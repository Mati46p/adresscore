# Pomiar JEV po polsku (#18)

> Najnowszy wynik – na zbiorze kontrolnym pisanym na ślepo – jest w sekcji
> „Druga runda (#150)” (drugi pomiar na tym zbiorze), pierwszy – w „Poprawki trafności (#147)”.
> Liczby z #18 niżej dotyczą zbioru, na którym potem stroiliśmy.

Pomiar z 2026-10-03: JEV (TypeSafe, `jev-latest`) kontra reguły słów kluczowych na złożonych,
potocznych opisach i pytaniach. Zbiory: `zbior-opisz.json` (30 opisów), `zbior-zapytaj.json`
(28 pytań). Wyniki pozycja po pozycji: `wyniki-na-zywo.json`. Skrypt: `pomiar.ts`.

> **Zastrzeżenie na start.** Zbiory wzorcowe i etykiety ułożył agent AI (Claude), a nie
> użytkownicy. Etykiety zostały zapisane i zacommitowane przed pierwszym wywołaniem JEV
> (osobny commit) i po pomiarze ich nie zmieniano. Ten sam agent zna jednak reguły i opisy
> warstw, więc zbiór może być stronniczy – w obie strony. To 30 + 28 pozycji, więc różnica
> 1 pozycji to 3–4 pp.

## Wynik nagłówkowy (pierwszy przebieg, bez żadnych zmian w kodzie)

**A – „opisz siebie”** (30 opisów, średnio 3,3 potrzeby na opis, 22 z 27 niepustych ma ≥ 3):

| | Reguły | JEV (to, co widzi użytkownik) |
|---|---|---|
| Profil trafiony | 73% | **93%** |
| Potrzeby – precyzja / pełność / F1 | 75% / 68% / 71% | **92% / 89% / 91%** |
| Opisy z ≥ 3 potrzebami: wyłapane wszystkie (z 10 z twierdzeniem) | 10 z 22 | **17 z 22** |
| Cały opis zrozumiany dokładnie (profil + komplet potrzeb) | 30% | **67%** |
| Kategorie ważne – P / R / F1 | 89% / 87% / 88% | 97% / 87% / 91% |
| Puste teksty → „nic nie zrozumiano” | 3/3 | 3/3 |
| „Komunikacja nam obojętna” → transport mało ważny | 0/1 | 1/1 |

**B – „zapytaj o adres”** (28 pytań: 17 pojedynczych, 7 złożonych, 4 spoza zakresu):

| | Reguły | JEV surowy | JEV z zapasem (to, co widzi użytkownik) |
|---|---|---|---|
| Trafna warstwa (albo „nie wiem”, gdy trzeba) | 64% | 82% | **86%** |
| Pytania pojedyncze | 8/17 | 15/17 | 14/17 |
| Pytania złożone – trafiony choć jeden temat | 6/7 | 4/7 | 6/7 |
| Spoza zakresu → „nie wiem” | 4/4 | 4/4 | 4/4 |
| Pokrycie pytań złożonych (średnio tematów na pytanie) | 38% | 29% | 40% |

**JEV – zapas, czas, pewność** (58 wywołań):

- Zapas (JEV poniżej progu, decydują reguły): A 3/30 – wyłącznie trzy puste teksty, gdzie JEV
  uczciwie powiedział „nieznany” i reguły też nic nie znalazły; na 27 prawdziwych opisach 0/27.
  B 5/28 – wszystkie z pewnością < 0,5, cztery z pięciu to pytania złożone.
- Czas odpowiedzi (pośrednik → api.typesafe.ai, z Polski): **p50 306 ms, p95 420 ms, max 451 ms**.
  Opis z 16 pytaniami (A) trwa tyle samo co jedno pytanie (B). Żadne wywołanie nie przekroczyło
  800 ms timeoutu pośrednika.
- Pewność coś znaczy: profil trafiony – średnio 0,97, chybiony – 0,71; ocena twierdzenia
  (noul) dla potrzeb, które są we wzorcu – 0,82, dla pozostałych – 0,21; warstwa trafna – 0,78,
  chybiona – 0,60.

## Po poprawce (strojenie – osobno od wyniku nagłówkowego)

Po pierwszym przebiegu zmieniłem dwie rzeczy w `src/ai/zapytajOAdres.ts` i powtórzyłem tylko
zbiór B (dwa razy):

1. Dopiski do opisów trzech warstw powodzi (`powodz_1proc` – domyślna dla „czy tu zalewa”,
   `powodz_10proc` i `powodz_02proc` – tylko gdy pytanie wprost mówi o częstej albo skrajnej
   powodzi). Przed: „Czy piwnica może zalać przy dużej wodzie?” → `powodz_1proc` z pewnością 0,49
   (pod progiem 0,5) → reguły → „nie wiem”. Po: 0,92.
2. Zdanie w poleceniu: „Jeśli pytanie dotyczy kilku rzeczy naraz, wybierz warstwę dla pierwszej
   z nich.” Przed: JEV na pytania złożone często wybierał `nie_wiem`.

| B | Przed (przebieg 1) | Po (przebieg 2) | Po (przebieg 3, powtórka) |
|---|---|---|---|
| JEV surowy | 82% | 89% | 89% |
| JEV z zapasem | 86% | 93% | 89% |
| Pytania złożone – trafiony temat (z zapasem) | 6/7 | 7/7 | 6/7 |
| Pokrycie złożonych | 40% | 45% | 40% |
| Zapas | 5/28 | 3/28 | 2/28 |
| p50 / p95 / max | 306 / 409 / 439 ms | 303 / 431 / 449 ms | 356 / 501 / 502 ms |

Koszt poprawki: dwa pytania straciły pewność JEV i przeszły na reguły – „astma, piece” (0,64 →
0,39; reguły dały `pm25_srednia`, też poprawną) i „Da się tu żyć bez samochodu? Jak często coś
jeździ?” (0,62 → 0,34; reguły dały poprawne `kursy_szczyt_h`). Wynik się nie pogorszył, ale
o „pierwszej rzeczy” w pytaniu decyduje JEV i bywa to mniej pewne. Powtórka przebiegu 2 i 3
różni się jedną pozycją (pytanie złożone z pewnością 0,49 → 0,57 wokół progu), średnia zmiana
pewności 0,02 – JEV jest w praktyce deterministyczny, więc różnice przed/po to skutek zmiany,
nie szumu.

Zbioru A nie stroiłem.

## Metoda

- Jedna pozycja = jedno wywołanie JEV tą samą ścieżką co aplikacja: klient `src/ai/jev.ts`
  (timeout 1,5 s) → pośrednik `api/_jev.js` (`obsluz`, timeout 800 ms, klucz z env) →
  api.typesafe.ai. Fetch klienta wstrzyknięty, żeby nie stawiać serwera HTTP.
- Z tej samej odpowiedzi liczone są trzy systemy: **reguły** (`zRegul` / `regula`, bez sieci),
  **JEV surowy** (A: `przetworzOdpowiedzi` bez reguł zapasowych; B: wybór JEV bez progu
  pewności) i **JEV z zapasem** (`opiszSiebie` / ścieżka `zapytajOAdres` – to, co widzi
  użytkownik). W A oba warianty JEV wyszły identyczne, bo zapas zadziałał tylko na pustych
  tekstach.
- A, potrzeby: mikro-P/R/F1 na 10 potrzebach, o które pytamy JEV (z twierdzeniem). Pięć
  potrzeb (`cisza`, `sklepy`, `bezpieczenstwo`, `inwestycja`, `singiel`) JEV z założenia
  pokrywa poziomem kategorii albo profilem, nie twierdzeniem – dlatego osobno liczone są
  „kategorie ważne” (poziom ≥ 3 vs kategorie podnoszone przez potrzeby wzorca z tabeli
  `POTRZEBY` + jawne). F1 na wszystkich 15 potrzebach: reguły 74%, JEV 77%.
- A, profil: trafiony, gdy równy `persona` albo jednemu z `persona_tez`. „Dokładnie” = profil
  trafiony, zbiór potrzeb (10) identyczny i zgodność „nic nie zrozumiano”.
- B: pytanie ma listę tematów, każdy temat to zbiór dopuszczalnych warstw. Trafienie = wybór
  w którymkolwiek temacie; spoza zakresu – tylko „nie wiem”. Pokrycie pytania złożonego =
  trafione tematy / wszystkie (najwyżej 1/n, bo aplikacja wybiera jedną warstwę).
- Lista warstw: `listaWarstw` na bieżącym `public/dane` (60 warstw, bez atrap).

Powtórzenie: `node src/ai/pomiar/pomiar.ts` (same reguły) albo
`node --env-file=.env.local src/ai/pomiar/pomiar.ts --na-zywo` (58 płatnych wywołań).

## Błędy, z których najwięcej widać

**JEV**

1. **Cudza sytuacja** (A06): „Kumpel ma trójkę dzieci i psa (…), ale to nie dla niego. Szukamy
   z partnerką dla siebie…” → profil Rodzina (0,80), dzieci 0,71, pies 0,86. JEV daje się złapać
   tak samo jak reguły.
2. **„Bez samochodu” to jego najsłabsza potrzeba** (10/14): „Nie mam samochodu” – 0,58 (tuż pod
   progiem 0,6), „No car obviously” – 0,39, „auta nie potrzebuję” – 0,21, „z dobrym dojazdem
   komunikacją” – 0,47. Twierdzenie łączy dwa warunki („nie ma samochodu **i** jeździ
   komunikacją”), więc JEV obniża ocenę, gdy tekst mówi tylko o jednym. Propozycja (niezrobiona,
   bo to strojenie A): rozbić albo zamienić „i” na „albo”.
3. **Zdrowie na granicy progu**: „syn ma alergię i astmę” → „potrzebuje lekarza blisko” 0,61,
   „kaszlę każdej zimy” → 0,60. Mylenie powietrza ze zdrowiem.
4. **Pytanie o park** (B19): „Jest gdzie wyjść z psem, jakiś skwer albo park?” → `nie_wiem`
   z pewnością 0,9. Opisy warstw zieleni są techniczne („odsetek powierzchni oczka 100 m…”),
   słowo „park” w nich nie pada. Reguły trafiają.
5. **„Opłaca się kupić pod wynajem?”** (B04) → `nie_wiem` (0,8). Wzorzec dopuszcza cenę m²
   i pozwolenia na budowę – to sporne, danych o rentowności najmu nie mamy.

**Reguły**

1. **Sygnały pośrednie przepadają**: „Mamy trzylatka i drugie w drodze” – brak dzieci;
   „Mam 74 lata” – brak seniora; „corgi”, „owczarek”, „dwoma psami” – brak psa.
2. **Wózek dziecięcy = wózek inwalidzki** (A01): „z psem i wózkiem codziennie łazimy” →
   potrzeba „lekarz blisko”.
3. **Przeczenia dalej niż o słowo**: „Komunikacja jest nam obojętna” → „bez samochodu”;
   „nie mam dzieci ani psa” → pies; „Na zieleni mi nie zależy” → zieleń; „Dzieci mamy już
   dorosłe, wyprowadziły się” → profil Rodzina.
4. **Angielski i slang**: opis studenta Erasmusa – 1 z 4 potrzeb; „szukam flipa albo czegoś pod
   airbnb” – nic nie zrozumiane.
5. **Pytania bez słowa-klucza**: „Czy piwnica może zalać?” (wzorzec zna „zalan”, nie „zalać”),
   „słońce w grudniu”, „miejskie ogrzewanie”, „pociąg do Tarnowa”, „jasno wieczorem” – „nie wiem”;
   „w nocy słychać tramwaje?” → przystanek zamiast hałasu.

## Ograniczenie: pytania o kilka rzeczy naraz

Ludzie pytają o kilka rzeczy naraz („Czy jest zielono, cicho i bezpiecznie wieczorem?”).
`zapytajOAdres` robi jeden `choice`, więc odpowiada na jeden temat: pokrycie pytań złożonych to
40–45% i z tą architekturą nie przekroczy 1/n. Tego #18 nie zmienia (wariant 1 wdrożony
w #146 – sekcja „Pytania złożone (#146)” niżej).

Propozycja (do osobnego zadania), w granicy 16 pytań pośrednika:

- **Wariant 1 – jedno wywołanie, choice + noul na tematach (polecany).** W tym samym zapytaniu
  obok `choice` (warstwa główna) do 15 twierdzeń `noul` w rodzaju „Pytanie dotyczy hałasu”,
  „…powietrza”, „…zieleni”, „…powodzi”, „…komunikacji”, „…szkół i przedszkoli” (grupy warstw).
  Każdy temat z noul ≥ 0,6 dokłada swoją domyślną warstwę (karta pokazuje do 3 odpowiedzi).
  Czas: bez zmian – w tym pomiarze zapytanie z 16 pytaniami (A) miało p50 306 ms, tyle samo co
  z jednym (B). Wywołań: nadal 1 na pytanie; jeśli TypeSafe liczy za pytania, a nie za
  wywołanie, koszt rośnie do 16×.
- **Wariant 2 – drugi choice bez pierwszego wyboru.** Drugie wywołanie z listą bez wybranej
  warstwy i z „nie_wiem” = „nic więcej”. Czas: ok. 2 × 300 ms = 600 ms p50 (sekwencyjnie),
  koszt 2× (3× dla trzech tematów). Prostsze, ale wolniejsze.
- **Wariant 3 – choice, potem noul na krótkiej liście.** Pierwsze wywołanie wybiera warstwę,
  drugie ocenia twierdzeniami 8–15 kandydatów (z reguł + sąsiedzi w kategorii). 2 wywołania,
  ok. 600 ms – lepiej celuje niż wariant 2, ale też podwaja czas.

## Pytania złożone (#146)

Wariant 1 z sekcji wyżej, wdrożony 2026-10-03: w tym samym wywołaniu JEV obok `choice`
(warstwa główna) 15 twierdzeń `noul`, po jednym na temat (`TEMATY` w `zapytajOAdres.ts`:
hałas, powietrze, zieleń, powódź, komunikacja, szkoły i przedszkola, zdrowie, sklepy i usługi,
ceny mieszkań, bezpieczeństwo, parkowanie, rower, demografia, plan i inwestycje, przemysł
i grunt) – razem 16 pytań, limit pośrednika. Temat z noul ≥ 0,6 dokłada jedną warstwę ze swojej
grupy (wskazaną przez reguły słów kluczowych, a bez nich domyślną), chyba że warstwa główna już
w niego trafiła. Karta pokazuje do 3 odpowiedzi: główna, potem tematy malejąco po noul, bez
duplikatów i najwyżej jedna warstwa na temat. Pewne `nie_wiem` → „nie wiem” bez dodatków.
Reguła zapasowa zbiera wszystkie pasujące grupy reguł, jedną na temat, w kolejności w pytaniu.

Ten sam zbiór B (28 pytań), dwa przebiegi na żywo na tej samej liście warstw (84, nie 60 jak
w #18 – dlatego „przed” powtórzone, a nie wzięte z tabel wyżej): **przed** = `main` przed
zmianą, **po** = ta zmiana. Pokrycie złożonych = średnio, jaka część tematów pytania dostała
warstwę z wzorca. Precyzja = pokazane warstwy, które są w którymś temacie wzorca, do wszystkich
pokazanych (pytania w zakresie).

| B, JEV z zapasem (to, co widzi użytkownik) | Przed | Po |
|---|---|---|
| **Pokrycie pytań złożonych** | 40% | **74%** |
| Złożone z kompletem tematów | 0/7 | 3/7 |
| Pytania pojedyncze – warstwa główna trafna | 14/17 | 16/17 |
| Spoza zakresu → „nie wiem” bez dodatkowych warstw | 4/4 | 4/4 |
| Precyzja warstw | 91% (20/22) | 85% (28/33) |
| Fałszywe dodatki na pytaniach pojedynczych | – | 2 na 17 pytań |
| Średnio warstw na odpowiedź (w zakresie) | 0,92 | 1,38 |
| Zapas (JEV pod progiem pewności → reguły) | 3/28 | 4/28 |
| Opóźnienie p50 / p95 / max | 288 / 398 / 458 ms | 308 / 409 / 445 ms |

| B, reguły (bez AI) | Przed | Po |
|---|---|---|
| Pokrycie pytań złożonych | 38% | 79% |
| Złożone z kompletem tematów | 0/7 | 4/7 |
| Pytania pojedyncze | 8/17 | 9/17 |
| Spoza zakresu → „nie wiem” | 4/4 | 4/4 |
| Precyzja warstw | 82% | 88% |

Jak to czytać – uczciwie:

- **Pojedyncze 14 → 16 to nie zasługa tej zmiany.** Obie różnice to pewność wyboru głównego
  tuż przy progu 0,5: B02 („w nocy słychać tramwaje”) 0,48 → 0,50 – przeszedł JEV z trafnym
  hałasem zamiast reguły z przystankiem; B19 („skwer albo park”) `nie_wiem` 0,53 → 0,46 – spadł
  do reguły, która trafia zieleń. Wniosek, którego wymaga zadanie: pojedyncze nie tracą.
  Pewność `choice` z 15 dodatkowymi pytaniami w tym samym zapytaniu jest średnio o ok. 0,02
  niższa (największy spadek: B05 0,84 → 0,74, B23 0,59 → 0,49).
- **Fałszywe dodatki (2 na 17 pojedynczych):** B02 „słychać tramwaje” dokłada komunikację
  (0,93), B13 „wjadę dieslem” dokłada powietrze (0,79). Na złożonych: B26 „apteka i przychodnia”
  dokłada sklep (0,89), B28 „bezpiecznie rowerem” dokłada miejscowe zagrożenia (0,78). To błędy
  znaczenia, nie szum – JEV jest ich pewny.
- **Sufit z definicji tematów:** B24 (przedszkole + żłobek), B26 (apteka + przychodnia) i B28
  (trasa rowerowa + stojaki) pytają o dwie warstwy z jednego tematu, a temat dokłada najwyżej
  jedną – te trzy mają z góry pokrycie ≤ 50%. B27 trafia hałas i drzewa, ale warstwą główną jest
  `przewietrzanie_klasa` (grupa „powietrze”, spoza wzorca), więc powietrze się nie liczy.
- **B23 poszło regułami:** pewność `choice` 0,49 → zapas; reguły też dały komplet 3/3. Oceny
  tematów JEV z tego wywołania przepadają razem z wyborem głównym – możliwa poprawka na później.
- **Reguły:** dodane wzorce dla tematów, które nie miały żadnej reguły (rower, stojaki, policja,
  osuwiska, azbest) – bez nich zapas nie umiał dołożyć ich warstwy. Spośród nich tylko rower
  i stojaki dotyczą zbioru (B28: 6/7 → 7/7 złożonych z trafionym tematem w regule pojedynczej).
  Znanych pomyłek reguł z #18 („zalać”, „słońce”, „ogrzewanie”, „pociąg”) celowo nie poprawiałem,
  żeby nie stroić pod zbiór.

**Próg 0,6** – ten sam co `PROG_POTRZEBY` w „opisz siebie”: w #18 noul dla potrzeb z wzorca miał
średnio 0,82, dla pozostałych 0,21. Po przebiegu przeliczyłem progi z tych samych odpowiedzi
(bez nowych wywołań):

| próg | 0,5 | 0,6 | 0,7 | 0,8 | 0,9 |
|---|---|---|---|---|---|
| Pokrycie złożonych | 74% | 74% | 74% | 74% | 74% |
| Precyzja warstw | 82% | 85% | 85% | 90% | 93% |
| Fałszywe dodatki na pojedynczych | 2 | 2 | 2 | 1 | 1 |

Na tym zbiorze 0,8 dałby lepszą precyzję bez straty pokrycia, ale prawdziwy temat potrafi mieć
0,68 (zieleń w B23), a fałszywe dodatki mają 0,78–0,93 – próg ich nie odróżnia, a 7 pytań
złożonych to za mało, żeby stroić. **Zostawiony 0,6, nie stroiłem po wynikach.**

Koszt: 1 wywołanie na pytanie jak dotąd (16 pytań w jednym zapytaniu); czas +20 ms p50, w granicy
powtórzeń z #18. Pomiar: 56 płatnych wywołań (28 przed + 28 po).
Powtórzenie: `node --env-file=.env.local src/ai/pomiar/pomiar.ts --na-zywo --tylko b`
(sekcja „pytania złożone” i przeliczenie progów są w wyniku skryptu).

## Poprawki trafności (#147)

Pomiar z 2026-10-03. Trzy poprawki z błędów #18 i #146 i – przede wszystkim – **pierwszy pomiar
na zbiorze, którego nie znał nikt, kto stroił aplikację**.

> **Zastrzeżenie.** Zbiór kontrolny (`kontrolny-opisz.json`, 30 opisów; `kontrolny-zapytaj.json`,
> 25 pytań) napisał na ślepo **inny agent AI** – bez dostępu do kodu, promptów, reguł i starych
> zbiorów; dostał tylko listy id (potrzeby, profile, warstwy). To nadal AI, nie ludzie. Pliki
> weszły do repo osobnym commitem przed jakąkolwiek zmianą kodu i są bajt w bajt takie, jak
> je napisał (`src/ai/pomiar/biome.json` wyłącza je z formatowania). Etykiet nie zmieniałem.
> Stroiłem **wyłącznie na starych zbiorach** (`zbior-*.json`) – te liczby są więc optymistyczne.
> Zbioru kontrolnego w czasie strojenia nie czytałem (ani tekstów, ani wyników pozycja po
> pozycji; `pomiar.ts --zbior kontrolny` drukuje same sumy). Przebiegi na nim były dwa:
> przed zmianą (na `main`) i raz po – ten drugi to wynik nagłówkowy, po nim nic nie zmieniałem.

### Co się zmieniło

1. **Twierdzenia bez „i”.** `bez_samochodu`: „Osoba nie ma samochodu i jeździ komunikacją
   miejską” → „Osoba nie ma samochodu”. Pozostałe twierdzenia potrzeb nie łączyły dwóch warunków.
   Próbowałem je też zaostrzyć (dzieci, pies, praca w centrum, lekarz, opis profilu „nieznany”)
   – na starym zbiorze A „dokładnie” spadło z 67% do 50%, więc wróciły do brzmienia z #16
   (pośredni przebieg w tabeli niżej). Wersja „obywa się bez samochodu” łapała za dużo
   (rowerzyści, seniorzy) – zostało najprostsze zdanie.
2. **Potoczne słowa w opisach warstw** (`DOPISKI_WARSTW`): park, skwer, smog, dym z pieców,
   korki, piwnica, „słychać tramwaje”, recepta/leki, Żabka, miejskie ogrzewanie…
3. **Ostrzejsze tematy** (`TEMATY`): „Użytkownik chce się dowiedzieć, jak stąd dojechać
   komunikacją…” zamiast „Pytanie (choćby w części) dotyczy komunikacji, tramwajów…”, z jawnymi
   wykluczeniami czterech znanych fałszywych dodatków (hałas tramwajów ≠ komunikacja, apteka ≠
   sklep, przepisy dla diesli ≠ powietrze, bezpieczeństwo jazdy rowerem ≠ zagrożenia).
4. **Cudza sytuacja.** W tym samym wywołaniu JEV ocenia „Osoba opisuje własną obecną sytuację
   i swoje potrzeby (nie cudzą, nie hipotetyczną, nie przeszłą)”. Poniżej 0,5: profil zostaje bez
   zmian, poziomy kategorii przepadają, zostają tylko potrzeby z noul ≥ 0,9; pusty wynik to
   „nic nie zrozumiano” od JEV, a nie zapas na reguły (reguły złapałyby słowa z cudzej sytuacji).
5. **Wolne miejsce w limicie 16 pytań: „Przyszłość okolicy”.** Było 1 profil + 5 kategorii + 10
   potrzeb. Usunąłem pytanie o poziom kategorii `przyszlosc`, bo w #18 JEV odszedł od środka
   skali tylko w 2 z 30 opisów, a jeden z nich i tak był inwestorem. Tę kategorię niesie teraz
   profil Inwestor: gdy JEV go wybierze, dochodzi potrzeba `inwestycja` z tabeli `POTRZEBY`
   (przyszłość 4, wskaźniki inwestycji) – liczby z tabeli, nie od JEV. Scalanie dwóch potrzeb
   odrzuciłem: zepsułoby porównanie z wzorcem pozycja po pozycji i chip „zrozumiałem”.
   Koszt: tekst w rodzaju „żeby okolica się rozwijała” bez profilu Inwestor nie podnosi już
   kategorii (w starym A tak było w 1 opisie – kategorie R 87% → 88%, bez straty).
6. **Dwie warstwy z jednego tematu.** Tematy z różnymi obiektami (szkoły, zdrowie, sklepy,
   rower – pole `obiekty`) dokładają drugą warstwę, gdy reguły słów kluczowych trafiają w pytaniu
   inny obiekt niż pierwsza warstwa (przedszkole + żłobek, apteka + przychodnia, trasa + stojaki).
   Bez dodatkowego wywołania JEV, tylko w wolne miejsca (różne tematy mają pierwszeństwo),
   najwyżej 3, bez duplikatów; ta sama zasada w regule zapasowej. Przy okazji `/szkol/` →
   `/\bszkol/`, bo „przedszkola” trafiało też szkołę.

### Wynik nagłówkowy – zbiór kontrolny (na ślepo)

**A – „opisz siebie”** (30 opisów):

| | Reguły przed | Reguły po | JEV przed | **JEV po** |
|---|---|---|---|---|
| Profil trafiony | 57% | 57% | 57% | **63%** |
| Potrzeby (10 z twierdzeniem) – P / R / F1 | 59 / 49 / 53% | 59 / 49 / 53% | 74 / 83 / 78% | **69 / 88 / 77%** |
| Potrzeby – F1 na wszystkich 15 | 54% | 54% | 65% | **67%** |
| Kategorie ważne – P / R / F1 | 71 / 65 / 68% | 71 / 65 / 68% | 79 / 71 / 75% | **75 / 83 / 79%** |
| Cały opis zrozumiany dokładnie | 20% | 20% | 40% | **37%** |
| Puste teksty → „nic nie zrozumiano” | 2/2 | 2/2 | 2/2 | 2/2 |

**B – „zapytaj o adres”** (25 pytań: 15 pojedynczych, 7 złożonych, 3 spoza zakresu):

| | Reguły przed | Reguły po | JEV przed | **JEV po** |
|---|---|---|---|---|
| Trafna warstwa główna (albo „nie wiem”) | 64% | 64% | 84% | **92%** |
| Pytania pojedyncze – warstwa główna trafna | 6/15 | 6/15 | 12/15 | **14/15** |
| Pokrycie pytań złożonych | 67% | 67% | 60% | **52%** |
| Złożone z kompletem tematów | 2/7 | 2/7 | 2/7 | **1/7** |
| Spoza zakresu → „nie wiem” bez dodatków | 3/3 | 3/3 | 3/3 | 3/3 |
| Precyzja warstw | 94% | 89% | 88% | **92%** |
| Fałszywe dodatki na pojedynczych (pytań) | 0 | 1 | 2 | 2 |
| Zapas (JEV pod progiem → reguły) | – | – | 2/25 | 1/25 |

JEV = to, co widzi użytkownik (JEV z zapasem). Reguły „opisz siebie” się nie zmieniły, stąd
te same liczby.

Jak to czytać – uczciwie:

- **Na zbiorze kontrolnym liczby są wyraźnie niższe niż w #18.** „Dokładnie” 37% zamiast 67–73%,
  profil 63% zamiast 90–93%. Część to stronniczość starego zbioru (pisał go agent, który znał
  reguły i opisy), część to inna konwencja etykiet: autor zbioru kontrolnego daje profil `null`
  każdej parze bez dzieci i każdemu, kto nie mówi wprost o profilu, a aplikacja nie ma profilu
  „para”, więc JEV wybiera Singla. Reguły też spadają (dokładnie 30% → 20%, profil 73% → 57%).
- **Poprawki pomagają głównie w „zapytaj o adres”:** warstwa główna 84% → 92% (pojedyncze
  12 → 14 z 15), precyzja 88% → 92%. „Opisz siebie”: pełność potrzeb 83% → 88% i kategorie
  F1 75% → 79%, ale precyzja potrzeb 74% → 69% (nowe twierdzenie „nie ma samochodu” trafia
  częściej, także fałszywie: 6 z 30 opisów, z tego 4 nowe) i „dokładnie” o 1 opis mniej
  (40% → 37%).
- **Pytania złożone na zbiorze kontrolnym są gorsze: pokrycie 60% → 52%** (jedno pytanie:
  „lekarz rodzinny i jakiś spożywczak” – temat sklepów 0,96 → 0,56, pod progiem 0,6).
  Ostrzejsze tematy obniżają noul także tematom prawdziwym (np. „czy wieczorem nie jest
  ciemno” – bezpieczeństwo 0,80 → 0,38; tu bez skutku, bo warstwa główna i tak była „nie
  wiem”). Na starym zbiorze to samo przykryła druga warstwa z tematu (B24, B26, B28 – akurat te
  pytania, które ją motywowały).
- **Fałszywe dodatki na pojedynczych: dalej 2 na 15, ale inne.** Zniknęły „recepta” → sklep
  i „przypiąć rower” → oświetlenie. Doszły „przypiąć rower” → trasa rowerowa (słowo „rower”
  trafia regułę trasy – wada nowej drugiej warstwy) i „z psem do weta” → zieleń 0,71
  (prawdopodobnie przez nowy dopisek zieleni „gdzie wyjść … z psem”).
- **Bramka „własna sytuacja” działa, ale nie zawsze tak, jak chcemy:** „pytam w imieniu siostry,
  … ja mam dzieci” – profil bez zmian (przed: Singiel + dzieci + praca w centrum). Ale „mama
  z nami zamieszka, 84 lata” też spadło pod próg (0,18) – profil Senior przepadł, potrzeby
  senior i lekarz zostały. Na starym zbiorze poniżej progu był tylko 1 z 30 opisów.

**Etykiety, które uważam za sporne** (nie zmieniłem żadnej): K-A11 i K-A20 mają potrzebę
`singiel`, a profil `null` (w aplikacji potrzeba `singiel` ustawia profil Singiel); K-A17 to
samo z `senior`; K-A29 („kupuję dla córki na studia … albo wynajmę”) – Inwestor jest sporny;
K-A19 („dojazd na Grzegórzki”) – `praca_centrum`, choć Grzegórzki to nie centrum w rozumieniu
starego zbioru. Zbiór B wygląda poprawnie.

### Stare zbiory (do strojenia) – przed i po

A „przed” to przebieg 1 z #18 (to samo zapytanie co na `main`, kod „opisz siebie” od #18 się
nie zmienił – bez nowych wywołań). B „przed” powtórzone teraz na `main`, bo lista warstw urosła
(86 plików, w tym atrapy).

| A, JEV | Przed (#18) | Pośrednio (wszystkie twierdzenia zaostrzone) | **Po** |
|---|---|---|---|
| Profil | 93% | 90% | **93%** |
| Potrzeby P / R / F1 | 92 / 89 / 91% | 83 / 89 / 86% | **91 / 94 / 93%** |
| Potrzeby F1 (wszystkie 15) | 77% | 75% | **80%** |
| Kategorie P / R / F1 | 97 / 87 / 91% | 92 / 88 / 90% | **97 / 88 / 92%** |
| Dokładnie | 67% | 50% | **73%** |

| B | Reguły przed | Reguły po | JEV przed | **JEV po** |
|---|---|---|---|---|
| Trafna warstwa główna | 68% | 68% | 89% | **96%** |
| Pojedyncze (warstwa główna) | 9/17 | 9/17 | 15/17 | **16/17** |
| Pokrycie złożonych | 79% | 100% | 74% | **76%** |
| Złożone w komplecie | 4/7 | 7/7 | 3/7 | **4/7** |
| Precyzja warstw | 88% | 89% | 84% | **100%** |
| Fałszywe dodatki na pojedynczych | 1 | 1 | 1 | **0** |
| Zapas | – | – | 6/28 | 1/28 |

Na starym zbiorze wszystko rośnie – na nim stroiłem, więc to nie jest dowód. Reguły złożone
dochodzą do 100%, bo druga warstwa z tematu trafia dokładnie w trzy pytania, które ją
motywowały.

### Opóźnienie (p50 / p95 / max, pośrednik → api.typesafe.ai)

| Przebieg | A (16 pytań w zapytaniu) | B (16 pytań) | Razem |
|---|---|---|---|
| Kontrolny przed | 271 / 412 / 713 ms | 308 / 408 / 412 ms | 302 / 412 / 713 ms |
| Kontrolny po | 281 / 387 / 511 ms | 309 / 440 / 455 ms | 306 / 440 / 511 ms |
| Stary B przed | – | 329 / 409 / 413 ms | – |
| Stary A + B po | 267 / 327 / 395 ms | 321 / 411 / 411 ms | 297 / 410 / 411 ms |
| Stary A po (końcowy) | 275 / 392 / 438 ms | – | – |

Bez zmian: nadal jedno wywołanie na tekst, ok. 0,3 s, żadne nie przekroczyło 800 ms.

### Wywołania na żywo

**226 płatnych wywołań**: kontrolny przed 55, stary B przed 28, stary A + B po pierwszej wersji
58, stary A po wycofaniu zaostrzeń 30, kontrolny po 55. Budżet zadania to ok. 220 – przekroczony
o 6, bo pośredni przebieg A wypadł źle i trzeba było zmierzyć wersję końcową.

Powtórzenie: `node --env-file=.env.local src/ai/pomiar/pomiar.ts --na-zywo --zbior kontrolny`
(55 wywołań) i bez `--zbior` dla starych zbiorów (58).

## Druga runda (#150)

Pomiar z 2026-10-03. Cztery poprawki znanych wad z #147. Strojenie wyłącznie na starych
zbiorach i własnych, celowanych zdaniach; zbiór kontrolny zmierzony **raz**, na końcu.

> **To drugi pomiar na zbiorze kontrolnym.** Ten zbiór już raz wpłynął na decyzję: wady, które
> tu poprawiam („mama z nami zamieszka”, „przypiąć rower”, „z psem do weta”, spadek pokrycia
> złożonych), znamy z jego wyniku w #147. Dlatego liczby „po #150” są lekko optymistyczne –
> zbiór nie jest już świeży. W czasie strojenia czytałem tylko liczby zbiorcze, z jednym
> wyjątkiem: wyszukiwanie słowa „przypi” w `src/ai` wypisało mimochodem dwie linie pliku
> kontrolnego (tekst pytania o stojaki, które i tak opisuje #147, i jedną etykietę z weterynarzem).
> Reguła dla roweru była już wtedy zaprojektowana; nie zmieniałem jej pod to brzmienie.

### Co się zmieniło

1. **Bramka „własna sytuacja” – nowe brzmienie, ten sam próg 0,5, bez łagodzenia.** Było:
   „Osoba opisuje własną obecną sytuację i swoje potrzeby (nie cudzą, nie hipotetyczną, nie
   przeszłą)”. Jest: „Tekst opisuje, czego szuka sama osoba pisząca (dla siebie, swojej rodziny
   albo jako inwestor), a nie znajomy ani wyobrażona lub dawna sytuacja.” Rozważyłem trzy drogi
   z zadania. Dowody to oceny noul na celowanych zdaniach i opisach ze starego A (kilka brzmień
   w jednym wywołaniu):

   | Tekst | #147 | tylko domownicy¹ | **#150** |
   |---|---|---|---|
   | teść od przyszłego miesiąca mieszka z nami | 0,58–0,66 | 0,95 | **0,92** |
   | będziemy mieć dziecko w marcu | 0,94 | 0,89 | **0,95** |
   | A12 – mieszkanie pod wynajem, „sam tam mieszkać nie będę” | 0,92 | 0,29 | **0,94** |
   | A23 – flip / airbnb | 0,86 | 0,54 | **0,94** |
   | A09 – relokacja, angielskie wtrącenia | 0,97 | 0,81 | **0,92** |
   | A27 – żona chce las, ja biuro | 0,92 | 0,93 | **0,93** |
   | pytam dla koleżanki (dzieci i pies) | 0,05 | 0,14 | **0,04** |
   | „gdybym kiedyś miał psa” | 0,19–0,21 | 0,24 | **0,13** |
   | „kiedyś mieszkaliśmy z dziećmi, to nieaktualne” | 0,55–0,56 | 0,29 | **0,16** |

   ¹ „Opisane potrzeby dotyczą osoby piszącej i ludzi, z którymi mieszka lub zamieszka…” –
   naprawiało domowników, ale odcinało inwestora. Stare A10 („Mama z nami zamieszka, ma 82
   lata”) miało w brzmieniu z #147 0,88. Fałszywego alarmu z kontrolnego (0,18) nie odtworzyłem
   dosłownie, ale teść w tej samej konstrukcji siedział tuż przy progu.
   - **Niższy próg – odrzucony:** dawna sytuacja miała w starym brzmieniu 0,55, a domownik 0,58.
     Progu, który rozdziela te dwa przypadki, nie ma.
   - **Łagodniejsza bramka (profil zostaje przy bardzo pewnym wyborze) – odrzucona:** przy
     „Pytam dla koleżanki: ona ma dwójkę dzieci i psa” JEV wybiera Rodzinę z pewnością **1,00**
     przy bramce 0,11, więc pewność profilu nie odróżnia cudzej sytuacji od własnej. Próg potrzeb
     pod bramką zostaje 0,9 (pies koleżanki miał 0,92; 0,8 przepuszczałoby więcej).
   - Znane ograniczenie: tekst mieszany („Kumpel ma trójkę dzieci i psa… Szukamy z partnerką dla
     siebie”, stare A06) ma wysoką ocenę w każdym brzmieniu (0,83–0,87), bo bramka ocenia cały
     tekst, a nie pojedyncze zdanie.
2. **Tematy pytań złożonych.** Siedem twierdzeń (hałas, powietrze, zieleń, komunikacja, sklepy,
   bezpieczeństwo, rower) wraca do formy „Pytanie (choćby w części) dotyczy …”. Wykluczenia
   znanych fałszywych dodatków zostają, zawężone do „pytanie **wyłącznie** o …” (hałas tramwajów,
   aptekę albo lekarza, przepisy dla aut, bezpieczną jazdę rowerem). Zdrowie, szkoły, powódź,
   ceny, parkowanie, demografia, plan i przemysł zostają bez zmian, bo nie sprawdzałem ich na
   żywo. `PROG_TEMATU` zostaje 0,6. Oceny noul na starym B (oba brzmienia w jednym wywołaniu):

   | Pytanie | Temat | #147 | **#150** |
   |---|---|---|---|
   | B02 „słychać tramwaje” – fałszywy dodatek | komunikacja | 0,09 | **0,07** |
   | B13 „wjadę dieslem” – fałszywy dodatek | powietrze | 0,20 | **0,17** |
   | B26 „apteka i przychodnia” – fałszywy dodatek | sklepy | 0,24 | **0,13** |
   | B28 „bezpiecznie rowerem” – fałszywy dodatek | bezpieczeństwo | 0,25 | **0,33** |
   | B22 „jak głośno i daleko do tramwaju” | hałas / komunikacja | 0,77 / 0,34 | **0,94 / 0,56** |
   | B23 „zielono, cicho i bezpiecznie wieczorem” | zieleń / hałas / bezpieczeństwo | 0,56 / 0,57 / 0,47 | **0,56 / 0,90 / 0,91** |
   | B27 „powietrze, hałas, drzewa” | powietrze / hałas / zieleń | 0,71 / 0,84 / 0,88 | **0,91 / 0,95 / 0,94** |
   | B28 „rowerem … przypiąć” | rower | 0,87 | **0,98** |
   | własne: „Biedronka i paczkomat? I apteka?” | sklepy | 0,69 | **0,91** |
   | własne: „najbliższy weterynarz? Mam psa.” | zieleń | 0,06 | **0,03** |

   Wszystkie cztery znane fałszywe dodatki zostają pod progiem. Hałas i bezpieczeństwo w B23
   wracają nad próg; komunikacja w B22 rośnie, ale zostaje pod nim.
3. **„przypiąć rower” → `stojaki_300m`, bez trasy rowerowej.** Reguły mają teraz pole `ogolne`
   na słowa samego tematu („rower”). Liczą się one do wyboru warstwy, ale nie nazywają osobnego
   obiektu. Druga warstwa z tematu (#147) wchodzi tylko wtedy, gdy pytanie nazywa jej obiekt
   wprost; trasę nazywają słowa „rowerem”, „na rowerze”, „ścieżka” i „trasa”. „Dojadę rowerem …
   i gdzie go przypiąć?” dalej daje obie warstwy (B28 bez zmian).
4. **„z psem do weta” bez zieleni.** Dopisek warstwy zieleni mówi o psie tylko przy spacerze
   („gdzie wyjść na spacer albo pobiegać, także na spacer z psem”), a twierdzenie tematu zieleni
   kończy się zdaniem „Samo posiadanie psa to nie to.”

Limit 16 pytań bez zmian (A: profil + 4 kategorie + 10 potrzeb + własna sytuacja; B: choice
+ 15 tematów).

### Wynik – zbiór kontrolny, drugi pomiar

**A – „opisz siebie”** (30 opisów), JEV = to, co widzi użytkownik:

| | Reguły | JEV po #147 | **JEV po #150** |
|---|---|---|---|
| Profil trafiony | 57% | 63% | **70%** |
| Potrzeby (10 z twierdzeniem) – P / R / F1 | 59 / 49 / 53% | 69 / 88 / 77% | **76 / 71 / 73%** |
| Potrzeby – F1 na wszystkich 15 | 54% | 67% | **63%** |
| Kategorie ważne – P / R / F1 | 71 / 65 / 68% | 75 / 83 / 79% | **80 / 77 / 78%** |
| Cały opis zrozumiany dokładnie | 20% | 37% | **37%** |
| Puste teksty → „nic nie zrozumiano” | 2/2 | 2/2 | 2/2 |
| Bramka „własna sytuacja” poniżej 0,5 | – | nie zapisano | **10 z 30** |

**B – „zapytaj o adres”** (25 pytań: 15 pojedynczych, 7 złożonych, 3 spoza zakresu):

| | Reguły po #147 | Reguły po #150 | JEV po #147 | **JEV po #150** |
|---|---|---|---|---|
| Trafna warstwa główna (albo „nie wiem”) | 64% | 64% | 92% | **88%** |
| Pytania pojedyncze – warstwa główna trafna | 6/15 | 6/15 | 14/15 | **13/15** |
| Pokrycie pytań złożonych | 67% | 67% | 52% | **52%** |
| Złożone z kompletem tematów | 2/7 | 2/7 | 1/7 | **1/7** |
| Spoza zakresu → „nie wiem” bez dodatków | 3/3 | 3/3 | 3/3 | 3/3 |
| Precyzja warstw | 89% | 94% | 92% | **88%** |
| Fałszywe dodatki na pojedynczych (pytań) | 1 | 0 | 2 | **3** |
| Zapas (JEV pod progiem → reguły) | – | – | 1/25 | **3/25** |

Jak to czytać – wprost:

- **Druga runda nie poprawiła wyniku na zbiorze kontrolnym.** „Dokładnie” bez zmian (37%),
  pokrycie pytań złożonych bez zmian (52%), warstwa główna gorsza o jedno pytanie (92% → 88%),
  fałszywe dodatki 2 → 3. Na starych zbiorach i celowanych zdaniach poprawki działały (tabele
  wyżej), ale na zbiorze pisanym przez kogoś innego to się nie przenosi. Różnice w B to
  pojedyncze pytania (1 pytanie = 4 pp).
- **Nowa bramka jest za ostra w pełnym zapytaniu:** odcina 10 z 30 opisów kontrolnych (średnia
  ocena 0,61). Profil (63% → 70%) i precyzja potrzeb (69% → 76%) rosną, ale pełność potrzeb
  spada z 88% do 71%. Na celowanych zdaniach własne opisy miały 0,92–0,95, ale tam twierdzenie
  stało obok kilku innych brzmień, a nie w pełnym zapytaniu z 16 pytaniami, i teksty były inne.
  Możliwa przyczyna (niesprawdzona): „sama osoba pisząca” bywa czytane jako „osoba sama, bez
  rodziny”.
- **Zapas B 1 → 3:** pewność wyboru głównego (`choice`, którego nie zmieniałem) spadła pod 0,5
  w trzech pytaniach. Zmienione twierdzenia tematów w tym samym zapytaniu przesuwają pewność
  wyboru – to samo zjawisko co w #146. W tych pytaniach odpowiadają reguły.
- **Reguły B:** precyzja 89% → 94% i 1 → 0 fałszywych dodatków. To „przypiąć rower” bez trasy
  (zmiana deterministyczna, poprawka 3). Pokrycie się nie zmieniło.
- **Przeliczenie progu tematu z tych samych odpowiedzi:** 0,5 nie zwiększa pokrycia (52%) i dokłada
  fałszywy dodatek; 0,7 daje to samo pokrycie przy precyzji 95% i 1 fałszywym dodatku. Progu nie
  zmieniłem, bo byłoby to strojenie na zbiorze kontrolnym.
- **Po tym pomiarze nic w kodzie nie zmieniłem.** Powrót bramki do brzmienia z #147 byłby wyborem
  na podstawie zbioru kontrolnego, więc zostawiam go jako osobną decyzję.

### Stare zbiory (do strojenia) – przed i po

Pełnego przebiegu JEV na starych zbiorach **nie powtórzyłem**: budżet 90 wywołań nie mieścił
58 wywołań na stare zbiory obok 55 na kontrolny. Na starych zbiorach mam tylko oceny noul
z tabel wyżej (pytania B02, B13, B22–B28; opisy A09, A12, A23, A27, a w brzmieniach pośrednich
także A06, A07, A10), zebrane celowanymi wywołaniami. „Przed” dla JEV to liczby „po” z #147.

| | Przed (po #147) | Po (#150) |
|---|---|---|
| A, JEV: dokładnie | 73% | nie mierzono |
| B, JEV: trafna warstwa główna / pokrycie złożonych / precyzja | 96% / 76% / 100% | nie mierzono |
| A, reguły: profil / potrzeby F1 / dokładnie | 73% / 71% / 30% | 73% / 71% / 30% |
| B, reguły: trafność / pokrycie złożonych / precyzja / fałszywe dodatki | 68% / 100% / 89% / 1 | 68% / 100% / 89% / 1 |

### Opóźnienie (p50 / p95 / max, pośrednik → api.typesafe.ai)

| Przebieg | A | B | Razem |
|---|---|---|---|
| Kontrolny po #147 | 281 / 387 / 511 ms | 309 / 440 / 455 ms | 306 / 440 / 511 ms |
| Kontrolny po #150 | 272 / 402 / 461 ms | 323 / 412 / 427 ms | 306 / 412 / 461 ms |

Bez zmian: jedno wywołanie na tekst, ok. 0,3 s.

### Wywołania na żywo

**90 płatnych wywołań** (budżet 90): strojenie 35, kontrolny 55. Na strojenie poszło: bramka
9 + 6 + 4 + 5 zdań (kilka brzmień w jednym wywołaniu) i tematy – 11 pytań (stare i nowe
twierdzenia obok siebie w jednym wywołaniu).

## Na slajd

Liczby ze zbioru kontrolnego, pisanego na ślepo przez osobnego agenta AI. Po #150 to **drugi
pomiar** na tym zbiorze (wady poprawiane w #150 znaliśmy z pierwszego), więc liczby są lekko
optymistyczne. Zdania z #18 (67%, 9 z 10, 93%, 86%) dotyczyły zbioru, na którym stroiliśmy,
i na slajd się nie nadają. Zdanie z #147 „prawie 9 z 10 potrzeb” po #150 nie jest już prawdziwe
(pełność 71%), więc je zastąpiłem.

- Na opisach, których nie widział nikt, kto stroił aplikację, JEV wyłapuje 7 z 10 wymienionych
  potrzeb, a reguły słów kluczowych – 5 z 10.
- Cały opis (profil i komplet potrzeb) JEV rozumie dokładnie w 37% przypadków, reguły w 20% –
  złożone, potoczne opisy są trudne dla obu.
- Na pytanie o adres JEV wskazuje właściwe dane w 88% przypadków (reguły 64%) i odpowiada
  w 0,3 sekundy.
