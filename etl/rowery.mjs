// Rowery i mobilność (#119): trzy wskaźniki transportowe dla każdego adresu z adresy.json.
//   rower_infrastruktura_odleglosc – metry do najbliższej drogi, ciągu, pasa lub kontrapasa rowerowego;
//   stojaki_300m                   – stojaki rowerowe ZTP w promieniu 300 m (tylko Kraków);
//   pr_odleglosc                   – metry do najbliższego parkingu Park and Ride ZTP (tylko Kraków).
//
// Źródła:
//   * MSIP Kraków, usługa Obserwatorium/ZTP_Komunikacja_Miejska_i_Rowerowa (dane ZTP, EPSG:2178):
//     warstwa 5 „Ciągi_rowerowe”, 4 „Stojaki ZTP”, 7 „Parking Park and Ride”. Warstwy 2 (punkty
//     mobilności = hulajnogi) i 3 (punktowa infrastruktura: naprawy, liczniki, podpórki) nie wchodzą.
//     Atrybucja: „Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl)”.
//   * OpenStreetMap (ekstrakt Geofabrik, Małopolska) – wyłącznie drogi rowerowe w 13 gminach
//     obwarzanka. Overpass z maszyn zespołu bywa nieosiągalny i ma limity, a ekstrakt daje stały,
//     datowany stan, który można powtórzyć. DuckDB spatial czyta PBF (ST_ReadOSM) w kilka sekund.
//
// Dlaczego dwa źródła w jednym wskaźniku: ewidencja ZTP kończy się na granicy Krakowa, a mapa ma
// pokazać także obwarzanek. Adres w Krakowie liczymy wyłącznie z ZTP (źródło urzędowe), adres w
// gminie obwarzanka z OSM (wszystkie linie z ramki, także te w granicach Krakowa, więc adres przy
// granicy nie traci sąsiedniej drogi). Warstwy SMK „drogi_rowerowe_metropolia” celowo nie używamy:
// należy do #113 (droga_rowerowa_odleglosc).
//
// Czego tu nie ma: ładowarek EV (ladowarka_ev_odleglosc). Pliki EIPA UDT wymagają rejestracji
// konta i mają limit pobrań na godzinę (https://eipa.udt.gov.pl/reader/docs), więc bez konta
// nie da się ich pobrać; szczegóły i opcje w etl/rowery.md. Roweru miejskiego i hulajnóg też nie
// (decyzja z issue: w Krakowie brak systemu stacyjnego, brak potwierdzonego GBFS).
//
// Uruchom: node etl/rowery.mjs [ścieżka do malopolskie-*.osm.pbf]
// Surowe pobrania: etl/.cache/rowery (MSIP, jeden raz) i etl/.cache/osm (PBF ~200 MB, jeden raz;
// bez argumentu skrypt użyje najnowszego pliku z cache albo pobierze „latest” z Geofabrik).
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { request } from 'node:https'
import { basename, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { DuckDBInstance } from '@duckdb/node-api'
import KDBush from 'kdbush'
import proj4 from 'proj4'
import { IndeksOdcinkow, odlegloscDoOdcinka } from './lib/odcinki.mjs'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ZADANIE = 119
const TERYT_KRAKOW = '1261011'
const MSIP_HOST = 'msip.um.krakow.pl'
const MSIP = `https://${MSIP_HOST}/arcgis/rest/services/Obserwatorium/ZTP_Komunikacja_Miejska_i_Rowerowa/MapServer`
const WARSTWA = { ciagi: 5, stojaki: 4, pr: 7 }
const STRONA = 2000 // maxRecordCount usługi
const LICENCJA_MSIP = 'Regulamin MSIP: https://msip.krakow.pl/getHtml?dok_id=228972'
const ATRYBUCJA_MSIP = 'Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl)'
const ZBIOR_ZTP =
  'https://otwartedane.um.krakow.pl/zbiory-danych/mobilnosc-aktywna-rowery-w-krakowie'
const OSM_LATEST = 'https://download.geofabrik.de/europe/poland/malopolskie-latest.osm.pbf'
const OSM_STRONA = 'https://download.geofabrik.de/europe/poland/malopolskie.html'
const LICENCJA_OSM =
  'ODbL 1.0, © współtwórcy OpenStreetMap (https://www.openstreetmap.org/copyright); wynik to dzieło wytworzone z wyboru linii rowerowych i odległości geodezyjnej, atrybucja wymagana'
const UA = 'adresscore-etl/1.0 (HackYeah 2026; https://github.com/Mati46p/adresscore)'

export const PROMIEN_STOJAKOW = 300 // m
export const MAX_ODLEGLOSC = 10_000 // m; dalej brak danych (poza zasięgiem opracowania)
// Ramka Krakowa w EPSG:2178 (jak w zielen.mjs): odsiewa rekordy z błędnymi współrzędnymi.
const RAMKA_KRAKOWA = { x: [7_400_000, 7_460_000], y: [5_520_000, 5_570_000] }

proj4.defs(
  'EPSG:2178',
  '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs',
)
const rzutuj = ([lon, lat]) => proj4('EPSG:4326', 'EPSG:2178', [lon, lat])

// ---------------------------------------------------------------------------------------------
// Klasyfikacja: co jest „infrastrukturą rowerową” i „stojakiem”
// ---------------------------------------------------------------------------------------------

/**
 * Rodzaje z pola `rodzaj` warstwy „Ciągi_rowerowe”, które liczymy. Opis zbioru ZTP wymienia: drogi
 * dla rowerów, pasy, ciągi pieszo-rowerowe, kontrapasy, kontraruchy, przejazdy i „inne drogi
 * rowerowe odseparowane od ruchu samochodowego” – to ostatnie czytamy jako rodzaj „inny”.
 * Pomijamy rodzaje, które są tylko zezwoleniem znakowym albo zwykłym chodnikiem: kontraruch
 * (jazda pod prąd w ulicy jednokierunkowej), „B-1 T22”, „chodnik dopuszczony do ruchu rowerowego”.
 * Rowerzysta nie zyskuje tam wydzielonego miejsca, więc nie jest to „infrastruktura w pobliżu”.
 */
const RODZAJE_MSIP = new Map([
  ['droga rowerowa', 'droga'],
  ['ciąg pieszo-rowerowy', 'ciag'],
  ['pas rowerowy', 'pas'],
  ['kontrapas', 'pas'],
  ['inny', 'inny'],
  ['przejazd', 'przejazd'],
])

export function rodzajMsip(rodzaj) {
  return (
    RODZAJE_MSIP.get(
      String(rodzaj ?? '')
        .trim()
        .toLowerCase(),
    ) ?? null
  )
}

/** Stojaki na hulajnogi i adnotacje o naprawie nie są miejscem na rower – zostają tylko te dwa typy. */
const TYPY_STOJAKOW = new Set(['stojak rowerowy', 'stojak rowerowy listwa'])

/** W 4% punktów pole „liczba” jest puste; stojak istnieje, więc liczymy co najmniej 1. */
export function liczbaStojakow(liczba) {
  return Number.isFinite(liczba) && liczba > 0 ? liczba : 1
}

const NIEAKTYWNE_OSM = new Set(['construction', 'proposed', 'razed', 'abandoned'])
const SCIEZKI_OSM = new Set(['path', 'footway', 'pedestrian'])
const PASY_OSM = new Set(['lane', 'track', 'opposite_lane', 'opposite_track'])

/**
 * Rodzaj linii OSM albo null. Odpowiedniki rodzajów ZTP: highway=cycleway = droga dla rowerów,
 * path/footway z bicycle=designated = ciąg pieszo-rowerowy, cycleway=lane/track na jezdni = pas.
 * Pomijamy shared_lane (znak na jezdni, nie wydzielony pas), shoulder, sidewalk, opposite
 * (kontraruch) i „separate” (droga jest wtedy osobną linią i łapie ją pierwszy warunek).
 */
export function rodzajOsm(t) {
  const droga = t.highway
  if (!droga || NIEAKTYWNE_OSM.has(droga)) return null
  const zamknieta =
    (t.access === 'private' || t.access === 'no') &&
    !['yes', 'designated', 'permissive'].includes(t.bicycle)
  if (droga === 'cycleway') return t.bicycle === 'no' || zamknieta ? null : 'droga'
  if (SCIEZKI_OSM.has(droga) && t.bicycle === 'designated') return zamknieta ? null : 'ciag'
  if ([t.cycleway, t.cycleway_left, t.cycleway_right, t.cycleway_both].some((v) => PASY_OSM.has(v)))
    return 'pas'
  return null
}

// ---------------------------------------------------------------------------------------------
// Parsowanie warstw MSIP (esriJSON w EPSG:2178)
// ---------------------------------------------------------------------------------------------

const wRamceKrakowa = (x, y) =>
  x > RAMKA_KRAKOWA.x[0] &&
  x < RAMKA_KRAKOWA.x[1] &&
  y > RAMKA_KRAKOWA.y[0] &&
  y < RAMKA_KRAKOWA.y[1]

/** „26/09/2026” → „2026-09-26”; z wielu wartości bierze najpóźniejszą. */
export function dataImportu(obiekty) {
  const daty = new Set()
  for (const o of obiekty) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(o.attributes?.data_importu ?? '').trim())
    if (m) daty.add(`${m[3]}-${m[2]}-${m[1]}`)
  }
  if (!daty.size) throw new Error('MSIP: brak poprawnej daty w polu data_importu')
  return [...daty].sort().at(-1)
}

/** Linie rowerowe ZTP: tylko policzone rodzaje, z geometrią w ramce Krakowa. */
export function linieMsip(obiekty) {
  const linie = []
  const pominiete = new Map()
  let bezGeometrii = 0
  let poZasiegu = 0
  for (const o of obiekty) {
    const rodzaj = rodzajMsip(o.attributes?.rodzaj)
    if (!rodzaj) {
      const nazwa = String(o.attributes?.rodzaj ?? 'brak rodzaju')
      pominiete.set(nazwa, (pominiete.get(nazwa) ?? 0) + 1)
      continue
    }
    const sciezki = o.geometry?.paths
    if (!sciezki?.length) {
      bezGeometrii++
      continue
    }
    if (sciezki.some((p) => p.some(([x, y]) => !wRamceKrakowa(x, y)))) {
      poZasiegu++
      continue
    }
    for (const p of sciezki) linie.push({ rodzaj, punkty: p.map(([x, y]) => [x, y]) })
  }
  return { linie, pominiete, bezGeometrii, poZasiegu }
}

/** Stojaki rowerowe ZTP jako punkty { x, y, miejsca } (bez stojaków na hulajnogi). */
export function stojakiMsip(obiekty) {
  const punkty = []
  const pominiete = new Map()
  let bezGeometrii = 0
  let poZasiegu = 0
  let bezLiczby = 0
  for (const o of obiekty) {
    const typ = String(o.attributes?.typ ?? '')
      .trim()
      .toLowerCase()
    if (!TYPY_STOJAKOW.has(typ)) {
      pominiete.set(typ || 'brak typu', (pominiete.get(typ || 'brak typu') ?? 0) + 1)
      continue
    }
    const g = o.geometry
    if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) {
      bezGeometrii++
      continue
    }
    if (!wRamceKrakowa(g.x, g.y)) {
      poZasiegu++
      continue
    }
    if (!(o.attributes?.liczba > 0)) bezLiczby++
    punkty.push({ x: g.x, y: g.y, miejsca: liczbaStojakow(o.attributes?.liczba) })
  }
  return { punkty, pominiete, bezGeometrii, poZasiegu, bezLiczby }
}

/** Parkingi Park and Ride ZTP jako { x, y, nazwa, miejsca, ladowarki }. */
export function parkingiPrMsip(obiekty) {
  return obiekty.flatMap((o) => {
    const g = o.geometry
    if (!g || !wRamceKrakowa(g.x, g.y)) return []
    return [
      {
        x: g.x,
        y: g.y,
        nazwa: String(o.attributes?.nazwa ?? '').trim() || `P+R ${o.attributes?.objectid}`,
        miejsca: o.attributes?.m_ogolem ?? null,
        ladowarki: o.attributes?.m_elektryczne ?? null,
      },
    ]
  })
}

// ---------------------------------------------------------------------------------------------
// Obliczenia
// ---------------------------------------------------------------------------------------------

/** Indeks stojaków do zliczania w promieniu (KDBush na współrzędnych metrycznych). */
export function indeksStojakow(punkty) {
  const indeks = new KDBush(punkty.length)
  for (const p of punkty) indeks.add(p.x, p.y)
  indeks.finish()
  return { indeks, miejsca: punkty.map((p) => p.miejsca) }
}

/** Suma pola „liczba” stojaków w promieniu `promien` metrów od punktu (x, y). */
export function stojakiWPromieniu({ indeks, miejsca }, x, y, promien = PROMIEN_STOJAKOW) {
  let suma = 0
  for (const i of indeks.within(x, y, promien)) suma += miejsca[i]
  return suma
}

/** Najbliższy z niewielu punktów (przeszukanie liniowe – P+R jest ich dziesięć). */
export function najblizszyPunkt(punkty, x, y) {
  let najlepszy = null
  for (const p of punkty) {
    const metry = Math.hypot(p.x - x, p.y - y)
    if (!najlepszy || metry < najlepszy.metry) najlepszy = { metry, punkt: p }
  }
  return najlepszy
}

/** Wzorzec do kontroli indeksu: odległość do najbliższej linii przeszukaniem wszystkich odcinków. */
export function najblizszaLiniaLiniowo(linie, x, y) {
  let najlepsza = Infinity
  for (const { punkty } of linie)
    for (let i = 1; i < punkty.length; i++)
      najlepsza = Math.min(
        najlepsza,
        odlegloscDoOdcinka(x, y, punkty[i - 1][0], punkty[i - 1][1], punkty[i][0], punkty[i][1]),
      )
  return najlepsza
}

/**
 * Składa linie OSM z listy dróg (pola tagów + refs) i słownika węzłów id → [lon, lat].
 * Odrzuca drogi bez rodzaju i te, które w ogóle nie wchodzą do ramki [xmin, ymin, xmax, ymax].
 */
export function zlozLinieOsm(drogi, wezly, ramka, rzutowanie = rzutuj) {
  const linie = []
  const statystyka = { drogi: drogi.length, bezRodzaju: 0, poRamce: 0, krotkie: 0, brakWezlow: 0 }
  for (const d of drogi) {
    const rodzaj = rodzajOsm(d)
    if (!rodzaj) {
      statystyka.bezRodzaju++
      continue
    }
    const punkty = []
    for (const ref of d.refs) {
      const w = wezly.get(ref)
      if (w) punkty.push(rzutowanie(w))
      else statystyka.brakWezlow++
    }
    if (punkty.length < 2) {
      statystyka.krotkie++
      continue
    }
    if (
      !punkty.some(([x, y]) => x >= ramka[0] && y >= ramka[1] && x <= ramka[2] && y <= ramka[3])
    ) {
      statystyka.poRamce++
      continue
    }
    linie.push({ rodzaj, punkty, id: d.id })
  }
  return { linie, statystyka }
}

// ---------------------------------------------------------------------------------------------
// Pobieranie
// ---------------------------------------------------------------------------------------------

const BLEDY_CERTYFIKATU = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

/** Zapytanie bez weryfikacji certyfikatu – wyłącznie dla hosta MSIP i tylko po błędzie certyfikatu. */
function pobierzBezWeryfikacji(url) {
  return new Promise((rozwiaz, odrzuc) => {
    const r = request(url, { rejectUnauthorized: false, timeout: 60_000 }, (odp) => {
      const kawalki = []
      odp.on('data', (k) => kawalki.push(k))
      odp.on('end', () =>
        odp.statusCode === 200
          ? rozwiaz(Buffer.concat(kawalki).toString('utf8'))
          : odrzuc(new Error(`${url} → ${odp.statusCode}`)),
      )
    })
    r.on('timeout', () => r.destroy(new Error(`${url}: przekroczono czas`)))
    r.on('error', odrzuc)
    r.end()
  })
}

async function pobierzTekstMsip(url) {
  try {
    const odp = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!odp.ok) throw new Error(`${url} → ${odp.status}`)
    return await odp.text()
  } catch (blad) {
    if (new URL(url).host !== MSIP_HOST || !BLEDY_CERTYFIKATU.has(blad.cause?.code)) throw blad
    console.warn(
      `MSIP: certyfikat odrzucony (${blad.cause.code}), ponawiam bez weryfikacji dla ${MSIP_HOST}`,
    )
    return pobierzBezWeryfikacji(url)
  }
}

/** JSON z MSIP z buforem w etl/.cache/rowery. Odpowiedź z błędem nie trafia do bufora. */
async function pobierzJsonMsip(url, plik) {
  const sciezka = join(CACHE, 'rowery', plik)
  if (existsSync(sciezka)) return JSON.parse(readFileSync(sciezka, 'utf8'))
  const tekst = await pobierzTekstMsip(url)
  const dane = JSON.parse(tekst)
  if (dane.error) throw new Error(`${url}: ${JSON.stringify(dane.error)}`)
  writeFileSync(sciezka, tekst)
  return dane
}

function sprawdzUklad(sr) {
  const wkt = sr?.wkt ?? ''
  if (sr?.wkid !== 2178 && !(wkt.includes('CS2000_21') && wkt.includes('7500000')))
    throw new Error(`MSIP: oczekiwano EPSG:2178, jest ${JSON.stringify(sr)}`)
}

async function pobierzWarstweMsip(id) {
  const { count } = await pobierzJsonMsip(
    `${MSIP}/${id}/query?where=1%3D1&returnCountOnly=true&f=json`,
    `msip_${id}_liczba.json`,
  )
  const obiekty = []
  for (let od = 0; od < count; od += STRONA) {
    const url = `${MSIP}/${id}/query?where=1%3D1&outFields=*&orderByFields=objectid&resultOffset=${od}&resultRecordCount=${STRONA}&returnGeometry=true&f=json`
    const strona = await pobierzJsonMsip(url, `msip_${id}_${od}.json`)
    sprawdzUklad(strona.spatialReference)
    obiekty.push(...strona.features)
  }
  const unikalne = new Set(obiekty.map((o) => o.attributes.objectid)).size
  if (obiekty.length !== count || unikalne !== count)
    throw new Error(
      `MSIP warstwa ${id}: pobrano ${obiekty.length} (unikalnych ${unikalne}), usługa zgłasza ${count}. Usuń etl/.cache/rowery i uruchom ponownie`,
    )
  return obiekty
}

/** Ścieżka do ekstraktu PBF: argument, najnowszy plik z cache albo pobranie „latest” z Geofabrik. */
async function rozwiazPbf(jawna) {
  if (jawna) {
    if (!existsSync(jawna)) throw new Error(`Brak pliku PBF: ${jawna}`)
    return resolve(jawna)
  }
  const katalog = join(CACHE, 'osm')
  mkdirSync(katalog, { recursive: true })
  const istniejace = readdirSync(katalog)
    .filter((n) => /^malopolskie-\d{6}\.osm\.pbf$/.test(n))
    .sort()
  if (istniejace.length) return join(katalog, istniejace.at(-1))

  const przekierowanie = await fetch(OSM_LATEST, {
    redirect: 'manual',
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(60_000),
  })
  const adres = przekierowanie.headers.get('location')
  if (!adres) throw new Error(`Geofabrik: brak przekierowania z ${OSM_LATEST}`)
  const url = new URL(adres, OSM_LATEST).href
  const cel = join(katalog, basename(new URL(url).pathname))
  console.log(`Pobieram ${url} (jednorazowo, ok. 200 MB)…`)
  const odp = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30 * 60_000),
  })
  if (!odp.ok || !odp.body) throw new Error(`${url} → ${odp.status}`)
  const oczekiwane = Number(odp.headers.get('content-length'))
  const tymczasowy = `${cel}.tmp`
  try {
    await pipeline(Readable.fromWeb(odp.body), createWriteStream(tymczasowy))
    if (oczekiwane && statSync(tymczasowy).size !== oczekiwane)
      throw new Error(`ucięte pobranie PBF: ${statSync(tymczasowy).size}/${oczekiwane} B`)
    renameSync(tymczasowy, cel)
  } catch (blad) {
    rmSync(tymczasowy, { force: true })
    throw blad
  }
  return cel
}

/** Data stanu ekstraktu z nazwy pliku „malopolskie-261002.osm.pbf” → „2026-10-02”. */
export function dataPbf(sciezka) {
  const m = /-(\d{2})(\d{2})(\d{2})\.osm\.pbf$/.exec(basename(sciezka))
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`
  return statSync(sciezka).mtime.toISOString().slice(0, 10)
}

// Pola tagów OSM, które czyta rodzajOsm (kolumna SQL → klucz tagu).
const POLA_OSM = [
  ['highway', 'highway'],
  ['bicycle', 'bicycle'],
  ['access', 'access'],
  ['cycleway', 'cycleway'],
  ['cycleway_left', 'cycleway:left'],
  ['cycleway_right', 'cycleway:right'],
  ['cycleway_both', 'cycleway:both'],
]

/** Drogi z tagami rowerowymi i współrzędne ich węzłów z PBF (dwa przebiegi DuckDB, kilka sekund). */
async function wczytajOsm(pbf) {
  const cytuj = (s) => `'${String(s).replaceAll("'", "''")}'`
  const plik = cytuj(pbf.replaceAll('\\', '/'))
  const tag = (k) => `map_extract_value(tags, ${cytuj(k)})`
  const instancja = await DuckDBInstance.create(':memory:', {
    temp_directory: join(CACHE, 'duckdb_rowery_tmp'),
    memory_limit: '4GB',
  })
  const polaczenie = await instancja.connect()
  try {
    await polaczenie.run('INSTALL spatial; LOAD spatial')
    // Szeroki filtr: ostateczną decyzję podejmuje rodzajOsm (testowalna w JS).
    await polaczenie.run(`
      CREATE TABLE drogi AS
      SELECT id, ${POLA_OSM.map(([kolumna, klucz]) => `${tag(klucz)} AS ${kolumna}`).join(', ')}, refs
      FROM ST_ReadOSM(${plik})
      WHERE kind = 'way' AND cardinality(tags) > 0 AND (
        ${tag('highway')} = 'cycleway'
        OR ${tag('bicycle')} = 'designated'
        OR ${tag('cycleway')} IS NOT NULL
        OR ${tag('cycleway:left')} IS NOT NULL
        OR ${tag('cycleway:right')} IS NOT NULL
        OR ${tag('cycleway:both')} IS NOT NULL
      )`)
    const drogi = (
      await polaczenie.runAndReadAll(`
        SELECT id::DOUBLE AS id, ${POLA_OSM.map(([kolumna]) => kolumna).join(', ')},
               list_transform(refs, r -> r::DOUBLE) AS refs
        FROM drogi`)
    ).getRowObjectsJS()
    const [ids, lony, laty] = (
      await polaczenie.runAndReadAll(`
        SELECT id::DOUBLE, lon, lat FROM ST_ReadOSM(${plik})
        WHERE kind = 'node' AND id IN (SELECT unnest(refs) FROM drogi)`)
    ).getColumnsJS()
    const wezly = new Map()
    for (let i = 0; i < ids.length; i++) wezly.set(ids[i], [lony[i], laty[i]])
    return { drogi, wezly }
  } finally {
    polaczenie.closeSync()
    instancja.closeSync()
  }
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
  ['Kraków, Bulwary Wiślane (Podgórze)', 19.9425, 50.0485],
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
  mkdirSync(join(CACHE, 'rowery'), { recursive: true })
  const { adresy } = wczytajAdresy()
  const xy = adresy.map((a) => rzutuj([a.lon, a.lat]))
  const wKrakowie = adresy.map((a) => a.teryt === TERYT_KRAKOW)
  const nKrakow = wKrakowie.filter(Boolean).length
  console.log(
    `Adresy: ${adresy.length}, w tym Kraków ${nKrakow}, obwarzanek ${adresy.length - nKrakow}`,
  )

  // 1. MSIP ZTP (Kraków)
  const surowe = {}
  for (const [nazwa, id] of Object.entries(WARSTWA)) surowe[nazwa] = await pobierzWarstweMsip(id)
  const ciagi = linieMsip(surowe.ciagi)
  const stojaki = stojakiMsip(surowe.stojaki)
  const parkingi = parkingiPrMsip(surowe.pr)
  const dataZtp = dataImportu([...surowe.ciagi, ...surowe.stojaki, ...surowe.pr])
  if (!ciagi.linie.length || !stojaki.punkty.length || !parkingi.length)
    throw new Error('MSIP: pusta warstwa po filtrowaniu')
  const odrzucone = ciagi.bezGeometrii + ciagi.poZasiegu + stojaki.bezGeometrii + stojaki.poZasiegu
  if (odrzucone > 0.01 * (surowe.ciagi.length + surowe.stojaki.length))
    throw new Error(`MSIP: ${odrzucone} rekordów bez geometrii albo poza Krakowem (próg 1%)`)
  console.log(
    `MSIP: linie ${ciagi.linie.length} odcinków (pominięte rodzaje: ${[...ciagi.pominiete].map(([k, v]) => `${k} ${v}`).join(', ')}); ` +
      `stojaki ${stojaki.punkty.length} punktów, ${stojaki.punkty.reduce((s, p) => s + p.miejsca, 0)} wg pola liczba ` +
      `(bez wartości ${stojaki.bezLiczby}; pominięte typy: ${[...stojaki.pominiete].map(([k, v]) => `${k} ${v}`).join(', ')}); ` +
      `P+R ${parkingi.length}; odrzucone ${odrzucone}; data ZTP ${dataZtp}`,
  )

  // 2. OSM (obwarzanek). Ramka = zasięg adresów + MAX_ODLEGLOSC, żeby odległości na skraju były pełne.
  const pbf = await rozwiazPbf(process.argv[2] ?? process.env.OSM_PBF)
  const dataOsm = dataPbf(pbf)
  console.log(`OSM: ${pbf} (stan ${dataOsm})`)
  const xs = xy.map((p) => p[0])
  const ys = xy.map((p) => p[1])
  const ramka = [
    xs.reduce((a, b) => Math.min(a, b)) - MAX_ODLEGLOSC,
    ys.reduce((a, b) => Math.min(a, b)) - MAX_ODLEGLOSC,
    xs.reduce((a, b) => Math.max(a, b)) + MAX_ODLEGLOSC,
    ys.reduce((a, b) => Math.max(a, b)) + MAX_ODLEGLOSC,
  ]
  const { drogi, wezly } = await wczytajOsm(pbf)
  const osm = zlozLinieOsm(drogi, wezly, ramka)
  const poRodzaju = {}
  for (const l of osm.linie) poRodzaju[l.rodzaj] = (poRodzaju[l.rodzaj] ?? 0) + 1
  console.log(
    `OSM: dróg z tagami ${drogi.length}, węzłów ${wezly.size}; linii w ramce ${osm.linie.length} ` +
      `${JSON.stringify(poRodzaju)}; odrzucone: ${JSON.stringify(osm.statystyka)}`,
  )
  if (osm.linie.length < 200) throw new Error('OSM: podejrzanie mało linii rowerowych w ramce')

  // 3. Indeksy
  const indeksZtp = new IndeksOdcinkow()
  for (const l of ciagi.linie) indeksZtp.dodajLinie(l.punkty, l.rodzaj)
  const indeksOsm = new IndeksOdcinkow()
  for (const l of osm.linie) indeksOsm.dodajLinie(l.punkty, l.rodzaj)
  console.log(
    `Indeksy: ZTP ${indeksZtp.liczbaOdcinkow} odcinków (${(indeksZtp.dlugosc / 1000).toFixed(0)} km), ` +
      `OSM ${indeksOsm.liczbaOdcinkow} odcinków (${(indeksOsm.dlugosc / 1000).toFixed(0)} km)`,
  )
  const stojakiIndeks = indeksStojakow(stojaki.punkty)

  // 4. Wskaźniki
  const infra = []
  const infraZnacznik = []
  const stojakiWartosci = []
  const pr = []
  const prNajblizszy = []
  for (let i = 0; i < adresy.length; i++) {
    const [x, y] = xy[i]
    const trafienie = (wKrakowie[i] ? indeksZtp : indeksOsm).najblizszy(x, y, MAX_ODLEGLOSC)
    infra.push(trafienie ? Math.round(trafienie.metry) : null)
    infraZnacznik.push(trafienie?.znacznik ?? null)
    if (wKrakowie[i]) {
      stojakiWartosci.push(stojakiWPromieniu(stojakiIndeks, x, y))
      const p = najblizszyPunkt(parkingi, x, y)
      pr.push(Math.round(p.metry))
      prNajblizszy.push(p.punkt.nazwa)
    } else {
      stojakiWartosci.push(null)
      pr.push(null)
      prNajblizszy.push(null)
    }
  }

  // 5. Kontrole. Indeks kontrolujemy przeszukaniem liniowym na próbce, żeby „zielone” coś znaczyło.
  const krok = Math.max(1, Math.floor(adresy.length / 400))
  let sprawdzone = 0
  let najwiekszaRoznica = 0
  for (let i = 0; i < adresy.length; i += krok) {
    const [x, y] = xy[i]
    const wzorzec = najblizszaLiniaLiniowo(wKrakowie[i] ? ciagi.linie : osm.linie, x, y)
    const oczekiwana = wzorzec <= MAX_ODLEGLOSC ? Math.round(wzorzec) : null
    if (oczekiwana !== infra[i]) throw new Error(`Indeks ≠ przeszukanie liniowe dla adresu ${i}`)
    najwiekszaRoznica = Math.max(najwiekszaRoznica, Math.abs((infra[i] ?? 0) - wzorzec))
    sprawdzone++
  }
  console.log(
    `Kontrola indeksu: ${sprawdzone} adresów zgodnych z przeszukaniem liniowym (największa różnica po zaokrągleniu ${najwiekszaRoznica.toFixed(2)} m)`,
  )

  // Porównanie źródeł w Krakowie: czy OSM nie jest wyraźnie mniej kompletny od ZTP.
  let podobne = 0
  let osmBlizej = 0
  let ztpBlizej = 0
  let porownane = 0
  for (let i = 0; i < adresy.length; i += 3) {
    if (!wKrakowie[i]) continue
    const o = indeksOsm.najblizszy(xy[i][0], xy[i][1], MAX_ODLEGLOSC)
    if (!o || infra[i] === null) continue
    porownane++
    const d = o.metry - infra[i]
    if (Math.abs(d) <= 100) podobne++
    else if (d < 0) osmBlizej++
    else ztpBlizej++
  }
  console.log(
    `Kraków, ZTP kontra OSM (co 3. adres, ${porownane}): różnica ≤ 100 m ${((100 * podobne) / porownane).toFixed(1)}%, ` +
      `OSM bliżej o > 100 m ${((100 * osmBlizej) / porownane).toFixed(1)}%, ZTP bliżej o > 100 m ${((100 * ztpBlizej) / porownane).toFixed(1)}%`,
  )

  const wybierz = (tablica, wMiescie) =>
    tablica.filter((v, i) => wKrakowie[i] === wMiescie && v !== null)
  console.log(`rower_infrastruktura_odleglosc, Kraków:    ${percentyle(wybierz(infra, true))}`)
  console.log(`rower_infrastruktura_odleglosc, obwarzanek: ${percentyle(wybierz(infra, false))}`)
  console.log(
    `stojaki_300m, Kraków:                      ${percentyle(wybierz(stojakiWartosci, true))}`,
  )
  console.log(`pr_odleglosc, Kraków:                      ${percentyle(wybierz(pr, true))}`)

  console.log('Miejsca kontrolne (najbliższy adres w bazie):')
  const miejsca = [
    ...MIEJSCA_KONTROLNE.map(([nazwa, lon, lat]) => [nazwa, ...rzutuj([lon, lat])]),
    ...parkingi.slice(0, 3).map((p) => [p.nazwa, p.x, p.y]),
  ]
  for (const [nazwa, px, py] of miejsca) {
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
      `  ${nazwa.padEnd(36)} → ${`${a.miejscowosc} ${a.ulica ?? ''} ${a.nr}`.trim().padEnd(34)} (${Math.round(odl)} m od punktu) ` +
        `infra ${infra[najlepszy]} m [${infraZnacznik[najlepszy]}], stojaki300 ${stojakiWartosci[najlepszy]}, ` +
        `P+R ${pr[najlepszy]} m [${prNajblizszy[najlepszy]}]`,
    )
  }

  // 6. Zapis
  const zrodloZtp = (warstwa, nazwa) => ({
    nazwa: `${ATRYBUCJA_MSIP} – ZTP Kraków: ${nazwa}`,
    url: `${MSIP}/${warstwa}`,
    licencja: `${LICENCJA_MSIP}; dane ZTP: ${ZBIOR_ZTP}`,
    dataDanych: dataZtp,
    pobrano,
  })
  const zrodloOsm = {
    nazwa: 'OpenStreetMap, ekstrakt Geofabrik – Małopolska (linie rowerowe obwarzanka)',
    url: OSM_STRONA,
    licencja: LICENCJA_OSM,
    dataDanych: dataOsm,
    pobrano,
  }

  zapiszWskaznik(
    {
      id: 'rower_infrastruktura_odleglosc',
      kategoria: 'transport',
      nazwa: 'Najbliższa infrastruktura rowerowa',
      opis: `Odległość geodezyjna w linii prostej od adresu do najbliższej drogi dla rowerów, ciągu pieszo-rowerowego, pasa lub kontrapasa rowerowego. W Krakowie: ewidencja ZTP z ${dataZtp} (bez kontraruchu, chodników dopuszczonych do ruchu rowerowego i oznakowania B-1/T-22); ewidencja kończy się na granicy miasta, więc adres przy granicy może mieć bliższą drogę po drugiej stronie. W 13 gminach obwarzanka: OpenStreetMap (highway=cycleway, ścieżki path/footway z bicycle=designated, pasy cycleway=lane/track), stan ${dataOsm}; OSM bywa niekompletny, więc tam wartość jest raczej górnym oszacowaniem. To nie jest długość dojazdu ani ocena bezpieczeństwa trasy. Dalej niż ${MAX_ODLEGLOSC / 1000} km: brak danych.`,
      jednostka: 'm',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      // 3 km obejmuje 95% adresów Krakowa i 90% wszystkich (p90 = 2992 m); dalej skala jest płaska.
      zakres: [0, 3000],
      zadanie: ZADANIE,
      zrodla: [zrodloZtp(WARSTWA.ciagi, 'Ciągi_rowerowe'), zrodloOsm],
    },
    infra,
  )
  zapiszWskaznik(
    {
      id: 'stojaki_300m',
      kategoria: 'transport',
      nazwa: 'Stojaki rowerowe w 300 m',
      opis: `Suma pola „liczba” stojaków rowerowych z ewidencji ZTP (typy „stojak rowerowy” i „stojak rowerowy listwa”, bez stojaków na hulajnogi) w promieniu ${PROMIEN_STOJAKOW} m w linii prostej od adresu. Zero znaczy brak stojaków ZTP w tym promieniu, nie brak miejsc na rower: ewidencja nie obejmuje stojaków prywatnych, sklepowych ani uczelnianych. W ${stojaki.bezLiczby} punktach bez wartości pola „liczba” liczymy 1. Tylko Kraków; poza nim brak danych.`,
      jednostka: 'szt.',
      kierunek: 'wiecej-lepiej',
      rozdzielczosc: 'adres',
      rozmiar: `promień ${PROMIEN_STOJAKOW} m`,
      // Rozkład jest skośny: 54% adresów Krakowa ma 0, p85 = 51, w Śródmieściu ponad 200.
      zakres: [0, 50],
      zadanie: ZADANIE,
      zrodla: [zrodloZtp(WARSTWA.stojaki, 'Stojaki ZTP')],
    },
    stojakiWartosci,
  )
  const lista = parkingi
    .map((p) => `${p.nazwa}${p.miejsca ? ` (${p.miejsca} miejsc)` : ''}`)
    .join(', ')
  zapiszWskaznik(
    {
      id: 'pr_odleglosc',
      kategoria: 'transport',
      nazwa: 'Najbliższy parking Park and Ride',
      opis: `Odległość geodezyjna w linii prostej od adresu w Krakowie do najbliższego z ${parkingi.length} parkingów Park and Ride ZTP: ${lista}. To nie jest czas ani trasa dojazdu. Parking służy dojeżdżającym spoza miasta, więc bliskość nie jest zaletą ani wadą miejsca zamieszkania; wskaźnik jest kontekstem (kierunek neutralny) i wpływa na ocenę dopiero, gdy użytkownik sam wybierze kierunek. Tylko Kraków; parkingi gmin obwarzanka nie są w ewidencji ZTP, więc poza miastem brak danych.`,
      jednostka: 'm',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      zakres: [0, 10000],
      zadanie: ZADANIE,
      zrodla: [zrodloZtp(WARSTWA.pr, 'Parking Park and Ride')],
    },
    pr,
  )
  console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
}
