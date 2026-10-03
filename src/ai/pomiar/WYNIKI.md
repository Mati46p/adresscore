# Pomiar JEV po polsku (#18)

> Najnowszy wynik jest w sekcji „Trzy błędy (#153)”: wersja po poprawkach zmierzona raz na
> **zbiorze kontrolnym nr 3**, pisanym na ślepo. Zbiór nr 2 mierzyliśmy w „Wersja końcowa (#152)”,
> a zbiór nr 1 w „Poprawki trafności (#147)” i „Druga runda (#150)”. Liczby z #18 niżej dotyczą
> zbioru, na którym potem stroiliśmy.

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

## Na slajd

Liczby pochodzą ze **zbioru kontrolnego nr 3** (#153). Napisał go na ślepo osobny agent AI, bez
dostępu do kodu i poleceń. Wersję po poprawkach zmierzyliśmy na nim raz i potem niczego nie
poprawialiśmy. To 30 opisów i 25 pytań, więc wynik jest orientacyjny.

Zdania z #152 (zbiór nr 2) wymieniłem tam, gdzie zbiór nr 3 ich nie potwierdza:

- Profil: na zbiorze nr 2 był remis (67%), na nr 3 JEV trafia częściej (80% vs 63%). Część tej
  różnicy daje poprawiona bramka – opisy z domownikiem trafione 3 na 3.
- Pytania złożone: na zbiorze nr 2 był remis (69%), na nr 3 JEV jest nieco lepszy (85% vs 78%)
  dzięki drugiemu wywołaniu.

Zdanie o 8 z 10 potrzeb zbiór nr 3 potwierdza (80% vs 63%), więc zostaje.

- Na nowych opisach JEV wyłapuje 8 z 10 wymienionych potrzeb, a reguły słów kluczowych 6 z 10.
- Cały opis (profil i komplet potrzeb) JEV rozumie dokładnie w połowie przypadków (50%), reguły
  w niecałej jednej trzeciej (30%). Profil JEV trafia w 80% przypadków, reguły w 63%.
- Na pytanie o adres JEV wskazuje właściwe dane w 92% przypadków (reguły 68%). Zwykle
  odpowiada w 0,3 sekundy, a gdy pytanie dotyczy dwóch rzeczy z jednej grupy (np. przedszkole
  i żłobek), w ok. 0,6 sekundy. Przy pytaniach o kilka rzeczy naraz pokrywa 85% tematów, reguły
  78% – różnica mniejsza niż jedno pytanie.
