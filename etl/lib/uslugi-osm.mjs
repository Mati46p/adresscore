// OSM dla warstwy usług (#104): jeden przebieg po ekstrakcie Geofabrik (DuckDB spatial, ST_ReadOSM)
// zbiera obiekty z tagami z katalogu branż. Własne zapytanie, bo etl/lib/codziennosc-zrodla.mjs ma
// zamknięty zestaw typów (#8); wspólny jest tylko plik pbf w etl/.cache.
// Węzły i środki zamkniętych linii (budynki): środek = średnia współrzędnych węzłów linii.
// Relacje (multipolygony) pomijamy – sklepy i apteki są w OSM praktycznie zawsze węzłem albo linią.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { BBOX } from './codziennosc-zrodla.mjs'
import { MIASTO_INFO, pbfRegionu } from './miasto.mjs'
import { klasyfikujOsm, kluczeOsm, selektoryOsm } from './uslugi-katalog.mjs'
import { CACHE, pobierzDoCache } from './wspolne.mjs'

const URL_PBF = 'https://download.geofabrik.de/europe/poland/malopolskie-latest.osm.pbf'
const sq = (s) => s.replaceAll("'", "''")

/** Data stanu ekstraktu z przekierowania „malopolskie-261002.osm.pbf" → „2026-10-02"; null przy braku sieci. */
export async function stanGeofabrik() {
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
 * Ścieżka pbf w cache i data jego stanu. Stan zapisujemy obok pliku (`.stan`), bo plik w cache
 * bywa starszy niż „latest" z Geofabrik – data z przekierowania opisywałaby wtedy inny ekstrakt.
 */
export async function pbfZCache() {
  if (MIASTO_INFO) {
    const r = await pbfRegionu()
    return {
      plik: r.plik,
      stan: r.stan,
      pobrano: statSync(r.plik).mtime.toISOString().slice(0, 10),
    }
  }
  const plik = join(CACHE, 'malopolskie.osm.pbf')
  const znacznik = `${plik}.stan`
  if (!existsSync(plik)) {
    const stan = await stanGeofabrik()
    await pobierzDoCache(URL_PBF, 'malopolskie.osm.pbf')
    if (stan) writeFileSync(znacznik, stan)
  }
  const stan = existsSync(znacznik) ? readFileSync(znacznik, 'utf8').trim() : await stanGeofabrik()
  return { plik, stan, pobrano: statSync(plik).mtime.toISOString().slice(0, 10) }
}

/** Surowe obiekty OSM { tagi, lat, lon } z tagami z katalogu, w BBOX. Wynik z cache (klucz: stan + katalog). */
async function obiektyOsm({ plik, stan }) {
  const klucze = kluczeOsm()
  const selektory = [...selektoryOsm()].map(([k, v]) => [k, [...v].sort()])
  const skrot = createHash('sha1')
    .update(JSON.stringify({ klucze, selektory, BBOX }))
    .digest('hex')
    .slice(0, 8)
  const cel = join(CACHE, `osm-uslugi-branze-${stan ?? 'bez-daty'}-${skrot}.json`)
  if (existsSync(cel)) return JSON.parse(readFileSync(cel, 'utf8'))

  const db = await DuckDBInstance.create(':memory:')
  const c = await db.connect()
  await c.run('INSTALL spatial')
  await c.run('LOAD spatial')
  const wiersze = async (sql) => (await c.runAndReadAll(sql)).getRowObjectsJson()
  const osm = `ST_ReadOSM('${sq(plik)}')`
  const tag = (k) => `map_extract_value(tags, '${sq(k)}')`
  const kolumny = klucze.map((k, i) => `${tag(k)} as t${i}`).join(', ')
  const warunek = [...selektory]
    .map(([k, v]) => `${tag(k)} in (${v.map((x) => `'${sq(x)}'`).join(',')})`)
    .join(' or ')
  // Przebieg 1: otagowane węzły i linie. Węzły od razu przycinamy do BBOX.
  await c.run(
    `create table kandydaci as
     select kind, id, refs, lat, lon, ${kolumny}
     from ${osm}
     where kind in ('node', 'way') and cardinality(tags) > 0 and (${warunek})
       and (kind = 'way' or (lat between ${BBOX.minLat} and ${BBOX.maxLat}
                             and lon between ${BBOX.minLon} and ${BBOX.maxLon}))`,
  )
  // Przebieg 2: współrzędne węzłów tylko dla linii, które nas interesują.
  await c.run(
    `create table potrzebne as select distinct unnest(refs) as id from kandydaci where kind = 'way'`,
  )
  await c.run(
    `create table wezly as select n.id, n.lat, n.lon from ${osm} n semi join potrzebne p on p.id = n.id where n.kind = 'node'`,
  )
  const pola = klucze.map((_, i) => `t${i}`).join(', ')
  const surowe = await wiersze(
    `select ${pola}, lat, lon from kandydaci where kind = 'node'
     union all
     select ${klucze.map((_, i) => `any_value(o.t${i})`).join(', ')}, avg(w.lat), avg(w.lon)
     from (select id, ${pola}, unnest(refs) as ref from kandydaci where kind = 'way') o
     join wezly w on w.id = o.ref group by o.id`,
  )
  const obiekty = []
  for (const w of surowe) {
    const lat = Number(w.lat)
    const lon = Number(w.lon)
    if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) continue
    const tagi = {}
    klucze.forEach((k, i) => {
      if (w[`t${i}`] != null) tagi[k] = w[`t${i}`]
    })
    obiekty.push({ tagi, lat, lon })
  }
  writeFileSync(cel, JSON.stringify(obiekty))
  return obiekty
}

/**
 * Punkty OSM dla branż z katalogu: { stan, punkty: [{ zrodlo: 'osm', branza, nazwa, lat, lon, flagi }] }.
 * Obiekt może trafić do kilku branż (np. piekarnia z kawiarnią). Nazwa: `name`, a bez niej `brand`.
 */
export async function punktyOsmBranz() {
  const pbf = await pbfZCache()
  const obiekty = await obiektyOsm(pbf)
  const punkty = []
  for (const o of obiekty)
    for (const { branza, flagi } of klasyfikujOsm(o.tagi))
      punkty.push({
        zrodlo: 'osm',
        branza,
        nazwa: o.tagi.name ?? o.tagi.brand ?? null,
        lat: o.lat,
        lon: o.lon,
        flagi,
      })
  return { stan: pbf.stan, pobrano: pbf.pobrano, punkty }
}
