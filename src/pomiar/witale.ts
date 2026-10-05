// Web Vitals bez biblioteki (research.md R11): LCP, CLS, INP, FCP, TTFB z natywnych API.
// Ładowany LENIWIE (`obserwatory.ts`); `PerformanceObserver` z `buffered: true` odtwarza
// wpisy sprzed utworzenia obserwatora, więc późny start niczego nie gubi.
//
// WYSYŁAMY POJEDYNCZE POMIARY, NIE ŚREDNIE: p75 (tak liczy się Core Web Vitals) musi powstać na
// całym zbiorze – z wartości uśrednionych po drodze nie da się go odtworzyć. Percentyl liczy baza.
//
// RAPORT RAZ NA METRYKĘ, przy pierwszym ukryciu strony: wtedy LCP i CLS są ostateczne (przeglądarka
// przestaje je aktualizować po pierwszym działaniu użytkownika lub ukryciu). To rdzeń woła
// `zbierz()` w swoim nasłuchu `visibilitychange`, dzięki czemu wital jedzie TĄ SAMĄ paczką co
// `wyjscie`, a kolejność nasłuchów nie ma znaczenia. Po raporcie metryka nie jest wysyłana
// ponownie, choć CLS i INP mogą jeszcze urosnąć – to świadomy kompromis.
//
// ATRYBUCJA: metryki dotyczą ŁADOWANIA strony (jak w CrUX), nie pojedynczej odsłony w aplikacji
// jednostronicowej, więc rdzeń przypisuje je do ekranu WEJŚCIA. Przy nawigacji wewnętrznej
// przeglądarka nie zgłasza nowego LCP, a przypisanie CLS/INP do ostatniego ekranu mieszałoby
// ładowanie jednego z interakcjami drugiego.
//
// FCP i TTFB czytamy z osi czasu (wpisy `paint` i `navigation` zostają w niej na stałe), więc
// nie potrzebują obserwatorów. INP to w tej wersji NAJDŁUŻSZA interakcja (nie 98. percentyl):
// dla krótkich wizyt różnica jest niewielka, a unikamy trzymania listy interakcji.

import type { MetrykaWital } from './kontrakt.ts'
import { MAX_WITAL_CLS, MAX_WITAL_MS } from './kontrakt.ts'

export interface Przesuniecie {
  /** Wartość przesunięcia układu (`LayoutShift.value`). */
  wartosc: number
  /** `startTime` wpisu w ms od początku nawigacji. */
  czas: number
}

export interface WitalPomiar {
  n: MetrykaWital
  v: number
}

/** Okno sesji CLS: przerwa między przesunięciami ≤ 1 s i całe okno ≤ 5 s (definicja Google). */
export const PRZERWA_OKNA_MS = 1000
export const DLUGOSC_OKNA_MS = 5000

/**
 * CLS = największa suma przesunięć w pojedynczym „oknie sesji”. Nowe okno zaczyna się, gdy od
 * poprzedniego przesunięcia minęło więcej niż PRZERWA_OKNA_MS albo okno trwa już dłużej niż
 * DLUGOSC_OKNA_MS. Wpisy z `hadRecentInput` filtruje wołający (przesunięcie po działaniu
 * użytkownika nie jest usterką układu). Brak przesunięć = 0.
 */
export function najwiekszeOknoCls(przesuniecia: readonly Przesuniecie[]): number {
  const posortowane = [...przesuniecia].sort((a, b) => a.czas - b.czas)
  let najwieksze = 0
  let suma = 0
  let poczatek = 0
  let ostatni = 0
  let otwarte = false
  for (const p of posortowane) {
    if (!otwarte || p.czas - ostatni > PRZERWA_OKNA_MS || p.czas - poczatek > DLUGOSC_OKNA_MS) {
      suma = 0
      poczatek = p.czas
      otwarte = true
    }
    suma += p.wartosc
    ostatni = p.czas
    if (suma > najwieksze) najwieksze = suma
  }
  return najwieksze
}

/**
 * Wartość do wysłania albo `null`, gdy to nie jest pomiar: niepoliczalna, ujemna albo ponad
 * limit serwera (dłużej niż 10 min to artefakt – karta uśpiona w trakcie ładowania, a nie wolna
 * strona). ms zaokrąglone do całości, CLS do 4 miejsc po przecinku.
 */
export function wartoscWitalu(n: MetrykaWital, surowa: number): number | null {
  if (!Number.isFinite(surowa) || surowa < 0) return null
  if (n === 'cls') return surowa > MAX_WITAL_CLS ? null : Math.round(surowa * 10_000) / 10_000
  return surowa > MAX_WITAL_MS ? null : Math.round(surowa)
}

/* -------------------------------------------------------------------------- */
/* Warstwa DOM                                                                 */
/* -------------------------------------------------------------------------- */

/** Ile przesunięć układu pamiętamy (strona w pętli przesunięć nie ma zjeść pamięci). */
const LIMIT_PRZESUNIEC = 1000

interface WpisPrzesuniecia extends PerformanceEntry {
  value: number
  hadRecentInput: boolean
}
interface WpisZdarzenia extends PerformanceEntry {
  interactionId?: number
}

let lcp: number | null = null
let inp = 0
let clsMierzony = false
let pierwszeUkrycie = Number.POSITIVE_INFINITY
const przesuniecia: Przesuniecie[] = []
const wyslane = new Set<MetrykaWital>()
const obserwatory: PerformanceObserver[] = []

function obserwuj(
  typ: string,
  naWpisach: (wpisy: PerformanceEntryList) => void,
  dodatkowe: Record<string, unknown> = {},
): boolean {
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes(typ)) return false
    const obserwator = new PerformanceObserver((lista) => {
      try {
        naWpisach(lista.getEntries())
      } catch {
        // Zły wpis nie może zatrzymać pomiaru.
      }
    })
    obserwator.observe({ type: typ, buffered: true, ...dodatkowe })
    obserwatory.push(obserwator)
    return true
  } catch {
    return false
  }
}

export function zacznij(): void {
  if (obserwatory.length > 0 || typeof PerformanceObserver === 'undefined') return
  // Strona otwarta w tle ma zaniżone LCP/FCP (liczone od pierwszego pokazania). Gdy już jest
  // ukryta w chwili startu, nie bierzemy tych dwóch metryk.
  pierwszeUkrycie = document.visibilityState === 'hidden' ? 0 : Number.POSITIVE_INFINITY

  obserwuj('largest-contentful-paint', (wpisy) => {
    // Każde wywołanie niesie kolejnych kandydatów; ostatni z nich jest bieżącym LCP.
    const ostatni = wpisy[wpisy.length - 1]
    if (ostatni && ostatni.startTime < pierwszeUkrycie) lcp = ostatni.startTime
  })

  clsMierzony = obserwuj('layout-shift', (wpisy) => {
    for (const wpis of wpisy as WpisPrzesuniecia[]) {
      if (wpis.hadRecentInput || przesuniecia.length >= LIMIT_PRZESUNIEC) continue
      przesuniecia.push({ wartosc: wpis.value, czas: wpis.startTime })
    }
  })

  // `durationThreshold` 40 ms to najniższa wartość, którą przeglądarki honorują sensownie;
  // domyślne 104 ms ukryłoby interakcje, które jeszcze mieszczą się w „dobrym” INP (200 ms).
  obserwuj(
    'event',
    (wpisy) => {
      for (const wpis of wpisy as WpisZdarzenia[]) {
        if ((wpis.interactionId ?? 0) > 0 && wpis.duration > inp) inp = wpis.duration
      }
    },
    { durationThreshold: 40 },
  )
}

function fcp(): number | null {
  const wpis = performance.getEntriesByName('first-contentful-paint', 'paint')[0]
  return wpis && wpis.startTime < pierwszeUkrycie ? wpis.startTime : null
}

function ttfb(): number | null {
  const nawigacja = performance.getEntriesByType('navigation')[0] as
    | (PerformanceNavigationTiming & { activationStart?: number })
    | undefined
  if (!nawigacja || !(nawigacja.responseStart > 0)) return null
  const wartosc = nawigacja.responseStart - (nawigacja.activationStart ?? 0)
  return wartosc >= 0 ? wartosc : null
}

/**
 * Metryki, których jeszcze nie wysłaliśmy, w postaci gotowej do wysyłki. Każda metryka wychodzi
 * co najwyżej raz. CLS tylko tam, gdzie przeglądarka go mierzy (Chromium): zero przesunięć to
 * prawdziwy wynik 0, ale brak obsługi to brak pomiaru, nie zero.
 */
export function zbierz(): WitalPomiar[] {
  const wynik: WitalPomiar[] = []
  const dodaj = (n: MetrykaWital, surowa: number | null) => {
    if (surowa === null || wyslane.has(n)) return
    const v = wartoscWitalu(n, surowa)
    if (v === null) return
    wyslane.add(n)
    wynik.push({ n, v })
  }
  dodaj('lcp', lcp)
  dodaj('fcp', fcp())
  dodaj('ttfb', ttfb())
  if (clsMierzony) dodaj('cls', najwiekszeOknoCls(przesuniecia))
  if (inp > 0) dodaj('inp', inp)
  return wynik
}

/**
 * Odpina obserwatory i zapomina zebrane wpisy: ponowny start (StrictMode, ponowne zamontowanie)
 * tworzy obserwatory z `buffered: true`, które odtwarzają WSZYSTKIE dotychczasowe wpisy – gdyby
 * poprzednie zostały, każde przesunięcie układu liczyłoby się podwójnie. Metryki już wysłane
 * (`wyslane`) zostają wysłane: po ponownym starcie nie wychodzą drugi raz.
 */
export function zatrzymaj(): void {
  for (const obserwator of obserwatory) obserwator.disconnect()
  obserwatory.length = 0
  lcp = null
  inp = 0
  clsMierzony = false
  przesuniecia.length = 0
}
