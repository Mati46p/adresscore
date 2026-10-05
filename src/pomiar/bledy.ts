// Błędy klienta: `error` i `unhandledrejection` → komunikat do pomiaru (typ `blad`). Ładowany
// LENIWIE razem z obserwatorami; błędy z pierwszych sekund, zanim ten moduł się załaduje, łapie
// maleńki nasłuch w `pomiar.ts` i oddaje je tu SUROWE (`SurowyBlad`) – czyszczenie (regexpy
// na adresy, e-maile, ścieżki) nie musi siedzieć w głównej paczce, a nic z pierwszych sekund
// nie ginie (bufor: 5 błędów).
//
// CO WYCHODZI: sam komunikat (≤ 200 znaków), bez stosu, bez adresów z query i fragmentem, bez
// e-maili, ścieżek plików użytkownika i długich liczb. Ekran dokłada rdzeń. Limit (najwyżej
// 5 na odsłonę, bez powtórzeń) pilnuje `rdzen.ts`.

import { MAX_KOMUNIKAT } from './kontrakt.ts'
import { oczyscBiale, przytnij } from './tekst.ts'

/** Szum bez wartości diagnostycznej: błąd z cudzego skryptu bez szczegółów i znane łagodne ostrzeżenia. */
const IGNOROWANE = [/^script error\.?$/i, /ResizeObserver loop/i]

/** Rozszerzenia przeglądarki wstrzykują własne skrypty; ich błędy nie są błędami serwisu. */
const SKRYPTY_ROZSZERZEN =
  /^(?:chrome-extension|moz-extension|safari-(?:web-)?extension|webkit-masked-url):/i

/** Adres w komunikacie bez query i fragmentu: tokeny i dane mieszkają właśnie tam. */
const ADRES_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`)\]}>]+/gi
const ADRES_EMAIL = /[^\s@'"`<>()]+@[^\s@'"`<>()]+/g
/** Ścieżki plików z katalogami użytkownika (`C:\Users\jan\…`, `/home/jan/…`, `/Users/jan/…`). */
const SCIEZKA_PLIKU = /(?:[A-Za-z]:\\|\/(?:Users|home)\/)[^\s'"`)\]}>]*/g
/** Serwer zamienia ciągi 7+ cyfr na `#`; robimy to samo, żeby numer nie opuścił przeglądarki. */
const DLUGA_LICZBA = /\d{7,}/g

/** Błąd zapamiętany bez żadnej obróbki (przed załadowaniem tego modułu). */
export interface SurowyBlad {
  /** `ErrorEvent.error ?? message` albo powód odrzuconej obietnicy. */
  powod: unknown
  /** `ErrorEvent.filename`: skrypty rozszerzeń przeglądarki są pomijane. */
  plik?: string
  obietnica?: boolean
}

/**
 * Tekst błędu z dowolnej wartości: `Error` → „Nazwa: komunikat”, tekst → on sam, reszta → typ.
 * Tylko pierwsza linia (kolejne to zwykle stos, którego nie wysyłamy).
 */
function tekstBledu(surowy: unknown): string {
  if (typeof surowy === 'string') return surowy
  if (surowy && typeof surowy === 'object') {
    const { name, message } = surowy as { name?: unknown; message?: unknown }
    if (typeof message === 'string') {
      return typeof name === 'string' && name ? `${name}: ${message}` : message
    }
  }
  return `bez komunikatu (${typeof surowy})`
}

/**
 * Komunikat gotowy do wysłania albo `null`, gdy nie ma czego wysyłać (pusty, szum). Czysta funkcja.
 */
export function czyscKomunikat(surowy: unknown): string | null {
  const pierwszaLinia = tekstBledu(surowy).split(/\r?\n/, 1)[0] ?? ''
  const czysty = oczyscBiale(
    pierwszaLinia
      // Bez query, fragmentu i `uzytkownik:haslo@` z adresu (login w adresie to też dane).
      .replace(ADRES_URL, (url) => (url.split(/[?#]/, 1)[0] ?? '').replace(/\/\/[^/@]*@/, '//'))
      .replace(ADRES_EMAIL, '[email]')
      .replace(SCIEZKA_PLIKU, '[sciezka]')
      .replace(DLUGA_LICZBA, '#'),
  )
  if (!czysty || IGNOROWANE.some((wzor) => wzor.test(czysty))) return null
  return przytnij(czysty, MAX_KOMUNIKAT)
}

/** Komunikat do wysłania z surowego zdarzenia albo `null` (szum, skrypt rozszerzenia). */
export function komunikatZBledu(blad: SurowyBlad): string | null {
  if (blad.plik && SKRYPTY_ROZSZERZEN.test(blad.plik)) return null
  const komunikat = czyscKomunikat(blad.powod)
  if (!komunikat) return null
  return blad.obietnica ? przytnij(`odrzucona obietnica: ${komunikat}`, MAX_KOMUNIKAT) : komunikat
}

/**
 * Podpina nasłuch błędów i od razu przetwarza `wczesne` (błędy zebrane przed załadowaniem tego
 * modułu). `zglos` dostaje oczyszczony komunikat. Zwraca funkcję odpinającą. Cała obsługa jest
 * w try/catch: obsługa błędu, która sama rzuca, zrobiłaby z jednego wyjątku dwa i mogłaby
 * przerwać łańcuch nasłuchów strony.
 */
export function zacznijBledy(
  zglos: (komunikat: string) => void,
  wczesne: readonly SurowyBlad[] = [],
): () => void {
  const przetworz = (blad: SurowyBlad) => {
    try {
      const komunikat = komunikatZBledu(blad)
      if (komunikat) zglos(komunikat)
    } catch {
      // Bez reakcji: to jest pomiar, nie obsługa błędów aplikacji.
    }
  }
  const naBlad = (zdarzenie: ErrorEvent) =>
    przetworz({ powod: zdarzenie.error ?? zdarzenie.message, plik: zdarzenie.filename })
  const naOdrzucenie = (zdarzenie: PromiseRejectionEvent) =>
    przetworz({ powod: zdarzenie.reason, obietnica: true })

  for (const blad of wczesne) przetworz(blad)
  window.addEventListener('error', naBlad)
  window.addEventListener('unhandledrejection', naOdrzucenie)
  return () => {
    window.removeEventListener('error', naBlad)
    window.removeEventListener('unhandledrejection', naOdrzucenie)
  }
}
