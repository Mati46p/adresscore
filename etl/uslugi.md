# Punkty usług dla trybu „Biznes" (zadanie #104)

Uruchom `node etl/uslugi.mjs` z katalogu projektu (opcje: `--z-ceidg`, `--budzet-ceidg=300`). Skrypt zbiera punkty sześciu branż w Krakowie i obwarzanku z czterech źródeł (CEIDG tylko na żądanie), łączy duplikaty i zapisuje `public/dane/uslugi/katalog.json` oraz po jednym pliku na branżę. To **same punkty**: nie ma tu wskaźników na adres (te liczy #8, #120 i #124). Surowe pobrania leżą w `etl/.cache` (poza gitem), drugi bieg ich nie pobiera. Paczkomaty są poza zakresem (robi je #124).

## Co powstaje

| Plik | Zawartość |
| --- | --- |
| `katalog.json` | branże (mapowanie, zasięg pieszy, licencja i atrybucja per plik), źródła z licencjami i datami, liczby punktów per źródło i po deduplikacji, pokrycie aptek, raport z pobrania CEIDG |
| `<branza>.json` | `sklep_spozywczy`, `apteka`, `fryzjer`, `piekarnia`, `kawiarnia`, `poz`: kolumny `lon`, `lat`, `zr`, `nazwa` (i `flagi` dla fryzjera) |

Format kolumnowy (`kolumny.*` mają równą długość `n`, punkty posortowane rosnąco po szerokości):

| Kolumna | Znaczenie |
| --- | --- |
| `lon`, `lat` | WGS84, 5 miejsc po przecinku (ok. 1 m) |
| `zr` | maska bitowa źródeł punktu: `osm` = 1, `overture` = 2, `rejestr` = 4, `ceidg` = 8 (`bityZrodel` w pliku). Punkt potwierdzony kilkoma źródłami ma sumę bitów |
| `flagi` | tylko `fryzjer`: maska flag branży (`bityFlag`), bit 1 = `barber` |
| `nazwa` | nazwa lokalu albo `null` (brak, albo mogłaby być daną osoby fizycznej) |

Bit `rejestr` znaczy rejestr właściwy dla branży: w `apteka` to Rejestr Aptek, w `poz` to RPWDL. Punkt z samym bitem `ceidg` (8) to wyłącznie adres działalności z CEIDG, **nie potwierdzony lokal**: licząc konkurencję w zasięgu pieszym, front powinien traktować go osobno (np. pokazać oddzielnie albo pominąć).

## Branże i mapowanie

Mapowanie jest danymi w `etl/lib/uslugi-katalog.mjs` (`BRANZE`) i trafia do `katalog.json`. Zasięg pieszy to założenie robocze (ok. 80 m/min, 6–15 minut), do kalibracji w trybie Biznes.

| Branża | Zasięg | OSM | Overture (`taxonomy.primary`) | PKD (CEIDG) |
| --- | --- | --- | --- | --- |
| `sklep_spozywczy` | 500 m | `shop=supermarket`, `convenience`, `greengrocer` | `convenience_store`, `grocery_store` | 47.11.Z |
| `apteka` | 800 m | `amenity=pharmacy` (bez `dispensing=no`) | `pharmacy` | brak (prawda: Rejestr Aptek) |
| `fryzjer` | 800 m | `shop=hairdresser`, `shop=barber`; flaga barber: `hairdresser=barber` | `hair_salon`, `barber`, `hair_stylist`; flaga barber: `barber` | 96.21.Z, 96.02.Z |
| `piekarnia` (piekarnie i cukiernie) | 500 m | `shop=bakery`, `shop=pastry` | `bakery` | 10.71.Z |
| `kawiarnia` | 500 m | `amenity=cafe` | `coffee_shop`, `cafe` | 56.30.Z |
| `poz` | 1200 m | `amenity=doctors`, `clinic` po filtrze POZ | `family_practice`; `doctors_office`, `health_care` po filtrze POZ | brak (prawda: RPWDL) |

Co świadomie pominięto: rzeźnie, delikatesy specjalistyczne, kioski i drogerie (sklep); sklepy ze słodyczami, czyli `shop=confectionery` (piekarnia); bary i kafejki internetowe (kawiarnia); stomatologia i rehabilitacja (POZ). Piekarnia obejmuje też cukiernie, bo Overture (`bakery`) i PKD 10.71.Z nie rozdzielają jednych od drugich.

**Filtr POZ.** OSM i Overture nie odróżniają gabinetu POZ od poradni specjalistycznej (`doctors_office` w Overture to w większości stomatologia, rehabilitacja i medycyna estetyczna). Dla tych dwóch źródeł POZ to: w OSM specjalizacja `general`, `family`, `primary_care`, `paediatrics` lub `internal` (a bez specjalizacji nazwa z „przychodnia", „ośrodek zdrowia", „NZOZ", „SPZOZ", „lekarz rodzinny" i podobnymi); w Overture kategoria `family_practice` albo nazwa o takim wzorze. Nazwa zdradzająca specjalistę, oddział albo izbę przyjęć wyklucza zawsze. RPWDL jest prawdą, więc filtr jest ostrożny: woli pominąć, niż dopisać.

## Źródła i licencje

| Źródło | Licencja | Atrybucja w pliku |
| --- | --- | --- |
| [OpenStreetMap](https://download.geofabrik.de/europe/poland/malopolskie.html), ekstrakt Geofabrik – małopolskie | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/): atrybucja i share-alike | © OpenStreetMap contributors, ODbL |
| [Overture Maps Places](https://docs.overturemaps.org/guides/places/), najnowsze wydanie (STAC `latest`) | CDLA-Permissive-2.0 | Overture Maps Foundation, Places (CDLA-Permissive-2.0) |
| [Rejestr Aptek](https://rejestry.ezdrowie.gov.pl/ra/search/public) (Centrum e-Zdrowia) | dane publiczne rejestru, jawne z mocy ustawy – Prawo farmaceutyczne | Centrum e-Zdrowia, Rejestr Aptek |
| [RPWDL](https://dane.gov.pl/pl/dataset/728,rejestr-podmiotow-wykonujacych-dzialalnosc-lecznicza), komórki „gabinet lekarza POZ" | CC BY 4.0 | Centrum e-Zdrowia, RPWDL (CC BY 4.0) |
| [CEIDG API v3](https://dane.biznes.gov.pl/) | dane jawne CEIDG | Ministerstwo Rozwoju i Technologii, CEIDG |

**ODbL i share-alike.** Plik zawierający punkty z OSM jest bazą pochodną: wolno go publikować z atrybucją „© OpenStreetMap contributors, ODbL" i trzeba zachować licencję ODbL przy dalszym udostępnianiu. Każdy plik branży ma własne pola `licencja` i `atrybucja`, zbudowane z faktycznie użytych źródeł, a `katalog.json` powtarza je per plik. Aplikacja, która pokazuje te punkty, musi wyświetlić atrybucję OSM. Źródła rejestrowe i Overture nie dokładają share-alike. To opis zgodności warunków, nie porada prawna.

## Metoda

1. **OSM**: jeden przebieg po pbf Geofabrik przez DuckDB (`ST_ReadOSM`), węzły i środki zamkniętych linii (budynki). Relacji (multipolygonów) nie czytamy. Obiekty z `disused:*`, `abandoned:*` i `was:*` odpadają. Nazwa to `name`, a bez niej `brand`. Własne zapytanie w `etl/lib/uslugi-osm.mjs`; wspólny z #8 i #124 jest tylko plik `etl/.cache/malopolskie.osm.pbf` (obok niego `.stan` z datą ekstraktu).
2. **Overture**: ekstrakt całego BBOX z S3 (DuckDB, `httpfs`) do `etl/.cache/overture-places-<wydanie>-<skrót bbox>.parquet`, potem filtr lokalny: `confidence >= 0.7` oraz `operating_status` pusty albo `open`. W wydaniu 2026-09-23.1 status ma tylko ok. 2% miejsc, więc wymóg „open" odrzuciłby 98% danych; wyklucza się wyłącznie jawnie zamknięte. Kategoria to `taxonomy.primary` (pola `categories` już nie ma). Wydanie można przypiąć zmienną `OVERTURE_WYDANIE`.
3. **Rejestry**: `apteki()` i `przychodniePoz()` z #8 (adresy geokodowane usługą GUGiK UUG), bez zmian w `etl/lib/codziennosc-*.mjs`.
4. **Deduplikacja w obrębie branży** (`etl/lib/uslugi-dedup.mjs`): dwa punkty to jeden lokal, gdy dzieli je mniej niż 30 m i nazwy są podobne, albo mniej niż 15 m, gdy któraś nazwa jest nieznana (CEIDG nazwy nie niesie nigdy; nazwa złożona z samych słów ogólnych, np. „Sklep spożywczy", też liczy się jako nieznana). Podobne nazwy to: wszystkie istotne słowa krótszej zawarte w dłuższej (z tolerancją literówek w słowach od 6 znaków) albo podobieństwo bigramów co najmniej 0,8. Punkty są łączone zachłannie w kolejności źródeł OSM, Overture, rejestr, CEIDG, więc wynik nie zależy od kolejności wejścia, a współrzędne wspólnego punktu bierze najlepiej położone źródło. Źródła punktu łączą się w sumę bitów `zr`.
5. **Apteka**: prawdą jest Rejestr Aptek. Do pliku trafiają tylko punkty z bitem `rejestr`; OSM i Overture dopisują bity, jeśli widać tę samą aptekę, a reszta służy do kontroli pokrycia (`pokrycie` w `katalog.json`: miara ścisła, jak w deduplikacji, i luźna, każdy punkt rejestru w promieniu 100 m, bo adres z rejestru i punkt w OSM potrafią dzielić kilkadziesiąt metrów w dużym budynku).
6. **Strażnik**: ETL kończy się błędem, gdy któraś branża ma mniej punktów niż `minPunktow` z katalogu, gdy któreś źródło dało mniej punktów niż `minZrodel` (żeby zerowy OSM nie ukrył się za Overture), gdy kolumny mają różne długości, punkt leży poza obszarem albo punkt tylko z CEIDG ma nazwę. Zero wyników ma być sygnałem awarii źródła, nie pustym plikiem. CEIDG jest poza strażnikami, bo to uzupełnienie, które wolno pominąć.

## CEIDG: uzupełnienie z budżetem i bez danych osobowych

**Domyślnie wyłączone (decyzja właściciela 2026-10-03):** adres z CEIDG to często adres domowy właściciela firmy, więc punkty wprowadzały szum do konkurencji. Kod zostaje za flagą `--z-ceidg` do pomiarów, pliki w `public/dane/uslugi` są bez CEIDG.

CEIDG zna jednoosobowe działalności z kodem PKD, ale **nie wie, gdzie jest lokal**: adres działalności bywa domowy albo wirtualny. Dlatego punkty tylko z CEIDG są uzupełnieniem i mają własny bit.

- **Budżet.** Limit API (1000/h) dzielimy z innym projektem, więc ETL wysyła łącznie najwyżej 300 zapytań (`--budzet-ceidg`), a licznik leży w `etl/.cache/ceidg/zuzycie.json` i przeżywa kolejne biegi. Odpowiedzi są w cache (jedna strona = jeden plik), drugi bieg nie pyta ponownie. ETL przestaje też pytać, gdy w oknie godzinnym zostanie mniej niż 500 zapytań (nagłówek `x-rate-limit-remaining`). Odmowa API (401, 403, 429), brak tokenu albo błąd sieci kończą pobieranie z logiem; reszta warstwy powstaje bez CEIDG.
- **Token** z `CEIDG_TOKEN`: zmienna środowiska, `.env.local` w katalogu projektu albo w głównym checkoucie (worktree go nie ma; ścieżkę daje `git rev-parse --git-common-dir`). Tylko ETL, nigdy front.
- **Zapytania.** Pary PKD × obszar (Kraków po `miasto`, 13 gmin obwarzanka po `gmina`), `status=AKTYWNY`, strona 25 wpisów (większa daje błąd). Pierwsza strona każdej pary daje liczebność. API sortuje malejąco po dacie rozpoczęcia, więc ucięcie liczby stron oznacza najnowsze wpisy. Gminy obwarzanka są pobrane w całości; w Krakowie fryzjerzy (96.21.Z) i piekarnie w całości, a duże PKD (sklepy 47.11.Z, kawiarnie 56.30.Z i starszy kod 96.02.Z) częściowo, od najnowszych. Co do wpisu pobrano i jak głęboko, mówi `zrodla.ceidg.pary` w `katalog.json`.
- **PKD 2025.** Od 2025-01-01 nowe wpisy mają kod 96.21.Z (fryzjerstwo i barber) i 96.22.Z (kosmetyka), a stary 96.02.Z (fryzjerstwo razem z kosmetyką) nie jest już nadawany. Pod 96.02.Z prawie nie ma wpisów z 2025 i 2026, więc fryzjerów szukamy pod 96.21.Z i, dla starszych wpisów, pod 96.02.Z. Kody sklepu, piekarni i kawiarni nie zmieniły się.
- **Dane osobowe.** Z odpowiedzi API na dysk (także do cache) trafia wyłącznie adres działalności, status i rok rozpoczęcia. Nazwa firmy, właściciel, NIP, REGON i identyfikator są odcinane w `zredukujFirme`, zanim cokolwiek zostanie zapisane. Adres jest geokodowany usługą UUG, a do plików idzie tylko punkt, branża (przez plik) i bit źródła, bez nazwy. Test `etl/uslugi.test.mjs` przepuszcza rekord z nazwą, nazwiskiem, NIP i REGON przez całą ścieżkę i sprawdza, że nic z tego nie ma w wyniku. Zostaje ryzyko, że adres działalności firmy jednoosobowej bywa adresem zamieszkania; punkt ma dokładność budynku.
- **Nazwy w plikach.** Nazwa lokalu pochodzi tylko z OSM, Overture i rejestrów, nigdy z CEIDG. Nazwy wyglądające na osobę fizyczną (tytuł z nazwiskiem, „indywidualna praktyka", popularne imię obok nazwiska) są zamieniane na `null`. To heurystyka: samo nazwisko albo nietypowe imię przejdą.

## Kontrola wyniku (bieg z 2026-10-03)

**Uwaga:** tabela i opis CEIDG niżej pochodzą z pierwszego biegu z CEIDG (2026-10-03). Bieżące liczby bez CEIDG: sklep 2619, apteka 431, fryzjer 1063, piekarnia 764, kawiarnia 836, POZ 394 (cały prostokąt `BBOX`), źródło prawdy to `katalog.json`.

Stany źródeł: OSM 2026-10-02, Overture 2026-09-23.1 (55 836 miejsc w obszarze), Rejestr Aptek pobrany 2026-10-03 (1085 aktywnych w Małopolsce, adres znaleziono dla 1061), RPWDL ze stanem 2026-10-02 (793 komórki POZ, adres dla 765), CEIDG pobrany 2026-10-03. Liczby to punkty w całym obszarze (prostokąt `BBOX`). „Bez samego CEIDG" to rdzeń do liczenia konkurencji, bez punktów z wyłącznie adresem z CEIDG.

| Branża | OSM | Overture | Rejestr | CEIDG | Po deduplikacji (w pliku) | Bez samego CEIDG | ≥ 2 źródła |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sklep_spozywczy` | 2128 | 1273 | – | 1795 | 3923 | 2619 | 898 |
| `apteka` | 477 | 211 | 431 | – | 431 (z 638 klastrów, reszta nie ma rejestru) | 431 | 328 |
| `fryzjer` | 704 | 498 | – | 1860 | 2337 | 1063 | 362 |
| `piekarnia` | 605 | 254 | – | 536 | 1226 | 764 | 134 |
| `kawiarnia` | 519 | 536 | – | 1559 | 2206 | 836 | 267 |
| `poz` | 139 | 24 | 306 | – | 394 | 394 | 52 |

Podział wg obszaru (najbliższy adres z `adresy.json` w promieniu 400 m; rdzeń + punkty tylko z CEIDG):

| Branża | Kraków | Obwarzanek (13 gmin) | Poza gminami (margines prostokąta) |
| --- | --- | --- | --- |
| `sklep_spozywczy` | 1526 + 620 | 516 + 684 | 577 |
| `apteka` | 252 | 72 | 107 |
| `fryzjer` | 850 + 673 | 127 + 601 | 86 |
| `piekarnia` | 624 + 320 | 84 + 142 | 56 |
| `kawiarnia` | 702 + 823 | 76 + 547 | 58 |
| `poz` | 227 | 70 | 97 |

**Pokrycie aptek.** Rejestr ma 431 aptek w obszarze (252 w Krakowie). OSM widzi 74% z nich w mierze ścisłej i 94% w luźnej (punkt w promieniu 100 m); Overture 22% i 37%. Odwrotnie: 87% punktów OSM i 81% punktów Overture ma w promieniu 100 m aptekę z rejestru, reszta to prawdopodobnie apteki zamknięte, szpitalne albo takie, których adres z rejestru nie został geokodowany (24 z 1085 aktywnych wpisów); nie sprawdzano tego punkt po punkcie. Szczegóły w `katalog.json`, pole `pokrycie` branży `apteka`.

**CEIDG.** Zużyto 295 z limitu 300 zapytań (okno godzinne wciąż miało ponad 700). Pobrano 6122 wpisów, adres znaleziono dla 5754 (94%), do plików trafiło 5750 punktów, po deduplikacji 1304 + 1274 + 462 + 1370 = 4410 z nich jest jedynym źródłem punktu. Z 70 par PKD × obszar 67 jest kompletnych (wszystkie gminy obwarzanka, w Krakowie 96.21.Z i piekarnie). Niepełne są trzy pary w Krakowie, pobrane od najnowszych wpisów: sklepy 1050 z 2560 (wpisy z lat 2016–2026), kawiarnie 1050 z 2304 (2017–2026), starszy kod fryzjerów 96.02.Z 300 z 1740 (2022–2025). Od 12% (kawiarnie, piekarnie) do 24% (sklepy) punktów tylko z CEIDG leży w promieniu 60 m od lokalu z OSM albo Overture (fryzjerzy: 250 z 1274), więc część to prawdopodobnie ten sam lokal geokodowany inaczej; reszta leży dalej, we fryzjerach 70% ponad 100 m od najbliższego lokalu z innego źródła.

## Ograniczenia

- Obszar to prostokąt Kraków + obwarzanek z marginesem ok. 3 km (`BBOX` z #8), nie granice gmin: punkty tuż za granicą gminy są w plikach celowo. Kraków od reszty odróżnia dopiero front (np. po najbliższym adresie).
- Punkt to pozycja z rejestru, OSM albo Overture, nie wejście do lokalu. Plik nie niesie godzin otwarcia ani informacji, że lokal czynny dziś.
- Deduplikacja nie łączy punktów o różnych nazwach, nawet bardzo bliskich (np. ten sam salon pod nazwą właściciela w Overture i pod marką w OSM), więc liczby w branżach z drobnymi lokalami (fryzjer, kawiarnia) mogą być nieco zawyżone.
- Overture i OSM różnią się od rejestru nazwami (nazwa prawna a marka), więc ścisłe dopasowanie aptek jest niższe niż luźne.
- Zasięgi piesze są założeniem, nie pomiarem czasu dojścia.

## Aktualizacja

Zmiana mapowania w katalogu nie wymaga nowych pobrań (OSM i Overture są w cache w surowej postaci szerszej niż katalog; cache OSM unieważnia się razem ze zmianą kluczy i selektorów). Nowy ekstrakt: usuń `etl/.cache/malopolskie.osm.pbf` (i `.stan`) albo nowszy parquet Overture pojawi się sam przy nowym wydaniu. Odświeżenie CEIDG: usuń `etl/.cache/ceidg` (razem z licznikiem; pamiętaj o limicie godzinnym).
