# Adresy 10 największych miast (PRG) – zaciąganie

`python3 etl/prg-miasta.py [teryt ...]` pobiera punkty adresowe z krajowego PRG (GUGiK WFS KINA,
`A07_Punkty_adresowe`) i zapisuje `etl/.cache/prg-miasta/<teryt>.json` (poza gitem, wznawialne).
Format wierszy jak w `etl/prg-wfs.py` (x/y w EPSG:2180). Pobranie ~10 min.

| Miasto | TERYT | Punktów (2026-10-04) |
|---|---|---|
| Warszawa | 1465011 | 126 566 |
| Wrocław | 0264011 | 75 230 |
| Kraków | 1261011 | 70 295 (produkcyjnie z MSIP, tu tylko do porównania) |
| Łódź | 1061011 | 64 962 |
| Poznań | 3064011 | 63 023 |
| Gdańsk | 2261011 | 42 848 |
| Szczecin | 3262011 | 41 886 |
| Lublin | 0663011 | 29 041 |
| Bydgoszcz | 0461011 | 27 413 |
| Białystok | 2061011 | 27 192 |

Na razie **nie** zmienia `public/dane/adresy.json` ani kontraktu (to tor `integracja`): to surowy
etap. Następny krok: złożenie adresów (`nowyAdres` z `etl/adresy.mjs`, h3 r10) w pliki per miasto i
uzgodnienie z integratorem, jak front wybiera miasto. Źródło: GUGiK PRG, dane bezpłatne
(https://www.geoportal.gov.pl/pl/dane/panstwowy-rejestr-granic-prg/).
