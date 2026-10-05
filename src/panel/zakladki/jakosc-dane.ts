// Czysta logika zakładki „Jakość” (T061, US6): klasyfikacja biegu zestawienia i ciszy w pomiarze, wiek
// zdarzeń, wiersze diagnostyki, układ tabeli Web Vitals i wiersze błędów klienta. Bez React, bez DOM
// i bez aliasu `@/`, żeby dało się ją objąć testem na gołym `node --test` (jakosc-dane.test.ts).
//
// CZAS „TERAZ” WCHODZI ZAWSZE JAKO ARGUMENT (ms od epoki). Żadna funkcja stąd nie woła Date.now():
// test podaje znaczniki wprost, a komponent nie dotyka zegara w renderze. Komponent podaje chwilę
// POBRANIA danych (`pobrano` z `useWidok`), więc wiek zdarzenia jest liczony względem migawki, którą
// admin ogląda (ten sam moment co „Dane z godz.” u góry panelu), a nie względem zegara, który tyka,
// podczas gdy liczby stoją w miejscu.
//
// PROGI W JEDNYM MIEJSCU (każdy ma uzasadnienie przy deklaracji):
//   PROG_BIEGU_MS (26 h)   – bieg zestawienia starszy niż to = „opóźniony” (czerwony),
//   PROG_CISZY_MS (1 h)    – ostatnie zdarzenie starsze niż to = „cisza” (ostrzeżenie),
//   MIN_PROBEK (5)         – p75 z mniejszej liczby pomiarów = „mało próbek”,
//   RETENCJA_DNI (90) + TOLERANCJA – najstarsze zdarzenie starsze niż to = sprzątanie nie działa.
//
// DANE Z SIECI NIE SĄ ZAUFANE. Odpowiedź ma tylko sprawdzony kształt ogólny (obiekt albo tablica),
// więc każda funkcja czyta pola ostrożnie: brak pola, zły typ albo liczba ujemna dają `null` („brak
// danych”), nigdy 0 i nigdy wyjątek w renderze. Teksty od klientów (komunikaty błędów) przechodzą
// przez `oczyscTekst`: znaki sterujące i niewidoczne (w tym przełączniki kierunku pisma, które potrafią
// wizualnie przestawić tekst) znikają, białe znaki się zbijają, a długość jest obcinana.
import type { MetrykaWitalu, OcenaWitalu } from '../arytmetyka.ts'
import {
  BRAK_DANYCH,
  czyLiczba,
  formatLiczby,
  formatProcent,
  jestMetrykaWitalu,
  METRYKI_WITALI,
  ocenaWitalu,
  PROGI_WITALI,
  procentOd,
} from '../arytmetyka.ts'
import {
  dzienTygodnia,
  dzienWarszawy,
  etykietaDnia,
  formatGodziny,
  pelnaDataDnia,
} from '../czas.ts'
import { KOLEJNOSC_TYPOW_ZDARZEN, NAZWA_EKRANU, NAZWA_TYPU_ZDARZENIA } from '../nazwy.ts'
import type { Diagnostyka, OstatniBieg, TypZdarzenia, WierszBledu, WierszWitalu } from '../typy.ts'

// ── Czas ──────────────────────────────────────────────────────────────────────────────────

export const MS_MINUTY = 60_000
export const MS_GODZINY = 3_600_000
export const MS_DOBY = 86_400_000

/**
 * Bieg zestawienia starszy niż 26 godzin jest „opóźniony”. Harmonogram biega raz na dobę (01:20 UTC),
 * więc zdrowy bieg ma najwyżej ~24 h + czas trwania. Dwie godziny zapasu pochłaniają spóźniony start
 * zadania i dłuższe liczenie, a mimo to wstrzymanie zestawienia na dobę zapala wskaźnik jeszcze tego
 * samego dnia (scenariusz Historii 6). „Starszy niż” znaczy ŚCIŚLE więcej: dokładnie 26 h to jeszcze OK.
 */
export const PROG_BIEGU_MS = 26 * MS_GODZINY

/**
 * Ostatnie zdarzenie starsze niż godzina to „cisza” (ostrzeżenie, nie błąd). Przyjmujemy, że w ciągu
 * dnia serwis dostaje zdarzenia (odsłony, wyjścia, pomiary szybkości) częściej niż raz na godzinę,
 * więc godzina bez żadnego jest podejrzana: tak wygląda zepsuty zapis (wygasły klucz serwerowy,
 * niedostępna baza), który z zewnątrz wygląda dokładnie jak „nikt nie wszedł”. To założenie o ruchu,
 * nie fakt: nocą i przy małym ruchu cisza bywa normalna, dlatego to ostrzeżenie (!), a nie czerwony
 * błąd (✕), i opis przy kaflu mówi o tym wprost. Brak jakiegokolwiek zdarzenia (świeży serwis) to
 * osobny stan „brak”, nie cisza.
 */
export const PROG_CISZY_MS = MS_GODZINY

/** Surowe zdarzenia żyją 90 dni (`analityka_sprzataj`); zestawienia dzienne zostają. */
export const RETENCJA_DNI = 90

/**
 * Sprzątanie biega raz na dobę, więc w zdrowej bazie najstarsze zdarzenie ma do 90 dni + doba.
 * Dwie doby tolerancji wybaczają jeden opuszczony bieg; starsze zdarzenie znaczy, że retencja nie działa.
 */
export const TOLERANCJA_RETENCJI_DNI = 2

const WZORZEC_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

/** Tekst z bazy (ISO 8601) → ms od epoki. `null` dla pustego, niepoprawnego i nie-tekstu. */
export function czasMs(iso: unknown): number | null {
  if (typeof iso !== 'string' || !WZORZEC_ISO.test(iso)) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Wiek chwili względem `teraz` w ms, nigdy ujemny: zegar komputera admina może iść za zegarem bazy,
 * a „zdarzenie z przyszłości” nie jest powodem do alarmu. `null`, gdy czas albo `teraz` są niepoprawne.
 */
export function wiekMs(iso: unknown, teraz: number): number | null {
  const ms = czasMs(iso)
  if (ms === null || !Number.isFinite(teraz)) return null
  return Math.max(0, teraz - ms)
}

/**
 * Czas trwania zaokrąglony w dół do minut: „mniej niż minutę”, „12 min”, „1 h 5 min”, „26 h 9 min”.
 * Do 48 godzin zostają godziny z minutami (próg biegu to 26 h, więc „26 h 9 min” musi być widoczne
 * dokładnie); od 48 godzin dni z godzinami („2 dni 3 h”).
 */
export function formatTrwania(ms: number | null | undefined): string {
  if (!czyLiczba(ms) || ms < 0) return BRAK_DANYCH
  if (ms < MS_MINUTY) return 'mniej niż minutę'
  const minuty = Math.floor(ms / MS_MINUTY)
  const godziny = Math.floor(minuty / 60)
  if (godziny < 1) return `${minuty} min`
  if (godziny < 48) {
    const resztaMinut = minuty % 60
    return resztaMinut > 0 ? `${godziny} h ${resztaMinut} min` : `${godziny} h`
  }
  const dni = Math.floor(godziny / 24)
  const resztaGodzin = godziny % 24
  return resztaGodzin > 0 ? `${dni} dni ${resztaGodzin} h` : `${dni} dni`
}

/** „12 min temu”. Brak wieku → „brak danych”. */
export function formatWieku(ms: number | null | undefined): string {
  return czyLiczba(ms) && ms >= 0 ? `${formatTrwania(ms)} temu` : BRAK_DANYCH
}

/** „1 dzień”, „2 dni”, „22 dni”: w liczbie mnogiej „dni” pasuje do każdej liczby poza jedynką. */
export function formatDni(n: number): string {
  return n === 1 ? '1 dzień' : `${formatLiczby(n)} dni`
}

/** „mniej niż dobę temu”, „1 dzień temu”, „34 dni temu”. */
export function formatDniTemu(n: number): string {
  return n < 1 ? 'mniej niż dobę temu' : `${formatDni(n)} temu`
}

/** Chwila w czasie warszawskim: „pon. 05.10, 14:05”. Niepoprawna → „brak danych”. */
export function formatChwili(iso: unknown): string {
  const ms = czasMs(iso)
  const dzien = ms === null ? null : dzienWarszawy(ms)
  if (ms === null || dzien === null) return BRAK_DANYCH
  return `${dzienTygodnia(dzien)} ${etykietaDnia(dzien)}, ${formatGodziny(ms)}`
}

/** Doba chwili jako „pon. 05.10.2026” (kafel najstarszego zdarzenia); `null`, gdy czas niepoprawny. */
export function formatDnia(iso: unknown): string | null {
  const ms = czasMs(iso)
  const dzien = ms === null ? null : dzienWarszawy(ms)
  return dzien === null ? null : pelnaDataDnia(dzien)
}

// ── Teksty z sieci ────────────────────────────────────────────────────────────────────────

/** Limit komunikatu po stronie bazy (`komunikat` ≤ 200 znaków); ten sam limit stosujemy do wyświetlania. */
export const MAX_KOMUNIKAT = 200
/** Pełny tekst do dymka `title`: żeby dymek nie urósł do rozmiarów ekranu. */
export const MAX_PELNY = 1000

// Znaki rozpoznajemy po kodach (liczbach), nie po sekwencjach ucieczki w wyrażeniu regularnym:
// zapis liczbowy nie zawiera w źródle żadnego niewidocznego znaku, więc nikt nie przeoczy go w diffie.

/** Znaki sterujące i separatory wierszy: zamieniane na spację (nie sklejają słów). */
function czyZnakSterujacy(kod: number): boolean {
  return kod < 0x20 || (kod >= 0x7f && kod <= 0x9f) || kod === 0x2028 || kod === 0x2029
}

/**
 * Niewidoczne albo zmieniające kierunek pisma (miękki łącznik, znak arabskiego kierunku, znaki zerowej
 * szerokości i kierunku, osadzenia i nadpisania kierunku, izolaty, BOM): tekst mógłby wyglądać inaczej,
 * niż brzmi. Usuwane bez śladu.
 */
function czyZnakNiewidoczny(kod: number): boolean {
  return (
    kod === 0xad ||
    kod === 0x61c ||
    (kod >= 0x200b && kod <= 0x200f) ||
    (kod >= 0x202a && kod <= 0x202e) ||
    (kod >= 0x2060 && kod <= 0x206f) ||
    kod === 0xfeff
  )
}

/** Tekst bezpieczny do pokazania: bez znaków sterujących i niewidocznych, białe znaki zbite do spacji. */
export function oczyscTekst(tekst: unknown): string {
  if (typeof tekst !== 'string') return ''
  let wynik = ''
  for (const znak of tekst) {
    const kod = znak.codePointAt(0) ?? 0
    if (czyZnakNiewidoczny(kod)) continue
    wynik += czyZnakSterujacy(kod) ? ' ' : znak
  }
  return wynik.replaceAll(/\s+/g, ' ').trim()
}

/** Obcina do `max` znaków (liczonych jako punkty kodowe, żeby nie przeciąć pary zastępczej) z „…”. */
export function skrocTekst(tekst: string, max: number): string {
  const znaki = Array.from(tekst)
  if (znaki.length <= max) return tekst
  return `${znaki
    .slice(0, Math.max(0, max - 1))
    .join('')
    .trimEnd()}…`
}

// ── Diagnostyka: ostatnie zdarzenie ───────────────────────────────────────────────────────

export type OcenaZdarzenia =
  | { stan: 'brak'; wiekMs: null }
  | { stan: 'swieze' | 'cisza'; wiekMs: number }

/**
 * Ostatnie zdarzenie ludzi: `brak` (żadnego jeszcze nie ma – szary stan, nie alarm), `swieze` (do
 * godziny włącznie) albo `cisza` (starsze, patrz `PROG_CISZY_MS`).
 */
export function ocenaOstatniegoZdarzenia(iso: unknown, teraz: number): OcenaZdarzenia {
  const wiek = wiekMs(iso, teraz)
  if (wiek === null) return { stan: 'brak', wiekMs: null }
  return { stan: wiek > PROG_CISZY_MS ? 'cisza' : 'swieze', wiekMs: wiek }
}

/** Dopowiedzenie do ciszy: ponad dobę to już nie nocna przerwa, tylko brak jakiegokolwiek ruchu w 24 h. */
export function opisCiszy(wiek: number): string {
  return wiek >= MS_DOBY
    ? 'Ponad dobę bez żadnego zdarzenia: albo nikt nie wszedł na serwis, albo zapis nie działa.'
    : 'Dłużej niż godzinę bez zdarzenia. Nocą to normalne, w dzień może znaczyć, że zapis stanął.'
}

// ── Diagnostyka: zdarzenia na typ ─────────────────────────────────────────────────────────

/** Liczba zdarzeń typu z ostatnich 24 h; `null`, gdy odpowiedź jej nie zawiera albo jest niepoprawna. */
function liczbaZdarzen(
  diagnostyka: Diagnostyka | null | undefined,
  typ: TypZdarzenia,
): number | null {
  const zbior: unknown = diagnostyka?.zdarzenia_24h
  if (typeof zbior !== 'object' || zbior === null || !Object.hasOwn(zbior, typ)) return null
  const surowa = (zbior as Record<string, unknown>)[typ]
  return czyLiczba(surowa) && surowa >= 0 ? surowa : null
}

/**
 * Pomiar „żyje”: w ostatnich 24 h są odsłony ORAZ pomiary szybkości. Odsłony dowodzą, że zapis działa,
 * a pomiary szybkości – że działa też leniwie ładowany moduł obserwatorów, w którym mieszka zbieranie
 * błędów klienta (witale i błędy to ten sam moduł). To najlepszy dostępny dowód, że brak błędów
 * znaczy „nikt ich nie zgłosił”, a nie „błędy nie mają jak dojść”.
 */
export function pomiarZyje(diagnostyka: Diagnostyka | null | undefined): boolean {
  const odslony = liczbaZdarzen(diagnostyka, 'odslona')
  const witale = liczbaZdarzen(diagnostyka, 'wital')
  return odslony !== null && odslony > 0 && witale !== null && witale > 0
}

/**
 * Uwaga przy typie zdarzenia. `cisza`: zero zdarzeń tego typu (prawdziwe zero, nie brak pomiaru),
 * czyli ten kawałek pomiaru milczy. WYJĄTEK `blad`: zero błędów klienta jest dobrą wiadomością, nie
 * awarią (tak mówi hasło słownika „Zdarzenia na typ”), więc dostaje `brak_bledow` – ale TYLKO gdy
 * pomiar żyje (`pomiarZyje`); gdy cały pomiar milczy, zero błędów niczego nie dowodzi i też jest ciszą.
 */
export type UwagaTypu = 'cisza' | 'brak_bledow' | null

export interface WierszTypu {
  typ: TypZdarzenia
  nazwa: string
  /** `null` = odpowiedź bazy nie zawiera tego typu (brak danych); 0 = zero zdarzeń. */
  liczba: number | null
  uwaga: UwagaTypu
}

export function uwagaTypu(typ: TypZdarzenia, liczba: number | null, zyje: boolean): UwagaTypu {
  if (liczba !== 0) return null
  return typ === 'blad' && zyje ? 'brak_bledow' : 'cisza'
}

/** Wszystkie siedem typów w ustalonej kolejności, także z zerem. */
export function wierszeTypow(diagnostyka: Diagnostyka | null | undefined): WierszTypu[] {
  const zyje = pomiarZyje(diagnostyka)
  return KOLEJNOSC_TYPOW_ZDARZEN.map((typ) => {
    const liczba = liczbaZdarzen(diagnostyka, typ)
    return { typ, nazwa: NAZWA_TYPU_ZDARZENIA[typ], liczba, uwaga: uwagaTypu(typ, liczba, zyje) }
  })
}

/**
 * Suma zdarzeń z 24 h = podstawa udziałów. `null`, gdy któregoś z siedmiu typów brakuje: suma z
 * niekompletnej odpowiedzi udawałaby całość, a podstawa procentu ma być sumą CAŁOŚCI.
 */
export function sumaZdarzen24h(diagnostyka: Diagnostyka | null | undefined): number | null {
  let suma = 0
  for (const typ of KOLEJNOSC_TYPOW_ZDARZEN) {
    const liczba = liczbaZdarzen(diagnostyka, typ)
    if (liczba === null) return null
    suma += liczba
  }
  return suma
}

// ── Diagnostyka: zdarzenia bez odcisku ────────────────────────────────────────────────────

export interface UdzialBezOdcisku {
  bez: number | null
  suma: number | null
  /** Procent `bez` z `suma`; `null` przy sumie 0 (brak danych, nie 0%) i przy danych niespójnych. */
  procent: number | null
}

/**
 * Udział zdarzeń bez odcisku w WSZYSTKICH zdarzeniach z 24 h (podstawa = suma siedmiu typów, ta sama
 * populacja co licznik: baza liczy oba na ruchu ludzi z tego samego okna). Część większa od całości
 * znaczy, że odpowiedź jest niespójna, więc procentu z fałszywej podstawy nie liczymy.
 */
export function udzialBezOdcisku(diagnostyka: Diagnostyka | null | undefined): UdzialBezOdcisku {
  const suma = sumaZdarzen24h(diagnostyka)
  const surowa: unknown = diagnostyka?.bez_odcisku_24h
  const bez = czyLiczba(surowa) && surowa >= 0 ? surowa : null
  if (suma === null || bez === null || bez > suma) return { bez, suma, procent: null }
  return { bez, suma, procent: procentOd(bez, suma) }
}

/**
 * Napis udziału. Niezerowa liczba, która zaokrągla się do 0,0%, jest pokazana jako „< 0,1%”: „0,0%”
 * obok ostrzeżenia czytałoby się jak sprzeczność. `null` (brak danych) zostaje szarym stanem kafla.
 */
export function formatUdzialuBezOdcisku(udzial: UdzialBezOdcisku): string | null {
  if (udzial.procent === null) return null
  if (udzial.procent === 0 && (udzial.bez ?? 0) > 0) return '< 0,1%'
  return formatProcent(udzial.procent)
}

// ── Diagnostyka: ostatni bieg zestawienia ─────────────────────────────────────────────────

/**
 * Stan ostatniego biegu zestawienia. Cztery stany z zadania (`ok`, `opozniony`, `blad`, `brak`) plus
 * `nieustalony` dla biegu bez poprawnego czasu zakończenia (trwa albo został przerwany): wiek takiego
 * biegu jest nieznany, więc nie wolno go nazwać ani „OK”, ani „opóźniony”.
 */
export type StanBiegu = 'ok' | 'opozniony' | 'blad' | 'brak' | 'nieustalony'

export interface OcenaBiegu {
  stan: StanBiegu
  /** Wiek zakończenia względem `teraz`; `null`, gdy bieg nie ma poprawnego czasu zakończenia. */
  wiekMs: number | null
}

/**
 * Klasyfikacja biegu (kolejność reguł jest częścią kontraktu):
 *  1. brak biegu w ogóle → `brak` (szary: zestawienie jeszcze nie biegło, zwłaszcza w pierwszej dobie),
 *  2. bieg z błędem → `blad` – bez względu na wiek: błąd jest bardziej pilny niż opóźnienie,
 *  3. bieg bez poprawnego czasu zakończenia (albo nieznane `teraz`) → `nieustalony`,
 *  4. zakończony ŚCIŚLE dawniej niż `PROG_BIEGU_MS` temu → `opozniony`, inaczej `ok`.
 */
export function klasyfikujBieg(bieg: OstatniBieg | null | undefined, teraz: number): OcenaBiegu {
  if (bieg === null || bieg === undefined || typeof bieg !== 'object') {
    return { stan: 'brak', wiekMs: null }
  }
  const wiek = wiekMs(bieg.koniec, teraz)
  const maBlad = typeof bieg.blad === 'string' && bieg.blad.trim() !== ''
  if (maBlad) return { stan: 'blad', wiekMs: wiek }
  if (wiek === null) return { stan: 'nieustalony', wiekMs: null }
  return { stan: wiek > PROG_BIEGU_MS ? 'opozniony' : 'ok', wiekMs: wiek }
}

/** Etykieta tekstowa wskaźnika: stan nigdy nie jest przekazany samym kolorem (WCAG 1.4.1). */
export const ETYKIETA_BIEGU: Readonly<Record<StanBiegu, string>> = {
  ok: 'OK',
  opozniony: 'opóźniony',
  blad: 'błąd',
  brak: 'brak biegu',
  nieustalony: 'bez zakończenia',
}

export type TonStanu = 'dobra' | 'uwaga' | 'zla' | 'neutralna'

/** Czerwony (`zla`) mają bieg opóźniony i bieg z błędem; brak biegu jest szary, nie czerwony. */
export const TON_BIEGU: Readonly<Record<StanBiegu, TonStanu>> = {
  ok: 'dobra',
  opozniony: 'zla',
  blad: 'zla',
  brak: 'neutralna',
  nieustalony: 'uwaga',
}

/**
 * Brak biegu ma dwa oblicza. `swiezy`: pomiar zaczął się niedawno (najstarsze zdarzenie młodsze niż
 * 26 h albo żadnego jeszcze nie ma), więc pierwszy nocny bieg może jeszcze nie nadejść – to normalne.
 * `zalegly`: pomiar działa dłużej niż 26 h, a zestawienie ani razu nie biegło – harmonogram nie
 * działa, a surowe zdarzenia znikają po 90 dniach. Stan (`brak`, etykieta „brak biegu”) jest ten sam
 * w obu przypadkach, jak w zadaniu; `zalegly` zmienia tylko ton wskaźnika z szarego na ostrzegawczy
 * (bursztynowy, nie czerwony) i treść wyjaśnienia.
 */
export type OkolicznoscBraku = 'swiezy' | 'zalegly'

export function okolicznoscBrakuBiegu(
  najstarszeZdarzenie: unknown,
  teraz: number,
): OkolicznoscBraku {
  const wiek = wiekMs(najstarszeZdarzenie, teraz)
  return wiek !== null && wiek > PROG_BIEGU_MS ? 'zalegly' : 'swiezy'
}

// ── Diagnostyka: dni w zestawieniu ────────────────────────────────────────────────────────

/**
 * Liczba dób w zestawieniu dziennym: nieujemna liczba albo `null`. Odpowiedź w złym kształcie (tekst,
 * liczba ujemna) to „brak danych”, a nie tekst z sieci wstawiony wprost do kafla. Zero jest prawdziwym
 * zerem (zestawienie jeszcze nie biegło), więc zostaje liczbą.
 */
export function dniWZestawieniu(diagnostyka: Diagnostyka | null | undefined): number | null {
  const surowa: unknown = diagnostyka?.dni_w_zestawieniu
  return czyLiczba(surowa) && surowa >= 0 ? surowa : null
}

// ── Diagnostyka: retencja ─────────────────────────────────────────────────────────────────

export interface OcenaRetencji {
  /** Pełne doby od najstarszego zdarzenia; `null`, gdy zdarzeń nie ma. */
  dni: number | null
  /** Najstarsze zdarzenie przekracza retencję z tolerancją: sprzątanie nie działa. */
  przekroczona: boolean
}

export function ocenaRetencji(najstarszeZdarzenie: unknown, teraz: number): OcenaRetencji {
  const wiek = wiekMs(najstarszeZdarzenie, teraz)
  if (wiek === null) return { dni: null, przekroczona: false }
  const dni = Math.floor(wiek / MS_DOBY)
  return { dni, przekroczona: dni > RETENCJA_DNI + TOLERANCJA_RETENCJI_DNI }
}

// ── Web Vitals ────────────────────────────────────────────────────────────────────────────

/**
 * Poniżej tylu pomiarów p75 jest „mało próbek”. Percentyl 75 z czterech pomiarów leży między drugą
 * a największą wartością, więc o wyniku decyduje jeden odstający telefon w tunelu; od pięciu to
 * druga największa z pięciu – wciąż słabe, ale to dolna granica, od której wartość coś mówi.
 * Próg ostrzega, nie ukrywa: wartość, liczba próbek i ocena zostają na ekranie.
 */
export const MIN_PROBEK = 5

export interface KomorkaWitalu {
  metryka: MetrykaWitalu
  p75: number | null
  /** Liczba pomiarów (całkowita, ≥ 0). */
  probki: number
  /** Ocena wobec progów Google; `null`, gdy brak p75. */
  ocena: OcenaWitalu | null
  maloProbek: boolean
}

export interface WierszWitali {
  ekran: string
  /** Komórka na metrykę; `null` = ta metryka nie ma pomiaru na tym ekranie (brak danych, nie zero). */
  komorki: Readonly<Record<MetrykaWitalu, KomorkaWitalu | null>>
}

export interface MetrykaNieznana {
  ekran: string
  metryka: string
  probki: number
}

export interface UkladWitali {
  wiersze: WierszWitali[]
  /** Znane ekrany bez żadnego pomiaru w oknie: nikt tam nie zaczął wizyty albo pomiar milczy. */
  bezPomiarow: string[]
  /** Wiersze z metryką, której tabela nie ma (nowa metryka w bazie): widoczne w przypisie, nie gubione. */
  nieznane: MetrykaNieznana[]
}

const ZNANE_EKRANY: readonly string[] = Object.keys(NAZWA_EKRANU)

/**
 * Układ macierzy ekran × metryka. Wiersze idą w stałej kolejności ekranów serwisu (z `NAZWA_EKRANU`),
 * potem ekrany nieznane alfabetycznie – kolejność nie zależy od sortowania w bazie ani od liczby
 * próbek, więc tabela nie skacze po odświeżeniu. Ekran bez żadnego pomiaru nie dostaje wiersza, tylko
 * wpis w `bezPomiarow`. Dubel (ekran, metryka) zostaje z większą liczbą próbek.
 */
export function ukladWitali(wiersze: readonly WierszWitalu[] | null | undefined): UkladWitali {
  const poEkranie = new Map<string, Partial<Record<MetrykaWitalu, KomorkaWitalu>>>()
  const nieznane: MetrykaNieznana[] = []

  for (const w of wiersze ?? []) {
    if (typeof w !== 'object' || w === null) continue
    const ekran = oczyscTekst(w.ekran)
    const surowaMetryka = oczyscTekst(w.metryka)
    if (ekran === '' || surowaMetryka === '') continue
    const probki = czyLiczba(w.probki) && w.probki > 0 ? Math.floor(w.probki) : 0
    const metryka = surowaMetryka.toLowerCase()
    if (!jestMetrykaWitalu(metryka)) {
      nieznane.push({ ekran, metryka: surowaMetryka, probki })
      continue
    }
    const p75 = czyLiczba(w.p75) && w.p75 >= 0 ? w.p75 : null
    const komorka: KomorkaWitalu = {
      metryka,
      p75,
      probki,
      ocena: ocenaWitalu(metryka, p75),
      maloProbek: probki < MIN_PROBEK,
    }
    const zbior = poEkranie.get(ekran) ?? {}
    const poprzednia = zbior[metryka]
    if (poprzednia === undefined || komorka.probki > poprzednia.probki) zbior[metryka] = komorka
    poEkranie.set(ekran, zbior)
  }

  const znane = ZNANE_EKRANY.filter((ekran) => poEkranie.has(ekran))
  const obce = [...poEkranie.keys()].filter((ekran) => !ZNANE_EKRANY.includes(ekran)).sort()
  const ukladane: WierszWitali[] = [...znane, ...obce].map((ekran) => {
    const zbior = poEkranie.get(ekran) ?? {}
    const komorki = {} as Record<MetrykaWitalu, KomorkaWitalu | null>
    for (const m of METRYKI_WITALI) komorki[m] = zbior[m] ?? null
    return { ekran, komorki }
  })

  return {
    wiersze: ukladane,
    bezPomiarow: ZNANE_EKRANY.filter((ekran) => !poEkranie.has(ekran)),
    nieznane,
  }
}

/**
 * Ton znacznika oceny. Przy małej liczbie próbek ocena jest szara (`neutralna`) niezależnie od
 * wyniku: czerwone „słaba” z dwóch pomiarów krzyczałoby głośniej, niż pozwalają dane. Słowo oceny
 * zostaje w znaczniku, więc informacja nie ginie – gaśnie tylko alarmowy kolor.
 */
export function tonOceny(ocena: OcenaWitalu, maloProbek: boolean): TonStanu {
  if (maloProbek) return 'neutralna'
  if (ocena === 'dobra') return 'dobra'
  return ocena === 'do-poprawy' ? 'uwaga' : 'zla'
}

function formaMnoga(n: number, jeden: string, kilka: string, wiele: string): string {
  const reszta10 = n % 10
  const reszta100 = n % 100
  if (n === 1) return jeden
  if (reszta10 >= 2 && reszta10 <= 4 && !(reszta100 >= 12 && reszta100 <= 14)) return kilka
  return wiele
}

/** „1 próbka”, „3 próbki”, „5 próbek”, „22 próbki”, „112 próbek”. */
export function liczbaProbek(n: number): string {
  const calkowita = czyLiczba(n) && n > 0 ? Math.floor(n) : 0
  return `${formatLiczby(calkowita)} ${formaMnoga(calkowita, 'próbka', 'próbki', 'próbek')}`
}

const formatProgu = new Intl.NumberFormat('pl-PL', {
  maximumFractionDigits: 3,
  useGrouping: 'always',
})

/**
 * Progi Google do podpisu tabeli, zbudowane z `PROGI_WITALI` (jedno źródło prawdy): „LCP 2 500 / 4 000
 * ms, …, CLS 0,1 / 0,25”. Pierwsza liczba to granica „dobra” (włącznie), druga – granica „słaba”.
 */
export function opisProgowWitali(): string {
  return METRYKI_WITALI.map((metryka) => {
    const { dobra, slaba } = PROGI_WITALI[metryka]
    const jednostka = metryka === 'cls' ? '' : ' ms'
    return `${metryka.toUpperCase()} ${formatProgu.format(dobra)} / ${formatProgu.format(slaba)}${jednostka}`
  }).join(', ')
}

// ── Błędy klienta ─────────────────────────────────────────────────────────────────────────

/** Ile najczęstszych komunikatów prosimy bazę (domyślne `p_limit` funkcji); powyżej tego lista jest przycięta. */
export const LIMIT_BLEDOW = 50

export interface WierszBleduWidok {
  /** Unikalny w liście (zawiera numer pozycji), do `key` w Reactcie. */
  klucz: string
  /** Komunikat oczyszczony i skrócony do `MAX_KOMUNIKAT`. */
  komunikat: string
  /** Pełny oczyszczony komunikat do dymka – tylko gdy skrócono. */
  pelny: string | null
  ekran: string
  ile: number | null
  /** ISO, gdy poprawny. */
  ostatnio: string | null
}

/**
 * Wiersze błędów do tabeli: oczyszczone teksty (dane od dowolnego klienta), od najczęstszych; remis
 * rozstrzyga nowsze wystąpienie, potem alfabet. Pozycje, które nie są obiektami, są pomijane.
 */
export function wierszeBledow(
  wiersze: readonly WierszBledu[] | null | undefined,
): WierszBleduWidok[] {
  const wynik: Omit<WierszBleduWidok, 'klucz'>[] = []
  for (const w of wiersze ?? []) {
    if (typeof w !== 'object' || w === null) continue
    const pelny = oczyscTekst(w.komunikat)
    const komunikat = skrocTekst(pelny, MAX_KOMUNIKAT)
    wynik.push({
      komunikat: komunikat === '' ? '(pusty komunikat)' : komunikat,
      pelny: komunikat !== pelny ? skrocTekst(pelny, MAX_PELNY) : null,
      ekran: oczyscTekst(w.ekran),
      ile: czyLiczba(w.ile) && w.ile >= 0 ? w.ile : null,
      ostatnio: czasMs(w.ostatnio) === null ? null : (w.ostatnio as string),
    })
  }
  wynik.sort(
    (a, b) =>
      (b.ile ?? -1) - (a.ile ?? -1) ||
      (czasMs(b.ostatnio) ?? 0) - (czasMs(a.ostatnio) ?? 0) ||
      (a.komunikat < b.komunikat ? -1 : a.komunikat > b.komunikat ? 1 : 0) ||
      (a.ekran < b.ekran ? -1 : a.ekran > b.ekran ? 1 : 0),
  )
  return wynik.map((w, i) => ({ ...w, klucz: `${i}|${w.ekran}|${w.komunikat}` }))
}

/**
 * Co znaczy pusta lista błędów.
 *  - `sa`: są błędy, pokaż tabelę.
 *  - `czysto`: lista pusta, a pomiar ŻYJE (`pomiarZyje`) – dobra wiadomość („brak błędów”).
 *  - `niepewne`: lista pusta, ale nie da się stwierdzić, czy pomiar działa – szary stan, nie zielony.
 *
 * Zielone „brak błędów” pokazujemy tylko z dowodem, że kanał błędów działa; fałszywe uspokojenie jest
 * groźniejsze niż szare „nie wiadomo”.
 */
export type WerdyktBledow = 'sa' | 'czysto' | 'niepewne'

export function werdyktBledow(
  liczbaWierszy: number,
  diagnostyka: Diagnostyka | null | undefined,
): WerdyktBledow {
  if (liczbaWierszy > 0) return 'sa'
  return pomiarZyje(diagnostyka) ? 'czysto' : 'niepewne'
}
