// Układ danych zakładki „Treść” (T060): top ekrany, top adresy, wyszukiwania bez wyniku, lejek
// produktowy. Czyste funkcje, bez DOM i bez aliasu `@/` (test na gołym `node --test`); komponent
// (`Tresc.tsx`) tylko je woła i rysuje.
//
// Zasady, które tu żyją (CLAUDE.md „Liczby na ekranie”):
//  - Udział ekranu w odsłonach to odsłony / SUMA odsłon wszystkich ekranów okna (lista jest pełna:
//    ekranów jest kilka), a udziały domyka do 100,0 `udzialy` (metoda największej reszty).
//  - „Unikalni” to odciski dobowe liczone w obrębie wiersza, więc NIE sumują się między wierszami i
//    nie ma ich w żadnej sumie ani udziale.
//  - Top adresy to FRAGMENT całości (limit listy), więc nie ma przy nich udziału: prawdziwa całość
//    leży w innym zapytaniu, a procent od sumy fragmentu zawyżałby pierwsze wiersze.
//  - Lejek liczy się na SESJACH niezależnie na krok (sesja liczy się do kroku, gdy ma jego
//    zdarzenie), więc krok późniejszy MOŻE mieć więcej sesji niż wcześniejszy. To nie spadek ani błąd
//    i panel tego nie wygładza ani nie przycina; mówi to wprost (`uwagiLejka`).
//  - Brak danych to `null`, nigdy 0: krok, którego baza nie zwróciła, nie jest krokiem z zerem sesji.
import { czyLiczba, formatLiczby } from '../arytmetyka.ts'
import { dzienWarszawy, etykietaDnia, formatGodziny } from '../czas.ts'
import { linkDoSerwisu } from '../linki.ts'
import { NAZWA_KROKU_LEJKA, nazwa } from '../nazwy.ts'
import type { WierszBezWyniku, WierszLejka, WierszTopAdresu, WierszTopEkranu } from '../typy.ts'
import type { ListaZUdzialami } from './zaangazowanie-dane.ts'
import { listaZUdzialami } from './zaangazowanie-dane.ts'

/** Lista bez przycinania po stronie klienta i bez limitu zapytania (ekranów jest kilka). */
const BEZ_LIMITU = Number.POSITIVE_INFINITY

/**
 * Ile adresów i fraz prosimy bazę o zwrócenie (to wartości domyślne widoków, baza przycina do 200).
 * Lista dochodząca do limitu może mieć ogon, którego nie widać, i ekran mówi to wprost.
 */
export const LIMIT_ADRESOW = 50
export const LIMIT_FRAZ = 100

// ── Top ekrany ────────────────────────────────────────────────────────────────────────────

/**
 * Ekrany od najczęściej odsłanianego, z udziałem w SUMIE odsłon wszystkich ekranów. Wiersz zachowuje
 * oryginał (`pozycja`), z którego komponent bierze ekran i unikalnych.
 */
export function topEkrany(wiersze: readonly WierszTopEkranu[]): ListaZUdzialami<WierszTopEkranu> {
  return listaZUdzialami(
    wiersze,
    (w) => w.odslony,
    (w, i) => `${w.ekran}§${i}`,
    { maks: BEZ_LIMITU, limitZapytania: BEZ_LIMITU },
  )
}

// ── Top adresy ────────────────────────────────────────────────────────────────────────────

export interface WierszAdresu {
  klucz: string
  /** Ścieżka zapisana przez pomiar (np. `/adres/<slug>`); tekst z bazy, tylko jako treść. */
  sciezka: string
  /** Bezpieczny `href` w obrębie serwisu albo `null` (wtedy sama treść, bez linku). */
  href: string | null
  odslony: number
  unikalni: number | null
}

/** Adresy od najczęściej oglądanego (stabilnie), z bezpiecznym linkiem przez `linkDoSerwisu`. */
export function topAdresy(wiersze: readonly WierszTopAdresu[]): WierszAdresu[] {
  const wynik: WierszAdresu[] = []
  wiersze.forEach((w, i) => {
    if (!czyLiczba(w.odslony) || w.odslony < 0) return
    wynik.push({
      klucz: `${w.sciezka}§${i}`,
      sciezka: String(w.sciezka),
      href: linkDoSerwisu(w.sciezka),
      odslony: w.odslony,
      unikalni: czyLiczba(w.unikalni) && w.unikalni >= 0 ? w.unikalni : null,
    })
  })
  return wynik.sort((a, b) => b.odslony - a.odslony)
}

// ── Wyszukiwania bez wyniku ───────────────────────────────────────────────────────────────

/**
 * Pozycja, pod którą baza zlicza wyszukiwania, których frazy nie zapisano, bo wyglądały na dane
 * osobowe (e-mail, telefon, długi ciąg cyfr). To nie jest fraza: panel pokazuje ją osobnym
 * wierszem z podpisem, a nie w rankingu fraz.
 */
export const ZNACZNIK_ODRZUCONO = '[odrzucono]'

export interface WierszFrazy {
  klucz: string
  fraza: string
  ile: number
  /** Ostatnie wystąpienie (ISO z bazy); `null`, gdy brak. */
  ostatnio: string | null
}

export interface BezWyniku {
  /** Frazy od najczęstszej (stabilnie: remis zostaje w kolejności z bazy). */
  frazy: WierszFrazy[]
  /** Zliczone, ale niezapisane wyszukiwania z danymi osobowymi; `null`, gdy żadnych nie było. */
  odrzucone: { ile: number; ostatnio: string | null } | null
}

function nowszy(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta)) return b
  if (Number.isNaN(tb)) return a
  return tb > ta ? b : a
}

export function bezWyniku(wiersze: readonly WierszBezWyniku[]): BezWyniku {
  const frazy: WierszFrazy[] = []
  // Osobne zmienne zamiast jednego obiektu doklejanego w pętli: TypeScript bierze samoodwołanie
  // `odrzucone = { ile: odrzucone?.ile … }` w pętli za cykl i zawęża typ do `never`.
  let bylyOdrzucone = false
  let ileOdrzuconych = 0
  let ostatnioOdrzuconych: string | null = null
  for (const [i, w] of wiersze.entries()) {
    if (!czyLiczba(w.ile) || w.ile < 0) continue
    const ostatnio = typeof w.ostatnio === 'string' && w.ostatnio !== '' ? w.ostatnio : null
    if (w.fraza === ZNACZNIK_ODRZUCONO) {
      bylyOdrzucone = true
      ileOdrzuconych += w.ile
      ostatnioOdrzuconych = nowszy(ostatnioOdrzuconych, ostatnio)
    } else {
      frazy.push({ klucz: `${w.fraza}§${i}`, fraza: String(w.fraza), ile: w.ile, ostatnio })
    }
  }
  frazy.sort((a, b) => b.ile - a.ile)
  return {
    frazy,
    odrzucone: bylyOdrzucone ? { ile: ileOdrzuconych, ostatnio: ostatnioOdrzuconych } : null,
  }
}

/**
 * „05.10, 14:30” (doba i godzina w Warszawie) albo `null` przy braku lub niepoprawnej dacie. Rok
 * pomijamy: okno panelu to najwyżej 30 dób.
 */
export function formatOstatnio(iso: string | null | undefined): string | null {
  if (!iso) return null
  const dzien = dzienWarszawy(iso)
  if (dzien === null) return null
  return `${etykietaDnia(dzien)}, ${formatGodziny(iso)}`
}

// ── Lejek produktowy ──────────────────────────────────────────────────────────────────────

/**
 * Kroki w kolejności lejka: wyszukanie, karta adresu, a po niej trzy alternatywy. Kolejność jest
 * stała (nie z `kolejnosc` w odpowiedzi), żeby pierwszy krok, od którego liczy się 100%, był zawsze
 * wyszukaniem, nawet gdy baza nie zwróciłaby wiersza.
 */
export const KROKI_LEJKA = [
  'wyszukanie',
  'karta_adresu',
  'porownanie_dodaj',
  'warstwa_mapy',
  'tryb_biznes',
] as const

/** Krok gotowy dla `WykresLejka` (ten sam kształt co `KrokWykresuLejka`). */
export interface KrokLejka {
  klucz: string
  etykieta: string
  /** Sesje z tym krokiem; `null`, gdy baza kroku nie zwróciła (brak pomiaru, nie zero). */
  wartosc: number | null
}

/**
 * Odpowiedź `admin_lejek` jako kroki wykresu. Zawsze pięć znanych kroków w stałej kolejności (krok
 * bez wiersza ma `null`), a krok nieznany frontowi, który baza doda później, idzie za nimi wg
 * `kolejnosc`: wiersz, którego panel nie zna, ma być widoczny.
 */
export function krokiLejka(wiersze: readonly WierszLejka[]): KrokLejka[] {
  const sesje = new Map<string, number>()
  for (const w of wiersze) {
    if (czyLiczba(w.sesje) && w.sesje >= 0) sesje.set(w.krok, w.sesje)
  }
  const znane: readonly string[] = KROKI_LEJKA
  const nieznane = wiersze
    .filter((w) => !znane.includes(w.krok))
    .sort((a, b) =>
      czyLiczba(a.kolejnosc) && czyLiczba(b.kolejnosc) ? a.kolejnosc - b.kolejnosc : 0,
    )
    .map((w) => w.krok)
  return [...znane, ...new Set(nieznane)].map((klucz) => ({
    klucz,
    etykieta: nazwa(NAZWA_KROKU_LEJKA, klucz),
    wartosc: sesje.get(klucz) ?? null,
  }))
}

/**
 * Uwagi o krokach, które mają WIĘCEJ sesji niż ich punkt odniesienia. Odniesieniem karty adresu
 * jest wyszukanie, a trzech kroków po karcie (alternatyw, nie kolejnych etapów) sama karta adresu:
 * porównanie z sąsiednim krokiem alternatywy nic by nie mówiło. Brak uwag, gdy nic nie przekracza.
 */
export function uwagiLejka(kroki: readonly KrokLejka[]): string[] {
  const uwagi: string[] = []
  for (let i = 1; i < kroki.length; i++) {
    const krok = kroki[i]
    const odniesienie = kroki[i === 1 ? 0 : 1]
    if (!krok || !odniesienie) continue
    const a = krok.wartosc
    const b = odniesienie.wartosc
    if (a === null || b === null || !(a > b)) continue
    const przyklad =
      krok.klucz === 'karta_adresu' ? ' (np. karta otwarta z wyszukiwarki internetowej)' : ''
    uwagi.push(
      `„${krok.etykieta}” (${formatLiczby(a)}) przewyższa „${odniesienie.etykieta}” (${formatLiczby(b)}): krok zdarzył się także w sesjach bez kroku „${odniesienie.etykieta}”${przyklad}. To nie błąd: kroki są liczone niezależnie.`,
    )
  }
  return uwagi
}
