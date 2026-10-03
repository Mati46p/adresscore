import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { PlikWskaznika } from '../kontrakty/index.ts'
import { ustawieniaPersony } from './persony.ts'
import {
  odczytajPreferencje,
  odczytajPreferencjeTrybu,
  polaczPreferencje,
  zapiszPreferencje,
} from './sesja.ts'
import { przygotujWskaznik, wynikAdresu } from './silnik.ts'
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
  assert.equal(pobierzStan().filtry.length, 0)
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
    const mieszkanie = czytajHash(
      '#/?t=kupuje&u=%7B%22v%22%3A1%2C%22w%22%3A%7B%22halas_ldwn%22%3A2%7D%2C%22k%22%3A%7B%7D%7D',
    )
    zapiszPreferencje(mieszkanie)
    assert.equal(odczytajPreferencjeTrybu('biznes')?.ustawienia?.wagi.ludnosc_1km, 3)
    assert.equal(odczytajPreferencjeTrybu('mieszkanie')?.ustawienia?.wagi.halas_ldwn, 2)
  } finally {
    globalThis.sessionStorage = poprzedni
  }
})

test('rzeczywiste warstwy OSM i NSP dają kierunek wyniku zgodny z trybem sklepu', () => {
  const plik = (id: string): PlikWskaznika =>
    JSON.parse(
      readFileSync(new URL(`../../public/dane/wskazniki/${id}.json`, import.meta.url), 'utf8'),
    )
  const sklep = plik('sklep_odleglosc')
  const ludnosc = plik('ludnosc_1km')
  assert.equal(sklep.meta.atrapa, undefined)
  assert.match(sklep.meta.zrodla[0]?.nazwa ?? '', /OpenStreetMap/)
  assert.match(ludnosc.meta.zrodla[0]?.nazwa ?? '', /NSP 2021/)
  assert.equal(sklep.wartosci.length, ludnosc.wartosci.length)
  assert.ok(sklep.wartosci.length > 100_000)
  const { wagi, kierunki } = ustawieniaPersony('rodzina', 'biznes', [sklep.meta, ludnosc.meta])
  assert.equal(wagi.sklep_odleglosc, 4)
  assert.equal(wagi.ludnosc_1km, 4)
  const skalaSklepu = przygotujWskaznik(sklep)
  const skalaLudnosci = przygotujWskaznik(ludnosc)
  const granice = (wartosci: (number | null)[]) => {
    let min = 0
    let max = 0
    for (let i = 1; i < wartosci.length; i++) {
      if ((wartosci[i] ?? Infinity) < (wartosci[min] ?? Infinity)) min = i
      if ((wartosci[i] ?? -Infinity) > (wartosci[max] ?? -Infinity)) max = i
    }
    return [min, max] as const
  }
  const [sklepBlisko, sklepDaleko] = granice(sklep.wartosci)
  const [ludnoscMalo, ludnoscDuzo] = granice(ludnosc.wartosci)
  const ocena = (i: number, warstwa: ReturnType<typeof przygotujWskaznik>) =>
    wynikAdresu(i, [warstwa], wagi, kierunki).wynik ?? -1
  assert.ok(ocena(sklepDaleko, skalaSklepu) > ocena(sklepBlisko, skalaSklepu))
  assert.ok(ocena(ludnoscDuzo, skalaLudnosci) > ocena(ludnoscMalo, skalaLudnosci))
})
