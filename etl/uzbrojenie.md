# Uzbrojenie terenu – `uzbrojenie_{gaz,woda,prad,kanalizacja}_50m` (zadanie #72)

Cztery flagi na adres: czy w promieniu 50 m od punktu adresu przebiega sieć gazowa, wodociągowa,
elektroenergetyczna i kanalizacyjna według geodezyjnej ewidencji sieci uzbrojenia terenu (GESUT).
`1` – sieć jest w ewidencji, `0` – ewidencja jej tu nie pokazuje, `null` – brak danych.
Uruchomienie: `node etl/uzbrojenie.mjs`, testy: `node --test etl/uzbrojenie.test.mjs etl/lib/msip-obraz.test.mjs`.
Pokrycie wzrosło z 34,9% (61 634 adresów) do 99,99% (176 659 z 176 684).

## Źródła i licencja

| Obszar | Adresy | Źródło |
|---|---|---|
| Kraków | 70 217 | MSIP, usługa WMS „Geodezyjna Sieć Uzbrojenia Terenu” miasta (`arcgis/services/WMS/GESUT/MapServer/WMSServer`, warstwy `siec_gazowa`, `siec_wodociagowa`, `siec_elektroenergetyczna`, `siec_kanalizacyjna`) |
| 13 gmin wokół Krakowa | 106 467 | GUGiK, Krajowa Integracja Uzbrojenia Terenu (KIUT), usługa zbiorcza WMS kaskadująca GESUT powiatów |

- **KIUT dla Krakowa jest pusty.** Obraz z Rynku Głównego ma 1 KB bez żadnego piksela sieci: miasto
  publikuje GESUT tylko w MSIP. Sieć widziana w KIUT po drugiej stronie granicy dawała dotąd
  adresom z obrzeży Krakowa fałszywe zera: 2 550 takich adresów miało wartość, z czego 83–91% to 0,
  a MSIP daje dla tych samych adresów 0 tylko w 1–6% przypadków (gaz 5,7%, woda 1,5%, prąd 1,0%,
  kanalizacja 2,6%).
- **MSIP – licencja.** Regulamin (https://msip.krakow.pl/getHtml?dok_id=228972): usługa przeglądania
  WMS jest powszechna i nieodpłatna (pkt 10), ale dane spoza OPEN DATA, w tym GESUT, „służą do
  przeglądania i wyszukiwania bez możliwości ich pobrania z portalu w postaci wektorowej
  i obiektowej” (pkt 22), a ciągłe, zorganizowane pośredniczenie w usługach wymaga zgody
  administratora (pkt 8–9). Dlatego pytamy wyłącznie usługę WMS o **obrazy** (GetMap), nigdy REST
  `query` ani WFS o wektory, pobieramy je **jednorazowo** do `etl/.cache/` (poza gitem) i
  publikujemy tylko flagę „sieć w 50 m”, a nie obrazy ani geometrię. Źródło jest w `meta.zrodla`
  każdego wskaźnika (pkt 7). Ryzyko pozostaje: pierwszy komentarz w #72 zwracał uwagę, że liczenie
  pikseli z WMS dla dziesiątek tysięcy adresów to szara strefa, więc decyzja o publikacji tej
  warstwy należy do właściciela.
- **KIUT – licencja.** GetCapabilities: Fees „Brak opłat”, AccessConstraints „NONE”.
- **robots.txt i tempo.** `msip.um.krakow.pl` nie ma pliku robots.txt (404), `integracja.gugik.gov.pl`
  zezwala na `/cgi-bin/*`, a serwery przekierowania `integracja01/02` też nie mają pliku. Zapytania
  idą po dwa równolegle, z przerwą 0,25 s (KIUT) i 0,5 s (MSIP) po każdym obrazie; zapytania do MSIP
  podpisują się `User-Agent: adresscore-etl/1.0 (HackYeah 2026; https://adresscore.pl)`.
  Pierwszy bieg to ok. 2 870 zapytań GetMap: 2 × 1 204 obrazów KIUT (dwa przebiegi), 44 dokładki
  KIUT i 416 obrazów MSIP.

## Metoda

1. Siatka kafli 2 × 2 km w EPSG:2180, tylko tam, gdzie są adresy źródła (104 kafle w Krakowie,
   301 poza). Obraz kafla ma 250 m zapasu z każdej strony, równe zasięgowi sprawdzania danych, więc
   koło wokół adresu nigdy nie wychodzi poza obraz.
2. GetMap każdej z czterech warstw: MSIP – WMS 1.1.1 (BBOX zawsze x,y), PNG8, 0,625 m/px,
   obraz 4000 × 4000 px; KIUT – WMS 1.3.0 (oś północ-wschód), 2 m/px, obraz 1250 × 1250 px.
   Warstwy GESUT w MSIP rysują się tylko poniżej ok. 0,66 m/px (`MaxScaleDenominator` 2362):
   przy 0,7 m/px obraz jest pusty, przy 0,65 i 0,625 – pełny.
3. PNG → maska pikseli o kryciu ≥ 16. KIUT zwraca raz paletę (z `tRNS`), raz RGBA. Linie mają
   krycie ok. 50% (alfa ≈ 130), cienkie schodzą poniżej 64, więc próg 16 daje pełniejszy obraz sieci
   niż dawny 64, a ucina tylko smugi wygładzania.
4. Adres = 1, gdy w kole 50 m jest piksel sieci, inaczej 0. Test koła ma 2r + 1 odczytów dzięki
   sumom wierszy maski (wcześniej (2r + 1)²; przy kole 250 m i pikselu 0,625 m to 801 zamiast
   640 tys. na adres).
5. Adres, w którego promieniu 250 m nie ma żadnej z czterech sieci, dostaje `null` we wszystkich
   flagach: nie wiadomo, czy rur nie ma, czy ewidencji. Kafel niepobrany też daje `null`.

## Dwa błędy, które zaniżały pokrycie

1. **Dekoder PNG czytał tylko obrazy z paletą.** KIUT zwraca dla ok. 45% obrazów PNG RGBA
   (548 z 1204; 137 z 301 kafli ma co najmniej jedną taką warstwę), a taki kafel był po cichu
   pomijany w całości: **do pierwszej wersji trafiło 55% adresów obwarzanka** (Michałowice 7%,
   Liszki 24%, Zabierzów 32%). Dekoder czyta teraz RGBA (test na wszystkich pięciu filtrach PNG).
2. **KIUT po cichu oddaje puste obrazy.** Kaskada do usługi powiatu potrafi zwrócić HTTP 200 z PNG
   bez żadnego piksela sieci, gdy powiat chwilowo zawodzi. Ponowne pobranie 28 obrazów o mniej niż
   500 pikselach: 15 miało za drugim razem od 0,5 do 60 tys. pikseli (w tym wszystkie 12 pustych PNG
   1-bitowych), prawie wszystkie w okolicy Koniuszy i Kocmyrzowa. Skutek: jeden kafel dawał 177
   adresom `0` dla prądu, który tam jest. Dlatego każdy obraz KIUT pobieramy dwa razy (drugi
   przebieg po całym pierwszym), maski sumujemy – zły obraz ma zawsze mniej pikseli, nigdy więcej –
   a wynik uznajemy za pewny dopiero przy dwóch dobrych przebiegach (co najmniej 90% pikseli
   najlepszego). Obraz z przebiegiem, który zawiódł, albo z sumą poniżej 500 pikseli dostaje
   kolejne przebiegi, najwyżej do pięciu.
   Wynik: 1 167 z 1 204 obrazów było w obu przebiegach identycznych, a 31 (2,6%) miało w jednym
   przebiegu ponad 10% pikseli mniej (14 pustych, 14 poniżej połowy, 3 częściowe), prawie wszystkie
   w gminie Koniusza i jej sąsiedztwie, dwa w Niepołomicach z pustym drugim przebiegiem. Dokładkę
   dostały 44 obrazy (31 z awarią i 13 rzadkich) i każda była dobra, więc żaden obraz nie został
   bez dwóch dobrych przebiegów. Dwa przebiegi z sumą naprawiają awarię jednego z nich, a dokładka
   potwierdza, że przebieg uznany za dobry nie jest sam tylko częścią sieci.
   MSIP tego nie wymaga: ponowne pobranie 8 obrazów (od najmniejszego po największy, 2,8 mln
   pikseli sieci) dało obrazy identyczne co do piksela.

## Kontrole (2026-10-04)

| Kontrola | Wynik |
|---|---|
| Skala rysowania warstw MSIP | 1,0 m/px i 0,7 m/px: obraz pusty (384 i 637 B); 0,65 i 0,625 m/px: 55–58 KB z przewodami |
| WMS GetMap vs REST `export` tego samego okna, Rynek Główny | ten sam obraz co do bajta (78 389 B): oś i BBOX WMS 1.1.1 są dobrze odczytane |
| Odległość do sieci z kafla vs z osobnego małego okna na adresie, MSIP, 52 adresy (woda 16, gaz, prąd i kanalizacja po 12) | różnica 0,0–6,5 m (woda do 3,1 m), bez przesunięcia w jedną stronę; rozrzut z innego położenia etykiet w innym oknie |
| To samo, KIUT woda i prąd, 20 adresów | różnica 0,0–1,8 m; jeden adres 4,4 m |
| Wpływ etykiet średnic na flagi MSIP: obraz bez etykiet (REST, `showLabels: false`) w 3 kaflach obrzeży, 1 617 adresów | jedynka tylko dzięki etykiecie: gaz 6, woda 3, prąd 0, kanalizacja 2 adresy (≤ 0,4%); w centrum Rynku 181 adresów, zero różnic |
| Próg krycia KIUT 64 vs 16, 106 467 adresów obwarzanka | 0 → 1 po obniżeniu: gaz 133, woda 1 087, prąd 45, kanalizacja 836 adresów |
| Wrażliwość MSIP na promień (Kraków, 104 kafle, 70 217 adresów) | w paśmie 35–50 m od sieci leży 2,1% adresów dla gazu, 1,0% wody, 0,4% prądu, 0,8% kanalizacji; w paśmie 50–65 m: 1,3%, 0,3%, 0,1%, 0,4% |
| Spójność kafli MSIP | 104 kafle: żadna warstwa bez pikseli, żaden kafel z rozbieżnością odsetka jedynek między sieciami powyżej 50 punktów |
| Test jednostkowy: mutacje kodu | osiem celowych błędów (bpp, filtr Paeth, suma wierszy, promień koła, próg, oś BBOX, zapas, podział źródeł) wywala testy |
| Zgodność ze starym wskaźnikiem, 59 084 adresy obwarzanka z wartością w obu wersjach | zgodnych: gaz 99,9%, woda 99,2%, prąd 99,97%, kanalizacja 99,3%. Zmiany tylko 0 → 1 (54, 458, 17, 421), **żadnej 1 → 0**; po samym pierwszym przebiegu było 795 takich zmian dla prądu i 684 dla wody, prawie wszystkie w gminie Koniusza (puste obrazy KIUT) |
| Łaty bez sieci: komórki 500 m z co najmniej 15 adresami, wszystkie z zerem | Kraków (1 197 komórek): woda, prąd i kanalizacja 0, gaz 5. Obwarzanek (3 211): gaz 2, woda 1, prąd 1, kanalizacja 14 (wsie bez kanalizacji). W pierwszym przebiegu KIUT było ich dla wody 20, a dla prądu 16 |
| Zera w starych adresach przy granicy Krakowa (2 550 adresów z wartością z KIUT) | stare zera: gaz 88,5%, woda 90,8%, prąd 82,8%, kanalizacja 89,5%; nowe z MSIP: 5,7%, 1,5%, 1,0%, 2,6% |

## Pokrycie i ograniczenia

| Obszar | Adresy | Z wartością | Jedynki wśród adresów z wartością: gaz / woda / prąd / kanalizacja |
|---|---|---|---|
| Kraków (MSIP) | 70 217 | 70 217 (100%; przed: 2 550, 3,6%) | 95,4% / 99,3% / 99,7% / 99,0% |
| 13 gmin wokół (KIUT) | 106 467 | 106 442 (99,98%; przed: 59 084, 55,5%) | 95,1% / 98,5% / 99,4% / 95,6% |
| Razem | 176 684 | 176 659 (99,99%; przed: 61 634, 34,9%) | 95,2% / 98,8% / 99,5% / 96,9% |

- **25 adresów bez danych** (Liszki 17, Kocmyrzów-Luborzyca 4, Koniusza 3, Igołomia-Wawrzeńczyce 1):
  w promieniu 250 m nie ma żadnej z czterech sieci.
- **Zera są informacją, ale słabszą niż jedynki.** W Krakowie: gaz 3 211 adresów (4,6%), woda 498,
  prąd 211, kanalizacja 690. W gminie Koniusza kanalizacja ma 50% jedynek: ewidencja nie pokazuje
  jej przy połowie adresów tej wiejskiej gminy.

- **GESUT to ewidencja, nie pomiar.** `0` znaczy „ewidencja nie pokazuje sieci w 50 m”. Operatorzy
  nie zawsze przekazują dane (gaz i prąd na obrzeżach), więc część zer to luki ewidencji.
- **Granica gminy.** Sieć po drugiej stronie granicy nie jest widoczna w GESUT sąsiada, więc dla
  adresów przy granicy flaga bywa niższa niż stan faktyczny.
- **Przyłącze, nie budynek.** `1` oznacza „sieć w zasięgu przyłącza”, nie „budynek podłączony”.
- **Etykiety.** Etykiety średnic są pikselami tego samego koloru co linie; stoją przy przewodzie, więc
  błąd to kilka metrów, a flaga 1 tylko dzięki etykiecie dotyczy najwyżej 0,4% adresów na obrzeżach.
- Data danych w `meta` to data pobrania obrazów (najstarszy obraz w cache), nie data pomiarów.
- Odświeżenie: usuń `etl/.cache/uzbrojenie/` (albo tylko jego podkatalog źródła) i uruchom skrypt.
  `ZRODLO=kiut` albo `ZRODLO=msip` pobiera i liczy tylko jedno źródło (bez zapisu), `LIMIT_KAFLI=n`
  robi próbę na n kaflach, `TYLKO_CACHE=1` liczy bez sieci.
