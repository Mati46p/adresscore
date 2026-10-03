// Dojazd drogą gruntową (#73): dwa wskaźniki dla każdego adresu z adresy.json.
//   dojazd_utwardzony   – 1, gdy najbliższa ulica ma nawierzchnię utwardzoną, 0, gdy gruntową;
//   drogi_gruntowe_300m – % długości dróg gruntowych wśród dróg o znanej nawierzchni w promieniu 300 m.
//
// Źródła (oba bez klucza i logowania):
//   * OpenStreetMap, ekstrakt Geofabrik (Małopolska): highway + surface (+ tracktype dla dróg polnych).
//   * BDOT10k, warstwa OT_SKDR_L (droga) z paczek SHP powiatów 1261, 1206, 1219 i 1214
//     (opendata.geoportal.gov.pl). Atrybut MATE_NAWIE jest wypełniony na każdym odcinku.
//
// Dlaczego dwa źródła: w OSM tag surface ma tylko ok. połowa ulic osiedlowych (residential 53%,
// unclassified 58%, service 18%), a to one najczęściej prowadzą do domów. BDOT10k ma materiał na
// każdym odcinku i zawiera też drogi polne, których OSM nie ma, ale jest opracowany z ortofotomapy
// i bywa starszy. Reguła z issue: jawny tag OSM ma pierwszeństwo, gdy go brak – materiał z BDOT10k.
//
// Jak łączymy: sieć = odcinki BDOT10k + odcinki OSM, których BDOT10k nie pokrywa. Odcinek OSM
// (kawałki do 30 m) uznajemy za pokryty, gdy w odległości do 12 m leży prawie równoległy kawałek
// BDOT10k. Pokryty odcinek BDOT10k dostaje klasę z jawnego tagu OSM; reszta zostaje z BDOT10k.
// Odcinek OSM bez pokrycia (nowa droga, poza powiatami z paczek) wchodzi do sieci ze swoją klasą:
// z tagu surface, z tracktype albo wnioskowaną z klasy drogi (primary/secondary/tertiary = utwardzona,
// track = gruntowa); resztę (residential, unclassified, service bez tagu) zostawiamy jako nieznaną.
//
// Czego w sieci nie ma: autostrad i ekspresówek (nikt nie ma z nich dojazdu do domu), ścieżek i
// chodników, podjazdów, uliczek parkingowych i dróg w budowie. BDOT10k: tylko odcinki
// „eksploatowany” leżące na powierzchni gruntu (bez wiaduktów i tuneli).
//
// Dojazd: najbliższy odcinek ULICY w promieniu 50 m, a gdy takiej nie ma – najbliższy odcinek
// jakiejkolwiek drogi w promieniu 100 m. Samo „najbliższy odcinek z całej sieci” dawało
// gruntowy dojazd 17% adresów w Krakowie, bo bliżej domu bywa krótki podjazd albo droga polna niż
// ulica, na której stoi dom. 50 m to granica, w której leży najbliższa droga 97% adresów.
// Ulica to w BDOT10k każda klasa poza „droga wewnętrzna”, w OSM residential, unclassified,
// living_street i tertiary lub wyższa (także gdy BDOT10k nazywa ją drogą wewnętrzną, a OSM ulicą).
//
// Uruchom: node etl/drogi-gruntowe.mjs [ścieżka do malopolskie-*.osm.pbf]
// Surowe pobrania: etl/.cache/bdot10k (4 paczki, ok. 125 MB, jednorazowo) i etl/.cache/malopolskie-*.osm.pbf.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DuckDBInstance } from '@duckdb/node-api'
import { do2180 } from './lib/geo.mjs'
import { pobierzTrwale } from './lib/pobieranie.mjs'
import { dlugoscWKole, odlegloscDoOdcinka, SiecOdcinkow } from './lib/siec-drog.mjs'
import { CACHE, DANE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ZADANIE = 73
const TERYT_KRAKOW = '1261011'
export const PROMIEN = 300 // m, koło do udziału dróg gruntowych
export const PROMIEN_ULICY = 50 // m, w tym promieniu szukamy najpierw ulicy
export const MAX_DOJAZD = 100 // m, dalej od jakiejkolwiek drogi: brak danych o dojeździe
export const MIN_DLUGOSC = 100 // m dróg o znanej nawierzchni w kole; mniej: brak danych o udziale
export const TOLERANCJA = 12 // m, odległość pokrycia odcinka OSM odcinkiem BDOT10k
export const COS_MIN = 0.9 // |cos kąta| między odcinkami uznanymi za ten sam fragment drogi (ok. 26°)
const MARGINES = 1500 // m wokół adresów, w którym ładujemy drogi
const OKOLICA = PROMIEN + 100 // m od adresu, w których sieć jest potrzebna (koło 300 m + zapas)
const OSM_STRONA = 'https://download.geofabrik.de/europe/poland/malopolskie.html'
const LICENCJA_OSM =
  'ODbL 1.0, © współtwórcy OpenStreetMap (https://www.openstreetmap.org/copyright); wynik to dzieło wytworzone z wyboru dróg i klasyfikacji nawierzchni, atrybucja wymagana'
const BDOT_URL = (powiat) =>
  `https://opendata.geoportal.gov.pl/bdot10k/schemat2021/SHP/12/${powiat}_SHP.zip`
const BDOT_STRONA =
  'https://www.geoportal.gov.pl/pl/dane/baza-danych-obiektow-topograficznych-bdot10k/'
const LICENCJA_BDOT =
  'Dane PZGiK (GUGiK), udostępniane bezpłatnie i do dowolnego wykorzystania: https://www.geoportal.gov.pl/pl/dane/baza-danych-obiektow-topograficznych-bdot10k/'
// Powiaty, w których leży 14 gmin z adresy.json: m. Kraków, krakowski, wielicki, proszowicki.
const POWIATY = ['1261', '1206', '1219', '1214']

// ---------------------------------------------------------------------------------------------
// Klasy, rodzaje nawierzchni, rangi dróg i źródła klasyfikacji
// ---------------------------------------------------------------------------------------------

export const KLASA = { NIEZNANA: 0, UTWARDZONA: 1, GRUNTOWA: 2 }

/** Rodzaj nawierzchni (kod 0–7) – to, co pokazujemy na karcie obok flagi. */
export const DETAL = {
  NIEZNANY: 0,
  ASFALT: 1,
  BETON: 2,
  KOSTKA: 3,
  BRUK: 4,
  UTWARDZONA: 5,
  ZWIR: 6,
  GRUNT: 7,
}
const NAZWY_DETALU = [
  'nieznana nawierzchnia',
  'asfalt',
  'beton lub płyty betonowe',
  'kostka brukowa',
  'bruk kamienny',
  'inna nawierzchnia utwardzona',
  'żwir lub tłuczeń',
  'grunt',
]

/** Skąd pochodzi klasa odcinka (kod 1–4). */
export const ZRODLO = { BDOT: 1, OSM_SURFACE: 2, OSM_TRACKTYPE: 3, OSM_KLASA_DROGI: 4 }
const NAZWY_ZRODEL = [
  '',
  'BDOT10k',
  'OSM, tag surface',
  'OSM, tag tracktype',
  'OSM, wnioskowane z klasy drogi',
]

/** Ranga drogi: ulica (1) albo droga wewnętrzna, polna, podjazd (0). */
export const RANGA = { WEWNETRZNA: 0, ULICA: 1 }

const P = KLASA.UTWARDZONA
const G = KLASA.GRUNTOWA

/** Wartości tagu surface z OSM → [klasa, rodzaj]. Podział utwardzona/nieutwardzona jak na wiki OSM. */
const SURFACE_OSM = new Map([
  ['asphalt', [P, DETAL.ASFALT]],
  ['chipseal', [P, DETAL.ASFALT]],
  ['paved', [P, DETAL.UTWARDZONA]],
  ['concrete', [P, DETAL.BETON]],
  ['concrete:plates', [P, DETAL.BETON]],
  ['concrete:lanes', [P, DETAL.BETON]],
  ['paving_stones', [P, DETAL.KOSTKA]],
  ['paving_stones:lanes', [P, DETAL.KOSTKA]],
  ['sett', [P, DETAL.BRUK]],
  ['cobblestone', [P, DETAL.BRUK]],
  ['unhewn_cobblestone', [P, DETAL.BRUK]],
  ['bricks', [P, DETAL.BRUK]],
  ['metal', [P, DETAL.UTWARDZONA]],
  ['wood', [P, DETAL.UTWARDZONA]],
  ['unpaved', [G, DETAL.GRUNT]],
  ['compacted', [G, DETAL.ZWIR]],
  ['fine_gravel', [G, DETAL.ZWIR]],
  ['gravel', [G, DETAL.ZWIR]],
  ['pebblestone', [G, DETAL.ZWIR]],
  ['ground', [G, DETAL.GRUNT]],
  ['dirt', [G, DETAL.GRUNT]],
  ['earth', [G, DETAL.GRUNT]],
  ['grass', [G, DETAL.GRUNT]],
  ['grass_paver', [G, DETAL.GRUNT]],
  ['sand', [G, DETAL.GRUNT]],
  ['mud', [G, DETAL.GRUNT]],
  ['rock', [G, DETAL.GRUNT]],
])

/** Wartości atrybutu MATE_NAWIE z BDOT10k → [klasa, rodzaj]. „inny” nie rozstrzyga. */
const MATERIAL_BDOT = new Map([
  ['masa bitumiczna', [P, DETAL.ASFALT]],
  ['beton', [P, DETAL.BETON]],
  ['płyty betonowe', [P, DETAL.BETON]],
  ['kostka prefabrykowana', [P, DETAL.KOSTKA]],
  ['kostka kamienna', [P, DETAL.BRUK]],
  ['bruk', [P, DETAL.BRUK]],
  ['grunt naturalny', [G, DETAL.GRUNT]],
  ['żwir', [G, DETAL.ZWIR]],
  ['tłuczeń', [G, DETAL.ZWIR]],
])

/**
 * Klasa nawierzchni z materiału BDOT10k.
 * @returns {{ klasa: number, detal: number, zrodlo: number }}
 */
export function nawierzchniaBdot(material) {
  const w = MATERIAL_BDOT.get(
    String(material ?? '')
      .trim()
      .toLowerCase(),
  )
  return w
    ? { klasa: w[0], detal: w[1], zrodlo: ZRODLO.BDOT }
    : { klasa: KLASA.NIEZNANA, detal: DETAL.NIEZNANY, zrodlo: ZRODLO.BDOT }
}

// Klasy OSM, dla których brak tagu surface nie budzi wątpliwości: w Polsce to asfalt albo kostka.
const OSM_DOMYSLNIE_UTWARDZONE = new Set([
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
])

/**
 * Klasa nawierzchni z tagów OSM: jawne surface, potem tracktype, potem domyślna z klasy drogi.
 * Wartość złożona („asphalt;gravel”) rozstrzyga tylko, gdy wszystkie składniki dają tę samą klasę.
 * @param {Record<string, string | null | undefined>} t
 * @returns {{ klasa: number, detal: number, zrodlo: number }}
 */
export function nawierzchniaOsm(t) {
  const nieznana = { klasa: KLASA.NIEZNANA, detal: DETAL.NIEZNANY, zrodlo: ZRODLO.OSM_SURFACE }
  if (t.surface) {
    const wartosci = String(t.surface)
      .split(';')
      .map((v) => SURFACE_OSM.get(v.trim().toLowerCase()))
    if (wartosci.every((w) => w && w[0] === wartosci[0]?.[0]))
      return { klasa: wartosci[0][0], detal: wartosci[0][1], zrodlo: ZRODLO.OSM_SURFACE }
    // Niezrozumiała albo sprzeczna wartość surface: nie zgadujemy z tracktype ani z klasy drogi.
    return nieznana
  }
  const trasa = String(t.tracktype ?? '')
  if (trasa === 'grade1') return { klasa: P, detal: DETAL.UTWARDZONA, zrodlo: ZRODLO.OSM_TRACKTYPE }
  if (trasa === 'grade2') return { klasa: G, detal: DETAL.ZWIR, zrodlo: ZRODLO.OSM_TRACKTYPE }
  if (['grade3', 'grade4', 'grade5'].includes(trasa))
    return { klasa: G, detal: DETAL.GRUNT, zrodlo: ZRODLO.OSM_TRACKTYPE }
  if (OSM_DOMYSLNIE_UTWARDZONE.has(t.highway))
    return { klasa: P, detal: DETAL.UTWARDZONA, zrodlo: ZRODLO.OSM_KLASA_DROGI }
  if (t.highway === 'track') return { klasa: G, detal: DETAL.GRUNT, zrodlo: ZRODLO.OSM_KLASA_DROGI }
  return { ...nieznana, zrodlo: ZRODLO.OSM_KLASA_DROGI }
}

// ---------------------------------------------------------------------------------------------
// Które drogi wchodzą do sieci i jaką mają rangę
// ---------------------------------------------------------------------------------------------

/** Klasy highway z OSM, do których można dojechać do domu (bez autostrad, ekspresówek i ścieżek). */
export const HIGHWAY_DOJAZDOWE = [
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'track',
]
const ULICE_OSM = new Set([
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
])
const SERVICE_POMIJANE = new Set(['driveway', 'parking_aisle', 'drive-through', 'emergency_access'])

/**
 * Czy droga OSM wchodzi do sieci: klasa dojazdowa, nie podjazd ani uliczka parkingowa, nie tunel
 * i nie zamknięta dla ruchu (access/motor_vehicle/vehicle = no). Droga prywatna wchodzi, bo
 * w Polsce wiele dojazdów do domów to drogi wewnętrzne.
 * @param {Record<string, string | null | undefined>} t
 */
export function drogaDojazdowaOsm(t) {
  if (!HIGHWAY_DOJAZDOWE.includes(t.highway)) return false
  if (t.highway === 'service' && SERVICE_POMIJANE.has(t.service)) return false
  if (t.tunnel === 'yes' || t.tunnel === 'culvert') return false
  const jawnieOtwarta = ['yes', 'designated', 'permissive'].includes(t.motor_vehicle)
  const zamknieta = t.access === 'no' || t.motor_vehicle === 'no' || t.vehicle === 'no'
  return !(zamknieta && !jawnieOtwarta)
}

/** Ulica (1) czy droga wewnętrzna/polna/podjazd (0) według klasy highway z OSM. */
export const rangaOsm = (highway) => (ULICE_OSM.has(highway) ? RANGA.ULICA : RANGA.WEWNETRZNA)

/** Ulica (1) czy droga wewnętrzna (0) według klasy drogi z BDOT10k (KLASA_DROG). */
export const rangaBdot = (klasaDrogi) =>
  klasaDrogi && klasaDrogi !== 'droga wewnętrzna' ? RANGA.ULICA : RANGA.WEWNETRZNA

const KLASY_BDOT_POMIJANE = new Set(['autostrada', 'droga ekspresowa'])

/**
 * Czy odcinek BDOT10k wchodzi do sieci: istniejący, na powierzchni gruntu, nie autostrada ani ekspresówka.
 * @param {{ KAT_ISTNIE?: string, POLOZENIE?: string, KLASA_DROG?: string }} r
 */
export function drogaDojazdowaBdot(r) {
  return (
    r.KAT_ISTNIE === 'eksploatowany' &&
    r.POLOZENIE === 'na powierzchni gruntu' &&
    !KLASY_BDOT_POMIJANE.has(r.KLASA_DROG ?? '')
  )
}

/**
 * Opis odcinka do karty (karta pokazuje go samodzielnie, bez liczby): wynik, rodzaj drogi,
 * nawierzchnia i źródło, np. „Dojazd utwardzony: ulica, asfalt (BDOT10k)”.
 */
export function etykietaOdcinka(ranga, detal, zrodlo) {
  const rodzaj = ranga >= RANGA.ULICA ? 'ulica' : 'droga wewnętrzna lub polna'
  const wynik =
    detal === DETAL.NIEZNANY
      ? 'Dojazd o nieznanej nawierzchni'
      : detal >= DETAL.ZWIR
        ? 'Dojazd gruntowy'
        : 'Dojazd utwardzony'
  return `${wynik}: ${rodzaj}, ${NAZWY_DETALU[detal]} (${NAZWY_ZRODEL[zrodlo]})`
}

// ---------------------------------------------------------------------------------------------
// Geometria z WKB (ST_AsWKB z DuckDB)
// ---------------------------------------------------------------------------------------------

/**
 * LineString (2) albo MultiLineString (5) w WKB 2D → lista łamanych [[x, y], …].
 * Inne typy (z wymiarem Z, EWKB) to błąd danych, a nie cicho pominięty rekord.
 */
export function lamaneZWkb(bufor) {
  const widok = new DataView(bufor.buffer, bufor.byteOffset, bufor.byteLength)
  let poz = 0
  const czytaj = () => {
    const little = widok.getUint8(poz) === 1
    const typ = widok.getUint32(poz + 1, little)
    poz += 5
    if (typ === 2) {
      const n = widok.getUint32(poz, little)
      poz += 4
      const punkty = []
      for (let i = 0; i < n; i++) {
        punkty.push([widok.getFloat64(poz, little), widok.getFloat64(poz + 8, little)])
        poz += 16
      }
      return [punkty]
    }
    if (typ === 5) {
      const n = widok.getUint32(poz, little)
      poz += 4
      const linie = []
      for (let i = 0; i < n; i++) linie.push(...czytaj())
      return linie
    }
    throw new Error(`WKB: nieobsługiwany typ geometrii ${typ}`)
  }
  return czytaj()
}

// ---------------------------------------------------------------------------------------------
// Łączenie źródeł w jedną sieć
// ---------------------------------------------------------------------------------------------

/**
 * Maska okolicy adresów: funkcja (x, y) → czy punkt leży w promieniu ≈ `promien` od któregoś z
 * punktów. Liczymy ją na siatce komórek (rozszerzenie o ceil(promien / komorka) komórek w obie strony),
 * więc to kwadrat, nie koło – wystarczy, żeby odciąć odległe lasy i pola. Dlaczego: ekstrakt OSM i
 * paczki BDOT10k obejmują dużo więcej niż okolice adresów, a drogi daleko od adresów psułyby
 * statystyki zgodności źródeł i zajmowały pamięć.
 * @param {number[][]} punkty [[x, y], …] w metrach
 */
export function maskaAdresow(punkty, { komorka = 100, promien = 400 } = {}) {
  let [xmin, ymin, xmax, ymax] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of punkty) {
    xmin = Math.min(xmin, x)
    xmax = Math.max(xmax, x)
    ymin = Math.min(ymin, y)
    ymax = Math.max(ymax, y)
  }
  const r = Math.ceil(promien / komorka)
  const x0 = xmin - r * komorka
  const y0 = ymin - r * komorka
  const nx = Math.floor((xmax - x0) / komorka) + r + 1
  const ny = Math.floor((ymax - y0) / komorka) + r + 1
  const jest = new Uint8Array(nx * ny)
  for (const [x, y] of punkty)
    jest[Math.floor((y - y0) / komorka) * nx + Math.floor((x - x0) / komorka)] = 1
  const poziomo = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      if (jest[j * nx + i])
        for (let d = Math.max(0, i - r); d <= Math.min(nx - 1, i + r); d++) poziomo[j * nx + d] = 1
  const maska = new Uint8Array(nx * ny)
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      if (poziomo[j * nx + i])
        for (let d = Math.max(0, j - r); d <= Math.min(ny - 1, j + r); d++) maska[d * nx + i] = 1
  return (x, y) => {
    const i = Math.floor((x - x0) / komorka)
    const j = Math.floor((y - y0) / komorka)
    return i >= 0 && j >= 0 && i < nx && j < ny && maska[j * nx + i] === 1
  }
}

/**
 * Składa sieć z BDOT10k i OSM (opis reguł na górze pliku). Do sieci i do statystyk wchodzą tylko
 * odcinki, których środek spełnia `wZasiegu(x, y)`.
 * @param {{ punkty: number[][], klasa: number, detal: number, ranga: number }[]} liniaBdot
 * @param {{ punkty: number[][], klasa: number, detal: number, zrodlo: number, ranga: number }[]} liniaOsm
 * @returns {{ siec: SiecOdcinkow, statystyki: object }}
 */
export function polaczSiec(
  liniaBdot,
  liniaOsm,
  {
    tolerancja = TOLERANCJA,
    cosMin = COS_MIN,
    komorka = 100,
    maxOdcinek = 30,
    wZasiegu = () => true,
  } = {},
) {
  const bdot = new SiecOdcinkow({ komorka, maxOdcinek })
  liniaBdot.forEach((l, i) =>
    bdot.dodajLinie(l.punkty, {
      klasa: l.klasa,
      detal: l.detal,
      zrodlo: ZRODLO.BDOT,
      ranga: l.ranga,
      wlasciciel: i,
    }),
  )
  bdot.zbuduj()
  const osm = new SiecOdcinkow({ komorka, maxOdcinek })
  liniaOsm.forEach((l, i) =>
    osm.dodajLinie(l.punkty, {
      klasa: l.klasa,
      detal: l.detal,
      zrodlo: l.zrodlo,
      ranga: l.ranga,
      wlasciciel: i,
    }),
  )
  osm.zbuduj()

  const srodek = (s, i) => [(s.ax[i] + s.bx[i]) / 2, (s.ay[i] + s.by[i]) / 2]
  const jawny = (o) =>
    osm.klasa[o] !== KLASA.NIEZNANA &&
    (osm.zrodlo[o] === ZRODLO.OSM_SURFACE || osm.zrodlo[o] === ZRODLO.OSM_TRACKTYPE)
  const pokrycie = new Int32Array(osm.liczba).fill(-1) // odcinek OSM → odcinek BDOT10k albo -1
  const najlepszy = new Int32Array(bdot.liczba).fill(-1) // odcinek BDOT10k → najbliższy jawny odcinek OSM
  const odlegloscNajlepszego = new Float64Array(bdot.liczba).fill(Infinity)
  const st = {
    osmM: 0,
    osmPokrytoM: 0,
    jawneM: 0,
    zgodneM: 0,
    sprzeczneM: 0,
    jawneBdotNieznanyM: 0,
    nadpisanoM: 0,
    /** metry odcinków o sprzecznej klasie: „OSM rodzaj → BDOT10k rodzaj” */
    konflikty: new Map(),
  }
  for (let o = 0; o < osm.liczba; o++) {
    const [mx, my] = srodek(osm, o)
    if (!wZasiegu(mx, my)) continue
    st.osmM += osm.dlugosc[o]
    const b = bdot.najblizszy(mx, my, tolerancja, [osm.kx[o], osm.ky[o], cosMin])
    if (b < 0) continue
    pokrycie[o] = b
    st.osmPokrytoM += osm.dlugosc[o]
    // Ulicą jest odcinek, który za ulicę uważa którekolwiek ze źródeł (OSM nazywa ulicą także
    // prywatne drogi dojazdowe, które BDOT10k zalicza do dróg wewnętrznych).
    if (osm.ranga[o] > bdot.ranga[b]) bdot.ranga[b] = osm.ranga[o]
    if (!jawny(o)) continue
    st.jawneM += osm.dlugosc[o]
    if (bdot.odleglosc < odlegloscNajlepszego[b]) {
      najlepszy[b] = o
      odlegloscNajlepszego[b] = bdot.odleglosc
    }
    if (bdot.klasa[b] === KLASA.NIEZNANA) st.jawneBdotNieznanyM += osm.dlugosc[o]
    else if (bdot.klasa[b] === osm.klasa[o]) st.zgodneM += osm.dlugosc[o]
    else {
      st.sprzeczneM += osm.dlugosc[o]
      const klucz = `${NAZWY_DETALU[osm.detal[o]]} (OSM) → ${NAZWY_DETALU[bdot.detal[b]]} (BDOT10k)`
      st.konflikty.set(klucz, (st.konflikty.get(klucz) ?? 0) + osm.dlugosc[o])
    }
  }
  // Nadpisanie klasy odcinka BDOT10k jawnym tagiem OSM (reguła z issue).
  for (let b = 0; b < bdot.liczba; b++) {
    const o = najlepszy[b]
    if (o < 0) continue
    if (bdot.klasa[b] !== osm.klasa[o]) st.nadpisanoM += bdot.dlugosc[b]
    bdot.klasa[b] = osm.klasa[o]
    bdot.detal[b] = osm.detal[o]
    bdot.zrodlo[b] = osm.zrodlo[o]
  }

  const siec = new SiecOdcinkow({ komorka, maxOdcinek })
  let bdotM = 0
  for (let b = 0; b < bdot.liczba; b++) {
    if (!wZasiegu(...srodek(bdot, b))) continue
    bdotM += bdot.dlugosc[b]
    siec.dodajOdcinek(bdot.ax[b], bdot.ay[b], bdot.bx[b], bdot.by[b], {
      klasa: bdot.klasa[b],
      detal: bdot.detal[b],
      zrodlo: bdot.zrodlo[b],
      ranga: bdot.ranga[b],
      wlasciciel: bdot.wlasciciel[b],
    })
  }
  let osmSamoM = 0
  for (let o = 0; o < osm.liczba; o++) {
    if (pokrycie[o] >= 0 || !wZasiegu(...srodek(osm, o))) continue
    osmSamoM += osm.dlugosc[o]
    siec.dodajOdcinek(osm.ax[o], osm.ay[o], osm.bx[o], osm.by[o], {
      klasa: osm.klasa[o],
      detal: osm.detal[o],
      zrodlo: osm.zrodlo[o],
      ranga: osm.ranga[o],
      wlasciciel: -1 - osm.wlasciciel[o],
    })
  }
  siec.zbuduj()
  return { siec, statystyki: { ...st, bdotM, osmSamoM } }
}

// ---------------------------------------------------------------------------------------------
// Wskaźniki
// ---------------------------------------------------------------------------------------------

/**
 * Flaga dojazdu: klasa najbliższej ulicy w promieniu `promienUlicy` m, a gdy jej nie ma –
 * klasa najbliższego odcinka jakiejkolwiek drogi w promieniu `maxDojazd` m.
 * @returns {{ wartosc: number | null, odcinek: number, odleglosc: number | null }}
 *   wartość: 1 utwardzony, 0 gruntowy, null – brak drogi w zasięgu albo nieznana nawierzchnia
 */
export function dojazd(siec, x, y, promienUlicy = PROMIEN_ULICY, maxDojazd = MAX_DOJAZD) {
  let id = siec.najblizszy(x, y, promienUlicy, null, -1, RANGA.ULICA)
  if (id < 0) id = siec.najblizszy(x, y, maxDojazd)
  if (id < 0) return { wartosc: null, odcinek: -1, odleglosc: null }
  const k = siec.klasa[id]
  return { wartosc: k === P ? 1 : k === G ? 0 : null, odcinek: id, odleglosc: siec.odleglosc }
}

/**
 * Udział (0–100) dróg gruntowych wśród dróg o znanej nawierzchni w promieniu `promien` m;
 * null, gdy takich dróg jest mniej niż `minDlugosc` m. Długość każdego odcinka obcinamy do koła.
 */
export function udzialGruntowych(siec, x, y, promien = PROMIEN, minDlugosc = MIN_DLUGOSC) {
  const w = siec.dlugosciWKole(x, y, promien, new Float64Array(4))
  const znane = w[P] + w[G]
  if (znane < minDlugosc) return null
  return (100 * w[G]) / znane
}

// ---------------------------------------------------------------------------------------------
// Pobieranie i wczytywanie źródeł
// ---------------------------------------------------------------------------------------------

const sq = (s) => String(s).replaceAll("'", "''")

/** Ścieżka do ekstraktu PBF: argument albo najnowszy malopolskie-YYMMDD.osm.pbf z etl/.cache. */
export function rozwiazPbf(jawna) {
  if (jawna) {
    if (!existsSync(jawna)) throw new Error(`Brak pliku PBF: ${jawna}`)
    return resolve(jawna)
  }
  const pliki = existsSync(CACHE)
    ? readdirSync(CACHE)
        .filter((n) => /^malopolskie-\d{6}\.osm\.pbf$/.test(n))
        .sort()
    : []
  if (!pliki.length)
    throw new Error(
      'Brak etl/.cache/malopolskie-YYMMDD.osm.pbf – pobierz ekstrakt z Geofabrik (europe/poland/malopolskie-latest.osm.pbf), uruchom etl/osm-uslugi.mjs albo podaj ścieżkę jako argument',
    )
  return join(CACHE, pliki.at(-1))
}

/** Data stanu ekstraktu z nazwy pliku „malopolskie-261002.osm.pbf” → „2026-10-02”. */
export function dataPbf(sciezka) {
  const m = /-(\d{2})(\d{2})(\d{2})\.osm\.pbf$/.exec(basename(sciezka))
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`
  return statSync(sciezka).mtime.toISOString().slice(0, 10)
}

// Tagi OSM potrzebne do klasyfikacji (kolumna SQL = klucz tagu).
const TAGI_OSM = [
  'highway',
  'surface',
  'tracktype',
  'access',
  'motor_vehicle',
  'vehicle',
  'service',
  'tunnel',
]

async function polaczenieDuckDb(opcje = {}) {
  const instancja = await DuckDBInstance.create(':memory:', { memory_limit: '4GB', ...opcje })
  const c = await instancja.connect()
  try {
    await c.run('INSTALL spatial')
  } catch {} // bez sieci zostaje rozszerzenie z poprzedniej instalacji
  await c.run('LOAD spatial')
  return { instancja, c }
}

/** Ramka [xmin, ymin, xmax, ymax] w EPSG:2180 → [lonMin, latMin, lonMax, latMax] z zapasem na skos układu. */
function ramkaStopnie([xmin, ymin, xmax, ymax]) {
  // Przybliżenie: 1° szerokości ≈ 111,2 km, 1° długości ≈ 71,3 km na 50°N; zapas 20% pokrywa skos siatki.
  const lon0 = 19 + (xmin - 500_000) / 71_300
  const lon1 = 19 + (xmax - 500_000) / 71_300
  const lat0 = (ymin + 5_300_000) / 111_200
  const lat1 = (ymax + 5_300_000) / 111_200
  const zapasLon = 0.2 * (lon1 - lon0)
  const zapasLat = 0.2 * (lat1 - lat0)
  return [lon0 - zapasLon, lat0 - zapasLat, lon1 + zapasLon, lat1 + zapasLat]
}

/** Drogi z PBF jako { id, tagi, punkty w EPSG:2180 }; ramka = [xmin, ymin, xmax, ymax] w EPSG:2180. */
export async function wczytajOsm(pbf, ramka) {
  const lista = HIGHWAY_DOJAZDOWE.map((h) => `'${h}'`).join(', ')
  const plik = `'${sq(pbf.replaceAll('\\', '/'))}'`
  const tag = (k) => `map_extract_value(tags, '${k}')`
  const katalogTymczasowy = join(CACHE, 'duckdb_drogi_tmp')
  mkdirSync(katalogTymczasowy, { recursive: true })
  const { instancja, c } = await polaczenieDuckDb({ temp_directory: katalogTymczasowy })
  try {
    await c.run(`
      CREATE TABLE drogi AS
      SELECT id, ${TAGI_OSM.map((k) => `${tag(k)} AS ${k}`).join(', ')}, refs
      FROM ST_ReadOSM(${plik})
      WHERE kind = 'way' AND cardinality(tags) > 0 AND ${tag('highway')} IN (${lista})
      ORDER BY id`)
    // Węzły filtrujemy już w SQL, żeby nie ładować całej Małopolski do pamięci Node.
    const [lonMin, latMin, lonMax, latMax] = ramkaStopnie(ramka)
    const [ids, lony, laty] = (
      await c.runAndReadAll(`
        SELECT id::DOUBLE, lon, lat FROM ST_ReadOSM(${plik})
        WHERE kind = 'node' AND lon BETWEEN ${lonMin} AND ${lonMax} AND lat BETWEEN ${latMin} AND ${latMax}
          AND id IN (SELECT unnest(refs) FROM drogi)`)
    ).getColumnsJS()
    const wezly = new Map()
    for (let i = 0; i < ids.length; i++) wezly.set(ids[i], do2180(lony[i], laty[i]))
    const wiersze = (
      await c.runAndReadAll(`
        SELECT id::DOUBLE AS id, ${TAGI_OSM.join(', ')}, list_transform(refs, r -> r::DOUBLE) AS refs
        FROM drogi ORDER BY id`)
    ).getRowObjectsJS()
    const drogi = []
    for (const w of wiersze) {
      const punkty = []
      for (const ref of w.refs) {
        const p = wezly.get(ref)
        if (p) punkty.push(p)
      }
      if (punkty.length < 2) continue
      const { id, refs, ...tagi } = w
      drogi.push({ id, tagi, punkty })
    }
    return { drogi, wszystkich: wiersze.length, wezly: wezly.size }
  } finally {
    c.closeSync()
    instancja.closeSync()
  }
}

/** Paczki BDOT10k do etl/.cache/bdot10k (jednorazowo); zwraca ścieżki w kolejności POWIATY. */
export async function pobierzPaczkiBdot() {
  mkdirSync(join(CACHE, 'bdot10k'), { recursive: true })
  const sciezki = []
  for (const p of POWIATY) {
    const wzgledna = `bdot10k/${p}_SHP.zip`
    const sciezka = join(CACHE, wzgledna)
    if (!existsSync(sciezka)) {
      console.log(`Pobieram paczkę BDOT10k ${p} (jednorazowo)…`)
      await pobierzTrwale(BDOT_URL(p), wzgledna, { proby: 3, limitMs: 900_000 })
    }
    sciezki.push(sciezka)
  }
  return sciezki
}

const dlugoscLamanej = (punkty) => {
  let d = 0
  for (let i = 1; i < punkty.length; i++)
    d += Math.hypot(punkty[i][0] - punkty[i - 1][0], punkty[i][1] - punkty[i - 1][1])
  return d
}

/** Odcinki OT_SKDR_L z paczek SHP w ramce EPSG:2180: linie z klasą nawierzchni i rangą oraz data najnowszej wersji. */
export async function wczytajBdot(paczki, ramka) {
  const { instancja, c } = await polaczenieDuckDb()
  const linie = []
  const rozklad = new Map()
  const lata = new Map() // rok wersji obiektu → długość dróg w sieci (m)
  let najnowsza = ''
  let wszystkich = 0
  try {
    for (const [i, paczka] of paczki.entries()) {
      const powiat = POWIATY[i]
      const shp = `/vsizip/${paczka.replaceAll('\\', '/')}/PL.PZGiK.283.BDOT10k.${powiat}__OT_SKDR_L.shp`
      const wiersze = (
        await c.runAndReadAll(`
          SELECT KAT_ISTNIE, POLOZENIE, KLASA_DROG, KAT_ZARZAD, SZER_NAWIE, MATE_NAWIE, POCZ_WERSJ,
                 ST_AsWKB(geom) AS wkb
          FROM ST_Read('${sq(shp)}')
          WHERE ST_XMax(geom) >= ${ramka[0]} AND ST_XMin(geom) <= ${ramka[2]}
            AND ST_YMax(geom) >= ${ramka[1]} AND ST_YMin(geom) <= ${ramka[3]}`)
      ).getRowObjectsJS()
      wszystkich += wiersze.length
      for (const r of wiersze) {
        if (!drogaDojazdowaBdot(r)) continue
        const n = nawierzchniaBdot(r.MATE_NAWIE)
        rozklad.set(r.MATE_NAWIE ?? 'brak', (rozklad.get(r.MATE_NAWIE ?? 'brak') ?? 0) + 1)
        if (r.POCZ_WERSJ && r.POCZ_WERSJ > najnowsza) najnowsza = r.POCZ_WERSJ
        const rok = String(r.POCZ_WERSJ ?? '').slice(0, 4) || 'brak'
        for (const punkty of lamaneZWkb(r.wkb)) {
          lata.set(rok, (lata.get(rok) ?? 0) + dlugoscLamanej(punkty))
          linie.push({
            punkty,
            klasa: n.klasa,
            detal: n.detal,
            ranga: rangaBdot(r.KLASA_DROG),
            klasaDrogi: r.KLASA_DROG,
            zarzad: r.KAT_ZARZAD,
            szerokosc: r.SZER_NAWIE,
            wersja: r.POCZ_WERSJ,
          })
        }
      }
    }
  } finally {
    c.closeSync()
    instancja.closeSync()
  }
  const dataDanych = najnowsza
    ? `${najnowsza.slice(0, 4)}-${najnowsza.slice(4, 6)}-${najnowsza.slice(6, 8)}`
    : null
  return { linie, wszystkich, rozklad, lata, dataDanych }
}

// ---------------------------------------------------------------------------------------------
// Skrypt
// ---------------------------------------------------------------------------------------------

function percentyle(wartosci, ps = [5, 25, 50, 75, 95, 99, 100]) {
  const s = wartosci.filter((v) => v !== null).sort((a, b) => a - b)
  if (!s.length) return 'brak danych'
  return ps
    .map((p) => `p${p}=${s[Math.min(s.length - 1, Math.ceil((s.length * p) / 100) - 1)]}`)
    .join(' ')
}

// Przybliżone współrzędne znanych miejsc [lon, lat]; kontrola pokazuje wartości dla najbliższego adresu.
const MIEJSCA_KONTROLNE = [
  ['Kraków, Rynek Główny', 19.93725, 50.06168],
  ['Kraków, Dworzec Główny', 19.9475, 50.0677],
  ['Kraków, Kopiec Kościuszki', 19.8932, 50.0551],
  ['Kraków, Nowa Huta, Plac Centralny', 20.0373, 50.0724],
  ['Kraków, Wola Justowska', 19.87, 50.075],
  ['Wieliczka, Rynek', 20.0646, 49.9868],
  ['Skawina, Rynek', 19.8284, 49.9752],
  ['Niepołomice, Rynek', 20.2152, 50.0343],
  ['Zabierzów, centrum', 19.8113, 50.1045],
  ['Zielonki, centrum', 19.9567, 50.1227],
  ['Mogilany, centrum', 19.8981, 49.9444],
  ['Koniusza, centrum', 20.21, 50.18],
]

async function main() {
  const start = performance.now()
  const pobrano = dzis()
  const { adresy } = wczytajAdresy()
  const xy = adresy.map((a) => do2180(a.lon, a.lat))
  const wKrakowie = adresy.map((a) => a.teryt === TERYT_KRAKOW)
  console.log(
    `Adresy: ${adresy.length}, w tym Kraków ${wKrakowie.filter(Boolean).length}, obwarzanek ${wKrakowie.filter((w) => !w).length}`,
  )
  // Zasięg adresów pętlą, bo Math.min(...tablica) przy 176 tys. elementów przepełnia stos.
  let [xmin, ymin, xmax, ymax] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of xy) {
    xmin = Math.min(xmin, x)
    xmax = Math.max(xmax, x)
    ymin = Math.min(ymin, y)
    ymax = Math.max(ymax, y)
  }
  const ramka = [xmin - MARGINES, ymin - MARGINES, xmax + MARGINES, ymax + MARGINES]

  // 1. Źródła
  const paczki = await pobierzPaczkiBdot()
  const bdot = await wczytajBdot(paczki, ramka)
  const razemLata = [...bdot.lata.values()].reduce((s, d) => s + d, 0)
  const lataTekst = [...bdot.lata]
    .sort()
    .map(([rok, d]) => `${rok} ${Math.round((100 * d) / razemLata)}%`)
    .join(', ')
  console.log(
    `BDOT10k: odcinków w ramce ${bdot.wszystkich}, w sieci ${bdot.linie.length}; materiały: ${[...bdot.rozklad].map(([k, v]) => `${k} ${v}`).join(', ')}; wersje obiektów wg roku (długość dróg): ${lataTekst}; najnowsza ${bdot.dataDanych}`,
  )
  const pbf = rozwiazPbf(process.argv[2] ?? process.env.OSM_PBF)
  const dataOsm = dataPbf(pbf)
  const osmSurowe = await wczytajOsm(pbf, ramka)
  const liniaOsm = []
  const nieznaneSurface = new Map()
  for (const d of osmSurowe.drogi) {
    if (!drogaDojazdowaOsm(d.tagi)) continue
    const n = nawierzchniaOsm(d.tagi)
    if (d.tagi.surface && n.klasa === KLASA.NIEZNANA)
      nieznaneSurface.set(d.tagi.surface, (nieznaneSurface.get(d.tagi.surface) ?? 0) + 1)
    liniaOsm.push({ punkty: d.punkty, ...n, ranga: rangaOsm(d.tagi.highway) })
  }
  console.log(
    `OSM ${basename(pbf)} (stan ${dataOsm}): dróg highway w ekstrakcie ${osmSurowe.wszystkich}, w ramce ${osmSurowe.drogi.length}, w sieci ${liniaOsm.length}; ` +
      `niezrozumiałe surface: ${[...nieznaneSurface].map(([k, v]) => `${k} ${v}`).join(', ') || 'brak'}`,
  )
  if (bdot.linie.length < 10_000 || liniaOsm.length < 10_000)
    throw new Error('Podejrzanie mało dróg w źródłach')

  // 2. Sieć (tylko okolice adresów)
  const wZasiegu = maskaAdresow(xy, { promien: OKOLICA })
  const { siec, statystyki: st } = polaczSiec(bdot.linie, liniaOsm, { wZasiegu })
  const km = (m) => (m / 1000).toFixed(0)
  const proc = (a, b) => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : 'brak')
  const jawneRazem = st.zgodneM + st.sprzeczneM
  console.log(
    `Sieć w okolicy adresów: ${siec.liczba} odcinków. BDOT10k ${km(st.bdotM)} km; OSM ${km(st.osmM)} km, w tym pokryte BDOT10k ${proc(st.osmPokrytoM, st.osmM)}, samodzielne ${km(st.osmSamoM)} km`,
  )
  console.log(
    `Zgodność jawnej klasy OSM z BDOT10k (${km(jawneRazem)} km odcinków z oboma werdyktami): zgodnie ${proc(st.zgodneM, jawneRazem)}, sprzecznie ${proc(st.sprzeczneM, jawneRazem)}; ` +
      `OSM jawny tam, gdzie BDOT10k nie rozstrzyga: ${km(st.jawneBdotNieznanyM)} km; klasa BDOT10k nadpisana tagiem OSM na ${km(st.nadpisanoM)} km`,
  )
  const najczestsze = [...st.konflikty].sort((a, b) => b[1] - a[1]).slice(0, 6)
  console.log(
    `Najczęstsze sprzeczności: ${najczestsze.map(([k, v]) => `${k} ${km(v)} km`).join('; ')}`,
  )
  const dlKlasy = new Float64Array(3 * 5)
  for (let i = 0; i < siec.liczba; i++)
    dlKlasy[siec.klasa[i] * 5 + siec.zrodlo[i]] += siec.dlugosc[i]
  const sumaKlasy = (k) => dlKlasy.subarray(k * 5, k * 5 + 5).reduce((s, d) => s + d, 0)
  const calosc = sumaKlasy(0) + sumaKlasy(1) + sumaKlasy(2)
  console.log(
    `Sieć wg klasy i źródła klasy (km): ${['nieznana', 'utwardzona', 'gruntowa']
      .map(
        (nazwa, k) =>
          `${nazwa} ${km(sumaKlasy(k))} [${[1, 2, 3, 4]
            .filter((z) => dlKlasy[k * 5 + z] > 0)
            .map((z) => `${NAZWY_ZRODEL[z]} ${km(dlKlasy[k * 5 + z])}`)
            .join('; ')}]`,
      )
      .join('; ')} – razem ${km(calosc)} km`,
  )
  const znaneM = sumaKlasy(P) + sumaKlasy(G)

  // 3. Wskaźniki
  const flaga = new Array(adresy.length).fill(null)
  const odcinek = new Int32Array(adresy.length).fill(-1)
  const odleglosc = new Array(adresy.length).fill(null)
  const udzial = new Array(adresy.length).fill(null)
  const przyczynaBraku = { 'brak drogi w 100 m': 0, 'nieznana nawierzchnia najbliższej drogi': 0 }
  for (let i = 0; i < adresy.length; i++) {
    const [x, y] = xy[i]
    const d = dojazd(siec, x, y)
    flaga[i] = d.wartosc
    odcinek[i] = d.odcinek
    odleglosc[i] = d.odleglosc
    if (d.wartosc === null)
      przyczynaBraku[
        d.odcinek < 0 ? 'brak drogi w 100 m' : 'nieznana nawierzchnia najbliższej drogi'
      ]++
    const u = udzialGruntowych(siec, x, y)
    udzial[i] = u === null ? null : Math.round(u)
  }

  const grupa = (tablica, wMiescie) =>
    tablica.filter((v, i) => wKrakowie[i] === wMiescie && v !== null)
  const zaokr = odleglosc.map((v) => (v === null ? null : Math.round(v)))
  console.log(`Odległość do wybranej drogi (m), Kraków:   ${percentyle(grupa(zaokr, true))}`)
  console.log(`Odległość do wybranej drogi (m), obwarzanek: ${percentyle(grupa(zaokr, false))}`)
  console.log(`drogi_gruntowe_300m (%), Kraków:   ${percentyle(grupa(udzial, true))}`)
  console.log(`drogi_gruntowe_300m (%), obwarzanek: ${percentyle(grupa(udzial, false))}`)
  const pokrycie = (t, m) => `${grupa(t, m).length}/${wKrakowie.filter((w) => w === m).length}`
  console.log(
    `Pokrycie dojazd_utwardzony: Kraków ${pokrycie(flaga, true)}, obwarzanek ${pokrycie(flaga, false)}; drogi_gruntowe_300m: Kraków ${pokrycie(udzial, true)}, obwarzanek ${pokrycie(udzial, false)}`,
  )
  console.log(`Brak flagi dojazdu: ${JSON.stringify(przyczynaBraku)}`)
  let blisko = 0
  for (let i = 0; i < adresy.length; i++)
    if (siec.najblizszy(xy[i][0], xy[i][1], PROMIEN_ULICY) >= 0) blisko++
  console.log(`Jakakolwiek droga w ${PROMIEN_ULICY} m: ${proc(blisko, adresy.length)} adresów`)

  // Skład flagi 0: ulica w 50 m czy droga wewnętrzna/polna; i niejednoznaczność (utwardzona tuż za gruntową).
  let gruntowe = 0
  let przezUlice = 0
  let niejednoznaczne = 0
  for (let i = 0; i < adresy.length; i++) {
    if (flaga[i] !== 0) continue
    gruntowe++
    if (siec.ranga[odcinek[i]] >= RANGA.ULICA) przezUlice++
    const [x, y] = xy[i]
    if (siec.najblizszy(x, y, odleglosc[i] + 10, null, P) >= 0) niejednoznaczne++
  }
  console.log(
    `Flaga 0 (dojazd gruntowy): ${gruntowe} adresów (${proc(gruntowe, flaga.filter((v) => v !== null).length)} z flagą); ` +
      `przez ulicę w 50 m ${proc(przezUlice, gruntowe)}, przez drogę wewnętrzną lub polną ${proc(gruntowe - przezUlice, gruntowe)}; ` +
      `z drogą utwardzoną nie dalej niż 10 m za wybraną gruntową ${proc(niejednoznaczne, gruntowe)}`,
  )

  // Podział po gminach: to one mają różnicować warstwę.
  const gminy = new Map()
  adresy.forEach((a, i) => {
    const g = gminy.get(a.gmina) ?? { n: 0, flaga: 0, gruntowy: 0, udzialSuma: 0, udzialN: 0 }
    g.n++
    if (flaga[i] !== null) {
      g.flaga++
      if (flaga[i] === 0) g.gruntowy++
    }
    if (udzial[i] !== null) {
      g.udzialSuma += udzial[i]
      g.udzialN++
    }
    gminy.set(a.gmina, g)
  })
  console.log(
    'Gmina                      adresów  flaga  dojazd gruntowy  średni udział gruntowych 300 m',
  )
  for (const [nazwa, g] of [...gminy].sort((a, b) => b[1].n - a[1].n))
    console.log(
      `  ${nazwa.padEnd(24)} ${String(g.n).padStart(7)} ${proc(g.flaga, g.n).padStart(6)} ${proc(g.gruntowy, g.flaga).padStart(16)} ${(g.udzialSuma / g.udzialN).toFixed(1).padStart(10)}%`,
    )

  // Kontrola: indeks kontra przeszukanie liniowe na próbce adresów (odległość, udział i wybór drogi).
  const krok = Math.max(1, Math.floor(adresy.length / 150))
  let sprawdzone = 0
  for (let i = 0; i < adresy.length; i += krok) {
    const [x, y] = xy[i]
    let ulica = Infinity
    let wszystkie = Infinity
    const dl = new Float64Array(3)
    for (let k = 0; k < siec.liczba; k++) {
      const d = odlegloscDoOdcinka(x, y, siec.ax[k], siec.ay[k], siec.bx[k], siec.by[k])
      if (siec.ranga[k] >= RANGA.ULICA) ulica = Math.min(ulica, d)
      wszystkie = Math.min(wszystkie, d)
      dl[siec.klasa[k]] += dlugoscWKole(
        siec.ax[k],
        siec.ay[k],
        siec.bx[k],
        siec.by[k],
        x,
        y,
        PROMIEN,
      )
    }
    const oczekiwana = ulica <= PROMIEN_ULICY ? ulica : wszystkie <= MAX_DOJAZD ? wszystkie : null
    if ((oczekiwana === null) !== (odleglosc[i] === null))
      throw new Error(`Indeks ≠ przeszukanie liniowe (odległość) dla adresu ${i}`)
    if (oczekiwana !== null && Math.abs(oczekiwana - odleglosc[i]) > 1e-6)
      throw new Error(`Indeks ≠ przeszukanie liniowe (odległość) dla adresu ${i}`)
    const znane = dl[P] + dl[G]
    const oczekiwanyUdzial = znane < MIN_DLUGOSC ? null : Math.round((100 * dl[G]) / znane)
    if (oczekiwanyUdzial !== udzial[i])
      throw new Error(`Indeks ≠ przeszukanie liniowe (udział) dla adresu ${i}`)
    sprawdzone++
  }
  console.log(`Kontrola indeksu: ${sprawdzone} adresów zgodnych z przeszukaniem liniowym`)

  // Miejsca kontrolne
  console.log('Miejsca kontrolne (najbliższy adres w bazie):')
  const opisOdcinka = (id) =>
    id < 0 ? 'brak drogi' : etykietaOdcinka(siec.ranga[id], siec.detal[id], siec.zrodlo[id])
  for (const [nazwa, lon, lat] of MIEJSCA_KONTROLNE) {
    const [px, py] = do2180(lon, lat)
    let najlepszy = -1
    let odl = Infinity
    for (let i = 0; i < adresy.length; i++) {
      const d = Math.hypot(xy[i][0] - px, xy[i][1] - py)
      if (d < odl) {
        odl = d
        najlepszy = i
      }
    }
    const a = adresy[najlepszy]
    console.log(
      `  ${nazwa.padEnd(34)} → ${`${a.miejscowosc} ${a.ulica ?? ''} ${a.nr}`.trim().padEnd(32)} (${Math.round(odl)} m od punktu) ` +
        `dojazd ${flaga[najlepszy]} [${opisOdcinka(odcinek[najlepszy])}, ${odleglosc[najlepszy] === null ? '–' : `${Math.round(odleglosc[najlepszy])} m`}], gruntowe 300 m: ${udzial[najlepszy]}%`,
    )
  }
  console.log('Przykłady dojazdu gruntowego (co 997. taki adres):')
  let licznik = 0
  for (let i = 0; i < adresy.length && licznik < 8; i++) {
    if (flaga[i] !== 0 || i % 997 !== 0) continue
    const a = adresy[i]
    console.log(
      `  ${a.miejscowosc} ${a.ulica ?? ''} ${a.nr} (${a.gmina}): ${opisOdcinka(odcinek[i])}, ${Math.round(odleglosc[i])} m, gruntowe 300 m: ${udzial[i]}%`,
    )
    licznik++
  }

  // 4. Zapis
  const slownik = {}
  const etykiety = Array.from(odcinek, (id, i) => {
    if (flaga[i] === null) return null
    const klucz = `${siec.ranga[id] >= RANGA.ULICA ? 'u' : 'w'}${siec.detal[id]}${siec.zrodlo[id]}`
    slownik[klucz] ??= opisOdcinka(id)
    return klucz
  })
  const zrodloOsm = {
    nazwa: 'OpenStreetMap, ekstrakt Geofabrik – Małopolska (highway, surface, tracktype)',
    url: OSM_STRONA,
    licencja: LICENCJA_OSM,
    dataDanych: dataOsm,
    pobrano,
  }
  const zrodloBdot = {
    nazwa: `BDOT10k, warstwa OT_SKDR_L (droga), powiaty ${POWIATY.join(', ')} – GUGiK`,
    url: BDOT_STRONA,
    licencja: LICENCJA_BDOT,
    dataDanych: bdot.dataDanych ?? pobrano,
    pobrano,
  }
  const opisZrodel =
    `Nawierzchnia: jawny tag OSM (surface, tracktype), a gdy go brak, materiał z BDOT10k (GUGiK, opracowany z ortofotomapy; wersje obiektów wg roku: ${lataTekst}, więc drogi utwardzone po 2023 r. mogą tam jeszcze figurować jako gruntowe); ` +
    `tam, gdzie OSM nie ma odcinka, a BDOT10k go ma (np. drogi polne), liczy się BDOT10k. Gdy oba źródła opisują ten sam odcinek, są zgodne na ${proc(st.zgodneM, jawneRazem)} jego długości. ` +
    `Za gruntową uznajemy grunt naturalny, żwir, tłuczeń i nawierzchnię ubitą; za utwardzoną asfalt, beton, płyty, kostkę i bruk.`
  const dane = {
    flaga: {
      id: 'dojazd_utwardzony',
      kategoria: 'transport',
      nazwa: 'Dojazd drogą utwardzoną',
      opis:
        `1 = najbliższa ulica ma nawierzchnię utwardzoną, 0 = gruntową, null = brak drogi w zasięgu albo nieznana nawierzchnia. ` +
        `Ulica to najbliższy odcinek drogi publicznej (BDOT10k) albo ulicy (OSM) w promieniu ${PROMIEN_ULICY} m od adresu; gdy takiej nie ma, liczy się najbliższy odcinek jakiejkolwiek drogi (wewnętrznej, polnej, podjazdu) w promieniu ${MAX_DOJAZD} m. ` +
        `${opisZrodel} To odległość w linii prostej od punktu adresu, nie trasa przejazdu: ostatni odcinek podjazdu może mieć inną nawierzchnię, a punkt adresu nie leży na bramie działki. Etykieta (na karcie zastępuje liczbę) podaje wynik, rodzaj drogi, nawierzchnię i źródło.`,
      jednostka: 'status',
      kierunek: 'wiecej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 1],
      zadanie: ZADANIE,
      zrodla: [zrodloBdot, zrodloOsm],
    },
    udzial: {
      id: 'drogi_gruntowe_300m',
      kategoria: 'transport',
      nazwa: 'Udział dróg gruntowych w 300 m',
      opis:
        `Odsetek długości dróg gruntowych wśród dróg o znanej nawierzchni w promieniu ${PROMIEN} m od adresu (długość każdego odcinka obcinamy do koła). ` +
        `Liczą się ulice, drogi wewnętrzne i polne z BDOT10k i OSM, bez autostrad i ekspresówek, ścieżek, podjazdów i uliczek parkingowych, więc adres przy asfaltowej ulicy obok pól też może mieć wysoki udział: droga polna to droga gruntowa w okolicy, a nie dojazd. ` +
        `${opisZrodel} Drogi o nieznanej nawierzchni (${proc(calosc - znaneM, calosc)} długości sieci w okolicy adresów: odcinki OSM bez tagu surface, których BDOT10k nie ma) są pomijane. Mniej niż ${MIN_DLUGOSC} m dróg o znanej nawierzchni w kole: brak danych.`,
      jednostka: '%',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      rozmiar: `promień ${PROMIEN} m`,
      zakres: [0, 100],
      zadanie: ZADANIE,
      zrodla: [zrodloBdot, zrodloOsm],
    },
  }
  zapiszWskaznik(dane.flaga, flaga, etykiety, slownik)
  zapiszWskaznik(dane.udzial, udzial)
  for (const id of [dane.flaga.id, dane.udzial.id])
    console.log(
      `${id}.json: ${(statSync(join(DANE, 'wskazniki', `${id}.json`)).size / 1e6).toFixed(2)} MB`,
    )
  console.log(`Słownik etykiet dojazdu: ${JSON.stringify(slownik)}`)
  console.log(`Długość dróg o znanej nawierzchni w sieci: ${km(znaneM)} km`)
  console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
}
