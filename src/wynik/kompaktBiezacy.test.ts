// Źródło danych heksów bieżącego miasta (#247, B2).
// Uruchom: node --test src/wynik/kompaktBiezacy.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Manifest } from '../kontrakty/index.ts'
import type { PodstawaHeksow } from './heksy.ts'
import type { IndeksKompaktu } from './kompakt.ts'
import { type DaneHeksowGotowe, utworzZrodloHeksow } from './kompaktBiezaceLogika.ts'
import type { WpisPrzegladu } from './przegladMenedzer.ts'

function indeks(rozszerzenia?: string[]): IndeksKompaktu {
  return {
    format: 2,
    skale: { plik: 'skale.abc.json', bajty: 1, sha256: '' },
    wskazniki: { a: { filtr: { plik: 'filtry/a.1.bin', bajty: 1, sha256: '' } } },
    ...(rozszerzenia ? { rozszerzenia } : {}),
  } as unknown as IndeksKompaktu
}

function wpisGotowy(i: IndeksKompaktu): WpisPrzegladu {
  return {
    stan: 'gotowe',
    indeks: i,
    manifest: { wskazniki: [] } as unknown as Manifest,
    podstawa: {} as PodstawaHeksow,
    granice: null,
    warstwy: new Map(),
    nieudane: new Set(),
  }
}

function zrodlo(wpis: WpisPrzegladu | undefined) {
  const pobrane: string[] = []
  const z = utworzZrodloHeksow({
    wpis: () => wpis,
    subskrybujWpisy: () => () => {},
    baza: () => 'dane',
    json: async <T>(url: string) => {
      pobrane.push(url)
      return { a: { od: 0, do: 10, norma: 5, zrodlo: 'zakres' } } as T
    },
    // Bajty to nie kompakt: sprawdza ścieżkę błędu (filtr zostaje null, bez ponowienia).
    bajty: async (url) => {
      pobrane.push(url)
      return new ArrayBuffer(4)
    },
    ostrzez: () => {},
  })
  return { z, pobrane }
}

const czekaj = () => new Promise((r) => setTimeout(r, 5))

describe('źródło danych heksów', () => {
  it('brak wpisu to ładowanie, wpis brak przechodzi z powodem', () => {
    assert.equal(zrodlo(undefined).z.stan('krakow').stan, 'ladowanie')
    const s = zrodlo({ stan: 'brak', powod: 'x' }).z.stan('krakow')
    assert.deepEqual(s, { stan: 'brak', powod: 'x' })
  })

  it('bez indeks.rozszerzenia stan brak z powodem', () => {
    const s = zrodlo(wpisGotowy(indeks())).z.stan('krakow')
    assert.equal(s.stan, 'brak')
    assert.ok(s.stan === 'brak' && s.powod.length > 0)
  })

  it('migawka jest stabilna (===), dopóki nic się nie zmieni', () => {
    const { z } = zrodlo(wpisGotowy(indeks(['i'])))
    assert.equal(z.stan('krakow'), z.stan('krakow'))
  })

  it('skala: jeden fetch na plik, powiadomienie po dojściu, potem wartość', async () => {
    const { z, pobrane } = zrodlo(wpisGotowy(indeks(['i'])))
    let powiadomien = 0
    z.subskrybuj(() => powiadomien++)
    const przed = z.stan('krakow') as DaneHeksowGotowe
    assert.equal(przed.skala('a'), null)
    assert.equal(przed.skala('a'), null)
    assert.equal(przed.skala('nieznana'), null)
    await czekaj()
    assert.equal(pobrane.filter((u) => u.includes('skale.abc.json')).length, 1)
    assert.equal(powiadomien, 1)
    const po = z.stan('krakow') as DaneHeksowGotowe
    assert.notEqual(po, przed)
    assert.equal(po.skala('a')?.norma, 5)
  })

  it('filtr: jeden fetch na plik, uszkodzony plik zostaje null i nie ponawia się', async () => {
    const { z, pobrane } = zrodlo(wpisGotowy(indeks(['i'])))
    let powiadomien = 0
    z.subskrybuj(() => powiadomien++)
    const d = z.stan('krakow') as DaneHeksowGotowe
    assert.equal(d.filtr('a'), null)
    assert.equal(d.filtr('a'), null)
    assert.equal(d.filtr('brak-takiej'), null)
    await czekaj()
    assert.equal(pobrane.filter((u) => u.endsWith('filtry/a.1.bin')).length, 1)
    assert.equal(powiadomien, 1)
    assert.equal((z.stan('krakow') as DaneHeksowGotowe).filtr('a'), null)
    assert.equal(pobrane.filter((u) => u.endsWith('filtry/a.1.bin')).length, 1)
  })
})
