// Przykład adresu do pól wyszukiwania (#223, F6). Uruchom: node --test src/karta/adres.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Adres } from '../kontrakty/index.ts'
import { liczba, opisAdresu, przykladAdresu } from './adres.ts'

function adres(i: number, ulica: string | null, nr: string, miejscowosc: string): Adres {
  return {
    i,
    id: `a-${i}`,
    miejscowosc,
    ulica,
    nr,
    kod: null,
    dzielnica: null,
    gmina: miejscowosc,
    teryt: '0',
    lon: 18.6,
    lat: 54.3,
    h3: '8a000000000ffff',
  }
}

describe('przykład adresu z danych miasta', () => {
  it('pierwszy adres z ulicą, bez miejscowości albo z nią', () => {
    const adresy = [adres(0, null, '5', 'Wieś'), adres(1, 'Zofii Nałkowskiej', '6C', 'Gdańsk')]
    assert.equal(przykladAdresu(adresy), 'Zofii Nałkowskiej 6C')
    assert.equal(przykladAdresu(adresy, true), 'Zofii Nałkowskiej 6C, Gdańsk')
  })

  it('dane bez ulic (same wsie) nie dają przykładu, a nie fałszywy napis', () => {
    assert.equal(przykladAdresu([adres(0, null, '5', 'Wieś')]), null)
    assert.equal(przykladAdresu([]), null)
  })
})

describe('opis adresu i liczba (bez zmian)', () => {
  it('opisAdresu i liczba', () => {
    assert.equal(opisAdresu(adres(0, 'Długa', '12', 'Kraków')), 'Długa 12, Kraków')
    assert.equal(opisAdresu(adres(0, null, '12', 'Wieś')), 'Wieś 12')
    assert.equal(liczba(null), '–')
    assert.equal(liczba(Number.NaN), '–')
    assert.equal(liczba(71.6), '72')
  })
})
