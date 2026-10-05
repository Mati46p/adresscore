# Quickstart: walidacja panelu analityki

Przewodnik sprawdzenia funkcji od końca do końca. Kontrakty: [endpoint](contracts/endpoint-zdarzenie.md),
[RPC](contracts/rpc.md), [klient](contracts/pomiar-klient.md); model: [data-model.md](data-model.md).

## Wymagania

- Node 24, pnpm, Docker (lokalny Supabase), konto Google do testu logowania.
- `.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (front),
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADRESSCORE_HOSTY` (endpoint) – wartości
  z `pnpm db:start` (lokalnie) albo z panelu Supabase / zmiennych Vercela i Coolify.

## 1. Baza lokalnie

```bash
pnpm db:start                      # migracje z supabase/migrations wchodzą same
pnpm exec supabase test db         # supabase/tests/*.test.sql (pgTAP)
```

Oczekiwane: wszystkie testy zielone, w tym `analityka_bramka` (każda `admin_*` ma bramkę,
anon nie ma EXECUTE, anon nie czyta `zdarzenia`; test wypisuje liczbę sprawdzonych funkcji),
`analityka_sesje` (luka 29 min = 1 sesja, 31 min = 2 sesje), `analityka_panel` (liczby każdej
funkcji na zestawie z ręcznym przeliczeniem, doba 25-godzinna 2026-10-25), `analityka_zestaw`
(idempotencja, retencja, pg_cron) i `analityka_prywatnosc` (schemat bez kolumn z IP i przeglądarką).

Gdy porty 54321–54327 zajmuje lokalny Supabase innego projektu (`pnpm db:start` kończy się błędem
zajętego portu), uruchom odizolowany stos z kopią `supabase/config.toml` o innym `project_id` i
przesuniętych portach (np. +2000) w katalogu roboczym poza repo: `pnpm exec supabase start --workdir <katalog>`
oraz `pnpm exec supabase test db --workdir <katalog>` (skopiuj tam `supabase/migrations` i `supabase/tests`).
Do testów samego SQL wystarczą usługi `db` i `gotrue` (`-x kong,postgrest,…`); do kroków 3–4 niżej
potrzebne są też `postgrest` i `kong`.

## 2. Testy jednostkowe (bez sieci i bazy)

```bash
node --test "api/**/*.test.js"     # endpoint, odcisk, boty, kanały, parytet kontraktu
node --test "src/pomiar/*.test.ts" "src/panel/**/*.test.ts" "src/wynik/*.test.ts"
                                   # przycinanie źródeł, fraza, arytmetyka (suma udziałów = 100), routing
pnpm verify                        # Biome + tsc + build
```

> Uwaga: na Node 24 forma `node --test katalog/` nie działa (argument jest traktowany jak plik) – używaj globów
> w cudzysłowie, jak wyżej.

## 3. Pomiar od końca do końca (lokalnie)

1. `pnpm dev` (port 5180) – middleware deweloperski w `vite.config.ts` (faza integracji)
   woła `handler` z `api/zdarzenie.js` pod `/api/zdarzenie` ze zmiennymi z `.env.local`.
2. Otwórz `http://localhost:5180/?utm_source=test`, wyszukaj adres, otwórz kartę, dodaj do
   porównania, zmień warstwę, zamknij kartę przeglądarki.
3. W Supabase Studio: `select typ, ekran, kanal, nazwa, odcisk from zdarzenia order by id desc limit 20`.
   Oczekiwane: `odslona` z `kanal = 'kampania'|'social'` wg listy, `produktowe` lejka,
   `wyjscie` z `czas_ms`; brak kolumny z IP/UA; DevTools → Application: brak kluczy poza
   ewentualnym `pomiar-wylaczony`.
4. Strona Metody → przełącznik „Pomiar ruchu" wyłączony → nawigacja → zero nowych wierszy.

## 4. Admin i panel

1. Google OAuth: w Supabase (Authentication → Providers → Google) wpisz Client ID/Secret;
   w Google Cloud Console redirect `https://<projekt>.supabase.co/auth/v1/callback`
   (lokalnie: `[auth.external.google]` w `supabase/config.toml` przez `env(...)`).
   Authentication → URL Configuration → Redirect URLs: `https://adresscore.pl/**` i
   `http://localhost:5180/**` (adres powrotu panelu to `<origin>/?panel#/panel`, a serwer autoryzacji
   dopisuje do niego `code`; wzorzec z `**` obejmuje tę postać).
2. Zaloguj się raz na `#/panel`, potem w SQL Editor:
   `insert into admini(user_id) select id from auth.users where email = '<e-mail właściciela>';`
3. Odśwież `#/panel` – Przegląd z danymi z kroku 3. Konto spoza listy – „brak dostępu".
4. Sprawdź każdą z 7 zakładek wobec zapytań kontrolnych z `supabase/tests/`.

## 5. Waga paczki

```bash
pnpm build
grep -l "recharts" dist/assets/index-*.js   # oczekiwane: brak trafień (recharts tylko w chunku panelu)
```

Porównaj sumę gzip chunku wejściowego i jego statycznych zależności (`dist/index.html`: skrypt modułowy i
`modulepreload`) przed i po (próg SC-002: +6 KB). Samego `index-*.js` nie porównuj: bundler potrafi
przenieść kod (np. `h3-js`) między chunkami wejściowymi i rozmiar jednego pliku mylnie spada albo rośnie.
Wynik pomiaru 2026-10-05: +5,3 KB gzip (budżet 6 KB); `recharts` tylko w chunkach panelu.

## 6. Wdrożenie (właściciel – nieodwracalne kroki)

- `pnpm db:push` z katalogu integracyjnego i z `main` (trzy migracje + pg_cron).
- Zmienne serwerowe na Vercelu i Coolify; commit `[wdroz]` robi integrator.
- Po dobie: `select * from analityka_biegi order by id desc limit 3` – bieg `zestaw` bez `blad`.
