# Miasta 20 – rejestr (Refs #236)

TERYT = gmina miejska typu 1 (powiat grodzki). Źródła: BDL (kody jednostek), PRG WFS (sprawdzone: każdy TERYT zwraca punkty adresowe), centra z OSM Nominatim.

| slug | nazwa | teryt | wojewodztwo | srodek |
|---|---|---|---|---|
| katowice | Katowice | 2469011 | śląskie | [19.0222, 50.2597] |
| gdynia | Gdynia | 2262011 | pomorskie | [18.5427, 54.5192] |
| czestochowa | Częstochowa | 2464011 | śląskie | [19.1143, 50.8119] |
| rzeszow | Rzeszów | 1863011 | podkarpackie | [22.005, 50.0375] |
| torun | Toruń | 0463011 | kujawsko-pomorskie | [18.6037, 53.0105] |
| radom | Radom | 1463011 | mazowieckie | [21.1433, 51.4028] |
| sosnowiec | Sosnowiec | 2475011 | śląskie | [19.1274, 50.278] |
| kielce | Kielce | 2661011 | świętokrzyskie | [20.6321, 50.8716] |
| gliwice | Gliwice | 2466011 | śląskie | [18.6661, 50.294] |
| olsztyn | Olsztyn | 2862011 | warmińsko-mazurskie | [20.4776, 53.7776] |
| bielskobiala | Bielsko-Biała | 2461011 | śląskie | [19.051, 49.822] |
| zabrze | Zabrze | 2478011 | śląskie | [18.7854, 50.307] |
| bytom | Bytom | 2462011 | śląskie | [18.9234, 50.347] |
| zielonagora | Zielona Góra | 0862011 | lubuskie | [15.5055, 51.9383] |
| rybnik | Rybnik | 2473011 | śląskie | [18.542, 50.0955] |
| rudaslaska | Ruda Śląska | 2472011 | śląskie | [18.8745, 50.2857] |
| opole | Opole | 1661011 | opolskie | [17.9227, 50.6682] |
| tychy | Tychy | 2477011 | śląskie | [18.9817, 50.1299] |
| gorzowwielkopolski | Gorzów Wielkopolski | 0861011 | lubuskie | [15.2401, 52.7312] |
| dabrowagornicza | Dąbrowa Górnicza | 2465011 | śląskie | [19.1883, 50.3255] |

## Przepis ETL miasta

Pilot: Katowice (2469011), 28 225 adresów, 2026-10-21, Windows 11. Wynik: `public/dane/miasta/katowice/` –
70 wskaźników, 27 plików usług, 70 warstw kompaktu, 42 kafle, 44 pliki budynków.

### Jedna komenda

```
node etl/miasto-calosc.mjs <slug>              # wszystko od zera
node etl/miasto-calosc.mjs <slug> --od <krok>  # wznowienie (po błędzie skrypt podaje gotową komendę)
node etl/miasto-calosc.mjs --lista             # kroki
```

Skrypt wykonuje kolejno kroki poniżej (`ADRESCORE_MIASTO=<slug> node etl/<skrypt>.mjs`), mierzy czasy,
zatrzymuje się na pierwszym błędzie. Wymaga Pythona 3 (`python3`, `python` lub `py` w PATH), `curl`, `tar`.
Dane `public/dane` nie są commitowane na tym branchu.

### Kroki i czasy pilota

Czasy z zimnym cache; kolumna „ciepły" to szacunek, gdy surowe pliki krajowe i PBF już leżą w `etl/.cache`.

| # | Krok | Skrypt | Czas | Uwagi |
|---|---|---|---|---|
| 1 | prg | `python etl/prg-miasta.py <TERYT gminy>` | 74 s | WFS GUGiK, cache `prg-miasta/<teryt>.json` (UTF-8) |
| 2 | adresy | `miasta-adresy.mjs <slug>` | 4 s | składa `adresy.json` |
| 3 | zasoby | PBF województwa + GTFS | 16 s + pobranie PBF | pod blokadą (patrz równoległość) |
| 4 | budynki, budynki-kafle | `budynki.mjs`, `budynki-kafle.mjs` | 50 s + 3 s | LoD1 GUGiK powiatu, python |
| 5 | gus, zamoznosc, przestepstwa, frekwencja, wybory-sejm-2023, pozary, szkoly | po jednym skrypcie | 32 + 4 + 4 + 7 + 8 + 8 + 32 s | dane gminne/powiatowe, krótkie |
| 6 | azbest, seveso, prtr, powodz, osiadanie, halas-obwarzanek, zielen-worldcover, swiatlo-viirs, powietrze | po jednym skrypcie | 15 + 8 + 5 + 127 + 3 + 9 + 12 + 89 + 27 s | warstwy środowiskowe |
| 7 | uzbrojenie | `uzbrojenie.mjs` | **798 s** | WMS GUGiK kafelkami; najwolniejszy krok |
| 8 | sewik, wypadki | `sewik-rozpakuj.py <woj>`, `wypadki.mjs raw/<woj>` | ok. 4 min pobranie (480 MB, raz) + 138 s rozpakowanie (raz na województwo) + 429 s | zrzut SEWIK |
| 9 | zabytki-nid | `zabytki-nid.mjs` | 474 s (pierwszy bieg), 22 s z cache | WMS NID, SVG regionu |
| 10 | codziennosc, sor | po jednym skrypcie | 68 + 3 s | **codziennosc przed sor** (pobiera RPWDL do `.cache/rpwdl`) |
| 11 | rowery, uslugi-osm, osm-uslugi, osm-uzupelnienie, uslugi | po jednym skrypcie | 54 + 14 + 19 + 18 + 104 s | z PBF województwa |
| 12 | gtfs-przystanki, dojazd-gtfs (`'' --rynek`), dojazd-gtfs-graf | po jednym skrypcie | 10 + 9 + 8 s | miasta bez feedu: pomijane, patrz niżej |
| 13 | uprosc-kryteria | `uprosc-kryteria.mjs` | – | krok po wszystkich warstwach, przed kompaktem; dopiero po merge #232 (do tego czasu `miasto-calosc` go pomija, bo skrypt bez trybu miasta usunąłby warstwy) |
| 14 | kompakt | `kompakt.mjs` | 14 s | `ADRESCORE_MIASTO=<slug> node etl/kompakt.mjs`; `--sprawdz` weryfikuje |

Razem pilot: ok. 50 min od zera (zimny cache, jedno miasto), ok. 30 min z ciepłym cache. Trzy kroki dają ponad
połowę czasu: uzbrojenie (13 min), zabytki-nid (8 min), wypadki (7 min).

### Porównanie z Lublinem

Zestaw plików ten sam (adresy, budynki-3d + kafle, dojazd/graf, kompakt, uslugi/27, 5 plików pobocznych).
Wskaźniki: Lublin 71, Katowice 70. Różnice wynikają z danych, nie z błędu:

- brak `sejm2023_lista_8` – w okręgu katowickim zarejestrowano 7 list,
- brak `targowisko_odleglosc` – 11 miejsc w obszarze przy progu 20 (skrypt pomija warstwę zamiast zgadywać),
- dodatkowo `wybieg_psy_odleglosc` – Katowice mają dość wybiegów w OSM, Lublin nie.

### GTFS

Feedy w `etl/lib/gtfs-miasta.mjs`. Brak feedu = wpis `BRAK_FEEDU`; `gtfs-przystanki`, `dojazd-gtfs` i
`dojazd-gtfs-graf` wypisują komunikat i nic nie zapisują (wskaźniki `przystanek_odleglosc`, `kursy_szczyt_h`,
`rynek_czas_min` nie powstają = szara kategoria, nie zero). Nigdy nie podstawiamy rozkładu Krakowa.
Miasta bez feedu (stan 2026-10-21): czestochowa, bielskobiala, rybnik, opole, zielonagora, radom, olsztyn.

GZM (katowice, sosnowiec, gliwice, zabrze, bytom, rudaslaska, tychy, dabrowagornicza): jeden feed CC BY.
Zbiór CKAN ma ok. 12 ZIP-ów o krótkich zakresach ważności (21, 22, 23.10 po jednym dniu, potem tygodnie od
4.11). URL jest rozwiązywany dynamicznie z API CKAN: bierzemy pierwszy ZIP, którego `feed_info` obejmuje dzień
liczenia (przystanki: dziś; dojazd: następny dzień roboczy). **Pułapka:** poza oknem publikacji (luka
24.10–3.11) nie ma wariantu na wskazany dzień i `dojazd-gtfs` kończy się błędem „Brak usług GTFS"; wtedy
poczekać na nowy zbiór albo podać datę z okna (`node etl/dojazd-gtfs.mjs RRRR-MM-DD --rynek` po `--od`).
Cache: `etl/.cache/gtfs-miasta/gzm-<data>.zip`.

### Pułapki (wszystkie naprawione w kodzie, ale warto wiedzieć)

- Windows: `python3` to atrapa Sklepu Microsoft. Skrypty używają `PYTHON` z `etl/lib/wspolne.mjs` (`python` na
  win32, nadpisywalne zmienną `PYTHON`).
- `etl/prg-miasta.py` zapisywał JSON w cp1250 (bez `encoding`), przez co polskie litery w ulicach były zepsute.
  Naprawione (UTF-8); istniejące pliki konwertuje jednorazowo `python etl/prg-miasta.py --konwertuj-cp1250`
  (idempotentne). Sprawdzenie: w `adresy.json` Katowic są m.in. „Wojewódzka", „Świerkowa", „Augustyna Świdra".
- SEWIK: nazwy plików w archiwum mają zepsute polskie litery (np. „ŚLĄSKIE" jako cyrylica); `sewik-rozpakuj.py`
  rozpoznaje województwo po znakach ASCII i wypakowuje do `etl/.cache/sewik/raw/<woj>/<rok>/`.
- `zabytki-nid`: usługa NID rysuje okrągłe znaczniki jako łuki SVG (`a`); parser je teraz rozwija w łamaną.
- `codziennosc`: rejestr żłobków – stare id zasobu dane.gov.pl zwracało 404; plik CSV bierzemy z listy zasobów
  zbioru 29751 (`file_url`).
- `rowery`, `powietrze` i inne skrypty nie wymagają osobnych argumentów; wszystkie czytają `ADRESCORE_MIASTO`.

### Współdzielone cache i równoległość

Wspólne dla wszystkich miast (`etl/.cache`): `<woj>.osm.pbf`, `gtfs-miasta/`, `sewik/` (archiwum 480 MB i
rozpakowane `raw/<woj>/`), `rpwdl/`, `bdl-*.json`, `e8-2026.xlsx`, `sio-2025.csv`, `kgpsp-tabele-2025.zip`,
`wykaz_list_sejm_csv.zip`, `PL_PD_3035_CSV.zip` (GUS), `halas-eea/`, `worldcover/`, `viirs/`, `powodz/`,
`zabytki-nid-*`. Per miasto: `prg-miasta/<teryt>.json`, `<powiat>-lod1-2024.*`, `uslugi-osm-pbf-<slug>-*`.
Wyniki zawsze w `public/dane/miasta/<slug>/`, więc procesy różnych miast się tam nie spotykają.

**Dwa procesy różnych miast mogą biec równolegle, pod warunkami:**

1. Pobrania wspólnych plików są zabezpieczone tylko tam, gdzie `miasto-calosc.mjs` bierze blokadę
   (`.cache/.blokada-*`: PRG, PBF + GTFS, SEWIK). Reszta używa `pobierzDoCache` bez pliku tymczasowego, więc dwa
   procesy pobierające ten sam plik krajowy naraz mogą zostawić ucięty plik. **Najpierw jedno miasto
   (pilot) rozgrzewa cache, potem reszta równolegle** albo kolejne starty przesunięte o kilka minut.
2. Miasta tego samego województwa dzielą PBF i cache `osm-uslugi-*` / `apteki-<woj>.json` (zapis bez pliku
   tymczasowego). Bezpieczne po rozgrzaniu cache pierwszym miastem z danego województwa; wcześniej –
   po kolei.
3. Zasoby maszyny: kroki `rowery` (DuckDB), `swiatlo-viirs`, `zielen-worldcover` i `kompakt` zjadają RAM
   (kilkaset MB do ok. 1 GB); 4–5 równoległych miast na zwykłym laptopie to rozsądna granica. Serwery
   GUGiK (WMS uzbrojenie, NID) rate-limitują – przy wielu miastach naraz rosną czasy 800 s / 474 s.
4. `pnpm verify` i build `dist` nie dotyczą ETL; nie czyścić `etl/.cache` ani `dist` w trakcie.

Zalecana kolejność dla pozostałych 19 miast: 1) Katowice (gotowe, rozgrzane `slaskie`), 2) po jednym mieście z
każdego województwa jako rozgrzewka (gdynia/pomorskie, rzeszow, torun, radom, kielce, olsztyn, zielonagora,
opole), 3) reszta równolegle.
