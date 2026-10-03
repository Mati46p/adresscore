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
nie powinien być commitowany jako ogólny wskaźnik. Do interaktywnego celu wybranego przez
użytkownika potrzeba osobnego API/cache obliczeń i widoku; obecny kontrakt statycznych plików
nie przenosi parametrów celu. Nie wolno podpisywać statycznego wyniku dla lotniska jako czasu
do adresu wybranego przez użytkownika.

ZTP [określa GTFS jako dane otwarte](https://ztp.krakow.pl/wszystkie-aktualnosci/dane-otwarte/sprawdz-przystanki-infrastrukture-rowerowa-i-parkingi-pr-czyli-otwarte-dane.html).
Publikując wynik, podajemy źródło, daty i metodę przetworzenia zgodnie z
[warunkami ponownego wykorzystania informacji GMK](https://bip.krakow.pl/?dok_id=48482).
Warunki wskazują także ograniczenia odpowiedzialności miasta oraz możliwe prawa osób trzecich.
