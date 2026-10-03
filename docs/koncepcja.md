HackYeah 2026 · Smart City · burza mózgów

# Pod Adresem

Jeden wynik jakości życia dla każdego adresu w Polsce, złożony z kilkunastu kategorii i kilkudziesięciu rejestrów publicznych. Na start mapa Polski jako heatmapa, a po wpisaniu adresu lot kamerą w dół i miasto, które buduje się w 3D z prawdziwych budynków.

Makieta wejścia. W aplikacji adres trafia do geokodera, a mapa przybliża się do punktu.

1. **Mapa Polski**Heatmapa score na siatce heksów, gęstsza w miastach.
2. **Adres albo klik**Geokodowanie po punktach adresowych PRG lub kliknięcie mapy.
3. **Lot kamery**Płynny zoom z kraju do ulicy, warstwy ładują się w trakcie.
4. **Miasto w 3D**Jeśli są dane: budynki GUGiK, przystanki, inwestycje, zieleń.
5. **Karta adresu**Score ogólny, kategorie i powód każdej oceny ze źródłem.

Model wyniku

## Jak liczyć jeden score z kilkunastu kategorii

Score ogólny od 0 do 100 to średnia ważona kategorii. Każda kategoria składa się z 1–3 warstw. Poniżej przykładowa karta i cztery sposoby ustalania wag do wyboru.

dane przykładowe

ul. Grodzka 52, Kraków

**71**/ 100 · lepiej niż 68% adresów w Polsce

### Stałe wagi

Zespół ustala wagi raz, dla wszystkich.

**Plus:** prosty ranking i porównania.

**Minus:** student i emeryt dostają ten sam wynik.

### Profile życiowe

Rodzina z dziećmi, senior, student, pracujący zdalnie, kierowca. Każdy profil ma swoje wagi.

**Plus:** jeden klik, dużo trafniej.

**Minus:** profile trzeba uzasadnić.

### Suwaki użytkownika

Użytkownik ustawia, co jest dla niego ważne, a mapa przelicza się na żywo.

**Plus:** najmocniejszy efekt na demo.

**Minus:** heatmapę trzeba liczyć w przeglądarce.

### Percentyle zamiast norm

Każda warstwa jako miejsce w rozkładzie krajowym, a nie ocena w skali „dobre / złe”.

**Plus:** łatwo obronić przed zarzutem arbitralności.

**Minus:** 80. percentyl smogu w Polsce to wciąż smog.

**Pokrycie danych**Każdy wynik ma pasek pewności. Brak danych to szara kategoria, nigdy zero.

**Uczciwa rozdzielczość**Przy każdej warstwie widać, czy dotyczy adresu, heksu 200 m, czy całej gminy.

**Każda liczba klikalna**Kliknięcie oceny pokazuje wzór, surową wartość i link do rejestru.

20 propozycji warstw

## Z czego zbudować score

Każda warstwa łączy kilka źródeł. Tagi pokazują rozdzielczość i trudność na hackathon. Filtruj po kategorii.

adres punkt lub budyneksiatka heks lub okolicagmina cała gminałatwe średnie trudne w 24 h

Podejścia do stacka

## Cztery drogi do mapy, która zamienia się w miasto 3D

Wszystkie korzystają z aktualnych wersji bibliotek. Przed startem sprawdź numery wersji i zgodność z WebGPU w docelowej przeglądarce.

A · polecane na start

### Mapa + warstwa Three.js

MapLibre GL JS\
deck.gl (H3HexagonLayer, warstwy 3D)\
Three.js w custom layer MapLibre\
PMTiles jako kafle

- Płynne przejście z 2D do 3D w jednej kamerze
- Gotowy zoom, kafle, geokodowanie
- Heatmapa milionów heksów bez problemu

Kiedy: chcesz działającej mapy w godzinę i efektu 3D na wierzchu.

B · najwięcej realizmu

### Glob i 3D Tiles

CesiumJS\
albo 3d-tiles-renderer (NASA-AMMOS) w Three.js\
budynki GUGiK przerobione na 3D Tiles

- Prawdziwa kula ziemska i teren
- Strumieniowanie budynków dla całego kraju
- Konwersja danych GUGiK zajmie czas

Kiedy: zależy Ci na efekcie „cały kraj w 3D” i masz osobę od danych.

C · styl gry

### Czysty Three.js z WebGPU

Three.js WebGPURenderer + TSL\
React Three Fiber + drei\
postprocessing (bloom, scanlines)\
Theatre.js lub GSAP do kamery

- Pełna kontrola nad wyglądem hologramu
- Najmocniejszy efekt wow
- Kafle mapy, zoom i projekcję piszesz sam

Kiedy: zespół zna Three.js, a mapa może być stylizowana, nie dokładna.

D · hybryda

### Mapa do lotu, scena do miasta

MapLibre do widoku kraju i zoomu\
przejście w osobną scenę R3F po dolocie\
wspólne współrzędne w metrach (EPSG:2180)

- Mapa robi to, w czym jest dobra
- Miasto ma pełną swobodę stylu
- Przejście między nimi trzeba dopracować

Kiedy: chcesz wyglądu z C bez pisania mapy od zera.

Dane i backend

### Warianty potoku danych

| Element | Wariant lekki | Wariant pełny | Uwagi |
| --- | --- | --- | --- |
| Przeliczenia | DuckDB z rozszerzeniem spatial, pliki GeoParquet | PostgreSQL + PostGIS + h3-pg | DuckDB liczy wszystko na laptopie, bez serwera |
| Siatka | Heksy H3, rozdzielczość 8 dla kraju | H3 rozdzielczość 9–10 w miastach | Score liczony wcześniej dla każdego heksu |
| Kafle mapy | PMTiles z Tippecanoe, hosting statyczny | Martin lub pg_tileserv z bazy | PMTiles nie potrzebuje serwera kafli |
| Geokodowanie | Punkty adresowe PRG (GUGiK) w pliku | Photon lub Nominatim z danymi PRG | PRG to oficjalny rejestr wszystkich adresów |
| Budynki 3D | Obrysy BDOT10k lub OSM z wysokością | Modele LOD1/LOD2 z GUGiK jako 3D Tiles | Na demo wystarczą wyciągnięte obrysy |
| Dane gmin | API z-dykty (JSON, CORS) | Własna kopia rejestrów z-dykty | Klucz TERYT łączy wszystko |
| Frontend | Vite + React lub Svelte | Next.js lub SvelteKit z SSR kart adresu | SSR daje linki do udostępniania z podglądem |

Biblioteki z gier i grafiki

### Co dorzucić dla efektu

**Three.js WebGPURenderer + TSL**Shadery hologramu, poświata i linie skanowania pisane w JavaScripcie.

**@react-three/postprocessing**Bloom, aberracja chromatyczna, winieta jednym komponentem.

**Theatre.js**Reżyseria lotu kamery na osi czasu, jak w silniku gry.

**GSAP**Animacja liczb score, kart i przejść interfejsu.

**three-mesh-bvh**Szybkie trafianie myszą w tysiące budynków.

**InstancedMesh / BatchedMesh**Tysiące budynków i przystanków w jednym wywołaniu rysowania.

**Babylon.js lub PlayCanvas**Alternatywne silniki z WebGPU, jeśli zespół je zna.

**deck.gl TripsLayer**Animowane ślady tramwajów i autobusów z GTFS.

Burza mózgów · runda 1 i 2

## Nietypowe połączenia danych

Pomysły, których nie mają serwisy z ogłoszeniami ani mapy. Werdykt na zielono: bierzemy, na żółto: warunkowo, na czerwono: odpada. Dostępność zbiorów do sprawdzenia.

Tryby życiowe

### Ten sam adres, inne pytanie

AI, które robi robotę

### Modele językowe jako narzędzie, nie czat

Design i UX

### Rozwiązania, które wyróżnią projekt

Pytanie, które padnie

## Etyka score

Ryzyko: wynik stygmatyzuje biedniejsze osiedla, obniża ceny i przyspiesza gentryfikację. Odpowiedź projektu:

**Bez przestępczości per adres**Bezpieczeństwo tylko na poziomie gminy lub komendy.

**Inwestycje obok jakości**Pokazujemy, ile miasto inwestuje w okolicę, a nie tylko, jak w niej jest.

**„Co by to zmieniło”**Każda niska ocena ma przycisk z kosztem poprawy.

**Panel dla gminy**Burmistrz widzi, które warstwy obniżają wynik. Ranking staje się narzędziem naprawy.

Po dwóch burzach

## Nowa wersja koncepcji

| Element | Co to jest | Dlaczego wyróżnia |
| --- | --- | --- |
| Wejście | Adres albo opis potrzeb plus tryb życiowy | Każdy dostaje wynik dopasowany do siebie |
| Mapa | Heatmapa Polski przeliczana na żywo, mgła wojny tam, gdzie brakuje danych | Uczciwość wobec danych językiem gier |
| Miasto | Lot do Krakowa w 3D, suwaki godziny, pory roku i roku 2030, ślady spaceru z drzwi | Słońce, cień i przyszłość widać, a nie tylko czytać |
| Wynik | Etykieta adresu A–G oraz złotówki i godziny rocznie | Format, który każdy zna, i waluta, którą każdy rozumie |
| Działanie | Strażnik uchwał, przeprowadzka za granicę gminy, wskazówka o PIT | Aplikacja mówi, co zrobić |
| Pitch | QR dla jury, slajd o etyce i panelu dla gmin | Projekt ma życie po hackathonie |

**Lista cięć**Prognoza cen mieszkań, czat jako główna funkcja, profil polityczny ulicy, dźwięk okolicy na scenie, świecące urzędy, przestępczość per adres, ciężarówki jako osobna warstwa.

**Do sprawdzenia rano**Otwartość zgłoszeń mieszkańców w Krakowie, dostęp do CEEB i inwentaryzacji UKE per adres, publiczny wykaz miejsc schronienia, możliwość zgłoszenia do dwóch kategorii.

Do rozstrzygnięcia

## Otwarte pytania

**Score dla adresu czy dla heksu?**Większość danych jest na poziomie gminy. Uczciwiej liczyć heks 200 m i dziedziczyć wartości gminne.

**Które miasta dostają 3D?**Na demo 1–3 miasta, np. Kraków. Reszta kraju zostaje heatmapą z kolumnami.

**Jak pokazać brak danych?**Szara kategoria i niższa pewność wyniku, żeby małe gminy nie dostawały kary za brak rejestrów.

**Profile czy suwaki?**Profile są szybsze w użyciu, suwaki lepsze na scenie. Można dać profile z opcją „dostosuj”.

**Co z rankingiem gmin?**Ranking przyciąga media, ale też pretensje burmistrzów. Potrzebna strona z metodą.

**Dane na żywo czy przeliczone?**Transport i smog na żywo wyglądają dobrze, ale score lepiej liczyć raz dziennie.

Cięcie na 24 h

### Co pokazać jury

- Heatmapa Polski na heksach H3 z 6–8 łatwych warstw i mgłą wojny tam, gdzie brakuje danych.
- Adres z hali, lot kamery do Krakowa, budynki 3D.
- Suwak: grudzień 16:00, cień zakrywa okno. Suwak: 2030, wyrasta blok obok.
- Etykieta adresu A–G oraz „ten adres kosztuje Cię X zł i Y godzin rocznie”.
- Jedna prawdziwa uchwała w strażniku uchwał i QR, przez który jury sprawdza własne adresy.
- Pozostałe warstwy jako roadmapa na jednym slajdzie.

Szkic do burzy mózgów. Nazwa robocza, dane na karcie przykładowe. Dostępność, licencje i formaty zbiorów trzeba sprawdzić przed startem.