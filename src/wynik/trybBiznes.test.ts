import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pobierzStan, podlaczDane, ustawFiltr, ustawTryb, ustawWage } from './stan.ts'

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
