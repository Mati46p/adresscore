// Ranking ulic z kompaktu (#247, B5). Uruchom: node --test src/wynik/rankingKompakt.test.ts
// Zgodność z pełnymi danymi na prawdziwym Krakowie sprawdza `etl/ranking-zgodnosc.mjs` (poza verify).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cellToParent, latLngToCell } from 'h3-js'
import type { Adres, WskaznikMeta } from '../kontrakty/index.ts'
import type { PodstawaHeksow } from './heksy.ts'
import type { KafelGotowy } from './kafle.ts'
import type { IndeksKompaktu, KafelKompaktu } from './kompakt.ts'
import {
  kafelHeksu,
  planKafli,
  pozycjeZPrzyblizenia,
  przyblizenieUlic,
  rankingKompakt,
  rankingZKafli,
} from './rankingKompakt.ts'
import type { WskaznikPrzygotowany } from './silnik.ts'

const H1 = latLngToCell(50.06, 19.94, 10)
const H2 = latLngToCell(50.07, 19.95, 10)
const H3 = latLngToCell(50.08, 19.96, 10)
const H4 = latLngToCell(50.09, 19.97, 10)
const POZA = latLngToCell(10, 10, 10)

function podstawa(
  wiersze: { id: string; liczba: number; ulica: string; dzielnica: string }[],
): PodstawaHeksow {
  return {
    skalaOceny: 1,
    skalaUdzialu: 200,
    poziomy: {
      10: { heksy: wiersze.map((w) => w.id), liczba: wiersze.map((w) => w.liczba) },
      9: { heksy: [], liczba: [] },
      8: { heksy: [], liczba: [] },
    },
    od: new Uint32Array(wiersze.length),
    ulica: wiersze.map((w) => w.ulica),
    dzielnica: wiersze.map((w) => w.dzielnica),
  }
}

describe('przyblizenieUlic', () => {
  const p = podstawa([
    { id: H1, liczba: 10, ulica: 'Długa', dzielnica: 'I' },
    { id: H2, liczba: 30, ulica: 'Długa', dzielnica: 'I' },
    { id: H3, liczba: 5, ulica: 'Krótka', dzielnica: 'I' },
    { id: H4, liczba: 50, ulica: 'Wykluczona', dzielnica: 'II' },
  ])

  it('średnia ważona liczbą adresów, bez heksów wykluczonych i bez wyniku', () => {
    const k = przyblizenieUlic(p, {
      heksy: new Map<string, number | null>([
        [H1, 80],
        [H2, 40],
        [H3, null],
        [H4, 99],
      ]),
      wykluczoneHeksy: new Set([H4]),
    })
    assert.equal(
      k.length,
      1,
      'heks bez wyniku i wykluczony nie tworzą ulicy (brak danych to nie 0)',
    )
    assert.equal(k[0]?.nazwa, 'Długa')
    assert.equal(k[0]?.wynik, (80 * 10 + 40 * 30) / 40)
    assert.equal(k[0]?.liczbaAdresow, 40)
    assert.deepEqual(k[0]?.heksy, [H1, H2])
  })

  it('sortuje malejąco, tnie do limitu, pozycje przybliżone nie mają prawdziwego sluga', () => {
    const k = przyblizenieUlic(
      p,
      {
        heksy: new Map<string, number | null>([
          [H1, 50],
          [H2, 50],
          [H3, 50],
          [H4, 70],
        ]),
        wykluczoneHeksy: new Set(),
      },
      2,
    )
    assert.deepEqual(
      k.map((x) => x.nazwa),
      ['Wykluczona', 'Długa'],
    )
    const poz = pozycjeZPrzyblizenia(k, 1)
    assert.equal(poz.length, 1)
    assert.ok(poz[0]?.slug.startsWith('~'))
    assert.equal(poz[0]?.adresDoPorownania, -1)
  })
})

describe('plan kafli', () => {
  const kafle: KafelKompaktu[] = [
    { h3: cellToParent(H1, 8), res: 8, od: 0, n: 5, plik: 'kafle/a.json.gz' },
    { h3: cellToParent(cellToParent(H3, 8), 7), res: 7, od: 5, n: 5, plik: 'kafle/b.json.gz' },
  ]
  const indeks = { kafle } as unknown as IndeksKompaktu
  const kand = (nazwa: string, heksy: string[], wynik: number) => ({
    nazwa,
    okolica: 'I',
    heksy,
    liczbaAdresow: 1,
    wynik,
  })

  it('kafelHeksu: r8, a gdy go nie ma rodzic r7; poza kompaktem null', () => {
    assert.equal(kafelHeksu(indeks, H1)?.plik, 'kafle/a.json.gz')
    assert.equal(kafelHeksu(indeks, H3)?.plik, 'kafle/b.json.gz')
    assert.equal(kafelHeksu(indeks, POZA), null)
  })

  it('ulica wchodzi w całości albo wcale; limit liczy się z szacunku 70 KB na kafel', () => {
    const wszystko = planKafli(indeks, [kand('A', [H1], 3), kand('B', [H3], 2)], 1_500_000)
    assert.equal(wszystko.kafle.length, 2)
    assert.equal(wszystko.pokryci.length, 2)
    const ciasno = planKafli(indeks, [kand('A', [H1], 3), kand('B', [H3], 2)], 100_000)
    assert.equal(ciasno.kafle.length, 1)
    assert.deepEqual(
      ciasno.pokryci.map((k) => k.nazwa),
      ['A'],
    )
    const bezKafla = planKafli(indeks, [kand('X', [H1, POZA], 9)])
    assert.equal(bezKafla.pokryci.length, 0, 'ulica z heksem bez kafla nie jest pokryta')
  })
})

describe('dokładny etap', () => {
  const meta = {
    id: 'x',
    kategoria: 'spokoj',
    nazwa: 'x',
    opis: '',
    jednostka: '',
    kierunek: 'wiecej-lepiej',
    rozdzielczosc: 'adres',
    zrodla: [],
    zadanie: 0,
    zakres: [0, 100],
  } as unknown as WskaznikMeta
  const adres = (i: number, ulica: string, h3: string): Adres =>
    ({
      i,
      id: `a${i}`,
      miejscowosc: 'Kraków',
      ulica,
      nr: String(i),
      kod: null,
      dzielnica: 'I',
      gmina: 'Kraków',
      teryt: '1',
      lon: 0,
      lat: 0,
      h3,
    }) as Adres
  function kafel(wpis: KafelKompaktu, adresy: Adres[], wartosci: number[]): KafelGotowy {
    const wskaznik: WskaznikPrzygotowany = {
      meta,
      wartosci: Float64Array.from(wartosci),
      skala: { od: 0, do: 100, norma: null, zrodlo: 'zakres' },
    }
    return { wpis, adresy, wskazniki: [wskaznik], pozycje: new Map(adresy.map((a, j) => [a.i, j])) }
  }
  const wpis: KafelKompaktu = { h3: 'k', od: 0, n: 4, plik: 'k' }
  const heksy = new Map<string, number | null>([
    [H1, 70],
    [H2, null],
  ])
  const wejscie = {
    nazwy: null,
    wagi: { x: 1 },
    kierunki: {},
    warstwa: 'wynik',
    filtry: [],
    heksy,
  }

  it('średnia ocen adresów z danymi, adresDoPorownania to Adres.i, brak danych nie jest zerem', () => {
    const k = kafel(
      wpis,
      [
        adres(100, 'Długa', H1),
        adres(101, 'Długa', H1),
        adres(102, 'Krótka', H1),
        adres(103, 'Krótka', H2),
      ],
      [80, 60, 90, 10],
    )
    const r = rankingZKafli({ ...wejscie, kafle: [k] })
    // Adres 103 leży w heksie bez wyniku, więc nie obniża Krótkiej.
    assert.deepEqual(
      r.map((p) => [p.nazwa, p.wynik, p.liczbaAdresow, p.adresDoPorownania]),
      [
        ['Krótka', 90, 1, 102],
        ['Długa', 70, 2, 100],
      ],
    )
  })

  it('filtr wyklucza adresy, nazwy zawężają do kandydatów', () => {
    const k = kafel(wpis, [adres(1, 'Długa', H1), adres(2, 'Krótka', H1)], [20, 90])
    const zFiltrem = rankingZKafli({
      ...wejscie,
      kafle: [k],
      filtry: [{ id: 'x', warunek: 'max', prog: 50 }],
    })
    assert.deepEqual(
      zFiltrem.map((p) => p.nazwa),
      ['Długa'],
    )
    const zNazwami = rankingZKafli({ ...wejscie, kafle: [k], nazwy: new Set(['Długa']) })
    assert.deepEqual(
      zNazwami.map((p) => p.nazwa),
      ['Długa'],
    )
  })

  it('rankingKompakt: pobiera tylko kafle z planu, przerwanie odrzuca wynik', async () => {
    const kafle: KafelKompaktu[] = [{ h3: cellToParent(H1, 8), res: 8, od: 0, n: 2, plik: 'k1' }]
    const indeks = { kafle } as unknown as IndeksKompaktu
    const p = podstawa([{ id: H1, liczba: 2, ulica: 'Długa', dzielnica: 'I' }])
    const pobrane: string[] = []
    const wczytaj = async (w: KafelKompaktu) => {
      pobrane.push(w.plik)
      return kafel(w, [adres(1, 'Długa', H1), adres(2, 'Długa', H1)], [60, 80])
    }
    const opcje = {
      podstawa: p,
      indeks,
      wyniki: { heksy, wykluczoneHeksy: new Set<string>() },
      wagi: { x: 1 },
      kierunki: {},
      warstwa: 'wynik',
      filtry: [],
      wczytaj,
    }
    const w = await rankingKompakt(opcje)
    assert.deepEqual(pobrane, ['k1'])
    assert.equal(w.kafli, 1)
    assert.equal(w.ulice[0]?.wynik, 70)
    await assert.rejects(rankingKompakt({ ...opcje, signal: AbortSignal.abort(new Error('stop')) }))
  })
})
