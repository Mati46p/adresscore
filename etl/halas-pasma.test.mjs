import assert from 'node:assert/strict'
import { test } from 'node:test'
import { najwyzszePasmo, pasmoLdwn } from './halas-pasma.mjs'

test('pasmo 5 dB ma jawną etykietę, a liczba jest reprezentantem dla silnika', () => {
  assert.deepEqual(pasmoLdwn(55, 60), {
    wartosc: 57.5,
    etykieta: '55–59,9 dB LDWN (pasmo mapy)',
  })
  assert.deepEqual(pasmoLdwn(55, 56), {
    wartosc: 55.5,
    etykieta: '55–55,9 dB LDWN (pasmo mapy)',
  })
  assert.deepEqual(pasmoLdwn(80, 999), {
    wartosc: 80,
    etykieta: '≥80 dB LDWN (pasmo mapy)',
  })
})

test('brak i nieprawidłowe pasmo nie są zamieniane na zero', () => {
  assert.equal(pasmoLdwn(null, null), null)
  assert.equal(pasmoLdwn(49, 50), null)
  assert.equal(pasmoLdwn(-24, 50), null)
  assert.equal(pasmoLdwn(55, 70), null)
  assert.equal(najwyzszePasmo([]), null)
})

test('na wspólnej granicy wybierane jest wyższe pasmo', () => {
  assert.deepEqual(
    najwyzszePasmo([
      { isov1: 55, isov2: 60 },
      { isov1: 60, isov2: 65 },
    ]),
    { wartosc: 62.5, etykieta: '60–64,9 dB LDWN (pasmo mapy)' },
  )
})
