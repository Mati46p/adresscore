# Nocne światło z satelity VIIRS (#137)

Uruchom `node etl/swiatlo-viirs.mjs` (Node 24, bez nowych zależności). Testy: `node --test etl/lib/tiff.test.mjs etl/swiatlo-viirs.test.mjs`. Pobranie rastra (145 MB, raz) trafia do `etl/.cache/viirs/`; flaga `--szybko` pomija kontrolę dekodera na całym rastrze (ok. 5 s). Wynik: `public/dane/wskazniki/swiatlo_nocne_viirs.json`. Po uruchomieniu przebuduj kompakt (`node etl/kompakt.mjs`), bo nowa warstwa zmienia manifest, a niezgodny kompakt zmusza aplikację do ładowania pełnych JSON-ów.

## Źródło

Roczna średnia jasność nocna VIIRS DNB, produkt EOG **VNL v2.2, „annual average masked”** za 2023 r. (Earth Observation Group, Payne Institute, Colorado School of Mines), w kopii **WorldPop** (zbiór „Nighttime Lights 2015–2023”, Polska, DOI 10.5258/SOTON/WP00772, [strona zbioru](https://hub.worldpop.org/geodata/summary?id=62680)). Licencja **CC BY 4.0** po obu stronach: WorldPop i EOG VNL.

Plik: `pol_viirs_nvf_2023_100m_v1.tif`, <https://data.worldpop.org/GIS/Covariates/Global_2015_2030/POL/VIIRS/v1/nvf/pol_viirs_nvf_2023_100m_v1.tif>. Pobrany 2026-10-03; 144 825 645 B, SHA-256 `6c7ae8f3f6a8c027aef40642cf737a6b73827f7be14a7fb6e643c4da8d74c045` (skrypt odmawia pracy na pliku o innym rozmiarze lub sumie), `Last-Modified` 2024-09-22, ETag `"8a1dd2d-622ac38237376"`. BigTIFF, kafle 512 × 512 px, kompresja LZW, float32, 12 027 × 7 001 px, piksel 3″ (0,00083333333°), współrzędne WGS 84, nodata −999999.

**Dlaczego nie oryginały z zadania.** NASA Black Marble VNP46A4 (LAADS) przekierowuje pobranie na `urs.earthdata.nasa.gov`, a EOG VNL na `eogauth.mines.edu`: oba wymagają zalogowania kontem, którego nie mamy. Kopia WorldPop to ten sam produkt EOG (VNL v2.1 dla lat 2015–2021, v2.2 dla 2022–2023), dostępny bez logowania. Licencja i wymagane cytowanie (Elvidge i in. 2021, Remote Sensing 13(5):922, doi:10.3390/rs13050922) zostają zachowane w `meta.zrodla`.

**Wariant `nvf`, nie `fvf`.** WorldPop daje dwa pliki: `nvf` (bez filtra) i `fvf` (z usuniętymi pochodniami gazowymi i wulkanami). Pobrano oba i porównano piksel po pikselu: w całej Polsce różnią się 1 147 pikseli z 58,96 mln ważnych (0,002%), a w oknie adresów **żaden**. Wybór wariantu nie zmienia więc warstwy; bierzemy `nvf` jako czysty produkt EOG bez dodatkowej obróbki.

**Serwer WorldPop nie obsługuje zakresów.** Odpowiada `Accept-Ranges: bytes`, ale na żądanie `Range` oddaje cały plik (HTTP 200), więc czytanie samych kafli po sieci nie działa. Plik trzeba pobrać w całości (ok. 9 minut przy ok. 270 kB/s); potem czytamy z niego tylko sześć kafli z 336.

## Metoda

- Wartość = piksel rastra, w którym leży adres (`etl/lib/tiff.mjs`: własny czytnik BigTIFF/LZW bez GDAL, w stylu `zielen-worldcover.mjs`).
- Jednostka **nW/cm²/sr**: światło wysyłane w górę. To pośrednik zanieczyszczenia światłem w skali okolicy, **nie** jasność nieba z balkonu ani oświetlenie ulicy czy wnętrz.
- **Rozdzielczość 15″** (ok. 460 m × 300 m na 50°N), nie 3″: WorldPop wygładził oczka do 3″ (w oknie adresów żadna z 367 595 par sąsiednich pikseli o wartości dodatniej nie ma równych wartości; równe są tylko zera), więc wartość pod adresem to interpolacja między oczkami. W meta: `rozdzielczosc: siatka`, `rozmiar: ok. 460 m × 300 m (oczko 15″, wygładzone do 3″)`.
- **Zero źródła zostaje zerem**: EOG zeruje tło poniżej progu czułości, więc 0 to „brak wykrytego światła”, czyli pomiar. Brak pomiaru to nodata, który zamieniamy na `null`; w obszarze adresów nie występuje. Zerowych adresów jest 742 (Koniusza 415, Liszki 176, Igołomia-Wawrzeńczyce 121, Zabierzów 30), wszystkie w gminach wiejskich.
- Kategoria `spokoj`, kierunek `mniej-lepiej`, `zakres` [0, 60] (silnik skaluje liniowo; poświata nad miastem jest w przybliżeniu sumą wkładów źródeł). 60 to 97. percentyl adresów Krakowa; powyżej leży 1,2% wszystkich adresów (2 129): Stare Miasto, Grzegórzki i część Podgórza w Krakowie (2 031) oraz Brzezie w gm. Zabierzów (93) i 5 adresów w Niepołomicach. Norma: brak, bo nie ma jej w przepisach ani wytycznych dla jasności z satelity.

## Pokrycie i rozkład (wersja adresów `a7d233814059`)

176 684 / 176 684 adresów z wartością, 0 × `null`. Plik wskaźnika: 0,9 MB.

| Obszar | adresów | zer | p5 | p25 | mediana | p75 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Kraków | 70 217 | 0 | 5,6 | 11,6 | 21,9 | 34,7 | 52,6 | 81,7 | 97,7 |
| gminy wokół | 106 467 | 742 | 1,4 | 2,8 | 4,9 | 8,5 | 19,2 | 28,9 | 138,6 |

Miejsca znane (kontrola, nW/cm²/sr): Rynek Główny 91,3, Galeria Krakowska i Dworzec Główny 88,3, Las Wolski 4,8, Puszcza Niepołomicka 1,4. Najjaśniejsze adresy leżą w Brzeziu (gm. Zabierzów, 110–139): jaśniejsze niż śródmieście, bo jasność z góry nie jest jasnością doświadczaną przez mieszkańca.

## Kontrole (skrypt przerywa pracę przy każdej porażce)

1. **Dekoder LZW wobec metadanych GDAL.** Statystyki całego rastra liczone własnym dekoderem (84 201 027 pikseli, 5 s) zgadzają się z zapisanymi w pliku: średnia 1,2149, odchylenie 4,4635, maksimum 815,94, ważnych 70,03%. To niezależny dowód, że LZW, odczyt float32 i nodata działają.
2. **Miejsca znane**: śródmieście ≥ 50, lasy ≤ 15 i ≤ 5 (granice łapią błąd rzędu wielkości, nie wahania roczne).
3. **Zgodność z innymi warstwami** (korelacja rangowa Spearmana, Kraków, n = 70 217): z `ludnosc_1km` +0,735, z `zielen_worldcover_100m` −0,629. Rangowa, bo rozkład ma długi ogon.
4. **Test przesunięcia**: korelacja z ludnością jest największa bez przesunięcia (0,735) i maleje w obie strony (przy 5 px, ok. 300–460 m: 0,69–0,73; przy 10 px: 0,61–0,71), więc raster nie jest przesunięty ani odwrócony. Dopuszczamy maksimum do 5 px od zera.
5. **Testy jednostkowe** czytnika na syntetycznych TIFF-ach i BigTIFF-ach (LZW, Deflate, bez kompresji; krawędzie rastra, kafle puste, odrzucanie nieobsługiwanych wariantów), a po stronie wskaźnika kontrakt, wersja adresów, zgodność opisu z danymi i próbka 400 adresów porównana z rastrem w cache.

## Ograniczenia

- Satelita widzi światło **w górę z oczka**, nie to, co widać z okna. Ciemna ulica obok oświetlonej hali ma tę samą wartość, a hala przemysłowa może świecić mocniej niż rynek.
- Jedna średnia roczna (2023): bez pory roku, godziny, zachmurzenia i księżyca. Roczniki 2024 i późniejsze są u EOG, ale za logowaniem.
- Warstwa jest jedną liczbą na adres, nie na budynek ani piętro.

**Atrybucja:** © Earth Observation Group, Payne Institute for Public Policy, Colorado School of Mines (VIIRS Nighttime Lights VNL v2.2); kopia: © WorldPop, University of Southampton, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.pl), data dostępu 2026-10-03. Przekształcenia: wybór piksela rastra w punkcie adresu, zamiana nodata na brak danych.
