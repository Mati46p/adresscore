// Inwarianty łączenia budynków z adresami. Uruchom: node --test src/miasto3d/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Budynek } from './kontrakt.ts'
import {
  budynekAdresu,
  budynkiOkolicy,
  kolorBudynku,
  odlegloscM,
  odmiana,
  punktWObrysie,
  SZARY_BUDYNKU,
  wysokoscBryly,
} from './laczenie.ts'

// Rynek Główny: kwadrat ok. 70 × 70 m.
const LON = 19.937
const LAT = 50.0617
const D = 0.0005

function kwadrat(lon: number, lat: number, d = D): [number, number][] {
  return [
    [lon - d, lat - d],
    [lon + d, lat - d],
    [lon + d, lat + d],
    [lon - d, lat + d],
  ]
}

function budynek(id: string, lon: number, lat: number, wysokosc: number | null = 12): Budynek {
  return {
    id,
    wysokosc,
    zrodloWysokosci: wysokosc === null ? null : 'lod1',
    obrys: kwadrat(lon, lat),
  }
}

describe('geometria', () => {
  it('punkt w obrysie i poza nim', () => {
    assert.equal(punktWObrysie(LON, LAT, kwadrat(LON, LAT)), true)
    assert.equal(punktWObrysie(LON + 2 * D, LAT, kwadrat(LON, LAT)), false)
  })

  it('odległość 0,01° szerokości ≈ 1113 m', () => {
    assert.ok(Math.abs(odlegloscM(LON, LAT, LON, LAT + 0.01) - 1113) < 2)
  })
})

describe('budynkiOkolicy', () => {
  const budynki = [
    budynek('a', LON, LAT),
    budynek('b', LON + 0.002, LAT),
    budynek('pusty', LON, LAT + 0.002),
    budynek('daleko', LON + 0.02, LAT),
  ]
  const adresy = [
    { i: 0, lon: LON, lat: LAT },
    { i: 1, lon: LON + 0.0001, lat: LAT },
    { i: 2, lon: LON + 0.002, lat: LAT },
    { i: 3, lon: LON + 0.02, lat: LAT },
  ]
  const wyniki = new Float32Array([90, 70, Number.NaN, 50])
  const wynik = budynkiOkolicy(budynki, adresy, wyniki, LON, LAT)

  it('pomija budynki poza promieniem 500 m', () => {
    assert.deepEqual(
      wynik.map((b) => b.id),
      ['a', 'b', 'pusty'],
    )
  })

  it('kilka adresów w budynku = średnia ich wyników', () => {
    const a = wynik.find((b) => b.id === 'a')
    assert.deepEqual(a?.adresy, [0, 1])
    assert.equal(a?.wynik, 80)
    assert.equal(a?.litera, 'B')
  })

  it('adres bez danych i budynek bez adresu dają null, nigdy zero', () => {
    assert.equal(wynik.find((b) => b.id === 'b')?.wynik, null)
    assert.equal(wynik.find((b) => b.id === 'pusty')?.wynik, null)
    assert.equal(wynik.find((b) => b.id === 'pusty')?.litera, null)
  })

  it('budynek adresu: zawierający, a gdy punkt jest poza obrysem – najbliższa ściana do 20 m', () => {
    assert.equal(budynekAdresu(wynik, { i: 1, lon: LON + 0.0001, lat: LAT })?.id, 'a')
    // 10 m za krawędzią budynku „a”.
    const obok = { i: 99, lon: LON + D + 0.00014, lat: LAT }
    assert.equal(budynekAdresu(wynik, obok)?.id, 'a')
    assert.equal(budynekAdresu(wynik, { i: 98, lon: LON + 0.001, lat: LAT + 0.001 }), null)
  })
})

describe('kolor i wysokość', () => {
  it('brak litery = szarość, nie kolor złej oceny', () => {
    assert.deepEqual(kolorBudynku(null, 'zwykly'), SZARY_BUDYNKU)
  })

  it('wybrany w pełnym kolorze, reszta blednie, ale zostaje nieprzezroczysta', () => {
    assert.deepEqual(kolorBudynku('G', 'wybrany'), kolorBudynku('G', 'zwykly'))
    const przygaszony = kolorBudynku('G', 'przygaszony')
    assert.ok(przygaszony[1] > kolorBudynku('G', 'zwykly')[1])
    assert.equal(przygaszony[3], 255)
  })

  it('brak wysokości = niska płyta, nie zero', () => {
    assert.equal(wysokoscBryly(budynek('x', LON, LAT, null)), 3)
    assert.equal(wysokoscBryly(budynek('x', LON, LAT, 24.5)), 24.5)
  })
})

describe('odmiana', () => {
  it('liczebniki po polsku', () => {
    const b = ['budynek', 'budynki', 'budynków'] as const
    assert.equal(odmiana(1, b), '1 budynek')
    assert.equal(odmiana(792, b), '792 budynki')
    assert.equal(odmiana(12, b), '12 budynków')
    assert.equal(odmiana(25, b), '25 budynków')
    assert.equal(odmiana(0, b), '0 budynków')
  })
})
