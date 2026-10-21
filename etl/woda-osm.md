# Woda powierzchniowa z OSM – miasta (#241)

`ADRESCORE_MIASTO=<slug> node etl/woda-osm.mjs` zapisuje `woda_odleglosc` dla miasta z rejestru. Kraków ma ten
wskaźnik z modelu SMK/BDOT (`etl/metropolia-smk.mjs`), więc skrypt poza trybem miasta kończy się błędem.

- **Źródło:** ekstrakt OSM województwa miasta (`pbfRegionu`, openstreetmap.fr, ODbL), czytany przez DuckDB
  `ST_ReadOSM` (`etl/lib/pbf-warstwy.mjs`), bez Overpass.
- **Co liczy się jako woda:** `natural=water` (bez `water=wastewater|sewage` i `covered=yes`), także relacje
  multipolygon (Wisła, Odra, jeziora), oraz osie `waterway=river|stream|canal` bez tuneli i przepustów.
  Morze (`natural=coastline`) nie jest liczone.
- **Odległość:** 0 w obrębie zbiornika, poza nim odległość do brzegu zbiornika albo osi cieku (minimum 1 m).
  Relację, której obrysu nie da się złożyć w zamknięty pierścień w ramce, liczymy po brzegu, bez wnętrza.
  Dalej niż 10 km od wody: brak danych.
- **Porównywalność:** inne źródło niż w Krakowie (tam BDOT10k); kompletność małych cieków i stawów w OSM bywa różna.
