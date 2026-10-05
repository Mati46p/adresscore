// Czytelne nazwy wartości z bazy (kanały, ekrany, kroki lejka…) – jedno miejsce dla wszystkich
// zakładek, żeby ten sam kanał nie nazywał się raz „odeslanie”, raz „Odesłania”.
//
// Nieznana wartość (nowy kanał, nowy ekran) wraca SAMA, zamiast zniknąć: wiersz z bazy, którego
// front jeszcze nie zna, musi być widoczny w panelu, inaczej liczby przestałyby się sumować bez
// śladu dlaczego. Wartości w nawiasach, jak `(wyjście)` czy `(nieznany)`, są już czytelne.
import type { KolorDanych } from './kolory.ts'
import type {
  EkranMierzony,
  KanalRuchu,
  KlasaBota,
  KrokLejkaProduktowego,
  MetrykaWitaluBazy,
  TypZdarzenia,
} from './typy.ts'

/** Nazwa z mapy albo sama wartość, gdy mapa jej nie zna. */
export function nazwa(
  mapa: Readonly<Record<string, string>>,
  wartosc: string | null | undefined,
): string {
  if (wartosc === null || wartosc === undefined || wartosc === '') return '(brak)'
  return Object.hasOwn(mapa, wartosc) ? (mapa[wartosc] as string) : wartosc
}

export const NAZWA_KANALU: Readonly<Record<KanalRuchu, string>> = {
  bezposrednie: '(bezpośrednie)',
  wyszukiwarka: 'Wyszukiwarki',
  social: 'Social media',
  ai: 'Asystenci AI',
  kampania: 'Kampanie',
  odeslanie: 'Odesłania z innych stron',
  wewnetrzne: 'Wewnętrzne',
}

/**
 * Stały slot koloru kanału (paleta danych, `kolory.ts`). Kolor idzie za BYTEM, nie za
 * pozycją w rankingu: po przefiltrowaniu kanał nie zmienia barwy. Kolejność slotów jest też
 * kolejnością rysowania, więc sąsiadują ze sobą tylko pary sprawdzone walidatorem palety.
 */
export const SLOT_KANALU: Readonly<Record<KanalRuchu, KolorDanych>> = {
  bezposrednie: 1,
  wyszukiwarka: 2,
  social: 3,
  odeslanie: 4,
  kampania: 5,
  ai: 6,
  wewnetrzne: 7,
}

/** Kolejność kanałów na ekranie (zgodna z kolejnością slotów kolorów). */
export const KOLEJNOSC_KANALOW: readonly KanalRuchu[] = [
  'bezposrednie',
  'wyszukiwarka',
  'social',
  'odeslanie',
  'kampania',
  'ai',
  'wewnetrzne',
]

export const NAZWA_EKRANU: Readonly<Record<EkranMierzony, string>> = {
  szukaj: 'Szukaj',
  okolica: 'Karta adresu',
  porownanie: 'Porównanie',
  metoda: 'Metoda i źródła',
  katalog: 'Katalog adresów',
  miasto: 'Dla miasta',
  biznes: 'Dla biznesu',
}

export const NAZWA_URZADZENIA: Readonly<Record<string, string>> = {
  mobile: 'Telefon',
  tablet: 'Tablet',
  desktop: 'Komputer',
  inne: 'Inne',
}

export const NAZWA_KLASY_BOTA: Readonly<Record<KlasaBota, string>> = {
  ai: 'Crawlery AI',
  wyszukiwarka: 'Wyszukiwarki',
  podglad: 'Podglądy linków',
  narzedzie: 'Narzędzia i skrypty',
  monitoring: 'Monitoring',
  inny: 'Inne',
}

export const NAZWA_TYPU_ZDARZENIA: Readonly<Record<TypZdarzenia, string>> = {
  odslona: 'Odsłony',
  wyjscie: 'Wyjścia',
  klik: 'Kliknięcia',
  udostepnienie: 'Udostępnienia',
  produktowe: 'Zdarzenia produktowe',
  wital: 'Pomiary szybkości',
  blad: 'Błędy klienta',
}

/** Kolejność typów w diagnostyce (jak w `TypZdarzenia`). */
export const KOLEJNOSC_TYPOW_ZDARZEN: readonly TypZdarzenia[] = [
  'odslona',
  'wyjscie',
  'klik',
  'udostepnienie',
  'produktowe',
  'wital',
  'blad',
]

export const NAZWA_KROKU_LEJKA: Readonly<Record<KrokLejkaProduktowego, string>> = {
  wyszukanie: 'Wyszukanie',
  karta_adresu: 'Karta adresu',
  porownanie_dodaj: 'Dodanie do porównania',
  warstwa_mapy: 'Zmiana warstwy mapy',
  tryb_biznes: 'Wejście w tryb Biznes',
}

export const NAZWA_SPOSOBU_UDOSTEPNIENIA: Readonly<Record<string, string>> = {
  link: 'Link',
  kopia: 'Kopiowanie',
  natywne: 'Menu systemowe',
  anulowano: 'Anulowano',
  blad: 'Błąd',
}

export const NAZWA_SYGNALU_UX: Readonly<Record<string, string>> = {
  furia: 'Szybkie wielokrotne kliknięcia',
  martwy: 'Kliknięcie w nieklikalne',
}

export const NAZWA_BIEGU: Readonly<Record<string, string>> = {
  zestaw: 'Zestawienie dzienne',
  sprzatanie: 'Sprzątanie',
}

export const NAZWA_WITALU: Readonly<Record<MetrykaWitaluBazy, string>> = {
  lcp: 'LCP – największa treść',
  inp: 'INP – reakcja na interakcję',
  cls: 'CLS – przesunięcia układu',
  fcp: 'FCP – pierwsza treść',
  ttfb: 'TTFB – odpowiedź serwera',
}
