// Warstwa „Dni z wydarzeniem w dużych obiektach w 500 m (sezon 2025/26)” (#71, obok wykazu
// imprez stałych z etl/imprezy-stale.mjs). Dla każdego heksu H3 r10 w Krakowie: ile RÓŻNYCH dni
// w sezonie 1 VII 2025 – 30 VI 2026 miało wydarzenie w którymkolwiek z pięciu dużych obiektów
// w promieniu 500 m od obrysu: TAURON Arena, EXPO Kraków, ICE Kraków (kalendarze obiektów),
// Stadion Cracovii i Stadion Wisły (mecze ligowe gospodarza). Kategoria „kontekst”: fakt na
// karcie, bez wpływu na wynik.
//
//   node etl/imprezy-obiekty.mjs             – liczy z migawki etl/imprezy-obiekty-2025-26.json
//                                              (bez sieci, wynik powtarzalny)
//   node etl/imprezy-obiekty.mjs --pobierz   – najpierw odświeża migawkę ze źródeł (kalendarze
//                                              obiektów, terminarze, obrysy OSM), potem liczy;
//                                              odpowiedzi serwisów zostają w etl/.cache, a
//                                              --swieze każe je pobrać od nowa
//
// Migawka trzyma same DATY (fakty) i obrysy, nie tytuły ani opisy wydarzeń (poza tytułami
// odrzuconych wpisów, do kontroli). Metoda, ograniczenia i kontrola: etl/imprezy-obiekty.md.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cellToLatLng } from 'h3-js'
import { do2180, odlegloscDoBbox, odlegloscDoWielokata, pierscien, wielokat } from './lib/geo.mjs'
import {
  dniDoMiesiecy,
  dniExpo,
  dniICE,
  dniTauron,
  dniZMiesiecy,
  meczeDomoweCSV,
  meczeDomoweLiga,
  obrysDoWkt,
  obrysZWkt,
  pobierzCsvLigi,
  pobierzExpo,
  pobierzIce,
  pobierzObrysy,
  pobierzStroneKlubu1Ligi,
  pobierzTauron,
  wOknie,
} from './lib/imprezy-zrodla.mjs'
import { dzis, KORZEN, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const ZADANIE = 71
export const ID_WSKAZNIKA = 'imprezy_obiekty_dni_500m_2025_26'
/** Zasięg od obrysu obiektu do środka heksu – ten sam co w warstwie wykazu imprez stałych. */
export const PROMIEN_M = 500
export const TERYT_KRAKOW = '1261011'
/** Sezon 2025/26 w całości już za nami, więc kalendarze i terminarze są kompletne. */
export const OKNO = { od: '2025-07-01', do: '2026-06-30', nazwa: 'sezon 2025/26' }
/** Pełny sezon ligowy: 18 drużyn, 34 kolejki, 17 meczów domowych każdej. */
export const MECZE_DOMOWE_W_SEZONIE = 17
export const PLIK_MIGAWKI = join(KORZEN, 'etl', 'imprezy-obiekty-2025-26.json')

const BRAK_LICENCJI =
  'Brak otwartej licencji. Z serwisu użyto wyłącznie dat wydarzeń (fakty); warstwa zawiera liczby dni, bez tytułów i opisów.'

/** Meczów domowych drużyny w oknie; błąd, gdy źródło nie zwróciło pełnego sezonu. */
function mecze(dni, nazwa) {
  const wOkn = dni.filter((d) => wOknie(d, OKNO))
  if (wOkn.length !== MECZE_DOMOWE_W_SEZONIE)
    throw new Error(`${nazwa}: ${wOkn.length} meczów domowych w oknie, oczekiwano 17`)
  return { dni: wOkn, wpisow: wOkn.length, odrzucone: [] }
}

/**
 * Obiekty warstwy. `osm` wskazuje obrys budynku (building=stadium lub building=yes) w OSM,
 * `pobierz` zwraca { dni, wpisow, odrzucone } z kalendarza obiektu.
 */
export const OBIEKTY = [
  {
    id: 'tauron-arena',
    nazwa: 'TAURON Arena Kraków',
    osm: { typ: 'way', id: 292867512 },
    zrodlo: {
      nazwa: 'TAURON Arena Kraków – kalendarz wydarzeń (REST API strony obiektu)',
      url: 'https://www.tauronarenakrakow.pl/events/',
      licencja: BRAK_LICENCJI,
    },
    pobierz: async (odswiez) => dniTauron(await pobierzTauron(OKNO, odswiez), OKNO),
  },
  {
    id: 'expo-krakow',
    nazwa: 'EXPO Kraków',
    osm: { typ: 'way', id: 329853261 },
    zrodlo: {
      nazwa: 'EXPO Kraków – kalendarz wydarzeń',
      url: 'https://expokrakow.com/kalendarz',
      licencja: BRAK_LICENCJI,
    },
    pobierz: async (odswiez) => dniExpo(await pobierzExpo(OKNO, odswiez), OKNO),
  },
  {
    id: 'ice-krakow',
    nazwa: 'ICE Kraków',
    osm: { typ: 'way', id: 301936204 },
    zrodlo: {
      nazwa: 'Centrum Kongresowe ICE Kraków – kalendarium i archiwum wydarzeń',
      url: 'https://icekrakow.pl/kalendarium/archiwum',
      licencja: BRAK_LICENCJI,
    },
    pobierz: async (odswiez) => dniICE(await pobierzIce(OKNO, odswiez), OKNO),
  },
  {
    id: 'stadion-cracovii',
    nazwa: 'Stadion Cracovii',
    osm: { typ: 'relation', id: 3178493 },
    zrodlo: {
      nazwa:
        'Mecze domowe Cracovii w Ekstraklasie 2025/26 (football-data.co.uk; 17 dat zgodnych co do dnia z oficjalnym terminarzem Ekstraklasy SA, ekstraklasa.org/terminarz/2025-2026)',
      url: 'https://www.football-data.co.uk/poland.php',
      licencja:
        'Dane udostępniane bezpłatnie przez football-data.co.uk, bez formalnej licencji. Użyto wyłącznie dat meczów (fakty).',
    },
    pobierz: async (odswiez) =>
      mecze(
        meczeDomoweCSV(await pobierzCsvLigi(odswiez), { druzyna: 'Cracovia', sezon: '2025/2026' }),
        'Cracovia',
      ),
  },
  {
    id: 'stadion-wisly',
    nazwa: 'Stadion Wisły Kraków',
    osm: { typ: 'relation', id: 3178490 },
    zrodlo: {
      nazwa:
        'Mecze domowe Wisły Kraków w Betclic 1 Lidze 2025/26 (1liga.org, oficjalna strona rozgrywek)',
      url: 'https://www.1liga.org/en/wisla-krakow',
      licencja:
        'Brak otwartej licencji (© 1liga.org). Użyto wyłącznie dat rozegranych meczów (fakty).',
    },
    pobierz: async (odswiez) =>
      mecze(
        meczeDomoweLiga(
          await pobierzStroneKlubu1Ligi('https://www.1liga.org/en/wisla-krakow', odswiez),
          'Wisła Kraków',
        ),
        'Wisła Kraków',
      ),
  },
]

// ── Migawka ──────────────────────────────────────────────────────────────────────────────

const OPIS_MIGAWKI =
  'Migawka dat i obrysów dla warstwy imprezy_obiekty_dni_500m_2025_26 (etl/imprezy-obiekty.mjs). Dni to różne dni kalendarzowe z wydarzeniem w kalendarzu obiektu (po odrzuceniu odwołanych) albo z meczem domowym gospodarza, w oknie sezonu. Tytułów ani opisów wydarzeń nie przechowujemy, poza tytułami odrzuconych wpisów (do kontroli). Obrysy to budynki obiektów z OpenStreetMap (ODbL 1.0). Odświeżenie: node etl/imprezy-obiekty.mjs --pobierz.'

/** Pobiera kalendarze, terminarze i obrysy, składa migawkę (tylko --pobierz). */
export async function zbudujMigawke(odswiez = false) {
  const { obrysy, znacznik } = await pobierzObrysy(
    OBIEKTY.map((o) => o.osm),
    odswiez,
  )
  const pobrano = dzis()
  const obiekty = []
  for (const o of OBIEKTY) {
    const wynik = await o.pobierz(odswiez)
    obiekty.push({
      id: o.id,
      nazwa: o.nazwa,
      osm: `https://www.openstreetmap.org/${o.osm.typ}/${o.osm.id}`,
      obrys: obrysDoWkt(obrysy[`${o.osm.typ}/${o.osm.id}`]),
      zrodlo: { ...o.zrodlo, pobrano },
      wpisow: wynik.wpisow,
      liczbaDni: wynik.dni.length,
      dni: dniDoMiesiecy(wynik.dni),
      odrzucone: wynik.odrzucone,
    })
    console.log(
      `${o.nazwa}: ${wynik.wpisow} wpisów, ${wynik.dni.length} dni, odrzucono ${wynik.odrzucone.length}`,
    )
  }
  return {
    opis: OPIS_MIGAWKI,
    sporzadzono: pobrano,
    okno: { ...OKNO },
    obrysyOsm: { znacznik },
    obiekty,
  }
}

const WYMAGANE_ZRODLO = ['nazwa', 'url', 'licencja', 'pobrano']
/** Kraków z zapasem: obrys poza tym oknem to przestawione współrzędne. */
const OKNO_KRAKOWA = { lat: [49.95, 50.15], lon: [19.75, 20.2] }

/**
 * Waliduje migawkę i zwraca obiekty z rozwiniętymi dniami i obrysem. Błąd w pliku ma zatrzymać
 * skrypt, a nie trafić na kartę adresu.
 */
export function sprawdzMigawke(migawka) {
  const bledy = []
  if (migawka?.okno?.od !== OKNO.od || migawka.okno.do !== OKNO.do)
    bledy.push(`okno: oczekiwano ${OKNO.od} – ${OKNO.do}`)
  if (!Array.isArray(migawka?.obiekty) || !migawka.obiekty.length) bledy.push('brak obiektów')
  const ids = new Set()
  const wynik = []
  for (const o of migawka?.obiekty ?? []) {
    const g = o.id ?? '?'
    if (ids.has(o.id)) bledy.push(`${g}: powtórzone id`)
    ids.add(o.id)
    for (const pole of ['id', 'nazwa', 'osm', 'obrys'])
      if (typeof o[pole] !== 'string' || !o[pole]) bledy.push(`${g}: brak pola ${pole}`)
    if (!o.osm?.startsWith('https://www.openstreetmap.org/'))
      bledy.push(`${g}: osm musi wskazywać obiekt w OpenStreetMap`)
    for (const k of WYMAGANE_ZRODLO) if (!o.zrodlo?.[k]) bledy.push(`${g}: zrodlo.${k}`)
    let obrys = []
    let dni = []
    try {
      obrys = obrysZWkt(o.obrys)
      const zamkniety =
        obrys.length >= 4 &&
        obrys[0]?.[0] === obrys.at(-1)?.[0] &&
        obrys[0]?.[1] === obrys.at(-1)?.[1]
      if (!zamkniety) bledy.push(`${g}: obrys niezamknięty`)
      if (
        obrys.some(
          ([lon, lat]) =>
            lat < OKNO_KRAKOWA.lat[0] ||
            lat > OKNO_KRAKOWA.lat[1] ||
            lon < OKNO_KRAKOWA.lon[0] ||
            lon > OKNO_KRAKOWA.lon[1],
        )
      )
        bledy.push(`${g}: obrys poza Krakowem`)
    } catch (e) {
      bledy.push(`${g}: ${e.message}`)
    }
    try {
      dni = dniZMiesiecy(o.dni ?? {})
      if (new Set(dni).size !== dni.length) bledy.push(`${g}: powtórzone dni`)
      if (dni.some((d) => !wOknie(d, OKNO))) bledy.push(`${g}: dzień poza oknem`)
      if (dni.length !== o.liczbaDni)
        bledy.push(`${g}: liczbaDni ${o.liczbaDni}, jest ${dni.length}`)
    } catch (e) {
      bledy.push(`${g}: ${e.message}`)
    }
    if (!Array.isArray(o.odrzucone)) bledy.push(`${g}: brak listy odrzuconych`)
    wynik.push({ id: o.id, nazwa: o.nazwa, osm: o.osm, zrodlo: o.zrodlo, obrys, dni: new Set(dni) })
  }
  if (bledy.length) throw new Error(`Migawka imprez w obiektach: ${bledy.join('; ')}`)
  return wynik
}

// ── Liczenie ─────────────────────────────────────────────────────────────────────────────

/** Obiekty z obrysem w metrach (EPSG:2180), gotowe do liczenia odległości. */
export function przygotujObiekty(migawka) {
  return sprawdzMigawke(migawka).map((o) => ({
    ...o,
    wielokat: wielokat([pierscien(o.obrys.map(([lon, lat]) => do2180(lon, lat)))]),
  }))
}

/** Obiekty, których obrys leży najwyżej `promien` metrów od punktu (0 m = punkt w środku). */
export function obiektyWZasiegu(lat, lon, obiekty, promien = PROMIEN_M) {
  const [x, y] = do2180(lon, lat)
  return obiekty.filter(
    (o) =>
      odlegloscDoBbox(x, y, o.wielokat.bbox) <= promien &&
      odlegloscDoWielokata(x, y, o.wielokat) <= promien,
  )
}

export const dniSlownie = (n) => `${n} ${n === 1 ? 'dzień' : 'dni'}`

/**
 * Wartość heksu = liczba różnych dni z dowolnego obiektu w zasięgu. Etykieta: przy jednym obiekcie
 * sama nazwa (jego dni to już wartość, a karta pokazuje „wartość – etykieta”, więc liczba nie
 * może się powtórzyć), przy kilku nazwy z dniami każdego, żeby było widać, z czego wynika suma.
 */
export function opisHeksu(wZasiegu) {
  const dni = new Set()
  for (const o of wZasiegu) for (const d of o.dni) dni.add(d)
  const kolejnosc = [...wZasiegu].sort(
    (a, b) => b.dni.size - a.dni.size || a.nazwa.localeCompare(b.nazwa, 'pl'),
  )
  const tekst =
    kolejnosc.length === 1
      ? (kolejnosc[0]?.nazwa ?? '')
      : kolejnosc.map((o) => `${o.nazwa} (${dniSlownie(o.dni.size)})`).join(', ')
  return { wartosc: dni.size, tekst }
}

export function policzWarstwe(adresy, obiekty) {
  const heksy = new Map()
  const wartosci = []
  const etykiety = []
  const slownikEtykiet = {}
  const kluczeEtykiet = new Map()
  for (const adres of adresy) {
    if (adres.teryt !== TERYT_KRAKOW) {
      wartosci.push(null)
      etykiety.push(null)
      continue
    }
    if (!heksy.has(adres.h3)) {
      const [lat, lon] = cellToLatLng(adres.h3)
      heksy.set(adres.h3, opisHeksu(obiektyWZasiegu(lat, lon, obiekty)))
    }
    const wynik = heksy.get(adres.h3)
    wartosci.push(wynik.wartosc)
    if (!wynik.tekst) {
      etykiety.push(null)
      continue
    }
    if (!kluczeEtykiet.has(wynik.tekst)) {
      const kod = String(kluczeEtykiet.size + 1)
      kluczeEtykiet.set(wynik.tekst, kod)
      slownikEtykiet[kod] = wynik.tekst
    }
    etykiety.push(kluczeEtykiet.get(wynik.tekst))
  }
  return { wartosci, etykiety, slownikEtykiet, liczbaHeksow: heksy.size }
}

// ── Metadane ─────────────────────────────────────────────────────────────────────────────

export function metaWskaznika(migawka) {
  const dataDanych = `${OKNO.od} – ${OKNO.do}`
  const osmZnacznik = (migawka.obrysyOsm?.znacznik ?? migawka.sporzadzono).slice(0, 10)
  return {
    id: ID_WSKAZNIKA,
    nazwa: 'Dni z wydarzeniem w dużych obiektach w 500 m (sezon 2025/26)',
    opis: 'Liczba dni od 1 lipca 2025 do 30 czerwca 2026, w których w kalendarzu przynajmniej jednego z pięciu dużych obiektów w promieniu 500 m od adresu było wydarzenie: TAURON Arena Kraków, EXPO Kraków i ICE Kraków (kalendarze obiektów) oraz Stadion Cracovii i Stadion Wisły (mecze ligowe gospodarza). Dzień z wydarzeniami w kilku obiektach liczony raz; etykieta wymienia obiekty w zasięgu, a przy kilku także ich dni osobno. To nie jest liczba imprez masowych, poziom hałasu ani rejestr zezwoleń: wpis kalendarza to i koncert dla kilkunastu tysięcy osób, i konferencja czy spektakl w mniejszej sali. Bez wpisów odwołanych, meczów pucharowych i towarzyskich oraz koncertów na stadionach. Zasięg liczony od środka heksu H3 do obrysu obiektu w OpenStreetMap. Zero oznacza brak takiego dnia przy tych pięciu obiektach, nie brak innych wydarzeń w okolicy (Błonia, Rynek, plenery: patrz warstwa wpisów wykazu imprez stałych). Poza Krakowem brak danych.',
    jednostka: 'dni z wydarzeniem',
    kategoria: 'kontekst',
    kierunek: 'neutralny',
    rozdzielczosc: 'heks',
    rozmiar: `promień ${PROMIEN_M} m od obrysu obiektu, liczony od środka heksu H3 r10`,
    zadanie: ZADANIE,
    zrodla: [
      ...migawka.obiekty.map((o) => ({
        nazwa: o.zrodlo.nazwa,
        url: o.zrodlo.url,
        licencja: o.zrodlo.licencja,
        dataDanych,
        pobrano: o.zrodlo.pobrano,
      })),
      {
        nazwa: 'OpenStreetMap – obrysy budynków obiektów',
        url: 'https://www.openstreetmap.org/copyright',
        licencja: 'Open Database License 1.0 – https://opendatacommons.org/licenses/odbl/1-0/',
        dataDanych: osmZnacznik,
        pobrano: migawka.sporzadzono,
      },
    ],
  }
}

// ── Uruchomienie ─────────────────────────────────────────────────────────────────────────

async function main() {
  let migawka
  if (process.argv.includes('--pobierz')) {
    // Odpowiedzi serwisów leżą w etl/.cache; --swieze każe je pobrać od nowa.
    migawka = await zbudujMigawke(process.argv.includes('--swieze'))
    sprawdzMigawke(migawka)
    writeFileSync(PLIK_MIGAWKI, `${JSON.stringify(migawka, null, 2)}\n`)
    console.log(`Zapisano migawkę: ${PLIK_MIGAWKI}`)
  } else {
    migawka = JSON.parse(readFileSync(PLIK_MIGAWKI, 'utf8'))
  }
  const obiekty = przygotujObiekty(migawka)
  const { adresy, atrapa } = wczytajAdresy()
  if (atrapa) throw new Error('Wymagane rzeczywiste adresy MSIP')
  const wynik = policzWarstwe(adresy, obiekty)
  zapiszWskaznik(metaWskaznika(migawka), wynik.wartosci, wynik.etykiety, wynik.slownikEtykiet)
  const zWydarzeniem = wynik.wartosci.filter((v) => v !== null && v > 0)
  console.log(
    `Sprawdzono ${wynik.liczbaHeksow} heksów Krakowa; ${zWydarzeniem.length} adresów ma co najmniej jeden dzień z wydarzeniem w zasięgu`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
