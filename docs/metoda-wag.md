# Metoda wag – profile i „Opisz siebie”

Skąd biorą się wagi w `src/wynik/persony.ts` (14 profili) i w `src/ai/opiszSiebie.ts`
(`POTRZEBY`, `NA_NIE`). Klucze w nawiasach kwadratowych (np. `[WHO-hałas]`) odsyłają do źródeł
na dole i stoją przy wagach w komentarzach kodu.

## Jak silnik używa wagi

- Wynik adresu to średnia ważona ocen 0–100 warstw z danymi pod adresem (`silnik.ts`). Brak
  danych nie daje zera: warstwa wypada z licznika i mianownika, a spada pewność.
- Waga liczy się tylko wtedy, gdy warstwa ma kierunek. Warstwa `neutralny` (wybieg, weterynarz,
  akademik, bary, główne trasy rowerowe, defibrylator, SPP, SCT) liczy się dopiero z kierunkiem
  od profilu (`kierunki`), potrzeby albo użytkownika. Warstwa z kategorii `kontekst` (piekarnia,
  poczta – odległość, bankomat, fryzjer) nie liczy się nigdy.
- Waga na warstwie, która się nie liczy, jest **martwa**: profil obiecuje coś, czego mapa nie
  robi. Do października 2026 r. profile miały 10 takich wag (Z psem: wybieg, weterynarz, ogródki
  działkowe; Student: akademik, bary; Praca zdalna: piekarnia, poczta; Rowerzysta i Aktywny:
  główne trasy rowerowe; Bezpieczeństwo: defibrylator). Teraz 0 – pilnuje tego
  `persony.test.ts` („persony: każda waga działa w silniku”), a potrzeby od #177 test
  w `opiszSiebie.test.ts`.

## Skala 0–4 (ta sama w każdym profilu)

| Waga | Znaczenie |
|---|---|
| 4 | Cecha, bez której profil traci sens (przedszkole dla rodziny, uzbrojenie dla budowy domu) |
| 3 | Ważna, z mocnym dowodem z badań albo z ankiet |
| 2 | Istotna albo ważna, ale z danymi niepełnymi (OSM poza Krakowem, model) |
| 1 | Tło; także warstwa o słabej rozdzielczości (jedna liczba na powiat, kilkanaście liczników) |

Zasady wspólne:

1. **Minimum zdrowotne.** Każdy profil mieszkaniowy waży hałas i PM2,5 co najmniej 1. Hałas
   drogowy i pył zawieszony to w Europie dwa największe środowiskowe obciążenia zdrowia
   [WHO-hałas, WHO-powietrze]. Wyższe wagi mają grupy wrażliwe: dzieci, seniorzy, alergicy,
   osoby pracujące w domu.
2. **Codzienność pieszo.** Sklep spożywczy jest w każdym profilu: to najczęstszy cel pieszy
   (najwyższa waga w Walk Score) [WalkScore] i najczęstsze oczekiwanie kupujących (83%)
   [ARC-2025]. Zieleń (78%), hałas (76%) i komunikacja (76%) idą za nim [ARC-2025];
   rama „15 minut” [15min].
3. **Rozdzielczość obniża wagę.** Warstwa z jedną wartością dla całego Krakowa (przestępstwa
   i wykrywalność na powiat) nie może przykryć ryzyk w punkcie adresu – najwyżej 2.
4. **Bez podwójnego liczenia jednej rzeczy.** Dwie miary tego samego punktu (punkt schronienia:
   odległość i czas dojścia) – zostaje lepsza (czas po sieci pieszej).
5. **Kierunek profilu wygrywa z potrzebą na tak** (#177). Profil nie nadaje więc kierunku
   warstwie, o której opis siebie może powiedzieć coś przeciwnego (bary u Studenta – „szukam
   ciszy”). Wyjątki istniejące wcześniej: pozwolenia na budowę (Rodzina/Inwestor), imprezy
   (Miłośnik kultury).
6. **Nie dopasowujemy wag do oczekiwań.** Pary okolic w `okolice.test.ts` oznaczone `todo` to
   hipotezy z wiedzy o mieście; wagi wynikają z dowodów, nie z tych par.

## Profile – co i dlaczego (przegląd z 2026-10-04)

| Profil | Najważniejsze wagi | Dowód |
|---|---|---|
| Rodzina z dziećmi | szkoła, przedszkole 4; hałas, zieleń 4; NO2 2; wypadki z pieszymi 2; wynik E8 2 | [WHO-hałas], [Astma], [WHO-zieleń], [Szkoła] |
| Singiel w centrum | przystanek, kursy, czas do Rynku 4; hałas 1 (świadoma zamiana); gastronomia w 1,2 km 1 | [15min], [WalkScore] |
| Senior | sklep, apteka, przychodnia, przystanek 4; hałas 4; ławki, krawężniki 3; SOR 2; wypadki z pieszymi 2; AED 1 | [WHO-senior], [ARC-2025], [AED] |
| Inwestor | pozwolenia 4 (więcej = lepiej), powódź 4; transport 3; hałas, zieleń, wynik E8 2 | [Kolej], [NDI], [Zieleń-cena], [Szkoła], [Powódź] |
| Student | akademik 4 (bliżej = lepiej), przystanek, kursy 4; gastronomia w 1,2 km 2 | [15min], [WalkScore] |
| Z psem | zieleń 4; wybieg, weterynarz 3 (bliżej = lepiej); bez ogródków działkowych | [Pies], [WHO-zieleń] |
| Rowerzysta | infrastruktura rowerowa 4; stojaki, wypadki z rowerzystami 3; główne trasy 2 (z kierunkiem) | [Rower] |
| Praca zdalna | hałas 4; słońce w grudniu, zieleń 3; paczkomat 3; poczta w 1,2 km 1 | [WHO-hałas], [Światło-dzienne] |
| Aktywny | sport, siłownia plenerowa, zieleń 4; główne trasy rowerowe 2 (z kierunkiem) | [Aktywność] |
| Kierowca | dojazd utwardzony 4; SPP 3; ładowarka EV 2; SCT 1 | [ARC-2025] |
| Budowa domu | prąd, woda, powódź, osuwisko 4; hałas i PM2,5 1 | [Powódź], [WHO-hałas] |
| Miłośnik kultury | kultura 4; zabytki, biblioteka, gastronomia 3; PM2,5 1 | [15min] |
| Alergik i astmatyk | PM2,5, PM10 4; NO2, BaP, paleniska 3; zieleń 1 (pyłki) | [WHO-powietrze], [Astma], [Zieleń-alergia] |
| Bezpieczeństwo | powódź 4; wypadki w heksie, latarnie, SOR, policja 3; przestępstwa (powiat) 2; AED 2 | [Oświetlenie], [AED] |

## Potrzeby „Opisz siebie”

`POTRZEBY` i `NA_NIE` przeszły ten sam przegląd: 0 martwych wag (test z #177), każda warstwa
istnieje w `public/dane/wskazniki`. Wagi potrzeb są strojone na zbiorach pomiarowych
(`src/ai/pomiar/WYNIKI.md`, #177, #183, #187), więc zostają bez zmian. Profile zgadzają się
z nimi tam, gdzie mówią o tej samej warstwie: wybieg i weterynarz 3, główne trasy rowerowe 2,
akademik i defibrylator „bliżej = lepiej”, bez ogródków działkowych.

## Źródła

- [WHO-hałas] WHO Regional Office for Europe, *Environmental Noise Guidelines for the European
  Region*, 2018 – hałas drogowy Lden 53 dB.
- [WHO-powietrze] WHO, *Global Air Quality Guidelines*, 2021 – średnie roczne: PM2,5 5 µg/m³,
  PM10 15 µg/m³, NO2 10 µg/m³ (te same normy są w `meta.norma` warstw).
- [WHO-zieleń] WHO Regional Office for Europe, *Urban green spaces and health*, 2016 – teren
  zielony w 300 m od domu.
- [WHO-senior] WHO, *Global Age-friendly Cities: A Guide*, 2007 – ławki, obniżone krawężniki,
  bezpieczne przejścia, transport, opieka zdrowotna.
- [ARC-2025] Fundacja Integracja i ARC Rynek i Opinia, luty–marzec 2025, n = 800, osoby 25+:
  sklepy w okolicy 83%, tereny zielone 78%, hałas 76% (60+: 82%), komunikacja 76%, parking 70%.
- [WalkScore] Metodyka Walk Score: najwyższa waga dla sklepu spożywczego, pełne punkty do ok.
  400 m, zero powyżej ok. 2,4 km, „głębia wyboru” dla lokali gastronomicznych.
- [15min] C. Moreno i in., „Introducing the 15-Minute City”, *Smart Cities* 4(1), 2021.
- [NDI] Przeglądy hedonicznych cen mieszkań (Noise Depreciation Index): hałas drogowy obniża
  cenę o ok. 0,4–0,6% na 1 dB.
- [Powódź] O. Beltrán, D. Maddison, R. Elliott, „Is Flood Risk Capitalised Into Property
  Values?”, *Ecological Economics* 146, 2018 – −4,6% w strefie Q100 (śródlądowo).
- [Kolej] G. Debrezion, E. Pels, P. Rietveld, „The Impact of Railway Stations on Residential and
  Commercial Property Value: A Meta-analysis”, *J. Real Estate Finance and Economics* 35, 2007.
- [Szkoła] S. Black, „Do Better Schools Matter? Parental Valuation of Elementary Education”,
  *Quarterly Journal of Economics* 114(2), 1999.
- [Zieleń-cena] J. Crompton, „The Impact of Parks on Property Values: A Review of the Empirical
  Evidence”, *Journal of Leisure Research* 33(1), 2001.
- [Astma] P. Achakulwisut i in., NO2 a nowe przypadki astmy u dzieci, *Lancet Planetary
  Health* 3(4), 2019.
- [Rower] R. Buehler, J. Dill, „Bikeway Networks: A Review of Effects on Cycling”, *Transport
  Reviews* 36(1), 2016.
- [Pies] „Access to off-leash parks, street pattern and dog walking among adults”, *Public
  Health*, 2011 (PubMed 21803384) – wybieg blisko domu wiąże się z częstszym spacerem.
- [Aktywność] J. Sallis i in., środowisko miejskie a aktywność fizyczna w 14 miastach (IPEN),
  *The Lancet* 387, 2016.
- [Oświetlenie] B. Welsh, D. Farrington, *Effects of Improved Street Lighting on Crime*, Campbell
  Systematic Reviews, 2008.
- [AED] European Resuscitation Council, wytyczne 2021 – czas do defibrylacji decyduje
  o przeżyciu nagłego zatrzymania krążenia.
- [Zieleń-alergia] K. Lambert i in., zieleń przy domu a alergiczne choroby dróg oddechowych
  u dzieci – przegląd, *Environmental Research* 159, 2017 (wyniki niespójne).
- [Światło-dzienne] Norma EN 17037 *Daylight in buildings*, 2018.
