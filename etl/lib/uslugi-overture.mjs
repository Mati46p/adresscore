// Overture Maps Places dla warstwy usług (#104): najnowsze wydanie z S3 przez DuckDB (httpfs, spatial),
// bbox jak reszta ETL, filtr jakości po stronie lokalnej. Surowy ekstrakt całego BBOX (wszystkie
// kategorie, ok. 56 tys. miejsc) leży w etl/.cache jako parquet, więc zmiana mapowania w katalogu
// branż nie wymaga ponownego pobrania z S3 (pierwsze pobranie trwa ok. 2 minut).
// Schemat wydania 2026-09-23: kategoria to taxonomy.primary (dawne categories.primary już nie ma),
// operating_status jest wypełniony tylko dla ok. 2% miejsc, więc brak statusu = czynne.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { BBOX } from './codziennosc-zrodla.mjs'
import {
  kategorieOverture,
  klasyfikujOverture,
  OVERTURE_MIN_CONFIDENCE,
  zakonczeniaKategoriiOverture,
} from './uslugi-katalog.mjs'
import { CACHE } from './wspolne.mjs'

const STAC = 'https://stac.overturemaps.org/catalog.json'
/** Wydanie użyte, gdy STAC nie odpowiada (np. brak sieci przy pustym cache). */
const WYDANIE_ZAPASOWE = '2026-09-23.1'
const sq = (s) => s.replaceAll("'", "''")

/** Najnowsze wydanie Overture z katalogu STAC („latest"). Nadpisanie: OVERTURE_WYDANIE. */
export async function najnowszeWydanie() {
  if (process.env.OVERTURE_WYDANIE) return process.env.OVERTURE_WYDANIE
  try {
    const r = await fetch(STAC, { signal: AbortSignal.timeout(20_000) })
    if (r.ok) {
      const j = await r.json()
      if (/^\d{4}-\d{2}-\d{2}\.\d+$/.test(j.latest ?? '')) return j.latest
    }
  } catch {}
  return WYDANIE_ZAPASOWE
}

const plikEkstraktu = (wydanie) => {
  const skrot = createHash('sha1').update(JSON.stringify(BBOX)).digest('hex').slice(0, 8)
  return join(CACHE, `overture-places-${wydanie}-${skrot}.parquet`)
}

async function polacz(...rozszerzenia) {
  const db = await DuckDBInstance.create(':memory:')
  const c = await db.connect()
  for (const r of rozszerzenia) {
    await c.run(`INSTALL ${r}`)
    await c.run(`LOAD ${r}`)
  }
  return c
}

/** Pobiera z S3 wszystkie miejsca w BBOX do lokalnego parquet (raz na wydanie). */
async function pobierzEkstrakt(wydanie, cel) {
  mkdirSync(CACHE, { recursive: true })
  const c = await polacz('httpfs', 'spatial')
  await c.run("SET s3_region='us-west-2'")
  const zrodlo = `read_parquet('s3://overturemaps-us-west-2/release/${wydanie}/theme=places/type=place/*', filename=false, hive_partitioning=false)`
  await c.run(
    `copy (
       select id, names.primary as nazwa, brand.names.primary as marka, taxonomy.primary as kat,
              taxonomy.alternates as alt, confidence, operating_status as status,
              ST_Y(geometry) as lat, ST_X(geometry) as lon
       from ${zrodlo}
       where bbox.xmin >= ${BBOX.minLon} and bbox.xmax <= ${BBOX.maxLon}
         and bbox.ymin >= ${BBOX.minLat} and bbox.ymax <= ${BBOX.maxLat}
     ) to '${sq(cel)}' (format parquet)`,
  )
}

/**
 * Punkty Overture dla branż z katalogu: { wydanie, miejsca, pobrano, punkty }.
 * `miejsca` to liczba wszystkich miejsc w BBOX (kontekst), `punkty` – po filtrze jakości i kategorii.
 * Filtr: confidence >= 0,7 oraz status czynny (null albo „open"); nazwa: names.primary, a bez niej marka.
 */
export async function punktyOverture({ wydanie = null } = {}) {
  const w = wydanie ?? (await najnowszeWydanie())
  const plik = plikEkstraktu(w)
  if (!existsSync(plik)) await pobierzEkstrakt(w, plik)
  const c = await polacz('spatial')
  const kategorie = kategorieOverture()
  const lista = kategorie.map((k) => `'${sq(k)}'`).join(',')
  // Reguły z gwiazdką (`*_restaurant`) to kategorie o danym zakończeniu, więc wstępny filtr też je zna.
  const wKategoriach = [
    `kat in (${lista})`,
    ...zakonczeniaKategoriiOverture().map((z) => `ends_with(kat, '${sq(z)}')`),
  ].join(' or ')
  const zrodlo = `read_parquet('${sq(plik)}')`
  const wiersze = async (sql) => (await c.runAndReadAll(sql)).getRowObjectsJson()
  const [{ n }] = await wiersze(`select count(*) as n from ${zrodlo}`)
  const surowe = await wiersze(
    `select kat, coalesce(nazwa, marka) as nazwa, lat, lon, confidence
     from ${zrodlo}
     where (${wKategoriach}) and confidence >= ${OVERTURE_MIN_CONFIDENCE}
       and coalesce(status, 'open') = 'open'`,
  )
  const punkty = []
  for (const m of surowe)
    for (const { branza, flagi } of klasyfikujOverture({ kat: m.kat, nazwa: m.nazwa }))
      punkty.push({
        zrodlo: 'overture',
        branza,
        nazwa: m.nazwa ?? null,
        lat: Number(m.lat),
        lon: Number(m.lon),
        flagi,
      })
  return {
    wydanie: w,
    miejsca: Number(n),
    pobrano: statSync(plik).mtime.toISOString().slice(0, 10),
    punkty,
  }
}
