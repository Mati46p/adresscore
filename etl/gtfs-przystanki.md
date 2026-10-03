# Warstwa `przystanek_odleglosc` (#5)

Źródła: statyczne archiwa [GTFS ZTP Kraków](https://gtfs.ztp.krakow.pl/) `GTFS_KRK_A.zip`
(autobusy MPK), `GTFS_KRK_M.zip` (Mobilis) i `GTFS_KRK_T.zip` (tramwaje). Skrypt zapisuje w
metadanych URL każdego archiwum, jego `Last-Modified`, `feed_version`, wydawcę z `feed_info.txt`
oraz datę pobrania. Pobrane archiwa pozostają w ignorowanym przez Git `etl/.cache/`.

Z `stops.txt` bierzemy tylko punkty przystankowe (`location_type=0`) z poprawnymi współrzędnymi,
które mają kurs umożliwiający wsiadanie w dniu uruchomienia ETL. Kalendarz wynika z
`calendar.txt` i wyjątków `calendar_dates.txt`; kursy z `trips.txt`, a obsługiwane przystanki
z `stop_times.txt` (`pickup_type=1` jest pomijany). Dzień liczony jest w strefie Europe/Warsaw.
Odległość od punktu adresowego do najbliższego punktu przystankowego jest liczona po wielkim
okręgu, w metrach. To odległość **w linii prostej**, nie czas ani długość dojścia pieszo. Punkt
z kursem w rozkładzie nie gwarantuje faktycznego przyjazdu pojazdu; wskaźnik nie podaje liczby kursów. Brak
punktu w promieniu 16 km daje `null`. `wheelchair_boarding=0` i puste pole oznaczają brak
informacji o dostępności, więc nie wpływają na wynik.

Liczba kursów/h w szczycie wymaga osobnej warstwy: dla reprezentatywnego dnia roboczego
wybrać aktywne `service_id`, z `stop_times.txt` policzyć odjazdy 07:00–09:00 (z
`pickup_type!=1`), zgrupować stanowiska tego samego zespołu przystankowego i podzielić
liczbę odjazdów przez 2 godziny. Wartość powinna dotyczyć najbliższego dostępnego zespołu
przystankowego, z jawną datą wzorcową i sprawdzeniem duplikatów kursów w A/M/T. Czas do Rynku
wymaga modelu połączeń, czasu dojścia, oczekiwania i przesiadek; sama odległość lub liczba
odjazdów nie daje wiarygodnego czasu podróży.

ZTP [określa GTFS jako dane otwarte](https://ztp.krakow.pl/wszystkie-aktualnosci/dane-otwarte/sprawdz-przystanki-infrastrukture-rowerowa-i-parkingi-pr-czyli-otwarte-dane.html).
Przy samych archiwach nie ma odrębnej licencji. Stosujemy
[warunki ponownego wykorzystania informacji GMK](https://bip.krakow.pl/?dok_id=48482):
podajemy źródło, czas stanu danych i pobrania, informację o przetworzeniu oraz zakres
odpowiedzialności miasta. Warunki zastrzegają prawa osób trzecich. W `feed_info.txt` wydawcą A
jest MPK, M jest R&G PLUS, T jest ZTP; warstwa publikuje wyłącznie pochodną odległość i nazwę
najbliższego punktu, nie surowe archiwa ani rozkłady. Przed pokazaniem warstwy w aplikacji
trzeba zapewnić widoczną informację o przetworzeniu i odpowiedzialności miasta na stronie metody.

ETL zatrzymuje się przy uciętym lub uszkodzonym ZIP i ponawia pobranie. Zaobserwowano, że
archiwum A potrafi zakończyć transfer niekompletnym plikiem mimo odpowiedzi HTTP 200. Cache
zachowuje SHA-256 i rozmiar, a odczyt dodatkowo sprawdza katalog ZIP.
