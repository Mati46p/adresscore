import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { mediana, punktyZFeatures, wyciagnijWynik } from './lib/warszawa-api.mjs'
import { DANE } from './lib/wspolne.mjs'
import { dataStanu, punktyToalet } from './warszawa-toalety.mjs'

const f = (lon, lat, aktu = 'Kwiecień 2026') => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { typ: 'toaleta stacjonarna', aktu_dan: aktu },
})

test('klient: tablica to dane, {result:false} i error to wyjątek, result jest rozpakowany', () => {
  assert.deepEqual(wyciagnijWynik([1, 2], 'a'), [1, 2])
  assert.deepEqual(wyciagnijWynik({ result: [3] }, 'a'), [3])
  assert.throws(() => wyciagnijWynik({ result: false, error: 'Zły klucz' }, 'a'), /Zły klucz/)
  assert.throws(() => wyciagnijWynik({ error: { message: 'x' } }, 'a'), /x/)
  assert.throws(() => wyciagnijWynik(null, 'a'), /pusta/)
})

test('punkty z GeoJSON: Point [lon, lat] i zagnieżdżone [[lon, lat]], błędne odpadają', () => {
  const p = punktyZFeatures([
    f(21, 52),
    { geometry: { type: 'Point', coordinates: [[21.1, 52.1]] }, properties: {} },
    { geometry: null, properties: {} },
    { geometry: { type: 'Point', coordinates: [null, 52] }, properties: {} },
  ])
  assert.deepEqual(
    p.map((x) => [x.lon, x.lat]),
    [
      [21, 52],
      [21.1, 52.1],
    ],
  )
  assert.equal(punktyToalet([f(21, 52)]).length, 1)
})

test('mediana: parzysta, nieparzysta, null pomijane, pusta to null', () => {
  assert.equal(mediana([3, 1, 2]), 2)
  assert.equal(mediana([1, 2, 3, 4]), 2.5)
  assert.equal(mediana([null, 5, null]), 5)
  assert.equal(mediana([null]), null)
})

test('data stanu: ostatni dzień najpóźniejszego miesiąca z aktu_dan', () => {
  assert.equal(dataStanu([f(1, 1, 'Kwiecień 2026'), f(1, 1, 'Marzec 2026')]), '2026-04-30')
  assert.equal(dataStanu([f(1, 1, 'Luty 2024')]), '2024-02-29')
  assert.equal(dataStanu([f(1, 1, null)]), null)
})

const plik = join(DANE, 'wskazniki', 'toaleta_publiczna_odleglosc.json')
test('wygenerowany plik: kontrakt, skala opisana, brak ujemnych', {
  skip: !existsSync(plik),
}, () => {
  const w = JSON.parse(readFileSync(plik, 'utf8'))
  assert.equal(w.meta.kierunek, 'mniej-lepiej')
  assert.equal(w.meta.rozdzielczosc, 'adres')
  assert.match(w.meta.opis, /mniej metrów = lepiej/)
  assert.ok(w.wartosci.every((v) => v === null || (Number.isFinite(v) && v >= 0)))
  assert.ok(w.wartosci.some((v) => v !== null))
})
