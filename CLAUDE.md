# adresscore – CLAUDE.md

Jeden wynik jakości życia dla każdego adresu w Polsce, z rejestrów publicznych (HackYeah 2026,
Smart City). Koncepcja: `docs/koncepcja.md`, decyzje z burz mózgów: `docs/burza-decyzje.md`.
Domena docelowa: adresscore.pl.

## Stack

- Vite 8 + React 19 (React Compiler przez Babel, więc bez ręcznego `useMemo`/`useCallback`)
  + TypeScript, alias `@/` → `src/`.
- Mapa: MapLibre GL; heatmapa heksów H3 i warstwy 3D: deck.gl (wariant A z koncepcji).
- Biome (lint + format), bez eslinta i prettiera.
- Supabase (baza, auth); migracje w `supabase/migrations`.
- Hosting: Vercel (SPA) + Supabase Cloud. **Tymczasowo** – docelowo serwer Hetzner obok z-dykty
  (Coolify, układ jak `infra/hetzner` w repo z-dykty).

## Komendy

| Co | Komenda |
|---|---|
| Dev | `pnpm dev` (port 5180) |
| Weryfikacja przed commitem | `pnpm verify` (Biome + `tsc --noEmit` + build) |
| Lokalna baza | `pnpm db:start` (wymaga Dockera) |
| Migracja na zdalną bazę | `pnpm db:push` – tylko z katalogu integracyjnego i z `main` |

## Praca równoległa – obowiązkowo przed startem i przed każdą ważną zmianą

Nad repo pracuje naraz kilka osób i do 12 okien Claude'a. Plan i podział: `docs/etapy/README.md`.

1. **Zanim weźmiesz zadanie:** `pnpm zadanie lista` – sprawdź milestone (etap), tor i przypisanie.
   Zadania z `@ktoś` (przypisane) i `ZAJĘTE` (gałąź `zajete/NN`) nie są Twoje. Bierz wyłącznie
   przez `pnpm zadanie wez [tor]` – nigdy „z ręki", inaczej dwa okna zrobią to samo.
2. **Zanim zaczniesz robić coś, czego nie ma w zadaniu:** `gh issue list -R Mati46p/adresscore
   --search "<słowa>" --state all` – może już istnieje albo jest w toku. Duplikat → komentarz w istniejącym,
   nie nowa praca.
3. **Przed każdą ważną zmianą** (nowy plik w cudzym katalogu, zmiana kontraktu, zależność, refaktor)
   i przed commitem: `git fetch origin main && git log --oneline HEAD..origin/main` – sprawdź, co
   weszło na main. Ktoś zrobił to samo albo zmienił kontrakt → dostosuj się, nie nadpisuj.
4. Pracujesz wyłącznie w katalogach swojego toru (tabela w `docs/etapy/README.md`). Pliki toru
   `integracja` zmienia tylko integrator – potrzebę zgłoś w zadaniu z etykietą `zablokowane`.
5. Scalasz przez `pnpm zadanie scal` (rebase na świeży main → `pnpm verify` → push). Commit z `[wdroz]`
   robi tylko integrator.

## Zasady

- Schemat zdalnej bazy zmienia wyłącznie plik migracji (`wt.ps1 migracja <nazwa>`).
- Klucz `anon` w przeglądarce jest publiczny – każda tabela czytana z frontu ma RLS.
- Sekrety tylko w `.env.local` i w zmiennych Vercela, nigdy w repo.
- Dane z rejestrów: przy każdej warstwie źródło i rozdzielczość (adres / heks / gmina).
  Brak danych = szara kategoria, nigdy zero.
- Polski tekst: półpauza `–` ze spacjami, nigdy pauza.
