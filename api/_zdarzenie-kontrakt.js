// Kontrakt zdarzeń pomiaru ruchu (POST /api/zdarzenie) – źródło prawdy po stronie SERWERA.
// Same stałe, zero logiki i zero importów, więc plik da się zaimportować z testu parytetu
// i z dowolnego miejsca bez skutków ubocznych. Plik z prefiksem `_` nie jest funkcją Vercela.
//
// Klient ma lustro tych list w src/pomiar/kontrakt.ts (`as const`, bo kompilator potrzebuje
// typów, a tsconfig nie obejmuje api/ i nie ma allowJs). Dwa pliki zamiast jednego to
// świadome odstępstwo (research.md R6), a rozjazd pilnuje api/_zdarzenie-kontrakt.test.js:
// nowa nazwa produktowa po jednej stronie byłaby po cichu odrzucana przez drugą.
// Zmieniasz listę – zmieniasz oba pliki i test w jednym commicie.
//
// Kolumny i checki tabeli `zdarzenia`: specs/001-panel-analityka/data-model.md. Walidacja
// w endpoincie jest co najmniej tak ostra jak te checki: jeden wiersz łamiący check
// przewróciłby cały zapis paczki (RPC jest jedną transakcją), a nie tylko siebie.

const lista = (...elementy) => Object.freeze(elementy)

/** Typy zdarzeń (check `zdarzenia.typ`). */
export const TYPY = lista(
  'odslona',
  'wyjscie',
  'klik',
  'udostepnienie',
  'produktowe',
  'wital',
  'blad',
)

/** Klasa urządzenia liczona w kliencie z UA (check `zdarzenia.urzadzenie`). */
export const URZADZENIA = lista('mobile', 'tablet', 'desktop', 'inne')

/** Zamknięta lista zdarzeń produktowych (contracts/pomiar-klient.md, research.md R16). */
export const NAZWY_PRODUKTOWE = lista(
  'wyszukanie',
  'wyszukanie_bez_wyniku',
  'karta_adresu',
  'porownanie_dodaj',
  'warstwa_mapy',
  'tryb_biznes',
  'tryb_miasto',
  'udostepnij',
  'pomiar_wylaczony',
)

/** Rodzaje wyszukania w właściwości `rodzaj` zdarzenia `wyszukanie`. */
export const RODZAJE_WYSZUKANIA = lista('adres', 'ulica', 'okolica')

/** Metryki Web Vitals (typ `wital`, kolumna `nazwa`). */
export const METRYKI_WITAL = lista('lcp', 'inp', 'cls', 'fcp', 'ttfb')

/** Kanały udostępnienia (check `zdarzenia.kanal_udostepnienia`). */
export const KANALY_UDOSTEPNIENIA = lista('link', 'kopia', 'natywne', 'anulowano', 'blad')

/** Identyfikatory kliknięcia reklamy. Zapisujemy NAZWĘ parametru, nigdy jego wartość. */
export const CLICK_ID = lista('gclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id')

/** Rodzaje kliknięcia w etykiecie `sekcja§rodzaj§cel`. */
export const RODZAJE_KLIKU = lista(
  'przycisk',
  'link-wewn',
  'link-zewn',
  'zakladka',
  'martwy',
  'furia',
)

/**
 * Dozwolone klucze właściwości zdarzenia produktowego, per nazwa. Klucz spoza listy jest
 * gubiony (zdarzenie zostaje), bo nowszy klient z dodatkową właściwością nie ma tracić
 * całego zdarzenia. Limit 12 kluczy z kontraktu spełnia się z definicji: żadna nazwa nie ma
 * więcej niż dwóch dozwolonych.
 *
 * Decyzje wykonawcze (kontrakt ich nie rozstrzygał):
 * - `wyszukanie_bez_wyniku` przyjmuje `fraza` i `odrzucono`: zamiast frazy z danymi osobowymi
 *   klient wysyła znacznik (FR-007, spec: „zapisuje się znacznik odrzucono”), więc ten klucz
 *   musi przejść, inaczej licznik braków by się rozjechał. Oba klucze występują razem tylko
 *   w postaci znacznika (`ZNACZNIK_ODRZUCONO` poniżej);
 * - `udostepnij` (krok lejka, odrębny od typu `udostepnienie`) niesie `element` i `kanal`,
 *   żeby lejek odróżniał kanały bez dokładania drugiego zdarzenia.
 */
export const WLASCIWOSCI_PRODUKTOWE = Object.freeze({
  wyszukanie: lista('wynikow', 'rodzaj'),
  wyszukanie_bez_wyniku: lista('fraza', 'odrzucono'),
  karta_adresu: lista(),
  porownanie_dodaj: lista(),
  warstwa_mapy: lista('warstwa'),
  tryb_biznes: lista(),
  tryb_miasto: lista(),
  udostepnij: lista('element', 'kanal'),
  pomiar_wylaczony: lista(),
})

/* -------------------------------------------------------------------------- */
/* Limity                                                                      */
/* -------------------------------------------------------------------------- */

/** Zdarzeń w jednej paczce (więcej = kształt naruszony, 400; nie przycinamy po cichu). */
export const MAX_PACZKA = 10
/** Ciało żądania w BAJTACH UTF-8. Endpoint jest publiczny, więc limit ma zostać ciasny. */
export const LIMIT_CIALA = 16_384
/** Sekcji w jednym `wyjscie`. */
export const MAX_SEKCJI = 24
/** Pozycji CTA w jednym `wyjscie`. */
export const MAX_CTA = 12
/** Kaptur czasu widocznego (30 min) – parytet z progiem sesjonizacji w bazie. */
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
/**
 * Pozycja sekcji w dokumencie. Kontrakt nie mówi, czy to piksele, czy procent wysokości,
 * więc serwer pilnuje tylko skończoności i rozsądnej górnej granicy.
 */
export const MAX_POZYCJA = 100_000
export const MAX_WYNIKOW = 1_000_000
/** Wartość wita w ms; dłuższe niż 10 minut nie jest pomiarem, tylko śmieciem. */
export const MAX_WITAL_MS = 600_000
/** CLS jest ułamkiem; kontrakt: ≤ 10. */
export const MAX_WITAL_CLS = 10

/** Parytet z klientem sprawdza te pięć nazw (test przyjmuje je jako LIMITY albo osobne stałe). */
export const LIMITY = Object.freeze({
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
})

/* -------------------------------------------------------------------------- */
/* Wzorce i formaty                                                            */
/* -------------------------------------------------------------------------- */

/** Ekran jak check w bazie: nowy ekran nie wymaga zmiany endpointu. */
export const WZORZEC_EKRANU = /^[a-z_]{1,24}$/
/** Klucz sekcji z atrybutu `data-sekcja` (contracts/pomiar-klient.md). */
export const WZORZEC_SEKCJI = /^[a-z0-9_-]{1,48}$/
/** Identyfikator warstwy mapy we właściwości `warstwa`. */
export const WZORZEC_WARSTWY = /^[a-z][a-z0-9_]{0,63}$/
/**
 * Znacznik zapisywany w miejsce frazy odrzuconej przez filtr danych osobowych (FR-007). Mieści
 * się w MAX_FRAZA. Klient wysyła go jako `{ fraza: '[odrzucono]', odrzucono: true }`, a serwer
 * zapisuje DOKŁADNIE tę postać także wtedy, gdy sam odrzuci frazę albo przyjdzie samo
 * `{ odrzucono: true }`: lista „wyszukiwania bez wyniku” grupuje po `fraza`, więc odrzucone
 * wyszukania mają trafić do jednej pozycji, a nie zniknąć. Test pilnuje zgodności z klientem
 * (src/pomiar/fraza.ts#ZNACZNIK_ODRZUCONO).
 */
export const ZNACZNIK_ODRZUCONO = '[odrzucono]'
/**
 * Separator członów etykiety kliknięcia (`sekcja§rodzaj§cel`) i klucza CTA (`sekcja§cel`).
 * Nie występuje w kluczach sekcji ani w nazwach hostów, więc rozbicie w SQL jest jednoznaczne.
 */
export const SEPARATOR = '§'

/* -------------------------------------------------------------------------- */
/* Tylko serwer (klient tego nie zna)                                          */
/* -------------------------------------------------------------------------- */

/** Kanały wejścia (check `zdarzenia.kanal`); klasyfikuje je wyłącznie serwer. */
export const KANALY = lista(
  'bezposrednie',
  'wyszukiwarka',
  'social',
  'ai',
  'kampania',
  'odeslanie',
  'wewnetrzne',
)

/** Klasy botów (check `zdarzenia.bot_klasa`). */
export const KLASY_BOTOW = lista('ai', 'wyszukiwarka', 'podglad', 'narzedzie', 'monitoring', 'inny')

/**
 * Klucze wiersza przekazywanego do RPC `zdarzenie_zapisz`: kolumny `zdarzenia` bez `id`
 * i `czas` (czas ustawia trigger, klient go nie wybiera). Każdy wiersz ma WSZYSTKIE klucze,
 * puste jako null – funkcja bazy czyta paczkę przez jsonb_to_record z jawną listą kolumn
 * (klucze spoza listy są tam ignorowane, więc klient nie podrzuci `id` ani `czas`).
 */
export const KOLUMNY_WIERSZA = lista(
  'typ',
  'ekran',
  'sciezka',
  'odcisk',
  'kraj',
  'urzadzenie',
  'czy_bot',
  'bot_rodzina',
  'bot_klasa',
  'kanal',
  'referer_host',
  'referer_sciezka',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'click_id',
  'czas_ms',
  'scroll_pc',
  'sekcje',
  'cta',
  'etykieta',
  'kanal_udostepnienia',
  'nazwa',
  'wlasciwosci',
  'wartosc',
  'komunikat',
)
