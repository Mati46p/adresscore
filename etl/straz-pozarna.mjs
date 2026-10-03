// Najbliższa czynna jednostka straży pożarnej oznaczona amenity=fire_station w OSM.
// Źródło: ekstrakt Geofabrik Małopolska; odległość w linii prostej, nie czas dojazdu.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { indeksPunktow } from './lib/codziennosc-geo.mjs'
import { CACHE, dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const PBF_URL = 'https://download.geofabrik.de/europe/poland/malopolskie-latest.osm.pbf'
const MAX_M = 30_000

function ekstrakt() {
  mkdirSync(CACHE, { recursive: true })
  const pliki = readdirSync(CACHE)
    .filter((n) => /^malopolskie-\d{4}-\d{2}-\d{2}\.osm\.pbf$/.test(n))
    .sort()
  const nazwa = pliki.at(-1)
  return nazwa ? { plik: join(CACHE, nazwa), data: nazwa.slice(12, 22) } : null
}

export function punktyZObiektow(obiekty, wezly) {
  const poId = new Map(wezly.map((w) => [String(w.id), [Number(w.lat), Number(w.lon)]]))
  const punkty = []
  for (const o of obiekty) {
    let lat = Number(o.lat)
    let lon = Number(o.lon)
    if (o.kind === 'way') {
      const wsp = (o.refs ?? []).map((id) => poId.get(String(id))).filter(Boolean)
      if (!wsp.length) continue
      lat = wsp.reduce((s, p) => s + p[0], 0) / wsp.length
      lon = wsp.reduce((s, p) => s + p[1], 0) / wsp.length
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    punkty.push({ lat, lon, nazwa: o.nazwa?.trim() || 'Jednostka straży pożarnej' })
  }
  // Niekiedy ten sam obiekt ma jednocześnie węzeł i obrys; odrzuć bliskie duplikaty.
  return punkty.filter(
    (p, i) =>
      !punkty
        .slice(0, i)
        .some((q) => Math.abs(p.lat - q.lat) < 0.00025 && Math.abs(p.lon - q.lon) < 0.00035),
  )
}

async function wczytajPunkty(pbf, data) {
  const cache = join(CACHE, `straz-pozarna-${data}.json`)
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'))
  const db = await DuckDBInstance.create(':memory:')
  const c = await db.connect()
  try {
    await c.run('INSTALL spatial')
  } catch {}
  await c.run('LOAD spatial')
  const plik = pbf.replaceAll("'", "''")
  const osm = `ST_ReadOSM('${plik}')`
  await c.run(`create table straz as
    select kind, id, refs, lat, lon, map_extract_value(tags, 'name') as nazwa
    from ${osm}
    where kind in ('node', 'way') and map_extract_value(tags, 'amenity') = 'fire_station'`)
  const obiekty = (await c.runAndReadAll('select * from straz')).getRowObjectsJson()
  await c.run(
    "create table ids as select distinct unnest(refs) as id from straz where kind = 'way'",
  )
  const wezly = (
    await c.runAndReadAll(
      `select n.id, n.lat, n.lon from ${osm} n semi join ids i on n.id = i.id where n.kind = 'node'`,
    )
  ).getRowObjectsJson()
  c.closeSync()
  const punkty = punktyZObiektow(obiekty, wezly)
  if (punkty.length < 20) throw new Error(`Za mało jednostek straży pożarnej: ${punkty.length}`)
  writeFileSync(cache, JSON.stringify(punkty))
  return punkty
}

export async function main() {
  const { adresy } = wczytajAdresy()
  const lokalny = ekstrakt()
  const plik = lokalny?.plik ?? (await pobierzDoCache(PBF_URL, 'malopolskie.osm.pbf'))
  const data = lokalny?.data ?? dzis()
  const punkty = await wczytajPunkty(plik, data)
  const najblizszy = indeksPunktow(punkty)
  const wartosci = []
  const etykiety = []
  for (const a of adresy) {
    const p = najblizszy(a.lat, a.lon, MAX_M)
    wartosci.push(p ? Math.round(p.metry) : null)
    etykiety.push(p ? `${p.punkt.nazwa}, ${Math.round(p.metry)} m` : null)
  }
  zapiszWskaznik(
    {
      id: 'straz_pozarna_odleglosc',
      nazwa: 'Najbliższa jednostka straży pożarnej',
      opis: 'Odległość w linii prostej od adresu do najbliższej jednostki PSP lub OSP oznaczonej w OpenStreetMap jako amenity=fire_station. To lokalizacja placówki, nie prognoza czasu reakcji ani gwarancja obsady. Brak danych, gdy nie znaleziono jednostki w 30 km.',
      jednostka: 'm',
      kategoria: 'bezpieczenstwo',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 10000],
      zadanie: 171,
      zrodla: [
        {
          nazwa: 'OpenStreetMap, ekstrakt Geofabrik – małopolskie (amenity=fire_station)',
          url: 'https://download.geofabrik.de/europe/poland/malopolskie.html',
          licencja:
            'ODbL 1.0 – © współtwórcy OpenStreetMap: https://www.openstreetmap.org/copyright',
          dataDanych: data,
          pobrano: dzis(),
        },
      ],
    },
    wartosci,
    etykiety,
  )
  console.log(`Jednostki straży pożarnej: ${punkty.length}`)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
