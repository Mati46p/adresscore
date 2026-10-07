# Specyfikacja funkcji: Wszystkie miasta od razu widoczne na mapie

**Gałąź**: `feat/wszystkie-miasta`
**Utworzono**: 2026-10-07
**Status**: Gotowa do planu
**Issue**: #223
**Wejście**: słowa właściciela – „wszystkie dostępne miasta mają być od razu widoczne na mapie".
Dziś na produkcji widać tylko Kraków, choć dane 9 kolejnych miast (Warszawa, Łódź, Wrocław,
Poznań, Gdańsk, Szczecin, Bydgoszcz, Lublin, Białystok) leżą już na serwerze.

## Scenariusze użytkownika i testy *(obowiązkowe)*

### Historia 1 – Widzę wszystkie miasta naraz (Priorytet: P1)

Osoba wchodzi na stronę główną i od razu widzi mapę Polski, na której każde z 10 miast z danymi
jest pokolorowane wynikiem okolic. Nie musi niczego wybierać ani przełączać, żeby zobaczyć,
że serwis obejmuje więcej niż Kraków.

**Dlaczego P1**: to dosłownie cel właściciela; bez tego pozostałe miasta są niewidoczne.

**Test niezależny**: otwarcie strony głównej bez parametrów → w kadrze startowym widać
pokolorowane obszary 10 miast, legenda opisuje skalę, poza miastami jest mgła z podpisem.

**Scenariusze akceptacji**:

1. **Zakładając**, że osoba otwiera stronę bez linku do adresu, **gdy** mapa się wczyta,
   **wtedy** kadr obejmuje wszystkie 10 miast, a każde jest pokolorowane wynikiem.
2. **Zakładając** widok Polski, **gdy** osoba najedzie (albo tapnie) na heks w Łodzi,
   **wtedy** dymek podaje wynik (albo „brak danych") i nazwę miasta.
3. **Zakładając**, że osoba zmieni profil albo wagi, **gdy** suwak się zatrzyma,
   **wtedy** kolory przeliczają się we wszystkich miastach, nie tylko w Krakowie.
4. **Zakładając**, że osoba wybierze warstwę, której w danym mieście nie ma,
   **wtedy** to miasto jest szare (brak danych), nigdy w kolorze zera.

---

### Historia 2 – Wchodzę w miasto i pracuję jak dziś w Krakowie (Priorytet: P1)

Osoba przybliża Wrocław (albo wybiera go z listy miast) i dostaje to samo co dziś w Krakowie:
heksy ~65 m, klik w heks → adres, karta okolicy z etykietą A–G, porównanie, ranking, katalog
adresów, budynki 3D, dojazd.

**Dlaczego P1**: sama kolorowa plama bez karty nie daje wartości; „widoczne" ma znaczyć „działa".

**Test niezależny**: wybór „Wrocław" → po wczytaniu klik w heks → karta adresu wrocławskiego
z wynikiem, źródłami i pewnością.

**Scenariusze akceptacji**:

1. **Zakładając** widok Polski, **gdy** osoba wybierze miasto z listy, **wtedy** kamera leci
   do miasta, a jego pełne dane wczytują się w tle z widocznym komunikatem.
2. **Zakładając**, że osoba sama przybliży inne miasto (bez wybranego adresu i bez porównania),
   **gdy** kamera się zatrzyma nad nim, **wtedy** to miasto staje się bieżącym bez dodatkowego kliku.
3. **Zakładając**, że osoba kliknie heks w mieście innym niż bieżące, **wtedy** miasto staje
   się bieżącym, a po wczytaniu danych wybiera się adres z klikniętego heksu.
4. **Zakładając** bieżące miasto Gdańsk, **gdy** osoba otworzy kartę, porównanie, ranking albo
   katalog, **wtedy** wszystkie pokazują adresy Gdańska.
5. **Zakładając** bieżące miasto inne niż Kraków, **gdy** osoba skopiuje link, **wtedy** link
   otwiera to samo miasto (i ten sam adres, jeśli był wybrany).

---

### Historia 3 – Uczciwie wiem, czego w danym mieście nie ma (Priorytet: P2)

Kraków ma 127 warstw, pozostałe miasta 65–71. Funkcje oparte na danych tylko krakowskich
(wyszukiwarka okolic SIM, tryb Biznes z popytem, plan miejscowy, pozwolenia na budowę)
w innych miastach mówią wprost, że ich tam nie ma – nie pokazują pustych ani zerowych wartości.

**Dlaczego P2**: zasada projektu „brak danych = szara kategoria, nigdy zero" i zaufanie do źródeł.

**Test niezależny**: bieżące miasto Lublin → wejście w tryb Biznes i w kartę adresu →
komunikat o niedostępności zamiast pustych liczb; legenda i karta nie pokazują zer.

**Scenariusze akceptacji**:

1. **Zakładając** bieżące miasto inne niż Kraków, **gdy** osoba wejdzie w funkcję dostępną
   tylko w Krakowie, **wtedy** widzi komunikat „Na razie tylko w Krakowie" i może wrócić.
2. **Zakładając** kartę adresu w Poznaniu, **wtedy** warstwy, których w Poznaniu nie liczymy,
   nie obniżają wyniku i są oznaczone jako brak danych (liczą się do pewności).

---

### Historia 4 – Strona nie zwalnia (Priorytet: P2)

Dołożenie 9 miast nie może wydłużyć startu ani zjeść transferu telefonu. Pełne dane
(adresy, warstwy, budynki) wczytuje się wyłącznie dla bieżącego miasta.

**Test niezależny**: pomiar transferu i czasu do pierwszych kolorów przed i po zmianie.

---

### Przypadki brzegowe

- Plik przeglądu jednego miasta się nie wczyta albo jest niezgodny → to miasto zostaje pod mgłą
  z podpisem „dane chwilowo niedostępne", reszta mapy działa.
- Osoba ma porównanie z Krakowa i przesunie mapę nad Warszawę → bieżące miasto NIE zmienia się
  samo; pojawia się przycisk „Przełącz na Warszawę" z ostrzeżeniem, że porównanie się wyczyści.
- Link do adresu sprzed tej funkcji (bez miasta) → otwiera Kraków jak dotąd.
- Link z miastem, którego nie znamy → Kraków i komunikat, że miasta nie ma.
- Tryb offline (service worker) → po zmianie danych miasta nie pokazuje starego indeksu
  wskazującego na usunięte pliki.
- Ograniczony ruch (`prefers-reduced-motion`) → przełączenie miasta skacze kamerą bez lotu.
- Telefon na słabym łączu → kolory bieżącego miasta pojawiają się pierwsze, pozostałe miasta dochodzą po kolei.

## Wymagania *(obowiązkowe)*

### Wymagania funkcjonalne

- **FR-001**: Mapa na ekranie Szukaj MUSI pokazywać heksy wszystkich miast z danymi jednocześnie,
  bez akcji użytkownika.
- **FR-002**: Lista miast MUSI wynikać z danych na serwerze i z jednego rejestru w kodzie;
  miasto z danymi, a bez wpisu w rejestrze (albo odwrotnie), MUSI dać czerwony test.
- **FR-003**: Kolor heksu w każdym mieście MUSI być liczony tym samym silnikiem i tymi samymi
  wagami/profilem co w bieżącym mieście. Warstwa nieobecna w mieście nie wchodzi do jego wyniku.
- **FR-004**: Heks bez danych (albo miasto bez wybranej warstwy) MUSI być rysowany szrafurą
  „brak danych", nigdy kolorem wartości 0.
- **FR-005**: Pełne dane (adresy, wszystkie warstwy, budynki 3D, dojazd, usługi) MUSZĄ być
  wczytywane wyłącznie dla bieżącego miasta.
- **FR-006**: Bieżące miasto MUSI się zmieniać: (a) wyborem z listy miast, (b) klikiem w heks
  innego miasta, (c) samoczynnie po zatrzymaniu kamery nad innym miastem przy przybliżeniu
  ulicznym, ale tylko gdy nie ma wybranego adresu ani porównania.
- **FR-007**: Zmiana bieżącego miasta MUSI czyścić wybrany adres i porównanie (porównanie
  obejmuje adresy jednego miasta) i ogłaszać to czytnikowi ekranu.
- **FR-008**: Link MUSI przenosić bieżące miasto; link bez miasta = Kraków (zgodność wstecz).
- **FR-009**: Teksty interfejsu mówiące „w Krakowie" MUSZĄ używać nazwy bieżącego miasta
  w poprawnej formie (np. „we Wrocławiu", „w Białymstoku").
- **FR-010**: Funkcje oparte na danych tylko krakowskich MUSZĄ w innych miastach pokazywać
  komunikat o niedostępności zamiast pustych lub zerowych wyników.
- **FR-011**: Mgła wojny MUSI przykrywać wszystko poza miastami z danymi; jej podpis i legenda
  MUSZĄ mówić „poza obsługiwanymi miastami – brak danych".
- **FR-012**: Kadr startowy bez linku MUSI obejmować wszystkie miasta; link z adresem albo
  miastem startuje przy nim.
- **FR-013**: Niezgodny lub brakujący przegląd jednego miasta NIE MOŻE blokować pozostałych.
- **FR-014**: Tryb offline MUSI zawsze pobierać świeży indeks danych każdego miasta.
- **FR-015**: Strony SEO (`/adres`, `/katalog`, `/metoda`) i mapy witryny zostają bez zmian
  (poza zakresem; osobny wpis `pomysl`).

### Kluczowe byty

- **Miasto (zbiór danych)**: slug, nazwa, forma „w <mieście>", katalog danych, obrys/kadr.
  Kraków to zbiór z katalogiem głównym (z obwarzankiem), pozostałe – katalogi miast.
- **Przegląd miasta**: lekka postać danych do kolorowania heksów na trzech poziomach szczegółu
  (bez adresów), po jednej na miasto.
- **Bieżące miasto**: jedno naraz; jego pełne dane zasilają kartę, porównanie, ranking, katalog, 3D.

## Kryteria sukcesu *(obowiązkowe)*

### Mierzalne wyniki

- **SC-001**: Po wejściu na stronę wszystkie 10 miast jest pokolorowanych w ≤ 4 s na łączu
  „Fast 4G" (dziś Kraków w podobnym czasie).
- **SC-002**: Dodatkowy transfer przeglądu 9 miast ≤ 2,5 MB (skompresowany), pobierany po
  pierwszym kolorze bieżącego miasta, nie przed nim.
- **SC-003**: Czas do pierwszych kolorów Krakowa nie rośnie o więcej niż 10% względem `main`.
- **SC-004**: W każdym z 10 miast da się w ≤ 3 kliknięciach od strony głównej otworzyć kartę adresu.
- **SC-005**: 0 heksów w kolorze zera tam, gdzie warstwy nie ma (test na danych miasta bez warstwy).
- **SC-006**: Każdy nowy napis spełnia kontrast 4,5:1 w obu motywach (pomiar, nie ocena na oko).

## Założenia

- Dane 9 miast w obecnym formacie (adresy, kompakt, wskaźniki) są kompletne i spójne
  wewnętrznie; ta funkcja nie uruchamia ETL i nie zmienia `public/dane/**`.
- Kraków pozostaje miastem domyślnym (decyzja #2 „fokus na Krakowie" nadal obowiązuje dla
  treści i SEO; ta funkcja zmienia tylko to, co widać na mapie i w aplikacji).
- Porównanie adresów z różnych miast jest poza zakresem v1.
- Ekrany Dla miasta (luki), Symulator i Biznes pracują na bieżącym mieście; przegląd wszystkich
  miast dostaje tylko mapa ekranu Szukaj.
- Warstwa AI (JEV) działa na liście warstw bieżącego miasta; warstwy nieobecne w mieście
  dostają „brak danych" (bez zmian w `api/**`).
