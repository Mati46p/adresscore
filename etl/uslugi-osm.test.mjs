import assert from 'node:assert/strict'
import { test } from 'node:test'
import { punktyZOverpass, zapytanie } from './uslugi-osm.mjs'

test('zapytanie obejmuje wszystkie adresy oraz tagi usług', () => {
  const q = zapytanie([
    { lat: 50, lon: 19.8 },
    { lat: 50.2, lon: 20.1 },
  ])
  assert.match(q, /49\.900000,19\.640000,50\.300000,20\.260000/)
  assert.match(q, /supermarket\|convenience\|grocery/)
  assert.match(q, /school\|kindergarten\|pharmacy\|clinic\|doctors/)
  assert.match(q, /childcare/)
  assert.match(q, /parcel_locker/)
  assert.match(q, /hairdresser/)
  assert.match(q, /nursery/)
})

test('punkty OSM: punkt i obrys, deduplikacja przy dwóch tagach medycznych', () => {
  const x = punktyZOverpass({
    osm3s: { timestamp_osm_base: '2026-10-03T12:00:00Z' },
    elements: [
      { type: 'node', id: 1, lat: 50, lon: 20, tags: { shop: 'supermarket', name: 'Sklep' } },
      {
        type: 'way',
        id: 2,
        center: { lat: 50.1, lon: 19.9 },
        tags: { amenity: 'clinic', healthcare: 'clinic', name: 'Centrum' },
      },
      { type: 'node', id: 3, lat: 0, lon: 0, tags: { amenity: 'school' } },
      {
        type: 'node',
        id: 4,
        lat: 50,
        lon: 20.1,
        tags: { amenity: 'kindergarten', nursery: 'yes' },
      },
    ],
  })
  assert.deepEqual(
    x.get('sklep_odleglosc').map((p) => p.nazwa),
    ['Sklep'],
  )
  assert.equal(x.get('przychodnia_odleglosc').length, 1)
  assert.equal(x.get('przychodnia_odleglosc')[0].lon, 19.9)
  assert.equal(x.get('szkola_odleglosc').length, 0)
  assert.equal(x.get('zlobek_odleglosc').length, 1)
  assert.equal(x.get('przedszkole_odleglosc').length, 1)
})
