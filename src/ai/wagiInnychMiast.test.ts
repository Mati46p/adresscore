// Profil z „Opisz siebie” nie gubi warstw innych miast (#223, F6). Uruchom: node --test src/ai/wagiInnychMiast.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WskaznikMeta } from '../kontrakty/index.ts'
import { PUSTE_ZROZUMIENIE, wagiZeZrozumienia } from './opiszSiebie.ts'
import { poza } from './wagiInnychMiast.ts'

describe('poza: wpisy spoza bieżącego miasta', () => {
  it('zostawia tylko id, których bieżące miasto nie ma', () => {
    const stare = { halas: 3, zielen: 2, tylko_krakow: 4 }
    assert.deepEqual(poza(stare, new Set(['halas', 'zielen'])), { tylko_krakow: 4 })
  })

  it('miasto bez własnych warstw w profilu: profil bez zmian, ale to kopia', () => {
    const stare = { a: 1, b: 2 }
    const wynik = poza(stare, new Set())
    assert.deepEqual(wynik, stare)
    assert.notEqual(wynik, stare)
  })

  it('działa też dla kierunków (wartości nie tylko liczby)', () => {
    const kierunki = { halas: 'mniej-lepiej', ludnosc_1km: 'wiecej-lepiej' } as const
    assert.deepEqual(poza(kierunki, new Set(['halas'])), { ludnosc_1km: 'wiecej-lepiej' })
  })
})

describe('profil po opisie w mieście, które nie ma wszystkich warstw', () => {
  // Gdańsk: dwie warstwy. Profil w stanie ma jeszcze warstwę tylko krakowską.
  const gdansk: Pick<WskaznikMeta, 'id' | 'kategoria' | 'kierunek'>[] = [
    { id: 'halas', kategoria: 'spokoj', kierunek: 'mniej-lepiej' },
    { id: 'przystanek', kategoria: 'transport', kierunek: 'mniej-lepiej' },
  ]
  const idGdanska = new Set(gdansk.map((w) => w.id))

  it('wagi warstwy tylko krakowskiej przeżywają opis, a warstwy Gdańska idą z opisu', () => {
    const stan = { wagi: { halas: 1, przystanek: 1, mpzp_status: 3 }, kierunki: {} }
    const z = { ...PUSTE_ZROZUMIENIE, kategorie: { spokoj: 4 } }
    const nowe = wagiZeZrozumienia(z, 'kupuje', gdansk, stan)
    assert.ok(!('mpzp_status' in nowe.wagi), 'sam opis nie zna warstwy spoza miasta')
    const zlozone = { ...poza(stan.wagi, idGdanska), ...nowe.wagi }
    assert.equal(zlozone.mpzp_status, 3, 'warstwa innego miasta zachowana')
    assert.equal(zlozone.halas, nowe.wagi.halas, 'warstwa bieżącego miasta wzięta z opisu')
  })
})
