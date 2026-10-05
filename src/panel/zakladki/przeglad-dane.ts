// Układ danych zakładki „Przegląd” (T055): z odpowiedzi RPC (`przeglad`, `seria_dzienna`,
// `seria_godzinowa`, `boty_ai`) wyprowadza to, co widać na ekranie. Czyste funkcje, bez DOM i bez aliasu
// `@/` (test na gołym `node --test`); komponent (`Przeglad.tsx`) tylko je woła i rysuje.
//
// Reguły, które tu żyją (CLAUDE.md „Liczby na ekranie”, spec FR-038–FR-040, przypadki brzegowe):
//
//  1. BRAK DANYCH TO NIE ZERO. Seria dzienna z bazy zawiera tylko doby, w których był jakikolwiek
//     zapis, więc „pierwsza doba z wierszem” (`PomiarSerii`) wyznacza początek pomiaru:
//       - doby PRZED nią to przerwa w linii (`null`), bo pomiaru jeszcze nie było,
//       - doby OD niej do dziś bez wiersza to prawdziwe zero (pomiar działał, nikt nie przyszedł),
//       - brak jakiegokolwiek wiersza w oknie 30 dób to „pusty” pomiar: liczniki równe zero
//         zamieniamy na `null`, bo zero „w ciszy całego okna” nie jest wynikiem, tylko brakiem.
//     Zero z bazy zamieniamy na `null` TYLKO wtedy, gdy nic nie przeczy brakowi pomiaru; liczba
//     dodatnia nigdy nie jest ukrywana (to dowód, że dane były, nawet gdy seria jeszcze nie dotarła).
//     Gdy serii nie ma (ładuje się albo padła), niczego nie wnioskujemy: zera zostają zerami, bo
//     wykres godzinowy z własnego zapytania nie ma tracić linii przez błąd innego zapytania.
//  2. PODSTAWA UDZIAŁU TO SUMA CAŁOŚCI. „Ludzie i boty” przekazujemy do `udzialy()` jako dwa segmenty
//     jednej całości (odsłony z 24 h), więc udziały domykają się do 100,0, a nie są liczone od
//     większej grupy.
//  3. ZMIANA TYLKO MIĘDZY DOBAMI PEŁNYMI. Dzisiejsza doba jest niepełna: „dziś do tej pory” wobec
//     pełnego „wczoraj” byłoby zawsze spadkiem. Porównujemy więc wczoraj z przedwczoraj (obie
//     zamknięte), a procent liczy `zmianaProcentowa` (tylko przy dodatnim odniesieniu). Przy małym
//     odniesieniu (< `MIN_ODNIESIENIA_ZMIANY`) procent jest szumem, więc podajemy różnicę
//     bezwzględną (osobna gałąź z reguły „dzielenie przez wartość ze znakiem”).
//  4. SERIĘ GODZINOWĄ BIERZEMY Z BAZY, NIE GENERUJEMY JEJ. Baza buduje ją w czasie bezwzględnym
//     (`generate_series` po 1 godzinie), więc doba 23- i 25-godzinna ma tyle godzin, ile naprawdę
//     miała. Klient niczego nie dokłada: klucz punktu to chwila (UTC), a nie etykieta „02:00”,
//     która w dobie zmiany czasu występuje dwa razy.
import { czyLiczba, formatLiczby, formatProcent, zmianaProcentowa } from '../arytmetyka.ts'
import {
  ciagDni,
  dzienTygodnia,
  dzienWarszawy,
  etykietaDnia,
  formatGodziny,
  opisGodziny,
  pelnaDataDnia,
  przesunDzien,
} from '../czas.ts'
import type { KolorDanych } from '../kolory.ts'
import { NAZWA_KLASY_BOTA, nazwa } from '../nazwy.ts'
import type { KluczHasla } from '../slownik.ts'
import { haslo } from '../slownik.ts'
import type {
  PrzegladRuchu,
  WierszBotaAi,
  WierszSeriiDziennej,
  WierszSeriiGodzinowej,
} from '../typy.ts'

/** Okno wykresu dziennego i listy robotów (dób). Ta sama liczba idzie do bazy jako `p_dni`. */
export const DNI_WYKRESU = 30
/** Okno wykresu godzinowego (godzin). Ta sama liczba idzie do bazy jako `p_godzin`. */
export const GODZIN_WYKRESU = 48
/**
 * Najmniejsze odniesienie, od którego podajemy zmianę w PROCENTACH. Poniżej 20 osób jedna osoba to
 * ponad 5 punktów procentowych, więc „+300%” z 1 na 4 byłoby szumem wyglądającym jak trend; wtedy
 * pokazujemy różnicę bezwzględną.
 */
export const MIN_ODNIESIENIA_ZMIANY = 20

// ── Pomocnicze ────────────────────────────────────────────────────────────────────────────

/** Liczność z odpowiedzi bazy: liczba skończona i nieujemna, inaczej `null` (brak pomiaru, nie zero). */
function liczba(wartosc: unknown): number | null {
  return czyLiczba(wartosc) && wartosc >= 0 ? wartosc : null
}

const WZORZEC_DNIA = /^\d{4}-\d{2}-\d{2}$/

/** Doba `YYYY-MM-DD` istniejąca w kalendarzu (30 lutego odpada, choć `Date.parse` by go przyjął). */
function czyDzien(wartosc: unknown): wartosc is string {
  if (typeof wartosc !== 'string' || !WZORZEC_DNIA.test(wartosc)) return false
  const data = new Date(`${wartosc}T00:00:00Z`)
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(wartosc)
}

/** Porównanie po punktach kodowych, jak `collate "C"` w bazie (remisy robotów rozstrzyga nazwa). */
function porownajTekst(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ── Początek pomiaru i seria dzienna ──────────────────────────────────────────────────────

/**
 * Co wiemy o pomiarze z serii dziennej (30 dób):
 *  - `nieznany`: serii jeszcze nie ma albo nie da się jej odczytać; niczego nie wnioskujemy,
 *  - `pusty`: seria jest, ale bez wiersza, czyli w oknie nie zapisano żadnego zdarzenia,
 *  - `od`: pierwsza doba z wierszem (początek danych w oknie).
 */
export type PomiarSerii =
  | { rodzaj: 'nieznany' }
  | { rodzaj: 'pusty' }
  | { rodzaj: 'od'; pierwszyDzien: string }

export function pomiarZSerii(
  wiersze: readonly WierszSeriiDziennej[] | null | undefined,
): PomiarSerii {
  if (!Array.isArray(wiersze)) return { rodzaj: 'nieznany' }
  if (wiersze.length === 0) return { rodzaj: 'pusty' }
  let pierwszy: string | null = null
  for (const w of wiersze) {
    const dzien: unknown = w?.dzien
    if (czyDzien(dzien) && (pierwszy === null || dzien < pierwszy)) pierwszy = dzien
  }
  // Same nieczytelne wiersze to nie dowód ciszy: nie udajemy, że pomiar jest pusty.
  return pierwszy === null ? { rodzaj: 'nieznany' } : { rodzaj: 'od', pierwszyDzien: pierwszy }
}

/**
 * Punkt wykresu dziennego. Kształt zgodny z `PunktDzienny` ze `skladniki/WykresDzienny.tsx`:
 * `null` to przerwa w linii (brak danych), 0 to faktyczne zero.
 */
export interface PunktDniaRuchu {
  dzien: string
  odslony: number | null
  unikalni: number | null
  boty: number | null
}

/**
 * Ciągła seria dobowa: `dni` kolejnych dób warszawskich kończących się na `dzis` (albo na późniejszej
 * dobie z danych, gdy zegar admina się spóźnia). Dobie z wierszem dajemy jego liczby; doby bez wiersza:
 *  - przed pierwszą dobą z wierszem: `null` (pomiaru jeszcze nie było),
 *  - od niej wzwyż: 0 (pomiar działał, nikt nie przyszedł).
 * Seria bez żadnego wiersza to same `null`, więc wykres pokazuje pustą oś z napisem „brak danych”.
 * Ostatni punkt to dzisiejsza, NIEPEŁNA doba (baza liczy ją na żywo).
 */
export function uzupelnijSerieDzienna(
  wiersze: readonly WierszSeriiDziennej[],
  dni: number,
  dzis: string,
): PunktDniaRuchu[] {
  const poDniach = new Map<string, WierszSeriiDziennej>()
  for (const w of wiersze) {
    const dzien: unknown = w?.dzien
    if (czyDzien(dzien)) poDniach.set(dzien, w)
  }
  let pierwszy: string | null = null
  let koniec = czyDzien(dzis) ? dzis : ''
  for (const dzien of poDniach.keys()) {
    if (pierwszy === null || dzien < pierwszy) pierwszy = dzien
    if (dzien > koniec) koniec = dzien
  }
  return ciagDni(koniec, dni).map((dzien): PunktDniaRuchu => {
    const w = poDniach.get(dzien)
    if (w) {
      return {
        dzien,
        odslony: liczba(w.odslony),
        unikalni: liczba(w.unikalni),
        boty: liczba(w.odslony_boty),
      }
    }
    const pomiarDzialal = pierwszy !== null && dzien >= pierwszy
    const wartosc = pomiarDzialal ? 0 : null
    return { dzien, odslony: wartosc, unikalni: wartosc, boty: wartosc }
  })
}

// ── Seria godzinowa ───────────────────────────────────────────────────────────────────────

/** Punkt wykresu godzinowego (zgodny z `PunktGodzinowy`); `godzina` to początek godziny, ISO UTC. */
export interface PunktGodzinyRuchu {
  godzina: string
  odslony: number | null
  unikalni: number | null
  boty: number | null
}

/**
 * Wiersze `admin_seria_godzinowa` jako punkty wykresu: posortowane po chwili, bez duplikatów chwili,
 * z godziną znormalizowaną do ISO UTC (unikalny klucz punktu także w dobie zmiany czasu, gdzie dwie
 * godziny „02:00” to dwie różne chwile). Niczego nie dokładamy ani nie gubimy: długość i ciągłość
 * serii pochodzą z bazy. Wiersz z niepoprawną godziną jest pomijany, a niepoprawna liczba to `null`.
 *
 * Godzina bez ruchu ma w bazie 0, ale godziny sprzed początku pomiaru (doba przed pierwszą z danymi
 * albo cały pusty pomiar) nie są ciszą, tylko brakiem: ich ZERA zamieniamy na `null`. Liczby dodatnie
 * zostają zawsze.
 */
export function punktyGodzinowe(
  wiersze: readonly WierszSeriiGodzinowej[],
  pomiar: PomiarSerii,
): PunktGodzinyRuchu[] {
  const poChwili = new Map<number, WierszSeriiGodzinowej>()
  for (const w of wiersze) {
    const godzina: unknown = w?.godzina
    const ms = typeof godzina === 'string' ? Date.parse(godzina) : Number.NaN
    if (!Number.isNaN(ms)) poChwili.set(ms, w)
  }
  return [...poChwili.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ms, w]): PunktGodzinyRuchu => {
      const dzien = dzienWarszawy(ms)
      const przedPomiarem =
        pomiar.rodzaj === 'pusty' ||
        (pomiar.rodzaj === 'od' && dzien !== null && dzien < pomiar.pierwszyDzien)
      const wartosc = (surowa: unknown): number | null => {
        const n = liczba(surowa)
        return n === 0 && przedPomiarem ? null : n
      }
      return {
        godzina: new Date(ms).toISOString(),
        odslony: wartosc(w.odslony),
        unikalni: wartosc(w.unikalni),
        boty: wartosc(w.odslony_boty),
      }
    })
}

/**
 * Zdanie pod opisem wykresu dobowego, gdy dane są dopiero z JEDNEJ doby (pierwszy dzień pomiaru).
 * Linia łączy punkty, więc jeden punkt nie tworzy żadnej linii i wykres wygląda na pusty, choć dane są.
 * Zdanie mówi, że to nie awaria, i jak zobaczyć wartości. Od drugiej doby (także zerowej) linia już jest.
 * `null` w pozostałych przypadkach, także gdy seria jest pusta (wtedy wykres sam pisze „brak danych”).
 */
export function uwagaPierwszejDoby(seria: readonly PunktDniaRuchu[] | null): string | null {
  if (seria === null) return null
  const zDanymi = seria.filter((p) => p.odslony !== null || p.unikalni !== null || p.boty !== null)
  return zDanymi.length === 1
    ? 'Dane są dopiero z jednej doby, więc wykres pokazuje pojedyncze punkty zamiast linii: najedź lub dotknij punkt, żeby zobaczyć wartości.'
    : null
}

// ── Zmiana wobec poprzedniej doby ─────────────────────────────────────────────────────────

export interface ZmianaDobowa {
  /** Unikalni z ostatniej pełnej doby (wczoraj). */
  teraz: number
  /** Unikalni z doby przed nią (przedwczoraj), odniesienie zmiany. */
  wtedy: number
  /** `teraz − wtedy`; zawsze dostępna, także gdy procent jest pusty. */
  roznica: number
  /** `zmianaProcentowa(teraz, wtedy)` albo `null` przy odniesieniu < `MIN_ODNIESIENIA_ZMIANY`. */
  procent: number | null
}

/**
 * Zmiana liczby unikalnych: wczoraj wobec przedwczoraj, czyli dwie ZAMKNIĘTE doby. Seria kończy się
 * dzisiejszą, niepełną dobą, więc bierzemy dwa punkty przed nią. Zwraca `null`, gdy któregoś z
 * punktów brakuje albo jest przerwą (`null`), albo gdy doby nie są kolejne (luka w ciągu).
 */
export function zmianaWobecPoprzedniejDoby(seria: readonly PunktDniaRuchu[]): ZmianaDobowa | null {
  const wczoraj = seria[seria.length - 2]
  const przedwczoraj = seria[seria.length - 3]
  if (!wczoraj || !przedwczoraj) return null
  if (przesunDzien(przedwczoraj.dzien, 1) !== wczoraj.dzien) return null
  const teraz = wczoraj.unikalni
  const wtedy = przedwczoraj.unikalni
  if (!czyLiczba(teraz) || !czyLiczba(wtedy)) return null
  return {
    teraz,
    wtedy,
    roznica: teraz - wtedy,
    procent: wtedy >= MIN_ODNIESIENIA_ZMIANY ? zmianaProcentowa(teraz, wtedy) : null,
  }
}

/**
 * Zmiana słowami, bez znaku i bez strzałki: „wzrost o 12,5% wobec przedwczoraj”, „o 3 więcej niż
 * przedwczoraj” (małe odniesienie albo zero) albo „tyle samo co przedwczoraj”. Słowa zamiast „+”/„−”
 * nie zakładają, że wzrost jest dobry, i nie giną w kolorze.
 */
export function opisZmiany(zmiana: ZmianaDobowa): string {
  const { roznica, procent } = zmiana
  if (roznica === 0 || procent === 0) return 'tyle samo co przedwczoraj'
  if (procent !== null) {
    return `${roznica > 0 ? 'wzrost' : 'spadek'} o ${formatProcent(Math.abs(procent))} wobec przedwczoraj`
  }
  return `o ${formatLiczby(Math.abs(roznica))} ${roznica > 0 ? 'więcej' : 'mniej'} niż przedwczoraj`
}

// ── Kafle ─────────────────────────────────────────────────────────────────────────────────

/** Jeden kafel zakładki, gotowy do narysowania przez `KartaStat`. */
export interface KafelRuchu {
  /** Hasło słownika: stąd etykieta i podpowiedź „i” (definicja i pułapka). */
  klucz: KluczHasla
  /** Nazwa hasła, żeby napis na kaflu i w podpowiedzi nie mogły się rozjechać. */
  etykieta: string
  /** `null` to szary „brak danych”, nigdy zero udające pomiar. */
  wartosc: number | null
  /** Cyfry po przecinku (średnia dobowa: 1, reszta: 0). */
  miejsca: number
  /**
   * Jedna linia pod liczbą: okno, kiedy, pułapka. Jednostkę (odsłony, osoby) niesie nagłówek grupy kafli.
   * Nie powtarza żadnej liczby z kafli (ta sama liczba dwa razy w kadrze to usterka). Przy braku danych
   * pusta, a powód braku stoi w opisie zakładki.
   */
  podpis: string
}

export interface KafleRuchu {
  /** „Ludzie”: teraz na stronie i unikalni. */
  ludzie: KafelRuchu[]
  /** „Odsłony”: okna 24 h / 7 / 30 dni i szczyty. */
  odslony: KafelRuchu[]
}

function kafel(
  klucz: KluczHasla,
  wartosc: number | null,
  podpis: string,
  inne: { brak?: string; miejsca?: number } = {},
): KafelRuchu {
  return {
    klucz,
    etykieta: haslo(klucz).nazwa,
    wartosc,
    miejsca: inne.miejsca ?? 0,
    podpis: wartosc === null ? (inne.brak ?? '') : podpis,
  }
}

interface SzczytRuchu {
  odslony: number
  opis: string
}

/** Szczyt godzinowy z `przeglad`: `null`, gdy brak ruchu w oknie albo pole jest nieczytelne. */
function szczytGodziny(surowy: unknown): SzczytRuchu | null {
  if (typeof surowy !== 'object' || surowy === null) return null
  const { godzina, odslony } = surowy as { godzina?: unknown; odslony?: unknown }
  const n = liczba(odslony)
  if (typeof godzina !== 'string' || dzienWarszawy(godzina) === null || n === null || n === 0) {
    return null
  }
  // Zakres („14:00–14:59”), nie punkt: godzina to przedział czasu.
  return { odslony: n, opis: opisGodziny(godzina) }
}

/** Szczyt dobowy z `przeglad`; podpis z dniem tygodnia i datą („pon. 19.10”). */
function szczytDnia(surowy: unknown): SzczytRuchu | null {
  if (typeof surowy !== 'object' || surowy === null) return null
  const { dzien, odslony } = surowy as { dzien?: unknown; odslony?: unknown }
  const n = liczba(odslony)
  if (!czyDzien(dzien) || n === null || n === 0) return null
  return { odslony: n, opis: `${dzienTygodnia(dzien)} ${etykietaDnia(dzien)}` }
}

const PODPIS_BRAKU_SZCZYTU = `brak odsłon ludzi w ostatnich ${DNI_WYKRESU} dobach`

interface OpcjeKafli {
  przeglad: PrzegladRuchu
  pomiar: PomiarSerii
  /** Dzisiejsza doba warszawska z chwili pobrania `przeglad`; `null`, gdy nieznana. */
  dzis: string | null
  zmianaWczoraj: ZmianaDobowa | null
}

/**
 * Kafle zakładki z odpowiedzi `admin_przeglad` (liczby SUROWE, bez własnej arytmetyki: średnią
 * dobową, sumy okien i szczyty liczy baza, żeby kafle zgadzały się z ręcznym przeliczeniem).
 * Klient dokłada trzy rzeczy: nazwę i hasło słownika, podpis oraz regułę „brak danych”:
 *  - pusty pomiar (nic w 30 dobach): zera liczników to `null`,
 *  - „wczoraj” sprzed pierwszej doby z danymi: `null` (wtedy pomiaru nie było),
 *  - pole nieczytelne albo ujemne: `null`.
 * Nie pokazujemy „średnio N odsłon na dobę”: dzielnik stały zaniżałby ją w pierwszym tygodniu pomiaru.
 */
export function kafleRuchu({ przeglad, pomiar, dzis, zmianaWczoraj }: OpcjeKafli): KafleRuchu {
  const bezZdarzen = pomiar.rodzaj === 'pusty'
  const wczoraj = dzis !== null && czyDzien(dzis) ? przesunDzien(dzis, -1) : null
  const wczorajPrzedPomiarem =
    pomiar.rodzaj === 'od' && wczoraj !== null && pomiar.pierwszyDzien > wczoraj

  /** Licznik z bazy; zero bez żadnego zdarzenia w oknie jest brakiem pomiaru, nie wynikiem. */
  const licznik = (surowy: unknown, brakPomiaru: boolean = bezZdarzen): number | null => {
    const n = liczba(surowy)
    return n === 0 && brakPomiaru ? null : n
  }

  const godzinowy = szczytGodziny(przeglad.szczyt_godzina)
  const dobowy = szczytDnia(przeglad.szczyt_dzien)
  const podpisWczoraj = zmianaWczoraj ? `pełna doba, ${opisZmiany(zmianaWczoraj)}` : 'pełna doba'
  // `null` z bazy znaczy „brak ruchu w oknie”; pole nieobecne to niezgodność odpowiedzi, bez powodu.
  const brakSzczytu = (surowy: unknown) => (surowy === null ? PODPIS_BRAKU_SZCZYTU : '')

  return {
    ludzie: [
      kafel('przeglad.teraz5min', licznik(przeglad.teraz_5min), 'ostatnie 5 minut, bez botów'),
      kafel(
        'przeglad.unikalniDzis',
        licznik(przeglad.unikalni_dzis),
        'trwająca doba, liczba rośnie do północy',
      ),
      kafel(
        'przeglad.unikalniWczoraj',
        licznik(przeglad.unikalni_wczoraj, bezZdarzen || wczorajPrzedPomiarem),
        podpisWczoraj,
        { brak: wczorajPrzedPomiarem ? 'pomiar jeszcze nie działał' : '' },
      ),
      kafel('przeglad.unikalni7d', licznik(przeglad.unikalni_7d), 'suma dobowych, nie liczba osób'),
      kafel(
        'przeglad.unikalniSrednia7d',
        licznik(przeglad.unikalni_srednia_7d),
        'średnia dobowa, do porównań między okresami',
        { miejsca: 1 },
      ),
    ],
    odslony: [
      kafel(
        'przeglad.odslony24h',
        licznik(przeglad.odslony_24h),
        'ostatnie 24 godziny, ruchome okno',
      ),
      kafel(
        'przeglad.odslony7d',
        licznik(przeglad.odslony_7d),
        '7 ostatnich dób, w tym niepełna dzisiejsza',
      ),
      kafel(
        'przeglad.odslony30d',
        licznik(przeglad.odslony_30d),
        '30 ostatnich dób, w tym niepełna dzisiejsza',
      ),
      kafel('przeglad.szczytGodzina', godzinowy?.odslony ?? null, godzinowy ? godzinowy.opis : '', {
        brak: brakSzczytu(przeglad.szczyt_godzina),
      }),
      kafel('przeglad.szczytDzien', dobowy?.odslony ?? null, dobowy ? dobowy.opis : '', {
        brak: brakSzczytu(przeglad.szczyt_dzien),
      }),
    ],
  }
}

/**
 * Zdanie nad kaflami, gdy pomiar nie obejmuje całego okna 30 dób: pusty pomiar albo początek danych
 * w środku okna. Sumy z 7 i 30 dni oraz średnia z 7 dni są wtedy ZANIŻONE (okno większe niż dane),
 * a czytelnik bez tej uwagi wziąłby niską liczbę za słaby ruch. `null`, gdy okno jest pełne albo
 * nic nie wiemy o serii.
 *
 * Komunikat o PUSTYM pomiarze mówi o liczbach na kaflach, więc pojawia się dopiero, gdy kafle są
 * znane, i nigdy obok dodatniej liczby (świeższy `przeglad` przy starszej serii: dowód danych wygrywa).
 */
export function opisPokrycia(
  pomiar: PomiarSerii,
  dzis: string | null,
  kafle: KafleRuchu | null,
): string | null {
  if (pomiar.rodzaj === 'pusty') {
    if (kafle === null || [...kafle.ludzie, ...kafle.odslony].some((k) => (k.wartosc ?? 0) > 0)) {
      return null
    }
    return `W ostatnich ${DNI_WYKRESU} dobach nie zarejestrowano żadnych zdarzeń, więc liczby i wykresy są puste (brak danych), a nie zerowe. Jeśli serwis ma ruch, sprawdź w zakładce Jakość, kiedy zapisało się ostatnie zdarzenie.`
  }
  if (pomiar.rodzaj !== 'od' || dzis === null || !czyDzien(dzis)) return null
  const pierwszy = pomiar.pierwszyDzien
  // Początek danych później niż „dziś” to rozjazd zegarów, nie powód do ostrzeżenia.
  if (pierwszy > dzis || pierwszy <= przesunDzien(dzis, -(DNI_WYKRESU - 1))) return null
  const objete = ciagDni(dzis, DNI_WYKRESU).filter((d) => d >= pierwszy).length
  const zanizone =
    pierwszy > przesunDzien(dzis, -6)
      ? 'sumy z 7 i 30 dni oraz średnia z 7 dni są zaniżone'
      : 'suma z 30 dni jest zaniżona'
  return `Zdarzenia w oknie ${DNI_WYKRESU} dób zaczynają się od ${pelnaDataDnia(pierwszy)} (dane obejmują ${objete} z ${DNI_WYKRESU} dób), więc ${zanizone}.`
}

// ── Ludzie i boty ─────────────────────────────────────────────────────────────────────────

/** Segment paska „ludzie i boty” (zgodny z `SegmentUdzialu` ze `skladniki/PasekUdzialow.tsx`). */
export interface SegmentLudzieBoty {
  klucz: 'ludzie' | 'boty'
  etykieta: string
  /** Odsłony z ostatnich 24 godzin; `null`, gdy pole jest nieczytelne (nie wchodzi do podstawy). */
  wartosc: number | null
  kolor: KolorDanych
}

/**
 * Dwie części jednej całości: odsłony ludzi i botów z ostatnich 24 godzin. Podstawą udziału jest ICH
 * SUMA (robi to `udzialy()` w `PasekUdzialow`), nie większa z grup, więc udziały domykają się do 100%.
 * Kolory za bytem: ludzie jak seria „odsłony” na wykresach (slot 1), boty szare jak tam.
 * `ludzie_24h` to ta sama liczba co `odslony_24h` (kontrakt rpc.md); pasek ma obie części w jednym
 * miejscu, a kafel odsłon własne pole.
 *
 * Gdy którejś części nie da się odczytać, obie są bez wartości: udział drugiej wobec nieznanej całości
 * byłby fałszem („100% to boty”), a pasek bez wartości pokazuje szary stan zamiast niego.
 */
export function segmentyLudzieBoty(przeglad: PrzegladRuchu): SegmentLudzieBoty[] {
  const ludzie = liczba(przeglad.ludzie_24h)
  const boty = liczba(przeglad.boty_24h)
  const komplet = ludzie !== null && boty !== null
  return [
    { klucz: 'ludzie', etykieta: 'Ludzie', wartosc: komplet ? ludzie : null, kolor: 1 },
    { klucz: 'boty', etykieta: 'Boty', wartosc: komplet ? boty : null, kolor: 'szary' },
  ]
}

// ── Roboty ────────────────────────────────────────────────────────────────────────────────

export interface WierszRobota {
  /** Stabilny klucz wiersza (klasa i rodzina; ta sama rodzina może wystąpić w dwóch klasach). */
  klucz: string
  /** Tekst z bazy pochodzi od dowolnego klienta: wyłącznie jako treść, nigdy jako link ani HTML. */
  rodzina: string
  /** Klasa tak, jak ją zapisała baza (`ai`, `wyszukiwarka`…); do porządkowania, nie do wyświetlania. */
  klasaKod: string
  /** Klasa po polsku (`nazwy.ts`); nieznana klasa wraca sama. */
  klasa: string
  odslony: number
  /** Ostatnia wizyta w czasie warszawskim („26.10, 14:28”) albo `null`, gdy czas jest nieczytelny. */
  ostatnia: string | null
}

function opisWizyty(iso: unknown): string | null {
  if (typeof iso !== 'string') return null
  const dzien = dzienWarszawy(iso)
  return dzien === null ? null : `${etykietaDnia(dzien)}, ${formatGodziny(iso)}`
}

/**
 * Wiersze robotów wybranych klas, malejąco po odsłonach; remis rozstrzyga nazwa rodziny, potem klasa
 * (porównanie po punktach kodowych, jak `collate "C"` w bazie), żeby kolejność była powtarzalna.
 * Wiersz bez rodziny, klasy albo liczby odsłon jest pomijany: nie udaje robota z zerem odsłon.
 */
function wierszeRobotow(
  wiersze: readonly WierszBotaAi[],
  czyWlaczyc: (klasa: string) => boolean,
): WierszRobota[] {
  const wynik: WierszRobota[] = []
  for (const w of wiersze) {
    const rodzina: unknown = w?.rodzina
    const klasa: unknown = w?.klasa
    const odslony = liczba(w?.odslony)
    if (typeof rodzina !== 'string' || rodzina === '' || typeof klasa !== 'string') continue
    if (odslony === null || !czyWlaczyc(klasa)) continue
    wynik.push({
      klucz: `${klasa}§${rodzina}`,
      rodzina,
      klasaKod: klasa,
      klasa: nazwa(NAZWA_KLASY_BOTA, klasa),
      odslony,
      ostatnia: opisWizyty(w.ostatnio),
    })
  }
  return wynik.sort(
    (a, b) =>
      b.odslony - a.odslony ||
      porownajTekst(a.rodzina, b.rodzina) ||
      porownajTekst(a.klasaKod, b.klasaKod),
  )
}

/** Crawlery AI (klasa `ai`): rodzina, odsłony, ostatnia wizyta; malejąco po odsłonach. */
export function wierszeCrawlerowAi(wiersze: readonly WierszBotaAi[]): WierszRobota[] {
  return wierszeRobotow(wiersze, (klasa) => klasa === 'ai')
}

/** Pozostałe roboty (wyszukiwarki, podglądy linków, narzędzia…): kontekst dla paska „ludzie i boty”. */
export function wierszePozostalychRobotow(wiersze: readonly WierszBotaAi[]): WierszRobota[] {
  return wierszeRobotow(wiersze, (klasa) => klasa !== 'ai')
}
