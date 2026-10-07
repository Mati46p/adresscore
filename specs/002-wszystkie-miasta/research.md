# Research: Wszystkie miasta od razu widoczne na mapie

Wszystkie liczby zmierzone na plikach w `public/dane` 2026-10-07.

## Stan wyjściowy (zbadane w kodzie)

- Front jest jednozbiorowy: `src/kontrakty/index.ts` (`BAZA = BASE_URL + 'dane'`, `wczytajAdresy`,
  `wczytajManifest`, `wczytajWskaznik`, `wczytajOkolice`), singleton `src/wynik/dane.ts`
  (`zaladujDane`, `useDane` – ok. 20 konsumentów), singleton `src/wynik/wstepnaMapa.ts`
  (kompakt Krakowa, jedyny konsument `EkranSzukaj`).
- Mapa (`src/mapa/MapaKrakowa.tsx`) rysuje heksy MapLibre GeoJSON: trzy źródła r8/r9/r10,
  wartości przez feature-state; r8/r9 to średnie dzieci r10 (`geometria.ts`); mgła = świat
  minus otoczka z r8; kadr startowy = Kraków (`kameraStartowa`), intro tylko z `?pokaz`.
- `manifest.json` nie leży w `public` – emituje go plugin `manifestDanych` w `vite.config.ts`
  wyłącznie z `public/dane/wskazniki`. Dla miast manifestu nie ma.
- Kompakt (format 2) każdego miasta ma własny `indeks.json` z `wersjaAdresow`, meta każdej
  warstwy i plikami heksów; `niezgodnoscKompaktu(indeks, manifest)` porównuje go z manifestem.
- Ścieżki na sztywno do Krakowa poza kontraktami: `dojazdCel.worker.ts` (`/dane/dojazd/graf.json`),
  `obliczeniaBiznes.ts` (`/dane/biznes/popyt.json`, `/dane/uslugi/<id>.json`), `EkranBiznes.tsx`,
  `biznesUslugi.ts`, `biznesBranze.ts`, `symulacja.ts` (`/dane/uslugi/katalog.json`),
  `miasto3d/kontrakt.ts` (`dane/budynki`), `Pozwolenia3D.tsx`, `SzczegolyMpzp.tsx`,
  `SzczegolySzkoly.tsx`, `mapa/okolica/*` (`okolice-granice.geojson`).
- Service worker (`public/sw.js`): `/dane/` z cache + odświeżanie w tle, wyjątek tylko
  `/dane/kompakt/indeks.json`.
- `GRANICE_PUNKTU` w `url.ts` (punkty Biznesu) to prostokąt Krakowa.

## Pomiary danych

| Zbiór | Adresy | Heksy r10 | Warstwy | `heksy.bin` | Suma plików heksów warstw | `skale` |
|---|---|---|---|---|---|---|
| Kraków (+ obwarzanek) | 176 684 | 35 274 | 127 | 142 kB | 2 064 kB | 343 kB |
| Warszawa | 126 566 | 19 914 | 70 | 95 kB | 857 kB | 226 kB |
| Wrocław | 75 230 | – | 66 | 45 kB | 363 kB | 215 kB |
| Łódź | 64 962 | 11 224 | 65 | 53 kB | 446 kB | 207 kB |
| Poznań | 63 023 | – | 65 | 43 kB | 346 kB | 217 kB |
| Gdańsk | 42 848 | – | 70 | 37 kB | 319 kB | 214 kB |
| Szczecin | 41 886 | – | 66 | 32 kB | 246 kB | 200 kB |
| Lublin | 29 041 | – | 71 | 26 kB | 244 kB | 206 kB |
| Bydgoszcz | 27 413 | – | 69 | 26 kB | 203 kB | 191 kB |
| Białystok | 27 192 | – | 70 | 21 kB | 172 kB | 188 kB |

Pełne katalogi miast: 63–281 MB każdy (razem ~1 GB nieskompresowanych). `heksy.bin` 9 miast
razem ~380 kB; warstwy heksów 9 miast razem ~3,2 MB, z czego profil domyślny potrzebuje
części (warstwy z wagą > 0) – szacunek 1–2 MB.

Dostępność plików pobocznych: `dojazd/graf.json`, `uslugi/katalog.json`, `budynki/` – są we
wszystkich miastach; `okolice.json`, `okolice-granice.geojson`, `biznes/`, `mpzp_*`,
`pozwolenia.geojson`, `sct/spp/punkty_schronienia` – tylko Kraków.

## R1. Architektura: jak pokazać 10 miast bez ładowania ~1 GB

- **Decyzja**: A – przegląd z kompaktów wszystkich miast + pełne dane bieżącego miasta na żądanie.
- **Uzasadnienie**: kompakty już istnieją, mają r8/r9/r10 w `heksy.bin` i warstwy heksów,
  silnik `wynikiHeksow(podstawa, res, liczone, warstwy)` liczy wynik na dowolnym poziomie –
  przegląd to nowy menedżer stanu, nie nowy format. Start: ~380 kB geometrii + warstwy
  profilu dociągane po pierwszym kolorze bieżącego miasta.
- **Odrzucone**:
  - B: jeden scalony zbiór (~800 tys. adresów, suma id 133 warstw) – ~1 GB surowych danych,
    nowy ETL i nowa `wersjaAdresow`, `useDane` rozwijałby 800 tys. obiektów w pamięci telefonu.
  - A' z gotowym plikiem przeglądu z ETL (wynik profilu domyślnego per r8/r9) – tańszy transfer,
    ale kolory innych miast nie reagowałyby na wagi i profil (kłamstwo legendy), plus zmiana `public/dane/**` (tor dane).

## R2. Manifest miasta

- **Decyzja**: rozszerzyć plugin `manifestDanych` o katalogi `public/dane/miasta/*/wskazniki`
  (middleware dev `/dane/miasta/<slug>/manifest.json` + `emitFile` w buildzie).
- **Odrzucone**: manifest wyprowadzany w przeglądarce z `kompakt/indeks.json` (brak meta warstw
  pominiętych, inny kształt niż kontrakt `Manifest`); plik z ETL (druga implementacja, tor dane).

## R3. Rysowanie na mapie

- **Decyzja**: r10 tylko bieżące miasto (istniejąca ścieżka `heksy`); pozostałe miasta jako
  „tło" w dwóch nowych źródłach `tlo-r8` (zoom < 11) i `tlo-r9` (11–13), te same wyrażenia
  koloru, szrafury i obrysu braku. Wartości r8/r9 tła z `wynikiHeksow(…, 8|9, …)` – policzone
  na kompakcie, nie średnią dzieci.
- **Dlaczego**: 130 tys. poligonów r10 w jednym GeoJSON to dziesiątki MB obiektów i
  setFeatureState przy każdym ruchu suwaka; r8/r9 wszystkich miast to kilka tysięcy heksów.
- **Odrzucone**: deck.gl H3HexagonLayer dla tła (drugi silnik rysowania obok MapLibre,
  inna paleta i krycie do pilnowania).

## R4. Zgodność wersji

Każde miasto sprawdza swój kompakt względem swojego manifestu (`niezgodnoscKompaktu`) i swoje
warstwy względem swojego `adresy.json` (`wersjaAdresow`) – bez zmian w regułach. Niezgodność
jednego miasta = to miasto pod mgłą z podpisem, nie wyjątek dla całej mapy.

## R5. Rozjazd meta miast i Krakowa (ryzyko, poza zakresem naprawy)

18 warstw ma w miastach `kierunek: neutralny`, a w Krakowie `wiecej-lepiej`
(`ludnosc_1km`, `sejm2023_lista_1..7`, `szkola_podst_wynik_e8`, `udzial_0_14`, `udzial_65plus`,
`gmina_pit_na_mieszkanca`, `powiat_wynagrodzenie_brutto`, `frekwencja_samorzad_2024`,
`osiadanie_mm_rok`, `pozary_gmina_2025`, `miejscowe_zagrozenia_gmina_2025`, `zabytki_rejestr_500m`);
61 z 65 warstw Łodzi różni się dowolnym polem meta; 6 id tylko w miastach
(`bankomat_poczta_odleglosc`, `halas_obwarzanek_lden`, `powodz_02proc`, `powodz_1proc`,
`sejm2023_lista_8`, `uslugi_15min`). Front liczy miasto jego meta. Naprawa = ponowny ETL meta
miast w torze dane – osobny wpis `dlug`.

## R6. Skala ocen

`skale` są liczone per zbiór (pozycja w rozkładzie adresów miasta). Kolor 70 w Łodzi i w
Krakowie znaczy „lepiej niż ~70% adresów **tego** miasta". Legenda i dymek tła mówią to wprost (D10).

## R7. Service worker

Wyjątek „zawsze z sieci" rozszerzony z `/dane/kompakt/indeks.json` na
`/^\/dane\/(miasta\/[a-z]+\/)?kompakt\/indeks\.json$/`. Pozostałe pliki miast (z hashem albo
z kontrolą wersji) mogą iść ścieżką „cache + odświeżanie".

## R8. SEO

`api/seo.js` i sitemapy generuje `scripts/generuj-katalog.mjs` z danych Krakowa. Bez zmian (FR-015).
