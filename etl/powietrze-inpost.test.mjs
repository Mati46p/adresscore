import assert from 'node:assert/strict'
import { test } from 'node:test'
import KDBush from 'kdbush'
import { najblizszyCzujnik, punktyZCzujnikiem } from './powietrze-inpost.mjs'

const GRANICE = { lat: [49.9, 50.2], lon: [19.7, 20.3] }
const punkt = (name, air_index_level, lat, lon) => ({
  name,
  air_index_level,
  location: { latitude: lat, longitude: lon },
})

test('tylko punkty z czujnikiem w granicach; nieznany poziom pominięty i zgłoszony', () => {
  const { features, nieznane } = punktyZCzujnikiem(
    [
      punkt('KRA1', 'VERY_GOOD', 50.06, 19.94),
      punkt('KRA2', undefined, 50.06, 19.95),
      punkt('WAW1', 'BAD', 52.23, 21.01),
      punkt('KRA3', 'DZIWNY', 50.07, 19.94),
    ],
    GRANICE,
  )
  assert.deepEqual(
    features.map((f) => [f.id, f.properties.wartosc]),
    [['KRA1', 1]],
  )
  assert.deepEqual(nieznane, ['DZIWNY'])
})

test('najbliższy czujnik w promieniu, dalej null zamiast zera', () => {
  const { features } = punktyZCzujnikiem(
    [punkt('A', 'GOOD', 50.06, 19.94), punkt('B', 'VERY_BAD', 50.061, 19.94)],
    GRANICE,
  )
  const indeks = new KDBush(features.length)
  for (const f of features) indeks.add(...f.geometry.coordinates)
  indeks.finish()
  const blisko = najblizszyCzujnik({ lat: 50.0601, lon: 19.94 }, features, indeks)
  assert.equal(blisko.punkt.id, 'A')
  assert.ok(blisko.metry < 20)
  assert.equal(najblizszyCzujnik({ lat: 50.1, lon: 19.94 }, features, indeks), null)
})
