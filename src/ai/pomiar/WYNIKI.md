# Pomiar JEV po polsku (#18)

> **Najnowszy wynik jest w sekcji „Duża walidacja (#170)”.** To **zbiór kontrolny nr 6**
> (150 opisów i 150 pytań, pisany na ślepo, mierzony raz) z 95% przedziałami ufności. Ta sama
> sekcja zawiera też osobne przebiegi zbioru nr 5 przed i po #163 oraz A/A i opóźnienie na
> końcowym zapytaniu. Zdania „Na slajd” pochodzą ze zbioru nr 6. Przed i po na zbiorze nr 5
> (wspólne zapytanie) opisuje sekcja „Opisy strukturalne (#163)”. Runda #154–#156 na zbiorze nr 4 i test A/A (szum JEV na
> przypiętym modelu) są w sekcji „Pomiar rundy (#154–#157)”. Zbiór nr 3 mierzyliśmy w „Trzy błędy (#153)”, nr 2 w „Wersja końcowa (#152)”,
> a nr 1 w „Poprawki trafności (#147)” i „Druga runda (#150)”. Liczby z #18 niżej dotyczą zbioru,
> na którym potem stroiliśmy.

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

## Wersja końcowa (#152)

Składamy najlepsze części z #147 i #150 – każdą wybraną na podstawie zbioru kontrolnego nr 1 –
i mierzymy je raz na **nowym zbiorze kontrolnym nr 2** (`kontrolny2-opisz.json`, 30 opisów;
`kontrolny2-zapytaj.json`, 25 pytań: 15 pojedynczych, 7 złożonych, 3 spoza zakresu). Zbiór nr 2
napisał na ślepo osobny agent AI, bez dostępu do kodu, poleceń, opisów warstw dla JEV i zbioru
nr 1. Wszedł do repo bajt w bajt osobnym commitem, zanim zmieniłem kod; etykiet nie ruszałem,
tekstów nie czytałem. Nic tu nie stroiłem: jedyny przebieg na żywo to końcowy pomiar zbioru nr 2.

### Wybór części – z dowodami (zbiór kontrolny nr 1)

| Część | Wersja | Dowód (kontrolny nr 1) |
|---|---|---|
| „Opisz siebie”: twierdzenia potrzeb, brzmienie bramki „własna sytuacja”, progi | **#147** (`5a8e872`) | Bramka z #150 odcinała 10 z 30 opisów; pełność potrzeb 88% → 71%, F1 77% → 73%; „dokładnie” 37% w obu |
| „Zapytaj o adres”, części dla JEV: twierdzenia `TEMATY`, `DOPISKI_WARSTW`, polecenie | **#147** | Z #150 warstwa główna 92% → 88%, precyzja 92% → 88%, zapas 1 → 3, fałszywe dodatki 2 → 3 |
| „Zapytaj o adres”, reguły: `ogolne`, rower → stojaki, druga warstwa z tematu tylko z nazwanych obiektów | **#150** | Reguły: precyzja 89% → 94%, fałszywe dodatki 1 → 0; pokrycie bez zmian (67%) |

Kawałki diffu `5a8e872..e25ffe9` w `src/ai`:

| Plik | Kawałek | Decyzja |
|---|---|---|
| `opiszSiebie.ts` | nowe brzmienie `TWIERDZENIE_WLASNEJ_SYTUACJI` i komentarze | odrzucony – cały plik z `5a8e872` (+ komentarz #152) |
| `zapytajOAdres.ts` | dopisek `zielen_worldcover_100m` („pobiegać, także na spacer z psem”) | odrzucony – JEV go widzi |
| `zapytajOAdres.ts` | stała `P` („Pytanie (choćby w części) dotyczy”) | odrzucony |
| `zapytajOAdres.ts` | 7 twierdzeń `TEMATY` (hałas, powietrze, zieleń z „Samo posiadanie psa to nie to”, komunikacja, sklepy, bezpieczeństwo, rower) | odrzucone – brzmienie z #147 |
| `zapytajOAdres.ts` | `REGULY`: pole `ogolne`; reguła trasy `sciezk`, `tras`, `rowerem`, `na rowerze` + `ogolne: rower` | zostaje |
| `zapytajOAdres.ts` | `TrafienieReguly.nazwany`, `nazwane()`, pętla po `wzorce` + `ogolne` w `trafieniaRegul` | zostaje |
| `zapytajOAdres.ts` | `drugieZTematu(…, nazwane(trafienia))` w `regulaWiele` i `przetworzWiele` (+ komentarz) | zostaje – logika reguł; w ścieżce JEV działa dopiero po odpowiedzi, zapytania nie zmienia |
| `pomiar.ts` | komentarz „brzmienie z #150” przy `wlasna` | odrzucony (komentarz z #147) |
| `opiszSiebie.test.ts` | import `TWIERDZENIE_WLASNEJ_SYTUACJI` | zostaje |
| `opiszSiebie.test.ts` | test „mama z nami zamieszka” (asercje brzmienia z #150, noul jak dla nowego brzmienia) | zastąpiony testem #152: twierdzenie z #147 jest w zapytaniu, ≤ 16 pytań |
| `opiszSiebie.test.ts` | test „wysoka pewność profilu nie otwiera bramki” | zostaje – logika bramki jest ta sama w #147 |
| `zapytajOAdres.test.ts` | „przypiąć rower” → stojaki, „rowerem” → obie warstwy | zostaje bez zmian |
| `zapytajOAdres.test.ts` | „z psem do weterynarza” → bez zieleni | zostają asercje przetwarzania i reguł; usunięte asercje brzmienia dopisku i twierdzenia zieleni |
| `zapytajOAdres.test.ts` | twierdzenia tematów „Pytanie (choćby w części)…” z wykluczeniami | usunięty – sprawdzał brzmienie z #150 |
| `WYNIKI.md` | sekcja „Druga runda (#150)” | zostaje jako historia |

Uwaga do „weterynarza”: poprawka z #150 była w całości po stronie JEV (dopisek i twierdzenie
zieleni); reguły nigdy nie dokładały tu zieleni (test przechodzi w obu wersjach). Wracając do
tekstów z #147, wraca więc znana wada #147: JEV może dołożyć zieleń do „z psem do weta”.

### Czy zapytania do JEV są takie jak w #147?

`node src/ai/pomiar/zgodnosc147.ts` (bez sieci) wyciąga `opiszSiebie.ts` i `zapytajOAdres.ts`
z `5a8e872`, buduje zapytania dla wszystkich tekstów ze wszystkich zbiorów i porównuje je bajt
w bajt:

| | Wzorcowy | Kontrolny nr 1 | Kontrolny nr 2 |
|---|---|---|---|
| „Opisz siebie” – całe zapytanie | 30/30 identycznych | 30/30 | 30/30 |
| „Zapytaj o adres” – kod, ta sama lista warstw | 28/28 identycznych | 25/25 | 25/25 |
| „Zapytaj o adres” – całe zapytanie z listą warstw z `5a8e872` | 0/28 | 0/25 | 0/25 |

**Kod zapytań jest identyczny z #147, ale lista warstw nie.** Po `5a8e872` doszło 7 warstw
„Sejm 2023 · …” (`sejm2023_lista_1…7`, commit `40ff16a`, #134): lista dla JEV ma 93 warstwy
zamiast 86 (opisy pozostałych bez zmian). To 7 dodatkowych opcji w wyborze warstwy głównej.
Wniosek:

- „opisz siebie” nie używa listy warstw, więc zapytanie i przetwarzanie są identyczne z #147 –
  wynik JEV z #147 na zbiorze nr 1 przenosi się wprost (z dokładnością do niedeterminizmu JEV);
- w „zapytaj o adres” wynik #147 przenosi się tylko w przybliżeniu: zapytanie ma 7 opcji więcej,
  a przetwarzanie ma reguły z #150. Nie wiadomo, czy pomiar #150 widział te warstwy (`40ff16a`
  weszło 10 minut przed scaleniem #150), więc porównanie #147 z #150 w B może je mieszać
  z brzmieniem tematów;
- warstw Sejmu nie wyłączyłem z listy JEV – to dane i funkcja z #134, a nie część tego zadania.
  Zbiór nr 2 ich nie używa (piszący nie znał tych warstw), więc w pomiarze są tylko
  dodatkowymi opcjami do pomylenia; w aplikacji też są.

### Wynik nagłówkowy – zbiór kontrolny nr 2 (świeży, na ślepo, mierzony raz)

`pomiar.ts --na-zywo --zbior kontrolny2`, jeden przebieg; po nim nic w kodzie nie zmieniłem.
JEV = to, co widzi użytkownik (JEV, a pod progiem reguły).

**A – „opisz siebie”** (30 opisów):

| | Reguły | **JEV** |
|---|---|---|
| Profil trafiony | 67% | **67%** |
| Potrzeby (10 z twierdzeniem) – P / R / F1 | 77 / 57 / 66% | **84 / 79 / 81%** |
| Potrzeby – F1 na wszystkich 15 | 64% | **71%** |
| Kategorie ważne – P / R / F1 | 83 / 68 / 75% | **90 / 75 / 81%** |
| Cały opis zrozumiany dokładnie | 27% | **47%** |
| Puste teksty → „nic nie zrozumiano” | 2/2 | 2/2 |
| Bramka „własna sytuacja” poniżej 0,5 | – | 3 z 30 (średnio 0,82) |
| Zapas (reguły zamiast JEV) | – | 1/30 (nieczytelna odpowiedź) |

**B – „zapytaj o adres”** (25 pytań):

| | Reguły | **JEV** |
|---|---|---|
| Trafna warstwa główna (albo „nie wiem”) | 60% | **96%** |
| Pytania pojedyncze – warstwa główna trafna | 5/15 | **14/15** |
| Pokrycie pytań złożonych (do 3 warstw) | 69% | **69%** |
| Złożone z kompletem tematów | 2/7 | 2/7 |
| Spoza zakresu → „nie wiem” bez dodatków | 3/3 | 3/3 |
| Precyzja warstw | 94% | **93%** |
| Fałszywe dodatki na pojedynczych (pytań) | 0 | 1 |
| Średnio warstw na odpowiedź | 0,77 | 1,27 |
| Zapas (reguły zamiast JEV) | – | 2/25 (nieczytelne odpowiedzi) |

Jak to czytać – wprost:

- **JEV wyraźnie wygrywa w wyborze jednej warstwy** (96% vs 60%) i w potrzebach z opisu
  (F1 81% vs 66%, pełność 79% vs 57%). Cały opis dokładnie: 47% vs 27%.
- **Profil – remis** (67% w obu). Pewność JEV przy trafnym profilu średnio 0,95, przy błędnym 0,73.
- **Pytania złożone – remis** (pokrycie 69% w obu, komplet 2/7 w obu). JEV pokazuje więcej warstw
  (1,27 vs 0,77), ale nie trafia w drugi temat częściej niż reguły; ma jeden fałszywy dodatek na
  pojedynczym pytaniu.
- Na zbiorze nr 2 oba systemy wypadają lepiej niż na zbiorze nr 1 (np. reguły „dokładnie” 27% vs
  20%), więc część różnicy względem #147 to inny, być może łatwiejszy zbiór, a nie lepszy kod.
- To 30 + 25 pozycji: 1 opis = 3 pp, 1 pytanie = 4 pp. Różnice rzędu jednej pozycji to szum.
- Przeliczenie progu tematu z tych samych odpowiedzi (bez nowych wywołań): 0,5 – pokrycie 69%
  i 2 fałszywe dodatki; 0,9 – pokrycie 60% i 0 fałszywych dodatków. Progu nie zmieniałem.

### Przekrój pomocniczy: tylko pisane

Pole w aplikacji jest **pisane**, nie dyktowane, więc pułapki, które są zjawiskiem mowy
(poprawianie się w pół zdania), są w nim mało realne. Przekrój „tylko pisane” pomija takie
pozycje; **wynik nagłówkowy to nadal pełny zbiór wyżej**. Bez nowych wywołań i bez zmian
w zbiorach ani etykietach: `pomiar.ts --zbior kontrolny2 --z-pliku <zapisany przebieg>
--tylko-pisane` przelicza ten sam zapisany przebieg (przeliczenie pełnego zbioru z pliku daje
dokładnie liczby wyżej). Lista pominiętych: `MOWIONE` w `pomiar.ts`.

Jak wybrałem pozycje: z cech zbioru pasuje tylko `sprzecznosc` (zbiór nr 2: K2-A10, K2-A29;
zbiór nr 1: K-A13, K-A24) – przeczytałem tylko te cztery teksty, a w pozostałych tekstach
szukałem automatycznie znaczników samokorekty („no dobra”, „to znaczy”, „właściwie”, „albo nie”…),
wypisując tylko trafienia.

| Pozycja | Decyzja | Dlaczego |
|---|---|---|
| K2-A10 | **pominięta** | samokorekta w pół zdania: „nie potrzebuję auta… no dobra, auto mamy” |
| K2-A29 | zostaje | dwie potrzeby naraz (dziecko lubi park, ja mam astmę), „wiem wiem” – da się tak napisać |
| K-A13 | zostaje | sprzeczne życzenia (centrum i cisza) – da się tak napisać |
| K-A24 | zostaje | sprzeczne życzenia (lotnisko blisko, bez hałasu samolotów) – da się tak napisać |
| K2-A04 | zostaje | fałszywe trafienie wyszukiwania („…mnie nie obchodzi”), nie samokorekta |

Cechy typowe dla pisania (bez polskich znaków, literówki, slang, cudza sytuacja, hipoteza,
przeszłość) zostają w obu przekrojach. W pytaniach B (oba zbiory) i w zbiorze nr 1 nic nie
pominąłem, więc tam „tylko pisane” = pełny zbiór.

Zbiór nr 2, A – „opisz siebie”, pełny (30) vs tylko pisane (29):

| | Reguły – pełny | Reguły – pisane | **JEV – pełny** | **JEV – pisane** |
|---|---|---|---|---|
| Profil trafiony | 67% | 66% | 67% | 66% |
| Potrzeby (10) – P / R / F1 | 77 / 57 / 66% | 76 / 58 / 66% | 84 / 79 / 81% | 83 / 78 / 80% |
| Potrzeby – F1 na wszystkich 15 | 64% | 64% | 71% | 70% |
| Kategorie ważne – F1 | 75% | 75% | 81% | 81% |
| Cały opis zrozumiany dokładnie | 27% (8/30) | 28% (8/29) | 47% (14/30) | 45% (13/29) |

Zbiór nr 2, B – bez zmian (nic nie pominięte): reguły 60% / JEV 96% warstwy głównej, pokrycie
złożonych 69% / 69%, precyzja 94% / 93%.

Wniosek: pominięcie jedynej pozycji „mówionej” niczego nie zmienia – K2-A10 JEV zrozumiał
dokładnie, reguły nie, więc bez niej JEV wypada o włos gorzej, a nie lepiej. Wynik na zbiorze nr 2
nie wisi na pułapkach mowy.

### Zbiór kontrolny nr 1 – dla odniesienia (użyty do wyboru części)

Na tym zbiorze wybierałem części, więc to nie jest dowód. JEV: wynik z #147 przeniesiony (patrz
zastrzeżenie o liście warstw wyżej, „≈” = tylko w przybliżeniu); reguły: przeliczone teraz bez
sieci.

| | Reguły (wersja końcowa) | JEV (pomiar #147) |
|---|---|---|
| A: profil | 57% | 63% |
| A: potrzeby P / R / F1 | 59 / 49 / 53% | 69 / 88 / 77% |
| A: kategorie F1 | 68% | 79% |
| A: dokładnie | 20% | 37% |
| B: trafna warstwa główna | 64% | ≈ 92% |
| B: pokrycie złożonych (do 3 warstw) | 67% | ≈ 52% |
| B: precyzja warstw | 94% | ≈ 92% |
| B: fałszywe dodatki na pojedynczych | 0 | ≈ 2 |

### Same reguły – bez sieci, wersja końcowa

`pomiar.ts` bez `--na-zywo` (z `--zbior kontrolny` / `kontrolny2` albo bez) – zero wywołań,
wynik deterministyczny.

| | Wzorcowy (strojenie) | Kontrolny nr 1 | Kontrolny nr 2 |
|---|---|---|---|
| A: profil | 73% | 57% | 67% |
| A: potrzeby P / R / F1 | 75 / 68 / 71% | 59 / 49 / 53% | 77 / 57 / 66% |
| A: kategorie F1 | 88% | 68% | 75% |
| A: dokładnie | 30% | 20% | 27% |
| B: trafna warstwa główna | 68% | 64% | 60% |
| B: pojedyncze | 9/17 | 6/15 | 5/15 |
| B: pokrycie złożonych (do 3 warstw) | 100% | 67% | 69% |
| B: złożone w komplecie | 7/7 | 2/7 | 2/7 |
| B: precyzja warstw | 89% | 94% | 94% |
| B: fałszywe dodatki na pojedynczych | 1 | 0 | 0 |

Wzorcowy i kontrolny nr 1 zgadzają się z liczbami reguł po #150 – reguły to wersja z #150.

### Opóźnienie (p50 / p95 / max, pośrednik → api.typesafe.ai)

| Przebieg | A | B | Razem |
|---|---|---|---|
| Kontrolny nr 2, wersja końcowa | 285 / 416 / 468 ms | 352 / 424 / 484 ms | 307 / 424 / 484 ms |

Bez zmian: jedno wywołanie na tekst, ok. 0,3 s.

### Wywołania na żywo

**55 płatnych wywołań** (budżet 60): tylko końcowy pomiar zbioru nr 2 (30 + 25). Strojenia nie
było; sprawdzenie zgodności z #147 i liczby reguł są bez sieci.

## Trzy błędy (#153)

Pomiar z 2026-10-03. Ta sekcja opisuje poprawki trzech znanych błędów wersji końcowej (#152)
i jeden pomiar na **nowym zbiorze kontrolnym nr 3**: `kontrolny3-opisz.json` (30 opisów)
i `kontrolny3-zapytaj.json` (25 pytań). Zbiór napisał na ślepo osobny agent AI, bez dostępu
do kodu i poleceń. Pozycje mają cechy pułapek, w tym `domownik`, `cudza_sytuacja`,
`pies_bez_spaceru` i `dwa_z_tematu`.

Zbiór otworzyłem dopiero przy gotowym kodzie i tylko po to, żeby skopiować pliki i sprawdzić id.
Wszedł bajt w bajt osobnym commitem („Dodaj zbiór kontrolny nr 3…”), wcześniejszym niż commit
z kodem. Etykiet nie ruszałem.

Jedna zbieżność: pytanie K3-B05 (17 znaków) jest dosłownie takie samo jak K2-B09. Test zbiorów
zwalnia je tylko z wymogu „inne niż w pozostałych zbiorach”.

Stroiłem na trzech rzeczach: starych zbiorach, własnych zdaniach i liczbach zbiorczych
przeliczonych z zapisanych przebiegów zbiorów nr 1 i nr 2. Tamtych przebiegów nie powtarzałem
na żywo i nie czytałem w nich tekstów.

### Co się zmieniło – i dlaczego

**1. Bramka „cudza sytuacja”: para wąskich twierdzeń i odwrócona logika (wariant a).**

Było jedno twierdzenie: „Osoba opisuje własną obecną sytuację…”. Bramka zamykała się poniżej
0,5, czyli wtedy, gdy **brakowało dowodu** własnej sytuacji. Teraz są dwa twierdzenia:

- `cudza_osoba`: „Osoba szuka mieszkania dla kogoś innego, kto z nią nie mieszka i nie zamieszka
  (np. dla znajomego, klienta, rodzeństwa). Zakup na wynajem albo jako inwestycja to nie to.”
- `sytuacja_nieaktualna`: „Tekst mówi wyłącznie o sytuacji wyobrażonej („gdyby…”) albo
  nieaktualnej (tak było kiedyś), a nie o obecnej ani planowanej.”

Jak działa bramka:

- Zamyka się tylko na **dowód** cudzej sytuacji, czyli gdy któreś twierdzenie ma ocenę ≥ 0,5.
- Brak odpowiedzi zostawia ją otwartą.
- Zamknięta działa jak dotąd: profil zostaje bez zmian, a z potrzeb zostają tylko te z noul ≥ 0,9.

Miejsce w limicie 16 pytań zwolniła kategoria „Codzienność pieszo”. JEV ocenia teraz 3
kategorie. Codzienność podnoszą potrzeby: dzieci, senior, lekarz, sklepy, rower i brak samochodu.

Każdego kandydata sprawdzałem w **pełnym zapytaniu** (16 pytań). To lekcja z #150: twierdzenie,
które wypadało dobrze osobno, w pełnym zapytaniu odcinało 10 z 30 opisów.

**Dowody bez sieci.** Zapytanie „opisz siebie” w zapisanych przebiegach zbioru nr 1 (#147)
i nr 2 (#152) jest bajt w bajt takie samo, więc wynik dało się przeliczyć z zapisanych ocen JEV.
Przeliczenie zgadza się z zapisanym wynikiem w 30/30 opisów na obu zbiorach. Liczby służą tylko
do porównania wariantów: „kategorie F1” liczyłem wyłącznie z tabeli `POTRZEBY` (zbiory kontrolne
nie mają jawnych kategorii), a pewność poziomu przyjąłem za 1.

| Wariant | Kontrolny 1: profil / F1 potrzeb / kat. F1 / dokładnie | Kontrolny 2: to samo |
|---|---|---|
| Bramka z #147 (stan na `main`) | 63% / 77% / 81% / 37% | 67% / 81% / 86% / 47% |
| (c) bez bramki | 57% / 77% / 82% / 33% | 70% / 82% / 87% / 50% |
| Bez pytania o „Codzienność” | 63% / 77% / **81%** / 37% | 67% / 81% / **86%** / 47% |
| Bez pytania o „Bezpieczeństwo” | 63% / 77% / 78% / 37% | 67% / 81% / 84% / 47% |
| Bez „Transportu” / bez „Spokoju” | kat. 83% / 79% | kat. 84% / 84% |

Wnioski:

- **(c) Bez bramki** – remis z przesunięciem: na zbiorze nr 1 tracę 2 profile, na zbiorze nr 2
  zyskuję 1. Ten wariant nie chroni przed cudzą sytuacją, więc go odrzuciłem.
- **(b) Bramka z #147 plus warunek słabych dowodów** – odrzucona bez pomiaru. W #150 tekst
  „Pytam dla koleżanki” dał Rodzinę z pewnością 1,00 i psa z oceną 0,92, więc siła dowodów nie
  odróżnia cudzej sytuacji od własnej.
- **Wolne miejsce:** pytanie o „Codzienność” kosztuje najmniej – 0 pp kategorii F1 na zbiorze
  nr 1 i nr 2, −2 pp na wzorcowym (przebieg #18). „Bezpieczeństwo” kosztuje −3 / −2 / −1 pp.

**Dowody na żywo.** Celowane zdania (pisałem je sam), każde w pełnym zapytaniu:

| Zdanie | Bramka z #147 (`wlasna_sytuacja`, < 0,5 zamyka) | **#153: `cudza_osoba`** | Wynik #153 |
|---|---|---|---|
| „Od przyszłego miesiąca zamieszka z nami teściowa, ma 84 lata…” | **0,35 – zamknięta**, profil przepada | 0,08 – otwarta | Senior; senior + lekarz |
| „Pytam dla koleżanki: ona ma dwójkę dzieci i psa…” | 0,04–0,05 (pomiar w #150) | **0,91 – zamknięta** | profil bez zmian, tylko pewne potrzeby |
| „Kiedyś mieszkaliśmy z dziećmi… to już nieaktualne” | 0,71 – otwarta | 0,09; zamknęła ją `sytuacja_nieaktualna` | profil bez zmian |
| „W marcu urodzi nam się dziecko…” | 0,94 (pomiar w #150) | 0,07 – otwarta | Rodzina; dzieci + zieleń |

W tym przebiegu skrypt nie wypisywał oceny `sytuacja_nieaktualna`. Widać ją tylko po tym, że
bramka się zamknęła albo nie. W przebiegu na starym A skrypt wypisywał już obie oceny.

Na starym A sprawdziłem 16 z 30 opisów, bo pełne 30 nie mieściło się w budżecie. Wybrałem
wszystkie opisy z pułapkami: A06 (cudza sytuacja), A07 (hipoteza), A12 (najemcy), A29
(teściowie), A27 (dawne dzieci), A10 („Mama z nami zamieszka”), A04, A16 i A24 (plany dziecka),
A30, a do tego kilka zwykłych.

- Bramka zamknęła się w **0 z 16** opisów. `cudza_osoba` miała najwyżej 0,16,
  a `sytuacja_nieaktualna` najwyżej 0,08.
- Dokładnie zrozumianych: 12 z 16. Inwestorzy (A12, A23) mają oceny 0,14 i 0,09 i zostają
  Inwestorami.
- **Znane ograniczenie:** tekst mieszany zostawia bramkę otwartą (A06: „Kumpel ma trójkę dzieci
  i psa… Szukamy z partnerką dla siebie”, ocena 0,16). JEV daje wtedy Rodzinę, dzieci i psa,
  jak w #18. Bramka ocenia cały tekst, a nie pojedyncze zdanie.

**2. „Z psem do weta”: po jednym zdaniu wykluczenia w dwóch tematach.**

- Twierdzenie zieleni dostało na końcu zdanie „Wizyta u weterynarza albo samo posiadanie psa
  to nie to.”
- Twierdzenie zdrowia dostało zdanie „Weterynarz to nie to.”
- Dopiski warstw i pozostałe 13 tematów zostały bez zmian. Wersja z #150 zmieniała naraz
  7 twierdzeń i prefiks, więc psuła też inne tematy.

Moje pytanie „Daleko stąd z psem do weta?” przed zmianą nie odtworzyło zieleni ze zbioru
kontrolnego (0,49, a tam 0,71). Za to dokładało **przychodnię**: temat zdrowia dostał 0,75,
a w drugim moim pytaniu o weterynarza 0,85.

| Pytanie | Temat | Przed | **Po** |
|---|---|---|---|
| „Daleko stąd z psem do weta?” | zieleń / zdrowie | 0,49 / 0,75 → [weterynarz, przychodnia] | **0,43 / < 0,3 → [weterynarz]** |
| B19 „Jest gdzie wyjść z psem, jakiś skwer albo park?” | zieleń | – | 0,91 → [zieleń] |
| B23 „zielono, cicho i bezpiecznie wieczorem” | zieleń / hałas / bezpieczeństwo | 0,56 / 0,57 / 0,47 (#147) | 0,51 / 0,58 / 0,44 – wynik bez zmian |
| B27 „powietrze, hałas, drzewa” | powietrze / hałas / zieleń | 0,71 / 0,84 / 0,88 (#147) | 0,74 / 0,83 / 0,84 – komplet 3/3 |

**3. Dwie warstwy z jednego tematu przez JEV: drugie wywołanie tylko wtedy, gdy trzeba.**

Drugie wywołanie idzie tylko wtedy, gdy spełnione są wszystkie warunki:

- temat z różnymi obiektami (szkoły, zdrowie, sklepy, rower) ma noul ≥ 0,6;
- z tego tematu jest w odpowiedzi dokładnie jedna warstwa;
- reguły nie dały drugiej;
- jest wolne miejsce (mniej niż 3 warstwy);
- pytanie wygląda na złożone („i”, „oraz”, „albo”, „lub”, przecinek albo kilka pytajników).

Jak działa:

- Drugie wywołanie to `choice` wyłącznie z warstw tego tematu o **innym obiekcie** niż pierwsza
  warstwa, plus `nie_wiem` („nie pyta o nic więcej z tej grupy”).
- Druga warstwa wchodzi przy pewności ≥ 0,6 i staje zaraz po pierwszej.
- Każdy kłopot z drugim wywołaniem zostawia wynik pierwszego.
- Pozostałe pytania nadal mają **jedno** wywołanie.

Bogatsze słowniki reguł odrzuciłem, bo pomagają tylko na słowa, które ktoś przewidział.
„Opieka na cały dzień” to żłobek, a „internista” to przychodnia, i żadne z tych słów nie jest
w regułach.

| Pytanie (moje) | Reguły | **JEV + drugie wywołanie** | Czas |
|---|---|---|---|
| „Czy blisko jest przedszkole, a dla młodszego jakaś opieka na cały dzień?” | [przedszkole] | **[przedszkole, żłobek]** (0,94) | 405 + 407 ms |
| „Jest tu apteka? A jakby trzeba było do internisty, to daleko?” | [apteka] | **[apteka, przychodnia]** (0,90) | 416 + 245 ms |
| „Czy przedszkole jest blisko, tak żeby dojść pieszo?” (jedna rzecz) | [przedszkole] | [przedszkole]; drugie wywołanie: `nie_wiem` 0,99 | 358 + 306 ms |

Jak często wchodzi drugie wywołanie? Przeliczenie bez sieci z zapisanych odpowiedzi na pierwsze
wywołanie (teksty tematów sprzed #153, więc w przybliżeniu):

- stary B: 1 z 28 (zapisany przebieg z #146);
- kontrolny nr 1: 3 z 25;
- kontrolny nr 2: 3 z 25;
- zbiór nr 3 (pomiar na żywo): **2 z 25**.

### Wynik nagłówkowy – zbiór kontrolny nr 3 (świeży, na ślepo, mierzony raz)

Jeden przebieg `pomiar.ts --na-zywo --zbior kontrolny3`, 57 wywołań. Po nim nic w kodzie nie
zmieniłem. JEV oznacza to, co widzi użytkownik: odpowiedź JEV, a poniżej progu – reguły.

**A – „opisz siebie”** (30 opisów):

| | Reguły | **JEV** |
|---|---|---|
| Profil trafiony | 63% | **80%** |
| Potrzeby (10 z twierdzeniem) – P / R / F1 | 74 / 63 / 68% | **74 / 80 / 77%** |
| Potrzeby – F1 na wszystkich 15 | 67% | 66% |
| Kategorie ważne – P / R / F1 | 73 / 72 / 72% | **81 / 81 / 81%** |
| Cały opis zrozumiany dokładnie | 30% | **50%** |
| „Nic nie zrozumiano” tam, gdzie trzeba | 2/4 | 3/4 |
| Bramka zamknięta | – | 2 z 30 (obie na pozycjach z cechą `cudza_sytuacja`) |
| Zapas (reguły zamiast JEV) | – | 1/30 (nieczytelna odpowiedź) |

**B – „zapytaj o adres”** (25 pytań: 13 pojedynczych, 9 złożonych, 3 spoza zakresu):

| | Reguły | **JEV** |
|---|---|---|
| Trafna warstwa główna (albo „nie wiem”) | 68% | **92%** |
| Pytania pojedyncze – warstwa główna trafna | 6/13 | **11/13** |
| Pokrycie pytań złożonych (do 3 warstw) | 78% | **85%** |
| Złożone z kompletem tematów | 5/9 | **6/9** |
| Spoza zakresu → „nie wiem” bez dodatków | 2/3 | **3/3** |
| Precyzja warstw | 91% | **100%** |
| Fałszywe dodatki na pojedynczych | 0 | 0 |
| Średnio warstw na odpowiedź | 1,05 | 1,23 |
| Zapas (reguły zamiast JEV) | – | 6/25 (pewność wyboru < 0,5, w tym 3 × `nie_wiem`) |

**Przekrój po cechach** (liczby zbiorcze). Każda cecha ma 1–6 pozycji, więc jedna pozycja to
17–100 pp.

| Cecha | n | Reguły | **JEV** |
|---|---|---|---|
| `domownik` (A) – profil / dokładnie | 3 | 33% / 33% | **100%** / 33% |
| `domownik` (A) – potrzeby P / R | 3 | 80 / 57% | 75 / 86% |
| `cudza_sytuacja` (A) – profil / dokładnie | 3 | 33% / 0% | **100% / 100%** |
| `pies_bez_spaceru` (A) – profil / dokładnie / F1 potrzeb | 2 | 100% / 50% / 50% | 100% / 50% / 86% |
| `dwa_z_tematu` (B) – pokrycie / precyzja | 6 | 67% / 80% | **92% / 100%** (komplet 5 z 6) |

- **`domownik`:** bramka nie zamknęła się w żadnym z 3 opisów, a profil był trafiony 3 razy
  na 3. „Dokładnie” wyszło 1 z 3, bo JEV pominął 1 potrzebę i dodał 2 nadmiarowe. Bramka nie
  miała z tym nic wspólnego.
- **`cudza_sytuacja`:** wszystkie 3 opisy zrozumiane dokładnie. Bramka zamknęła się w 2 z nich,
  a trzeci JEV zrozumiał dobrze przy otwartej bramce. W pozostałych 27 opisach bramka nie
  zamknęła się ani razu.
- **`pies_bez_spaceru`:** ta cecha jest w zbiorze A (opis z psem bez spacerów), a nie w B. JEV
  nie dodał potrzeby zieleni w żadnym z 2 opisów. Poprawka „weterynarza” dotyczy B, a w B zbioru
  nr 3 nie ma pytania z tą cechą. Fałszywych dodatków na pojedynczych pytaniach B nie było
  wcale (0).
- **`dwa_z_tematu`:** drugie wywołanie weszło w 2 z 6 pytań. Liczę z tych samych odpowiedzi na
  pierwsze wywołanie, z drugim wywołaniem i bez niego:
  - pokrycie tej cechy rośnie z 75% do 92%, a komplet z 3 do 5 z 6;
  - we wszystkich pytaniach złożonych pokrycie rośnie z 74% do 85%, a komplet z 4 do 6 z 9.
  Bez drugiego wywołania JEV byłby tu prawie na równi z regułami (75% vs 67%).

Mówiąc wprost:

- **W A JEV wygrywa wyraźnie:** dokładnie 50% vs 30%, profil 80% vs 63%. W B wyraźnie wygrywa
  wybór warstwy: 92% vs 68%.
- **Pytania złożone – JEV nieco lepszy:** pokrycie 85% vs 78%, komplet 6 vs 5 z 9. To mniej niż
  jedno pytanie średnio, więc różnica jest na granicy szumu. Tym razem to jednak nie remis,
  jak w #152.
- **Część różnicy względem #152 to sam zbiór.** Zbiór nr 3 jest inny niż nr 2, a reguły
  wypadają na nim podobnie (dokładnie 30% vs 27%, warstwa główna 68% vs 60%).
- **Zapas w B 6/25 to najwięcej do tej pory** (w #152: 2/25). W 6 pytaniach pewność wyboru
  warstwy spadła pod 0,5, w 3 z nich przy `nie_wiem`; tam odpowiadają reguły. Nie umiem
  rozdzielić bez sieci, czy to sprawa zbioru, czy zmienionych twierdzeń zieleni i zdrowia w tym
  samym zapytaniu. W #146 i #150 zmiana twierdzeń tematów przesuwała pewność wyboru, więc
  drugiej przyczyny nie wykluczam.
- **Próg tematu przeliczony z tych samych odpowiedzi** (bez drugich wywołań): przy 0,5 pokrycie
  78%, przy 0,6 – 74%, przy 0,8 – 65%; precyzja wszędzie 100%. Progu nie zmieniałem.

### Opóźnienie i koszt

| Przebieg (kontrolny nr 3) | p50 / p95 / max |
|---|---|
| A (16 pytań w zapytaniu) | 258 / 375 / 395 ms |
| B – pytania z jednym wywołaniem (23) | 328 / 385 / 720 ms |
| B – pytania z drugim wywołaniem (2) | 569 / 620 / 620 ms |
| Razem (czas na pytanie) | 303 / 569 / 720 ms |

- Drugie wywołanie dokłada ok. **250–400 ms**, ale tylko w pytaniach, które go potrzebują: 2
  z 25 na zbiorze nr 3, a w przeliczeniach starszych zbiorów 1–3 pytania na 25–28.
- Pozostałe pytania mają jedno wywołanie i trwają ok. 0,3 s, jak dotąd.
- Wywołania idą po kolei, więc najgorszy przypadek to dwa timeouty klienta (2 × 1,5 s). W pomiarze
  się nie zdarzył.

**Wywołania na żywo: 91** (budżet 95):

- strojenie, razem 34:
  - celowane zdania A na starej bramce – 2;
  - celowane zdania A na nowej bramce – 4;
  - stary A – 16;
  - weterynarz przed zmianą – 2;
  - stary B19, B23, B27 – 3;
  - celowane pytania B – 4, plus 3 drugie wywołania;
- zbiór nr 3 – 57 (30 + 25 + 2 drugie wywołania).

Przeliczenia bez sieci nic nie kosztowały: bramka, kategorie, częstość drugiego wywołania
i wariant bez drugiego wywołania. `zgodnosc147.ts` pokazuje teraz zapytanie inne niż w #147.
Tak ma być, bo zmieniło się to, co widzi JEV.

## Profil (#155)

Pomiar z 2026-10-03. Trzy zmiany w wyborze profilu w „opisz siebie”. Bramka z #153, twierdzenia
potrzeb, kategorie i limit 16 pytań są bez zmian.

1. **Próg profilu 0,85** (`PROG_PROFILU`). Wcześniej było 0,6, tak samo jak dla kategorii, które
   zostają przy 0,6. Pod progiem profil zostaje bez zmian, a potrzeby i kategorie liczą się jak
   dotąd.
2. **Opisy opcji profilu mówią, kim jest osoba** (`OPISY_PROFILI_JEV`), a nie, co ceni. Opisy
   w UI (`persony.ts`) się nie zmieniają.
   - rodzina: „Rodzic z dziećmi w domu (także gdy dziecko jest w drodze)”;
   - singiel: „Osoba mieszkająca sama, zwykle młoda, pracująca albo studiująca”;
   - senior: „Osoba na emeryturze albo w starszym wieku”;
   - inwestor: „Kupujący pod wynajem albo jako lokatę, sam tam nie zamieszka”.
3. **Pod progiem profil wynika tylko z mocnych potrzeb** (`profilZMocnychPotrzeb`):
   - `senior` z noul ≥ 0,9 daje Seniora, a `dzieci` z noul ≥ 0,9 – Rodzinę;
   - `inwestycja` i `singiel` nie mają twierdzenia, więc liczą się słowa z reguł („pod
     wynajem”, „mieszkam sama”, z przeczeniami jak w `zRegul`), ale tylko wtedy, gdy JEV pod
     progiem wskazał ten sam profil;
   - bez mocnej potrzeby profil zostaje bez zmian. Przed #155 profil ustawiała każda potrzeba
     z noul ≥ 0,6.

   Przy konflikcie obowiązuje kolejność **Inwestor → Senior → Rodzina → Singiel**, ta sama co
   w regułach:
   - Inwestor sam nie zamieszka, więc jego dzieci i wiek nie ustawiają wag.
   - Senior wygrywa z Rodziną, bo starsza osoba pisze o wnukach i dorosłych dzieciach.
     Gdy do rodziny wprowadza się starszy rodzic, potrzeby seniora i tak zostają.
   - Singiel to najsłabszy sygnał.

   **Mocna potrzeba to 0,9, a nie 0,8.** To ten sam poziom co „pewna potrzeba” przy zamkniętej
   bramce. Przy 0,8 zapas dawał Rodzinę stare A06 („Kumpel ma trójkę dzieci… szukamy
   z partnerką”, gdzie dzieci mają 0,81, a profil 0,66). We wszystkich zapisanych przebiegach
   0,8 i 0,9 dają poza tym ten sam wynik.

### Skąd 0,85 – zapisane przebiegi, bez nowych wywołań

Pewność wyboru profilu (przed progiem), trafne vs błędne:

| Przebieg | trafne: średnio / ≥ 0,85 | błędne: średnio / ≥ 0,85 |
|---|---|---|
| Wzorcowy, #18 (stare opisy) | 0,97 / 27 z 27 | 0,71 / 1 z 3 |
| Wzorcowy, #155 (nowe opisy, na żywo) | 0,98 / 26 z 27 („nieznany” 0,48 przy wzorcu „–”) | 0,67 / 1 z 3 |
| Kontrolny nr 1 | 0,95 / 12 z 13 | 0,68 / 4 z 17 |
| Kontrolny nr 2 | 0,95 / 17 z 18 | 0,73 / 5 z 12 |
| Kontrolny nr 3 | 0,90 / 15 z 18 | 0,73 / 5 z 12 |

Próg przeliczyłem z zapisanych odpowiedzi JEV z nowym zapasem. Komórka podaje profil trafiony
i liczbę złych profili w nawiasie:

| Próg | Wzorcowy #18 | Wzorcowy #155 | Kontrolny 1 | Kontrolny 2 | Kontrolny 3 |
|---|---|---|---|---|---|
| 0,6 | 93% (2) | 93% (2) | 63% (10) | 67% (8) | 80% (6) |
| 0,7 | 93% (2) | 97% (1) | 70% (8) | 67% (7) | 80% (6) |
| 0,8 | 93% (2) | 97% (1) | 83% (4) | 73% (5) | 80% (6) |
| **0,85** | **97% (1)** | **97% (1)** | **83% (4)** | **73% (5)** | **83% (5)** |
| 0,9 | 97% (1) | 97% (1) | 83% (4) | 80% (3) | 83% (5) |
| 0,95 | 93% (1) | 97% (1) | 87% (3) | 80% (3) | 83% (3) |

- Od 0,85 do 0,9 różnica to dwa opisy, oba na zbiorze nr 2. To poniżej reguły „≥ 3 pozycje”,
  więc zostaje 0,85, czyli wartość z decyzji.
- Przy 0,95 profil od JEV prawie nie działa, a na wzorcowym #18 przepada trafna Rodzina (A10).
- Przy nowych opisach trafne profile na wzorcowym mają pewność ≥ 0,95 w 26 z 27 opisów, więc
  próg 0,85 nic tam nie kosztuje.

### Przed i po – zbiory użyte (bez zbioru nr 4)

„Przed” to przetwarzanie sprzed #155 (próg 0,6, profil z potrzeb ≥ 0,6), a „po” – #155. Wiersze
kontrolne to przeliczenie zapisanych przebiegów: odtworzenie „przed” zgadza się z wynikami
w #147, #152 i #153. Odpowiedzi w tych przebiegach pochodzą jeszcze ze starych opisów profilu.
Zły profil oznacza błąd szkodliwy (przestawia wagi). Wstrzymanie oznacza profil bez zmian
tam, gdzie wzorzec ma profil.

| Zbiór | Profil | Zły profil | Wstrzymanie | Potrzeby F1 (10) | Dokładnie |
|---|---|---|---|---|---|
| Wzorcowy, przebieg #18 | 93% → **97%** | 2 → 1 | 0 → 0 | 91% → 91% | 67% → 67% |
| Wzorcowy, nowe opisy (na żywo) | 93% → **97%** | 2 → 1 | 0 → 0 | 92% → 92% | 70% → 70% |
| Kontrolny nr 1 | 63% → **83%** | 11 → 4 | 0 → 1 | 77% → 77% | 37% → 40% |
| Kontrolny nr 2 | 67% → **73%** | 8 → 5 | 2 → 3 | 81% → 81% | 47% → 47% |
| Kontrolny nr 3 | 80% → **83%** | 6 → 5 | 0 → 0 | 77% → 79% | 50% → 50% |

Jak to czytać:

- **Złych profili jest mniej:** na zbiorach kontrolnych spadło ich z 25 do 14, a wstrzymań
  przybyło 2. Większość zysku daje sam próg.
- **Zapas z potrzeb w tych przebiegach nic nie poprawił.** Pod progiem nie było trafnego profilu
  do uratowania: trafne profile mają pewność ≥ 0,85. Słowa „inwestor/singiel” kosztują 1 opis
  na zbiorze nr 1 (bez nich 87%, zły profil 3). Zostawiłem je zgodnie z decyzją, w ostrożnej
  wersji: działają tylko wtedy, gdy JEV wskazał ten sam profil.
- **Nowe opisy profilu** zmierzyłem raz, na żywo, na całym zbiorze wzorcowym (30 opisów). Na tych
  samych opisach to porównanie z przebiegiem #18:
  - trafne z pewnością ≥ 0,95: 21 → 26 z 27 (A13 „mieszkam sama” 0,85 → 1,00);
  - A06 (cudza rodzina): Rodzina 0,80 → 0,66, więc pod progiem;
  - A07 („Gdybyśmy kiedyś mieli dzieci…”) to dalej Singiel 0,98 przy wzorcu „–”. To jedyny zły
    profil i ani próg, ani bramka go nie łapią.

  „Dokładnie” wzrosło z 67% do 70%. Zapytanie zmieniło się jednak od #18 także w potrzebach,
  bramce i kategoriach, więc to nie jest czysty efekt opisów.
- Opóźnienie (wzorcowy, 30 wywołań): p50 257 / p95 383 / max 393 ms – bez zmian.
- To 30 opisów na zbiór: 1 opis = 3 pp.

**Wywołania na żywo: 30** (budżet 30). Wszystkie poszły na zbiór wzorcowy A z nowymi opisami,
najpierw 10, potem pozostałe 20. Próg, zapas i kolejność liczyłem bez sieci. Zbiorów
kontrolnych nie wołałem, a z nich czytałem tylko liczby zbiorcze. Zbioru nr 4 nie otwierałem.

## Dwie propozycje i tematy przy słabym wyborze (#156)

Pomiar z 2026-10-03. Dwie zmiany w „zapytaj o adres”, obie bez zmiany zapytania do JEV:

- **R4 – dwie propozycje.** Pewność wyboru > 0,9 → odpowiedź od razu, jak dotąd. Pewność
  0,5–0,9 i rozkład z JEV (`prawdopodobienstwa`, #154) → karta pyta „Chodziło Ci o…?” i pokazuje
  dwa przyciski z dwiema najlepszymi warstwami (bez `nie_wiem` i bez id spoza listy). Klik
  pokazuje odpowiedź tej warstwy z danych, ze źródłem i rozdzielczością. Pod 0,5 – reguły, jak
  dotąd. Bez rozkładu – jak dotąd.
- **Próg 0,05 dla propozycji (`MIN_PROPOZYCJI`).** Warstwa musi mieć p ≥ 0,05; gdy takich jest
  mniej niż dwie, karta odpowiada jak dotąd. Na żywo druga warstwa „z sensem” miała 0,06–0,29,
  a pozostałe 0,00–0,02 (np. „dług gminy” obok hałasu). Bez tego progu połowa propozycji byłaby
  przypadkowa.
- **R5 – tematy nie przepadają.** Gdy JEV odpowiedział, ale wyboru głównego nie bierzemy
  (pewność < 0,5, brak pewności, wybór spoza listy), warstwy reguł łączą się z tematami JEV
  o noul ≥ 0,6: do 3, bez duplikatów, najwyżej jedna na temat, plus druga warstwa z tematu
  (#147, #153). Podpis: „pytanie rozpoznała reguła słów kluczowych, tematy dołożył JEV”.

`warstwy` w wyniku (to, co liczy `pomiar.ts`) przy propozycjach są takie same jak bez nich,
więc R4 nie zmienia liczb pomiaru. R5 je zmienia.

**Pasma pewności – bez sieci, z zapisanych przebiegów** (pewność wyboru zapisana przy każdym
pytaniu; teksty zbiorów kontrolnych nieczytane, tylko liczby):

| Zbiór | > 0,9 | 0,5–0,9 (w tym `nie_wiem`) | < 0,5 (w tym `nie_wiem`) |
|---|---|---|---|
| Stary B (#147, 28) | 12 | 12 (1) | 4 (1) |
| Kontrolny nr 1 (25) | 12 | 12 (3) | 1 (0) |
| Kontrolny nr 2 (25) | 14 | 9 (1) | 2 (2) |
| Kontrolny nr 3 (25) | 11 | 8 (0) | 6 (3) |
| **Razem (103)** | **49 (48%)** | **41 (40%)** | **13 (13%)** |

Zapisane przebiegi nie mają rozkładu, więc nie wiadomo, w ilu z 41 pytań w paśmie 0,5–0,9
pojawiłyby się propozycje.

**Na żywo, 19 wywołań** (stary B i moje zdania; jedno z nich odrzucone, 422, bo wysłałem
zapytanie bez tłumaczenia pośrednika): 18 odpowiedzi, w paśmie 0,5–0,9 jest 11 z nich.

- Propozycje pojawiły się w **6 z 11**: B10 (PM2,5 | benzo(a)piren), B11 (przychodnia
  z udogodnieniem | przychodnia), B22 (hałas | przystanek), B27 (PM2,5 | przewietrzanie),
  B28 (infrastruktura rowerowa | główna trasa rowerowa), B23 (zieleń 100 m | udział zieleni).
- **We wszystkich 6 warstwa z wzorca jest wśród dwóch propozycji.** W B10 JEV wybrał PM2,5,
  a wzorzec to benzo(a)piren, więc trafna jest druga propozycja. W B22 wzorzec ma obie warstwy.
  B23 i B28 to dwie miary jednej rzeczy, więc wybór niewiele daje, ale też nie szkodzi.
- 5 bez propozycji. W B03, B13 i B19 druga warstwa ma ≤ 0,02. W B04 („nie_wiem” 0,70) próg
  przechodzi tylko cena (0,29), więc zostaje „nie wiem”, choć wzorzec to cena. „Gdzie zjeść
  na mieście” (spoza zakresu) też zostaje przy „nie wiem”.

**Pod 0,5 – czy propozycje by pomogły?** Bez sieci, 13 pytań z zapisanych przebiegów:
pierwszy wybór JEV jest trafny w 6, a pierwsza warstwa reguł w 10. W 3 pytaniach reguły nic
nie znajdują; tam JEV trafia w 1 (K3-B02), a R5 i tak odzyskuje 2 z 3 przez tematy. Na żywo:
B16 (0,37, przystanek | kursy; reguły trafiają) i „Jak tu z dojazdem?” (0,34, przystanek |
czas do Rynku; R5 dokłada przystanek z tematu komunikacji 0,70). **Dowód jest słaby, więc
próg 0,5 zostaje.**

**R5 – bez sieci, na tych samych 13 pytaniach pod 0,5:** wynik zmienia się w 5. Pokrycie
pytań z tematami rośnie na zbiorze nr 2 z 50% do 100%, a na zbiorze nr 3 z 58% do 75%. Na
starym B i zbiorze nr 1 zostaje 100%. Warstw trafnych do pokazanych było 12/12, a jest 16/17.
Jedyny fałszywy dodatek to temat zdrowia (0,67) w K2-B09.

Koszt: zero dodatkowych wywołań. Propozycje i odpowiedzi do nich liczą się z odpowiedzi na
pierwsze wywołanie, a klik niczego nie wysyła. Model w wywołaniach na żywo to `jev-latest`
sprzed #154; rozkład wyglądał tak samo, jak opisuje kontrakt #154.

## Pomiar rundy (#154–#157)

Pomiar z 2026-10-03. Kod z `main` po całej rundzie: #154 (rozkład `prawdopodobienstwa`, model
przypięty do `jev-1.13.0`), #155 (profil) i #156 (dwie propozycje, tematy przy słabym wyborze).
Oba zadania były zamknięte, a ich commity na `main` (`9fadc05`, `f055657`), zanim poszło
pierwsze wywołanie tej sekcji. W kodzie aplikacji nic tu nie zmieniałem – tylko pomiar.

### Test A/A – ile wynosi szum

`src/ai/pomiar/aa.ts`: ten sam zestaw dwa razy pod rząd, ten sam kod i ten sam model. Zestaw to
co druga pozycja ze zbiorów do strojenia (`zbior-opisz.json` bez pustych tekstów – 15 opisów,
`zbior-zapytaj.json` – 14 pytań). Żadnego zbioru kontrolnego. Przebiegi są w scratchpadzie, nie
w repo; `aa.ts --z-pliku` przelicza raport bez sieci.

| | n | wybór (`choice`) taki sam | \|Δ pewności\| średnio / max | \|Δ noul\| średnio / p95 / max | noul po różnych stronach progu | końcowa odpowiedź inna |
|---|---|---|---|---|---|---|
| A – opisz siebie (profil) | 15 | **15/15** | 0,005 / 0,07 | 0,007 / 0,02 / 0,05 (180 ocen) | 0/180 | **0/15** |
| B – zapytaj o adres (warstwa) | 14 | **14/14** | 0,017 / 0,06 | 0,008 / 0,02 / 0,05 (210 ocen) | 1/210 | **0/14** |

- Poziom kategorii (`score`) był inny w 2 z 45 ocen, bez wpływu na wynik.
- Rozkład opcji (`prawdopodobienstwa`) różnił się średnio o 0,001, najwyżej o 0,08.
- Jedna ocena tematu przeszła przez próg 0,6, ale odpowiedzi nie zmieniła.
- Źródło (JEV albo zapas) było takie samo we wszystkich 29 pozycjach. Wynik wzorcowy był taki sam
  w obu przebiegach: A 11/15, B 14/14.
- Opóźnienie: p50 304 i 310 ms, max 589 i 642 ms.
- Wywołań: 60 (2 × 30, w tym po jednym drugim wywołaniu w B).

**Reguła, która z tego wynika.** Na przypiętym modelu powtórka nie zmieniła żadnej końcowej
odpowiedzi (0 z 29). Z reguły trzech: przy 95% pewności przeskakuje mniej niż ok. 10% pozycji.
Pewność wyboru waha się o najwyżej ok. 0,07, a ocena noul o najwyżej ok. 0,05. Dlatego:

- **Na tym samym zbiorze różnica 1 pozycji (2,5–4 pp) to szum**, jeśli ta pozycja ma pewność albo
  noul w odległości do 0,07 od progu. Różnica **2 lub więcej pozycji** to skutek zmiany, a nie
  szum JEV.
- **Między różnymi zbiorami szum jest dużo większy i pochodzi ze zbioru, nie z JEV.** Reguły
  (deterministyczne, kod bez zmian) dają na zbiorach 1–4: warstwa główna 64 / 60 / 68 / 66%,
  „dokładnie” 20 / 27 / 30 / 28%. Różnice do ok. 8–10 pp między zbiorami to więc sama zmiana
  zbioru.
- Dawne porównania „przed/po” na tym samym zbiorze się bronią. Powtórka z #18 (`jev-latest`)
  różniła się jedną pozycją przy średniej |Δ| 0,02, a #146 i #150 opisują przesunięcia pewności
  o 0,02–0,1 przy progu. Tamte wnioski „to pozycja przy progu, nie skutek zmiany” A/A potwierdza.

Wariantu „sam `choice` bez noul” z R7 nie mierzyłem (budżet). Pytanie o interferencję pytań
w jednym zapytaniu zostaje otwarte.

### Zbiór kontrolny nr 4 (świeży, na ślepo, mierzony raz)

`kontrolny4-opisz.json` (40 opisów) i `kontrolny4-zapytaj.json` (35 pytań: 23 pojedyncze,
8 złożonych, 4 spoza zakresu). Napisał je osobny agent bez dostępu do kodu. Weszły bajt w bajt
osobnym commitem (`de8f94a`) przed zmianą pomiaru. Tekstów nie czytałem. Jedyny przebieg na żywo
to `pomiar.ts --na-zywo --zbior kontrolny4` na `main` z całą rundą. Po nim nic nie zmieniałem.
Wywołań: 79 (40 + 35 + 4 drugie wywołania).

Zbieżność: K4-B25 (50 znaków) to dosłownie to samo pytanie co K3-B21. Test zbiorów zwalnia je
tylko z wymogu „inne niż w pozostałych zbiorach”. To 1 z 35 pytań; wynik bez niego może się
różnić o najwyżej 1 pozycję.

**A – „opisz siebie”** (40 opisów), JEV = to, co widzi użytkownik:

| | Reguły | **JEV** |
|---|---|---|
| Profil trafiony | 63% | **85%** |
| – zły profil (inny niż we wzorcu) | 2 | **0** |
| – profil tam, gdzie wzorzec ma null | 1 | 6 |
| – profil bez zmian tam, gdzie wzorzec ma profil | 12 | 0 |
| Potrzeby (10 z twierdzeniem) – P / R / F1 | 78 / 59 / 67% | **78 / 70 / 74%** |
| Potrzeby – F1 na wszystkich 15 | 63% | 66% |
| Kategorie ważne – P / R / F1 | 93 / 69 / 79% | **92 / 80 / 85%** |
| Cały opis zrozumiany dokładnie | 28% | **33%** |
| „Nic nie zrozumiano” tam, gdzie trzeba | 2/2 | 2/2 |
| Bramka zamknięta | – | 2 z 40 (obie na pozycjach `cudza_sytuacja`) |
| Zapas (reguły zamiast JEV) | – | 2/40 (nieczytelna odpowiedź) |

**B – „zapytaj o adres”** (35 pytań):

| | Reguły | **JEV** |
|---|---|---|
| Trafna warstwa główna od razu (albo „nie wiem”) | 66% | **91%** (32/35) |
| Pytania pojedyncze – warstwa główna trafna | 11/23 | **20/23** |
| Pokrycie pytań złożonych (do 3 warstw) | 52% | **60%** |
| Złożone z kompletem tematów | 0/8 | 2/8 |
| Spoza zakresu → „nie wiem” bez dodatków | 4/4 | 4/4 |
| Precyzja warstw | 79% | **88%** |
| Fałszywe dodatki na pojedynczych (pytań) | 2 | 1 |
| Średnio warstw na odpowiedź | 0,90 | 1,10 |
| Zapas (reguły zamiast JEV) | – | 1/35 (nieczytelna odpowiedź) |

**B – dwie propozycje (#156), osobno od odpowiedzi od razu.** Karta pyta „Chodziło Ci o…?”, gdy
pewność wyboru jest w paśmie 0,5–0,9 i rozkład ma dwie warstwy z p ≥ 0,05:

| Pasmo pewności wyboru | Pytań | Warstwa główna trafna od razu | Z propozycjami |
|---|---|---|---|
| > 0,9 (odpowiedź od razu) | 22 | 22/22 | – |
| 0,5–0,9 | 12 | 9/12 | 10 |
| < 0,5 (reguły + tematy JEV) | 1 | 1/1 | – |

- Propozycje pojawiły się w **10 z 35 pytań**. W tych 10 warstwa główna od razu była trafna w 7,
  a **warstwa z wzorca była wśród dwóch propozycji w 9**. Pytań spoza zakresu z propozycjami: 0.
- Cały zbiór B: od razu trafne 32/35 (91%), **po kliknięciu właściwej propozycji 34/35 (97%)**.
  To górna granica: zakłada, że użytkownik kliknie dobrze.
- W 2 pytaniach z pasma propozycji nie było, bo druga warstwa miała p < 0,05.
- Rozkład przyszedł w każdej odpowiedzi (A profil 40/40, B 35/35). Różnica p1 − p2: trafny wybór
  średnio 0,80, błędny 0,51 (n = 3 – za mało na próg).

**Przekrój po cechach** (liczby zbiorcze; cecha ma 3–8 pozycji, więc 1 pozycja = 12–33 pp):

| Cecha | n | Reguły: profil / dokładnie | **JEV: profil / dokładnie** | JEV: potrzeby P / R |
|---|---|---|---|---|
| `profil_glowny` (A) | 8 | 13% / 0% | **100% / 25%** | 83 / 71% |
| `profil_niejasny` (A) | 5 | 80% / 40% | 60% / 20% | 63 / 83% |
| `domownik` (A) | 3 | 100% / 33% | 100% / **67%** | 89 / 100% |
| `cudza_sytuacja` (A) | 3 | 100% / 0% | 67% / 0% | 100 / 50% |

| Cecha | n | Reguły: warstwa główna | **JEV: od razu** | JEV: wzorzec wśród propozycji | JEV: po kliknięciu |
|---|---|---|---|---|---|
| `niejednoznaczne` (B) | 7 | 43% | **71%** (5/7) | 3/3 | 7/7 |
| `zlozone` (B) – pokrycie / precyzja | 8 | 52% / 82% | 60% / 77% | 1/1 | 8/8 (warstwa główna) |
| `spoza` (B) | 4 | 4/4 | 4/4 | – | 4/4 |

- **`profil_glowny`:** JEV trafia profil 8 na 8, reguły 1 na 8 (w 6 zostawiają profil bez
  zmian). Tu działa #155.
- **`profil_niejasny`:** JEV daje profil w 2 z 5 opisów, w których wzorzec ma null. Wszystkie
  6 „pudeł” profilu JEV w całym zbiorze są tego rodzaju (profil tam, gdzie wzorzec ma null). Zły
  profil, czyli inny niż we wzorcu: 0. Tę metrykę ustawia konwencja etykiet (R3 w researchu),
  a przy złym profilu i profilu przy null błąd kosztuje inaczej.
- **`niejednoznaczne`:** tu propozycje robią najwięcej. Od razu 5 z 7, po kliknięciu 7 z 7.
- **`zlozone`:** JEV pokrywa więcej tematów niż reguły (60% vs 52%), ale ma niższą precyzję
  (77% vs 82%). Komplet tylko 2 z 8 – pytania złożone dalej są najsłabsze.

**`cudza_sytuacja` – to pytanie produktowe, nie tylko błąd modelu.** W zbiorze nr 4 te 3 opisy
mają profil null, ale potrzeby opisują drugą osobę („piszę w imieniu taty… szukamy mu”). Autor
zbioru uznał więc, że potrzeby taty się liczą, a jego profil nie. Bramka z #153 robi co innego:
gdy szuka się dla kogoś innego, potrzeby przepadają (zostają tylko te z noul ≥ 0,9).

- W 2 z 3 opisów bramka się zamknęła: profil bez zmian (zgodnie ze wzorcem), ale **0 z 4 potrzeb
  wzorca** (reguły znalazły 2).
- W trzecim bramka została otwarta: JEV znalazł 3 z 3 potrzeb, ale dał też profil (wzorzec: null).
- „Dokładnie” wyszło więc 0 z 3 – i w JEV, i w regułach.

Żadne z tych zachowań nie jest „błędem” bez decyzji, czego chcemy. Gdy ktoś szuka mieszkania dla
taty, który z nim nie zamieszka, czy aplikacja ma ważyć mapę potrzebami taty? Na zbiorze nr 3
(`cudza_sytuacja` 3 z 3 dokładnie) etykiety widocznie miały inną konwencję niż na zbiorze nr 4. Do decyzji Jana. Bez tej
cechy JEV ma „dokładnie” 13 z 37 (35%), a reguły 11 z 37 (30%).

### Porównanie ze zbiorami nr 2 i nr 3

To **inne zbiory** (nr 4 jest większy, z innymi cechami i innym autorem), a reguły z niezmienionym
kodem wahają się między nimi o kilka do kilkunastu pp (pokrycie złożonych: 52–78%). Porównanie wersji przez zbiory to więc
porównanie „mniej więcej”, a nie sparowane.

| | Zbiór nr 2 (#152): reguły / JEV | Zbiór nr 3 (#153): reguły / JEV | **Zbiór nr 4 (#157): reguły / JEV** |
|---|---|---|---|
| A: profil | 67 / 67% | 63 / 80% | **63 / 85%** |
| A: potrzeby F1 (10) | 66 / 81% | 68 / 77% | **67 / 74%** |
| A: pełność potrzeb (R) | 57 / 79% | 63 / 80% | **59 / 70%** |
| A: kategorie F1 | 75 / 81% | 72 / 81% | **79 / 85%** |
| A: dokładnie | 27 / 47% | 30 / 50% | **28 / 33%** |
| B: warstwa główna od razu | 60 / 96% | 68 / 92% | **66 / 91%** |
| B: po kliknięciu propozycji | – | – | **– / 97%** |
| B: pokrycie złożonych | 69 / 69% | 78 / 85% | **52 / 60%** |
| B: precyzja warstw | 94 / 93% | 91 / 100% | **79 / 88%** |
| B: zapas JEV | 2/25 | 6/25 | **1/35** |

Mówiąc wprost:

- **Wybór warstwy i profil się potwierdzają.** Warstwa główna 91% przy regułach 66%, jak 92–96%
  na zbiorach nr 2–3. Profil JEV 85% (najwyżej do tej pory) przy zerze złych profili. To zgodne
  z przeliczeniem #155 na starych zbiorach.
- **„Dokładnie” i potrzeby się nie potwierdzają.** „Dokładnie” 33% zamiast 47–50%, pełność potrzeb
  70% zamiast 79–80%. Przewaga nad regułami w „dokładnie” to 2 opisy z 40 (+5 pp), a nie 20 pp.
  Reguły na zbiorze nr 4 wypadają jak zwykle (28%), więc spadek dotyczy JEV, nie trudności zbioru
  liczonej regułami. Część wyjaśnia `cudza_sytuacja` (0 z 3 z powodu konwencji), ale bez niej
  nadal jest tylko 35%. Profil tu nie przeszkadza (85%). Spadek siedzi w potrzebach: noul dla
  potrzeb ze wzorca średnio 0,75 (w #18: 0,82), a pełność 70%. Dlaczego – bez czytania tekstów
  nie rozstrzygnę.
- **Pytania złożone na zbiorze nr 4 wychodzą słabo w obu systemach** (52% i 60%, komplet 0 i 2
  z 8). JEV jest lepszy o 8 pp – na 8 pytaniach to mniej niż jedno pytanie pokrycia.
- **Zapas spadł do 1/35** (zbiór nr 3: 6/25). Od #156 słaby wybór daje reguły plus tematy JEV.
  W tym przebiegu było tylko 1 pytanie pod 0,5, więc tej zmiany prawie nie widać.
- Przeliczenie progu tematu z tych samych odpowiedzi: 0,7 daje precyzję 97% przy pokryciu 48%,
  a 0,5 – 85% przy 52%. **Progu nie zmieniam** – to byłoby strojenie na zbiorze nr 4.

### Opóźnienie i wywołania

| Przebieg | p50 / p95 / max |
|---|---|
| Zbiór nr 4, A (16 pytań w zapytaniu) | 277 / 366 / 766 ms |
| Zbiór nr 4, B – jedno wywołanie (31) | 324 / 380 / 411 ms |
| Zbiór nr 4, B – z drugim wywołaniem (4) | 646 / 677 / 677 ms |
| Zbiór nr 4, razem (czas na pozycję) | 315 / 646 / 766 ms |
| A/A, przebieg 1 / 2 (czas na pozycję) | 304 / 479 / 589 i 310 / 485 / 642 ms |

Propozycje nie kosztują nic: liczą się z odpowiedzi na pierwsze wywołanie, a klik niczego nie
wysyła. Żadne wywołanie nie przekroczyło 800 ms pośrednika.

**Wywołania na żywo: 139** (budżet 150): A/A 60, zbiór nr 4 – 79. Liczby zbiorcze w tej sekcji
(profil per rodzaj błędu, `cudza_sytuacja`, pasma) pochodzą z tego samego zapisanego przebiegu,
bez nowych wywołań i bez czytania tekstów.

## Szukam dla kogoś (#162)

Pomiar z 2026-10-03, model `jev-1.13.0`. **Decyzja Jana:** gdy ktoś szuka mieszkania dla innej
osoby („piszę w imieniu taty… szukamy mu”, „szukam dla koleżanki, ona…”), mapa liczy profil
i potrzeby osoby, która tam zamieszka. Bramka zamyka się (profil bez zmian, z potrzeb tylko
noul ≥ 0,9) tylko w trzech sytuacjach:

- czysta hipoteza, bez prawdziwego szukania („gdybyśmy kiedyś…”);
- sytuacja, która już nie trwa;
- tekst bez przyszłego mieszkańca, czyli opinia albo ciekawość.

Przed tą zmianą bramka z #153 zamykała się na `cudza_osoba` („szuka dla kogoś, kto z nią nie
zamieszka”). Na zbiorze nr 4 cecha `cudza_sytuacja` wyszła przez to 0 z 3.

### Co się zmieniło

- **`cudza_osoba` → `nikt_nie_szuka`:** „Tekst to tylko opinia albo ciekawość – nikt nie szuka
  mieszkania ani dla siebie, ani dla kogoś innego (np. taty, koleżanki), ani pod wynajem.”
- **`sytuacja_nieaktualna`** zostało bajt w bajt takie samo.
- **Każde twierdzenie ma własny próg.** `nikt_nie_szuka` zamyka bramkę od **0,7**
  (`PROG_NIKT_NIE_SZUKA`), a `sytuacja_nieaktualna` jak dotąd od 0,5.
- **Inwestor:** gdy JEV wybrał profil Inwestor, `nikt_nie_szuka` nie zamyka bramki. To tylko
  zabezpieczenie, bez dodatkowych wywołań (patrz pierwsza wersja niżej).
- **Bez zmian:** pytanie o profil, 10 twierdzeń potrzeb, kategorie i limit 16 pytań. Zmienił się
  tylko tekst jednego pytania z 16.

Dlaczego nie ruszałem profilu ani twierdzeń potrzeb („osoba, która ma tam zamieszkać”)? Na
celowanych zdaniach JEV już opisuje przyszłego mieszkańca: „w imieniu taty” daje Seniora,
a „dla koleżanki” daje Rodzinę. Do tego w #150 zmiana 7 twierdzeń naraz popsuła inne tematy.

Każdego kandydata sprawdzałem w pełnym zapytaniu, z 16 pytaniami (lekcja z #150).

### Dowody bez sieci (zbiór nr 4 – UŻYTY)

Przebieg `k4-157` ma zapytanie bajt w bajt takie jak przed #162. Przeliczenie z obecną bramką
zgadza się z zapisanym wynikiem w 40 z 40 opisów. Warianty bramki liczyłem z tych samych ocen
JEV, bez nowych wywołań. Podaję tylko liczby zbiorcze.

| Wariant (zbiór nr 4, 40 opisów) | Profil | Potrzeby P / R | Dokładnie | Bramka zamknięta | `cudza_sytuacja`: potrzeby R / bramka |
|---|---|---|---|---|---|
| Bramka z #153 | 34/40 | 78 / 70% | 13/40 | 2 | 50% / 2 z 3 |
| Bez `cudza_osoba` (tylko `sytuacja_nieaktualna`) | 33/40 | 78 / 72% | 13/40 | 1 | 67% / 1 z 3 |
| Bez bramki | 33/40 | 78 / 73% | 13/40 | 0 | 83% / 0 z 3 |

Poza cechą `cudza_sytuacja` wszystkie warianty dają ten sam wynik. Zbiór nr 4 nie ma pozycji, na
których bramka by pomagała, więc samo „bez `cudza_osoba`” nie mówi, czy zamknie się na ciekawość.
Do tego potrzebne jest nowe twierdzenie, a więc wywołania na żywo.

### Dowody na żywo – celowane zdania (moje)

**Pierwsza wersja:** „W tekście nie ma nikogo, kto zamieszka w szukanym mieszkaniu – to tylko
opinia albo ciekawość. Szukanie dla kogoś innego (taty, koleżanki) albo zakup na wynajem to nie
to.” Na moich zdaniach działała:

| Zdanie | ocena v1 | wynik |
|---|---|---|
| tata | 0,12 | Senior |
| koleżanka | 0,20 | Rodzina |
| ciekawość | 0,68 | bramka zamknięta |
| domownik | 0,07 | bramka otwarta |
| własna sytuacja | 0,15 | bramka otwarta |

Odrzuciłem ją z dwóch powodów:

- **Inwestor dostał 0,54**, więc bramka by się zamknęła mimo wykluczenia w twierdzeniu.
- **Pozycje `cudza_sytuacja` ze zbioru nr 4** (UŻYTY, 3 wywołania) dostały 0,25 / 0,54 / 0,85,
  a stare `cudza_osoba` miało 0,49 / 0,55 / 0,89. Bramka dalej zamykała się w 2 z 3. JEV
  czytał pierwszą część twierdzenia jako „piszący tam nie zamieszka”.

**Wersja końcowa** (`nikt_nie_szuka`) mówi o braku szukania, a nie o braku mieszkańca:

| Zdanie (pełne zapytanie, 16 pytań) | `nikt_nie_szuka` | `sytuacja_nieaktualna` | Bramka | Wynik |
|---|---|---|---|---|
| „Piszę w imieniu taty. Tata ma 79 lat… Szukamy mu kawalerki blisko przychodni…” | 0,01 | 0,03 | otwarta | **Senior** 0,86; zieleń 0,93 (v1: senior, zdrowie, zieleń) |
| „Szukam mieszkania dla koleżanki z pracy, ona ma dwójkę małych dzieci i psa…” | 0,02 | 0,04 | otwarta | **Rodzina** 0,98; dzieci 0,74, pies 0,95 |
| „Gdybyśmy kiedyś mieli dzieci i psa… na razie nic nie szukamy” (hipoteza) | 0,92 | 0,85 | **zamknięta** | nic |
| „Kiedyś mieszkaliśmy z trójką dzieci i psem… to już nieaktualne” (przeszłość) | 0,75 | 0,91 | **zamknięta** | nic |
| „Kumpel ma trójkę dzieci i psa… Ciekawe, czy to prawda” (ciekawość) | 0,90 | 0,05 | **zamknięta** | tylko pies (0,96 ≥ 0,9) |
| „Mamy z mężem dwójkę dzieci… i psa. Nie mamy samochodu…” (własna) | 0,23 | 0,03 | otwarta | Rodzina; dzieci, pies, bez samochodu |
| „Od wiosny zamieszka z nami moja mama, ma 82 lata…” (domownik) | 0,10 | 0,03 | otwarta | Senior (z mocnej potrzeby); senior, zdrowie (+ dzieci 0,89) |
| „Kupuję kawalerkę pod wynajem dla studentów, sam tam nie zamieszkam” (inwestor) | 0,04 | 0,04 | otwarta | Inwestor |

Dla „taty” w wersji końcowej zapisałem tylko profil, bramkę i początek ocen potrzeb. Lista potrzeb
w nawiasie pochodzi z pierwszej wersji (to samo zdanie, inne tylko twierdzenie bramki). Na
domowniku JEV dokłada „dzieci” (0,89). Tak było też przed #162, bramka nie ma z tym związku.

**Skąd próg 0,7: zbiór do strojenia, nie kontrolny.** Pytałem o 15 opisów z testu A/A (#157).
Zapis tego testu, `aa-157`, ma zapytanie sprzed #162, więc porównanie jest sparowane.

- Ocena `nikt_nie_szuka` dla opisów własnej sytuacji, które nie mówią „szukam”: A25 („Mam 74 lata,
  sama już nie prowadzę…”) **0,50**, A13 0,49, A29 0,46, A07 0,45, A19 0,37.
- Przy progu 0,5 A25 tracił Seniora i dwie potrzeby. To jedyna zmiana wyniku z 15.
- Teksty bez szukania mają 0,75–0,92: hipoteza, przeszłość, ciekawość, a w tym zbiorze A05
  („hej, sprawdzam tylko jak to działa”, 0,87, wzorzec: nic).
- Próg 0,7 leży między tymi grupami, z zapasem 0,2 w dół i 0,05 w górę. Przy przeszłości i tak
  zamyka `sytuacja_nieaktualna`.
- Z progiem 0,7 na tych 15 opisach: **0 z 15 wyników innych niż w A/A**, bramka zamknięta tylko
  na A05.
- A25 przeliczyłem z zapisanych ocen. Po zmianie twierdzenia wszystkie pozostałe oceny są
  w odległości do 0,06 od A/A, a żadna ocena A25 nie leży tak blisko progu.
- Zamiana jednego twierdzenia przesuwa pozostałe oceny (pewność profilu, 10 potrzeb,
  `sytuacja_nieaktualna`) średnio o |Δ| **0,008**, najwyżej o 0,06. To tyle, co szum w A/A
  (0,005–0,008, najwyżej 0,07).

### Zbiory użyte – przed i po (UŻYTE, tylko liczby zbiorcze)

Wszystkie zbiory kontrolne 1–4 są już użyte, więc to nie jest wynik nagłówkowy. Nie czytałem
tekstów pozycji. Pełnej części A żadnego zbioru nie powtarzałem, bo nie mieściła się w budżecie
(45 wywołań). Wziąłem tylko pozycje z cechami, których dotyczy bramka.

**Zbiór nr 4, `cudza_sytuacja`** (3 pozycje, 3 wywołania). „Przed” to zapisany przebieg
`k4-157`: to samo zapytanie, a model jest deterministyczny (A/A).

| `cudza_sytuacja` (n = 3) | Profil | Potrzeby P / R | Dokładnie | Bramka zamknięta |
|---|---|---|---|---|
| Przed (#153), wzorzec jak zapisany | 2/3 | 100 / 50% | 0/3 | 2 |
| **Po (#162), wzorzec jak zapisany** | 1/3 | 100 / 50% | 0/3 | **1** |
| Przed, bez oceny profilu | 3/3 | 100 / 50% | 1/3 | 2 |
| **Po, bez oceny profilu** | 3/3 | 100 / 50% | 1/3 | **1** |

- **Bramka otworzyła się na 1 pozycji.** Na dwóch pozycjach `nikt_nie_szuka` daje 0,03 i 0,04.
  Stare `cudza_osoba` dawało tam 0,89 (bramka zamknięta) i 0,49 (bramka otwarta, ale tylko
  0,01 pod progiem).
- **Trzecia zostaje zamknięta przez `sytuacja_nieaktualna` 0,90.** To twierdzenie się nie
  zmieniło: JEV czyta ten tekst jako sytuację wyobrażoną albo dawną. Przed #162 też miała 0,91,
  a `nikt_nie_szuka` daje jej 0,78. Bez czytania tekstu nie rozstrzygnę, czy JEV ma rację.
- **Dlaczego „profil” spadł z 2/3 do 1/3.** Wzorzec ma tu profil null, a potrzeby drugiej
  osoby. Według nowej decyzji właściwy jest profil przyszłego mieszkańca, więc null we wzorcu to
  konwencja sprzed decyzji, a nie błąd JEV. Otwarta pozycja dostaje Rodzinę (pewność 1,00),
  a wzorzec ma dla niej potrzebę „dzieci”, więc to spójne z regułą. Dlatego podaję też wiersz
  „bez oceny profilu”: tam profil jest 3/3, a „dokładnie” bez zmian, 1/3.
- **Potrzeby się nie poprawiły (R 50%).** Na otwartej pozycji potrzeby wzorca mają dzieci 0,59
  i praca w centrum 0,55, czyli tuż pod progiem 0,6. To już nie bramka, tylko siła twierdzeń
  potrzeb przy tekście o drugiej osobie. Na moich zdaniach widać to samo: „dla koleżanki” daje
  dzieci 0,74–0,77, a własna rodzina 0,98.

**Zbiór nr 3, cechy `cudza_sytuacja`, `gdybanie`, `przeszlosc`, `domownik`** (6 pozycji,
6 wywołań). „Przed” to zapisany przebieg `k3-153` przeliczony obecnym kodem. Ten przebieg miał
jeszcze opisy profilu sprzed #155, więc porównanie jest przybliżone. W zbiorze nr 3 etykiety
`cudza_sytuacja` mają inną konwencję niż w nr 4: profil null i (prawie) bez potrzeb.

| Cecha | n | Przed: profil / dokładnie / bramka | **Po: profil / dokładnie / bramka** |
|---|---|---|---|
| `cudza_sytuacja` (w niej `gdybanie` i `przeszlosc`) | 3 | 3/3 / 3/3 / 2 | 2/3 / 1/3 / 2 |
| `gdybanie` | 1 | 1/1 / 1/1 / zamknięta | 1/1 / 1/1 / zamknięta |
| `przeszlosc` | 1 | 1/1 / 1/1 / otwarta | 1/1 / 0/1 / **zamknięta** |
| `domownik` | 3 | 3/3 / 1/3 / 0 | 3/3 / 1/3 / 0 |

- **`domownik`: bez zmian.** Bramka zamknięta 0 z 3.
- **`gdybanie`: dalej zamyka.**
- **Jedna pozycja się otworzyła** (`nikt_nie_szuka` 0,22, a stare `cudza_osoba` 0,59). Dostaje
  Rodzinę bez potrzeb, a wzorzec zbioru nr 3 ma tu profil null. Jeśli to szukanie dla kogoś, to
  według nowej decyzji Rodzina jest właściwa. Jeśli to sama opinia, to błąd. Bez czytania tekstu
  nie rozstrzygnę.
- **Pozycja `przeszlosc` jest teraz zamknięta** (`nikt_nie_szuka` 0,76, `sytuacja_nieaktualna`
  0,18), a wzorzec ma dla niej bieżącą potrzebę „cisza”. To jedna pozycja, 0,06 nad progiem,
  czyli w paśmie szumu progu. Progu pod nią nie przesuwałem, bo to byłoby strojenie na zbiorze
  kontrolnym. Zostaje jako znane ryzyko: tekst o przeszłości z bieżącym życzeniem, ale bez
  słowa „szukam”.

### Wywołania na żywo

**45 z budżetu 45:**

- pierwsza wersja, razem 12:
  - celowane zdania – 9;
  - zbiór nr 4, `cudza_sytuacja` – 3;
- wersja końcowa, razem 32:
  - celowane zdania – 8;
  - zbiór nr 4, `cudza_sytuacja` – 3;
  - zbiór nr 3, cechy bramki – 6;
  - 15 opisów ze zbioru do strojenia (A/A) – 15;
- 1 wywołanie stracone przez błąd w moim skrypcie (odpowiedź nieodczytana).

Opóźnienie bez zmian: p50 ok. 270–350 ms, max 588 ms.

Przeliczenia bez sieci nic nie kosztowały. To warianty bramki na `k4-157`, próg 0,7 na zapisanych
odpowiedziach i A25.

`aa.ts` i raport `pomiar.ts` (liczba ocen bramki ≥ 0,5) dalej liczą jeden próg `PROG_BRAMKI`
dla obu twierdzeń. To tylko liczba diagnostyczna: wynik pozycji idzie przez `bramkaZamknieta`
z progami per twierdzenie.

## Opisy strukturalne (#163)

Pomiar z 2026-10-03, model `jev-1.13.0`. Punkt R6 z `RESEARCH-JEV.md` i rozszerzenie od Jana:
zwykłe opisy wszystkich warstw.

### Co się zmieniło

1. **Pośrednik (`api/_jev.js`) przyjmuje opisy strukturalne.** Zmiana jest addytywna: zapytania
   z samymi tekstami wyglądają dla JEV tak samo jak wcześniej (test).
   - Opcja `choice` to tekst albo `{ co, nie_dla?, przyklady? }`. Pośrednik przekłada to na
     `{ what, not_for?, examples? }`.
   - Twierdzenie `noul` może mieć `kryteria: { prawda?, falsz? }`, co daje `criteria.true` /
     `criteria.false`. Każda strona to tekst albo obiekt jak wyżej.
   - Każde pole ma do 300 znaków, przykładów może być 1–5. Nieznane pole jest odrzucane.
   - Całe pytania mają do 60 tys. znaków, a ciało funkcji do 64 tys. (było 32 tys.). Zapytanie
     „zapytaj o adres” ma teraz ok. 31 tys. znaków.
   - Odpowiedź nadal przechodzi tylko z id opcji z żądania.
2. **Kształty sprawdzone w dokumentacji i na żywo.** Dokumentacja TypeSafe (`primitives/choice`,
   `primitives/noul`, `primitives/advanced`, `api`) opisuje:
   - opcję jako obiekt z polami `what` / `not_for` / `examples` (nazwy pól są dowolne, „none are
     reserved”);
   - noul z `criteria.true` / `criteria.false` (tekst albo obiekt);
   - zły kształt to błąd 422.

   Jedno wywołanie na żywo z oboma kształtami dało 200 i sensowne odpowiedzi. Z notatkami
   w `RESEARCH-JEV.md` nic się nie kłóci.
3. **Zwykłe opisy wszystkich 108 warstw** (`src/ai/opisyWarstwJev.ts`). Zastąpiły „nazwę
   (jednostkę) + dopisek + pierwsze zdanie opisu z danych”.
   - Każdy opis mówi, co warstwa znaczy dla mieszkańca i na jakie pytania odpowiada.
   - Skróty są rozwinięte (LDWN, SCT, P+R, POZ, MPZP…), jednostki zapisane słowami, bez żargonu
     („oczko siatki”, „H3”, „interferometria”).
   - Dopiski z #147 (park, smog, „słychać tramwaje”…) są wplecione w treść.
   - `public/dane` się nie zmieniło.
   - Test `opisyWarstwJev.test.ts` wymaga wpisu dla każdej warstwy bez atrapy i rozwinięcia
     każdego skrótu z listy obok skrótu.
4. **`nie_dla` i przykłady tylko przy opcjach mylonych w zapisanych przebiegach:**
   - rodzina powodzi (1%, 10%, 0,2% i udział gminy);
   - rodzina powietrza (PM2,5, PM10, NO2, benzo(a)piren, paleniska, przewietrzanie);
   - hałas ↔ przystanek;
   - cena m² ↔ „nie wiem”. Ta para myliła się w każdym ze zbiorów nr 2–4, zawsze jako
     `nie_wiem` zamiast ceny.
5. **Kryteria prawda/fałsz dla 5 tematów ze znanymi fałszywymi dodatkami.** Fałsz to znany
   fałszywy dodatek, prawda to pytanie o sam temat. Twierdzenia zostały bez zmian.
   - komunikacja: tramwaj jako źródło hałasu;
   - sklepy: apteka i lekarz;
   - powietrze: wjazd dieslem do strefy;
   - bezpieczeństwo: bezpieczna jazda rowerem;
   - zieleń: weterynarz.
6. **„Opisz siebie”: kryteria prawda/fałsz dla bramki i dwóch potrzeb.** Twierdzenia zostały
   bez zmian.
   - `nikt_nie_szuka`: fałsz to także własny opis potrzeb bez słowa „szukam”. W #162 taki opis
     dostał 0,50.
   - `sytuacja_nieaktualna`: fałsz to obecny plan, także gdy tekst wspomina przeszłość.
   - `dzieci`: „osoba” to przyszły mieszkaniec, także przy szukaniu dla kogoś. W #162 było tu
     0,59.
   - `bez_samochodu`: najsłabsza potrzeba.
   - `praca_centrum`: kryteria **odrzucone** na zbiorze do strojenia. „Szybki dojazd na AGH”
     spadł z 0,67 do 0,47, a żaden opis nie zyskał.

### Metoda: przed i po w jednym wywołaniu

Dwa pełne przebiegi zbioru nr 5 (przed i po) kosztowałyby ok. 160 wywołań, czyli cały budżet,
bez strojenia. Dlatego `pomiar.ts --przed-po <commit>` wysyła **jedno wywołanie na pozycję**
z pytaniami trzech wersji:

- **przed** – kod z `origin/main` (`fe6843c`), wyciągnięty z repozytorium do plików tymczasowych;
- **po** – ta zmiana;
- **proste** – ta zmiana bez `nie_dla`, przykładów i kryteriów prawda/fałsz, czyli same nowe
  zwykłe opisy.

Pytanie takie samo we wszystkich wersjach JEV ocenia raz, a inne dostaje przedrostek. Każda
wersja przechodzi przez walidację pośrednika osobno i jest przetwarzana własnym kodem. Wersja
„przed” idzie kodem z `main`, także w drugim wywołaniu (#153), więc to sparowane porównanie.

Dlaczego to jest uczciwe:

- według dokumentacji pytania w jednym zapytaniu są niezależne;
- w #162 zamiana jednego twierdzenia przesuwała pozostałe oceny średnio o 0,008, czyli tyle, co
  szum A/A.

Ograniczenie: każda wersja dzieli zapytanie z pytaniami pozostałych, a nie stoi sama. Czasy
tych wywołań nie są czasami aplikacji, bo zapytanie jest ok. 3 razy większe. Czas aplikacji jest
zmierzony osobno, niżej.

### Strojenie (zbiory do strojenia i własne zdania)

Ta sama metoda na zbiorze wzorcowym B (28 pytań), 15 opisach A z testu A/A oraz 12 pytaniach
i 8 opisach napisanych przeze mnie (cechy jak w zbiorze nr 5: bliska pomyłka, w imieniu,
nikt nie szuka). Wszystko liczone na pełnym zapytaniu, 67 wywołań.

| | przed | proste | **po** |
|---|---|---|---|
| A (23): dokładnie | 78% | 78% | **87%** |
| B (40): pojedyncze – warstwa główna | 25/28 | 27/28 | **27/28** |
| B: precyzja warstw | 91% | 95% | 93% |
| B: fałszywe dodatki na pojedynczych | 2 | 1 | 2 |

- Na znanych fałszywych dodatkach oceny tematów spadły:
  - B02 „słychać tramwaje” → komunikacja: 0,09 → 0,03;
  - B26 → sklepy: 0,25 → 0,05;
  - B13 diesel → powietrze: 0,18 → 0,04;
  - B28 → bezpieczeństwo: 0,25 → 0,12;
  - moje „weterynarz” → zieleń: 0,06 → 0,02.
- Prawdziwe tematy wzrosły:
  - B16 komunikacja: 0,62 → 0,90;
  - B21: 0,79 → 0,92;
  - B23 bezpieczeństwo: 0,46 → 0,79, zieleń: 0,53 → 0,70;
  - B27 zieleń: 0,83 → 0,94.
- Zwykłe opisy same naprawiły dwa pytania:
  - B04 „opłaca się kupić pod wynajem”: `nie_wiem` 0,87 → cena 0,57 (z przykładami 0,77);
  - moje pytanie o wjazd starym autem: zapas → Strefa Czystego Transportu 0,81.
- Bramka: mój opis „jeżdżę autem do pracy w Zabierzowie, cisza i zieleń” na `main` zamykał się
  na `nikt_nie_szuka` 0,74. Teraz ma 0,45 i bramka jest otwarta.
- Koszt: moje pytanie „gdzie zostawię auto i przesiądę się do tramwaju” dostało dodatkowo
  przystanek (komunikacja 0,46 → 0,65).

### Wynik nagłówkowy – zbiór kontrolny nr 5 (świeży, na ślepo, mierzony raz)

`kontrolny5-opisz.json` (40 opisów) i `kontrolny5-zapytaj.json` (35 pytań: 23 pojedyncze,
8 złożonych, 4 spoza zakresu).

- Napisał je osobny agent bez dostępu do kodu. Weszły bajt w bajt osobnym commitem przed kodem.
- Otworzyłem je dopiero przy gotowym kodzie, żeby je skopiować i policzyć pozycje i cechy.
- Jeden przebieg: `pomiar.ts --na-zywo --zbior kontrolny5 --przed-po origin/main`. Po nim nic
  w kodzie nie zmieniałem.
- Przebiegi: `przebiegi/k5-przed-163.json`, `k5-po-163.json` i `k5-proste-163.json`.
- JEV oznacza to, co widzi użytkownik: odpowiedź JEV, a pod progiem reguły.

**A – „opisz siebie”** (40 opisów):

| | Reguły | JEV przed | JEV proste¹ | **JEV po** |
|---|---|---|---|---|
| Profil trafiony | 60% | 93% | 93% | **95%** |
| Potrzeby (10 z twierdzeniem) – P / R / F1 | 67 / 65 / 66% | 86 / 90 / 88% | 86 / 90 / 88% | **90 / 88 / 89%** |
| Potrzeby – F1 na wszystkich 15 | 64% | 74% | 74% | 74% |
| Kategorie ważne – F1 | 73% | 81% | 81% | 81% |
| **Cały opis zrozumiany dokładnie** | 35% | 70% (28) | 70% (28) | **78% (31)** |
| „Nic nie zrozumiano” tam, gdzie trzeba | 4/5 | 5/5 | 5/5 | 5/5 |
| Bramka zamknięta | – | 5 | 5 | 3 |

¹ W „opisz siebie” wersja proste to dokładnie zapytanie z `main`, bo nie używa listy warstw.

**B – „zapytaj o adres”** (35 pytań):

| | Reguły | JEV przed | JEV proste | **JEV po** |
|---|---|---|---|---|
| **Trafna warstwa główna od razu** | 37% | 89% (31) | 94% (33) | **97% (34)** |
| Pojedyncze – warstwa główna | 5/23 | 20/23 | 21/23 | **22/23** |
| Pokrycie pytań złożonych | 44% | 56% | 62% | **62%** |
| Złożone z kompletem tematów | 1/8 | 2/8 | 2/8 | 2/8 |
| Spoza zakresu → „nie wiem” bez dodatków | 4/4 | 4/4 | 4/4 | 4/4 |
| Precyzja warstw | 60% | 86% | 86% | 87% |
| Fałszywe dodatki na pojedynczych (pytań) | 2 | 3 | 4 | **5** |
| Zapas (pewność wyboru < 0,5) | – | 4/35 | 2/35 | **1/35** |
| Pewność wyboru > 0,9 | – | 14/35 | 21/35 | **23/35** |
| Po kliknięciu propozycji (#156) | – | 30/35 | 33/35 | **34/35** |

**Przekrój po cechach.** Liczby zbiorcze. Strzałka to zmiana „przed → po”, a w nawiasie liczba
pozycji, które zyskały i straciły.

| Cecha | n | Miara | Przed → **po** | Proste |
|---|---|---|---|---|
| `bliska_pomylka` (A) | 7 | dokładnie | 71% → **86%** (+1 / −0) | 71% |
| `bliska_pomylka` (B) | 5 | warstwa główna | 80% → **100%** (+1 / −0) | 80% |
| `bliska_pomylka` (B) | 5 | fałszywe dodatki | 1 → 2 | 1 |
| `w_imieniu` (A) | 4 | dokładnie; potrzeby P / R | 25% → **50%** (+1 / −0); 82 / 100% → 89 / 89% | 25% |
| `nikt_nie_szuka` (A) | 3 | dokładnie; bramka zamknięta | 100% → 100%; 3 → 2 | 100%; 3 |
| `domownik` (A) | 4 | dokładnie | 50% → 75% (+1 / −0) | 50% |
| `profil_glowny` (A) | 6 | dokładnie | 83% → 83% | 83% |
| `niejednoznaczne` (B) | 4 | warstwa główna | 50% → 75% (+1 / −0) | 75% |
| `zlozone` (B) | 8 | warstwa główna; pokrycie | 88% → 100% (+1); 56% → 62% | 100%; 62% |
| `spoza` (B) | 4 | „nie wiem” | 4/4 → 4/4 | 4/4 |

Pozycja po pozycji (bez tekstów):

- **A:** „dokładnie” +3 / −0. Zyskały po jednej pozycji z cech `bliska_pomylka`, `w_imieniu`
  i `domownik`. Żaden opis nie przeszedł z dokładnego na niedokładny. Zysk w A pochodzi
  wyłącznie z kryteriów prawda/fałsz (wersja proste = przed).
- **B:** warstwa główna +3 / −0. Dwie pozycje zyskały już na zwykłych opisach (`niejednoznaczne`
  i `zlozone`), trzecia (`bliska_pomylka`) dopiero z `nie_dla` i przykładami.
- **Fałszywe dodatki 3 → 5** – to koszt.
  - Obie nowe pozycje to pytania, w których na `main` wybór miał pewność < 0,5 i odpowiadały
    reguły z błędną warstwą. Teraz JEV daje trafną warstwę główną, ale dokłada temat.
  - Raz to hałas: ocena 0,62, temat bez kryteriów i bez zmian.
  - Raz to powietrze: ocena wzrosła z 0,75 do 0,87, a wzorzec mówi „nie powietrze”. Ta pozycja
    ma cechę `bliska_pomylka`.
  - Żadne pytanie nie straciło trafnej warstwy głównej.
- **Bramka** zamknęła się w 3 opisach zamiast 5. Ubyło jedno zamknięcie poza cechą
  `nikt_nie_szuka` i jedno w tej cesze. Wszystkie 3 opisy `nikt_nie_szuka` zostały zrozumiane
  dokładnie w obu wersjach (JEV nic nie wyłapał także przy otwartej bramce).

Mówiąc wprost:

- Według A/A (#157) różnica 2 lub więcej pozycji na tym samym zbiorze to skutek zmiany, a nie
  szum. Tu jest +3 w A i +3 w B, bez żadnej pozycji, która przeszła z trafnej na chybioną.
- Na cechach celu zysk to +2 w `bliska_pomylka` (A + B) i +1 w `w_imieniu`.
- `nikt_nie_szuka` jest bez zmian. Bramka zamyka się rzadziej i nic przez to nie straciła.
- To 40 + 35 pozycji: 1 opis = 2,5 pp, 1 pytanie = 3 pp. Cechy mają 3–8 pozycji, więc
  procenty w przekroju skaczą o 12–33 pp na pozycję.
- **Który kawałek pomógł (przekrój pomocniczy):**
  - same zwykłe opisy warstw dają w B +2 pozycje warstwy głównej (89% → 94%), mniej zapasów
    (4 → 2) i więcej pewnych wyborów (14 → 21 powyżej 0,9);
  - `nie_dla` i przykłady dokładają w B +1 (`bliska_pomylka`);
  - kryteria prawda/fałsz dają całe +3 w A;
  - zwykłe opisy kosztują 1 fałszywy dodatek, a struktura drugi.
- Zbiór nr 5 wypada dla JEV wyraźnie lepiej niż nr 4 (dokładnie 70% vs 33% przed tą zmianą),
  a dla reguł gorzej (warstwa główna 37% vs 66%). To inny zbiór. Porównanie przed i po na tym
  samym zbiorze jest sparowane, ale poziomów nie da się wprost zestawić z #157.

### Opóźnienie

| Zapytanie | p50 / p95 / max |
|---|---|
| Aplikacja po #163, „zapytaj o adres” (5 pytań ze starego B, osobne wywołania) | 399 / 552 / 552 ms |
| Dla porównania: A/A przed #163 (#157, 14 pytań B + 15 opisów A) | 304–310 / 479–485 / 589–642 ms |
| Zbiór nr 5, wywołanie z trzema wersjami naraz: A / B | 286 / 420 / 496 ms; 581 / 1014 / 1015 ms |

- Zapytanie „zapytaj o adres” ma teraz ok. 31 tys. znaków, a wcześniej ok. 23 tys.
- Na 5 pytaniach p50 wyszło ok. 90 ms więcej niż w A/A. To mała próbka i inny dzień, więc
  traktuję to jako możliwy koszt rzędu 0,1 s.
- Wszystkie odpowiedzi w aplikacji zmieściły się w 800 ms pośrednika.
- „Opisz siebie” ma zapytanie większe o ok. 2 tys. znaków, więc praktycznie bez zmian.

### Wywołania na żywo

**158 z budżetu 160:**

- weryfikacja kształtów API – 1;
- próba trybu `--przed-po` – 2;
- strojenie – 67 (23 opisy + 40 pytań + 4 drugie wywołania);
- zbiór nr 5 – 83 (75 pozycji + 8 drugich wywołań: po 4 dla starych i nowych opisów);
- czas aplikacji – 5.

### Decyzja

**Zostaje.** Warunek był taki: po lepsze od przed o ≥ 2 pozycje na cechach celu, bez strat gdzie
indziej.

- Cechy celu: +3 (`bliska_pomylka` +2, `w_imieniu` +1).
- Całość: A +3, B +3, żadna pozycja nie przeszła z trafnej na chybioną.
- Jedyna strata to 2 fałszywe dodatki więcej. Oba są na pytaniach, które zyskały trafną warstwę
  główną.
- Próg tematu i pozostałe progi bez zmian.

**Po pomiarze, przy scalaniu:** na `main` w trakcie zadania doszło 12 warstw (uzbrojenie terenu,
drogi gruntowe, nocne światło, przestępstwa i wykrywalność w powiecie, zabytki z rejestru,
wydarzenia w dużych obiektach, wnioski „Czyste Powietrze”). Test pokrycia wymaga dla nich
opisów, więc dopisałem 12 zwykłych zdań (samo `co`, bez `nie_dla` i przykładów). To nie jest
strojenie – opisów pozostałych warstw, kryteriów ani progów nie ruszałem. Lista dla JEV ma
teraz 120 warstw zamiast 108, więc w aplikacji wybór ma 12 opcji więcej niż w pomiarze (tak jak
warstwy Sejmu w #152). Zapytanie ma ok. 33 tys. znaków.

## Duża walidacja (#170)

Pomiar z 2026-10-03, model `jev-1.13.0`, kod z `origin/main` = `ba69cfd` (wersja końcowa, z #163).
W kodzie aplikacji nic tu nie zmieniałem – tylko pomiar. Budżet JEV przestał być ograniczeniem,
więc zadanie robi trzy rzeczy, których wcześniej nie dało się zrobić:

- zbiór nr 5 przed i po #163 w dwóch osobnych, pełnych przebiegach;
- A/A i opóźnienie na końcowym zapytaniu;
- duży zbiór kontrolny nr 6 (150 + 150), pierwszy na tyle liczny, żeby podawać wynik
  z przedziałem ufności.

Części (a) i (b) zmierzyły dwa osobne okna. Ich raporty i skrypty są poza repo, a przebiegi
w `przebiegi/` (tabela na końcu pliku).

**Wywołania na żywo tego dnia: 702.**

- zbiór nr 6 – 309: 150 opisów, 150 pytań i 9 drugich wywołań;
- zbiór nr 5 osobno – 158 (2 × 79);
- A/A i opóźnienie – 235.

Inne okna wołały JEV w tym samym czasie. Wszystkie trzy skrypty ponawiały 429, 5xx, błąd sieci
i timeout z rosnącym odstępem i nie liczyły nieudanych prób jako odpowiedzi. **Ponowień było 0
na 702 wywołania.**

### (a) Zbiór nr 5: osobne przebiegi zamiast wspólnego zapytania z #163

#163 mierzył przed i po w **jednym** wywołaniu na pozycję (pytania obu wersji w jednym
zapytaniu). Teraz to dwa zwykłe przebiegi `pomiar.ts --na-zywo --zbior kontrolny5`:

- PRZED – kod z `baa4353`, czyli bez #163;
- PO – `ba69cfd`.

Każde zapytanie niesie tylko pytania swojej wersji, a oba przebiegi szły w tym samym czasie.

| | PRZED osobno | **PO osobno** | #163 wspólne: przed → po |
|---|---|---|---|
| A: profil | 95% | 95% | 93% → 95% |
| A: potrzeby P / R / F1 | 86 / 88 / 87% | 89 / 86 / 88% | 86/90/88 → 90/88/89% |
| **A: cały opis dokładnie** | 68% (27) | **75% (30)** | 70% (28) → 78% (31) |
| A: bramka zamknięta | 4 | 4 | 5 → 3 |
| **B: trafna warstwa główna od razu** | 91% (32) | **94% (33)** | 89% (31) → 97% (34) |
| B: surowy wybór JEV (bez progu 0,5) | 33/35 | 35/35 | 33/35 → 35/35 |
| B: pokrycie złożonych | 56% | 62% | 56% → 62% |
| B: precyzja warstw | 86% | 86% | 86% → 87% |
| B: fałszywe dodatki na pojedynczych | 3 | 4 | 3 → 5 |
| B: zapas (pewność < 0,5) | 2/35 | 2/35 | 4/35 → 1/35 |
| B: pewność wyboru > 0,9 | 14/35 | 24/35 | 14/35 → 23/35 |
| B: po kliknięciu propozycji | 33/35 | 32/35 | 30/35 → 34/35 |

**Wynik: A potwierdzone, B potwierdzone częściowo.**

- **A: +3 / −0, te same trzy pozycje co w #163** (K5-A01, A08, A22; cechy `w_imieniu`,
  `domownik`, `bliska_pomylka`). Oba poziomy są o 1 opis niższe niż w #163. Powód to K5-A37
  (`praca_centrum` 0,55–0,57 przy progu 0,6, w #163 było 0,62) – to pozycja na progu, a nie
  różnica wersji.
- **B: +2 / −1 zamiast +3 / −0.**
  - Pewne są zyski K5-B18 i B30. Pojawiają się w obu metodach i w surowym wyborze.
  - K5-B35 (`bliska_pomylka`, jedyny zysk, który #163 przypisał `nie_dla` i przykładom) się
    nie powtórzył: pewność 0,53 w #163, a teraz 0,46.
  - Strata K5-B29 to ten sam rodzaj szumu: surowy wybór jest trafny we wszystkich czterech
    przebiegach, a pewność skacze od 0,46 do 0,62 wokół progu.
  - Bez progu (surowy wybór) obie metody dają to samo: 33 → 35, zero strat.
- **Koszt się potwierdza, ale mniejszy:** fałszywe dodatki 3 → 4, a nie 3 → 5. Pewny jest
  dodatek na K5-B30.
- **Decyzja z #163 („zostaje”) stoi.** Liczby się zmieniają: na zbiorze nr 5 wersja po #163 ma
  w osobnym przebiegu **94% (33/35)** warstwy głównej, a nie 97%, i **75%** „dokładnie”, a nie 78%.
- **Wniosek o metodzie.** Wspólne zapytanie dobrze mierzy wybory JEV (zgodne w 69/70 pytań
  i 78/80 profili) i oceny noul (|Δ| ok. 0,005–0,009, tyle co szum). Liczby zależne od progu
  pewności (warstwa główna z zapasem, zapas, propozycje) mają w nim niepewność ±1–2 pozycje.
  Pewność wyboru w wersji „przed”, która stała w zapytaniu obok dwóch innych pytań o warstwę,
  wahała się średnio o 0,065, a w „po” o 0,033. Tu obie różnice wypadły na korzyść „po”, ale dwie
  pozycje to za mało, żeby to nazwać stronniczością metody. **Do liczb nagłówkowych – osobne
  przebiegi.**

### (b) A/A i opóźnienie na końcowym zapytaniu

Skrypt A/A wziął pełne zbiory do strojenia (30 opisów, 28 pytań), a nie co drugą pozycję jak
w #157. Przebiegi były trzy (r1, r2, r3) i każdy szedł tą samą ścieżką co aplikacja. Timeout
pośrednika podniósł do 10 s, żeby zobaczyć cały ogon opóźnień. Żadne wywołanie nie przekroczyło
800 ms, więc wynik jest taki, jaki dałaby produkcja.

| r1 vs r2 | n | wybór (`choice`) taki sam | \|Δ pewności\| średnio / max | \|Δ noul\| średnio / max | końcowa odpowiedź inna | wynik wzorcowy r1 / r2 |
|---|---|---|---|---|---|---|
| A – opisz siebie | 30 | **30/30** | 0,009 / 0,12 | 0,008 / 0,07 | 4/30 | 23 / 22 |
| B – zapytaj o adres | 28 | **28/28** | 0,007 / 0,03 | 0,006 / 0,05 | 1/28 | 28 / 28 |

- **Wybór JEV jest powtarzalny:** 58/58 w każdej parze przebiegów, także w drugim wywołaniu.
- **Pełna odpowiedź końcowa już nie zawsze.** W każdej parze różni się 4–5 z 58 pozycji,
  a w trzech przebiegach 7 z 58 (12%) dało choć raz inną odpowiedź. W #157 było 0 z 29.
  Najczęstsze źródło to pewność poziomu kategorii przy progu 0,6, głównie `kat_transport`
  (0,55–0,62 w tym zbiorze). Rzadziej noul potrzeby przy 0,6, bramka przy 0,7, temat przy 0,6
  i pewność przy 0,9 (propozycje).
- **Wynik wzorcowy** („dokładnie” w A, warstwa główna w B) zmienia się o 0–1 pozycję na parę,
  zawsze ta sama pozycja (A16). Warstwa główna B nie zmieniła się ani razu.
- **Reguła z #157 po korekcie:**
  - różnica 1 pozycji to szum;
  - różnica 2 lub więcej pozycji to skutek zmiany tylko wtedy, gdy te pozycje nie leżą przy
    progu. Pas „przy progu” to teraz **±0,10**, a nie ±0,07 (max |Δ noul| 0,09, a pewności 0,12);
  - gdy porównujemy całe odpowiedzi (z kategoriami), skutek zaczyna się dopiero od ok. 6–7 z 58.

**Opóźnienie i ryzyko timeoutu** (czas `obsluz`, z lokalnego Maca prosto do JEV):

| Wywołanie | n | p50 | p95 | max | > 800 ms |
|---|---|---|---|---|---|
| Opisz siebie (A/A i powtórki) | 103 | 281 ms | 361 ms | 461 ms | 0 |
| Zapytaj o adres, pierwsze wywołanie | 103 | 346 ms | 385 ms | 564 ms | 0 |
| Zapytaj o adres, samo drugie wywołanie | 17 | 286 ms | 339 ms | 339 ms | 0 |
| Pytanie z drugim wywołaniem, oba po kolei | 17 | 631 ms | 826 ms | 826 ms | – (każde z dwóch < 800 ms) |
| Zbiór nr 6 (to zadanie), A | 150 | 274 ms | 334 ms | 498 ms | 0 |
| Zbiór nr 6, B, pytania z jednym wywołaniem | 141 | 363 ms | 536 ms | 730 ms | 0 |
| Zbiór nr 6, B, pytania z dwoma wywołaniami | 9 | 634 ms | 1016 ms | 1016 ms | – (każde z dwóch < 800 ms) |
| Zbiór nr 5 osobno, pojedyncze wywołanie (PRZED / PO) | 79 / 79 | 313 / 310 ms | 407 / 399 ms | 644 / 578 ms | 0 |

- **Timeoutu nie było w żadnym z 702 wywołań tego dnia.** Zbiór nr 6 szedł z prawdziwym limitem
  pośrednika 800 ms: 0 nieudanych prób. Z 291 pojedynczych wywołań ponad 600 ms były 3, ponad
  700 ms – 1 (730 ms).
- **Zapas do limitu jest jednak niewielki:** ok. 240 ms od najgorszego wyniku w A/A, 70 ms od
  najgorszego w zbiorze nr 6 i ok. 400 ms od p95 dla „zapytaj o adres”.
- **Czego tu nie zmierzyliśmy:**
  - zimnego startu funkcji na Vercelu;
  - sieci przeglądarka → Vercel (ta zjada zapas klienta 1,5 s, nie limit 800 ms);
  - odległości regionu funkcji od JEV. Ta wchodzi wprost w limit 800 ms, więc pierwszy pomiar
    z produkcji jest potrzebny, zanim uznamy ryzyko za zerowe.
- Pytanie z drugim wywołaniem trwa ok. 0,6 s, w najgorszym przypadku 1,0 s. To dwa osobne limity
  po 800 ms, więc nie timeout, tylko dłuższe czekanie (9 z 150 pytań w zbiorze nr 6).
- **Rozmiar zapytania** (z pola `usage` w odpowiedzi JEV):
  - „zapytaj o adres” – ok. 33,7 tys. znaków, czyli ok. **14,4 tys. tokenów** wejścia;
  - „opisz siebie” – 4,6 tys. znaków, czyli 1,9 tys. tokenów.
  - Polski JSON ma ok. 2,3–2,5 znaku na token, a nie 4. P50 „zapytaj o adres” jest mimo to
    tylko o ok. 50–90 ms wyższe niż „opisz siebie”.

### (c) Wynik nagłówkowy – zbiór kontrolny nr 6 (na ślepo, 150 + 150, mierzony raz)

`kontrolny6-opisz.json` ma 150 opisów i `kontrolny6-zapytaj.json` 150 pytań: 105 pojedynczych,
30 złożonych i 15 spoza zakresu.

- Napisały je na ślepo dwa osobne agenty AI, bez dostępu do kodu, poleceń i poprzednich zbiorów.
- Pliki weszły bajt w bajt osobnym commitem (`1f612db`), zanim poszło pierwsze wywołanie.
- Tekstów nie czytałem. Z pozycji widziałem tylko id, cechy i etykiety w liczbach zbiorczych.
- Jeden przebieg: `pomiar.ts --na-zywo --zbior kontrolny6`, czyli 309 wywołań bez ponowień.
  Przebieg pozycja po pozycji jest w `przebiegi/k6-170.json`, a `--z-pliku` odtwarza z niego
  wszystkie liczby bez sieci.
- Po pomiarze nic nie zmieniałem.
- JEV oznacza to, co widzi użytkownik: odpowiedź JEV, a pod progiem reguły.
- W nawiasach kwadratowych podaję **95% przedział ufności Wilsona**.
- „Pary niezgodne” to porównanie sparowane na tych samych pozycjach: w ilu pozycjach trafia tylko
  JEV, a w ilu tylko reguły. p to dokładny test McNemara.

**A – „opisz siebie”** (150 opisów):

| | Reguły | **JEV** | tylko JEV / tylko reguły | p |
|---|---|---|---|---|
| **Profil trafiony** | 72% [64–79%] (108) | **85% [79–90%]** (128) | 33 / 13 | 0,005 |
| **Cały opis zrozumiany dokładnie** | 47% [39–55%] (70) | **61% [53–69%]** (92) | 44 / 22 | 0,009 |
| Potrzeby (10 z twierdzeniem) – precyzja¹ | 77% [69–83%] | 79% [72–84%] | | |
| Potrzeby – pełność¹ | 69% [62–76%] | **84% [78–89%]** | | |
| Potrzeby – F1 (10) | 73% | **81%** | | |
| Potrzeby – F1 na wszystkich 15 | 72% | 71% | | |
| Kategorie ważne – P / R / F1 | 83 / 77 / 80% | 93 / 77 / 85% | | |
| „Nic nie zrozumiano” tam, gdzie trzeba | 12/18 | 16/18 | | |
| Bramka zamknięta | – | 12 (9 z 10 pozycji `nikt_nie_szuka`) | | |
| Zapas (JEV bez pewnej odpowiedzi → reguły) | – | 11/150, z tego 8 na `bez_sygnalu` (wzorzec: nic) | | |

¹ Liczone na potrzebach, a nie na opisach (kilka potrzeb na opis), więc przedział jest tylko
przybliżony.

**B – „zapytaj o adres”** (150 pytań):

| | Reguły | **JEV** | tylko JEV / tylko reguły | p |
|---|---|---|---|---|
| **Trafna warstwa główna od razu (albo „nie wiem”)** | 37% [29–45%] (55) | **97% [93–99%]** (146) | 92 / 1 | < 0,001 |
| Pojedyncze – warstwa główna | 29% [21–38%] (30/105) | **98% [93–99%]** (103/105) | 73 / 0 | < 0,001 |
| Złożone – trafiony choć jeden temat | 60% [42–75%] (18/30) | **100% [89–100%]** (30/30) | 12 / 0 | < 0,001 |
| Spoza zakresu → „nie wiem” | 47% [25–70%] (7/15) | 87% [62–96%] (13/15) | 7 / 1 | 0,07 |
| Pokrycie pytań złożonych (do 3 warstw)² | 38% | **61%** | | |
| Złożone z kompletem tematów | 7% [2–21%] (2/30) | 23% [12–41%] (7/30) | | |
| Precyzja warstw¹ | 57% [48–66%] | **87% [81–91%]** | | |
| Fałszywe dodatki na pojedynczych (pytań) | 7 z 105 | **15 z 105** | | |
| Średnio warstw na odpowiedź | 0,76 | 1,23 | | |
| Surowy wybór JEV (bez progu 0,5) | – | 99% (149/150) | | |
| Zapas (pewność < 0,5 → reguły + tematy JEV) | – | 6/150 | | |
| Drugie wywołanie (#153) | – | 9/150 | | |

² Średnia ułamków tematów, a nie proporcja pozycji, więc bez przedziału.

**Dwie propozycje (#156) – od razu i po kliknięciu:**

| Pasmo pewności wyboru | Pytań | Warstwa główna trafna od razu | Z propozycjami |
|---|---|---|---|
| > 0,9 (odpowiedź od razu) | 117 | 117/117 | – |
| 0,5–0,9 | 27 | 26/27 | 19 |
| < 0,5 (reguły + tematy JEV) | 6 | 3/6 | – |

- Propozycje pojawiły się w 19 pytaniach. **W 19 z 19 warstwa z wzorca była wśród dwóch**
  [83–100%]. W żadnym pytaniu spoza zakresu propozycji nie było.
- Od razu trafne jest 146/150, **po kliknięciu też 146/150**. We wszystkich 19 pytaniach
  z propozycjami warstwa główna była już trafna, więc na tym zbiorze klik niczego nie dodaje. Na
  zbiorze nr 4 dodawał 2 pytania, a na zbiorze nr 5 w #163 – 0.
- Pasmo > 0,9 to 78% pytań, wszystkie trafne. Tam odpowiedź od razu jest bezpieczna.

**Przekrój po cechach** (liczby zbiorcze; przy n ≤ 25 jedna pozycja to co najmniej 4 pp,
więc różnice kilku punktów w cesze to szum):

| Cecha (A) | n | Reguły: profil / dokładnie | **JEV: profil / dokładnie** | JEV: potrzeby P / R |
|---|---|---|---|---|
| `zwykly` | 60 | 78% / 50% | 85% / 55% | 80 / 85% |
| `bez_diakrytykow` | 71 | 66% / 51% | 85% / 58% | 74 / 79% |
| `bliska_pomylka` | 25 | 64% / 24% | **76% / 60%** | 81 / 74% |
| `profil_glowny` | 20 | 55% / 50% | **85% / 70%** | 71 / 91% |
| `w_imieniu` | 15 | 47% / 33% | **80% / 53%** | 88 / 88% |
| `domownik` | 12 | 92% / 58% | 92% / 50% | 75 / 83% |
| `nikt_nie_szuka` | 10 | 80% / 50% | **100% / 90%** | – |
| `bez_sygnalu` | 8 | 100% / 88% | 100% / 88% | – |
| `krotki` / `dlugi` | 4 / 3 | 50% / 50%; 33% / 0% | 100% / 75%; 67% / 0% | – |

| Cecha (B) | n | Reguły: warstwa główna | **JEV: warstwa główna** | Reguły / JEV: precyzja | Uwagi |
|---|---|---|---|---|---|
| `jeden_temat` | 70 | 29% | **100%** | 48 / 89% | 9 fałszywych dodatków JEV |
| `zlozone` | 30 | 60% | **100%** | 79 / 88% | pokrycie 38% → **61%** |
| `bliska_pomylka` | 20 | 15% | **100%** | 36 / 87% | 3 fałszywe dodatki JEV |
| `dwa_z_tematu` | 17 | 82% | **100%** | 89 / 95% | pokrycie 50% → 62% |
| `niejednoznaczne` | 15 | 47% | **87%** | 70 / 76% | 3 fałszywe dodatki JEV; 2 chybione to pewność < 0,5 |
| `spoza` | 15 | 47% | **87%** | – | 2 chybione: jedno pewne (0,71), jedno `nie_wiem` 0,49 |

**Opóźnienie (zbiór nr 6, czas na pozycję):** A 274 / 334 / 498 ms, B 366 / 632 / 1016 ms,
razem p50 326 / p95 537 / max 1016 ms. Wartości ponad 800 ms to pytania z dwoma wywołaniami (patrz (b)).

**Na tle zbiorów nr 4 i 5.** To inne zbiory, więc porównanie jest przybliżone:

- **Warstwa główna od razu, JEV:** 91% na zbiorze nr 4, 94% na nr 5 (osobno) i 97% [93–99%] na
  nr 6. Reguły mają 66%, 37% i 37%.
- **„Dokładnie”, JEV:** 33% na zbiorze nr 4, 75% na nr 5 i 61% [53–69%] na nr 6. Reguły mają
  28%, 35% i 47%.

Na zbiorze nr 6 reguły w „opisz siebie” wypadają wyraźnie lepiej niż kiedykolwiek, a w „zapytaj
o adres” tak źle jak na zbiorze nr 5. Poziom zależy więc mocno od autora zbioru. Dlatego
w zdaniach na zewnątrz podajemy nazwę zbioru i przedział.

### (d) Bilans – co JEV robi wyraźnie lepiej, gdzie remis, co jest słabe

**Wyraźnie lepiej** – przedziały się nie nakładają albo test sparowany daje p < 0,01:

- **Wybór danych do pytania:** 97% [93–99%] wobec 37% [29–45%]. W 92 pytaniach trafia tylko JEV,
  w 1 tylko reguły. Ta przewaga powtarza się na każdym zbiorze od nr 2.
- **Pytania z bliską pomyłką, potoczne i niejednoznaczne:** `bliska_pomylka` 100% wobec 15%,
  `niejednoznaczne` 87% wobec 47%.
- **Profil:** 85% [79–90%] wobec 72% [64–79%], p = 0,005. JEV wygrywa zwłaszcza tam, gdzie profil
  wynika z kontekstu (`profil_glowny`, `w_imieniu`).
- **Cały opis dokładnie:** 61% [53–69%] wobec 47% [39–55%], p = 0,009. Przedziały lekko się
  nakładają, ale na tych samych opisach JEV wygrywa 44 do 22.
- **Pełność potrzeb:** 84% wobec 69%.
- **Precyzja warstw:** 87% wobec 57%.
- **Pokrycie pytań złożonych:** 61% wobec 38%.

**Remis albo różnica w granicach szumu:**

- precyzja potrzeb: 79% wobec 77%;
- F1 na wszystkich 15 potrzebach: 71% wobec 72%. Pięć potrzeb bez twierdzenia JEV pokrywa tylko
  pośrednio;
- zwykłe opisy bez pułapek: „dokładnie” 55% wobec 50%;
- `domownik`: 50% wobec 58%, n = 12 – tu reguły są o jeden opis lepsze;
- spoza zakresu: 87% wobec 47%, ale n = 15 i p = 0,07, więc nie rozstrzygnięte;
- „dokładnie” to nie jest dominacja. W 22 opisach dokładne są tylko reguły.

**Znane słabości:**

1. **Pytania o kilka rzeczy naraz.** Komplet tematów JEV daje tylko w 7 z 30 pytań (23%
   [12–41%]), choć reguły dają 2 z 30. Odpowiedź ma najwyżej 3 warstwy, a tematy często nie
   przechodzą progu.
2. **Fałszywe dodatki.** Do 15 ze 105 pojedynczych pytań (co siódmego) JEV dokłada warstwę spoza
   pytania, a reguły do 7.
   - Przeliczenie z tych samych odpowiedzi: przy progu tematu 0,7 byłoby ich 7, a przy 0,8 – 3,
     bez straty pokrycia na tym zbiorze.
   - **Progu nie zmieniłem**, bo to byłoby strojenie na zbiorze nr 6. To kandydat na osobne
     zadanie, sprawdzone na nowym zbiorze.
3. **Próg 0,5 wyrzuca trafne wybory.** We wszystkich 6 pytaniach pod 0,5 surowy wybór JEV był
   trafny, a reguły z tematami trafiły w 3. Surowy JEV ma 99%, a to, co widzi użytkownik, 97%.
   Ten sam wzór był na zbiorze nr 5 (B29, B35).
4. **Bramka zamyka się czasem bez powodu.** Na 10 opisów `nikt_nie_szuka` zamknęła się 9 razy,
   i to dobrze. Zamknęła się też 3 razy poza tą cechą, na opisach z prawdziwym profilem
   (`nikt_nie_szuka` 0,72–0,85 przy progu 0,7).
5. **Spoza zakresu:** 2 z 15 chybione.
   - Raz JEV był pewny złej warstwy (0,71).
   - Raz wybrał „nie wiem”, ale z pewnością 0,49. Wtedy odpowiadają reguły z tematami, które
     dołożyły 3 warstwy.
6. **Szum odpowiedzi końcowej (A/A):** ok. 9% pozycji zmienia odpowiedź między identycznymi
   przebiegami. Głównie chodzi o kategorie przy progu pewności 0,6. Wynik nagłówkowy waha się
   przez to o ok. ±1–2 pozycje.
7. **Ograniczenia samego pomiaru.**
   - Zbiory i etykiety pisały agenty AI, a nie ludzie.
   - Konwencja etykiet (np. profil null) różni się między autorami.
   - Czas mierzyliśmy lokalnie, a nie z produkcji.

### Wywołania na żywo

**309 z budżetu 450** – jeden przebieg zbioru nr 6, bez ponowień i bez timeoutów. Przebieg samych
reguł na zbiorze nr 6 (`pomiar.ts --zbior kontrolny6`) nic nie kosztował. Części (a) i (b) to
inne okna: 158 i 235 wywołań.

`pomiar.ts` ma teraz:

- `--zbior kontrolny6`;
- ponawianie 429, 5xx, timeoutu i błędu sieci (do 6 prób, odstęp 1–30 s). Nieudana próba nie jest
  odpowiedzią, a ponowienia są zapisane przy pozycji (`ponowienia`) i w podsumowaniu
  (`nieudane`);
- sekcję raportu z przedziałami Wilsona i testem McNemara (`wilson`, `mcnemar`).

## Próg tematu (#173)

**`PROG_TEMATU` 0,6 → 0,7.** Nic więcej się nie zmienia: pasmo wyboru głównego, propozycje
i „opisz siebie” zostają bez zmian. Ten sam próg dalej uruchamia drugie wywołanie (#153), bo to
bezpośrednie użycie `PROG_TEMATU`. `PROG_DRUGIEJ` (pewność drugiego wyboru) zostaje 0,6.

**Problem.** Na zbiorze nr 6 JEV dokładał zbędną warstwę do 15 ze 105 pojedynczych pytań (#170).
Tam progu nie zmieniałem, żeby nie stroić pod zbiór nr 6.

### Metoda: tylko zbiory użyte, bez nowych wywołań

Zapisane przebiegi mają oceny noul wszystkich tematów. Wynik przy innym progu składam od nowa
bieżącym kodem (`przetworzWiele`, a pod progiem pewności `regulyZTematami`). Drugie wywołanie
odtwarzam z zapisu tylko wtedy, gdy jego temat nadal przechodzi próg.

- Zbiory: do strojenia (B, 28 pytań, oba przebiegi A/A z #170) oraz kontrolne nr 2–6.
- Zbioru nr 7 nie otwierałem. Na nim osobny agent zmierzy tę zmianę na ślepo.
- Zgodność odtworzenia przy 0,6 z tym, co pokazano na żywo: zbiory nr 4–6 – 100%. Na zbiorach
  nr 2 i 3 różnią się po 2 pytania, bo kod zmienił się od tamtych pomiarów (#156 R5).
- Zbiory nr 2–4 zmierzono jeszcze ze starszymi twierdzeniami tematów (przed #163), więc ich
  noul jest tylko przybliżeniem dzisiejszego.

### Krzywa: fałszywe dodatki kontra pokrycie pytań złożonych

FD = pojedyncze pytania z fałszywym dodatkiem; pokr. = pokrycie tematów w pytaniach złożonych.

| próg | strojenie r1 / r2: FD, pokr. | nr 2: FD, pokr. | nr 3: FD, pokr. | nr 4: FD, pokr. | nr 5: FD, pokr. | nr 6: FD, pokr. | **razem nr 2–6: FD, pokr., komplet** |
|---|---|---|---|---|---|---|---|
| 0,60 (było) | 0/17, 88% / 81% | 2/15, 69% | 0/13, 85% | 1/23, 60% | 4/23, 63% | 15/105, 61% | **22/179, 65,6%, 19/62** |
| 0,65 | 0/17, 81% / 81% | 2/15, 69% | 0/13, 85% | 1/23, 60% | 3/23, 63% | 14/105, 61% | 20/179, 65,6%, 19/62 |
| **0,70** | 0/17, 81% / 81% | 1/15, 64% | 0/13, 85% | 1/23, 54% | 3/23, 63% | 7/105, 61% | **12/179, 64,2%, 18/62** |
| 0,75 | 0/17, 81% / 81% | 1/15, 64% | 0/13, 85% | 1/23, 54% | 3/23, 63% | 7/105, 61% | 12/179, 64,2%, 18/62 |
| 0,80 | 0/17, 76% / 76% | 1/15, 64% | 0/13, 76% | 1/23, 54% | 3/23, 56% | 3/105, 59% | 8/179, 61,3%, 15/62 |
| 0,85 | 0/17, 71% / 71% | 1/15, 60% | 0/13, 70% | 1/23, 54% | 2/23, 56% | 2/105, 58% | 6/179, 59,1%, 13/62 |
| 0,90 | 0/17, 71% / 71% | 0/15, 60% | 0/13, 65% | 1/23, 54% | 2/23, 56% | 1/105, 56% | 4/179, 57,5%, 11/62 |

Warstwa główna na pytaniach pojedynczych prawie stoi w miejscu: 171/179 przy 0,6, 170/179 przy
0,7, 168/179 przy 0,9. Próg zmienia ją tylko w zapasie, gdy reguły nie dały nic. Pytania spoza
zakresu z dodatkami (zbiór nr 6): 2 przy 0,6, 1 od 0,65.

**Dlaczego 0,7.** Pojedyncze dodatki z tematów (zbiór do strojenia r2 i nr 2–6, pytania w zakresie):

| noul dodatku | trafne | fałszywe |
|---|---|---|
| 0,60–0,69 | 4 | **14** |
| 0,70–0,79 | 8 | 9 |
| ≥ 0,80 | 23 (rower, szkoły, sklepy, zdrowie) | 7 |

- Pas 0,6–0,7 to głównie zbędne doklejki. 0,7 usuwa z niego 14 fałszywych za cenę 4 trafnych.
  Pytań pojedynczych z fałszywym dodatkiem jest 22 → 12 na 179, a pokrycie złożonych spada
  o 1,4 pp (65,6% → 64,2%, komplet 19 → 18 z 62).
- Od 0,7 do 0,8 dodatki są już pół na pół. 0,8 ścina 4 kolejne fałszywe, ale traci 3 komplety
  i 2,9 pp pokrycia, a strata pojawia się na czterech zbiorach (strojenie, nr 3, 5, 6). Tego nie
  biorę.
- 0,65 prawie nic nie daje (22 → 20). 0,75 daje to samo co 0,7, więc biorę niższą wartość:
  mniej tracimy na pytaniach złożonych, gdy JEV oceni temat nieco słabiej.
- Spadek fałszywych dodatków widać na zbiorach nr 2, 5 i 6, a żaden zbiór nie ma ich więcej.
  Pokrycie traci tylko na zbiorach nr 2 i 4 (po jednym temacie). W strojeniu r1 to pozycja przy
  progu: w r2 jest już 81% przy 0,6.

**Próg per temat – nie.** Najmocniejszy sygnał to powietrze (0 trafnych i 6 fałszywych dodatków)
i zieleń (1 trafny, 7 fałszywych). Te fałszywe dodatki leżą jednak głównie na zbiorze nr 6
(powietrze: 4 z 6; zieleń: 6 z 7 na zbiorach nr 5 i 6), a część ma noul 0,77–0,93. Wyższy próg dla tych tematów byłby więc
strojeniem pod zbiór nr 6 przy n = 6–8. Zostaje jeden próg. To kandydat do sprawdzenia na
zbiorze nr 7.

**Warunek „temat to nie przypadkowa wzmianka” – nie.** Sprawdziłem, czy fałszywe dodatki da się
odróżnić bez tekstu pytania. 9 fałszywych dodatków (6 z nich ≥ 0,7) pojawia się przy warstwie
głównej spoza tematów (np. życie nocne → hałas, wybieg dla psów → zieleń, kolejki NFZ
→ zdrowie). Ten sam układ ma jednak 5 trafnych dodatków (3 z nich ≥ 0,7) (np. obszar rewitalizacji → ceny,
wybieg dla psów → sklepy). `nie_dla` to wolny tekst, a nie mapa sąsiadów. Tani i poparty danymi
warunek tu nie istnieje, a drogi wymagałby nowego pytania do JEV. Nie robię.

**Skutek uboczny:** drugie wywołanie (#153) rusza rzadziej. W zapisanych przebiegach 2 z 19
drugich wywołań miały temat poniżej 0,7 (K4-B24 0,68 – trafne, K6-B072 0,61 – nic nie dodało).

### Sprawdzian na żywo (stare zbiory, nowy próg)

Trzy zwykłe przebiegi `pomiar.ts --na-zywo --zbior kontrolnyN --tylko b` z progiem 0,7
(`przebiegi/k2-173.json`, `k4-173.json`, `k5-173.json`). Porównanie z zapisanymi przebiegami
przy 0,6 (#152, #157, #170):

| zbiór | FD przy 0,6 (zapis) | FD przy 0,7 – offline | **FD przy 0,7 – na żywo** | pokrycie: 0,6 zapis → 0,7 na żywo | warstwa główna (pojedyncze) na żywo |
|---|---|---|---|---|---|
| nr 2 | 2/15 | 1/15 | **0/15** | 69% → 69% | 15/15 |
| nr 4 | 1/23 | 1/23 | **1/23** | 60% → 60% | 21/23 |
| nr 5 | 4/23 | 3/23 | **3/23** | 63% → 62% | 21/23 |
| razem | 7/61 | 5/61 | **4/61** | – | – |

- Na żywo jest zgodnie z przeliczeniem albo lepiej. Fałszywych dodatków jest 7 → 4. Pokrycie
  w granicy szumu A/A: strata przewidziana offline na nr 2 i 4 to tematy przy progu, które tym
  razem przeszły.
- To nie jest wynik nagłówkowy, bo te zbiory są użyte. Wynik nagłówkowy da zbiór nr 7.
- Spodziewany skutek na nowym zbiorze, z krzywej wyżej: mniej więcej o połowę mniej pytań
  pojedynczych ze zbędną warstwą (na zbiorze nr 6 byłoby 15 → 7 ze 105). Pokrycie złożonych
  spada o 0–2 pp.

**Wywołania na żywo: 106** (nr 5 – 40, nr 4 – 39, nr 2 – 27, w tym 10 drugich wywołań). Jedno
ponowienie (timeout pośrednika), żadnej utraconej odpowiedzi. Przeliczenie progów nic nie
kosztowało.

## Stabilne progi (#172)

> **Część kategorii z #172 cofnięta w #180 (decyzja po #174); propozycje przy słabym wyborze zostają.** Poziom kategorii znów liczy się z zaokrąglonej `ocena` przy pewności
> ≥ 0,6 (`PROG_PEWNOSCI`), jak przed #172. Szczegóły: „Cofnięcie części kategorii (#180)” niżej.

Pomiar z 2026-10-03, model `jev-1.13.0`. Test A/A z #170 pokazał, że surowy wybór JEV powtarza
się 58/58, a odpowiedź końcowa różni się w 4–5 z 58 pozycji. Powód: wartości leżą tuż przy
progach. Zmiany dotyczą tylko tego, jak kod czyta odpowiedź – zapytanie do JEV jest takie samo.

### Co się zmieniło

- **Poziom kategorii (`opiszSiebie.ts`, `poziomKategorii`).** Poziom liczymy z oczekiwanego
  poziomu Σ poziom·p z rozkładu `prawdopodobienstwa`. To ta sama liczba co `ocena` (na 270
  ocenach z A/A różnica ≤ 0,02). Progu pewności 0,6 już nie ma.
  - Progi: ≥ 3,55 → „Bardzo ważne”, ≥ 2,65 → „Ważne”, ≤ 1,2 → „Mało ważne”, ≤ 0,7 → „Bez
    znaczenia”, a pomiędzy – środek, czyli bez zmian.
  - Każdy próg leży tam, gdzie ocen jest najmniej. Liczyłem oceny w odległości do ±0,08 od progu
    w zbiorach nr 2–6 (900 ocen) i w siedmiu przebiegach zbiorów do strojenia (540):
    - 3,55 – 29 ocen; 3,7 – 40;
    - 2,65 – 22; dawne 2,5 – 39;
    - 1,2 – 10; dawne 1,5 – 48;
    - 0,7 – 0.
  - Progi są ostrożne. Pół na pół „Ważne” i „Bardzo ważne” daje „Ważne”, a pół na pół środek
    i „Ważne” – środek.
- **Słaby wybór warstwy (`zapytajOAdres.ts`, `PROG_SLABEGO_WYBORU` = 0,25).** Przy pewności
  0,25–0,5 wybór JEV zostaje, jeśli da się pokazać dwie propozycje (#156). Bez nich odpowiadają
  reguły, jak dotąd.
  - Na zbiorach nr 4–6 (model z rozkładem) surowy JEV pod 0,5 trafiał w 9 z 9 pytań, a pokazane
    reguły z tematami – w 4.
  - Na zbiorach nr 2–3 (stary model) JEV pod 0,5 trafiał w 3 z 8. Tam nie ma rozkładu, więc
    nic się nie zmienia.
  - Na zbiorach nr 2–6 żadna pewność nie wypadła między 0,18 a 0,34.
- **Górna granica propozycji: 0,9 → 0,86 (`PROG_BEZ_PROPOZYCJI`).** Pewności w odległości do
  ±0,03 od progu jest 53 przy 0,9 i 30 przy 0,86 (zbiory nr 2–6 i A/A). W paśmie 0,86–0,9
  warstwa główna była trafna w 12 z 12 pytań, więc tam propozycje nic nie dawały.
- **Bez zmian:**
  - `PROG_POTRZEBY` 0,6. Przy 0,6 nie ma pustego pasma. Żaden próg między 0,62 a 0,7 nie dał
    mniej przeskoków w A/A (16–23 wobec 14 przy 0,6). Przy wyższym progu „dokładnie” rośnie na
    zbiorach nr 5–6 (123 → 127–129 ze 190), a spada na zbiorze do strojenia (23 → 18–20 z 30).
    To pytanie o trafność, a nie o stabilność.
  - Tematy (`PROG_TEMATU`, #173), bramka i profil.

### Przed i po – stabilność

**A/A bez sieci i na żywo.** Każdą parę przebiegów liczyłem starym kodem (`origin/main`) i nowym
na tych samych odpowiedziach JEV. Przebiegi:

- `aa-157` (29 pozycji) i `aa-170` (58) – zapisane wcześniej;
- trzy nowe przebiegi na żywo na pełnych zbiorach do strojenia (30 opisów i 28 pytań), czyli
  trzy pary.

Kod to stan po rebase na `main` z #173, #164 i #171.

| Para | n | stary kod: odpowiedź końcowa inna | **nowy kod** |
|---|---|---|---|
| aa-157 | 29 | 0 | **0** |
| aa-170 | 58 | 4 (A07, A10, A12 – kategorie; A16 – potrzeba) | **1** (A16) |
| na żywo r1/r2 | 58 | 6 (A04, A10, A13, A19 – kategorie; A07, A16 – potrzeba) | **6** (A03, A04, A15 – kategorie; A07, A16 – potrzeba; B28 – propozycje) |
| na żywo r1/r3 | 58 | 5 | **2** (A07, A16 – potrzeba) |
| na żywo r2/r3 | 58 | 2 | **4** (A03, A04, A15 – kategorie; B28 – propozycje) |
| **Razem** | **261** | **17 (3,8 na 58)** | **13 (2,9 na 58)** |

- **Przeskoki z kategorii spadły z 12 do 6.** Te, które zostały, to trzy pozycje, które dziś
  leżą tuż przy nowych progach:
  - `kat_transport` 3,43–3,57 w A03 i A04 przy 3,55;
  - `kat_spokoj` 1,16–1,23 w A15 przy 1,2.

  W zapisanych przebiegach (A03 3,49) tego nie było widać. Każdy próg ma jakąś pozycję obok
  siebie. Progi wybrałem po gęstości ocen na wszystkich danych, a nie pod te trzy pozycje.
- **Potrzeba przy 0,6 (A07, A16) daje teraz 5 z 13 przeskoków.** Ten próg zostaje (patrz wyżej).
- **B28** to pewność 0,86–0,89 przy nowej granicy propozycji 0,86. Przy starej (0,9)
  przeskakiwałyby inne pozycje: na zbiorach nr 5–6 jest ich wyraźnie więcej (niżej).
- **Wynik nie jest „wyraźnie poniżej 4 na 58”**: na tych zbiorach to 2,9 zamiast 3,8. Reszta
  szumu leży w potrzebach (0,6), w tematach (#173) i w pojedynczych pozycjach przy progach
  kategorii.

**Zaburzenie Monte Carlo.** Do każdej odpowiedzi dodałem różnice zmierzone w parach A/A (r1 − r2)
i sprawdziłem, ile odpowiedzi końcowych się zmienia. 100 powtórzeń, wspólne liczby losowe.

| | stary kod | **nowy kod** |
|---|---|---|
| Zbiory do strojenia, A (30 opisów) | 3,49 | **0,35** |
| Zbiory do strojenia, B (28 pytań) | 0,24 | 0,28 |
| Zbiory nr 5–6, B (185 pytań): zmiana warstwy głównej | 0,26 | **0,06** |
| Zbiory nr 5–6, B: propozycje są / ich nie ma | 2,24 | **1,73** |
| Zbiory nr 5–6, B: inna druga propozycja | 0,57 | 1,76 |
| Zbiory nr 5–6, B razem (na 58 pytań) | 1,12 | 1,25 |

- Pod 0,5 JEV często daje rozkład rozlany na trzy warstwy, więc druga propozycja potrafi się
  zamienić z trzecią. Warstwa główna (to, co karta pokazuje po kliknięciu pierwszej propozycji
  i co liczy pomiar) przeskakuje ok. 4 razy rzadziej.
- Dla A na zbiorach nr 5–6 starego kodu nie da się zaburzyć – zapis nie ma pewności kategorii.
  Nowy kod: 3,3% opisów na powtórzenie, z tego kategorie 1,2%.

### Przed i po – trafność

**B – zbiory nr 2–6 (270 pytań, UŻYTE, tylko liczby zbiorcze).** Stary i nowy kod przeliczone
na tych samych zapisanych odpowiedziach, na danych z `main` po #171 i #173.

| | stary kod | **nowy kod** |
|---|---|---|
| Warstwa główna trafna od razu | 252/270 | **256/270** |
| Po kliknięciu propozycji | 252/270 | **255/270** |
| Precyzja warstw | 90,4% (245/271) | **91,2% (250/274)** |
| Pojedyncze z fałszywym dodatkiem | 11 | 12 |
| Pytania z propozycjami | 25 | 29 |

Zyski są na zbiorach nr 5 (+2) i nr 6 (+2). Na zbiorach nr 2–4 wynik się nie zmienił.

**A – zbiory nr 5–6 (190 opisów).** Stary kod to zapisane wyniki z pewnością kategorii, a nowy to
przeliczenie tych samych odpowiedzi. Liczone przed rebase, bo #171 zmienił kategorie z „Przyszłość
okolicy” na „Społeczność i koszty”, a zapis ma stare id. Pytań do JEV (transport, spokój,
bezpieczeństwo) #171 nie zmienił.

| | stary kod | **nowy kod** |
|---|---|---|
| Profil | 166/190 | 166/190 |
| Cały opis dokładnie | 122/190 | **123/190** |
| Kategorie ważne – P / R / F1 | 92,5 / 76,2 / 83,6% | 91,5 / **79,3 / 85,0%** |

**Na żywo, zbiory do strojenia (trzy przebiegi).** Stary i nowy kod dały to samo:

- A „dokładnie”: 22, 23 i 23 z 30;
- B warstwa główna: 28/28 w każdym przebiegu.

### Wywołania na żywo

**177** – trzy przebiegi po 59 (30 opisów, 28 pytań i jedno drugie wywołanie). Stary kod dostawał
odpowiedzi nowego z pamięci, bo zapytanie jest to samo. 0 nieudanych prób, 0 ponowień.
Przeliczenia bez sieci nic nie kosztowały. Skrypty i surowe przebiegi są poza repo (scratchpad).

Zmiana persony z #164 (wagi profili) nie wpływa na te liczby. Pomiar porównuje profil,
potrzeby i poziomy kategorii, a nie wagi.

## Pomiar #172 i #173 na zbiorze nr 7 (#174)

Pomiar z 2026-10-03, model `jev-1.13.0`. Zmierzyłem obie zmiany na świeżym zbiorze, każdą
osobno. W kodzie aplikacji nic nie zmieniałem. Niczego też nie cofałem: tu są tylko liczby
i rekomendacja.

### Zbiór nr 7 i to, że jest starszy niż zmiany

`kontrolny7-opisz.json` ma 120 opisów, a `kontrolny7-zapytaj.json` 150 pytań: 113 pojedynczych,
25 złożonych i 12 spoza zakresu.

- Napisały je na ślepo dwa osobne agenty AI, bez dostępu do kodu i poprzednich zbiorów. Cechy
  pod te zmiany: `lagodne` (30 opisów, cel #172) i `przypadkowe_slowo` (60 pytań, cel #173).
- Pliki weszły bajt w bajt osobnym commitem `d3beb77`, zanim poszło pierwsze wywołanie.
  - #172 (`59a58c5`, 23:15) wszedł po nim.
  - #173 (`3a9580b`, 23:02:21) wszedł o 2 s wcześniej, bo wyścig wygrał przy rebase
    w `zadanie scal`. Pliki zbioru leżały gotowe od 22:57–22:58.
  - Diff #173 nie dotyka zbioru nr 7, a próg 0,7 wybrano na zbiorach nr 2–6 (patrz „Próg tematu
    (#173)”, gdzie zbiór nr 7 jest wprost oznaczony jako nieotwierany).
- Tekstów nie czytałem. Z pozycji widziałem tylko id, cechy i etykiety w liczbach zbiorczych.

### #171 a etykiety zbioru nr 7

#171 (`c810b48`) usunął i połączył warstwy, a zbiór nr 7 (jak nr 1–6) ma stare id. Przy ocenie,
i tylko tam, mapuję stare id na następcę według `etl/uprosc-kryteria.mjs`. Plików zbioru nie
zmieniałem.

- `halas_obwarzanek_lden` → `halas_ldwn`;
- `inwestycje_500m_obwarzanek` → `inwestycje_500m`;
- `powodz_1proc`, `powodz_02proc` i `gmina_powodz_powierzchnia_pct` → `powodz_10proc`;
- `bankomat_poczta_odleglosc` i `uslugi_15min` nie mają jasnego następcy (usunięta albo
  rozbita na trzy warstwy).

Wpływ na zbiór nr 7:

- 17 pytań ma zmapowany wzorzec: K7-B001, B007, B024, B052, B062, B082, B091, B094, B107, B108,
  B114, B132, B136, B141, B143, B144 i B145.
- **K7-B033 jest wyłączone z wyniku nagłówkowego.** Jego wzorzec wskazywał tylko warstwy bez
  następcy. Dlatego B liczę na 149 pytaniach.
- W K7-B134 jedna z grup tematu straciła warstwę bez następcy. Reszta grupy zostaje.
- Wszystkie cztery przebiegi mają te same dane po #171: `public/dane` jest identyczne we
  wszystkich drzewach, a lista dla JEV ma 118 warstw.
- Bez mapowania liczby są prawie te same, np. warstwa główna R3 to 141/150 zamiast 141/149.
  Mapowanie niczego tu nie rozstrzyga.

### Metoda: cztery osobne drzewa kodu

| Przebieg | Kod | Co |
|---|---|---|
| **R0** | `c810b48` (BASE: `main` tuż przed pierwszą ze zmian) | bez zmian |
| **R1** | BASE + cherry-pick `59a58c5` | tylko #172 |
| **R2** | `3a9580b` (= BASE + #173, rodzicem jest BASE) | tylko #173 |
| **R3** | `59a58c5` (`main` z oboma) | #172 i #173 |
| **R3b** | jak R3 | A/A wersji końcowej |

- Każde drzewo wyeksportowałem z gita (`git archive`) do osobnego katalogu. Każdy przebieg to
  `pomiar.ts --na-zywo --zbior kontrolny7` z własnego drzewa, a więc z własnymi zapytaniami
  i własnym przetwarzaniem.
- Wspólny jest tylko pomiar: `pomiar.ts` i pliki zbioru z `d3beb77` w każdym drzewie (#172
  i #173 pomiaru nie zmieniały). Wspólny jest też pośrednik `api/_jev.js`.
- Cherry-pick #172 na BASE miał konflikt tylko w `WYNIKI.md` (sama dokumentacja). Wziąłem wersję
  z #172. Zmienione linie kodu są identyczne z `59a58c5` (diff 328 = 328 linii).
- Zapytania do JEV są we wszystkich czterech drzewach identyczne (skrót sha256 zapytań dla
  wszystkich 270 pozycji). Obie zmiany zmieniają więc tylko to, jak kod czyta odpowiedź (#173:
  także to, kiedy rusza drugie wywołanie).
- #164 (`be7103e`, wagi profili) leży między BASE a R3, ale zapytań nie zmienia (ten sam skrót).
- Pięć przebiegów szło równolegle, o tej samej porze.
- Przedziały to 95% Wilsona. „Zyski / straty” to porównanie sparowane z R0 na tych samych
  pozycjach, a p to dokładny test McNemara.
- R0b (A/A wersji bazowej) się nie zmieścił w budżecie. Zastępują go dwie rzeczy:
  - A/A na prawdziwych parach. Część A (opisz siebie) ma w R0 i R2 identyczny kod, a w R1 i R3
    też identyczny. To dwa czyste A/A części A: bazowy i po #172;
  - dla B te same zapisane odpowiedzi JEV z par przebiegów, przetworzone kodem każdej wersji,
    bez sieci. Odtworzenie R3/R3b kodem R3 daje dokładnie te same 6 przeskoków co na żywo.

### Wynik (JEV = to, co widzi użytkownik)

**A – „opisz siebie”** (120 opisów):

| | Reguły | R0 bez zmian | R1 tylko #172 | R2 tylko #173 | **R3 oba** | R3b (A/A) |
|---|---|---|---|---|---|---|
| Profil | 72% [63–79%] (86) | 78% [69–84%] (93) | 82% [74–88%] (98) | 80% [72–86%] (96) | **80% [72–86%] (96)** | 78% [70–85%] (94) |
| Cały opis dokładnie | 35% [27–44%] (42) | 57% [48–65%] (68) | 60% [51–68%] (72) | 57% [48–65%] (68) | **58% [49–67%] (70)** | 57% [48–65%] (68) |
| Potrzeby (10) P / R / F1 | 59 / 71 / 64% | 78 / 94 / 85% | 78 / 94 / 85% | 76 / 92 / 83% | 80 / 93 / 86% | 78 / 94 / 85% |
| Kategorie ważne P / R / F1 | 73 / 80 / 76% | 91 / 77 / 83% | 91 / 81 / 85% | 90 / 77 / 83% | 92 / 80 / 86% | 91 / 82 / 86% |
| „Nic” tam, gdzie trzeba | 10/14 | 14/14 | 14/14 | 14/14 | 14/14 | 14/14 |
| Bramka zamknięta | – | 11 | 10 | 11 | 12 | 10 |
| Zapas (reguły) | – | 13 | 11 | 13 | 9 | 11 |

**B – „zapytaj o adres”** (149 pytań: 112 pojedynczych, 25 złożonych, 12 spoza zakresu):

| | Reguły | R0 bez zmian | R1 tylko #172 | R2 tylko #173 | **R3 oba** | R3b (A/A) |
|---|---|---|---|---|---|---|
| Warstwa główna od razu | 42% [34–50%] (62) | 94% [89–97%] (140) | 94% [89–97%] (140) | 93% [88–96%] (139) | **95% [90–97%] (141)** | 94% [89–97%] (140) |
| Pojedyncze – warstwa główna | 38/112 | 103/112 | 103/112 | 102/112 | 104/112 | 103/112 |
| Złożone – choć jeden temat | 17/25 | 25/25 | 25/25 | 25/25 | 25/25 | 25/25 |
| Spoza → „nie wiem”, bez warstw | 7/12 | 12/12 | 12/12 | 12/12 | 12/12 | 12/12 |
| Pokrycie złożonych | 55% | 69% | 73% | 69% | 69% | 69% |
| Złożone z kompletem | 8/25 | 9/25 | 11/25 | 9/25 | 9/25 | 9/25 |
| Precyzja warstw | 54% [46–62%] | 86% [80–90%] | 89% [83–93%] | 89% [84–93%] | **94% [89–97%]** | 93% [88–96%] |
| **Pojedyncze z fałszywym dodatkiem** | 9 (8%) | 13 (12% [7–19%]) | 11 (10%) | 8 (7% [4–13%]) | **4 (4% [1–9%])** | 5 (4%) |
| Fałszywe warstwy (wszystkie pytania w zakresie) | 13 | 18 | 15 | 10 | **6** | 7 |
| Średnio warstw na odpowiedź | 1,01 | 1,23 | 1,19 | 1,16 | 1,11 | 1,11 |
| Surowy wybór JEV (bez progu) | – | 141 | 140 | 139 | 141 | 140 |
| Pewność < 0,5 | – | 11 | 11 | 11 | 11 | 11 |
| Z propozycjami / wzorzec wśród dwóch | – | 22 / 22 | 29 / 27 | 25 / 25 | 30 / 29 | 29 / 28 |
| – z tego przy pewności < 0,5 (#172) | – | 0 | 11 | 0 | 11 | 11 |
| **Po kliknięciu propozycji** | – | 95% [90–97%] (141) | 98% [94–99%] (146) | 95% [91–98%] (142) | **99% [95–100%] (147)** | 99% (147) |
| Drugie wywołanie | – | 14 | 13 | 12 | 12 | 12 |

**Cechy** (liczby pozycji; przy n ≤ 30 jedna pozycja to co najmniej 3 pp):

| Cecha | n | Reguły | R0 | R1 | R2 | **R3** | R3b |
|---|---|---|---|---|---|---|---|
| A `lagodne`: profil / dokładnie | 30 | 23 / 5 | 23 / 15 | 25 / 17 | 23 / 15 | **23 / 15** | 24 / 16 |
| A `lagodne`: kategorie F1 / potrzeby F1 | 30 | 77 / 53% | 80 / 83% | 79 / 83% | 79 / 83% | 79 / 83% | 79 / 83% |
| B `przypadkowe_slowo`: główna / z fałszywym dodatkiem | 59 | 18 / 5 | 56 / 5 | 57 / 5 | 55 / 3 | **57 / 3** | 57 / 3 |
| B `jeden_temat`: główna / z fałszywym dodatkiem | 99 | 32 / 8 | 92 / 7 | 92 / 8 | 91 / 5 | **93 / 4** | 92 / 4 |
| B `niejednoznaczne`: główna / z fałszywym dodatkiem | 13 | 6 / 1 | 11 / 6 | 11 / 3 | 11 / 3 | **11 / 0** | 11 / 1 |
| B `zlozone`: pokrycie | 25 | 55% | 69% | 73% | 69% | 69% | 69% |
| B `bliska_pomylka`: główna | 10 | 2 | 7 | 7 | 7 | 7 | 7 |

W pozostałych cechach A (`profil_glowny`, `bliska_pomylka`, `domownik`, `w_imieniu`,
`nikt_nie_szuka`, `bez_sygnalu`) wersje różnią się o 0–2 pozycje, czyli tyle co R3 i R3b.

**Sparowane względem R0** (zyski / straty, p McNemara):

| | R0 → R1 (#172) | R0 → R2 (#173) | **R0 → R3 (oba)** | R0 → R3b |
|---|---|---|---|---|
| A: profil | +5 / −0, p = 0,063 | +5 / −2, p = 0,45 | +4 / −1, p = 0,38 | +4 / −3, p = 1 |
| A: dokładnie | +4 / −0, p = 0,13 | +3 / −3, p = 1 | +4 / −2, p = 0,69 | +3 / −3, p = 1 |
| A: kategorie ważne dokładnie | +5 / −2, p = 0,45 | +3 / −2, p = 1 | +6 / −3, p = 0,51 | +6 / −2, p = 0,29 |
| A `lagodne`: dokładnie | +2 / −0, p = 0,5 | +1 / −1, p = 1 | +0 / −0 | +2 / −1, p = 1 |
| A `lagodne`: kategorie dokładnie | +0 / −1 | +0 / −1 | +0 / −1 | +0 / −1 |
| B: warstwa główna | +2 / −2, p = 1 | +0 / −1, p = 1 | +2 / −1, p = 1 | +2 / −2, p = 1 |
| **B: pojedyncze bez fałszywego dodatku** | +5 / −3, p = 0,73 | +5 / −0, p = 0,063 | **+9 / −0, p = 0,004** | +8 / −0, p = 0,008 |
| B `przypadkowe_slowo`: bez fałszywej warstwy | +1 / −1 | +2 / −0, p = 0,5 | +2 / −0, p = 0,5 | +2 / −0, p = 0,5 |
| B: złożone z kompletem | +2 / −0, p = 0,5 | +0 / −0 | +0 / −0 | +0 / −0 |
| **B: po kliknięciu** | +5 / −0, p = 0,063 | +1 / −0, p = 1 | **+6 / −0, p = 0,031** | +6 / −0, p = 0,031 |

Część A ma w R0 i R2 **ten sam kod**, więc kolumna R0 → R2 dla A to czysty szum: profil +5 / −2,
„dokładnie” +3 / −3. Zyski profilu w R0 → R1 to te same pozycje (A012, A017, A023, A046), które
„zyskuje” R2 bez żadnej zmiany w A. To nie jest skutek #172.

### Stabilność (A/A)

**A – pary przebiegów z identycznym kodem części A:**

| Para | Kod A | Odpowiedź końcowa inna | w tym tylko kategorie | wybór profilu inny | „dokładnie” zmienione |
|---|---|---|---|---|---|
| R0 / R2 | bazowy | 16/120 | 7 | 2 | 6 |
| R1 / R3 | #172 | 11/120 | 2 | 2 | 6 |
| R3 / R3b | #172 | 17/120 | 6 | 1 | 8 |

**B – te same odpowiedzi JEV, przetworzone kodem każdej wersji** (bez sieci; drugie wywołanie
nie jest zapisane, więc w przeliczeniu go nie ma):

| Para odpowiedzi | kod R0 | kod R1 (#172) | kod R2 (#173) | **kod R3 (oba)** |
|---|---|---|---|---|
| R3 / R3b | 13 | 11 | 9 | **6** (na żywo też 6) |
| R0 / R2 | 9 | 8 | 10 | 9 |
| R1 / R3 | 14 | 12 | 10 | 9 |
| **Razem na 450 par** | **36** | 31 | 29 | **24** |
| w tym inna warstwa główna | 6 | 4 | 6 | 4 |

- **Wybór JEV prawie się nie zmienia między przebiegami:** w R3 i R3b profil różni się w 1/120,
  a warstwa w 1/150. Pewność wyboru warstwy różni się średnio o 0,014, maksymalnie o 0,15.
- **A: stabilność po #172 nie jest lepsza ponad szum.** Odpowiedź inna: 16 w parze bazowej
  wobec 11 i 17 w parach po #172. Przeskoki z kategorii: 7 wobec 2 i 6. Większość przeskoków
  (9–11 na parę) to potrzeby i profil, a tych #172 nie zmienia.
- **B: przeskoki spadają z 36 do 24 na 450 par.** Więcej daje tu #173 (mniej doklejek przy
  progu tematu) niż #172. Inna warstwa główna to 6 → 4 przypadki.
- **Wersja końcowa, na żywo:** 23 z 270 pozycji (8,5%) różni się między R3 a R3b: 17 w A
  i 6 w B. W B tylko 2 różnią się warstwami, a 4 – samymi propozycjami. Wynik nagłówkowy waha
  się o 0–2 pozycje (A „dokładnie” 70 / 68, B 141 / 140).

### Opóźnienie i wywołania

| Przebieg | A p50 / p95 / max | B p50 / p95 / max (czas pytania, z drugim wywołaniem) |
|---|---|---|
| R0 | 277 / 355 / 786 ms | 351 / 649 / 763 ms |
| R1 | 281 / 359 / 610 ms | 346 / 613 / 776 ms |
| R2 | 290 / 370 / 632 ms | 351 / 594 / 689 ms |
| R3 | 288 / 391 / 635 ms | 353 / 619 / 796 ms |
| R3b | 293 / 344 / 676 ms | 351 / 615 / 697 ms |

- Opóźnienie nie zależy od wersji, bo zapytania są te same.
- **Dwa pierwsze timeouty pośrednika** (806 i 810 ms, w R1 i R3b) po 702 wywołaniach bez
  timeoutu w #170. Oba ponowione z odczekaniem. Odpowiedzi nie zginęły, a nieudane próby nie są
  liczone jako odpowiedzi. Zapas do limitu 800 ms jest naprawdę mały – to potwierdza (b) z #170.

**Wywołania na żywo: 1415** (R0 – 284, R1 – 284, R2 – 282, R3 – 282, R3b – 283, licznik
`pomiar.ts`). To 1413 udanych i 2 ponowienia po timeoucie. Budżet 1400 przekroczyłem o 15, bo
źle oszacowałem drugie wywołania (12–14 na przebieg zamiast ok. 9). Przebieg samych reguł i całe
przeliczenie bez sieci nic nie kosztowały.

### Decyzja – z danych, bez cofania

**#173 (`PROG_TEMATU` 0,6 → 0,7): ZOSTAJE.**

- Cel się poprawia ponad szum. Pojedyncze pytania z fałszywym dodatkiem: 13 → 8 sam (+5 / −0,
  p = 0,063), 13 → 4 z #172 (+9 / −0, p = 0,004; w powtórce R3b +8 / −0, p = 0,008).
  Fałszywe warstwy 18 → 10 (sam) i → 6 (z oboma). Precyzja 86% → 89% → 94%.
- W `przypadkowe_slowo` 5 → 3 (+2 / −0, n = 59, to za mało na istotność). W `niejednoznaczne`
  6 → 3, a z oboma 0.
- Bez straty: pokrycie złożonych 69% → 69%, komplet 9 → 9, warstwa główna 140 → 139 (−1,
  p = 1; K7-B031 to pozycja przy progu). Mniej drugich wywołań (14 → 12) i stabilniejsze B.
- Przewidywanie z #173 („mniej więcej o połowę mniej”) się sprawdziło: 13 → 8 sam, 13 → 4 razem.

**#172 (poziomy kategorii z rozkładu, słaby wybór z propozycjami, granica 0,86): według reguły
„cel ponad szum” – rekomendacja cofnięcia części o kategoriach. Część B (słaby wybór
z propozycjami) ma dowody za, choć na granicy istotności.**

- **Cel – stabilność – nie jest lepszy ponad szum na zbiorze nr 7.**
  - A: odpowiedź inna 16 (kod bazowy) wobec 11 i 17 (#172).
  - B: 36 → 31 na 450 par samym #172. Warstwa główna przeskakuje 6 → 4 razy.
- **`lagodne` bez zmian:** „dokładnie” 15 → 17 w R1, ale 15 w R3 i 16 w R3b. Kategorie
  dokładnie +0 / −1 we wszystkich wersjach (K7-A052), kategorie F1 80% → 79%.
- **A ogółem w granicach szumu:** „dokładnie” +4 / −0 (p = 0,13), ale czysty szum (R0 → R2,
  ten sam kod A) daje +3 / −3. Profil +5 / −0 to te same pozycje, które zmienia szum. Pełność
  kategorii 77% → 81% (R3 80%, R3b 82%) to jedyny spójny ruch w A, bez straty precyzji.
- **Żadnej istotnej straty:** warstwa główna +2 / −2, fałszywe dodatki 13 → 11, potrzeby bez
  zmian, bramka 11 → 10.
- **Słaby wybór (0,25–0,5) z dwiema propozycjami** to jedyny wyraźny zysk.
  - Wszystkie 11 pytań z pewnością < 0,5 ma teraz propozycje (było 0).
  - Po kliknięciu: +5 / −0 (p = 0,063) sam, +6 / −0 (p = 0,031) z #173. R3b powtarza to samo.
  - Warstwa główna od razu się nie zmienia.
- **Rekomendacja:** jeśli trzymamy się reguły z #174 dosłownie, #172 nie pokazał poprawy celu
  ponad szum i powinien zostać cofnięty. Uczciwszy podział:
  - część o kategoriach (`poziomKategorii`, progi 3,55 / 2,65 / 1,2 / 0,7) cofnąć albo zostawić
    jako neutralną. Nic nie psuje, ale też niczego nie dowiodła;
  - słaby wybór z propozycjami i granicę 0,86 zostawić. Zysk po kliknięciu powtarza się w R1,
    R3 i R3b bez ani jednej straty.

  Decyzja należy do właściciela – tu niczego nie cofałem.

### Bez sieci, do powtórzenia

Przebiegi są w `przebiegi/k7-r0-174.json`, `k7-r1-174.json`, `k7-r2-174.json`, `k7-r3-174.json`
i `k7-r3b-174.json`. `pomiar.ts --zbior kontrolny7 --z-pliku <plik>` odtwarza z nich liczby
zbiorcze, bez mapowania #171. Mapowanie #171, porównania sparowane, przeskoki A/A
i przetworzenie odpowiedzi kodem innych wersji robiły skrypty poza repo (scratchpad), tak jak
w #170.

### Cofnięcie części kategorii (#180)

**Część kategorii z #172 cofnięta w #180 (decyzja po #174); propozycje przy słabym wyborze zostają.**

- **Cofnięte (`opiszSiebie.ts`):** `poziomKategorii`, `oczekiwanyPoziom`, `PROGI_KATEGORII`
  (3,55 / 2,65 / 1,2 / 0,7). Wraca reguła z `59a58c5^`: poziom = zaokrąglona `ocena` przycięta
  do 0–4, tylko przy pewności ≥ `PROG_PEWNOSCI` (0,6) albo bez pewności; środek skali nic nie
  zmienia.
- **Zostaje (`zapytajOAdres.ts`, bez zmian):** propozycje przy pewności 0,25–0,5, gdy da się
  pokazać dwie (`PROG_SLABEGO_WYBORU`), i górna granica propozycji 0,86. Nietknięte też #173,
  #176 i #177.
- **Bez sieci, 0 wywołań:**
  - Zapytania „opisz” dla 120 tekstów zbioru nr 7 mają ten sam skrót sha256 w drzewach R2
    (`3a9580b`), R3 (`59a58c5`), `59a58c5^`, `main` i po cofnięciu.
  - Odpowiedzi JEV z `k7-r3-174.json` przetworzone kodem po cofnięciu i kodem `59a58c5^`:
    0/120 różnic (profil, potrzeby, poziomy kategorii) i te same liczby zbiorcze A
    (`pomiar.ts --z-pliku`). Zapis przebiegu nie ma pewności kategorii, więc sprawdziłem cztery
    założenia (brak pewności, wszędzie 0,6, wszędzie 0,59, stała losowa 0,3–1 na pozycję).
    Reguła zapasowa (słowa kluczowe) w obu z `main` – inaczej różnią się 1–2 opisy z samych
    nowych potrzeb reguł (fc3c399), a nie z cofnięcia.
  - Część B: `pomiar.ts --z-pliku k7-r3-174.json` daje na gałęzi i na `main` identyczne
    podsumowanie (141/148 od razu, 147/148 po kliknięciu, liczone przez `pomiar.ts` bez
    mapowania #171).
  - A/A `k7-r3` / `k7-r3b` po cofnięciu: odpowiedź inna w 17/120 opisów przy braku pewności
    kategorii i 16/120 przy stałej losowej (kod z #172 na tych samych danych: 16/120). Pewność
    kategorii nie jest zapisana, więc to przeliczenie nie widzi przeskoków przy progu 0,6. Pomiar
    na żywo z tą samą regułą to para R0 / R2 wyżej: 16/120.

## Tabela potrzeb a silnik (#177)

Pomiar z 2026-10-03, bez JEV i bez sieci: `node src/ai/pomiar/spelnienie.ts` (ok. 40 s).
Pytania do JEV (twierdzenia, kryteria), bramka, wzorce reguł i poziomy kategorii w POTRZEBY
są bez zmian. `pomiar.ts` nie czyta wag warstw, więc wszystkie liczby JEV wyżej zostają ważne.

### Co sprawdzamy

Tabela POTRZEBY powstała przy ok. 45 warstwach. Dziś jest ich 118. Pytanie brzmi: czy po
dodaniu rozpoznanej potrzeby najlepsze adresy na mapie lepiej ją spełniają niż przy samym
profilu?

- Opisy: zbiór wzorcowy i zbiory kontrolne nr 1–7, 420 opisów z co najmniej jedną potrzebą.
  Profil i potrzeby są WZORCOWE (etykiety, nie odpowiedź JEV). Profil null to profil domyślny
  (Rodzina), jak u nowego użytkownika.
- Wagi liczymy czterema sposobami:
  - **profil**: sam profil;
  - **stara**: tabela i `wagiZeZrozumienia` z `430153e`, czyli `main` przed #177;
  - **stara tabela, nowe składanie**: osobno widać, co daje sama zmiana składania;
  - **nowa**: nowa tabela i nowe składanie.
- Silnik (`wynikiWszystkich`, tryb „kupuję”) ocenia 176 684 adresy. Bierzemy 100 najlepszych.
- Każda potrzeba ma 1–2 wskaźniki spełnienia z surowych danych. Liczymy medianę w top 100
  opisu, potem medianę po opisach z tą potrzebą. Hałas ma najniższe pasmo 50 dB, w którym jest
  ¼ adresów z danymi. Dlatego przy hałasie, barach i osuwiskach liczymy odsetek top 100
  powyżej progu.

### Co było nie tak: poziom kategorii włączał całą kategorię

W starym składaniu potrzeba z poziomem kategorii ≥ 3 (np. „pies” → spokój 3) dawała tę wagę
**każdej** warstwie kategorii, także tym, których profil nie liczy: kąpielisku, słońcu
w grudniu, gęstości zaludnienia. Z 22 warstw liczonych przez profil robiło się 52 (mediana).
Konkretne warstwy potrzeby ginęły wśród reszty: przy „psie” top 100 miał mniej zieleni niż sam
profil (59% zamiast 77%), a przy „seniorze” przychodnię 2,5 raza dalej (430 m zamiast 172 m).

Nowe składanie (`wagiZeZrozumienia`):

- Poziom kategorii od JEV ≥ 3 podnosi tylko warstwy, które baza już liczy (waga > 0).
  Poziom ≤ 1 obniża je jak dotąd.
- Poziom, który wynika **tylko** z potrzeb, nie zmienia wag, bo potrzeba ma własne warstwy.
  Inaczej „dzieci” (codzienność 4) podnosiły warstwy Rodziny z wagą 1 (wynik E8, kolejki NFZ,
  biblioteka) do 4, tyle co przedszkole. W pierwszej wersji (bez tej reguły) „dzieci” odsuwały
  przedszkole o 13 m (15 opisów lepiej, 72 gorzej), a „zdrowie” przychodnię o 9 m.
- Potrzeba może nadać kierunek warstwie neutralnej (weterynarz, wybieg dla psów, bary, noclegi,
  defibrylator, główne trasy rowerowe). Kierunek z profilu albo z ustawień użytkownika wygrywa.

Poziomy kategorii w samym zrozumieniu (chipy, pomiar kategorii F1) się nie zmieniają.

### Tabela: warstwy przed → po

Wagi 0–4. „↘” to kierunek „mniej = lepiej” nadany warstwie neutralnej.

| Potrzeba | Przed (#176) | Po (#177) |
|---|---|---|
| dzieci | przedszkole 4, szkoła podst. 4, żłobek 3, udział zieleni 4 | przedszkole 4, szkoła podst. 4, **plac zabaw 4**, żłobek 3, **biblioteka 1,2 km 2**, udział zieleni **2** |
| pies | udział zieleni 4, zieleń 100 m 4 | udział zieleni 4, zieleń 100 m 4, **wybieg dla psów 3 ↘**, **weterynarz 3 ↘** |
| zieleń | udział zieleni 4, zieleń 100 m 4 | udział zieleni 4, zieleń 100 m 4, **chroniona przyroda 2**, **drzewa ZZM 100 m 2** |
| powietrze | PM2,5 4, PM10 4, NO₂ 4, B(a)P 4 | PM2,5 4, PM10 4, NO₂ 4, B(a)P 4, **paleniska 200 m 3**, **przewietrzanie 2**, **zakład PRTR 2** |
| rower | sklep 4, gastronomia 1,2 km 3, poczta 1,2 km 3 | **infrastruktura rowerowa 4**, **stojaki 3**, **główna trasa rowerowa 2 ↘**, sklep **2** |
| bez samochodu | przystanek 4, kursy 4, sklep 3 | przystanek 4, kursy 4, **czas do Rynku 3**, **stacja kolejowa 2**, **pociągi w szczycie 2**, **busy MLD 1**, sklep 3 |
| senior | przychodnia 4, apteka 4, ławki 4, krawężniki 3 | przychodnia 4, apteka 4, ławki 4, krawężniki 3, **POZ bez barier 3**, **Centrum Aktywności Seniora 3**, **kolejki NFZ 2**, **defibrylator 1 ↘** |
| praca w centrum | czas do Rynku 4, kursy 3 | bez zmian |
| lekarz blisko | przychodnia 4, apteka 4, POZ bez barier 3, krawężniki 3 | to samo + **kolejki NFZ 2**, **defibrylator 1 ↘** |
| lotnisko | czas do Balic 4 | bez zmian |
| cisza | hałas 4 | hałas 4, **imprezy w obiektach 3**, **imprezy stałe 3**, **bary i kluby 3 ↘**, **noclegi 2 ↘** |
| sklepy | sklep 4, gastronomia 1,2 km 2, poczta 1,2 km 2 | sklep 4, **gastronomia (odległość) 2**, **targowisko 2**, **paczkomat 2**, poczta 1,2 km 2 |
| bezpieczeństwo | powódź Q10 4 | powódź Q10 4, **teren osuwiskowy 3**, **zakład Seveso 2**, **latarnie 2**, **policja 1** |
| inwestycja | pozwolenia 500 m 4, projekty BO 3 | bez zmian (kierunek pozwoleń zostaje przy profilu) |
| mieszkam sam | – (wagi niesie profil) | bez zmian |

Czego celowo nie ma:

- przestępstwa i wykrywalność na powiat: jedna liczba dla całego Krakowa, a opis warstwy mówi
  wprost, że to informacja, nie ocena adresu;
- liceum: potrzeba nie zna wieku dzieci;
- wnioski „Czyste Powietrze”: liczba dla całej gminy;
- ROD, nocne światło, ruch z 17 liczników rowerowych.

Uzasadnienie każdej pozycji jest w komentarzu w `opiszSiebie.ts`.

Testy pilnują tabeli:

- każde id istnieje w `public/dane/wskazniki`;
- wagi są całkowite 1–4;
- kierunki mają poprawne wartości i wagę w tej samej potrzebie;
- każda warstwa potrzeby naprawdę wchodzi do wyniku (`kierunekEfektywny`);
- dwie potrzeby nie dają tej samej warstwie sprzecznych kierunków.

### Wynik 1: profil → profil + wszystkie potrzeby opisu

Mediana po opisach z potrzebą. ↑ oznacza lepiej dla potrzeby, ↓ gorzej. Opis ma zwykle kilka
potrzeb naraz, więc tu miesza się wpływ wszystkich (np. senior + cisza + zieleń odsuwa top od
przychodni).

| Potrzeba | Opisów | Wskaźnik | Profil | Stara | Stara tabela, nowe składanie | Nowa | Stara − profil | Nowa − profil |
|---|---|---|---|---|---|---|---|---|
| dzieci | 96 | przedszkole (m) | 112,0 | 141,0 | 124,5 | 120,0 | ↓ 29,0 | ↓ 8,0 |
| dzieci | 96 | plac zabaw (m) | 89,5 | 126,0 | 108,0 | 94,0 | ↓ 36,5 | ↓ 4,5 |
| pies | 41 | zieleń 100 m (%) | 77,0 | 59,0 | 82,0 | 78,5 | ↓ −18,0 | ↑ 1,5 |
| pies | 41 | weterynarz (m) | 364,5 | 838,0 | 369,5 | 274,5 | ↓ 473,5 | ↑ −90,0 |
| zieleń | 72 | zieleń 100 m (%) | 77,0 | 46,8 | 82,0 | 80,0 | ↓ −30,3 | ↑ 3,0 |
| zieleń | 72 | udział zieleni (%) | 87,8 | 92,1 | 96,5 | 94,2 | ↑ 4,3 | ↑ 6,4 |
| powietrze | 37 | PM2,5 (µg/m³) | 14,6 | 14,3 | 14,2 | 14,3 | ↑ −0,3 | ↑ −0,3 |
| powietrze | 37 | NO₂ (µg/m³) | 16,6 | 18,7 | 16,4 | 16,4 | ↓ 2,1 | ↑ −0,2 |
| rower | 37 | infrastruktura rowerowa (m) | 212,0 | 61,5 | 158,5 | 66,0 | ↑ −150,5 | ↑ −146,0 |
| rower | 37 | stojaki 300 m (szt.) | 49,0 | 154,8 | 64,5 | 129,0 | ↑ 105,8 | ↑ 80,0 |
| bez samochodu | 69 | przystanek (m) | 163,9 | 120,1 | 161,1 | 148,4 | ↑ −43,8 | ↑ −15,6 |
| bez samochodu | 69 | kursy w szczycie (/h) | 12,0 | 24,0 | 15,5 | 15,0 | ↑ 12,0 | ↑ 3,0 |
| senior | 73 | przychodnia (m) | 172,0 | 430,5 | 171,0 | 157,0 | ↓ 258,5 | ↑ −15,0 |
| senior | 73 | ławki 300 m (szt.) | 116,5 | 81,0 | 118,5 | 128,5 | ↓ −35,5 | ↑ 12,0 |
| praca w centrum | 83 | czas do Rynku (min) | 40,0 | 16,0 | 28,0 | 24,0 | ↑ −24,0 | ↑ −16,0 |
| lekarz blisko | 52 | przychodnia (m) | 172,0 | 430,5 | 155,0 | 159,5 | ↓ 258,5 | ↑ −12,5 |
| lekarz blisko | 52 | apteka (m) | 102,5 | 229,0 | 106,0 | 112,5 | ↓ 126,5 | ↓ 10,0 |
| lotnisko | 28 | czas do Balic (min) | 70,0 | 40,0 | 40,0 | 40,0 | ↑ −30,0 | ↑ −30,0 |
| cisza | 66 | hałas (% top > 50 dB) | 0,0 | 12,0 | 0,0 | 0,0 | ↓ 12,0 | = 0,0 |
| cisza | 66 | bary i kluby (% top > 0) | 11,0 | 11,0 | 11,0 | 0,0 | = 0,0 | ↑ −11,0 |
| sklepy | 45 | sklep (m) | 54,0 | 63,5 | 57,0 | 51,0 | ↓ 9,5 | ↑ −3,0 |
| sklepy | 45 | gastronomia (m) | 79,0 | 37,5 | 92,0 | 69,0 | ↑ −41,5 | ↑ −10,0 |
| bezpieczeństwo | 30 | teren osuwiskowy (% top) | 0,0 | 0,0 | 0,0 | 0,0 | = 0,0 | = 0,0 |
| bezpieczeństwo | 30 | latarnie 100 m (szt.) | 2,0 | 5,0 | 2,0 | 4,0 | ↑ 3,0 | ↑ 2,0 |
| inwestycja | 39 | pozwolenia 500 m (szt.) | 12,0 | 9,0 | 11,0 | 11,0 | ↓ −3,0 | ↓ −1,0 |
| mieszkam sam | 81 | kursy w szczycie (/h) | 16,5 | 24,0 | 16,5 | 16,5 | ↑ 7,5 | = 0,0 |
| mieszkam sam | 81 | czas do Rynku (min) | 13,0 | 14,0 | 13,0 | 13,0 | ↓ 1,0 | = 0,0 |

### Wynik 2: efekt krańcowy

Porównujemy ten sam opis bez potrzeby i z nią, przy tych samych pozostałych potrzebach.
Podajemy medianę zmiany i liczbę opisów, w których wskaźnik się poprawił / pogorszył.

| Potrzeba | Wskaźnik | Stara | Stara tabela, nowe składanie | Nowa |
|---|---|---|---|---|
| dzieci | przedszkole (m) | = 0,0 (43 / 44) | ↓ 12,5 (4 / 72) | ↓ 4,5 (20 / 74) |
| dzieci | plac zabaw (m) | ↑ −0,8 (48 / 40) | ↓ 13,3 (3 / 73) | = 0,0 (42 / 46) |
| pies | zieleń 100 m (%) | = 0,0 (12 / 1) | = 0,0 (18 / 0) | ↑ 1,5 (33 / 7) |
| pies | weterynarz (m) | = 0,0 (10 / 3) | = 0,0 (5 / 13) | ↑ −79,0 (40 / 1) |
| zieleń | zieleń 100 m (%) | = 0,0 (18 / 19) | ↑ 5,0 (42 / 0) | ↑ 3,0 (71 / 1) |
| zieleń | udział zieleni (%) | = 0,0 (16 / 8) | ↑ 8,6 (42 / 0) | ↑ 5,2 (70 / 1) |
| powietrze | PM2,5 (µg/m³) | ↑ −0,1 (25 / 3) | ↑ −0,3 (37 / 0) | ↑ −0,3 (37 / 0) |
| powietrze | NO₂ (µg/m³) | = 0,0 (9 / 15) | ↑ −0,1 (37 / 0) | ↑ −0,1 (32 / 3) |
| rower | infrastruktura rowerowa (m) | ↑ −2,0 (23 / 2) | = 0,0 (6 / 15) | ↑ −51,0 (37 / 0) |
| rower | stojaki 300 m (szt.) | = 0,0 (14 / 10) | = 0,0 (14 / 0) | ↑ 20,5 (26 / 10) |
| bez samochodu | przystanek (m) | = 0,0 (34 / 12) | ↑ −1,8 (40 / 11) | ↑ −9,7 (51 / 18) |
| bez samochodu | kursy w szczycie (/h) | = 0,0 (30 / 4) | = 0,0 (32 / 6) | ↑ 1,8 (42 / 9) |
| senior | przychodnia (m) | ↓ 64,0 (18 / 47) | ↑ −1,0 (51 / 5) | = 0,0 (31 / 20) |
| senior | ławki 300 m (szt.) | ↑ 1,0 (44 / 21) | ↑ 4,5 (59 / 0) | ↑ 4,0 (51 / 8) |
| praca w centrum | czas do Rynku (min) | ↑ −2,0 (43 / 0) | ↑ −3,0 (58 / 0) | = 0,0 (41 / 0) |
| lekarz blisko | przychodnia (m) | = 0,0 (4 / 2) | ↑ −16,0 (52 / 0) | = 0,0 (12 / 0) |
| lekarz blisko | apteka (m) | = 0,0 (5 / 1) | ↑ −2,0 (47 / 0) | = 0,0 (12 / 0) |
| lotnisko | czas do Balic (min) | ↑ −20,0 (17 / 0) | ↑ −17,5 (20 / 0) | ↑ −10,0 (19 / 0) |
| cisza | hałas (% top > 50 dB) | = 0,0 (7 / 14) | = 0,0 (16 / 0) | ↑ −1,0 (47 / 3) |
| cisza | bary i kluby (% top > 0) | = 0,0 (28 / 7) | = 0,0 (2 / 4) | ↑ −11,0 (66 / 0) |
| sklepy | sklep (m) | ↑ −3,5 (28 / 0) | ↑ −4,0 (26 / 0) | ↑ −6,5 (44 / 0) |
| sklepy | gastronomia (m) | ↑ −0,5 (26 / 1) | = 0,0 (15 / 6) | ↑ −22,0 (41 / 4) |
| bezpieczeństwo | teren osuwiskowy (% top) | = 0,0 (0 / 0) | = 0,0 (0 / 0) | = 0,0 (0 / 0) |
| bezpieczeństwo | latarnie 100 m (szt.) | ↑ 0,8 (21 / 0) | = 0,0 (0 / 0) | ↑ 2,5 (29 / 0) |
| inwestycja | pozwolenia 500 m (szt.) | ↓ −3,0 (4 / 32) | ↓ −1,0 (2 / 31) | ↓ −1,0 (2 / 32) |
| mieszkam sam | kursy w szczycie (/h) | ↑ 1,8 (41 / 8) | = 0,0 (0 / 0) | = 0,0 (0 / 0) |
| mieszkam sam | czas do Rynku (min) | = 0,0 (31 / 18) | = 0,0 (0 / 0) | = 0,0 (0 / 0) |

### Wynik 3: skutki uboczne

Mediana po 420 opisach.

| | Profil | Stara | Stara tabela, nowe składanie | Nowa |
|---|---|---|---|---|
| Warstwy liczone w wyniku | 22 | 52 | 22 | 24 |
| Rozrzut wyników adresów (p90 − p10, pkt) | 31,2 | 29,4 | 32,7 | 32,7 |
| Wynik samego profilu w top 100 (śr., pkt) | 81,6 | 77,3 | 81,5 | 81,2 |
| Top 100 wspólne z top samego profilu (%) | 100 | 8 | 72 | 58 |

Rozkład wyników się nie spłaszcza: stara tabela zwężała go (31,2 → 29,4 pkt), nowa lekko
poszerza (32,7). Stara wymieniała 92% top 100 i kosztowała 4,3 pkt dopasowania do profilu.
Nowa wymienia 42% i kosztuje 0,4 pkt.

### Wnioski

- **Lepiej niż stara tabela** (nowa przesuwa top we właściwą stronę, stara w złą albo wcale):
  - pies: weterynarz −90 m, zieleń bez strat; stara: −18 pp zieleni;
  - zieleń: +3 pp; stara: −30 pp;
  - senior: przychodnia −15 m, ławki +12; stara: +258 m do przychodni;
  - lekarz blisko: przychodnia −12,5 m; stara: +258 m;
  - powietrze: NO₂; stara: +2,1;
  - cisza: 0% top przy barach, hałas bez pogorszenia; stara: 12% top powyżej 50 dB;
  - sklepy: sklep −3 m, gastronomia −10 m;
  - bezpieczeństwo: latarnie;
  - inwestycja: −1 pozwolenie zamiast −3.
- **Podobnie albo trochę słabiej, ale z mniejszą ceną**:
  - rower: −146 m zamiast −150 m, stojaki +80 zamiast +106;
  - bez samochodu: przystanek −16 m zamiast −44 m, kursy +3 zamiast +12;
  - praca w centrum: −16 min zamiast −24 min.

  Stara tabela osiągała tu więcej, bo włączała WSZYSTKIE warstwy transportu i codzienności
  naraz. Płaciła za to zmianą 92% top i gorszym wynikiem w innych potrzebach tego samego opisu.
  Efekt krańcowy samej potrzeby jest w nowej tabeli większy: rower −51 m wobec −2 m, przystanek
  −9,7 m wobec 0.
- **Gdzie nowa tabela wciąż pogarsza wskaźnik:**
  - **dzieci → przedszkole** +8 m wobec profilu (stara +29 m). Efekt krańcowy to +4,5 m
    (20 opisów lepiej, 74 gorzej). Rodzina waży już przedszkole na 4, a potrzeba dokłada plac
    zabaw i bibliotekę. To wymiana między placówkami dla dzieci, a nie utrata: plac zabaw ma
    medianę 0 (42 opisy lepiej, 46 gorzej), a przy top 300 69 lepiej i 4 gorzej.
  - **lekarz blisko → apteka** +10 m wobec profilu. To wpływ innych potrzeb tych samych opisów:
    efekt krańcowy samego „lekarza” to 12 opisów lepiej i 0 gorzej, a przy top 300 zmiana
    wynosi 0.
  - **inwestycja → pozwolenia** −1: projekty BO (3) rozcieńczają pozwolenia, które Inwestor
    i tak waży na 4. Tabelę zostawiam (stara: −3).
  - **mieszkam sam** nic już nie zmienia. Nie ma własnych warstw, a jej poziomy kategorii (z
    samych potrzeb) wag nie ruszają. Wagi niesie profil Singiel. Stara tabela poprawiała kursy
    (41 opisów lepiej, 8 gorzej), ale czas do Rynku przesuwała w obie strony (31 / 18).
- Przy top 300 wnioski są te same. Wyjątek: przy „ciszy” hałas jest o 1,1 pp gorszy niż
  profil (2,1% top powyżej 50 dB wobec 1,0%), przy starej tabeli o 17 pp.

Ograniczenia:

- Część wskaźników spełnienia to warstwy, które nowa tabela waży (weterynarz, stojaki,
  latarnie), więc ich poprawa jest po części z definicji. Mierzy jednak to, czego chcieliśmy:
  czy waga przebija się przez resztę wyniku. Stara tabela pokazuje, że nie musi.
- Top 100 z 176 tys. adresów bywa skupione na kilku ulicach.
- Etykiety zbiorów ułożyły agenty AI.
- Persona null liczymy jako Rodzinę, czyli profil domyślny.

## Nowe potrzeby (#183)

Sześć nowych potrzeb, z id ze słownika zbioru nr 8: `auto`, `wozek`, `praca_zdalna`,
`zycie_nocne`, `sport`, `student`. Każda ma twierdzenie dla JEV z kryteriami prawda/fałsz (#163)
pisanymi o przyszłym mieszkańcu (#162), wiersz w tabeli POTRZEBY (warstwy, wagi 1–4, kierunek tylko
dla warstw neutralnych) i reguły zapasowe z przeczeniami. Wiersze są na końcu tabeli, więc kolejność
starych pytań się nie zmienia. Główny pomiar zrobi #184 na zbiorze nr 8. Niżej są tylko sprawdzenia
celowane.

| Potrzeba | Warstwy (waga) | Kierunek nadany |
|---|---|---|
| auto | dojazd utwardzony (3), drogi gruntowe w 300 m (2), SPP (1), ładowarka EV (1) | SPP: 0 = lepiej |
| wozek | obniżone krawężniki (4), przychodnia bez barier (4), przystanek (3), sklep (3), dojazd utwardzony (3), ławki (2) | – |
| praca_zdalna | hałas (3), zieleń 100 m (2), udział zieleni (2), słońce w grudniu (2), sklep, gastronomia, paczkomat (po 2) | – |
| zycie_nocne | bary i kluby w 300 m (4), gastronomia (3), czas do Rynku (3), kultura (2) | bary: więcej = lepiej |
| sport | obiekty sportowe ZIS (3), siłownia plenerowa (3), udział zieleni (3), zieleń 100 m (2), infrastruktura rowerowa (2), kąpielisko (1) | – |
| student | akademik (3), przystanek (3), kursy w szczycie (3), czas do Rynku (2), mediana ceny m² (2) | akademik: mniej = lepiej |

Czego nie ma w danych: dojazdu do głównej drogi, spadków terenu, uczelni (akademik to
przybliżenie, bo domy studenckie stoją przy kampusach) i ceny najmu (mediana ceny m² to cena
sprzedaży, tylko w Krakowie). P+R i SCT pominięte. P+R według opisu warstwy służy dojeżdżającym
spoza miasta. W SCT jest 77% adresów Krakowa, a prawo wjazdu zależy od pojazdu, którego nie znamy.
Dla pracy zdalnej „mniej wagi na dojazd” nie da się zapisać, bo potrzeby tylko podnoszą wagi
(maksimum, #177).

**Nachodzenie na siebie zostaje:**
- `wozek` i `zdrowie`: reguła `zdrowie` dalej łapie „wózek”, też dziecięcy.
- `student` i `singiel`: to samo słowo „student”.
- `auto` i `bez_samochodu`: wykluczają się, rozstrzyga przeczenie.
- `zycie_nocne` i `cisza`: przeciwne kierunki dla barów w 300 m. Przy obu potrzebach wygrywa
  `cisza`, bo jest wcześniej w tabeli. Zostaje sama gastronomia, kultura i czas do Rynku: lokale
  blisko, ale nie pod oknem. To jedyny wyjątek w teście sprzecznych kierunków.
- `koszty`, `kolej` i `sasiedzi` (fc3c399) są bez zmian i bez dublowania.

**Profil.** Tylko `student` → Singiel. Na zbiorach 1–7 osoba, która sama studiuje, ma w złocie
Singla 9 razy na 12, w pozostałych 3 przypadkach null (współlokatorzy) i ani razu innego profilu.

### Limit pośrednika: 16 → 32 pytań

„Opisz siebie” ma teraz 22 pytania: 1 profil, 3 kategorie, 16 potrzeb i 2 twierdzenia bramki.
`LIMITY.pytan` w `api/_jev.js` podniosłem z 16 do 32. To nasz limit, bo JEV ogranicza tylko
liczbę tokenów (64 tys.). Bezpiecznik znaków (60 tys.) zostaje.

Pomiar na żywo, `wolajJev` z timeoutem 5 s, żeby zobaczyć pełny rozkład:

| | Pytań | Ciało żądania do JEV | Opóźnienie |
|---|---|---|---|
| 16 tekstów celowanych | 22 | 8016–8044 znaków | p50 288 ms, śr. 298 ms, max 440 ms |
| 4 te same teksty, stare pytania | 16 | 4536–4564 znaków | śr. 282 ms (22 pytania na tych samych tekstach: śr. 291 ms) |

Ciało żądania jest o ok. 3,5 tys. znaków (+76%) większe. Opóźnienie praktycznie się nie zmienia:
+9 ms średnio na parze, to mniej niż szum. Żadne z 20 wywołań nie przekroczyło 800 ms (timeout
pośrednika). Zapas do 800 ms jest taki sam jak w #174, więc ryzyko pojedynczych timeoutów też.

### Rozpoznanie na żywo (20 wywołań)

16 tekstów: 7 z nową potrzebą w złocie, 9 typowych pomyłek („near miss”) i 1 kontrolny bez nowych
potrzeb. Próg potrzeby to 0,6.

| Tekst | Złoto | noul nowej potrzeby | Wynik końcowy | Reguły |
|---|---|---|---|---|
| Dojeżdżam samochodem…, potrzebuję miejsca parkingowego | auto | auto 0,95 | auto | auto |
| Mąż porusza się na wózku…, bez barier | wozek | wozek 0,96 | wozek | wozek |
| Pracuję zdalnie, cały dzień siedzę w domu… | praca_zdalna | 0,99 | praca_zdalna | praca_zdalna |
| Lubię wieczorem wyjść na piwo, knajpy i kluby… | zycie_nocne | 0,97 | zycie_nocne | zycie_nocne |
| Biegam codziennie rano… basen | sport | 0,97 | sport (bramka zamknięta, ≥ 0,9 zostaje) | sport |
| Córka… zaczyna studia na AGH, szukamy jej kawalerki | student | 0,94 | student, Singiel | student |
| Jestem studentką UEK, mieszkam sama i nie mam auta | student, nie auto | student 0,98, auto 0,02 | bez_samochodu, student | student |
| **Mam auto, ale na co dzień jeżdżę rowerem** | nie auto | auto 0,04 | rower | auto ✗ |
| **Kiedyś studiowałem w Krakowie…** | nie student | 0,03 | – | – |
| Spacerujemy z wózkiem, mała ma pół roku | nie wozek | 0,04 | dzieci, zieleń | – (po poprawce) |
| Kiedyś pracowałem zdalnie, teraz… do biura | nie praca_zdalna | 0,03 | – | – (po poprawce) |
| Nie chcę knajp pod oknem… | nie zycie_nocne | 0,02 | – | – |
| Kiedyś grałem w piłkę… | nie sport | 0,02 | – | – |
| Kupuję mieszkanie pod wynajem dla studentów | nie student | 0,05 | inwestycja | – |
| Dorabiam w knajpie na Kazimierzu… | nie zycie_nocne | **0,63** | – (bramka zamknięta) | – |
| Mam dwoje dzieci i psa… rowerem (kontrola) | żadna nowa | maks. 0,23 | dzieci, pies, rower | – |

- **JEV:** 7/7 trafień (wszystkie ≥ 0,94). Na 9 pomyłkach 8 razy ≤ 0,05. Wyjątek to praca
  w knajpie: 0,63, tuż nad progiem. Kryteria mówią wprost „praca w knajpie to nie to samo”. Tu
  potrzebę i tak odcięła bramka, ale przy otwartej bramce (z „szukam”) by przeszła. Przykładu pod
  to zdanie nie dopisałem, bo to byłoby strojenie pod test. Na tekstach bez nowej potrzeby w złocie
  najwyższe noul to 0,44 (życie nocne przy „studentce”) i 0,42 (auto przy „jeżdżę do biura”).
- **Reguły:** 7/7 trafień. Pierwszy przebieg łapał 3 pomyłki: wózek dziecięcy („z wózkiem”), czas
  przeszły („pracowałem zdalnie”) i „mam auto, ale jeżdżę rowerem”. Dwie pierwsze poprawiłem we
  wzorcach (bez „z wózkiem”, bez „pracował… zdalnie”), obie mają test. Trzecia zostaje, bo reguła
  nie odróżni „mam auto, ale…”. Reguły to tylko zapas.
- **Bramka:** zamknęła się na 5 tekstach bez słowa „szukam” (opis samej czynności). To zachowanie
  sprzed #183 (#162), nie nowych pytań. W #184 trzeba to policzyć osobno.

Wywołania na żywo: **20** (16 + 4 sparowane), bez ponowień.

### Spełnienie potrzeby bez sieci (`spelnienie.ts --syntetyczne`)

`spelnienie.ts` dostał wskaźniki spełnienia sześciu nowych potrzeb (MIARY) i 25 przypadków
syntetycznych (`SYNTETYCZNE`), po 4–5 na potrzebę, z różnymi profilami i potrzebami bazowymi.
Efekt krańcowy to zmiana top 100 adresów po dodaniu nowej potrzeby do profilu i potrzeb bazowych,
liczona bieżącą tabelą i bieżącym składaniem:

| Nowa potrzeba | Wskaźnik | Mediana zmiany | Lepiej / gorzej / bez zmian |
|---|---|---|---|
| auto | dojazd utwardzony (% top) | ↑ +1 pp | 2 / 0 / 2 |
| auto | w strefie płatnego parkowania (% top) | ↑ −38 pp | 4 / 0 / 0 |
| wozek | obniżone krawężniki w 300 m | ↑ +3,5 szt. | 3 / 0 / 1 |
| wozek | przychodnia bez barier | ↑ −139 m | 4 / 0 / 0 |
| praca_zdalna | hałas > 50 dB (% top) | ↑ −15 pp | 2 / 0 / 2 |
| praca_zdalna | zieleń w 100 m | ↑ +20 pp | 2 / 2 / 0 |
| zycie_nocne | bar w 300 m (% top) | ↑ +1 pp | 3 / 0 / 1 |
| zycie_nocne | gastronomia | ↑ −6 m | 4 / 0 / 0 |
| sport | obiekt sportowy ZIS | ↑ −311 m | 4 / 0 / 0 |
| sport | siłownia plenerowa | ↑ −67 m | 4 / 0 / 0 |
| student | akademik | ↑ −66 m | 5 / 0 / 0 |
| student | kursy w szczycie | ↑ +3 kursy/h | 3 / 1 / 1 |

- Wszystkie potrzeby przesuwają top we właściwą stronę. Wyjątki:
  - zieleń przy pracy zdalnej, gdy profil (Rodzina, pies) już ją waży na 4: −1 do −1,5 pp,
    w granicach remisów;
  - kursy u studenta z rowerem: −2.
- `zycie_nocne` przy `cisza` (S16): bar w 300 m 0% przed i po, bo cisza wygrywa z założenia.
  Gastronomia i tak się przybliża (−8,5 m).
- **SPP z wagą 2 było za mocne.** Warstwa 0/1 robi skok wyniku: u Singla z pracą w centrum (S02)
  auto wyrzucało cały top ze strefy i z top samego profilu zostawał 1%. Przy wadze 1 zostaje 52%,
  a odsetek top w SPP i tak spada z 99% do 51%. Zostaje 1.
- Najmocniej przestawiają top sport u Singla (S17: 5% wspólnego top) i praca zdalna u Singla (S09:
  15%, top wychodzi z hałaśliwego centrum). Tak ma być, bo profil Singla nie ma tych warstw.

Bez sieci, do powtórzenia: `node src/ai/pomiar/spelnienie.ts --syntetyczne`.

## Siła i „nie chcę” (#182)

Przed #182 potrzeba była zero-jedynkowa, a „nie chcę knajp pod oknem” niczego nie zmieniało.
Silnik się nie zmienił. JEV dalej wybiera tylko z zamkniętych list: ocenia twierdzenia (noul)
i wybiera poziom na skali (score). Słownik jest wspólny ze zbiorem nr 8: siła 1 = „byłoby miło”,
2 = „wyraźnie ważne”, 3 = „bardzo ważne / warunek”, a 7 id „nie chcę” jest takich jak w etykietach.

### Siła: skąd ją brać (próba na żywo)

Sprawdziliśmy 4 źródła w jednym pełnym żądaniu (31 pytań). Mieliśmy 24 celowane zdania z siłą
ustaloną przy pisaniu: pierwsze 16 w dwóch przebiegach (A/A), 8 nowych tylko w drugim. Liczymy
tylko potrzeby, które JEV rozpoznał (noul ≥ 0,6).

| Źródło siły | Pytań | Przebieg 1 (16 zdań) | Przebieg 2 (24 zdania) |
|---|---|---|---|
| stała 2 | 0 | 47% (błąd 0,53) | 38% (0,62) |
| brak siły (= waga z tabeli, jak przed #182) | 0 | 37% (0,79) | 46% (0,69) |
| pasma noul twierdzenia (≥ 0,95 / 0,8 / 0,6) | 0 | 53% (0,53) | 58% (0,50) |
| jedno pytanie score o siłę wymagań w całym tekście | 1 | 58% (0,47) | 62% (0,46) |
| **3 pytania score – po jednym na grupę potrzeb** | 3 | **68% (0,32)** | **73% (0,31)** |
| grupy z progiem pewności 0,5 | 3 | 58% (0,47) | 69% (0,35) |

Wygrało źródło **3 pytania score na grupę**: dom (dzieci, pies, senior, zdrowie, sklepy),
otoczenie (zieleń, powietrze, cisza, bezpieczeństwo) i dojazdy (rower, bez samochodu, praca
w centrum, lotnisko, kolej). Skala ma 4 poziomy: 0 = „tekst nie mówi”, 1–3 = siła. Siła potrzeby
to zaokrąglona ocena jej grupy. Ocena 0 przy rozpoznanej potrzebie oznacza brak siły, czyli
wagę z tabeli. Potrzeby z #183 wózek, auto i student należą do grup dom i dojazdy. Praca
zdalna, życie nocne i sport nie należą do żadnej grupy, więc mają wagę z tabeli. Noul mówi, czy twierdzenie jest prawdziwe, a nie jak mocno. „Mam psa, fajnie
byłoby mieć skwer” daje pies 0,94, choć siła wynosi 1. Osobne pytanie score na każdą potrzebę
to co najmniej 10 pytań więcej. Zawodzi to, że jedna grupa ma jedną siłę, np. „astma córki to
warunek” podnosi też dzieci do 3. Oceny grup są stabilne: w A/A różnią się o ±0,15. Zdania pisał
ten sam agent, który ustalał siłę, więc wynik jest optymistyczny. Wynik nagłówkowy policzy #184
na zbiorze nr 8.

**Siła → waga** (`wagaZSily`): przy sile 3 warstwa potrzeby dostaje wagę z tabeli POTRZEBY, przy
2 o 1 mniej, a przy 1 o 2 mniej, ale nie mniej niż 1. Brak siły daje wagę z tabeli, tak jak
przed #182. Tak jest przy regułach bez słów siły i przy JEV bez oceny. Reguły zapasowe ustawiają
jedną siłę dla całego tekstu: „koniecznie / warunek / najważniejsze” = 3, „byłoby miło /
niekoniecznie” = 1.

### „Nie chcę”: tabela

7 twierdzeń noul z kryteriami prawda/fałsz (jak w #163) i progiem 0,6. Każde przejmuje
istniejące warstwy, które liczą się w silniku, i nadaje im kierunek (`kierunki`, jak suwak
kierunku w panelu):

| Id | Warstwy (waga, kierunek) |
|---|---|
| zycie_nocne_obok | bary/kluby w 300 m (4, mniej), najbliższa gastronomia (1, dalej) |
| turysci | miejsca noclegowe w 300 m (4, mniej) |
| szkola_obok | najbliższa szkoła (2, dalej), plac zabaw (1, dalej) |
| duza_droga | hałas LDWN (4, mniej), NO2 (2, mniej) |
| przemysl | zakład z rejestru PRTR (4, dalej), zakład Seveso (3, dalej) |
| imprezy | dni z wydarzeniem w dużych obiektach w 500 m (4, mniej), imprezy stałe w 500 m (3, mniej) |
| budowy | pozwolenia na budowę w 500 m (4, mniej) |

Nie ma warstwy „duża ulica”. Mapa hałasu to głównie hałas drogowy i tramwajowy, a NO2 to spaliny.
Silnik nie ma kierunku „optimum”, więc „szkoła obok” ustawia „dalej = lepiej” z małą wagą.
Pierwsze brzmienie twierdzenia o turystach dało 0,54 na „mam dość turystów z walizkami”.
Twierdzenie „Osobie przeszkadzają turyści…” daje 0,95.

### Reguła sprzecznych kierunków

1. „Nie chcę” wygrywa kierunek swojej warstwy: z profilem (Inwestor + „budowy” → pozwolenia
   mniej), z bieżącymi ustawieniami i z potrzebą na tak („dzieci” + „szkoła obok” → plac zabaw
   dalej). Waga tej warstwy to maksimum tylko z wag zgodnych z tym kierunkiem. Waga 4 placu
   zabaw z „dzieci” nie wzmacnia więc „placu zabaw dalej”.
2. Dwie potrzeby na tak z przeciwnymi kierunkami: wygrywa silniejsza, a brak siły liczy się
   jak 3. Przy remisie wygrywa wcześniejsza w POTRZEBY. Dziś żadne dwie nie są sprzeczne.
   Pierwsza będzie „życie nocne” z #183 przeciw „ciszy”.
3. Kierunek z profilu albo bieżących ustawień wygrywa z potrzebą na tak, bez zmian od #177.

### Bez sieci: przypadki syntetyczne (`node src/ai/pomiar/spelnienie.ts --182`)

Mamy 21 przypadków „nie chcę”: 7 id × 3 konteksty (Rodzina + dzieci, Singiel + bez samochodu,
Senior + zdrowie), top 100 adresów. Top odsuwa się od rzeczy niechcianej w 19 z 21 przypadków
i nie pogarsza się w żadnym. W dwóch pozostałych top już był od niej wolny. Przykłady:
- bary w 300 m: Singiel 99% → 0% top;
- noclegi w 300 m: 59–100% → 2–39%;
- szkoła: mediana 146–208 m → 230–283 m;
- zakład PRTR: +875–1480 m;
- hałas > 55 dB u Singla: 41% → 0%.

Siła na 8 potrzebach (16 wskaźników), profil → profil + potrzeba z siłą 1, 2 i 3: siła 3 przesuwa
top co najmniej tak mocno jak 1 w 14 z 16 wskaźników. Przykłady: zieleń w 100 m +2 / +3 / +5 pp,
weterynarz −36 / −70 / −73 m, droga rowerowa −6 / −6 / −15 m. W dwóch wyjątkach profil już ma
tę warstwę z wagą 4 (przedszkole u Rodziny, przystanek u Singla), więc zmiana to szum: +3 m
i +0,3 m.

### Na żywo: końcowe zapytanie

Zapytanie ma 32 pytania, czyli cały nowy limit pośrednika (16 → 32): 22 z #183, 7 „nie chcę”
i 3 o siłę. Puściliśmy je dwa razy na tych samych 24 zdaniach przez `przetworzOdpowiedzi`.
Pierwszy raz było przed scaleniem #183: 26 pytań i 6 zaślepek noul w miejsce jego potrzeb.
Drugi raz po scaleniu, z prawdziwymi twierdzeniami #183. Oba przebiegi dały te same wyniki:
- siła trafna 19 z 26 (73%);
- „nie chcę” trafione 9 z 10, fałszywe 0, w tym na 5 zdaniach kontrolnych: „chcę knajpy blisko”,
  „pod wynajem, gdzie się buduje”, „blisko szkoły dla syna”, „blisko hali, chodzę na koncerty”
  i „zakładów się nie boję”;
- jedyne pominięcie: „nie przy samym boisku szkolnym” (szkola_obok 0,38).

Opóźnienie i rozmiar (pośrednik czeka 800 ms, limit znaków to 60 tys.):
- z zaślepkami: mediana 295 ms, p90 395 ms, max 618 ms;
- z prawdziwym #183: mediana 306 ms, p90 433 ms, max 460 ms;
- pytania mają 12,1 tys. znaków.

Wywołania na żywo: 88 (16 + 24 w próbie źródeł siły, 24 + 24 w sprawdzianach końcowych).

## Na slajd

**Zbiór kontrolny nr 7 (#174).** To 120 opisów i 150 pytań, które napisały na ślepo osobne
agenty AI, bez dostępu do kodu. Wersję końcową (po #172 i #173) zmierzyliśmy na nim w dwóch
osobnych przebiegach (liczby z pierwszego, drugi różni się o 0–2 pozycje). W nawiasach podajemy
95% przedział ufności.

- Na pytanie o adres JEV wskazuje właściwe dane od razu w **95%** pytań (90–97%). Reguły słów
  kluczowych robią to w 42% (34–50%). Gdy JEV nie jest pewny, pokazuje dwie propozycje. Z nimi
  właściwe dane są w **99%** pytań (95–100%).
- Do prostego pytania JEV dokłada zbędną warstwę już tylko w **4%** pytań (1–9%), czyli 4 na
  112. Przed #173 było to 12%.
- Cały opis, czyli profil razem z kompletem potrzeb, JEV rozumie dokładnie w **58%** (49–67%),
  a reguły w 35% (27–44%).
- Z potrzeb wymienionych w opisie JEV wyłapuje 93%, a reguły 71%.
- Profil szukającego JEV trafia w 80% opisów (72–86%), a reguły w 72% (63–79%). Na tym zbiorze
  ta różnica nie jest istotna (p = 0,15). Na zbiorze nr 6 była (85% wobec 72%).
- Odpowiedź przychodzi zwykle po ok. 0,3 s, a w 95% przypadków przed upływem 0,4 s (opis) i 0,65 s
  (pytanie). Z 1415 wywołań 2 przekroczyły limit 0,8 s i poszły ponownie (pomiar lokalny,
  nie z produkcji).
- Słabe strony: w pytaniach o kilka rzeczy naraz komplet tematów JEV daje tylko w 36% (20–55%).
  Między dwoma identycznymi przebiegami ok. 8% odpowiedzi różni się szczegółem (głównie potrzeba
  albo poziom kategorii przy progu).

Zbiory pisały agenty AI, a nie ludzie. Wynik zależy od zbioru: „dokładnie” wyniosło 33%, 75%,
61% i 58% na zbiorach nr 4–7. Dlatego zawsze podajemy go z nazwą zbioru.

### Wcześniej (historia, zastąpione zdaniami wyżej)

**Wersja z #170 (zbiór kontrolny nr 6, 150 opisów i 150 pytań, przed #172 i #173):**

- warstwa główna od razu: 97% (93–99%), reguły 37% (29–45%);
- profil: 85% (79–90%), reguły 72% (64–79%);
- cały opis dokładnie: 61% (53–69%), reguły 47% (39–55%);
- potrzeby: 84%, reguły 69%;
- komplet tematów w pytaniach złożonych: 23% (12–41%); zbędna warstwa do co siódmego prostego
  pytania.

**Po #163 (zbiór kontrolny nr 5, 40 opisów i 35 pytań).** Osobne przebiegi w #170 dały 94%
warstwy głównej i 75% „dokładnie”. Wspólne zapytanie z #163 dało 97% i 78%.

**Po rundzie #154–#156 (zbiór kontrolny nr 4, 40 opisów i 35 pytań):**

- warstwa główna: od razu 91%, po kliknięciu propozycji 97% (reguły: 66%);
- profil: 85%, bez ani jednego profilu innego niż we wzorcu (reguły: 63%);
- potrzeby: 7 z 10 (reguły: 6 z 10);
- cały opis dokładnie: 33% (reguły: 28%);
- pytania złożone: pokrycie 60% (reguły: 52%).

## Surowe przebiegi i research

Przebiegi pozycja po pozycji (odpowiedzi JEV, pewności, prawdopodobieństwa, czasy – bez klucza
i nagłówków) leżą w `przebiegi/`, żeby dało się je przeliczać offline (`pomiar.ts --z-pliku`)
bez nowych wywołań:

| Plik | Co | Zadanie |
|---|---|---|
| `przebiegi/k2-152.json` | zbiór kontrolny nr 2, wersja końcowa | #152 |
| `przebiegi/k3-153.json` | zbiór kontrolny nr 3 | #153 |
| `przebiegi/k4-157.json` | zbiór kontrolny nr 4, runda #154–#156 | #157 |
| `przebiegi/aa-157.json` | test A/A na `jev-1.13.0` (dwa identyczne przebiegi) | #157 |
| `przebiegi/k5-przed-163.json` | zbiór kontrolny nr 5, kod z `main` przed #163 (wersja „przed”) | #163 |
| `przebiegi/k5-po-163.json` | zbiór kontrolny nr 5, #163 (wersja „po”, wynik nagłówkowy) | #163 |
| `przebiegi/k5-proste-163.json` | zbiór kontrolny nr 5, same zwykłe opisy bez struktury (przekrój pomocniczy) | #163 |
| `przebiegi/k6-170.json` | zbiór kontrolny nr 6 (150 + 150), wersja końcowa, wynik nagłówkowy | #170 |
| `przebiegi/k5-przed-osobno-170.json` | zbiór kontrolny nr 5, kod sprzed #163 (`baa4353`), osobny przebieg | #170 |
| `przebiegi/k5-po-osobno-170.json` | zbiór kontrolny nr 5, kod po #163 (`ba69cfd`), osobny przebieg | #170 |
| `przebiegi/aa-170-r1.json`, `aa-170-r2.json` | A/A na końcowym zapytaniu, pełne zbiory do strojenia (format własnego skryptu: wszystkie wywołania, czasy, `usage`) | #170 |
| `przebiegi/latencja-170.json` | opóźnienie końcowego zapytania: wszystkie wywołania z przebiegów A/A i powtórek, podsumowanie | #170 |
| `przebiegi/k2-173.json`, `k4-173.json`, `k5-173.json` | zbiory nr 2, 4 i 5 (B), próg tematu 0,7 – sprawdzian na żywo na zbiorach użytych | #173 |
| `przebiegi/k7-r0-174.json` | zbiór kontrolny nr 7 (120 + 150), kod BASE `c810b48` – bez #172 i #173 | #174 |
| `przebiegi/k7-r1-174.json` | zbiór kontrolny nr 7, BASE + #172 (cherry-pick `59a58c5`) | #174 |
| `przebiegi/k7-r2-174.json` | zbiór kontrolny nr 7, BASE + #173 (`3a9580b`) | #174 |
| `przebiegi/k7-r3-174.json` | zbiór kontrolny nr 7, `main` z #172 i #173 (`59a58c5`), wynik nagłówkowy | #174 |
| `przebiegi/k7-r3b-174.json` | zbiór kontrolny nr 7, powtórka R3 (A/A wersji końcowej) | #174 |

Przebiegów zbioru nr 1 (#147, #150) nie zapisywaliśmy pozycja po pozycji – są tylko liczby
zbiorcze powyżej. Raport z przeglądu projektu JEV (nazwy warstw, prawdopodobieństwa, profil,
co z dokumentacji TypeSafe nie wykorzystujemy): `RESEARCH-JEV.md`.

