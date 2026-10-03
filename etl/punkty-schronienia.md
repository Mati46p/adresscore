# Punkty Schronienia KG PSP – Kraków (#25)

Źródłem jest [publiczny CSV KG PSP](https://gdziesieukryc.pl/PS_XML/punkty_schronienia.csv),
zarejestrowany w [dane.gov.pl, zbiór 28058](https://dane.gov.pl/pl/dataset/28058,punkty-schronienia-w-polsce)
jako zasób 1393918. Wydawcą jest Komenda Główna Państwowej Straży Pożarnej. Metadane API
`https://api.dane.gov.pl/1.4/datasets/28058` wskazują **CC BY 4.0**, aktualizację co tydzień
i źródłowy URL CSV/XML. Skrypt pobiera CSV bezpośrednio od KG PSP, zapisuje surowy plik tylko w
ignorowanym przez Git `etl/.cache/`, a publiczny GeoJSON zawiera tylko rekordy z `Gmina=Kraków`.
Data w metadanych warstwy pochodzi z nagłówka HTTP `Last-Modified` pliku CSV i określa datę tego
zrzutu, nie datę weryfikacji każdego punktu. Hash SHA-256 umożliwia identyfikację dokładnego
zrzutu. ETL odrzuca podejrzanie krótki plik, uszkodzony CSV, duplikaty
identyfikatorów i współrzędne poza obszarem Krakowa. Zrzut z 2026-10-03 ma 86 520 rekordów
w Polsce i 3 008 z `Gmina=Kraków`.

`node etl/punkty-schronienia.mjs` pobiera bieżący CSV. Dla powtarzalnego uruchomienia z zapisanym
plikiem: `PSP_DATA_DANYCH=2026-10-03 node etl/punkty-schronienia.mjs /ścieżka/punkty_schronienia.csv`.
Wynik to `public/dane/punkty_schronienia.geojson`, WGS84, punkty `[lon, lat]`. Nazwa, rodzaj,
adres i deklarowana dostępność są przejęte z katalogu; wartość „Całodobowa” nie gwarantuje
możliwości wejścia w danej chwili.

Skrypt zapisuje też `public/dane/wskazniki/punkt_schronienia_odleglosc.json` dla pełnego
kontraktu 176 684 adresów. Wartość to odległość geodezyjna do najbliższego Punktu Schronienia,
wyszukana w indeksie przestrzennym. W zrzucie z 2026-10-03 wynik ma 70 217 adresów gminy
Kraków; pozostałe 106 467 adresów mają `null`, ponieważ warstwa punktowa obejmuje tylko Kraków.
To wskaźnik kontekstowy o neutralnym kierunku, bez wpływu na ocenę. Zasięg wyszukania to 8 km;
żaden adres Krakowa z obecnego zbioru nie przekracza tego progu. Deklarowany zakres prezentacji
to 0–6 000 m; największa wyliczona wartość w obecnym zrzucie wynosi 5 057,59 m. ETL zatrzyma
się, jeśli nowy zrzut przekroczy deklarowany zakres.

**Znaczenie danych:** według [wyjaśnienia KG PSP w „Przeglądzie Pożarniczym”](https://www.ppoz.pl/czytelnia/ratownictwo-i-ochrona-ludnosci/Gdziesieukryc-pl-serwis-pierwszej-potrzeby/idn:3441)
Punkty Schronienia to informacyjna kategoria miejsc doraźnej osłony. Nie oznacza ona
potwierdzonych schronów, ukryć ani miejsc doraźnego schronienia w rozumieniu ustawy. Warstwa
nie określa pojemności, odporności, dostępności wejścia ani czasu dojścia. Czas dojścia wymaga
zweryfikowanego trasowania pieszo; odległość geodezyjna nie jest czasem ani długością trasy.
Do prezentacji należy zachować tę nazwę, datę danych i atrybucję KG PSP/CC BY 4.0.
