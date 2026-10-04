# Czas dojazdu do lotniska Balice (#38)

`node etl/dojazd-gtfs.mjs 2026-10-07` przelicza `public/dane/wskazniki/lotnisko_czas_min.json`
dla wyjścia z punktu adresowego o 07:00 w środę 2026-10-07 (Europe/Warsaw). Bez argumentu daty
ETL wybiera następny dzień roboczy. Wynik to planowy czas do jednego ze stanowisk autobusowych
**Kraków Airport** z danych ZTP, nie do drzwi terminala. `null` oznacza, że model nie znalazł
trasy do 14:00 lub punkt adresowy leży poza zasięgiem dojścia do przystanku. Nie jest to zero.

Źródłem są trzy aktualne archiwa [GTFS ZTP Kraków](https://gtfs.ztp.krakow.pl/): A, M i T.
ETL uwzględnia `calendar.txt`, wyjątki `calendar_dates.txt`, kursy `trips.txt`, stanowiska
`stops.txt` i czasy `stop_times.txt`. `pickup_type=1` wyklucza wsiadanie, `drop_off_type=1`
wyklucza wysiadanie. Wersje i wydawcy pochodzą z `feed_info.txt`, daty publikacji z nagłówka
`Last-Modified`; plik wynikowy zapisuje daty pobrania i URL-e. Pobrane ZIP-y i ich SHA-256 są
przechowywane w ignorowanym przez Git `etl/.cache/`. W warstwie publikujemy wyłącznie pochodny
czas, bez surowego rozkładu.

Algorytm liczy najwcześniejszy przyjazd dla każdej minuty i stanowiska, skanując aktywne kursy
od końca dnia. Pozwala czekać na kurs, pozostać w tym samym pojeździe i przesiąść się. Przy
przesiadce dodaje co najmniej 2 min; inne stanowisko jest dostępne w promieniu 350 m. Dojście
z adresu do stanowiska do 1,2 km i między stanowiskami liczono po **linii prostej**, przy
1,25 m/s. To nie jest routing po chodnikach, więc czas może być zaniżony w miejscach z barierami
(rzeka, tory, ogrodzenia) i zawyżony przez zaokrąglenie do pełnej minuty. Nie uwzględnia ruchu,
opóźnień, faktycznego wykonania kursu ani dostępności pojazdu. Plik obowiązuje tylko dla daty
rozkładu podanej w metadanych; wymaga ponownego ETL przy zmianie feedu.

Kontrola dla danych z 2026-10-03: 160 487/176 684 adresów ma wartość, mediana 70 min, p95 120 min;
Rynek Główny 10 ma 40 min, bliskie lotnisku adresy 1 min. Zakres 1–304 min. Miejsca bez trasy
w modelu: 16 197 adresów, w tym gminy na obrzeżach z dojściem dalszym niż 1,2 km. Każdy adres
dziedziczy tę samą wersję identyfikatorów co `adresy.json`.
Skala punktacji powstaje z 5. i 95. percentyla wartości, bez deklarowanego sztywnego zakresu;
surowe czasy powyżej percentyla pozostają dostępne na karcie.

Silnik przyjmuje również współrzędne dowolnego celu:

```sh
node etl/dojazd-gtfs.mjs 2026-10-07 19.9366 50.0614
```

Wtedy tworzy lokalny `etl/.cache/dojazd_cel.json`, który **nie jest częścią manifestu** i
nie powinien być commitowany jako ogólny wskaźnik. Nie wolno podpisywać statycznego wyniku dla
lotniska jako czasu do adresu wybranego przez użytkownika – do tego służy graf niżej (#85).

## Cel wybrany przez użytkownika (#85)

`node etl/dojazd-gtfs-graf.mjs 2026-10-07 5-23` zapisuje `public/dane/dojazd/graf.json`:
przystanki z odjazdami w oknie 05:00–23:00 wybranego dnia i kursy zakodowane deltami
(`[przystanek, Δprzyjazd, postój, flagi wsiadania/wysiadania]`), bez identyfikatorów kursów
i nazw linii. Rozmiar dla 2026-10-07: 3903 stanowiska, 16 117 kursów, 355 263 zdarzeń –
3,9 MB, ok. 0,6 MB gzip. Plik pobiera dopiero worker po wybraniu celu w lewym panelu
(`src/karta/panel/PanelDojazdu.tsx`, silnik `src/wynik/dojazdCel.ts`). Liczenie w przeglądarce
nie pośredniczy w żadnej usłudze miasta – korzysta z pochodnego, statycznego pliku.

Silnik liczy ten sam profil co wyżej, ale odwrotnie od celu i tylko dla jednej godziny wyjścia
(pełne godziny 05:00–21:00) z limitem podróży 2 h: raz na (cel zaokrąglony do 0,001°,
godzina) – ok. 50 ms – i trzyma 8 ostatnich profili w cache. Potem czas z adresu to kilka
przystanków w promieniu 1,2 km; liczony wyłącznie dla adresu wybranego na mapie i heksów
w porównaniu (maks. 64 punkty na zapytanie), nigdy dla 176 tys. adresów. Parametry jak wyżej:
dojścia i przesiadki po prostej, 1,25 m/s, przesiadki do 350 m i min. 2 min. Brak trasy w 2 h
lub brak przystanku w zasięgu = `null` (w UI „brak trasy”, szare), nie zero. Panel pokazuje
datę rozkładu, daty feedów i te założenia. Przy zmianie feedu trzeba ponownie uruchomić ETL.

ZTP [określa GTFS jako dane otwarte](https://ztp.krakow.pl/wszystkie-aktualnosci/dane-otwarte/sprawdz-przystanki-infrastrukture-rowerowa-i-parkingi-pr-czyli-otwarte-dane.html).
Publikując wynik, podajemy źródło, daty i metodę przetworzenia zgodnie z
[warunkami ponownego wykorzystania informacji GMK](https://bip.krakow.pl/?dok_id=48482).
Warunki wskazują także ograniczenia odpowiedzialności miasta oraz możliwe prawa osób trzecich.

## Rynek Główny (#60)

`node etl/dojazd-gtfs.mjs 2026-10-07 --rynek` zapisuje
`public/dane/wskazniki/rynek_czas_min.json` dla tego samego rozkładu i godziny wyjścia 07:00.
Cel to **punkt na Rynku Głównym: 50.0617°N, 19.9373°E**. Po wysiadaniu z pojazdu model
dolicza dojście ze stanowiska GTFS do tego punktu; dla adresów w promieniu 1,2 km porównuje
również bezpośredni marsz. Pozostałe parametry są takie jak wyżej: dojścia i przesiadki po
prostej, 1,25 m/s, co najmniej 2 min na przesiadkę, najpóźniejszy przyjazd 14:00.

To statyczny, **planowy** czas podróży przy wyjściu 07:00 w konkretnym dniu, a nie czas
aktualnej podróży ani trasa piesza po chodnikach. Rzeka, tory, przejścia dla pieszych i inne
bariery mogą wydłużyć rzeczywisty marsz. Wynik `null` oznacza brak znalezionej trasy w modelu
(w tym brak stanowiska w promieniu 1,2 km), nie zerowy czas. `rynek_czas_min` nie deklaruje
sztywnego zakresu 0–120 min; surowe wartości pozostają dostępne dla karty adresu.

Kontrola przeliczenia z 2026-10-03 dla rozkładu 2026-10-07: 160 487/176 684 adresów
z wartością (90,8%), 16 197 `null`; mediana 56 min, p95 95 min, zakres 1–342 min.
Przykładowe wyniki: Rynek Główny 10 – 2 min pieszo, Floriańska 1 – 3 min pieszo,
Bronowicka 104 – 25 min, Wielicka 256 – 51 min. Wersja identyfikatorów adresów jest taka
sama jak w `adresy.json`; te przykłady kontrolują orientacyjnie logikę, nie są pomiarem
rzeczywistej podróży.
