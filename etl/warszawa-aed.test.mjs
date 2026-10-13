import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DANE } from './lib/wspolne.mjs'
import { punktyAed } from './warszawa-aed.mjs'

const f = (dostep, coords = [[21, 52]]) => ({
  geometry: { type: 'Point', coordinates: coords },
  properties: { device_public_access: dostep },
})

test('AED: tylko publiczne, niepubliczne liczone osobno, współrzędne [[lon, lat]]', () => {
  const { publiczne, odrzucone } = punktyAed([
    f('Publiczny'),
    f(' publiczny '),
    f('Prywatny'),
    f(undefined),
    f('Publiczny', [[21.2, 52.3]]),
  ])
  assert.equal(publiczne.length, 3)
  assert.equal(odrzucone, 2)
  assert.deepEqual([publiczne[2].lon, publiczne[2].lat], [21.2, 52.3])
})

const plik = join(DANE, 'wskazniki', 'defibrylator_um_odleglosc.json')
test('wygenerowany plik: bezpieczeństwo, metry, id różny od warstwy OSM', {
  skip: !existsSync(plik),
}, () => {
  const w = JSON.parse(readFileSync(plik, 'utf8'))
  assert.equal(w.meta.kategoria, 'bezpieczenstwo')
  assert.equal(w.meta.jednostka, 'm')
  assert.notEqual(w.meta.id, 'defibrylator_odleglosc')
  assert.equal(w.meta.kierunek, 'mniej-lepiej')
  assert.ok(w.wartosci.every((v) => v === null || v >= 0))
})
