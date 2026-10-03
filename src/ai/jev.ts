// Klient pośrednika JEV (`POST /api/jev`, #15) z regułą zapasową w jednym miejscu.
// Klucz JEV nigdy nie trafia do przeglądarki – front zna tylko adres pośrednika.
// JEV wybiera z zamkniętych list i ocenia zdania; liczby i miejsca zawsze biorą się z danych.
// Każde niepowodzenie (brak klucza, odmowa, timeout, limit, `vite dev` bez funkcji `api/`)
// kończy się regułą zapasową, nigdy wyjątkiem.

export const ADRES_POSREDNIKA = '/api/jev'
/** Pośrednik czeka na JEV 800 ms – dajemy zapas na sieć i zimny start funkcji. */
export const TIMEOUT_KLIENTA_MS = 1500

/**
 * #163: opis strukturalny – dla opcji, które JEV myli (dokumentacja TypeSafe: primitives/choice,
 * primitives/advanced). Pośrednik przekłada pola na `what` / `not_for` / `examples`. Każde pole
 * do 300 znaków, przykładów 1–5. Zwykły tekst dalej działa i zostaje domyślny.
 */
export interface OpisStrukturalny {
  /** Co opcja obejmuje (albo kiedy twierdzenie jest prawdziwe / fałszywe). */
  co: string
  /** Co należy do sąsiedniej opcji, a nie do tej. */
  nie_dla?: string
  /** Kilka przykładowych tekstów. */
  przyklady?: readonly string[]
}
export type OpisOpcji = string | OpisStrukturalny
/** #163: kryteria twierdzenia noul – co najmniej jedna strona (`criteria.true` / `criteria.false`). */
export type KryteriaTakNie =
  | { prawda: OpisOpcji; falsz?: OpisOpcji }
  | { prawda?: OpisOpcji; falsz: OpisOpcji }

export type PytanieJev =
  | { typ: 'choice'; polecenie: string; kryteria: Record<string, OpisOpcji> }
  | { typ: 'noul'; polecenie: string; kryteria?: KryteriaTakNie }
  | { typ: 'score'; polecenie: string; kryteria: readonly string[] }

export interface ZapytanieJev {
  /** Tekst użytkownika (pośrednik przycina do 2000 znaków). */
  stan: string
  /** Do 32 pytań (#183, `LIMITY.pytan` pośrednika); id i klucze opcji: litery, cyfry, `_`, `-`. */
  pytania: Record<string, PytanieJev>
}

export type OdpowiedzJev =
  | {
      typ: 'choice'
      wybor: string
      pewnosc: number | null
      /** Rozkład po id opcji z żądania, wartości 0–1 (#154). Brak, gdy JEV go nie przysłał. */
      prawdopodobienstwa?: Record<string, number>
    }
  | { typ: 'noul'; noul: number }
  | {
      typ: 'score'
      ocena: number
      pewnosc: number | null
      /** Rozkład po numerze poziomu („0”…„n−1”), wartości 0–1 (#154). Brak, gdy JEV nie przysłał. */
      prawdopodobienstwa?: Record<string, number>
    }

/** Dlaczego nie ma odpowiedzi – do logów i pomiaru (#18), czytelnik widzi tylko zapas. */
export type PowodBraku = 'brak-klucza' | 'odmowa' | 'blad' | 'limit'

export interface WynikPosrednika {
  /** null = zapas. Pojedyncza odpowiedź null = JEV odpowiedział spoza listy albo wcale. */
  odpowiedzi: Record<string, OdpowiedzJev | null> | null
  powod: PowodBraku | null
}

export interface OpcjeKlienta {
  fetch?: typeof fetch
  timeoutMs?: number
  adres?: string
}

/**
 * Wybór z zamkniętej listy; kolejność opcji ma znaczenie dla JEV, więc jej nie przestawiaj.
 * Opis opcji to tekst albo (#163) opis strukturalny – tylko dla opcji, które JEV myli.
 */
export const wybor = (polecenie: string, kryteria: Record<string, OpisOpcji>): PytanieJev => ({
  typ: 'choice',
  polecenie,
  kryteria,
})

/**
 * Twierdzenie tak/nie – odpowiedź `noul` 0–1 (≈1 tak, ≈0 nie). #163: opcjonalne kryteria mówią,
 * kiedy twierdzenie jest prawdziwe, a kiedy fałszywe. Bez nich pytanie jest takie jak wcześniej.
 */
export const takNie = (polecenie: string, kryteria?: KryteriaTakNie): PytanieJev =>
  kryteria ? { typ: 'noul', polecenie, kryteria } : { typ: 'noul', polecenie }

/** Poziom na skali – odpowiedź `ocena` 0…(poziomy − 1), może wypaść między poziomami. */
export const ocena = (polecenie: string, kryteria: readonly string[]): PytanieJev => ({
  typ: 'score',
  polecenie,
  kryteria,
})

const BRAK = (powod: PowodBraku): WynikPosrednika => ({ odpowiedzi: null, powod })

/** Woła pośrednika. Nigdy nie rzuca – każdy błąd to `odpowiedzi: null`. */
export async function zapytajJev(
  zapytanie: ZapytanieJev,
  opcje: OpcjeKlienta = {},
): Promise<WynikPosrednika> {
  const fetchImpl = opcje.fetch ?? fetch
  try {
    const res = await fetchImpl(opcje.adres ?? ADRES_POSREDNIKA, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(zapytanie),
      signal: AbortSignal.timeout(opcje.timeoutMs ?? TIMEOUT_KLIENTA_MS),
    })
    if (res.status === 429) return BRAK('limit')
    if (!res.ok) return BRAK('blad')
    const json = (await res.json()) as Partial<WynikPosrednika> | null
    const odpowiedzi = json?.odpowiedzi
    if (odpowiedzi && typeof odpowiedzi === 'object') return { odpowiedzi, powod: null }
    return BRAK(json?.powod ?? 'blad')
  } catch {
    return BRAK('blad')
  }
}

export interface WynikZZapasem<T> {
  wynik: T
  zrodlo: 'jev' | 'zapas'
  powod: PowodBraku | 'nieczytelne' | null
}

/**
 * Reguła zapasowa w jednym miejscu: pyta JEV, `przetworz` zamienia odpowiedzi na wynik
 * (wagi #16, warstwa #17) i może zwrócić null, gdy pewność za niska albo brak kluczowej
 * odpowiedzi. Wtedy – i przy każdym błędzie – wynik daje `zapas()` (reguła bez AI).
 */
export async function zJevem<T>(
  zapytanie: ZapytanieJev,
  przetworz: (odpowiedzi: Record<string, OdpowiedzJev | null>) => T | null,
  zapas: () => T,
  opcje: OpcjeKlienta = {},
): Promise<WynikZZapasem<T>> {
  const { odpowiedzi, powod } = await zapytajJev(zapytanie, opcje)
  if (odpowiedzi) {
    let wynik: T | null = null
    try {
      wynik = przetworz(odpowiedzi)
    } catch {
      wynik = null
    }
    if (wynik !== null) return { wynik, zrodlo: 'jev', powod: null }
    return { wynik: zapas(), zrodlo: 'zapas', powod: 'nieczytelne' }
  }
  return { wynik: zapas(), zrodlo: 'zapas', powod }
}
