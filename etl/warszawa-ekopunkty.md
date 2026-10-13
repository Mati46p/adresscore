# Eko-punkty odpadów w Warszawie – `ekopunkt_odleglosc` (#234)

`ADRESCORE_MIASTO=warszawa node etl/warszawa-ekopunkty.mjs`

| Co mierzy | Pokrycie | Skala | Źródło |
|---|---|---|---|
| odległość w linii prostej od adresu do najbliższego stałego eko-punktu, metry | 100% adresów Warszawy | mniej metrów = lepiej, zakres 0–1 500 m | API dane.um.warszawa.pl, action `get_bos_ekopunkty` |

- 775 rekordów (pola `szerokosc`/`dlugosc`), wchodzi 646. Odpada 129 punktów, które mają wyłącznie
  typ mobilny (82: zbiórka objazdowa, brak stałego miejsca) albo jadłodzielnię (47: wymiana jedzenia,
  nie odpady). Punkt z choć jednym typem stałym zostaje.
- Typy w użyciu: odbiór przeterminowanych leków 502, Miejski Punkt Elektroodpadów 83, pojemnik na małe
  elektrośmieci 56, PSZOK 5. Większość to apteki z odbiorem leków, więc wartość znaczy „najbliższe
  miejsce oddania któregoś z tych odpadów”; opis warstwy to mówi.
- Mediana odległości: 458 m (maks. 3 784 m).
- Klucz i cache jak w `etl/warszawa-toalety.md`.
