# Zabytki z rejestru NID w okolicy adresu – Kraków i gminy obwarzanka (#143)

Źródłem jest rejestr zabytków nieruchomych (księga A) Narodowego Instytutu Dziedzictwa, czyli
[zbiór 1130 na dane.gov.pl](https://dane.gov.pl/pl/dataset/1130,rejestr-zabytkow-nieruchomych)
(**CC BY 4.0**, aktualizacja kwartalna, stan zasobów 2026-09-30). Metadane INSPIRE tej usługi
podają „brak ograniczeń w dostępie i użyciu”. Wynik to `public/dane/wskazniki/zabytki_rejestr_500m.json`:
dla każdego z 176 684 adresów liczba wpisów rejestru w promieniu 500 m oraz etykieta, czy sam adres leży
w obrysie obiektu, na obszarze wpisanym albo w otoczeniu zabytku. Kategoria „kontekst”, neutralny
kierunek, bez wpływu na wynik.

## Skąd współrzędne

Otwarte pliki NID (CSV i REST API zbioru 1130) mają adresy bez współrzędnych, a po adresie PRG da się
zlokalizować tylko część pozycji (`etl/zabytki.mjs`, #125: poza Krakowem 11% adresów). Usługi WFS NID
obejmują wyłącznie Pomniki Historii i listę UNESCO. Warstwa „Dane do pobrania” portalu mapowego (SHP po
gminach) jest po stronie portalu chroniona logowaniem, więc jej nie używamy. Geometrię całego rejestru
oddaje publiczna usługa przeglądania
[INSPIRE WMS `Immovable_Monuments`](https://usluga.zabytek.gov.pl/INSPIRE_IMD/service.svc/get?request=GetCapabilities&service=WMS),
wskazana w tym samym zbiorze 1130, i to dwoma zapytaniami (`etl/lib/nid-wms.mjs`):

1. **GetMap w formacie SVG**, jedno żądanie dla całego regionu adresów z marginesem 500 m, w EPSG:2180
   (okno 19 953 × 15 842 px po 2,59 m, 1,07 MB). Odpowiedź zawiera wielokąty, linie i punkty wszystkich
   obiektów w kolejności bazy, ale bez atrybutów. Serwer czyta w WMS 1.3.0 BBOX tego układu jako
   „północ, wschód”; parser sprawdza zakres i skalę z metadanych SVG i zatrzymuje eksport przy każdej
   niezgodności.
2. **GetFeatureInfo jako sondy**: w punkcie wybranym wewnątrz obiektu (okno 6 × 6 m, piksel 10 cm)
   usługa zwraca `INSPIREID` i nazwy obiektów pod punktem, **w tej samej kolejności co w SVG**. Plan
   sond idzie od najmniejszych obiektów, więc sonda w budynku trafia też zespół i układ urbanistyczny
   nad nim: 2 591 zapytań (5 równolegle, ok. 1,5 minuty) przypisało identyfikatory 3 313 z 3 349 obiektów.
   Sonda jest brana pod uwagę tylko wtedy, gdy liczba zwróconych obiektów równa się liczbie obiektów
   SVG w punkcie; głosy z nakładających się sond są sumowane, a obiekt z dwoma różnymi identyfikatorami
   zatrzymuje eksport.

Kolejność GetFeatureInfo = kolejność SVG to zachowanie usługi, którego NID nie dokumentuje, więc jest
sprawdzane trzema niezależnymi kontrolami (niżej), a nie przyjmowane na wiarę.

## Co liczymy

Identyfikator niesie typ wpisu: BK budynek, BL budowla, MA mała architektura, ZE zespół, ZZ park,
CM cmentarz, UU układ urbanistyczny, KK krajobraz, SK szlak, **OT otoczenie lub strefa ochrony**.
Otoczenia to 516 z 3 197 wpisów w oknie (16%) i nie są zabytkami, więc nie liczą się do wartości.

- **Wartość**: liczba różnych wpisów (INSPIREID) bez otoczeń w promieniu 500 m, liczona po odległości od
  obrysu, więc wpis, w którego obrysie leży adres, liczy się (0 m). Wpis rysowany jako kilka obiektów
  (np. Kalwaria Zebrzydowska) liczy się raz. 0 znaczy brak wpisu w danych NID w tym promieniu.
- **Etykieta** (`obiekt`, `obszar`, `otoczenie`, brak): najsilniejsza klasa wpisu, w którego obrysie
  leży adres. `obiekt` to BK, BL, MA do 10 ha, `obszar` to ZE, ZZ, CM, UU, KK, SK oraz budowle powyżej
  10 ha (obrys wpisu kopalni soli w Wieliczce ma 235 ha i obejmuje centrum miasta), `otoczenie` to OT. Roboty przy
  obiekcie z rejestru i w jego otoczeniu wymagają pozwolenia wojewódzkiego konserwatora zabytków
  (art. 36 ustawy o ochronie zabytków i opiece nad zabytkami); na obszarze wpisanym zakres rozstrzyga
  konserwator.

## Kontrola jakości

| Kontrola | Wynik |
|---|---|
| Spójność sond | 2 453 z 2 591 sond spójnych, 138 odrzuconych (kolejne rundy sond brały inne punkty), **0 obiektów ze sprzecznym identyfikatorem** |
| Pokrycie wykazu CSV (zbiór 1130, po `INSPIRE_ID`) | 2 352 z 2 373 pozycji (bez otoczeń) z 14 gmin adresów ma obiekt w usłudze: **99,1%**, Kraków 1 882 z 1 900, 10 gmin 100% |
| Położenie względem adresów PRG (dokładne dopasowanie adresu z CSV) | 1 863 pozycji: mediana odległości punktu PRG od obiektu o tym samym id **0,0 m**, w obrysie 1 431 (77%), do 50 m 1 680 (90%), p90 49 m |
| Porównanie z wykazem MSIP (Kraków, tylko rejestr, 1 416 punktów, 500 m, 70 217 adresów) | korelacja Pearsona **0,995**, Spearmana 0,87; NID liczy więcej (średnio 15,1 wobec 11,1), bo zespoły ma rozbite na budynki |
| Rozdzielczość geometrii 2,6 m/px | na 8 825 adresach z centrum Krakowa wynik „adres w wielokącie” różni się od zapytania po 1,2 m/px w 1 przypadku; dla małych obiektów (poniżej 120 m) w 23 z 1 318 trafień (1,7%) |

Skrypt powtarza dwie pierwsze kontrole przy każdym biegu i zatrzymuje się, gdy pokrycie wykazu
spadnie poniżej 90% albo mniej niż 70% pozycji z dokładnym adresem leży w 50 m od swojego obiektu.

## Wynik i ograniczenia

- Wszystkie adresy mają liczbę (0 to zmierzone zero). Kraków: 33 635 adresów bez wpisu w 500 m (48%),
  mediana 1, p90 17, p99 337, maks. 567. Gminy obwarzanka: 79 974 adresów bez wpisu (75%), mediana 0,
  p90 3, p99 18, maks. 59. Etykiety: `obiekt` 1 513, `obszar` 5 057, `otoczenie` 1 272 adresów.
- Plik ma 1,23 MB (kontrakt: poniżej 2 MB).
- Lokalizacje są **orientacyjne**: kilka metrów (geometria SVG w rozdzielczości 2,59 m), a dla 9% pozycji
  sam NID podaje położenie przybliżone, niepewne albo żadne. Ok. 1% pozycji wykazu nie ma obiektu w usłudze
  i nie jest liczone, więc wartość to dolne oszacowanie. 36 obiektów (1,1%: głównie linie w gęstej
  zabudowie) zostało bez identyfikatora i liczy się jako osobne wpisy.
- Dane NID są informacyjne i nie zastępują wypisu z rejestru zabytków prowadzonego przez wojewódzkiego
  konserwatora; do prezentacji należy zachować atrybucję NID i licencję CC BY 4.0.
- `zabytki_300m` (#125, Kraków z MSIP: rejestr i ewidencja, gminy z adresów NID) zostaje bez zmian. Ten
  wskaźnik dotyczy tylko rejestru, ma jednolite źródło w całym regionie i etykietę adresu.

## Uruchomienie

`node etl/zabytki-nid.mjs` (ok. 2 minuty przy pustym cache). Surowe pobrania w ignorowanym przez Git
`etl/.cache/zabytki-nid-*`: SVG regionu, sondy GetFeatureInfo (JSONL dopisywany na bieżąco, więc
przerwany bieg się wznawia), zasoby i CSV zbioru 1130 (29 MB, tylko do kontroli). Usługa jest pytana
jednorazowo; żeby pobrać dane ponownie, usuń te pliki. Testy: `node --test etl/lib/nid-wms.test.mjs
etl/zabytki-nid.test.mjs`.
