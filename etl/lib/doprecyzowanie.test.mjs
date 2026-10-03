import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cecha, doprecyzuj } from './doprecyzowanie.mjs'

test('średnia oczka zostaje wartością GIOŚ, głośny adres wyżej, zielony niżej', () => {
  const cechy = [cecha(75, 5, true), cecha(null, 90, true), cecha(60, 40, true)]
  const wynik = doprecyzuj([20, 20, 20], ['A', 'A', 'A'], cechy, 0.1)
  const srednia = wynik.reduce((s, v) => s + v, 0) / wynik.length
  assert.ok(Math.abs(srednia - 20) < 0.1)
  assert.ok(wynik[0] > 20 && wynik[1] < 20)
  for (const v of wynik) assert.ok(v >= 20 * 0.9 - 0.05 && v <= 20 * 1.1 + 0.05)
})

test('poza Krakowem i bez danych wartość oczka bez zmian, null zostaje null', () => {
  const cechy = [cecha(70, 10, false), cecha(70, null, true), null]
  assert.deepEqual(doprecyzuj([15, 15, null], ['A', 'A', 'A'], cechy, 0.1), [15, 15, null])
})
