# Popyt trybu „Biznes” (`etl/biznes-popyt.mjs`, E10 #105)

`node etl/biznes-popyt.mjs` (ok. 5 s, bez sieci) zbiera adresy w heksy H3 r10 i zapisuje
`public/dane/biznes/popyt.json`. Plik czyta `src/wynik/biznes.ts` (worker `biznes.worker.ts`).
Test: `node --test etl/biznes-popyt.test.mjs` (dane syntetyczne i prawdziwe pliki).

## Wejście i wyjście

| Plik | Rola |
| --- | --- |
| `public/dane/adresy.json` | adresy z heksem `h3`: Kraków z MSIP, 13 gmin obwarzanka z PRG (`etl/adresy.mjs`) |
| `public/dane/wskazniki/ludnosc_1km.json` | ludność oczka siatki 1 km (NSP 2021, `etl/gus.md`), ta sama przy każdym adresie oczka |
| `public/dane/wskazniki/kursy_szczyt_h.json` | kursy na godzinę w porannym szczycie z najbliższego przystanku (`etl/gtfs-przystanki.mjs`) |
| `public/dane/biznes/popyt.json` | wynik: `komorki`, `zrodla` oraz dodatkowo `wersjaAdresow` i `meta` |

Kontrakt czytnika to wyłącznie `komorki` i `zrodla`. Komórka to krotka
`[h3, lon, lat, adresy, ludnosc, kursy]`: liczba adresów w heksie, ludność NSP 2021 przypisana
adresom heksu (0,01 osoby) i średnie kursy adresów, które mają wartość (0, gdy żaden nie ma).
`meta` (data, obszar, gminy, bilans, opis kolumn) jest dodatkowe i czytnik go nie używa.
Indeks popytu liczy silnik: ludność, a gdy jej brak, dwa razy liczba adresów, z premią do 30%
za kursy (`popytKomorki`).

## Obszar: wszystkie adresy z adresy.json

Popyt obejmuje CAŁY plik adresów, czyli Kraków i obwarzanek, tą samą metodą. Stan z 2026-10-04
(wersja adresów `a7d233814059`): 176 684 adresy w 35 274 heksach, 1 289 oczek siatki 1 km.

| Gmina | TERYT | Adresy | Heksy | Ludność przypisana | Osób na adres |
| --- | --- | ---: | ---: | ---: | ---: |
| Kraków (MSIP) | 1261011 | 70 217 | 11 282 | 788 086 | 11,2 |
| Wieliczka | 1219053 | 22 017 | 4 161 | 68 809 | 3,1 |
| Niepołomice | 1219043 | 11 578 | 2 397 | 32 130 | 2,8 |
| Zabierzów | 1206162 | 11 288 | 2 327 | 28 957 | 2,6 |
| Skawina | 1206113 | 11 087 | 2 571 | 45 320 | 4,1 |
| Zielonki | 1206172 | 9 777 | 1 679 | 29 090 | 3,0 |
| Liszki | 1206072 | 7 564 | 1 669 | 18 891 | 2,5 |
| Kocmyrzów-Luborzyca | 1206052 | 6 726 | 2 011 | 17 668 | 2,6 |
| Wielka Wieś | 1206152 | 6 079 | 1 319 | 15 904 | 2,6 |
| Mogilany | 1206092 | 5 979 | 1 419 | 16 363 | 2,7 |
| Michałowice | 1206082 | 5 183 | 1 500 | 13 693 | 2,6 |
| Świątniki Górne | 1206143 | 3 895 | 864 | 12 007 | 3,1 |
| Koniusza | 1214012 | 2 945 | 1 387 | 9 614 | 3,3 |
| Igołomia-Wawrzeńczyce | 1206022 | 2 349 | 882 | 7 894 | 3,4 |

Dwie uwagi do tabeli:

- „Ludność przypisana” to ludność oczek 1 km rozdzielona na adresy gminy, a nie ludność gminy:
  oczko przy granicy zawiera też mieszkańców sąsiada, a każdy adres w nim dostaje swój udział.
  Heksy na granicy gmin liczą się w obu gminach, więc kolumna „Heksy” nie sumuje się do 35 274.
- Liczba adresów nie jest porównywalna między źródłami: MSIP (Kraków) ma ok. 11 osób na adres,
  PRG (obwarzanek) ok. 3. Do porównań między obszarami służy ludność (kolumna 5 komórki), nie
  liczba adresów.

## Metoda i bilans

1. Adres → oczko siatki 1 km w EPSG:3035 (`oczkoSiatki`, ta sama definicja co w `etl/gus.mjs`).
2. Ludność oczka (`ludnosc_1km`) dzielimy równo między adresy tego oczka i sumujemy w heksach.
   Oczko liczy się więc raz, a nie tyle razy, ile ma adresów.
3. Skrypt przerywa pracę, gdy wskaźnik ma w jednym oczku różne wartości (inne oczko tu, inne w
   `gus.mjs`), gdy wersje wejść się różnią i gdy bilans się nie domyka.

**Bilans:** suma ludności w heksach = suma ludności oczek 1 km, w których leży choć jeden adres:
1 104 427,86 w heksach wobec 1 104 426 w oczkach. Różnica 1,86 osoby to zaokrąglenia do 0,01 na
heks. Pilnuje tego test (suma liczona niezależnie od skryptu, z `adresy.json` i `ludnosc_1km.json`),
a `meta.bilans` zapisuje obie liczby w pliku. Oczka bez żadnego adresu w `adresy.json` do bilansu
nie wchodzą: ich mieszkańców popyt nie widzi.

## Poza obszarem popytu

Katalog usług (`public/dane/uslugi`) leży w prostokącie 49,84–50,30 N, 19,58–20,46 E (margines
ok. 3 km, żeby punkty tuż za granicą gminy były widoczne), a adresy w prostokącie 49,888–50,245 N,
19,653–20,363 E. Punkt usługi bez heksu popytu w zasięgu branży (500–2000 m) nie ma popytu.
Stan z 2026-10-04, katalog 26 branż: 2 412 z 18 739 punktów (13%), np. 571 z 2 619 sklepów
spożywczych. Żaden z nich nie leży bliżej niż 500 m od adresu, 1 269 dalej niż 5 km. To głównie
margines katalogu i sąsiednie gminy poza 14 gminami z adresami, a nie brak popytu w obwarzanku:
każda z 13 gmin ma heksy popytu, a ocena miejsca w centrum Wieliczki, Skawiny czy Niepołomic daje
percentyl i konkurentów.

Takie punkty nie wchodzą do rozkładu porównawczego percentyla, ale liczą się jako konkurenci miejsc,
w których zasięgu leżą (`src/wynik/README.md`, sekcja Biznes). Żeby popyt objął sąsiednie gminy,
trzeba dopisać je do `GMINY` w `etl/adresy.mjs` i przeliczyć kolejno `adresy`, `gus`,
`gtfs-przystanki` oraz ten skrypt. Test „każda gmina z katalogu usług ma heksy popytu” pilnuje, żeby
katalog nie wyszedł poza obszar popytu.

## Czego popyt nie mówi

Ludność z NSP 2021 w oczku 1 km to kontekst mieszkaniowy, nie ruch pieszych, nie liczba klientów
ani prognoza (`etl/gus.md`). Heks r10 ma ok. 65 m, a ludność ma rozdzielczość 1 km, więc różnice
między sąsiednimi heksami tego samego oczka wynikają z liczby adresów, nie z pomiaru.
