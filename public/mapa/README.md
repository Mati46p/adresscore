# Podkład mapy

Podkład pochodzi z [Protomaps Basemap v4](https://docs.protomaps.com/basemaps/downloads),
zbudowanego z OpenStreetMap i Natural Earth. Archiwum źródłowe:
`https://build.protomaps.com/20261002.pmtiles` (OSM z 2026-10-02). Dane OSM są na
[ODbL](https://www.openstreetmap.org/copyright); mapa pokazuje przypisanie
„Protomaps · © OpenStreetMap contributors”.

Plik `polska.pmtiles` (cała Polska, bbox 14,48.8,24.2,55, do z14, 2,1 GB) **nie leży w repo
ani w obrazie**. Serwer czyta go z katalogu `MAPA_DIR` (wolumen Coolify, np. `/data/mapa`) pod
adresem `/mapa/polska.pmtiles`. Inny adres daje zmienna builda `VITE_MAPA_URL`. Lokalnie:
skopiuj plik do `public/mapa/` (jest w .gitignore; `pnpm build` skopiuje go wtedy do `dist/`)
albo ustaw `VITE_MAPA_URL`.

Odtworzenie pliku wymaga [go-pmtiles CLI](https://docs.protomaps.com/pmtiles/cli) v1.31.2:

```sh
pmtiles extract https://build.protomaps.com/20261002.pmtiles polska.pmtiles --bbox=14,48.8,24.2,55 --maxzoom=14
pmtiles verify polska.pmtiles
```

Service worker nie dotyka plików `.pmtiles` (2 GB nie zmieści się w Cache API); zakresy bajtów
cachuje przeglądarka, a mapa nie działa offline.

Glify `fonts/Noto Sans Regular` pochodzą z
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets) i są objęte licencją
SIL Open Font License 1.1 (`fonts/OFL.txt`). Skopiowano zakresy znaków 0–1279 oraz
8192–8447 (łacinka, greka, cyrylica i typowa interpunkcja); to obejmuje polskie nazwy, ale
rzadkie inne pisma w nazwach OSM mogą nie mieć glifów.
