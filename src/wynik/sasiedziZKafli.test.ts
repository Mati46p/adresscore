// „Lepszy sąsiad” i karta adresu z kafli (#247, B7b). Uruchom: node --test src/wynik/sasiedziZKafli.test.ts
// Test zgodności jedzie na prawdziwych danych Krakowa (30 adresów) i jest pomijany, gdy kompakt nie ma
// `rozszerzenia` (stary format) albo nie ma plików.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { Adres, Manifest } from '../kontrakty/index.ts'
import { kafleWokol } from '../miasto3d/adresyZKafli.ts'
import type { TwardyFiltr } from './filtry.ts'
import {
  type KafelGotowy,
  kafelPunktu,
  pozycjaWKaflu,
  skaleKafli,
  wczytajKafel,
  wyczyscKafle,
} from './kafle.ts'
import type { IndeksKompaktu } from './kompakt.ts'
import { ladujDaneMiasta } from './ladowanieDanych.ts'
import { PERSONA_DOMYSLNA, PERSONY, ustawieniaPersony } from './persony.ts'
import { type AdresSasiada, lepsiSasiedzi, PROMIEN_SASIADA_M } from './sasiedzi.ts'
import { lepsiSasiedziZKafli, zbiorZKafli, zbiorZKafliPamiec } from './sasiedziZKafli.ts'
import { type WskaznikPrzygotowany, wynikAdresu } from './silnik.ts'

const DANE = new URL('../../public/dane/', import.meta.url)
const KOMPAKT = new URL('kompakt/', DANE)
const indeks = existsSync(new URL('indeks.json', KOMPAKT))
  ? (JSON.parse(readFileSync(new URL('indeks.json', KOMPAKT), 'utf8')) as IndeksKompaktu)
  : null
const gotowy =
  indeks?.rozszerzenia?.includes('i') === true && existsSync(new URL('adresy.json', DANE))

function adres(i: number): Adres {
  return {
    i,
    id: `a${i}`,
    miejscowosc: 'Kraków',
    ulica: 'Długa',
    nr: String(i),
    kod: null,
    dzielnica: null,
    gmina: 'Kraków',
    teryt: '0',
    lon: 19.9 + i / 1000,
    lat: 50.0,
    h3: '8a1f0000000ffff',
  }
}

function warstwa(id: string, wartosci: number[], etykiety?: (string | null)[]) {
  return {
    meta: { id },
    wartosci: Float64Array.from(wartosci),
    ...(etykiety ? { etykiety } : {}),
    skala: { min: 0, max: 1 },
  } as unknown as WskaznikPrzygotowany
}

function kafel(is: number[], wskazniki: WskaznikPrzygotowany[]): KafelGotowy {
  return {
    wpis: { h3: 'x' },
    adresy: is.map(adres),
    wskazniki,
    pozycje: new Map(is.map((i, j) => [i, j])),
  } as unknown as KafelGotowy
}

describe('zbiorZKafli', () => {
  it('sortuje po Adres.i, zachowuje wartości i wstawia NaN tam, gdzie kafel nie ma warstwy', () => {
    const k1 = kafel([5, 2], [warstwa('a', [0.5, 0.2], ['pięć', 'dwa']), warstwa('b', [1, 2])])
    const k2 = kafel([9, 1], [warstwa('a', [0.9, 0.1])])
    const z = zbiorZKafli([k1, k2])
    assert.deepEqual(
      z.adresy.map((a) => a.i),
      [1, 2, 5, 9],
    )
    assert.equal(z.lokalny.get(5), 2)
    const a = z.wskazniki.find((w) => w.meta.id === 'a') as WskaznikPrzygotowany
    assert.deepEqual([...a.wartosci], [0.1, 0.2, 0.5, 0.9])
    assert.deepEqual(a.etykiety, [null, 'dwa', 'pięć', null])
    const b = z.wskazniki.find((w) => w.meta.id === 'b') as WskaznikPrzygotowany
    assert.ok(Number.isNaN(b.wartosci[0] as number), 'brak warstwy w kaflu to NaN, nigdy 0')
    assert.deepEqual([b.wartosci[1], b.wartosci[2]], [2, 1])
    assert.equal(z.poI[9]?.i, 9)
  })

  it('adres obecny w dwóch kaflach liczy się raz', () => {
    const w = [warstwa('a', [0.5])]
    const z = zbiorZKafli([kafel([3], w), kafel([3], w)])
    assert.equal(z.adresy.length, 1)
  })

  it('te same kafle dają ten sam obiekt (pamięć), inne – nowy', () => {
    const k1 = kafel([1], [warstwa('a', [1])])
    const k2 = kafel([2], [warstwa('a', [1])])
    assert.equal(zbiorZKafliPamiec([k1, k2]), zbiorZKafliPamiec([k1, k2]))
    assert.notEqual(zbiorZKafliPamiec([k1]), zbiorZKafliPamiec([k1, k2]))
  })

  it('adres spoza zbioru (kafel nie dotarł) to null, nie pusta lista', () => {
    const z = zbiorZKafli([kafel([1], [warstwa('a', [1])])])
    assert.equal(lepsiSasiedziZKafli(99, z, { wagi: {} }), null)
  })
})

describe('karta i lepsi sąsiedzi z kafli – zgodność z pełnymi danymi (Kraków)', {
  skip: !gotowy,
}, () => {
  it('30 adresów: rozbicie wyniku i lista sąsiadów identyczne jak z pełnych danych', async () => {
    const ix = indeks as IndeksKompaktu
    wyczyscKafle()
    const pobierzJson = async (s: string) => {
      const sciezka = s.replace(/^\/dane\//, '')
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
    // Słowniki etykiet jak w aplikacji (`slowniki.<skrót>.json`); w razie ich braku z plików warstw.
    const slowniki: Record<string, Record<string, string>> = ix.slowniki
      ? JSON.parse(readFileSync(new URL(ix.slowniki.plik, KOMPAKT), 'utf8'))
      : {}
    if (!ix.slowniki)
      for (const w of pelne.wskazniki)
        if (w.slownikEtykiet) slowniki[w.meta.id] = { ...w.slownikEtykiet }
    const skale = { ...skaleKafli(ix, skaleJson), slowniki }
    const pobierz = async (url: string) =>
      new Uint8Array(readFileSync(new URL(url.slice(url.indexOf('kafle/')), KOMPAKT)))
    const k = pelne.plikAdresow.kolumny
    const adresyPelne: AdresSasiada[] = k.id.map((_, i) => ({
      lon: k.lon[i] as number,
      lat: k.lat[i] as number,
      h3: k.h3[i] as string,
      miejscowosc: k.miejscowosc[i] ?? '',
      ulica: k.ulica[i] ?? null,
      nr: k.nr[i] ?? '',
    }))

    let ziarno = 4242
    const los = () => {
      ziarno = (ziarno * 1103515245 + 12345) % 2 ** 31
      return ziarno / 2 ** 31
    }
    const filtry: TwardyFiltr[] = [{ id: 'przystanek_odleglosc', warunek: 'max', prog: 150 }]
    const persony = [
      PERSONA_DOMYSLNA,
      (PERSONY.find((p) => p.id !== PERSONA_DOMYSLNA) ?? PERSONY[1])?.id,
    ]
    let sprawdzone = 0
    let zKandydatami = 0
    for (let n = 0; n < 30; n++) {
      const i = Math.floor(los() * k.id.length)
      const lon = k.lon[i] as number
      const lat = k.lat[i] as number
      const wpis = kafelPunktu(ix, lon, lat)
      assert.ok(wpis, `brak kafla adresu ${i}`)
      const kafle = await Promise.all(
        kafleWokol(ix, lon, lat, PROMIEN_SASIADA_M + 250).map((w) =>
          wczytajKafel('/dane', w, skale, { pobierz }),
        ),
      )
      const zbior = zbiorZKafli(kafle)
      const centralny = kafle.find((kf) => pozycjaWKaflu(kf, i) >= 0)
      assert.ok(centralny, `kafel adresu ${i} nie wszedł do zbioru`)
      for (const persona of persony) {
        const { wagi, kierunki } = ustawieniaPersony(
          persona as (typeof PERSONY)[number]['id'],
          'kupuje',
          manifest.wskazniki,
        )
        // Karta: rozbicie wyniku z kafla adresu == z pełnych danych.
        const zPelnych = wynikAdresu(i, pelne.wskazniki, wagi, kierunki)
        const zKafla = wynikAdresu(pozycjaWKaflu(centralny, i), centralny.wskazniki, wagi, kierunki)
        assert.deepStrictEqual({ ...zKafla, i }, zPelnych, `karta: adres ${i}, persona ${persona}`)
        // Lepsi sąsiedzi: bez filtrów i z filtrem.
        for (const f of [[], filtry]) {
          const oczekiwane = lepsiSasiedzi(i, adresyPelne, pelne.wskazniki, {
            wagi,
            kierunki,
            filtry: f,
          })
          const jest = lepsiSasiedziZKafli(i, zbior, { wagi, kierunki, filtry: f })
          assert.deepStrictEqual(jest, oczekiwane, `sąsiedzi: adres ${i}, persona ${persona}`)
          if (oczekiwane.kandydaci.length > 0) zKandydatami++
        }
      }
      sprawdzone++
    }
    assert.equal(sprawdzone, 30)
    assert.ok(zKandydatami > 0, 'żaden z adresów nie miał sąsiadów – test niczego nie sprawdza')
    console.log(`sąsiedzi z kafli: ${zKandydatami} z ${30 * 4} zestawów miało kandydatów`)
  })
})
