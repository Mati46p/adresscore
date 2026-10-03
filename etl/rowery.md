# Rowery i mobilność – Kraków i obwarzanek (#119)

`node etl/rowery.mjs [ścieżka do malopolskie-*.osm.pbf]` liczy trzy wskaźniki transportowe dla
wszystkich 176 684 adresów (zrzut z 2026-10-03, ok. 30 s przy gotowym cache).

| Wskaźnik | Co mierzy | Pokrycie | Kierunek | Źródło |
|---|---|---|---|---|
| `rower_infrastruktura_odleglosc` | metry w linii prostej do najbliższej drogi, ciągu, pasa lub kontrapasa rowerowego | 100% (Kraków 70 217, obwarzanek 106 467) | mniej = lepiej | Kraków: ZTP (MSIP, warstwa 5); obwarzanek: OpenStreetMap |
| `stojaki_300m` | suma pola „liczba” stojaków rowerowych ZTP w promieniu 300 m | Kraków (39,7%), poza nim `null` | więcej = lepiej | ZTP (MSIP, warstwa 4) |
| `pr_odleglosc` | metry do najbliższego z 10 parkingów Park and Ride ZTP | Kraków (39,7%), poza nim `null` | neutralny (kontekst) | ZTP (MSIP, warstwa 7) |

## Źródła i licencje

- **MSIP Kraków**, usługa `Obserwatorium/ZTP_Komunikacja_Miejska_i_Rowerowa` (dane ZTP, stan z
  `data_importu` = 2026-09-26, EPSG:2178). Warstwy: 5 `Ciągi_rowerowe` (2 529 obiektów), 4 `Stojaki
  ZTP` (3 157), 7 `Parking Park and Ride` (10). Warstwy 2 (punkty mobilności = miejsca na hulajnogi)
  i 3 (stacje naprawy, liczniki, podpórki, wiaty) nie wchodzą do żadnego wskaźnika. Te same dane
  opisuje zbiór [Mobilność Aktywna (Rowery) w Krakowie](https://otwartedane.um.krakow.pl/zbiory-danych/mobilnosc-aktywna-rowery-w-krakowie).
  Atrybucja w metadanych wskaźników: „Gmina Miejska Kraków, Portal MSIP Obserwatorium
  (https://msip.krakow.pl)”, licencja: [Regulamin MSIP](https://msip.krakow.pl/getHtml?dok_id=228972).
  Pobranie jednorazowe do `etl/.cache/rowery/` (paginacja `resultOffset`, bez pętli odpytującej).
- **OpenStreetMap**, ekstrakt Geofabrik dla Małopolski ze stanem 2026-10-02 (`malopolskie-261002.osm.pbf`,
  202 MB, `etl/.cache/osm/`). DuckDB spatial czyta PBF przez `ST_ReadOSM` w kilka sekund. Overpass
  nie jest używany: z maszyn zespołu `overpass-api.de` bywa nieosiągalny, a ekstrakt daje stały, datowany
  stan. Licencja ODbL 1.0, © współtwórcy OpenStreetMap; wynik to dzieło wytworzone, atrybucja wymagana
  (jest w `zrodla[]`).

## Definicje

**Co liczymy jako infrastrukturę rowerową.** Opis zbioru ZTP wymienia drogi dla rowerów, pasy,
ciągi pieszo-rowerowe, kontrapasy, kontraruchy, przejazdy i „inne drogi rowerowe odseparowane od
ruchu samochodowego”. Liczymy rodzaje `droga rowerowa`, `ciąg pieszo-rowerowy`, `pas rowerowy`,
`kontrapas`, `inny` i `przejazd` (345 z 419 km). Pomijamy to, co jest wyłącznie zezwoleniem znakowym
albo zwykłym chodnikiem: `kontraruch` (jazda pod prąd w ulicy jednokierunkowej, 63 km), `B-1 T22`,
`chodnik dopuszczony do ruchu rowerowego` i rekord bez rodzaju. Rowerzysta nie dostaje tam wydzielonego
miejsca, więc nie jest to „infrastruktura w pobliżu”.

**Odpowiedniki w OSM** (gminy obwarzanka): `highway=cycleway` (droga dla rowerów), `path`/`footway`/
`pedestrian` z `bicycle=designated` (ciąg pieszo-rowerowy; z ok. 5,5 tys. takich linii w obszarze 97% ma
twardą nawierzchnię – asphalt, paved, paving_stones, concrete – a tylko 11 tag `mtb:scale`) oraz `cycleway`, `cycleway:left/right/both` =
`lane`/`track`/`opposite_lane`/`opposite_track` na jezdni (pas). Pomijamy `shared_lane`, `shoulder`,
`sidewalk`, `opposite` i `separate`, obiekty `construction`/`proposed` oraz zamknięte (`access=private|no`
bez zgody dla roweru). W ramce (zasięg adresów + 10 km): 7 105 linii, 621 km.

**Stojaki.** Tylko typy `stojak rowerowy` i `stojak rowerowy listwa` (2 954 punkty). Stojaki na
hulajnogi (197) i adnotacje o naprawie (6) odpadają. Wartość to suma pola `liczba`; w 111 punktach
(3,8%) pole jest puste i liczymy 1, bo stojak istnieje, więc ma co najmniej jedno miejsce. Pole
`liczba` opisuje liczbę stojaków w punkcie ewidencji, nie gwarantuje pojemności w rowerach.

**Park and Ride.** Dziesięć parkingów z ewidencji ZTP. Wskaźnik ma kierunek `neutralny` (jak
`sct_w_strefie`): parking służy dojeżdżającym spoza miasta, więc bliskość nie jest zaletą ani wadą
miejsca zamieszkania. Silnik liczy kierunek neutralny dopiero po wyborze użytkownika, więc domyślnie
to kontekst. Nazwy i pojemności są w `opis` wskaźnika.

## Metoda

- Odległość liczymy do **odcinka** łamanej, nie do wierzchołka: wierzchołki leżą co kilkadziesiąt
  metrów, więc odległość do najbliższego wierzchołka zawyża wynik nawet o pół odstępu.
- Adresy, linie OSM i stojaki idą do EPSG:2178 (proj4), czyli do układu źródła MSIP; w tym układzie
  odległość euklidesowa różni się od geodezyjnej o ok. 0,002% w tej okolicy. Odległości są
  zaokrąglone do pełnych metrów (plik 0,7–0,8 MB zamiast 1,5 MB).
- Indeks (`etl/lib/odcinki.mjs`): siatka jednorodna 250 m, przeszukanie pierścieni komórek i stop,
  gdy dalszy pierścień nie może dać bliższego trafienia. Stojaki: KDBush, `within(300 m)`.
- Zasięg wyszukania infrastruktury to 10 km; dalej byłoby `null`. W obecnym zrzucie nikt nie
  przekracza 7,2 km.

## Kontrole (zrzut 2026-10-03)

- Indeks kontra przeszukanie liniowe wszystkich odcinków: 401 adresów (co ok. 441.), zgodność po
  zaokrągleniu; test jednostkowy porównuje oba na 600 losowych punktach.
- Zgodność źródeł w Krakowie (co 3. adres, 23 406): ZTP i OSM różnią się o najwyżej 100 m dla
  78,2% adresów; OSM jest bliżej o ponad 100 m dla 15,3%, ZTP bliżej o ponad 100 m dla 6,6%.
  Dla obwarzanka (tylko OSM) wynik jest więc porównywalny z urzędowym, ale OSM pokazuje tam ścieżki,
  których ZTP nie ma w ewidencji, a czasem pomija te, które ZTP ma.
- Rozkład: infrastruktura w Krakowie p50 343 m, p95 2 391 m, max 5 003 m; w obwarzanku p50 1 272 m,
  p95 4 360 m, max 7 166 m. Stojaki w Krakowie: 53,6% adresów ma 0, p75 = 19, p95 = 161, max 361.
  P+R: p50 2 518 m, p95 8 408 m, max 15 652 m.
- Miejsca znane: Rynek Główny 3 – droga w 68 m (rodzaj „inny”), stojaki 194, P+R Krowodrza
  Górka 3 055 m; Osiedle Centrum C 1 (Nowa Huta) – droga w 22 m; trzy sprawdzone parkingi P+R mają
  najbliższy adres 39–72 m od punktu, a `pr_odleglosc` tych adresów równa się tej odległości.
  Wieliczka, Piłsudskiego 55 – ciąg w 500 m; Skawina, Krakowska 3 – ciąg w 68 m; Niepołomice,
  3 Maja 13 – pas w 145 m; Mogilany, Skrzyszów 36B – ciąg w 4 437 m.

## Ograniczenia

- **Granica Krakowa.** Adres w Krakowie liczymy wyłącznie z ZTP, w obwarzanku wyłącznie z OSM (w tym
  z linii leżących w Krakowie). Adres w Krakowie tuż przy granicy może więc mieć bliższą drogę
  w sąsiedniej gminie, której ZTP nie obejmuje. Połączenie obu źródeł dla całego obszaru byłoby
  decyzją o semantyce, nie poprawką techniczną.
- **OSM bywa niekompletny.** Wartości w obwarzanku to raczej górne oszacowanie odległości.
- **Stojaki ZTP to nie wszystkie stojaki.** Ewidencja nie obejmuje stojaków prywatnych, sklepowych
  ani uczelnianych, więc 0 znaczy „brak stojaków ZTP w 300 m”, nie „brak miejsc na rower”. Połowa
  adresów Krakowa ma 0, co przy wadze tego wskaźnika w ocenie może karać osiedla z własnymi stojakami.
- **P+R tylko Kraków.** Parkingów gmin obwarzanka nie ma w ewidencji ZTP, więc poza miastem `null`.
  OSM zna kilkanaście (np. Wieliczka, Podłęże, Węgrzce Wielkie, Kocmyrzów) – można dodać osobnym
  zadaniem.
- Wszystkie odległości są w linii prostej: nie są długością dojazdu, nie uwzględniają barier
  (rzeka, torowisko) ani jakości trasy.
- Wskaźniki są w manifeście (`/dane/manifest.json`), ale wagi w `src/wynik/persony.ts` trzeba dopisać
  osobno; do tego czasu nie wpływają na ocenę.

## Czego nie ma i dlaczego

- **Ładowarki EV (`ladowarka_ev_odleglosc`).** Rejestr EIPA UDT udostępnia sześć plików JSON
  (`dictionary`, `operator`, `pool`, `station`, `point`, `dynamic`), ale
  [dokumentacja](https://eipa.udt.gov.pl/reader/docs) mówi wprost: „Dostęp do plików nadawany jest po
  zarejestrowaniu się. Przyznawany jest także limit pobrań plików na godzinę”. Adresy plików nie są
  publiczne (próby `reader/*.json` bez konta dają 404), więc zgodnie z zakresem zadania konta nie
  zakładamy i warstwa nie powstała. Opcje: (a) konto UDT właściciela i jednorazowe pobranie `station`
  + `point` do `etl/.cache/`, wtedy skrypt to ok. godzina pracy; (b) OSM `amenity=charging_station`
  z tego samego ekstraktu (w prostokącie Kraków + obwarzanek ok. 157 węzłów, do tego obiekty
  powierzchniowe; w całej Małopolsce 246 węzłów i 59 obiektów powierzchniowych), tańsze, ale niekompletne i inna licencja niż urzędowy rejestr.
- **Rower miejski, hulajnogi, car-sharing.** Poza zakresem (w Krakowie brak systemu stacyjnego,
  brak potwierdzonego GBFS).
- **Droga rowerowa metropolii z planszy SMK** (`droga_rowerowa_odleglosc`) należy do #113 i nie
  jest tu używana; obwarzanek dostaje tu odległość z OSM.
