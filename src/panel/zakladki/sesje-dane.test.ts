// Logika zakładki Sesje (T057). Oczekiwania policzone RĘCZNIE (komentarze przy asercjach). Pilnowane
// inwarianty z CLAUDE.md „Liczby na ekranie”: odsetki sesji idą od LICZBY SESJI, udziały przejść od
// SUMY przejść z danego ekranu (sumują się do 100 ± 0,1), brak sesji to `null`, nie 0.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { udzialy } from '../arytmetyka.ts'
import type { SesjePrzeglad, WierszPrzejscia, WierszUdostepnienia } from '../typy.ts'
import {
  ELEMENT_BEZ_ZNACZNIKA,
  grupujPrzejscia,
  kafleSesji,
  lacznieUdostepnien,
  SPOSOB_NIEZNANY,
  SPOSOBY_DOKONCZONE,
  udostepnieniaWgElementu,
  udostepnieniaWgSposobu,
  WYJSCIE,
} from './sesje-dane.ts'

/** Generator mulberry32: to samo ziarno daje ten sam ciąg, niezależnie od silnika JS. */
function generator(ziarno: number): () => number {
  let stan = ziarno >>> 0
  return () => {
    stan = (stan + 0x6d2b79f5) >>> 0
    let t = stan
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const suma = (liczby: readonly (number | null)[]) =>
  liczby.reduce<number>((s, n) => s + (n ?? 0), 0)

const przeglad = (nadpisz: Partial<SesjePrzeglad> = {}): SesjePrzeglad => ({
  sesje: 40,
  odslony: 100,
  mediana_stron: 2,
  srednia_stron: 2.5,
  mediana_czas_s: 12.4,
  p75_czas_s: 40,
  zaangazowane: 30,
  jednostronicowe: 10,
  ...nadpisz,
})

describe('kafleSesji: odsetki od LICZBY SESJI', () => {
  it('przypadek bazowy: 30 z 40 to 75,0%, 10 z 40 to 25,0%; czasy w ms (baza podaje sekundy)', () => {
    assert.deepEqual(kafleSesji(przeglad()), {
      sesje: 40,
      odslony: 100,
      medianaStron: 2,
      sredniaStron: 2.5,
      medianaCzasMs: 12_400,
      p75CzasMs: 40_000,
      zaangazowane: 30,
      zaangazowanePct: 75,
      jednostronicowe: 10,
      jednostronicowePct: 25,
    })
  })

  it('zaangażowane i jednostronicowe NIE są dopełnieniem: 30 + 20 z 40 to 75,0% i 50,0%', () => {
    const kafle = kafleSesji(przeglad({ zaangazowane: 30, jednostronicowe: 20 }))
    assert.equal(kafle?.zaangazowanePct, 75)
    assert.equal(kafle?.jednostronicowePct, 50)
  })

  it('zerowe zaangażowanie przy istniejących sesjach to zmierzone 0,0%, a nie brak danych', () => {
    const kafle = kafleSesji(przeglad({ sesje: 5, zaangazowane: 0, jednostronicowe: 5 }))
    assert.equal(kafle?.zaangazowanePct, 0)
    assert.equal(kafle?.jednostronicowePct, 100)
  })

  it('brak sesji (0, null, NaN, ujemne, brak odpowiedzi): null, czyli szare „brak danych”', () => {
    assert.equal(kafleSesji(przeglad({ sesje: 0 })), null)
    assert.equal(kafleSesji(przeglad({ sesje: Number.NaN })), null)
    assert.equal(kafleSesji(przeglad({ sesje: -3 })), null)
    assert.equal(kafleSesji(null), null)
    assert.equal(kafleSesji(undefined), null)
  })

  it('mediany `null` z bazy zostają `null` (nie zera), reszta kafli działa', () => {
    const kafle = kafleSesji(
      przeglad({
        mediana_stron: null,
        srednia_stron: null,
        mediana_czas_s: null,
        p75_czas_s: null,
      }),
    )
    assert.equal(kafle?.medianaStron, null)
    assert.equal(kafle?.sredniaStron, null)
    assert.equal(kafle?.medianaCzasMs, null)
    assert.equal(kafle?.p75CzasMs, null)
    assert.equal(kafle?.zaangazowanePct, 75)
  })

  it('sekundy na milisekundy bez błędu zmiennoprzecinkowego: 0,3 s to 300 ms, 59,96 s to 59960 ms', () => {
    assert.equal(kafleSesji(przeglad({ mediana_czas_s: 0.3 }))?.medianaCzasMs, 300)
    assert.equal(kafleSesji(przeglad({ p75_czas_s: 59.96 }))?.p75CzasMs, 59_960)
  })
})

describe('grupujPrzejscia: osobna całość dla każdego ekranu źródłowego', () => {
  const p = (skad: string, dokad: string, ile: number): WierszPrzejscia => ({ skad, dokad, ile })
  const przyklad: WierszPrzejscia[] = [
    p('szukaj', 'okolica', 60),
    p('szukaj', WYJSCIE, 40),
    p('okolica', 'okolica', 5),
    p('okolica', 'porownanie', 15),
    p('okolica', WYJSCIE, 30),
  ]

  it('grupy malejąco wg liczby przejść, cele malejąco; etykiety z nazwy.ts, ten sam ekran opisany', () => {
    const wynik = grupujPrzejscia(przyklad)
    assert.deepEqual(
      wynik.grupy.map((g) => [g.skad, g.etykieta, g.razem]),
      [
        ['szukaj', 'Szukaj', 100],
        ['okolica', 'Karta adresu', 50],
      ],
    )
    assert.deepEqual(
      wynik.grupy[0]?.cele.map((c) => [c.klucz, c.etykieta, c.wartosc]),
      [
        ['okolica', 'Karta adresu', 60],
        [WYJSCIE, WYJSCIE, 40],
      ],
    )
    assert.deepEqual(
      wynik.grupy[1]?.cele.map((c) => [c.etykieta, c.wartosc, c.wyjscie, c.tenSamEkran]),
      [
        [WYJSCIE, 30, true, false],
        ['Porównanie', 15, false, false],
        ['Karta adresu (ten sam ekran)', 5, false, true],
      ],
    )
    assert.equal(wynik.lacznie, 150)
    assert.equal(wynik.ekranow, 2)
  })

  it('udział celu to jego liczba ÷ WSZYSTKIE przejścia z ekranu: szukaj 60/40, okolica 60/30/10', () => {
    const [szukaj, okolica] = grupujPrzejscia(przyklad).grupy
    // Szukaj: razem 100 → 60,0 i 40,0. Okolica: razem 50 → 30/50, 15/50, 5/50 = 60,0, 30,0, 10,0.
    assert.deepEqual(udzialy(szukaj?.cele ?? [], 'wartosc'), [60, 40])
    assert.deepEqual(udzialy(okolica?.cele ?? [], 'wartosc'), [60, 30, 10])
  })

  it('przycięcie liczby tabel (`maksEkranow`) nie zmienia zawartości pozostałych ani sumy łącznej', () => {
    const wynik = grupujPrzejscia(przyklad, 1)
    assert.equal(wynik.grupy.length, 1)
    assert.equal(wynik.grupy[0]?.skad, 'szukaj')
    assert.equal(wynik.grupy[0]?.cele.length, 2)
    assert.equal(wynik.ekranow, 2)
    assert.equal(wynik.lacznie, 150)
    assert.equal(grupujPrzejscia(przyklad, 0).grupy.length, 0)
  })

  it('powtórzona para jest sumowana; liczby zerowe, ujemne i niepoprawne są pomijane', () => {
    const wynik = grupujPrzejscia([
      p('szukaj', 'okolica', 3),
      p('szukaj', 'okolica', 4),
      p('szukaj', 'metoda', 0),
      p('szukaj', 'katalog', -2),
      p('szukaj', 'miasto', Number.NaN),
    ])
    assert.deepEqual(
      wynik.grupy[0]?.cele.map((c) => [c.klucz, c.wartosc]),
      [['okolica', 7]],
    )
    assert.equal(wynik.lacznie, 7)
  })

  it('remis liczby przejść rozstrzyga nazwa, więc kolejność jest deterministyczna', () => {
    const wynik = grupujPrzejscia([p('metoda', 'szukaj', 2), p('katalog', 'szukaj', 2)])
    assert.deepEqual(
      wynik.grupy.map((g) => g.skad),
      ['katalog', 'metoda'],
    )
  })

  it('ekran nieznany frontowi nie znika: wraca pod własną nazwą; pusty klucz to „(brak)”', () => {
    const wynik = grupujPrzejscia([p('nowy_ekran', 'szukaj', 1), p('', 'szukaj', 1)])
    assert.deepEqual(
      wynik.grupy.map((g) => g.etykieta),
      ['(brak)', 'nowy_ekran'],
    )
  })

  it('pusta odpowiedź: zero grup, zero łącznie', () => {
    assert.deepEqual(grupujPrzejscia([]), { grupy: [], ekranow: 0, lacznie: 0 })
  })

  it('inwariant na losowych zestawach: `razem` = suma celów, udziały w grupie 100 (± 0,1), od SUMY grupy', () => {
    const los = generator(20261006)
    const ekrany = ['szukaj', 'okolica', 'porownanie', 'metoda', 'katalog', 'miasto', 'biznes']
    for (let n = 0; n < 200; n++) {
      const wiersze: WierszPrzejscia[] = []
      for (const skad of ekrany) {
        if (los() < 0.3) continue
        for (const dokad of [...ekrany, WYJSCIE]) {
          if (los() < 0.5) wiersze.push(p(skad, dokad, 1 + Math.floor(los() * 80)))
        }
      }
      const wynik = grupujPrzejscia(wiersze, 100)
      assert.equal(wynik.lacznie, suma(wiersze.map((w) => w.ile)), `zestaw ${n}: suma łączna`)
      for (const g of wynik.grupy) {
        assert.equal(g.razem, suma(g.cele.map((c) => c.wartosc)), `zestaw ${n}, ${g.skad}: razem`)
        const u = udzialy(g.cele, 'wartosc')
        assert.ok(Math.abs(suma(u) - 100) <= 0.1 + 1e-9, `zestaw ${n}, ${g.skad}: suma ${suma(u)}`)
        for (const [i, c] of g.cele.entries()) {
          const dokladny = (c.wartosc / g.razem) * 100
          assert.ok(Math.abs((u[i] ?? 0) - dokladny) < 0.1 + 1e-9, `zestaw ${n}, ${g.skad}`)
        }
      }
    }
  })
})

describe('udostępnienia', () => {
  const u = (element: string | null, kanal: string | null, ile: number): WierszUdostepnienia => ({
    element,
    kanal,
    ile,
  })
  const przyklad: WierszUdostepnienia[] = [
    u('karta', 'link', 3),
    u('karta', 'kopia', 2),
    u('karta', 'natywne', 1),
    u('karta', 'anulowano', 3),
    u('karta', 'blad', 1),
    u('porownanie', 'kopia', 4),
    u('porownanie', 'anulowano', 2),
  ]

  it('dokończone to link, kopiowanie i menu systemowe', () => {
    assert.deepEqual([...SPOSOBY_DOKONCZONE], ['link', 'kopia', 'natywne'])
  })

  it('według sposobu: sumy po elementach (kopia 6, anulowano 5, link 3, błąd 1, menu 1), razem 16', () => {
    // kopia 2 + 4, anulowano 3 + 2, link 3, natywne 1, blad 1; remis 1 : 1 rozstrzyga klucz (blad < natywne).
    assert.deepEqual(
      udostepnieniaWgSposobu(przyklad).map((w) => [w.klucz, w.etykieta, w.wartosc]),
      [
        ['kopia', 'Kopiowanie', 6],
        ['anulowano', 'Anulowano', 5],
        ['link', 'Link', 3],
        ['blad', 'Błąd', 1],
        ['natywne', 'Menu systemowe', 1],
      ],
    )
    assert.equal(lacznieUdostepnien(przyklad), 16)
  })

  it('według elementu: odsetek dokończeń = dokończone ÷ WSZYSTKIE próby elementu', () => {
    // karta: próby 3 + 2 + 1 + 3 + 1 = 10, dokończone 3 + 2 + 1 = 6 → 60,0%.
    // porownanie: próby 4 + 2 = 6, dokończone 4 → 66,666… → 66,7%.
    assert.deepEqual(
      udostepnieniaWgElementu(przyklad).map((w) => [
        w.element,
        w.proby,
        w.dokonczone,
        w.odsetekDokonczen,
      ]),
      [
        ['karta', 10, 6, 60],
        ['porownanie', 6, 4, 66.7],
      ],
    )
  })

  it('element z samymi anulowaniami ma odsetek 0,0% (zmierzone zero), nie „brak danych”', () => {
    const [wiersz] = udostepnieniaWgElementu([u('karta', 'anulowano', 2)])
    assert.deepEqual([wiersz?.proby, wiersz?.dokonczone, wiersz?.odsetekDokonczen], [2, 0, 0])
  })

  it('sposób nieznany to próba, ale nie dokończenie (odsetek jest podłogą)', () => {
    const [wiersz] = udostepnieniaWgElementu([u('karta', 'link', 1), u('karta', 'nowy_sposob', 1)])
    assert.deepEqual([wiersz?.proby, wiersz?.dokonczone, wiersz?.odsetekDokonczen], [2, 1, 50])
  })

  it('brak znacznika elementu i sposobu: wartości zastępcze, nie gubienie wierszy', () => {
    const wiersze = udostepnieniaWgElementu([u(null, null, 2)])
    assert.deepEqual([wiersze[0]?.element, wiersze[0]?.proby], [ELEMENT_BEZ_ZNACZNIKA, 2])
    assert.deepEqual(
      udostepnieniaWgSposobu([u(null, null, 2)]).map((w) => [w.klucz, w.wartosc]),
      [[SPOSOB_NIEZNANY, 2]],
    )
  })

  it('liczby zerowe, ujemne i niepoprawne są pomijane; pusta odpowiedź daje puste listy i 0', () => {
    const smieci = [u('a', 'link', 0), u('a', 'link', -1), u('a', 'link', Number.NaN)]
    assert.deepEqual(udostepnieniaWgElementu(smieci), [])
    assert.deepEqual(udostepnieniaWgSposobu(smieci), [])
    assert.equal(lacznieUdostepnien(smieci), 0)
    assert.deepEqual(udostepnieniaWgElementu([]), [])
    assert.equal(lacznieUdostepnien([]), 0)
  })

  it('inwariant na losowych zestawach: dokończone ≤ próby, suma prób elementów = łącznie, odsetek ∈ [0, 100]', () => {
    const los = generator(20261007)
    const sposoby = ['link', 'kopia', 'natywne', 'anulowano', 'blad']
    for (let n = 0; n < 200; n++) {
      const wiersze: WierszUdostepnienia[] = []
      for (const element of ['karta', 'porownanie', 'biznes']) {
        for (const sposob of sposoby) {
          if (los() < 0.6) wiersze.push(u(element, sposob, 1 + Math.floor(los() * 30)))
        }
      }
      const elementy = udostepnieniaWgElementu(wiersze)
      assert.equal(suma(elementy.map((w) => w.proby)), lacznieUdostepnien(wiersze), `zestaw ${n}`)
      assert.equal(
        suma(udostepnieniaWgSposobu(wiersze).map((w) => w.wartosc)),
        lacznieUdostepnien(wiersze),
        `zestaw ${n}: sposoby`,
      )
      for (const w of elementy) {
        assert.ok(w.dokonczone <= w.proby, `zestaw ${n}, ${w.element}`)
        assert.ok((w.odsetekDokonczen ?? -1) >= 0 && (w.odsetekDokonczen ?? 101) <= 100)
      }
    }
  })
})
