import assert from 'node:assert/strict'
import test from 'node:test'
import {
  do2180,
  IndeksPunktow,
  IndeksWielokatow,
  LicznikWielokatow,
  odlegloscDoOdcinka,
  odlegloscDoWielokata,
  odlegloscM,
  pierscien,
  punktWWielokacie,
  wielokat,
  wielokatyZGeojson,
} from './geo.mjs'

/** Generator pseudolosowy (mulberry32) – testy mają być powtarzalne. */
function losowy(ziarno) {
  let a = ziarno
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const prostokat = (x0, y0, x1, y1) =>
  pierscien([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ])

test('do2180: odległość w układzie metrycznym zgadza się z geodezyjną (Rynek – Wawel)', () => {
  const [ax, ay] = do2180(19.9372, 50.0614)
  const [bx, by] = do2180(19.9354, 50.054)
  const RAD = Math.PI / 180
  const dLat = (50.054 - 50.0614) * RAD
  const dLon = (19.9354 - 19.9372) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(50.0614 * RAD) * Math.cos(50.054 * RAD) * Math.sin(dLon / 2) ** 2
  const geodezyjna = 2 * 6_371_000 * Math.asin(Math.sqrt(h))
  assert.ok(Math.abs(odlegloscM(ax, ay, bx, by) - geodezyjna) / geodezyjna < 0.003)
  // Kraków leży ok. 570 km na wschód od południka osi i ok. 240 km od równika układu (y_0 = −5 300 000)
  assert.ok(ax > 560_000 && ax < 580_000 && ay > 235_000 && ay < 250_000)
})

test('odległość do odcinka: rzut na odcinek i na jego końce', () => {
  assert.equal(odlegloscDoOdcinka(5, 3, 0, 0, 10, 0), 3)
  assert.equal(odlegloscDoOdcinka(-3, 4, 0, 0, 10, 0), 5)
  assert.equal(odlegloscDoOdcinka(13, 4, 0, 0, 10, 0), 5)
  assert.equal(odlegloscDoOdcinka(2, 2, 1, 1, 1, 1), Math.SQRT2)
})

test('wielokąt z otworem: środek otworu jest poza, odległość liczy się do brzegu otworu', () => {
  const w = wielokat([prostokat(0, 0, 100, 100), prostokat(40, 40, 60, 60)])
  assert.equal(punktWWielokacie(10, 10, w), true)
  assert.equal(punktWWielokacie(50, 50, w), false)
  assert.equal(odlegloscDoWielokata(10, 10, w), 0)
  assert.equal(odlegloscDoWielokata(50, 45, w), 5)
  assert.equal(odlegloscDoWielokata(130, 50, w), 30)
  assert.equal(odlegloscDoWielokata(-3, -4, w), 5)
})

test('pierścień niedomknięty jest domykany, za krótki to błąd', () => {
  const p = pierscien([
    [0, 0],
    [4, 0],
    [4, 3],
  ])
  assert.equal(p.length, 8)
  assert.deepEqual([...p.slice(0, 2)], [...p.slice(6, 8)])
  assert.throws(
    () =>
      pierscien([
        [0, 0],
        [1, 1],
      ]),
    /co najmniej 3/,
  )
})

test('wielokatyZGeojson: MultiPolygon rzutowany do EPSG:2180, inna geometria to błąd', () => {
  const ws = wielokatyZGeojson(
    {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [19.9, 50.0],
            [19.91, 50.0],
            [19.91, 50.01],
            [19.9, 50.01],
            [19.9, 50.0],
          ],
        ],
        [
          [
            [20.0, 50.0],
            [20.01, 50.0],
            [20.01, 50.01],
            [20.0, 50.01],
            [20.0, 50.0],
          ],
        ],
      ],
    },
    { nazwa: 'x' },
  )
  assert.equal(ws.length, 2)
  assert.equal(ws[0].dane.nazwa, 'x')
  const [x, y] = do2180(19.905, 50.005)
  assert.equal(punktWWielokacie(x, y, ws[0]), true)
  assert.equal(punktWWielokacie(x, y, ws[1]), false)
  assert.throws(() => wielokatyZGeojson({ type: 'Point', coordinates: [0, 0] }), /Polygon/)
})

test('IndeksWielokatow zgadza się z przeglądem siłowym na losowych wielokątach', () => {
  const los = losowy(7)
  const wielokaty = []
  for (let k = 0; k < 40; k++) {
    const cx = los() * 20_000
    const cy = los() * 20_000
    const n = 4 + Math.floor(los() * 10)
    const r = 100 + los() * 1_500
    const punkty = []
    for (let i = 0; i < n; i++) {
      const kat = (2 * Math.PI * i) / n
      const rr = r * (0.5 + 0.5 * los())
      punkty.push([cx + rr * Math.cos(kat), cy + rr * Math.sin(kat)])
    }
    wielokaty.push(wielokat([pierscien(punkty)], { numer: k }))
  }
  const indeks = new IndeksWielokatow(wielokaty, 700)
  for (let t = 0; t < 400; t++) {
    const x = -3_000 + los() * 26_000
    const y = -3_000 + los() * 26_000
    const silowo = wielokaty.map((w, idx) => [odlegloscDoWielokata(x, y, w), idx])
    silowo.sort((a, b) => a[0] - b[0])
    const wynik = indeks.najblizszy(x, y, 50_000)
    assert.ok(wynik, `punkt ${t}: brak wyniku`)
    assert.ok(
      Math.abs(wynik.odleglosc - silowo[0][0]) < 1e-6,
      `punkt ${t}: ${wynik.odleglosc} vs ${silowo[0][0]}`,
    )
  }
})

test('IndeksWielokatow: limit zasięgu i pierwszeństwo przy nakładających się obszarach', () => {
  const duzy = wielokat([prostokat(0, 0, 1000, 1000)], { nazwa: 'park', priorytet: 3 })
  const maly = wielokat([prostokat(400, 400, 600, 600)], { nazwa: 'rezerwat', priorytet: 2 })
  const daleki = wielokat([prostokat(5000, 0, 5100, 100)], { nazwa: 'daleki', priorytet: 1 })
  const indeks = new IndeksWielokatow([duzy, maly, daleki], 500)
  // w obu obszarach naraz wygrywa ostrzejsza ochrona (mniejszy priorytet)
  assert.equal(indeks.najblizszy(500, 500, 10_000).wielokat, 1)
  assert.equal(indeks.najblizszy(500, 500, 10_000).odleglosc, 0)
  // poza obszarami: odległość do najbliższej granicy i limit zasięgu
  assert.equal(indeks.najblizszy(1300, 500, 10_000).odleglosc, 300)
  assert.equal(indeks.najblizszy(1300, 500, 10_000).wielokat, 0)
  assert.equal(indeks.najblizszy(2500, 50, 1_000), null)
  assert.equal(indeks.najblizszy(2500, 50, 10_000).wielokat, 0)
})

test('LicznikWielokatow zlicza obrysy w promieniu, także wielkie, jak przegląd siłowy', () => {
  const los = losowy(11)
  const obrysy = []
  for (let k = 0; k < 300; k++) {
    const x = los() * 5_000
    const y = los() * 5_000
    const a = 5 + los() * 40
    obrysy.push(wielokat([prostokat(x, y, x + a, y + a * (0.5 + los()))]))
  }
  obrysy.push(wielokat([prostokat(1000, 1000, 2200, 1500)])) // hala większa niż próg „dużych”
  const licznik = new LicznikWielokatow(obrysy)
  for (let t = 0; t < 300; t++) {
    const x = los() * 5_000
    const y = los() * 5_000
    const silowo = obrysy.filter((w) => odlegloscDoWielokata(x, y, w) <= 100).length
    assert.equal(licznik.policz(x, y, 100), silowo, `punkt ${t}`)
  }
  // adres wewnątrz budynku liczy ten budynek (odległość 0)
  assert.equal(new LicznikWielokatow([wielokat([prostokat(0, 0, 10, 10)])]).policz(5, 5, 100), 1)
  assert.equal(new LicznikWielokatow([]).policz(5, 5, 100), 0)
})

test('IndeksPunktow: najbliższy punkt jak przegląd siłowy, null poza limitem', () => {
  const los = losowy(3)
  const punkty = Array.from({ length: 200 }, (_, i) => ({
    id: i,
    x: los() * 30_000,
    y: los() * 30_000,
  }))
  const indeks = new IndeksPunktow(punkty)
  for (let t = 0; t < 200; t++) {
    const x = los() * 30_000
    const y = los() * 30_000
    const silowo = Math.min(...punkty.map((p) => odlegloscM(x, y, p.x, p.y)))
    const w = indeks.najblizszy(x, y, 100_000)
    assert.ok(Math.abs(w.odleglosc - silowo) < 1e-6)
  }
  assert.equal(new IndeksPunktow([{ id: 1, x: 0, y: 0 }]).najblizszy(10_000, 0, 5_000), null)
  assert.equal(new IndeksPunktow([]).najblizszy(0, 0, 5_000), null)
  assert.equal(new IndeksPunktow([{ id: 1, x: 0, y: 0 }]).najblizszy(3, 4, 5_000).odleglosc, 5)
})
