// Arytmetyka prezentacji panelu (T030). Najważniejszy jest inwariant z CLAUDE.md „Liczby na ekranie”:
// segmenty jednej całości sumują się do 100%, a podstawą jest SUMA, nie największa pozycja.
// Losowe zestawy idą z generatora ziarnistego, więc test jest deterministyczny i powtarzalny.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  BRAK_DANYCH,
  czyLiczba,
  formatCzasu,
  formatLiczby,
  formatMs,
  formatProcent,
  formatWitalu,
  lejek,
  METRYKI_WITALI,
  ocenaWitalu,
  PROGI_WITALI,
  procentOd,
  udzialy,
  zaokraglij,
  zmianaProcentowa,
} from './arytmetyka.ts'

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
/** Spacja twarda z `Intl` (pl-PL) na zwykłą, żeby asercje nie zależały od wersji ICU. */
const zwykleSpacje = (tekst: string) => tekst.replaceAll(/[  ]/g, ' ')

interface Wiersz {
  nazwa: string
  ile: number
}

describe('udzialy: podstawa to SUMA całości', () => {
  it('prosty przypadek: 3 pozycje dają 50 / 30 / 20 i sumują się do 100', () => {
    const wynik = udzialy(
      [
        { nazwa: 'a', ile: 50 },
        { nazwa: 'b', ile: 30 },
        { nazwa: 'c', ile: 20 },
      ],
      'ile',
    )
    assert.deepEqual(wynik, [50, 30, 20])
  })

  it('największa pozycja NIE dostaje 100%: ludzie 90, boty 10 to 90 i 10, a nie 100 i 11,1', () => {
    const [ludzie, boty] = udzialy(
      [
        { nazwa: 'ludzie', ile: 90 },
        { nazwa: 'boty', ile: 10 },
      ],
      'ile',
    )
    assert.equal(ludzie, 90)
    assert.equal(boty, 10)
  })

  it('metoda największej reszty domyka do 100,0: trzy równe części to 33,4 / 33,3 / 33,3', () => {
    const wynik = udzialy([{ ile: 1 }, { ile: 1 }, { ile: 1 }], 'ile')
    // Brakującą jednostkę dostaje pierwszy wiersz (remis reszt rozstrzyga kolejność wejściowa).
    assert.deepEqual(wynik, [33.4, 33.3, 33.3])
    assert.equal(Math.round(suma(wynik) * 10), 1000)
  })

  it('suma 0 → wszystkie udziały null (nie 0, nie NaN)', () => {
    assert.deepEqual(udzialy([{ ile: 0 }, { ile: 0 }], 'ile'), [null, null])
    assert.deepEqual(udzialy([], 'ile' as never), [])
  })

  it('wiersz z zerem przy dodatniej sumie ma udział 0 (to faktyczne zero, nie brak danych)', () => {
    assert.deepEqual(udzialy([{ ile: 5 }, { ile: 0 }], 'ile'), [100, 0])
  })

  it('wartości niepoprawne (ujemna, NaN, ±∞, null) dostają null i nie wchodzą do podstawy', () => {
    const wynik = udzialy(
      [
        { ile: 60 },
        { ile: -5 },
        { ile: Number.NaN },
        { ile: Number.POSITIVE_INFINITY },
        { ile: null },
        { ile: 40 },
      ],
      'ile',
    )
    assert.deepEqual(wynik, [60, null, null, null, null, 40])
    assert.equal(Math.round(suma(wynik) * 10), 1000)
  })

  it('klucz może być funkcją (wartość wyliczona z wiersza)', () => {
    const wynik = udzialy(
      [
        { a: 1, b: 1 },
        { a: 3, b: 5 },
      ],
      (w) => w.a + w.b,
    )
    assert.deepEqual(wynik, [20, 80])
  })

  it('inna precyzja: 0 miejsc daje liczby całkowite sumujące się do 100', () => {
    const wynik = udzialy([{ ile: 1 }, { ile: 1 }, { ile: 1 }], 'ile', 0)
    assert.deepEqual(wynik, [34, 33, 33])
    assert.equal(suma(wynik), 100)
  })

  it('INWARIANT (500 losowych zestawów): suma udziałów = 100 ± 0,1, brak NaN, żaden udział nie od maksimum', () => {
    const los = generator(20261005)
    let zestawowZSuma = 0
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(los() * 12)
      const wiersze: Wiersz[] = Array.from({ length: n }, (_, j) => ({
        nazwa: `w${j}`,
        // Mieszanka: zera, małe liczby, bardzo duże rozrzuty (wielkość jednej pozycji >> reszty).
        ile: los() < 0.2 ? 0 : Math.floor(los() ** 3 * 1_000_000),
      }))
      const razem = suma(wiersze.map((w) => w.ile))
      const wynik = udzialy(wiersze, 'ile')

      assert.equal(wynik.length, wiersze.length)
      if (razem === 0) {
        assert.ok(
          wynik.every((u) => u === null),
          `suma 0 → same null (zestaw ${i})`,
        )
        continue
      }
      zestawowZSuma++
      assert.ok(
        wynik.every((u) => u !== null && Number.isFinite(u) && u >= 0 && u <= 100),
        `zestaw ${i}: udział poza 0..100 albo NaN: ${JSON.stringify(wynik)}`,
      )
      assert.ok(Math.abs(suma(wynik) - 100) <= 0.1, `zestaw ${i}: suma ${suma(wynik)}`)
      // Dokładnie 100,0 na precyzji jednego miejsca (a nie tylko „blisko”).
      assert.equal(Math.round(suma(wynik) * 10), 1000, `zestaw ${i}`)
      wiersze.forEach((w, j) => {
        const dokladny = (w.ile / razem) * 100
        // Największa reszta: odchyłka od dokładnego udziału mniejsza niż jednostka ostatniej cyfry.
        assert.ok(
          Math.abs((wynik[j] ?? Number.NaN) - dokladny) < 0.1 + 1e-9,
          `zestaw ${i} wiersz ${j}`,
        )
      })
      // Podstawa to suma, nie maksimum: pozycja największa ma swój prawdziwy udział. 100 dostaje
      // tylko wtedy, gdy jest jedyną niezerową albo (zaokrąglenie) jej dokładny udział to ≥ 99,95%.
      const maks = Math.max(...wiersze.map((w) => w.ile))
      const indeksMaks = wiersze.findIndex((w) => w.ile === maks)
      if ((maks / razem) * 100 < 99.9) {
        assert.ok((wynik[indeksMaks] ?? 100) < 100, `zestaw ${i}: maksimum = 100%`)
      }
    }
    assert.ok(zestawowZSuma > 400, 'test musiał faktycznie zmierzyć zestawy z dodatnią sumą')
  })
})

describe('procentOd', () => {
  it('liczy procent z całości i zaokrągla do jednego miejsca', () => {
    assert.equal(procentOd(1, 3), 33.3)
    assert.equal(procentOd(50, 200), 25)
    assert.equal(procentOd(7, 7), 100)
    assert.equal(procentOd(0, 10), 0)
  })

  it('całość ≤ 0 albo nieskończona → null (nigdy dzielenie przez zero)', () => {
    assert.equal(procentOd(5, 0), null)
    assert.equal(procentOd(5, -10), null)
    assert.equal(procentOd(5, Number.NaN), null)
    assert.equal(procentOd(5, Number.POSITIVE_INFINITY), null)
    assert.equal(procentOd(5, null), null)
  })

  it('część niepoprawna albo ujemna → null; część większa od całości jest dozwolona', () => {
    assert.equal(procentOd(null, 10), null)
    assert.equal(procentOd(Number.NaN, 10), null)
    assert.equal(procentOd(-1, 10), null)
    assert.equal(procentOd(12, 10), 120)
  })
})

describe('lejek', () => {
  it('10 wyszukań → 6 kart → 2 porównania: procenty od pierwszego kroku i od poprzedniego', () => {
    const wynik = lejek([
      { etykieta: 'wyszukanie', wartosc: 10 },
      { etykieta: 'karta', wartosc: 6 },
      { etykieta: 'porownanie', wartosc: 2 },
    ])
    assert.deepEqual(
      wynik.map((k) => [k.odPierwszego, k.odPoprzedniego]),
      [
        [100, null],
        [60, 60],
        [20, 33.3],
      ],
    )
    assert.equal(wynik[1]?.krok.etykieta, 'karta')
  })

  it('zerowy pierwszy krok → procenty od pierwszego null (nie 0, nie NaN)', () => {
    const wynik = lejek([{ wartosc: 0 }, { wartosc: 4 }, { wartosc: 1 }])
    assert.deepEqual(
      wynik.map((k) => k.odPierwszego),
      [null, null, null],
    )
    assert.equal(wynik[2]?.odPoprzedniego, 25)
    assert.equal(wynik[1]?.odPoprzedniego, null) // poprzedni krok jest zerowy
  })

  it('kroki liczone niezależnie mogą przekroczyć 100% pierwszego kroku', () => {
    const wynik = lejek([{ wartosc: 10 }, { wartosc: 15 }])
    assert.equal(wynik[1]?.odPierwszego, 150)
  })

  it('brakująca wartość kroku → null w tym kroku, reszta liczy się dalej', () => {
    const wynik = lejek([{ wartosc: 10 }, { wartosc: null }, { wartosc: 5 }])
    assert.equal(wynik[1]?.odPierwszego, null)
    assert.equal(wynik[1]?.wartosc, null)
    assert.equal(wynik[2]?.odPierwszego, 50)
    assert.equal(wynik[2]?.odPoprzedniego, null)
  })

  it('pusta lista kroków → pusta lista', () => {
    assert.deepEqual(lejek([]), [])
  })
})

describe('zmianaProcentowa', () => {
  it('wzrost i spadek względem dodatniego odniesienia', () => {
    assert.equal(zmianaProcentowa(120, 100), 20)
    assert.equal(zmianaProcentowa(80, 100), -20)
    assert.equal(zmianaProcentowa(300, 100), 200)
    assert.equal(zmianaProcentowa(100, 100), 0)
  })

  it('odniesienie ≤ 0 → null: nigdy strzałka odwrócona przez ujemny mianownik', () => {
    assert.equal(zmianaProcentowa(5, 0), null)
    assert.equal(zmianaProcentowa(5, -3), null)
    // Gdyby liczyć wprost: (−3 − (−5)) / −5 = −40% przy POPRAWIE z −5 na −3.
    assert.equal(zmianaProcentowa(-3, -5), null)
  })

  it('brak któregokolwiek końca → null', () => {
    assert.equal(zmianaProcentowa(null, 10), null)
    assert.equal(zmianaProcentowa(10, null), null)
    assert.equal(zmianaProcentowa(Number.NaN, 10), null)
    assert.equal(zmianaProcentowa(10, Number.POSITIVE_INFINITY), null)
  })

  it('zaokrągla symetrycznie względem zera', () => {
    assert.equal(zaokraglij(2.25, 1), 2.3)
    assert.equal(zaokraglij(-2.25, 1), -2.3)
    assert.equal(Object.is(zaokraglij(-0.04, 1), 0), true) // bez „-0”
  })
})

describe('ocenaWitalu: progi Google, granica włącznie', () => {
  const przypadki: [string, number, 'dobra' | 'do-poprawy' | 'slaba'][] = [
    ['lcp', 2500, 'dobra'],
    ['lcp', 2500.01, 'do-poprawy'],
    ['lcp', 4000, 'do-poprawy'],
    ['lcp', 4000.01, 'slaba'],
    ['inp', 200, 'dobra'],
    ['inp', 201, 'do-poprawy'],
    ['inp', 500, 'do-poprawy'],
    ['inp', 501, 'slaba'],
    ['cls', 0.1, 'dobra'],
    ['cls', 0.11, 'do-poprawy'],
    ['cls', 0.25, 'do-poprawy'],
    ['cls', 0.26, 'slaba'],
    ['fcp', 1800, 'dobra'],
    ['fcp', 1801, 'do-poprawy'],
    ['fcp', 3000, 'do-poprawy'],
    ['fcp', 3001, 'slaba'],
    ['ttfb', 800, 'dobra'],
    ['ttfb', 801, 'do-poprawy'],
    ['ttfb', 1800, 'do-poprawy'],
    ['ttfb', 1801, 'slaba'],
  ]
  for (const [metryka, p75, oczekiwana] of przypadki) {
    it(`${metryka} ${p75} → ${oczekiwana}`, () => {
      assert.equal(ocenaWitalu(metryka, p75), oczekiwana)
    })
  }

  it('progi z zadania: LCP 2500/4000, INP 200/500, CLS 0,1/0,25, FCP 1800/3000, TTFB 800/1800', () => {
    assert.deepEqual(PROGI_WITALI, {
      lcp: { dobra: 2500, slaba: 4000 },
      inp: { dobra: 200, slaba: 500 },
      cls: { dobra: 0.1, slaba: 0.25 },
      fcp: { dobra: 1800, slaba: 3000 },
      ttfb: { dobra: 800, slaba: 1800 },
    })
    assert.deepEqual([...METRYKI_WITALI].sort(), Object.keys(PROGI_WITALI).sort())
  })

  it('brak pomiaru, wartość niepoprawna albo nieznana metryka → null (to nie jest „słaba”)', () => {
    assert.equal(ocenaWitalu('lcp', null), null)
    assert.equal(ocenaWitalu('lcp', undefined), null)
    assert.equal(ocenaWitalu('lcp', Number.NaN), null)
    assert.equal(ocenaWitalu('lcp', -1), null)
    assert.equal(ocenaWitalu('nieznana', 100), null)
    assert.equal(ocenaWitalu('LCP', 2000), 'dobra') // wielkość liter nie ma znaczenia
  })
})

describe('formaty', () => {
  it('formatLiczby: pełne liczby pl-PL, brak pomiaru to „brak danych”', () => {
    assert.equal(zwykleSpacje(formatLiczby(1234567)), '1 234 567')
    assert.equal(zwykleSpacje(formatLiczby(2450)), '2 450') // także cztery cyfry, spójnie w kolumnie
    assert.equal(formatLiczby(0), '0')
    assert.equal(formatLiczby(2.5, 1), '2,5')
    assert.equal(formatLiczby(null), BRAK_DANYCH)
    assert.equal(formatLiczby(undefined), BRAK_DANYCH)
    assert.equal(formatLiczby(Number.NaN), BRAK_DANYCH)
    assert.equal(formatLiczby(Number.POSITIVE_INFINITY), BRAK_DANYCH)
    assert.equal(formatLiczby(-0), '0')
  })

  it('formatProcent: stała liczba miejsc, null nigdy nie jest „0%” ani NaN', () => {
    assert.equal(formatProcent(42.9), '42,9%')
    assert.equal(formatProcent(100), '100,0%')
    assert.equal(formatProcent(0), '0,0%')
    assert.equal(formatProcent(12.34, 0), '12%')
    assert.equal(formatProcent(null), BRAK_DANYCH)
    assert.equal(formatProcent(Number.NaN), BRAK_DANYCH)
    assert.notEqual(formatProcent(null), '0%')
    assert.ok(!formatProcent(Number.NaN).includes('NaN'))
  })

  it('formatMs i formatWitalu: ms jako pełna liczba, CLS jako ułamek', () => {
    assert.equal(zwykleSpacje(formatMs(2450)), '2 450 ms')
    assert.equal(zwykleSpacje(formatMs(12450)), '12 450 ms')
    assert.equal(formatMs(null), BRAK_DANYCH)
    assert.equal(zwykleSpacje(formatWitalu('lcp', 2450)), '2 450 ms')
    assert.equal(formatWitalu('cls', 0.087), '0,087')
    assert.equal(formatWitalu('CLS', 0.1), '0,100')
    assert.equal(formatWitalu('lcp', null), BRAK_DANYCH)
  })

  it('formatCzasu: milisekundy, sekundy, minuty i godziny', () => {
    assert.equal(formatCzasu(850), '850 ms')
    assert.equal(formatCzasu(2400), '2,4 s')
    assert.equal(formatCzasu(12_000), '12 s')
    assert.equal(formatCzasu(185_000), '3 min 5 s')
    assert.equal(formatCzasu(180_000), '3 min')
    assert.equal(formatCzasu(3_900_000), '1 h 5 min')
    assert.equal(formatCzasu(3_600_000), '1 h')
    assert.equal(formatCzasu(0), '0 ms')
    assert.equal(formatCzasu(null), BRAK_DANYCH)
    assert.equal(formatCzasu(-5), BRAK_DANYCH)
  })

  it('czyLiczba odrzuca null, tekst, NaN i nieskończoność', () => {
    for (const zle of [null, undefined, '5', Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      assert.equal(czyLiczba(zle), false)
    }
    assert.equal(czyLiczba(0), true)
    assert.equal(czyLiczba(-3.5), true)
  })
})
