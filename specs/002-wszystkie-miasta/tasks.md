---
description: "Lista zadań: wszystkie miasta od razu widoczne na mapie"
---

# Zadania: Wszystkie miasta od razu widoczne na mapie

**Wejście**: `specs/002-wszystkie-miasta/` – [spec.md](spec.md), [plan.md](plan.md),
[research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/),
[quickstart.md](quickstart.md). Issue funkcji: #223.

**Testy**: tak, dla czystej logiki (rejestr, przegląd, link/stan) – zasada „logika prezentacji
w `lib/`/czystej funkcji, inwariant pod testem". Uruchamianie: `node --test <plik>.test.ts`
i `pnpm verify`.

**Reguły dla każdego wykonawcy**:
- Biome, alias `@/`, React Compiler – **żadnych** `useMemo`/`useCallback`.
- Polski tekst (UI, komentarze, commity): półpauza `–` ze spacjami, nigdy pauza.
- Brak danych = `null` → szrafura; nigdy 0. Każda nowa ścieżka liczenia ma na to test.
- **Pliki toru `integracja`** (`src/kontrakty/**`, `vite.config.ts`, `public/sw.js`,
  `package.json`, `src/App.tsx`, `vercel.json`) zmieniają WYŁĄCZNIE Faza 1 i Faza 7
  (wykonuje sesja nadrzędna = integrator). Faza 2–6 tych plików nie dotyka; potrzeba zmiany
  → zgłoś w raporcie fazy, nie edytuj.
- Nie zmieniamy `public/dane/**`, `etl/**`, `api/**`, `scripts/generuj-katalog.mjs` (FR-015).
- Commit: po polsku, `Refs #223`; przed commitem `pnpm verify` + testy fazy.

## Format: `[ID] [P?] [Story] Opis`

- **[P]**: może iść równolegle z innymi zadaniami tej fazy (inne pliki).
- **[USn]**: historia ze spec.md (US1 wszystkie miasta naraz, US2 praca w mieście,
  US3 uczciwe braki, US4 wydajność).

---

## Faza 1: Fundament – kontrakty i build [integracja] (szeregowo, pierwsza)

**Cel**: rejestr miast, ścieżki danych per miasto, manifesty miast w buildzie, service worker.
Blokuje wszystkie pozostałe fazy. Pliki: `src/kontrakty/miasta.ts` (nowy),
`src/kontrakty/miasta.test.ts` (nowy), `src/kontrakty/index.ts`, `vite.config.ts`, `public/sw.js`.

- [x] T001 Utwórz `src/kontrakty/miasta.ts` wg [contracts/miasta.md](contracts/miasta.md): `SlugMiasta`, `Miasto` (`slug`, `nazwa`, `wMiescie`, `katalog`, `srodek`), `MIASTA` (Kraków pierwszy, potem malejąco wg liczby adresów: warszawa, wroclaw, lodz, poznan, gdansk, szczecin, lublin, bydgoszcz, bialystok), `MIASTO_DOMYSLNE`, `miasto()`, `czySlugMiasta()`, typ `TloMapy` z [contracts/przeglad.md](contracts/przeglad.md); bez `import.meta.env`. Formy: „w Krakowie", „w Warszawie", „we Wrocławiu", „w Łodzi", „w Poznaniu", „w Gdańsku", „w Szczecinie", „w Lublinie", „w Bydgoszczy", „w Białymstoku"; `srodek` z `etl/lib/miasta.mjs`/obrysu danych
- [x] T002 [P] Test `src/kontrakty/miasta.test.ts`: zbiór slugów ≠ `krakow` = katalogi `public/dane/miasta/*` z `kompakt/indeks.json` (katalog bez wpisu i wpis bez katalogu = czerwony); slugi unikalne; `wMiescie` zaczyna się od „w " albo „we "
- [x] T003 W `src/kontrakty/index.ts` dodaj `bazaDanych(slug?)` i opcjonalny parametr `baza` w `wczytajAdresy`, `wczytajManifest`, `wczytajWskaznik`, `wczytajOkolice` (domyślnie Kraków – dotychczasowe wywołania bez zmian); eksportuj `./miasta.ts`
- [x] T004 W `vite.config.ts` rozszerz `manifestDanych`: `zbuduj(katalog)` dla `public/dane/wskazniki` i każdego `public/dane/miasta/<slug>/wskazniki`; middleware dev `/dane/miasta/<slug>/manifest.json`; `emitFile` `dane/miasta/<slug>/manifest.json`; komentarz „dlaczego" (jedno źródło prawdy, D2)
- [x] T005 [P] W `public/sw.js` wyjątek „zawsze z sieci" dla `/^\/dane\/(miasta\/[a-z]+\/)?kompakt\/indeks\.json$/` (R7); podnieś `CACHE` na `adresscore-v2`, żeby stare kopie indeksów wypadły
- [x] T006 Weryfikacja fazy: `node --test src/kontrakty/miasta.test.ts`, `pnpm verify`, `ls dist/dane/miasta/*/manifest.json` = 9 plików, każdy z `wersjaAdresow` równym `adresy.json` miasta

**Punkt kontrolny**: build daje manifesty 10 zbiorów; reszta aplikacji działa jak na `main`.

---

## Faza 2: Bieżące miasto i dane per miasto – tor karta/wynik [P z Fazą 4]

**Cel**: stan zna bieżące miasto, link je niesie, `useDane()` zwraca dane bieżącego miasta.
Pliki: `src/wynik/miastoDanych.ts` (nowy), `src/wynik/stan.ts`, `src/wynik/url.ts`,
`src/wynik/dane.ts`, `src/wynik/stanMiasto.test.ts` (nowy). Kontrakt: [contracts/url.md](contracts/url.md).

- [x] T010 [US2] `src/wynik/url.ts`: `StanUrl.miasto?: SlugMiasta`; czytanie/zapis `mst=` (pomijany dla Krakowa, nieznany → `undefined` + flaga do komunikatu); nie ruszać `m` (miejsca Biznesu) ani ekranu `#/miasto`
- [x] T011 [US2] `src/wynik/stan.ts`: pole `miasto` (domyślnie `krakow`) z linku; `ustawMiasto(slug, { klik? })` czyści `wybrany`, `porownanie`, `symulacja`, miejsca Biznesu; oczekujący klik wybiera adres po `podlaczDane` nowego miasta (reguła `adresWKliknietymHeksie`)
- [x] T012 [US2] `src/wynik/stan.ts` `podlaczDane`: `wagi`/`kierunki` scalane, nie zastępowane – id spoza meta bieżącego miasta zostają (D9); komentarz „dlaczego"
- [x] T013 [P] [US2] `src/wynik/miastoDanych.ts`: `miastoBiezace()`, `bazaBiezaca()`, `useMiasto()`, `tylkoKrakow()` – bez Reacta tam, gdzie to możliwe (getter z `pobierzStan()`)
- [x] T014 [US2] `src/wynik/dane.ts`: pamięć `Map<SlugMiasta, Promise<StanDanych>>` (najwyżej 2 miasta w pamięci), `wczytajWszystko(slug)` z `bazaDanych(slug)` dla adresów, manifestu, wskaźników, okolic i skal kompaktu; `useDane()`/`daneJesliGotowe()` = bieżące miasto (subskrypcja także na zmianę `miasto` w stanie); `Dane.miasto`; `podlaczDane` tylko gdy miasto nadal bieżące
- [x] T015 [US2] Test `src/wynik/stanMiasto.test.ts`: `mst=lodz` → `miasto: 'lodz'`; brak `mst` → Kraków; nieznany slug → Kraków; zapis linku pomija Kraków; `ustawMiasto` czyści wybór i porównanie; scalanie wag zachowuje id spoza meta
- [x] T016 Weryfikacja fazy: testy `src/wynik/*.test.ts` dotychczasowe zielone (`stanLink*`, `urlMiasto`, `urlBiznes`), `pnpm verify`; ręcznie `#/?mst=gdansk` → karta i ranking z adresami Gdańska (bez mapy przeglądu)

---

## Faza 3: Przegląd wszystkich miast – tor karta/wynik [P z Fazą 5 i 4]

**Cel**: kolory r8/r9 wszystkich miast z kompaktów, liczone tymi samymi wagami.
Pliki: `src/wynik/przeglad.ts` (nowy), `src/wynik/przegladLiczenie.ts` (nowy),
`src/wynik/przegladLiczenie.test.ts` (nowy), `src/wynik/wstepnaMapa.ts` (usunięty albo
cienka nakładka). Kontrakt: [contracts/przeglad.md](contracts/przeglad.md). Zależy od Fazy 2 (bieżące miasto).

- [ ] T020 [P] [US1] `src/wynik/przegladLiczenie.ts`: `wynikiPrzegladu(podstawa, liczone, warstwa, res)` (opakowanie `wynikiHeksow`, NaN → `null`, `liczone = []` → same `null`), `zlaczTlo(per, biezace)`, `graniceZHeksow(r8)`, `miastoPunktu` po r8 (h3-js `latLngToCell(…, 8)` → mapa r8→slug); bez `import.meta.env`
- [ ] T021 [P] [US1] Test `src/wynik/przegladLiczenie.test.ts`: warstwa nieobecna w mieście → wszystkie heksy `null` (SC-005); heks bez danych → `null`, nigdy 0; `zlaczTlo` pomija bieżące miasto; granice z r8 obejmują wszystkie heksy; punkt poza miastami → `null`
- [ ] T022 [US1] `src/wynik/przeglad.ts`: menedżer per miasto (`indeks.json` + `manifest.json` z `bazaDanych(slug)` → `niezgodnoscKompaktu` → `heksy.bin` → `PodstawaHeksow`); warstwy heksów dociągane wg `liczoneWarstwy(metaMiasta, wagi, kierunki, warstwa)`; kolejka: bieżące miasto pierwsze, reszta po jego pierwszym kolorze, maks. 3 pobrania naraz (D13); błąd jednego miasta → `stan: 'brak'`, reszta działa (FR-013)
- [ ] T023 [US1] `usePrzeglad()` w `src/wynik/przeglad.ts` zwraca `Przeglad` (tlo, biezaceR10, podpis, kadrWszystkich, miastoPunktu, miasta); przenieś rolę `useWstepnaMapa` (r10 bieżącego miasta przed pełnymi danymi) i usuń `src/wynik/wstepnaMapa.ts` albo zostaw re-eksport do F6
- [ ] T024 Weryfikacja fazy: test T021, `pnpm verify`; log w konsoli dev: liczba heksów r8/r9 per miasto i bajty pobrane (do SC-002)

---

## Faza 4: Mapa – tło, mgła, kadr Polski – tor mapa [P z Fazą 2, 3, 5]

**Cel**: `MapaKrakowa` rysuje tło miast, mgłę z sumy miast i kadr startowy Polski.
Pliki: `src/mapa/MapaKrakowa.tsx`, `src/mapa/geometria.ts`, `src/mapa/lot.ts`, `src/mapa/mapa.css`.
Zależy tylko od Fazy 1 (typ `TloMapy`). Kontrakt: [contracts/przeglad.md](contracts/przeglad.md).

- [x] T030 [P] [US1] `src/mapa/geometria.ts`: `zbudujGeometrieTla(heksy r8, r9)` (kolekcje bez r10) i otoczka mgły z sumy r8 bieżącego miasta i tła; geometria tła przebudowywana tylko przy zmianie zbioru kluczy
- [x] T031 [US1] `src/mapa/MapaKrakowa.tsx`: prop `tlo?: TloMapy`; źródła `tlo-r8` (0–11) i `tlo-r9` (11–13) z tymi samymi wyrażeniami koloru, krycia, szrafury, obrysu braku i linii co heksy bieżącego miasta; feature-state wysyłane tylko dla zmienionych wartości (jak `wyslaneRef`); suwak krycia obejmuje tło
- [x] T032 [US1] `src/mapa/MapaKrakowa.tsx`: dymek tła „<Miasto> · wynik N (średnia okolicy)" / „<Miasto> · brak danych" przez `tlo.miastoHeksu`; `onWidok(lon, lat, zoom)` (trzeci argument, zgodnie wstecz); `kadrStartowy` – bez wybranego adresu i granic pierwsze `fitBounds` na prostokąt wszystkich miast zamiast Krakowa (D4)
- [x] T033 [US1] `src/mapa/MapaKrakowa.tsx` teksty: podpis mgły i wiersz legendy „poza obsługiwanymi miastami – brak danych"; wiersz legendy „Skala liczona osobno w każdym mieście", gdy `tlo` niepuste (D10); intro „Dane: Kraków i 9 największych miast"; `aria-label` „Mapa miast – …"
- [x] T034 [P] [US1] `src/mapa/lot.ts`: lot startowy (`?pokaz`) ląduje w bieżącym mieście, kadr zapasowy = `srodek` bieżącego miasta zamiast `WIDOK_KRAKOWA`, gdy obrys jeszcze nie gotowy
- [x] T035 Weryfikacja fazy: `pnpm verify`; ręcznie z atrapą `tlo` (2 miasta, część `null`) – szrafura w tle, dymek z nazwą miasta, suwak krycia działa na tło

---

## Faza 5: Dane poboczne per miasto i bramki „tylko Kraków" – tor karta/mapa/miasto3d [P z Fazą 3 i 4]

**Cel**: budynki 3D, dojazd i usługi z katalogu bieżącego miasta; funkcje tylko krakowskie
mówią to wprost. Zależy od Fazy 2 (`miastoDanych.ts`). Pliki: `src/miasto3d/kontrakt.ts`,
`src/miasto3d/Pozwolenia3D.tsx`, `src/miasto3d/pozwolenia.ts`, `src/wynik/dojazdCel.ts`,
`src/wynik/dojazdCel.worker.ts`, `src/wynik/obliczeniaBiznes.ts`, `src/wynik/biznesUslugi.ts`,
`src/wynik/biznesBranze.ts`, `src/wynik/symulacja.ts`, `src/karta/biznes/EkranBiznes.tsx`,
`src/karta/okolica/SzczegolyMpzp.tsx`, `src/karta/okolica/SzczegolySzkoly.tsx`, `src/mapa/okolica/wczytajGranice.ts`, `src/mapa/okolica/granice.ts`.

- [ ] T040 [P] [US2] `src/miasto3d/kontrakt.ts`: baza kafli budynków z `bazaBiezaca()`; pamięć kafli kluczowana pełną ścieżką (zmiana miasta nie podaje kafli Krakowa)
- [ ] T041 [P] [US2] `src/wynik/dojazdCel.ts` + `dojazdCel.worker.ts`: ścieżka grafu przekazywana do workera (`<baza>/dojazd/graf.json`), cache w workerze per ścieżka
- [ ] T042 [P] [US2] Usługi: `src/wynik/biznesUslugi.ts`, `biznesBranze.ts`, `symulacja.ts`, `obliczeniaBiznes.ts` (`uslugi/<id>.json`) – ścieżki z `bazaBiezaca()`; pamięć per miasto
- [ ] T043 [P] [US3] Tryb Biznes poza Krakowem (brak `biznes/popyt.json`): `src/karta/biznes/EkranBiznes.tsx` pokazuje „Tryb Biznes na razie tylko w Krakowie" z przyciskiem „Pokaż Kraków" (`ustawMiasto('krakow')`); `obliczeniaBiznes.ts` nie pobiera popytu poza Krakowem; `GRANICE_PUNKTU` bez zmian (D8)
- [ ] T044 [P] [US3] `SzczegolyMpzp.tsx`, `Pozwolenia3D.tsx`/`pozwolenia.ts`, `wczytajGranice.ts`/`granice.ts`: poza Krakowem nie pobierają plików krakowskich; sekcja karty pokazuje „Na razie tylko w Krakowie" zamiast pustych wartości; `SzczegolySzkoly.tsx` czyta `szkoly_e8_szczegoly.json` z `bazaBiezaca()` (plik jest w miastach)
- [ ] T045 Weryfikacja fazy: `pnpm verify`; ręcznie `#/?mst=lublin` – 3D przy adresie z budynkami Lublina, dojazd liczy się, Biznes i MPZP z komunikatem

---

## Faza 6: Ekran Szukaj – złożenie, lista miast, teksty (szeregowo po F2–F5)

**Cel**: użytkownik widzi wszystkie miasta, przełącza je i pracuje w każdym.
Pliki: `src/karta/EkranSzukaj.tsx`, `src/karta/szukaj.css`, `src/karta/WyborMiasta.tsx` (nowy),
`src/karta/Naglowek.tsx`, `src/karta/KatalogAdresow.tsx`, `src/karta/Ranking.tsx`,
`src/karta/okolica/EkranOkolica.tsx`, `src/karta/porownanie/EkranPorownanie.tsx`,
`src/karta/panel/PanelDojazdu.tsx`, `src/karta/luki/PanelLuk.tsx`, `src/mapa/luki/MapaLuk.tsx`,
`src/karta/symulator/*.tsx`, `src/karta/wyszukiwarka/Wyszukiwarka.tsx`, `src/miasto3d/Okolica3D.tsx`,
`src/miasto3d/PanelCienia.tsx`, `src/miasto3d/Warstwa3D.tsx`, `src/strony/Metoda.tsx`.

- [ ] T050 [US2] `src/karta/WyborMiasta.tsx` + style w `szukaj.css`: lista 10 miast (przyciski `seg`, `aria-pressed` = bieżące, akcent wyłącznie na bieżącym), stan ładowania miasta („Wczytuję dane: Łódź…" w `role="status"`), mieści się w 360 px bez poziomego przewijania; hover pod `@media (hover: hover)`
- [ ] T051 [US1] `src/karta/EkranSzukaj.tsx`: `usePrzeglad()` zamiast `useWstepnaMapa`; do mapy `heksy = wyniki?.heksy ?? przeglad.biezaceR10`, `tlo = przeglad.tlo`, `kadrStartowy` = `przeglad.kadrWszystkich` (gdy brak linku z adresem/miastem)
- [ ] T052 [US2] `src/karta/EkranSzukaj.tsx` `onKlik`: punkt w innym mieście (`przeglad.miastoPunktu`) → `ustawMiasto(slug, { klik })` + lot do miasta; punkt w bieżącym → jak dziś
- [ ] T053 [US2] `src/karta/EkranSzukaj.tsx` `onWidok(lon, lat, zoom)`: zoom ≥ 11 i środek w innym mieście → bez wybranego adresu i porównania `ustawMiasto`; inaczej przycisk „Przełącz na <Miasto>" z ostrzeżeniem „porównanie się wyczyści" (D5); ogłoszenie zmiany w `role="status"`
- [ ] T054 [US2] Teksty „w Krakowie" → `useMiasto().wMiescie` / `nazwa` w plikach z listy fazy (nagłówek „Znajdź okolicę we Wrocławiu", ranking, katalog, karta, porównanie, dojazd, luki, symulator, 3D, Metoda); bez zmian w treściach SEO
- [ ] T055 [US3] `EkranSzukaj.tsx`: wyszukiwarka okolic poza Krakowem (brak `okolice.json`) → „Wyszukiwanie okolic na razie tylko w Krakowie. Kliknij mapę, żeby wybrać adres."
- [ ] T056 [US2] Zgodność AI: `src/ai/PoleOpiszSiebie.tsx` i `PoleZapytajOAdres.tsx` działają na meta bieżącego miasta; warstwa spoza miasta → „brak danych" (sprawdzić, poprawić tylko po stronie `src/ai/**`, bez `api/**`)
- [ ] T057 Weryfikacja fazy: `pnpm verify`, wszystkie testy `node --test`, quickstart kroki 1–10 i 12, 14

---

## Faza 7: Bramka [integracja] (ostatnia)

**Cel**: dowód na kryteria sukcesu, przegląd na Opusie, merge.

- [ ] T060 Pomiar SC-001..SC-003 (DevTools „Fast 4G", twarde odświeżenie; `main` vs gałąź): czas do pierwszych kolorów Krakowa, czas do kolorów 10 miast, bajty przeglądu – liczby do komentarza w #223
- [ ] T061 [P] Kontrast nowych napisów w obu motywach (lista miast, komunikaty, wiersze legendy) – pomiar kanwą, wypisać liczbę zmierzonych elementów i najciaśniejszy wynik (SC-006)
- [ ] T062 [P] Offline: build + `pnpm preview`, wejście online, potem offline – mapa działa; podmiana pliku indeksu miasta online → pobierany świeży (quickstart 15)
- [ ] T063 Przegląd kodu (bramka review, Opus) całej gałęzi; poprawki
- [ ] T064 Wpis `dlug` w torze dane: „meta 9 miast rozjechana z Krakowem (kierunek 18 warstw, 6 id tylko w miastach)" – research R5; wpis `pomysl`: SEO i katalog dla 9 miast (FR-015)
- [ ] T065 Merge do `main` (`git merge --no-ff`), `pnpm verify` na `main`, push; wdrożenie przez commit `[wdroz]` – decyzja integratora

---

## Zależności i kolejność

| Faza | Zależy od | Równolegle z | Tor |
|---|---|---|---|
| F1 | – | – | integracja (integrator) |
| F2 | F1 | F4 | karta (`src/wynik/stan,url,dane,miastoDanych`) |
| F3 | F1, F2 | F4, F5 | karta (`src/wynik/przeglad*`) |
| F4 | F1 | F2, F3, F5 | mapa (`src/mapa/MapaKrakowa,geometria,lot`) |
| F5 | F1, F2 | F3, F4 | karta + mapa/okolica + miasto3d (pliki rozłączne z F3/F4) |
| F6 | F2, F3, F4, F5 | – | karta + strony + miasto3d (teksty) |
| F7 | F6 | – | integracja |

Rozłączność plików sprawdzona: F3 tylko nowe pliki `przeglad*` + `wstepnaMapa.ts`; F4 tylko
`src/mapa/{MapaKrakowa,geometria,lot}.ts(x)` + `mapa.css`; F5 nie dotyka `stan.ts`, `url.ts`,
`dane.ts`, `MapaKrakowa.tsx`, `EkranSzukaj.tsx`. Pliki wspólne F5 i F6: `src/miasto3d/*` –
F5 zmienia `kontrakt.ts`, `Pozwolenia3D.tsx`, `pozwolenia.ts`, F6 tylko teksty w
`Okolica3D.tsx`, `PanelCienia.tsx`, `Warstwa3D.tsx` – rozłączne.

## Przykłady równoległego uruchomienia

```text
Po F1:  worktree A → F2 (Sonnet)     ‖  worktree B → F4 (Sonnet)
Po F2:  worktree A → F3              ‖  worktree C → F5        (B dalej F4, jeśli trwa)
Po F3+F4+F5 zmergowanych do gałęzi funkcji: F6 (jeden wykonawca), potem F7 (integrator + Opus)
```

## Strategia wdrożenia

- **MVP = F1 + F2 + F3 + F4 + T051** – wszystkie miasta pokolorowane na mapie (US1, cel właściciela).
- Pełna wartość: + F5 + reszta F6 (praca w każdym mieście, uczciwe braki).
- Wdrożenie na produkcję po F7 jednym commitem `[wdroz]`.
