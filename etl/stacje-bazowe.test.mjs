import assert from 'node:assert/strict'
import test from 'node:test'
import { dmsNaStopnie, klasterLokalizacji, ocenAdres, serialExcela } from './stacje-bazowe.mjs'

test('DMS UKE na stopnie', () => {
  assert.ok(Math.abs(dmsNaStopnie(`20E58'40"`) - (20 + 58 / 60 + 40 / 3600)) < 1e-9)
  assert.ok(Math.abs(dmsNaStopnie(`52N13'47.5"`) - (52 + 13 / 60 + 47.5 / 3600)) < 1e-9)
  assert.equal(dmsNaStopnie('abc'), null)
  assert.equal(dmsNaStopnie(`20E61'40"`), null)
})

test('serial Excela', () => {
  assert.equal(serialExcela('1900-03-01'), 61)
  assert.equal(serialExcela('2026-01-01'), 46023)
})

test('klaster łączy bliskie punkty, dalekie zostawia', () => {
  const l = klasterLokalizacji([
    { lat: 50.8, lon: 19.1 },
    { lat: 50.8001, lon: 19.1 },
    { lat: 50.81, lon: 19.1 },
  ])
  assert.equal(l.length, 2)
  assert.equal(l[0].n, 2)
})

test('ocena adresu: odległość i liczba w promieniu, zero to zero', () => {
  const l = [{ lat: 50.8, lon: 19.1 }]
  assert.equal(ocenAdres(50.8, 19.1, l).wPromieniu, 1)
  const daleko = ocenAdres(50.81, 19.1, l)
  assert.equal(daleko.wPromieniu, 0)
  assert.ok(daleko.odleglosc > 1000)
})
