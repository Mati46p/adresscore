# Zamożność gminy i wynagrodzenie powiatu (#70)

Uruchom po `node etl/obwarzanek.mjs`: `node etl/zamoznosc.mjs` (Node 24). Sprawdź `node --test etl/zamoznosc.test.mjs`. Surowe odpowiedzi API są przechowywane w `etl/.cache/`; dla nowego rocznika zmień `ROK` i pobierz nowe odpowiedzi. Ponowne uruchomienie `etl/obwarzanek.mjs` nadpisuje `gminy-porownanie.json`, więc uruchom potem również ten ETL.

Źródło: GUS Bank Danych Lokalnych, API `/data/by-unit`, rok 2025, licencja CC BY 4.0. Zmienna 149128 to dochody **budżetu gminy z udziału w PIT na mieszkańca** (zł/os.). Zmienna 64428 to przeciętne miesięczne wynagrodzenie brutto **według powiatu miejsca pracy** (zł/mies.). Dane wynagrodzeń nie opisują zarobków mieszkańców adresu; statystyka nie obejmuje wszystkich miejsc pracy. Wewnątrz Krakowa obie liczby są stałe. To neutralny kontekst, bez wpływu na ocenę adresu.

Pokrycie: 14/14 gmin i 4/4 powiatów, 176 684/176 684 adresów. `gminy-porownanie.json` zawiera obie miary, każdą z rokiem, źródłowym URL-em i rozdzielczością. PIT w 2025 r. jest po zmianach finansowania JST, dlatego nie pokazujemy trendu względem wcześniejszych roczników.
