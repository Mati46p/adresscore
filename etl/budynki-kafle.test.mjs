// Uruchom: node --test etl/budynki-kafle.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { kafluj } from './budynki-kafle.mjs'

const meta = {
  dokumentacja: 'https://www.geoportal.gov.pl/',
  licencja: 'GUGiK',
  rocznikModelu: 2024,
  rocznikiALS: { 2023: 2 },
  pobrano: '2026-10-03',
}
const kwadrat = (x, y) => [
  [
    [x, y],
    [x + 0.0001, y],
    [x + 0.0001, y + 0.0001],
    [x, y + 0.0001],
    [x, y],
  ],
]
const cecha = (id, x, y, h) => ({
  type: 'Feature',
  id,
  properties: { height_m: h },
  geometry: { type: 'Polygon', coordinates: kwadrat(x, y) },
})

test('każdy budynek trafia do dokładnie jednego kafla, bez zamykającego punktu', () => {
  const kafle = kafluj(
    {
      features: [
        cecha('a', 19.937, 50.0617, 12),
        cecha('b', 19.938, 50.0617, 8),
        cecha('daleko', 20.1, 50.0, 5),
      ],
    },
    meta,
  )
  const wszystkie = [...kafle.values()].flatMap((k) => k.budynki.id)
  assert.deepEqual(wszystkie.sort(), ['a', 'b', 'daleko'])
  const k = [...kafle.values()].find((x) => x.budynki.id.includes('a'))
  assert.equal(k.budynki.obrys[0].length, 8)
  assert.equal(k.wersja, 'lod1-2024')
  assert.equal(k.zrodla[0].dataDanych, '2024 (ALS 2023)')
})
