# Wnioski „Czyste Powietrze” na 100 domów w gminie – `gmina_czyste_powietrze_wnioski_100_domow` (zadanie #141)

Liczba wniosków o dofinansowanie z programu Czyste Powietrze (nowy program, od 31.03.2025 do
12.12.2025) na 100 budynków jednorodzinnych w 14 gminach Krakowa i obwarzanka. Warstwa gminna:
każdy adres gminy dostaje tę samą liczbę (176 684 z 176 684 adresów), a brak danych gminy to
`null`, nigdy 0. Kategoria „przyszlosc”, kierunek „wiecej-lepiej”, rozdzielczość „gmina” (tak
ustalono w zadaniu #141).

Uruchomienie: `node etl/czyste-powietrze.mjs` (z migawki, bez sieci). Odświeżenie z PDF-ów:
`node --use-system-ca etl/czyste-powietrze.mjs --odswiez` (wymaga `pdftotext` w PATH). Test:
`node --test etl/czyste-powietrze.test.mjs`.

## Wynik (stan raportu 12.12.2025, pobrano 2026-10-03)

| Gmina | Powiat | Adresów | Wnioski | Budynki jednorodzinne | Na 100 domów | Pellet | Drewno | Pompy ciepła | Termomod. |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Igołomia-Wawrzeńczyce | krakowski | 2 349 | 32 | 2 137 | **1,50** | 2 | 1 | 3 | 32 |
| Koniusza | proszowicki | 2 945 | 26 | 2 514 | **1,03** | 9 | 1 | 1 | 23 |
| Skawina | krakowski | 11 087 | 59 | 8 531 | **0,69** | 11 | 2 | 1 | 52 |
| Kocmyrzów-Luborzyca | krakowski | 6 726 | 31 | 5 318 | **0,58** | 7 | 1 | 2 | 26 |
| Liszki | krakowski | 7 564 | 29 | 5 651 | **0,51** | 13 | 1 | 0 | 26 |
| Zielonki | krakowski | 9 777 | 39 | 8 042 | **0,48** | 5 | 1 | 2 | 36 |
| Świątniki Górne | krakowski | 3 895 | 14 | 3 173 | **0,44** | 5 | 1 | 1 | 12 |
| Niepołomice | wielicki | 11 578 | 39 | 8 866 | **0,44** | 4 | 1 | 9 | 32 |
| Zabierzów | krakowski | 11 288 | 37 | 8 842 | **0,42** | 9 | 3 | 3 | 30 |
| Michałowice | krakowski | 5 183 | 15 | 3 983 | **0,38** | 3 | 0 | 1 | 13 |
| Wielka Wieś | krakowski | 6 079 | 18 | 4 930 | **0,37** | 3 | 0 | 1 | 16 |
| Mogilany | krakowski | 5 979 | 17 | 4 801 | **0,35** | 1 | 5 | 2 | 11 |
| Kraków | Kraków | 70 217 | 139 | 41 172 | **0,34** | 0 | 0 | 2 | 139 |
| Wieliczka | wielicki | 22 017 | 47 | 17 021 | **0,28** | 9 | 3 | 4 | 39 |

Kolumny „Pellet”, „Drewno”, „Pompy ciepła” i „Termomod.” to liczby wniosków obejmujących daną
pozycję (kocioł na pellet drzewny, kocioł zgazowujący drewno, pompa ciepła dowolnego z pięciu
typów, termomodernizacja). Ogrzewania elektrycznego i przyłączy do sieci ciepłowniczej w tych
14 gminach nie ma w żadnym wniosku. Rozstęp 0,28–1,50 wniosku na 100 domów; Kraków, z 40% adresów,
ma 0,34, a wszystkie jego 139 wnioski obejmują termomodernizację, tylko 2 wymianę źródła ciepła.

## Metoda

1. **Licznik**: kolumna „Liczba wniosków o dofinansowanie ogółem” z raportu NFOŚiGW, wiersz gminy
   (układ WFOŚiGW → powiat → gmina). To wnioski złożone w nowym programie od 31.03.2025 do dnia
   stanu raportu, nie umowy ani wypłaty. Wniosek może dotyczyć wymiany źródła ciepła,
   termomodernizacji albo obu.
2. **Mianownik**: kolumna „Liczba budynków jednorodzinnych w całej gminie” z rankingu gmin NFOŚiGW
   za okres 01.04.2022–31.12.2023 (stan na 31.12.2023). Ten sam wydawca i serwis co raport.
3. **Wartość** = 100 × wnioski / budynki jednorodzinne, do 0,01. Brak licznika, brak mianownika
   albo mianownik 0 = `null`; zmierzone zero zostaje zerem.
4. **Łączenie gminy z adresami**: raport nie ma TERYT, więc wiersz raportu wybieramy po powiecie,
   nazwie i rodzaju gminy. Powiat, nazwę i rodzaj podaje wiersz rankingu z tym samym kodem gminy
   (TERYT, 7 cyfr, jak w adresach), a rodzaj sprawdzamy jeszcze względem siódmej cyfry kodu.
   Każda z 14 gmin musi mieć dokładnie jeden wiersz w raporcie.
5. **Etykieta na karcie** (słownik, jeden wpis na gminę, adresy niosą tylko klucz; plik 1,6 MB,
   limit kontraktu 2 MB): liczba wniosków i budynków, wartość na 100 domów, rodzaje źródeł ciepła
   we wnioskach i termomodernizacja, np. „Skawina: 59 wniosków o dofinansowanie z programu Czyste
   Powietrze (od 31.03.2025 do 12.12.2025) na 8531 budynków jednorodzinnych w gminie, czyli 0,69
   na 100 domów. Wymiana źródła ciepła we wnioskach: kocioł na pellet 11, kocioł na drewno 2,
   pompa ciepła 1. Termomodernizacja we wnioskach: 52.”

## Źródła i licencje

| Składnik | Źródło | Plik | Licencja |
|---|---|---|---|
| Wnioski wg gmin | NFOŚiGW, Raport „Czyste Powietrze w liczbach od 31 marca 2025 r.” ([strona](https://czystepowietrze.gov.pl/efekty-programu/raport-nfosigw-czyste-powietrze-w-liczbach-od-31-marca-2025)) | `Raport_WoD_nowego_PPCP_-_stan_na_12-12-2025.pdf`, 83 strony, 3 249 654 B, `Last-Modified` 2025-12-15 | informacja publiczna, ponowne wykorzystanie z podaniem źródła; brak jawnej licencji otwartej |
| Budynki jednorodzinne | NFOŚiGW, Ranking gmin w programie Czyste Powietrze za okres 01.04.2022–31.12.2023 ([strona](https://czystepowietrze.gov.pl/partnerzy/gminy/ranking-gmin/drugi-ranking-gmin)) | `ranking-gmin-01-04-2022-31-12-2023.pdf`, 63 strony, 734 793 B, `Last-Modified` 2024-11-06 | jak wyżej |

Atrybucja: Narodowy Fundusz Ochrony Środowiska i Gospodarki Wodnej (NFOŚiGW), program Czyste
Powietrze. Przekształcenia: wybór 14 gmin obszaru, iloraz wniosków i budynków do 0,01, powtórzenie
wartości gminy przy każdym adresie. Serwis `czystepowietrze.gov.pl` nie podaje licencji ani
regulaminu pobierania, a `robots.txt` nie blokuje tych ścieżek. Decyzja właściciela z 2026-10-03
(wątek zadania #141): bierzemy źródło jako informację publiczną z podaniem źródła; w metadanych
warstwy zostaje zapis „brak jawnej licencji otwartej”.

Serwer nie wysyła certyfikatu pośredniego, więc Node bez flagi zgłasza
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Pobieramy z `--use-system-ca` (magazyn certyfikatów systemu);
weryfikacji TLS nie wyłączamy. Surowe PDF-y leżą w `etl/.cache/` (poza gitem), a skrót SHA-256
każdego jest w migawce.

## Migawka `etl/czyste-powietrze-dane.json`

Dosłowne wiersze z `pdftotext -raw` z numerem strony PDF: wszystkie gminy 4 powiatów obszaru
(krakowski 17, wielicki 5, proszowicki 6, Kraków 1) wraz z wierszami powiatów oraz 14 wierszy
rankingu. Plik generuje `--odswiez`, nie edytuje się go ręcznie. Test i recenzent odtwarzają
z niego każdą liczbę warstwy bez dostępu do PDF-ów, a numer strony pozwala znaleźć wiersz w
dokumencie. Numer strony raportu zgadza się z numerem drukowanym u dołu strony (sprawdzone na
wszystkich 83 stronach).

## Kontrole (2026-10-03)

| Kontrola | Wynik |
|---|---|
| Sumy raportu: gminy → wiersz powiatu, powiaty → wiersz funduszu, fundusze → wiersz „Łącznie” (46 521 wniosków), we wszystkich 11 kolumnach, porównanie tekstów wierszy | 2477 gmin, 380 powiatów, 16 funduszy: wszystkie sumy zgodne |
| Odczyt raportu drugą metodą (`pdftotext -table`, układ geometryczny, nazwa i liczby w jednym wierszu tabeli) względem `-raw` (kolejność strumienia): nazwa, rodzaj, strona i 11 liczb | 2477 z 2477 wierszy gmin zgodnych |
| Kolejność kolumn: nagłówki raportu po sklejeniu linii względem listy kolumn w kodzie | zgodne; zmiana kolejności zatrzymuje odczyt |
| Ranking: wskaźnik z wiersza (wnioski / budynki, do 0,01 pp) jednoznacznie rozdziela liczby z separatorem tysięcy; kolejność malejąca po wskaźniku, unikalne kody gmin | 2160 wierszy odczytanych, 2 pominięte (literówki w PDF, nie dotyczą gmin obszaru) |
| Ranking odczytany drugą metodą (`-table`) względem `-raw` | 2160 z 2160 zgodnych |
| Lustro rankingu w z-dykty.pl (tabela `wskazniki`, kody `cz_pow_budynki_jednorodzinne`, `cz_pow_wnioski_zlozone`, `cz_pow_wskaznik_aktywnosci`) względem PDF | 12 z 12 gmin obecnych w z-dykty zgodnych; brak tam Zabierzowa i Krakowa |
| Wiarygodność: kolejność 14 gmin wg wniosków na 100 domów w 2025 r. względem wskaźnika aktywności z rankingu 2022–2023 | korelacja rang Spearmana 0,69; w obu okresach te same trzy gminy na górze (Igołomia-Wawrzeńczyce, Koniusza, Skawina) i te same dwie na dole (Kraków, Wieliczka) |
| Wiersze gmin raportu: suma rodzajów źródeł ciepła nie przekracza liczby wniosków | 2477 z 2477 gmin (wskazuje jedno źródło na wniosek; raport tego wprost nie stwierdza) |
| Wartość stała w obrębie TERYT, 14 gmin bez luk, etykieta zgodna z liczbą, plik poniżej 2 MB, metadane z generatora | w teście (`node --test etl/czyste-powietrze.test.mjs`) |
| Opublikowany plik względem przeliczenia z migawki | identyczny, w teście |

## Decyzje i dlaczego

| Decyzja | Dlaczego |
|---|---|
| Licznik „wnioski ogółem”, nie suma rodzajów źródeł ciepła | To jedyna liczba, którą raport podaje wprost dla wniosków. Rodzaje źródeł rozbijają wnioski wg pozycji, a raport nie mówi, czy wniosek może mieć dwa źródła, więc ich suma byłaby własnym szacunkiem. Rozbicie jest w etykiecie jako informacja, nie w wartości |
| Mianownik z rankingu NFOŚiGW, nie z z-dykty.pl ani z GUS | Ranking niesie kod gminy i liczbę budynków jednorodzinnych (dokładnie tę grupę, do której adresowany jest program) dla wszystkich 14 gmin, od tego samego wydawcy co raport. z-dykty ma lustro rankingu dla 12 gmin (bez Zabierzowa i Krakowa, czyli 46% adresów), a tabela `wskazniki` nie ma innej liczby budynków. GUS NSP 2021 (BDL) podaje na poziomie gminy zamieszkane budynki mieszkalne ogółem, bez podziału na jednorodzinne, a podział według liczby mieszkań tylko dla powiatów; do tego limit 1000 zapytań na 12 godzin był 2026-10-03 wyczerpany (HTTP 429) |
| Odczyt `pdftotext -raw`, nie `-layout` | `-layout` rozdziela nazwy gmin od liczb, bo komórki z nazwami są wyśrodkowane pionowo i wiersz „Augustów | gmina wiejska” dostaje liczby sąsiada. `-raw` zwraca wiersz tabeli jako jedną linię, a sumy na każdym poziomie raportu i druga metoda (`-table`) potwierdzają odczyt |
| Separator tysięcy to spacja, jak separator kolumn | Wiersze 14 gmin mają po 11 liczb poniżej 1000, więc nie ma niejednoznaczności (czego pilnuje parser: inna liczba tokenów to błąd). Wiersze powiatów i funduszy z tysiącami weryfikujemy porównaniem tekstów z sumą dzieci, nie rozbijaniem. W rankingu dwie liczby rozdziela wskaźnik z tego samego wiersza |
| Rodzaj gminy z rankingu względem słowa i siódmej cyfry TERYT, nie względem cyfry w nawiasie | W PDF 22 gminy miejsko-wiejskie mają przy nazwie „(2)”. Nie dotyczy to gmin obszaru, ale parser nie odrzuca przez to poprawnych wierszy |
| Kategoria „przyszlosc”, kierunek „wiecej-lepiej” | Tak ustalono w zadaniu #141. Konsekwencja: warstwa wchodzi do wyniku adresu (inaczej niż warstwy „kontekstu”), a ponieważ jest stała w gminie, przesuwa o ten sam skok wszystkie jej adresy. Gdyby wynik miał jej nie uwzględniać, wystarczy zmienić `kategoria` na „kontekst” w `zbudujMeta` i przeliczyć warstwę |
| Wnioski, nie umowy | Raport NFOŚiGW podaje wnioski złożone. Liczby umów i wypłat gmin w żadnym z dwóch dokumentów nie ma |
| Migawka z dosłownymi wierszami, nie surowy PDF w repo | Wiersze z numerem strony wystarczają do porównania z dokumentem, a PDF (3,2 MB) jest powtarzalny skryptem i leży w `etl/.cache/` |

## Ograniczenia

- Nowy program trwa w raporcie niespełna dziewięć miesięcy (od 31.03.2025 do 12.12.2025), więc
  wartości są małe (0,28–1,50 na 100 domów) i nie opisują historii dopłat do pieców. W rankingu
  2022–2023 wskaźnik aktywności tych gmin wynosił 2,5–14,5 wniosku na 100 domów (poprzedni
  nabór, 21 miesięcy).
- To wnioski złożone: raport nie mówi, ile z nich zakończyło się umową i wypłatą.
- Liczba budynków jednorodzinnych pochodzi z końca 2023 r., a PDF nie podaje, z jakiego rejestru
  NFOŚiGW ją wziął. Mianownik jest sprzed prawie dwóch lat, a w gminach obwarzanka przybywa
  domów, więc wartość może być nieco zawyżona.
- Wartość dotyczy całej gminy, nie okolicy adresu. W Krakowie (jedna wartość dla 70 217 adresów)
  wszystkie 139 wniosków obejmują termomodernizację, a wymianę źródła ciepła tylko 2 (pompa
  ciepła), więc jako miara wymiany pieców warstwa pokazuje tam praktycznie zero.
- Raport nie ma kodów TERYT; dopasowanie po powiecie, nazwie i rodzaju gminy jest jednoznaczne dla
  14 gmin obszaru (sprawdza je test), ale dla innych gmin trzeba je zweryfikować osobno.
- `pdftotext` w wersji Xpdf 4.06 (`-raw`); poppler może układać linie nieco inaczej. Sumy na
  każdym poziomie raportu zatrzymają odczyt, jeśli wiersze się pomylą.

## Odświeżenie

- Nowy raport NFOŚiGW (nazwa pliku zawiera datę stanu): zmień `RAPORT_URL` i `PLIK_RAPORTU`
  w skrypcie (`POCZATEK_PROGRAMU`, jeśli zmieni się okres), uruchom
  `node --use-system-ca etl/czyste-powietrze.mjs --odswiez`, sprawdź `git diff` migawki i test.
  Gdy zmieni się liczba funduszy, powiatów albo gmin, zaktualizuj `OCZEKIWANE`.
- Po zmianie adresów (`wersja` w `adresy.json`): `node etl/czyste-powietrze.mjs` (bez sieci),
  potem `node etl/kompakt.mjs`.
