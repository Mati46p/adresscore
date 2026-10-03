# Kolejki do lekarzy specjalistów – NFZ Terminy Leczenia (#138)

Wskaźnik `nfz_kolejki_dni` (jednostka: dni, kierunek: mniej-lepiej, kategoria: kontekst) to
**mediana czasu oczekiwania na pierwszą wizytę w poradniach specjalistycznych NFZ w promieniu
3 km** od adresu (linia prosta, nie czas dojazdu). Skrypt: `etl/nfz-kolejki.mjs`, testy:
`etl/nfz-kolejki.test.mjs`, wynik: `public/dane/wskazniki/nfz_kolejki_dni.json` (1,54 MB).

## Źródło i licencja

| Co | Wartość |
|---|---|
| Pierwotna instytucja | Narodowy Fundusz Zdrowia, Informator o Terminach Leczenia (API Terminy Leczenia) |
| Licencja | **CC BY 4.0** – metadane API [dane.gov.pl, zbiór 1455](https://dane.gov.pl/pl/dataset/1455,informator-o-terminach-leczenia) (sprawdzone 2026-10-03) |
| Warunek regulaminu API | wskazanie źródła danych: <https://api.nfz.gov.pl/> (jest w `meta.zrodla[0].url` i w licencji) |
| Pośrednik | z-dykty.pl, tabela `nfz_kolejki` (PostgREST, publiczny klucz anon). Atrybucja w meta: „przetworzone przez z-dykty.pl (CC BY 4.0)" |
| Okres sprawozdawczy | 2026-06 (`dataDanych`); z-dykty zaktualizowało tabelę 2026-07-28 |
| Zakres w z-dykty | 1 934 wiersze Małopolski (26 280 w kraju), 16 grup świadczeń |

Klucz i adres z-dykty są w `.env.local` (`ZDYKTY_SUPABASE_URL`, `ZDYKTY_ANON_KEY`), poza repo.
Surowe pobranie zostaje w `etl/.cache/nfz-kolejki/`; `--odswiez` pobiera od nowa (stronicowanie
`limit`/`offset`, liczba wierszy sprawdzana z nagłówkiem `Content-Range`).

## Co liczy

Dla adresu bierzemy poradnie w promieniu 3 km. W każdej z 12 specjalności (okulistyka,
laryngologia, neurologia, ortopedia, pulmonologia, endokrynologia, urologia, diabetologia,
dermatologia, reumatologia, nefrologia, gastroenterologia) liczymy medianę czasów oczekiwania,
a wynik to mediana tych specjalności, zaokrąglona do pełnego dnia. Wartość jest dopiero od
3 specjalności w promieniu; poniżej tego `null` (za mało danych), a etykieta mówi dlaczego.

| Zasada | Powód |
|---|---|
| Tylko przypadek stabilny (`przypadek = 1`) | zwykłe skierowanie; przypadki pilne mają osobną, krótszą kolejkę i zaniżałyby czas typowego pacjenta |
| Tylko poradnie dla dorosłych (bez „dla dzieci", „dziecięcej", kobiet w ciąży i poradni szpitali dziecięcych) | inna populacja i własne kolejki; szpital dziecięcy ma poradnie bez „dla dzieci" w nazwie, więc sprawdzamy też nazwę świadczeniodawcy |
| Bez onkologii, tomografii, rezonansu i kardiochirurgii | onkologia ma szybką ścieżkę (czasy nieporównywalne), TK i MR to diagnostyka, kardiochirurgia ma 2 wpisy w województwie |
| Najpierw mediana w specjalności, potem mediana specjalności | czasy różnią się kilkukrotnie (okulistyka ok. 140 dni, laryngologia ok. 20), więc mediana wszystkich wpisów mierzyłaby głównie liczbę poradni danej specjalności w okolicy |
| Minimum 3 specjalności | mediana z 1–2 liczb to jedna konkretna poradnia |
| `srednio_dni` = 0 zostaje zerem | NFZ: „przyjmują na bieżąco" to wartość prawdziwa; brak sprawozdania (`null`) odpada |
| Jedna poradnia na (świadczeniodawca, punkt adresowy, specjalność) | ta sama poradnia pod dwiema nazwami miejsca liczy się raz (mediana wpisów) |
| Tylko najnowszy okres | wszystkie wartości z jednego miesiąca sprawozdawczego |

`srednio_dni` to „średnia liczba dni oczekiwania na świadczenie zdrowotne" zgłoszona przez
świadczeniodawcę, nie gwarancja terminu. Nowa grupa świadczeń w z-dykty nie wchodzi cicho do
wskaźnika: skrypt ostrzega, a brak którejkolwiek z 12 specjalności zatrzymuje bieg.

## Położenie poradni

z-dykty nie ma współrzędnych, a `gmina_teryt` w `nfz_kolejki` wskazuje siedzibę świadczeniodawcy,
nie miejsce świadczenia (wpis z Tarnowa ma TERYT Krakowa), więc go nie używamy. Położenie ustalamy
dopasowaniem **miejscowość + ulica + numer** z NFZ do punktów adresowych z `adresy.json`
(MSIP Kraków, PRG): dopisek dzielnicy („KRAKÓW-PODGÓRZE") jest odcinany, rodzaj ulicy („UL.",
„AL.", „OS.") pomijany, nazwa ulicy porównywana od końca z dopuszczeniem inicjału i skrótu tytułu
(„F. Focha" = „Aleja Marszałka Ferdinanda Focha"), numer z literą, zakresem i lokalem sprowadzany
do budynku. Gdy kilka punktów pasuje, wszystkie muszą leżeć w 150 m od siebie, inaczej miejsce
zostaje bez położenia. Wieś numerowana (bez ulic w punktach adresowych) dopasowuje się tylko
wtedy, gdy NFZ też nie podaje ulicy: wpis „Zagórze, ul. Piłsudskiego 226" to Zagórze pod
Chrzanowem, nie wieś o tej nazwie w gminie Niepołomice.

| Miara | Wynik |
|---|---|
| Miejsca świadczenia w miejscowościach z `adresy.json` | 110 (kolejne 179 miejsc to inne miejscowości, poza obszarem mapy) |
| Dopasowane do punktu adresowego | **105 z 110 (95,5%)**; wiersze 264 z 278 (95,0%) |
| Tryb dopasowania | 103 po pełnym numerze, 2 po numerze bazowym („5G" → „5A") |
| Bez położenia (5) | Kraków: Złota Jesień 3 (w punktach „Osiedle Złotej Jesieni"), Kopiec Kościuszki 35, Prądnicka 37 (brak numeru w punktach); Skawina: ks. Popiełuszki 5 (brak ulicy); Zagórze (homonim spoza obszaru) |
| Poradnie z położeniem | 262 (specjalność × świadczeniodawca × punkt), w 86 różnych punktach |
| Kontrola niezależna: GUGiK UUG | 98 z 105 miejsc UUG też geokoduje; 97 leży ≤ 100 m od naszego punktu (mediana 0 m), maks. 204 m, bez odstających |

Poradnie spoza 14 gmin obszaru nie mają punktów adresowych w pliku i nie wchodzą do wskaźnika,
więc przy zewnętrznej granicy obszaru wartość może pomijać poradnie leżące tuż za nią.

## Pokrycie

Wartość ma **79 875 z 176 684 adresów (45,2%)**, reszta to `null`. Zakres: 0–321 dni, mediana
85, p10 63, p90 178, p99 192 (`zakres` w meta: 0–200).

| Gmina | Adresów | Z wartością |
|---|---|---|
| Kraków | 70 217 | 55 513 (79,1%) |
| Wieliczka | 22 017 | 12 174 (55,3%) |
| Skawina | 11 087 | 4 738 (42,7%) |
| Mogilany | 5 979 | 3 504 (58,6%) |
| Zielonki | 9 777 | 3 633 (37,2%) |
| Michałowice | 5 183 | 298 (5,8%) |
| Kocmyrzów-Luborzyca | 6 726 | 15 (0,2%) |
| Liszki, Zabierzów, Wielka Wieś, Niepołomice, Świątniki Górne, Koniusza, Igołomia-Wawrzeńczyce | 45 698 | 0 |

`null` ma dwa powody, rozróżnione w etykiecie (`slownikEtykiet`): brak poradni z danymi w
promieniu 3 km (79 547 adresów) albo tylko 1–2 specjalności (17 262 adresy). Etykieta przy
wartości mówi, na ilu specjalnościach i poradniach ona stoi („12 specjalności, 123 poradnie
w promieniu 3 km"). Etykiety są kluczami słownika, bo pełne napisy dla 176 tys. adresów
przekroczyłyby limit 2 MB pliku.

## Czego wskaźnik nie mówi

- To czas z puli poradni w 3 km, nie czas dojazdu ani termin dla konkretnego pacjenta.
- Wartość zależy od tego, jakie specjalności są w pobliżu; etykieta pokazuje ich liczbę.
- „Brak poradni z danymi NFZ" dotyczy poradni z z-dykty (16 grup świadczeń, okres 2026-06), nie
  całego systemu: nie ma tam m.in. kardiologii, ginekologii, psychiatrii ani pediatrii.
- Kategoria `kontekst`: wskaźnik jest faktem na karcie i nie wchodzi do wyniku A–G. Żeby wszedł,
  integrator dopisuje `nfz_kolejki_dni` do `KONTEKST_DO_WYNIKU` w `src/wynik/silnik.ts`
  (np. jako `codziennosc`); kierunek `mniej-lepiej` jest już ustawiony.

## Uruchomienie i testy

```
node etl/nfz-kolejki.mjs [--odswiez]   # pobranie (raz) i przeliczenie, ok. 5 s
node --test etl/nfz-kolejki.test.mjs   # 17 testów: czyste funkcje, plik wskaźnika, przeliczenie z cache
```

Skrypt zatrzymuje się, gdy: schemat `nfz_kolejki` się zmienił, pobranie jest niepełne, brakuje
którejś z 12 specjalności, dopasowanie adresów spada poniżej 80%, kontrola niezależna (pełny
przegląd poradni na kuli zamiast rzutu EPSG:2180, 601 adresów, przypadki graniczne ±15 m
pomijane) wykaże rozbieżność albo plik przekroczy 2 MB.
