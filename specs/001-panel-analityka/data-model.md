# Model danych: Panel admina z analityką

Schemat `public`, Postgres w Supabase. Wszystkie doby w `Europe/Warsaw`. Wzorzec: migracje
z-dykty `0039`, `0040`, `0074`, `0076`, `0077`, `20260731162138`, `20260801093000`,
`20260804220656`, `20260809102207`, `20260812152339` – złożone w jeden schemat od razu
w docelowym kształcie (u nas to pierwsze migracje, nie ma historii do zachowania).

Migracje (pliki tworzone WYŁĄCZNIE przez `powershell -File ~/.claude/bin/wt.ps1 migracja <nazwa>`
w worktree):

| Plik (nazwa) | Zawartość |
|---|---|
| `analityka_fundament` | `admini`, `jest_adminem()`, `zdarzenia` + trigger + RLS, `analityka_sol`, `analityka_dzienna`, `analityka_biegi`, `zdarzenie_zapisz`, `analityka_sol_dzis`, helper `analityka_sesje` |
| `analityka_panel` | wszystkie `admin_*` (7 zakładek) – [contracts/rpc.md](contracts/rpc.md) |
| `analityka_zestaw` | `analityka_zestaw_dzien`, `analityka_sprzataj`, `analityka_cron`, harmonogram pg_cron |

## Encje

### `admini`

| Kolumna | Typ | Reguły |
|---|---|---|
| `user_id` | `uuid` PK | `references auth.users(id) on delete cascade` |
| `dodano` | `timestamptz` | `default now()` |

RLS włączony, **zero polityk** – czyta wyłącznie `security definer` i `service_role`.
Dopisanie admina: SQL w panelu Supabase (quickstart), bez ekranu w v1.

### `jest_adminem() returns boolean`

`language sql stable security definer set search_path = ''`;
`select exists(select 1 from public.admini where user_id = auth.uid())`.
`revoke all … from public, anon`; `grant execute … to authenticated, service_role`.

### `zdarzenia` – surowy pomiar (retencja 90 dni)

| Kolumna | Typ | Reguły / skąd |
|---|---|---|
| `id` | `bigint generated always as identity` PK | |
| `czas` | `timestamptz not null default now()` | trigger nadpisuje `now()` – klient nie ustawia czasu |
| `typ` | `text not null` | `check in ('odslona','wyjscie','klik','udostepnienie','produktowe','wital','blad')` |
| `ekran` | `text not null` | `check (ekran ~ '^[a-z_]{1,24}$')`; wartość typu `Ekran` z `src/wynik/url.ts` |
| `sciezka` | `text not null` | 1..512, ścieżka z hasha bez query (np. `/okolica/<id>`) |
| `odcisk` | `text` | `check (odcisk ~ '^[0-9a-f]{16}$')`; `null` gdy sól niedostępna |
| `kraj` | `text` | `check (kraj ~ '^[A-Z]{2}$')`, `null` = nieznany |
| `urzadzenie` | `text not null` | `check in ('mobile','tablet','desktop','inne')` |
| `czy_bot` | `boolean not null default false` | z UA na serwerze |
| `bot_rodzina` | `text` | ≤ 40, np. `gptbot`; `null` gdy człowiek |
| `bot_klasa` | `text` | `check in ('ai','wyszukiwarka','podglad','narzedzie','monitoring','inny')` |
| `kanal` | `text` | tylko `odslona`: `check in ('bezposrednie','wyszukiwarka','social','ai','kampania','odeslanie','wewnetrzne')` |
| `referer_host` | `text` | ≤ 255, bez `www.` |
| `referer_sciezka` | `text` | ≤ 200, tylko hosty publiczne, bez query |
| `utm_source`, `utm_medium`, `utm_campaign` | `text` | ≤ 60 każde, małe litery |
| `click_id` | `text` | `check in ('gclid','fbclid','msclkid','ttclid','li_fat_id')` – nazwa parametru, nigdy wartość |
| `czas_ms` | `integer` | tylko `wyjscie`; trigger przycina do 0..1 800 000 |
| `scroll_pc` | `smallint` | tylko `wyjscie`; 0..100 |
| `sekcje` | `jsonb` | tylko `wyjscie`: `[{"k": sekcja, "ms": int, "p": pozycja}]`, ≤ 24 |
| `cta` | `jsonb` | tylko `wyjscie`: `[{"k": "sekcja§cel", "e": ekspozycje, "n": kliki}]`, ≤ 12 |
| `etykieta` | `text` | ≤ 120; `klik`: `sekcja§rodzaj§cel`, `udostepnienie`: element |
| `kanal_udostepnienia` | `text` | `check in ('link','kopia','natywne','anulowano','blad')` |
| `nazwa` | `text` | `produktowe`: zamknięta lista ([contracts/pomiar-klient.md](contracts/pomiar-klient.md)); `wital`: `lcp|inp|cls|fcp|ttfb` |
| `wlasciwosci` | `jsonb` | tylko obiekt, ≤ 12 kluczy, wartości ≤ 200 znaków |
| `wartosc` | `numeric` | `wital`: ms (CLS – ułamek) |
| `komunikat` | `text` | `blad`: ≤ 200, bez liczb dłuższych niż 6 cyfr (trigger zamienia na `#`) |

Indeksy: `(czas desc)`; `(typ, czas desc)`; `(odcisk, czas) where odcisk is not null and not czy_bot`;
`(nazwa, czas desc) where nazwa is not null`; `(ekran, czas desc) where typ = 'wyjscie'`.

RLS: włączony; polityka `zdarzenia_select_admin` (`for select to authenticated using
(public.jest_adminem())`). **Brak** polityk insert/update/delete. Zapis wyłącznie przez
`zdarzenie_zapisz` (service_role).

Trigger `zdarzenia_przed_insert` (before insert, security definer): `czas = now()`, przycięcia
długości, `czas_ms`/`scroll_pc` do zakresu (przycina, nie odrzuca), `komunikat` bez długich liczb.

### `analityka_sol` – sól dnia (retencja 2 dni)

| `dzien date` PK | `sol text not null` (32 bajty losowe, hex) | `utworzono timestamptz default now()` |

RLS włączony, zero polityk. `analityka_sol_dzis() returns text` (security definer, grant
tylko `service_role`): zwraca sól dzisiejszego dnia warszawskiego, tworząc ją przy pierwszym
wywołaniu (`insert … on conflict do nothing` + `select`).

### `analityka_dzienna` – zestawienie (bez retencji)

| Kolumna | Typ | Reguły |
|---|---|---|
| `dzien` | `date` | |
| `wymiar` | `text` | 1..64 |
| `klucz` | `text` | 1..512 |
| `wartosc` | `bigint not null default 0` | |
| `wartosc2` | `numeric` | tylko gdy wymiar to zapowiada (`witale`: p75) |
| `zaktualizowano` | `timestamptz default now()` | |

PK `(dzien, wymiar, klucz)`; indeks `(wymiar, dzien desc)`. RLS: select dla admina, brak zapisu.

Wymiary: `ruch` (klucze `odslony`, `unikalni`, `odslony_boty`, `sesje`, `sesje_zaangazowane`),
`ekran` (odsłony), `kanal` (wizyty), `kraj`, `urzadzenie`, `bot_ai` (klucz = rodzina),
`produktowe` (klucz = nazwa), `bez_wyniku` (klucz = fraza, top 100), `witale` (klucz
`ekran§metryka`, `wartosc` = próbki, `wartosc2` = p75).

### `analityka_biegi` – ślad zestawień (dla Jakości)

| `id bigint identity` PK | `rodzaj text` (`zestaw`/`sprzatanie`) | `start timestamptz` | `koniec timestamptz` | `wynik jsonb` | `blad text` |

RLS: select admin. Zapis tylko `analityka_cron()`.

### Sesja – encja wyliczana, NIE przechowywana

`analityka_sesje(p_od timestamptz)` (security definer, bez grantu dla klientów): odsłony ludzi
z niepustym `odcisk` od `p_od`; `lag(czas) over (partition by odcisk order by czas)`; luka
> 30 min albo pierwszy wiersz = nowa sesja (`sum(...) over` → numer); klucz sesji
`odcisk || '-' || nr`. Zwraca `(sesja, dzien, czas, ekran, sciezka, poz, kolejny_ekran,
czas_ms, scroll_pc, ostatnia_sekcja, kanal, urzadzenie)`; `wyjscie` dopasowane lateral joinem
(ten sam odcisk i ścieżka, między tą odsłoną a następną albo +30 min). Zdarzenia
`produktowe` przypisywane do sesji tym samym kluczem (odcisk + okno czasu).

Definicje:
- **sesja zaangażowana**: ≥ 2 odsłony albo suma `czas_ms` ≥ 30 000.
- **punkt urwania**: ostatnia odsłona sesji (`kolejny_ekran is null`) + sekcja o najwyższej
  pozycji z `czas > 0` w jej `wyjscie`.
- **lejek**: sesja liczy się do kroku, gdy ma zdarzenie danego kroku (kroki niezależne,
  procent od kroku „wyszukanie").

## Przejścia stanów

- Sól: brak → utworzona przy pierwszym zdarzeniu doby → usunięta po 2 dobach.
- Zdarzenie: zapisane → po 90 dniach usunięte (wcześniej wliczone do `analityka_dzienna`).
- Zestawienie dnia D: brak → zapisane biegiem o 01:20 UTC dnia D+1 → nadpisywalne (bieg
  idempotentny; ręczne `select analityka_zestaw_dzien('D')` poprawia dzień).

## Walidacja (warstwy)

1. Klient przycina i wysyła tylko pola z kontraktu (bez IP/UA – tego nie zna).
2. Endpoint waliduje zamknięte listy i limity, liczy odcisk, kanał, bota, kraj.
3. `zdarzenie_zapisz` sprawdza ponownie listy (check constraints) i limit 1500 zdarzeń/h na
   odcisk (ponad limit – wiersz pominięty, funkcja zwraca liczbę zapisanych).
4. Trigger przycina zakresy i nadpisuje czas.
