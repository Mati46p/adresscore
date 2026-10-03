# Przestępstwa stwierdzone – rejon Policji (powiat), 2025

`node etl/przestepstwa.mjs` pobiera z API
[Banku Danych Lokalnych GUS](https://bdl.stat.gov.pl/bdl/start) dane Policji za 2025 r.
dla powiatów Małopolski (poziom 5) i buforuje odpowiedzi w `etl/.cache/`:

| Zmienna BDL | Treść |
| --- | --- |
| [1752907](https://bdl.stat.gov.pl/api/v1/data/by-variable/1752907?unit-parent-id=011200000000&unit-level=5&format=json&lang=pl) | przestępstwa stwierdzone przez Policję na 1000 mieszkańców (P4633) |
| [1749155](https://bdl.stat.gov.pl/api/v1/data/by-variable/1749155?unit-parent-id=011200000000&unit-level=5&format=json&lang=pl) | rok – przestępstwa stwierdzone ogółem (P4601) |
| [1749170](https://bdl.stat.gov.pl/api/v1/data/by-variable/1749170?unit-parent-id=011200000000&unit-level=5&format=json&lang=pl) | rok – wskaźnik wykrywalności sprawców ogółem, % (P4601) |

Stan pobrania 2026-10-03:

| Powiat (jednostka Policji) | Stwierdzone | Na 1000 mieszk. | Wykrywalność | Adresów |
| --- | ---: | ---: | ---: | ---: |
| m. Kraków (KMP) | 18 603 | 22,95 | 60,9% | 70 217 |
| krakowski (KMP) | 2 891 | 9,48 | 65,4% | 69 927 |
| wielicki (KPP Wieliczka) | 1 985 | 13,57 | 75,7% | 33 595 |
| proszowicki (KPP Proszowice) | 307 | 7,34 | 77,6% | 2 945 |

Suma Krakowa zgadza się z Raportem o stanie Gminy 2025 (BIP): 18 603 przestępstwa stwierdzone,
wykrywalność 60,8% (BDL podaje 60,9%). Cztery powiaty pokrywają wszystkie 176 684 adresy.

Wyniki:

- `wskazniki/przestepstwa_1000_powiat_2025.json` – informacja, nie ocena: grupa `bezpieczenstwo`
  z `PRZENIESIONE` (`etl/uprosc-kryteria.mjs`, #171), kierunek „mniej = lepiej”, **waga startowa 0**,
  więc domyślnie nie wpływa na wynik (po nadaniu wagi liczy się jak zwykła warstwa),
- `wskazniki/wykrywalnosc_powiat_2025.json` – jw., kierunek „więcej = lepiej”,
- `przestepstwa_rejony_2025.json` – wiersze powiatów z URL zmiennych oraz rejony komisariatów Krakowa.

ETL importuje grupę i kierunek z `PRZENIESIONE` (funkcja `grupa`), więc ponowny bieg
`node etl/przestepstwa.mjs` nie cofa integracji z #171. Testy (`node --test etl/przestepstwa.test.mjs`)
pilnują: wartość adresu = wartość jego powiatu, adresy sumują się do całości (powiaty i komisariaty),
brak danych to `null`, a nie zero.

Do poprawy przy najbliższym przebudowaniu kompaktu (zmiana `meta.opis` unieważnia kompakt –
`niezgodnoscKompaktu` zwraca „inna meta” – więc nie robimy jej osobno): `opis` obu warstw mówi, że BIP
Krakowa jest „niedostępny z ETL” (jest osiągalny, po prostu nie publikuje liczb per komisariat) i że
wskaźnik „nie wpływa na wynik” (od #171 ma wagę startową 0, którą użytkownik może podnieść), a `opis`
wykrywalności powtarza zdanie o mianowniku z ludnością, które jej nie dotyczy (to odsetek, nie wskaźnik
na 1000 mieszkańców).

Rozdzielczość `rejon`, **nigdy adres**: ta sama wartość stoi przy każdym adresie powiatu.
Licznik liczy przestępstwa w miejscu popełnienia (także wobec turystów i dojeżdżających),
mianownik to stali mieszkańcy – Kraków jako centrum wypada gorzej niż gminy obwarzanka.
Brak wartości w BDL daje `null`, nie zero.

## Rejony komisariatów KMP Kraków – liczb nie ma w otwartych źródłach

Przypisanie dzielnic do ośmiu komisariatów pochodzi ze stron KMP Kraków
(„Obsługiwana dzielnica”, np. [KP V](https://krakow.policja.gov.pl/kr1/wolnytekst/1314,Komisariat-Policji-V-w-Krakowie.html)):
KP I – I; KP II – II; KP III – III, IV; KP IV – V, VI, VII; KP V – VIII, IX, XIII;
KP VI – X, XI, XII; KP VII – XV, XVI, XVII; KP VIII – XIV, XVIII. Skrypt sprawdza,
że każdy adres Krakowa trafia do dokładnie jednego komisariatu.

Liczb przestępstw per komisariat **nie znaleziono**, więc w pliku rejonów wartości komisariatów
są `null` (brak danych, nie zero). Gdy dokument się pojawi, wystarczy uzupełnić liczby per `KP …`
i podzielić przez ludność dzielnic danego rejonu (rok i URL dokumentu w pliku).

Sprawdzone wieczorem 2026-10-03 (kontynuacja #68). `bip.krakow.pl` jest osiągalny (HTTP 200,
`robots.txt` zamyka tylko `/captcha`); 503 z wcześniejszej próby były przejściowe, więc brak liczb
nie wynika z dostępu do serwera:

| Źródło | Co zawiera | Wynik |
| --- | --- | --- |
| Raporty o stanie Gminy 2018–2025 (BIP, `plik.php?zid=` 242261, 274867, 308075, 337263, 400279, 486691, 581632, 684238) | sumy dla miasta (2025: 18 603 przestępstwa, 2024: 19 575); rozkład przestrzenny tylko jako mapa „dane własne UMK” (rys. IV.2.6 w raporcie 2025) | brak tabeli per komisariat; „komisariat” pada tylko przy wydatkach i monitoringu |
| Raport o stanie miasta za 2016 (BIP, `zid=193069`, tabela XII.3) | przestępstwa stwierdzone wg komisariatów I–VIII za 2015 i 2016 (razem 20 671 w 2016) | ostatnia oficjalna tabela per komisariat; sprzed 10 lat, więc nie użyta |
| Informacja Policji za 2025 dla Komisji Praworządności RMK (posiedzenie nr 24, 2026-03-16) | BIP: zawiadomienie, lista obecności i protokół 24/2026 (`_inc/rada9kdn/show_pdfdoc.php?id=145636`) | liczby dla całej KMP, bez komisariatów; samej Informacji nie opublikowano. Żadne z 30 posiedzeń IX kadencji nie ma załącznika Policji |
| Program „Bezpieczny Kraków” 2025–2028 (BIP, `zid=548549`) | cele i działania | bez statystyk komisariatów |
| MSIP Obserwatorium, `Obserwatorium/K07_Admini_i_Bezpiecz`, warstwa 7 „Zasięgi komisariatów” | 8 wielokątów rejonów komisariatów (pola `kp`, `komisariat`) | bez liczb; nadaje się do dokładniejszego przypisania adresów niż po dzielnicach |
| Portal „Bezpieczny Kraków” (ArcGIS Hub `bezpiecznykrakow-gmk.hub.arcgis.com`) | mapa przestępczości z rejestrów Policji i Straży Miejskiej (zapowiedź UMK z 2021 r.) | element witryny i API zwracają błąd uprawnień (GWM_0003): zasoby niepubliczne, zabezpieczeń nie obchodzimy |
| dane.gov.pl (API 1.4) | – | brak zbiorów o przestępstwach Krakowa (trafienia to Gdynia i Gdańsk) |
| BDL, temat P4601 | przestępstwa wg powiatów | `availability.levels = [5]`, brak poziomu gminy, więc obwarzanek zostaje na powiatach |
| statystyka.policja.pl | pliki XLSX „do 2021” | za stare |
| Prasa ([portalsamorzadowy.pl](https://www.portalsamorzadowy.pl/wydarzenia-lokalne/policyjne-statystyki-nie-klamia-te-rejony-krakowa-lepiej-omijac,447490.html), marzec 2023) | dane KMP dla PAP za 2022 r.: wybrane kategorie dla części komisariatów, bez dokumentu źródłowego | niepełne i nieoficjalne, nie użyte |

Jedyna droga do liczb per komisariat za 2025 r. to wniosek o informację publiczną do KMP Kraków
(liczba przestępstw stwierdzonych w rejonach KP I–VIII; ustawowo 14 dni, po przedłużeniu do 2 miesięcy).
Do tego czasu wskaźnik zostaje na rozdzielczości powiatu.
