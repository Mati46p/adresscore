// Odczyt dróg i innych linii (ways) z ekstraktu OSM województwa (PBF) przez DuckDB ST_ReadOSM, w ramce
// współrzędnych. Wspólne dla warstw trybu miasta (sieć piesza, woda): ekstrakt jest już w etl/.cache
// (pbfRegionu), więc nie potrzeba Overpass, który dla dużych miast ma limity czasu i rozmiaru.
// Ramka [lonMin, latMin, lonMax, latMax] w WGS84: bierzemy linie, które mają choć jeden węzeł w ramce;
// węzły poza ramką są odcinane (linia przy brzegu ramki jest skrócona).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { CACHE } from './wspolne.mjs'

const sq = (s) => String(s).replaceAll("'", "''")

/**
 * @param {string} pbf ścieżka ekstraktu
 * @param {object} opcje
 * @param {string[]} opcje.tagi klucze tagów zwracane w `tagi`
 * @param {(tag: (klucz: string) => string) => string} opcje.warunek fragment SQL (WHERE) dla ways
 * @param {number[]} opcje.ramka [lonMin, latMin, lonMax, latMax]
 * @param {string} [opcje.nazwaTmp] podkatalog tymczasowy DuckDB w etl/.cache
 * @param {(c: object, plik: string, tag: (klucz: string) => string) => Promise<unknown>} [opcje.przygotuj]
 *   wołane przed wyborem linii (np. tabela członków relacji, do której odwołuje się `warunek`); jego wynik wraca jako `dodatkowe`
 * @returns {Promise<{ linie: { id: number, tagi: Record<string, string|null>, wezly: number[], geometria: [number, number][] }[], wszystkich: number }>}
 */
export async function liniePbf(
  pbf,
  { tagi, warunek, ramka, nazwaTmp = 'duckdb_pbf_tmp', przygotuj = null },
) {
  const [lonMin, latMin, lonMax, latMax] = ramka
  const plik = `'${sq(pbf.replaceAll('\\', '/'))}'`
  const tag = (k) => `map_extract_value(tags, '${sq(k)}')`
  const katalog = join(CACHE, nazwaTmp)
  mkdirSync(katalog, { recursive: true })
  const instancja = await DuckDBInstance.create(':memory:', {
    temp_directory: katalog,
    memory_limit: '6GB',
  })
  const c = await instancja.connect()
  try {
    try {
      await c.run('INSTALL spatial')
    } catch {} // bez sieci zostaje rozszerzenie z poprzedniej instalacji
    await c.run('LOAD spatial')
    const dodatkowe = przygotuj ? await przygotuj(c, plik, tag) : null
    await c.run(`
      CREATE TABLE linie AS
      SELECT id, ${tagi.map((k, i) => `${tag(k)} AS t${i}`).join(', ')}, refs
      FROM ST_ReadOSM(${plik})
      WHERE kind = 'way' AND cardinality(tags) > 0 AND (${warunek(tag)})`)
    await c.run(`
      CREATE TABLE wezly_ramki AS
      SELECT id, lon, lat FROM ST_ReadOSM(${plik})
      WHERE kind = 'node' AND lon BETWEEN ${lonMin} AND ${lonMax} AND lat BETWEEN ${latMin} AND ${latMax}`)
    await c.run(`
      CREATE TABLE w_ramce AS
      SELECT DISTINCT l.id FROM (SELECT id, unnest(refs) AS r FROM linie) l
      JOIN wezly_ramki n ON n.id = l.r`)
    const [wszystkich] = (
      await c.runAndReadAll('SELECT count(*)::DOUBLE FROM linie')
    ).getColumnsJS()
    const [ids, lony, laty] = (
      await c.runAndReadAll(`
        SELECT id::DOUBLE, lon, lat FROM wezly_ramki
        WHERE id IN (SELECT unnest(refs) FROM linie WHERE id IN (SELECT id FROM w_ramce))`)
    ).getColumnsJS()
    const wezly = new Map()
    for (let i = 0; i < ids.length; i++) wezly.set(ids[i], [lony[i], laty[i]])
    const wiersze = (
      await c.runAndReadAll(`
        SELECT id::DOUBLE AS id, ${tagi.map((_, i) => `t${i}`).join(', ')},
               list_transform(refs, r -> r::DOUBLE) AS refs
        FROM linie WHERE id IN (SELECT id FROM w_ramce)`)
    ).getRowObjectsJS()
    const wynik = []
    for (const w of wiersze) {
      const nodes = []
      const geometria = []
      for (const ref of w.refs) {
        const p = wezly.get(ref)
        if (!p) continue
        nodes.push(ref)
        geometria.push(p)
      }
      if (geometria.length < 2) continue
      wynik.push({
        id: w.id,
        tagi: Object.fromEntries(tagi.map((k, i) => [k, w[`t${i}`] ?? null])),
        wezly: nodes,
        geometria,
      })
    }
    return { linie: wynik, wszystkich: wszystkich[0], dodatkowe }
  } finally {
    c.closeSync()
    instancja.closeSync()
  }
}
