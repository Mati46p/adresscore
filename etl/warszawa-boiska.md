# Otwarte boiska szkolne Warszawy – `boisko_otwarte_odleglosc` (#234)

`ADRESCORE_MIASTO=warszawa node etl/warszawa-boiska.mjs`

| Co mierzy | Pokrycie | Skala | Źródło |
|---|---|---|---|
| odległość w linii prostej od adresu do najbliższego adresu szkoły z otwartym boiskiem, metry | 100% adresów Warszawy | mniej metrów = lepiej, zakres 0–1 500 m | API dane.um.warszawa.pl, action `get_be_otwarte_boiska` |

- 1 227 rekordów (jeden na rodzaj urządzenia), 308 unikalnych adresów szkół. Rekordy mają tylko adres
  tekstowy, więc położenie to punkt adresowy budynku szkoły (z `adresy.json`), nie samo boisko.
- **Geokodowanie bez zewnętrznego geokodera**: normalizacja ulicy (ul./al./pl./aleja/aleje/plac,
  wielkość liter, polskie znaki, myślniki, cudzysłowy, nawiasy), numer (pełny „12/14”, człony, bez
  litery „12A” → „12”, odcięcie „lok.”, kodu i opisu po myślniku), ulica ze skróconą nazwą (inicjał
  imienia, pominięte imię) tylko gdy dokładnie jedna pasuje, ta sama ulica w kilku miejscach
  rozstrzygana kodem pocztowym, a gdy go brak – dzielnicą rekordu (kandydat co najmniej dwa razy
  bliżej mediany dopasowanych adresów tej dzielnicy niż drugi).
- **Punkt decyzyjny**: dopasowanie < 90% adresów (albo rekordów) = warstwa nie jest zapisywana
  (kod wyjścia 2), skrypt wypisuje odsetek i listę niedopasowanych.
- Wynik: 306 z 308 adresów (99,4%), 1 220 z 1 227 rekordów; niedopasowane 2 (ul. gen. Karola
  Ziemskiego „Wachnowskiego” 22, ul. Jana Bytnara Rudego 15A).
- Mediana odległości: 553 m (maks. 4 034 m). Liczba boisk w 500 m nie wchodzi (jedna liczba na adres,
  miara to odległość).
- Klucz i cache jak w `etl/warszawa-toalety.md`.
