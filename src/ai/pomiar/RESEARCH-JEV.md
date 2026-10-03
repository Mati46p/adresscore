# JEV w adresscore: jak lepiej pytać – rekomendacje

Data: 2026-10-03. Badanie bez zmian w kodzie i bez wywołań JEV. Zbiorów kontrolnych
(`kontrolny*.json`) nie otwierałem. Z pliku `wyniki-na-zywo.json` odczytałem tylko klucze
najwyższego poziomu (przebiegi #18 na zbiorze do strojenia).

Oznaczenia:
- **[FAKT]** – z kodu, z WYNIKI.md albo z dokumentacji TypeSafe, ze wskazaniem miejsca.
- **[DOK]** – dokumentacja producenta, docs.typesafe.ai, odczytana 2026-10-03.
- **[HIPOTEZA]** – mój wniosek, niesprawdzony pomiarem.

---

## 0. W skrócie

1. **Pośrednik wyrzuca `probabilities`** (`api/_jev.js:101-113`). Bez rozkładu nie da się
   zsumować pewności rodziny warstw, pokazać dwóch najlepszych opcji ani rzetelnie stroić
   progów. To najtańsza zmiana o największym zysku: nie zmienia zapytania ani nie dokłada
   wywołań, a nowe przetwarzanie da się policzyć offline z tych samych odpowiedzi.
2. **Lista 93 warstw ma przypadkowy początek.** Pierwszą opcją jest `akademik_odleglosc`, bo
   sortujemy po kategorii, a potem alfabetycznie. Producent pisze, że jev-1.13 „leans toward
   the option that comes first”. Siedem warstw Sejmu to siedem opcji, o które nikt nie pyta.
   Hałas i pozwolenia na budowę mają po dwie warstwy, które różnią się tylko zasięgiem
   (Kraków / obwarzanek). Ten wybór powinien robić kod po adresie, a nie JEV.
3. **Dwa etapy po kolei: nie.** Wybór pojedynczej warstwy jest już na 96% (14/15) i nie on
   jest słabym miejscem. Dwa etapy podwajają czas (ok. 300 → 600 ms) i kumulują błąd pierwszego
   etapu. To samo da się zrobić w jednym wywołaniu: zsumować prawdopodobieństwa w obrębie
   tematu albo dołożyć pytanie choice o temat w tym samym zapytaniu.
4. **„Interferencja” w jednym zapytaniu nie jest udowodniona.** Producent pisze wprost, że
   pytania oceniane są niezależnie. Zmierzone przesunięcia (średnio ok. 0,02) mieszczą się
   w szumie powtórzeń, a #150 miesza się z dojściem 7 warstw Sejmu. Rozbijanie zapytania na
   dwa równoległe nie ma podstaw, dopóki nie zrobimy testu A/A.
5. **Profil (remis 67%):** JEV powinien częściej się wstrzymywać (trafny – średnio 0,95,
   błędny – 0,73). Opisy profili mówią, co jest ważne, a nie kim jest osoba. Stąd para bez
   dzieci ląduje w „Singlu”.
6. **Limity, które sami sobie nałożyliśmy:** 16 pytań, opis opcji tylko jako tekst do 300
   znaków, 128 opcji. TypeSafe przyjmuje opcje jako obiekty z polami `what` / `not_for` /
   `examples` i noul z definicją `true` / `false`. Dokumentacja wskazuje to właśnie na opcje,
   które model myli – czyli na nasze fałszywe dodatki.

---

## 1. Fakty, na których stoję

### Kod

- [FAKT] Zapytanie „zapytaj o adres” to 1 choice (`warstwa`) i 15 twierdzeń noul (`TEMATY`)
  w jednym wywołaniu (`src/ai/zapytajOAdres.ts:384-391`, `TEMATY` w liniach 174-366).
- [FAKT] Opis opcji: `„nazwa (jednostka). [dopisek] pierwsze zdanie opisu”`, przycięty do 300
  znaków (`zapytajOAdres.ts:119-128`). Dopiski mają 20 warstw (`:43-71`).
- [FAKT] Kolejność: kategoria karty według `KOLEJNOSC_KATEGORII` (pierwsza jest
  `codziennosc`, `src/wynik/silnik.ts:17-20`), potem id alfabetycznie (`zapytajOAdres.ts:113-117`).
  Pierwsze opcje to więc `akademik_odleglosc`, `apteka_odleglosc`,
  `bankomat_poczta_odleglosc`, `cas_odleglosc`… `nie_wiem` jest zawsze ostatnie (`:132-137`).
- [FAKT] Próg wyboru warstwy wynosi 0,5 (`:24`, `:408`). Gdy wybór główny spada pod próg,
  przepada **cała** odpowiedź JEV razem z ocenami tematów (`przetworzWiele`, `:430-431`
  → reguły).
- [FAKT] Pośrednik przekazuje tylko `choice` + `confidence` (choice), `noul` i `score` +
  `confidence`. **`probabilities` i `legend` wyrzuca** (`api/_jev.js:101-113`). Typ
  `OdpowiedzJev` też ich nie ma (`src/ai/jev.ts:23-26`). Nikt w `src/` ani `api/` nie czyta
  `probabilities` (grep).
- [FAKT] Limity pośrednika: 16 pytań, polecenie do 300 znaków, 128 opcji choice, opis opcji
  **wyłącznie tekst** do 300 znaków, score 2–10 poziomów (`api/_jev.js:18-26`, sprawdzenie
  w `:66-70`). Timeout to 800 ms (`:16`).
- [FAKT] „Opisz siebie” to 1 choice profilu, 4 score kategorii, 10 noul potrzeb i 1 noul
  bramki = 16 pytań (`src/ai/opiszSiebie.ts:350-365`). Progi: profil i kategorie 0,6 (`:84`),
  potrzeby 0,6 (`:86`), bramka 0,5, a potrzeby pod bramką 0,9 (`:99-100`).
- [FAKT] Opisy profili to zestawy wag, a nie tożsamość osoby. „Singiel w centrum –
  Komunikacja i sklepy pod ręką”, „Rodzina z dziećmi – Zieleń, cisza, czyste powietrze, sklep
  blisko” (`src/wynik/persony.ts:26-76`). Profil wchodzi do zapytania jako
  `${nazwa} – ${opis}` (`opiszSiebie.ts:352-355`).
- [FAKT] Potrzeby `singiel` i `inwestycja` nie mają twierdzenia dla JEV. Po stronie JEV niesie
  je tylko wybór profilu (`opiszSiebie.ts:276-297`, `:473`). Deterministyczny wybór profilu
  z potrzeb już istnieje (`personaZPotrzeb`, `:369-374`, kolejność pierwszeństwa w `:301`).
- [FAKT] Na liście jest 93 warstw, bez atrap (meta z `public/dane/wskazniki`). Są wśród nich:
  - `sejm2023_lista_1…7` (7 opcji „Sejm 2023 · KOMITET…”);
  - pary, które różnią się zasięgiem: `halas_ldwn` / `halas_obwarzanek_lden` („poza
    Krakowem”) oraz `inwestycje_500m` / `inwestycje_500m_obwarzanek`;
  - rodziny miar jednej rzeczy: `powodz_1proc|10proc|02proc`, `pm25|pm10|no2|bap_srednia`,
    `zielen_worldcover_100m|zielen_udzial|drzewa_100m`, `przystanek_odleglosc|kursy_szczyt_h`;
  - warstwy gminne, o które trudno zapytać: `gmina_dlug_pc`, `gmina_inwestycje_pc`,
    `gmina_mpzp_pokrycie_pct`, `przetargi_dzielnica`.
- [FAKT] `inwestycje_500m_obwarzanek` nie należy do żadnego tematu (`TEMATY.plan`,
  `zapytajOAdres.ts:338-351`). Temat hałasu dokłada zawsze `halas_ldwn` (`:179-180`).
- [FAKT] Zbiór do strojenia już traktuje rodziny jako równoważne: na przykład B03 przyjmuje
  każdą z trzech warstw powodzi, B10 każdą z 4 warstw powietrza, a B19 każdą z 3 warstw zieleni
  (`src/ai/pomiar/zbior-zapytaj.json`).

### WYNIKI.md (pomiary)

- [FAKT] Zbiór nr 2 (wynik nagłówkowy, zmierzony raz), JEV kontra reguły
  (`WYNIKI.md:642-681`):
  - warstwa główna: 96% vs 60%;
  - potrzeby F1: 81% vs 66%;
  - profil: 67% vs 67%;
  - pokrycie pytań złożonych: 69% vs 69%;
  - „dokładnie”: 47% vs 27%.
- [FAKT] Pewność coś znaczy (`WYNIKI.md:50-52`, `:673`):

  | Pytanie | Trafne – średnio | Błędne / nietrafione – średnio |
  |---|---|---|
  | profil, #18 | 0,97 | 0,71 |
  | profil, zbiór nr 2 | 0,95 | 0,73 |
  | warstwa | 0,78 | 0,60 |
  | noul potrzeb | 0,82 (potrzeba we wzorcu) | 0,21 (pozostałe) |

- [FAKT] Rozkład pewności między podobnymi warstwami spychał wynik pod próg. „Czy piwnica
  może zalać?” → `powodz_1proc` z pewnością 0,49 (pod progiem). Dopiero dopisek „domyślna”
  podniósł ją do 0,92 (`WYNIKI.md:59-62`). To jest objaw podziału prawdopodobieństwa między
  trzy prawie identyczne opcje.
- [FAKT] JEV jest w praktyce deterministyczny. Powtórka tego samego zapytania zmienia pewność
  średnio o 0,02, a jedna pozycja zmieniła się o 0,08 (0,49 → 0,57) (`WYNIKI.md:78-81`).
- [FAKT] Dołożenie 15 noul obniżyło średnią pewność choice o ok. 0,02 (najwięcej B05:
  0,84 → 0,74) (`WYNIKI.md:211-213`). W #150 zapas wzrósł z 1 do 3 (`:529-531`), ale w tym
  samym czasie lista urosła o 7 warstw Sejmu (`:622-632`). Porównanie jest więc zaburzone.
- [FAKT] Fałszywe dodatki tematów mają noul 0,78–0,93, a prawdziwy temat potrafi mieć 0,68.
  Progiem się ich nie odróżni (`WYNIKI.md:240-242`).
- [FAKT] B23: wybór główny miał 0,49, więc oceny tematów z tego wywołania przepadły
  (`WYNIKI.md:222-223`).
- [FAKT] Profil częściowo chybia przez konwencję etykiet. Autor zbioru kontrolnego daje
  `null` parom bez dzieci, a aplikacja nie ma profilu „para”, więc JEV wybiera Singla
  (`WYNIKI.md:328-332`).
- [FAKT] Pozycje to 30 opisów i 25 pytań: 1 pozycja = 3–4 pp (`WYNIKI.md:679`). Na
  7 pytaniach złożonych nie da się stroić progów.

### Dokumentacja TypeSafe [DOK]

- **Pytania są niezależne.** „Every question in a request sees the same state, is evaluated
  independently… You can add or remove questions without changing the others' results.”
  Wiele pytań w jednym wywołaniu prawie nie wydłuża czasu (docs.typesafe.ai/primitives).
- **Kolejność opcji.** „The order of a Choice's options can affect the answer, and jev-1.13
  leans toward the option that comes first” (model-jaggedness/jev-1.13).
- **Choice:**
  - do 255 opcji;
  - dodaj `other`, gdy lista może nie wystarczyć;
  - zacznij od jednej linii opisu na opcję, a gdy model myli opcje, użyj obiektu z polami
    „what the option covers, what belongs to a neighboring option instead, and a few example
    inputs”;
  - `probabilities` sumują się do 1, a `confidence` liczy się z kształtu rozkładu
    (primitives/choice).
- **Struktura.** Opcje choice, poziomy score, kryteria noul i polecenia przyjmują
  string | object | array | null. Noul ma `criteria.true` / `criteria.false`. Opcje choice
  mogą być zagnieżdżonym drzewem: „each option's value is the child's tree”
  (primitives/advanced; api).
- **State** może być stringiem, obiektem albo tablicą. Producent zaleca obiekt z nazwanymi
  polami i kontekstem („related context, examples…”) (concepts/state).
- **Confidence** (docs.typesafe.ai/confidence):
  - przedziały: > 0,9 działaj, 0,5–0,9 potwierdź, < 0,5 dopytaj lub odeślij;
  - zamiast samej confidence można patrzeć na p_max albo na stosunek pierwszej opcji do
    drugiej;
  - dla noul pewność = |2p − 1|.
- **Brak parametrów temperature, seed ani cache** w API. Kody błędów: 401, 422, 429, 529
  (api).
- **Wzorce wielu wywołań** (cookbooks):
  - hierarchia z beam search: zachłannie 2/4, beam 4/4;
  - „skill suggestion” (182 opcje): pierwsze wywołanie to choice + 3 noul-bramki,
    drugie to choice z pełnymi opisami top-3 i noul „czy pasuje” na kandydata;
  - koszt: 2 wywołania.
- **Język.** Angielski jest głównym językiem treningu; inne języki mają niższą dokładność
  (`z-dykty/specs/050-pytania-udip/research-jev.md` §4).

---

## 2. Odpowiedzi na pytania

### 2.1 Nazwy i opisy warstw

**Czy „nazwa (jednostka). zdanie opisu + dopisek” to dobry projekt etykiety?** Częściowo.
- [FAKT] Gdzie dopisano potoczne słowa, JEV trafia: park (B19), piwnica (B03), tramwaje
  (B02). Wybór pojedynczej warstwy na świeżym zbiorze ma 96%.
- [HIPOTEZA] Opis zaczynający się od techniki („Najwyższe pasmo hałasu (LDWN) (dB).
  Najwyższe opublikowane pasmo LDWN…”) marnuje początek opisu na żargon. Dopisek jest
  intencją użytkownika, a 73 warstwy go nie mają.

**Etykiety intencji („Czy jest głośno?”) czy etykiety danych?**
- [HIPOTEZA] Najlepiej łączyć jedno z drugim, ale dla każdej opcji osobno: intencja na
  początku, dane dalej. Tak już działa `DOPISKI_WARSTW` i to on dał zyski.
- Pełna zamiana na intencje ma koszt: opcja musi nadal jednoznacznie wskazywać warstwę.
  Przy rodzinach (pm25/pm10/no2) dwie opcje „Czy jest smog?” byłyby nierozróżnialne. To
  argument za scaleniem rodziny w jedną opcję (niżej), a nie za samymi etykietami intencji.
- Docelowo (wymaga zmiany pośrednika) opcja jako obiekt, zgodnie z [DOK]
  primitives/advanced:

  ```json
  {
    "what": "...",
    "not_for": "...",
    "examples": ["..."]
  }
  ```

  Przykład dla komunikacji: `not_for: "hałas tramwajów"`. Wykluczenia, które dziś wciskamy
  w twierdzenia tematów, trafiłyby wtedy w miejsce, które producent do tego przewidział.

**Scalanie prawie-duplikatów – tak, ale z wyborem członka rodziny przez kod:**

| Rodzina | Propozycja | Kto wybiera warstwę |
|---|---|---|
| `halas_ldwn` / `halas_obwarzanek_lden` | jedna opcja „hałas” | **kod po adresie**: ta, która ma wartość pod `i` |
| `inwestycje_500m` / `_obwarzanek` | jedna opcja | kod po adresie |
| `sejm2023_lista_1…7` | jedna opcja „wyniki wyborów do Sejmu 2023 w gminie” | kod pokazuje wszystkie albo zwycięzcę |
| `powodz_1/10/02proc` | jedna opcja „powódź” | domyślnie 1%; 10% i 0,2% tylko z reguły słów („co roku”, „najgorszy scenariusz”) |
| `pm25/pm10/no2/bap` | jedna opcja „powietrze/smog” plus osobne `bap` („dym z pieców”) | pm25 domyślnie; pm10/no2 z reguł (`/pm ?10/`, `/azot\|spalin/` już są, `zapytajOAdres.ts:549-551`) |
| przystanek / kursy, zieleń / udział / drzewa | **nie scalać** | to różne pytania („daleko?” vs „jak często?”, „drzewa pod oknem”) |

- [FAKT] Zbiory oceniają rodziny jako równoważne, więc scalanie nie psuje metryki.
- [HIPOTEZA] Hałas dla adresu w obwarzanku dziś daje „brak danych”, bo wybór i temat
  wskazują `halas_ldwn`. **Do sprawdzenia bez sieci**: czy `wartosci` obu warstw się
  uzupełniają. Celowo nie czytałem `wartosci`.

**Wykluczać warstwy, o które nikt nie pyta?**
- Sejm: scalić do 1 opcji, a nie usuwać. Jest funkcją z #134, a jedna opcja nie zaśmieca
  listy.
- `gmina_dlug_pc`, `przetargi_dzielnica`: zostawić. Mają reguły (`:609-610`), więc ktoś
  zakładał, że ludzie o nie zapytają. Przesunąć je na koniec listy.
- [HIPOTEZA] Zysk z usunięcia kilku opcji jest mały. Główny zysk to mniej konkurentów dla
  pytań ogólnych i kolejność.

**Kolejność:**
- [DOK] Model ciąży ku pierwszej opcji. [FAKT] Dziś pierwsza jest `akademik_odleglosc`.
- Propozycja: najpierw domyślne warstwy tematów w kolejności `TEMATY` (`halas_ldwn`,
  `pm25_srednia`, `zielen_worldcover_100m`, `powodz_1proc`, `przystanek_odleglosc`…), potem
  pozostałe warstwy tematów, na końcu niszowe i gminne. `nie_wiem` zostaje ostatnie.
- [HIPOTEZA] Zysk w pewności wyboru dla pytań ogólnych; skala nieznana. Stała, deterministyczna
  kolejność zostaje (wymóg z `:106-108`).

**`probabilities`:**
- [FAKT] Dziś przepadają w pośredniku.
- [HIPOTEZA] Dałyby: (a) sumę po rodzinie albo temacie, czyli pewność „to pytanie o powódź”
  odporną na podział między trzy warstwy (przypadek B03); (b) drugą najlepszą opcję do szybkiego
  wyboru; (c) różnicę p1 − p2 albo stosunek p1/p2 jako lepszy sygnał wstrzymania niż sama
  confidence ([DOK] confidence); (d) kandydatów na drugą warstwę w pytaniach złożonych
  (druga opcja z innego tematu z p ≥ X).

### 2.2 Dwa etapy czy jeden

| Wariant | Trafność | Czas | Koszt |
|---|---|---|---|
| Dziś: 93-way choice + 15 noul, 1 wywołanie | 96% pojedyncze, 69% pokrycie złożonych (zbiór nr 2) | p50 ok. 300–350 ms | 1 wywołanie |
| Dwa etapy po kolei (temat → warstwa) | [HIPOTEZA] pojedyncze nie wzrosną (sufit), a błąd etapu 1 jest nieodwracalny (greedy: 2/4 vs beam 4/4 w [DOK]); pytaniom złożonym nie pomaga | ok. 2 × 300 = 600 ms p50, p95 ok. 850 ms, czyli blisko timeoutu 800 ms + 1,5 s klienta | 2 wywołania, a `state` liczony 2 razy (wejście $0,042/mln tokenów, pomijalne; liczy się raczej limit żądań 20/min/IP z `_jev.js:29`) |
| **Jeden etap, temat z rozkładu:** ta sama choice, `P(temat) = Σ p(warstw tematu)`, decyzja na sumie, warstwa w temacie = argmax albo deterministycznie | [HIPOTEZA] mniej zapasów z rozkładu między rodzeństwem | 0 ms | 0 |
| **Jeden etap, dodatkowa choice tematu w tym samym zapytaniu** (15 tematów + `inne`), niezależna od choice warstwy ([DOK] niezależność) | [HIPOTEZA] dwa niezależne głosy; zgodność = wysoka pewność, niezgodność = pokaż dwie opcje | 0 ms | +1 pytanie (limit 16 pośrednika jest pełny: trzeba zwolnić miejsce albo podnieść limit) |

Wniosek: **dwa etapy po kolei nie.** Jeśli kiedyś warstw będzie ponad 255 albo opisy przestaną
się mieścić, wtedy hierarchia z beam search (równolegle, [DOK]), a nie zachłannie.

### 2.3 Struktura „opisz siebie”

- **Interferencja.** [DOK] Pytania są niezależne. [FAKT] Zmierzone przesunięcia mieszczą się
  w szumie (0,02 vs powtórka 0,02) albo są zaburzone dojściem warstw Sejmu. W „opisz siebie”
  spadek z #150 (10/30 pod bramką) to skutek **nowego brzmienia bramki**, a nie wpływu innych
  pytań (`WYNIKI.md:523-528`).
  [HIPOTEZA] Interferencji najpewniej nie ma. Pozostaje to do sprawdzenia testem A/A (§5.3).
- **Dwa równoległe zapytania** dają ten sam czas p50, gorszy ogon (maksimum z dwóch), dwa
  razy więcej żądań wobec limitu na IP i dwa razy więcej tokenów `state`. Według [DOK] nie
  zmieniają odpowiedzi. **Nie robić bez dowodu z A/A.**
- **Profil z potrzeb, deterministycznie:**
  - [FAKT] `personaZPotrzeb` istnieje. JEV nie ma jednak twierdzeń dla `singiel` ani
    `inwestycja`, więc Singla i Inwestora po stronie JEV niesie wyłącznie choice profilu.
    Usunięcie choice skasowałoby oba.
  - [HIPOTEZA] Lepiej: choice profilu zostaje z wyższym progiem wstrzymania i opisami
    „kim jest osoba”. Gdy JEV się wstrzymuje, profil bierzemy z potrzeb tylko przy silnych
    sygnałach (dzieci → Rodzina, senior → Senior), a w przeciwnym razie `null` (zostaje
    bieżący – tani błąd).
  - Alternatywa: zamienić choice na 2 noul („Osoba mieszka sama, bez partnera i dzieci”,
    „Osoba kupuje mieszkanie jako inwestycję albo pod wynajem”) i składać profil w kodzie.
    Kosztuje 1 miejsce w limicie 16.

### 2.4 Pewność i prawdopodobieństwa

- **Progi dla każdego pytania osobno:**
  - profil: 0,6 → [HIPOTEZA] ok. 0,85 (trafne 0,95 vs błędne 0,73);
  - warstwa: 0,5 → zamiast progu na confidence warstwy próg na **sumie rodziny/tematu**
    i na różnicy p1 − p2;
  - noul tematów: progiem się nie poprawi ([FAKT] 0,78–0,93 fałszywych). To problem opisu
    (`not_for`), a nie progu;
  - noul potrzeb: 0,6 jest dobrze rozdzielone (0,82 vs 0,21).
- **Dwie najlepsze opcje do szybkiego wyboru:** w strefie 0,5–0,9 ([DOK]) albo gdy
  p1/p2 < ok. 2, karta pokazuje wynik z najlepszej warstwy i chip „A może chodziło o: X?”.
  Pod 0,5 zamiast cichego zapasu na reguły: dwa chipy (top-1 JEV i top-1 reguły, jeśli
  inne). Liczby nadal tylko z danych.
- **Wstrzymanie:** profil `null` jest tanim błędem (zostaje bieżący). Warstwa „nie wiem”
  jest droższa (użytkownik nic nie dostaje), więc tam lepsza jest szybka podpowiedź niż
  wstrzymanie.

### 2.5 Gdzie decydować powinny reguły, a nie JEV

| Decyzja | Kto | Dlaczego |
|---|---|---|
| Wybór jednej warstwy / rodziny z pytania | **JEV** | 96% vs 60% |
| Potrzeby z opisu | **JEV** | F1 81% vs 66% |
| Który członek rodziny (Kraków / obwarzanek) | **kod po adresie** | to fakt z danych, nie z języka |
| Konkretny wskaźnik, gdy pytanie go nazywa (PM10, NO2, benzo, 10%) | **reguły** | słowo jawne, regex się nie myli; JEV dziś musi to rozróżniać z opisów |
| Drugi obiekt z tematu (apteka + przychodnia) | **reguły** (już tak, #147/#150) | jawne nazwy |
| Tematy pytań złożonych | **suma JEV ∪ reguły**, do 3 warstw | remis 69/69%; [HIPOTEZA] błędy obu są częściowo rozłączne |
| Profil | **JEV z wyższym progiem**, inaczej `null` / potrzeby | remis 67%; JEV ma przynajmniej sygnał pewności |
| Inwestor → przyszłość okolicy | **kod** (już tak) | – |

### 2.6 Czego z TypeSafe nie używamy

1. **`probabilities`** (choice i score) i **`legend`** (score) – wyrzucane w pośredniku.
2. **Opcje jako obiekty** (`what` / `not_for` / `examples`) i **noul z `criteria.true/false`**.
   Pośrednik przyjmuje tylko string (`_jev.js:66-70`), a noul wysyła bez `criteria`. To jest
   narzędzie producenta dokładnie na nasze fałszywe dodatki i na „cudzą sytuację”.
3. **`state` jako obiekt.** Można wysłać `{ pytanie_uzytkownika, kontekst: "Kraków i gminy
   obwarzanka; aplikacja pokazuje dane pod jednym adresem" }`. [HIPOTEZA] Mały zysk, ryzyko
   „large state” ([DOK]: dokładność spada z nieistotnym kontekstem) i więcej tokenów. Nisko.
4. **Few-shot / przykłady:** nie ma osobnego pola. Przykłady idą w `examples` opcji albo
   w `state` ([DOK] state, advanced).
5. **Zagnieżdżone choice (drzewo).** Możliwe zamiast płaskiej listy 93; wymaga obiektów
   w kryteriach.
6. **Determinizm:** API nie ma temperature ani seed. [FAKT] W praktyce powtórka zmienia
   średnio 0,02. Wersję modelu można przypiąć (`jev-1.13.0` zamiast `jev-latest`,
   research-jev.md §1), żeby pomiary dało się porównać. Dziś alias może się zmienić między
   przebiegami.
7. **Batch:** już używamy (wiele pytań w jednym wywołaniu). Batchu wielu `state` w jednym
   żądaniu dokumentacja nie opisuje.
8. **Limit pytań:** [DOK] nie podaje limitu liczby pytań, tylko 64 tys. tokenów `state`
   + wszystkich pytań. **16 to nasz własny limit** (`_jev.js:20`). Kod i WYNIKI wielokrotnie
   poświęcały pytania pod ten limit (np. usunięta kategoria `przyszlosc`).

---

## 3. Rekomendacje, od najważniejszej

Koszty w godzinach dla jednej osoby znającej kod, bez pomiaru na żywo. Pliki: tylko `src/ai/**`,
chyba że zaznaczono **(+ api/_jev.js)** – tę zmianę trzeba zatwierdzić osobno, bo wychodzi
poza `src/ai`.

### R1. Przepuścić `probabilities` i decydować na sumie rodziny/tematu

- **Co:**
  - pośrednik oddaje `prawdopodobienstwa` (choice i score);
  - `przetworz` liczy `P(rodzina) = Σ p` dla grup z `TEMATY` (i rodzin z R2) oraz próg na
    tej sumie zamiast na confidence pojedynczej warstwy;
  - warstwa w grupie to argmax w grupie albo domyślna;
  - `pomiar.ts` zapisuje rozkłady.
- **Efekt:** [FAKT] B03 pokazał, że podział między rodzeństwo spycha pod próg (0,49), a #146
  pokazał odpowiedzi tracone przy wyborze głównym 0,49. [HIPOTEZA] Mniej zapasów, a więc
  więcej odpowiedzi JEV (96% vs 60% reguł). Daje też dane do R4 i R5.
- **Koszt:** 3–5 h. Pliki: `api/_jev.js` (`przelozOdpowiedz`), `src/ai/jev.ts`
  (`OdpowiedzJev`), `src/ai/zapytajOAdres.ts` (`przetworz`, `przetworzWiele`),
  `src/ai/pomiar/pomiar.ts` oraz testy.
- **Czas i wywołania:** 0 / 0. Zapytanie się nie zmienia.
- **Ryzyko:** niskie. Nowy próg to nowe strojenie, więc trzeba go wybrać na zbiorze do
  strojenia i zweryfikować na nowym zbiorze (§5). Rozmiar odpowiedzi rośnie o 94 liczby,
  co jest pomijalne.

### R2. Lista warstw v2: kolejność, rodziny i wybór po adresie

- **Co:**
  - (a) kolejność opcji: domyślne warstwy tematów → reszta tematów → nisza i gmina →
    `nie_wiem`;
  - (b) jedna opcja dla hałasu (Kraków / obwarzanek) i pozwoleń na budowę (Kraków /
    obwarzanek); członka wybiera kod po wartości pod adresem `i`;
  - (c) jedna opcja „Sejm 2023”;
  - (d) powódź i powietrze jako rodziny z domyślną warstwą i regułą dla jawnie nazwanego
    członka.
- **Efekt:**
  - [DOK] skłonność do pierwszej opcji; [FAKT] dziś pierwsza jest `akademik_odleglosc`;
  - z 93 opcji robi się ok. 80; z 7 opcji Sejmu jedna;
  - [HIPOTEZA] poprawne dane hałasu dla adresów w obwarzanku – dziś prawdopodobnie „brak
    danych”. Do sprawdzenia offline.
- **Koszt:** 4–6 h. Pliki: `src/ai/zapytajOAdres.ts` (`listaWarstw`, `kryteria`, mapowanie
  opcja → warstwa w `przetworz`/`odpowiedz`, `TEMATY` dla `inwestycje_500m_obwarzanek`),
  testy, `zgodnosc147.ts` do aktualizacji.
- **Czas i wywołania:** 0 / 0.
- **Ryzyko:** średnie. Zmienia zapytanie, więc wszystkie wyniki trzeba zmierzyć od nowa.
  Rodzina może zgubić niuans (np. „spaliny” → NO2 – pokrywa to istniejąca reguła).
  Odpowiedź Sejmu wymaga decyzji, co pokazać.

### R3. Profil: wyższy próg, opisy „kim jest osoba”, zapas z potrzeb

- **Co:**
  - próg profilu 0,6 → wybrany na zbiorze do strojenia (spodziewam się 0,8–0,9);
  - opisy opcji profilu dla JEV oddzielone od opisów UI, na przykład „Rodzina – mieszka
    z dziećmi albo je planuje”, „Singiel – mieszka sam, bez partnera i dzieci”, „Senior –
    emeryt, osoba starsza”, „Inwestor – kupuje pod wynajem albo na zysk, sam nie zamieszka”;
  - pod progiem: profil z silnych potrzeb (dzieci, senior), inaczej `null`.
- **Efekt:** [FAKT] pewność rozdziela trafne i błędne profile (0,95 vs 0,73), a część błędów
  to para → Singiel. [HIPOTEZA] Mniej błędnych profili przy tej samej liczbie trafnych;
  błąd zamienia się w „bez zmian”.
- **Koszt:** 2–3 h. Plik: `src/ai/opiszSiebie.ts` (`zapytanieOpiszSiebie`, próg,
  `przetworzOdpowiedzi`) i testy.
- **Czas i wywołania:** 0 / 0.
- **Ryzyko:** średnie. Metryka profilu zależy od konwencji etykiet zbioru (`null` dla par),
  więc łatwo „wygrać” metrykę zamiast realnego zysku. Trzeba też liczyć „błąd szkodliwy”
  (zły profil) osobno od „wstrzymania”.

### R4. Szybki wybór z dwóch najlepszych opcji zamiast cichego zapasu

- **Co:**
  - gdy confidence wynosi 0,5–0,9 albo p1/p2 < 2, pokazujemy wynik i chip „A może: X?”;
  - pod progiem: chipy z top-1 JEV i top-1 reguł zamiast samego wyniku reguł;
  - klik wybiera warstwę, a liczba nadal pochodzi z danych.
- **Efekt:** [FAKT] trafna warstwa ma średnio 0,78, chybiona 0,60, a zapas przy pytaniach
  przy progu to rzut monetą (B02, B19). [HIPOTEZA] Użytkownik dostaje właściwą warstwę jednym
  kliknięciem w większości przypadków granicznych.
- **Koszt:** 3–4 h. Pliki: `src/ai/zapytajOAdres.ts` (zwracanie alternatyw),
  `src/ai/PoleZapytajOAdres.tsx`, `src/ai/zapytaj.css`. Wymaga R1.
- **Czas i wywołania:** 0 / 0; jedna interakcja użytkownika.
- **Ryzyko:** niskie–średnie (UX: za dużo chipów). Ograniczyć do jednej alternatywy.

### R5. Tematy pytań złożonych: nie wyrzucać ocen przy słabym wyborze głównym, łączyć z regułami

- **Co:**
  - gdy wybór główny < 0,5, ale jakiś temat ma noul ≥ 0,6, nie spadać w całości do reguł,
    tylko złożyć odpowiedź z tematów JEV i trafień reguł;
  - tematy dołożone = suma (JEV ≥ próg) ∪ (reguły), do 3 warstw.
- **Efekt:** [FAKT] B23 stracił oceny tematów przez 0,49 (`WYNIKI.md:222-223`), a pokrycie
  złożonych to remis 69/69. [HIPOTEZA] Suma podnosi pokrycie, bo reguły na zbiorze nr 1 miały
  67% przy 52% JEV, kosztem precyzji. **Da się to policzyć offline** z zapisanych odpowiedzi
  zbioru do strojenia, bez wywołań.
- **Koszt:** 1–2 h. Pliki: `src/ai/zapytajOAdres.ts` (`przetworzWiele`), testy.
- **Czas i wywołania:** 0 / 0.
- **Ryzyko:** średnie. Fałszywe dodatki z reguł mogą wejść. Pilnować precyzji ≥ 90% jako
  warunku.

### R6. Opisy opcji jako obiekty i noul z `true/false` (oraz własny limit pytań)

- **Co:**
  - pośrednik przyjmuje `criteria` jako obiekt `{what, not_for, examples}` (choice) oraz
    `criteria.true/false` (noul);
  - limit pytań 16 → np. 32, nadal jako bezpiecznik;
  - wykluczenia przenieść z twierdzeń tematów do `not_for` / `false`;
  - bramka „własna sytuacja” z przykładami prawdy i fałszu („pytam dla koleżanki” → false,
    „mama z nami zamieszka” → true).
- **Efekt:** [DOK] producent zaleca to wprost dla mylonych opcji. [FAKT] Fałszywe dodatki
  i bramka to dziś problemy brzmienia, których progiem się nie naprawi, a #150 pokazało, że
  strojenie samego brzmienia jest kruche.
- **Koszt:** 3–5 h. Pliki: `api/_jev.js` (`sprawdzZapytanie`, `LIMITY`), `src/ai/jev.ts`
  (typy `PytanieJev`), `src/ai/zapytajOAdres.ts`, `src/ai/opiszSiebie.ts` i testy.
- **Czas i wywołania:** ok. 0 ms (więcej tokenów, wejście $0,042/mln, pomijalne) / 0.
- **Ryzyko:** średnie–wysokie. Zmienia wszystko, co widzi JEV; łatwo przestroić pod zbiór
  (lekcja z #150). Robić po R1–R2 i mierzyć na nowym zbiorze.

### R7. Przypiąć wersję modelu i zrobić test A/A, zanim ktoś rozbije zapytania

- **Co:**
  - `MODEL_JEV = 'jev-1.13.0'` w pomiarze (w aplikacji opcjonalnie);
  - test A/A: te same 20 tekstów ze zbioru do strojenia w trzech wariantach: pełne
    zapytanie ×2 oraz sam choice/profil ×1.
- **Efekt:** rozstrzyga pytanie o interferencję: jeśli |Δ| w wariancie „sam choice” nie
  przekracza Δ powtórki, nie ma powodu dzielić zapytań ([DOK] mówi, że go nie ma).
- **Koszt:** 1 h. Plik: `src/ai/pomiar/pomiar.ts` (flaga wariantu). Zmiana stałej modelu
  jest w `api/_jev.js` – w pomiarze można ją wstrzyknąć.
- **Wywołania:** ok. 60 jednorazowo. Czas w aplikacji: 0.
- **Ryzyko:** niskie.

Kolejność wdrażania: **R7 (tani pomiar szumu) → R1 → R2 → R5 → R3 → R4 → R6.**
Najważniejsze do sprawdzenia są R1 i R2.

---

## 4. Czego NIE robić

- **Dwóch etapów po kolei** (temat → warstwa). Czas ×2, kumulacja błędu, a nie rusza to
  słabego miejsca (pytań złożonych). Jeśli kiedyś hierarchia, to równolegle z beam search.
- **Dzielenia „opisz siebie” na dwa zapytania** bez wyniku A/A. Producent twierdzi, że to
  nic nie zmienia, a zmierzone przesunięcia są w szumie.
- **Usuwania choice profilu i zastąpienia go samymi potrzebami.** Singiel i Inwestor nie mają
  twierdzeń, więc zniknęłyby po stronie JEV.
- **Strojenia progów na zbiorach kontrolnych nr 1 i nr 2** (ani na liczbach zbiorczych –
  #150 pokazał, że to przecieka). Progi wybierać wyłącznie na zbiorze do strojenia.
- **Dalszego strojenia brzmienia twierdzeń na kilku zdaniach.** #150: celowane zdania
  poprawiły się, a zbiór kontrolny pogorszył.
- **Usuwania warstw z danych tylko dlatego, że są niszowe.** Lepiej scalić albo przesunąć na
  koniec listy.
- **Wpuszczania JEV do liczb i miejsc** – dalej zostaje zasada „JEV wybiera id”.
- **Wnioskowania z różnic o jedną pozycję** (3–4 pp).
- **Mierzenia na `jev-latest` bez zapisu wersji** – porównania między dniami mogą być
  porównaniami dwóch modeli.

---

## 5. Eksperyment dla R1 i R2 bez zatruwania zbiorów kontrolnych

### 5.1 Nowy zbiór kontrolny nr 3 (na ślepo)

- Pisze go **świeży agent** bez dostępu do kodu, poleceń, opisów warstw dla JEV, `WYNIKI.md`
  i zbiorów 1–2. Dostaje tylko listę id warstw z nazwą dla ludzi i listę tematów.
- **Większy niż poprzednie**, żeby 1 pozycja ≠ 4 pp: 60 pytań B (30 pojedynczych,
  20 złożonych, 10 spoza zakresu).
- Około 15 pytań ma przypisany **adres w obwarzanku** (dla R2b) – pole `adres_i` dobrane
  skryptem z `adresy.json`, a nie przez agenta.
- Etykiety na poziomie **rodziny/tematu** plus lista dopuszczalnych warstw (jak dziś).
  Dodatkowo pole `ogolne: true/false` mówi, czy pytanie nazywa konkretny wskaźnik
  (PM10, 10%).
- Commit bajt w bajt przed zmianą kodu, wyłączenie z formatowania (`biome.json`). Teksty
  czyta tylko skrypt, a raport pokazuje same sumy (jak `--zbior kontrolny2`).

### 5.2 Rejestracja z góry (w WYNIKI.md, przed przebiegiem)

- **Hipotezy:**
  - H1 (R1): odsetek zapasów spada, a trafność warstwy głównej nie spada o więcej niż
    1 pozycję;
  - H2 (R2): trafność pojedynczych ≥ obecnej, a w pytaniach z adresem w obwarzanku odsetek
    „brak danych” spada do 0.
- **Progi R1** (suma rodziny, p1/p2) wybrane wcześniej na `zbior-zapytaj.json` i zapisane.
- **Reguła decyzji:** wdrażamy, jeśli liczba pozycji, które zmiana naprawia, przewyższa
  liczbę pozycji, które psuje, o ≥ 3 (para tych samych pozycji, test znaku/McNemar).
  Inaczej zostaje wersja obecna.

### 5.3 Przebiegi (ok. 140 wywołań)

1. **A/A i szum (R7):** 20 pozycji z `zbior-zapytaj.json` – pełne zapytanie ×2 i sam choice
   ×1 (60 wywołań). Wynik: rozkład |Δconfidence| powtórki i wariantu „bez noul”.
2. **Przebieg 1 na zbiorze nr 3:** obecne zapytanie z zapisem `probabilities` (60 wywołań).
   Z **tych samych odpowiedzi** offline liczymy obecne przetwarzanie i R1 (oraz R5). R1 nie
   zmienia zapytania, więc porównanie jest dokładnie sparowane i nic nie kosztuje.
3. **Przebieg 2 na zbiorze nr 3:** lista v2 (R2) z przetwarzaniem R1 (60 wywołań). Porównanie
   z przebiegiem 1 pozycja po pozycji, tylko w liczbach zbiorczych i liczbie naprawionych
   i zepsutych pozycji.
4. **Bez sieci:** sprawdzenie, czy `halas_ldwn` i `halas_obwarzanek_lden` (oraz para
   inwestycji) uzupełniają się pod adresami – wynik do R2b.

Wszystkie przebiegi idą na przypiętym `jev-1.13.0`. Po przebiegach 2–3 nic nie stroimy na
zbiorze nr 3. Jeśli coś trzeba poprawić, poprawka czeka na zbiór nr 4.

### 5.4 Dla „opisz siebie” (R3) – osobno

Jeśli R3 wchodzi, potrzebny jest nowy zbiór A (40 opisów). Etykieta profilu ma tam trzy
wartości: `profil`, `null-dopuszczalny` i `null-wymagany`, żeby odróżnić wstrzymanie od
błędu. Bez tego metryka 67% nagradza i karze przypadkowo.

---

## 6. Źródła

- Kod:
  - `src/ai/zapytajOAdres.ts`
  - `src/ai/opiszSiebie.ts`
  - `src/ai/jev.ts`
  - `api/_jev.js`
  - `src/wynik/persony.ts`
  - `src/wynik/silnik.ts:17-20`
  - meta z `public/dane/wskazniki/*.json`
- Pomiary: `src/ai/pomiar/WYNIKI.md` (linie podane przy faktach), `src/ai/pomiar/zbior-zapytaj.json`.
- Historia: `git log -- src/ai`, w tym #146, #147, #150, #152; warstwy Sejmu w `40ff16a` (#134).
- `z-dykty/specs/050-pytania-udip/research-jev.md` (§1 model i wersje, §4 język, §6 kolejność),
  `research.md` (R4, R15).
- Dokumentacja TypeSafe (odczyt 2026-10-03):
  - [primitives](https://docs.typesafe.ai/primitives.md)
  - [choice](https://docs.typesafe.ai/primitives/choice.md)
  - [advanced](https://docs.typesafe.ai/primitives/advanced.md)
  - [state](https://docs.typesafe.ai/concepts/state.md)
  - [confidence](https://docs.typesafe.ai/confidence.md)
  - [api](https://docs.typesafe.ai/api.md)
  - [jaggedness jev-1.13](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)
  - [hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification.md)
  - [skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion.md)
  - [intent routing](https://docs.typesafe.ai/patterns/intent-routing.md)
  - [llms.txt](https://docs.typesafe.ai/llms.txt)
