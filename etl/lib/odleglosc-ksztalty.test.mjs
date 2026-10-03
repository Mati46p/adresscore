import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IndeksOdcinkow,
  IndeksWielokatow,
  kwadratOdleglosciDoOdcinka,
  odlegloscDoOdcinka,
  punktWPierscieniach,
} from './odleglosc-ksztalty.mjs'

/** Deterministyczny generator (mulberry32), żeby test losowy był powtarzalny. */
function generator(ziarno) {
  let s = ziarno >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('odległość do odcinka: rzut na odcinek, końce i odcinek zerowej długości', () => {
  assert.equal(odlegloscDoOdcinka(5, 3, 0, 0, 10, 0), 3)
  assert.equal(odlegloscDoOdcinka(13, 4, 0, 0, 10, 0), 5)
  assert.equal(odlegloscDoOdcinka(-3, 4, 0, 0, 10, 0), 5)
  assert.equal(odlegloscDoOdcinka(3, 4, 0, 0, 0, 0), 5)
  assert.equal(kwadratOdleglosciDoOdcinka(5, 0, 0, 0, 10, 0), 0)
})

test('indeks odcinków zwraca dokładnie tyle, co przegląd wszystkich odcinków', () => {
  const los = generator(2180)
  for (const komorka of [250, 1000, 7500]) {
    const indeks = new IndeksOdcinkow(komorka)
    const odcinki = []
    for (let i = 0; i < 400; i++) {
      const ax = los() * 20000
      const ay = los() * 20000
      // część odcinków długa (przecina wiele komórek), część krótka
      const dl = i % 4 === 0 ? 6000 : 300
      const bx = ax + (los() - 0.5) * dl
      const by = ay + (los() - 0.5) * dl
      odcinki.push([ax, ay, bx, by])
      indeks.dodajOdcinek(ax, ay, bx, by)
    }
    for (let n = 0; n < 300; n++) {
      // punkty także poza obszarem odcinków
      const px = los() * 30000 - 5000
      const py = los() * 30000 - 5000
      const wzorzec = Math.min(...odcinki.map((o) => odlegloscDoOdcinka(px, py, ...o)))
      const wynik = indeks.najblizszy(px, py)
      assert.ok(Math.abs(wynik - wzorzec) < 1e-6, `${komorka} m: ${wynik} zamiast ${wzorzec}`)
    }
  }
})

test('rzadkie punkty daleko od zapytania: wiele pierścieni, limit promienia i pusty indeks', () => {
  const indeks = new IndeksOdcinkow(500)
  indeks.dodajPunkt(30000, 0)
  indeks.dodajPunkt(0, 12000)
  assert.equal(indeks.najblizszy(0, 0), 12000)
  assert.equal(indeks.najblizszy(0, 0, 12000), 12000)
  assert.equal(indeks.najblizszy(0, 0, 11999), null)
  assert.ok(Math.abs(indeks.najblizszy(29000, 400) - Math.hypot(1000, 400)) < 1e-9)
  assert.equal(new IndeksOdcinkow(500).najblizszy(1, 1), null)
  assert.throws(() => new IndeksOdcinkow(0), /dodatni/)
})

test('łamana: wierzchołki i odcinki, w tym łamana z jednego punktu', () => {
  const indeks = new IndeksOdcinkow(100)
  indeks.dodajLamana([
    [0, 0],
    [100, 0],
    [100, 100],
  ])
  assert.equal(indeks.liczba, 2)
  assert.equal(indeks.najblizszy(50, 30), 30)
  assert.equal(indeks.najblizszy(130, 50), 30)
  const punkt = new IndeksOdcinkow(100)
  punkt.dodajLamana([[10, 10]])
  assert.equal(punkt.najblizszy(13, 14), 5)
})

test('punkt w wielokącie z otworem: otwór i zewnętrze to nie wnętrze', () => {
  const zewnetrzny = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ]
  const otwor = [
    [4, 4],
    [4, 6],
    [6, 6],
    [6, 4],
    [4, 4],
  ]
  assert.equal(punktWPierscieniach(1, 1, [zewnetrzny, otwor]), true)
  assert.equal(punktWPierscieniach(5, 5, [zewnetrzny, otwor]), false)
  assert.equal(punktWPierscieniach(11, 5, [zewnetrzny, otwor]), false)
  const indeks = new IndeksWielokatow(3)
  indeks.dodaj([zewnetrzny, otwor])
  indeks.dodaj([
    [
      [20, 20],
      [30, 20],
      [30, 30],
      [20, 30],
      [20, 20],
    ],
  ])
  assert.equal(indeks.liczba, 2)
  assert.equal(indeks.zawiera(1, 1), true)
  assert.equal(indeks.zawiera(5, 5), false)
  assert.equal(indeks.zawiera(25, 25), true)
  assert.equal(indeks.zawiera(15, 15), false)
  assert.equal(indeks.zawiera(-100, -100), false)
})
