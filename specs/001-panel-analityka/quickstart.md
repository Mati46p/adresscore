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
anon nie ma EXECUTE, anon nie czyta `zdarzenia`) i `analityka_sesje` (luka 29 min = 1 sesja,
31 min = 2 sesje, granica doby warszawskiej przy zmianie czasu).

## 2. Testy jednostkowe (bez sieci i bazy)

```bash
node --test api/                   # endpoint, odcisk, boty, kanały, parytet kontraktu
node --test src/pomiar/ src/panel/ # przycinanie źródeł, fraza, arytmetyka (suma udziałów = 100)
pnpm verify                        # Biome + tsc + build
```

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
   Authentication → URL Configuration → Redirect URLs: `https://adresscore.pl/?panel`,
   `http://localhost:5180/?panel`.
2. Zaloguj się raz na `#/panel`, potem w SQL Editor:
   `insert into admini(user_id) select id from auth.users where email = '<e-mail właściciela>';`
3. Odśwież `#/panel` – Przegląd z danymi z kroku 3. Konto spoza listy – „brak dostępu".
4. Sprawdź każdą z 7 zakładek wobec zapytań kontrolnych z `supabase/tests/`.

## 5. Waga paczki

```bash
pnpm build
grep -l "recharts" dist/assets/index-*.js   # oczekiwane: brak trafień (recharts tylko w chunku panelu)
```

Porównaj rozmiar gzip chunku wejściowego przed i po (próg SC-002: +6 KB).

## 6. Wdrożenie (właściciel – nieodwracalne kroki)

- `pnpm db:push` z katalogu integracyjnego i z `main` (trzy migracje + pg_cron).
- Zmienne serwerowe na Vercelu i Coolify; commit `[wdroz]` robi integrator.
- Po dobie: `select * from analityka_biegi order by id desc limit 3` – bieg `zestaw` bez `blad`.
