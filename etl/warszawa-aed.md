# Publiczne defibrylatory AED w Warszawie – `defibrylator_um_odleglosc` (#234)

`ADRESCORE_MIASTO=warszawa node etl/warszawa-aed.mjs`

| Co mierzy | Pokrycie | Skala | Źródło |
|---|---|---|---|
| odległość w linii prostej od adresu do najbliższego publicznego AED, metry | 100% adresów Warszawy | mniej metrów = lepiej, zakres 0–1 000 m | API dane.um.warszawa.pl, action `get_scb_lokalizacja_defibrylatorow` |

- 710 punktów, z czego 610 `device_public_access = Publiczny` wchodzi, 100 `Prywatny` odpada
  (nie jest przeznaczone dla przypadkowego świadka).
- Dostępność całodobowa (`device_availability`: Tak 76, Ograniczona 86, Nie 446) jest w danych słabo
  opisana, więc jej nie filtrujemy; opis warstwy mówi, że większość urządzeń jest w budynkach.
- Mediana odległości: 486 m (maks. 4 416 m).
- Osobny id niż istniejąca warstwa OSM `defibrylator_odleglosc` (inne źródło, kierunek neutralny);
  żadna nie nadpisuje drugiej.
- Klucz i cache jak w `etl/warszawa-toalety.md`.
