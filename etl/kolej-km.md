# Kolej i busy Kolei Małopolskich: `kolej_*` i `bus_mld_*` (#111)

`node etl/kolej-km.mjs [YYYY-MM-DD] [--odswiez]` liczy cztery warstwy `transport` dla każdego z 176 684
adresów. Istniejące `przystanek_odleglosc` i `kursy_szczyt_h` (ZTP) zostają bez zmian. Testy:
`node --test etl/kolej-km.test.mjs`.

| id | Co mierzy | Jedn. | Kierunek | Skala |
|---|---|---|---|---|
| `kolej_odleglosc` | linia prosta do najbliższej stacji z odjazdem pociągu KM | m | mniej-lepiej | 0–5000 |
| `kolej_kursy_szczyt_h` | odjazdy 07:00–09:00 z tej stacji, obie strony łącznie | kursy/h | wiecej-lepiej | 0–8 |
| `bus_mld_odleglosc` | linia prosta do najbliższego przystanku MLD z odjazdem | m | mniej-lepiej | 0–1500 |
| `bus_mld_kursy_szczyt_h` | odjazdy 07:00–09:00 z zespołu przystankowego tego przystanku, obie strony i wszystkie linie | kursy/h | wiecej-lepiej | 0–8 |

## Źródła (gtfs.kolejemalopolskie.com.pl, stan z 2026-10-03)

| Feed | Wydawca w `feed_info` | Ważny | Stan danych | SHA-256 |
|---|---|---|---|---|
| `kml-ska-gtfs.zip` (kolej SKA) | Koleje Małopolskie sp. z o.o. | 2026-10-02 – 2026-12-12 | 2026-10-02 | `2d00759f9995…` |
| `GTFS.zip` z sekcji MLD (busy MLD), w cache jako `mld-gtfs-rg.zip` | R&G PLUS Sp. z o.o., wersja 1381 | 2026-10-01 – 2026-11-30 | 2026-10-01 | `d1f561093e55…` |

**Dlaczego nie `ald-gtfs.zip` dla busów.** Ten plik ma stan z 2026-08-31, a MLD zmieniły się od tamtej
pory. W środę 2026-10-07 brakuje w nim trzech linii: A67 (Proszowice – Kocmyrzów-Luborzyca – Kraków,
16 kursów), A73 (Skawina – Kraków, 32 kursy) i A74 (Tarnów – Wojnicz, 6 kursów), a w A57 i A13 ma mniej
kursów (32 zamiast 50 oraz 8 zamiast 10). Pozostałe 64 linie mają tyle samo kursów. Skutek dla
`bus_mld_odleglosc` (mediana do najbliższego przystanku, `ald` → `GTFS.zip`): Kocmyrzów-Luborzyca
7814 → 2171 m, Skawina 1112 → 960 m, Michałowice 5713 → 5156 m, Koniusza 4825 → 2204 m, Kraków
1551 → 1220 m; w żadnej gminie nie jest gorzej. Feed `kolej/gtfs.zip` (kiedyPrzyjedzie.pl, 2026-10-03)
ma te same 118 czynnych stacji i niemal ten sam rozkład (205 kursów zamiast 206 w dniu pomiaru), więc
posłużył tylko do kontroli.

## Licencja i atrybucja

To **nie jest CC BY 4.0**, jak zakładało zgłoszenie. Wydawca opublikował własne zasady
([BIP, art. 2934167](https://bip.malopolska.pl/malopolskiekoleje,a,2934167,zasady-udostepniania-i-ponownego-wykorzystywania-danych-gtfs.html),
ustawa z 11.08.2021 o otwartych danych): dane wolno bezpłatnie pobierać, przetwarzać, łączyć i
rozpowszechniać, także komercyjnie, pod warunkami:

1. wskazania Kolei Małopolskich sp. z o.o. jako źródła,
2. podania daty pozyskania danych albo ostatniej aktualizacji,
3. poinformowania o przetworzeniu, jeśli wynik nie odpowiada danym źródłowym,
4. nieprzedstawiania danych przetworzonych jako niezmienionych danych spółki,
5. niepodawania nazwy ani znaków spółki tak, jakby zatwierdzała lub współtworzyła produkt.

Spełnienie: `zrodla[]` każdej warstwy ma nazwę spółki, datę stanu (`dataDanych`) i datę pobrania, a
`opis` mówi, że wartość jest obliczona przez adresscore. Spółka nie odpowiada za sposób wykorzystania
danych. Strona metody powinna powtórzyć: „Koleje Małopolskie sp. z o.o., rozkład GTFS, stan z
<data>; dane przetworzone przez adresscore”. Logotypów KM nie używamy. Wzmianki o CC BY 4.0 (Transitland,
dane.gov.pl) dotyczą portalu otwartych danych województwa, nie tej strony; nie opieramy się na nich.

## Metoda

- **Dzień pomiaru:** najbliższa środa od dnia uruchomienia (ten sam dzień, gdy jest środa); w biegu
  z 2026-10-03 to 2026-10-07. Ten sam dzień dla odległości i kursów oraz dla `kursy_szczyt_h` (ZTP).
- **Czynny punkt:** ma co najmniej jeden odjazd z możliwością wsiadania w dniu pomiaru. Ostatni
  przystanek kursu nie jest odjazdem. `pickup_type=1` wyklucza wsiadanie; `pickup_type=3` nie wyklucza
  (tak R&G oznacza przystanki MLD na żądanie, to 92% wierszy tego feedu). Punkty z `location_type`
  innym niż 0 (stacje nadrzędne) nie są miejscem wsiadania.
- **Kalendarz:** `calendar.txt` z wyjątkami `calendar_dates.txt`. Feed SKA nie ma `calendar.txt`, tylko
  daty z `exception_type=1`, więc oba pliki są opcjonalne, byle jeden istniał (funkcja `uslugiDnia`).
- **Odległość:** po wielkim okręgu w metrach, zaokrąglona do 1 m, do najbliższego czynnego punktu.
  Limit 60 km nigdy nie zadziałał (największa odległość to 13,3 km), więc nie ma `null`.
- **Kursy:** odjazdy z czasem w przedziale [07:00, 09:00) podzielone przez 2 h. Dla kolei punktem jest
  stacja. Dla MLD sumujemy stanowiska tej samej stacji nadrzędnej (`parent_station`), więc strona
  jezdni nie ma znaczenia. `0` to zmierzone zero: punkt czynny w dniu, ale bez odjazdu w szczycie.
- Wartości są surowe, bez etykiet (pliki 0,4–0,9 MB). Ocenę 0–100 liczy `src/wynik`: warstwy bez
  normy ocenia rangowo wśród adresów z danymi (mediana = 50), a `zakres` tylko przycina wartości
  skrajne, więc odległość powyżej 5 km (kolej) i 1,5 km (MLD) jest oceniana tak samo. `zakres` wyznacza
  też domyślny próg twardego filtra w panelu (środek przedziału).

## Kontrola (dzień pomiaru 2026-10-07)

Pokrycie 176 684 z 176 684 (Kraków 70 217, obwarzanek 106 467) dla każdej warstwy.
Czynne: 118 z 140 stacji SKA (206 kursów), 4276 z 4297 przystanków MLD (1309 kursów).

| Warstwa | Kraków: mediana / p95 | Obwarzanek: mediana / p95 |
|---|---|---|
| `kolej_odleglosc` [m] | 1585 / 3906 | 3029 / 8016 |
| `kolej_kursy_szczyt_h` | 2,5 / 8 | 2 / 4 |
| `bus_mld_odleglosc` [m] | 1220 / 3196 | 1032 / 6128 |
| `bus_mld_kursy_szczyt_h` | 2 / 10,5 | 1 / 4,5 |

Znane adresy (skrypt wypisuje je po każdym biegu):

| Adres | Stacja kolejowa | Przystanek MLD |
|---|---|---|
| Kraków, Pawia 5 | Kraków Główny, 143 m, 8 kursów/h | Kraków MDA, 272 m, 6 kursów/h |
| Kraków, Rynek Główny 10 | Kraków Grzegórzki, 790 m, 8 kursów/h | Jubilat, 907 m, 10,5 kursów/h |
| Wieliczka, Rynek Górny 7 | Wieliczka Rynek-Kopalnia, 404 m, 2 kursy/h | Wieliczka Magistrat, 215 m, 1,5 kursów/h |
| Skawina, Rynek 2 | Skawina, 345 m, 1 kurs/h | Skawina Rynek, 148 m, 4 kursy/h |
| Kocmyrzów, Na Błonie 6 | Baranówka, 1959 m, 1,5 kursów/h | Kocmyrzów-Luborzyca Urząd Gminy, 384 m, 1,5 kursów/h (linia A67) |
| Niepołomice, Rynek 19 | Staniątki, 2550 m, 2,5 kursów/h | Niepołomice Rynek, 131 m, 3,5 kursów/h |

Kontrole niezależne:
- 3000 losowych adresów porównanych z pełnym przeszukaniem wszystkich czynnych punktów: 0 rozbieżności
  w odległości i kursach, dla kolei i MLD.
- Rozkład Wieliczki Rynek-Kopalnia sprawdzony ręcznie w feedzie: kurs co 30 min (07:11, 07:41, 08:11,
  08:41), czyli 2 kursy/h z końcówki linii.
- Współrzędne stacji wobec OpenStreetMap: Skawina Zachodnia 18 m, Kraków Mydlniki 188 m, Kraków
  Przylasek 343 m od położenia w OSM (feed `kolej/gtfs.zip` ma tu 100, 65 i 1 m).

## Ograniczenia

- Linia prosta, nie droga: rzeka, tory i ogrodzenia wydłużają dojście. To nie jest czas dojazdu.
- Współrzędne stacji w GTFS KM bywają odsunięte od peronów do ok. 350 m (patrz wyżej). Przy skali
  0–5000 m to mało, ale dla pojedynczych adresów przy tych stacjach wynik bywa zaniżony lub zawyżony.
- Tylko pociągi i busy Kolei Małopolskich. Brak PKP Intercity i Polregio (osobny feed
  mkuran.pl, autor ostrzega „unstable”; pominięty, bo poza zakresem zadania).
- To plan rozkładowy w jedną środę, nie rzeczywiste kursy; GTFS-RT niewykorzystany.
- Kursy to częstotliwość jednego punktu (stacji albo zespołu przystankowego), nie sieci, i obie strony
  łącznie. Punkt może leżeć daleko od adresu, więc ocenia się go razem z odległością, tak jak
  `kursy_szczyt_h` ze `przystanek_odleglosc`.
- Plik obowiązuje dla daty pomiaru. MLD są ważne do 2026-11-30, SKA do 2026-12-12; potem trzeba
  przeliczyć (`--odswiez` pobiera nowe archiwa).

## Dla integratora i routingu

- Nowe warstwy `transport` bez wpisu w `persony.ts` dostają `wagaNowych` (2 dla rodziny, singla i
  seniora, 1 dla inwestora) i od razu wchodzą do wyniku, cztery naraz. Decyzja integratora: jawne wagi
  w `persony.ts`. Rada: `kolej_*` wyżej dla gmin obwarzanka, `bus_mld_*` niżej, bo MLD to linie
  dowozowe do Krakowa, a w mieście dostęp zapewnia ZTP (mediana odległości do MLD w Krakowie to 1,2 km).
- Archiwa leżą w `etl/.cache/kolej-km/` (`kml-ska-gtfs.zip`, `mld-gtfs-rg.zip`, obok `.json` z SHA-256,
  datą pobrania i stanem). Dla grafu routingu (#38, #60) `odczytajFeed` z `dojazd-gtfs.mjs` wymaga
  `calendar.txt`, którego SKA nie ma; `uslugiDnia` z `kolej-km.mjs` obsługuje oba przypadki.
