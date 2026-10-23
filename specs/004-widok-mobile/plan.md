# Plan: szybki start + dopracowany widok Web/Mobile (adresscore)

## Context

Właściciel: „aplikacja bardzo długo się ładuje” i „widok Web i Mobile niedopracowany”. Pomiar
produkcji (adresscore.pl, 2026-10-23) i odczyt kodu:

| Aspekt | Stan | Skutek |
|---|---|---|
| Dane na starcie | `useDane()` (`src/wynik/dane.ts:83` `wczytajWszystko`) pobiera `adresy.json` + **wszystkie 127** `wskazniki/*.json` = ~50 MB gzip, 312 MB JSON | na 4G ~40 s samego transferu |
| Wątek główny | `r.json()` ×128, `rozwinAdresy`, `grupujHeksy`, `policzWyniki` bez workera | karta zamarzała 45 s+ w Chrome (CDP timeout), FCP 17,7 s |
| Cache | `serwer/serwer.mjs` nie wysyła ETag → `public/sw.js` `cacheIOdswiez` pobiera ~50 MB w tle przy KAŻDYM wejściu; pliki kompaktu z hashem mają `max-age=300` | regresja po przenosinach z Vercela na Hetzner |
| Gotowiec nieużyty | ETL robi kompakt (`etl/kompakt.mjs`, dekoder `src/wynik/kompakt.ts`): heksy r10 ~2,4 MB, filtry ~2,9 MB, kafle r7 z adresami, `szukaj.bin`; inne miasta już startują z niego (`przeglad*.ts`) | Kraków wciąż ciągnie pełne JSON-y |
| Mobile 390 px | poziomy scroll strony (`PasekSerwisow`: `.sr-only` bez pozycjonowanego rodzica), podwójny scroll (main `100dvh`), mapa ~270 px przykryta legendą i etykietami „NN źródeł danych”, cele 22–36 px, 13 różnych breakpointów | aplikacja mapowa bez używalnej mapy na telefonie |
| Desktop | mapa ~55% wysokości, ranking pod nią, nagłówek 101 px niesticky, brak tokenów odstępów/cieni/ruchu/z-index, `mapa.css` 27 hexów i 0 `var()` | wygląd „składanka” |

Decyzje właściciela (2026-10-23): **wydajność – oba etapy** (szybkie poprawki + start z kompaktu),
**mobile – mapa na cały ekran + dolny arkusz z 3 pozycjami**.

## Organizacja pracy

- Dziennik: issue `funkcja` „Szybki start: kompakt zamiast 50 MB JSON” i „Widok Web/Mobile: arkusz,
  tokeny, nagłówek” (milestone wg obszaru); rezerwacja `rezerwuj.mjs zajmij`; `Refs #NN`.
- Dwa worktree, dwa specy (≥ 3 pliki + kontrakt danych): `wt.ps1 nowa szybki-start` →
  `specs/003-szybki-start`, `wt.ps1 nowa widok-mobile` → `specs/004-widok-mobile`. Opus pisze specy
  i plan, fazy `tasks.md` idą na agentów (`task-sonnet-low` logika/decyzje, `task-haiku-low`
  mechanika z gotowym planem). Paczki równoległe nie dzielą plików.
- **UI pod kontrolą Opusa** (agenci słabo radzą sobie z UI): Opus robi makietę HTML arkusza i
  desktopu w `docs/makiety/` przed kodem, a po każdej paczce UI sam ogląda zrzuty 390/768/1440
  i odsyła poprawki. Agent dostaje dokładne wartości (tokeny, px, stany), nie „zrób ładnie”.
- Scalanie: `pnpm zadanie scal` / kolejka; deploy przez `wdroz.mjs` po `go`.

## Etap A – wydajność, szybkie poprawki (worktree `szybki-start`, ~1–2 dni)

Cztery paczki, rozłączne pliki:

1. **A1 serwer** (`serwer/serwer.mjs`, + `vercel.json` jako zapas): słaby ETag `W/"size-mtimeMs"`,
   304 na `If-None-Match`/`If-Modified-Since`; pliki kompaktu z hashem
   (`/kompakt/.*\.[0-9a-f]{10}\.(bin|json|json\.gz)$`) → `max-age=31536000, immutable`;
   `indeks.json`, `manifest.json` → `no-cache`; reszta `/dane` → `max-age=300, stale-while-revalidate=86400`.
2. **A2 service worker** (`public/sw.js`, cache v5): kompakt/kafle cache-first bez odświeżania;
   pełne dane odświeżane najwyżej raz na 24 h albo wg `indeks.wersja`; sprzątanie starych kopii.
3. **A3 worker danych** (nowy `src/wynik/daneWorker.ts`, `dane.ts`, czytelnicy `wartosci`):
   fetch + parse + skale + `grupujHeksy` w workerze, 6 pobrań naraz `priority:'low'`;
   `WskaznikPrzygotowany.wartosci` → `Float64Array` (NaN = brak danych) jako transferable – `tsc`
   wskaże każde `=== null` (silnik, heksy, filtry, luki, sasiedzi, symulacja, biznes,
   zapytajOAdres, spelnienie, demo, Metoda). Kontrakt pliku `PlikWskaznika` bez zmian.
   Fallback bez Workera = ten sam kod na wątku głównym.
4. **A4 kolejność** (po A3; `pamiecDanych.ts`, `dane.ts`, `EkranSzukaj.tsx`, `Aplikacja.tsx`):
   `pozwolNaPelneDane()` – Szukaj zwalnia pełne dane dopiero po pierwszej pokolorowanej klatce
   mapy (`requestIdleCallback`), mapa koloruje się z `przeglad.biezaceR10`; wczesny
   `import('@/mapa/MapaKrakowa')`; `h3-js` poza chunk wejściowy (dynamiczny import w
   `przegladLiczenie`, `wyszukiwarka/heks.ts`, `sasiedzi.ts`).

Wynik etapu A: koniec zamrażania, powrót = same 304; pierwsze wejście nadal ~50 MB (w tle).

## Etap B – start z kompaktu (ten sam worktree, ~3–5 dni)

1. **B1 ETL format 3** (`etl/kompakt.mjs`, `src/wynik/kompakt.ts`, `etl/kompakt-spojnosc.mjs`):
   kolumna `i` (pozycja w `adresy.json` – zostaje kluczem adresu w stanie i linkach) w każdym
   kaflu; kafle > ~1500 adresów dzielone na r8 (centrum ma dziś 400–472 KB gz); sidecar bbox okolic.
   Przebudowa kompaktów 10 miast.
2. **B2** `src/wynik/kompaktBiezacy.ts` → `useDaneHeksow()` (bierze wpis bieżącego miasta z
   `przegladMenedzer`, dociąga `filtry/<id>`, `skale`, `szukaj` leniwie).
3. **B3** `src/wynik/kafle.ts` → `wczytajKafel` (LRU 40), `useKafel(h3)`, `useAdres(i)`,
   `adresZPunktu(lon,lat)`; kafel + skale → `WskaznikPrzygotowany[]`, więc `wynikAdresu`
   i reszta silnika liczą kartę identycznie jak z pełnych danych.
4. **B4** `useWynikiMapy()` na istniejących, nieużywanych `wynikiHeksow` /
   `wykluczeniaHeksow` / `najlepszeHeksy` (`src/wynik/heksy.ts`).
5. **B5 Ranking** `rankingKompakt.ts`: przybliżenie z heksów → top 25 ulic → ich kafle (≤ 1,5 MB)
   → dokładny `rankingUlic`. Bramka `etl/ranking-zgodnosc.mjs`: top 5 = pełne dane w 100%
   person × trybów × 3 zestawów filtrów.
6. **B6** `stan.ts`: `podlaczDane` → `podlaczMeta(manifest)` + `podlaczSlownik(resolver)`
   (id z linku przez `id.bin` tylko, gdy link je niesie).
7. **B7 przepięcie konsumentów** (równolegle, każda grupa swoje pliki):

| Grupa | Pliki | Źródło |
|---|---|---|
| Szukaj | EkranSzukaj, Ranking, PanelFiltrow/Budzetu/Dojazdu, PoleOpiszSiebie, MiniKarta, Wyszukiwarka | heksy + `szukaj.bin` + kafel |
| Okolica | EkranOkolica, LepszySasiad, useSasiedzi, PoleZapytajOAdres, Okolica3D, Warstwa3D, Pokaz3D | kafel + pierścień kafli |
| Porównanie | EkranPorownanie | ≤ 5 adresów z kafli |
| Metoda | Metoda.tsx | manifest + `indeks.pokrycie` |
| Bez zmian | EkranSymulatora, PanelLuk/MapaLuk | `useDane()` leniwie (Luki opcjonalnie jedna warstwa) |

Kolejność plików: B7-Szukaj startuje dopiero po C-P3 (oba ruszają `EkranSzukaj.tsx`, `MiniKarta.tsx`, `Ranking.tsx`).

## Etap C – widok Web/Mobile (worktree `widok-mobile`, równolegle z A/B)

0. **Makieta (Opus)**: `docs/makiety/arkusz-mobile.html` (3 stany arkusza, wybrany adres,
   porównanie) + desktop (pełna mapa, zakładki Filtry | Ranking) – otwarta w przeglądarce;
   punkt decyzyjny tylko przy rozbieżności z tym planem.
1. **P0 tokeny** (sekwencyjnie, Haiku z gotowymi wartościami): `src/styles.css` – odstępy
   `--odstep-1..8` (4/8/12/16/20/24/32/48), skala pisma 12/13/15/17/20/26, promienie s/m/l/pełny,
   cienie `--cien-1/2/arkusz`, ruch `--czas-szybki` 120 / `--czas` 200 / `--czas-arkusz` 320 +
   `--krzywa`, z-index (mapa 2–5, lepkie 10, arkusz 20, nagłówek 30, menu 40, toast 50),
   `--akcent-hover` zamiast 3 odcieni; globalny `prefers-reduced-motion`; strażniki
   `@media (hover:hover)`; trzy breakpointy 640/1024/1440 + `src/lib/punktyLamania.ts`
   (`lekki.ts`, `EkranSzukaj.tsx:203`, `EkranPorownanie`, `Okolica3D`, `PanelCienia`).
   Blok nagłówka → `src/karta/naglowek.css`, blok Szukaj → `szukaj.css`. Gotowe: `pnpm verify`, zrzuty bez zmian.
2. Po P0 równolegle:
   - **P1 (Haiku)** `serwisy.css` + `PasekSerwisow.tsx` (`position:relative`, sr-only z `clip-path`),
     cele ≥ 44 px (`panel/panel.css:128`, `miasto3d.css`, `szukaj.css` chipy), `katalog.css`, reszta CSS komponentów → 3 breakpointy.
   - **P2 (Sonnet)** nowe `src/karta/arkusz/ArkuszDolny.tsx`, `arkusz.css`, `fizykaArkusza.ts` + test:
     stany zwinięty (112 px + safe-area) / pół (50dvh) / pełny; drag pointer events z progiem 8 px
     i prędkością (>0,5 px/ms → projekcja), `--arkusz-y` bez re-renderu; przekazanie scrolla
     w stanie pełnym; uchwyt = `<button aria-expanded>`, Esc zwija o poziom, `inert` na ukrytej
     treści, fokus pola → pełny + `visualViewport`; reduced-motion = bez animacji.
   - **P4 (Sonnet)** `MapaKrakowa.tsx`, `mapa.css`, `etykietyZrodel.ts`, `lot.ts`: prop
     `odstepDolny` → `easeTo({padding})`; legenda zwijana (na telefonie sam pasek 0–100);
     etykiety „NN źródeł danych” ukryte od zoom 7 i zawsze < 640 px; hexy → `var()`;
     kontrolki 44 px.
   - **P5 (Sonnet)** `Naglowek.tsx`, `naglowek.css`, `tryby.css`, `Aplikacja.tsx`, `aplikacja.css`:
     jeden sticky wiersz 56 px; pasek partnerów 28 px, na telefonie w Menu; stopka nie renderuje się na Szukaj.
3. **P3 (Sonnet, po P2+P4)** `EkranSzukaj.tsx`, `szukaj.css`, `MiniKarta.tsx`, `Ranking.tsx`,
   `Wyszukiwarka.tsx`: < 1024 px arkusz zastępuje `display:contents`/`order`/„Zwiń mapę”;
   zakładki Filtry | Ranking (desktop i arkusz); MiniKarta w arkuszu z jednym CTA „Otwórz kartę”;
   desktop – mapa 100% prawej kolumny, pasek warstw na mapie; zachowane wszystkie `data-cel`.
4. **Review**: Sonnet czyta diff, Opus ogląda zrzuty i logikę arkusza; poprawki wracają paczką.

Punkty decyzyjne zapisane w planie (pytam dopiero przy nich):
- **D4 / FR-012** – start pokazuje całą Polskę (udokumentowane w `src/wynik/README.md:383`).
  Propozycja: kadr bieżącego miasta + przycisk „Wszystkie miasta”. Wymaga zgody i zmiany README.
- Próg `trybLekki` (bez 3D): 640 czy 1024.
- Offline demo (#100) po etapie B obejmie tylko odwiedzone kafle.

## Weryfikacja

- Każda paczka: `pnpm verify` + `node --test 'src/**/*.test.ts'`.
- **Pomiar startu** `scripts/pomiar-startu.mjs` (Playwright przez `pnpm dlx`, CPU ×4, Fast 4G,
  świeży profil, `pnpm build` + `serwer.mjs`), przed i po każdym etapie:
  - A: wizyta powtórna ≤ 300 KB pod `/dane` (same 304); brak long tasków > 200 ms w 15 s; TBT < 600 ms.
  - B: zimny start dane ≤ 1,5 MB, całość ≤ 3 MB, zero żądań `adresy.json`/`wskazniki/`;
    `performance.mark('mapa-kolor')` ≤ 3 s, ranking ≤ 5 s, karta ≤ 1 s po kaflu.
- **UI** (Playwright 390×844, 768×1024, 1440×900): `scrollWidth === clientWidth`; jeden kontener
  przewijania na kolumnę (telefon: `html` bez scrolla); wszystkie widoczne cele ≥ 44×44; pod
  `reducedMotion:'reduce'` `transition-duration` arkusza 0 s; drag do każdego stanu, Esc zwija,
  `aria-expanded` się zmienia, wybrany adres nad krawędzią arkusza. Zrzuty ogląda Opus.
- Po scaleniu: pomiar na produkcji tym samym skryptem; issue zamknięte po wdrożeniu.
