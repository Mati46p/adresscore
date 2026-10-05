---
description: "Lista zadań: panel admina z analityką"
---

# Zadania: Panel admina z analityką

**Wejście**: `specs/001-panel-analityka/` – [spec.md](spec.md), [plan.md](plan.md),
[research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/),
[quickstart.md](quickstart.md). Wzorzec do podglądu (tylko odczyt): `C:\Users\PC\Z_dykty`.

**Testy**: tak – właściciel wymaga testów endpointu (`api/_zdarzenie.test.js`) i arytmetyki
prezentacji; bramka bazy i sesje mają testy pgTAP. Uruchamianie: `node --test <katalog>`,
`pnpm exec supabase test db`, `pnpm verify`.

**Reguły dla każdego wykonawcy**:
- Biome, alias `@/`, React Compiler – **żadnych** `useMemo`/`useCallback`.
- Polski tekst (UI, komentarze, commity): półpauza `–` ze spacjami, nigdy pauza.
- Pliki migracji tworzy WYŁĄCZNIE `powershell -File ~/.claude/bin/wt.ps1 migracja <nazwa>`
  uruchomione w worktree fazy – nigdy ręcznie, nigdy MCP `apply_migration`/`execute_sql` z DDL,
  nigdy `db push` z worktree.
- Pliki toru integracji (`package.json`, `pnpm-lock.yaml`, `src/App.tsx`, `vercel.json`,
  `src/kontrakty/**`, a w tej funkcji także `vite.config.ts`) zmienia wyłącznie Faza 13
  (wyjątek: T001).
- Commit: po polsku, `Refs #<nr issue funkcji>`; przed commitem `pnpm verify` + testy fazy.

## Format: `[ID] [P?] [Story] Opis`

- **[P]**: może iść równolegle (inne pliki, brak zależności od niedokończonych zadań).
- **[USn]**: historia ze spec.md (US1 pomiar, US2 wejście do panelu, US3 Przegląd,
  US4 Akwizycja i Sesje, US5 Zaangażowanie/CTA/Treść, US6 Jakość).
- Fazy oznaczone w nagłówku **[P]** mogą iść równolegle z innymi fazami [P] tego samego
  poziomu (sekcja „Zależności").

---

## Faza 1: Przygotowanie

**Cel**: zależność wykresów, bez której faza panelu nie przejdzie `tsc`.

- [X] T001 Dodaj `recharts` (najnowsza stabilna) do `dependencies` w `package.json` przez `pnpm add recharts` (aktualizuje `pnpm-lock.yaml`); w treści commita napisz „wyjątek od toru integracji – zależność potrzebna fazie 5, przegląd w fazie 13” (research.md R12)

**Punkt kontrolny**: `pnpm verify` zielone; recharts nie jest jeszcze nigdzie importowany.

---

## Faza 2: Baza – fundament [P]

**Cel**: tabele, bramka admina, zapis zdarzeń i helper sesji (US1, US2). Blokuje fazy 6 i 7.
**Test niezależny**: `pnpm db:start` + `pnpm exec supabase test db` – bramka i zapis zielone.

- [X] T002 [US1] Utwórz plik migracji: `powershell -File ~/.claude/bin/wt.ps1 migracja analityka_fundament` w worktree fazy → `supabase/migrations/<ts>_analityka_fundament.sql`
- [X] T003 [US2] W `supabase/migrations/<ts>_analityka_fundament.sql`: tabela `admini` (RLS bez polityk) i `jest_adminem()` (`sql stable security definer set search_path = ''`, revoke `public, anon`, grant `authenticated, service_role`) – data-model.md „admini”; wzór z-dykty `supabase/migrations/0039_admini.sql`
- [X] T004 [US1] W tym samym pliku: tabela `zdarzenia` ze wszystkimi kolumnami, checkami i indeksami z data-model.md, trigger `zdarzenia_przed_insert` (czas = now(), przycięcia, `komunikat` bez liczb > 6 cyfr), RLS: tylko `zdarzenia_select_admin`; wzór z-dykty `0040_zdarzenia.sql`, `0074_*`, `0077_*`, `20260731162138_analityka_sesje.sql`, `20260812152339_cta_auto_i_sygnaly_ux.sql`
- [X] T005 [US1] W tym samym pliku: `analityka_sol` + `analityka_sol_dzis()` (grant tylko `service_role`), `analityka_dzienna` (PK, indeks, select admin), `analityka_biegi` (select admin)
- [X] T006 [US1] W tym samym pliku: `zdarzenie_zapisz(p_paczka jsonb) returns integer` – `jsonb_to_recordset`/`jsonb_populate_recordset` na kolumny `zdarzenia`, limit 1500 zdarzeń/h na `odcisk` (wiersze ponad limit pominięte), zwraca liczbę zapisanych; `security definer`, revoke wszystkim, grant `service_role` (contracts/rpc.md „Zapis”)
- [X] T007 [US1] W tym samym pliku: helper `analityka_sesje(p_od timestamptz)` – sklejanie luką 30 min po `odcisk`, lateral join `wyjscie`, `kolejny_ekran`, `ostatnia_sekcja` (data-model.md „Sesja”); revoke `public, anon, authenticated`; wzór z-dykty `analityka_sesje_zdarzenia` w `20260731162138_analityka_sesje.sql`
- [X] T008 [P] [US2] Test pgTAP `supabase/tests/analityka_bramka.test.sql`: anon i konto spoza `admini` nie czytają `zdarzenia` ani `analityka_dzienna`; anon/authenticated nie wstawiają do `zdarzenia`; `zdarzenie_zapisz` i `analityka_sol_dzis` niewykonywalne dla anon/authenticated; pętla po `pg_proc` dla `public.admin_%` – `prosecdef`, `prosrc ilike '%jest_adminem()%'`, brak EXECUTE dla `anon` (test ma przejść także przy zerze funkcji `admin_*` i wypisać ich liczbę)
- [X] T009 [P] [US1] Test pgTAP `supabase/tests/analityka_sesje.test.sql`: luka 29 min = 1 sesja, 31 min = 2 sesje; boty i `odcisk is null` pominięte; `wyjscie` dopasowane do właściwej odsłony; limit 1500/h w `zdarzenie_zapisz`; trigger przycina `czas_ms` > 1 800 000
- [X] T010 [US1] Uruchom `pnpm db:start` i `pnpm exec supabase test db`; napraw do zielonego (bez Dockera – zapisz w raporcie fazy jako blokadę, nie pomijaj testów)

**Punkt kontrolny**: migracja wchodzi na czystą bazę lokalną, testy T008–T009 zielone.

---

## Faza 3: Endpoint zapisu zdarzeń [P]

**Cel**: `POST /api/zdarzenie` przenośny Vercel ↔ Node na Coolify (US1).
**Test niezależny**: `node --test api/` – bez sieci, bez bazy.

- [X] T011 [P] [US1] `api/_zdarzenie-kontrakt.js`: stałe `TYPY`, `URZADZENIA`, `NAZWY_PRODUKTOWE`, `WLASCIWOSCI_PRODUKTOWE` (dozwolone klucze per nazwa), `METRYKI_WITAL`, `KANALY_UDOSTEPNIENIA`, `CLICK_ID`, `RODZAJE_KLIKU`, limity (`MAX_PACZKA = 10`, `LIMIT_CIALA = 16384`, `MAX_SEKCJI = 24`, `MAX_CTA = 12`, `MAX_CZAS_MS`, długości pól) – contracts/endpoint-zdarzenie.md, contracts/pomiar-klient.md
- [X] T012 [P] [US1] `api/_odcisk.js`: `dzienWarszawy()`, `solDnia({ env, fetch })` (RPC `analityka_sol_dzis`, cache obietnicy na dzień, błąd → `null`), `policzOdcisk(sol, ip, ua, host)` → 16 znaków hex; nagłówek komentarza o gwarancji „IP/UA tylko w pamięci”; wzór z-dykty `apps/web/src/lib/analityka/odcisk.ts` + test `api/_odcisk.test.js` (determinizm, zmiana soli zmienia odcisk, format, fetch wstrzykiwany)
- [X] T013 [P] [US1] `api/_ruch.js`: `rodzinaBota(ua)` → `{ czyBot, rodzina, klasa }` (lista rodzin z research.md R4, crawlery AI: GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, Claude-SearchBot, PerplexityBot, Perplexity-User, Google-Extended, Applebot; pusty UA = `narzedzie`), `kanal({ rh, us, um, ci, wlasnyHost })` (research.md R5; wzór z-dykty `apps/web/src/lib/zrodla-ruchu.ts`), `kraj(naglowki)` (R3) + test `api/_ruch.test.js` (po jednym przypadku na klasę bota i kanał, `XX`/`T1` → null)
- [X] T014 [US1] `api/_zdarzenie.js`: `obsluz({ metoda, cialo, naglowki, ip, env, fetch })` – kolejność: metoda → origin (`ADRESSCORE_HOSTY`, localhost poza produkcją) → rozmiar → parsowanie tekstu → walidacja każdego zdarzenia wg kontraktu (niepoprawne pomijane) → odcisk/bot/kraj/kanał → wiersze w kształcie kolumn `zdarzenia` → `fetch` RPC `zdarzenie_zapisz` (timeout 2 s) → status wg tabeli w contracts/endpoint-zdarzenie.md; nigdy nie rzuca; zero `console.*` z IP/UA (zależy od T011–T013)
- [X] T015 [US1] `api/zdarzenie.js`: adapter `export default async function handler(req, res, { env = process.env, fetch } = {})` – czytanie ciała (`req.body` string/obiekt albo strumień z limitem), `ip` jak w `api/jev.js`, `Cache-Control: no-store`, bez ciała odpowiedzi; komentarz nagłówkowy o przenośności (Vercel + `node:http` na Coolify)
- [X] T016 [US1] `api/_zdarzenie.test.js`: 405/403/413/400/204; paczka z mieszanymi poprawnymi i złymi zdarzeniami zapisuje tylko poprawne; awaria fetch → 204; brak `SUPABASE_*` → 204 bez wywołania; IP i UA z żądania NIE występują w `JSON.stringify` argumentów fetch ani w odpowiedzi; `handler` działa na atrapie z `req.body` i na atrapie-strumieniu
- [X] T017 [US1] `api/_zdarzenie-kontrakt.test.js`: importuje `api/_zdarzenie-kontrakt.js` i `../src/pomiar/kontrakt.ts` (Node 24 zdejmuje typy) i porównuje zbiory typów, nazw produktowych, metryk, kanałów udostępnienia, click-id, limitów – **zadanie wykonuje faza, która skończy się później z faz 3 i 4** (oba pliki muszą istnieć); do tego czasu test pomija się `skip` z komunikatem, jeśli `src/pomiar/kontrakt.ts` nie istnieje

**Punkt kontrolny**: `node --test api/` zielone, `pnpm verify` zielone.

---

## Faza 4: Pomiar w kliencie – rdzeń [P]

**Cel**: moduł `src/pomiar/` gotowy do zamontowania (US1). Nie dotyka ekranów ani `App.tsx`.
**Test niezależny**: `node --test src/pomiar/` (czyste funkcje bez DOM).

- [X] T018 [P] [US1] `src/pomiar/kontrakt.ts`: typy `Typ`, `NazwaProduktowa`, `KanalUdostepnienia`, `ClickId`, `Zdarzenie` (unia wg contracts/endpoint-zdarzenie.md) i stałe `as const` o wartościach identycznych z `api/_zdarzenie-kontrakt.js` (komentarz: parytet pilnuje `api/_zdarzenie-kontrakt.test.js`)
- [X] T019 [P] [US1] `src/pomiar/zgoda.ts`: `pomiarWylaczony()` (klucz `pomiar-wylaczony` albo `navigator.globalPrivacyControl`), `ustawPomiar(wlaczony)`; każdy dostęp do `localStorage` w try/catch (research.md R15)
- [X] T020 [P] [US1] `src/pomiar/zrodlo.ts` + `src/pomiar/zrodlo.test.ts`: `zrodloWejscia(href, referrer, wlasnyHost)` → `{ rh, rs, us, um, uc, ci }`; host bez `www.`, ścieżka tylko dla hostów publicznych, bez query i fragmentu, UTM ≤ 60 małymi literami, z click-id tylko nazwa; test: żadna wartość click-id ani inny parametr nie przechodzi
- [X] T021 [P] [US1] `src/pomiar/fraza.ts` + `src/pomiar/fraza.test.ts`: `normalizujFraze(tekst)` → `{ fraza } | { odrzucono: true }` (małe litery, zbite spacje, ≤ 80; odrzuca e-mail, `@`, 9+ cyfr z rzędu)
- [X] T022 [US1] `src/pomiar/kolejka.ts` + `src/pomiar/kolejka.test.ts`: bufor ≤ 10, wysyłka po 5 s bezczynności / przy zapełnieniu / przy `zamknij()`; transport wstrzykiwany (`sendBeacon` z `Blob` `text/plain`, fallback `fetch` `keepalive`); strażnik dubla przy `pagehide` + `visibilitychange`; przy `pomiarWylaczony()` czyści bufor; test na atrapie transportu i zegara (bez DOM)
- [X] T023 [P] [US1] `src/pomiar/sekcje.ts`: `IntersectionObserver` na `[data-sekcja]`, czas widoczny per sekcja tylko przy widocznej karcie, pozycja w dokumencie; `zbierzSekcje()` → `[klucz, ms, poz][]` ≤ 24; ponowne skanowanie po zmianie ekranu (`MutationObserver` z debounce); wzór z-dykty `apps/web/src/lib/analityka-sekcje.ts`
- [X] T024 [P] [US1] `src/pomiar/cta.ts`: ekspozycje (`IntersectionObserver` ≥ 50% przez ≥ 500 ms) i kliki `[data-cel]`, `button`, `a`, `[role=button]` w sekcjach; klucz `sekcja§cel`; furia (≥ 3 kliki, 30 px, 800 ms) i martwy klik → zdarzenie `klik` z rodzajem; `zbierzCta()` ≤ 12; czysta funkcja `czyFuria` z testem w `src/pomiar/cta.test.ts`; wzór z-dykty `apps/web/src/lib/analityka-cta.ts`
- [X] T025 [P] [US1] `src/pomiar/witale.ts`: `PerformanceObserver` (`largest-contentful-paint`, `layout-shift` z oknami sesji CLS, `paint` FCP, `navigation` TTFB, `event` z `interactionId` INP = najdłuższa), `buffered: true`, raport raz na metrykę przy ukryciu strony (research.md R11)
- [X] T026 [P] [US1] `src/pomiar/bledy.ts`: `error` i `unhandledrejection` → zdarzenie `blad` z komunikatem ≤ 200 znaków (bez stosu, bez URL-i z query), najwyżej 5 na odsłonę
- [X] T027 [US1] `src/pomiar/pomiar.ts`: `startPomiaru()` (zwraca sprzątanie), `odslona(ekran, sciezka)` (najpierw `wyjscie` poprzedniej z `czas_ms` widocznym, `scroll_pc`, sekcjami i CTA), `produktowe(n, w)`, `udostepnienie(element, kanal)`; `klasaUrzadzenia()` z UA; nic nie robi przy `pomiarWylaczony()` (zależy od T018–T026)
- [X] T028 [US1] `src/pomiar/Pomiar.tsx`: komponent bez UI (`return null`) – w `useEffect` `startPomiaru()` i `subskrybuj` z `@/wynik/stan` → tabela przejść z contracts/pomiar-klient.md (odsłona, `karta_adresu`, `porownanie_dodaj`, `warstwa_mapy`, `tryb_biznes`, `tryb_miasto`); ścieżka z `location.hash` bez query
- [X] T029 [US1] Jeśli faza 3 jest już zmergowana: zdejmij `skip` z `api/_zdarzenie-kontrakt.test.js` (T017) i doprowadź parytet do zielonego; inaczej zostaw to fazie 3

**Punkt kontrolny**: `node --test src/pomiar/` i `pnpm verify` zielone; moduł nigdzie jeszcze nie zamontowany.

---

## Faza 5: Panel – ekran, logowanie, fundament UI [P]

**Cel**: `#/panel` ładowany leniwie, logowanie Google, bramka „brak dostępu”, rejestr RPC,
arytmetyka i wspólne składniki; siedem zakładek jako zaślepki (US2). Zależy od T001.
**Test niezależny**: `#/panel` bez sesji pokazuje logowanie; `node --test src/panel/` zielone;
w `dist/assets/index-*.js` nie ma `recharts`.

- [X] T030 [P] [US2] `src/panel/arytmetyka.ts` + `src/panel/arytmetyka.test.ts`: `udzialy(wiersze, klucz)` (podstawa = SUMA, metoda największej reszty – segmenty dają dokładnie 100,0; suma 0 → wszystkie `null`), `procentOd(czesc, calosc)` (`null` przy całości ≤ 0), `lejek(kroki)` (procent od pierwszego i od poprzedniego kroku), `zmianaProcentowa(teraz, wtedy)` (`null` gdy `wtedy ≤ 0`), `ocenaWitalu(metryka, p75)` (progi research.md R11), `formatLiczby`, `formatCzasu(ms)`, `formatProcent`; test inwariantu: dla losowych zestawów suma udziałów = 100 ± 0,1, żaden udział nie liczony od maksimum (CLAUDE.md „Liczby na ekranie”)
- [X] T031 [P] [US2] `src/lib/supabase.ts`: `createClient(url, klucz, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } })`; komentarz „dlaczego PKCE” (router na hashu, research.md R9)
- [X] T032 [P] [US2] `src/panel/auth.ts`: `zaloguj()` (`signInWithOAuth` Google, `redirectTo: ${location.origin}/?panel#/panel`), `wyloguj()`, `useSesja()` (`useSyncExternalStore` na `onAuthStateChange`), `wyczyscAdresPoLogowaniu()` (`history.replaceState` na `/#/panel` gdy w query jest `code` lub `panel`)
- [X] T033 [P] [US2] `src/panel/dane.ts`: zamknięty rejestr `WIDOKI` (nazwa widoku → nazwa RPC z contracts/rpc.md + domyślne parametry; wszystkie RPC wszystkich zakładek), `pobierz(widok, parametry)` przez `supabase.rpc`, cache `Map` z TTL 5 min, `odswiezWszystko()`, rozróżnienie błędu `42501` („brak dostępu”) od innych; hook `useWidok(widok, parametry)` → `{ dane, blad, ladowanie, pobrano }`
- [X] T034 [P] [US2] `src/panel/slownik.ts`: hasło na każdą liczbę ze spec (FR-030–FR-036): `liczy`, `okno`, `pulapka`; wzór z-dykty `apps/web/src/lib/slownik-panelu.ts` (pułapki: „unikalni z 7 dni” to suma dobowych odcisków, nie osoby; czasy sesji są podłogą)
- [X] T035 [P] [US2] `src/panel/zakladki.ts`: 7 zakładek (id, etykieta, tytuł) i `WSTEPY` – po jednym zdaniu „na jakie pytanie odpowiada i czego tu nie ma” (FR-037); wzór z-dykty `packages/core/src/panel/analityka/zakladki.ts` bez Gmin/Czytelników/Redakcji/Reklam
- [X] T036 [P] [US2] Składniki w `src/panel/skladniki/`: `KartaStat.tsx` (liczba + podpis + `Podpowiedz`, stan „brak danych” szary), `TabelaTop.tsx` (pełne liczby, kolumna udziału z `udzialy`), `Podpowiedz.tsx` (hasło ze `slownik.ts`, dostępne z klawiatury), `BrakDanych.tsx`, `PasekUdzialow.tsx` (segmenty z `udzialy`, kolor na wypełnieniu, etykieta tekstowa obok – nie kolor palety na tekście), `WykresDzienny.tsx`, `WykresGodzinowy.tsx`, `WykresLejka.tsx` (Recharts, `Tooltip` z wartością i datą, `<title>` dla dotyku/czytników); hover pod `@media (hover: hover)`
- [X] T037 [US2] `src/panel/EkranPanel.tsx` + `src/panel/Logowanie.tsx` + `src/panel/panel.css`: stan bez sesji → przycisk „Zaloguj przez Google”; sesja bez uprawnień (błąd `42501` z `admin_przeglad`) → „Brak dostępu” + wyloguj; admin → pasek zakładek (z `zakladki.ts`, stan aktywny jako jedyny akcent), wstęp zakładki, przycisk „Odśwież” (`odswiezWszystko`), znacznik najstarszego `pobrano`; zakładki ładowane `lazy` po jednej (zależy od T030–T036)
- [X] T038 [P] [US2] Zaślepki zakładek `src/panel/zakladki/Przeglad.tsx`, `Akwizycja.tsx`, `Sesje.tsx`, `Zaangazowanie.tsx`, `Cta.tsx`, `Tresc.tsx`, `Jakosc.tsx` – każda eksportuje komponent nazwany jak plik, renderujący `BrakDanych` („w budowie”); późniejsze fazy podmieniają WYŁĄCZNIE treść swojego pliku
- [X] T039 [US2] `src/wynik/url.ts`: `Ekran` + `'panel'`; `#/panel` ↔ `ekran: 'panel'`; obecność `panel` w `location.search` → `'panel'` niezależnie od hasha (bezpiecznik R9); testy w istniejącym stylu (`src/wynik/urlPanel.test.ts`)
- [X] T040 [US2] `src/karta/ladowanieEkranow.ts`: `ladujPanel = () => import('@/panel/EkranPanel')`, wpis w `przygotujEkran`; `src/karta/Aplikacja.tsx`: `lazy` `EkranPanel`, render przy `ekran === 'panel'` bez mapy i nagłówka aplikacji (sprawdź, czy `src/wynik/stan.ts` nie wymaga gałęzi dla `panel` – jeśli tak, dopisz minimalnie)
- [ ] T041 [US2] Weryfikacja: `pnpm verify`; `grep -l recharts dist/assets/index-*.js` → brak; ręcznie `pnpm dev` → `#/panel` pokazuje logowanie; zapisz w komentarzu issue fazy wynik sprawdzenia kształtu adresu powrotu OAuth (R9), jeśli lokalny Supabase ma skonfigurowanego Google

**Punkt kontrolny**: panel otwiera się, loguje i odmawia; zakładki to zaślepki.

---

## Faza 6: Baza – RPC panelu

**Cel**: wszystkie `admin_*` z contracts/rpc.md (US3–US6). Zależy od fazy 2.
**Test niezależny**: `supabase test db` – liczby zgodne z ręcznym przeliczeniem na zestawie testowym.

- [ ] T042 [US3] Utwórz plik migracji: `powershell -File ~/.claude/bin/wt.ps1 migracja analityka_panel` → `supabase/migrations/<ts>_analityka_panel.sql`; nagłówek z regułami wspólnymi z contracts/rpc.md
- [ ] T043 [US3] Przegląd: `admin_przeglad`, `admin_seria_dzienna` (historia z `analityka_dzienna`, dziś na żywo), `admin_seria_godzinowa` (`generate_series` – godziny bez ruchu jako 0), `admin_boty_ai`; wzór z-dykty `0080`, `0085`, `0089`, `20260809121425_boty_ai_pomiar.sql`
- [ ] T044 [US4] Akwizycja i Sesje: `admin_kanaly`, `admin_zrodla`, `admin_kampanie`, `admin_kraje`, `admin_urzadzenia` (wizyta = sesja z `analityka_sesje`, źródło z pierwszej odsłony), `admin_sesje_przeglad`, `admin_przejscia`, `admin_udostepnienia`; wzór z-dykty `20260809102207_zrodla_ruchu.sql`, `20260731162138_analityka_sesje.sql`
- [ ] T045 [US5] Zaangażowanie, CTA, Treść: `admin_sciezki`, `admin_sekcje`, `admin_punkt_urwania`, `admin_cta_sekcje`, `admin_cta_martwe`, `admin_ux_sygnaly`, `admin_top_ekrany`, `admin_top_adresy`, `admin_bez_wyniku`, `admin_lejek`; wzór z-dykty `20260801093000_analityka_sekcje.sql`, `20260805184650_*`, `20260812152339_cta_auto_i_sygnaly_ux.sql`
- [ ] T046 [US6] Jakość: `admin_diagnostyka`, `admin_witale` (`percentile_cont(0.75)`), `admin_bledy`; wzór z-dykty `20260804220656_zdarzenia_produktowe_i_wital.sql`
- [ ] T047 [P] [US3] Test pgTAP `supabase/tests/analityka_panel.test.sql`: zestaw zdarzeń z trzech dni (w tym granica doby warszawskiej i dzień zmiany czasu 2026-10-25) → oczekiwane wyniki każdej funkcji Przeglądu, Akwizycji (UTM → kampania/social, brak referera → bezposrednie), Sesji, lejka (10 → 6 → 2), martwych CTA (≥ 50 wyświetleń, 0 kliknięć), p75 witali
- [ ] T048 [US3] `pnpm exec supabase test db` – w tym `analityka_bramka` (T008) liczy teraz wszystkie nowe `admin_*`; napraw do zielonego

**Punkt kontrolny**: wszystkie RPC kontraktu istnieją, mają bramkę i dają liczby z testu.

---

## Faza 7: Baza – zestawienie dzienne i pg_cron [P]

**Cel**: FR-050–FR-052. Zależy od fazy 2; równolegle z fazą 6, jeśli `wt.ps1` pozwala na
dwie migracje naraz (inaczej po fazie 6).
**Test niezależny**: `select analityka_zestaw_dzien(current_date - 1)` dwa razy daje te same wiersze.

- [ ] T049 [P] Utwórz plik migracji: `powershell -File ~/.claude/bin/wt.ps1 migracja analityka_zestaw` → `supabase/migrations/<ts>_analityka_zestaw.sql`
- [ ] T050 `analityka_zestaw_dzien(p_dzien date)` – idempotentne `delete` + `insert` wymiarów z data-model.md (`ruch`, `ekran`, `kanal`, `kraj`, `urzadzenie`, `bot_ai`, `produktowe`, `bez_wyniku`, `witale`), `statement_timeout = '120s'`, bez grantu dla klientów; wzór z-dykty `analityka_rollup_wlasne` (`0074`, `0089`)
- [ ] T051 `analityka_sprzataj()` (zdarzenia > 90 dni, sól > 2 dni) i `analityka_cron()` (zestaw wczoraj i przedwczoraj + sprzątanie, wpis do `analityka_biegi`, wyjątek zapisany w `blad`)
- [ ] T052 `create extension if not exists pg_cron with schema pg_catalog` + `cron.schedule('analityka-dzienna', '20 1 * * *', 'select public.analityka_cron()')` (idempotentnie: `cron.unschedule` gdy istnieje)
- [ ] T053 [P] Test pgTAP `supabase/tests/analityka_zestaw.test.sql`: idempotencja, retencja (zdarzenie sprzed 91 dni znika, zestawienie zostaje), wpis w `analityka_biegi`; `pnpm exec supabase test db` zielone

**Punkt kontrolny**: zestawienie liczy się, sprząta i zostawia ślad.

---

## Faza 8: Zakładka Przegląd [P]

**Cel**: US3 – pierwszy ekran z danymi. Zależy od fazy 5 (do testu ręcznego z danymi – od fazy 6).
**Test niezależny**: dane z T047 w lokalnej bazie → kafle i wykresy zgodne z testem SQL.

- [ ] T054 [US3] `src/panel/zakladki/Przeglad.tsx`: kafle `KartaStat` (unikalni dziś/wczoraj/7 dni/średnia, odsłony 24 h/7 dni/30 dni, szczyt godzinowy i dzienny z datą, teraz na stronie), `WykresDzienny` (30 dni, `admin_seria_dzienna`), `WykresGodzinowy` (48 h), `PasekUdzialow` ludzie vs boty (podstawa = suma obu), tabela crawlerów AI (`TabelaTop`, `admin_boty_ai`); brak danych → `BrakDanych`, nigdy 0
- [ ] T055 [US3] Wyprowadzanie wierszy wykresów i kafli z odpowiedzi RPC jako czyste funkcje w `src/panel/zakladki/przeglad-dane.ts` + `src/panel/zakladki/przeglad-dane.test.ts` (dni bez ruchu w serii, średnia 7 dni, zmiana wobec wczoraj przez `zmianaProcentowa`)

---

## Faza 9: Zakładki Akwizycja i Sesje [P]

**Cel**: US4. Zależy od fazy 5.

- [ ] T056 [P] [US4] `src/panel/zakladki/Akwizycja.tsx`: przełącznik okna 7/30 dni; kanały (`PasekUdzialow` + `TabelaTop`), źródła (kanał, źródło, ścieżka, wizyty), kampanie UTM, kraje (`(nieznany)` osobno), urządzenia; wstęp z `WSTEPY.akwizycja`
- [ ] T057 [P] [US4] `src/panel/zakladki/Sesje.tsx`: kafle z `admin_sesje_przeglad` (sesje, mediana/średnia stron, mediana i p75 czasu, odsetek zaangażowanych i jednostronicowych przez `procentOd` od liczby sesji), top przejścia `skad → dokad` (z `(wyjście)`), udostępnienia wg kanału

---

## Faza 10: Zakładki Zaangażowanie, CTA i Treść [P]

**Cel**: US5. Zależy od fazy 5.

- [ ] T058 [P] [US5] `src/panel/zakladki/Zaangazowanie.tsx`: top ścieżki 3-krokowe, sekcje ekranu (wybór ekranu; zasięg sekcji = `odslony_z_sekcja / odslony_ekranu` przez `procentOd`, mediana czasu), punkt urwania (ekran, sekcja, sesje, udział od sumy urwań)
- [ ] T059 [P] [US5] `src/panel/zakladki/Cta.tsx`: klikalność sekcji = kliknięcia / wyświetlenia (`procentOd`, podpis kierunku „więcej = lepiej”), lista martwych przycisków, sygnały UX na 1000 odsłon ekranu
- [ ] T060 [P] [US5] `src/panel/zakladki/Tresc.tsx`: top ekrany, top adresy (link do `#/okolica/<id>`), wyszukiwania bez wyniku (fraza, liczba, ostatnio), `WykresLejka` z `lejek()` (procent od kroku „wyszukanie” i od poprzedniego, podpisane)

---

## Faza 11: Zakładka Jakość [P]

**Cel**: US6. Zależy od fazy 5.

- [ ] T061 [US6] `src/panel/zakladki/Jakosc.tsx`: diagnostyka pomiaru (ostatnie zdarzenie, zdarzenia na typ 24 h, bez odcisku, ostatni bieg – czerwony gdy starszy niż 26 h lub z `blad`), Web Vitals p75 per ekran (ms, liczba próbek obok, ocena z `ocenaWitalu`; CLS jako ułamek), błędy klienta (komunikat, ekran, liczba, ostatnio)

---

## Faza 12: Pomiar – wpięcia w ekrany i sprzeciw [P]

**Cel**: oznaczenia sekcji/CTA, zdarzenia wyszukiwarki, przełącznik „Pomiar ruchu” (US1, US5).
Zależy od fazy 4. Dotyka plików toru karta/strony – wyłącznie atrybuty i jednolinijkowe wywołania.

- [X] T062 [P] [US5] `src/karta/wyszukiwarka/Wyszukiwarka.tsx`: po zatwierdzeniu wyszukiwania (nie przy każdym znaku – debounce 1 s albo wybór/enter) `produktowe('wyszukanie', { wynikow, rodzaj })`; przy zerze wyników `produktowe('wyszukanie_bez_wyniku', normalizujFraze(tekst))`
- [X] T063 [P] [US5] Atrybuty `data-sekcja` (klucze z contracts/pomiar-klient.md) i `data-cel` na głównych przyciskach w plikach ekranu karty adresu (`src/karta/okolica/*.tsx`), `src/karta/porownanie/EkranPorownanie.tsx`, `src/karta/biznes/EkranBiznes.tsx`, `src/karta/EkranSzukaj.tsx` – bez zmian zachowania i stylów
- [X] T064 [P] [US1] `src/strony/Metoda.tsx` (+ `src/strony/metoda.css` w razie potrzeby): sekcja „Pomiar ruchu” – co mierzymy, czego nie (IP, ciasteczka), przełącznik `ustawPomiar` z odczytem `pomiarWylaczony()`; przy wyłączeniu jedno zdarzenie `pomiar_wylaczony` PRZED zapisem wyboru; **treść publiczna – oznacz w raporcie fazy do akceptacji właściciela przed wdrożeniem**
- [ ] T065 [US1] `pnpm verify` + `node --test src/pomiar/ src/karta/` – istniejące testy ekranów bez regresji

---

## Faza 13: Integracja (ostatnia – przegląd integratora)

**Cel**: zamontowanie pomiaru i dev-endpointu; jedyne zmiany plików toru integracji.
Zależy od faz 3, 4, 5, 12.

- [ ] T066 `src/App.tsx`: `<Pomiar />` (z `@/pomiar/Pomiar`) obok `<Aplikacja />` – pomiar rusza na wszystkich ekranach
- [ ] T067 `vite.config.ts`: plugin dev (`configureServer`) pod `/api/zdarzenie` wołający `handler` z `api/zdarzenie.js` z `env` z `loadEnv(mode, cwd, '')` – tylko `pnpm dev`, nic w buildzie
- [ ] T068 Przegląd `package.json` / `pnpm-lock.yaml` (recharts z T001) i `vercel.json`: potwierdź, że rewrite `/((?!…api/…).*)` przepuszcza `/api/zdarzenie` i nie trzeba wpisu w `functions`; `src/kontrakty/**` bez zmian – zapisz wynik przeglądu w komentarzu issue fazy
- [ ] T069 Zdejmij ewentualny `skip` z `api/_zdarzenie-kontrakt.test.js` (T017/T029); `node --test api/ src/pomiar/ src/panel/ src/wynik/` i `pnpm verify` zielone

---

## Faza 14: Bramka i szlif

**Cel**: kryteria sukcesu SC-001–SC-008, dokumentacja.

- [ ] T070 [P] Waga paczki (SC-002): `pnpm build` przed (z `main`) i po; gzip chunku wejściowego +≤ 6 KB; `recharts` tylko w chunku panelu – wynik w komentarzu issue
- [ ] T071 [P] Przejście quickstart.md kroki 1–5 na lokalnym Supabase; rozbieżności → poprawki w odpowiednich plikach faz albo w quickstart.md
- [ ] T072 [P] `docs/panel-admina.md`: architektura panelu adresscore (warstwy, bramka, pomiar, zestawienie, jak dołożyć widok: RPC z bramką → wpis w `src/panel/dane.ts` → hasło w `slownik.ts` → komponent), wzór z-dykty `docs/panel-admina.md` w skrócie
- [ ] T073 Przegląd prywatności: `grep` po `api/` i `src/pomiar/` – brak `console.*` z IP/UA, brak zapisu do storage poza `pomiar-wylaczony`, brak `useMemo`/`useCallback` w `src/panel/` i `src/pomiar/`; półpauzy zamiast pauz w nowych tekstach

---

## Zależności i kolejność

```text
Faza 1 (T001) ─────────────────────────────┐
                                           ▼
Poziom 1 [P]:  F2 baza-fundament   F3 endpoint   F4 pomiar-rdzeń   F5 panel-fundament
                   │                    │              │                 │
Poziom 2 [P]:  F6 RPC  ∥  F7 zestaw     │          F12 wpięcia      F8 ∥ F9 ∥ F10 ∥ F11 (zakładki)
                   │                    │              │                 │
Poziom 3:          └──────────── F13 integracja ◄──────┴─────────────────┘
Poziom 4:                        F14 bramka i szlif
```

| Faza | Zależy od | Równolegle z | Pliki (na wyłączność fazy) |
|---|---|---|---|
| 1 | – | – | `package.json`, `pnpm-lock.yaml` |
| 2 | – | 3, 4, 5 | `supabase/migrations/*_analityka_fundament.sql`, `supabase/tests/analityka_bramka.test.sql`, `analityka_sesje.test.sql` |
| 3 | – | 2, 4, 5 | `api/zdarzenie.js`, `api/_zdarzenie*.js`, `api/_odcisk*.js`, `api/_ruch*.js` |
| 4 | – | 2, 3, 5 | `src/pomiar/**` |
| 5 | 1 | 2, 3, 4 | `src/panel/**` (bez treści zakładek), `src/lib/supabase.ts`, `src/wynik/url.ts`, `src/wynik/urlPanel.test.ts`, `src/karta/ladowanieEkranow.ts`, `src/karta/Aplikacja.tsx` |
| 6 | 2 | 7 (warunkowo), 8–12 | `supabase/migrations/*_analityka_panel.sql`, `supabase/tests/analityka_panel.test.sql` |
| 7 | 2 | 6 (warunkowo), 8–12 | `supabase/migrations/*_analityka_zestaw.sql`, `supabase/tests/analityka_zestaw.test.sql` |
| 8 | 5 | 6, 7, 9–12 | `src/panel/zakladki/Przeglad.tsx`, `przeglad-dane*.ts` |
| 9 | 5 | 6, 7, 8, 10–12 | `src/panel/zakladki/Akwizycja.tsx`, `Sesje.tsx` |
| 10 | 5 | 6, 7, 8, 9, 11, 12 | `src/panel/zakladki/Zaangazowanie.tsx`, `Cta.tsx`, `Tresc.tsx` |
| 11 | 5 | 6, 7, 8–10, 12 | `src/panel/zakladki/Jakosc.tsx` |
| 12 | 4 | 6–11 | `src/karta/wyszukiwarka/Wyszukiwarka.tsx`, `src/karta/okolica/*.tsx`, `src/karta/porownanie/EkranPorownanie.tsx`, `src/karta/biznes/EkranBiznes.tsx`, `src/karta/EkranSzukaj.tsx`, `src/strony/Metoda.tsx`, `src/strony/metoda.css` |
| 13 | 3, 4, 5, 12 | – | `src/App.tsx`, `vite.config.ts` (+ przegląd `package.json`, `vercel.json`) |
| 14 | 13 (+6, 7 dla quickstart) | – | `docs/panel-admina.md`, poprawki |

Jedyne zadanie łączące tory B i C: T017 (test parytetu) – wykonuje go faza kończąca się
później (T017 w fazie 3 albo T029 w fazie 4), domyka T069.

## Przykłady równoległego uruchomienia

```text
Poziom 1 – cztery worktree naraz:
  wykonawca A: Faza 2 (T002–T010)
  wykonawca B: Faza 3 (T011–T017)
  wykonawca C: Faza 4 (T018–T029)
  wykonawca D: Faza 5 (T030–T041) – po T001
Poziom 2 – do siedmiu naraz:
  Faza 6, Faza 7 (jeśli wt.ps1 pozwala), Faza 8, 9, 10, 11, 12
W obrębie faz: zadania [P] (różne pliki), np. T011 ∥ T012 ∥ T013; T018 ∥ T019 ∥ T020 ∥ T021;
T030 ∥ T031 ∥ T032 ∥ T033 ∥ T034 ∥ T035 ∥ T036.
```

## Strategia wdrożenia

- **MVP = US1 + US2 + US3**: fazy 1–5, 6 (tylko T042–T043 + bramka), 8, 13 – pomiar
  zbiera dane, admin loguje się i widzi Przegląd. Pomiar ma ruszyć jak najwcześniej
  (każdy dzień bez pomiaru to luka w historii).
- Przyrosty: US4 (faza 9) → US5 (fazy 10, 12) → US6 (faza 11) → zestawienie (faza 7,
  przed upływem 90 dni od startu pomiaru) → szlif (faza 14).
- Wdrożenie produkcyjne (`pnpm db:push` z `main`, zmienne serwerowe na Vercelu i Coolify,
  Google OAuth w Supabase, dopisanie admina, commit `[wdroz]`) – decyzja i ręce właściciela /
  integratora (quickstart.md krok 6).
