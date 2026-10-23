// Rozbicie `podlaczDane` (B6): meta z manifestu osobno, słownik id ↔ indeks osobno. Osobny plik od
// pozostałych testów stanu, bo stan aplikacji to moduł z jednym obiektem (własny proces na plik).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  idAdresu,
  indeksAdresu,
  pobierzStan,
  podlaczMeta,
  podlaczSlownik,
  resolverZId,
  ustawMiasto,
  wczytajLinkStartowy,
} from './stan.ts'
import { czytajHash } from './url.ts'

const WSKAZNIKI = [{ id: 'halas_ldwn', kategoria: 'spokoj' as const }]

test('resolverZId bez kolejności nie zgaduje – rzuca', () => {
  assert.throws(() => resolverZId(['a', 'b', 'c'], undefined))
})

test('resolverZId z kolejnością kompaktu: indeks to pozycja w adresy.json', () => {
  // kompakt: j=0 → adresy.json 2, j=1 → 0, j=2 → 1
  const r = resolverZId(['a', 'b', 'c'], [2, 0, 1])
  assert.equal(r.indeksDlaId('a'), 2)
  assert.equal(r.indeksDlaId('c'), 1)
  assert.equal(r.idDlaIndeksu(0), 'b')
  assert.equal(r.idDlaIndeksu(2), 'a')
  assert.equal(r.idDlaIndeksu(7), null)
})

test('podlaczMeta liczy wagi bez słownika, a id z linku czekają na podlaczSlownik', () => {
  wczytajLinkStartowy(czytajHash('#/adres/id-b?cmp=id-a,id-c,nie-ma'))
  podlaczMeta(WSKAZNIKI)
  assert.ok('halas_ldwn' in pobierzStan().wagi)
  assert.equal(pobierzStan().ekran, 'okolica')
  assert.equal(pobierzStan().wybrany, null)
  assert.deepEqual(pobierzStan().porownanie, [])
  podlaczSlownik(resolverZId(['id-a', 'id-b', 'id-c'], [0, 1, 2]))
  const s = pobierzStan()
  assert.equal(s.wybrany, 1)
  assert.deepEqual(s.porownanie, [0, 2])
  assert.equal(idAdresu(1), 'id-b')
})

test('po zmianie miasta słownik poprzedniego nie rozwiązuje id', () => {
  podlaczSlownik(resolverZId(['id-a', 'id-b', 'id-c'], [0, 1, 2]))
  assert.equal(idAdresu(1), 'id-b')
  ustawMiasto('lodz')
  assert.equal(idAdresu(1), null)
  assert.equal(indeksAdresu('id-b'), null)
})
