// Układ danych zakładki „Treść” (T060). Oczekiwania policzone ręcznie. Pilnowane: udziały ekranów
// domykają się do 100,0 (podstawa = suma), lejek 10 → 6 → 2 daje 100 / 60 / 20 od pierwszego i
// 100 / 60 / 33,3 od poprzedniego kroku, dzielenie przez zero to null, krok bez wiersza z bazy to
// brak danych (nie zero), frazy odrzucone nie mieszają się z frazami, link tylko w obrębie serwisu.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lejek } from '../arytmetyka.ts'
import { NAZWA_KROKU_LEJKA } from '../nazwy.ts'
import type { WierszBezWyniku, WierszLejka, WierszTopAdresu, WierszTopEkranu } from '../typy.ts'
import {
  bezWyniku,
  formatOstatnio,
  KROKI_LEJKA,
  krokiLejka,
  topAdresy,
  topEkrany,
  uwagiLejka,
  ZNACZNIK_ODRZUCONO,
} from './tresc-dane.ts'

const dziesiate = (liczby: readonly (number | null)[]) =>
  Math.round(liczby.reduce<number>((s, n) => s + (n ?? 0), 0) * 10)

const ekran = (nazwa: string, odslony: number, unikalni: number): WierszTopEkranu => ({
  ekran: nazwa,
  odslony,
  unikalni,
})

describe('topEkrany: udział w SUMIE odsłon wszystkich ekranów', () => {
  it('60 / 30 / 10 odsłon to 60 / 30 / 10 procent, niezależnie od kolejności z bazy', () => {
    const lista = topEkrany([
      ekran('porownanie', 10, 8),
      ekran('okolica', 60, 40),
      ekran('szukaj', 30, 25),
    ])
    assert.deepEqual(
      lista.wiersze.map((w) => [w.pozycja?.ekran, w.wartosc, w.udzial]),
      [
        ['okolica', 60, 60],
        ['szukaj', 30, 30],
        ['porownanie', 10, 10],
      ],
    )
    assert.equal(lista.podstawa, 100)
  })

  it('wiersz niesie oryginał, z którego komponent czyta unikalnych (bez sumowania ich)', () => {
    const lista = topEkrany([ekran('okolica', 60, 40), ekran('szukaj', 30, 25)])
    assert.deepEqual(
      lista.wiersze.map((w) => w.pozycja?.unikalni),
      [40, 25],
    )
  })

  it('trzy równe ekrany domykają się do 100,0 (33,4 / 33,3 / 33,3)', () => {
    const lista = topEkrany([ekran('a', 5, 1), ekran('b', 5, 1), ekran('c', 5, 1)])
    assert.deepEqual(
      lista.wiersze.map((w) => w.udzial),
      [33.4, 33.3, 33.3],
    )
    assert.equal(dziesiate(lista.wiersze.map((w) => w.udzial)), 1000)
  })

  it('jeden ekran ma 100%, a lista bez ruchu nie ma udziałów (null, nie 0)', () => {
    assert.equal(topEkrany([ekran('okolica', 7, 3)]).wiersze[0]?.udzial, 100)
    const zero = topEkrany([ekran('okolica', 0, 0), ekran('szukaj', 0, 0)])
    assert.deepEqual(
      zero.wiersze.map((w) => w.udzial),
      [null, null],
    )
    assert.equal(zero.podstawa, 0)
  })

  it('pusta odpowiedź to pusta lista z podstawą 0', () => {
    const lista = topEkrany([])
    assert.deepEqual(lista.wiersze, [])
    assert.equal(lista.podstawa, 0)
  })

  it('wszystkie ekrany są na liście (bez zwijania w „pozostałe”)', () => {
    const wejscie = Array.from({ length: 25 }, (_, i) => ekran(`e${i}`, i + 1, 1))
    const lista = topEkrany(wejscie)
    assert.equal(lista.wiersze.length, 25)
    assert.ok(lista.wiersze.every((w) => !w.zbiorczy))
    assert.equal(dziesiate(lista.wiersze.map((w) => w.udzial)), 1000)
  })
})

describe('topAdresy: link tylko w obrębie serwisu', () => {
  const adres = (sciezka: string, odslony: number, unikalni: number): WierszTopAdresu => ({
    sciezka,
    odslony,
    unikalni,
  })

  it('sortuje od najczęściej oglądanego (stabilnie) i zostawia pełne liczby', () => {
    const wynik = topAdresy([
      adres('/adres/a', 5, 4),
      adres('/adres/b', 9, 7),
      adres('/adres/c', 5, 5),
    ])
    assert.deepEqual(
      wynik.map((w) => [w.sciezka, w.odslony, w.unikalni]),
      [
        ['/adres/b', 9, 7],
        ['/adres/a', 5, 4],
        ['/adres/c', 5, 5],
      ],
    )
  })

  it('bezpieczna ścieżka dostaje href, niebezpieczna tylko treść (bez linku)', () => {
    const wynik = topAdresy([
      adres('/adres/ul-dluga-5', 9, 1),
      adres('javascript:alert(1)', 8, 1),
      adres('//evil.example/x', 7, 1),
      adres('/adres/a?x=1', 6, 1),
      adres('https://evil.example/', 5, 1),
    ])
    assert.deepEqual(
      wynik.map((w) => w.href),
      ['/adres/ul-dluga-5', null, null, null, null],
    )
    // Tekst niebezpiecznej ścieżki zostaje widoczny jako treść: admin ma zobaczyć, co przyszło.
    assert.equal(wynik[1]?.sciezka, 'javascript:alert(1)')
  })

  it('odsłony niepoprawne odpadają, brak unikalnych to null', () => {
    const wynik = topAdresy([
      adres('/adres/a', Number.NaN, 1),
      adres('/adres/b', -2, 1),
      { sciezka: '/adres/c', odslony: 3, unikalni: Number.NaN },
    ])
    assert.equal(wynik.length, 1)
    assert.equal(wynik[0]?.unikalni, null)
  })

  it('pusta odpowiedź to pusta lista', () => {
    assert.deepEqual(topAdresy([]), [])
  })
})

describe('bezWyniku: frazy osobno, zliczone dane osobowe osobno', () => {
  const fraza = (f: string, ile: number, ostatnio: string): WierszBezWyniku => ({
    fraza: f,
    ile,
    ostatnio,
  })

  it('frazy od najczęstszej, remis zostaje w kolejności z bazy; odrzucone poza rankingiem', () => {
    const wynik = bezWyniku([
      fraza('ul. długa', 5, '2026-10-05T10:00:00Z'),
      fraza(ZNACZNIK_ODRZUCONO, 3, '2026-10-05T12:00:00Z'),
      fraza('kraków', 9, '2026-10-04T08:00:00Z'),
      fraza('zakopane', 5, '2026-10-03T08:00:00Z'),
    ])
    assert.deepEqual(
      wynik.frazy.map((f) => [f.fraza, f.ile]),
      [
        ['kraków', 9],
        ['ul. długa', 5],
        ['zakopane', 5],
      ],
    )
    assert.deepEqual(wynik.odrzucone, { ile: 3, ostatnio: '2026-10-05T12:00:00Z' })
  })

  it('bez odrzuconych: odrzucone to null (nie wiersz z zerem)', () => {
    assert.equal(bezWyniku([fraza('a', 1, '2026-10-05T10:00:00Z')]).odrzucone, null)
  })

  it('same odrzucone: lista fraz pusta, ale wiersz odrzuconych jest', () => {
    const wynik = bezWyniku([fraza(ZNACZNIK_ODRZUCONO, 2, '2026-10-05T10:00:00Z')])
    assert.deepEqual(wynik.frazy, [])
    assert.equal(wynik.odrzucone?.ile, 2)
  })

  it('kilka wierszy odrzuconych sumuje się, a ostatnia data to nowsza', () => {
    const wynik = bezWyniku([
      fraza(ZNACZNIK_ODRZUCONO, 2, '2026-10-05T10:00:00Z'),
      fraza(ZNACZNIK_ODRZUCONO, 4, '2026-10-06T09:00:00Z'),
      fraza(ZNACZNIK_ODRZUCONO, 1, '2026-10-01T09:00:00Z'),
    ])
    assert.deepEqual(wynik.odrzucone, { ile: 7, ostatnio: '2026-10-06T09:00:00Z' })
  })

  it('liczba niepoprawna odpada, brak daty to null', () => {
    const wynik = bezWyniku([
      fraza('a', Number.NaN, '2026-10-05T10:00:00Z'),
      fraza('b', -1, '2026-10-05T10:00:00Z'),
      { fraza: 'c', ile: 2, ostatnio: '' },
    ])
    assert.deepEqual(
      wynik.frazy.map((f) => [f.fraza, f.ostatnio]),
      [['c', null]],
    )
  })

  it('pusta odpowiedź', () => {
    assert.deepEqual(bezWyniku([]), { frazy: [], odrzucone: null })
  })
})

describe('formatOstatnio: doba i godzina w Warszawie', () => {
  it('październik (czas letni, UTC+2): 12:30 UTC to 14:30', () => {
    assert.equal(formatOstatnio('2026-10-05T12:30:00Z'), '05.10, 14:30')
  })

  it('zima (UTC+1) i przejście przez północ: 23:30 UTC to 00:30 następnej doby', () => {
    assert.equal(formatOstatnio('2026-01-15T23:30:00Z'), '16.01, 00:30')
  })

  it('brak lub niepoprawna data to null, nie „Invalid Date”', () => {
    assert.equal(formatOstatnio(null), null)
    assert.equal(formatOstatnio(undefined), null)
    assert.equal(formatOstatnio(''), null)
    assert.equal(formatOstatnio('to nie data'), null)
  })
})

const wiersz = (krok: string, kolejnosc: number, sesje: number): WierszLejka => ({
  krok,
  kolejnosc,
  sesje,
})

describe('krokiLejka i lejek(): kroki liczone niezależnie na sesjach', () => {
  // 10 wyszukań, 6 kart, 2 porównania (spec, Historia 5, test niezależny).
  const dziesiec: WierszLejka[] = [
    wiersz('wyszukanie', 1, 10),
    wiersz('karta_adresu', 2, 6),
    wiersz('porownanie_dodaj', 3, 2),
    wiersz('warstwa_mapy', 4, 0),
    wiersz('tryb_biznes', 5, 0),
  ]

  it('zawsze pięć znanych kroków w stałej kolejności, z nazwami z słownika', () => {
    const kroki = krokiLejka(dziesiec)
    assert.deepEqual(
      kroki.map((k) => k.klucz),
      [...KROKI_LEJKA],
    )
    for (const krok of kroki) {
      assert.equal(krok.etykieta, NAZWA_KROKU_LEJKA[krok.klucz as keyof typeof NAZWA_KROKU_LEJKA])
    }
  })

  it('kolejność z bazy nie ma znaczenia: pierwszy krok to zawsze wyszukanie', () => {
    const odwrotnie = [...dziesiec].reverse()
    assert.deepEqual(
      krokiLejka(odwrotnie).map((k) => [k.klucz, k.wartosc]),
      [
        ['wyszukanie', 10],
        ['karta_adresu', 6],
        ['porownanie_dodaj', 2],
        ['warstwa_mapy', 0],
        ['tryb_biznes', 0],
      ],
    )
  })

  it('10 → 6 → 2: od pierwszego 100 / 60 / 20, od poprzedniego 100 / 60 / 33,3', () => {
    const wyniki = lejek(krokiLejka(dziesiec))
    assert.deepEqual(
      wyniki.map((w) => w.odPierwszego),
      [100, 60, 20, 0, 0],
    )
    // Pierwszy krok nie ma poprzedniego (null); „100” w specyfikacji to jego udział w sobie samym.
    assert.deepEqual(
      wyniki.map((w) => w.odPoprzedniego),
      [null, 60, 33.3, 0, null],
    )
  })

  it('dzielenie przez zero: krok po kroku z zerem sesji ma procent od poprzedniego null, nie NaN', () => {
    const wyniki = lejek(krokiLejka(dziesiec))
    assert.equal(wyniki[4]?.odPoprzedniego, null)
  })

  it('pierwszy krok z zerem sesji: wszystkie procenty null (nie 0 i nie Infinity)', () => {
    const wyniki = lejek(krokiLejka([wiersz('wyszukanie', 1, 0), wiersz('karta_adresu', 2, 5)]))
    assert.deepEqual(
      wyniki.map((w) => w.odPierwszego),
      [null, null, null, null, null],
    )
    assert.equal(wyniki[1]?.odPoprzedniego, null)
  })

  it('krok bez wiersza z bazy ma wartość null (brak pomiaru), a nie 0', () => {
    const kroki = krokiLejka([wiersz('wyszukanie', 1, 10), wiersz('karta_adresu', 2, 6)])
    assert.deepEqual(
      kroki.map((k) => k.wartosc),
      [10, 6, null, null, null],
    )
    const wyniki = lejek(kroki)
    assert.deepEqual(
      wyniki.map((w) => w.odPierwszego),
      [100, 60, null, null, null],
    )
  })

  it('jedna pozycja: samo wyszukanie to 100% od pierwszego', () => {
    const wyniki = lejek(krokiLejka([wiersz('wyszukanie', 1, 4)]))
    assert.equal(wyniki[0]?.odPierwszego, 100)
    assert.equal(wyniki[1]?.odPierwszego, null)
  })

  it('pusta odpowiedź: pięć kroków bez wartości', () => {
    const kroki = krokiLejka([])
    assert.equal(kroki.length, 5)
    assert.ok(kroki.every((k) => k.wartosc === null))
  })

  it('krok późniejszy może przekroczyć wcześniejszy i pierwszy: bez przycinania do 100%', () => {
    const wyniki = lejek(
      krokiLejka([
        wiersz('wyszukanie', 1, 10),
        wiersz('karta_adresu', 2, 12),
        wiersz('porownanie_dodaj', 3, 15),
      ]),
    )
    assert.deepEqual(
      wyniki.map((w) => w.odPierwszego),
      [100, 120, 150, null, null],
    )
    assert.equal(wyniki[2]?.odPoprzedniego, 125)
  })

  it('krok nieznany frontowi idzie za znanymi wg kolejnosc i jest widoczny', () => {
    const kroki = krokiLejka([
      ...dziesiec,
      wiersz('nowy_krok_b', 7, 1),
      wiersz('nowy_krok_a', 6, 3),
    ])
    assert.deepEqual(
      kroki.map((k) => k.klucz),
      [...KROKI_LEJKA, 'nowy_krok_a', 'nowy_krok_b'],
    )
    assert.deepEqual(
      kroki.slice(5).map((k) => [k.etykieta, k.wartosc]),
      [
        ['nowy_krok_a', 3],
        ['nowy_krok_b', 1],
      ],
    )
  })

  it('wartość niepoprawna z bazy to brak pomiaru (null)', () => {
    const kroki = krokiLejka([wiersz('wyszukanie', 1, Number.NaN), wiersz('karta_adresu', 2, -3)])
    assert.deepEqual(
      kroki.map((k) => k.wartosc),
      [null, null, null, null, null],
    )
  })
})

describe('uwagiLejka: reguła, a nie udawany spadek', () => {
  const kroki = (wartosci: (number | null)[]) =>
    krokiLejka(
      wartosci.flatMap((w, i) => {
        const krok = KROKI_LEJKA[i]
        return krok !== undefined && w !== null ? [wiersz(krok, i + 1, w)] : []
      }),
    )

  it('brak uwag, gdy żaden krok nie przekracza swojego odniesienia', () => {
    assert.deepEqual(uwagiLejka(kroki([10, 6, 2, 0, 0])), [])
    assert.deepEqual(uwagiLejka(kroki([10, 10, 10, 10, 10])), [])
  })

  it('karta adresu liczniejsza od wyszukań: uwaga z przykładem (link z wyszukiwarki internetowej)', () => {
    const uwagi = uwagiLejka(kroki([10, 12, 2, 0, 0]))
    assert.equal(uwagi.length, 1)
    assert.match(uwagi[0] ?? '', /Karta adresu/)
    assert.match(uwagi[0] ?? '', /12/)
    assert.match(uwagi[0] ?? '', /Wyszukanie/)
    assert.match(uwagi[0] ?? '', /wyszukiwarki internetowej/)
    assert.match(uwagi[0] ?? '', /niezależnie/)
  })

  it('krok po karcie liczniejszy od karty: odniesieniem jest karta, nie sąsiednia alternatywa', () => {
    // Warstwa mapy (30) przewyższa dodanie do porównania (10), ale to alternatywy; porównujemy z kartą (20).
    const uwagi = uwagiLejka(kroki([40, 20, 10, 30, 0]))
    assert.equal(uwagi.length, 1)
    assert.match(uwagi[0] ?? '', /Zmiana warstwy mapy/)
    assert.match(uwagi[0] ?? '', /Karta adresu/)
    assert.doesNotMatch(uwagi[0] ?? '', /Dodanie do porównania/)
  })

  it('kroki bez pomiaru (null) nie wywołują uwag', () => {
    assert.deepEqual(uwagiLejka(kroki([null, 6, null, null, null])), [])
    assert.deepEqual(uwagiLejka(krokiLejka([])), [])
  })
})
