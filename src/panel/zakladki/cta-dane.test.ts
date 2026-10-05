// Układ danych zakładki „CTA” (T059). Oczekiwania policzone ręcznie. Pilnowane: klikalność to
// kliknięcia / wyświetlenia (nie odsłony strony), zbiorcza klikalność z SUM, dzielenie tylko przy
// dodatnim mianowniku, wskaźniki UX na 1000 odsłon ekranu, brak danych to null (nie 0).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WierszCtaMartwego, WierszCtaSekcji, WierszSygnaluUx } from '../typy.ts'
import {
  klikalnoscSekcji,
  liczbaZdarzen,
  MIN_WYSWIETLEN,
  martwePrzyciski,
  naTysiac,
  sygnalyUx,
} from './cta-dane.ts'

/** Spacja twarda z `Intl` (pl-PL) na zwykłą, żeby asercje nie zależały od wersji ICU. */
const zwykleSpacje = (tekst: string) => tekst.replaceAll(/[  ]/g, ' ')

const cta = (ekran: string, sekcja: string, wyswietlenia: number, klikniecia: number) =>
  ({ ekran, sekcja, wyswietlenia, klikniecia }) satisfies WierszCtaSekcji

describe('klikalnoscSekcji: kliknięcia / wyświetlenia przycisku', () => {
  const wiersze: WierszCtaSekcji[] = [
    cta('okolica', 'zrodla', 100, 10),
    cta('okolica', 'etykieta', 200, 50),
    cta('szukaj', 'pole', 500, 100),
    cta('okolica', 'rzadki', 2, 2),
    cta('okolica', 'mapa', 80, 40),
    cta('okolica', 'ponad', 60, 66),
    cta('okolica', 'zero', 0, 0),
  ]

  it('klikalność: 50/200 → 25, 10/100 → 10, 40/80 → 50; powyżej 100 jest możliwe (66/60 → 110)', () => {
    const wynik = klikalnoscSekcji(wiersze, 'okolica')
    const wg = Object.fromEntries(wynik.wiersze.map((w) => [w.sekcja, w.klikalnosc]))
    assert.equal(wg.etykieta, 25)
    assert.equal(wg.zrodla, 10)
    assert.equal(wg.mapa, 50)
    assert.equal(wg.ponad, 110)
    assert.equal(wg.rzadki, 100)
  })

  it('zero wyświetleń to null (brak danych), nie 0 i nie NaN', () => {
    const wynik = klikalnoscSekcji(wiersze, 'okolica')
    const zero = wynik.wiersze.find((w) => w.sekcja === 'zero')
    assert.equal(zero?.klikalnosc, null)
    assert.equal(zero?.malaProba, true)
  })

  it('kolejność: wiarygodne próby od najwyższej klikalności, potem mała próba wg wyświetleń', () => {
    const wynik = klikalnoscSekcji(wiersze, 'okolica')
    assert.deepEqual(
      wynik.wiersze.map((w) => w.sekcja),
      ['ponad', 'mapa', 'etykieta', 'zrodla', 'rzadki', 'zero'],
    )
    assert.deepEqual(
      wynik.wiersze.map((w) => w.malaProba),
      [false, false, false, false, true, true],
    )
  })

  it(`próg małej próby to ${MIN_WYSWIETLEN} wyświetleń włącznie: 50 jest wiarygodne, 49 nie`, () => {
    const wynik = klikalnoscSekcji(
      [cta('okolica', 'a', 50, 5), cta('okolica', 'b', 49, 49)],
      'okolica',
    )
    assert.deepEqual(
      wynik.wiersze.map((w) => [w.sekcja, w.malaProba]),
      [
        ['a', false],
        ['b', true],
      ],
    )
  })

  it('zbiorcza klikalność ekranu to Σ kliknięć / Σ wyświetleń: 168 / 442 → 38,0 (nie średnia z procentów)', () => {
    const { razem } = klikalnoscSekcji(wiersze, 'okolica')
    assert.equal(razem.wyswietlenia, 442)
    assert.equal(razem.klikniecia, 168)
    assert.equal(razem.klikalnosc, 38)
    assert.equal(razem.malaProba, false)
  })

  it('suma poniżej progu 50 wyświetleń też jest małą próbą (razem nie udaje wiarygodnej)', () => {
    const { razem } = klikalnoscSekcji(
      [cta('okolica', 'a', 20, 5), cta('okolica', 'b', 29, 1)],
      'okolica',
    )
    assert.equal(razem.wyswietlenia, 49)
    assert.equal(razem.malaProba, true)
    const graniczna = klikalnoscSekcji(
      [cta('okolica', 'a', 20, 5), cta('okolica', 'b', 30, 1)],
      'okolica',
    )
    assert.equal(graniczna.razem.malaProba, false)
  })

  it('klikalność NIE jest udziałem: kolumna nie sumuje się do 100%', () => {
    const suma = klikalnoscSekcji(wiersze, 'okolica').wiersze.reduce(
      (s, w) => s + (w.klikalnosc ?? 0),
      0,
    )
    assert.equal(suma, 295)
  })

  it('wybór ekranu odcina sekcje innych ekranów', () => {
    const wynik = klikalnoscSekcji(wiersze, 'szukaj')
    assert.deepEqual(
      wynik.wiersze.map((w) => w.sekcja),
      ['pole'],
    )
    assert.equal(wynik.razem.klikalnosc, 20)
  })

  it('remis klikalności rozstrzyga większa liczba wyświetleń, potem nazwa', () => {
    const wynik = klikalnoscSekcji(
      [cta('okolica', 'b', 100, 25), cta('okolica', 'a', 100, 25), cta('okolica', 'c', 200, 50)],
      'okolica',
    )
    assert.deepEqual(
      wynik.wiersze.map((w) => w.sekcja),
      ['c', 'a', 'b'],
    )
  })

  it('pusta odpowiedź i ekran bez danych: brak wierszy, razem 0 i klikalność null', () => {
    const pusto = {
      wiersze: [],
      razem: { wyswietlenia: 0, klikniecia: 0, klikalnosc: null, malaProba: true },
    }
    assert.deepEqual(klikalnoscSekcji([], 'okolica'), pusto)
    assert.deepEqual(klikalnoscSekcji(wiersze, 'biznes'), pusto)
  })

  it('liczby niepoprawne (NaN, ujemne) liczą się jako 0 i nie psują sum', () => {
    const wynik = klikalnoscSekcji(
      [cta('okolica', 'zle', Number.NaN, -3), cta('okolica', 'dobre', 100, 10)],
      'okolica',
    )
    assert.equal(wynik.razem.wyswietlenia, 100)
    assert.equal(wynik.razem.klikniecia, 10)
    assert.equal(wynik.razem.klikalnosc, 10)
  })
})

describe('naTysiac: dzielenie tylko przy dodatnim mianowniku', () => {
  it('liczy na 1000 odsłon z jednym miejscem po przecinku', () => {
    assert.equal(naTysiac(5, 2000), 2.5)
    assert.equal(naTysiac(1, 8), 125)
    assert.equal(naTysiac(1, 3), 333.3)
    assert.equal(naTysiac(0, 100), 0)
  })

  it('brak odsłon, brak licznika albo wartość niepoprawna to null', () => {
    assert.equal(naTysiac(3, 0), null)
    assert.equal(naTysiac(3, null), null)
    assert.equal(naTysiac(3, undefined), null)
    assert.equal(naTysiac(3, -10), null)
    assert.equal(naTysiac(null, 100), null)
    assert.equal(naTysiac(-1, 100), null)
    assert.equal(naTysiac(Number.NaN, 100), null)
    assert.equal(naTysiac(1, Number.POSITIVE_INFINITY), null)
  })
})

const sygnal = (ekran: string, rodzaj: string, ile: number, odslony: number) =>
  ({ ekran, rodzaj, ile, odslony_ekranu: odslony }) satisfies WierszSygnaluUx

describe('sygnalyUx: wskaźniki na 1000 odsłon ekranu', () => {
  const wiersze: WierszSygnaluUx[] = [
    sygnal('okolica', 'furia', 5, 2000),
    sygnal('okolica', 'martwy', 2, 2000),
    sygnal('szukaj', 'furia', 1, 400),
    sygnal('biznes', 'martwy', 4, 0),
    sygnal('miasto', 'inny', 9, 100),
  ]

  it('okolica: furia 5/2000 → 2,5; martwy 2/2000 → 1; razem 7/2000 → 3,5', () => {
    const okolica = sygnalyUx(wiersze).find((w) => w.ekran === 'okolica')
    assert.equal(okolica?.odslony, 2000)
    assert.deepEqual(okolica?.furia, { ile: 5, na1000: 2.5 })
    assert.deepEqual(okolica?.martwy, { ile: 2, na1000: 1 })
    assert.deepEqual(okolica?.razem, { ile: 7, na1000: 3.5 })
  })

  it('rodzaj bez wiersza przy znanym mianowniku to zmierzone zero, nie brak danych', () => {
    const szukaj = sygnalyUx(wiersze).find((w) => w.ekran === 'szukaj')
    assert.deepEqual(szukaj?.furia, { ile: 1, na1000: 2.5 })
    assert.deepEqual(szukaj?.martwy, { ile: 0, na1000: 0 })
    assert.deepEqual(szukaj?.razem, { ile: 1, na1000: 2.5 })
  })

  it('ekran bez odsłon w oknie: liczby zdarzeń zostają, wskaźniki to null (nie Infinity)', () => {
    const biznes = sygnalyUx(wiersze).find((w) => w.ekran === 'biznes')
    assert.equal(biznes?.odslony, 0)
    assert.deepEqual(biznes?.martwy, { ile: 4, na1000: null })
    assert.deepEqual(biznes?.razem, { ile: 4, na1000: null })
  })

  it('kolejność: od największego łącznego wskaźnika, ekran bez mianownika na końcu', () => {
    assert.deepEqual(
      sygnalyUx(wiersze).map((w) => w.ekran),
      ['okolica', 'szukaj', 'biznes'],
    )
  })

  it('nieznany rodzaj sygnału nie tworzy ekranu', () => {
    assert.ok(!sygnalyUx(wiersze).some((w) => w.ekran === 'miasto'))
  })

  it('remis łącznego wskaźnika rozstrzyga większy ruch, potem nazwa ekranu', () => {
    const wynik = sygnalyUx([
      sygnal('b', 'furia', 1, 100),
      sygnal('a', 'furia', 1, 100),
      sygnal('c', 'furia', 2, 200),
    ])
    assert.deepEqual(
      wynik.map((w) => w.ekran),
      ['c', 'a', 'b'],
    )
  })

  it('pusta odpowiedź to pusta lista', () => {
    assert.deepEqual(sygnalyUx([]), [])
  })

  it('ekran niepoprawny w odpowiedzi (null) nie wywraca sortowania', () => {
    const wynik = sygnalyUx([
      sygnal('a', 'furia', 1, 100),
      { ekran: null as unknown as string, rodzaj: 'furia', ile: 1, odslony_ekranu: 100 },
    ])
    assert.equal(wynik.length, 2)
  })
})

describe('liczbaZdarzen: polska odmiana przy liczbie', () => {
  it('1 zdarzenie, 2–4 zdarzenia, 5+ zdarzeń', () => {
    assert.equal(liczbaZdarzen(1), '1 zdarzenie')
    for (const n of [2, 3, 4]) assert.equal(liczbaZdarzen(n), `${n} zdarzenia`)
    for (const n of [0, 5, 6, 10, 11]) assert.equal(liczbaZdarzen(n), `${n} zdarzeń`)
  })

  it('nastki (12–14) to zdarzeń, a 22–24 i 32 znów zdarzenia', () => {
    for (const n of [12, 13, 14, 112, 113]) assert.equal(liczbaZdarzen(n), `${n} zdarzeń`)
    for (const n of [22, 23, 24, 32, 102]) assert.equal(liczbaZdarzen(n), `${n} zdarzenia`)
    assert.equal(liczbaZdarzen(21), '21 zdarzeń')
  })

  it('duże liczby mają separator tysięcy', () => {
    assert.equal(zwykleSpacje(liczbaZdarzen(1000)), '1 000 zdarzeń')
    assert.equal(zwykleSpacje(liczbaZdarzen(2024)), '2 024 zdarzenia')
  })
})

describe('martwePrzyciski', () => {
  const martwy = (ekran: string, sekcja: string, cel: string, wyswietlenia: number) =>
    ({ ekran, sekcja, cel, wyswietlenia }) satisfies WierszCtaMartwego

  it('sortuje od najczęściej wyświetlanych, remis zachowuje kolejność z bazy', () => {
    const wynik = martwePrzyciski([
      martwy('okolica', 'zrodla', 'a', 60),
      martwy('okolica', 'mapa', 'b', 100),
      martwy('szukaj', 'pole', 'c', 60),
    ])
    assert.deepEqual(
      wynik.map((w) => w.cel),
      ['b', 'a', 'c'],
    )
  })

  it('wiersz o niepoprawnej liczbie wyświetleń odpada', () => {
    const wynik = martwePrzyciski([
      martwy('okolica', 'a', 'x', Number.NaN),
      martwy('okolica', 'a', 'y', -5),
      martwy('okolica', 'a', 'z', 50),
    ])
    assert.deepEqual(
      wynik.map((w) => w.cel),
      ['z'],
    )
  })

  it('pusta odpowiedź to pusta lista', () => {
    assert.deepEqual(martwePrzyciski([]), [])
  })
})
