# Hałas poza Krakowem – `halas_obwarzanek_lden` (zadanie #114)

Najwyższe pasmo hałasu Lden z map strategicznych dyrektywy END, runda 4 (rok referencyjny 2021),
zebranych przez Europejską Agencję Środowiska. Dotyczy 106 467 adresów 13 gmin obwarzanka;
Kraków ma w tej kolumnie `null`, bo ma własną warstwę `halas_ldwn` (mapa MSIP 2022).
Uruchomienie: `node etl/halas-obwarzanek.mjs`, test: `node --test etl/halas-obwarzanek.test.mjs`.

## Źródło i licencja

- Usługi ImageServer EEA `noiseStoryMap/NoiseContours_{road,rail,ind,air}_lden`, raster 10 m,
  EPSG:3035, klasy 1–5 = 55–60, 60–65, 65–70, 70–75, >75 dB. Pozycja `PL_DF4_8_*_Lden_PL`.
- **Licencja nie jest CC BY 4.0.** Metadane zbioru (GPKG END 2022, katalog EEA) mówią: dane
  „dostępne do celów badawczych i niekomercyjnych”, bez konturów oznaczonych przez kraj jako
  ograniczone. Prototyp HackYeah jest niekomercyjny; przy wdrożeniu komercyjnym warunki trzeba
  potwierdzić w EEA. Wymagane wskazanie źródła: © European Environment Agency.
- Lden to ten sam wskaźnik co polskie LDWN (dzień–wieczór–noc). Różnica jest w zakresie map:
  END obejmuje drogi z ruchem powyżej 3 mln pojazdów rocznie, koleje powyżej 30 tys. pociągów,
  lotniska powyżej 50 tys. operacji i aglomeracje, a pasma zaczynają się od 55 dB (MSIP od 50 dB).

## Metoda

1. Adresy poza Krakowem (TERYT ≠ 1261011) → EPSG:3035 (proj4).
2. Dla każdej z czterech warstw `exportImage` kafli (2000 wierszy) z surowymi klasami: PNG
   8-bitowy, `noData=0`, mozaika zablokowana na pozycji PL, bbox wyrównany do siatki rastra
   (kotwica to lewy dolny róg pozycji PL), więc piksel eksportu = piksel źródła.
3. Dekoder PNG (`etl/lib/png.mjs`) → klasa w pikselu zawierającym adres. Najwyższa klasa ze źródeł,
   liczba = środek pasma 5 dB (57,5 / 62,5 / 67,5 / 72,5), pasmo >75 = 77,5 dB.
4. Brak konturu = `null`, nigdy 0: mapa nie obejmuje lokalnych ulic, więc nie wiadomo, czy jest
   cicho.

Dlaczego nie `getSamples`: działa tylko na gęstych rastrach (drogi, koleje), na rzadkich
(przemysł, lotniska) zwraca „Invalid or missing input parameters”, a punkty ponad 1000 w żądaniu
ignoruje po cichu. Dlaczego nie GPKG: `PL.gpkg` waży 9,3 GB.

## Kontrole (2026-10-03)

| Kontrola | Wynik |
|---|---|
| Eksport rastra vs `getSamples`, drogi i koleje, 106 467 adresów | zgodność 106 467 / 106 467 (drogi: 11 983 w konturze, koleje: 740) |
| EEA vs MSIP w Krakowie, 10 031 adresów | pasma układają się wzdłuż przekątnej (MSIP 57,5 → klasa 1, 62,5 → 2, 67,5 → 3, 72,5 → 4, 77,5 → 5) |
| EEA vs mapa GDDKiA (kolor w pikselu), próba 722 adresów, tylko te, które GDDKiA obejmuje (drogi krajowe) | zgodna klasa: 1 – 97%, 2 – 86%, 3 – 83%, 4 – 75% (reszta głównie w sąsiedniej klasie); klasa 5: 77% w GDDKiA ≥75 dB (z nich 92% to 75–79,9 dB, 8% ≥80 dB), 23% w paśmie 70–74,9 |
| Hałas przemysłowy w zasięgu adresów | 93 701 pikseli z danymi, 0 adresów poza Krakowem |
| Hałas lotniczy | brak konturów w zasięgu; w danych PL są tylko okolice Warszawy |
| Znane miejsca | DK94 Zielonki, Krakowskie Przedmieście 214: 67,5; DK79 Zabierzów, Krakowska 59: 72,5; DK7 Mogilany, Myślenicka: 38 adresów >75 dB; Świątniki Górne: brak konturów |

Mapa GDDKiA (WMS `gddkia/mapaImisyjnaLDWN`, warstwy per województwo) została tylko kontrolą:
GetFeatureInfo nie zwraca klasy (sam obrys), a warstwy rysują się poniżej skali 1:10 001.

## Pokrycie i ograniczenia

- 12 682 z 106 467 adresów (11,9%) ma wartość: 5 395 w paśmie 55–60, 3 678 w 60–65, 2 708 w 65–70,
  779 w 70–75, 122 powyżej 75 dB. Najwięcej w Mogilanach (21%) i Wielkiej Wsi (21%), w Świątnikach
  Górnych brak konturów.
- Pasma EEA są szersze niż rzeczywiste różnice między sąsiednimi adresami; wartość liczbowa
  to reprezentant pasma, nie pomiar.
- Odświeżenie po zmianie danych EEA: usuń `etl/.cache/halas-eea/` i uruchom skrypt ponownie.
