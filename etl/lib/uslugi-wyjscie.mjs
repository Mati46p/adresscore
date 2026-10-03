// Format wyjściowy warstwy usług (#104): zwięzłe pliki kolumnowe per branża i katalog.json.
// Zasady prywatności: w plikach jest wyłącznie punkt (lon, lat), źródła jako bity, opcjonalna
// flaga branży i nazwa lokalu. Nazwa nigdy nie pochodzi z CEIDG, a nazwy wyglądające na dane osoby
// fizycznej (tytuł + imię, indywidualna praktyka) są odrzucane.
// Moduł jest czysty (bez wejścia-wyjścia), więc zlozWyjscie da się sprawdzić testem na punktach
// zmyślonych; zapis plików robi etl/uslugi.mjs.
import { czytelnaNazwa } from './codziennosc-geo.mjs'
import { ilePokrytych, polaczPunkty } from './uslugi-dedup.mjs'
import {
  BITY_ZRODEL,
  BRANZE,
  BRANZE_PO_ID,
  DEDUP_PROGI,
  OBSZARY_CEIDG,
  OPISY_ZRODEL,
  opisBranzy,
} from './uslugi-katalog.mjs'
import { wygladaNaOsobe } from './uslugi-nazwy.mjs'

export const WERSJA_FORMATU = 1
const MAX_NAZWA = 60

/** Współrzędne do 5 miejsc po przecinku (ok. 1 m): dokładność adresu i tak jest większa. */
export const zaokr5 = (v) => Math.round(v * 1e5) / 1e5

/**
 * Nazwa lokalu do pliku albo null. Odrzuca nazwy wyglądające na dane osoby (tytuł + nazwisko,
 * „Indywidualna praktyka", popularne imię + nazwisko: patrz wygladaNaOsobe), skraca do 60 znaków.
 * Nazwy z rejestrów (WIELKIMI LITERAMI) zamienia na zwykłą pisownię; nazwy z OSM i Overture zostają,
 * bo skróty marek („DOZ", „KFC") są wielkimi literami celowo.
 */
export function nazwaPubliczna(nazwa, zrodlo = 'osm') {
  const surowa = String(nazwa ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!surowa) return null
  const n =
    zrodlo === 'rejestr'
      ? czytelnaNazwa(surowa, MAX_NAZWA)
      : surowa.length > MAX_NAZWA
        ? `${surowa.slice(0, MAX_NAZWA - 1).trimEnd()}…`
        : surowa
  return !n || wygladaNaOsobe(n) ? null : n
}

/** Nazwa klastra do pliku: pierwsza użyteczna wg kolejności źródeł; CEIDG nazw nie dostarcza. */
export function nazwaKlastra(klaster) {
  for (const zrodlo of ['osm', 'overture', 'rejestr']) {
    for (const n of klaster.nazwy) {
      if (n.zrodlo !== zrodlo) continue
      const publiczna = nazwaPubliczna(n.nazwa, zrodlo)
      if (publiczna) return publiczna
    }
  }
  return null
}

const maska = (zrodla) => [...zrodla].reduce((m, z) => m | (BITY_ZRODEL[z] ?? 0), 0)

/** Źródła, które występują w pliku (co najmniej jeden punkt z danym bitem), w kolejności bitów. */
export function zrodlaWPliku(klastry) {
  const wystepuja = new Set()
  for (const k of klastry) for (const z of k.zrodla) wystepuja.add(z)
  return Object.keys(BITY_ZRODEL).filter((z) => wystepuja.has(z))
}

/** Opis źródła z OPISY_ZRODEL: bit `rejestr` oznacza rejestr właściwy dla branży (apteka, POZ). */
export const opisZrodla = (zrodlo, branza) =>
  OPISY_ZRODEL[zrodlo === 'rejestr' ? branza.rejestr : zrodlo]

/**
 * Atrybucja i licencja pliku zbudowane z faktycznie użytych źródeł. `zrodlaFlag` to źródła flag, które
 * nie tworzą punktów (np. `nfz` przy dentyście): w pliku jest po nich sam bit, ale licencja wymaga
 * wskazania źródła, więc idą do atrybucji i opisu licencji tak samo jak źródła punktów.
 */
export function licencjaPliku(zrodla, branza, zrodlaFlag = []) {
  const opisy = [
    ...zrodla.map((z) => opisZrodla(z, branza)),
    ...zrodlaFlag.map((z) => OPISY_ZRODEL[z]),
  ].filter(Boolean)
  const atrybucja = opisy.map((o) => o.atrybucja).join('; ')
  const czesci = []
  if (zrodla.includes('osm'))
    czesci.push(
      'Plik zawiera punkty z OpenStreetMap, więc jest bazą pochodną na licencji ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/): wymagana atrybucja „© OpenStreetMap contributors, ODbL", a udostępniając go dalej, zachowaj tę licencję (share-alike).',
    )
  for (const z of zrodla.filter((x) => x !== 'osm')) {
    const o = opisZrodla(z, branza)
    if (o) czesci.push(`${o.nazwa}: ${o.licencja}.`)
  }
  for (const z of zrodlaFlag) {
    const o = OPISY_ZRODEL[z]
    if (o) czesci.push(`Flaga z innego źródła, ${o.nazwa}: ${o.licencja}.`)
  }
  return { licencja: czesci.join(' '), atrybucja }
}

/**
 * Plik punktów jednej branży. `klastry` po deduplikacji (i filtrze źródła prawdy). Kolejność
 * punktów jest deterministyczna: szerokość, długość, maska źródeł.
 */
export function zbudujPlikBranzy(branza, klastry) {
  const flagiBranzy = Object.keys(branza.flagi ?? {})
  const wiersze = klastry
    .map((k) => ({
      lon: zaokr5(k.lon),
      lat: zaokr5(k.lat),
      zr: maska(k.zrodla),
      flagi: flagiBranzy.reduce((m, f, i) => (k.flagi.has(f) ? m | (1 << i) : m), 0),
      nazwa: nazwaKlastra(k),
    }))
    .sort((a, b) => a.lat - b.lat || a.lon - b.lon || a.zr - b.zr)
  // Flagi z innego źródła niż punkty (nfz) trafiają do atrybucji tylko wtedy, gdy ktoś je w pliku ma.
  const zrodlaFlag = [
    ...new Set(
      flagiBranzy
        .filter((f) => klastry.some((k) => k.flagi.has(f)))
        .map((f) => branza.flagi[f].zrodlo)
        .filter(Boolean),
    ),
  ]
  const { licencja, atrybucja } = licencjaPliku(zrodlaWPliku(klastry), branza, zrodlaFlag)
  const kolumny = {
    lon: wiersze.map((w) => w.lon),
    lat: wiersze.map((w) => w.lat),
    zr: wiersze.map((w) => w.zr),
  }
  if (flagiBranzy.length) kolumny.flagi = wiersze.map((w) => w.flagi)
  kolumny.nazwa = wiersze.map((w) => w.nazwa)
  return {
    wersja: WERSJA_FORMATU,
    branza: branza.id,
    nazwa: branza.nazwa,
    zasiegPieszyM: branza.zasiegPieszyM,
    n: wiersze.length,
    bityZrodel: BITY_ZRODEL,
    ...(flagiBranzy.length
      ? { bityFlag: Object.fromEntries(flagiBranzy.map((f, i) => [f, 1 << i])) }
      : {}),
    licencja,
    atrybucja,
    kolumny,
  }
}

/** Liczby do katalogu: punkty wejściowe per źródło, po deduplikacji i nakładanie się źródeł. */
export function liczbyBranzy({ wejscie, klastry, wPliku }) {
  const surowe = {}
  for (const p of wejscie) surowe[p.zrodlo] = (surowe[p.zrodlo] ?? 0) + 1
  const wgZrodel = {}
  for (const k of wPliku) for (const z of k.zrodla) wgZrodel[z] = (wgZrodel[z] ?? 0) + 1
  const zFlaga = {}
  for (const k of wPliku) for (const f of k.flagi) zFlaga[f] = (zFlaga[f] ?? 0) + 1
  const tylkoJedno = {}
  let wieleZrodel = 0
  for (const k of wPliku) {
    if (k.zrodla.size > 1) wieleZrodel++
    else {
      const [z] = k.zrodla
      tylkoJedno[z] = (tylkoJedno[z] ?? 0) + 1
    }
  }
  return {
    surowe,
    poDeduplikacji: klastry.length,
    wPliku: wPliku.length,
    wPlikuWgZrodel: wgZrodel,
    tylkoJednoZrodlo: tylkoJedno,
    potwierdzoneWielomaZrodlami: wieleZrodel,
    // Ile punktów w pliku ma daną flagę branży (barber, nfz, fast_food).
    zFlaga,
    // Punkty, które nie są wyłącznie adresem z CEIDG: rdzeń do liczenia konkurencji w zasięgu pieszym.
    bezSamegoCeidg: wPliku.length - (tylkoJedno.ceidg ?? 0),
  }
}

const procent = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null)

/**
 * Pokrycie źródeł kontrolnych (OSM, Overture) względem źródła prawdy (rejestr) dla branży z
 * `zrodloPrawdy`. Dwie miary: ścisła (ta sama deduplikacja co w pliku: do 30 m i podobna nazwa)
 * oraz luźna (jakikolwiek punkt prawdy w promieniu `metryLuzno`, bez nazwy), bo adres z rejestru
 * i punkt w OSM potrafią dzielić kilkadziesiąt metrów w dużym budynku.
 */
export function pokrycieWzgledemPrawdy({ wejscie, klastry, prawda = 'rejestr', metryLuzno = 100 }) {
  const wg = (z) => wejscie.filter((p) => p.zrodlo === z)
  const rejestr = wg(prawda)
  const wRejestrze = klastry.filter((k) => k.zrodla.has(prawda))
  const opis = {
    metryLuzno,
    rejestr: { rekordow: rejestr.length, punktow: wRejestrze.length },
  }
  for (const z of ['osm', 'overture']) {
    const kontrolne = wg(z)
    const klastrZ = klastry.filter((k) => k.zrodla.has(z))
    const ztymRejestrem = klastrZ.filter((k) => k.zrodla.has(prawda)).length
    const luzno = ilePokrytych(kontrolne, rejestr, metryLuzno)
    const rejestrWZ = wRejestrze.filter((k) => k.zrodla.has(z)).length
    const rejestrLuzno = ilePokrytych(rejestr, kontrolne, metryLuzno)
    opis[z] = {
      rekordow: kontrolne.length,
      punktow: klastrZ.length,
      wRejestrzeScisle: ztymRejestrem,
      wRejestrzeScislePct: procent(ztymRejestrem, klastrZ.length),
      wRejestrzeLuzno: luzno,
      wRejestrzeLuznoPct: procent(luzno, kontrolne.length),
      bezRejestru: klastrZ.length - ztymRejestrem,
    }
    opis.rejestr[`widocznychWZ_${z}Scisle`] = rejestrWZ
    opis.rejestr[`widocznychWZ_${z}ScislePct`] = procent(rejestrWZ, wRejestrze.length)
    opis.rejestr[`widocznychWZ_${z}Luzno`] = rejestrLuzno
    opis.rejestr[`widocznychWZ_${z}LuznoPct`] = procent(rejestrLuzno, rejestr.length)
  }
  return opis
}

/**
 * Składa pliki branż i katalog z punktów wejściowych { zrodlo, branza, nazwa, lat, lon, flagi }.
 * `meta`: { dataGenerowania, bbox, zrodla: { osm: {...}, ..., ceidg: {...} } } – daty stanu i pobrania
 * oraz liczby per źródło (dołączane do OPISY_ZRODEL), dla CEIDG także raport z pobrania.
 */
export function zlozWyjscie({ wejscie, meta }) {
  const pliki = {}
  const wpisy = []
  for (const b of BRANZE) {
    const pts = wejscie.filter((p) => p.branza === b.id)
    const klastry = polaczPunkty(pts)
    const wPliku = b.zrodloPrawdy ? klastry.filter((k) => k.zrodla.has(b.zrodloPrawdy)) : klastry
    const plik = zbudujPlikBranzy(b, wPliku)
    pliki[b.id] = plik
    const zrodla = zrodlaWPliku(wPliku)
    wpisy.push({
      ...opisBranzy(b),
      plik: `${b.id}.json`,
      n: plik.n,
      zrodlaWPliku: zrodla,
      licencja: plik.licencja,
      atrybucja: plik.atrybucja,
      liczby: liczbyBranzy({ wejscie: pts, klastry, wPliku }),
      // Pokrycie liczymy względem źródła prawdy (plik filtrowany) albo źródła kontrolnego (plik pełny).
      ...((b.zrodloPrawdy ?? b.kontrolaPokrycia)
        ? {
            pokrycie: pokrycieWzgledemPrawdy({
              wejscie: pts,
              klastry,
              prawda: b.zrodloPrawdy ?? b.kontrolaPokrycia,
            }),
          }
        : {}),
    })
  }
  const zrodla = {}
  for (const [id, opis] of Object.entries(OPISY_ZRODEL)) {
    zrodla[id] = { ...opis, ...(meta.zrodla?.[id] ?? {}) }
  }
  const katalog = {
    wersja: WERSJA_FORMATU,
    wygenerowano: meta.dataGenerowania,
    obszar: {
      opis: 'Kraków i 13 gmin obwarzanka; prostokąt z marginesem ok. 3 km, żeby punkty tuż za granicą gminy były widoczne',
      bbox: meta.bbox,
      gminy: OBSZARY_CEIDG.map((o) => ({ nazwa: o.nazwa, terc: o.terc })),
    },
    format: {
      opis: 'Pliki kolumnowe <branza>.json: kolumny lon, lat (WGS84, 5 miejsc), zr (maska bitowa źródeł), flagi (maska flag branży, tylko gdy branża je ma) i nazwa (null, gdy brak albo mogłaby być daną osoby fizycznej). Same punkty, bez wskaźników na adres.',
      bityZrodel: BITY_ZRODEL,
      uwagaRejestr:
        'Bit rejestr znaczy rejestr właściwy dla branży: apteka – Rejestr Aptek; poz, dentysta, fizjoterapia i laboratorium – RPWDL (patrz mapowanie.rejestr).',
    },
    progiDedupu: DEDUP_PROGI,
    zrodla,
    branze: wpisy,
  }
  return { pliki, katalog }
}

const KLUCZE_PLIKU = [
  'wersja',
  'branza',
  'nazwa',
  'zasiegPieszyM',
  'n',
  'bityZrodel',
  'licencja',
  'atrybucja',
  'kolumny',
]

/**
 * Sprawdza spójność wyniku zanim trafi na dysk: długości kolumn, współrzędne w obszarze, znane bity
 * źródeł, brak nazw przy punktach tylko z CEIDG, strażnik minimalnej liczby punktów branży.
 * Z `katalog` sprawdza też minima per źródło (BRANZE[].minZrodel wobec liczby punktów wejściowych).
 * Zwraca listę błędów (pustą, gdy wszystko gra).
 */
export function sprawdzWyjscie({ pliki, bbox, minima = {}, katalog = null }) {
  const bledy = []
  const dozwoloneBity = Object.values(BITY_ZRODEL).reduce((a, b) => a | b, 0)
  for (const [id, p] of Object.entries(pliki)) {
    for (const k of KLUCZE_PLIKU) if (!(k in p)) bledy.push(`${id}: brak pola ${k}`)
    const kol = p.kolumny
    for (const [nazwa, tab] of Object.entries(kol))
      if (tab.length !== p.n) bledy.push(`${id}: kolumna ${nazwa} ma ${tab.length} zamiast ${p.n}`)
    for (let i = 0; i < p.n; i++) {
      const { lon, lat } = { lon: kol.lon[i], lat: kol.lat[i] }
      if (
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        lat < bbox.minLat ||
        lat > bbox.maxLat ||
        lon < bbox.minLon ||
        lon > bbox.maxLon
      ) {
        bledy.push(`${id}: punkt ${i} poza obszarem (${lon}, ${lat})`)
        break
      }
      const zr = kol.zr[i]
      if (!zr || (zr & ~dozwoloneBity) !== 0) bledy.push(`${id}: punkt ${i} ma zły zr=${zr}`)
      if (zr === BITY_ZRODEL.ceidg && kol.nazwa[i] !== null)
        bledy.push(`${id}: punkt ${i} tylko z CEIDG ma nazwę`)
    }
    if (minima[id] !== undefined && p.n < minima[id])
      bledy.push(
        `${id}: ${p.n} punktów, poniżej strażnika ${minima[id]} (źródło zwróciło za mało?)`,
      )
  }
  for (const wpis of katalog?.branze ?? []) {
    for (const [zrodlo, min] of Object.entries(BRANZE_PO_ID[wpis.id]?.minZrodel ?? {})) {
      const ile = wpis.liczby.surowe[zrodlo] ?? 0
      if (ile < min)
        bledy.push(`${wpis.id}: źródło ${zrodlo} dało ${ile} punktów, poniżej strażnika ${min}`)
    }
    // Flaga z osobnego źródła (nfz) też ma strażnika: brak odpowiedzi API albo zła zgodność adresów
    // dałyby plik bez flag i bez żadnego błędu.
    for (const [flaga, min] of Object.entries(BRANZE_PO_ID[wpis.id]?.minFlag ?? {})) {
      const ile = wpis.liczby.zFlaga?.[flaga] ?? 0
      if (ile < min)
        bledy.push(`${wpis.id}: flaga ${flaga} ma ${ile} punktów, poniżej strażnika ${min}`)
    }
  }
  return bledy
}
