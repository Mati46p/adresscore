// Testy: node --test src/karta/wyszukiwarka/*.test.ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Adres } from '../../kontrakty/index.ts'
import { najblizszyAdres } from './najblizszy.ts'

function punkt(i: number, lon: number, lat: number): Adres {
  return {
    i,
    id: `p-${i}`,
    miejscowosc: 'Kraków',
    ulica: 'Testowa',
    nr: String(i),
    kod: null,
    dzielnica: null,
    gmina: 'Kraków',
    teryt: '',
    lon,
    lat,
    h3: '',
  }
}

// 0,001° szerokości ≈ 111 m; 0,001° długości przy 50° ≈ 72 m.
const adresy = [punkt(100, 19.94, 50.06), punkt(101, 19.941, 50.06), punkt(102, 19.95, 50.07)]

test('zwraca najbliższy adres (Adres.i, nie pozycję)', () => {
  assert.equal(najblizszyAdres(adresy, 19.9402, 50.0601), 100)
  assert.equal(najblizszyAdres(adresy, 19.9409, 50.06), 101)
})

test('null, gdy dalej niż ~300 m', () => {
  assert.equal(najblizszyAdres(adresy, 19.96, 50.06), null)
  assert.equal(najblizszyAdres(adresy, 19.94, 50.0635), null)
})

test('granica promienia i sąsiednie komórki siatki', () => {
  const p = [punkt(1, 19.94, 50.06)]
  assert.equal(najblizszyAdres(p, 19.94, 50.06 + 0.0026), 1) // ~290 m
  assert.equal(najblizszyAdres(p, 19.94 + 0.0039, 50.06), 1) // ~280 m
  assert.equal(najblizszyAdres(p, 19.94 + 0.0045, 50.06), null) // ~325 m
})

test('pusta tablica', () => {
  assert.equal(najblizszyAdres([], 19.9, 50), null)
})

test('wydajność: 70 tys. punktów, 10 tys. zapytań', () => {
  const dane = Array.from({ length: 70_000 }, (_, i) =>
    punkt(i, 19.8 + (i % 300) * 0.0007, 50.0 + Math.floor(i / 300) * 0.0004),
  )
  najblizszyAdres(dane, 19.9, 50.05)
  const t = performance.now()
  for (let k = 0; k < 10_000; k++)
    najblizszyAdres(dane, 19.8 + (k % 300) * 0.0007, 50.0 + (k % 233) * 0.0004)
  const na = (performance.now() - t) / 10_000
  console.log(`najblizszyAdres ${na.toFixed(4)} ms`)
  assert.ok(na < 1)
})
