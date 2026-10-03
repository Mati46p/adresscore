# Usługi z OSM i InPost wokół adresu (zadanie #124)

Uruchom `node etl/osm-uslugi.mjs` z katalogu projektu. Skrypt wyciąga z ekstraktu OpenStreetMap
jednym przebiegiem wszystkie grupy obiektów, pobiera paczkomaty InPost i zapisuje dziesięć warstw
w `public/dane/wskazniki`. Surowe dane (PBF, odpowiedź InPost, ludność z GUS BDL, wyciąg punktów)
leżą w `etl/.cache` poza repozytorium; drugi bieg ich nie pobiera. Odświeżenie OSM: usuń
`malopolskie-YYMMDD.osm.pbf` z cache. Ten sam plik PBF czyta `etl/bezpieczenstwo.mjs` (#45);
skrypt akceptuje też `malopolskie.osm.pbf` z #8, więc nic nie pobiera dwa razy.

## Warstwy

Każda warstwa to **odległość w linii prostej (m)** od adresu do najbliższego obiektu grupy,
rozdzielczość `adres`, pokrycie 176 684 z 176 684 adresów (dalej niż 30 km od jakiegokolwiek
obiektu byłby `null`; w obecnych danych nie ma takiego adresu). Pliki mają 0,7–0,9 MB, bez etykiet.

| Id | Co liczy (tagi OSM i filtry) | Kategoria, kierunek | Skala |
| --- | --- | --- | --- |
| `bankomat_poczta_odleglosc` | `amenity=atm`, `amenity=post_office` (bez punktów InPost, DPD, GLS i podobnych wpisanych jako poczta) | codzienność, bliżej lepiej | 0–2000 m |
| `kultura_odleglosc` | teatr, kino, `arts_centre`, biblioteka, muzeum, galeria; `community_centre` tylko z „kultur" w nazwie albo `community_centre=cultural_centre`; bez `access=private/no` | codzienność, bliżej lepiej | 0–2000 m |
| `plac_zabaw_odleglosc` | `leisure=playground` bez `access=private/no/customers/permit`, bez `indoor=yes`, `fee=yes` i sal zabaw, trampolin, parków linowych po nazwie | codzienność, bliżej lepiej | 0–1000 m |
| `paczkomat_odleglosc` | API punktów InPost, `type` zawiera `parcel_locker`, `status=Operating` (3 203 z 3 236 punktów; punkty obsługi bez automatu odpadają) | codzienność, bliżej lepiej | 0–1000 m |
| `recykling_odleglosc` | `amenity=recycling` bez `access=private/no` | codzienność, neutralna | 0–1500 m |
| `toaleta_woda_odleglosc` | `amenity=toilets`, `amenity=drinking_water` bez dostępu dla klientów, prywatnego, na zezwolenie; woda z `drinking_water=no` albo `drinking_water:legal=no` odpada | codzienność, neutralna | 0–2000 m |
| `weterynarz_odleglosc` | `amenity=veterinary` | codzienność, neutralna | 0–3000 m |
| `rod_odleglosc` | `landuse=allotments`, odległość do obrysu ogrodu (punkty granicy co 50 m) | codzienność, neutralna | 0–2500 m |
| `akademik_odleglosc` | `building=dormitory`, `amenity=student_accommodation`; internaty szkolne i bursy odrzucone po nazwie | codzienność, neutralna | 0–6500 m |
| `defibrylator_odleglosc` | `emergency=defibrillator` z `access=yes/permissive` albo bez tagu dostępu i poza budynkiem | bezpieczeństwo, neutralna | 0–2500 m |

**Dlaczego część warstw jest neutralna.** Silnik wyniku daje każdej nowej warstwie domyślną wagę
persony, więc dziesięć nowych warstw zmieniłoby wynik każdego adresu. Do wyniku wchodzą cztery
z oczywistym „bliżej lepiej" i pełną mapą. Weterynarz, akademik i ogród działkowy zależą od stylu
życia. Recykling, toalety i defibrylatory mają w OSM wyraźnie niepełne dane poza Krakowem (patrz
tabela niżej). Neutralna warstwa nie liczy się do wyniku, dopóki użytkownik nie wybierze kierunku
w panelu; wartość widać na karcie.

**Skala.** Górna granica skali (ocena 0) to 90. percentyl odległości w Krakowie zaokrąglony w górę
do 500 m. Silnik przycina wartości do `zakres`, więc odległość większa niż granica daje ocenę 0.

## Metoda

1. **OSM.** Ekstrakt Geofabrik, województwo małopolskie, stan 2026-10-02 (193 MB). DuckDB `spatial`,
   `ST_ReadOSM`: odczyt węzłów i linii z tagami z listy grup (`etl/lib/osm-uslugi.mjs`, `GRUPY` to
   jedyne źródło prawdy, zapytanie SQL składa się z niej), potem odczyt współrzędnych węzłów tych
   linii. Overpass pominięty: w #8 i #46 timeoutował. Filtry dostępu (`access`, `indoor`, `fee`)
   robi `klasyfikuj` w JS na pełnych tagach obiektu.
2. **Położenie.** Węzeł: jego punkt. Zamknięta linia (budynek, plac): średnia wierzchołków. Ogród
   działkowy to duży obszar, więc liczymy do punktów jego obrysu rozstawionych co najwyżej co 50 m
   (adres wewnątrz ogrodu ma odległość do granicy, nie zero). Ten sam obiekt jako węzeł i budynek
   w odległości do 25 m liczy się raz.
3. **Najbliższy obiekt.** Indeks siatkowy z `etl/lib/codziennosc-geo.mjs` (#8), komórka dobrana do
   liczby punktów grupy. Indeks wybiera kandydata po płaskich współrzędnych (błąd do 0,1%), a mierzy
   haversine'em; skrypt przy każdym biegu porównuje wynik z pełnym przeglądem na 150 losowych
   adresach każdej warstwy i przerywa przy różnicy większej niż 1 m + 0,2%.
4. **InPost.** `GET api-shipx-pl.easypack24.net/v1/points?province=małopolskie&per_page=500`, bez
   tokenu, jedno stronicowane pobranie z nagłówkiem User-Agent. Dane operatora prywatnego bez
   licencji otwartej: publikujemy wyłącznie odległość, nie pozycje paczkomatów (jak w #80).
   Źródło i data pobrania są w metadanych warstwy.
5. **Licznik porównawczy w opisie.** Obiekty OSM na 1000 mieszkańców osobno dla Krakowa i dla 13
   gmin obwarzanka. Obiekt należy do gminy najbliższego punktu adresowego, jeśli ten leży bliżej
   niż 1 km (granic gmin nie mamy). Ludność ogółem 31.12.2024 z GUS BDL (zmienna 72305): Kraków
   809 168, 13 gmin razem 318 298.

Licencja: dane OSM © współtwórcy OpenStreetMap, ODbL 1.0 (<https://www.openstreetmap.org/copyright>).
Warstwy zawierają tylko pochodne odległości, bez punktów i bez kopii bazy; atrybucja jest w
`zrodla` każdej warstwy.

## Kontrola wyniku z obecnego zestawu

Rozkład odległości w metrach (10., 50., 90., 99. percentyl, maksimum) i liczba obiektów OSM na 1000
mieszkańców:

| Warstwa | Obiektów w Małopolsce | Kraków | na 1000 | 13 gmin obwarzanka | na 1000 |
| --- | ---: | --- | ---: | --- | ---: |
| `bankomat_poczta` | 1 408 | 114 / 451 / 1751 / 3951 / 4794 | 0,7 | 388 / 1490 / 3560 / 5327 / 6787 | 0,4 |
| `kultura` | 931 | 157 / 595 / 1678 / 2992 / 3470 | 0,4 | 415 / 1489 / 3299 / 5089 / 6423 | 0,2 |
| `plac_zabaw` | 2 616 | 100 / 293 / 812 / 1475 / 2190 | 1,1 | 200 / 675 / 1749 / 2807 / 6100 | 0,9 |
| `paczkomat` | 3 203 | 84 / 239 / 622 / 1540 / 2837 | 1,0 | 161 / 509 / 1240 / 2033 / 3180 | 1,1 |
| `recykling` | 1 319 | 104 / 357 / 1136 / 2085 / 3171 | 1,1 | 687 / 2252 / 4945 / 7914 / 12277 | 0,1 |
| `toaleta_woda` | 959 | 185 / 596 / 1861 / 3548 / 5130 | 0,3 | 634 / 1901 / 3999 / 6651 / 8503 | 0,2 |
| `weterynarz` | 194 | 253 / 792 / 2683 / 5896 / 6835 | 0,10 | 601 / 2355 / 6055 / 8113 / 9323 | 0,09 |
| `rod` | 592 | 260 / 814 / 2272 / 3342 / 4140 | 0,2 | 545 / 2070 / 4964 / 7375 / 10321 | 0,2 |
| `akademik` | 60 | 539 / 2414 / 6417 / 12922 / 14578 | 0,07 | 4821 / 9529 / 16438 / 22786 / 25505 | 0,0 |
| `defibrylator` | 731 | 288 / 945 / 2170 / 5163 / 7081 | 0,1 | 380 / 1432 / 3343 / 6713 / 7830 | 0,3 |

Recykling pokazuje, jak wygląda niepełna mapa: 1,1 punktu na 1000 mieszkańców w Krakowie i 0,1 w
gminach, więc mediana odległości rośnie z 357 m do 2252 m. Defibrylatory odwrotnie: więcej na
mieszkańca poza Krakowem, bo w Krakowie większość urządzeń ma w OSM dostęp dla klientów, prywatny
albo stoi w budynku i odpada po filtrze: zostaje 29% (118 z 414 w prostokącie Krakowa), a w gminach
62% (97 z 156).

Kontrola na znanych adresach (odległość w m, najbliższy obiekt z nazwą):

| Adres | Bankomat lub poczta | Kultura | Plac zabaw | Paczkomat | Akademik |
| --- | ---: | --- | ---: | ---: | --- |
| Kraków, Rynek Główny 10 | 82 | 25, Kościół św. Wojciecha (oddział Muzeum Archeologicznego) | 455 | 390 | 552, DA „Bratniak" |
| Wieliczka, Rynek Górny 7 | 199, bankomat | 116, Szyb poszukiwawczy (muzeum) | 301 | 238 | 5899, DS CMUJ A |
| Niepołomice, Rynek 19 | 0, Poczta Polska | 184, Muzeum Niepołomickie | 238 | 117 | 15525, DS UJ |
| Koniusza 70 (wieś) | 110 | 97, Gminny Ośrodek Kultury | 159 | 186 | 19318, DS-3 „Bartek" |

Sala zabaw „Na Fali" (płatna, w budynku) była najbliższym „placem zabaw" dla Rynku w Niepołomicach
(188 m), dopóki filtr `indoor`/`fee` jej nie wykluczył; po filtrze najbliższy to 238 m.

## Co odpadło i ograniczenia

- **Coworking:** w OSM jest 7 obiektów `office=coworking` w całej Małopolsce (`amenity=coworking_space`
  nie ma wcale), za mało na odległość – warstwa nie powstała.
- **Spoza zakresu zlecenia:** `amenity=marketplace`, `bar`, `pub`, `nightclub`, `townhall`,
  `leisure=dog_park` i `fitness_station` z listy w issue. Dodanie grupy to wpis w `GRUPY`.
- **Relacje OSM (multipoligony)** są pominięte; to od 0,1% do 4% obiektów grupy (najwięcej ogrodów
  działkowych: 22 z 614). Obiekty poza Małopolską nie istnieją w ekstrakcie.
- **Odległość w linii prostej**, bez sieci pieszej; budynki, rzeki i przejścia wydłużają drogę.
  Dla obiektów zapisanych jako linie liczymy środek, nie wejście.
- **Kompletność OSM** jest nierówna: poza Krakowem mniej bankomatów, kultury, recyklingu i
  toalet. Warstwy z największą luką (recykling, toalety, AED) są neutralne.
- **OSM nie zna godzin otwarcia, repertuaru ani stanu urządzeń.** Defibrylator w wykazie może być
  nieczynny, a toaleta zamknięta.
- **Paczkomaty:** liczymy tylko automaty InPost. Paczkomaty innych firm i punkty odbioru w sklepach
  (`pok`, `pop`, `pudo_mini`) nie wchodzą. Migawka z dnia pobrania, bo API nie podaje historii.
