# Metropolia Krakowska (SMK): liceum, główne trasy rowerowe, wody (#113)

`node etl/metropolia-smk.mjs` (ok. 15 s) → `liceum_odleglosc`, `droga_rowerowa_odleglosc`,
`woda_odleglosc` w `public/dane/wskazniki/`. Pobrania MSIP trafiają jednorazowo do
`etl/.cache/msip/`. Testy: `node --test etl/metropolia-smk.test.mjs etl/lib/odleglosc-ksztalty.test.mjs`.

## Źródło

Usługi ArcGIS REST MSIP, folder `Metropolia_Krakowska`, zbiór „Metropolia Krakowska”
(https://msip.krakow.pl/dataset/2241): model struktury funkcjonalno-przestrzennej Strategii
Metropolia Krakowska 2030, wydawcy Prezydent Miasta Krakowa i Stowarzyszenie Metropolia Krakowska
(15 gmin: Kraków i 14 innych). Układ EPSG:2180 (nie 2178, jak w opisie zadania), limit 1000
rekordów na zapytanie, stan wszystkich użytych warstw 2021-12-16 (pole `data_utworzenia`).
Licencja: Regulamin MSIP, atrybucja „Gmina Miejska Kraków, Portal MSIP Obserwatorium
(https://msip.krakow.pl)”, więc liczymy pliki statyczne, bez pośredniczenia w usłudze.

| Usługa / warstwa | Zawartość | Liczba | Użyta |
|---|---|---|---|
| plansza 06 / 4 „licea ogólnokształcące” | tylko Kraków | 107 | tak, 72 po filtrze |
| plansza 06 / 3 „Licea_gminy_MK” | gminy; miesza licea z technikami, gimnazjami i szkołami dla dorosłych | 33 | tak, 8 po filtrze |
| plansza 06 / 2 „szkoły podstawowe” | tylko Kraków | 208 | nie (patrz niżej) |
| plansza 06 / 1 „Szkoly podstawowe_gminy MK” | gminy | 141 | nie |
| plansza 06 / 14 „granice administacyjne gmin” | 15 gmin z TERYT (`idTerytTer`) | 15 | zasięg danych i kontrola układu |
| plansza 03 / 9 „drogi_rowerowe_metropolia” | główne trasy rowerowe | 83 odcinki, 448 km | tak |
| plansza 02 (przestrzeń) / 6 „rzeki” | cieki BDOT | 5228, z czego 5158 na powierzchni | tak |
| plansza 02 (przestrzeń) / 7 „wody powierzchniowe” | zbiorniki BDOT | 1755 | tak |

Opis zadania wskazywał warstwy 2 i 4 planszy 06 jako źródło szkół „dla 13 gmin”, a one dotyczą
wyłącznie Krakowa. Szkoły gmin są w warstwach 1 i 3.

## Decyzje

- **Szkół podstawowych nie liczymy.** `szkola_podst_odleglosc` ma #8 (SIO, stan 2025-09-30,
  wszystkie adresy), a SMK ma stan z 2021 r. i nie obejmuje Koniuszy. Zgodnie z „nie dubluj”
  zostawiamy tę warstwę #8. Porównanie (SMK 2021 bez szkół specjalnych vs SIO 2025): w Krakowie
  mediana różnicy 1 m, p90 257 m, różnica ponad 500 m dla 3,5% adresów; w gminach 11 m, 388 m
  i 8,2%. Gdyby #8 zrezygnowało z tej warstwy, wystarczy dodać do skryptu warstwy 1 i 2 z filtrem
  „bez nazw zawierających SPECJALN” (zbiór ma wtedy 322 szkoły).
- **`kierunek: neutralny` dla wszystkich trzech.** Dane z 2021 r., liceów w 13 gminach jest 8,
  a trasy rowerowe to tylko główne szlaki. Bez kierunku od persony albo użytkownika silnik ich
  nie wlicza do wyniku. Zmiana na `mniej-lepiej` to jedna linia (`wspolne.kierunek`), ale
  wymaga decyzji o wadze.
- **Liceum dla młodzieży**: nazwa zawiera LICEUM albo LIC., a nie zawiera DOROS, ZAOCZN, WIECZOR,
  SPECJALN, TECHNIKUM, GIMNAZJUM, i szkoła ma więcej niż 0 uczniów (gdy źródło podaje liczbę;
  warstwa krakowska jej nie ma). Słowa kluczowe są bez polskich liter, bo nazwy szkół gmin mają
  zepsute kodowanie. Filtr odrzuca 35 ze 107 wpisów krakowskich i 25 z 33 wpisów gmin.
- **Woda**: osie cieków (bez odcinków pod ziemią, `polozenie` −1) i brzegi wszystkich zbiorników.
  Adres wewnątrz zbiornika ma 0 (dwa adresy, oba do 3,4 m od brzegu, czyli w granicach błędu położenia).
  Próg powierzchni zbiornika pominęliśmy: 71% zbiorników ma poniżej 0,1 ha, ale próg 0,1 ha
  zmienia medianę odległości z 225 na 246 m (dominuje gęsta sieć potoków).
- **Zasięg**: adres z gminy spoza 15 gmin SMK dostaje `null`. W naszych adresach to Koniusza
  (2 945 adresów). Odległość do obiektów sąsiadów byłaby fałszywym wynikiem, bo dane gminy
  nie zostały zebrane.
- **Odległość** w płaszczyźnie PL-1992 (zniekształcenie skali poniżej 0,07%, czyli poniżej 1 m
  na kilometr), zaokrąglona do pełnych metrów. Indeks siatkowy daje wynik dokładny (test
  porównuje go z przeglądem wszystkich odcinków).
- **Bez etykiet**: nazwa najbliższego obiektu dla każdego adresu zwiększyłaby plik tak, jak w innych
  warstwach z etykietami (7 – 13 MB wobec limitu 2 MB). Pliki wskaźników mają 0,7 – 0,9 MB.

## Ograniczenia

- Stan 2021: szkoły mogły się zmienić. Zbiór liceów w gminach jest mały (8), więc wartości
  w gminach są raczej odległością do Krakowa i kilku miast niż miarą dostępności.
- Przy granicy obszaru SMK najbliższy obiekt może leżeć poza zbiorem, wtedy odległość jest zawyżona.
- Trasy rowerowe to 448 km głównych szlaków, a nie sieć: duża odległość nie znaczy braku ścieżek.
- Cieki liczone od osi koryta (Wisła ma w danych ok. 100 m szerokości).

## Kontrola

- Układ współrzędnych: 6937 z 6937 próbkowanych adresów leży w granicy własnej gminy z planszy 06;
  punkty szkół krakowskich pokrywają się z punktami adresowymi MSIP (mediana 0 m).
- Adresy liceów (Studencka 12, Grzegórzecka 24, Krupnicza 44, Jana Sobieskiego 9, Zawiła 4) mają
  `liceum_odleglosc` 0 m.
- Rynek Główny 1: liceum 282 m, główna trasa rowerowa 30 m, woda 533 m (staw przy Plantach;
  Wisła jest 881 m od osi koryta).
- Skawina, Rynek 1: liceum 128 m; Wieliczka, Rynek Górny 1: 745 m; Radziszów, Rynek 1: 3689 m.
- Pokrycie: Kraków 70 217 z 70 217, pozostałe gminy 103 522 z 106 467 (brak Koniuszy), razem 98,3%.
