# Ryzyka i przyroda ze źródeł krajowych (zadanie #116)

Cztery wskaźniki dla wszystkich adresów (Kraków i obwarzanek), rozdzielczość `adres`. Każdy skrypt
pobiera surowe dane do `etl/.cache/ryzyka/` (poza gitem; drugi bieg nie pyta serwerów) i zapisuje
`public/dane/wskazniki/<id>.json` przez `zapiszWskaznik`.

| Wskaźnik | Skrypt | Źródło | Licencja | Kierunek |
|---|---|---|---|---|
| `azbest_budynki_100m` (szt.) | `etl/azbest.mjs` | Baza Azbestowa, WFS `esip.bazaazbestowa.gov.pl`, warstwa `budynki_z_azbestem` (GML, EPSG:2180) | CC BY 4.0 (dane.gov.pl, zbiór 662) | mniej lepiej |
| `seveso_odleglosc` (m) | `etl/seveso.mjs` | GIOŚ, INSPIRE OGC API Features `seveso:ProductionFacility` (współrzędne); API rejestru GIOŚ i wykaz xlsx 31.12.2025 jako kontrola | CC BY 4.0 (zbiory 2540 i 34643) | więcej lepiej |
| `emitent_odleglosc` (m) | `etl/prtr.mjs` | GIOŚ, INSPIRE OGC API Features `prtr:ProductionFacility` (Krajowy Rejestr Uwalniania i Transferu Zanieczyszczeń, zbiór 425) | CC BY 4.0 | więcej lepiej |
| `przyroda_chroniona_odleglosc` (m) | `etl/przyroda-gdos.mjs` | GDOŚ, CRFOP, WFS `sdi.gdos.gov.pl/wfs` | CC0 1.0 (zbiór 471) | mniej lepiej |

Wspólne narzędzia: `etl/lib/geo.mjs` (EPSG:2180, odległość punkt–wielokąt, indeks siatkowy, licznik
obrysów), `etl/lib/pobieranie.mjs` (stronicowanie OGC API, ponawianie pobrań), `etl/lib/nazwy.mjs`
(skracanie nazw zakładów do etykiet, porównywanie nazw między rejestrami).

Uruchomienie: `node etl/azbest.mjs`, `node etl/seveso.mjs`, `node etl/prtr.mjs`,
`node etl/przyroda-gdos.mjs`. Testy: `node --test etl/azbest.test.mjs etl/seveso.test.mjs
etl/prtr.test.mjs etl/przyroda-gdos.test.mjs etl/lib/geo.test.mjs etl/lib/nazwy.test.mjs`.

## Decyzje i ograniczenia

- **Azbest.** Liczymy obrysy budynków z azbestem, których odległość od punktu adresu wynosi najwyżej
  100 m (obrys, w którym leży adres, liczy się). Baza powstaje z inwentaryzacji gmin i zgłoszeń
  właścicieli, więc 0 oznacza brak wpisu, nie brak azbestu. Obrysy budynków są przypisane tylko do
  części wpisów (np. gmina Liszki: 56 obrysów wobec 1207 działek z wyrobami), dlatego udział adresów
  z wynikiem > 0 waha się od 4% (Wieliczka) do 54% (Igołomia-Wawrzeńczyce). Gmina bez żadnego obrysu
  budynku w bazie (ani z azbestem, ani oczyszczonego) dostałaby null; w obecnym zasięgu takich nie
  ma. Gminę rozpoznajemy po prefiksie TERYT w `nr_dzialki` (Kraków: cztery jednostki 1261xx).
- **Seveso.** Wykaz xlsx GIOŚ nie ma współrzędnych (tylko adres), więc współrzędne bierzemy z
  INSPIRE (żywy rejestr, 523 zakłady). Skrypt porównuje INSPIRE z bieżącym API rejestru GIOŚ dla
  województw małopolskiego, śląskiego i świętokrzyskiego i zatrzymuje się, gdy czegoś brakuje.
  Wykaz xlsx z 31.12.2025 zawiera jeszcze POLYNT w Niepołomicach (ZZR), którego nie ma już w
  bieżącym rejestrze ani w INSPIRE – nie liczymy go. Zakład to jeden punkt (środek terenu), a część
  współrzędnych (ok. 1,5%) ma dokładność ok. 1 km. Adres rejestrowy bywa siedzibą spółki, nie
  zakładem (ALKAT: Jasnogórska 9 to siedziba, instalacja stoi w Nowej Hucie), więc adresów z
  wykazu nie używamy do geokodowania.
- **PRTR.** To lista zakładów objętych obowiązkiem rejestracji (energetyka, przemysł, odpady, ścieki,
  duże fermy), nie pomiar emisji. Dla branż używamy działów NACE w polskich nazwach.
- **Przyroda.** Liczymy rezerwaty, parki narodowe i krajobrazowe, Natura 2000 (obszary ptasie i
  siedliskowe), użytki ekologiczne i zespoły przyrodniczo-krajobrazowe. Pomijamy otuliny
  (strefy buforowe w tej samej warstwie, rozpoznawane po nazwie), obszary chronionego krajobrazu
  (obejmują większość regionu), pomniki przyrody i stanowiska dokumentacyjne. Adres w obrębie
  obszaru = 0 m; przy nakładaniu się obszarów etykieta wskazuje ostrzejszą ochronę (park narodowy,
  rezerwat, park krajobrazowy, Natura 2000, użytek, zespół). Obszar chroniony to nie park
  rekreacyjny. MSIP `Gdos_Formy_Ochrony` dla Krakowa pomijamy: WFS GDOŚ jest kompletny i jednolity
  dla całego obszaru.
- **Etykiety** (nazwa najbliższego zakładu lub obszaru) są tylko w pobliżu (Seveso do 3 km, PRTR do
  1 km, przyroda do 300 m), żeby pliki nie rosły: każdy adres bez etykiety to `null` w tablicy.
- **Odległości** liczymy w EPSG:2180 (błąd skali w regionie ok. 0,07%, czyli ok. 3 m na 5 km).
  Odległości do punktów zaokrąglamy do 10 m (współrzędne źródłowe mają 4 miejsca po przecinku),
  do obszarów do 1 m, przy czym 0 oznacza wyłącznie wnętrze obszaru.
