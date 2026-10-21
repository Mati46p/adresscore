import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IndeksWielokatow } from './lib/geo.mjs'
import { IndeksOdcinkow } from './lib/odcinki.mjs'
import { odlegloscDoWody, zbudujWode, zlozLamane } from './woda-osm.mjs'

// Linia PBF w stopniach WGS84 (tag natural/waterway), wezly = id węzłów OSM.
const linia = (id, tagi, wezly, geometria) => ({
  id,
  tagi: { natural: null, water: null, waterway: null, tunnel: null, covered: null, ...tagi },
  wezly,
  geometria,
})

test('segmenty o wspólnych końcach składają się w zamknięty pierścień, także odwrócone', () => {
  const wynik = zlozLamane([
    {
      wezly: [1, 2, 3],
      punkty: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    },
    {
      wezly: [1, 4, 3],
      punkty: [
        [0, 0],
        [0, 10],
        [10, 10],
      ],
    },
  ])
  assert.equal(wynik.zamkniete.length, 1)
  assert.equal(wynik.otwarte.length, 0)
  const p = wynik.zamkniete[0]
  assert.deepEqual(p[0], p.at(-1))
  assert.equal(p.length, 5)
})

test('niepełny obrys zostaje łamaną otwartą, a nie fałszywym pierścieniem', () => {
  const wynik = zlozLamane([
    {
      wezly: [1, 2, 3],
      punkty: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    },
  ])
  assert.equal(wynik.zamkniete.length, 0)
  assert.equal(wynik.otwarte.length, 1)
})

test('staw (zamknięty way) to wielokąt, rzeka (open way) to łamana, relacja daje wielokąt z otworem', () => {
  // Współrzędne w okolicach Łodzi (19.45, 51.77); 0,001° ≈ 70–110 m.
  const o = (lon, lat) => [19.45 + lon, 51.77 + lat]
  const linie = [
    linia(
      1,
      { natural: 'water' },
      [1, 2, 3, 4, 1],
      [o(0, 0), o(0.001, 0), o(0.001, 0.001), o(0, 0.001), o(0, 0)],
    ),
    linia(2, { waterway: 'stream' }, [5, 6], [o(0.01, 0), o(0.01, 0.01)]),
    linia(
      10,
      {},
      [11, 12, 13, 14, 11],
      [o(0.02, 0), o(0.03, 0), o(0.03, 0.01), o(0.02, 0.01), o(0.02, 0)],
    ),
    linia(
      11,
      {},
      [21, 22, 23, 24, 21],
      [o(0.024, 0.004), o(0.026, 0.004), o(0.026, 0.006), o(0.024, 0.006), o(0.024, 0.004)],
    ),
  ]
  const w = zbudujWode(linie, [
    { rid: 100, wid: 10, rola: 'outer' },
    { rid: 100, wid: 11, rola: 'inner' },
  ])
  assert.equal(w.wielokaty.length, 2)
  assert.equal(w.wielokaty[0].pierscienie.length, 2, 'wyspa jako otwór')
  assert.equal(w.lamane.length, 1)
  assert.equal(w.statystyki.cieki, 1)
})

test('odległość: 0 w zbiorniku, najmniejsza z wielokąta i cieku, null poza zasięgiem', () => {
  const kwadrat = Float64Array.from([0, 0, 100, 0, 100, 100, 0, 100, 0, 0])
  const iw = new IndeksWielokatow(
    [{ pierscienie: [kwadrat], bbox: [0, 0, 100, 100], dane: null }],
    100,
  )
  const il = new IndeksOdcinkow(50)
  il.dodajLinie([
    [300, 0],
    [300, 100],
  ])
  assert.equal(odlegloscDoWody(50, 50, iw, il), 0)
  assert.equal(odlegloscDoWody(130, 50, iw, il), 30)
  assert.equal(odlegloscDoWody(260, 50, iw, il), 40)
  assert.equal(odlegloscDoWody(50_000, 50, iw, il, 1000), null)
  assert.equal(odlegloscDoWody(50, 50, null, il, 1000), 250)
})
