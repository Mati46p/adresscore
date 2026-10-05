// Arytmetyka prezentacji panelu: udziały, procenty, lejek, zmiana, ocena Web Vitals i formaty liczb.
//
// Wszystko czyste i bez zależności, żeby dało się to objąć testem na gołym `node --test` (bez DOM,
// bez aliasu `@/`). To jest ten jeden plik, w którym wolno liczyć procenty na ekranie; komponenty
// i zakładki wołają stąd, a nie dzielą liczb we własnych pętlach. Reguły („Liczby na ekranie”):
//
//  1. 100% to CAŁOŚĆ, nie największa pozycja. Podstawa udziału to suma wszystkich wierszy tej
//     całości (`udzialy`) albo jawnie podana całość (`procentOd`). Segmenty jednej całości domyka
//     do 100,0 metoda największej reszty, żeby suma wypisanych procentów zgadzała się z liczbą
//     z nagłówka; pilnuje tego test inwariantu (`arytmetyka.test.ts`).
//  2. Dzielenie przez wartość ZE ZNAKIEM odwraca wynik, więc procent i zmiana procentowa istnieją
//     tylko przy DODATNIM odniesieniu (inaczej `null`, a nie strzałka w złą stronę).
//  3. Brak danych to `null`, nigdy 0 i nigdy NaN. Formaty zamieniają `null` w napis „brak danych”.
//  4. Liczba i jednostka stoją razem: między nimi jest spacja nierozdzielająca (U+00A0), więc
//     w wąskim kaflu „1 s” nie rozpada się na „1” i „s” w dwóch liniach, a rzeczownik po
//     liczebniku ma poprawną formę („1 odsłona”, „2 odsłony”, „5 odsłon”, „22 odsłony”; `odmiana`).

/** Napis dla braku pomiaru. Szary stan „brak danych” (FR-040) zamiast zera udającego wynik. */
export const BRAK_DANYCH = 'brak danych'

/**
 * Spacja nierozdzielająca (U+00A0): przeglądarka nie łamie w niej linii. Zbudowana z kodu znaku, bo
 * literał w źródle jest nie do odróżnienia od zwykłej spacji, a formater (Biome) zamienia na niego
 * nawet zapis z ucieczką Unicode.
 */
export const NBSP = String.fromCharCode(0xa0)

/** Liczba skończona. `null`, `undefined`, `NaN` i ±∞ to brak pomiaru, nie wartość. */
export function czyLiczba(wartosc: unknown): wartosc is number {
  return typeof wartosc === 'number' && Number.isFinite(wartosc)
}

/**
 * Zaokrągla do `miejsca` cyfr po przecinku, połówki od zera (-2,5 → -3), żeby wzrost i spadek
 * o tę samą wartość zaokrąglały się symetrycznie. `Math.round` zaokrągla połówki w stronę +∞.
 */
export function zaokraglij(wartosc: number, miejsca = 1): number {
  const mnoznik = 10 ** miejsca
  const wynik = (Math.sign(wartosc) * Math.round(Math.abs(wartosc) * mnoznik)) / mnoznik
  return wynik + 0 // zamienia -0 na 0
}

// ── Udziały ───────────────────────────────────────────────────────────────────────────────

/** Klucze wiersza, pod którymi leży liczba (albo jej brak). */
export type KluczLiczbowy<T> = {
  [K in keyof T]: T[K] extends number | null | undefined ? K : never
}[keyof T]

function wartoscWiersza<T>(
  wiersz: T,
  klucz: KluczLiczbowy<T> | ((w: T) => number | null | undefined),
): number | null {
  const surowa = typeof klucz === 'function' ? klucz(wiersz) : wiersz[klucz]
  // Liczność ujemna jest błędem danych, nie wkładem do całości (jak NaN i ±∞).
  return czyLiczba(surowa) && surowa >= 0 ? surowa : null
}

/**
 * Udziały procentowe wierszy w SUMIE wszystkich wierszy. Wynik idzie równolegle do `wiersze`.
 *
 * - Podstawa to suma wartości wszystkich wierszy, nigdy największa pozycja.
 * - Metoda największej reszty (Hamiltona) na precyzji `miejsca` cyfr po przecinku (domyślnie 1):
 *   każdy wiersz dostaje podłogę swojego udziału, a brakujące jednostki trafiają do wierszy o
 *   największej części ułamkowej (remis rozstrzyga kolejność wejściowa, bez zależności od silnika).
 *   Suma wypisanych udziałów domyka się więc DOKŁADNIE do 100 na tej precyzji, a każdy udział
 *   odbiega od dokładnego o mniej niż jednostkę ostatniej cyfry.
 * - Suma 0 (albo brak poprawnych wierszy) → wszystkie `null`: nie ma czego dzielić, a dzielenie
 *   przez zero dałoby NaN albo Infinity.
 * - Wartość ujemna, `NaN`, ±∞, `null` i `undefined` są odrzucane jawnie: wiersz dostaje `null` i nie
 *   wchodzi do podstawy. Funkcja nie rzuca (jest wołana w renderze), a udział „nie wiem” nie udaje
 *   zera.
 *
 * Gdy wiersze to tylko FRAGMENT całości (np. 50 z 400 źródeł), nie wołaj tej funkcji: segmenty nie
 * sumują się do 100%, więc podaj prawdziwą całość do `procentOd`.
 */
export function udzialy<T>(
  wiersze: readonly T[],
  klucz: KluczLiczbowy<T> | ((w: T) => number | null | undefined),
  miejsca = 1,
): (number | null)[] {
  const wartosci = wiersze.map((w) => wartoscWiersza(w, klucz))
  const podstawa = wartosci.reduce<number>((s, v) => s + (v ?? 0), 0)
  if (!(podstawa > 0)) return wiersze.map(() => null)

  const jednostki = 100 * 10 ** miejsca
  const dokladne = wartosci.map((v) => (v === null ? 0 : (v * jednostki) / podstawa))
  const wynik = dokladne.map((d) => Math.floor(d))
  const brakuje = jednostki - wynik.reduce((s, n) => s + n, 0)

  const kolejnosc = wartosci
    .map((v, indeks) => ({ indeks, reszta: (dokladne[indeks] ?? 0) - (wynik[indeks] ?? 0), v }))
    .filter((p) => p.v !== null)
    .sort((a, b) => b.reszta - a.reszta || a.indeks - b.indeks)
  // `% długość` tylko jako zabezpieczenie przed błędem zmiennoprzecinkowym; matematycznie
  // brakuje < liczba wierszy.
  for (let k = 0; k < brakuje && kolejnosc.length > 0; k++) {
    const cel = kolejnosc[k % kolejnosc.length]
    if (cel) wynik[cel.indeks] = (wynik[cel.indeks] ?? 0) + 1
  }
  return wartosci.map((v, i) => (v === null ? null : (wynik[i] ?? 0) / 10 ** miejsca))
}

/**
 * Procent `czesc` z `calosc`. `null`, gdy całość jest nieskończona, niepoprawna albo ≤ 0, gdy część
 * jest niepoprawna albo ujemna. Część większa od całości jest dozwolona (zwraca > 100): lejek
 * liczony na sesjach niezależnie na krok może mieć więcej kart niż wyszukań.
 */
export function procentOd(
  czesc: number | null | undefined,
  calosc: number | null | undefined,
  miejsca = 1,
): number | null {
  if (!czyLiczba(czesc) || !czyLiczba(calosc) || calosc <= 0 || czesc < 0) return null
  return zaokraglij((czesc / calosc) * 100, miejsca)
}

// ── Lejek ─────────────────────────────────────────────────────────────────────────────────

export interface WynikKrokuLejka<T> {
  krok: T
  /** Liczność kroku albo `null`, gdy brak poprawnej wartości. */
  wartosc: number | null
  /** Procent liczności pierwszego kroku (pierwszy krok = 100). `null` przy pustym pierwszym. */
  odPierwszego: number | null
  /** Procent liczności poprzedniego kroku. Pierwszy krok nie ma poprzedniego (`null`). */
  odPoprzedniego: number | null
}

/**
 * Lejek: dla każdego kroku procent od pierwszego i od poprzedniego. Kroki liczone są niezależnie
 * (sesja liczy się do kroku, gdy ma zdarzenie tego kroku), więc ani liczność, ani procent nie muszą
 * maleć: krok może przekroczyć 100% pierwszego. `null` zawsze znaczy „nie da się policzyć”
 * (zerowy albo brakujący pierwszy lub poprzedni krok), nigdy 0%.
 */
export function lejek<T extends { wartosc: number | null | undefined }>(
  kroki: readonly T[],
  miejsca = 1,
): WynikKrokuLejka<T>[] {
  const wartosci = kroki.map((k) => (czyLiczba(k.wartosc) && k.wartosc >= 0 ? k.wartosc : null))
  const pierwszy = wartosci[0] ?? null
  return kroki.map((krok, i) => ({
    krok,
    wartosc: wartosci[i] ?? null,
    odPierwszego: procentOd(wartosci[i], pierwszy, miejsca),
    odPoprzedniego: i === 0 ? null : procentOd(wartosci[i], wartosci[i - 1], miejsca),
  }))
}

// ── Zmiana ────────────────────────────────────────────────────────────────────────────────

/**
 * Zmiana procentowa `teraz` wobec `wtedy`: `(teraz − wtedy) / wtedy × 100`. Tylko przy DODATNIM
 * odniesieniu. Przy `wtedy ≤ 0` (zero, saldo ujemne) wynik byłby nieokreślony albo odwrócony
 * (ujemny mianownik zamienia poprawę w strzałkę w dół), więc zwracamy `null` i wołający pokazuje
 * różnicę bezwzględną. Wynik może być ujemny (spadek) i większy od 100 (wzrost ponad dwukrotny).
 */
export function zmianaProcentowa(
  teraz: number | null | undefined,
  wtedy: number | null | undefined,
  miejsca = 1,
): number | null {
  if (!czyLiczba(teraz) || !czyLiczba(wtedy) || wtedy <= 0) return null
  return zaokraglij(((teraz - wtedy) / wtedy) * 100, miejsca)
}

// ── Serie czasowe ─────────────────────────────────────────────────────────────────────────

/**
 * Które punkty serii są IZOLOWANE: mają wartość, a żaden z sąsiadów jej nie ma (sąsiad to przerwa
 * `null`/`undefined`/NaN albo brak punktu na brzegu serii). Wykres liniowy łączy tylko sąsiednie
 * punkty z wartością, więc punkt izolowany (jedyny w serii, jedyny po przerwie, pierwsza doba
 * pomiaru) nie ma żadnego odcinka i bez własnego znacznika jest niewidoczny, choć dane są.
 * Zero jest wartością (zmierzone zero), nie przerwą. Wynik idzie równolegle do `wartosci`.
 */
export function punktyIzolowane(wartosci: readonly (number | null | undefined)[]): boolean[] {
  return wartosci.map(
    (w, i) => czyLiczba(w) && !czyLiczba(wartosci[i - 1]) && !czyLiczba(wartosci[i + 1]),
  )
}

// ── Web Vitals ────────────────────────────────────────────────────────────────────────────

export type MetrykaWitalu = 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb'
export type OcenaWitalu = 'dobra' | 'do-poprawy' | 'slaba'

/**
 * Progi Google (p75): do `dobra` włącznie = dobra, do `slaba` włącznie = do poprawy, powyżej =
 * słaba. LCP, INP, FCP i TTFB w milisekundach, CLS bezwymiarowy (ułamek).
 */
export const PROGI_WITALI: Readonly<Record<MetrykaWitalu, { dobra: number; slaba: number }>> = {
  lcp: { dobra: 2500, slaba: 4000 },
  inp: { dobra: 200, slaba: 500 },
  cls: { dobra: 0.1, slaba: 0.25 },
  fcp: { dobra: 1800, slaba: 3000 },
  ttfb: { dobra: 800, slaba: 1800 },
}

/** Ocena słowem (kolor nigdy nie jest jedynym nośnikiem oceny). */
export const ETYKIETA_OCENY: Readonly<Record<OcenaWitalu, string>> = {
  dobra: 'dobra',
  'do-poprawy': 'do poprawy',
  slaba: 'słaba',
}

/** Kolejność metryk w tabelach i skróty widoczne dla czytelnika. */
export const METRYKI_WITALI: readonly MetrykaWitalu[] = ['lcp', 'inp', 'cls', 'fcp', 'ttfb']

export function jestMetrykaWitalu(nazwa: string): nazwa is MetrykaWitalu {
  return Object.hasOwn(PROGI_WITALI, nazwa)
}

/**
 * Ocena p75 metryki wobec progów Google. `null`, gdy brak pomiaru, wartość jest niepoprawna
 * (NaN, ujemna) albo metryka nieznana: brak pomiaru to nie „słaba”.
 */
export function ocenaWitalu(metryka: string, p75: number | null | undefined): OcenaWitalu | null {
  const nazwa = metryka.toLowerCase()
  if (!jestMetrykaWitalu(nazwa) || !czyLiczba(p75) || p75 < 0) return null
  const progi = PROGI_WITALI[nazwa]
  if (p75 <= progi.dobra) return 'dobra'
  if (p75 <= progi.slaba) return 'do-poprawy'
  return 'slaba'
}

// ── Formaty ───────────────────────────────────────────────────────────────────────────────

const formatyLiczb = new Map<string, Intl.NumberFormat>()

function formatLiczbowy(min: number, max: number): Intl.NumberFormat {
  const klucz = `${min}-${max}`
  let format = formatyLiczb.get(klucz)
  if (!format) {
    format = new Intl.NumberFormat('pl-PL', {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
      // Polski domyślnie nie grupuje liczb czterocyfrowych („2450”, ale „12 450”); w kolumnie tabeli
      // to wygląda jak dwie różne konwencje, więc grupujemy zawsze.
      useGrouping: 'always',
    })
    formatyLiczb.set(klucz, format)
  }
  return format
}

/**
 * Liczba w formacie pl-PL, PEŁNA (bez skrótów typu „12,9 tys.”): w tabelach i legendach zaokrąglenie
 * ukrywa liczbę, po którą admin przyszedł. `miejsca` to stała liczba cyfr po przecinku. Brak
 * pomiaru → „brak danych”.
 */
export function formatLiczby(wartosc: number | null | undefined, miejsca = 0): string {
  if (!czyLiczba(wartosc)) return BRAK_DANYCH
  return formatLiczbowy(miejsca, miejsca).format(wartosc + 0)
}

/** Procent z `miejsca` cyframi po przecinku (domyślnie jedna: „42,9%”). Brak pomiaru → „brak danych”. */
export function formatProcent(procent: number | null | undefined, miejsca = 1): string {
  if (!czyLiczba(procent)) return BRAK_DANYCH
  return `${formatLiczbowy(miejsca, miejsca).format(procent + 0)}%`
}

/** Milisekundy jako pełna liczba: „2 450 ms”. Do Web Vitals, gdzie próg podajemy w ms. */
export function formatMs(ms: number | null | undefined): string {
  if (!czyLiczba(ms)) return BRAK_DANYCH
  return `${formatLiczby(Math.round(ms))} ms`
}

/**
 * Czas czytelny dla człowieka z milisekund: „850 ms”, „2,4 s”, „3 min 5 s”, „1 h 5 min”.
 * Czasy sesji z bazy przychodzą w sekundach, więc woła się go z `sekundy * 1000`. Czasy są
 * PODŁOGĄ (czas biegnie tylko przy widocznej karcie, doba przecina wizytę) i słownik to mówi.
 *
 * Między LICZBĄ a JEDNOSTKĄ jest zawsze spacja nierozdzielająca (`NBSP`), we wszystkich gałęziach:
 * wąski kafel nie rozerwie „1 s” na „1” i „s”. Spacja MIĘDZY składnikami zostaje zwykła celowo, bo
 * to jedyne miejsce, w którym wolno złamać linię: przy samych zwykłych spacjach „12 min 59 s”
 * łamie się między liczbą a jednostką („12 min 59” i „s”), a przy samych NBSP napis bez szczelin
 * łamie się w dowolnym znaku (kafel ma `overflow-wrap: anywhere`), też jako „12 min 59” i „s”.
 * Tylko ta mieszanka daje „12 min” i „59 s” w dwóch liniach (sprawdzone w Edge, kafel 160 px).
 */
export function formatCzasu(ms: number | null | undefined): string {
  if (!czyLiczba(ms) || ms < 0) return BRAK_DANYCH
  // Granice sprawdzamy po zaokrągleniu: 999,6 ms to już „1 s”, a 59,96 s to „1 min”, nie „60 s”.
  const calkowiteMs = Math.round(ms)
  if (calkowiteMs < 1000) return `${formatLiczby(calkowiteMs)}${NBSP}ms`
  const dziesiateSekundy = Math.round(ms / 100)
  if (dziesiateSekundy < 600) {
    const sekundy = dziesiateSekundy / 10
    return `${formatLiczby(sekundy, Number.isInteger(sekundy) ? 0 : 1)}${NBSP}s`
  }
  const sekundyCale = Math.round(ms / 1000)
  const godziny = Math.floor(sekundyCale / 3600)
  const minuty = Math.floor((sekundyCale % 3600) / 60)
  const sekundy = sekundyCale % 60
  if (godziny > 0) {
    return minuty > 0 ? `${godziny}${NBSP}h ${minuty}${NBSP}min` : `${godziny}${NBSP}h`
  }
  return sekundy > 0 ? `${minuty}${NBSP}min ${sekundy}${NBSP}s` : `${minuty}${NBSP}min`
}

/** p75 metryki Web Vitals w jej jednostce: CLS jako ułamek („0,087”), reszta w ms („2 450 ms”). */
export function formatWitalu(metryka: string, p75: number | null | undefined): string {
  if (!czyLiczba(p75)) return BRAK_DANYCH
  return metryka.toLowerCase() === 'cls' ? formatLiczby(p75, 3) : formatMs(p75)
}

// ── Odmiana rzeczownika po liczebniku ─────────────────────────────────────────────────────

/**
 * Trzy formy rzeczownika, które wystarczą po liczebniku: „1 odsłona”, „2 odsłony”, „5 odsłon”
 * (mianownik liczby pojedynczej, mianownik liczby mnogiej, dopełniacz liczby mnogiej).
 */
export type FormyLiczebnika = readonly [jeden: string, kilka: string, wiele: string]

/**
 * Formy jednostek, które panel podpisuje liczbą („100% = 22 odsłony łącznie”). Tablica w jednym
 * miejscu, bo „22 odsłon” (zła forma) to błąd, który wraca przy każdej nowej kopii podpisu.
 */
export const JEDNOSTKI = {
  odslony: ['odsłona', 'odsłony', 'odsłon'],
  wizyty: ['wizyta', 'wizyty', 'wizyt'],
  sesje: ['sesja', 'sesje', 'sesji'],
} as const satisfies Record<string, FormyLiczebnika>

/**
 * Forma rzeczownika zgodna z liczbą (mianownik/biernik po liczebniku):
 *  - 1 → `jeden` („1 odsłona”),
 *  - kończące się na 2, 3, 4, ale nie na 12, 13, 14 → `kilka` („2 odsłony”, „22 odsłony”),
 *  - reszta, także 0 → `wiele` („0 odsłon”, „5 odsłon”, „12 odsłon”, „25 odsłon”, „112 odsłon”).
 * Liczba ujemna jest odmieniana jak jej wartość bezwzględna. Ułamek dostaje `kilka`: polszczyzna
 * wymaga wtedy dopełniacza liczby pojedynczej, który dla rzeczowników na „-a” brzmi tak samo
 * („2,5 odsłony”). Wartość nieskończona albo NaN dostaje `wiele`.
 */
export function odmiana(liczba: number, formy: FormyLiczebnika): string {
  const [jeden, kilka, wiele] = formy
  if (!Number.isFinite(liczba)) return wiele
  if (!Number.isInteger(liczba)) return kilka
  const k = Math.abs(liczba)
  if (k === 1) return jeden
  const ostatnia = k % 10
  const ostatnieDwie = k % 100
  return ostatnia >= 2 && ostatnia <= 4 && (ostatnieDwie < 12 || ostatnieDwie > 14) ? kilka : wiele
}

/**
 * Liczba w formacie pl-PL z rzeczownikiem w poprawnej formie, połączona spacją nierozdzielającą:
 * „22 odsłony”, „1 wizyta”, „12 450 odsłon”. Brak pomiaru → „brak danych” (bez jednostki).
 */
export function liczbaZRzeczownikiem(
  wartosc: number | null | undefined,
  formy: FormyLiczebnika,
  miejsca = 0,
): string {
  if (!czyLiczba(wartosc)) return BRAK_DANYCH
  return `${formatLiczby(wartosc, miejsca)}${NBSP}${odmiana(wartosc, formy)}`
}
