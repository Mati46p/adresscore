import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { zipSync } from 'fflate'
import { zCityGmlRow, zloz } from './budynki.mjs'

const ID = '28BA1C4D-D835-8554-E053-CC2BA8C0F941'
const obrys = [
  [
    [584929, 246596],
    [584935, 246596],
    [584935, 246602],
    [584929, 246602],
    [584929, 246596],
  ],
]

test('CityGML → GeoJSON zachowuje wysokość, ID i domknięty obrys WGS84', () => {
  const f = zCityGmlRow({ id: ID, height: 12.5, alsYear: '2023', footprint: obrys })
  assert.equal(f.id, ID)
  assert.equal(f.properties.height_m, 12.5)
  assert.equal(f.geometry.coordinates[0].length, 5)
  assert.deepEqual(f.geometry.coordinates[0][0], f.geometry.coordinates[0][4])
  assert.ok(f.geometry.coordinates[0][0][0] > 19.6)
  assert.ok(f.geometry.coordinates[0][0][1] > 49.8)
})

test('odrzuca brak wysokości i duplikaty identyfikatorów', () => {
  const row = { id: ID, height: 12.5, alsYear: '2023', footprint: obrys }
  assert.throws(() => zCityGmlRow({ ...row, height: null }), /measuredHeight/u)
  assert.throws(() => zloz([row, row]), /Powtórzony buildingId/u)
})

test('parser bierze przyziemie z CityGML, a nie dach ani ścianę', () => {
  const xml = `<?xml version="1.0"?><CityModel xmlns="http://www.opengis.net/citygml/2.0" xmlns:bldg="http://www.opengis.net/citygml/building/2.0" xmlns:gen="http://www.opengis.net/citygml/generics/2.0" xmlns:gml="http://www.opengis.net/gml"><cityObjectMember><bldg:Building><gen:stringAttribute name="buildingId"><gen:value>${ID}</gen:value></gen:stringAttribute><gen:stringAttribute name="aktZrodla"><gen:value>2023</gen:value></gen:stringAttribute><bldg:measuredHeight>12.5</bldg:measuredHeight><bldg:lod1Solid><gml:Solid><gml:exterior><gml:CompositeSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>584929 246596 12.5 584935 246596 12.5 584935 246602 12.5 584929 246602 12.5 584929 246596 12.5</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>584929 246596 0 584935 246596 0 584935 246602 0 584929 246602 0 584929 246596 0</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod1Solid></bldg:Building></cityObjectMember></CityModel>`
  const dir = mkdtempSync(join(tmpdir(), 'adres-score-budynki-'))
  try {
    const zip = join(dir, 'test.zip')
    const out = join(dir, 'test.ndjson')
    writeFileSync(zip, zipSync({ 'test.gml': new TextEncoder().encode(xml) }))
    execFileSync('python3', [new URL('./budynki-gml.py', import.meta.url).pathname, zip, out])
    const [row] = readFileSync(out, 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(row.height, 12.5)
    assert.equal(row.id, ID)
    assert.equal(row.alsYear, '2023')
    assert.deepEqual(row.footprint, obrys)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
