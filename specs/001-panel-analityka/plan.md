# Plan implementacji: Panel admina z analityką

**Branch**: `feat/panel-analityka` | **Data**: 2026-10-05 | **Spec**: [spec.md](spec.md)

**Wejście**: specyfikacja z `specs/001-panel-analityka/spec.md`

## Podsumowanie

Własny, bezciasteczkowy pomiar ruchu i ekran `#/panel` z siedmioma zakładkami analityki,
przeniesiony z z-dykty na stack adresscore (SPA Vite bez routera). Cztery tory niezależne
od siebie po ustaleniu kontraktów: **baza** (trzy migracje: fundament, RPC panelu,
zestawienie z pg_cron), **endpoint** (`api/zdarzenie.js` przenośny Vercel ↔ Node na
Coolify, zapis RPC kluczem service_role), **pomiar w kliencie** (`src/pomiar/`) i **panel**
(`src/panel/`, leniwy chunk z Recharts, logowanie Google PKCE, bramka `jest_adminem()`).
Pliki integracji (`src/App.tsx`, `vite.config.ts`, przegląd `package.json`) w ostatniej fazie.
Decyzje techniczne: [research.md](research.md).

## Kontekst techniczny

**Język/wersja**: TypeScript 7 (front, `tsc --noEmit`), JavaScript ESM (funkcje `api/`, Node 24), SQL (Postgres 15+ w Supabase)
**Główne zależności**: React 19 (+ React Compiler), `@supabase/supabase-js` 2 (już jest), `recharts` (nowa, tylko panel), `pg_cron` (rozszerzenie Supabase)
**Przechowywanie**: Supabase Postgres – `zdarzenia` (90 dni), `analityka_dzienna` (bezterminowo), `analityka_sol` (2 dni), `admini`, `analityka_biegi`
**Testy**: `node --test` (`api/`, `src/pomiar/`, `src/panel/` – czyste funkcje, bez DOM), pgTAP przez `supabase test db` (`supabase/tests/`), `pnpm verify` (Biome + tsc + build)
**Platforma docelowa**: przeglądarki evergreen; endpoint: funkcja Node Vercela i serwer Node na Coolify (Hetzner)
**Typ projektu**: aplikacja web (SPA + funkcje serwerowe + baza)
**Cele wydajności**: główna paczka +≤ 6 KB gzip (SC-002), brak wpływu na INP/LCP > 5% (SC-003), Przegląd < 3 s przy 90 dniach danych (SC-004), każda RPC < 30 s (timeout), typowo < 1 s
**Ograniczenia**: zero identyfikatorów na urządzeniu, IP/UA tylko w pamięci endpointu, Recharts wyłącznie w chunku panelu, pliki integracji tylko w fazie końcowej, schemat wyłącznie przez pliki migracji (`wt.ps1 migracja`), polski tekst z półpauzą
**Skala**: ruch hackathonowy → do ~50 tys. zdarzeń/dobę; 1–3 adminów

## Kontrola konstytucji

`.specify/memory/constitution.md` jest niewypełnionym szablonem – bramki pochodzą
z `CLAUDE.md` projektu i globalnego:

| Bramka | Stan |
|---|---|
| Schemat zdalnej bazy tylko plikiem migracji (`wt.ps1 migracja`), `db:push` tylko z `main` | spełniona – trzy pliki, tworzone narzędziem; push poza zakresem implementacji (właściciel) |
| Każda tabela czytana z frontu ma RLS | spełniona – `zdarzenia`, `analityka_dzienna`, `analityka_biegi`: select tylko admin; `admini`, `analityka_sol`: RLS bez polityk |
| Sekrety tylko w `.env.local` i zmiennych hostingu | spełniona – `SUPABASE_SERVICE_ROLE_KEY` bez prefiksu `VITE_` |
| Tory: pliki integracji zmienia integrator | wyjątek uzasadniony – `package.json` (recharts) w T001, patrz Śledzenie złożoności |
| React Compiler – bez `useMemo`/`useCallback` | spełniona – reguła w zadaniach UI |
| Alias `@/`, Biome, `pnpm verify` | spełniona |
| Brak danych = szara kategoria, nigdy zero | spełniona – FR-040, `procentOd` zwraca `null` |
| 100% to suma, nie maksimum; arytmetyka w `lib` z testem | spełniona – `src/panel/arytmetyka.ts` + test inwariantu |
| Wykres: najechanie podaje wartość | spełniona – `Tooltip` Recharts + `<title>` |

Ponowna kontrola po projekcie (faza 1): bez nowych naruszeń.

## Struktura projektu

### Dokumentacja

```text
specs/001-panel-analityka/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/ (endpoint-zdarzenie.md, rpc.md, pomiar-klient.md)
├── checklists/requirements.md
└── tasks.md
```

### Kod (nowe i zmieniane pliki)

```text
supabase/
├── migrations/<ts>_analityka_fundament.sql   # nowe (wt.ps1 migracja)
├── migrations/<ts>_analityka_panel.sql
├── migrations/<ts>_analityka_zestaw.sql
└── tests/analityka_*.test.sql                # pgTAP

api/
├── zdarzenie.js                # adapter handler(req,res,{env,fetch})
├── _zdarzenie.js               # obsluz(): walidacja, wiersze, wywołanie RPC
├── _zdarzenie-kontrakt.js      # stałe typów, nazw, limitów (źródło prawdy serwera)
├── _odcisk.js                  # sól dnia + sha256
├── _ruch.js                    # rodzinaBota(), kanal(), kraj()
└── _zdarzenie.test.js, _odcisk.test.js, _ruch.test.js, _zdarzenie-kontrakt.test.js

src/pomiar/                     # NOWY katalog – tor tej funkcji
├── kontrakt.ts                 # typy + stałe (parytet z api/_zdarzenie-kontrakt.js)
├── zgoda.ts                    # pomiarWylaczony(), ustawPomiar(), GPC
├── zrodlo.ts                   # przycięcie referera, UTM, click-id (czyste)
├── fraza.ts                    # normalizacja frazy + filtr danych osobowych (czyste)
├── kolejka.ts                  # bufor, paczki ≤10, beacon/fetch, strażnik dubla
├── sekcje.ts                   # IntersectionObserver na [data-sekcja], czas widoczny
├── cta.ts                      # ekspozycje/kliki [data-cel], furia, martwe
├── witale.ts                   # PerformanceObserver: LCP, CLS, FCP, TTFB, INP
├── bledy.ts                    # window.onerror / unhandledrejection → 'blad'
├── pomiar.ts                   # API modułu (startPomiaru, odslona, produktowe…)
├── Pomiar.tsx                  # komponent bez UI: subskrypcja stanu → zdarzenia
└── *.test.ts                   # zrodlo, fraza, kolejka (logika bez DOM), kontrakt

src/panel/                      # NOWY katalog – ładowany leniwie
├── EkranPanel.tsx              # bramka: logowanie → brak dostępu → zakładki
├── Logowanie.tsx               # Google OAuth (PKCE), wylogowanie
├── auth.ts                     # sesja, wymiana ?code, czyszczenie URL
├── dane.ts                     # rejestr widok → RPC + cache Map (TTL 5 min)
├── arytmetyka.ts (+ .test.ts)  # udziały (suma), procentOd, lejek, zmiana, ocenaWitalu, formaty
├── slownik.ts                  # definicje metryk: liczy / okno / pułapka
├── zakladki.ts                 # 7 zakładek + wstępy (FR-037)
├── skladniki/                  # KartaStat, TabelaTop, Podpowiedz, BrakDanych, PasekUdzialow,
│                               # WykresDzienny, WykresGodzinowy, WykresLejka
├── zakladki/                   # Przeglad, Akwizycja, Sesje, Zaangazowanie, Cta, Tresc, Jakosc (.tsx)
└── panel.css

zmieniane (tor karta/strony – małe wpięcia):
├── src/wynik/url.ts            # Ekran + 'panel', parsowanie '#/panel' i '?panel'
├── src/karta/ladowanieEkranow.ts  # ladujPanel()
├── src/karta/Aplikacja.tsx     # lazy EkranPanel + render (bez nagłówka mapy)
├── src/lib/supabase.ts         # flowType: 'pkce'
├── src/karta/wyszukiwarka/Wyszukiwarka.tsx  # produktowe('wyszukanie' | 'wyszukanie_bez_wyniku')
├── src/karta/okolica/*.tsx, src/karta/porownanie/EkranPorownanie.tsx,
│   src/karta/biznes/EkranBiznes.tsx          # atrybuty data-sekcja / data-cel
└── src/strony/Metoda.tsx       # sekcja „Pomiar ruchu" z przełącznikiem

integracja (faza końcowa):
├── package.json, pnpm-lock.yaml   # recharts (dodany w T001 – tu przegląd)
├── src/App.tsx                    # <Pomiar /> obok <Aplikacja />
└── vite.config.ts                 # middleware dev /api/zdarzenie → api/zdarzenie.js
```

**Decyzja o strukturze**: dwa nowe katalogi na wyłączność funkcji (`src/pomiar/`,
`src/panel/`) + pliki w `api/` z prefiksem `_` (wzór `_jev.js`). Zmiany w cudzych torach
ograniczone do jednolinijkowych wpięć i atrybutów – każde w osobnej fazie, żeby integrator
widział je razem.

## Tory i równoległość (podstawa dla tasks.md)

| Tor | Fazy | Pliki | Zależy od |
|---|---|---|---|
| A – baza | fundament → panel RPC ∥ zestaw | `supabase/**` | kontrakty (gotowe) |
| B – endpoint | jedna faza | `api/_zdarzenie*`, `api/_odcisk*`, `api/_ruch*`, `api/zdarzenie.js` | kontrakty |
| C – pomiar | rdzeń → wpięcia w ekrany | `src/pomiar/**` → `src/karta/**` (atrybuty), `src/strony/Metoda.tsx` | kontrakty |
| D – panel | fundament (arytmetyka, dane, auth, ekran) → zakładki | `src/panel/**`, `src/wynik/url.ts`, `src/karta/ladowanieEkranow.ts`, `src/karta/Aplikacja.tsx`, `src/lib/supabase.ts` | T001 (recharts), kontrakty |
| E – integracja | ostatnia | `src/App.tsx`, `vite.config.ts`, przegląd `package.json` | B, C, D |

Uwaga o konflikcie: tor C (wpięcia) i tor D dotykają `src/karta/**`, ale RÓŻNYCH plików
(C: `Wyszukiwarka.tsx`, ekrany `okolica/`, `porownanie/`, `biznes/`; D: `Aplikacja.tsx`,
`ladowanieEkranow.ts`). Migracje toru A tworzy `wt.ps1 migracja`, które trzyma blokadę
migracji na slot – fazy A2 i A3 mogą iść równolegle tylko wtedy, gdy narzędzie pozwala na dwie
migracje naraz; inaczej po kolei (to jedyne miejsce zależne od narzędzia).

## Śledzenie złożoności

| Odstępstwo | Po co | Prostsza alternatywa odrzucona, bo |
|---|---|---|
| `package.json` (recharts) zmieniany na starcie, nie w fazie końcowej | faza UI nie przejdzie `tsc` bez zależności | własne wykresy SVG = czwarty własny prymityw; przesunięcie całego UI za integrację zabija równoległość |
| Kontrakt zdarzeń w dwóch plikach (JS + TS) | `tsconfig` bez `allowJs`, funkcje hostingu bez TS | jeden plik w `src/kontrakty` blokowałby tory B i C do fazy integracji; parytet pilnuje test importujący oba |
| Własne obserwatory Web Vitals zamiast biblioteki | brak nowej zależności w torze C | biblioteka `web-vitals` = kolejna zmiana `package.json` poza fazą integracji |
