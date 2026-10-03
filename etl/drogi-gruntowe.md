# Dojazd drogą gruntową – Kraków i obwarzanek (#73)

`node etl/drogi-gruntowe.mjs [ścieżka do malopolskie-*.osm.pbf]` liczy dwa wskaźniki transportowe dla
wszystkich 176 684 adresów (zrzut z 2026-10-03, ok. 40 s przy gotowym cache; wynik jest powtarzalny,
dwa biegi dają identyczne pliki).

| Wskaźnik | Co mierzy | Pokrycie | Kierunek | Plik |
|---|---|---|---|---|
| `dojazd_utwardzony` | 1 = najbliższa ulica ma nawierzchnię utwardzoną, 0 = gruntową; etykieta podaje rodzaj drogi, nawierzchnię i źródło | 98,5% (Kraków 98,2%, obwarzanek 98,6%) | więcej = lepiej | 1,4 MB |
| `drogi_gruntowe_300m` | % długości dróg gruntowych wśród dróg o znanej nawierzchni w promieniu 300 m | 100% | mniej = lepiej | 0,5 MB |

## Źródła i licencje (oba bez klucza, konta i logowania)

- **BDOT10k** (GUGiK), warstwa `OT_SKDR_L` (droga) z paczek SHP powiatów 1261 (Kraków), 1206
  (krakowski), 1219 (wielicki) i 1214 (proszowicki): `https://opendata.geoportal.gov.pl/bdot10k/schemat2021/SHP/12/<powiat>_SHP.zip`,
  razem 125 MB, pobranie jednorazowe do `etl/.cache/bdot10k/`. Pliki w archiwach mają datę 2026-10-03, a wersje obiektów dróg w obszarze pochodzą z lat 2023 (47% długości),
  2024 (18%) i 2025 (35%), najnowsza z 2026-07-30. Atrybut `MATE_NAWIE` jest wypełniony na każdym odcinku,
  a źródłem danych jest w 97–99% ortofotomapa (pole `ZRO_DANYCH`). Geoportal:
  „Baza BDOT10k jest dostępna bezpłatnie i możliwa do dowolnego wykorzystania”. DuckDB czyta SHP prosto
  z archiwum (`/vsizip/…`), bez rozpakowywania.
- **OpenStreetMap**, ekstrakt Geofabrik dla Małopolski ze stanem 2026-10-02 (`etl/.cache/malopolskie-261002.osm.pbf`,
  202 MB): `highway`, `surface`, `tracktype`, `access`, `service`, `tunnel`. Licencja ODbL 1.0, © współtwórcy
  OpenStreetMap; wynik to dzieło wytworzone, atrybucja wymagana (jest w `zrodla[]`).

## Dlaczego dwa źródła

W OSM tag `surface` ma tylko część dróg: primary 99,6%, tertiary 91%, ale residential 53%,
unclassified 58%, track 24%, service 18%. To właśnie ulice osiedlowe i drogi polne prowadzą do domów.
BDOT10k ma materiał na każdym odcinku i zawiera drogi polne, których w OSM brak: w okolicy adresów
BDOT10k ma 9 173 km dróg, OSM 6 953 km, a z odcinków BDOT10k tylko 61% ma odpowiednik w OSM
(wśród gruntowych 45%). Liczone samym OSM dałoby to 5,8% gruntowych dojazdów w Krakowie i 13,2%
w obwarzanku, samym BDOT10k 15,1% i 29,6%, a po połączeniu 11,8% i 27,0%.

## Definicje

**Nawierzchnia.** Utwardzona to asfalt, beton, płyty, kostka, bruk; gruntowa to grunt naturalny, żwir,
tłuczeń i nawierzchnia ubita. Podział z wiki OSM (`paved` kontra `unpaved`) i z atrybutu BDOT10k.

| BDOT10k `MATE_NAWIE` | OSM `surface` | Klasa | Rodzaj na etykiecie |
|---|---|---|---|
| masa bitumiczna | asphalt, chipseal | utwardzona | asfalt |
| beton, płyty betonowe | concrete, concrete:plates, concrete:lanes | utwardzona | beton lub płyty betonowe |
| kostka prefabrykowana | paving_stones | utwardzona | kostka brukowa |
| kostka kamienna, bruk | sett, cobblestone, unhewn_cobblestone, bricks | utwardzona | bruk kamienny |
| – | paved, metal, wood | utwardzona | inna nawierzchnia utwardzona |
| żwir, tłuczeń | gravel, fine_gravel, compacted, pebblestone | gruntowa | żwir lub tłuczeń |
| grunt naturalny | unpaved, ground, dirt, earth, grass, sand, mud, rock | gruntowa | grunt |
| inny (5 odcinków) | nieznana lub sprzeczna wartość (np. `asphalt;gravel`) | nieznana | – |

Bez tagu `surface` OSM daje: `tracktype=grade1` utwardzona, `grade2` żwir, `grade3–5` grunt;
primary, secondary i tertiary (także `_link`) – utwardzona; `track` – grunt. Ulice residential,
unclassified, living_street i service bez tagu zostają **nieznane**, a nie asfaltowe.

**Co wchodzi do sieci.** Z OSM: primary…tertiary, unclassified, residential, living_street, service,
track; bez autostrad i ekspresówek (nikt nie ma z nich dojazdu do domu), ścieżek, chodników, tuneli,
dróg zamkniętych (`access`/`motor_vehicle`/`vehicle=no`) oraz podjazdów, uliczek parkingowych,
dojazdów awaryjnych i drive-through (`service=driveway|parking_aisle|emergency_access|drive-through`).
Droga prywatna wchodzi, bo wiele dojazdów do domów to drogi wewnętrzne. Z BDOT10k: odcinki
`eksploatowany`, `na powierzchni gruntu`, bez autostrad i dróg ekspresowych (wiadukty i tunele odpadają).

**Ulica a droga wewnętrzna.** W BDOT10k ulicą jest każda klasa poza „droga wewnętrzna”; w OSM ulicą są
primary…tertiary, unclassified, residential i living_street. Odcinek jest ulicą, gdy tak mówi
którekolwiek źródło (OSM nazywa residential także prywatne ulice, które BDOT10k zalicza do dróg
wewnętrznych). Reszta (service, track, droga wewnętrzna) to podjazdy, drogi polne i prywatne.

## Metoda

1. **Sieć.** Sieć to odcinki BDOT10k plus odcinki OSM, których BDOT10k nie pokrywa. Linie dzielimy na kawałki
   do 30 m. Kawałek OSM jest pokryty, gdy w odległości do 12 m leży prawie równoległy kawałek BDOT10k
   (|cos kąta| ≥ 0,9). Wyniki są niewrażliwe na te progi: tolerancja 8–16 m i kąt 0,8–0,95 dają ten sam
   odsetek gruntowych dojazdów i średni udział co do 0,1 punktu procentowego.
2. **Nawierzchnia odcinka.** Jawny tag OSM (surface, potem tracktype) ma pierwszeństwo przed
   materiałem BDOT10k (reguła z issue), a gdy go brak – materiał BDOT10k. Odcinki OSM bez pokrycia
   (nowe drogi) wchodzą ze swoją klasą, także wnioskowaną z klasy drogi.
3. **Dojazd.** Najbliższy odcinek **ulicy** w promieniu 50 m od adresu, a gdy takiej nie ma – najbliższy
   odcinek jakiejkolwiek drogi w promieniu 100 m. 97,3% adresów ma jakąkolwiek drogę w 50 m (odległość do
   wybranej drogi: p95 45–47 m). Samo „najbliższy odcinek z całej sieci” dawało 17% gruntowych dojazdów
   w Krakowie, bo bliżej domu bywa krótki podjazd albo droga polna niż ulica, na której stoi dom.
   Nieznana nawierzchnia wybranego odcinka daje `null`, bez szukania dalszej drogi.
4. **Udział w 300 m.** Suma długości dróg gruntowych podzielona przez sumę dróg o znanej nawierzchni,
   z długością każdego odcinka obciętą do koła (równanie przecięcia odcinka z okręgiem). Mniej niż 100 m
   dróg o znanej nawierzchni w kole: `null`. Drogi o nieznanej nawierzchni (3,3% długości sieci) są pomijane.
5. **Okolica adresów.** Sieć budujemy tylko w promieniu 400 m od adresów (maska komórek 100 m), bo
   ekstrakt OSM i paczki BDOT10k obejmują dużo więcej; to odcina lasy i góry, które zafałszowałyby statystyki.
6. **Układ i indeks.** Wszystko w EPSG:2180 (BDOT10k jest w nim natywnie, węzły OSM i adresy przez proj4).
   Indeks to siatka 100 m w układzie CSR (`etl/lib/siec-drog.mjs`): najbliższy odcinek, dopasowanie równoległe
   i długość w kole. Odległości do odcinka, nie do wierzchołka.

## Kontrole (zrzut 2026-10-03)

- **Indeks kontra przeszukanie liniowe**: 151 adresów (co 1177.) zgodnych w odległości i udziale; testy
  jednostkowe porównują oba na setkach losowych punktów, a długość w kole z całkowaniem numerycznym.
- **Zgodność źródeł** na odcinkach, które opisują oba (3 958 km): 92,5% długości zgodnie, 7,5% sprzecznie.
  Sprzeczności to głównie OSM asfalt kontra BDOT10k grunt/żwir/tłuczeń (172 km), czyli droga utwardzona po
  zdjęciach BDOT10k albo błąd tagu; w druga stronę 57 km. Sprzeczności jest więcej w starszych wersjach
  BDOT10k (2023: 8,6%, 2024: 12,0%, 2025: 5,8%) i na ulicach osiedlowych (residential 10,3%, service 14,6%),
  a na drogach głównych praktycznie wcale (primary, secondary, tertiary: 0,0–0,1%). Tag OSM wygrał na 240 km.
- **Podwójnie policzone drogi**: odcinki leżące prawie na innej linii (≤ 2 m, równolegle) to 0,24% długości
  w BDOT10k i 0,25% w OSM.
- **Skład sieci w okolicy adresów** (10 355 km): utwardzona 5 631 km, gruntowa 4 379 km, nieznana 345 km.
- **Rozkład**: udział gruntowych w 300 m – Kraków p50 14%, p95 58%; obwarzanek p50 42%, p95 72%.
  Odległość do wybranej drogi – p50 15–19 m, p95 45–47 m.
- **Gminy** (adresy z dojazdem gruntowym | średni udział gruntowych w 300 m): Kraków 11,8% | 20,1%,
  Wieliczka 34,5% | 47,9%, Michałowice 34,8% | 49,3%, Mogilany 34,1% | 47,3%, Zielonki 28,4% | 42,1%,
  Zabierzów 25,1% | 40,3%, Niepołomice 22,8% | 35,9%, Koniusza 12,8% | 26,8%, Igołomia-Wawrzeńczyce 8,0% | 33,9%.
- **Znane miejsca**: wszystkie adresy ul. Floriańskiej (51), Grodzkiej (67), Rynku Głównego (46) i Alei Pokoju
  (96) mają dojazd utwardzony; ul. Zakopiańska 226 z 265 (reszta to numery z literami za zabudową, z gruntową
  drogą wewnętrzną); ul. Rzepichy 12 – gruntowy (żwirowa ulica, oba źródła się zgadzają); Rynek w Wieliczce,
  Skawinie i Niepołomicach – utwardzony, 2–9% gruntowych w 300 m.

## Ograniczenia

- To odległość w linii prostej od punktu adresu, a nie trasa przejazdu. Ostatni odcinek podjazdu może mieć
  inną nawierzchnię, a punkt adresu nie leży na bramie działki.
- 63,7% adresów z gruntowym dojazdem ma gruntowy odcinek drogi wewnętrznej lub polnej jako najbliższą
  drogę, bo ulicy w 50 m nie ma (drugi rząd zabudowy, długie podjazdy). 13,3% gruntowych dojazdów ma
  drogę utwardzoną nie dalej niż 10 m za wybraną gruntową; flaga jest dla nich niejednoznaczna.
- BDOT10k powstaje z ortofotomapy i bywa starszy od OSM: 47% długości dróg ma wersję z 2023 r., więc droga
  utwardzona później może tam figurować jako gruntowa. Gdzie OSM ma jawny tag, jego klasa ma pierwszeństwo. Nawierzchnia ubita lub z tłucznia to u nas „gruntowa”.
- Nawierzchnię określa jedna klasa na odcinek; nie ma stanu technicznego (dziury, błoto, zimowe utrzymanie).
- 1,5% adresów (2 719) nie ma flagi: 157 bez drogi w 100 m, 2 562 z nieznaną nawierzchnią najbliższej ulicy
  (OSM bez tagu `surface` poza paczkami BDOT10k).

## Dla integratora i toru AI

- Etykiety flagi są w `slownikEtykiet` (klucz `u11` = „Dojazd utwardzony: ulica, asfalt (BDOT10k)”), bo
  176 tys. pełnych napisów przekroczyłoby 2 MB. Jednostka `status` sprawia, że karta pokazuje sam napis.
  `src/wynik/silnik.ts` rozwija słownik, ale `src/ai/zapytajOAdres.ts` (wiersz z `w.etykiety?.[i]`) czyta
  klucz bez słownika, więc w odpowiedzi „zapytaj o adres” pojawiłby się kod `u11` (tak samo dla `sejm2023_lista_*`).
- `etl/kompakt.mjs` nie przenosi `slownikEtykiet` do kafli; nie ruszałem go (to praca integratora).
