# Kontrakt danych E2 → E3

Typy: `src/kontrakty/index.ts` (jedyne źródło prawdy). Zmiana kontraktu = zadanie dla integratora.

## Pliki

| Plik | Co | Kto pisze |
|---|---|---|
| `public/dane/adresy.json` | wszystkie adresy, format kolumnowy (`PlikAdresow`), pole `wersja` | ETL #3 |
| `public/dane/wskazniki/<id>.json` | jeden wskaźnik: `meta` + `wartosci[i]` dla i-tego adresu (+ opcjonalne `etykiety[i]`) | ETL każdej warstwy |
| `/dane/manifest.json` | lista metadanych wszystkich wskaźników | **nikt** – składa go Vite (dev i build) z plików wskaźników |
| `public/dane/okolice.json` | okolica każdego adresu: jednostka SIM (Kraków) albo miejscowość, słownik nazw, rozjazdy (`PlikOkolic`, opis w `etl/okolice.md`). To nie wskaźnik: poza manifestem | ETL #75 (`etl/okolice.mjs`) |

## Zasady

- **Jedna liczba na adres, zawsze.** Warstwa siatkowa, rejonowa czy gminna też przypisuje wartość
  każdemu adresowi, a uczciwą rozdzielczość niesie `meta.rozdzielczosc` (+ `rozmiar`).
- **Brak danych = `null`, nigdy 0.** 0 znaczy „zmierzone zero" (np. poza strefą powodziową).
- **Surowy pomiar, nie ocena.** ETL daje dB, metry, µg/m³; ocenę 0–100 liczy `src/wynik`
  z `kierunek`, `norma` i `zakres`.
- **`wersjaAdresow`** w pliku wskaźnika musi równać się `wersja` w `adresy.json`. Loader odrzuca
  niezgodny plik – po zmianie adresów każdą warstwę trzeba przeliczyć (`node etl/<warstwa>.mjs`).
  To samo dotyczy `okolice.json` (`wczytajOkolice` sprawdza też długość kolumny); front bez
  okolic liczy po dzielnicy i gminie, więc niezgodny plik nie blokuje aplikacji.
- `meta.atrapa: true` = dane wymyślone (`node etl/atrapa.mjs`). Prawdziwa warstwa o tym samym `id`
  nadpisuje atrapę. Karta pokazuje atrapę wprost.
- Kategorie: `codziennosc`, `transport`, `spokoj`, `przyszlosc`, `bezpieczenstwo`, `kontekst`
  (kontekst = fakt na karcie, bez wpływu na wynik).

## Dla E3 (karta, wynik, mapa)

```ts
import {
  wczytajAdresy, wczytajManifest, wczytajOkolice, wczytajWskaznik, rozwinAdresy, KATEGORIE,
} from '@/kontrakty'
const plik = await wczytajAdresy()
const adresy = rozwinAdresy(plik)                 // Adres[] z polem h3 (r10) do heatmapy
const { wskazniki } = await wczytajManifest()     // metadane: kategoria, kierunek, norma, źródła
const halas = await wczytajWskaznik('halas_ldwn', plik.wersja) // null = nieaktualny plik
const okolice = await wczytajOkolice(plik.wersja, adresy.length) // null = nieaktualny plik
// Okolica i-tego adresu: okolice.okolice[okolice.idOkolic[okolice.kolumny.okolica[i]]]
// (null w kolumnie = brak danych). W kodzie wyniku: okolicaAdresu(adres, i, okolice) z src/wynik/luki.ts.
```

Heatmapa: grupuj adresy po `h3`, wynik heksu = średnia wyników adresów (wagi zmienia użytkownik,
więc liczone w przeglądarce). Id wskaźników z atrapy (stabilne, prawdziwe warstwy je zachowają):
`sklep_odleglosc`, `przystanek_odleglosc`, `halas_ldwn`, `pm25_srednia`, `zielen_udzial`,
`inwestycje_500m`, `powodz_1proc`, `cena_m2_mediana`. Pełna lista żywych warstw: manifest.

## Dla ETL (tor dane)

```js
import { pobierzDoCache, wczytajAdresy, zapiszWskaznik, dzis } from './lib/wspolne.mjs'
const { adresy } = wczytajAdresy()
zapiszWskaznik(meta, adresy.map(policz), etykiety)  // waliduje kontrakt, wypisuje pokrycie
```

Narzędzia w repo: DuckDB (`@duckdb/node-api`, rozszerzenia `spatial` i `h3` z community),
`h3-js`, `proj4` (EPSG:2178 → 4326), `fflate` (zip), `kdbush` (najbliższy punkt).
Surowe pobrania: `etl/.cache/` (poza gitem). Plik wskaźnika < 2 MB – wartości zaokrąglane do 0,01.
