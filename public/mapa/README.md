# Lokalny podkład mapy

Podkład pochodzi z [Protomaps Basemap v4](https://docs.protomaps.com/basemaps/downloads),
zbudowanego z OpenStreetMap i Natural Earth. Archiwum źródłowe:
`https://build.protomaps.com/20261002.pmtiles`, OSM replication time z metadanych:
`2026-10-02T04:00:00Z`. Pobrano 2026-10-03. Dane OSM są dostępne na [ODbL](https://www.openstreetmap.org/copyright);
mapa pokazuje przypisanie „Protomaps · © OpenStreetMap contributors”.

| Plik | Zakres WGS84 | Najwyższy poziom | Rozmiar | SHA-256 |
| --- | --- | ---: | ---: | --- |
| `krakow-obwarzanek.pmtiles` | 19.60,49.83,20.43,50.30 | z14 | 39 MiB | `bf8a655867a8fc9dab236259b2e15c10904fc915df33a2dee2197de67f9d7ac4` |
| `polska-przeglad.pmtiles` | 14,48.8,24.2,55 | z7 | 6.3 MiB | `ebe33e20a292219feb78dc92e650a6a4bf2fc73a1ca3629cdc78d39df792816f` |

Wycinek miasta obejmuje wszystkie punkty w `public/dane/adresy.json` (zakres punktów:
19.653461–20.363227°E, 49.888085–50.245059°N) z zapasem. Z14 jest powiększany przy
większym zoomie; bardzo drobne ścieżki i adresy OSM widoczne dopiero na z15 mogą nie wystąpić.
Plik Polski służy do ogólnego widoku i animacji; szczegółowa mapa poza obszarem miasta nie jest
dostępna lokalnie.

Odtworzenie plików wymaga [go-pmtiles CLI](https://docs.protomaps.com/pmtiles/cli) v1.31.2:

```sh
pmtiles extract https://build.protomaps.com/20261002.pmtiles public/mapa/krakow-obwarzanek.pmtiles --bbox=19.60,49.83,20.43,50.30 --maxzoom=14
pmtiles extract https://build.protomaps.com/20261002.pmtiles public/mapa/polska-przeglad.pmtiles --bbox=14,48.8,24.2,55 --maxzoom=7
pmtiles verify public/mapa/krakow-obwarzanek.pmtiles
pmtiles verify public/mapa/polska-przeglad.pmtiles
```

Glify `fonts/Noto Sans Regular` pochodzą z
[protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets) i są objęte licencją
SIL Open Font License 1.1 (`fonts/OFL.txt`). Skopiowano zakresy znaków 0–1279 oraz
8192–8447 (łacinka, greka, cyrylica i typowa interpunkcja); to obejmuje polskie nazwy, ale
rzadkie inne pisma w nazwach OSM mogą nie mieć glifów. Styl w `src/mapa/podklad.ts` używa
lokalnych archiwów i glifów. Podkład działa bez
połączenia z *zewnętrznymi* usługami, gdy aplikacja jest serwowana lokalnie albo z serwera
dostępnego użytkownikowi. Wyłączenie także dostępu do tego serwera wymaga dodatkowego zapisu
aplikacji i zasobów w pamięci przeglądarki (service worker lub lokalny pakiet).
