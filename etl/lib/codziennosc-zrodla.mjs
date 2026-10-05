// Źródła warstwy „codzienność pieszo" (#8). Każda funkcja zwraca punkty
// { nazwa, lat, lon } w WGS84 i pobiera surowe dane do etl/.cache (drugi bieg używa cache).
// Dane są ogólne dla Małopolski – wybór obszaru robi dopiero indeks najbliższego punktu.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { unzipSync } from 'fflate'
import { geokoduj } from './codziennosc-geo.mjs'
import {
  bboxMiasta,
  MIASTO_INFO,
  pbfRegionu,
  SUFIKS_REGIONU,
  TERYT_WOJ,
  terytMiasta,
  WOJEWODZTWO,
  wMiescieMiasta,
} from './miasto.mjs'
import { CACHE, pobierzDoCache } from './wspolne.mjs'

/** Prostokąt Kraków + obwarzanek z zapasem ok. 3 km, żeby najbliższy punkt za granicą gminy był widoczny. */
export const BBOX = bboxMiasta() ?? { minLat: 49.84, maxLat: 50.3, minLon: 19.58, maxLon: 20.46 }

/** Tryb miasta: rejestry bez współrzędnych geokodujemy tylko dla wpisów z miejscowości miasta (UUG jest wolny). */
const wMiescie = wMiescieMiasta

const wBbox = (p) =>
  p.lat >= BBOX.minLat && p.lat <= BBOX.maxLat && p.lon >= BBOX.minLon && p.lon <= BBOX.maxLon

const URL_SIO =
  'https://api.dane.gov.pl/resources/1254769,wykaz-szko-i-placowek-oswiatowych-wg-stanu-bazy-sio-na-30092025/file'
const URL_ZLOBKI = 'https://api.dane.gov.pl/resources/2713903,rejestr-zobkow-lista-instytucji/file'
const URL_RPWDL =
  'https://api.dane.gov.pl/resources/70070,podmioty-wykonujace-dziaalnosc-lecznicza-link-do-usugi-umozliwiajacej-pobranie-aktualnych-danych-w-postaci-pliku-csv/file'
const URL_APTEKI = 'https://rejestry.ezdrowie.gov.pl/api/ra/pharmacies/search'
const URL_PBF = 'https://download.geofabrik.de/europe/poland/malopolskie-latest.osm.pbf'

async function duckdb(...rozszerzenia) {
  const db = await DuckDBInstance.create(':memory:')
  const c = await db.connect()
  for (const r of rozszerzenia) {
    await c.run(`INSTALL ${r}`)
    await c.run(`LOAD ${r}`)
  }
  return c
}

const wiersze = async (c, sql) => (await c.runAndReadAll(sql)).getRowObjectsJson()
const sq = (s) => s.replaceAll("'", "''")

/** Geokoduje wiersze { nazwa, miejscowosc, ulica, nr } i zostawia te, które mają współrzędne w BBOX. */
async function zGeokodowaniem(wejscie) {
  const wsp = await geokoduj(wejscie)
  const razem = wejscie.length
  const punkty = []
  wejscie.forEach((w, i) => {
    if (wsp[i]) punkty.push({ nazwa: w.nazwa, lat: wsp[i].lat, lon: wsp[i].lon })
  })
  const trafione = punkty.length
  return { punkty: punkty.filter(wBbox), razem, trafione }
}

// --- SIO / RSPO: szkoły podstawowe i przedszkola -------------------------------------------

// W SIO „Miejscowość" bywa nazwą dzielnicy (Warszawa: „Mokotów"), więc w trybie miasta wybieramy
// placówki po TERYT gminy, a miejscowość do geokodera ustawiamy na nazwę miasta.
async function wczytajSio() {
  const plik = await pobierzDoCache(URL_SIO, 'sio-2025-09-30.xlsx')
  const c = await duckdb('excel')
  return await wiersze(
    c,
    `select "Typ podmiotu" as typ, "Publiczność" as publicznosc, "Specyfika szkoły" as specyfika,
            "Nazwa placówki" as nazwa, ${MIASTO_INFO ? `'${sq(MIASTO_INFO.nazwa)}'` : 'Miejscowość'} as miejscowosc, Ulica as ulica,
            "Numer domu" as nr, "Kod pocztowy" as kod, try_cast("w tym_w oddz_przedszk" as integer) as oddz_przedszk
     from read_xlsx('${sq(plik)}', all_varchar=true)
     where idTerytWojewodztwo = '${TERYT_WOJ}' and "Numer domu" <> ''
       ${MIASTO_INFO ? `and idTerytGmina = '${terytMiasta()}'` : ''}`,
  )
}

const nazwaSzkoly = (s) => (s.nazwa ?? '').replace(/\s+/g, ' ').trim()

export async function szkolyPodstawowe() {
  const sio = await wczytajSio()
  const wejscie = sio
    .filter((s) => s.typ === 'Szkoła podstawowa' && s.publicznosc === 'publiczna')
    .filter((s) => s.specyfika !== 'specjalna')
    .map((s) => ({ ...s, nazwa: nazwaSzkoly(s) }))
  return zGeokodowaniem(wejscie)
}

export async function przedszkola() {
  const sio = await wczytajSio()
  const przedszkole = (s) => s.typ === 'Przedszkole' || s.typ === 'Punkt przedszkolny'
  const oddzial = (s) => s.typ === 'Szkoła podstawowa' && (s.oddz_przedszk ?? 0) > 0
  const wejscie = sio
    .filter((s) => przedszkole(s) || oddzial(s))
    .filter((s) => s.specyfika !== 'specjalna')
    .map((s) => ({ ...s, nazwa: nazwaSzkoly(s) }))
  return zGeokodowaniem(wejscie)
}

// --- Rejestr Żłobków i Klubów Dziecięcych (MRPiPS) -----------------------------------------

export async function zlobki() {
  const plik = await pobierzDoCache(URL_ZLOBKI, 'zlobki-mrpips.csv')
  const c = await duckdb()
  const w = (
    await wiersze(
      c,
      `select Nazwa as nazwa, Miejscowość as miejscowosc, Ulica as ulica, "Nr domu" as nr,
            "Kod pocztowy" as kod, Geolokalizacja as geo
     from read_csv('${sq(plik)}', delim=';', header=true, all_varchar=true)
     where Województwo ilike '${sq(WOJEWODZTWO)}'
       and coalesce("Czy podmiot prowadzący zawiesił działalność instytucji opieki?", '') not ilike 'TAK'`,
    )
  ).filter((z) => wMiescie(z.miejscowosc))
  const punkty = []
  const bez = []
  for (const z of w) {
    const m = /^(-?\d+(?:\.\d+)?);(-?\d+(?:\.\d+)?)$/.exec(z.geo ?? '')
    if (m) punkty.push({ nazwa: z.nazwa, lon: Number(m[1]), lat: Number(m[2]) })
    else bez.push(z)
  }
  const dod = await zGeokodowaniem(bez)
  return {
    punkty: [...punkty.filter(wBbox), ...dod.punkty],
    razem: w.length,
    trafione: punkty.length + dod.trafione,
  }
}

// --- Rejestr Aptek (Centrum e-Zdrowia / GIF) -----------------------------------------------

async function pobierzApteki() {
  const cel = join(CACHE, `apteki-${MIASTO_INFO ? MIASTO_INFO.pbf : 'malopolskie'}.json`)
  if (existsSync(cel)) return JSON.parse(readFileSync(cel, 'utf8'))
  const wszystkie = []
  const rozmiar = 1000
  for (let strona = 0; ; strona++) {
    const url = `${URL_APTEKI}?page=${strona}&size=${rozmiar}&sortField=originId&sortDirection=ASC&pharmacyProvince=${encodeURIComponent(WOJEWODZTWO)}`
    const r = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(120_000),
    })
    if (!r.ok) throw new Error(`Rejestr Aptek ${r.status}`)
    const j = await r.json()
    const razem = Number(Object.keys(j)[0])
    const lista = Object.values(j)[0]
    wszystkie.push(...lista)
    if (wszystkie.length >= razem || lista.length === 0) break
  }
  writeFileSync(cel, JSON.stringify(wszystkie))
  return wszystkie
}

export async function apteki() {
  const rejestr = await pobierzApteki()
  const wejscie = rejestr
    .filter((a) => a.pharmacyStatus?.code === 'AKTYWNA' && !a.temporaryClosed)
    .filter((a) => ['APTEKA_OGOLNODOSTEPNA', 'PUNKT_APTECZNY'].includes(a.pharmacyGenre?.code))
    .filter((a) => a.address?.city && a.address?.homeNumber)
    .filter((a) => wMiescie(a.address.city))
    .map((a) => ({
      nazwa: (a.name ?? 'Apteka').replace(/\s+/g, ' ').trim(),
      miejscowosc: a.address.city,
      ulica: a.address.street ?? '',
      nr: a.address.homeNumber,
      kod: a.address.postcode ?? null,
    }))
  return zGeokodowaniem(wejscie)
}

// --- RPWDL: gabinety lekarza POZ ------------------------------------------------------------

export async function przychodniePoz() {
  const zip = await pobierzDoCache(URL_RPWDL, 'rpwdl-aktywne.zip')
  const katalog = join(CACHE, 'rpwdl')
  const pliki = ['komorki.csv', 'zaklady.csv', 'Info.txt']
  if (pliki.some((p) => !existsSync(join(katalog, p)))) {
    // komorki.csv ma ok. 180 MB po rozpakowaniu, więc bierzemy tylko potrzebne pliki.
    mkdirSync(katalog, { recursive: true })
    const dane = unzipSync(readFileSync(zip), { filter: (f) => pliki.includes(f.name) })
    for (const p of pliki) writeFileSync(join(katalog, p), dane[p])
  }
  // Info.txt: „Raport wygenerowany na podstawie danych w systemie RPWDL z dnia 2026-10-02 00:00:00".
  const stan =
    /(\d{4}-\d{2}-\d{2})/.exec(readFileSync(join(katalog, 'Info.txt'), 'utf8'))?.[1] ?? null
  const csv = (p) =>
    `read_csv('${sq(join(katalog, p))}', delim=';', quote='"', header=true, all_varchar=true, nullstr='NULL', ignore_errors=true)`
  const c = await duckdb()
  // kodResortVIII 0010 = „poradnia (gabinet) lekarza podstawowej opieki zdrowotnej" (słownik RPWDL).
  const w = (
    await wiersze(
      c,
      `select coalesce(z.Nazwa, k."Nazwa komórki") as nazwa, k.Miejscowość as miejscowosc,
            k.Ulica as ulica, k.Budynek as nr,
            k."Kod pocztowy" as kod
     from ${csv('komorki.csv')} k
     left join (select "ID ZOZ" as id, min(Nazwa) as Nazwa from ${csv('zaklady.csv')} group by "ID ZOZ") z on z.id = k."ID ZOZ"
     where k.kodResortVIII = '0010' and k.Teryt like '${TERYT_WOJ}%'
       and k."Data zakończenia działalności komórki" is null
       and k."Budynek" is not null
     order by miejscowosc, ulica, nr, nazwa`,
    )
  ).filter((z) => wMiescie(z.miejscowosc))
  return { ...(await zGeokodowaniem(w)), stan }
}

// --- OSM (Geofabrik, plik pbf przez DuckDB spatial) ------------------------------------

export const TYPY_OSM = {
  sklep: { shop: ['supermarket', 'convenience', 'greengrocer', 'bakery', 'butcher'] },
  gastro: { amenity: ['restaurant', 'cafe', 'fast_food'] },
  bank: { amenity: ['bank', 'atm'] },
  poczta: { amenity: ['post_office', 'parcel_locker'] },
  biblioteka: { amenity: ['library'] },
}

/** Data stanu ekstraktu Geofabrik z przekierowania „malopolskie-261002.osm.pbf" → „2026-10-02". */
async function stanOsm() {
  try {
    const r = await fetch(URL_PBF, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    })
    const m = /malopolskie-(\d{2})(\d{2})(\d{2})\.osm\.pbf/.exec(r.headers.get('location') ?? '')
    if (m) return `20${m[1]}-${m[2]}-${m[3]}`
  } catch {}
  return null
}

/**
 * Zwraca { stan, rodzaje: { sklep: [...], gastro: [...], ... } } z punktami: węzły oraz środki zamkniętych linii (budynki).
 * Czytamy surowy pbf przez ST_ReadOSM (DuckDB spatial), bo sterownik GDAL z DuckDB nie zwraca
 * zamkniętych linii jako wielokątów. Środek linii = średnia współrzędnych jej węzłów.
 */
export async function punktyOsm() {
  const cel = join(CACHE, `osm-codziennosc${SUFIKS_REGIONU}.json`)
  if (existsSync(cel)) return JSON.parse(readFileSync(cel, 'utf8'))
  const region = MIASTO_INFO ? await pbfRegionu() : null
  const stan = region ? region.stan : await stanOsm()
  const pbf = region ? region.plik : await pobierzDoCache(URL_PBF, 'malopolskie.osm.pbf')
  const c = await duckdb('spatial')
  const osm = `ST_ReadOSM('${sq(pbf)}')`
  const tag = (k) => `map_extract_value(tags, '${k}')`
  const typ = (kolumna, wartosci) =>
    `${tag(kolumna)} in (${wartosci.map((v) => `'${v}'`).join(',')})`
  const rodzaj = Object.entries(TYPY_OSM)
    .map(([nazwa, def]) => {
      const [kolumna, wartosci] = Object.entries(def)[0]
      return `when ${typ(kolumna, wartosci)} then '${nazwa}'`
    })
    .join(' ')
  // Jeden przebieg po pliku: otagowane węzły i linie z potrzebnymi tagami.
  await c.run(
    `create table otagowane as
     select kind, id, case ${rodzaj} end as rodzaj, ${tag('name')} as nazwa, refs, lat, lon
     from ${osm}
     where kind in ('node', 'way') and cardinality(tags) > 0
       and (${Object.values(TYPY_OSM)
         .map((def) => {
           const [kolumna, wartosci] = Object.entries(def)[0]
           return typ(kolumna, wartosci)
         })
         .join(' or ')})`,
  )
  // Drugi przebieg: współrzędne węzłów tylko dla linii, które nas interesują.
  await c.run(
    `create table potrzebne as select distinct unnest(refs) as id from otagowane where kind = 'way'`,
  )
  await c.run(
    `create table wezly as select n.id, n.lat, n.lon from ${osm} n semi join potrzebne p on p.id = n.id where n.kind = 'node'`,
  )
  const punkty = await wiersze(
    c,
    `select rodzaj, nazwa, lat, lon from otagowane where kind = 'node'
     union all
     select o.rodzaj, o.nazwa, avg(w.lat), avg(w.lon)
     from (select id, rodzaj, nazwa, unnest(refs) as ref from otagowane where kind = 'way') o
     join wezly w on w.id = o.ref group by o.id, o.rodzaj, o.nazwa`,
  )
  const rodzaje = Object.fromEntries(Object.keys(TYPY_OSM).map((k) => [k, []]))
  for (const p of punkty) {
    const pkt = { nazwa: p.nazwa ?? null, lat: Number(p.lat), lon: Number(p.lon) }
    if (wBbox(pkt)) rodzaje[p.rodzaj].push(pkt)
  }
  for (const [k, v] of Object.entries(rodzaje))
    console.log(`  OSM ${k}: ${v.length} punktów w obszarze`)
  const wynik = { stan, rodzaje }
  writeFileSync(cel, JSON.stringify(wynik))
  return wynik
}
