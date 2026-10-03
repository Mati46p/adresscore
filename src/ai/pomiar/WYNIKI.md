# Pomiar JEV po polsku (#18)

> Najnowszy wynik jest w sekcji „Opisy strukturalne (#163)”: przed i po na **zbiorze kontrolnym
> nr 5**, pisanym na ślepo, mierzonym raz. Runda #154–#156 na zbiorze nr 4 i test A/A (szum JEV na
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

## Na slajd

**Po #163 (zbiór kontrolny nr 5, na ślepo, 40 opisów i 35 pytań, mierzony raz).** Zbiór nr 5
potwierdza zdania niżej o wyborze warstwy i profilu, z wyższymi liczbami. Liczby po #163:

- Na pytanie o adres JEV wskazuje właściwe dane od razu w 97% pytań (przed #163: 89%; reguły:
  37%).
- Profil trafia w 95% opisów, a cały opis rozumie dokładnie w 78% (przed #163: 70%; reguły: 35%).
- Opisy warstw po ludzku i definicje „kiedy tak, kiedy nie” dały +3 pozycje w każdej części
  zbioru, bez żadnej pozycji, która przeszła z trafnej na chybioną.
- Na zbiorze nr 4 te same miary wypadły niżej (91% i 33% przed #163). Zbiory różnią się
  trudnością, więc zdania „97%” i „78%” podajemy razem z nazwą zbioru.

Liczby pochodzą ze **zbioru kontrolnego nr 4** (#157). Napisał go na ślepo osobny agent AI, bez
dostępu do kodu i poleceń. Wersję po rundzie #154–#156 zmierzyliśmy na nim raz i potem niczego
nie poprawialiśmy. To 40 opisów i 35 pytań, więc wynik jest orientacyjny. Test A/A pokazał, że
powtórka tego samego zapytania na przypiętym modelu nie zmienia odpowiedzi.

Zdania ze zbioru nr 3 wymieniłem tam, gdzie zbiór nr 4 ich nie potwierdza:

- Potrzeby: na zbiorze nr 3 było 8 z 10, na nr 4 jest 7 z 10 (reguły 6 z 10).
- Cały opis dokładnie: na zbiorze nr 3 było 50% vs 30%, na nr 4 jest 33% vs 28%. Przewaga JEV to
  tu 2 opisy z 40, więc zdanie o „połowie” i dużej różnicy wypada.
- Pytania złożone: na zbiorze nr 3 było 85% vs 78%, na nr 4 jest 60% vs 52%.

Potwierdzają się wybór warstwy (91% vs 66%), profil (85% vs 63%, teraz bez ani jednego profilu
innego niż we wzorcu) i czas odpowiedzi.

- Na pytanie o adres JEV wskazuje właściwe dane od razu w 91% przypadków (reguły 66%). Gdy nie
  jest pewny, pokazuje dwie propozycje do kliknięcia – z nimi właściwe dane są pod ręką w 97%
  pytań.
- Profil JEV trafia w 85% opisów, reguły w 63%. JEV nie przypisał nikomu innego profilu, niż
  powinien; myli się tylko, gdy przypisuje profil tam, gdzie lepiej byłoby go nie zgadywać.
- Z wymienionych potrzeb JEV wyłapuje 7 z 10, reguły słów kluczowych 6 z 10. Cały opis (profil
  i komplet potrzeb) JEV rozumie dokładnie w jednej trzeciej przypadków (33%), reguły w 28%.
- Zwykle odpowiada w 0,3 sekundy, a gdy pytanie dotyczy dwóch rzeczy z jednej grupy (np.
  przedszkole i żłobek), w ok. 0,65 sekundy. Przy pytaniach o kilka rzeczy naraz pokrywa 60%
  tematów, reguły 52% – różnica mniejsza niż jedno pytanie.

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

Przebiegów zbioru nr 1 (#147, #150) nie zapisywaliśmy pozycja po pozycji – są tylko liczby
zbiorcze powyżej. Raport z przeglądu projektu JEV (nazwy warstw, prawdopodobieństwa, profil,
co z dokumentacji TypeSafe nie wykorzystujemy): `RESEARCH-JEV.md`.

