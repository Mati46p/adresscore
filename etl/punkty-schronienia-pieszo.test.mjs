import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DOJSCIE_MAX,
  dijkstra,
  dowiaz,
  indeksWezlow,
  trasa,
  zbudujGraf,
} from './punkty-schronienia-pieszo.mjs'

// Rzeka wzdłuż y = 0: brzeg południowy y = -50, północny y = 50, jedyny most przy x = 1000.
function siecZRzeka() {
  return zbudujGraf([
    {
      wezly: ['s0', 's1'],
      punkty: [
        [0, -50],
        [1000, -50],
      ],
    },
    {
      wezly: ['n0', 'n1'],
      punkty: [
        [0, 50],
        [1000, 50],
      ],
    },
    {
      wezly: ['s1', 'n1'],
      punkty: [
        [1000, -50],
        [1000, 50],
      ],
    }, // most
  ])
}

test('rzeka wydłuża dojście do mostu – czas pieszy nie jest odległością prostą', () => {
  const g = siecZRzeka()
  const indeks = indeksWezlow(g)
  const zrodlo = dowiaz(g, indeks, 0, -60) // punkt na południowym brzegu
  const wynik = dijkstra(g, [{ ...zrodlo, nr: 0 }])
  const t = trasa(g, indeks, wynik, 0, 60) // adres naprzeciwko, po drugiej stronie rzeki
  assert.ok(t)
  // Prosto: 120 m. Trasą: 10 + 1000 + 100 + 1000 + 10 = 2120 m.
  assert.ok(Math.abs(t.metry - 2120) < 1e-6)
  assert.ok(Math.abs(t.minuty - 2120 / 75) < 1e-6)
  assert.ok(t.minuty > (120 / 75) * 10)
})

test('wielozródłowy Dijkstra wybiera najbliższy po sieci, nie w linii prostej', () => {
  const g = siecZRzeka()
  const indeks = indeksWezlow(g)
  const blisko = dowiaz(g, indeks, 0, -55) // 110 m prosto, ale za rzeką
  const daleko = dowiaz(g, indeks, 400, 55) // 400 m prosto, ten sam brzeg
  const wynik = dijkstra(g, [
    { ...blisko, nr: 0 },
    { ...daleko, nr: 1 },
  ])
  const t = trasa(g, indeks, wynik, 0, 55)
  assert.equal(t.zrodlo, 1)
  assert.ok(Math.abs(t.metry - 410) < 1e-6)
})

test('brak sieci w zasięgu albo brak połączenia = null, nigdy 0', () => {
  const g = zbudujGraf([
    {
      wezly: ['a', 'b'],
      punkty: [
        [0, 0],
        [500, 0],
      ],
    },
    {
      wezly: ['c', 'd'],
      punkty: [
        [0, 5000],
        [10, 5000],
      ],
    }, // mała odcięta składowa
  ])
  const indeks = indeksWezlow(g)
  const wynik = dijkstra(g, [{ ...dowiaz(g, indeks, 0, 0), nr: 0 }])
  assert.equal(trasa(g, indeks, wynik, 0, DOJSCIE_MAX + 100), null)
  assert.equal(trasa(g, indeks, wynik, 5, 5000), null) // odcięta składowa nie jest dowiązywana
  assert.equal(trasa(g, indeks, wynik, 0, 0).metry, 0)
})
