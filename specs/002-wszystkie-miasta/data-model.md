# Model danych: Wszystkie miasta od razu widoczne na mapie

Bez zmian w plikach `public/dane/**` i w bazie. Nowe są wyłącznie byty w pamięci przeglądarki.

## Miasto (rejestr, `src/kontrakty/miasta.ts`)

| Pole | Typ | Reguła |
|---|---|---|
| `slug` | `'krakow' \| 'warszawa' \| … \| 'bialystok'` | unikalny; dla miast = nazwa katalogu w `public/dane/miasta/` |
| `nazwa` | string | „Kraków", „Łódź" |
| `wMiescie` | string | „w Krakowie", „we Wrocławiu", „w Białymstoku" – do tekstów UI |
| `katalog` | string | `''` dla Krakowa, `miasta/<slug>` dla pozostałych (względem `dane/`) |
| `srodek` | `[lon, lat]` | do listy miast i kadru zapasowego przed wczytaniem obrysu |

Kolejność w rejestrze = kolejność na liście i w ładowaniu tła: Kraków, potem malejąco wg liczby adresów.
Walidacja (test): zbiór slugów ≠ krakow = zbiór katalogów `public/dane/miasta/*` z plikiem `kompakt/indeks.json`.

## Bieżące miasto (stan aplikacji)

- `StanAplikacji.miasto: SlugMiasta` (domyślnie `krakow`), w linku `mst=<slug>` (pomijane dla Krakowa).
- Przejście `ustawMiasto(slug)`:
  1. jeśli `slug` = bieżące → nic;
  2. czyści `wybrany`, `porownanie`, `symulacja`, miejsca Biznesu; ogłasza „Bieżące miasto: X";
  3. `dane.ts` zaczyna (albo bierze z pamięci) ładowanie zbioru X; `useDane()` zwraca stan X;
  4. po `gotowe` → `podlaczDane` X: `idAdresow` X, meta X, wagi **scalone** (D9).
- Nieznany slug z linku → `krakow` + komunikat.

## Dane miasta (`src/wynik/dane.ts`)

`Map<SlugMiasta, Promise<StanDanych>>` – każde miasto ładowane najwyżej raz na sesję.
`useDane()` / `daneJesliGotowe()` zwracają stan **bieżącego** miasta. Kształt `Dane` bez zmian,
plus `miasto: SlugMiasta` (konsumenci mogą sprawdzić, czy dane pasują do bieżącego miasta).
Pamięć: trzymamy dane najwyżej 2 miast (bieżące + poprzednie), starsze zwalniamy; zwalniane w trakcie
ładowania jest przerywane (`AbortController` na wpis).

## Przegląd miasta (`src/wynik/przeglad.ts`)

| Pole | Opis |
|---|---|
| `slug` | miasto |
| `stan` | `ladowanie` → `gotowe` \| `brak` (powód w konsoli, miasto pod mgłą z podpisem) |
| `indeks`, `manifest` | kompakt i manifest miasta, zgodne (`niezgodnoscKompaktu` = null) |
| `podstawa` | `PodstawaHeksow` z `heksy.bin` (r8/r9/r10) |
| `warstwy` | `Map<id, WarstwaHeksow>` dociągane wg potrzeby profilu/warstwy |
| `granice` | prostokąt z heksów r8 – do kadru Polski i rozpoznania miasta pod punktem |

Wynik: `Record<8|9|10, Map<h3, number|null>>` per miasto, liczony `wynikiHeksow` z `liczoneWarstwy(metaMiasta, wagi, kierunki, warstwa)`.
Warstwa wybrana, której miasto nie ma → `liczone = []` → wszystkie heksy `null` (szrafura), nigdy 0.

## Tło mapy (prop `tlo` w `MapaKrakowa`)

Suma przeglądów wszystkich miast **poza bieżącym** (bieżące rysuje istniejąca ścieżka r10),
na poziomach r8 i r9, plus funkcja `miastoHeksu(h3) → nazwa` do dymku. Kontrakt: [contracts/przeglad.md](contracts/przeglad.md).
