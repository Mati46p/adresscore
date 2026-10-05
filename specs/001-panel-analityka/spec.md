# Specyfikacja funkcji: Panel admina z analityką

**Branch funkcji**: `feat/panel-analityka`

**Utworzono**: 2026-10-05

**Status**: Draft

**Wejście**: opis właściciela: „Panel admina z analityką (ekran #/panel) dla adresscore – wzorzec
z repo Z_dykty". Decyzje wiążące (2026-10-05): zakres 1a – siedem zakładek ze szczegółowością
z-dykty; logowanie admina kontem Google; zapis zdarzeń przez własny endpoint serwisu działający
zarówno na obecnym, jak i docelowym hostingu; pomiar bez ciasteczek; zestawienie dzienne liczone
w bazie według harmonogramu.

## Scenariusze użytkownika i testy *(obowiązkowe)*

### Historia 1 – Pomiar ruchu bez ciasteczek (Priorytet: P1)

Odwiedzający korzysta z adresscore jak dotąd (szuka adresu, otwiera kartę, porównuje, przełącza
warstwy mapy, wchodzi w tryb Biznes). Serwis po cichu zapisuje anonimowe zdarzenia: odsłonę
ekranu, czas widoczności i głębokość przewinięcia przy wyjściu, kliknięcia w oznaczone przyciski,
udostępnienia, kroki lejka produktowego, pomiary szybkości strony i błędy klienta. Na urządzeniu
nie zostaje żaden identyfikator, a serwer nie przechowuje adresu IP ani przeglądarki – tylko
skrót dobowy, który nie łączy wizyt między dniami. Odwiedzający może wyłączyć pomiar.

**Dlaczego ten priorytet**: bez danych panel nie ma czego pokazać; zbieranie musi ruszyć jak
najwcześniej, bo każdy dzień bez pomiaru to luka w historii, której nie da się odtworzyć.

**Test niezależny**: otwarcie kilku ekranów w przeglądarce i sprawdzenie w bazie, że pojawiły
się wiersze zdarzeń z kanałem, krajem (gdy dostępny), klasą urządzenia i skrótem dobowym, a nie
ma w nich IP ani pełnej przeglądarki; w magazynie przeglądarki nie ma żadnego identyfikatora.

**Scenariusze akceptacji**:

1. **Zakładając**, że odwiedzający wchodzi z wyniku wyszukiwarki, **gdy** otwiera kartę adresu,
   **wtedy** zapisuje się odsłona z kanałem „wyszukiwarka", ekranem „okolica" i adresem karty.
2. **Zakładając**, że odwiedzający przewinął kartę do połowy i zamknął kartę przeglądarki,
   **gdy** karta ginie, **wtedy** zapisuje się zdarzenie wyjścia z czasem widoczności
   (bez czasu w tle) i głębokością przewinięcia.
3. **Zakładając**, że odwiedzający wyłączył pomiar, **gdy** przechodzi między ekranami,
   **wtedy** nie wychodzi żadne zdarzenie, a wybór przetrwa przeładowanie strony.
4. **Zakładając**, że ruch pochodzi od robota (crawler wyszukiwarki, crawler AI, skrypt),
   **gdy** wysyła odsłonę, **wtedy** zdarzenie zapisuje się z oznaczeniem bota i rodziny bota,
   a nie wlicza się do ludzi.
5. **Zakładając**, że ktoś wysyła do endpointu śmieci albo zbyt duże ciało, **gdy** żądanie
   przychodzi, **wtedy** jest odrzucone bez zapisu, a awaria bazy nigdy nie psuje nawigacji
   odwiedzającego.

---

### Historia 2 – Bezpieczne wejście do panelu (Priorytet: P1)

Właściciel otwiera `#/panel`, loguje się kontem Google i widzi panel. Każdy inny zalogowany
lub niezalogowany człowiek widzi ekran logowania albo komunikat „brak dostępu" i nie dostaje
żadnej liczby – odmowa zapada w bazie, nie na ekranie.

**Dlaczego ten priorytet**: dane o ruchu są wewnętrzne; panel bez bramki to wyciek.

**Test niezależny**: wywołanie dowolnej funkcji odczytowej panelu kluczem publicznym bez sesji
i sesją konta spoza listy adminów kończy się odmową; konto z listy dostaje dane.

**Scenariusze akceptacji**:

1. **Zakładając**, że osoba nie jest zalogowana, **gdy** otwiera `#/panel`, **wtedy** widzi
   przycisk logowania Google i nic więcej.
2. **Zakładając**, że osoba zalogowała się kontem spoza listy adminów, **gdy** panel pyta
   o dane, **wtedy** baza odmawia, a ekran mówi „brak dostępu" i oferuje wylogowanie.
3. **Zakładając**, że admin jest zalogowany, **gdy** otwiera `#/panel`, **wtedy** widzi
   zakładkę Przegląd z danymi.
4. **Zakładając**, że ktoś zna klucz publiczny bazy, **gdy** próbuje czytać tabelę zdarzeń
   wprost albo do niej pisać, **wtedy** dostaje zero wierszy / odmowę.

---

### Historia 3 – Przegląd: czy serwis żyje (Priorytet: P1)

Admin w jednym spojrzeniu widzi: unikalnych dziś, wczoraj, z 7 dni i średnią dobową; odsłony
z 24 h, 7 i 30 dni; szczyt godzinowy i dzienny; wykres dzienny i godzinowy; ilu ludzi jest na
stronie teraz (ostatnie 5 minut); podział ludzie / boty i listę crawlerów AI.

**Dlaczego ten priorytet**: to pierwszy ekran po wejściu i minimalny, samodzielny panel.

**Test niezależny**: po wygenerowaniu znanego zestawu zdarzeń testowych kafle i wykresy
pokazują dokładnie oczekiwane liczby.

**Scenariusze akceptacji**:

1. **Zakładając** znany zestaw zdarzeń z trzech dni, **gdy** admin otwiera Przegląd,
   **wtedy** kafle unikalnych i odsłon zgadzają się z ręcznym przeliczeniem w strefie
   Europe/Warsaw.
2. **Zakładając**, że w ostatnich 5 minutach były dwie osoby i jeden bot, **gdy** admin
   patrzy na „teraz na stronie", **wtedy** widzi 2.
3. **Zakładając** ruch ludzi i botów, **gdy** admin patrzy na podział, **wtedy** udziały
   sumują się do 100% całości ruchu, a nie są skalowane do większej grupy.

---

### Historia 4 – Akwizycja i sesje (Priorytet: P2)

Admin widzi, skąd przychodzą ludzie (kanał wyliczony z referera, znaczników UTM i
identyfikatorów kliknięcia; źródła; kraje; urządzenia) i co robią w obrębie wizyty (liczba
sesji sklejonych z ciągu zdarzeń z przerwą do 30 minut, strony na sesję, czas wizyty, odsetek
sesji zaangażowanych, najczęstsze przejścia między ekranami, udostępnienia).

**Dlaczego ten priorytet**: odpowiada na pytanie „który kanał promocji działa" – drugie
w kolejności po „czy w ogóle ktoś przychodzi".

**Test niezależny**: zestaw zdarzeń z jednego skrótu dobowego z przerwą 31 minut daje dwie
sesje; z przerwą 29 minut – jedną.

**Scenariusze akceptacji**:

1. **Zakładając** wejście z `?utm_source=facebook`, **gdy** admin patrzy na kanały,
   **wtedy** wizyta liczy się do kanału „social", a źródło to „facebook".
2. **Zakładając** wejście bez referera, **gdy** admin patrzy na kanały, **wtedy** wizyta
   liczy się do „(bezpośrednie)".
3. **Zakładając** sesje różnej długości, **gdy** admin patrzy na Sesje, **wtedy** widzi
   medianę i średnią stron na sesję oraz czas wizyty, a sesje zaangażowane są zdefiniowane
   w podpowiedzi przy liczbie.

---

### Historia 5 – Zaangażowanie, CTA i Treść (Priorytet: P2)

Admin widzi najczęstsze ścieżki i punkt urwania (na którym ekranie i w której sekcji kończy
się wizyta), czas spędzony w sekcjach ekranów, które sekcje konwertują na kliknięcia,
przyciski wyświetlane, a nieklikane (martwe), sygnały frustracji (szybkie wielokrotne
kliknięcia, kliknięcia w nieklikalne elementy), top ekrany i adresy, wyszukiwania bez wyniku
oraz lejek produktowy adresscore: wyszukanie → karta adresu → porównanie / warstwa mapy /
tryb Biznes.

**Dlaczego ten priorytet**: to materiał do decyzji produktowych na pitch i po hackathonie;
lista wyszukiwań bez wyniku to gotowa lista braków w danych.

**Test niezależny**: zestaw zdarzeń lejka z dziesięciu sesji (10 wyszukań, 6 kart,
2 porównania) daje lejek 10 → 6 → 2 z procentami liczonymi od pierwszego kroku.

**Scenariusze akceptacji**:

1. **Zakładając**, że odwiedzający wpisał adres, którego nie ma w danych, **gdy** admin
   patrzy na Treść, **wtedy** fraza (znormalizowana, przycięta) pojawia się na liście
   wyszukiwań bez wyniku z liczbą powtórzeń.
2. **Zakładając**, że przycisk był wyświetlony 100 razy i kliknięty 0 razy, **gdy** admin
   patrzy na CTA, **wtedy** przycisk jest na liście martwych.
3. **Zakładając** wizyty kończące się na karcie adresu w sekcji „źródła", **gdy** admin
   patrzy na punkt urwania, **wtedy** ta para (ekran, sekcja) prowadzi listę.

---

### Historia 6 – Jakość pomiaru i strony (Priorytet: P3)

Admin widzi, czy pomiar działa (ostatnie zdarzenie, liczba zdarzeń na typ w 24 h, odsetek
zdarzeń bez odcisku, ostatni bieg zestawienia dziennego), jak szybka jest strona (Web Vitals p75 na
ekran: LCP, INP, CLS, FCP, TTFB, z oceną dobra / do poprawy / słaba) i jakie błędy zgłosił
klient (komunikat skrócony, ekran, liczba).

**Dlaczego ten priorytet**: chroni przed fałszywą ciszą („zero ruchu" przy zepsutym pomiarze),
ale nie jest potrzebne do pierwszej oceny ruchu.

**Test niezależny**: wstrzymanie zestawienia dziennego na dobę daje w diagnostyce czerwony
wskaźnik „ostatni bieg starszy niż 26 h".

**Scenariusze akceptacji**:

1. **Zakładając** 20 pomiarów LCP na karcie adresu, **gdy** admin patrzy na Jakość,
   **wtedy** widzi p75 z liczbą próbek obok, w milisekundach, z oceną.
2. **Zakładając**, że w kliencie poleciał wyjątek, **gdy** admin patrzy na błędy,
   **wtedy** widzi skrócony komunikat, ekran i liczbę wystąpień – bez danych osobowych.

---

### Przypadki brzegowe

- Brak danych w oknie (świeży serwis, pierwszy dzień) – kafle pokazują „brak danych" (szare),
  nigdy 0 udające pomiar; wykresy pokazują pustą oś z podpisem.
- Doba przechodzi przez północ w trakcie wizyty – sesja zostaje przecięta (skrót dobowy
  rotuje); podpowiedź uprzedza, że czasy są podłogą.
- Zmiana czasu (DST) – doby liczone w Europe/Warsaw; doba 23- i 25-godzinna nie gubi godzin.
- Ruch z IP bez kraju (brak nagłówka kraju na hostingu) – kraj „nieznany", osobna pozycja.
- Karta w tle – czas widoczności nie rośnie; `wyjscie` wysyła się raz mimo dwóch zdarzeń
  zamknięcia.
- Endpoint niedostępny (deploy, awaria) – klient gubi zdarzenie po cichu, bez ponawiania
  w pętli i bez błędu na ekranie.
- Panel otwarty z wolnym łączem – recharts i kod panelu nie trafiają do głównej paczki
  aplikacji; reszta serwisu nie płaci za panel.
- Admin usunięty z listy w trakcie sesji – kolejne zapytanie dostaje odmowę.
- Fraza wyszukiwania zawierająca dane osobowe (np. e-mail, telefon) – nie jest zapisywana
  (filtr wzorców), zapisuje się znacznik „odrzucono".
- Udział procentowy przy sumie zero – „brak danych", nigdy dzielenie przez zero ani NaN.

## Wymagania *(obowiązkowe)*

### Wymagania funkcjonalne

**Pomiar (klient)**

- **FR-001**: Serwis MUSI rejestrować zdarzenia typów: odsłona, wyjście, klik, udostępnienie,
  produktowe (zamknięta lista nazw), wital (pomiar szybkości) i błąd klienta.
- **FR-002**: Odsłona MUSI nieść ekran, ścieżkę (bez parametrów zapytania), przycięty referer
  (host, a ścieżka tylko dla hostów z listy publicznych), znaczniki UTM i rodzaj
  identyfikatora kliknięcia (sama nazwa parametru, nie wartość) oraz klasę urządzenia.
- **FR-003**: Wyjście MUSI nieść czas widoczności (tylko przy widocznej karcie, z limitem
  30 min), maksymalną głębokość przewinięcia, czas w sekcjach ekranu i ekspozycje/kliknięcia
  oznaczonych przycisków; wysyłane raz, także przy zamknięciu karty.
- **FR-004**: Serwis NIE MOŻE zapisywać na urządzeniu żadnego identyfikatora; jedyny trwały
  zapis to wybór „pomiar wyłączony" (przełącznik w stopce/na stronie Metody).
- **FR-005**: Przy wyłączonym pomiarze serwis NIE MOŻE wysyłać żadnych zdarzeń; respektuje też
  sygnał przeglądarki „Global Privacy Control".
- **FR-006**: Zdarzenia MUSZĄ wychodzić paczkami (do 10 w jednym żądaniu) i nie mogą blokować
  ani opóźniać interakcji użytkownika; błąd wysyłki jest tłumiony.
- **FR-007**: Wyszukiwanie bez wyniku MUSI zapisywać znormalizowaną frazę (małe litery,
  przycięta do 80 znaków), o ile fraza nie pasuje do wzorców danych osobowych.

**Zapis (serwer)**

- **FR-010**: Endpoint zapisu MUSI działać identycznie na obecnym hostingu i na docelowym
  serwerze własnym; logika endpointu MUSI dać się przetestować bez sieci i bez bazy.
- **FR-011**: Endpoint MUSI przyjmować wyłącznie żądania z własnej domeny (lista dozwolonych
  originów), ciało do 16 KB, zamknięte listy typów, nazw i wartości; resztę odrzuca.
- **FR-012**: Endpoint MUSI liczyć skrót dobowy z soli dnia, adresu IP, przeglądarki i hosta;
  IP i przeglądarka NIE MOGĄ trafić do bazy, logów ani odpowiedzi.
- **FR-013**: Endpoint MUSI rozpoznawać boty po przeglądarce (lista rodzin, w tym crawlery AI)
  i zapisywać oznaczenie bota oraz rodzinę zamiast odrzucać ruch.
- **FR-014**: Endpoint MUSI ustalać kraj z nagłówka kraju dostarczanego przez hosting lub
  pośrednika (gdy brak – kraj nieznany).
- **FR-015**: Zapis MUSI iść przez jedną funkcję bazy dostępną wyłącznie dla roli
  serwerowej; awaria zapisu nie zmienia odpowiedzi dla przeglądarki na błąd.

**Dostęp**

- **FR-020**: Panel MUSI wymagać logowania kontem Google.
- **FR-021**: Lista adminów MUSI być prowadzona w bazie i niewidoczna dla nikogo poza bazą;
  każda funkcja odczytowa panelu MUSI sprawdzać członkostwo przed zwróceniem danych.
- **FR-022**: Tabela zdarzeń MUSI być niedostępna do zapisu dla klucza publicznego i do odczytu
  dla wszystkich poza adminem.
- **FR-023**: Panel MUSI być ładowany wyłącznie po wejściu na `#/panel` – ani jego kod, ani
  biblioteka wykresów nie trafiają do kodu ładowanego na pozostałych ekranach.

**Panel – zakładki** (Przegląd, Akwizycja, Sesje, Zaangażowanie, CTA, Treść, Jakość)

- **FR-030 Przegląd**: unikalni dziś / wczoraj / 7 dni / średnia dobowa z 7 dni; odsłony
  24 h / 7 dni / 30 dni; szczyt godzinowy i dzienny z datą; wykres dzienny (30 dni) i godzinowy
  (48 h); teraz na stronie (5 min); ludzie vs boty; crawlery AI (rodzina, odsłony, ostatnia wizyta).
- **FR-031 Akwizycja**: kanały (bezpośrednie, wyszukiwarka, social, odesłania, kampania, AI,
  inne), źródła (host referera / utm_source), kampanie UTM, kraje, urządzenia – w oknie 7/30 dni.
- **FR-032 Sesje**: liczba sesji (przerwa > 30 min = nowa sesja), strony na sesję (mediana,
  średnia), czas wizyty (mediana), odsetek sesji zaangażowanych (≥ 2 ekrany albo ≥ 30 s
  widoczności), top przejścia ekran → ekran (z celem „wyjście"), udostępnienia według kanału.
- **FR-033 Zaangażowanie**: top ścieżki 3-krokowe, czas widoczny w sekcjach ekranów (mediana,
  zasięg sekcji), punkt urwania (ostatni ekran i ostatnia widziana sekcja wizyty).
- **FR-034 CTA**: klikalność sekcji liczona wobec wyświetleń przycisku, martwe przyciski
  (≥ 50 wyświetleń, 0 kliknięć), sygnały UX (wściekłe kliknięcia, kliknięcia w nieklikalne).
- **FR-035 Treść**: top ekrany i top adresy (karty), wyszukiwania bez wyniku, lejek produktowy
  wyszukanie → karta adresu → (porównanie | warstwa mapy | tryb Biznes) liczony na sesjach.
- **FR-036 Jakość**: diagnostyka pomiaru (ostatnie zdarzenie, zdarzenia na typ 24 h, ostatni
  bieg zestawienia, liczba dni w zestawieniu), Web Vitals p75 na ekran z liczbą próbek i oceną
  według progów Google, błędy klienta (komunikat skrócony, ekran, liczba, ostatnio).
- **FR-037**: Każda zakładka MUSI mieć jednozdaniowy wstęp „na jakie pytanie odpowiada
  i czego tu nie ma", a każda liczba – podpowiedź z definicją i pułapką interpretacji.
- **FR-038**: Każdy udział procentowy MUSI mieć podstawę równą sumie całości, której dotyczy;
  segmenty jednej całości sumują się do 100% (pilnowane testem). Kierunek skali (czy więcej
  znaczy lepiej) jest podpisany, gdy nie jest oczywisty.
- **FR-039**: Wykres po najechaniu (i dotknięciu) MUSI podawać dokładną wartość i datę.
- **FR-040**: Brak danych MUSI być pokazany jako szary stan „brak danych", nigdy jako zero.

**Zestawienie dzienne i retencja**

- **FR-050**: Baza MUSI raz na dobę (po północy Europe/Warsaw) zapisywać zestawienie dnia
  poprzedniego (unikalni, odsłony, sesje, wymiary) i rotować sól; bieg MUSI być idempotentny.
- **FR-051**: Surowe zdarzenia MUSZĄ być usuwane po 90 dniach; zestawienia dzienne zostają.
- **FR-052**: Sól dnia MUSI być kasowana po upływie doby (nie przechowuje się soli z przeszłości
  dłużej niż 2 dni).

### Kluczowe encje

- **Zdarzenie**: jeden zapis pomiaru – czas, typ, ekran, ścieżka, skrót dobowy, kanał i źródło,
  kraj, klasa urządzenia, znacznik bota i rodzina, dodatki zależne od typu (czas, przewinięcie,
  sekcje, CTA, nazwa produktowa z właściwościami, metryka szybkości, komunikat błędu).
- **Sól dnia**: losowa wartość na jedną dobę Europe/Warsaw, wejście skrótu dobowego.
- **Zestawienie dzienne**: wiersz na (dzień, wymiar, klucz) z wartościami liczbowymi; trzyma
  historię dłużej niż surowe zdarzenia.
- **Admin**: konto (identyfikator użytkownika z logowania) uprawnione do panelu.
- **Bieg zestawienia**: znacznik czasu i wynik ostatniego przeliczenia (dla diagnostyki).

## Kryteria sukcesu *(obowiązkowe)*

### Mierzalne wyniki

- **SC-001**: 100% prób odczytu danych panelu bez sesji admina kończy się odmową (test na
  każdej funkcji odczytowej).
- **SC-002**: Główna paczka aplikacji (ekrany poza panelem) nie rośnie o więcej niż 6 KB
  skompresowane po dodaniu pomiaru; kod panelu i wykresów ładuje się tylko na `#/panel`.
- **SC-003**: Pomiar nie pogarsza INP ani LCP strony głównej o więcej niż 5% w porównaniu
  z wersją bez pomiaru.
- **SC-004**: Admin otwiera panel i widzi zakładkę Przegląd z danymi w czasie poniżej 3 s
  przy 90 dniach danych na łączu 4G.
- **SC-005**: Liczby na każdej zakładce zgadzają się z ręcznym przeliczeniem na zestawie
  testowym (zgodność 100%, łącznie z granicą doby i sesji 30 min).
- **SC-006**: Zero kolumn z adresem IP lub pełną przeglądarką w bazie; zero identyfikatorów
  w magazynach przeglądarki przy włączonym pomiarze.
- **SC-007**: Wszystkie udziały procentowe na ekranie mają podstawę równą sumie; test
  sprawdza, że segmenty jednej całości dają 100% (± zaokrąglenie 0,1 pp).
- **SC-008**: Endpoint działa bez zmian kodu na obecnym hostingu i na serwerze docelowym
  (ten sam test kontraktowy przechodzi w obu uruchomieniach).

## Założenia

- Jedynym adminem na start jest właściciel; konto dopisuje się do listy adminów ręcznie
  (instrukcja w quickstart), bez ekranu zarządzania kontami w v1.
- Drugi składnik logowania (2FA) poza zakresem v1; bramka jest jedna funkcja w bazie, więc
  dołożenie 2FA później domknie cały panel jedną zmianą.
- Pominięte względem z-dykty: zakładki Gminy, Czytelnicy, Redakcja, Reklamy; komentarze,
  newsletter, PostHog, cache serwerowy panelu (skala ruchu hackathonowego go nie wymaga –
  przy obciążeniu wraca jako osobna funkcja).
- Panel czyta dane bezpośrednio z bazy funkcjami odczytowymi przez sesję admina; zakładki
  „na żywo" liczą z surowych zdarzeń w oknie do 30 dni, historia dłuższa – z zestawienia.
- Hosting: przeprowadzka na serwer własny trwa równolegle; endpoint jest przenośny,
  a harmonogram zestawienia działa w bazie, więc nie zależy od crona hostingu.
- Strefa czasowa wszystkich dób: Europe/Warsaw.
- Pomiar opiera się na prawnie uzasadnionym interesie (statystyki własne, bez ciasteczek);
  prawo sprzeciwu realizuje przełącznik „pomiar wyłączony". Tekst informacji o pomiarze na
  stronie Metody – treść publiczna, do akceptacji właściciela przy wdrożeniu.
- Oznaczanie sekcji i przycisków na istniejących ekranach (atrybuty danych) robi się
  w plikach ekranów; zakres oznaczania w v1: karta adresu, wyszukiwarka, porównanie, Biznes.
