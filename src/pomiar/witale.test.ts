// Okna sesji CLS i granice wartości Web Vitals (czysta część witale.ts).
// Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_WITAL_CLS, MAX_WITAL_MS } from './kontrakt.ts'
import {
  DLUGOSC_OKNA_MS,
  najwiekszeOknoCls,
  PRZERWA_OKNA_MS,
  type Przesuniecie,
  wartoscWitalu,
} from './witale.ts'

const p = (czas: number, wartosc: number): Przesuniecie => ({ czas, wartosc })

/** Zaokrągla sumę zmiennoprzecinkową do porównań. */
const r = (x: number) => Math.round(x * 1e6) / 1e6

describe('najwiekszeOknoCls', () => {
  it('brak przesunięć = 0', () => {
    assert.equal(najwiekszeOknoCls([]), 0)
  })

  it('jedno okno: suma wartości', () => {
    assert.equal(r(najwiekszeOknoCls([p(100, 0.05), p(400, 0.03), p(900, 0.02)])), 0.1)
  })

  it('przerwa dłuższa niż 1 s zamyka okno, bierzemy NAJWIĘKSZE okno, nie sumę wszystkich', () => {
    const wynik = najwiekszeOknoCls([
      p(100, 0.1),
      p(500, 0.1), // okno 1: 0,2
      p(2000, 0.05), // przerwa 1500 ms → okno 2: 0,05
      p(2300, 0.02), // okno 2: 0,07
    ])
    assert.equal(r(wynik), 0.2)
  })

  it('granica przerwy: dokładnie 1 s nie zamyka okna, 1001 ms zamyka', () => {
    assert.equal(PRZERWA_OKNA_MS, 1000)
    assert.equal(r(najwiekszeOknoCls([p(0, 0.1), p(1000, 0.1)])), 0.2)
    assert.equal(r(najwiekszeOknoCls([p(0, 0.1), p(1001, 0.1)])), 0.1)
  })

  it('okno dłuższe niż 5 s zamyka się mimo ciągłych przesunięć', () => {
    assert.equal(DLUGOSC_OKNA_MS, 5000)
    const ciagle = [0, 800, 1600, 2400, 3200, 4000, 4800, 5600, 6400].map((t) => p(t, 0.01))
    // Pierwsze okno obejmuje czasy 0–4800 (7 wpisów = 0,07; 5600 przekracza 5 s od początku),
    // drugie zaczyna się w 5600 (2 wpisy = 0,02), więc wygrywa pierwsze.
    assert.equal(r(najwiekszeOknoCls(ciagle)), 0.07)
  })

  it('granica długości okna: dokładnie 5 s od początku jeszcze mieści się', () => {
    const wpisy = [0, 1000, 2000, 3000, 4000, 5000].map((t) => p(t, 0.01))
    assert.equal(r(najwiekszeOknoCls(wpisy)), 0.06)
    assert.equal(r(najwiekszeOknoCls([...wpisy, p(5001, 0.01)])), 0.06)
  })

  it('kolejność wejścia nie ma znaczenia (sortowanie po czasie)', () => {
    const wpisy = [p(900, 0.02), p(100, 0.05), p(400, 0.03)]
    assert.equal(r(najwiekszeOknoCls(wpisy)), 0.1)
  })

  it('nie mutuje wejścia', () => {
    const wpisy = [p(900, 0.02), p(100, 0.05)]
    najwiekszeOknoCls(wpisy)
    assert.deepEqual(wpisy, [p(900, 0.02), p(100, 0.05)])
  })

  it('późne duże okno wygrywa z wczesnym małym', () => {
    assert.equal(r(najwiekszeOknoCls([p(0, 0.01), p(10_000, 0.2), p(10_500, 0.1)])), 0.3)
  })
})

describe('wartoscWitalu', () => {
  it('milisekundy zaokrąglone do całości', () => {
    assert.equal(wartoscWitalu('lcp', 1234.56), 1235)
    assert.equal(wartoscWitalu('ttfb', 0), 0)
  })

  it('CLS zaokrąglony do 4 miejsc', () => {
    assert.equal(wartoscWitalu('cls', 0.123456), 0.1235)
    assert.equal(wartoscWitalu('cls', 0), 0)
  })

  it('wartości ponad limity serwera i niepoliczalne to nie pomiar', () => {
    assert.equal(wartoscWitalu('lcp', MAX_WITAL_MS + 1), null)
    assert.equal(wartoscWitalu('inp', MAX_WITAL_MS), MAX_WITAL_MS)
    assert.equal(wartoscWitalu('cls', MAX_WITAL_CLS + 0.1), null)
    assert.equal(wartoscWitalu('cls', MAX_WITAL_CLS), MAX_WITAL_CLS)
    assert.equal(wartoscWitalu('fcp', -1), null)
    assert.equal(wartoscWitalu('fcp', Number.NaN), null)
    assert.equal(wartoscWitalu('fcp', Number.POSITIVE_INFINITY), null)
  })
})
