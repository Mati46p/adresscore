// Czas widoczny w sekcjach ekranu (`data-sekcja`). Ładowany LENIWIE razem z resztą obserwatorów
// (`obserwatory.ts`) – rdzeń pomiaru nie płaci za IntersectionObserver na ekranach, które
// jeszcze go nie potrzebują. Wzorzec: z-dykty `analityka-sekcje.ts`.
//
// Dwie warstwy:
//   - `utworzRejestrSekcji` – CZYSTE liczenie (stoper per klucz, liczniki widocznych egzemplarzy,
//     kolejność, zbieranie wyniku), z wstrzykiwanym zegarem, więc testowane bez DOM;
//   - funkcje modułu (`zacznij`, `skanuj`, …) – cienka warstwa na IntersectionObserver.
//
// CO MIERZYMY: sumę odcinków, w których sekcja była „czytana” (widoczna w ≥ 50% własnej wysokości
// albo zajmująca ≥ 50% wysokości okna – ta druga reguła ratuje sekcje wyższe niż ekran, które
// nigdy nie osiągną połowy siebie) ORAZ karta była widoczna (ten sam reżim co czas odsłony).
//
// KLUCZ, NIE ELEMENT: kilka egzemplarzy tego samego klucza (powtarzana karta) liczy się jednym
// stoperem – czas, gdy widoczny jest którykolwiek, bez podwajania.
//
// POZYCJA (`poz`) to KOLEJNOŚĆ w dokumencie wśród oznaczonych sekcji (0 = pierwsza od góry),
// nie piksele: układ mobilny i desktopowy mają różne wysokości, a kolejność w DOM jest ta sama,
// więc mediana pozycji z obu urządzeń nie miesza skal. „Punkt urwania” w bazie bierze sekcję
// o najwyższej pozycji z niezerowym czasem.
//
// ODCZYT, NIE PRZYROST: `zbierz()` oddaje wartości od otwarcia odsłony i niczego nie zeruje.
// Rdzeń woła je RAZ, przy jedynym `wyjscie` odsłony (patrz `rdzen.ts`); czas po jego wysłaniu
// nie jest raportowany. Nowa odsłona zaczyna od zera przez `reset()`.

import type { SekcjaPomiar } from './kontrakt.ts'
import { MAX_CZAS_MS, MAX_SEKCJI, WZORZEC_SEKCJI } from './kontrakt.ts'
import { type Stoper, utworzStoper } from './stoper.ts'

/** Ile różnych kluczy śledzimy w jednej odsłonie (bezpiecznik; ekrany mają ich kilka). */
const LIMIT_KLUCZY = 48
/** Ile elementów `[data-sekcja]` obserwujemy naraz. */
const LIMIT_ELEMENTOW = 120

interface Wpis {
  stoper: Stoper
  /** Ile egzemplarzy tego klucza jest teraz „czytanych”. */
  widoczne: number
  /** Czy sekcja weszła w „czytane” od otwarcia odsłony (także na 0 ms). */
  osiagnieta: boolean
  poz: number
}

export interface RejestrSekcji {
  /** Ustawia kolejność kluczy (z jednego skanu DOM) i zakłada wpisy dla nowych. */
  pozycje(poz: ReadonlyMap<string, number>): void
  wejscie(klucz: string): void
  wyjscie(klucz: string): void
  /** Karta zeszła w tło: czas przestaje płynąć, liczniki egzemplarzy zostają. */
  wstrzymaj(): void
  wznow(): void
  /** Sekcje z czasem (albo osiągnięte) od otwarcia odsłony, w kolejności dokumentu; ≤ `maks`. */
  zbierz(): SekcjaPomiar[] | null
  reset(): void
}

export function utworzRejestrSekcji(teraz: () => number, maks = MAX_SEKCJI): RejestrSekcji {
  const wpisy = new Map<string, Wpis>()
  let kartaWidoczna = true

  function pobierz(klucz: string): Wpis | null {
    const istniejacy = wpisy.get(klucz)
    if (istniejacy) return istniejacy
    if (wpisy.size >= LIMIT_KLUCZY) return null
    const nowy: Wpis = {
      stoper: utworzStoper(teraz),
      widoczne: 0,
      osiagnieta: false,
      poz: wpisy.size,
    }
    wpisy.set(klucz, nowy)
    return nowy
  }

  return {
    pozycje(poz) {
      for (const [klucz, p] of poz) {
        const wpis = pobierz(klucz)
        if (wpis) wpis.poz = p
      }
    },
    wejscie(klucz) {
      const wpis = pobierz(klucz)
      if (!wpis) return
      wpis.widoczne++
      wpis.osiagnieta = true
      if (wpis.widoczne === 1 && kartaWidoczna) wpis.stoper.start()
    },
    wyjscie(klucz) {
      const wpis = wpisy.get(klucz)
      if (!wpis || wpis.widoczne === 0) return
      wpis.widoczne--
      if (wpis.widoczne === 0) wpis.stoper.stop()
    },
    wstrzymaj() {
      kartaWidoczna = false
      for (const wpis of wpisy.values()) wpis.stoper.stop()
    },
    wznow() {
      kartaWidoczna = true
      for (const wpis of wpisy.values()) if (wpis.widoczne > 0) wpis.stoper.start()
    },
    zbierz() {
      const wynik: SekcjaPomiar[] = []
      for (const [klucz, wpis] of wpisy) {
        const ms = Math.min(Math.round(wpis.stoper.ms()), MAX_CZAS_MS)
        if (ms === 0 && !wpis.osiagnieta) continue
        wynik.push([klucz, ms, wpis.poz])
      }
      if (wynik.length === 0) return null
      // Przy nadmiarze zostają sekcje o największym czasie (nie te z góry strony), ale wynik
      // wychodzi w kolejności dokumentu.
      const wybrane =
        wynik.length > maks ? [...wynik].sort((a, b) => b[1] - a[1]).slice(0, maks) : wynik
      return wybrane.sort((a, b) => a[2] - b[2])
    },
    reset() {
      wpisy.clear()
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Warstwa DOM                                                                 */
/* -------------------------------------------------------------------------- */

const SELEKTOR = '[data-sekcja]'
/** Progi co 5%: sekcja wyższa niż ekran zmienia widoczną wysokość bez przekraczania 0,5 swojej. */
const PROGI = Array.from({ length: 21 }, (_, i) => i / 20)

const rejestr = utworzRejestrSekcji(() => performance.now())
let obserwator: IntersectionObserver | null = null
const elementy = new Map<Element, { klucz: string; czytana: boolean }>()

function czytana(wpis: IntersectionObserverEntry): boolean {
  if (!wpis.isIntersecting) return false
  if (wpis.intersectionRatio >= 0.5) return true
  return wpis.intersectionRect.height >= (window.innerHeight || 1) * 0.5
}

function naPrzeciecie(wpisy: IntersectionObserverEntry[]) {
  for (const wpis of wpisy) {
    const stan = elementy.get(wpis.target)
    if (!stan) continue
    const teraz = czytana(wpis)
    if (teraz === stan.czytana) continue
    stan.czytana = teraz
    if (teraz) rejestr.wejscie(stan.klucz)
    else rejestr.wyjscie(stan.klucz)
  }
}

function utworzObserwatora() {
  obserwator = new IntersectionObserver(naPrzeciecie, { threshold: PROGI })
}

/** Zaczyna pomiar (raz). Skanowanie DOM robi `skanuj()`, wołane przez `obserwatory.ts`. */
export function zacznij(): void {
  if (obserwator || typeof IntersectionObserver === 'undefined') return
  utworzObserwatora()
}

/** Nowa odsłona: zapomina poprzedni ekran i zaczyna od zera. */
export function resetuj(): void {
  obserwator?.disconnect()
  obserwator = null
  elementy.clear()
  rejestr.reset()
  zacznij()
}

/**
 * Przegląda DOM: rejestruje nowe sekcje, odświeża kolejność, zapomina elementy usunięte z dokumentu.
 * NIC NIE ZMIENIA w DOM (tylko czyta atrybuty), więc nie wzbudza własnego MutationObservera.
 */
export function skanuj(): void {
  if (!obserwator) return
  for (const [el, stan] of elementy) {
    if (el.isConnected) continue
    if (stan.czytana) rejestr.wyjscie(stan.klucz)
    obserwator.unobserve(el)
    elementy.delete(el)
  }
  const pozycje = new Map<string, number>()
  for (const el of document.querySelectorAll(SELEKTOR)) {
    const klucz = el.getAttribute('data-sekcja')
    if (!klucz || !WZORZEC_SEKCJI.test(klucz)) continue
    if (!pozycje.has(klucz)) pozycje.set(klucz, pozycje.size)
    if (elementy.has(el) || elementy.size >= LIMIT_ELEMENTOW) continue
    elementy.set(el, { klucz, czytana: false })
    obserwator.observe(el)
  }
  rejestr.pozycje(pozycje)
}

export function wstrzymaj(): void {
  rejestr.wstrzymaj()
}

/**
 * Po powrocie do karty wymuszamy świeży odczyt przecięć: ponowne `observe` na obserwowanym
 * elemencie nic nie robi, dopiero `unobserve` + `observe` kolejkuje nowe powiadomienie. Układ
 * mógł się zmienić w tle (rozmiar okna), a bez odczytu liczylibyśmy stan sprzed ukrycia.
 */
export function wznow(): void {
  rejestr.wznow()
  if (!obserwator) return
  for (const el of elementy.keys()) {
    obserwator.unobserve(el)
    obserwator.observe(el)
  }
}

export function zbierz(): SekcjaPomiar[] | null {
  return rejestr.zbierz()
}

export function zatrzymaj(): void {
  obserwator?.disconnect()
  obserwator = null
  elementy.clear()
  rejestr.reset()
}
