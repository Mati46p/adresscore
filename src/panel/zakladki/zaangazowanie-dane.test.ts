// Układ danych zakładki „Zaangażowanie” (T058). Najważniejsze są inwarianty z CLAUDE.md „Liczby na
// ekranie”: udziały jednej całości sumują się do 100,0, podstawa to SUMA, zasięg sekcji nie jest
// udziałem, a brak danych to null. Oczekiwania policzone ręcznie, losowe zestawy z generatora
// ziarnistego (test deterministyczny).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WierszSekcji } from '../typy.ts'
import {
  etykietaSciezki,
  etykietaSekcji,
  KLUCZ_ZBIORCZEGO,
  listaZUdzialami,
  opcjeEkranow,
  opisPodstawyUdzialu,
  sekcjeEkranu,
  WYJSCIE,
  wybierzEkran,
} from './zaangazowanie-dane.ts'

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

interface Poz {
  nazwa: string
  ile: number | null
}
const ile = (p: Poz) => p.ile
const nazwa = (p: Poz) => p.nazwa
const LISTA = { maks: 15, limitZapytania: 200 }
/** Spacja twarda z `Intl` (pl-PL) na zwykłą, żeby asercje nie zależały od wersji ICU. */
const zwykleSpacje = (tekst: string | null) => (tekst ?? '').replaceAll(/[  ]/g, ' ')
const dziesiate = (liczby: readonly (number | null)[]) =>
  Math.round(liczby.reduce<number>((s, n) => s + (n ?? 0), 0) * 10)

describe('etykietaSekcji', () => {
  it('pusty klucz to „(bez sekcji)”, a nie pusta komórka', () => {
    assert.equal(etykietaSekcji(''), '(bez sekcji)')
  })

  it('klucz bez nazwy w mapie wraca sam (sekcja, której panel nie zna, ma być widoczna)', () => {
    assert.equal(etykietaSekcji('klucz_ktorego_nie_ma_w_mapie'), 'klucz_ktorego_nie_ma_w_mapie')
    assert.equal(etykietaSekcji('(brak pomiaru)'), '(brak pomiaru)')
  })
})

describe('opcjeEkranow i wybierzEkran', () => {
  it('znane ekrany z sekcjami idą pierwsze w ustalonej kolejności, reszta alfabetycznie', () => {
    assert.deepEqual(opcjeEkranow(['szukaj', 'miasto', 'okolica', 'okolica', 'katalog']), [
      'okolica',
      'szukaj',
      'katalog',
      'miasto',
    ])
    assert.deepEqual(opcjeEkranow(['biznes', 'porownanie']), ['porownanie', 'biznes'])
  })

  it('pusta lista ekranów daje pustą listę opcji', () => {
    assert.deepEqual(opcjeEkranow([]), [])
  })

  it('nieznany ekran z bazy nie znika z przełącznika', () => {
    assert.deepEqual(opcjeEkranow(['okolica', 'nowy_ekran']), ['okolica', 'nowy_ekran'])
  })

  it('wybierzEkran: wybrany z danymi wygrywa, brak danych w oknie cofa do pierwszego', () => {
    assert.equal(wybierzEkran('szukaj', ['okolica', 'szukaj']), 'szukaj')
    assert.equal(wybierzEkran('biznes', ['okolica', 'szukaj']), 'okolica')
    assert.equal(wybierzEkran(null, ['okolica', 'szukaj']), 'okolica')
    assert.equal(wybierzEkran('okolica', []), null)
    assert.equal(wybierzEkran(null, []), null)
  })
})

describe('listaZUdzialami: podstawa to SUMA, segmenty dają 100,0', () => {
  it('pusta odpowiedź: brak wierszy, podstawa 0, lista kompletna', () => {
    const lista = listaZUdzialami<Poz>([], ile, nazwa, LISTA)
    assert.deepEqual(lista.wiersze, [])
    assert.equal(lista.podstawa, 0)
    assert.equal(lista.kompletna, true)
  })

  it('jedna pozycja ma 100% (całość to ona sama)', () => {
    const lista = listaZUdzialami([{ nazwa: 'a', ile: 7 }], ile, nazwa, LISTA)
    assert.equal(lista.wiersze.length, 1)
    assert.equal(lista.wiersze[0]?.udzial, 100)
    assert.equal(lista.podstawa, 7)
  })

  it('5, 3, 2 z bazy w dowolnej kolejności to 50 / 30 / 20 i sortowanie malejąco', () => {
    const lista = listaZUdzialami(
      [
        { nazwa: 'c', ile: 2 },
        { nazwa: 'a', ile: 5 },
        { nazwa: 'b', ile: 3 },
      ],
      ile,
      nazwa,
      LISTA,
    )
    assert.deepEqual(
      lista.wiersze.map((w) => [w.klucz, w.wartosc, w.udzial]),
      [
        ['a', 5, 50],
        ['b', 3, 30],
        ['c', 2, 20],
      ],
    )
    assert.equal(lista.podstawa, 10)
  })

  it('największa pozycja NIE dostaje 100%: 90 i 10 to 90 i 10', () => {
    const lista = listaZUdzialami(
      [
        { nazwa: 'duza', ile: 90 },
        { nazwa: 'mala', ile: 10 },
      ],
      ile,
      nazwa,
      LISTA,
    )
    assert.deepEqual(
      lista.wiersze.map((w) => w.udzial),
      [90, 10],
    )
  })

  it('trzy równe części domykają się do 100,0 (33,4 / 33,3 / 33,3), remis zachowuje kolejność z bazy', () => {
    const lista = listaZUdzialami(
      [
        { nazwa: 'x', ile: 1 },
        { nazwa: 'y', ile: 1 },
        { nazwa: 'z', ile: 1 },
      ],
      ile,
      nazwa,
      LISTA,
    )
    assert.deepEqual(
      lista.wiersze.map((w) => w.udzial),
      [33.4, 33.3, 33.3],
    )
    assert.equal(dziesiate(lista.wiersze.map((w) => w.udzial)), 1000)
  })

  it('ogon dłuższy niż maks + 1 zwija się do wiersza „pozostałe” na końcu, a suma nadal daje 100,0', () => {
    // Wartości 1..20 w odwróconej kolejności: 15 największych zostaje (20..6), reszta 5+4+3+2+1 = 15.
    const wejscie = Array.from({ length: 20 }, (_, i) => ({ nazwa: `p${i + 1}`, ile: i + 1 }))
    const lista = listaZUdzialami(wejscie, ile, nazwa, LISTA)
    assert.equal(lista.wiersze.length, 16)
    assert.equal(lista.podstawa, 210)
    const ostatni = lista.wiersze.at(-1)
    assert.equal(ostatni?.klucz, KLUCZ_ZBIORCZEGO)
    assert.equal(ostatni?.zbiorczy, true)
    assert.equal(ostatni?.pozycja, null)
    assert.equal(ostatni?.wartosc, 15)
    assert.equal(ostatni?.pozycji, 5)
    assert.equal(lista.wiersze[0]?.wartosc, 20)
    assert.equal(lista.wiersze[14]?.wartosc, 6)
    assert.equal(dziesiate(lista.wiersze.map((w) => w.udzial)), 1000)
    // Udział każdego wiersza odbiega od dokładnego (100 · wartość / 210) o mniej niż 0,1 pp.
    for (const w of lista.wiersze) {
      assert.ok(Math.abs((w.udzial ?? Number.NaN) - (100 * w.wartosc) / 210) < 0.1, w.klucz)
    }
  })

  it('dokładnie maks + 1 pozycji nie jest zwijane (zwinięcie jednego wiersza niczego nie oszczędza)', () => {
    const wejscie = Array.from({ length: 16 }, (_, i) => ({ nazwa: `p${i}`, ile: 16 - i }))
    const lista = listaZUdzialami(wejscie, ile, nazwa, LISTA)
    assert.equal(lista.wiersze.length, 16)
    assert.ok(lista.wiersze.every((w) => !w.zbiorczy))
    assert.equal(dziesiate(lista.wiersze.map((w) => w.udzial)), 1000)
  })

  it('lista obcięta limitem zapytania nie jest całością: bez udziałów i bez zwijania', () => {
    const wejscie = Array.from({ length: 5 }, (_, i) => ({ nazwa: `p${i}`, ile: 10 - i }))
    const lista = listaZUdzialami(wejscie, ile, nazwa, { maks: 2, limitZapytania: 5 })
    assert.equal(lista.kompletna, false)
    assert.equal(lista.wiersze.length, 5)
    assert.ok(lista.wiersze.every((w) => w.udzial === null && !w.zbiorczy))
    assert.equal(lista.podstawa, 10 + 9 + 8 + 7 + 6)
  })

  it('wartości niepoprawne (ujemna, NaN, null) odpadają i nie wchodzą do podstawy', () => {
    const lista = listaZUdzialami(
      [
        { nazwa: 'ok', ile: 4 },
        { nazwa: 'ujemna', ile: -1 },
        { nazwa: 'nan', ile: Number.NaN },
        { nazwa: 'brak', ile: null },
      ],
      ile,
      nazwa,
      LISTA,
    )
    assert.equal(lista.wiersze.length, 1)
    assert.equal(lista.wiersze[0]?.udzial, 100)
    assert.equal(lista.podstawa, 4)
  })

  it('suma zero → udziały null (nie 0 i nie NaN)', () => {
    const lista = listaZUdzialami(
      [
        { nazwa: 'a', ile: 0 },
        { nazwa: 'b', ile: 0 },
      ],
      ile,
      nazwa,
      LISTA,
    )
    assert.equal(lista.podstawa, 0)
    assert.deepEqual(
      lista.wiersze.map((w) => w.udzial),
      [null, null],
    )
  })

  it('inwariant na losowych zestawach: suma udziałów = 100,0, podstawa = suma wejścia', () => {
    const los = generator(20261005)
    for (let proba = 0; proba < 200; proba++) {
      const n = 1 + Math.floor(los() * 40)
      const wejscie = Array.from({ length: n }, (_, i) => ({
        nazwa: `p${i}`,
        ile: 1 + Math.floor(los() * 100),
      }))
      const maks = 1 + Math.floor(los() * 20)
      const lista = listaZUdzialami(wejscie, ile, nazwa, { maks, limitZapytania: 200 })
      const oczekiwanaSuma = wejscie.reduce((s, p) => s + p.ile, 0)
      assert.equal(lista.podstawa, oczekiwanaSuma, `proba ${proba}`)
      assert.equal(dziesiate(lista.wiersze.map((w) => w.udzial)), 1000, `proba ${proba}`)
      assert.equal(
        lista.wiersze.reduce((s, w) => s + w.wartosc, 0),
        oczekiwanaSuma,
        `proba ${proba}: wiersze (z „pozostałymi”) muszą pokrywać całość`,
      )
      assert.ok(lista.wiersze.length <= maks + 1, `proba ${proba}`)
    }
  })
})

describe('opisPodstawyUdzialu: podpis podstawy pod tabelą', () => {
  const lista = (wejscie: Poz[], opcje = LISTA) => listaZUdzialami(wejscie, ile, nazwa, opcje)

  it('lista kompletna: podstawa to suma, podana pełną liczbą z jednostką', () => {
    const opis = opisPodstawyUdzialu(
      lista([
        { nazwa: 'a', ile: 1200 },
        { nazwa: 'b', ile: 34 },
      ]),
      'sesji',
    )
    assert.equal(
      zwykleSpacje(opis),
      'Udział liczony od 1 234 sesji łącznie: to suma wszystkich pozycji okna, więc udziały dają 100%.',
    )
  })

  it('wiersz zbiorczy jest wymieniony w podpisie', () => {
    const wejscie = Array.from({ length: 20 }, (_, i) => ({ nazwa: `p${i}`, ile: i + 1 }))
    assert.match(opisPodstawyUdzialu(lista(wejscie), 'sesji') ?? '', /razem z wierszem „pozostałe”/)
  })

  it('lista przycięta limitem mówi, że nie zna całości; pusta nie ma podpisu; suma zero też mówi', () => {
    const wejscie = Array.from({ length: 5 }, (_, i) => ({ nazwa: `p${i}`, ile: i + 1 }))
    assert.match(
      opisPodstawyUdzialu(lista(wejscie, { maks: 15, limitZapytania: 5 }), 'sesji') ?? '',
      /nie znam całości/,
    )
    assert.equal(opisPodstawyUdzialu(lista([]), 'sesji'), null)
    assert.match(opisPodstawyUdzialu(lista([{ nazwa: 'a', ile: 0 }]), 'sesji') ?? '', /brak danych/)
  })
})

describe('etykietaSciezki', () => {
  const nazwaEkranu = (e: string) => ({ szukaj: 'Szukaj', okolica: 'Karta adresu' })[e] ?? e

  it('trzy ekrany to trzy nazwy ze strzałkami', () => {
    assert.equal(
      etykietaSciezki(['szukaj', 'okolica', 'porownanie'], nazwaEkranu),
      'Szukaj → Karta adresu → porownanie',
    )
  })

  it('wyjście po drugim kroku kończy ścieżkę', () => {
    assert.equal(
      etykietaSciezki(['szukaj', 'okolica', WYJSCIE], nazwaEkranu),
      'Szukaj → Karta adresu → (wyjście)',
    )
  })

  it('baza dopełnia krótką wizytę powtórzonym wyjściem: zwijamy je do jednego', () => {
    assert.equal(etykietaSciezki(['szukaj', WYJSCIE, WYJSCIE], nazwaEkranu), 'Szukaj → (wyjście)')
  })

  it('brakujący krok to „(brak)”, nie pusty napis', () => {
    assert.equal(
      etykietaSciezki([null, 'okolica', undefined], nazwaEkranu),
      '(brak) → Karta adresu → (brak)',
    )
    assert.equal(etykietaSciezki([], nazwaEkranu), '')
  })
})

function sekcja(
  ekran: string,
  nazwaSekcji: string,
  zSekcja: number,
  ekranu: number,
  mediana: number | null,
  pozycja: number | null,
): WierszSekcji {
  return {
    ekran,
    sekcja: nazwaSekcji,
    odslony_z_sekcja: zSekcja,
    odslony_ekranu: ekranu,
    mediana_ms: mediana,
    pozycja_med: pozycja,
  }
}

describe('sekcjeEkranu: zasięg to procent odsłon ekranu, nie udział', () => {
  const wiersze: WierszSekcji[] = [
    sekcja('okolica', 'zrodla', 30, 40, 4200, 3),
    sekcja('okolica', 'etykieta', 40, 40, 9000, 0),
    sekcja('szukaj', 'pole', 12, 20, 1500, 0),
    sekcja('okolica', 'mapa', 10, 40, null, 5),
    sekcja('okolica', 'bez-pozycji', 1, 40, 800, null),
  ]

  it('wybiera sekcje ekranu i układa je w kolejności dokumentu, brak pozycji na końcu', () => {
    const wynik = sekcjeEkranu(wiersze, 'okolica')
    assert.deepEqual(
      wynik.wiersze.map((w) => [w.kolejnosc, w.sekcja]),
      [
        [1, 'etykieta'],
        [2, 'zrodla'],
        [3, 'mapa'],
        [4, 'bez-pozycji'],
      ],
    )
  })

  it('zasięg = odsłony z sekcją / odsłony ekranu: 40/40 → 100, 30/40 → 75, 10/40 → 25, 1/40 → 2,5', () => {
    const wynik = sekcjeEkranu(wiersze, 'okolica')
    assert.deepEqual(
      wynik.wiersze.map((w) => w.zasieg),
      [100, 75, 25, 2.5],
    )
    assert.equal(wynik.odslonyEkranu, 40)
  })

  it('zasięgi NIE sumują się do 100% (każda sekcja ma własny procent tej samej całości)', () => {
    const suma = sekcjeEkranu(wiersze, 'okolica').wiersze.reduce((s, w) => s + (w.zasieg ?? 0), 0)
    assert.equal(suma, 202.5)
  })

  it('mediana czasu: liczba z pomiaru albo null (brak pomiaru nie jest zerem)', () => {
    const wynik = sekcjeEkranu(wiersze, 'okolica')
    assert.deepEqual(
      wynik.wiersze.map((w) => w.medianaMs),
      [9000, 4200, null, 800],
    )
  })

  it('remis pozycji rozstrzyga nazwa sekcji', () => {
    const wynik = sekcjeEkranu(
      [sekcja('okolica', 'b', 1, 2, 100, 1), sekcja('okolica', 'a', 1, 2, 100, 1)],
      'okolica',
    )
    assert.deepEqual(
      wynik.wiersze.map((w) => w.sekcja),
      ['a', 'b'],
    )
  })

  it('dzielenie przez zero: mianownik 0 daje zasięg null, nie NaN ani Infinity', () => {
    const wynik = sekcjeEkranu([sekcja('okolica', 'a', 3, 0, 100, 0)], 'okolica')
    assert.equal(wynik.wiersze[0]?.zasieg, null)
    assert.equal(wynik.odslonyEkranu, 0)
  })

  it('pusta odpowiedź i ekran bez danych: brak wierszy, mianownik null', () => {
    assert.deepEqual(sekcjeEkranu([], 'okolica'), { wiersze: [], odslonyEkranu: null })
    assert.deepEqual(sekcjeEkranu(wiersze, 'biznes'), { wiersze: [], odslonyEkranu: null })
  })

  it('wiersze podające różne mianowniki nie udają jednej podstawy', () => {
    const wynik = sekcjeEkranu(
      [sekcja('okolica', 'a', 1, 10, 100, 0), sekcja('okolica', 'b', 1, 12, 100, 1)],
      'okolica',
    )
    assert.equal(wynik.odslonyEkranu, null)
    assert.deepEqual(
      wynik.wiersze.map((w) => w.zasieg),
      [10, 8.3],
    )
  })

  it('jedna sekcja: kolejność 1, zasięg liczony wobec ekranu', () => {
    const wynik = sekcjeEkranu([sekcja('szukaj', 'pole', 12, 20, 1500, 0)], 'szukaj')
    assert.equal(wynik.wiersze.length, 1)
    assert.equal(wynik.wiersze[0]?.kolejnosc, 1)
    assert.equal(wynik.wiersze[0]?.zasieg, 60)
  })
})
