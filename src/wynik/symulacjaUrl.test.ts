// Obiekty symulatora w linku (#98). Uruchom: node --test src/wynik/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Obiekt } from './symulacja.ts'
import { MAKS_OBIEKTOW, obiektyDoTekstu, obiektyZTekstu } from './symulacjaUrl.ts'
import { czytajHash, zapiszHash } from './url.ts'

const obiekty: Obiekt[] = [
  { typ: 'przystanek', lon: 19.9372, lat: 50.0614 },
  { typ: 'sklep', lon: 19.90001, lat: 50.05 },
  { typ: 'zdrowie', lon: 20.01234, lat: 50.08765 },
  { typ: 'schron', lon: 19.8, lat: 50.1 },
]

describe('obiekty w URL', () => {
  it('zapis i odczyt się zgadzają (5 miejsc po przecinku ≈ 1 m)', () => {
    assert.deepEqual(obiektyZTekstu(obiektyDoTekstu(obiekty)), obiekty)
  })
  it('śmieci odpadają, poprawne obiekty zostają', () => {
    const tekst = `x:19.9,50.0;p:abc,50;p:0,0;${obiektyDoTekstu(obiekty.slice(0, 1))};;s:19.9`
    assert.deepEqual(obiektyZTekstu(tekst), obiekty.slice(0, 1))
    assert.deepEqual(obiektyZTekstu(''), [])
    assert.deepEqual(obiektyZTekstu(null), [])
  })
  it(`najwyżej ${MAKS_OBIEKTOW} obiektów`, () => {
    const duzo = Array.from({ length: 30 }, () => obiekty[0] as Obiekt)
    assert.equal(obiektyZTekstu(obiektyDoTekstu(duzo)).length, MAKS_OBIEKTOW)
  })
  it('ekran #/symulator z wariantami A i B przechodzi przez hash', () => {
    const a = obiektyDoTekstu(obiekty.slice(0, 2))
    const b = obiektyDoTekstu(obiekty.slice(2))
    const s = czytajHash(`#/symulator?a=${a}&b=${b}`)
    assert.equal(s.ekran, 'symulator')
    assert.deepEqual(s.symulacja, { a, b })
    assert.deepEqual(czytajHash(zapiszHash(s)), s)
  })
  it('parametry symulacji poza ekranem symulatora nie trafiają do stanu', () => {
    assert.equal(czytajHash('#/?a=p:19.9,50.0').symulacja, undefined)
    assert.equal(czytajHash('#/symulator').symulacja?.a, '')
  })
})
