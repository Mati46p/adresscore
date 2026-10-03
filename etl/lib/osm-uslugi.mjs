// Czyste funkcje warstw „usługi z OSM i InPost" (#124): definicje grup tagów, geometria punktów
// z linii OSM, szukanie najbliższego obiektu i licznik obiektów na 1000 mieszkańców.
// Bez wejścia/wyjścia, więc da się je testować bez pliku PBF i bez sieci (etl/osm-uslugi.test.mjs).
import { indeksPunktow, odlegloscMetry } from './codziennosc-geo.mjs'

// Dostęp, który wyklucza obiekt z „ogólnodostępnych": miejsce prywatne, dla klientów, na zezwolenie.
const OGRANICZONY = new Set(['private', 'no', 'customers', 'permit', 'delivery', 'members'])
const dostepOgraniczony = (t) => OGRANICZONY.has(t.access)
const prywatny = (t) => t.access === 'private' || t.access === 'no'

// Punkty kurierskie wpisywane w OSM jako post_office – to nie poczta.
const KURIERZY = /\b(inpost|dpd|gls|dhl|ups|fedex|orlen|allegro|paczkomat|kurier)\b/i
// Internaty szkolne, bursy i stołówki mają tag building=dormitory, ale to nie akademiki.
const NIE_AKADEMIK = /internat|bursa|stołówk|aplikant|garnizon|ośrodek szkolno|wychowawcz/i
// Płatne atrakcje wpisywane w OSM jako plac zabaw: sale zabaw, trampoliny, parki linowe.
const KOMERCYJNY_PLAC = /bawialni|sala zabaw|trampolin|park linow|park rozrywki/i

/**
 * Grupy wskaźników. `tagi`: pary [klucz, wartość] – obiekt OSM trafia do grupy, gdy ma którąkolwiek.
 * `akceptuj`: dodatkowy filtr na tagach obiektu (null = bierzemy wszystko z pasującym tagiem).
 * `brzeg`: obiekt jest dużym obszarem, więc odległość liczymy do obrysu, a nie do środka.
 * Ta lista jest jedynym źródłem prawdy: zapytanie do pliku PBF składamy z niej (warunekSql).
 */
export const GRUPY = [
  {
    id: 'bankomat_poczta',
    tagi: [
      ['amenity', 'atm'],
      ['amenity', 'post_office'],
    ],
    akceptuj: (t) => !(t.amenity === 'post_office' && KURIERZY.test(t.operator ?? '')),
  },
  {
    id: 'kultura',
    tagi: [
      ['amenity', 'theatre'],
      ['amenity', 'cinema'],
      ['amenity', 'arts_centre'],
      ['amenity', 'library'],
      ['amenity', 'community_centre'],
      ['tourism', 'museum'],
      ['tourism', 'gallery'],
    ],
    // Świetlice wiejskie i domy parafialne mają tag community_centre, ale to nie instytucje kultury.
    akceptuj: (t) =>
      !prywatny(t) &&
      (t.amenity !== 'community_centre' ||
        /kultur/i.test(t.name ?? '') ||
        t.community_centre === 'cultural_centre'),
  },
  {
    id: 'plac_zabaw',
    tagi: [['leisure', 'playground']],
    akceptuj: (t) =>
      !dostepOgraniczony(t) &&
      t.indoor !== 'yes' &&
      t.fee !== 'yes' &&
      !KOMERCYJNY_PLAC.test(t.name ?? ''),
  },
  {
    id: 'toaleta_woda',
    tagi: [
      ['amenity', 'toilets'],
      ['amenity', 'drinking_water'],
    ],
    // Woda oznaczona jako niezdatna do picia (drinking_water=no, drinking_water:legal=no) odpada.
    akceptuj: (t) =>
      !dostepOgraniczony(t) &&
      !(
        t.amenity === 'drinking_water' &&
        (t.drinking_water === 'no' || t['drinking_water:legal'] === 'no')
      ),
  },
  {
    id: 'defibrylator',
    tagi: [['emergency', 'defibrillator']],
    // Bez tagu access zakładamy dostęp publiczny, chyba że urządzenie jest w budynku (godziny nieznane).
    akceptuj: (t) =>
      t.access === 'yes' ||
      t.access === 'permissive' ||
      (t.access === undefined && t.indoor !== 'yes'),
  },
  {
    id: 'recykling',
    tagi: [['amenity', 'recycling']],
    akceptuj: (t) => !prywatny(t),
  },
  {
    id: 'rod',
    tagi: [['landuse', 'allotments']],
    akceptuj: null,
    brzeg: true,
  },
  {
    id: 'weterynarz',
    tagi: [['amenity', 'veterinary']],
    akceptuj: null,
  },
  {
    id: 'akademik',
    tagi: [
      ['building', 'dormitory'],
      ['amenity', 'student_accommodation'],
    ],
    akceptuj: (t) => !NIE_AKADEMIK.test(t.name ?? ''),
  },
]

/** Klucze tagów, które czytamy z pliku PBF: te z grup oraz pomocnicze dla filtrów. */
export const KLUCZE_TAGOW = [
  ...new Set([
    ...GRUPY.flatMap((g) => g.tagi.map(([k]) => k)),
    'name',
    'operator',
    'access',
    'indoor',
    'fee',
    'community_centre',
    'drinking_water',
    'drinking_water:legal',
  ]),
]

/** Warunek SQL (DuckDB, kolumna `tags` z ST_ReadOSM) wybierający obiekty z którymkolwiek tagiem grupy. */
export function warunekSql() {
  const poKluczu = new Map()
  for (const g of GRUPY)
    for (const [k, v] of g.tagi) poKluczu.set(k, [...(poKluczu.get(k) ?? []), v])
  return [...poKluczu]
    .map(
      ([k, wartosci]) =>
        `map_extract_value(tags, '${k}') in (${[...new Set(wartosci)].map((v) => `'${v}'`).join(', ')})`,
    )
    .join(' or ')
}

/** Identyfikatory grup, do których należy obiekt o danych tagach (obiekt może być w kilku). */
export function klasyfikuj(tagi) {
  return GRUPY.filter(
    (g) => g.tagi.some(([k, v]) => tagi[k] === v) && (!g.akceptuj || g.akceptuj(tagi)),
  ).map((g) => g.id)
}

// --- Geometria -----------------------------------------------------------------------------

const bezPowtorzonegoKonca = (lats, lons) => {
  const n = lats.length
  return n > 1 && lats[0] === lats[n - 1] && lons[0] === lons[n - 1] ? n - 1 : n
}

/** Środek linii OSM jako średnia wierzchołków (zamknięta linia nie liczy pierwszego punktu dwa razy). */
export function srodekLinii(lats, lons) {
  const n = bezPowtorzonegoKonca(lats, lons)
  let sLat = 0
  let sLon = 0
  for (let i = 0; i < n; i++) {
    sLat += lats[i]
    sLon += lons[i]
  }
  return [sLat / n, sLon / n]
}

/** Punkty wzdłuż obrysu: wierzchołki i punkty pośrednie co najwyżej co `krokM` metrów. */
export function punktyBrzegu(lats, lons, krokM = 50) {
  const punkty = []
  for (let i = 0; i + 1 < lats.length; i++) {
    const [aLat, aLon, bLat, bLon] = [lats[i], lons[i], lats[i + 1], lons[i + 1]]
    const kroki = Math.max(1, Math.ceil(odlegloscMetry(aLat, aLon, bLat, bLon) / krokM))
    for (let j = 0; j < kroki; j++) {
      const u = j / kroki
      punkty.push([aLat + (bLat - aLat) * u, aLon + (bLon - aLon) * u])
    }
  }
  const ostatni = lats.length - 1
  if (ostatni >= 0) punkty.push([lats[ostatni], lons[ostatni]])
  return punkty
}

/**
 * Łączy punkty bliższe niż `promienM` (ten sam obiekt zapisany w OSM jako węzeł i jako budynek).
 * Zachowuje pierwszy z pary. Wejście jest posortowane, więc wynik nie zależy od kolejności pliku.
 */
export function scalDuplikaty(punkty, promienM = 25) {
  const posortowane = [...punkty].sort(
    (a, b) => a.lat - b.lat || a.lon - b.lon || (a.nazwa ?? '').localeCompare(b.nazwa ?? ''),
  )
  const komorka = 0.0005 // ok. 55 m w szerokości, więc sąsiad w promieniu 25 m jest w sąsiedniej komórce
  const siatka = new Map()
  const klucz = (cy, cx) => `${cy}|${cx}`
  const wynik = []
  for (const p of posortowane) {
    const cy = Math.floor(p.lat / komorka)
    const cx = Math.floor(p.lon / komorka)
    let duplikat = false
    for (let dy = -1; dy <= 1 && !duplikat; dy++)
      for (let dx = -1; dx <= 1 && !duplikat; dx++)
        for (const q of siatka.get(klucz(cy + dy, cx + dx)) ?? [])
          if (odlegloscMetry(p.lat, p.lon, q.lat, q.lon) <= promienM) {
            duplikat = true
            break
          }
    if (duplikat) continue
    wynik.push(p)
    const k = klucz(cy, cx)
    if (siatka.has(k)) siatka.get(k).push(p)
    else siatka.set(k, [p])
  }
  return wynik
}

// --- Najbliższy obiekt ---------------------------------------------------------------------

/** Rozmiar komórki indeksu dobrany do liczby punktów: rzadkie grupy potrzebują większych komórek. */
export function komorkaDla(liczbaPunktow) {
  if (liczbaPunktow < 150) return 3000
  if (liczbaPunktow < 600) return 1500
  if (liczbaPunktow < 2500) return 1000
  return 500
}

/**
 * Funkcja (lat, lon) → { punkt, metry } | null, gdzie null znaczy: nic w promieniu `maxM`.
 * Punkty to obiekty { lat, lon, ... }; indeks dopisuje im pola x i y.
 */
export function budujNajblizszy(punkty, maxM) {
  const najblizszy = indeksPunktow(punkty, komorkaDla(punkty.length))
  return (lat, lon) => najblizszy(lat, lon, maxM)
}

/** Odległości (zaokrąglone do metra) od każdego adresu do najbliższego punktu; brak w promieniu = null. */
export function odleglosci(adresy, punkty, maxM) {
  const najblizszy = budujNajblizszy(punkty, maxM)
  return adresy.map((a) => {
    const w = najblizszy(a.lat, a.lon)
    return w ? Math.round(w.metry) : null
  })
}

// --- Licznik porównawczy -------------------------------------------------------------------

/**
 * Liczba obiektów w gminach: obiekt należy do gminy najbliższego punktu adresowego, o ile ten leży
 * bliżej niż `maxM`. Granic gmin nie mamy, a o to pytamy tylko po to, by porównać kompletność mapy.
 * `najblizszyAdres` pochodzi z budujNajblizszy(adresy, maxM); adresy mają pole `teryt`.
 */
export function obiektyWGminach(punkty, najblizszyAdres) {
  const wg = new Map()
  for (const p of punkty) {
    const w = najblizszyAdres(p.lat, p.lon)
    if (w) wg.set(w.punkt.teryt, (wg.get(w.punkt.teryt) ?? 0) + 1)
  }
  return wg
}

/**
 * Obiekty na 1000 mieszkańców osobno dla Krakowa i dla reszty gmin (obwarzanka).
 * `ludnosc`: Map teryt → liczba mieszkańców; gmina bez ludności w mapie to błąd, nie zero.
 */
export function licznikNa1000(obiektyWgGminy, ludnosc, terytKrakowa) {
  const suma = (czyKrakow) => {
    let obiekty = 0
    let mieszkancy = 0
    for (const [teryt, mieszkancyGminy] of ludnosc) {
      if ((teryt === terytKrakowa) !== czyKrakow) continue
      obiekty += obiektyWgGminy.get(teryt) ?? 0
      mieszkancy += mieszkancyGminy
    }
    return { obiekty, mieszkancy, na1000: mieszkancy ? (1000 * obiekty) / mieszkancy : null }
  }
  return { krakow: suma(true), obwarzanek: suma(false) }
}

/** Liczba po polsku z jednym miejscem po przecinku (dwoma poniżej 0,1), np. „0,9" albo „0,04". */
export function liczbaPL(x) {
  const miejsca = x > 0 && x < 0.1 ? 2 : 1
  return x.toLocaleString('pl-PL', {
    minimumFractionDigits: miejsca,
    maximumFractionDigits: miejsca,
  })
}

// --- InPost --------------------------------------------------------------------------------

/**
 * Paczkomaty (type zawiera parcel_locker) z odpowiedzi API punktów InPost. Punkty obsługi bez
 * automatu (pok, pop, pudo_mini) odpadają. Wynik jest posortowany, więc nie zależy od kolejności stron.
 */
export function paczkomaty(items) {
  return items
    .filter(
      (p) =>
        Array.isArray(p.type) &&
        p.type.includes('parcel_locker') &&
        p.status === 'Operating' &&
        Number.isFinite(p.location?.latitude) &&
        Number.isFinite(p.location?.longitude),
    )
    .map((p) => ({ nazwa: p.name ?? null, lat: p.location.latitude, lon: p.location.longitude }))
    .sort((a, b) => a.lat - b.lat || a.lon - b.lon || (a.nazwa ?? '').localeCompare(b.nazwa ?? ''))
}
