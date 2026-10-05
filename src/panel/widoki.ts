// Zamknięty rejestr widoków panelu: nazwa widoku → funkcja bazy + domyślne parametry + kształt
// odpowiedzi. Nazwa RPC ZAWSZE pochodzi stąd, nigdy z danych ani z adresu (zasada z-dykty: nic
// z zewnątrz nie buduje zapytania). Dołożenie widoku: funkcja `admin_*` z bramką w bazie → wpis
// tutaj (+ typ w `typy.ts`) → hasło w `slownik.ts` → komponent w zakładce.
//
// Plik jest czysty (bez React, bez klienta bazy), żeby rejestr i jego reguły dało się objąć
// testem w Node: `dane.test.ts` pilnuje, że rejestr zgadza się z contracts/rpc.md.
import type { BladWidoku } from './magazyn.ts'
import type {
  Diagnostyka,
  PrzegladRuchu,
  SesjePrzeglad,
  WierszBezWyniku,
  WierszBledu,
  WierszBotaAi,
  WierszCtaMartwego,
  WierszCtaSekcji,
  WierszKampanii,
  WierszKanalu,
  WierszKraju,
  WierszLejka,
  WierszPrzejscia,
  WierszPunktuUrwania,
  WierszSciezki,
  WierszSekcji,
  WierszSeriiDziennej,
  WierszSeriiGodzinowej,
  WierszSygnaluUx,
  WierszTopAdresu,
  WierszTopEkranu,
  WierszUdostepnienia,
  WierszUrzadzenia,
  WierszWitalu,
  WierszZrodla,
} from './typy.ts'

/** Odpowiedź każdego widoku. Klucz = nazwa widoku w rejestrze `WIDOKI`. */
export interface OdpowiedziWidokow {
  przeglad: PrzegladRuchu
  seria_dzienna: WierszSeriiDziennej[]
  seria_godzinowa: WierszSeriiGodzinowej[]
  boty_ai: WierszBotaAi[]
  kanaly: WierszKanalu[]
  zrodla: WierszZrodla[]
  kampanie: WierszKampanii[]
  kraje: WierszKraju[]
  urzadzenia: WierszUrzadzenia[]
  sesje_przeglad: SesjePrzeglad
  przejscia: WierszPrzejscia[]
  udostepnienia: WierszUdostepnienia[]
  sciezki: WierszSciezki[]
  sekcje: WierszSekcji[]
  punkt_urwania: WierszPunktuUrwania[]
  cta_sekcje: WierszCtaSekcji[]
  cta_martwe: WierszCtaMartwego[]
  ux_sygnaly: WierszSygnaluUx[]
  top_ekrany: WierszTopEkranu[]
  top_adresy: WierszTopAdresu[]
  bez_wyniku: WierszBezWyniku[]
  lejek: WierszLejka[]
  diagnostyka: Diagnostyka
  witale: WierszWitalu[]
  bledy: WierszBledu[]
}

export type NazwaWidoku = keyof OdpowiedziWidokow
export type OdpowiedzWidoku<W extends NazwaWidoku> = OdpowiedziWidokow[W]

type Dni = { p_dni?: number }
type Limit = { p_limit?: number }
type BezParametrow = Record<never, never>

/**
 * Parametry każdego widoku (nazwy jak w SQL). Pominięty parametr bierze wartość domyślną z rejestru.
 * Baza przycina okno (`p_dni` do 30 dla surowych zdarzeń, do 90 dla zestawienia; `p_limit` do 200).
 */
export interface ParametryWidokow {
  przeglad: BezParametrow
  seria_dzienna: Dni
  seria_godzinowa: { p_godzin?: number }
  boty_ai: Dni
  kanaly: Dni
  zrodla: Dni & Limit
  kampanie: Dni
  kraje: Dni
  urzadzenia: Dni
  sesje_przeglad: Dni
  przejscia: Dni & Limit
  udostepnienia: Dni
  sciezki: Dni & Limit
  sekcje: Dni & { p_ekran?: string | null }
  punkt_urwania: Dni & Limit
  cta_sekcje: Dni & { p_ekran?: string | null }
  cta_martwe: Dni & { p_min?: number }
  ux_sygnaly: Dni
  top_ekrany: Dni
  top_adresy: Dni & Limit
  bez_wyniku: Dni & Limit
  lejek: Dni
  diagnostyka: BezParametrow
  witale: Dni
  bledy: Dni & Limit
}

export type ParametryWidoku<W extends NazwaWidoku> = ParametryWidokow[W]

type WartoscParametru = number | string | null

interface DefinicjaWidoku {
  /** Funkcja bazy; zawsze `admin_*` (ma bramkę `jest_adminem()`). */
  rpc: `admin_${string}`
  /**
   * Domyślne parametry = wartości domyślne funkcji w SQL (contracts/rpc.md). Klucze tego obiektu
   * są jednocześnie JEDYNYMI parametrami, które widok przyjmuje; `null` znaczy „domyślne w SQL”
   * (parametr nie jest wysyłany).
   */
  domyslne: Readonly<Record<string, WartoscParametru>>
  /** Oczekiwany kształt odpowiedzi: tablica wierszy (`returns table`) albo obiekt (`returns jsonb`). */
  ksztalt: 'tablica' | 'obiekt'
}

export const WIDOKI = {
  przeglad: { rpc: 'admin_przeglad', domyslne: {}, ksztalt: 'obiekt' },
  seria_dzienna: { rpc: 'admin_seria_dzienna', domyslne: { p_dni: 30 }, ksztalt: 'tablica' },
  seria_godzinowa: {
    rpc: 'admin_seria_godzinowa',
    domyslne: { p_godzin: 48 },
    ksztalt: 'tablica',
  },
  boty_ai: { rpc: 'admin_boty_ai', domyslne: { p_dni: 30 }, ksztalt: 'tablica' },
  kanaly: { rpc: 'admin_kanaly', domyslne: { p_dni: 7 }, ksztalt: 'tablica' },
  zrodla: { rpc: 'admin_zrodla', domyslne: { p_dni: 7, p_limit: 50 }, ksztalt: 'tablica' },
  kampanie: { rpc: 'admin_kampanie', domyslne: { p_dni: 30 }, ksztalt: 'tablica' },
  kraje: { rpc: 'admin_kraje', domyslne: { p_dni: 7 }, ksztalt: 'tablica' },
  urzadzenia: { rpc: 'admin_urzadzenia', domyslne: { p_dni: 7 }, ksztalt: 'tablica' },
  sesje_przeglad: { rpc: 'admin_sesje_przeglad', domyslne: { p_dni: 7 }, ksztalt: 'obiekt' },
  przejscia: {
    rpc: 'admin_przejscia',
    domyslne: { p_dni: 7, p_limit: 60 },
    ksztalt: 'tablica',
  },
  udostepnienia: { rpc: 'admin_udostepnienia', domyslne: { p_dni: 30 }, ksztalt: 'tablica' },
  sciezki: { rpc: 'admin_sciezki', domyslne: { p_dni: 7, p_limit: 30 }, ksztalt: 'tablica' },
  sekcje: {
    rpc: 'admin_sekcje',
    domyslne: { p_dni: 7, p_ekran: null },
    ksztalt: 'tablica',
  },
  punkt_urwania: {
    rpc: 'admin_punkt_urwania',
    domyslne: { p_dni: 7, p_limit: 30 },
    ksztalt: 'tablica',
  },
  cta_sekcje: {
    rpc: 'admin_cta_sekcje',
    domyslne: { p_dni: 7, p_ekran: null },
    ksztalt: 'tablica',
  },
  cta_martwe: {
    rpc: 'admin_cta_martwe',
    domyslne: { p_dni: 7, p_min: 50 },
    ksztalt: 'tablica',
  },
  ux_sygnaly: { rpc: 'admin_ux_sygnaly', domyslne: { p_dni: 7 }, ksztalt: 'tablica' },
  top_ekrany: { rpc: 'admin_top_ekrany', domyslne: { p_dni: 7 }, ksztalt: 'tablica' },
  top_adresy: {
    rpc: 'admin_top_adresy',
    domyslne: { p_dni: 7, p_limit: 50 },
    ksztalt: 'tablica',
  },
  bez_wyniku: {
    rpc: 'admin_bez_wyniku',
    domyslne: { p_dni: 30, p_limit: 100 },
    ksztalt: 'tablica',
  },
  lejek: { rpc: 'admin_lejek', domyslne: { p_dni: 7 }, ksztalt: 'tablica' },
  diagnostyka: { rpc: 'admin_diagnostyka', domyslne: {}, ksztalt: 'obiekt' },
  witale: { rpc: 'admin_witale', domyslne: { p_dni: 7 }, ksztalt: 'tablica' },
  bledy: { rpc: 'admin_bledy', domyslne: { p_dni: 7, p_limit: 50 }, ksztalt: 'tablica' },
} as const satisfies Record<NazwaWidoku, DefinicjaWidoku>

export const NAZWY_WIDOKOW = Object.keys(WIDOKI) as NazwaWidoku[]

/**
 * Argumenty RPC: domyślne z rejestru nałożone na przekazane, tylko znane klucze widoku, bez `null`,
 * `undefined` i liczb nieskończonych (SQL użyje wtedy swojej wartości domyślnej), klucze w stałej
 * kolejności. Ta sama funkcja buduje klucz cache, więc `useWidok('kanaly')` i
 * `useWidok('kanaly', { p_dni: 7 })` dzielą jeden wpis.
 */
export function argumentyRpc<W extends NazwaWidoku>(
  widok: W,
  parametry?: ParametryWidoku<W>,
): Record<string, number | string> {
  const domyslne: Readonly<Record<string, WartoscParametru>> = WIDOKI[widok].domyslne
  const przekazane = (parametry ?? {}) as Readonly<Record<string, unknown>>
  const wynik: Record<string, number | string> = {}
  for (const klucz of Object.keys(domyslne).sort()) {
    const wartosc = Object.hasOwn(przekazane, klucz) ? przekazane[klucz] : domyslne[klucz]
    if (typeof wartosc === 'string' || (typeof wartosc === 'number' && Number.isFinite(wartosc))) {
      wynik[klucz] = wartosc
    }
  }
  return wynik
}

/** Klucz wpisu w pamięci podręcznej: widok + serializowane argumenty. */
export function kluczWidoku<W extends NazwaWidoku>(
  widok: W,
  parametry?: ParametryWidoku<W>,
): string {
  return `${widok}:${JSON.stringify(argumentyRpc(widok, parametry))}`
}

/**
 * Minimalna kontrola kształtu odpowiedzi (nie ufamy jej bezkrytycznie, ale też nie walidujemy
 * każdego pola: to robi baza, a zakładka czyta pola ostrożnie). Tablica może przyjść jako `null`,
 * gdy funkcja nie zwróciła wierszy – wtedy to pusta lista.
 */
export function sprawdzKsztalt(
  ksztalt: 'tablica' | 'obiekt',
  dane: unknown,
): { ok: true; dane: unknown } | { ok: false } {
  if (ksztalt === 'tablica') {
    if (Array.isArray(dane)) return { ok: true, dane }
    if (dane === null || dane === undefined) return { ok: true, dane: [] }
    return { ok: false }
  }
  if (typeof dane === 'object' && dane !== null && !Array.isArray(dane)) return { ok: true, dane }
  return { ok: false }
}

interface BladBazy {
  code?: string | null
  message?: string | null
}

/** Kod odmowy: `raise exception 'brak dostępu' using errcode = '42501'` oraz brak EXECUTE dla `anon`. */
export const KOD_BRAK_DOSTEPU = '42501'

/**
 * Błąd z klienta bazy → błąd panelu. Komunikaty po polsku i konkretne tam, gdzie znamy przyczynę:
 * admin zobaczy „migracje nie wdrożone” zamiast surowego „PGRST202”.
 */
export function klasyfikujBlad(blad: BladBazy | null | undefined): BladWidoku {
  const kod = blad?.code ?? ''
  const tresc = blad?.message ?? ''
  if (kod === KOD_BRAK_DOSTEPU) return { rodzaj: 'brak_dostepu' }
  if (kod === '57014') {
    return {
      rodzaj: 'blad',
      komunikat:
        'Zapytanie trwało zbyt długo i baza je przerwała (limit 30 s). Spróbuj krótszego okresu.',
    }
  }
  if (kod === 'PGRST202' || kod === '42883') {
    return {
      rodzaj: 'blad',
      komunikat:
        'Funkcja panelu nie istnieje w bazie. Najpewniej migracje analityki nie zostały jeszcze wdrożone.',
    }
  }
  if (kod === 'PGRST301' || kod === 'PGRST303' || /jwt/i.test(tresc)) {
    return { rodzaj: 'blad', komunikat: 'Sesja wygasła. Wyloguj się i zaloguj ponownie.' }
  }
  if (/failed to fetch|networkerror|load failed/i.test(tresc)) {
    return { rodzaj: 'blad', komunikat: 'Brak połączenia z bazą. Sprawdź sieć i odśwież.' }
  }
  return {
    rodzaj: 'blad',
    komunikat: tresc
      ? `Nie udało się pobrać danych: ${tresc.slice(0, 200)}`
      : 'Nie udało się pobrać danych.',
  }
}
