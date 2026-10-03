// GUGiK LoD1 2024 dla powiatu Kraków: BDOT10k obrys + ALS measuredHeight.
// Uruchom: node etl/budynki.mjs. Surowa paczka i pośredni NDJSON zostają w etl/.cache.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import proj4 from 'proj4'
import { CACHE, DANE, dzis, pobierzDoCache } from './lib/wspolne.mjs'

const POBRANIE_URL = 'https://opendata.geoportal.gov.pl/InneDane/Budynki3D/LOD1/2024/12/1261.zip'
const DOKUMENTACJA = 'https://www.geoportal.gov.pl/pl/dane/inne-dane/modele-3d-budynkow/'
const EPSG_2180 =
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs'
const OCZEKIWANE = 91257

function poleZeZnakiem(ring) {
  let suma = 0
  const [x0, y0] = ring[0]
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    suma += (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
  }
  return suma / 2
}

export function zCityGmlRow(row) {
  if (!/^[0-9A-Z-]{36}$/iu.test(row.id ?? '')) throw new Error('Brak buildingId BDOT10k')
  if (!Number.isFinite(row.height) || row.height <= 0 || row.height > 500) {
    throw new Error(`Niepoprawne measuredHeight: ${row.id}`)
  }
  if (!Array.isArray(row.footprint) || !row.footprint.length) {
    throw new Error(`Brak obrysu: ${row.id}`)
  }
  const coordinates = row.footprint.map((ring, i) => {
    if (ring.length < 4) throw new Error(`Niepoprawny wielokąt: ${row.id}`)
    const pole = Math.abs(poleZeZnakiem(ring))
    if (pole <= 0 || (i === 0 && pole < 0.01)) {
      throw new Error(`Niepoprawny wielokąt: ${row.id}`)
    }
    if (ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) {
      throw new Error(`Niepoprawne współrzędne: ${row.id}`)
    }
    const wynik = ring.map(([x, y]) => {
      const [lon, lat] = proj4(EPSG_2180, 'EPSG:4326', [x, y])
      if (lon < 19.6 || lon > 20.4 || lat < 49.8 || lat > 50.3) {
        throw new Error(`Budynek poza Krakowem: ${row.id}`)
      }
      return [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]
    })
    wynik[wynik.length - 1] = [...wynik[0]]
    // RFC 7946: obrys zewnętrzny przeciwnie do wskazówek zegara, otwory odwrotnie.
    if (poleZeZnakiem(wynik) > 0 !== (i === 0)) wynik.reverse()
    return wynik
  })
  return {
    type: 'Feature',
    id: row.id,
    properties: {
      height_m: row.height,
    },
    geometry: { type: 'Polygon', coordinates },
  }
}

export function zloz(rows) {
  const ids = new Set()
  const features = []
  const lataALS = {}
  let minHeight = Infinity
  let maxHeight = -Infinity
  for (const row of rows) {
    const feature = zCityGmlRow(row)
    if (ids.has(feature.id)) throw new Error(`Powtórzony buildingId: ${feature.id}`)
    ids.add(feature.id)
    features.push(feature)
    const rok = row.alsYear ?? 'brak'
    lataALS[rok] = (lataALS[rok] ?? 0) + 1
    minHeight = Math.min(minHeight, feature.properties.height_m)
    maxHeight = Math.max(maxHeight, feature.properties.height_m)
  }
  return { features, lataALS, minHeight, maxHeight }
}

async function main() {
  const zipPath = await pobierzDoCache(POBRANIE_URL, '1261-lod1-2024.zip')
  if (statSync(zipPath).size < 20_000_000) throw new Error('Niepełny ZIP LoD1')
  const ndjsonPath = join(CACHE, '1261-lod1-2024.ndjson')
  execFileSync(
    'python3',
    [new URL('./budynki-gml.py', import.meta.url).pathname, zipPath, ndjsonPath],
    {
      stdio: 'inherit',
    },
  )
  const rows = readFileSync(ndjsonPath, 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line))
  const { features, lataALS, minHeight, maxHeight } = zloz(rows)
  if (features.length !== OCZEKIWANE) {
    throw new Error(`GUGiK powiat 1261: ${features.length} budynków, oczekiwano ${OCZEKIWANE}`)
  }
  const zipSha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex')
  const geojson = { type: 'FeatureCollection', features }
  writeFileSync(join(DANE, 'budynki-3d.geojson'), JSON.stringify(geojson))
  const meta = {
    nazwa: 'Modele budynków GUGiK LoD1 2024, powiat Kraków (TERYT 1261)',
    url: POBRANIE_URL,
    dokumentacja: DOKUMENTACJA,
    licencja: 'Bez opłat, do dowolnego wykorzystania według dokumentacji GUGiK',
    rocznikModelu: 2024,
    rocznikiALS: lataALS,
    pobrano: dzis(),
    zipSha256,
    liczbaBudynkow: features.length,
    zakresWysokosciM: [minHeight, maxHeight],
    crs: 'EPSG:4326',
    jednostkaWysokosci: 'm',
    metoda:
      'Najniższy poziomy wielokąt z lod1Solid stanowi przyziemie budynku BDOT10k BUBD_A; height_m to przybliżona bldg:measuredHeight GUGiK z mediany punktów ALS względem NMT 1 m. To nie są obrysy EGiB.',
    dokladnoscWspolrzednych: '6 miejsc po przecinku (~0,1 m)',
  }
  writeFileSync(join(DANE, 'budynki-3d.meta.json'), JSON.stringify(meta, null, 2) + '\n')
  console.log(
    `Budynki: ${features.length}; ALS ${JSON.stringify(lataALS)}; wysokość ${minHeight}–${maxHeight} m`,
  )
  console.log(`GeoJSON: ${statSync(join(DANE, 'budynki-3d.geojson')).size} bajtów`)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
