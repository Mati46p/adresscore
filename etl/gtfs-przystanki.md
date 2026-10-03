# Warstwy GTFS: `przystanek_odleglosc` i `kursy_szczyt_h` (#5)

Źródła: statyczne archiwa [GTFS ZTP Kraków](https://gtfs.ztp.krakow.pl/) `GTFS_KRK_A.zip`
(autobusy MPK), `GTFS_KRK_M.zip` (Mobilis) i `GTFS_KRK_T.zip` (tramwaje). Skrypt zapisuje w
metadanych URL każdego archiwum, datę publikacji (`Last-Modified` albo datę z indeksu ZTP),
`feed_version`, wydawcę z `feed_info.txt`
oraz datę pobrania. Pobrane archiwa pozostają w ignorowanym przez Git `etl/.cache/`.

Z `stops.txt` bierzemy tylko punkty przystankowe (`location_type=0`) z poprawnymi współrzędnymi,
które mają kurs umożliwiający wsiadanie w dniu uruchomienia ETL. Kalendarz wynika z
`calendar.txt` i wyjątków `calendar_dates.txt`; kursy z `trips.txt`, a obsługiwane przystanki
z `stop_times.txt` (`pickup_type=1` jest pomijany). Dzień liczony jest w strefie Europe/Warsaw.
Odległość od punktu adresowego do najbliższego punktu przystankowego jest liczona po wielkim
okręgu, w metrach. To odległość **w linii prostej**, nie czas ani długość dojścia pieszo. Punkt
z kursem w rozkładzie nie gwarantuje faktycznego przyjazdu pojazdu. Brak
punktu w promieniu 16 km daje `null`. `wheelchair_boarding=0` i puste pole oznaczają brak
informacji o dostępności, więc nie wpływają na wynik.
Etykieta każdego adresu podaje nazwę i kod najbliższego stanowiska oraz zaokrągloną odległość.

`kursy_szczyt_h` liczy planowe odjazdy 07:00–09:00 w najbliższą środę od dnia ETL, dzielone
przez dwie godziny. Wybiera to samo, najbliższe stanowisko co wskaźnik odległości. Wspólny
`stop_code` pozwala zsumować odjazdy tego stanowiska z A/M/T; każde stanowisko ma unikatowy kod
w obrębie feedu. `pickup_type=1` nie jest liczone. Gdy stanowisko nie ma w środę kursów, wynik
wynosi mierzone `0`, a gdy adres nie ma punktu GTFS w 16 km, wynosi `null`. To częstotliwość
jednego stanowiska, nie całego zespołu przystankowego. Data wzorcowa jest podana w opisie
wskaźnika. Czas do Rynku wymaga modelu połączeń, dojścia, oczekiwania i przesiadek; sama
odległość ani liczba odjazdów nie daje wiarygodnego czasu podróży.
Etykieta pokazuje to samo stanowisko i planowe kursy/h; `0` oznacza brak odjazdów w tym oknie.

ZTP [określa GTFS jako dane otwarte](https://ztp.krakow.pl/wszystkie-aktualnosci/dane-otwarte/sprawdz-przystanki-infrastrukture-rowerowa-i-parkingi-pr-czyli-otwarte-dane.html).
Przy samych archiwach nie ma odrębnej licencji. Stosujemy
[warunki ponownego wykorzystania informacji GMK](https://bip.krakow.pl/?dok_id=48482):
podajemy źródło, czas stanu danych i pobrania, informację o przetworzeniu oraz zakres
odpowiedzialności miasta. Warunki zastrzegają prawa osób trzecich. W `feed_info.txt` wydawcą A
jest MPK, M jest R&G PLUS, T jest ZTP; warstwy publikują wyłącznie pochodną odległość i
częstotliwość, nie surowe punkty, archiwa ani rozkłady. Przed pokazaniem warstw w aplikacji
trzeba zapewnić widoczną informację o przetworzeniu i odpowiedzialności miasta na stronie metody.

ETL zatrzymuje się przy uciętym lub uszkodzonym ZIP i ponawia pobranie. Zaobserwowano, że
archiwum A potrafi zakończyć transfer niekompletnym plikiem mimo odpowiedzi HTTP 200. Cache
zachowuje SHA-256 i rozmiar, a odczyt dodatkowo sprawdza katalog ZIP.
Ponieważ kontrakt `etykiety[i]` powtarza nazwę stanowiska przy każdym adresie, każdy wynikowy
JSON ma około 10 MB zamiast zalecanych 2 MB. Po kompresji HTTP gzip jest to około 1–1,8 MB.
Słownik etykiet z indeksami adresów wymagałby zmiany kontraktu przez integratora.
