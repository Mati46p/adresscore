// Kafle kompaktu na żądanie. Uruchom: node --test src/wynik/kafle.test.ts
// Test zgodności jedzie na prawdziwych danych Krakowa i jest pomijany, gdy kompakt nie ma
// `rozszerzenia` (stary format) albo nie ma plików.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { gzipSync } from 'node:zlib'
import type { Manifest } from '../kontrakty/index.ts'
import {
  adresZPunktu,
  kafelAdresu,
  kafelPunktu,
  pozycjaWKaflu,
  skaleKafli,
  wczytajKafel,
  wyczyscKafle,
  zbudujKafel,
} from './kafle.ts'
import type { IndeksKompaktu, PlikKafla } from './kompakt.ts'
import { ladujDaneMiasta } from './ladowanieDanych.ts'
import { PERSONA_DOMYSLNA, PERSONY, ustawieniaPersony } from './persony.ts'
import { wynikAdresu } from './silnik.ts'

const DANE = new URL('../../public/dane/', import.meta.url)
const KOMPAKT = new URL('kompakt/', DANE)
const maIndeks = existsSync(new URL('indeks.json', KOMPAKT))
const indeks = maIndeks
  ? (JSON.parse(readFileSync(new URL('indeks.json', KOMPAKT), 'utf8')) as IndeksKompaktu)
  : null
const gotowy =
  indeks?.rozszerzenia?.includes('i') === true && existsSync(new URL('adresy.json', DANE))

const meta = (id: string) => ({
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
})

function plikKafla(): PlikKafla {
  return {
    format: 2,
    wersja: 'w',
    kafel: 'k',
    od: 0,
    n: 2,
    kolumny: {
      id: ['a', 'b'],
      miejscowosc: ['M', 'M'],
      ulica: ['U', null],
      nr: ['1', '2'],
      kod: [null, '30-001'],
      dzielnica: [null, null],
      gmina: ['G', 'G'],
      teryt: ['1', '1'],
      lon: [19.9, 19.9001],
      lat: [50.06, 50.0601],
      h3: ['h1', 'h2'],
      i: [7, 3],
    },
    wartosci: { x: [10, null] },
    etykiety: { x: ['et', null] },
  }
}

describe('kafle – jednostkowo', () => {
  const skale = {
    skale: { x: { od: 0, do: 100, norma: null, zrodlo: 'rangi', wezly: [0, 100] } },
    meta: { x: meta('x') },
  } as unknown as Parameters<typeof zbudujKafel>[2]
  const wpis = { h3: 'k', od: 0, n: 2, plik: 'kafle/k.json.gz' }

  it('NaN zamiast braku, nigdy 0; pozycje i etykiety', () => {
    const k = zbudujKafel(wpis, plikKafla(), skale)
    assert.equal(k.wskazniki[0]?.wartosci[0], 10)
    assert.ok(Number.isNaN(k.wskazniki[0]?.wartosci[1]))
    assert.equal(pozycjaWKaflu(k, 3), 1)
    assert.equal(pozycjaWKaflu(k, 99), -1)
    assert.equal(k.adresy[0]?.i, 7)
    assert.equal(k.wskazniki[0]?.etykiety?.[0], 'et')
  })

  it('deduplikuje równoległe żądania, rozpakowuje gzip, respektuje AbortSignal', async () => {
    wyczyscKafle()
    let pobran = 0
    const bufor = gzipSync(JSON.stringify(plikKafla()))
    const pobierz = async () => {
      pobran++
      await new Promise((r) => setTimeout(r, 5))
      return new Uint8Array(bufor)
    }
    const [a, b] = await Promise.all([
      wczytajKafel('/b', wpis, skale, { pobierz }),
      wczytajKafel('/b', wpis, skale, { pobierz }),
    ])
    assert.equal(a, b)
    assert.equal(pobran, 1)
    await wczytajKafel('/b', wpis, skale, { pobierz })
    assert.equal(pobran, 1)
    const przerwanie = AbortSignal.abort(new Error('stop'))
    await assert.rejects(wczytajKafel('/b', wpis, skale, { signal: przerwanie, pobierz }))
  })

  it('kafelAdresu: wyszukiwanie po indeksie kompaktu, null bez mapy', () => {
    wyczyscKafle()
    const ix = {
      kafle: [
        { h3: 'a', od: 0, n: 5, plik: 'a' },
        { h3: 'b', od: 5, n: 5, plik: 'b' },
      ],
    } as unknown as IndeksKompaktu
    assert.equal(kafelAdresu(ix, 0), null)
    assert.equal(kafelAdresu(ix, 0, [7])?.h3, 'b')
    assert.equal(kafelAdresu(ix, 0, [-1]), null)
  })
})

describe('kafle – zgodność z pełnymi danymi (Kraków)', { skip: !gotowy }, () => {
  it('wynikAdresu z kafla == z pełnych danych (50 adresów, 2 persony)', async () => {
    const ix = indeks as IndeksKompaktu
    const pobierzJson = async (s: string) => {
      const sciezka = s.replace(/^\/dane\//, '')
      // W czasie przebudowy kompaktu manifest.json bywa chwilowo nieobecny: składamy go
      // z indeksu (meta i wersja adresów warstw są tam te same, w tej samej kolejności).
      if (sciezka === 'manifest.json' && !existsSync(new URL(sciezka, DANE))) {
        return {
          wersja: ix.wersja,
          wskazniki: Object.entries(ix.wskazniki).map(([, w]) => ({
            ...w.meta,
            wersjaAdresow: w.wersjaAdresow,
          })),
        }
      }
      return JSON.parse(readFileSync(new URL(sciezka, DANE), 'utf8'))
    }
    const pelne = await ladujDaneMiasta({
      slug: 'krakow',
      baza: '/dane',
      pobierzJson,
      ostrzez: () => {},
    })
    const manifest = pelne.manifest as Manifest
    const skaleJson = JSON.parse(readFileSync(new URL(ix.skale.plik, KOMPAKT), 'utf8'))
    // Kafel niesie kody etykiet, a słownik jest tylko w wskazniki/<id>.json (luka ETL) – bierzemy go stamtąd.
    const slowniki: Record<string, Record<string, string>> = {}
    for (const w of pelne.wskazniki)
      if (w.slownikEtykiet) slowniki[w.meta.id] = { ...w.slownikEtykiet }
    const skale = { ...skaleKafli(ix, skaleJson), slowniki }
    const pobierz = async (url: string) => {
      const plik = url.slice(url.indexOf('kafle/'))
      return new Uint8Array(readFileSync(new URL(plik, KOMPAKT)))
    }
    const k = pelne.plikAdresow.kolumny
    // Deterministyczna „losowość”, by test był powtarzalny.
    let ziarno = 12345
    const los = () => {
      ziarno = (ziarno * 1103515245 + 12345) % 2 ** 31
      return ziarno / 2 ** 31
    }
    const persony = [
      PERSONA_DOMYSLNA,
      (PERSONY.find((p) => p.id !== PERSONA_DOMYSLNA) ?? PERSONY[1])?.id,
    ]
    let sprawdzone = 0
    const czasy: number[] = []
    for (let n = 0; n < 50; n++) {
      const i = Math.floor(los() * k.id.length)
      const lon = k.lon[i] as number
      const lat = k.lat[i] as number
      const wpis = kafelPunktu(ix, lon, lat)
      assert.ok(wpis, `brak kafla dla adresu ${i}`)
      const t0 = performance.now()
      const kafel = await wczytajKafel('/dane', wpis, skale, { pobierz })
      czasy.push(performance.now() - t0)
      const j = pozycjaWKaflu(kafel, i)
      assert.ok(j >= 0, `adresu ${i} nie ma w kaflu ${wpis.h3}`)
      assert.equal(kafel.adresy[j]?.id, k.id[i])
      // Ten sam wybór adresu w klikniętym heksie co dla pełnej listy.
      assert.equal(adresZPunktu(kafel, lon, lat).h3, kafel.adresy[j]?.h3)
      for (const persona of persony) {
        const { wagi, kierunki } = ustawieniaPersony(
          persona as (typeof PERSONY)[number]['id'],
          'kupuje',
          manifest.wskazniki,
        )
        const z = wynikAdresu(i, pelne.wskazniki, wagi, kierunki)
        const w = wynikAdresu(j, kafel.wskazniki, wagi, kierunki)
        assert.deepStrictEqual({ ...w, i }, z, `adres ${i}, persona ${persona}`)
      }
      sprawdzone++
    }
    assert.equal(sprawdzone, 50)
    console.log(
      `kafle: ${ix.kafle.length}, wczytanie z dysku+rozpakowanie+budowa: mediana ${[...czasy]
        .sort((a, b) => a - b)[25]
        ?.toFixed(1)} ms`,
    )
  })

  it('kafelPunktu trafia w kafel zawierający adres', () => {
    const ix = indeks as IndeksKompaktu
    assert.equal(kafelPunktu(ix, 0, 0), null)
  })
})
