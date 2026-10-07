# Plan implementacji: Wszystkie miasta od razu widoczne na mapie

**Gałąź**: `feat/wszystkie-miasta` | **Data**: 2026-10-07 | **Spec**: [spec.md](spec.md) | **Issue**: #223

## Podsumowanie

Mapa ekranu Szukaj pokazuje naraz 10 zbiorów danych (Kraków z obwarzankiem + 9 miast). Warstwa
**przeglądowa** z kompaktów wszystkich miast (heksy r8/r9, kilkaset kB na start, warstwy
dociągane po pierwszym kolorze) + **pełne dane tylko bieżącego miasta** (adresy, ~65–127 warstw,
budynki, dojazd, usługi), przełączanego listą, klikiem albo kamerą. Jeden scalony zbiór (B)
odrzucony – szczegóły w [research.md](research.md), R1.

## Kontekst techniczny

**Język/wersja**: TypeScript 5 (strict), React 19 + React Compiler (bez ręcznego `useMemo`/`useCallback`)
**Zależności**: MapLibre GL (heksy jako GeoJSON + feature-state), h3-js, deck.gl tylko w 3D; bez nowych paczek
**Przechowywanie**: pliki statyczne `public/dane/**` (bez zmian), bez Supabase
**Testy**: `node --test <plik>.test.ts` (Node 24 zdejmuje typy; moduł testowany bez `import.meta.env`, jak `kontrakty/okolice.ts`) + `pnpm verify` (Biome, tsc, build)
**Platforma**: SPA na Vercelu, telefon i desktop, service worker trybu offline
**Cele wydajności**: SC-001..SC-003 ze spec (≤ 4 s do kolorów 10 miast, ≤ 2,5 MB dodatkowo, Kraków ≤ +10%)
**Ograniczenia**: r10 tylko dla bieżącego miasta (MapLibre i telefon nie uniosą ~130 tys. heksów r10 naraz);
brak danych = szrafura, nigdy 0; teksty z półpauzą
**Skala**: 10 zbiorów, 27–177 tys. adresów każdy, ~800 tys. adresów razem

## Sprawdzenie zasad (konstytucja = szablon, więc zasady z `CLAUDE.md` projektu)

| Zasada | Stan |
|---|---|
| Tory i pliki `integracja` zmienia tylko integrator | ✅ Faza 1 i Faza 7 oznaczone `[integracja]`, wykonuje je sesja nadrzędna |
| Brak danych = szara kategoria, nigdy zero | ✅ FR-004, test SC-005 w Fazie 3 |
| Przy warstwie źródło i rozdzielczość | ✅ karta czyta meta bieżącego miasta, bez zmian w treści meta |
| Schemat bazy tylko migracją | ✅ nie dotyczy – brak zmian w bazie |
| Sekrety | ✅ nie dotyczy |
| `useMemo`/`useCallback` | ✅ zakaz powtórzony w tasks.md |

Po projekcie: bez naruszeń.

## Rozstrzygnięcia (wątpliwości rozstrzygnięte w planie, nie do właściciela)

| # | Pytanie | Rozstrzygnięcie | Dlaczego |
|---|---|---|---|
| D1 | Architektura | **A**: przegląd z kompaktów + pełne dane bieżącego miasta | B = ~1 GB, nowy ETL, nowa wersja adresów, telefon nie uniesie; A korzysta z gotowych kompaktów (format 2) bez zmian w danych |
| D2 | Skąd manifest miasta | plugin `manifestDanych` w `vite.config.ts` rozszerzony na `public/dane/miasta/*/wskazniki` | jedno źródło prawdy jak dla Krakowa; plik w ETL dałby drugą kopię logiki, która cicho gnije |
| D3 | Rejestr miast | `src/kontrakty/miasta.ts` (slug, nazwa, forma „w …", katalog) + test zgodności z katalogami `public/dane/miasta/*` | potrzebna odmiana nazw („we Wrocławiu"), której nie ma w danych; test łapie miasto bez wpisu |
| D4 | Kadr startowy | cała Polska z 10 miastami (bez linku); z linkiem – miasto/adres z linku | dosłownie „od razu widoczne"; jedna stała, odwracalna |
| D5 | Kiedy kamera zmienia miasto | tylko przy zoomie ≥ 11, środek kadru w innym mieście, **bez** wybranego adresu i porównania; inaczej przycisk „Przełącz na X" | przesunięcie mapy nie może skasować porównania bez pytania |
| D6 | Porównanie między miastami | poza v1; zmiana miasta czyści wybór i porównanie z komunikatem | indeksy adresów są per zbiór; porównanie międzymiastowe wymagałoby kluczy złożonych w całym stanie |
| D7 | Link | parametr `mst=<slug>` w query hasha, pomijany dla Krakowa; brak = Kraków | `m` jest zajęty (miejsca Biznesu, `czytajMiejsca`), `miasto` myli się z ekranem `#/miasto`; `mst` jest wolny |
| D8 | Funkcje tylko krakowskie | wyszukiwarka okolic SIM, tryb Biznes (brak `biznes/popyt.json`), MPZP, pozwolenia 3D → komunikat „Na razie tylko w Krakowie" | brak plików w katalogach miast (sprawdzone); zero zamiast braku łamie zasadę projektu |
| D9 | Wagi przy zmianie miasta | `wagi`/`kierunki` w stanie to mapa po **sumie** id wszystkich miast; `podlaczDane` scala, nie zastępuje | inaczej kolor Krakowa w przeglądzie zależałby od tego, które miasto jest bieżące, a powrót do Krakowa gubiłby wagi warstw krakowskich |
| D10 | Skala ocen per miasto | ocena warstwy to pozycja w rozkładzie adresów **danego miasta**; legenda i dymek przeglądu dopisują „skala liczona osobno w każdym mieście" | uczciwość: 70 w Łodzi ≠ 70 w Krakowie; bez podpisu mapa sugeruje porównywalność |
| D11 | SEO, sitemap, `api/**` | bez zmian (FR-015) | strony SEO są generowane z danych Krakowa; rozszerzenie to osobny wpis `pomysl` |
| D12 | Inne ekrany z mapą (luki, symulator, biznes) | bieżące miasto, bez przeglądu innych | cel dotyczy mapy głównej; mniej ryzyka regresji |
| D13 | Kolejność ładowania przeglądu | bieżące miasto pierwsze, reszta po pierwszym kolorze, maks. 3 pobrania naraz | SC-003: Kraków nie może zwolnić |
| D14 | Do czego limit 3 pobrań (F3) | tylko do TŁA; bieżące miasto pobiera bez limitu, a miasto, które się nim staje, przejmuje swoje oczekujące zadania | limit na bieżącym mieście wydłużyłby pierwsze kolory Krakowa ponad `main` (SC-003): jego 23 warstwy szły dotąd równolegle |
| D15 | Kolory tła po zmianie profilu (F3) | stare kolory zostają, dopóki nie dojdą pliki nowych warstw; r10 bieżącego miasta liczymy tylko do czasu wczytania pełnych danych | kilkaset ms starego profilu to mniej szkody niż mrugnięcie całego tła; po wczytaniu pełnych danych r10 liczy `useWyniki`, a drugie liczenie 35 tys. heksów byłoby zbędne |
| D16 | Podział F3 na pliki | `przegladLiczenie` (arytmetyka), `przegladMenedzer` (ładowanie, kolejka), `przegladSklad` (złożenie widoku, stabilne referencje), `przeglad` (klej: fetch, React) | tylko klej dotyka `import.meta.env` i Reacta, więc kolejność, limit, izolacja błędów i stabilność `tlo` mają testy na gołym `node --test`, także na prawdziwych kompaktach 10 miast |

## Ryzyka

| Ryzyko | Skutek | Co robimy |
|---|---|---|
| Meta 9 miast rozjechana z Krakowem (ETL „stan pośredni" z 2026-10-04): 18 warstw ma inny `kierunek` (np. `ludnosc_1km`, `sejm2023_*`, `szkola_podst_wynik_e8` – w Krakowie `wiecej-lepiej`, w miastach `neutralny`), 61/65 różni się dowolnym polem, 6 id istnieje tylko w miastach | ten sam profil liczy w miastach inny zestaw warstw niż w Krakowie | front liczy każde miasto jego własną meta (zgodność z plikami); test T031 wypisuje rozjazd; **osobny wpis `dlug` w torze dane** na ponowny ETL meta miast – poza tą funkcją |
| Wydajność MapLibre przy 10 miastach | zacięcia na telefonie | r10 tylko bieżące miasto; przegląd r8/r9 (kilka tys. heksów) w osobnych źródłach; pomiar w Fazie 7 |
| Stary indeks w service workerze | 404 na plikach z hashem | T005: indeksy kompaktów wszystkich miast zawsze z sieci |
| Konflikt z innymi gałęziami w `stan.ts`/`EkranSzukaj.tsx` | rebase | fazy krótkie, rebase po każdym commicie |

## Struktura projektu (pliki tej funkcji)

```text
src/kontrakty/miasta.ts            [integracja] nowy – rejestr miast
src/kontrakty/index.ts             [integracja] parametr `baza` w wczytaj*
vite.config.ts                     [integracja] manifest per miasto
public/sw.js                       [integracja] indeksy miast zawsze z sieci
src/wynik/miastoDanych.ts          nowy – bieżące miasto, baza URL, getter bez Reacta
src/wynik/stan.ts, url.ts          pole `miasto`, parametr `mst`, reset wyboru, scalanie wag
src/wynik/dane.ts                  pamięć danych per miasto, useDane() = bieżące
src/wynik/przeglad.ts              nowy – przegląd wszystkich miast (zastępuje wstepnaMapa.ts)
src/wynik/przegladLiczenie.ts      nowy – czysta arytmetyka przeglądu (testowalna bez DOM)
src/mapa/MapaKrakowa.tsx           prop `tlo`, mgła z sumy miast, kadr Polski, teksty
src/mapa/geometria.ts, lot.ts      geometria tła, kadr wszystkich miast
src/miasto3d/kontrakt.ts, Pozwolenia3D.tsx      baza bieżącego miasta / tylko Kraków
src/wynik/dojazdCel.ts(.worker), obliczeniaBiznes.ts, biznesUslugi.ts   ścieżki per miasto
src/karta/** (EkranSzukaj, Naglowek, KatalogAdresow, Ranking, EkranOkolica, biznes, okolica/SzczegolyMpzp)  teksty i bramki
```

## Kontrakty

- [contracts/miasta.md](contracts/miasta.md) – rejestr i ścieżki danych miasta
- [contracts/przeglad.md](contracts/przeglad.md) – `usePrzeglad()` i prop `tlo` mapy
- [contracts/url.md](contracts/url.md) – parametr `m` i przejścia stanu

## Fazy wykonania (szczegóły i zadania: tasks.md)

```text
F1 [integracja] fundament ──┬─> F2 bieżące miasto i dane (wynik) ──┬─> F3 przegląd (wynik)      ─┐
                            │                                       └─> F5 dane poboczne per miasto├─> F6 ekran Szukaj i teksty ─> F7 [integracja] bramka
                            └─> F4 mapa: tło, mgła, kadr (mapa) ──────────────────────────────────┘
```

Równolegle: F2 ‖ F4; F3 ‖ F5 (‖ F4, jeśli jeszcze trwa). Szeregowo: F1 pierwsza, F6 po F2–F5, F7 ostatnia.

## Złożoność

Brak odstępstw do uzasadnienia.
