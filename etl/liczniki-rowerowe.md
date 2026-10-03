# Liczniki rowerowe Krakowa – ruch rowerowy przy najbliższym liczniku (#136)

`node etl/liczniki-rowerowe.mjs` liczy jeden wskaźnik transportowy dla wszystkich 176 684 adresów
(zrzut z 2026-10-03, ok. 6 s przy gotowym cache).

| Wskaźnik | Co mierzy | Pokrycie | Kierunek | Źródło |
|---|---|---|---|---|
| `rower_ruch_dobowy` | średnia dobowa liczba rowerów z 365 dni pracy najbliższego licznika ZTP, o ile stoi w promieniu 1 km w linii prostej; wartości zaokrąglone do 10, etykieta „licznik Mogilska, 620 m” | Kraków 11 367 z 70 217 adresów (16,2%), obwarzanek 0 z 106 467, razem 6,4%; poza zasięgiem `null` | więcej = lepiej, skala 0–2 000 rowerów/dobę | tabela pomiarów ZTP + położenie liczników z MSIP |

## Źródła i licencje (oba bez klucza, konta i logowania)

- **Liczby: tabela „Dane tabelaryczne” ZTP Kraków**
  (<https://ztp.krakow.pl/rower/pomiary-ruchu-rowerowego/dane-tabelaryczne>). Strona ładuje ją z pliku
  CSV, który ZTP publikuje w Arkuszach Google („publikuj w sieci”, `docs.google.com/spreadsheets/d/e/2PACX-1vTWNYLoE3k3JegSt47hV66v5j7_Vh8jIdLRUhcMLrIAW4VcIZK-3W9rGoDSfnToUnCIb9DPngGAlgL6/pub?gid=0&single=true&output=csv`).
  Dane dobowe z 19 liczników, 3 574 doby (2016-11-18 – 2026-08-31, bez przerw w datach), plus pięć
  kolumn pogodowych (temperatura, opad), których nie używamy. Tabela jest odświeżana z opóźnieniem
  (na 2026-10-03 kończy się na 2026-08-31). Pobranie jednorazowe do `etl/.cache/liczniki-rowerowe/`;
  aby odświeżyć dane, usuń ten katalog i uruchom skrypt ponownie.
- **Położenie: MSIP Kraków**, usługa `Obserwatorium/ZTP_Komunikacja_Miejska_i_Rowerowa`, warstwa 3
  „Infrastruktura rowerowa ZTP”, `typ = licznik rowerowy` (17 punktów, EPSG:2178, `data_importu`
  2026-09-26, status „niezinwentaryzowano”). Nazwy punktów są takie same jak nagłówki kolumn tabeli,
  więc łączymy po nazwie. Warstwę 3 pomija `etl/rowery.mjs` (#119), więc nic się nie dubluje.
  Atrybucja: „Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl)”, licencja:
  [Regulamin MSIP](https://msip.krakow.pl/getHtml?dok_id=228972).
- **Licencja liczb.** Strona ZTP nie podaje odrębnej licencji. Zbiór „Mobilność Aktywna (Rowery)”
  na portalu Otwarte Dane Krakowa (<https://otwartedane.um.krakow.pl/zbiory-danych/mobilnosc-aktywna-rowery-w-krakowie>)
  zawiera tylko lokalizacje, bez liczb. Stosujemy więc warunki tego portalu
  ([Warunki wykorzystania Danych](https://otwartedane.um.krakow.pl/warunki-wykorzystania-danych-udostepnianych-w-portalu)):
  swobodne ponowne wykorzystanie, wymagane podanie źródła („Gmina Miejska Kraków”) oraz czasu
  wytworzenia i pozyskania danych (`dataDanych` i `pobrano` w `zrodla[]`).
- **Czego nie używamy.** API `api.um.krakow.pl` (portal programisty) wymaga klucza, więc je pominięto.
  Widgety Eco-Counter osadzone na stronie ZTP (`data.eco-counter.com/eco-widget`) pokazują tylko dobę
  wczorajszą i sumę od początku roku, bez szeregu czasowego.

## Definicja

**Średnia dobowa liczba rowerów.** Dla każdego licznika bierzemy 365 dni kończących się na jego
ostatnim odczycie i liczymy średnią z dni z odczytem. Powody:

- Ruch rowerowy zmienia się z porą roku około czterokrotnie (zob. niżej), więc średnia z niepełnego
  roku mierzyłaby porę roku, a nie miejsce. Licznik wchodzi tylko z kompletnym rokiem: co najmniej
  329 z 365 dni z odczytem (90%).
- Odczyt `0` traktujemy jak awarię licznika: na ulicy ze średnią kilkuset rowerów doba bez przejazdu
  nie zdarza się (najsłabsza doba roku ma na każdym z 15 liczników z danymi do końca tabeli od 1 do
  290 przejazdów). Zero nie liczy się ani do średniej, ani do pokrycia. Wszystkie 17 użytych okien ma
  komplet 365 odczytów, więc dziś ta zasada nie zmienia żadnej średniej; chroni przed awarią w
  przyszłych wersjach tabeli.
- Dla 15 liczników rok to 2025-09-01 – 2026-08-31. **Smoleńsk** ma w tabeli odczyty tylko do
  2026-07-13 (rok 2025-07-14 – 2026-07-13), **Bora-Komorowskiego** do 2026-01-07 (rok
  2025-01-08 – 2026-01-07). Dla Bora-Komorowskiego zgadza się to z widgetem ZTP: jego suma od początku
  roku (1 018) jest równa sumie z tabeli, więc licznik od stycznia nie nadaje. Limit nieaktualności to
  366 dni od końca tabeli.
- Tabela podaje jedną liczbę na dobę, bez rozbicia na kierunki jazdy; tak ją przekazujemy.

**Najbliższy licznik w promieniu 1 km.** Odległość euklidesowa w metrach EPSG:2178, w linii prostej,
bez uwzględnienia barier (Wisła, torowiska). Promień 1 km to ustalenie z issue; stała `PROMIEN` w
skrypcie, zmiana i ponowny bieg to kilka sekund. Wartość to średnia tego jednego licznika, nie
uśrednienie kilku. Poza promieniem `null` (nigdy 0), także cały obwarzanek, bo liczniki stoją tylko w
Krakowie.

**Rozdzielczość `rejon`.** Liczba opisuje okolicę licznika (do 1 km), nie sam adres; wszystkie adresy
najbliższe temu samemu licznikowi mają tę samą wartość (17 liczników, 16 różnych wartości w pliku,
bo Smoleńsk i Armii Krajowej mają po 780).

**Kierunek „więcej = lepiej”** i skala 0–2 000. Intensywny ruch rowerowy w okolicy oznacza, że trasy
są używane i połączone w sieć; to nie jest ocena bezpieczeństwa ani wygody, o czym mówi `opis` w
metadanych. Średnie liczników to 680–2 220 rowerów/dobę, a 2 000 odpowiada „bardzo ruchliwej trasie”
(Mogilska, Dworzec Główny). Wagę w ocenie ustala integrator (zob. Ograniczenia).

## Liczniki w zrzucie 2026-10-03

| Licznik | Średnia (zaokr. do 10) | Rok pomiaru | Adresów |
|---|---|---|---|
| Mogilska | 2 220 | 2025-09-01 – 2026-08-31 | 858 |
| Dworzec Główny | 1 970 | 2025-09-01 – 2026-08-31 | 800 |
| Kotlarska | 1 860 | 2025-09-01 – 2026-08-31 | 91 |
| Grzegórzecka | 1 780 | 2025-09-01 – 2026-08-31 | 476 |
| Monte Cassino | 1 660 | 2025-09-01 – 2026-08-31 | 1 061 |
| Kopernika | 1 570 | 2025-09-01 – 2026-08-31 | 290 |
| Bulwary | 1 560 | 2025-09-01 – 2026-08-31 | 922 |
| Tyniecka | 1 360 | 2025-09-01 – 2026-08-31 | 634 |
| Wadowicka | 1 320 | 2025-09-01 – 2026-08-31 | 520 |
| Klimeckiego | 1 190 | 2025-09-01 – 2026-08-31 | 580 |
| Wielicka | 1 100 | 2025-09-01 – 2026-08-31 | 462 |
| Kamieńskiego | 960 | 2025-09-01 – 2026-08-31 | 327 |
| Smoleńsk | 780 | 2025-07-14 – 2026-07-13 | 1 466 |
| Armii Krajowej | 780 | 2025-09-01 – 2026-08-31 | 1 679 |
| Nowohucka | 770 | 2025-09-01 – 2026-08-31 | 558 |
| Niepołomska | 750 | 2025-09-01 – 2026-08-31 | 153 |
| Bora-Komorowskiego | 680 | 2025-01-08 – 2026-01-07 | 490 |

**Odpadają Brożka i Nawojki.** Uruchomione jesienią 2025 (pierwsze odczyty 2025-11-20 i
2025-12-13), mają 285 i 260 dni z odczytem w ostatnich 365 dniach, czyli mniej niż 329. Nie mają
też położenia w żadnym otwartym źródle (warstwa MSIP ma 17 z 19 liczników; w OSM liczników rowerowych
Małopolski brak), więc nie dałoby się ich umieścić na mapie bez zgadywania. Wejdą po dopisaniu
punktów do ewidencji ZTP i po pełnym roku pomiarów.

**Sezon.** Latem (czerwiec – sierpień) liczniki notują średnio 4,0 razy więcej rowerów niż zimą
(grudzień – luty): od 2,2 razy na Grzegórzeckiej do 13 razy na Niepołomskiej, a na Bulwarach 7,6.
Średnia roczna zasłania ten rozstęp, dlatego `opis` karty o nim mówi.

## Kontrole (zrzut 2026-10-03)

- **Układ współrzędnych.** Położenia liczników w EPSG:2178 (z MSIP) przeliczone proj4 do WGS84
  zgadzają się z położeniami, które serwer MSIP zwraca dla `outSR=4326`, z dokładnością 0,01 m
  (17 liczników). Adresy idą do EPSG:2178 tym samym proj4, więc to sprawdza spójność obu stron.
- **Odległości.** Dla 11 367 adresów w zasięgu odległość w EPSG:2178 różni się od odległości po
  elipsoidzie GRS80 liczonej z długości i szerokości geograficznej (`odlegloscElipsoidyM`, niezależnej
  od rzutowania) najwyżej o 0,02 m. Haversine na kuli dałby tu 3 m błędu na kilometr, więc nie
  nadaje się do tej kontroli.
- **Wybór licznika.** 804 adresy (co ok. 220.) sprawdzone drugim sposobem, pełnym sortowaniem
  odległości do wszystkich liczników: zgodne.
- **Położenie względem infrastruktury (uzgodnienie z #119).** Warstwa 5 ZTP (30 608 odcinków
  ciągów rowerowych, te same dane co `rower_infrastruktura_odleglosc`): 17 z 17 liczników leży
  w ≤ 30 m od linii, najdalsze w 3–4 m (Klimeckiego, Kamieńskiego, Dworzec Główny). Położenia ze
  statusem „niezinwentaryzowano” są więc wiarygodne w skali, która ma znaczenie przy promieniu 1 km.
- **Tabela kontra widgety ZTP.** Suma od początku 2026 roku z widgetów Eco-Counter (stan 2026-10-02)
  minus suma z tabeli do 31.08 daje średnie dobowe z 1 września – 2 października, które na 14 z 15
  liczników z danymi do końca tabeli mieszczą się w 1,0–1,3 razy średniej z września 2025 z tabeli
  (odstaje tylko Grzegórzecka: 0,72). Dla Bora-Komorowskiego różnica to 0 (licznik nie nadaje), dla
  Smoleńska widget ma o 40,8 tys. więcej niż tabela do 13 lipca, więc w tabeli brakuje odczytów po tej
  dacie, a licznik nadal liczył.
- **Rozkład.** Wartości p5 = 750, p25 = 780, p50 = 1 190, p75 = 1 660, p95 = 2 220 rowerów/dobę;
  odległość do licznika p5 = 194 m, p50 = 663 m, p95 = 968 m.
- **Miejsca znane** (najbliższy adres w bazie, etykieta z pliku): Rynek Główny 3 – 780, licznik
  Smoleńsk, 920 m; Dworzec Główny (Pawia 5A) – 1 970, licznik Dworzec Główny, 350 m; Rondo
  Mogilskie 1 – 1 570, licznik Kopernika, 140 m; Krakowska 3 (Plac Nowy) – 1 660, licznik Monte
  Cassino, 940 m; Rynek Podgórski (Parkowa 4) – 1 100, licznik Wielicka, 910 m. Bez licznika w 1 km:
  Salwator, Nowa Huta (Osiedle Centrum C 1), Wola Justowska, Prokocim oraz Wieliczka, Skawina
  i Niepołomice (rynek).
- **Testy:** 15 w `etl/liczniki-rowerowe.test.mjs` (`node --test etl/liczniki-rowerowe.test.mjs`):
  parser CSV, odrzucanie kolumn pogodowych i złego formatu, okno 365 dni z granicami, zera jako awaria,
  próg kompletności, nieaktualny licznik, łączenie nazw, promień włącznie, zaokrąglenia i etykiety,
  zgodność EPSG:2178 z elipsoidą oraz spójność opublikowanego pliku (wersja adresów, brak zer,
  każdy licznik ma jedną wartość, obwarzanek bez danych).

## Ograniczenia

- **Pokrycie 16% Krakowa.** 17 liczników stoi na głównych trasach, głównie w pierścieniu wokół
  centrum, więc w promieniu 1 km jest ich dla co szóstego adresu. Szara kategoria (`null`) znaczy
  „żaden licznik w 1 km”, nie „nikt tu nie jeździ”. Większy promień zwiększyłby pokrycie kosztem
  wiarygodności: ruch na ulicy 2 km dalej nie mówi nic o okolicy adresu.
- **Jedna policzona ulica.** Licznik mierzy przekrój jednej trasy, a adres może leżeć po drugiej
  stronie Wisły albo torowiska. Wartość opisuje intensywność jazdy w okolicy, nie komfort ani
  bezpieczeństwo.
- **Wybór miejsc przez ZTP.** Liczniki stoją tam, gdzie ruch jest duży, więc średnie są zawyżone
  względem całego miasta. Wskaźnik porównuje okolice liczników między sobą, nie z miastem bez liczników.
- **Okna niejednolite.** Smoleńsk i Bora-Komorowskiego mają rok kończący się wcześniej niż reszta
  (zob. Definicja); to różnica pory pomiaru, nie sezonu, bo wszystkie okna mają pełne 12 miesięcy.
  Ruch rowerowy zmienia się z roku na rok o kilkanaście procent, więc różnice rzędu 10% między
  licznikami nie są istotne.
- **Zaokrąglenie do 10** w wartości i do 10 m w etykiecie: położenia ZTP nie są inwentaryzowane w terenie.
- **Waga w ocenie.** Wskaźnik jest w manifeście (`/dane/manifest.json`), ale wagi w
  `src/wynik/persony.ts` i temat „rower” w `src/ai/zapytajOAdres.ts` trzeba dopisać osobno
  (tory karta i ai); do tego czasu nie wpływa na ocenę. Warstwa AI czyta etykiety bez słownika, dlatego
  etykiety są pełnym tekstem, nie kluczami. Plik ma ok. 2,0 MB (etykiety dla co szóstego adresu Krakowa).

## Czego nie ma i dlaczego

- **Ciągi rowerowe ważone licznikami** (druga wersja z issue). Przypisanie ruchu do odcinków
  infrastruktury z #119 wymagałoby modelu (jak daleko i na które odcinki rozciągać pomiar jednego
  licznika), a danych do jego kalibracji nie ma: jest 17 punktów i żadnego pomiaru poza nimi.
  Zostaje wersja z najbliższym licznikiem, w której każda liczba jest pomiarem.
- **Brożka i Nawojki** – zob. wyżej.
- **Zima jako osobny wskaźnik.** Ruch grudzień – luty dobrze oddaje jazdę użytkową (dojazdy), bo
  rekreacyjna zimą zamiera; to prosta, tania warstwa na tych samych danych (`srednieZima` jest już
  liczone), ale wymaga decyzji, czy wskaźnik ma opisywać lato, rok czy zimę.
