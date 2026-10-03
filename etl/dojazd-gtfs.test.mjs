import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aktywneUslugi, czasAdresu, indeksPunktow, profilDoCelu } from './dojazd-gtfs.mjs'

const p = (i, lat, lon) => ({ i, lat, lon, nazwa: `P${i}` })
const punkty = [p(0, 50.0, 19.0), p(1, 50.02, 19.0), p(2, 50.04, 19.0), p(3, 50.06, 19.0)]
const zdarzenie = (trip, stop, dep, arr, sequence, pickup = true, dropoff = true) => ({
  trip,
  stop,
  dep,
  arr,
  sequence,
  pickup,
  dropoff,
})

test('rozkład: czekanie, przejazd i przesiadka dają najwcześniejszy przyjazd', () => {
  const z = [
    zdarzenie('A', 0, 425, 425, 1),
    zdarzenie('A', 1, 430, 430, 2),
    zdarzenie('B', 1, 433, 433, 1),
    zdarzenie('B', 3, 445, 445, 2),
    zdarzenie('C', 0, 440, 440, 1),
    zdarzenie('C', 3, 460, 460, 2),
  ]
  const model = profilDoCelu(punkty, z, new Map([[3, 0]]), { start: 420, koniec: 480 })
  assert.equal(czasAdresu(punkty[0], punkty, model), 25)
  assert.equal(czasAdresu(punkty[3], punkty, model), 0)
})

test('nie wpuszcza pasażera na przystanku bez wsiadania ani nie wysadza bez wysiadania', () => {
  const z = [zdarzenie('A', 0, 425, 425, 1, false), zdarzenie('A', 3, 445, 445, 2)]
  assert.equal(
    czasAdresu(
      punkty[0],
      punkty,
      profilDoCelu(punkty, z, new Map([[3, 0]]), { start: 420, koniec: 480 }),
    ),
    null,
  )
  const z2 = [zdarzenie('A', 0, 425, 425, 1), zdarzenie('A', 3, 445, 445, 2, true, false)]
  assert.equal(
    czasAdresu(
      punkty[0],
      punkty,
      profilDoCelu(punkty, z2, new Map([[3, 0]]), { start: 420, koniec: 480 }),
    ),
    null,
  )
})

test('przesiadka na innym stanowisku uwzględnia dojście i bufor', () => {
  const blisko = [p(0, 50, 19), p(1, 50.02, 19), p(2, 50.0205, 19), p(3, 50.06, 19)]
  const z = [
    zdarzenie('A', 0, 425, 425, 1),
    zdarzenie('A', 1, 430, 430, 2),
    zdarzenie('B', 2, 432, 432, 1),
    zdarzenie('B', 3, 445, 445, 2),
    zdarzenie('C', 2, 435, 435, 1),
    zdarzenie('C', 3, 449, 449, 2),
  ]
  const model = profilDoCelu(blisko, z, new Map([[3, 0]]), { start: 420, koniec: 480 })
  // 55 m + 2 min na zmianę stanowiska: 07:32 jest za wcześnie.
  assert.equal(czasAdresu(blisko[0], blisko, model), 29)
})

test('wyjątek calendar_dates usuwa usługę w wybranym dniu', () => {
  const enc = (s) => new TextEncoder().encode(s)
  const pliki = {
    'calendar.txt': enc(
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nA,1,1,1,1,1,0,0,20261001,20261031\n',
    ),
    'calendar_dates.txt': enc('service_id,date,exception_type\nA,20261007,2\nB,20261007,1\n'),
  }
  assert.deepEqual([...aktywneUslugi(pliki, '2026-10-07')], ['B'])
})

test('indeks przestrzenny zachowuje kolejność stanowisk', () => {
  const indeks = indeksPunktow(punkty)
  assert.equal(indeks.range(18.999, 49.999, 19.001, 50.001)[0], 0)
})
