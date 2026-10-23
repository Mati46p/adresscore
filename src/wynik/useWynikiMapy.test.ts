// Wyniki mapy z kompaktu (#247, B4).
// Uruchom: node --test src/wynik/useWynikiMapy.test.ts
// Test zgodności na Krakowie pomija się bez `rozszerzenia` w public/dane/kompakt/indeks.json.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { Manifest, PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import type { TwardyFiltr } from './filtry.ts'
import {
  type FiltrHeksow,
  type PodstawaHeksow,
  type WarstwaHeksow,
  zakryjBrakiHeksow,
} from './heksy.ts'
import { type IndeksKompaktu, rozpakuj } from './kompakt.ts'
import type { DaneHeksowGotowe } from './kompaktBiezaceLogika.ts'
import { ustawieniaPersony } from './persony.ts'
import { podstawaZPliku, warstwaZPliku } from './przegladLiczenie.ts'
import {
  grupujHeksy,
  mapaHeksow,
  przygotujWskaznik,
  type Skala,
  srednieHeksow,
  wynikiWszystkich,
} from './silnik.ts'
import { policzWynikiMapy } from './wynikiMapy.ts'

function meta(id: string): WskaznikMeta {
  return {
    id,
    kategoria: 'transport',
    nazwa: `Nazwa ${id}`,
    opis: '',
    jednostka: '',
    kierunek: 'wiecej-lepiej',
    rozdzielczosc: 'adres',
    zakres: [0, 100],
    zadanie: 1,
    zrodla: [],
  } as WskaznikMeta
}

const H = ['h1', 'h2', 'h3']
const podstawa = {
  skalaOceny: 1,
  skalaUdzialu: 200,
  poziomy: {
    10: { heksy: H, liczba: [10, 20, 30] },
    9: { heksy: [], liczba: [] },
    8: { heksy: [], liczba: [] },
  },
} as unknown as PodstawaHeksow

function wiersz(oceny: number[], udzial: number[]): WarstwaHeksow {
  const pusty = new Uint8Array(0)
  return {
    ocena: { 10: Uint8Array.from(oceny), 9: pusty, 8: pusty },
    udzial: { 10: Uint8Array.from(udzial), 9: pusty, 8: pusty },
  }
}

const SKALA: Skala = { od: 0, do: 100, norma: 50, zrodlo: 'zakres' }

function dane(
  opcje: { filtry?: Record<string, FiltrHeksow>; skale?: boolean; nieudane?: string[] } = {},
): DaneHeksowGotowe {
  return {
    stan: 'gotowe',
    miasto: 'krakow',
    manifest: { wskazniki: [meta('a'), meta('b')] } as unknown as Manifest,
    indeks: { wskazniki: { a: {}, b: {} } } as unknown as IndeksKompaktu,
    podstawa,
    warstwy: new Map([
      // Heks h3 bez pomiaru w 'a' (BRAK = 255, udział 0).
      ['a', wiersz([80, 40, 255], [200, 200, 0])],
      ['b', wiersz([60, 20, 30], [200, 200, 200])],
    ]),
    nieudane: new Set(opcje.nieudane ?? []),
    filtr: (id) => opcje.filtry?.[id] ?? null,
    skala: () => (opcje.skale === false ? null : SKALA),
  }
}

const wagi = { a: 1, b: 1 }

describe('policzWynikiMapy', () => {
  it('średnia ważona warstw na heksach r10, brak danych to null, nie 0', () => {
    const w = policzWynikiMapy(dane(), wagi, {}, 'wynik', [])
    assert.ok(w)
    assert.equal(w.heksy.get('h1'), 70)
    assert.equal(w.heksy.get('h2'), 30)
    // h3: tylko warstwa b niesie połowę wagi (próg 0,5) – wynik z b, nie z zera.
    assert.equal(w.heksy.get('h3'), 30)
    assert.equal(w.liczbaAdresow, 60)
    assert.equal(w.wykluczoneHeksy.size, 0)
    assert.equal(w.podpis, 'Wynik tej okolicy')
    assert.equal(w.brakWarstwy, false)
    assert.equal(w.filtryGotowe, true)
  })

  it('warstwa mapy: nazwa w podpisie; nieobecna – wszystkie heksy null i brakWarstwy', () => {
    const d = dane()
    const a = policzWynikiMapy(d, wagi, {}, 'a', [])
    assert.equal(a?.podpis, 'Nazwa a')
    assert.equal(a?.heksy.get('h1'), 80)
    assert.equal(a?.heksy.get('h3'), null)
    const brak = policzWynikiMapy(d, wagi, {}, 'nie-ma', [])
    assert.equal(brak?.brakWarstwy, true)
    assert.deepEqual([...(brak?.heksy.values() ?? [])], [null, null, null])
  })

  it('czeka (null), gdy liczona warstwa nie ma jeszcze pliku, ale nie gdy się nie wczytała', () => {
    const d = dane()
    const bezB = { ...d, warstwy: new Map([['a', d.warstwy.get('a') as WarstwaHeksow]]) }
    assert.equal(policzWynikiMapy(bezB, wagi, {}, 'wynik', []), null)
    const nieudane = policzWynikiMapy({ ...bezB, nieudane: new Set(['b']) }, wagi, {}, 'wynik', [])
    assert.ok(nieudane)
    assert.equal(nieudane.heksy.get('h1'), 80)
  })

  it('ten sam obiekt przy tych samych wejściach', () => {
    const d = dane()
    const f: readonly TwardyFiltr[] = []
    const k = {}
    assert.equal(policzWynikiMapy(d, wagi, k, 'wynik', f), policzWynikiMapy(d, wagi, k, 'wynik', f))
  })

  it('filtr wyklucza heks, gdy wszystkie adresy go naruszają; niegotowy filtr nie wyklucza', () => {
    // Warstwa b, „max 25" przy skali 0–100: h1 (min 55) i h3 (min 30) naruszają wszędzie, h2 (20) spełnia.
    const filtr: FiltrHeksow = {
      udzial: Uint8Array.from([200, 200, 200]),
      min: Uint8Array.from([55, 20, 30]),
      max: Uint8Array.from([65, 20, 40]),
    }
    const f: readonly TwardyFiltr[] = [{ id: 'b', warunek: 'max', prog: 25 }]
    const gotowe = policzWynikiMapy(dane({ filtry: { b: filtr } }), wagi, {}, 'wynik', f)
    assert.ok(gotowe)
    assert.deepEqual([...gotowe.wykluczoneHeksy].sort(), ['h1', 'h3'])
    assert.equal(gotowe.liczbaWykluczonych, 40)
    assert.equal(gotowe.filtryGotowe, true)
    // Heks wykluczony zachowuje swój wynik (mapa rysuje go szrafurą).
    assert.equal(gotowe.heksy.get('h1'), 70)

    const bezPliku = policzWynikiMapy(dane(), wagi, {}, 'wynik', f)
    assert.ok(bezPliku)
    assert.equal(bezPliku.wykluczoneHeksy.size, 0)
    assert.equal(bezPliku.filtryGotowe, false)
    const bezSkali = policzWynikiMapy(
      dane({ filtry: { b: filtr }, skale: false }),
      wagi,
      {},
      'wynik',
      f,
    )
    assert.equal(bezSkali?.filtryGotowe, false)
  })

  it('filtr nieobecnej warstwy nie wyklucza i nie blokuje gotowości', () => {
    const f: readonly TwardyFiltr[] = [{ id: 'obca', warunek: 'max', prog: 1 }]
    const w = policzWynikiMapy(dane(), wagi, {}, 'wynik', f)
    assert.equal(w?.filtryGotowe, true)
    assert.equal(w?.liczbaWykluczonych, 0)
  })
})

// ── Zgodność na prawdziwych danych Krakowa ───────────────────────────────────────────────

const KAT = new URL('../../public/dane/', import.meta.url)
const INDEKS_PLIK = new URL('kompakt/indeks.json', KAT)
const indeksKrakowa: IndeksKompaktu | null = existsSync(INDEKS_PLIK)
  ? (JSON.parse(readFileSync(INDEKS_PLIK, 'utf8')) as IndeksKompaktu)
  : null
const MOZNA =
  Boolean(indeksKrakowa?.rozszerzenia?.length) && existsSync(new URL('adresy.json', KAT))

function kwantyl(posortowane: number[], p: number): number {
  return posortowane[Math.min(posortowane.length - 1, Math.floor(p * posortowane.length))] as number
}

describe('zgodność z pełnymi danymi Krakowa', { skip: !MOZNA }, () => {
  it('średnia heksów r10 z kompaktu vs średnia po adresach (rozkład różnic)', async () => {
    const indeks = indeksKrakowa as IndeksKompaktu
    // Manifest.json nie leży w repo; meta warstw niesie sam indeks kompaktu (te same pola).
    const manifest = {
      wskazniki: Object.values(indeks.wskazniki).map((w) => w.meta),
    } as unknown as Manifest
    const adresy = JSON.parse(readFileSync(new URL('adresy.json', KAT), 'utf8')) as {
      kolumny: { h3: string[]; id: string[] }
    }
    const { wagi: wagiP, kierunki } = ustawieniaPersony('rodzina', 'kupuje', manifest.wskazniki)
    const podst = podstawaZPliku(
      await rozpakuj(readFileSync(new URL(`kompakt/${indeks.heksy.plik}`, KAT))),
    )
    const warstwy = new Map<string, WarstwaHeksow>()
    const wskazniki = []
    for (const m of manifest.wskazniki) {
      const wpis = indeks.wskazniki[m.id]
      if (!wpis || (wagiP[m.id] ?? 0) <= 0) continue
      warstwy.set(
        m.id,
        warstwaZPliku(await rozpakuj(readFileSync(new URL(`kompakt/${wpis.heksy.plik}`, KAT)))),
      )
      const plik = JSON.parse(
        readFileSync(new URL(`wskazniki/${m.id}.json`, KAT), 'utf8'),
      ) as PlikWskaznika
      wskazniki.push(przygotujWskaznik(plik))
    }
    const d = {
      ...dane(),
      manifest,
      indeks,
      podstawa: podst,
      warstwy,
      filtr: () => null,
      skala: () => null,
    } as DaneHeksowGotowe
    const kompakt = policzWynikiMapy(d, wagiP, kierunki, 'wynik', [])
    assert.ok(kompakt)

    const grupy = grupujHeksy(adresy.kolumny.h3)
    const n = adresy.kolumny.id.length
    const pelne = mapaHeksow(
      zakryjBrakiHeksow(
        srednieHeksow(wynikiWszystkich(wskazniki, wagiP, kierunki, n), grupy),
        grupy,
        wskazniki,
        wagiP,
        kierunki,
        'wynik',
      ),
      grupy,
    )
    const roznice: number[] = []
    let tylkoJedno = 0
    for (const [h, v] of pelne) {
      const k = kompakt.heksy.get(h)
      if (k === undefined) continue
      if (v === null || k === null) {
        if (v !== k) tylkoJedno++
        continue
      }
      roznice.push(Math.abs(v - k))
    }
    roznice.sort((a, b) => a - b)
    assert.ok(roznice.length > 1000, 'za mało wspólnych heksów')
    const mediana = kwantyl(roznice, 0.5)
    const p95 = kwantyl(roznice, 0.95)
    console.info(
      `[zgodność] heksów: ${roznice.length}, mediana |Δ| = ${mediana.toFixed(2)}, p95 = ${p95.toFixed(2)}, max = ${(roznice.at(-1) as number).toFixed(2)}, null tylko po jednej stronie: ${tylkoJedno}`,
    )
    // Próg tylko jako alarm przy regresji; wynik raportujemy, nie wymagamy równości.
    assert.ok(mediana < 5, `mediana różnic ${mediana}`)
  })
})
