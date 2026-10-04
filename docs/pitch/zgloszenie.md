# Zgłoszenie HackTribe – wersja finalna (#33, #47)

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
- [x] e) PDF, maks. **10 slajdów** – `adresscore.pdf` (10 slajdów, źródło `slajdy.html`)
- [x] zrzuty ekranu w PDF – `zrzuty/` (karta adresu, mapa, Biznes) na slajdach 3, 4, 7
- [ ] link do demo: https://adresscore.pl – **sprawdzić na komputerze spoza sieci zespołu**
- [ ] link do repozytorium – repo jest prywatne; zdecydować: upublicznić albo dodać jury

Język: polski albo angielski. Kategoria: tylko **Smart City**.

## Kryteria oceny i gdzie je pokazujemy

| Kryterium | Waga | Slajd |
|---|---|---|
| Pomysł i innowacja | 30% | 2–5 (etykieta A–G, persony, JEV) |
| Związek z kategorią Smart City | 20% | 6, 7, 9 (dane MSIP, luki i symulator dla miasta, roadmapa) |
| Użyteczność | 20% | 3, 4, 7 (karta, porównanie, Biznes) + `scenariusz-demo.md` |
| Design | 20% | cały PDF + zrzuty; etyka – slajd 8 |
| Kompletność | 10% | 3, 6, 10 (176 684 adresy, 126 warstw) |

Etap 1: komisja (min. 3 mentorów) ocenia zgłoszenie w HackTribe; do nagrody trzeba ≥ 50% punktów.
Etap 2: pitch na żywo finalistów przed jury.

---

## Pola formularza – do wklejenia

**Tytuł:** adresscore – jakość życia pod każdym adresem

**Nazwa zespołu:** _do uzupełnienia_

**Skład zespołu:** _do potwierdzenia_ – autorzy commitów w repo: Mateusz (Mati0x), Jan Strojny,
Paweł Sieczkiewicz (psieczk). Dopisać pozostałe osoby, maks. 6.

**Link do demo:** https://adresscore.pl

**Opis (PL, ok. 1500 znaków):**

> Mieszkanie wybieramy na lata, a o tym, jak się żyje pod adresem – hałas, powietrze, dojazd,
> szkoły, zieleń, powódź, co powstanie obok – dowiadujemy się po przeprowadzce. Te dane istnieją,
> ale są rozproszone w dziesiątkach rejestrów, w różnych formatach i rozdzielczościach.
>
> adresscore składa je w etykietę A–G dla każdego adresu. Pilotaż: Kraków i 13 gmin obwarzanka,
> 176 684 adresy, 126 warstw z rejestrów publicznych (MSIP Kraków, GUGiK, GIOŚ, GUS, GUNB, NFZ,
> PSP, ZTP GTFS, PKW i in.). Wynik zależy od tego, kim jesteś: persony i tryby (kupuję, wynajmuję)
> zmieniają wagi, a mapa heksów H3 przelicza się na żywo. Można też opisać siebie jednym zdaniem –
> warstwa AI (JEV) zamienia opis na wagi i odpowiada na pytania o adres, ale wybiera wyłącznie
> z zamkniętych list: liczby zawsze pochodzą z rejestrów.
>
> Te same dane służą przedsiębiorcy i miastu. Tryb Biznes pokazuje, gdzie na jeden sklep czy
> aptekę przypada najwięcej mieszkańców, i porównuje do 5 miejsc. Tryb Miasto wskazuje okolice
> poza zasięgiem usług, a symulator liczy, ile adresów zyska nowy przystanek czy przedszkole.
>
> Przy każdej liczbie widać źródło, licencję i rozdzielczość; brak danych to szara kategoria,
> nigdy zero. Przestępczość tylko na poziomie rejonu, nigdy adresu.
> Ujawnienie: szablon repozytorium powstał przed startem hackathonu (11:00); funkcje i dane
> powstały w trakcie wydarzenia.

**Description (EN, gdyby formularz wymagał):**

> When you rent or buy a flat you check the price and the floor area, but you learn how life at
> that address really is – noise, air, commute, schools, greenery, flood risk, what will be built
> next door – only after moving in. The data exists, scattered across dozens of public registers.
> adresscore turns it into one A–G label for every address. Pilot: Kraków and 13 neighbouring
> municipalities – 176,684 addresses, 126 layers from dozens of public sources; sample values are flagged and never scored.
> Personas and modes (buy, rent, business) re-weight the score live on an H3 hex map; an AI layer
> (JEV) maps a plain-language self-description to weights and answers questions about an address,
> but never invents numbers. Every value shows its source, licence and resolution; missing data is
> grey, never zero. For the city, a "gaps" mode shows neighbourhoods without services in reach.

---

## Lista przed wysłaniem finalnym (do 10:00)

1. Wpisać nazwę zespołu i skład (pola wyżej i slajd 1 w `slajdy.html`).
2. Otworzyć https://adresscore.pl na komputerze spoza sieci zespołu i sprawdzić mapę i kartę adresu.
3. Wpisać na slajdzie 10 commit i datę szablonu sprzed 11:00 (ujawnienie).
4. Zdecydować o repo (publiczne albo dostęp dla jury) i wpisać link.
5. Odświeżyć zrzuty, jeśli UI się zmienił, i wygenerować PDF (`README.md`).
6. Nagrać zapasowe MP4 według `scenariusz-demo.md`.

---

## Pozostałe pola formularza HackTribe

**Code Repository:** https://github.com/Mati46p/adresscore – repo prywatne; przed wysłaniem
finalnym upublicznić albo dać jury dostęp.

**Your video presentation:** opcjonalne; nagranie zapasowe z #79 wrzucić
jako „Listed” na YouTube przed finałem.

**Instructions on how to open project:**

```
Demo online – nic nie trzeba instalować:
1. Otwórz https://adresscore.pl (komputer, Chrome/Edge/Safari/Firefox).
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

**Presentation:** `docs/pitch/adresscore.pdf` (10 slajdów, ok. 1,3 MB; limit 10 MB). Draft
z checkpointu zostaje w `adresscore-checkpoint.pdf`.
