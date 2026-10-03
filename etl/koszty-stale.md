# Koszty stałe mieszkania w gminie – `gmina_koszty_stale_rok` (zadanie #140)

Roczny szacunek kosztów stałych wzorcowego gospodarstwa (3 osoby, mieszkanie 60 m² w budynku
mieszkalnym) w 14 gminach Krakowa i obwarzanka: opłata za odpady plus podatek od nieruchomości.
Warstwa gminna: każdy adres gminy dostaje tę samą liczbę (176 684 z 176 684 adresów), a brak danych
gminy to `null`, nigdy 0. Kategoria „kontekst”, kierunek neutralny: fakt na karcie, bez wpływu
na wynik adresu.

Uruchomienie: `node etl/koszty-stale.mjs` (klucz z-dykty w `.env.local`: `ZDYKTY_SUPABASE_URL`,
`ZDYKTY_ANON_KEY`). Stawki względem uchwał: `node --use-system-ca etl/koszty-stale.mjs --sprawdz-eli`
(wymaga `pdftotext` z poppler w PATH). Test: `node --test etl/koszty-stale.test.mjs`.

## Wynik (stan na 2026-10-03)

| Gmina | Adresów | Wpływ z opłaty 2025, zł/os. | Odpady (3 os.) | Stawka 2026, zł/m² | Podatek (60 m²) | Razem, zł/rok | Uchwała (ELI) |
|---|---:|---:|---:|---:|---:|---:|---|
| Skawina | 11 087 | 537,96 | 1 614 | 1,13 | 68 | **1 682** | [2025/6214](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2025/6214) |
| Kraków | 70 217 | 508,37 | 1 525 | 1,25 | 75 | **1 600** | [2025/6495](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2025/6495) |
| Zielonki | 9 777 | 450,81 | 1 352 | 1,25 | 75 | **1 427** | [2025/6405](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2025/6405) |
| Niepołomice | 11 578 | 444,38 | 1 333 | 0,89 | 53 | **1 386** | [2025/6954](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2025/6954) |
| Wieliczka | 22 017 | 436,35 | 1 309 | 1,08 | 65 | **1 374** | [2024/7222](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2024/7222) |
| Michałowice | 5 183 | 420,03 | 1 260 | 1,25 | 75 | **1 335** | [2025/6255](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2025/6255) |
| Kocmyrzów-Luborzyca | 6 726 | 420,06 | 1 260 | 0,84 | 50 | **1 310** | [2025/5652](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2025/5652) |
| Liszki | 7 564 | 409,28 | 1 228 | 1,12 | 67 | **1 295** | [2024/7050](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2024/7050) |
| Mogilany | 5 979 | 403,02 | 1 209 | 0,95 | 57 | **1 266** | [2024/8052](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2024/8052) |
| Zabierzów | 11 288 | 403,28 | 1 210 | 0,82 | 49 | **1 259** | [2024/8293](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2024/8293) |
| Wielka Wieś | 6 079 | 386,39 | 1 159 | 1,14 | 68 | **1 227** | [2025/6228](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2025/6228) |
| Świątniki Górne | 3 895 | 383,91 | 1 152 | 0,77 | 46 | **1 198** | [2025/6784](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2025/6784) |
| Koniusza | 2 945 | 366,87 | 1 101 | 0,72 | 43 | **1 144** | [2024/7690](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2024/7690) |
| Igołomia-Wawrzeńczyce | 2 349 | 318,48 | 955 | 0,80 | 48 | **1 003** | [2023/8287](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2023/8287) |

Rozstęp 1 003–1 682 zł rocznie. Najwyższy wpływ z opłaty na mieszkańca ma Skawina (538 zł), drugi
jest Kraków (508 zł). Trzy gminy (Kraków, Michałowice, Zielonki) mają stawkę podatku na ustawowym
maksimum 1,25 zł/m², najniższą Koniusza (0,72 zł/m²).

## Metoda

1. **Opłata za odpady** = 3 × (dochody gminy w rozdz. 90002, §0490, wykonanie 2025 / liczba mieszkańców).
2. **Podatek** = 60 m² × stawka podatku od budynków mieszkalnych (zł od 1 m² powierzchni
   użytkowej) z uchwały rady gminy obowiązującej w 2026 r.
3. Składniki zaokrąglane do pełnych złotych, suma jest sumą zaokrąglonych składników, więc liczby
   na karcie dodają się bez grosza różnicy (pilnuje tego test).
4. Brak wpływów, mieszkańców albo stawki = `null`. Wpływ poniżej 50 zł na osobę (opłata idzie przez
   budżet związku międzygminnego, próg jak w z-dykty) = `null`. Powyżej 1 500 zł na osobę skrypt staje
   z błędem, bo to prawie na pewno błąd danych.
5. Etykieta na karcie: „odpady 1525 zł + podatek 75 zł (3 os., 60 m²)”. Słownik ma jeden wpis
   na gminę, a adresy niosą tylko klucz (plik 1,6 MB, limit kontraktu 2 MB).

## Źródła i licencje

| Składnik | Źródło pierwotne | Droga | Licencja |
|---|---|---|---|
| Wpływy z opłaty za odpady | Ministerstwo Finansów, sprawozdania Rb-27S ([dane.gov.pl, zbiór 872](https://dane.gov.pl/pl/dataset/872)) | z-dykty.pl, tabela `budzet_pozycje` (dochody, dział 900, rozdz. 90002, §0490, wykonanie) | CC BY 4.0 (metadane zbioru, odczyt 2026-10-03); opracowanie z-dykty.pl CC BY 4.0 |
| Liczba mieszkańców | GUS, Bank Danych Lokalnych, zmienna 72305 | z-dykty.pl, tabela `wskazniki`, kod `ludnosc`, rok 2025 | CC BY 4.0 ([Portal API GUS](https://api.stat.gov.pl/Home/BdlApi)); opracowanie z-dykty.pl CC BY 4.0 |
| Stawki podatku | Uchwały rad gmin, Dziennik Urzędowy Województwa Małopolskiego ([ELI](https://edziennik.malopolska.uw.gov.pl/eli)) | bezpośrednio, API ELI (`/api/eli/acts/…/text.pdf`) | akty prawa miejscowego nie podlegają ochronie prawnoautorskiej (art. 4 pkt 1 ustawy o prawie autorskim); `robots.txt` e-dziennika blokuje tylko `/login` |
| Górna granica stawki 2026 | Obwieszczenie Ministra Finansów i Gospodarki z 1 sierpnia 2025 r., M.P. 2025 poz. 726 | walidacja, nie dana wejściowa | 1,25 zł/m² dla budynków mieszkalnych |

Dostęp do z-dykty: PostgREST z publicznym kluczem `anon` w nagłówku `apikey`, zapytania filtrowane
po stronie serwera (14 TERYT-ów). Klucz nie trafia do repo ani do `etl/.cache/`. Wejście wskaźnika
(14 wierszy: wykonanie i liczba mieszkańców) zapisuje skrypt do `etl/koszty-stale-odpady-2025.json`,
żeby test i recenzent mogli policzyć wynik bez dostępu do z-dykty.

## Decyzje i dlaczego

| Decyzja | Dlaczego |
|---|---|
| Wpływy z `budzet_pozycje` (rozdz. 90002), nie z widoku `mv_smieci_gmina` | Widok sumuje §0490 ze wszystkich rozdziałów. W Krakowie dolicza 120,8 mln zł opłat parkingowych (rozdz. 60019) i 11,8 mln zł z rozdz. 75618, więc wychodzi 548,2 mln zł zamiast 415,1 mln zł, czyli 671 zamiast 508 zł na osobę. Strona gminy w z-dykty pokazuje 508 zł, tak jak ten skrypt. Różnice w pozostałych gminach: tabela niżej |
| Stawki podatku z uchwał, nie z `podatki_skutki` | Rb-PDP niesie wpływy i skutki ulg („to nie są stawki”), a stawki za 1 m² w z-dykty nie ma. Treści uchwał są w ELI |
| Stawki obowiązujące w 2026 r., wpływy z 2025 r. | Dla czytelnika liczy się rachunek dziś. Rok 2025 to ostatnie zamknięte sprawozdanie. Sześć gmin (Liszki, Zabierzów, Wieliczka, Koniusza, Mogilany, Igołomia-Wawrzeńczyce) ma stawki z uchwał z lat 2023–2024, które nadal obowiązują |
| Średnie wpływy zamiast stawek z uchwał o opłacie | Cztery metody naliczania (od osoby, od gospodarstwa, od zużycia wody, od powierzchni), łańcuchy zmian i uchwały unieważnione przez RIO nie dają się porównać bez założeń o zużyciu wody. Wpływy to jedna miara dla wszystkich gmin. Koszt: obejmują firmy i instytucje, a liczba mieszkańców to dane GUS. Przykład: w Krakowie stawka od 1 września 2025 r. to 35 zł od osoby miesięcznie ([uchwała XXXIII/669/25](https://edziennik.malopolska.uw.gov.pl/eli/POL_WOJ_MP/2025/4453)), czyli 1 260 zł rocznie dla 3 osób wobec 1 525 zł z wpływów |
| Kategoria „kontekst”, kierunek neutralny | Jak pozostałe warstwy gminne (#44): kwota stała w gminie przesunęłaby wynik wszystkich jej adresów o ten sam skok, a wysoka opłata finansuje usługi. Do wyniku wchodzą tylko warstwy kontekstu z listy `KONTEKST_DO_WYNIKU` w `src/wynik/silnik.ts` (tor integracji); tej warstwy tam nie ma, więc jest faktem na karcie. Chcąc ją w wyniku, integrator dopisuje jej `id` do listy |
| Tylko budynek mieszkalny, bez udziału w gruncie | Udział w gruncie zależy od budynku i wspólnoty, więc wymagałby kolejnego założenia. Pominięty jawnie w opisie warstwy |

Różnica widoku `mv_smieci_gmina` względem rozdz. 90002 (zł na osobę, 2025):

| Gmina | Widok | Rozdz. 90002 | Różnica |
|---|---:|---:|---:|
| Kraków | 671,27 | 508,37 | +32,0% |
| Niepołomice | 495,76 | 444,38 | +11,6% |
| Liszki | 450,08 | 409,28 | +10,0% |
| Wieliczka | 457,12 | 436,35 | +4,8% |
| Zielonki | 465,12 | 450,81 | +3,2% |
| Koniusza | 377,96 | 366,87 | +3,0% |
| Skawina | 544,24 | 537,96 | +1,2% |
| Pozostałe 7 gmin | | | od 0 do +0,6% |

## Kontrole (2026-10-03)

| Kontrola | Wynik |
|---|---|
| 14 stawek względem uchwał w ELI (`--sprawdz-eli`: status „obowiązujący”, tytuł, stawka z PDF, data „1 stycznia RRRR”) | 14 / 14 zgodnych |
| Parser stawki na prawdziwych fragmentach 14 uchwał (różne myślniki, kolejność kwoty, numeracja, nagłówek strony w pozycji) | 14 / 14, w teście |
| Wpływ Krakowa z rozdz. 90002 względem strony z-dykty | 415,14 mln zł i 508 zł na osobę, jak na stronie |
| Stawki względem maksimum ustawowego 2026 (1,25 zł/m²) | wszystkie w granicach, trzy gminy na maksimum |
| 7 uchwał o zwolnieniach z podatku od nieruchomości (Kraków, Michałowice, Kocmyrzów-Luborzyca, Świątniki Górne, Liszki) przejrzanych w ELI | żadna nie wymienia budynków mieszkalnych; zwolnień i tak nie uwzględniamy |
| Wartość stała w obrębie TERYT, 14 gmin bez luk, składniki dodają się do liczby, plik poniżej 2 MB | w teście (`node --test etl/koszty-stale.test.mjs`) |
| Opublikowany plik względem przeliczenia z migawki wejścia i stawek | identyczny, w teście |

## Ograniczenia

- To średnia gminy, nie rachunek konkretnego domu. Wpływy z opłaty dotyczą wszystkich płatników,
  więc wynik może odbiegać od faktycznej opłaty w obie strony (Kraków: o 21% powyżej stawki
  nominalnej dla 3 osób).
- Pominięte: udział w gruncie pod budynkiem, ulgi, zwolnienia, woda, energia, ogrzewanie, czynsz.
- Wpływy 2025 nie uwzględniają podwyżek z 2026 r. (Kraków: stawka 35 zł od września 2025 r.).
- Uchwała podatkowa Igołomi-Wawrzeńczyc pochodzi z 2023 r. (obowiązuje od 2024-01-01); w ELI nie ma
  nowszej. Uchwała Liszek o zwolnieniach z 2026 r. (XXXII/400/2026) została zakwestionowana przez RIO
  (status w ELI: częściowa nieważność); dotyczy zwolnień, nie stawek.

## Odświeżenie

- Nowe wpływy: usuń `etl/.cache/z-dykty-odpady-*` i uruchom skrypt. Przy zmianie roku zmień
  `ROK_ODPADOW` w skrypcie.
- Nowe stawki (rady uchwalają je co jesień): zaktualizuj `etl/koszty-stale-stawki-2026.json`
  (uchwała, daty, cytat), `ROK_STAWEK` i `MAKS_STAWKA_ZL_M2` w skrypcie, potem
  `node --use-system-ca etl/koszty-stale.mjs --sprawdz-eli`.
- Serwer e-dziennika nie wysyła certyfikatu pośredniego, więc Node bez `--use-system-ca` zgłasza
  `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Weryfikacji TLS nie wyłączamy.
