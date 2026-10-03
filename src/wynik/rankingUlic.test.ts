import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Adres } from '../kontrakty/index.ts'
import { rankingUlic } from './rankingUlic.ts'
import { slugUlicy } from './slug.ts'

const adres = (ulica: string, nr: string, miejscowosc = 'Kraków'): Adres =>
  ({
    id: `${miejscowosc}-${ulica}-${nr}`,
    i: 0,
    ulica,
    nr,
    miejscowosc,
    gmina: miejscowosc,
    teryt: miejscowosc === 'Kraków' ? '1261011' : '1219053',
    dzielnica: miejscowosc === 'Kraków' ? 'Stare Miasto' : null,
    h3: 'hex',
  }) as Adres

test('ranking pokazuje ulicę raz i uśrednia wyniki jej adresów', () => {
  const a = [adres('Długa', '1'), adres('Długa', '3'), adres('Grodzka', '2')]
  const wynik = rankingUlic(
    a,
    Float32Array.from([90, 70, 75]),
    new Uint8Array(3),
    new Map([['hex', 80]]),
  )
  assert.equal(wynik.length, 2)
  assert.equal(wynik[0]?.nazwa, 'Długa')
  assert.equal(wynik[0]?.wynik, 80)
  assert.equal(wynik[0]?.liczbaAdresow, 2)
  assert.equal(wynik[0]?.adresDoPorownania, 0)
  assert.equal(wynik[0]?.slug, slugUlicy(a[0] as Adres))
  assert.equal(wynik[1]?.nazwa, 'Grodzka')
})

test('ta sama nazwa w różnych miejscowościach nie jest łączona', () => {
  const a = [adres('Długa', '1'), adres('Długa', '1', 'Wieliczka')]
  const wynik = rankingUlic(
    a,
    Float32Array.from([60, 80]),
    new Uint8Array(2),
    new Map([['hex', 70]]),
  )
  assert.equal(wynik.length, 2)
  assert.notEqual(wynik[0]?.slug, wynik[1]?.slug)
})

test('brak oceny i adresy wykluczone nie zawyżają wyniku ulicy', () => {
  const a = [adres('Długa', '1'), adres('Długa', '3'), adres('Długa', '5')]
  const wynik = rankingUlic(
    a,
    Float32Array.from([40, 90, Number.NaN]),
    Uint8Array.from([0, 1, 0]),
    new Map([['hex', 50]]),
  )
  assert.equal(wynik[0]?.wynik, 40)
  assert.equal(wynik[0]?.liczbaAdresow, 1)
  assert.equal(wynik[0]?.adresDoPorownania, 0)
})

test('do porównania wybiera adres z danymi, który spełnia filtr', () => {
  const a = [adres('Długa', '1'), adres('Długa', '3'), adres('Długa', '5')]
  const wynik = rankingUlic(
    a,
    Float32Array.from([90, 80, 70]),
    Uint8Array.from([1, 0, 0]),
    new Map([['hex', 80]]),
  )
  assert.equal(wynik[0]?.adresDoPorownania, 1)
})
