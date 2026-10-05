// Typy wierszy odpowiedzi funkcji bazy panelu (`admin_*`), 1:1 z specs/001-panel-analityka/
// contracts/rpc.md i jego „Uzupełnień wykonawczych”. Nazwy pól są identyczne z kolumnami w bazie.
//
// Zasady wspólne dla wszystkich typów:
//  - `bigint` i `numeric` przychodzą jako liczba JSON (`number`), `date` jako „YYYY-MM-DD”,
//    `timestamptz` jako tekst ISO 8601 (`string`), `jsonb` jako obiekt; NULL → `null`.
//  - Liczby są SUROWE (liczności). Procenty i udziały liczy `arytmetyka.ts` (podstawa = suma).
//  - Pole z `| null` bywa puste w bazie (kolumna zdarzeń jest opcjonalna albo nie ma z czego
//    policzyć wartości), więc zakładka pokazuje wtedy „brak danych”, a nie zero.
//  - Odpowiedź z sieci nie jest zaufana bezkrytycznie (`widoki.ts#sprawdzKsztalt` sprawdza tylko
//    kształt ogólny: tablica albo obiekt). Zakładka nie zakłada, że pole istnieje, i nie rzuca w render.
//  - ZASTĘPNIKI TEKSTOWE ZAMIAST NULL. W części kolumn baza sama zamienia brak wartości na napis w
//    nawiasie (`coalesce` w funkcjach `analityka_panel_*`), więc w odpowiedzi stoi tekst, nie NULL:
//
//      funkcja                kolumna                     zastępnik         brak wartości znaczy
//      admin_zrodla           zrodlo                      (bezpośrednie)    wizyta bez źródła z zewnątrz
//      admin_zrodla           sciezka                     (brak)            referer bez zapisanej ścieżki
//      admin_kampanie         utm_source/medium/campaign  (brak)            brakujący człon trójki UTM
//      admin_kraje            kraj                        (nieznany)        host bez nagłówka kraju
//      admin_przejscia        dokad                       (wyjście)         koniec wizyty
//      admin_sciezki          krok2, krok3                (wyjście)         wizyta skończyła się wcześniej
//      admin_punkt_urwania    sekcja                      (brak pomiaru)    brak wyjścia albo sekcji
//      admin_udostepnienia    element                     (bez znacznika)   odsłona bez etykiety elementu
//      admin_udostepnienia    kanal                       (nieznany)        brak sposobu udostępnienia
//      admin_cta_martwe       cel                         (brak)            przycisk bez nazwy celu
//      admin_boty_ai          rodzina                     (nieznana)        robot bez rozpoznanej rodziny
//
//    Zastępnik jest PEŁNOPRAWNĄ pozycją, nie brakiem danych: wiersz z nim wchodzi do sum (wizyty po
//    kanałach, krajach i urządzeniach dają razem liczbę wizyt) i zakładka pokazuje go jak każdą
//    inną wartość. Typy pól zostają takie, jak w kontrakcie (`string | null` tam, gdzie dopuszcza
//    NULL), bo klient obsługuje OBA przypadki: `null`, pusty tekst i sam zastępnik trafiają do tej
//    samej etykiety (`tekstLubZastepczy` w akwizycja-dane.ts i sesje-dane.ts, `etykietaSciezki` i
//    `etykietaSekcji` w zaangazowanie-dane.ts), więc wiersz nigdy nie znika ani nie zostaje pustą
//    komórką. Wyjątki, w których klient polega na gwarancji bazy: `cel` martwego przycisku (CTA) i
//    `rodzina` robota (Przegląd pomija wiersz bez rodziny). Kolumny, w których SQL zostawia NULL
//    (np. `urzadzenie`), klient podpisuje „(brak)”. NULL w polu liczbowym albo w medianie to co
//    innego: brak pomiaru, czyli szary „brak danych”.
//
// Plik zawiera wyłącznie typy (zero kodu w czasie wykonania).

/** Ekran mierzony (`ekran` w zdarzeniach). Ekran `panel` nie jest mierzony. */
export type EkranMierzony =
  | 'szukaj'
  | 'okolica'
  | 'porownanie'
  | 'metoda'
  | 'katalog'
  | 'miasto'
  | 'biznes'

/** Kanał wejścia (`kanal` odsłony), wyliczany na serwerze z referera, UTM i identyfikatora kliknięcia. */
export type KanalRuchu =
  | 'bezposrednie'
  | 'wyszukiwarka'
  | 'social'
  | 'ai'
  | 'kampania'
  | 'odeslanie'
  | 'wewnetrzne'

/** Klasa robota (`bot_klasa`). */
export type KlasaBota = 'ai' | 'wyszukiwarka' | 'podglad' | 'narzedzie' | 'monitoring' | 'inny'

/** Typ zdarzenia (`typ`) – siedem typów w `admin_diagnostyka().zdarzenia_24h`. */
export type TypZdarzenia =
  | 'odslona'
  | 'wyjscie'
  | 'klik'
  | 'udostepnienie'
  | 'produktowe'
  | 'wital'
  | 'blad'

/** Kroki lejka produktowego, w kolejności `kolejnosc`. */
export type KrokLejkaProduktowego =
  | 'wyszukanie'
  | 'karta_adresu'
  | 'porownanie_dodaj'
  | 'warstwa_mapy'
  | 'tryb_biznes'

/** Metryka Web Vitals w `admin_witale` (`nazwa` zdarzenia `wital`). */
export type MetrykaWitaluBazy = 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb'

// ── Przegląd ──────────────────────────────────────────────────────────────────────────────

/**
 * `admin_przeglad()`. `unikalni_*` to `count(distinct odcisk)` ludzi (bez botów) w dobie
 * Europe/Warsaw; `unikalni_7d` to SUMA dobowych liczb unikalnych z 7 ostatnich dób (dziś + 6
 * poprzednich), NIE liczba osób tygodnia, a `unikalni_srednia_7d` = `unikalni_7d / 7` (ułamek).
 * Pozostałe pola to liczby całkowite; 0 oznacza faktycznie zero zdarzeń w oknie.
 */
export interface PrzegladRuchu {
  unikalni_dzis: number
  unikalni_wczoraj: number
  unikalni_7d: number
  unikalni_srednia_7d: number
  odslony_24h: number
  odslony_7d: number
  odslony_30d: number
  /** Godzina z największą liczbą odsłon w oknie 30 dni; `null`, gdy w oknie nie było ruchu. */
  szczyt_godzina: { godzina: string; odslony: number } | null
  /** Doba z największą liczbą odsłon w oknie 30 dni; `null`, gdy w oknie nie było ruchu. */
  szczyt_dzien: { dzien: string; odslony: number } | null
  /** Różne odciski ludzi z ostatnich 5 minut. */
  teraz_5min: number
  ludzie_24h: number
  boty_24h: number
}

/**
 * `admin_seria_dzienna(p_dni)`. Tylko doby, dla których istnieje wiersz (zestawienie albo dziś na
 * żywo): dni bez wiersza uzupełnia klient (`czas.ts#ciagDni`), przed pierwszym dniem danych jako
 * brak danych (`null`), nie zero.
 */
export interface WierszSeriiDziennej {
  /** `YYYY-MM-DD`, doba warszawska. */
  dzien: string
  odslony: number
  unikalni: number
  odslony_boty: number
}

/** `admin_seria_godzinowa(p_godzin ≤ 168)`. Każda godzina jest obecna; godzina bez ruchu ma 0. */
export interface WierszSeriiGodzinowej {
  /** Początek godziny, ISO 8601. */
  godzina: string
  odslony: number
  /** Różne odciski w tej godzinie. Godzin NIE wolno sumować: osoba czytająca trzy godziny jest w trzech. */
  unikalni: number
  odslony_boty: number
}

/** `admin_boty_ai(p_dni)`: wszystkie roboty (`czy_bot`), klasa `ai` najpierw. */
export interface WierszBotaAi {
  /** Robot bez rozpoznanej rodziny ma w bazie `(nieznana)` (zastępnik, patrz nagłówek pliku). */
  rodzina: string
  /** Wartość z `KlasaBota`; pole jest tekstem, bo baza może dołożyć nową klasę. */
  klasa: string
  odslony: number
  ostatnio: string
}

// ── Akwizycja ─────────────────────────────────────────────────────────────────────────────

/** `admin_kanaly(p_dni)`: wizyta = sesja, kanał z jej pierwszej odsłony. */
export interface WierszKanalu {
  /** Wartość z `KanalRuchu` (tekst: lista kanałów może urosnąć szybciej niż front). */
  kanal: string
  wizyty: number
  odslony: number
}

/** `admin_zrodla(p_dni, p_limit ≤ 200)`: host referera albo `utm_source`. */
export interface WierszZrodla {
  /** Wartość z `KanalRuchu`. */
  kanal: string
  /** Baza daje `(bezpośrednie)` zamiast NULL, gdy wizyta nie ma źródła z zewnątrz (zastępnik). */
  zrodlo: string | null
  /** Ścieżka referera, tylko dla hostów publicznych; baza daje `(brak)` zamiast NULL (zastępnik). */
  sciezka: string | null
  wizyty: number
}

/**
 * `admin_kampanie(p_dni)`: znaczniki UTM wizyt (każdy może być pusty). Brakujący człon trójki baza
 * zastępuje napisem `(brak)` zamiast NULL, bo link z samym `utm_source` jest nadal kampanią.
 */
export interface WierszKampanii {
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  wizyty: number
}

/**
 * `admin_kraje(p_dni)`: kraj `(nieznany)` (host bez nagłówka kraju; baza daje ten napis zamiast NULL)
 * jest osobną pozycją, nie brakiem danych.
 */
export interface WierszKraju {
  kraj: string
  wizyty: number
}

/** `admin_urzadzenia(p_dni)`: `mobile`, `tablet`, `desktop`, `inne`. */
export interface WierszUrzadzenia {
  urzadzenie: string
  wizyty: number
}

// ── Sesje ─────────────────────────────────────────────────────────────────────────────────

/**
 * `admin_sesje_przeglad(p_dni)`. Mediany i średnie są `null`, gdy `sesje = 0`. `zaangazowane`
 * (≥ 2 odsłony albo ≥ 30 s widoczności) i `jednostronicowe` to LICZBY sesji: udział liczy klient
 * przez `procentOd(…, sesje)`. Obie grupy nie są dopełnieniem: sesja jednostronicowa może być
 * zaangażowana, jeśli trwała ≥ 30 s.
 */
export interface SesjePrzeglad {
  sesje: number
  odslony: number
  mediana_stron: number | null
  srednia_stron: number | null
  mediana_czas_s: number | null
  p75_czas_s: number | null
  zaangazowane: number
  jednostronicowe: number
}

/** `admin_przejscia(p_dni, p_limit)`: po `ekran`; cel `(wyjście)` oznacza koniec wizyty. */
export interface WierszPrzejscia {
  skad: string
  dokad: string
  ile: number
}

/**
 * `admin_udostepnienia(p_dni)`: element i sposób udostępnienia (`link`, `kopia`, `natywne`,
 * `anulowano`, `blad`). Baza daje `(bez znacznika)` zamiast NULL w `element` i `(nieznany)` w
 * `kanal` (zastępniki, patrz nagłówek pliku).
 */
export interface WierszUdostepnienia {
  element: string | null
  kanal: string | null
  ile: number
}

// ── Zaangażowanie ─────────────────────────────────────────────────────────────────────────

/** `admin_sciezki(p_dni, p_limit)`: pierwsze trzy ekrany sesji, brak kroku = `(wyjście)`. */
export interface WierszSciezki {
  krok1: string
  krok2: string
  krok3: string
  sesje: number
}

/**
 * `admin_sekcje(p_dni, p_ekran)`. Zasięg sekcji = `odslony_z_sekcja / odslony_ekranu` (przez
 * `procentOd`). `mediana_ms` to czas WIDOCZNY sekcji, `pozycja_med` mediana jej pozycji w dokumencie.
 */
export interface WierszSekcji {
  ekran: string
  sekcja: string
  odslony_z_sekcja: number
  odslony_ekranu: number
  mediana_ms: number | null
  pozycja_med: number | null
}

/** `admin_punkt_urwania(p_dni, p_limit)`: ostatni ekran i ostatnia widziana sekcja wizyty (`(brak pomiaru)`). */
export interface WierszPunktuUrwania {
  ekran: string
  sekcja: string
  sesje: number
}

// ── CTA ───────────────────────────────────────────────────────────────────────────────────

/** `admin_cta_sekcje(p_dni, p_ekran)`: klikalność = `klikniecia / wyswietlenia` (nie wobec odsłon strony). */
export interface WierszCtaSekcji {
  ekran: string
  sekcja: string
  wyswietlenia: number
  klikniecia: number
}

/** `admin_cta_martwe(p_dni, p_min)`: `klikniecia = 0` i `wyswietlenia ≥ p_min` (domyślnie 50). */
export interface WierszCtaMartwego {
  ekran: string
  sekcja: string
  /** Przycisk bez nazwy celu ma w bazie `(brak)` (zastępnik); kolumna nigdy nie jest NULL. */
  cel: string
  wyswietlenia: number
}

/** `admin_ux_sygnaly(p_dni)`: `furia` (szybkie wielokrotne kliknięcia) albo `martwy` (kliknięcie w nieklikalne). */
export interface WierszSygnaluUx {
  ekran: string
  /** `furia` albo `martwy` (tekst, jak `kanal`). */
  rodzaj: string
  ile: number
  odslony_ekranu: number
}

// ── Treść ─────────────────────────────────────────────────────────────────────────────────

/** `admin_top_ekrany(p_dni)`. */
export interface WierszTopEkranu {
  ekran: string
  odslony: number
  /** Suma dobowych odcisków, NIE liczba osób. */
  unikalni: number
}

/** `admin_top_adresy(p_dni, p_limit)`: tylko `ekran = 'okolica'`; `sciezka` to np. `/adres/<slug>`, bez hosta. */
export interface WierszTopAdresu {
  sciezka: string
  odslony: number
  unikalni: number
}

/** `admin_bez_wyniku(p_dni, p_limit)`: fraza znormalizowana (małe litery, przycięta), `odrzucono` przy danych osobowych. */
export interface WierszBezWyniku {
  fraza: string
  ile: number
  ostatnio: string
}

/** `admin_lejek(p_dni)`: kroki liczone na sesjach NIEZALEŻNIE (sesja liczy się do kroku, gdy ma jego zdarzenie). */
export interface WierszLejka {
  /** Wartość z `KrokLejkaProduktowego`. */
  krok: string
  kolejnosc: number
  sesje: number
}

// ── Jakość ────────────────────────────────────────────────────────────────────────────────

/** Ostatni bieg zestawienia dziennego albo sprzątania (`analityka_biegi`). */
export interface OstatniBieg {
  rodzaj: 'zestaw' | 'sprzatanie'
  koniec: string | null
  blad: string | null
}

/**
 * `admin_diagnostyka()`. `zdarzenia_24h` zawiera ZAWSZE wszystkie siedem typów; 0 znaczy ciszę
 * danego typu, a to właśnie ma wykryć diagnostyka.
 */
export interface Diagnostyka {
  ostatnie_zdarzenie: string | null
  zdarzenia_24h: Record<TypZdarzenia, number>
  bez_odcisku_24h: number
  ostatni_bieg: OstatniBieg | null
  dni_w_zestawieniu: number
  najstarsze_zdarzenie: string | null
}

/** `admin_witale(p_dni)`: `p75` w ms, dla `cls` jako ułamek; `probki` to liczba pomiarów (nie osób). */
export interface WierszWitalu {
  ekran: string
  /** Wartość z `MetrykaWitaluBazy`; ocenę liczy `ocenaWitalu(metryka, p75)`. */
  metryka: string
  p75: number | null
  probki: number
}

/** `admin_bledy(p_dni, p_limit)`: komunikat skrócony (≤ 200 znaków, długie liczby zamienione na `#`). */
export interface WierszBledu {
  komunikat: string
  ekran: string
  ile: number
  ostatnio: string
}
