// Porównanie z kafli == porównanie z pełnych danych. Uruchom: node --test src/karta/porownanie/zKafli.test.ts
// Test zgodności jedzie na prawdziwych danych Krakowa i jest pomijany bez kompaktu z rozszerzeniami.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { Manifest } from '../../kontrakty/index.ts'
import { policzWykluczenia, type TwardyFiltr } from '../../wynik/filtry.ts'
import {
  kafelPunktu,
  pozycjaWKaflu,
  przypnijAdresy,
  skaleKafli,
  wczytajKafel,
  wyczyscKafle,
} from '../../wynik/kafle.ts'
import { type IndeksKompaktu, kolejnoscId, rozpakuj } from '../../wynik/kompakt.ts'
import { ladujDaneMiasta } from '../../wynik/ladowanieDanych.ts'
import { PERSONA_DOMYSLNA, PERSONY, ustawieniaPersony } from '../../wynik/persony.ts'
import { wynikAdresu } from '../../wynik/silnik.ts'
import { adresyZSzukaj, adresZKafla, kolejnoscZMapy } from './zKafli.ts'

const DANE = new URL('../../../public/dane/', import.meta.url)
const KOMPAKT = new URL('kompakt/', DANE)
const indeks = existsSync(new URL('indeks.json', KOMPAKT))
  ? (JSON.parse(readFileSync(new URL('indeks.json', KOMPAKT), 'utf8')) as IndeksKompaktu)
  : null
const gotowy =
  indeks?.rozszerzenia?.includes('i') === true &&
  indeks.rozszerzenia.includes('kolejnosc') &&
  existsSync(new URL('adresy.json', DANE))

describe('kolejnoscZMapy', () => {
  it('odwraca mapę i pomija adresy bez wpisu', () => {
    // adres 0 → kompakt 2, 1 → brak, 2 → 0, 3 → 1
    assert.deepEqual([...kolejnoscZMapy([2, -1, 0, 1])], [2, 3, 0])
  })
})

describe('porównanie z kafli – zgodność z pełnymi danymi (Kraków)', { skip: !gotowy }, () => {
  it('5 adresów: wynik, litera, pewność, warstwy i wykluczenia identyczne; lista z szukaj.bin', async () => {
    const ix = indeks as IndeksKompaktu
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
    const slowniki: Record<string, Record<string, string>> = {}
    for (const w of pelne.wskazniki)
      if (w.slownikEtykiet) slowniki[w.meta.id] = { ...w.slownikEtykiet }
    const skale = { ...skaleKafli(ix, skaleJson), slowniki }
    const pobierz = async (url: string) =>
      new Uint8Array(readFileSync(new URL(url.slice(url.indexOf('kafle/')), KOMPAKT)))
    const k = pelne.plikAdresow.kolumny
    // Pięć adresów rozrzuconych po całym mieście (różne kafle), deterministycznie.
    const porownanie = [3, 40_000, 90_000, 130_000, k.id.length - 2]
    wyczyscKafle()
    przypnijAdresy(porownanie)
    const kafle = new Map<number, Awaited<ReturnType<typeof wczytajKafel>>>()
    for (const i of porownanie) {
      const wpis = kafelPunktu(ix, k.lon[i] as number, k.lat[i] as number)
      assert.ok(wpis, `brak kafla dla adresu ${i}`)
      kafle.set(i, await wczytajKafel('/dane', wpis, skale, { pobierz }))
    }
    const filtr: TwardyFiltr = {
      id: manifest.wskazniki[0]?.id as string,
      warunek: 'min',
      prog: 50,
    } as unknown as TwardyFiltr
    const persony = [
      PERSONA_DOMYSLNA,
      (PERSONY.find((p) => p.id !== PERSONA_DOMYSLNA) ?? PERSONY[1])?.id,
    ]
    for (const persona of persony) {
      const { wagi, kierunki } = ustawieniaPersony(
        persona as (typeof PERSONY)[number]['id'],
        'kupuje',
        manifest.wskazniki,
      )
      const wykl = policzWykluczenia(pelne.wskazniki, [filtr], k.id.length)
      for (const i of porownanie) {
        const z = adresZKafla(kafle.get(i) ?? null, i, wagi, kierunki, [filtr])
        assert.ok(z, `adres ${i}`)
        assert.equal(z.adres.id, k.id[i])
        assert.equal(z.adres.i, i)
        assert.deepStrictEqual(
          z.wynik,
          wynikAdresu(i, pelne.wskazniki, wagi, kierunki),
          `adres ${i}`,
        )
        assert.equal(z.wykluczony, wykl.wykluczony[i] === 1, `wykluczony ${i}`)
        assert.equal(z.niewiadomy, wykl.niewiadomy[i] === 1, `niewiadomy ${i}`)
        assert.ok(pozycjaWKaflu(kafle.get(i) as never, i) >= 0)
      }
    }
    // Brak kafla nie jest zerem ani wyjątkiem.
    assert.equal(adresZKafla(null, 3, {}, {}, []), null)

    // Lista kandydatów z szukaj.bin: teksty i `i` takie jak w adresy.json.
    const id = await rozpakuj(readFileSync(new URL(ix.id.plik, KOMPAKT)))
    const kolejnosc = kolejnoscId(id)
    assert.ok(kolejnosc)
    const szukaj = adresyZSzukaj(
      await rozpakuj(readFileSync(new URL(ix.szukaj.plik, KOMPAKT))),
      kolejnosc,
    )
    assert.equal(szukaj.length, k.id.length)
    const poI = new Map(szukaj.map((a) => [a.i, a]))
    for (const i of porownanie) {
      const a = poI.get(i)
      assert.ok(a, `szukaj: brak ${i}`)
      assert.equal(a.miejscowosc, k.miejscowosc[i])
      assert.equal(a.ulica, k.ulica[i] ?? null)
      assert.equal(a.nr, k.nr[i])
      assert.equal(a.kod, k.kod[i] ?? null)
      assert.equal(a.dzielnica, k.dzielnica[i] ?? null)
      assert.equal(a.gmina, k.gmina[i])
      assert.equal(a.teryt, k.teryt[i])
    }
  })
})
