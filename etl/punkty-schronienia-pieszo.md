# Punkt Schronienia – czas dojścia pieszo (#65, kontynuacja #25)

`node etl/punkty-schronienia-pieszo.mjs` (po `node etl/punkty-schronienia.mjs`) zapisuje
`public/dane/wskazniki/punkt_schronienia_pieszo_min.json`: czas dojścia pieszo w minutach z adresu
w gminie Kraków do najbliższego **po sieci** Punktu Schronienia KG PSP. Nazwa „Punkt Schronienia”
zostaje; znaczenie punktów opisuje `etl/punkty-schronienia.md` (to nie są potwierdzone schrony).

## Metoda

- **Sieć piesza:** OpenStreetMap przez Overpass API (`maps.mail.ru`, bo `overpass-api.de` i
  Geofabrik zrywały połączenie przy pobieraniu), 64 kafle na obszarze 49,955–50,145 N,
  19,77–20,24 E, buforowane w `etl/.cache/siec-piesza/`. Brane są drogi `highway` dostępne pieszo:
  chodniki, ścieżki, schody, deptaki, drogi lokalne do `primary`, `track`, `cycleway`, `trunk_link`.
  Wyłączone: `motorway`, `trunk` (S7, S52, obwodnica), `access=private|no`, `foot=no|private`,
  `area=yes`. Dzięki temu Wisła, tory i drogi ekspresowe są przekraczane tylko mostem, kładką,
  przejściem albo tunelem, które są w OSM. Licencja OSM: ODbL 1.0.
- **Graf:** nieskierowany, węzły OSM wspólne na skrzyżowaniach; krawędzie dłuższe niż 25 m dzielone,
  żeby najbliższy węzeł był blisko adresu. Zrzut 2026-10-04: 186 639 dróg, 915 521 węzłów;
  dowiązujemy tylko do głównej spójnej składowej (899 921 węzłów), żeby odcięte kawałki sieci
  (np. wewnętrzne ścieżki osiedla bez połączenia w OSM) nie dawały fałszywego braku trasy.
- **Dojście do wejścia:** katalog KG PSP nie podaje wejść, więc współrzędne punktu traktujemy jako
  wejście. Punkt i adres łączymy z siecią odcinkiem prostym do najbliższego węzła, najwyżej 300 m.
  Dowiązano 2 994 z 3 008 punktów; 14 leży dalej niż 300 m od sieci i nie jest źródłem.
- **Wielozródłowy Dijkstra** od wszystkich punktów naraz (odległość startowa = dojście do węzła).
  Czas = (dojście z adresu + trasa) / prędkość. **Prędkość 4,5 km/h** (75 m/min), zapisana w
  `meta.predkoscKmH`; bez kar za schody, światła i wzniesienia.
- **Brak trasy = `null`, nigdy 0:** adresy poza gminą Kraków, dalej niż 300 m od sieci albo bez
  połączenia z żadnym punktem. Pokrycie: 70 215 adresów Krakowa (z 70 217 mających odległość
  geodezyjną), 39,7% kontraktu.
- Meta jak w warstwie odległości po `etl/uprosc-kryteria.mjs`: `bezpieczenstwo`, `mniej-lepiej`,
  `domyslnaWaga: 0`. Etykieta = najbliższy po sieci punkt (krótki klucz → `slownikEtykiet`).

Wynik (2026-10-04): mediana 5,5 min, 90. percentyl 29,6 min, maksimum 133,0 min (Nowa Huta,
ul. Dybowskiego – teren kombinatu i dróg ekspresowych, 4,1 km prosto). Stosunek trasy do
odległości prostej do najbliższego punktu: mediana 1,6, 90. percentyl 2,8.

## Przykłady z barierą (weryfikacja)

Bariera sprawdzona przecięciem odcinka prostego adres → punkt z geometrią OSM
(`railway`, `motorway|trunk`, `waterway`). „Prosto” = odległość geodezyjna do najbliższego punktu
z warstwy `punkt_schronienia_odleglosc` podzielona przez 4,5 km/h.

| Adres | Bariera | Prosto | Prosto / 4,5 km/h | Pieszo po sieci | Razy |
|---|---|---|---|---|---|
| Wielkanocna 54 (VIII Dębniki) | Wisła – najbliższy punkt w linii prostej (OZO-78F4C2B90BDA, ul. Gajówka 11, Zwierzyniec) jest na drugim brzegu; trasa wybiera punkt na tym samym brzegu (OZO-823F93DDD90B, ul. Ćwikłowa 20) | 859 m | 11,5 min | 40,3 min (≈ 3,0 km) | 3,5× |
| Henryka Sucharskiego 121 (XII Bieżanów-Prokocim) | tory – linie kolejowe 91 i 100 (Mała Obwodnica) oraz potok Serafa między adresem a punktem OZO-73AC879EEB41 | 195 m | 2,6 min | 14,6 min (≈ 1,1 km) | 5,6× |
| Wiesława Zarzyckiego 22 (XII Bieżanów-Prokocim) | droga – S7 (motorway) między adresem a punktem OZO-8F9D2DD5F28C; trasa przez najbliższe przejście | 401 m | 5,3 min | 22,6 min (≈ 1,7 km) | 4,2× |

Te same zjawiska na sieci syntetycznej (rzeka z jednym mostem, wybór punktu po sieci zamiast w linii
prostej, brak trasy = `null`) sprawdza `etl/punkty-schronienia-pieszo.test.mjs`.

## Ograniczenia

Jakość zależy od kompletności OSM: brakujące przejście czy chodnik wydłuża trasę, a ścieżka
nieoznaczona jako zamknięta może ją skrócić. Nie uwzględniamy bram osiedli zamykanych w nocy, wind,
schodów jako przeszkody, czasu oczekiwania na światłach ani rzeczywistego wejścia do obiektu.
Wartość to orientacyjny czas dojścia, nie gwarancja dostępności punktu.
