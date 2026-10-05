# Kontrakt: funkcje bazy (RPC)

## Reguły wspólne dla KAŻDEJ `admin_*`

- `language plpgsql stable security definer set search_path = '' set statement_timeout = '30s'`.
- Pierwsza instrukcja: `if not public.jest_adminem() then raise exception 'brak dostępu'
  using errcode = '42501'; end if;`
- `revoke all on function … from public, anon;` `grant execute on function … to authenticated;`
- Parametr okna przycinany: `p_dni := least(greatest(coalesce(p_dni, 7), 1), 30)` (surowe
  zdarzenia), `≤ 90` dla funkcji czytających `analityka_dzienna`; `p_limit ≤ 200` (PostgREST
  tnie odpowiedź na 1000 wierszy).
- Ruch botów wykluczony, chyba że nazwa mówi inaczej (`admin_boty_ai`, `ludzie/boty`).
- Liczby zwracane SUROWE (liczności). Procenty i udziały liczy `src/panel/arytmetyka.ts`
  (podstawa = suma) – baza nie zwraca procentów poza p75/medianą.
- Test bramki (`supabase/tests/analityka_bramka.test.sql`): dla każdej funkcji
  `public.admin_%` w `pg_proc` – `prosrc` zawiera `jest_adminem()`, `prosecdef = true`,
  `anon` nie ma `EXECUTE`. (z-dykty miał trzy funkcje bez bramki – ten test to wyklucza.)

## Zapis (tylko `service_role`)

| Funkcja | Zwraca | Opis |
|---|---|---|
| `zdarzenie_zapisz(p_paczka jsonb)` | `integer` | wstawia wiersze z tablicy obiektów o kluczach = kolumny `zdarzenia` (bez `id`, `czas`); limit 1500/h na odcisk; zwraca liczbę zapisanych |
| `analityka_sol_dzis()` | `text` | sól dzisiejszej doby warszawskiej |

## Przegląd

| Funkcja | Zwraca |
|---|---|
| `admin_przeglad()` | `jsonb`: `unikalni_dzis`, `unikalni_wczoraj`, `unikalni_7d`, `unikalni_srednia_7d`, `odslony_24h`, `odslony_7d`, `odslony_30d`, `szczyt_godzina {godzina, odslony}`, `szczyt_dzien {dzien, odslony}` (30 dni), `teraz_5min` (distinct odcisk ludzi), `ludzie_24h`, `boty_24h` (odsłony) |
| `admin_seria_dzienna(p_dni int = 30)` | `(dzien date, odslony bigint, unikalni bigint, odslony_boty bigint)` – historia z `analityka_dzienna`, dziś na żywo |
| `admin_seria_godzinowa(p_godzin int = 48)` | `(godzina timestamptz, odslony, unikalni, odslony_boty)`, `p_godzin ≤ 168`, godziny bez ruchu jako 0 (`generate_series`) |
| `admin_boty_ai(p_dni int = 30)` | `(rodzina text, klasa text, odslony bigint, ostatnio timestamptz)` – wszystkie `czy_bot`, sortowane: klasa `ai` najpierw |

## Akwizycja (wizyta = sesja; źródło z pierwszej odsłony)

| Funkcja | Zwraca |
|---|---|
| `admin_kanaly(p_dni int = 7)` | `(kanal text, wizyty bigint, odslony bigint)` |
| `admin_zrodla(p_dni int = 7, p_limit int = 50)` | `(kanal, zrodlo text /* host albo utm_source */, sciezka text, wizyty bigint)` |
| `admin_kampanie(p_dni int = 30)` | `(utm_source, utm_medium, utm_campaign, wizyty bigint)` |
| `admin_kraje(p_dni int = 7)` | `(kraj text /* '(nieznany)' */, wizyty bigint)` |
| `admin_urzadzenia(p_dni int = 7)` | `(urzadzenie text, wizyty bigint)` |

## Sesje

| Funkcja | Zwraca |
|---|---|
| `admin_sesje_przeglad(p_dni int = 7)` | `jsonb`: `sesje`, `odslony`, `mediana_stron`, `srednia_stron`, `mediana_czas_s`, `p75_czas_s`, `zaangazowane` (liczba), `jednostronicowe` (liczba) |
| `admin_przejscia(p_dni int = 7, p_limit int = 60)` | `(skad text, dokad text /* '(wyjście)' */, ile bigint)` – po `ekran` |
| `admin_udostepnienia(p_dni int = 30)` | `(element text, kanal text, ile bigint)` |

## Zaangażowanie

| Funkcja | Zwraca |
|---|---|
| `admin_sciezki(p_dni int = 7, p_limit int = 30)` | `(krok1 text, krok2 text, krok3 text, sesje bigint)` – pierwsze trzy ekrany sesji, brak = `(wyjście)` |
| `admin_sekcje(p_dni int = 7, p_ekran text = null)` | `(ekran, sekcja, odslony_z_sekcja bigint, odslony_ekranu bigint, mediana_ms int, pozycja_med int)` |
| `admin_punkt_urwania(p_dni int = 7, p_limit int = 30)` | `(ekran text, sekcja text /* '(brak pomiaru)' */, sesje bigint)` |

## CTA

| Funkcja | Zwraca |
|---|---|
| `admin_cta_sekcje(p_dni int = 7, p_ekran text = null)` | `(ekran, sekcja, wyswietlenia bigint, klikniecia bigint)` – z `cta` w `wyjscie` |
| `admin_cta_martwe(p_dni int = 7, p_min int = 50)` | `(ekran, sekcja, cel, wyswietlenia bigint)` – `kliki = 0` i `wyswietlenia ≥ p_min` |
| `admin_ux_sygnaly(p_dni int = 7)` | `(ekran, rodzaj text /* furia|martwy */, ile bigint, odslony_ekranu bigint)` |

## Treść

| Funkcja | Zwraca |
|---|---|
| `admin_top_ekrany(p_dni int = 7)` | `(ekran, odslony bigint, unikalni bigint)` |
| `admin_top_adresy(p_dni int = 7, p_limit int = 50)` | `(sciezka text, odslony bigint, unikalni bigint)` – tylko `ekran = 'okolica'` |
| `admin_bez_wyniku(p_dni int = 30, p_limit int = 100)` | `(fraza text, ile bigint, ostatnio timestamptz)` |
| `admin_lejek(p_dni int = 7)` | `(krok text, kolejnosc int, sesje bigint)` – kroki: `wyszukanie`, `karta_adresu`, `porownanie_dodaj`, `warstwa_mapy`, `tryb_biznes` |

## Jakość

| Funkcja | Zwraca |
|---|---|
| `admin_diagnostyka()` | `jsonb`: `ostatnie_zdarzenie`, `zdarzenia_24h {typ: liczba}`, `bez_odcisku_24h`, `ostatni_bieg {rodzaj, koniec, blad}`, `dni_w_zestawieniu`, `najstarsze_zdarzenie` |
| `admin_witale(p_dni int = 7)` | `(ekran, metryka, p75 numeric, probki bigint)` – `percentile_cont(0.75)` na `wartosc` |
| `admin_bledy(p_dni int = 7, p_limit int = 50)` | `(komunikat, ekran, ile bigint, ostatnio timestamptz)` |

## Zestawienie i sprzątanie (bez grantu dla klientów; woła pg_cron)

| Funkcja | Zwraca | Opis |
|---|---|---|
| `analityka_zestaw_dzien(p_dzien date)` | `jsonb` | `delete` + `insert` wszystkich wymiarów dnia (data-model.md) |
| `analityka_sprzataj()` | `jsonb` | zdarzenia > 90 dni, sól > 2 dni |
| `analityka_cron()` | `void` | zestaw wczoraj i przedwczoraj (poprawka spóźnionych beaconów) + sprzątanie; wpis do `analityka_biegi`, wyjątek łapany i zapisany w `blad` |

Harmonogram: `select cron.schedule('analityka-dzienna', '20 1 * * *', 'select public.analityka_cron()')`
(wymaga rozszerzenia `pg_cron` – `create extension if not exists pg_cron with schema pg_catalog`).
`statement_timeout = '120s'` na funkcjach zestawienia.

## Uzupełnienia wykonawcze (2026-10-05)

Doprecyzowania wspólne dla bazy (fazy 2, 6, 7) i klienta (`src/panel/dane.ts`, zakładki), żeby tory
równoległe nie rozjechały się na kształcie odpowiedzi. Mają pierwszeństwo przy rozbieżności z tabelami wyżej.

- **Typy po drucie (PostgREST → JSON)**: `bigint` i `numeric` → liczba JSON; `date` → `"YYYY-MM-DD"`;
  `timestamptz` → tekst ISO 8601; `jsonb` → obiekt; NULL → `null`. Funkcje zwracające tabelę dają tablicę
  obiektów o kluczach równych nazwom kolumn z tabel wyżej; funkcje `jsonb` – jeden obiekt.
- **Błąd bramki**: `42501` (`brak dostępu`) przy braku uprawnień; ten sam kod daje odmowa EXECUTE dla roli
  `anon`. Klient rozróżnia go po `error.code`.
- **`admin_przeglad()`**: `unikalni_*` liczą `count(distinct odcisk)` ludzi (bez botów, `odcisk is not null`) w dobie
  Europe/Warsaw; `unikalni_7d` to SUMA dobowych liczb unikalnych z 7 ostatnich dób (dziś + 6 poprzednich),
  `unikalni_srednia_7d` = `unikalni_7d / 7` (liczba ułamkowa). `szczyt_godzina` = `{ "godzina": <ISO, początek
  godziny>, "odslony": n }`, `szczyt_dzien` = `{ "dzien": "YYYY-MM-DD", "odslony": n }`; oba `null`, gdy brak ruchu
  w oknie 30 dni. Pozostałe pola to liczby całkowite (0 = faktycznie zero zdarzeń w oknie).
- **`admin_seria_dzienna`**: zwraca tylko dni, dla których istnieje wiersz (zestawienie albo dziś na żywo);
  dni bez wiersza uzupełnia klient (przed pierwszym dniem danych = brak danych, nie zero). `unikalni` ludzi
  w dobie, `odslony` ludzi, `odslony_boty` osobno.
- **`admin_seria_godzinowa`**: każda godzina z `generate_series` jest obecna; godzina bez ruchu ma 0.
- **`admin_diagnostyka()`**: `{ "ostatnie_zdarzenie": ISO|null, "zdarzenia_24h": { "odslona": n, "wyjscie": n,
  "klik": n, "udostepnienie": n, "produktowe": n, "wital": n, "blad": n }` (zawsze wszystkie siedem typów,
  0 = cisza danego typu – to właśnie ma wykryć diagnostyka)`, "bez_odcisku_24h": n, "ostatni_bieg": { "rodzaj":
  "zestaw"|"sprzatanie", "koniec": ISO|null, "blad": tekst|null } | null, "dni_w_zestawieniu": n,
  "najstarsze_zdarzenie": ISO|null }`.
- **`admin_sesje_przeglad`**: `mediana_stron`, `srednia_stron`, `mediana_czas_s`, `p75_czas_s` są `null`, gdy
  `sesje = 0`; `zaangazowane` i `jednostronicowe` to liczby sesji (udział liczy klient przez `procentOd`).
- **`admin_witale`**: `p75` w ms, a dla `cls` jako ułamek; `probki` to liczba pomiarów (nie unikalnych osób).
- **`admin_top_adresy`**: `sciezka` to ścieżka serwisu zapisana przez pomiar (np. `/adres/<slug>`), bez hosta.
- **Ekrany** (`ekran`): wartości typu `Ekran` z `src/wynik/url.ts` (`szukaj`, `okolica`, `porownanie`, `metoda`,
  `katalog`, `miasto`, `biznes`); ekran `panel` NIE jest mierzony (ruch admina nie wchodzi do statystyk).
- **Ścieżka odsłony** (`sciezka`): jeśli `location.pathname` ≠ `/` → pathname (np. `/adres/<slug>`, `/katalog`),
  inaczej część hasha przed `?` (np. `/porownanie`); puste → `/`. Nigdy query ani fragment z parametrami.
