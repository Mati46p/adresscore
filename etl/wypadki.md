# Wypadki drogowe – wszystkie oraz piesi i rowerzyści (SEWIK 2018–2024, #69)

`node etl/wypadki.mjs <zrzut SEWIK XML: plik, katalog z plikami .xml albo stdin>` zapisuje dwa wskaźniki:

| Wskaźnik | Co mierzy | Rozdzielczość | Kierunek |
|---|---|---|---|
| `wypadki_heks` | średnia roczna waga wszystkich zdarzeń (wypadki z ofiarami i kolizje) w heksie wokół adresu | heks H3 r8, ok. 0,74 km² | mniej = lepiej |
| `wypadki_piesi_rowerzysci_heks` | to samo, tylko zdarzenia z pieszym albo rowerzystą; wagę liczą ich poszkodowani | heks H3 r8, ok. 0,74 km² | mniej = lepiej |

Kategoria `bezpieczenstwo`, jednostka „pkt ciężkości / rok”. Adres dostaje wartość heksu r8, w którym leży
(rodzic jego heksu r10), a etykieta na karcie podaje liczbę zdarzeń i ofiar w tym heksie za 2018–2024.
Heks bez zdarzeń ma 0: SEWIK obejmuje cały kraj, więc to pomiar, nie brak danych. Warstwa ma 176 684 wartości,
żadnego `null`; domyślna waga w profilach jest 0 (`wagaNowych` person), więc na wynik wchodzi dopiero po ustawieniu
wagi.

## Źródło i pobranie

Zrzut SEWIK (Komenda Główna Policji) ze strony [sewik.pl](https://sewik.pl) (serwis niekomercyjny, wolontariusze
z organizacji pozarządowych); sekcja „Zasoby do pobrania”, bez logowania i bez CAPTCHA. `robots.txt` sewik.pl
blokuje tylko `/tmp/`, a host plików (mocniak.pl) go nie ma:

| Plik | Rozmiar | SHA-256 | Do czego |
|---|---|---|---|
| `http://mocniak.pl/sewik/fixed-sewik-xml-(2018-25).tar.xz` | 480 530 400 B | `5f5171666ae9f0c48e9351fd3060c51736deb91d5cd58f5b4fdf785758ca61cc` | źródło warstw (XML, 2018–2024) |
| `http://mocniak.pl/sewik/sewik_dump_sql_20250411.tar.xz` | 191 272 508 B | `3ff832352719090bdf473da4f1f9690701439bbd06b7c0d619335b3a14b0baaf` | tylko kontrola współrzędnych i ofiar (patrz niżej) |

Archiwum XML ma po jednym pliku na województwo i rok (`2018/…` do `2024/…`), kodowanie UTF-8; nazwy plików
Małopolski różnią się pisownią litery „Ł” (`MALOPOLSKIE`, `MAŁOPOLSKIE`, `MAЭOPOLSKIE`), stąd wzorzec `*MA*OPOLSKIE*`.
Małopolska to 7 plików, razem ok. 930 MB; zrzuty z `DataZrzutu` od 2019-02-25 (rok 2018) do 2025-02-15 (rok 2024).
Pobrano 2026-10-03.

```bash
# jednorazowo, surowe pliki zostają poza gitem (etl/.cache/ jest w .gitignore)
mkdir -p etl/.cache/sewik/raw
curl -L -o etl/.cache/sewik/sewik-xml-2018-24.tar.xz "http://mocniak.pl/sewik/fixed-sewik-xml-(2018-25).tar.xz"
# -C przed wzorcem: inaczej tar rozpakuje do bieżącego katalogu
tar -C etl/.cache/sewik/raw -xJf etl/.cache/sewik/sewik-xml-2018-24.tar.xz --wildcards "*MA*OPOLSKIE*"
node etl/wypadki.mjs etl/.cache/sewik/raw
# bez rozpakowywania na dysk (ten sam wynik):
tar -xJOf etl/.cache/sewik/sewik-xml-2018-24.tar.xz --wildcards "*MA*OPOLSKIE*" | node etl/wypadki.mjs stdin
```

Bieg trwa ok. 70 s po rozpakowaniu (225 868 zdarzeń, 930 MB). Importer filtruje przestrzennie (heksy z adresami),
więc można podać też cały zrzut – będzie tylko wolniej. Zrzut jest corocznie uzupełniany w lutym i marcu; nowy rok
to zmiana `LATA` w `etl/wypadki.mjs` i ponowny bieg.

### Licencja i atrybucja

Strona sewik.pl nie podaje licencji zrzutu; w sprawie użycia komercyjnego odsyła do kontaktu mailowego. Dane
pochodzą z policyjnego SEWIK. Regulamin Polskiego Obserwatorium BRD (ITS) dla jego mapy wypadków wymaga
cytowania „Instytut Transportu Samochodowego – Polskie Obserwatorium Bezpieczeństwa Ruchu Drogowego” (art. 6),
pozwala na użycie niekomercyjne bez zgody i komercyjne za zgodą administratora (art. 7). adresscore liczy
z surowego zrzutu, nie z mapy Obserwatorium, ale stosuje tę atrybucję zachowawczo: obie pozycje są w `zrodla[]`
obu wskaźników, więc karta pokazuje je razem z warunkami. **Projekt konkursowy to użycie niekomercyjne; przed
użyciem komercyjnym trzeba uzyskać zgodę** (sewik.pl i ITS).

## Schemat zrzutu (sprawdzony na danych)

Korzeń `sewik:SEWIK_EXP_XML_02` z atrybutami `DataZrzutu`, `DataOd`, `DataDo`, `LiczbaZdarzen` (suma po 7 plikach
Małopolski to dokładnie 225 868 zdarzeń, tyle samo co sparsowane). Zdarzenie to `<ZDARZENIE DataUtworzenia DataMod
SzkicZdarzenia>` z polami i zagnieżdżonymi `<POJAZDY><POJAZD>` oraz `<UCZESTNICY><OSOBA>`:

| Pole | Znaczenie | Użycie |
|---|---|---|
| `ID` | numer zdarzenia, unikalny we wszystkich plikach | deduplikacja |
| `DATA_ZDARZ` | data (`RRRR-MM-DD`) | filtr lat 2018–2024 |
| `WSP_GPS_X`, `WSP_GPS_Y` | długość i szerokość, napis `DD*MM'SSs` | punkt zdarzenia |
| `GPS_X_GUS`, `GPS_Y_GUS` | punkt miejscowości z GUS (przecinek dziesiętny); dla Krakowa środek miasta | tylko odrzucanie literówek |
| `KOD_GUS` | TERYT gminy (7 cyfr) | tylko kontrola: ile zdarzeń gmin obszaru nie ma punktu |
| `POJAZD/RODZAJ_POJAZDU`, `POJAZD/ID` | rodzaj pojazdu | rower |
| `OSOBA/SSRU_KOD`, `OSOBA/STUC_KOD`, `OSOBA/ZSPO_ID` | rodzaj uczestnika, stan, pojazd osoby | ofiary, pieszy, pasażer roweru |

`SzkicZdarzenia=T` wygląda na znacznik szkicu z miejsca zdarzenia, a nie roboczego zapisu: 191 z 195 takich zdarzeń
w 2018 r. ma zabitego. Zdarzeń z `T` nie odrzucamy. `SRUZ_KOD` to „Rozstrzygnięcie” (mandat, pouczenie…), a nie rodzaj
uczestnika; nazwy słowników są w `dictionary.sql` zrzutu SQL, wartości kodów tam nie ma.

### Kody (zrzut nie ma słownika wartości – wywnioskowane i sprawdzone)

| Kod | Znaczenie | Dowód |
|---|---|---|
| `STUC_KOD` = `ZM` / `ZC` | zabity na miejscu / zmarł w ciągu 30 dni | liczby ofiar liczone z osób **zgadzają się co do jednego** z `skutki_*` w zrzucie SQL sewik.pl dla wszystkich 225 867 zdarzeń Małopolski |
| `STUC_KOD` = `RC` / `RL` | ranny ciężko / lekko | jw. |
| `SSRU_KOD` = `I` (uczestnik bez pojazdu) | pieszy | `SPPI_KOD` („przyczyny zachowanie pieszego”) występuje prawie wyłącznie u `I`; w 2018 r. 1 233 z 1 262 zdarzeń rodzaju `SZRD_KOD` = `04` ma uczestnika `I`; 33% zdarzeń z pieszym w X–XII, najwięcej 16–18 h |
| `SSRU_KOD` = `K` / `P` | kierujący / pasażer | `MIEJSCE_W_POJ` tylko u `P`; osoba `O` (od 2022 r., ok. 30 rocznie) pominięta |
| `RODZAJ_POJAZDU` = `IS101` (do 2021 r.), `IS201` (od 2022 r.; w 2022 r. oba) | rower | brak ubezpieczyciela (94% / 84%), badań technicznych i roku produkcji; 37–38% poszkodowanych kierujących; 66% zdarzeń w V–IX, 2% w I, najwięcej 15–17 h |
| `RODZAJ_POJAZDU` = `IS240` (od 2022 r.) | hulajnoga elektryczna | ten sam profil sezonowy co rower; **poza warstwą**, bo kod pojawił się w 2022 r. i szereg 2018–2024 byłby niespójny |

Poprzednia wersja importera (commit 35ba290) powstała bez dostępu do zrzutu i zakładała m.in. współrzędne
dziesiętne, stan `Z`, pieszego jako `SRUZ_KOD` i bloki `UCZESTNIK`; żadne z tych założeń nie zgadzało się ze
zrzutem (prawie wszystkie zdarzenia wypadłyby jako „bez GPS”).

## Współrzędne

`WSP_GPS_X`/`WSP_GPS_Y` to napis `DD*MM'SSs`: stopnie, minuty, sekundy i **dziesiąte części sekundy**
(`19*57'313` = 19°57'31,3" = 19,95869°E). Odczyt „minuty z tysięcznymi” (19°57,313') byłby naturalnym
pierwszym przypuszczeniem, ale jest błędny – sprawdzenie na drogach OSM (`malopolskie.osm.pbf`, drogi publiczne
i obsługujące, losowa próba 20% zdarzeń Krakowa, 13 882 punkty):

| Odczyt | Mediana odległości do osi najbliższej drogi | p90 |
|---|---|---|
| DMS (stopnie, minuty, sekundy z dziesiątymi) | **2 m** | 22 m |
| minuty dziesiętne | 38 m | 139 m |

Zdarzenie leży więc na jezdni, a nie ok. 40–800 m od niej. Zrzut SQL sewik.pl (jego własne `polozenie_x/y`) liczy
tak samo: 220 758 z 225 867 zdarzeń (97,7%) zgadza się z importerem co do 50 m.

Formaty, które importer rozpoznaje (po jednym punkcie na zdarzenie, obie osie w tym samym formacie):

1. **DMS**: `DD*MM'SSs`, minuty i sekundy < 60 – 213 753 zdarzeń Małopolski (94,6%), w obszarze 88 235 (96,8%).
2. **Stopnie dziesiętne**: w kształcie DMS (`19*80'205` = 19,80205°, minuty albo sekundy > 59, więc DMS jest
   niemożliwy) oraz zwykłe liczby `19.9565` / `19,9565` (od 2020 r., coraz częściej) – 10 191 zdarzeń Małopolski
   (4,5%), w obszarze 2 900 (3,2%). Na drogach OSM ten odczyt ma medianę 3 m, p90 65 m.
3. Literówki (`50*2''332`, `4**55'099`, brak tagu, punkt dalej niż 25 km od punktu GUS miejscowości, poza
   obwiednią województwa) – zdarzenie bez punktu.

Punkt GUS służy wyłącznie do odrzucania literówek (próg 25 km), nie do wyboru odczytu: dla Krakowa to środek
miasta (±13 km), a w teście na drogach OSM wybór „bliższego punktowi GUS” był gorszy od stałego DMS (błędnie
zamieniał 69 z 47 916 poprawnych punktów Krakowa, a odzyskał 6 z 96 dziesiętnych). Znane ograniczenie: zapis
dziesiętny w kształcie DMS z minutami i sekundami < 60 jest czytany jako DMS i trafia kilka kilometrów od
miejsca. Z punktów, które drogi OSM pozwalają rozstrzygnąć, dotyczy to ok. 0,2% zdarzeń Krakowa i ok. 1% pozostałych
gmin (szacunek).

**Zdarzenia bez punktu** – 1 924 z 225 868 w Małopolsce (0,85%; w 2018 r. 2,6%, w 2019–2020 ok. 1%, od 2021 r. nie
więcej niż 0,6%). W 14 gminach obszaru (według `KOD_GUS`) 463 z 91 388 zdarzeń (0,5%; Kraków 0,2%, najwięcej
Zabierzów i Zielonki po 2,5%) – pomijamy je. Geokodowanie po ulicy (opcja z zadania) nie jest potrzebne przy tak małym
udziale i nie dałoby dokładności heksu r8.

## Jak liczymy

- Lata 2018–2024 według daty zdarzenia, średnia roczna = suma / 7.
- Obszar: heksy H3 r8, w których są adresy projektu (Kraków i 13 gmin obwarzanka, 1 740 heksów). Zdarzenia spoza
  tych heksów (132 809) nie wchodzą; zdarzenia w obszarze: 91 135 (13 700 w 2018, 14 809, 11 713 w 2020,
  13 468, 12 155, 12 209, 13 081 w 2024).
- Waga zdarzenia: **1 + 10 × zabici + 4 × ciężko ranni + 1 × lekko ranni** (zabici także do 30 dni po
  zdarzeniu). Waga jest stała dla całej serii, więc heksy da się porównywać; konkretne współczynniki to decyzja
  projektowa, nie norma.
- `wypadki_heks`: wszyscy poszkodowani w zdarzeniu. Obszar w sumie: 91 135 zdarzeń, 191 zabitych, 2 331 ciężko
  i 4 948 lekko rannych.
- `wypadki_piesi_rowerzysci_heks`: zdarzenia z pieszym (`SSRU_KOD` = `I`) albo rowerem (`IS101`/`IS201`);
  wagę liczą **wyłącznie poszkodowani piesi i rowerzyści** (z pasażerami roweru), nie kierowcy samochodów.
  Obszar: 6 845 zdarzeń, 90 zabitych, 1 274 ciężko i 2 013 lekko rannych pieszych i rowerzystów.
- Etykieta heksu (słownik `slownikEtykiet`, 1 740 wpisów): „335 zdarzeń w latach 2018–2024 (zabici: 0, ciężko
  ranni: 9, lekko ranni: 25)”. Test w `etl/wypadki.test.mjs` sprawdza, że wartość każdego adresu równa się
  (zdarzenia + 10 · zabici + 4 · ciężko + lekko) / 7 z jego etykiety.

## Kontrola jakości (zrobiona 2026-10-04)

| Kontrola | Wynik |
|---|---|
| Liczba zdarzeń vs `LiczbaZdarzen` w nagłówkach | 225 868 = 225 868, bez duplikatów `ID` |
| Ofiary z osób vs `skutki_*` w SQL sewik.pl | zgodne dla 225 867 z 225 867 zdarzeń |
| Punkty vs `polozenie_x/y` w SQL | 97,7% w granicach 50 m; różnice dotyczą zapisów dziesiętnych, które SQL liczy jako DMS bez sprawdzania zakresu (wychodzą 40–80 km od miejscowości) |
| Odległość do osi drogi OSM (Kraków, DMS) | mediana 2 m, p90 22 m |
| Zgodność z gminą zapisaną w zdarzeniu | zdarzenia w heksach obszaru, ale z `KOD_GUS` spoza 14 gmin: 600 (0,7%); zdarzenia 14 gmin poza heksami obszaru: 390 (0,4%) |
| Rower: sezonowość | 66% zdarzeń w V–IX (czerwiec 14,8%, styczeń 2,1%), jak w statystykach rowerowych |
| Pieszy: pora | najwięcej 16–18 h, 33% zdarzeń w X–XII |

Heksów obszaru ze zdarzeniami: 1 490 z 1 740 (wszystkie zdarzenia), 703 (piesi i rowerzyści); adresów z wartością
0: 5 706 (3,2%) i 57 507 (32,5%) – głównie wsie obwarzanka.

## Czego warstwa nie mówi

- Miejsce zdarzenia, nie zamieszkania poszkodowanych; do SEWIK trafiają tylko zdarzenia zgłoszone Policji.
- Liczba bez przeliczenia na natężenie ruchu: śródmieście i drogi wylotowe mają najwięcej zdarzeń, bo mają
  najwięcej pojazdów. To miara okolicy, nie ryzyka na przejechany kilometr.
- Heks r8 to ok. 0,74 km² (bok ok. 460 m): adresy po dwóch stronach granicy heksów mogą mieć różne wartości.
- Szereg 2018–2024 obejmuje rok pandemii 2020 (11 713 zdarzeń w obszarze wobec 14 809 w 2019 r. i 13 468 w 2021 r.).
- Hulajnogi elektryczne nie są w warstwie pieszych i rowerzystów.
