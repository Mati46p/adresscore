# Kontrola modelu PM2,5 i PM10 na czujnikach Sensor.Community (#144)

`node etl/sensor-community.mjs` porównuje warstwy `pm25_srednia` i `pm10_srednia` (model GIOŚ, w Krakowie
z doprecyzowaniem do adresu z #131) ze średnimi rocznymi z czujników obywatelskich Sensor.Community.
Wynik to `public/dane/powietrze_kontrola_sensor_community.json` – tabela zgodności do strony metody
(wiersz = czujnik) plus podsumowanie. **To nie jest wskaźnik**: żadna wartość adresu ani wynik się nie
zmienia, plik nie trafia do manifestu. Pierwszy bieg to ok. 50 tys. drobnych żądań (spis dób kontrolnych
i pliki dobowe, 6–8 połączeń naraz, ok. 40 min); agregaty godzinowe zostają w `etl/.cache/sensor-community`,
więc drugi bieg trwa kilkanaście sekund.

## Źródło i licencja

- **Archiwum**: `https://archive.sensor.community/<rok>/<dzień>/<dzień>_<typ>_sensor_<id>.csv.gz` – jeden
  plik na czujnik i dobę (nie miesięczne zipy po kilka GB), bez klucza i konta. Czujniki zewnętrzne.
- **Licencja** (`00disclamer.md` w repozytorium projektu): ODbL 1.0 dla bazy, DbCL 1.0 dla zawartości.
  Wymagana atrybucja „Contains information from Sensor.Community, which is made available here under the
  Open Database License (ODbL)”; tabela agregatów jest bazą pochodną i też idzie na ODbL (jest w `zrodla[]`).
- **Lista czujników**: żywe API (`data.24h.json`, jedno pobranie, nagłówek User-Agent z kontaktem) plus
  spis archiwum z dwóch dób kontrolnych roku (12.02 i 13.08.2025; pierwszy wiersz każdego pliku, żądanie
  `Range` 2 KB), żeby objąć też czujniki, które w roku modelu nadawały, a dziś już nie.

## Jak liczymy (reguły: stała `REGULY` w `etl/lib/sensor-community.mjs`, opis w `meta.metoda`)

1. Rok porównania = rok modelu GIOŚ (2025). Średnie godzinowe UTC z plików dobowych.
2. Odrzucone: odczyty poza 0–999 µg/m³, pojedyncze skoki (> 3× mediana godziny + 15 µg/m³ dla PM2,5),
   godziny zawieszone, godziny z PM2,5 większym od PM10, godziny odstające względem mediany wszystkich
   czujników (> 4× mediana + 30 µg/m³). SPS30 publikuje pod swoim id dwa strumienie – bierzemy pełne wiersze.
3. **Wilgotność > 80%**: dwie średnie na czujnik – z wszystkich godzin (`wszystkie`) i tylko z godzin
   o wilgotności do 80% (`suche`), z czujnika wilgotności w tej samej lokalizacji. Doba z zawieszonym
   czujnikiem wilgotności (np. DHT22 zapisujący 84,9% całą dobę) nie liczy się jako pomiar.
4. Średnia roczna = średnia ze średnich miesięcznych; do tabeli czujnik wchodzi przy pokryciu ≥ 75% godzin
   roku, ≥ 10 miesiącach z danymi, stałej lokalizacji i małym udziale godzin odstających. Reszta jest na
   liście `odrzucone` z powodem (najczęściej pokrycie < 75%).
5. Model przy czujniku: średnia warstwy z adresów w promieniu 100 m (`model`) i surowa wartość oczka GIOŚ
   w punkcie czujnika bez doprecyzowania (`modelOczko`). Różnica = model − czujnik.

## Wynik (adresy `a7d233814059`, rok 2025)

24 czujniki w tabeli: 13 w Krakowie (11 z 18 dzielnic), 11 w gminach wokół (obwarzanek). Odrzuconych 19
z 43 ocenionych (pokrycie < 75%, odstające odczyty, brak danych w dobach kontrolnych). Zdania z liczbami
są w `meta.wynik`. Kraków, PM2,5, średnia z wszystkich godzin (13 czujników): model 15,9 µg/m³, czujniki 10,1
(pojedyncze od 5,2 do 16,0), mediana czujnik/model 0,63, korelacja −0,10. Z godzin o wilgotności do 80%
(8 czujników): czujniki 7,7, korelacja 0,71.

## Jak to czytać

- **Czujniki pokazują mniej niż model i bardzo różnią się między sobą** (w jednym mieście ponad 3-krotnie).
  To rozrzut tanich, niekalibrowanych czujników, a nie dowód błędu modelu: tabela nie potwierdza ani nie
  obala rozkładu przestrzennego modelu. Doprecyzowanie #131 (±10%) ginie w tym szumie: średni błąd
  bezwzględny dla adresu i dla surowego oczka różni się o mniej niż 1 µg/m³, raz w jedną, raz w drugą stronę.
- **Średnia „suche” zaniża**: pomijane godziny z wilgotnością > 80% to częściej zimowe noce z inwersją, czyli
  wyższe stężenia (u czujnika `61982`: 8,3 wobec 15,2 z wszystkich godzin). Do porównania z modelem lepsza jest
  średnia z wszystkich godzin. Dodatkowo czujnik wilgotności stoi w obudowie czujnika pyłu: średnia wilgotność
  waha się od 38% do 87%, a udział godzin > 80% od 0% do 71%, więc filtr działa na stanowiskach bardzo różnie.
- Próba jest mała i nielosowa; korelacji nie liczymy poniżej 5 czujników.

## Kontrola potoku

- Test `node --test etl/sensor-community.test.mjs`: czyste funkcje (agregacja godzinowa, skoki, zawieszenie,
  wilgotność, średnia z miesięcy, statystyki) oraz spójność pliku wyniku (wersja adresów, sumy grup, atrybucja).
- Niezależne przeliczenie dla 2 czujników od zera, bez kodu z `etl/lib`: średnia z surowych plików zgadza się
  z potokiem (6,90 wobec 6,88 µg/m³ PM2,5), a wyszukiwanie modelu (pełny przegląd 176 684 adresów, haversine)
  zgadza się z KDBush: różnice do 0,3 µg/m³, a do 1,4 µg/m³ tam, gdzie plik zaokrągla dokładną pozycję
  czujnika do 0,001°.
