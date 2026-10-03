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

## Zasady

- Schemat zdalnej bazy zmienia wyłącznie plik migracji (`wt.ps1 migracja <nazwa>`).
- Klucz `anon` w przeglądarce jest publiczny – każda tabela czytana z frontu ma RLS.
- Sekrety tylko w `.env.local` i w zmiennych Vercela, nigdy w repo.
- Dane z rejestrów: przy każdej warstwie źródło i rozdzielczość (adres / heks / gmina).
  Brak danych = szara kategoria, nigdy zero.
- Polski tekst: półpauza `–` ze spacjami, nigdy pauza.
