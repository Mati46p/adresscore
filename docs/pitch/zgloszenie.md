# Zgłoszenie HackTribe – draft na checkpoint (sobota 20:00)

Wymogi z regulaminu Smart City (`docs/hackyeah/regulamin-smart-city.pdf`) i strony hackyeah.pl,
sprawdzone 2026-10-03.

## Terminy

| Kiedy | Co | Źródło |
|---|---|---|
| sob 20:00 | **checkpoint – pierwszy draft projektu** w HackTribe | hackyeah.pl, harmonogram |
| ndz 10:00 | nasz wewnętrzny termin (finalny `[wdroz]` do 9:30) | `docs/etapy/README.md` |
| ndz 11:00 | twardy koniec zgłoszeń na hackyeah.pl | hackyeah.pl |
| ndz 23:00 | koniec wg pkt 5 regulaminu kategorii | regulamin |

Regulamin pisze „start nie wcześniej niż 11:00 PM 3 października” – to literówka (start był
o 11:00). Liczy się wcześniejszy termin, czyli **11:00 w niedzielę**. Zmian po terminie jury nie
bierze pod uwagę (pkt 13).

## Co musi być w zgłoszeniu (pkt 5 regulaminu)

- [x] a) tytuł projektu
- [ ] b) nazwa zespołu – **do potwierdzenia**
- [ ] c) skład zespołu, 1–6 osób – **do potwierdzenia**
- [x] d) opis projektu
- [x] e) PDF, maks. **10 slajdów** – na checkpoint `adresscore-checkpoint.pdf` (7 slajdów)
- [ ] zrzuty ekranu w PDF – **do wstawienia** (ramki na slajdach 3 i 4)
- [x] link do demo: https://adresscore.pl
- [ ] link do repozytorium – repo jest prywatne; zdecydować: upublicznić albo dodać jury

Język: polski albo angielski. Kategoria: tylko **Smart City**.

## Kryteria oceny i gdzie je pokazujemy

| Kryterium | Waga | Slajd |
|---|---|---|
| Pomysł i innowacja | 30% | 2, 3, 5 (etykieta A–G, persony, JEV, „lepszy sąsiad”) |
| Związek z kategorią Smart City | 20% | 2, 6 (dane miejskie MSIP, panel luk dla miasta) |
| Użyteczność | 20% | 3, 4 (karta adresu, porównanie, telefon, QR) |
| Design | 20% | cały PDF + zrzuty |
| Kompletność | 10% | 4, 7 (93 warstwy, 0 atrap, działa publicznie) |

Etap 1: komisja (min. 3 mentorów) ocenia zgłoszenie w HackTribe; do nagrody trzeba ≥ 50% punktów.
Etap 2: pitch na żywo finalistów przed jury.

---

## Pola formularza – do wklejenia

**Tytuł:** adresscore – jakość życia pod każdym adresem

**Nazwa zespołu:** _do uzupełnienia_

**Skład zespołu:** _do potwierdzenia_ – autorzy commitów w repo: Mateusz (Mati0x), Jan Strojny,
Paweł Sieczkiewicz (psieczk). Dopisać pozostałe osoby, maks. 6.

**Link do demo:** https://adresscore.pl

**Opis (PL):**

> Kupując albo wynajmując mieszkanie, sprawdzamy metraż i cenę, a o tym, jak się żyje pod danym
> adresem – hałas, powietrze, dojazd, szkoły, zieleń, ryzyko powodzi, co powstanie obok – dowiadujemy
> się dopiero po przeprowadzce. Te dane istnieją, ale są rozproszone w kilkudziesięciu rejestrach
> publicznych, w różnych formatach i rozdzielczościach.
>
> adresscore składa je w jeden wynik dla każdego adresu. Na start Kraków i 13 gmin obwarzanka:
> 176 684 punkty adresowe, 93 warstwy z ponad 40 instytucji (MSIP Kraków, GIOŚ, GUGiK, ZTP GTFS,
> Wody Polskie, GUNB, GUS, NFZ, KG PSP i in.), bez ani jednej wartości wymyślonej.
>
> Każdy adres dostaje etykietę A–G, znaną z etykiet energetycznych, z pięciu kategorii: codzienność
> pieszo, transport, spokój i zdrowie, przyszłość okolicy, bezpieczeństwo i ryzyko. Wynik zależy
> od tego, kim jesteś: persony (rodzina, senior, singiel w centrum, inwestor) i tryby (kupuję,
> wynajmuję, biznes) zmieniają wagi, a mapa heksów H3 przelicza się na żywo. Możesz też opisać
> siebie zwykłym zdaniem – warstwa AI (JEV) zamienia opis na wagi i odpowiada na pytania o adres,
> ale nigdy nie wymyśla liczb: wybiera z zamkniętych list, a wartości zawsze pochodzą z rejestrów.
>
> Uczciwość wobec danych jest częścią projektu: przy każdej liczbie widać źródło, licencję i
> rozdzielczość (adres, heks, gmina), a brak danych to szara kategoria, nigdy zero. Nie pokazujemy
> przestępczości per adres. Dla miasta tryb „gdzie miasto ma luki” wskazuje okolice bez usług
> w zasięgu – ranking staje się narzędziem naprawy, a nie tablicą wstydu.
>
> Stack: React 19 + MapLibre + deck.gl (budynki 3D GUGiK LoD1), dane liczone skryptami Node +
> DuckDB do plików statycznych, hosting Vercel. Szablon repozytorium powstał przed startem
> hackathonu – cały kod funkcji i dane są z czasu wydarzenia.

**Description (EN, gdyby formularz wymagał):**

> When you rent or buy a flat you check the price and the floor area, but you learn how life at
> that address really is – noise, air, commute, schools, greenery, flood risk, what will be built
> next door – only after moving in. The data exists, scattered across dozens of public registers.
> adresscore turns it into one A–G label for every address. Pilot: Kraków and 13 neighbouring
> municipalities – 176,684 addresses, 93 layers from 40+ public institutions, no mock values.
> Personas and modes (buy, rent, business) re-weight the score live on an H3 hex map; an AI layer
> (JEV) maps a plain-language self-description to weights and answers questions about an address,
> but never invents numbers. Every value shows its source, licence and resolution; missing data is
> grey, never zero. For the city, a "gaps" mode shows neighbourhoods without services in reach.

---

## Lista na checkpoint – co zrobić przed 20:00

1. Wpisać nazwę zespołu i skład (pola wyżej i slajd 1).
2. Wstawić zrzuty: mapa heksów, karta adresu z etykietą, porównanie, telefon. Ramki na slajdach
   3 i 4 mają opisane, który zrzut gdzie.
3. Sprawdzić https://adresscore.pl na telefonie przez sieć komórkową; jeśli działa – QR
   (`docs/pitch/README.md`) na slajd 7.
4. Zdecydować o repo (publiczne albo dostęp dla jury) i wpisać link.
5. Wygenerować PDF z `slajdy-checkpoint.html` (polecenie niżej) i wysłać w HackTribe jako draft.

```sh
chromium --headless --no-pdf-header-footer \
  --print-to-pdf=docs/pitch/adresscore-checkpoint.pdf docs/pitch/slajdy-checkpoint.html
```

Po checkpoincie (issue #33): rozbudowa do 10 slajdów – demo 3D (`?pokaz=`), „co by to zmieniło”
w zł i godzinach, etyka i panel dla gmin, roadmapa na całą Polskę.

---

## Pozostałe pola formularza HackTribe

**Code Repository:** https://github.com/Mati46p/adresscore – repo prywatne; przed wysłaniem
finalnym upublicznić albo dać jury dostęp.

**Your video presentation:** opcjonalne – na checkpoint puste; nagranie zapasowe z #79 wrzucić
jako „Listed” na YouTube przed finałem.

**Instructions on how to open project:**

```
Demo online – nic nie trzeba instalować:
1. Otwórz https://adresscore.pl (komputer albo telefon, Chrome/Edge/Safari/Firefox).
2. Ekran „Szukaj”: mapa Krakowa i 13 gmin obwarzanka w heksach. Wybierz personę
   (np. Rodzina z dziećmi, Senior) albo tryb Kupuję / Wynajmuję – mapa przelicza się na żywo.
3. Kliknij heks albo wpisz adres (np. „Grodzka 52”) → karta adresu z etykietą A–G,
   kategoriami i źródłem przy każdej liczbie. Szary pasek = brak danych.
4. Na karcie: budynki 3D z cieniem, „co by to zmieniło”, „lepszy sąsiad”.
5. Dodaj 2–5 adresów do porównania → ekran Porównanie (radar + tabela).
6. Metoda i wszystkie źródła danych: https://adresscore.pl/#/metoda

Uruchomienie lokalne (Node 24, pnpm 11):
  git clone https://github.com/Mati46p/adresscore && cd adresscore
  pnpm install
  pnpm dev          # http://localhost:5180
Dane są w plikach statycznych (public/dane), baza nie jest potrzebna.
Warstwa AI (JEV) wymaga JEV_API_KEY po stronie serwera; bez klucza działa reguła zapasowa.
```

**Skills comment** (pole o oczekiwanych umiejętnościach kandydatów do zespołu):

```
Zespół jest kompletny. Gdybyśmy rozwijali projekt dalej, szukamy osób z:
– GIS i danymi przestrzennymi (QGIS, PostGIS/DuckDB spatial, H3, układy EPSG:2180),
  doświadczeniem z rejestrami GUGiK, GUS, MSIP i otwartymi danymi miast;
– frontendem map i 3D (MapLibre GL, deck.gl, WebGL, wydajność na telefonie);
– UX i projektowaniem informacji – jak pokazać wynik, niepewność i brak danych uczciwie;
– wiedzą o planowaniu przestrzennym i samorządzie (MPZP, budżet obywatelski, uchwały),
  żeby zamienić wynik w narzędzie dla gmin;
– etyką danych i prawem (licencje danych publicznych, RODO).
```

**Presentation:** `docs/pitch/adresscore-checkpoint.pdf` (7 slajdów, 267 kB; limit 10 MB).
