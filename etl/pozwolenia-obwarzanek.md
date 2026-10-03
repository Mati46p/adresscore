# Pozwolenia na budowę w obwarzanku – `inwestycje_500m_obwarzanek`

Uruchom `node etl/pozwolenia-obwarzanek.mjs` (Node 24). Pierwszy bieg pobiera zip RWDZ (35 MB)
i około 12 tys. geometrii działek z ULDK (ok. 35 min przy 8–10 zapytaniach naraz; wynik każdej
działki ląduje w `etl/.cache/`), kolejne biegi nie dotykają sieci poza jednym zapytaniem o datę
stanu zasobu. `--bez-pobierania` to tryb suchy: tylko cache, nic nie zapisuje.
Test: `node --test etl/pozwolenia-obwarzanek.test.mjs etl/lib/uldk.test.mjs`.

## Co mierzy

Liczba pozwoleń na budowę, rozbudowę i nadbudowę budynków wydanych od 2025-01-01 do stanu
rejestru (2026-09-30), których środek działek leży do 500 m od adresu. Surowa liczba (szt.),
kierunek `neutralny`, zakres 0–50 jak w `inwestycje_500m`. Wartość dla 106 467 adresów 13 gmin
obwarzanka, `null` dla Krakowa (tam obowiązuje `inwestycje_500m` z MSIP). Etykiet nie ma:
przy 106 tys. adresów ważyłyby kilka MB, a wskaźnik ma 0,6 MB.

## Skąd dane

- **Decyzje:** Rejestr Wniosków, Decyzji i Zgłoszeń GUNB (RWDZ), dane.gov.pl, zbiór 3467,
  zasób 2716739, licencja CC0 1.0. CSV dla Małopolski: 522 188 wierszy (decyzja × działka, od
  2016). Od 2025-01-01 w 34 gminach (13 gmin obwarzanka, Kraków i 20 sąsiednich): 11 693 decyzji,
  do liczenia 7 778. Nazwisk inwestorów i projektantów nie czytamy (dane osobowe).
- **Położenie:** RWDZ nie ma współrzędnych, ma jednostkę ewidencyjną, obręb i numer działki.
  Z tego powstaje identyfikator `WWPPGG_R.OOOO.NR`, a geometrię daje ULDK GUGiK (EGiB, bez opłat).
  Punkt decyzji to środek ciężkości jej działek ważony polem – tak jak MSIP-owy `pozwolenia.mjs`.
  Działka, której ULDK nie zna (podzielona, scalona lub przenumerowana po decyzji), dostaje
  geometrię sąsiedniego podnumeru albo działki macierzystej (339 działek, rzędu kilkudziesięciu
  metrów błędu); decyzja bez żadnej rozpoznanej działki jest pomijana (114, czyli 1,5%), podobnie
  decyzja, której działki leżą dalej niż 2 km od siebie (średnia z nich wskazywałaby miejsce, gdzie
  nic nie powstaje; w danych to pojedyncze przypadki).
  „Brak wyników" z komunikatem „usługa nie zwróciła odpowiedzi" to awaria serwera powiatu,
  nie brak działki: nie trafia do cache, tylko jest ponawiana.
- **Zasięg:** liczą się decyzje z 13 gmin, z Krakowa (jednostki RWDZ 126102–126105) i z 20 gmin
  dotykających bufora 600 m wokół tego obszaru (ULDK `GetCommuneByXY`, 2026-10-03). Bez sąsiadów
  okrąg 500 m byłby ucięty dla 4 532 adresów (4,3%).

## Definicja (jak `inwestycje_500m`)

Decyzje od 2025-01-01; zakres budowa, rozbudowa lub nadbudowa (pole zamierzenia; „roboty inne"
tylko, gdy opis zaczyna się od budowa|rozbudowa|nadbudowa); 500 m w EPSG:2180, odległość płaska
(błąd skali poniżej 0,1%); bez sieci, instalacji, dróg i reklam; bez dostawek wind, dźwigów
i balkonów do istniejących budynków. Infrastrukturę rozpoznaje pierwszy obiekt w opisie
(„Budowa instalacji gazowej w budynku" to instalacja, „Budynek z instalacjami" to budynek),
a gdy opis nie rozstrzyga – kategoria obiektu z załącznika do Prawa budowlanego (I–III, IX–XVIII)
i rodzaj inwestycji.

## Różnice względem MSIP

- RWDZ nie podaje rodzaju rozstrzygnięcia. Plik to pozwolenia na budowę (symbol sprawy 6740),
  bez odmów i umorzeń, które MSIP rozróżnia.
- Zmiany wcześniejszych decyzji („Zmiana decyzji nr …") odrzucamy: to nie nowe pozwolenia.
  Filtr MSIP przepuszcza część z nich (78 z 1423).
- Rejestr bywa niespójny: zakres „rozbudowa" przy opisie „Przebudowa i remont…" albo „Rozbiórka…"
  traktujemy jak brak nowej zabudowy.
- Dwa rejestry nie są tym samym zbiorem. W Krakowie 83% decyzji z RWDZ ma w MSIP decyzję
  z tą samą datą w 100 m, a 72% decyzji MSIP ma odpowiednik w RWDZ.

## Kontrola jakości (bieg 2026-10-03, dane RWDZ z 2026-09-30)

| Kontrola | Wynik |
|---|---|
| Kraków, ta sama metoda z RWDZ vs `inwestycje_500m` (70 217 adresów) | średnio 4,99 vs 5,35 (93%), korelacja 0,86 |
| Położenie z ULDK vs punkty MSIP (1 243 decyzje w Krakowie) | mediana odległości 8 m; 83% decyzji ma odpowiednik MSIP w 100 m |
| Niezależnie: decyzje z ulicą i numerem domu vs nasze punkty adresowe (224) | mediana 15 m, 92% w 100 m, 0,4% powyżej 500 m |
| Rozrzut działek jednej decyzji (2 395 decyzji wielodziałkowych) | mediana 26 m, p99 441 m, 4 powyżej 1 km |
| Podłęże (Niepołomice): 11 decyzji z 2025-02-24 na dz. 1522 | adres obok ma co najmniej 11 (test) |

Rozkład wartości w 13 gminach: średnio 5,4, mediana 5, p90 10, p99 18, maks 34 (Bibice w gm. Zielonki);
4,6% adresów bez pozwoleń w 500 m. Średnia wg gminy: Zielonki 7,5; Michałowice 6,5; Niepołomice
i Wieliczka 6,2; Skawina 5,3; Kocmyrzów-Luborzyca 5,2; Zabierzów 4,9; Mogilany 4,8; Liszki 4,4;
Świątniki Górne 4,2; Wielka Wieś 3,8; Igołomia-Wawrzeńczyce 2,0; Koniusza 1,7. Średnia w Krakowie
(MSIP) to 5,35, więc liczby z obu stron granicy są tego samego rzędu.

## Ograniczenia

- Liczba pozwoleń to sygnał, że okolica się zmienia, nie ocena dobra ani zła: stąd `neutralny`.
  Wielkość inwestycji nie jest ważona: decyzja na osiedle liczy się jak decyzja na jeden dom
  (w RWDZ domy jednorodzinne mają zwykle osobne decyzje).
- Środek działki nie jest położeniem budynku: przy dużych działkach błąd sięga setek metrów.
- Pomijane decyzje bez położenia (1,5%) i ewentualne luki w samym rejestrze obniżają wartość;
  w Krakowie ta sama metoda daje 93% liczby z MSIP.
- Zgłoszenia budowy (bez pozwolenia) nie wchodzą do wskaźnika.
- Zamiast BDOT10k „Nowe budynki" użyliśmy ULDK; BDOT10k (WFS `…/BDOT10k/WFS/NoweBudynki`,
  warstwy `bud_2018`–`bud_2025`) odpowiada na zapytania i nadaje się na osobny wskaźnik
  „zrealizowanych" budynków, ale to inna miara niż pozwolenia i nie była potrzebna jako zapas.
