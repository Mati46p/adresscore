// Mapa luk (#90). Uruchom: node --test src/mapa/luki/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LiczbyLuki } from '../../wynik/luki.ts'
import { STOPNIE_SKALI } from '../skala.ts'
import {
  formaAdresow,
  gradientLukCss,
  graniceOkolicy,
  liczbaPelna,
  opisHeksuLuki,
  procentLuki,
  sumaLiczb,
  wartoscMapyLuki,
} from './skalaLuk.ts'

const liczby = (wLuce: number, bezLuki: number, brakDanych: number): LiczbyLuki => {
  const wszystkie = wLuce + bezLuki + brakDanych
  return {
    wszystkie,
    wLuce,
    bezLuki,
    brakDanych,
    udzial: wLuce + bezLuki > 0 ? wLuce / wszystkie : null,
  }
}

describe('wartoscMapyLuki', () => {
  it('odwraca skalę: 0% w luce = 100 (zieleń), 100% = 0 (pomarańcz)', () => {
    assert.equal(wartoscMapyLuki(0), 100)
    assert.equal(wartoscMapyLuki(1), 0)
    assert.equal(wartoscMapyLuki(0.25), 75)
  })
  it('brak danych zostaje brakiem, nigdy zerem', () => {
    assert.equal(wartoscMapyLuki(null), null)
    assert.equal(wartoscMapyLuki(undefined), null)
    assert.equal(wartoscMapyLuki(Number.NaN), null)
  })
  it('przycina wartości spoza 0–1', () => {
    assert.equal(wartoscMapyLuki(1.2), 0)
    assert.equal(wartoscMapyLuki(-0.1), 100)
  })
})

describe('sumaLiczb', () => {
  const mapa = new Map([
    ['a', liczby(10, 30, 0)],
    ['b', liczby(0, 0, 5)],
    ['c', liczby(1, 9, 0)],
  ])
  it('udział rodzica = suma w luce / suma wszystkich, nie średnia udziałów', () => {
    const s = sumaLiczb(['a', 'c'], mapa)
    assert.equal(s.wszystkie, 50)
    assert.equal(s.wLuce, 11)
    assert.equal(s.udzial, 11 / 50)
    assert.notEqual(s.udzial, (10 / 40 + 1 / 10) / 2)
  })
  it('brak danych wchodzi do podstawy udziału', () => {
    const s = sumaLiczb(['a', 'b'], mapa)
    assert.equal(s.wszystkie, 45)
    assert.equal(s.udzial, 10 / 45)
    assert.equal(s.wLuce + s.bezLuki + s.brakDanych, s.wszystkie)
  })
  it('same braki dają null (szary), nie 0', () => {
    assert.equal(sumaLiczb(['b'], mapa).udzial, null)
    assert.equal(sumaLiczb(['x'], mapa).udzial, null)
  })
})

describe('opis heksu', () => {
  it('pełne liczby i forma rzeczownika', () => {
    assert.match(liczbaPelna(12345), /^12\s345$/u)
    assert.equal(formaAdresow(1), 'adres')
    assert.equal(formaAdresow(3), 'adresy')
    assert.equal(formaAdresow(12), 'adresów')
    assert.equal(formaAdresow(22), 'adresy')
    assert.equal(formaAdresow(45), 'adresów')
  })
  it('w luce / wszystkie, z adresami bez danych', () => {
    assert.equal(opisHeksuLuki(liczby(3, 6, 0)), 'w luce: 3 / 9 adresów (33%)')
    assert.equal(opisHeksuLuki(liczby(1, 1, 2)), 'w luce: 1 / 4 adresy (25%), bez danych: 2')
    assert.match(opisHeksuLuki(liczby(3, 6, 0), true), /\(większy heks, łącznie\)$/)
  })
  it('heks bez danych mówi „brak danych”, nie „0%”', () => {
    const t = opisHeksuLuki(liczby(0, 0, 7))
    assert.equal(t, 'brak danych – 7 adresów')
    assert.doesNotMatch(t, /0%/)
  })
  it('procent bez fałszywego zera i fałszywej setki', () => {
    assert.equal(procentLuki(0), '0%')
    assert.equal(procentLuki(0.003), '<1%')
    assert.equal(procentLuki(0.998), '>99%')
    assert.equal(procentLuki(1), '100%')
  })
})

describe('gradientLukCss', () => {
  it('zaczyna od zieleni (0% w luce), kończy pomarańczem (100%)', () => {
    const g = gradientLukCss()
    const zielen = STOPNIE_SKALI[STOPNIE_SKALI.length - 1]?.[1] as string
    const pomarancz = STOPNIE_SKALI[0]?.[1] as string
    assert.ok(g.startsWith(`linear-gradient(to right, ${zielen} 0%`), g)
    assert.ok(g.endsWith(`${pomarancz} 100%)`), g)
  })
})

describe('graniceOkolicy', () => {
  const adresy = [
    { dzielnica: 'I Stare Miasto', gmina: 'Kraków', lon: 19.93, lat: 50.06 },
    { dzielnica: 'I Stare Miasto', gmina: 'Kraków', lon: 19.95, lat: 50.07 },
    { dzielnica: 'VI Bronowice', gmina: 'Kraków', lon: 19.88, lat: 50.08 },
    { dzielnica: null, gmina: 'Zabierzów', lon: 19.8, lat: 50.1 },
    { dzielnica: null, gmina: 'Zabierzów', lon: 0, lat: 0 },
  ]
  it('ramka adresów dzielnicy', () => {
    assert.deepEqual(graniceOkolicy(adresy, 'dzielnica:I Stare Miasto'), [
      [19.93, 50.06],
      [19.95, 50.07],
    ])
  })
  it('gmina obwarzanka po id z okolicaAdresu, bez punktu (0, 0)', () => {
    const g = graniceOkolicy(adresy, 'gmina:Zabierzów')
    assert.ok(g)
    const [[x0, y0], [x1, y1]] = g
    assert.ok(x0 < 19.8 && x1 > 19.8 && y0 < 50.1 && y1 > 50.1, 'punkt w środku ramki')
    assert.ok(x1 - x0 > 0.002 && y1 - y0 > 0.002, 'jeden adres daje ramkę z zapasem')
  })
  it('nieznana okolica daje null', () => {
    assert.equal(graniceOkolicy(adresy, 'dzielnica:Nie ma'), null)
    assert.equal(graniceOkolicy(adresy, 'gmina:Kraków'), null)
  })
})
