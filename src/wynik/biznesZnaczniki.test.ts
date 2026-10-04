import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nastepneWolne, ograniczDoGranic, postawionePunkty } from './biznesZnaczniki.ts'
import { czytajHash, GRANICE_PUNKTU, wGranicachPunktu } from './url.ts'

test('te same punkty dają tę samą tablicę (znaczniki na mapie nie są odtwarzane co render)', () => {
  const a = { lon: 19.94, lat: 50.06 }
  const b = { lon: 19.95, lat: 50.07 }
  const pierwsza = postawionePunkty([a, b])
  assert.equal(postawionePunkty([a, b]), pierwsza)
  assert.equal(postawionePunkty([a, b]), pierwsza)
  assert.deepEqual(pierwsza, [
    { id: 'a', lon: 19.94, lat: 50.06 },
    { id: 'b', lon: 19.95, lat: 50.07 },
  ])
})

test('przesunięcie punktu (nowy obiekt) daje nową tablicę, bez punktów – pustą stałą', () => {
  const a = { lon: 19.94, lat: 50.06 }
  const przed = postawionePunkty([a, null])
  const po = postawionePunkty([{ lon: 19.941, lat: 50.06 }, null])
  assert.notEqual(po, przed)
  assert.deepEqual(po, [{ id: 'a', lon: 19.941, lat: 50.06 }])
  assert.deepEqual(postawionePunkty([null, { lon: 19.9, lat: 50 }]), [
    { id: 'b', lon: 19.9, lat: 50 },
  ])
  const pusta = postawionePunkty([null, null])
  assert.equal(pusta.length, 0)
  assert.equal(postawionePunkty([null, null]), pusta)
})

test('znacznik wypchnięty poza obszar linku wraca do jego brzegu', () => {
  assert.deepEqual(ograniczDoGranic(19.94, 50.06), [19.94, 50.06])
  assert.deepEqual(ograniczDoGranic(22, 50.06), [GRANICE_PUNKTU.lonMax, 50.06])
  assert.deepEqual(ograniczDoGranic(18, 48), [GRANICE_PUNKTU.lonMin, GRANICE_PUNKTU.latMin])
  assert.deepEqual(ograniczDoGranic(19.94, 60), [19.94, GRANICE_PUNKTU.latMax])
  // Wynik zawsze mieści się w tym, co przyjmuje link, więc po odświeżeniu punkt nie znika.
  for (const [lon, lat] of [
    [0, 0],
    [180, 90],
    [19.3, 49.7],
    [20.8, 50.5],
  ] as const) {
    const [l, b] = ograniczDoGranic(lon, lat)
    assert.ok(wGranicachPunktu(l, b), `${l}, ${b}`)
  }
})

test('granice punktu: link i formularz mają jedną definicję', () => {
  assert.equal(wGranicachPunktu(19.94, 50.06), true)
  assert.equal(wGranicachPunktu(GRANICE_PUNKTU.lonMin, GRANICE_PUNKTU.latMin), true)
  assert.equal(wGranicachPunktu(GRANICE_PUNKTU.lonMax, GRANICE_PUNKTU.latMax), true)
  assert.equal(wGranicachPunktu(19.29, 50.06), false)
  assert.equal(wGranicachPunktu(19.94, 50.51), false)
  assert.equal(wGranicachPunktu(Number.NaN, 50), false)
  assert.equal(wGranicachPunktu(19.9, Number.POSITIVE_INFINITY), false)
  // Parser linku odrzuca dokładnie to, czego nie przyjmuje ta funkcja.
  assert.equal(czytajHash('#/biznes?a=19.29,50.06').miejsca?.[0], null)
  assert.deepEqual(czytajHash('#/biznes?a=19.3,50.06').miejsca?.[0], { lon: 19.3, lat: 50.06 })
})

test('pięć miejsc: znaczniki A–E i kolejne wolne miejsce z zawinięciem', () => {
  const p = (i: number) => ({ lon: 19.9 + i / 100, lat: 50.06 })
  const piec = [p(0), p(1), p(2), p(3), p(4)]
  assert.deepEqual(
    postawionePunkty(piec).map((x) => x.id),
    ['a', 'b', 'c', 'd', 'e'],
  )
  assert.equal(nastepneWolne(piec, 'c'), null)
  assert.equal(nastepneWolne([p(0), null, p(2), null, null], 'a'), 'b')
  assert.equal(nastepneWolne([p(0), null, p(2), p(3), p(4)], 'c'), 'b')
  assert.equal(nastepneWolne([null, p(1), p(2), p(3), p(4)], 'e'), 'a')
})
