import assert from 'node:assert/strict'
import { test } from 'node:test'
import { odczytajPreferencje, polaczPreferencje, zapiszPreferencje } from './sesja.ts'
import { pobierzStan, podlaczDane, ustawFiltr, ustawTryb, ustawWage } from './stan.ts'
import { czytajHash } from './url.ts'

test('preferencje sklepu są osobne od ustawień mieszkaniowych podczas przełączania trybów', () => {
  podlaczDane(
    [],
    [
      { id: 'halas_ldwn', kategoria: 'spokoj' },
      { id: 'sklep_odleglosc', kategoria: 'codziennosc' },
      { id: 'ludnosc_1km', kategoria: 'kontekst' },
    ],
    [],
  )
  ustawWage('halas_ldwn', 4)
  ustawFiltr({ id: 'halas_ldwn', warunek: 'max', prog: 55 })
  ustawTryb('biznes')
  assert.equal(pobierzStan().wagi.halas_ldwn, 0)
  assert.equal(pobierzStan().wagi.sklep_odleglosc, 4)
  assert.equal(pobierzStan().wagi.ludnosc_1km, 4)
  assert.deepEqual(pobierzStan().filtry, [])
  ustawWage('sklep_odleglosc', 2)
  ustawTryb('kupuje')
  assert.equal(pobierzStan().wagi.halas_ldwn, 4)
  assert.equal(pobierzStan().filtry.length, 1)
  ustawTryb('biznes')
  assert.equal(pobierzStan().wagi.sklep_odleglosc, 2)
  assert.deepEqual(pobierzStan().filtry, [])
})

test('tryb biznesowy i własne wagi wracają po otwarciu czystego linku adresu', () => {
  const zawartosc = new Map<string, string>()
  const poprzedni = globalThis.sessionStorage
  globalThis.sessionStorage = {
    get length() {
      return zawartosc.size
    },
    getItem: (klucz) => zawartosc.get(klucz) ?? null,
    setItem: (klucz, wartosc) => {
      zawartosc.set(klucz, wartosc)
    },
    removeItem: (klucz) => {
      zawartosc.delete(klucz)
    },
    clear: () => zawartosc.clear(),
    key: (indeks) => [...zawartosc.keys()][indeks] ?? null,
  }
  try {
    const preferencje = czytajHash(
      '#/?t=biznes&u=%7B%22v%22%3A1%2C%22w%22%3A%7B%22ludnosc_1km%22%3A3%7D%2C%22k%22%3A%7B%22ludnosc_1km%22%3A%22wiecej-lepiej%22%7D%7D',
    )
    zapiszPreferencje(preferencje)
    const odczyt = odczytajPreferencje()
    const poPrzejsciu = polaczPreferencje(czytajHash(''), '', odczyt)
    assert.equal(poPrzejsciu.tryb, 'biznes')
    assert.equal(poPrzejsciu.ustawienia?.wagi.ludnosc_1km, 3)
  } finally {
    globalThis.sessionStorage = poprzedni
  }
})
