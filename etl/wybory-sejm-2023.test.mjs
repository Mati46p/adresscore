import assert from 'node:assert/strict'
import test from 'node:test'
import { csv, zbudujDane } from './wybory-sejm-2023.mjs'

test('CSV obsługuje cudzysłowy i średniki w nazwie', () => {
  assert.deepEqual(csv('"a;b";"c"\r\n1;2\r\n'), [
    ['a;b', 'c'],
    ['1', '2'],
  ])
})

const naglowek = [
  'TERYT Gminy',
  'Gmina',
  'Nr okręgu',
  'Liczba głosów ważnych oddanych łącznie na wszystkie listy kandydatów',
  'Komitet A',
  'Komitet B',
]
const listy = [
  ['Numer okręgu', 'Nr listy', 'Nazwa Komitetu'],
  ['13', '1', 'Komitet A'],
  ['13', '2', 'Komitet B'],
]
const adresy = [{ teryt: '1261011' }]

test('mapuje siedmiocyfrowy TERYT adresu do gminy i sprawdza sumę głosów', () => {
  const r = zbudujDane([naglowek, ['126101', 'Kraków', '13', '10', '7', '3']], listy, adresy)
  assert.equal(r.poGminie.get('126101').glosy[0], 7)
  assert.equal(r.numerListy.get('13|Komitet B'), 2)
  assert.throws(
    () => zbudujDane([naglowek, ['126101', 'Kraków', '13', '10', '7', '2']], listy, adresy),
    /suma list/,
  )
  assert.throws(() => zbudujDane([naglowek], listy, adresy), /Brak gminy/)
})
