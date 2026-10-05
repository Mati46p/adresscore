// Logika zakładki Akwizycja (T056). Oczekiwania są policzone RĘCZNIE (komentarze przy asercjach), a
// najważniejszy jest inwariant z CLAUDE.md „Liczby na ekranie”: segmenty jednej całości sumują się do
// 100 (± 0,1), a podstawą jest SUMA całości, nie największa pozycja. Przypadki brzegowe zadania: pusta
// odpowiedź, jedna pozycja, „(nieznany)”, suma 0. Losowe zestawy idą z generatora ziarnistego, więc
// test jest deterministyczny.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { udzialy } from '../arytmetyka.ts'
import type {
  WierszKampanii,
  WierszKanalu,
  WierszKraju,
  WierszUrzadzenia,
  WierszZrodla,
} from '../typy.ts'
import {
  czolowkaKrajow,
  KRAJ_NIEZNANY,
  nazwaKraju,
  OKNA_DNI,
  OKNO_DOMYSLNE,
  opisOkna,
  segmentyKanalow,
  sumaWizyt,
  wierszeKampanii,
  wierszeOdslonKanalow,
  wierszeUrzadzen,
  wierszeZrodel,
} from './akwizycja-dane.ts'

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
const kanal = (nazwa: string, wizyty: number, odslony = wizyty * 2): WierszKanalu => ({
  kanal: nazwa,
  wizyty,
  odslony,
})
const wartosci = (segmenty: readonly { wartosc: number | null }[]) => segmenty.map((s) => s.wartosc)
const procenty = (segmenty: readonly { wartosc: number | null }[]) => udzialy(segmenty, 'wartosc')

describe('okres', () => {
  it('7 i 30 dni, domyślnie 7; opis mówi o dobach warszawskich i niepełnej dzisiejszej', () => {
    assert.deepEqual([...OKNA_DNI], [7, 30])
    assert.equal(OKNO_DOMYSLNE, 7)
    assert.match(opisOkna(7), /7 dób warszawskich/)
    assert.match(opisOkna(30), /30 dób warszawskich/)
    assert.match(opisOkna(7), /niepełną/)
  })
})

describe('segmentyKanalow: pasek wizyt według kanału', () => {
  it('kolejność, etykiety i sloty kolorów wg nazwy.ts; kanał bez wizyt to prawdziwe 0, nie brak', () => {
    const segmenty = segmentyKanalow([
      kanal('wyszukiwarka', 30),
      kanal('bezposrednie', 50),
      kanal('social', 20),
    ])
    // Zawsze sześć znanych kanałów w stałej kolejności; „wewnętrzne” nie jest wejściem.
    assert.deepEqual(
      segmenty.map((s) => s.klucz),
      ['bezposrednie', 'wyszukiwarka', 'social', 'odeslanie', 'kampania', 'ai'],
    )
    assert.deepEqual(
      segmenty.map((s) => s.kolor),
      [1, 2, 3, 4, 5, 6],
    )
    assert.deepEqual(
      segmenty.map((s) => s.etykieta),
      [
        '(bezpośrednie)',
        'Wyszukiwarki',
        'Social media',
        'Odesłania z innych stron',
        'Kampanie',
        'Asystenci AI',
      ],
    )
    assert.deepEqual(wartosci(segmenty), [50, 30, 20, 0, 0, 0])
    // Razem 100 wizyt: 50 / 30 / 20 procent i trzy zera.
    assert.deepEqual(procenty(segmenty), [50, 30, 20, 0, 0, 0])
  })

  it('podstawą jest SUMA, nie największa pozycja: 90 i 10 to 90,0% i 10,0%, a nie 100% i 11,1%', () => {
    const segmenty = segmentyKanalow([kanal('bezposrednie', 90), kanal('social', 10)])
    assert.deepEqual(procenty(segmenty), [90, 0, 10, 0, 0, 0])
    assert.equal(sumaWizyt([kanal('bezposrednie', 90), kanal('social', 10)]), 100)
  })

  it('remis reszt: 1 / 1 / 1 to 33,4 / 33,3 / 33,3 i dokładnie 100,0 w sumie', () => {
    // 1000 jednostek po 0,1 pp: każdy dostaje 333, brakującą jedną bierze pierwszy (remis → kolejność).
    const segmenty = segmentyKanalow([
      kanal('bezposrednie', 1),
      kanal('wyszukiwarka', 1),
      kanal('social', 1),
    ])
    const p = procenty(segmenty)
    assert.deepEqual(p, [33.4, 33.3, 33.3, 0, 0, 0])
    assert.ok(Math.abs(suma(p) - 100) <= 0.1)
  })

  it('pusta odpowiedź: sześć zer w legendzie, suma 0, udziały puste (nie 0% i nie NaN)', () => {
    const segmenty = segmentyKanalow([])
    assert.equal(segmenty.length, 6)
    assert.deepEqual(wartosci(segmenty), [0, 0, 0, 0, 0, 0])
    assert.equal(sumaWizyt([]), 0)
    assert.deepEqual(procenty(segmenty), [null, null, null, null, null, null])
  })

  it('jedna pozycja dostaje całe 100,0%', () => {
    const p = procenty(segmentyKanalow([kanal('ai', 7)]))
    assert.deepEqual(p, [0, 0, 0, 0, 0, 100])
  })

  it('kanał nieznany frontowi nie znika: dochodzi na koniec, szary, malejąco wg wizyt', () => {
    const segmenty = segmentyKanalow([
      kanal('social', 10),
      kanal('newsletter', 4),
      kanal('poczta', 6),
    ])
    assert.deepEqual(
      segmenty.map((s) => s.klucz),
      [
        'bezposrednie',
        'wyszukiwarka',
        'social',
        'odeslanie',
        'kampania',
        'ai',
        'poczta',
        'newsletter',
      ],
    )
    const ostatnie = segmenty.slice(-2)
    assert.deepEqual(
      ostatnie.map((s) => [s.etykieta, s.kolor, s.wartosc]),
      [
        ['poczta', 'szary', 6],
        ['newsletter', 'szary', 4],
      ],
    )
    // Razem 20: 10 / 6 / 4 → 50,0 / 30,0 / 20,0 (nieznane kanały wchodzą do podstawy).
    assert.deepEqual(
      procenty(segmenty).filter((x) => x !== 0),
      [50, 30, 20],
    )
  })

  it('kanał „wewnętrzne” jest pokazany tylko z wizytami (slot 7 po „ai”)', () => {
    const bez = segmentyKanalow([kanal('social', 5), kanal('wewnetrzne', 0)])
    assert.ok(!bez.some((s) => s.klucz === 'wewnetrzne'))
    const z = segmentyKanalow([kanal('social', 5), kanal('wewnetrzne', 3)])
    const wewnetrzne = z.at(-1)
    assert.equal(wewnetrzne?.klucz, 'wewnetrzne')
    assert.equal(wewnetrzne?.kolor, 7)
    assert.equal(wewnetrzne?.wartosc, 3)
  })

  it('niepoprawne liczby (NaN, ujemne) są brakiem pomiaru: wartość null i poza podstawą', () => {
    const segmenty = segmentyKanalow([
      kanal('bezposrednie', Number.NaN),
      kanal('social', -5),
      kanal('wyszukiwarka', 10),
    ])
    assert.deepEqual(wartosci(segmenty), [null, 10, null, 0, 0, 0])
    assert.deepEqual(procenty(segmenty), [null, 100, null, 0, 0, 0])
  })

  it('powtórzony kanał jest sumowany, nie gubiony', () => {
    const segmenty = segmentyKanalow([kanal('social', 5), kanal('social', 7)])
    assert.equal(segmenty.find((s) => s.klucz === 'social')?.wartosc, 12)
  })

  it('inwariant na losowych zestawach: udziały sumują się do 100 (± 0,1), a ich proporcje idą od SUMY', () => {
    const los = generator(20261005)
    const nazwy = ['bezposrednie', 'wyszukiwarka', 'social', 'odeslanie', 'kampania', 'ai']
    for (let n = 0; n < 300; n++) {
      const wiersze = nazwy.filter(() => los() < 0.7).map((k) => kanal(k, Math.floor(los() * 500)))
      const segmenty = segmentyKanalow(wiersze)
      const razem = sumaWizyt(wiersze)
      const p = procenty(segmenty)
      if (razem === 0) {
        assert.ok(
          p.every((x) => x === null),
          'przy sumie 0 żaden udział nie istnieje',
        )
        continue
      }
      assert.ok(Math.abs(suma(p) - 100) <= 0.1 + 1e-9, `zestaw ${n}: suma ${suma(p)}`)
      for (const [i, s] of segmenty.entries()) {
        const oczekiwany = ((s.wartosc ?? 0) / razem) * 100
        assert.ok(Math.abs((p[i] ?? 0) - oczekiwany) < 0.1 + 1e-9, `zestaw ${n}, ${s.klucz}`)
      }
    }
  })
})

describe('wierszeOdslonKanalow: głębokość wizyt według kanału', () => {
  it('tylko kanały z wizytami, w kolejności paska; odsłon na wizytę = odsłony ÷ wizyty (1 miejsce)', () => {
    const wiersze = wierszeOdslonKanalow([
      kanal('social', 3, 10),
      kanal('bezposrednie', 4, 4),
      kanal('ai', 0, 0),
    ])
    assert.deepEqual(
      wiersze.map((w) => w.klucz),
      ['bezposrednie', 'social'],
    )
    // 4 / 4 = 1,0; 10 / 3 = 3,333… → 3,3.
    assert.deepEqual(
      wiersze.map((w) => [w.wizyty, w.odslony, w.odslonNaWizyte]),
      [
        [4, 4, 1],
        [3, 10, 3.3],
      ],
    )
    assert.deepEqual(
      wiersze.map((w) => w.kolor),
      [1, 3],
    )
  })

  it('niepoprawna liczba odsłon daje null (szare „brak danych”), nie 0', () => {
    const [wiersz] = wierszeOdslonKanalow([kanal('social', 3, Number.NaN)])
    assert.equal(wiersz?.odslony, null)
    assert.equal(wiersz?.odslonNaWizyte, null)
  })

  it('kanał nieznany frontowi jest w tabeli, szary i pod własną nazwą', () => {
    const [wiersz] = wierszeOdslonKanalow([kanal('poczta', 2, 6)])
    assert.deepEqual(
      [wiersz?.etykieta, wiersz?.kolor, wiersz?.odslonNaWizyte],
      ['poczta', 'szary', 3],
    )
  })

  it('pusta odpowiedź i same zera: brak wierszy', () => {
    assert.deepEqual(wierszeOdslonKanalow([]), [])
    assert.deepEqual(wierszeOdslonKanalow([kanal('social', 0, 0)]), [])
  })
})

describe('wierszeZrodel: udział od całości okresu, nie od sumy listy', () => {
  const zrodlo = (
    kanalZrodla: string,
    zrodloNazwa: string | null,
    sciezka: string | null,
    wizyty: number,
  ): WierszZrodla => ({ kanal: kanalZrodla, zrodlo: zrodloNazwa, sciezka, wizyty })

  it('wartości zastępcze z bazy i nulle dają ten sam wynik; sortowanie malejąco wg wizyt', () => {
    const wiersze = wierszeZrodel(
      [
        zrodlo('social', 'facebook', '/groups/adresscore', 30),
        zrodlo('kampania', null, null, 20),
        zrodlo('bezposrednie', '(bezpośrednie)', '(brak)', 50),
      ],
      200,
    )
    assert.deepEqual(
      wiersze.map((w) => [w.etykietaKanalu, w.zrodlo, w.sciezka, w.wizyty]),
      [
        ['(bezpośrednie)', '(bezpośrednie)', null, 50],
        ['Social media', 'facebook', '/groups/adresscore', 30],
        ['Kampanie', '(bezpośrednie)', null, 20],
      ],
    )
    // Lista to tylko 100 z 200 wizyt okresu: 50/200 = 25,0, 30/200 = 15,0, 20/200 = 10,0 (a nie 50/30/20%).
    assert.deepEqual(
      wiersze.map((w) => w.udzial),
      [25, 15, 10],
    )
  })

  it('całość ≤ 0 albo brak całości: udział null (szare „brak danych”), bez dzielenia przez zero', () => {
    const wejscie = [zrodlo('social', 'x.com', null, 5)]
    assert.equal(wierszeZrodel(wejscie, 0)[0]?.udzial, null)
    assert.equal(wierszeZrodel(wejscie, null)[0]?.udzial, null)
  })

  it('kolor idzie za kanałem; kanał nieznany frontowi jest szary', () => {
    const wiersze = wierszeZrodel(
      [zrodlo('wyszukiwarka', 'google', null, 9), zrodlo('poczta', 'mail.example', null, 3)],
      12,
    )
    assert.deepEqual(
      wiersze.map((w) => w.kolor),
      [2, 'szary'],
    )
    assert.equal(wiersze[1]?.etykietaKanalu, 'poczta')
  })

  it('remis wizyt zostaje w kolejności z bazy; klucze wierszy są unikalne także dla identycznych treści', () => {
    const wiersze = wierszeZrodel(
      [
        zrodlo('social', 'a.example', null, 5),
        zrodlo('social', 'b.example', null, 5),
        zrodlo('social', 'b.example', null, 5),
      ],
      15,
    )
    assert.deepEqual(
      wiersze.map((w) => w.zrodlo),
      ['a.example', 'b.example', 'b.example'],
    )
    assert.equal(new Set(wiersze.map((w) => w.klucz)).size, 3)
  })

  it('niepoprawna liczba wizyt: null na końcu listy, bez udziału', () => {
    const wiersze = wierszeZrodel(
      [zrodlo('social', 'x.com', null, Number.NaN), zrodlo('ai', 'chatgpt.com', null, 4)],
      4,
    )
    assert.deepEqual(
      wiersze.map((w) => [w.zrodlo, w.wizyty, w.udzial]),
      [
        ['chatgpt.com', 4, 100],
        ['x.com', null, null],
      ],
    )
  })

  it('pusta odpowiedź: brak wierszy', () => {
    assert.deepEqual(wierszeZrodel([], 10), [])
  })
})

describe('wierszeKampanii: udział od sumy wizyt kampanijnych', () => {
  const kampania = (
    s: string | null,
    m: string | null,
    c: string | null,
    wizyty: number,
  ): WierszKampanii => ({ utm_source: s, utm_medium: m, utm_campaign: c, wizyty })

  it('5 / 3 / 2 z 10 to 50,0 / 30,0 / 20,0 i sortowanie malejąco niezależnie od kolejności wejścia', () => {
    const wiersze = wierszeKampanii([
      kampania('newsletter', 'email', 'wrzesien', 2),
      kampania('facebook', 'cpc', 'lato', 5),
      kampania('facebook', 'cpc', 'zima', 3),
    ])
    assert.deepEqual(
      wiersze.map((w) => [w.zrodlo, w.medium, w.kampania, w.wizyty, w.udzial]),
      [
        ['facebook', 'cpc', 'lato', 5, 50],
        ['facebook', 'cpc', 'zima', 3, 30],
        ['newsletter', 'email', 'wrzesien', 2, 20],
      ],
    )
  })

  it('brak członu znacznika to „(brak)”, a link z samym utm_source nadal jest kampanią', () => {
    const [wiersz] = wierszeKampanii([kampania('tiktok', null, '', 4)])
    assert.deepEqual(
      [wiersz?.zrodlo, wiersz?.medium, wiersz?.kampania],
      ['tiktok', '(brak)', '(brak)'],
    )
    assert.equal(wiersz?.udzial, 100)
  })

  it('remis reszt: 1 / 1 / 1 to 33,4 / 33,3 / 33,3 i 100,0 w sumie', () => {
    const wiersze = wierszeKampanii([
      kampania('a', 'x', '1', 1),
      kampania('b', 'x', '2', 1),
      kampania('c', 'x', '3', 1),
    ])
    const p = wiersze.map((w) => w.udzial)
    assert.deepEqual(p, [33.4, 33.3, 33.3])
    assert.ok(Math.abs(suma(p) - 100) <= 0.1)
  })

  it('pusta odpowiedź: brak wierszy; suma 0: udziały null', () => {
    assert.deepEqual(wierszeKampanii([]), [])
    const zerowe = wierszeKampanii([kampania('a', 'b', 'c', 0)])
    assert.equal(zerowe[0]?.udzial, null)
  })
})

describe('nazwaKraju i czolowkaKrajow', () => {
  const kraj = (kod: string | null, wizyty: number): WierszKraju => ({
    kraj: kod as string,
    wizyty,
  })

  it('nazwa polska z kodem w nawiasie; kod nierozpoznany i „(nieznany)” wracają bez zmian', () => {
    assert.equal(nazwaKraju('PL'), 'Polska (PL)')
    assert.equal(nazwaKraju('DE'), 'Niemcy (DE)')
    assert.equal(nazwaKraju('XX'), 'XX')
    assert.equal(nazwaKraju(KRAJ_NIEZNANY), '(nieznany)')
    assert.equal(nazwaKraju('pl'), 'pl')
    assert.equal(nazwaKraju(''), '')
  })

  it('„(nieznany)” poza czołówką zostaje osobną pozycją; łącznie liczy WSZYSTKIE kraje', () => {
    const wynik = czolowkaKrajow(
      [
        kraj('PL', 100),
        kraj('DE', 40),
        kraj('GB', 20),
        kraj('US', 10),
        kraj('FR', 5),
        kraj(KRAJ_NIEZNANY, 3),
      ],
      3,
    )
    assert.deepEqual(
      wynik.wiersze.map((w) => [w.kod, w.wartosc]),
      [
        ['PL', 100],
        ['DE', 40],
        ['GB', 20],
        [KRAJ_NIEZNANY, 3],
      ],
    )
    // 100 + 40 + 20 + 10 + 5 + 3 = 178 (całość okresu, także to, czego tabela nie pokazuje).
    assert.equal(wynik.lacznie, 178)
    assert.equal(wynik.pozycji, 6)
    assert.equal(wynik.pominietych, 2)
    // Pominięte US (10) i FR (5): ogon ma 15 wizyt, a widoczne 163 (100 + 40 + 20 + 3), razem 178.
    assert.equal(wynik.wizytyPominietych, 15)
  })

  it('„(nieznany)” w czołówce nie jest dublowany', () => {
    const wynik = czolowkaKrajow([kraj('PL', 100), kraj(KRAJ_NIEZNANY, 50), kraj('DE', 10)], 2)
    assert.deepEqual(
      wynik.wiersze.map((w) => w.kod),
      ['PL', KRAJ_NIEZNANY],
    )
    assert.equal(wynik.pominietych, 1)
    assert.equal(wynik.wizytyPominietych, 10)
  })

  it('brak kodu kraju (null, pusty) to „(nieznany)” i łączy się z tą pozycją', () => {
    const wynik = czolowkaKrajow([kraj(null, 4), kraj('', 1), kraj(KRAJ_NIEZNANY, 6)], 10)
    assert.deepEqual(
      wynik.wiersze.map((w) => [w.kod, w.wartosc]),
      [[KRAJ_NIEZNANY, 11]],
    )
    assert.equal(wynik.lacznie, 11)
  })

  it('więcej miejsca niż krajów: wszystkie, nic pominięte; remis wizyt rozstrzyga kod kraju', () => {
    const wynik = czolowkaKrajow([kraj('DE', 5), kraj('AT', 5), kraj('PL', 9)], 15)
    assert.deepEqual(
      wynik.wiersze.map((w) => w.kod),
      ['PL', 'AT', 'DE'],
    )
    assert.equal(wynik.pominietych, 0)
    assert.equal(wynik.wizytyPominietych, 0)
  })

  it('pusta odpowiedź: zero pozycji, łącznie 0', () => {
    assert.deepEqual(czolowkaKrajow([], 15), {
      wiersze: [],
      lacznie: 0,
      pozycji: 0,
      pominietych: 0,
      wizytyPominietych: 0,
    })
  })

  it('etykieta wiersza to nazwa kraju, klucz to kod', () => {
    const [wiersz] = czolowkaKrajow([kraj('PL', 2)], 5).wiersze
    assert.deepEqual([wiersz?.klucz, wiersz?.etykieta], ['PL', 'Polska (PL)'])
  })
})

describe('wierszeUrzadzen', () => {
  const urzadzenie = (nazwaKlasy: string, wizyty: number): WierszUrzadzenia => ({
    urzadzenie: nazwaKlasy,
    wizyty,
  })

  it('polskie nazwy klas, malejąco wg wizyt; udziały z sumy dają 100,0', () => {
    const wiersze = wierszeUrzadzen([
      urzadzenie('desktop', 25),
      urzadzenie('mobile', 70),
      urzadzenie('tablet', 5),
    ])
    assert.deepEqual(
      wiersze.map((w) => [w.etykieta, w.wartosc]),
      [
        ['Telefon', 70],
        ['Komputer', 25],
        ['Tablet', 5],
      ],
    )
    // Razem 100: 70,0 / 25,0 / 5,0.
    assert.deepEqual(udzialy(wiersze, 'wartosc'), [70, 25, 5])
  })

  it('nieznana klasa wraca pod własną nazwą, powtórzona jest sumowana, remis rozstrzyga klucz', () => {
    const wiersze = wierszeUrzadzen([
      urzadzenie('smartwatch', 2),
      urzadzenie('inne', 1),
      urzadzenie('inne', 1),
    ])
    assert.deepEqual(
      wiersze.map((w) => [w.klucz, w.etykieta, w.wartosc]),
      [
        ['inne', 'Inne', 2],
        ['smartwatch', 'smartwatch', 2],
      ],
    )
  })

  it('pusta odpowiedź: brak wierszy', () => {
    assert.deepEqual(wierszeUrzadzen([]), [])
  })
})
