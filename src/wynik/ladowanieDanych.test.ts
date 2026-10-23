// Ładowanie danych miasta bez sieci i bez Vite: `pobierzJson` to atrapa z plikami w pamięci.
// Uruchom: node --test src/wynik/ladowanieDanych.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Manifest, PlikAdresow, PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import {
  ladujDaneMiasta,
  listaTransferow,
  POBRAN_NARAZ,
  type PobierzJson,
} from './ladowanieDanych.ts'
import { ocenWartosc, wynikAdresu } from './silnik.ts'

const BAZA = '/dane/miasta/test'

function meta(id: string, m: Partial<WskaznikMeta> = {}): WskaznikMeta {
  return {
    id,
    kategoria: 'spokoj',
    nazwa: id,
    opis: '',
    jednostka: '',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zrodla: [],
    zadanie: 0,
    zakres: [0, 100],
    ...m,
  }
}

const adresy: PlikAdresow = {
  wersja: 'w1',
  zrodla: [],
  kolumny: {
    id: ['a', 'b', 'c'],
    miejscowosc: ['M', 'M', 'M'],
    ulica: [null, null, null],
    nr: ['1', '2', '3'],
    kod: [null, null, null],
    dzielnica: [null, null, null],
    gmina: ['G', 'G', 'G'],
    teryt: ['1', '1', '1'],
    lon: [20, 20.1, 20.2],
    lat: [50, 50.1, 50.2],
    h3: ['h1', 'h1', 'h2'],
  },
}

const wskaznikA: PlikWskaznika = {
  meta: meta('a'),
  wersjaAdresow: 'w1',
  wartosci: [100, 50, null],
}
const wskaznikB: PlikWskaznika = {
  meta: meta('b', { kierunek: 'wiecej-lepiej' }),
  wersjaAdresow: 'w1',
  wartosci: [100, null, null],
}

const manifest: Manifest = {
  wygenerowano: 'test',
  wskazniki: [
    { ...wskaznikA.meta, wersjaAdresow: 'w1' },
    { ...wskaznikB.meta, wersjaAdresow: 'w1' },
    { ...meta('stary'), wersjaAdresow: 'w0' },
    { ...meta('zepsuty'), wersjaAdresow: 'w1' },
  ],
}

function atrapa(
  extra: Record<string, unknown> = {},
  licznik?: { naraz: number; maks: number },
): PobierzJson {
  const pliki: Record<string, unknown> = {
    [`${BAZA}/adresy.json`]: adresy,
    [`${BAZA}/manifest.json`]: manifest,
    [`${BAZA}/wskazniki/a.json`]: wskaznikA,
    [`${BAZA}/wskazniki/b.json`]: wskaznikB,
    ...extra,
  }
  return async (sciezka, signal) => {
    signal?.throwIfAborted()
    if (licznik) {
      licznik.naraz++
      licznik.maks = Math.max(licznik.maks, licznik.naraz)
      await new Promise((r) => setTimeout(r, 1))
      licznik.naraz--
    }
    if (!(sciezka in pliki)) throw new Error(`Brak pliku danych ${sciezka} (404)`)
    return structuredClone(pliki[sciezka])
  }
}

const wej = (pobierzJson: PobierzJson, ostrzezenia: string[] = []) => ({
  slug: 'lodz' as never,
  baza: BAZA,
  pobierzJson,
  ostrzez: (t: string) => ostrzezenia.push(t),
})

describe('ladujDaneMiasta', () => {
  it('braki danych zostają NaN, nigdy 0, a wynik adresu liczy tylko warstwy z danymi', async () => {
    const w = await ladujDaneMiasta(wej(atrapa()))
    const [a, b] = w.wskazniki
    assert.ok(a && b)
    assert.ok(a.wartosci instanceof Float64Array)
    assert.deepEqual([...a.wartosci.slice(0, 2)], [100, 50])
    assert.ok(Number.isNaN(a.wartosci[2]))
    assert.ok(Number.isNaN(b.wartosci[1]))
    assert.ok(Number.isNaN(b.wartosci[2]))

    const wagi = { a: 4, b: 4 }
    // Adres 1: warstwa b bez danych – wynik = ocena samej warstwy a, a nie średnia z zerem.
    const r1 = wynikAdresu(1, w.wskazniki, wagi)
    assert.equal(r1.warstwy.find((x) => x.id === 'b')?.wartosc, null)
    assert.equal(r1.wynik, ocenWartosc(50, a.skala, 'mniej-lepiej'))
    // Adres 2: żadnej danej – szary wynik, nie 0.
    const r2 = wynikAdresu(2, w.wskazniki, wagi)
    assert.equal(r2.wynik, null)
    assert.equal(r2.pewnosc, 0)
  })

  it('pomija warstwy z inną wersją adresów i te, których plik nie doszedł', async () => {
    const ostrzezenia: string[] = []
    const w = await ladujDaneMiasta(wej(atrapa(), ostrzezenia))
    assert.equal(w.wskazniki.length, manifest.wskazniki.length)
    assert.deepEqual(w.pominiete.map((p) => p.id).sort(), ['stary', 'zepsuty'])
    const stary = w.wskazniki.find((x) => x.meta.id === 'stary')
    assert.ok(stary?.niedostepny)
    assert.ok(stary.wartosci.every((v) => Number.isNaN(v)))
    assert.equal(stary.wartosci.length, 3)
    assert.equal(ostrzezenia.filter((t) => t.includes('bez danych')).length, 2)
  })

  it('wskaźnik liczony dla innych adresów = niedostępny z ostrzeżeniem', async () => {
    const ostrzezenia: string[] = []
    const obcy = { ...wskaznikB, wersjaAdresow: 'w9' }
    const w = await ladujDaneMiasta(
      wej(atrapa({ [`${BAZA}/wskazniki/b.json`]: obcy }), ostrzezenia),
    )
    assert.equal(w.pominiete.find((p) => p.id === 'b')?.powod, 'niezgodna wersja adresów')
    assert.ok(ostrzezenia.some((t) => t.includes('liczony dla adresów w9')))
  })

  it('okolice tylko dla miasta domyślnego', async () => {
    const pobrane: string[] = []
    const baza = atrapa()
    const w = await ladujDaneMiasta(
      wej(async (s, sig) => {
        pobrane.push(s)
        return baza(s, sig)
      }),
    )
    assert.equal(w.okolice, null)
    assert.ok(!pobrane.some((s) => s.endsWith('okolice.json')))
  })

  it('grupuje heksy i nie pobiera więcej niż POBRAN_NARAZ plików naraz', async () => {
    const licznik = { naraz: 0, maks: 0 }
    const w = await ladujDaneMiasta(wej(atrapa({}, licznik)))
    assert.deepEqual(w.grupyHeksow.heksy, ['h1', 'h2'])
    assert.deepEqual([...w.grupyHeksow.indeksHeksu], [0, 0, 1])
    assert.ok(licznik.maks <= POBRAN_NARAZ + 1, `naraz ${licznik.maks}`)
  })

  it('przerwanie odrzuca ładowanie bez wpisów do pominiętych i ostrzeżeń', async () => {
    const ostrzezenia: string[] = []
    const ac = new AbortController()
    const p = ladujDaneMiasta(wej(atrapa(), ostrzezenia), ac.signal)
    ac.abort()
    await assert.rejects(p)
    assert.deepEqual(ostrzezenia, [])
  })

  it('lista transferów zawiera każdy bufor raz', async () => {
    const w = await ladujDaneMiasta(wej(atrapa()))
    const lista = listaTransferow(w)
    assert.equal(new Set(lista).size, lista.length)
    // Każda warstwa ma własny bufor + indeks heksów.
    assert.equal(lista.length, w.wskazniki.length + 1)
  })
})
