# Punkty usług dla trybu „Biznes" (zadania #104 i #160)

Uruchom `node etl/uslugi.mjs` z katalogu projektu (opcje: `--z-ceidg`, `--budzet-ceidg=300`). Skrypt zbiera punkty 17 branż w Krakowie i obwarzanku z czterech źródeł punktów (CEIDG tylko na żądanie), a z NFZ bierze wyłącznie flagę `nfz` dentysty. Łączy duplikaty i zapisuje `public/dane/uslugi/katalog.json` oraz po jednym pliku na branżę. Sześć branż to #104 (sklep, apteka, fryzjer, piekarnia, kawiarnia, POZ), jedenaście kolejnych to #160 (dentysta, fizjoterapia, laboratorium, siłownia, weterynarz, restauracja, warsztat, myjnia, salon kosmetyczny, kwiaciarnia, optyk). To **same punkty**: nie ma tu wskaźników na adres (te liczy #8, #120 i #124). Surowe pobrania leżą w `etl/.cache` (poza gitem), drugi bieg ich nie pobiera. Paczkomaty są poza zakresem (robi je #124).

## Co powstaje

| Plik | Zawartość |
| --- | --- |
| `katalog.json` | branże (mapowanie, zasięg pieszy, licencja i atrybucja per plik), źródła z licencjami i datami, liczby punktów per źródło, po deduplikacji i z flagą (`liczby.zFlaga`), pokrycie względem rejestru (apteka, dentysta, fizjoterapia, laboratorium), kontrola flagi NFZ (`zrodla.nfz`), raport z pobrania CEIDG |
| `<branza>.json` | po jednym pliku na branżę (`sklep_spozywczy`, `apteka`, `fryzjer`, `piekarnia`, `kawiarnia`, `poz`, `dentysta`, `fizjoterapia`, `laboratorium`, `silownia`, `weterynarz`, `restauracja`, `warsztat`, `myjnia`, `salon_kosmetyczny`, `kwiaciarnia`, `optyk`): kolumny `lon`, `lat`, `zr`, `nazwa` (i `flagi` dla branż z flagami) |

Format kolumnowy (`kolumny.*` mają równą długość `n`, punkty posortowane rosnąco po szerokości):

| Kolumna | Znaczenie |
| --- | --- |
| `lon`, `lat` | WGS84, 5 miejsc po przecinku (ok. 1 m) |
| `zr` | maska bitowa źródeł punktu: `osm` = 1, `overture` = 2, `rejestr` = 4, `ceidg` = 8 (`bityZrodel` w pliku). Punkt potwierdzony kilkoma źródłami ma sumę bitów |
| `flagi` | tylko branże z flagami: maska flag branży (`bityFlag` w pliku, kolejność flag to kolejność bitów). `fryzjer`: bit 1 = `barber`; `dentysta`: bit 1 = `nfz` (miejsce jest w Informatorze o Terminach Leczenia NFZ); `restauracja`: bit 1 = `fast_food` |
| `nazwa` | nazwa lokalu albo `null` (brak, albo mogłaby być daną osoby fizycznej) |

Bit `rejestr` znaczy rejestr właściwy dla branży: w `apteka` to Rejestr Aptek, w `poz`, `dentysta`, `fizjoterapia` i `laboratorium` to RPWDL. Punkt z samym bitem `ceidg` (8) to wyłącznie adres działalności z CEIDG, **nie potwierdzony lokal**: licząc konkurencję w zasięgu pieszym, front powinien traktować go osobno (np. pokazać oddzielnie albo pominąć).

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
| `dentysta` | 1000 m | `amenity=dentist`, `healthcare=dentist` | `dental_clinic`, `general_dentistry`, `pediatric_dentistry`, `orthodontics`, `cosmetic_dentistry` | brak (rejestr: RPWDL 1800, 1801, 1820, 1830, 1840) |
| `fizjoterapia` | 1000 m | `healthcare=physiotherapist`, `healthcare=rehabilitation` | `physical_therapy` | brak (rejestr: RPWDL 1300, 1310, 1320) |
| `laboratorium` (punkt pobrań i laboratorium) | 1500 m | `healthcare=laboratory`, `healthcare=sample_collection` | `b2b_clinical_lab`, `laboratory_testing` po filtrze `lab` | brak (rejestr: RPWDL 7100, 7110) |
| `silownia` | 1000 m | `leisure=fitness_centre` | `gym` | brak |
| `weterynarz` | 1500 m | `amenity=veterinary` | `veterinarian` | brak |
| `restauracja` (restauracja i fast food) | 500 m | `amenity=restaurant`, `amenity=fast_food`; flaga `fast_food`: `amenity=fast_food` | `restaurant`, każda `*_restaurant`, `steakhouse`, `diner`, `bistro`, `sandwich_shop`; flaga `fast_food`: `fast_food_restaurant`, `burger_restaurant`, `doner_kebab_restaurant`, `hot_dog_restaurant`, `sandwich_shop` | brak |
| `warsztat` | 1500 m | `shop=car_repair` | `automotive_repair`, `auto_body_shop` | brak |
| `myjnia` | 2000 m | `amenity=car_wash` | `car_wash` po filtrze `myjnia` | brak |
| `salon_kosmetyczny` | 800 m | `shop=beauty` | `beauty_salon`, `nail_salon`, `skin_care_and_makeup` | brak |
| `kwiaciarnia` | 800 m | `shop=florist` | `flowers_and_gifts_store`, `florist` | brak |
| `optyk` | 800 m | `shop=optician` | `eyewear_store` | brak |

Co świadomie pominięto: rzeźnie, delikatesy specjalistyczne, kioski i drogerie (sklep); sklepy ze słodyczami, czyli `shop=confectionery` (piekarnia); bary i kafejki internetowe (kawiarnia); stomatologia i rehabilitacja (POZ). Piekarnia obejmuje też cukiernie, bo Overture (`bakery`) i PKD 10.71.Z nie rozdzielają jednych od drugich.

**Branże z #160: co świadomie pominięto.** Dentysta: pracownie protetyki i technicy dentystyczni (RPWDL 8100, `craft=dental_technician`, Overture `b2b_dental_lab`) oraz poradnie periodontologiczne (RPWDL 1810, 45 czynnych komórek w Małopolsce, poza listą kodów z #160). Fizjoterapia: masaże (`shop=massage`, `massage_therapy`), osteopatia i chiropraktyka. Laboratorium: laboratoria badawcze i budowlane (odpadają na filtrze `lab`). Siłownia: siłownie plenerowe (`leisure=fitness_station`, robi je #159), trenerzy personalni, joga, sztuki walki i `sport_or_fitness_facility`. Restauracja: bary, puby, kawiarnie, food courty i food trucki, hurt i wyposażenie gastronomii. Warsztat: wulkanizacje (`shop=tyres`, `tire_dealer_and_repair`), warsztaty motocyklowe i detailing. Salon kosmetyczny: Overture `spa` (miesza salony fryzjerskie), solaria i drogerie. Optyk: `optometry` (gabinety okulistów) i sklepy z okularami przeciwsłonecznymi.

**Rozszerzenia względem tabeli z zadania #160.** Fizjoterapia bierze też OSM `healthcare=rehabilitation` (13 obiektów w obszarze, w większości gabinety i centra rehabilitacji). Salon kosmetyczny bierze w Overture `nail_salon` (w OSM paznokcie to też `shop=beauty`) i `skin_care_and_makeup` (kosmetolodzy, 237 miejsc z `confidence` ≥ 0,7). Warsztat bierze Overture `auto_body_shop` (blacharze i lakiernicy). Dentysta bierze OSM `healthcare=dentist` obok `amenity=dentist` (3 dodatkowe obiekty), a Overture `dental_clinic` i cztery kategorie specjalizacji. Myjnia ma także Overture `car_wash`, mimo że zadanie podawało tylko OSM.

**Kategorie Overture z gwiazdką.** W wydaniu 2026-09-23.1 restauracje mają kategorię według kuchni (`pizza_restaurant`, `polish_restaurant` i 72 inne `*_restaurant`), a samo `restaurant` to 560 z 2092 miejsc o `confidence` ≥ 0,7. Reguła `*_restaurant` w katalogu bierze każdą kategorię z takim zakończeniem, także nową w kolejnych wydaniach (wstępny filtr SQL używa `ends_with`). `restaurant_equipment_and_supply` i `restaurant_wholesale` nie pasują, bo `restaurant` jest w nich przedrostkiem.

**Filtry `lab` i `myjnia`.** W Overture kategoria `car_wash` zawiera paczkomaty i stacje paliw (np. „ORLEN Paczka": 12 z 91 miejsc), a `laboratory_testing` obok ALAB i Diagnostyki także laboratoria budowlane i paczkomaty. Filtr `myjnia` odrzuca nazwy z „paczk" i „stacja paliw". Filtr `lab` przepuszcza nazwy z „laborat", „diagnost", „pobra", „badan", „genet", „medyczn" i podobnymi, a odrzuca „budown", „paczk" i „stacja paliw". Oba filtry działają tylko na Overture (OSM `car_wash` i `healthcare=laboratory` są czyste) i, jak filtr POZ, wolą pominąć, niż dopisać.

**Filtr POZ.** OSM i Overture nie odróżniają gabinetu POZ od poradni specjalistycznej (`doctors_office` w Overture to w większości stomatologia, rehabilitacja i medycyna estetyczna). Dla tych dwóch źródeł POZ to: w OSM specjalizacja `general`, `family`, `primary_care`, `paediatrics` lub `internal` (a bez specjalizacji nazwa z „przychodnia", „ośrodek zdrowia", „NZOZ", „SPZOZ", „lekarz rodzinny" i podobnymi); w Overture kategoria `family_practice` albo nazwa o takim wzorze. Nazwa zdradzająca specjalistę, oddział albo izbę przyjęć wyklucza zawsze. RPWDL jest prawdą, więc filtr jest ostrożny: woli pominąć, niż dopisać.

## Źródła i licencje

| Źródło | Licencja | Atrybucja w pliku |
| --- | --- | --- |
| [OpenStreetMap](https://download.geofabrik.de/europe/poland/malopolskie.html), ekstrakt Geofabrik – małopolskie | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/): atrybucja i share-alike | © OpenStreetMap contributors, ODbL |
| [Overture Maps Places](https://docs.overturemaps.org/guides/places/), najnowsze wydanie (STAC `latest`) | CDLA-Permissive-2.0 | Overture Maps Foundation, Places (CDLA-Permissive-2.0) |
| [Rejestr Aptek](https://rejestry.ezdrowie.gov.pl/ra/search/public) (Centrum e-Zdrowia) | dane publiczne rejestru, jawne z mocy ustawy – Prawo farmaceutyczne | Centrum e-Zdrowia, Rejestr Aptek |
| [RPWDL](https://dane.gov.pl/pl/dataset/728,rejestr-podmiotow-wykonujacych-dzialalnosc-lecznicza), komórki „gabinet lekarza POZ" oraz komórki z kodami dentysty, fizjoterapii i laboratorium | CC BY 4.0 | Centrum e-Zdrowia, RPWDL (CC BY 4.0) |
| [NFZ – Informator o Terminach Leczenia](https://api.nfz.gov.pl/app-itl-api/) (API Terminy Leczenia), tylko flaga `nfz` dentysty | CC BY 4.0 (metadane zbioru [1455](https://dane.gov.pl/pl/dataset/1455,informator-o-terminach-leczenia) na dane.gov.pl); regulamin API: wskazanie źródła, zakaz modyfikowania danych | Narodowy Fundusz Zdrowia, Informator o Terminach Leczenia (https://api.nfz.gov.pl/), w pliku `dentysta` |
| [CEIDG API v3](https://dane.biznes.gov.pl/) | dane jawne CEIDG | Ministerstwo Rozwoju i Technologii, CEIDG |

**ODbL i share-alike.** Plik zawierający punkty z OSM jest bazą pochodną: wolno go publikować z atrybucją „© OpenStreetMap contributors, ODbL" i trzeba zachować licencję ODbL przy dalszym udostępnianiu. Każdy plik branży ma własne pola `licencja` i `atrybucja`, zbudowane z faktycznie użytych źródeł, a `katalog.json` powtarza je per plik. Aplikacja, która pokazuje te punkty, musi wyświetlić atrybucję OSM. Źródła rejestrowe i Overture nie dokładają share-alike. To opis zgodności warunków, nie porada prawna.

**NFZ: regulamin i co z niego zapisujemy (sprawdzone 2026-10-03).** Regulamin API Terminy Leczenia (`https://api.nfz.gov.pl/app-itl-api/terms`) wymaga wskazania źródła `https://api.nfz.gov.pl/`, zakazuje modyfikowania danych i przeciążania API (10 zapytań na sekundę z jednego adresu IP). Ponownego udostępniania danych nie zakazuje, a metadane zbioru na dane.gov.pl podają CC BY 4.0. Mimo to do plików trafia **wyłącznie flaga**: jeden bit przy punktach dentysty, bez nazw świadczeniodawców, adresów, współrzędnych, terminów i liczby oczekujących. Źródło jest w atrybucji i licencji pliku `dentysta` oraz w `zrodla.nfz` w `katalog.json`. Cache w `etl/.cache` (poza gitem) trzyma wpisy zredukowane do położenia miejsca, bez nazw świadczeniodawców, NIP, REGON i telefonów. Flaga mówi, że miejsce widnieje w Informatorze, czyli ma umowę z NFZ na świadczenia stomatologiczne; **brak flagi nie dowodzi braku umowy** (znaczy tylko, że miejsca nie ma w Informatorze albo nie dopasowano go do punktu).

## Metoda

1. **OSM**: jeden przebieg po pbf Geofabrik przez DuckDB (`ST_ReadOSM`), węzły i środki zamkniętych linii (budynki). Relacji (multipolygonów) nie czytamy. Obiekty z `disused:*`, `abandoned:*` i `was:*` odpadają. Nazwa to `name`, a bez niej `brand`. Własne zapytanie w `etl/lib/uslugi-osm.mjs`; wspólny z #8 i #124 jest tylko plik `etl/.cache/malopolskie.osm.pbf` (obok niego `.stan` z datą ekstraktu).
2. **Overture**: ekstrakt całego BBOX z S3 (DuckDB, `httpfs`) do `etl/.cache/overture-places-<wydanie>-<skrót bbox>.parquet`, potem filtr lokalny: `confidence >= 0.7` oraz `operating_status` pusty albo `open`. W wydaniu 2026-09-23.1 status ma tylko ok. 2% miejsc, więc wymóg „open" odrzuciłby 98% danych; wyklucza się wyłącznie jawnie zamknięte. Kategoria to `taxonomy.primary` (pola `categories` już nie ma). Wydanie można przypiąć zmienną `OVERTURE_WYDANIE`.
3. **Rejestry**: `apteki()` i `przychodniePoz()` z #8 (adresy geokodowane usługą GUGiK UUG), bez zmian w `etl/lib/codziennosc-*.mjs`. Dentysta, fizjoterapia i laboratorium (#160) czytają te same pliki RPWDL (`etl/.cache/rpwdl`, przygotowuje je `przychodniePoz()`) w `etl/lib/uslugi-rpwdl.mjs`: czynne komórki Małopolski (TERYT 12…) z numerem budynku i kodem resortowym VIII części z katalogu (`kodyRpwdl`), bez zakończonych, zawieszonych i jeszcze niezaczętych. Nazwa to nazwa zakładu, jak przy POZ; adres geokoduje ta sama `geokoduj()` co w #8.
4. **Deduplikacja w obrębie branży** (`etl/lib/uslugi-dedup.mjs`): dwa punkty to jeden lokal, gdy dzieli je mniej niż 30 m i nazwy są podobne, albo mniej niż 15 m, gdy któraś nazwa jest nieznana (CEIDG nazwy nie niesie nigdy; nazwa złożona z samych słów ogólnych, np. „Sklep spożywczy", też liczy się jako nieznana). Podobne nazwy to: wszystkie istotne słowa krótszej zawarte w dłuższej (z tolerancją literówek w słowach od 6 znaków) albo podobieństwo bigramów co najmniej 0,8. Punkty są łączone zachłannie w kolejności źródeł OSM, Overture, rejestr, CEIDG, więc wynik nie zależy od kolejności wejścia, a współrzędne wspólnego punktu bierze najlepiej położone źródło. Źródła punktu łączą się w sumę bitów `zr`.
5. **Apteka**: prawdą jest Rejestr Aptek. Do pliku trafiają tylko punkty z bitem `rejestr`; OSM i Overture dopisują bity, jeśli widać tę samą aptekę, a reszta służy do kontroli pokrycia (`pokrycie` w `katalog.json`: miara ścisła, jak w deduplikacji, i luźna, każdy punkt rejestru w promieniu 100 m, bo adres z rejestru i punkt w OSM potrafią dzielić kilkadziesiąt metrów w dużym budynku).
6. **Strażnik**: ETL kończy się błędem, gdy któraś branża ma mniej punktów niż `minPunktow` z katalogu, gdy któreś źródło dało mniej punktów niż `minZrodel` (żeby zerowy OSM nie ukrył się za Overture), gdy flaga z osobnego źródła ma mniej punktów niż `minFlag` (dentysta: 75 punktów z `nfz`, bo brak odpowiedzi API dałby plik bez flag i bez błędu), gdy kolumny mają różne długości, punkt leży poza obszarem albo punkt tylko z CEIDG ma nazwę. Zero wyników ma być sygnałem awarii źródła, nie pustym plikiem. CEIDG jest poza strażnikami, bo to uzupełnienie, które wolno pominąć. Strażnicy branż z #160 to ok. 50% pomiaru z 2026-10-03.
7. **Flaga `nfz` dentysty** (`etl/lib/uslugi-nfz.mjs`). API Terminy Leczenia, województwo `06` (Małopolski Oddział Wojewódzki NFZ), przypadek stabilny (`case=1`; przypadek pilny daje te same wpisy: 634 z 634 par świadczeniodawca–komórka jest w obu), świadczenia o nazwie zawierającej „stomatolog" (poradnie stomatologiczne, dla dzieci, chirurgii i protetyki) oraz „ortodon". Wpisy łączą się w miejsca (miejscowość, adres, współrzędne). Każde miejsce ma do dwóch pozycji: własne współrzędne NFZ (podaje je 71% miejsc) i adres geokodowany usługą UUG (dopasowanie „po adresie": ta sama usługa co adresy RPWDL, więc ten sam adres daje ten sam punkt). Dwie, bo współrzędne NFZ bywają błędne (do 305 km od adresu), a UUG nie zna części adresów. Miejsce flaguje **jeden** punkt dentysty w promieniu 50 m od którejkolwiek pozycji: najbliższy punkt z rejestru (świadczeniodawca z umową jest zawsze w RPWDL), a gdy rejestru w pobliżu nie ma – najbliższy w ogóle. Jeden, bo kilka gabinetów w budynku nie ma umowy tylko dlatego, że ma ją sąsiad. Flaga trafia na punkty wejściowe przed deduplikacją, więc przechodzi na cały klaster (także na punkty OSM i Overture tego samego gabinetu).

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

## Branże z #160: kontrola wyniku (bieg z 2026-10-03)

Stany źródeł: OSM 2026-10-02, Overture 2026-09-23.1, RPWDL 2026-10-02 (czynne komórki Małopolski z kodami: dentysta 1477, adres znaleziono dla 1438; fizjoterapia 1270 i 1222; laboratorium 842 i 813), NFZ pobrany 2026-10-03 (okres sprawozdawczy 2026-08 do 2026-09). Liczby to punkty w całym prostokącie `BBOX`; liczby z zadania #160 dotyczyły samego Krakowa i OSM bez `healthcare=dentist`, rehabilitacji i kategorii Overture z gwiazdką, więc nie są wprost porównywalne. Podział na obszary robi `node etl/uslugi-podzial.mjs` (najbliższy adres z `adresy.json` w promieniu 400 m; bez adresu to margines).

| Branża | OSM | Overture | Rejestr (RPWDL) | Po deduplikacji (w pliku) | Kraków | Obwarzanek (13 gmin) | Margines | ≥ 2 źródła | Strażnik (`minPunktow`) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dentysta` | 267 | 259 | 758 (497 punktów) | 813 | 592 | 111 | 110 | 167 | 400 |
| `fizjoterapia` | 57 | 166 | 593 (414) | 590 | 430 | 83 | 77 | 44 | 295 |
| `laboratorium` | 53 | 51 | 462 (381) | 421 | 300 | 61 | 60 | 53 | 210 |
| `silownia` | 131 | 294 | – | 391 | 286 | 58 | 47 | 34 | 195 |
| `weterynarz` | 121 | 146 | – | 209 | 134 | 44 | 31 | 56 | 105 |
| `restauracja` | 2106 | 2092 | – | 3160 | 2468 | 363 | 329 | 987 | 1580 |
| `warsztat` | 396 | 586 | – | 927 | 558 | 206 | 163 | 50 | 460 |
| `myjnia` | 260 | 75 | – | 310 | 169 | 78 | 63 | 14 | 155 |
| `salon_kosmetyczny` | 450 | 826 | – | 1191 | 936 | 140 | 115 | 83 | 595 |
| `kwiaciarnia` | 271 | 257 | – | 436 | 262 | 88 | 86 | 69 | 218 |
| `optyk` | 144 | 101 | – | 209 | 164 | 27 | 18 | 35 | 105 |

Kolumna „Rejestr" podaje komórki RPWDL w obszarze, a w nawiasie punkty po deduplikacji (komórki tego samego zakładu pod jednym adresem to jeden punkt). Flagi: `nfz` ma 155 punktów dentysty (76 w Krakowie), `fast_food` 1081 punktów restauracji (901 w Krakowie), `barber` bez zmian. Strażnicy per źródło (`minZrodel`) i `minFlag` są w katalogu i w `katalog.json`.

### Pokrycie RPWDL a OSM i Overture (dentysta, fizjoterapia, laboratorium)

Dwie miary jak przy aptekach: ścisła (ta sama deduplikacja co w pliku: do 30 m i podobna nazwa) i luźna (jakikolwiek punkt w promieniu 100 m). Rejestr jest tu źródłem kontrolnym, nie filtrem: plik zawiera także punkty tylko z OSM i Overture (w przeciwieństwie do apteki).

| Branża | Źródło | Punkty rejestru widoczne w źródle: ściśle | luźno | Punkty źródła mające rejestr: ściśle | luźno |
| --- | --- | --- | --- | --- | --- |
| `dentysta` | OSM | 85 z 497 (17,1%) | 258 z 758 (34,0%) | 85 z 266 (32,0%) | 159 z 267 (59,6%) |
| `dentysta` | Overture | 89 z 497 (17,9%) | 264 z 758 (34,8%) | 89 z 258 (34,5%) | 168 z 259 (64,9%) |
| `fizjoterapia` | OSM | 10 z 414 (2,4%) | 35 z 593 (5,9%) | 10 z 57 (17,5%) | 23 z 57 (40,4%) |
| `fizjoterapia` | Overture | 31 z 414 (7,5%) | 105 z 593 (17,7%) | 31 z 165 (18,8%) | 71 z 166 (42,8%) |
| `laboratorium` | OSM | 32 z 381 (8,4%) | 63 z 462 (13,6%) | 32 z 53 (60,4%) | 50 z 53 (94,3%) |
| `laboratorium` | Overture | 28 z 381 (7,3%) | 68 z 462 (14,7%) | 28 z 51 (54,9%) | 45 z 51 (88,2%) |

- **Dentysta.** Rejestr ma 497 punktów, OSM 266 i Overture 258, więc bez RPWDL plik zawierałby ok. połowy gabinetów. Tylko 17% punktów rejestru ma w OSM gabinet o podobnej nazwie, a 34% jakikolwiek punkt OSM w 100 m; odwrotnie, 60% punktów OSM ma w 100 m komórkę rejestru, a 181 punktów OSM nie ma rejestru w klastrze. Powody nie były badane punkt po punkcie (nazwa prawna z rejestru rzadko jest nazwą gabinetu z OSM, ale możliwe są też gabinety pod innym kodem resortowym i adresy z rejestru geokodowane w inne miejsce budynku).
- **Fizjoterapia.** Rejestr ma 7 razy więcej punktów niż OSM (414 wobec 57) i 2,5 raza więcej niż Overture (165). Rejestr obejmuje też działy i pracownie fizjoterapii w szpitalach i przychodniach (kody 1310, 1320, 1300), więc nie każdy jego punkt to gabinet przyjmujący z ulicy.
- **Laboratorium.** Zgodność OSM i Overture z rejestrem jest wysoka (94% i 88% punktów ma komórkę RPWDL w 100 m), ale widzą one tylko 14 do 15% punktów rejestru.

### Flaga `nfz` dentysty

| Miara | Wynik |
| --- | --- |
| Wpisy w Informatorze (Małopolska, przypadek stabilny; „stomatolog" 634, „ortodon" 74) | 708 wpisów, 29 zapytań |
| Unikalne miejsca (miejscowość, adres, współrzędne) | 538: 380 z własnymi współrzędnymi NFZ, 498 z adresem znalezionym w UUG, 18 bez żadnej pozycji |
| Miejsca w obszarze (prostokąt `BBOX`) | 176 |
| Dopasowane do punktu dentysty w 50 m | 162 (92%): 158 do punktu rejestru, 4 do punktu OSM bez rejestru |
| Bez dopasowania | 14 (w 50 m od ich pozycji nie leży żaden punkt dentysty) |
| Punkty dentysty z flagą | 155 z 813 (19%), w Krakowie 76 z 592 |
| Zgodność dwóch pozycji (NFZ i adres UUG) | z 358 miejsc z obiema: 302 (84%) w 50 m, mediana 10 m, 90. percentyl 132 m, maksimum 305 km (błąd współrzędnych NFZ) |
| Kontrola nazw | w 123 z 161 dopasowań nazwa świadczeniodawcy z NFZ jest podobna do nazwy z rejestru; z 38 pozostałych większość to forma prawna kontra marka („KASHYK sp. z o.o." i „Gabinet Stomatologiczny Kashyk"), a ok. 4 wygląda na sąsiedni gabinet w tym samym budynku (przegląd ręczny) |
| Niejednoznaczność | 13 z 176 miejsc ma w 50 m dwa albo trzy punkty rejestru; flagę dostaje najbliższy |

## Ograniczenia

- Obszar to prostokąt Kraków + obwarzanek z marginesem ok. 3 km (`BBOX` z #8), nie granice gmin: punkty tuż za granicą gminy są w plikach celowo. Kraków od reszty odróżnia dopiero front (np. po najbliższym adresie).
- Punkt to pozycja z rejestru, OSM albo Overture, nie wejście do lokalu. Plik nie niesie godzin otwarcia ani informacji, że lokal czynny dziś.
- Deduplikacja nie łączy punktów o różnych nazwach, nawet bardzo bliskich (np. ten sam salon pod nazwą właściciela w Overture i pod marką w OSM), więc liczby w branżach z drobnymi lokalami (fryzjer, kawiarnia) mogą być nieco zawyżone.
- Overture i OSM różnią się od rejestru nazwami (nazwa prawna a marka), więc ścisłe dopasowanie aptek jest niższe niż luźne.
- Zasięgi piesze są założeniem, nie pomiarem czasu dojścia.
- **Dentysta i fizjoterapia: liczba punktów to górna granica liczby gabinetów.** Nazwa prawna z RPWDL rzadko zgadza się z nazwą gabinetu w OSM i Overture, więc to samo miejsce bywa policzone dwa razy (punkt rejestru i punkt OSM, ścisłe dopasowanie tylko 17% rejestru). Luźna miara pokrycia (100 m) jest w `katalog.json`, a liczenie konkurencji w zasięgu pieszym powinno to uwzględnić.
- **RPWDL fizjoterapii i laboratoriów obejmuje komórki w szpitalach i przychodniach** (działy fizjoterapii, laboratoria szpitalne), nie tylko gabinety i punkty pobrań z ulicy. Rejestr nie rozróżnia, czy komórka przyjmuje pacjentów z zewnątrz.
- **Flaga `nfz` to „jest w Informatorze", nie „ma umowę".** Brak flagi nie dowodzi braku umowy. Jedno miejsce NFZ flaguje jeden punkt (najbliższy z rejestru), więc w budynku z kilkoma świadczeniodawcami z umową flaga może być tylko przy jednym z nich (13 z 176 miejsc ma kilku kandydatów). Informator jest aktualizowany co miesiąc, a plik niesie stan z dnia biegu.
- **Restauracje i flaga `fast_food` to przybliżenie.** OSM rozdziela restaurację od fast foodu tagiem, a Overture kategorią kuchni, więc burgerownie i kebaby w Overture dostają flagę z listy kategorii (`burger_restaurant`, `doner_kebab_restaurant`, `hot_dog_restaurant`, `fast_food_restaurant`, `sandwich_shop`), a nie z cech lokalu. Overture `flowers_and_gifts_store` obejmuje też sklepy z upominkami, więc liczba kwiaciarni może być lekko zawyżona. Relacji OSM (multipolygonów) nie czytamy, co dotyczy głównie dużych obiektów, np. siłowni w halach.
- **Nazwy z inicjałem i nazwiskiem właściciela przechodzą przez heurystykę nazw osobowych.** Są to nazwy w rodzaju „Auto Serwis A.Szczurek" albo „Gum-Serwis. Szostak W.K." (Overture podaje część nazw warsztatów w formie „Firma. Branża. Nazwisko I."). Wyrażenie dopasowane do inicjału z nazwiskiem znajduje ich ok. 60 w nowych plikach (z tego ok. 40 w `warsztat`) i ok. 20 w plikach z #104; heurystyka z #104 (tytuł, popularne imię, „indywidualna praktyka") ich nie łapie. Zmiana heurystyki zmieniłaby też nazwy w plikach z #104, więc to osobna decyzja.

## Aktualizacja

Zmiana mapowania w katalogu nie wymaga nowych pobrań (OSM i Overture są w cache w surowej postaci szerszej niż katalog; cache OSM unieważnia się razem ze zmianą kluczy i selektorów). Nowy ekstrakt: usuń `etl/.cache/malopolskie.osm.pbf` (i `.stan`) albo nowszy parquet Overture pojawi się sam przy nowym wydaniu. Odświeżenie NFZ: usuń `etl/.cache/nfz-itl-stomatologia-06.json` (kolejny bieg pobierze Informator od nowa: 29 zapytań, ok. 10 s; regulamin dopuszcza 10 zapytań na sekundę, skrypt robi ok. 5). Odświeżenie RPWDL: usuń `etl/.cache/rpwdl` i `etl/.cache/rpwdl-aktywne.zip` (`przychodniePoz()` pobierze zrzut od nowa, a geokodowanie nowych adresów idzie do wspólnego cache `uug-cache-v2.json`). Odświeżenie CEIDG: usuń `etl/.cache/ceidg` (razem z licznikiem; pamiętaj o limicie godzinnym).
