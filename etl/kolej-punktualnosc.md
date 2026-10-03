# Punktualność pociągów na najbliższej stacji: `kolej_punktualnosc` (#139)

`node etl/kolej-punktualnosc.mjs` liczy jedną warstwę `transport` dla każdego z 176 684 adresów. Uzupełnia
#111: `kolej_odleglosc` i `kolej_kursy_szczyt_h` mówią, jak blisko jest stacja Kolei Małopolskich i jak
często z niej jeżdżą pociągi, a ta warstwa mówi, jak punktualnie pociągi zatrzymują się na najbliższej
stacji z danych całego kraju. Testy: `node --test etl/kolej-punktualnosc.test.mjs`. Dane czyta z tabel
z-dykty.pl przez PostgREST (zmienne `ZDYKTY_SUPABASE_URL` i `ZDYKTY_ANON_KEY` ze środowiska albo z
`.env.local`; klucz anon jest publiczny z założenia, skrypt go nie wypisuje i nie zapisuje).

| id | Co mierzy | Jedn. | Kierunek | Skala |
|---|---|---|---|---|
| `kolej_punktualnosc` | odsetek zatrzymań pociągów na najbliższej stacji (do 3 km, linia prosta), które nie były opóźnione o 6 minut lub więcej, w 2024 r. | % | wiecej-lepiej | 80–100 |

Rozdzielczość: adres (wartość stacji przypisana adresom w promieniu jej zasięgu). Kategoria: `transport`.
Brak stacji w promieniu 3 km to `null` (szary), nigdy 0.

## Źródła i licencja

- **Urząd Transportu Kolejowego**, dane.gov.pl, zbiór 1650 „Przewozy pasażerskie” (API 1.4 sprawdzone
  2026-10-03: `license_name: CC0 1.0`). Rocznik 2024: zasób 67808 „Liczba zatrzymań pociągów pasażerskich
  w 2024 r.” (mianownik) i zasób 67804 „Liczba opóźnionych zatrzymań pociągów w 2024 r.” (licznik), oba
  opublikowane 2025-06-27. Zbiór ma też zasób 2062811 „Liczba opóźnionych pociągów pasażerskich w 2025 roku w
  podziale na przewoźników” (opublikowany 2026-06-12), ale nie ma zasobu z liczbą zatrzymań w 2025 r. (lista
  zasobów sprawdzona 2026-10-03), więc udziału za 2025 r. nie da się policzyć.
- **z-dykty.pl** przetworzyło te pliki do tabel `kolej_punktualnosc` (stacja × rok × przewoźnik) i
  `kolej_stacje` (położenie) na licencji CC BY 4.0. Atrybucja w `zrodla[]`: instytucja pierwotna + „przetworzone
  przez z-dykty.pl (CC BY 4.0)”, tak jak w decyzji do #139.
- **Położenie stacji** w `kolej_stacje` to dopasowanie nazwy stacji UTK do przystanku w GTFS mkuran.pl
  (rozkłady PKP PLK; mkuran.pl podaje warunki ponownego wykorzystania danych sektora publicznego PKP PLK).
  Drugie źródło w `zrodla[]` mówi o tym wprost. Stan tabeli: 2026-09-07.
- **Definicja punktualności jest urzędowa:** pociąg punktualny ma opóźnienie do 5 min 59 s, więc „opóźnione
  zatrzymanie” to od 6 minut.

## Metoda

1. **Rocznik:** najnowszy, w którym wiersze mają i licznik, i mianownik (`wybierzRok`). To 2024. Rocznik 2025
   ma u UTK sam licznik, więc udziału nie da się policzyć. Rocznik spoza tabeli `ROCZNIKI_UTK` zatrzymuje ETL
   (najpierw trzeba sprawdzić zasoby i datę publikacji).
2. **Stacja:** zatrzymania i opóźnione zatrzymania zsumowane po przewoźnikach (od 2024 r. UTK podaje stację ×
   przewoźnik). Stacja z choćby jednym niepełnym wierszem odpada.
3. **Stacja kwalifikowana:** metoda położenia `gtfs` (nazwa 1:1; `gtfs-prefiks` bierze pozycję jednego z kilku
   kandydatów i może mylić się o kilometry), pozycja w Polsce i co najmniej 2000 zatrzymań w roku.
4. **Najbliższa stacja:** linia prosta do najbliższej kwalifikowanej stacji, do 3 km (ta sama funkcja
   `najblizszyPunkt` co w `kolej_odleglosc`). Dalej: brak danych.
5. **Wartość:** `100 × (1 − opóźnione / zatrzymania)`, zaokrąglone do 0,1 pp. Zero i sto są zmierzonymi
   wartościami (w danych jest 86,1–99,1).
6. **Bramki:** liczba wierszy z-dykty (`Content-Range` kontra pobrane), udział opóźnionych w kraju między 3 a 20%,
   licznik większy od mianownika u więcej niż 1% stacji (objaw różnego zakresu plików UTK), rozmiar pliku
   poniżej 2 MB.

### Dlaczego próg 2000 zatrzymań

- Wynik jest podawany z dokładnością 0,1 pp. Przy 2000 zatrzymań jedno opóźnione przesuwa go o 0,05 pp, czyli
  o pół kroku. Poniżej procent opisuje kilka pociągów, nie stację.
- W okolicy Krakowa próg odcina pięć stacji o małym ruchu w 2024 r., a UTK w 2025 r. podaje dla nich od 3,9 do 38
  razy więcej opóźnionych zatrzymań (rozkład się zmienił, rocznik 2024 ich nie opisuje):

| Stacja | Zatrzymań 2024 | Punktualnych 2024 | Opóźnione 2025 / 2024 |
|---|---|---|---|
| Kraków Przylasek | 477 | 97,1% | 24,1 |
| Kraków Kościelniki | 477 | 97,1% | 24,7 |
| Kraków Piastów | 1178 | 95,2% | 37,9 |
| Kraków Lubocza | 1967 | 94,9% | 3,9 |
| Kraków Nowa Huta | 1967 | 95,3% | 4,1 |

  Między 1967 a 4859 zatrzymań nie ma w okolicy żadnej stacji, więc każdy próg z tego przedziału daje ten sam
  wynik; 2000 to najmniejsza okrągła liczba. z-dykty używa 5000 w rankingu stacji (tam liczy się kolejność).
- Koszt wobec progów niższych (adresy z wartością):

| Próg (zatrzymań/rok) | Kraków | Obwarzanek | Razem |
|---|---|---|---|
| 365 | 59 499 (84,7%) | 55 617 (52,2%) | 65,2% |
| 1000 | 57 688 (82,2%) | 55 225 (51,9%) | 63,9% |
| **2000** | **53 406 (76,1%)** | **54 890 (51,6%)** | **61,3%** |

  Jeśli właściciel woli pokazać wschodni Kraków z wartością z 2024 r. (z ostrzeżeniem), wystarczy zmienić
  `MIN_ZATRZYMAN` na 1000 (wraca ok. 4,3 tys. adresów Krakowa) albo 365 (ok. 6,1 tys.). Skrypt wypisuje
  `UWAGA` dla każdej użytej stacji, której opóźnienia w roku następnym wzrosły albo spadły trzykrotnie.

## Kontrola (bieg z 2026-10-03, rocznik 2024)

Pokrycie 108 296 z 176 684 adresów (61,3%). Plik 0,88 MB, bez etykiet.

| | Z wartością | Min | p5 | Mediana | p95 | Max |
|---|---|---|---|---|---|---|
| Kraków | 53 406 z 70 217 (76,1%) | 89,8 | 90,4 | 92,5 | 99,1 | 99,1 |
| Obwarzanek | 54 890 z 106 467 (51,6%) | 86,1 | 86,7 | 92,3 | 99,1 | 99,1 |

- Krajowy udział opóźnionych zatrzymań w 2024 r.: 8,72% (3 114 017 z 35 727 821), czyli 91,3% punktualnych.
- Stacje: 2674 z 3176 trafiło do warstwy. Odrzucone: 276 bez położenia 1:1 (259 bez dopasowania, 9
  `gtfs-prefiks`, 8 zagranicznych), 67 bez pomiaru w 2024 r., 159 z ruchem poniżej progu.
- Użyto 54 stacji. Najczęściej wybierane: Wieliczka Rynek-Kopalnia (5706 adresów), Kraków Łobzów (5451),
  Kraków Główny (5327), Kraków Batowice (5133), Kraków Bronowice (4959).

| Adres | Najbliższa stacja | Wartość |
|---|---|---|
| Kraków, Pawia 5 | Kraków Główny, 171 m | 90,4% z 161 704 zatrzymań |
| Kraków, Rynek Główny 10 | Kraków Grzegórzki, 797 m | 94,5% z 73 147 |
| Kraków, Wielicka 256 | Wieliczka Bogucice, 942 m | 99,1% z 23 445 |
| Wieliczka, Rynek Górny 7 | Wieliczka Rynek-Kopalnia, 400 m | 99,1% z 23 442 |
| Skawina, Rynek 2 | Skawina, 349 m | 92,6% z 25 187 |
| Niepołomice, Rynek 19 | Staniątki, 2549 m | 91,2% z 18 955 |
| Zabierzów, Krakowska 22 | Zabierzów, 578 m | 91,2% z 30 802 |
| Kocmyrzów, Na Błonie 6 | Baranówka, 1941 m | 88,8% z 15 017 |
| Mogilany, Zakopiańska 66 | brak stacji w promieniu 3 km | brak danych |

Kontrole niezależne:
- Wszystkie 176 684 adresy porównane z pełnym przeszukaniem (własny haversine, bez KDBush i bez kodu ETL,
  stacje kwalifikowane liczone od nowa z surowych tabel): 0 rozbieżności (108 296 wartości, 68 388 braków),
  w tym 2646 adresów w pasie 2950–3050 m od najbliższej stacji.
- Położenie stacji wobec GTFS Kolei Małopolskich (`kml-ska-gtfs.zip`, 140 stacji po nazwie): mediana
  różnicy 36 m, p90 117 m, największa 404 m (Zastów). Wyjątek: Bańska Niżna ma w GTFS KM pozycję 0,0, a
  w z-dykty poprawną (49,398; 20,016). To pokazuje, po co jest bramka „pozycja w Polsce”.
- 13 testów na czystych funkcjach i pobieraniu stron (Range, `Content-Range`, ponowienia, klucz nie trafia
  do komunikatu błędu); 8 celowych usterek w kodzie (próg, promień, sumowanie przewoźników, kierunek procentu,
  filtr położenia, niepełny wiersz, ponawianie 429, klucz w błędzie) wychwytują testy.

## Ograniczenia

- **To rok 2024, nie dziś.** Zmiany rozkładu od 2025 r. nie są uwzględnione. Gdy z-dykty doda rocznik z
  mianownikiem, trzeba dopisać go w `ROCZNIKI_UTK` (zasoby UTK i data publikacji) i uruchomić ETL ponownie.
- **Punktualność linii, nie stacji.** Pociągi tej samej linii dają stacjom prawie identyczne liczby (np.
  Kraków Lotnisko, Olszanica, Zakliki i Młynówka: po ok. 25 834 zatrzymań i 99,1% punktualnych). Wartość mówi,
  jak kursują pociągi zatrzymujące się na stacji; nie jest oceną stacji ani gminy.
- **Zatrzymania, nie pociągi.** Jeden pociąg liczy się tyle razy, ile razy zatrzymał się na stacji. Wszyscy
  przewoźnicy pasażerscy razem; wartość nie mówi, kto jeździ ani jak często (to `kolej_kursy_szczyt_h`).
- **Zakres licznika i mianownika.** Tytuł zasobu licznika 2024 wspomina „przewozy pasażerskie i towarowe”, a
  mianownika tylko pasażerskie. Pary stacja × przewoźnik są w obu plikach identyczne (4680) i licznik nigdzie
  nie przekracza mianownika, więc zakres wygląda na ten sam; ETL zatrzyma się, gdy złamie to ponad 1% stacji.
- **Linia prosta, 3 km.** To nie droga ani czas dojścia. Adres dalej niż 3 km od kwalifikowanej stacji (głównie
  obwarzanek) nie ma wartości.
- **Bez nazwy stacji na karcie.** Etykieta z nazwą stacji dla każdego adresu ważyłaby ok. 3,5 MB (limit
  kontraktu: 2 MB), a `slownikEtykiet` nie jest rozwiązywany przez kafle kompaktu ani przez „zapytaj o adres”
  (pokazałby sam klucz). Stację i wartość dla znanych miejsc wypisuje skrypt.
- **Położenie z dopasowania nazw.** Pozycja stacji pochodzi z GTFS mkuran.pl dobranego po nazwie przez
  z-dykty, nie z rejestru stacji PKP PLK.

## Dla integratora

- Nowa warstwa `transport` bez wpisu w `persony.ts` dostaje `wagaNowych` (2 dla rodziny, singla i seniora,
  1 dla inwestora) i od razu wchodzi do wyniku. Rada: jawna waga niższa niż dla `kolej_odleglosc` i
  `kolej_kursy_szczyt_h`, bo to pomiar z 2024 r., a 39% adresów nie ma wartości.
- Warstwa nie jest jeszcze w `kompakt/`; trzeba go przebudować (`node etl/kompakt.mjs`), żeby weszła na mapę.
