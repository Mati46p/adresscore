import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  grupujPunkty,
  indeksPunktow,
  najblizszyOdcinek,
  odlegloscDoOdcinka,
  srodekGrupy,
  sumaWPromieniu,
  zbudujIndeksOdcinkow,
} from './przestrzen.mjs'

// Deterministyczny generator, żeby test losowy był powtarzalny.
function losowy(ziarno) {
  let s = ziarno
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

test('odległość od odcinka: rzut, koniec, odcinek zerowej długości', () => {
  assert.equal(odlegloscDoOdcinka(5, 3, 0, 0, 10, 0), 3)
  assert.equal(odlegloscDoOdcinka(-4, 3, 0, 0, 10, 0), 5)
  assert.equal(odlegloscDoOdcinka(13, 4, 0, 0, 10, 0), 5)
  assert.equal(odlegloscDoOdcinka(5, 0, 0, 0, 10, 0), 0)
  assert.equal(odlegloscDoOdcinka(3, 4, 0, 0, 0, 0), 5)
})

test('najbliższy odcinek zgadza się z przeglądem wszystkich odcinków', () => {
  const los = losowy(42)
  const odcinki = []
  for (let i = 0; i < 400; i++) {
    const ax = los() * 5000
    const ay = los() * 5000
    // część odcinków długa (przecina wiele komórek), część krótka
    const dl = i % 5 === 0 ? 900 : 40
    const kat = los() * 2 * Math.PI
    odcinki.push([ax, ay, ax + dl * Math.cos(kat), ay + dl * Math.sin(kat)])
  }
  const indeks = zbudujIndeksOdcinkow(odcinki, 250)
  for (let k = 0; k < 300; k++) {
    // także punkty daleko poza obszarem odcinków – wymagają wielu pierścieni
    const px = los() * 14000 - 4000
    const py = los() * 14000 - 4000
    let wzorzec = Number.POSITIVE_INFINITY
    for (const [ax, ay, bx, by] of odcinki)
      wzorzec = Math.min(wzorzec, odlegloscDoOdcinka(px, py, ax, ay, bx, by))
    const wynik = najblizszyOdcinek(indeks, px, py)
    assert.ok(wynik, 'indeks niepusty zawsze coś zwraca')
    assert.ok(Math.abs(wynik.metry - wzorzec) < 1e-9, `punkt ${k}: ${wynik.metry} ≠ ${wzorzec}`)
  }
})

test('najbliższy odcinek: numer odcinka i pusty indeks', () => {
  const indeks = zbudujIndeksOdcinkow(
    [
      [0, 0, 100, 0],
      [0, 1000, 100, 1000],
    ],
    250,
  )
  assert.deepEqual(najblizszyOdcinek(indeks, 50, 30), { metry: 30, numer: 0 })
  assert.equal(najblizszyOdcinek(indeks, 50, 900)?.numer, 1)
  assert.equal(najblizszyOdcinek(zbudujIndeksOdcinkow([], 250), 1, 1), null)
})

test('suma w promieniu: brzeg włącznie, wagi i punkty bez wag', () => {
  const punkty = [
    [0, 0],
    [10, 0],
    [20, 0],
  ]
  const indeks = indeksPunktow(punkty)
  assert.equal(sumaWPromieniu(indeks, 0, 0, 10), 2)
  assert.equal(sumaWPromieniu(indeks, 0, 0, 9.99), 1)
  assert.equal(sumaWPromieniu(indeks, 10, 0, 10, [5, 1, 2]), 8)
  assert.equal(sumaWPromieniu(indeksPunktow([]), 0, 0, 1000), 0)
})

test('grupowanie łańcuchowe łączy punkty pośrednio, odległe zostawia osobno', () => {
  const punkty = [
    [0, 0],
    [15, 0],
    [30, 0],
    [500, 0],
    [505, 5],
  ]
  const grupy = grupujPunkty(punkty, 20).map((g) => g.sort((a, b) => a - b))
  assert.deepEqual(
    grupy.sort((a, b) => a[0] - b[0]),
    [
      [0, 1, 2],
      [3, 4],
    ],
  )
  assert.equal(grupujPunkty(punkty, 10).length, 4)
  assert.deepEqual(grupujPunkty([], 20), [])
  assert.deepEqual(srodekGrupy(punkty, [0, 1, 2]), [15, 0])
})
