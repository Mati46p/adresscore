# Pomiar JEV po polsku (#18)

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
40–45% i z tą architekturą nie przekroczy 1/n. Tego #18 nie zmienia.

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

## Na slajd

- JEV rozumie złożone opisy w całości w 67% przypadków, reguły słów kluczowych w 30%.
- Gdy ktoś wymienia kilka potrzeb naraz, JEV wyłapuje 9 z 10 z nich, reguły 7 z 10 – i trafia
  profil w 93% opisów (reguły 73%).
- Na pytanie o adres JEV wskazuje właściwe dane w 86% przypadków (reguły 64%) i odpowiada
  w 0,3 sekundy.
