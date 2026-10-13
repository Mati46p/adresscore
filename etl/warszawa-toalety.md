# Toalety publiczne Warszawy – `toaleta_publiczna_odleglosc` (#234)

`ADRESCORE_MIASTO=warszawa node etl/warszawa-toalety.mjs`

| Co mierzy | Pokrycie | Skala | Źródło |
|---|---|---|---|
| odległość w linii prostej od adresu do najbliższej toalety publicznej, metry | 100% adresów Warszawy (brak obiektu w 10 km = `null`) | mniej metrów = lepiej, zakres 0–1 500 m | API dane.um.warszawa.pl, action `get_m_toalety` |

- 695 punktów (GeoJSON), stan „kwiecień 2026”: toalety stacjonarne 383, w stacjach metra 54,
  automatyczne 45, przenośne 213. Wchodzą wszystkie typy. Przenośne mogą być sezonowe, a API tego
  nie rozróżnia, więc opis warstwy ostrzega, zamiast zgadywać.
- Mediana odległości: 471 m (maks. 3 135 m).
- Klucz `WARSZAWA_API_KEY` czytany z `.env` (nigdy do repo ani logów), klient: `etl/lib/warszawa-api.mjs`.
  Surowa odpowiedź leży w `etl/.cache/warszawa-api/` (pobranie jednorazowe; odświeżenie = usuń plik).
