# OSM – uzupełnienie: ładowarki EV, życie nocne, targowiska, wybiegi dla psów, siłownie plenerowe, urzędy (zadanie #159)

Uruchom `node etl/osm-uzupelnienie.mjs` z katalogu projektu (ok. 25 s). Skrypt wyciąga z ekstraktu
OpenStreetMap jednym przebiegiem sześć grup obiektów i zapisuje sześć warstw w
`public/dane/wskazniki`. Uzupełnia #124 (`etl/osm-uslugi.mjs`) o grupy, które tam odpadły z zakresu;
bibliotekę i skrypt #124 zostawia nietknięte, więc dziesięć tamtych warstw nie zmienia się ani o bajt.
Surowe dane (PBF, ludność z GUS BDL) leżą w `etl/.cache` poza repozytorium; ten sam plik PBF czytają
#124, #45 i #104, więc nic nie pobiera się dwa razy. Odświeżenie OSM: usuń `malopolskie-YYMMDD.osm.pbf`
z cache. Bez kluczy, kont i rejestracji (ładowarki z rejestru UDT/EIPA wymagają konta, #119, a ta
warstwa pokazuje to, co jest w OSM).

## Warstwy

Pokrycie każdej: 176 684 z 176 684 adresów (dalej niż 30 km od jakiegokolwiek obiektu byłby `null`;
w obecnych danych nie ma takiego adresu). Pliki mają 0,36–0,88 MB, bez etykiet.

| Id | Co liczy (tagi OSM i filtry) | Kategoria, kierunek | Skala |
| --- | --- | --- | --- |
| `ladowarka_ev_odleglosc` | `amenity=charging_station`, `access` pusty, `yes` albo `permissive`; bez `motorcar=no`, `vehicle=no`, `bicycle=yes/designated`, `bus=yes` (chyba że `motorcar=yes`) | przyszłość, bliżej lepiej | 0–3000 m |
| `zycie_nocne_300m` | liczba `amenity=bar`, `pub`, `nightclub` w 300 m, bez `access=private/no/members`; wpisy o tej samej nazwie w 25 m to jeden lokal | spokój, neutralna | 0–40 szt. |
| `targowisko_odleglosc` | `amenity=marketplace`, do obrysu; bez nazw z „nieczynn", „zlikwidowan" i bez dostępu innego niż publiczny | codzienność, bliżej lepiej | 0–4000 m |
| `wybieg_psy_odleglosc` | `leisure=dog_park`, do obrysu; bez `access=customers/permit/private`, `fee=yes` i placów szkoleniowych po nazwie | codzienność, neutralna | 0–4000 m |
| `silownia_plenerowa_odleglosc` | `leisure=fitness_station` (odległość do najbliższego przyrządu); bez `access=private/employees/military`, `fee=yes`, `indoor=yes` | codzienność, bliżej lepiej | 0–2000 m |
| `urzad_odleglosc` | `amenity=townhall` albo `office=government` z nazwą zaczynającą się od „Urząd Gminy/Miasta/Miejski/Dzielnicy", „Rada i Zarząd Dzielnicy" albo „Ratusz" | codzienność, neutralna | 0–4500 m |

**Dostęp publiczny** to brak tagu `access` (w OSM domyślnie otwarte) albo `yes` / `permissive`; każda inna
wartość (`private`, `customers`, `permit`, `employees`, `members`, `military`) wyklucza obiekt. Wyjątek:
bar, pub i klub „dla klientów" to zwykły lokal, więc `access=customers` zostaje.

**Kierunek.** Zlecenie wskazuje „neutralny" dla życia nocnego, wybiegów i urzędów; ładowarki,
targowiska i siłownie liczą się do wyniku (bliżej lepiej). Gęstość wpisów na mieszkańca (Kraków do
obwarzanka) wynosi: ładowarki 0,9 raza, siłownie 1,1, targowiska 2,5, wybiegi 5,0, życie nocne 11,6
(urzędy 0,5). Ładowarki i siłownie są więc w OSM poza Krakowem równie kompletne jak w nim, targowiska
umiarkowanie, a życie nocne i wybiegi wyraźnie mniej.

**Skala.** Dla odległości górna granica (ocena 0) to 90. percentyl odległości w Krakowie zaokrąglony
w górę do 500 m, jak w #124 (ładowarki 2513 m → 3000, targowiska 3981 → 4000, wybiegi 3638 → 4000,
siłownie 1733 → 2000, urzędy 4261 → 4500). Dla liczby lokali to 99. percentyl w Krakowie: 40 (90.
percentyl to 1, bo wpisy skupiają się w Śródmieściu). Skrypt ostrzega, gdy świeże dane dają inną
wartość niż w definicji.

## Metoda

1. **OSM.** Ekstrakt Geofabrik, województwo małopolskie, stan 2026-10-02 (202 MB). DuckDB `spatial`,
   `ST_ReadOSM`: węzły, linie i relacje wielokątów z tagami z listy grup (`etl/lib/osm-uzupelnienie.mjs`,
   `GRUPY` to jedyne źródło prawdy, zapytanie SQL składa się z niej), potem linie zewnętrznych obrysów
   tych relacji, potem współrzędne węzłów. Filtry dostępu robi `klasyfikuj` w JS na pełnych tagach.
2. **Położenie.** Węzeł: jego punkt. Zamknięta linia (budynek, plac): średnia wierzchołków. Targowisko
   i wybieg to obszary, które mają znaczenie jako całość, więc liczymy do punktów ich obrysu
   rozstawionych co najwyżej co 25 m (adres przy targowisku ma małą odległość, nie zero). Relacje
   wielokątów (Plac Nowy, Plac Na Stawach) dają obrys z linii `outer`; wnętrza (`inner`, np. Okrąglak)
   pomijamy. Bez tego adresy przy Placu Nowym miały 580–640 m do „najbliższego targowiska".
3. **Najbliższy obiekt.** Indeks siatkowy z #124; skrypt przy każdym biegu porównuje wynik z pełnym
   przeglądem na 150 losowych adresach każdej warstwy i przerywa przy różnicy większej niż 1 m + 0,2%.
4. **Liczba lokali w 300 m.** Układ 1992 (EPSG:2180) i indeks kdbush jak w warstwie ławek (#46); skrypt
   porównuje wynik z pełnym przeglądem haversine'em na 300 losowych adresach i 50 adresach o największych
   liczbach (tolerancja 0,5% promienia: haversine na kuli jest tu o 0,3% krótszy wzdłuż równoleżnika niż
   elipsoida GRS80, więc obie miary nie mogą zgadzać się co do metra).
5. **Scalanie do liczników.** Odległość liczy się do najbliższego wpisu, ale licznik „miejsc na 1000
   mieszkańców" i liczba lokali w 300 m liczą miejsca, nie wpisy: ładowarki, siłownie, urzędy, targowiska
   i wybiegi bliższe niż 50 m to jedno miejsce (przyrządy jednej siłowni, punkty jednej stacji).
   Lokale scalamy tylko przy tej samej nazwie w 25 m: w ekstrakcie 113 z 117 par wpisów bliższych niż
   25 m to różne lokale w jednej kamienicy (np. „Pijana Wiśnia" i „Pijalnia Wódki i Piwa" w odległości 8 m).
   Prosta zasada „25 m = duplikat" zostawiłaby z 512 wpisów 424 zamiast 510, a w promieniu 300 m od
   Rynku Głównego 46 zamiast 77.
6. **Licznik porównawczy w opisie.** Miejsca na 1000 mieszkańców osobno dla Krakowa i 13 gmin obwarzanka.
   Obiekt należy do gminy najbliższego punktu adresowego, jeśli ten leży bliżej niż 1 km (granic gmin nie
   mamy). Ludność ogółem 31.12.2024 z GUS BDL (zmienna 72305): Kraków 809 168, 13 gmin razem 318 298.
   Grupa z mniej niż 20 miejscami w obszarze 14 gmin odpada; teraz żadna nie odpadła. Gdy Kraków ma na
   mieszkańca ponad 4 razy więcej wpisów niż obwarzanek, opis warstwy mówi to wprost.

Licencja: dane OSM © współtwórcy OpenStreetMap, ODbL 1.0 (<https://www.openstreetmap.org/copyright>).
Warstwy zawierają tylko pochodne odległości i liczby, bez punktów i bez kopii bazy; atrybucja jest w
`zrodla` każdej warstwy.

## Kontrola wyniku z obecnego zestawu

Obiekty: z tagiem grupy w ekstrakcie → przyjęte po filtrach (relacja z kilkoma liniami zewnętrznymi to
kilka wpisów) → miejsca po scaleniu → miejsca w obszarze 14 gmin.

| Warstwa | z tagiem | przyjęte | miejsc | w 14 gminach |
| --- | ---: | ---: | ---: | ---: |
| `ladowarka_ev` | 305 | 232 | 209 | 122 |
| `zycie_nocne` | 512 | 512 | 510 | 304 |
| `targowisko` | 99 | 98 | 97 | 29 |
| `wybieg_psy` | 51 | 46 | 46 | 41 |
| `silownia_plenerowa` | 784 | 778 | 633 | 238 |
| `urzad` | 591 | 207 | 201 | 36 |

Odrzucone przez filtry: ładowarki 52 prywatne, 6 dla klientów, 15 nie dla samochodów (autobusy MPK,
rowery); wybiegi 2 dla klientów, 1 na zezwolenie, 1 prywatny, 1 szkoła tresury; siłownie 6 prywatnych,
1 pracownicza, 1 wojskowa; targowiska 1 „Plac Targowy nieczynny"; urzędy: większość z 591 to inne
instytucje z `office=government` (starostwa, inspektoraty, remizy, archiwum).

Rozkład odległości w metrach (10., 50., 90., 99. percentyl, maksimum; dla życia nocnego liczba lokali
w 300 m) i miejsca na 1000 mieszkańców:

| Warstwa | Kraków | miejsc | na 1000 | 13 gmin obwarzanka | miejsc | na 1000 |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| `ladowarka_ev` | 318 / 855 / 2513 / 4772 / 6023 | 86 | 0,1 | 691 / 2820 / 7392 / 13918 / 19285 | 36 | 0,1 |
| `zycie_nocne` (szt.) | 0 / 0 / 1 / 40 / 92 | 294 | 0,4 | 0 / 0 / 0 / 0 / 2 | 10 | 0,03 |
| `targowisko` | 435 / 1548 / 3981 / 6655 / 9116 | 25 | 0,03 | 1516 / 4861 / 8385 / 10127 / 11416 | 4 | 0,01 |
| `wybieg_psy` | 495 / 1419 / 3638 / 6713 / 9453 | 38 | 0,05 | 1698 / 5660 / 12043 / 16502 / 20407 | 3 | 0,01 |
| `silownia_plenerowa` | 224 / 650 / 1733 / 2757 / 3238 | 173 | 0,2 | 482 / 1623 / 3750 / 7786 / 10028 | 65 | 0,2 |
| `urzad` | 544 / 1970 / 4261 / 6302 / 7061 | 20 | 0,02 | 902 / 2778 / 5216 / 7072 / 8140 | 16 | 0,05 |

Życie nocne pokazuje, jak wygląda niepełna mapa: 0,4 lokalu na 1000 mieszkańców w Krakowie i 0,03 w
gminach, więc mediana liczby lokali w 300 m wynosi 0 wszędzie, a 90% adresów w Krakowie ma najwyżej
jeden. Wartości są wysokie tylko tam, gdzie ktoś wpisał lokale (Śródmieście, Kazimierz). Warstwa jest
neutralna i opis mówi, że zero oznacza brak wpisu.

Kontrola na znanych adresach (odległość w m albo liczba lokali w 300 m; najbliższy obiekt z nazwą):

| Adres | Ładowarka | Lokale w 300 m | Targowisko | Wybieg | Siłownia | Urząd |
| --- | ---: | --- | --- | ---: | ---: | --- |
| Kraków, Rynek Główny 10 | 239 | 57 | 716, Stary Kleparz | 1760 | 1451 | 215, Urząd Miasta Krakowa |
| Kraków, Plac Wszystkich Świętych 3 | 34 | 27 | 794, plac targowy koło Hali Targowej | 1780 | 1284 | 23, Urząd Miasta Krakowa |
| Kraków, Rynek Kleparski 10 | 505 | 7 | 22, Stary Kleparz | 1054 | 1107 | 62, Rada i Zarząd Dzielnicy I |
| Kraków, Plac Nowowiejski 2 | 503 | 2 | 9, Plac Nowowiejski | 579 | 187 | 619, Rada i Zarząd Dzielnicy V |
| Kraków, Plac Nowy 3 (Kazimierz) | 716 | 57 | 11, Plac Nowy (relacja OSM) | 1505 | 667 | 834, Rada i Zarząd Dzielnicy XIII |
| Zabierzów, Rynek 1 | 2761 | 0 | 6636, Giełda (RTV, Komputerowa, Staroci, Zoologiczna) | 7396 | 1281 | 19, Urząd Gminy Zabierzów |
| Wieliczka, Rynek Górny 7 | 586 | 0 | 164 | 955 | 401 | 219, Urząd Miasta i Gminy |
| Skawina, Rynek 2 | 562 | 0 | 416, Plac targowy | 6565 | 1267 | 16, Urząd Miasta i Gminy Skawina |
| Niepołomice, Rynek 19 | 1210, Lidl | 0 | 506, Plac Targowy | 351, Psi Park | 1312 | 175, Ratusz |
| Koniusza 70 (wieś) | 13939 | 0 | 5679, Plac Targowy | 15648 | 7321 | 458, Urząd Gminy w Koniuszy |

Niezależna kontrola (osobny kod bez importu z `etl/lib`, osobny wyciąg z PBF, dokładny obrys co 2 m
zamiast co 25 m): 427 adresów (400 losowych i próbka z Rynku Głównego) × 6 warstw, 0 rozbieżności
powyżej tolerancji (odległości do punktów: maksimum 0,5 m, czyli zaokrąglenie; do obrysów: 1,4 m;
liczby lokali: wewnątrz tolerancji 0,5% promienia). Obrysy relacji Placu Nowego i Placu Na Stawach
sprawdzone osobno: 7 adresów, różnica do dokładnego obrysu 0–2 m.

## Co odpadło i ograniczenia

- **Urzędy: samo `amenity=townhall` nie wystarcza.** Tak oznaczonych obiektów jest w obszarze 14 gmin
  tylko 8 (Kraków 3, Wieliczka 2, Igołomia-Wawrzeńczyce, Niepołomice, Koniusza), a 9 z 14 gmin (Zabierzów,
  Liszki, Michałowice, Skawina, Zielonki, Wielka Wieś, Mogilany, Świątniki Górne, Kocmyrzów-Luborzyca) ma
  urząd w OSM wyłącznie jako `office=government`. Przy samym `townhall` mieszkaniec Zabierzowa miałby
  „najbliższy urząd" w Krakowie, 11,6 km od Rynku w Zabierzowie, choć urząd gminy stoi tuż obok. Dlatego tagi są dwa, a o przyjęciu decyduje nazwa; tagiem
  `amenity=townhall` oznaczono też kurię diecezjalną, świetlicę i inspektorat pracy, które nazwa odrzuca.
  Z samym `townhall` grupa miałaby mniej niż 20 miejsc w obszarze i odpadłaby wg reguły ze zlecenia.
- **Siedziby rad dzielnic Krakowa** (15 z 18 w OSM) są w warstwie urzędów: to najbliższe lokalne biura
  samorządu, ale nie tam załatwia się dowód ani meldunek. Opis warstwy mówi o dzielnicach wprost.
- **Targowiska w OSM to także bazary, giełdy i centra handlowe z tagiem `marketplace`** (np. Centrum
  Targowe KING, Giełda Samochodowo-Handlowa). Nie odrzucamy ich po nazwie, żeby nie wybierać na oko;
  odpadają tylko nieczynne i zamknięte dla ogółu.
- **Życie nocne i wybiegi są wyraźnie niepełne poza Krakowem** (11,6-krotna i 5-krotna różnica gęstości).
  Zero lub duża odległość tam często znaczy „nie wpisano", co mówi opis warstwy. Warstwy są neutralne.
- **Ładowarki:** w OSM jest ich w obszarze 122 lokalizacje, rejestr UDT/EIPA ma więcej, ale wymaga
  konta (#119). Nie znamy mocy, liczby gniazd ani cennika; wpisy z `fee=yes` (płatne) zostają, bo
  ładowanie jest zwykle płatne.
- **Relacje OSM:** uwzględnione tylko typu `multipolygon` i tylko ich zewnętrzne linie. Z 11 relacji z
  tagami grup 10 to multipoligony; relacja typu `site` (bez ról) jest pominięta. Pierścień złożony z
  kilku otwartych linii nie jest składany, więc dla takiego obiektu odległość do obrysu bywa zawyżona.
- **Odległość w linii prostej**, bez sieci pieszej; dla linii liczymy środek albo obrys, nie wejście.
- **OSM nie zna godzin otwarcia, dni handlu ani stanu urządzeń.** Ładowarka może być zajęta, targowisko
  zamknięte, siłownia uszkodzona.
- **Poza Małopolską** ekstrakt nie ma obiektów; adresy przy granicy województwa mają odległości do
  obiektów z wnętrza Małopolski. W ekstrakcie są też obiekty słowackie (np. „Obecný úrad"); odpadają po
  nazwie i leżą zbyt daleko, by wpłynąć na jakikolwiek adres.
