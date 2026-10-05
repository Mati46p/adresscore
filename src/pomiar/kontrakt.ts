// Kontrakt zdarzeń pomiaru po stronie KLIENTA: typy i stałe `as const`.
//
// Źródłem prawdy dla serwera jest api/_zdarzenie-kontrakt.js (te same nazwy i wartości).
// Dwa pliki zamiast jednego, bo tsconfig nie obejmuje api/ i nie ma allowJs, a funkcje
// hostingu nie czytają TS (research.md R6). Parytet pilnuje api/_zdarzenie-kontrakt.test.js:
// importuje oba pliki (Node 24 zdejmuje typy) i porównuje wartości. Zmieniasz listę – zmieniasz
// oba pliki i test w jednym commicie, inaczej nowa nazwa po jednej stronie jest po cichu
// odrzucana przez drugą.
//
// DLACZEGO ZERO RUNTIME-IMPORTÓW: plik ma się ładować w gołym Node (test parytetu, testy modułu).
// Jedyny import to `import type` (usuwany przed uruchomieniem), więc nic nie ciągnie DOM-u.
//
// Nie ma tu list tylko-serwerowych (kanały wejścia, klasy botów, kolumny wiersza): klient ich
// nie zna i nie wysyła – kanał liczy serwer z referera i znaczników (research.md R5).
//
// Kształt drutu: specs/001-panel-analityka/contracts/endpoint-zdarzenie.md.

import type { Ekran } from '@/wynik/url'

/** Typy zdarzeń. */
export const TYPY = [
  'odslona',
  'wyjscie',
  'klik',
  'udostepnienie',
  'produktowe',
  'wital',
  'blad',
] as const

/** Klasa urządzenia liczona lokalnie z UA – do sieci wychodzi klasa, nigdy sam UA. */
export const URZADZENIA = ['mobile', 'tablet', 'desktop', 'inne'] as const

/** Zamknięta lista zdarzeń produktowych. */
export const NAZWY_PRODUKTOWE = [
  'wyszukanie',
  'wyszukanie_bez_wyniku',
  'karta_adresu',
  'porownanie_dodaj',
  'warstwa_mapy',
  'tryb_biznes',
  'tryb_miasto',
  'udostepnij',
  'pomiar_wylaczony',
] as const

/** Rodzaje wyszukania we właściwości `rodzaj` zdarzenia `wyszukanie`. */
export const RODZAJE_WYSZUKANIA = ['adres', 'ulica', 'okolica'] as const

/** Metryki Web Vitals (typ `wital`). */
export const METRYKI_WITAL = ['lcp', 'inp', 'cls', 'fcp', 'ttfb'] as const

/** Kanały udostępnienia (pole `ku`). */
export const KANALY_UDOSTEPNIENIA = ['link', 'kopia', 'natywne', 'anulowano', 'blad'] as const

/** Identyfikatory kliknięcia reklamy. Wychodzi sama NAZWA parametru, nigdy jego wartość. */
export const CLICK_ID = ['gclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id'] as const

/** Rodzaje kliknięcia w etykiecie `sekcja§rodzaj§cel`. */
export const RODZAJE_KLIKU = [
  'przycisk',
  'link-wewn',
  'link-zewn',
  'zakladka',
  'martwy',
  'furia',
] as const

/**
 * Dozwolone klucze właściwości zdarzenia produktowego, per nazwa. Klucz spoza listy serwer
 * gubi, więc klient wysyła wyłącznie te (moduł `rdzen.ts` filtruje po tej mapie).
 * `wyszukanie_bez_wyniku` przyjmuje `fraza` ALBO `odrzucono` (decyzja serwera, FR-007).
 */
export const WLASCIWOSCI_PRODUKTOWE = {
  wyszukanie: ['wynikow', 'rodzaj'],
  wyszukanie_bez_wyniku: ['fraza', 'odrzucono'],
  karta_adresu: [],
  porownanie_dodaj: [],
  warstwa_mapy: ['warstwa'],
  tryb_biznes: [],
  tryb_miasto: [],
  udostepnij: ['element', 'kanal'],
  pomiar_wylaczony: [],
} as const

/* -------------------------------------------------------------------------- */
/* Limity                                                                      */
/* -------------------------------------------------------------------------- */

/** Zdarzeń w jednej paczce. */
export const MAX_PACZKA = 10
/** Ciało żądania w BAJTACH UTF-8. */
export const LIMIT_CIALA = 16_384
/** Sekcji w jednym `wyjscie`. */
export const MAX_SEKCJI = 24
/** Pozycji CTA w jednym `wyjscie`. */
export const MAX_CTA = 12
/** Kaptur czasu widocznego (30 min). */
export const MAX_CZAS_MS = 1_800_000

export const MAX_SCIEZKA = 512
export const MAX_HOST = 255
export const MAX_SCIEZKA_REFERERA = 200
export const MAX_UTM = 60
export const MAX_ETYKIETA = 120
export const MAX_KLUCZ_SEKCJI = 48
export const MAX_CEL = 40
export const MAX_ELEMENT = 60
export const MAX_FRAZA = 80
export const MAX_KOMUNIKAT = 200
export const MAX_WLASCIWOSCI = 12
/** Kaptur licznika CTA: tysiąc ekspozycji jednego przycisku w odsłonie to już absurd. */
export const MAX_LICZNIK_CTA = 1000
export const MAX_POZYCJA = 100_000
export const MAX_WYNIKOW = 1_000_000
/** Wartość wita w ms; dłuższe niż 10 minut nie jest pomiarem, tylko śmieciem. */
export const MAX_WITAL_MS = 600_000
/** CLS jest ułamkiem; kontrakt: ≤ 10. */
export const MAX_WITAL_CLS = 10

/** Te same limity zebrane w jeden obiekt – test parytetu przyjmuje obie postaci. */
export const LIMITY = {
  MAX_PACZKA,
  LIMIT_CIALA,
  MAX_SEKCJI,
  MAX_CTA,
  MAX_CZAS_MS,
  MAX_SCIEZKA,
  MAX_HOST,
  MAX_SCIEZKA_REFERERA,
  MAX_UTM,
  MAX_ETYKIETA,
  MAX_KLUCZ_SEKCJI,
  MAX_CEL,
  MAX_ELEMENT,
  MAX_FRAZA,
  MAX_KOMUNIKAT,
  MAX_WLASCIWOSCI,
  MAX_LICZNIK_CTA,
  MAX_POZYCJA,
  MAX_WYNIKOW,
  MAX_WITAL_MS,
  MAX_WITAL_CLS,
} as const

/* -------------------------------------------------------------------------- */
/* Wzorce i formaty                                                            */
/* -------------------------------------------------------------------------- */

/** Ekran jak check w bazie: nowy ekran nie wymaga zmiany endpointu. */
export const WZORZEC_EKRANU = /^[a-z_]{1,24}$/
/** Klucz sekcji z atrybutu `data-sekcja`. */
export const WZORZEC_SEKCJI = /^[a-z0-9_-]{1,48}$/
/** Identyfikator warstwy mapy we właściwości `warstwa`. */
export const WZORZEC_WARSTWY = /^[a-z][a-z0-9_]{0,63}$/
/**
 * Separator członów etykiety kliknięcia (`sekcja§rodzaj§cel`) i klucza CTA (`sekcja§cel`).
 * Nie występuje w kluczach sekcji ani w nazwach hostów, więc rozbicie w SQL jest jednoznaczne.
 */
export const SEPARATOR = '§'

/* -------------------------------------------------------------------------- */
/* Typy                                                                        */
/* -------------------------------------------------------------------------- */

export type Typ = (typeof TYPY)[number]
export type Urzadzenie = (typeof URZADZENIA)[number]
export type NazwaProduktowa = (typeof NAZWY_PRODUKTOWE)[number]
export type RodzajWyszukania = (typeof RODZAJE_WYSZUKANIA)[number]
export type MetrykaWital = (typeof METRYKI_WITAL)[number]
export type KanalUdostepnienia = (typeof KANALY_UDOSTEPNIENIA)[number]
export type ClickId = (typeof CLICK_ID)[number]
export type RodzajKliku = (typeof RODZAJE_KLIKU)[number]

/** Właściwości zdarzenia produktowego: płaski słownik, wartości proste. */
export type Wlasciwosci = Readonly<Record<string, string | number | boolean>>

/**
 * Czas w sekcji ekranu: `[klucz, ms widoczności, poz]`. `poz` to KOLEJNOŚĆ sekcji w dokumencie
 * (0 = pierwsza od góry wśród oznaczonych), nie piksele: układ mobilny i desktopowy różnią się
 * wysokościami, a kolejność w DOM jest taka sama, więc mediana pozycji z obu nie miesza skal.
 */
export type SekcjaPomiar = readonly [klucz: string, ms: number, poz: number]
/** Przycisk w sekcji: `[sekcja§cel, ekspozycje, kliki]`. */
export type CtaPomiar = readonly [klucz: string, ekspozycje: number, kliki: number]

/** Pola wspólne każdego zdarzenia. */
interface Wspolne {
  /** Ekran aplikacji (typ `Ekran` z routera). */
  e: Ekran
  /** Ścieżka bez query i bez fragmentu z parametrami, ≤ MAX_SCIEZKA. */
  s: string
  u: Urzadzenie
}

export type Zdarzenie =
  | (Wspolne & {
      t: 'odslona'
      /** Host referera (bez `www.`), ścieżka referera tylko dla hostów publicznych. */
      rh?: string
      rs?: string
      /** `utm_source`, `utm_medium`, `utm_campaign`. */
      us?: string
      um?: string
      uc?: string
      ci?: ClickId
    })
  | (Wspolne & {
      t: 'wyjscie'
      /**
       * Czas widoczności od otwarcia odsłony do pierwszego ukrycia karty albo opuszczenia
       * ekranu (jedno `wyjscie` na odsłonę), ≤ MAX_CZAS_MS. To podłoga: późniejszy powrót na kartę
       * nie jest raportowany.
       */
      ms: number
      /** Najgłębsze przewinięcie dokumentu w %, krok 5. */
      sc: number
      /** Czas w sekcjach od otwarcia odsłony. */
      sk?: SekcjaPomiar[]
      /** Ekspozycje i kliknięcia przycisków od otwarcia odsłony. */
      ct?: CtaPomiar[]
    })
  | (Wspolne & { t: 'klik'; et: string })
  | (Wspolne & { t: 'udostepnienie'; et: string; ku: KanalUdostepnienia })
  | (Wspolne & { t: 'produktowe'; n: NazwaProduktowa; w?: Wlasciwosci })
  | (Wspolne & { t: 'wital'; n: MetrykaWital; v: number })
  | (Wspolne & { t: 'blad'; k: string })

/** Paczka w ciele żądania. */
export interface Paczka {
  z: Zdarzenie[]
}
