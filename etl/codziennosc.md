# Codzienność wokół adresu (zadanie #8)

Uruchom `node etl/codziennosc.mjs` z katalogu projektu. Skrypt pobiera dane źródłowe do `etl/.cache` i zapisuje siedem warstw w `public/dane/wskazniki`. Cache nie jest częścią repozytorium. Przy aktualizacji źródła usuń odpowiedni plik cache wraz z pochodnym `osm-codziennosc.json`, a następnie uruchom ETL ponownie.

## Źródła i metoda

| Warstwa | Źródło | Wybór punktów |
| --- | --- | --- |
| `sklep_odleglosc` | [OpenStreetMap, ekstrakt Małopolski z Geofabrik](https://download.geofabrik.de/europe/poland/malopolskie.html), stan ekstraktu 2026-10-02 | `shop=supermarket`, `convenience`, `greengrocer`, `bakery`, `butcher`; węzły i środki linii |
| `apteka_odleglosc` | [Rejestr Aptek Centrum e-Zdrowia](https://rejestry.ezdrowie.gov.pl/ra/search/public) | aktywne apteki ogólnodostępne i punkty apteczne bez czasowego zamknięcia; adres geokodowany przez GUGiK UUG |
| `szkola_podst_odleglosc`, `przedszkole_odleglosc` | [SIO, wykaz z 30.09.2025](https://dane.gov.pl/pl/dataset/839,wykaz-szkol-i-placowek-oswiatowych) | szkoły podstawowe publiczne, przedszkola i punkty przedszkolne oraz oddziały przy szkołach; bez placówek specjalnych; adresy geokodowane |
| `zlobek_odleglosc` | [Rejestr żłobków i klubów dziecięcych](https://dane.gov.pl/pl/dataset/29751,rejestr-zlobkow-lista-instytucji) | bez zawieszonej działalności; współrzędne rejestru, a przy ich braku geokodowanie adresu |
| `przychodnia_odleglosc` | [RPWDL](https://dane.gov.pl/pl/dataset/728,rejestr-podmiotow-wykonujacych-dzialalnosc-lecznicza) | adresy *komórek organizacyjnych* o kodzie VIII `0010` (gabinet lekarza POZ), bez zakończonej działalności; geokodowane przez GUGiK UUG |
| `uslugi_15min` | powyższe oraz OSM | liczba spośród 10 typów usług w promieniu 1200 m |

Punkty OSM pochodzą z ekstraktu Geofabrik, który udostępnia dane autorów OpenStreetMap. **© OpenStreetMap contributors**, [Open Database License (ODbL) 1.0](https://www.openstreetmap.org/copyright). Nazwy i tagi OSM zależą od wpisów społeczności i mogą być niepełne lub nieaktualne. Metadane pozostałych źródeł są zapisane w każdym wynikowym JSON.

Odległość do punktu jest mierzona po powierzchni Ziemi w linii prostej. `uslugi_15min` zachowuje identyfikator kontraktowy, lecz jego widoczna nazwa to „Rodzaje usług w promieniu 1,2 km”. **Nie mierzy czasu ani trasy pieszej.** Budynki, rzeki, przejścia i wejścia do lokali mogą wydłużyć drogę. W przypadku obiektów OSM zapisanych jako linie używamy średniej współrzędnych węzłów jako przybliżenia położenia, a nie wejścia do budynku.

Importer bierze punkty z prostokąta 49,84–50,30°N i 19,58–20,46°E, z marginesem wokół Krakowa i sąsiednich gmin. Gdy nie ma punktu w odległości 15 km, odległość jest `null`; zero oznacza punkt w miejscu adresu. Wynik z rejestru świadczy o wpisie placówki, lecz sam nie potwierdza godzin otwarcia, miejsc w placówce, obwodu szkolnego, umowy z NFZ ani dostępności wizyty. Pełne wartości dla wszystkich 176 684 adresów znaczą, że znaleziono najbliższy zarejestrowany punkt, a nie że rejestr ma pełne pokrycie terenu.

## Kontrola wyniku z bieżącego zestawu

Ekstrakt OSM z 2026-10-02 daje 2738 punktów sklepowych w obszarze. Dla 176 684 adresów mediana odległości do sklepu wynosi 388 m, maksimum 4206 m. Liczby służą jako kontrola reprodukcji tego zestawu, nie jako stałe progowe modelu. Przy aktualizacji źródeł porównaj liczbę punktów, pokrycie, rozkład odległości i daty w metadanych przed zatwierdzeniem danych.
