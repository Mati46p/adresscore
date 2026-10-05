// Słownik liczb panelu: JEDNO źródło definicji dla podpowiedzi przy kaflach, tabelach i wykresach.
// Wzorzec: `slownik-panelu.ts` z z-dykty, zawężony do pomiaru adresscore (jedno źródło danych:
// własny pomiar bez ciasteczek, więc hasło nie ma pola „źródło”).
//
// DLACZEGO OSOBNY MODUŁ, A NIE OPIS PRZY KAFLU: ta sama liczba stoi w kilku miejscach (odsłony na
// Przeglądzie i w tabeli ekranów), a opis rozsypany po komponentach rozjeżdża się przy pierwszej
// zmianie definicji. Tutaj definicja żyje raz.
//
// DLACZEGO POLE `pulapka` JEST WAŻNIEJSZE OD `liczy`: błędne decyzje biorą się nie z niewiedzy, czym
// jest liczba, tylko z pewności, że jest czymś innym. „Unikalni (7 dób, suma)” wygląda jak liczba
// czytelników tygodnia i nią nie jest. Każde hasło, przy którym da się pomylić, mówi to WPROST,
// bo przy ekranie nikt nie otworzy kodu.
//
// Klucze są jawną unią (`KluczHasla`), nie `string`: literówka w komponencie wywala `pnpm typecheck`,
// zamiast zniknąć jako brakująca podpowiedź, której nikt nie zauważy.

export interface HasloPanelu {
  /** Nazwa dokładnie taka, jak stoi na ekranie – po niej szuka się w podpowiedzi. */
  nazwa: string
  /** Co dokładnie jest liczone. Jedno do trzech zdań, bez nazw tabel i migracji. */
  liczy: string
  /** Okres, którego dotyczy liczba. Pomijamy tam, gdzie okno wybiera użytkownik albo go nie ma. */
  okno?: string
  /** Czego ta liczba NIE znaczy. Wypełniane wszędzie tam, gdzie istnieje naturalna błędna interpretacja. */
  pulapka?: string
  /** Czy więcej znaczy lepiej, gdy to nie jest oczywiste (FR-038). Kierunek skali jest wypisany, nie zakładany. */
  kierunek?: string
}

export const SLOWNIK_PANELU = {
  // ── Przegląd (FR-030) ───────────────────────────────────────────────────────────────────

  'przeglad.unikalniDzis': {
    nazwa: 'Unikalni (dziś)',
    liczy:
      'Ile różnych odcisków ludzi zarejestrowano dziś w dobie warszawskiej. Odcisk to skrót z soli dnia, adresu IP, przeglądarki i hosta, liczony na serwerze – bez ciasteczka i bez identyfikatora na urządzeniu.',
    okno: 'trwająca doba, liczona na żywo',
    pulapka:
      'To przybliżenie liczby OSÓB jednej doby, nie liczba osób w ogóle. Odcisk rotuje o północy, wspólny adres (biuro, sieć operatora) skleja kilka osób w jeden, a ta sama osoba z telefonu i z komputera to dwa. Doba trwa, więc liczba rośnie do północy: z „wczoraj” porównuj ją dopiero po pełnej dobie.',
  },
  'przeglad.unikalniWczoraj': {
    nazwa: 'Unikalni (wczoraj)',
    liczy: 'Ile różnych odcisków ludzi było w ostatniej PEŁNEJ dobie warszawskiej.',
    okno: 'poprzednia doba',
    pulapka:
      'Jak „dziś”: przybliżenie osób jednej doby. Ta sama osoba, która weszła dziś i wczoraj, ma dwa różne odciski.',
  },
  'przeglad.unikalni7d': {
    nazwa: 'Unikalni (7 dób, suma)',
    liczy: 'Suma dobowych liczb unikalnych z 7 ostatnich dób warszawskich (dziś i 6 poprzednich).',
    okno: '7 dób',
    pulapka:
      'TO NIE JEST LICZBA OSÓB TYGODNIA. Osoba wchodząca codziennie liczy się siedem razy, bo odcisk rotuje o północy i nie łączy wizyt między dniami. Do porównań między okresami służy średnia dobowa.',
  },
  'przeglad.unikalniSrednia7d': {
    nazwa: 'Średnio na dobę (7 dni)',
    liczy: 'Suma dobowych liczb unikalnych z 7 ostatnich dób podzielona przez 7.',
    okno: '7 dób',
    pulapka:
      'Świadomie ŚREDNIA, nie suma: to jedyna miara osób porównywalna między okresami o różnej długości. Nadal liczy powroty tej samej osoby z kolejnych dni jako nowe odciski.',
  },
  'przeglad.odslony24h': {
    nazwa: 'Odsłony (24 h)',
    liczy:
      'Ile razy człowiek otworzył ekran serwisu w ostatnich 24 godzinach (bez botów). Przejście między ekranami aplikacji liczy się jako nowa odsłona.',
    okno: '24 godziny, ruchome',
    pulapka:
      'Odsłony to nie ludzie: osoba, która obejrzy pięć ekranów, to pięć odsłon. Liczbę osób przybliżają „Unikalni”. Robot udający zwykłą przeglądarkę jest tu policzony jako człowiek.',
  },
  'przeglad.odslony7d': {
    nazwa: 'Odsłony (7 dni)',
    liczy: 'Suma odsłon ludzi z ostatnich 7 dni (bez botów).',
    okno: '7 dni',
    pulapka:
      'Dzisiejsza doba jest niepełna, więc kolejne wejście na panel pokaże nieco więcej. Odsłony wolno sumować między dobami (w przeciwieństwie do unikalnych).',
  },
  'przeglad.odslony30d': {
    nazwa: 'Odsłony (30 dni)',
    liczy: 'Suma odsłon ludzi z ostatnich 30 dni (bez botów).',
    okno: '30 dni',
    pulapka: 'Jak przy 7 dniach: dzisiejsza doba jest niepełna.',
  },
  'przeglad.szczytGodzina': {
    nazwa: 'Szczyt godzinowy',
    liczy: 'Godzina z największą liczbą odsłon w ostatnich 30 dniach, z datą i godziną w podpisie.',
    okno: '30 dni, czas warszawski',
    pulapka:
      'To rekord pojedynczej godziny, nie typowa godzina: jedna wzmianka w mediach albo przebieg skryptu potrafi go wyznaczyć.',
  },
  'przeglad.szczytDzien': {
    nazwa: 'Szczyt dobowy',
    liczy: 'Doba z największą liczbą odsłon w ostatnich 30 dniach, z datą w podpisie.',
    okno: '30 dni, doby warszawskie',
    pulapka:
      'Szczyt liczy się ZAWSZE z 30 dni, także gdy wykres obok pokazuje krótszy okres: inaczej ta sama etykieta znaczyłaby raz maksimum tygodnia, raz miesiąca.',
  },
  'przeglad.teraz5min': {
    nazwa: 'Teraz na stronie',
    liczy: 'Ile różnych odcisków ludzi wysłało jakiekolwiek zdarzenie w ostatnich 5 minutach.',
    okno: '5 minut, na żywo',
    pulapka:
      'Bez botów. Czytelnik, który nie klika ani nie zmienia ekranu, po 5 minutach znika z liczby, choć ma stronę otwartą. To przybliżenie obecności, nie licznik otwartych kart.',
  },
  'przeglad.ludzieBoty': {
    nazwa: 'Ludzie i boty (24 h)',
    liczy:
      'Podział odsłon z ostatnich 24 godzin na ruch ludzi i roboty rozpoznane po nagłówku przeglądarki. Podstawą udziału jest SUMA obu grup, nie większa z nich.',
    okno: '24 godziny',
    pulapka:
      'Robot, który przedstawia się jako zwykła przeglądarka, jest policzony jako człowiek, więc udział botów to DOLNA granica. Roboty, które nie uruchamiają skryptów strony, nie wysyłają zdarzeń i nie ma ich tu wcale.',
  },
  'przeglad.crawleryAi': {
    nazwa: 'Crawlery AI',
    liczy:
      'Roboty modeli językowych (np. GPTBot, ClaudeBot, PerplexityBot) rozpoznane po przeglądarce: rodzina, liczba odsłon i ostatnia wizyta.',
    okno: '30 dni',
    pulapka:
      'Widać tylko roboty, które uruchomiły skrypty strony i wysłały zdarzenie. Większość crawlerów AI pobiera sam HTML bez skryptów, więc brak robota na tej liście nic nie znaczy.',
  },
  'przeglad.wykresDzienny': {
    nazwa: 'Wykres dzienny',
    liczy: 'Odsłony, unikalni i odsłony botów na dobę, dziś liczone na żywo.',
    okno: '30 dni',
    pulapka:
      'Doba bez wiersza w bazie (przed pierwszym pomiarem) jest przerwą w linii, czyli brakiem danych, nie zerem. Unikalnych z różnych dób nie wolno sumować.',
  },
  'przeglad.wykresGodzinowy': {
    nazwa: 'Wykres godzinowy',
    liczy: 'Odsłony, unikalni i odsłony botów w każdej godzinie, czas warszawski.',
    okno: '48 godzin',
    pulapka:
      'Godzina bez ruchu to prawdziwe zero. Unikalnych z godzin NIE wolno sumować: osoba czytająca trzy godziny jest w trzech z nich.',
  },

  // ── Akwizycja (FR-031) ──────────────────────────────────────────────────────────────────

  'akwizycja.wizyty': {
    nazwa: 'Wizyty',
    liczy:
      'Sesje: ciągi odsłon tego samego odcisku z przerwami do 30 minut. Wizyta należy do kanału i źródła swojej pierwszej odsłony.',
    pulapka:
      'Wizyta nie przechodzi przez północ (odcisk rotuje), a wspólny adres skleja kilka osób w jedną, więc wizyt jest raczej mniej, niż się zdarzyło naprawdę.',
  },
  'akwizycja.kanaly': {
    nazwa: 'Kanały wejścia',
    liczy:
      'Skąd przyszła wizyta: bezpośrednie (brak referera), wyszukiwarka, social, odesłania z innych stron, kampania i asystenci AI. Kanał wylicza serwer z referera, znaczników UTM i nazwy identyfikatora kliknięcia.',
    pulapka:
      '„(bezpośrednie)” to także zakładki, aplikacje, komunikatory i linki z ukrytym refererem – kanał, którego nie da się rozbić, a nie brak danych. Udział kanału to jego wizyty podzielone przez wizyty WSZYSTKICH kanałów okna.',
  },
  'akwizycja.zrodla': {
    nazwa: 'Źródła',
    liczy:
      'Host referera albo wartość utm_source, z kanałem wizyty i (dla hostów publicznych) ścieżką referera.',
    pulapka:
      'Lista jest przycięta do najliczniejszych źródeł, więc udział liczymy wobec wszystkich wizyt okna, a nie wobec sumy widocznych wierszy – inaczej ostatni wiersz wyglądałby na całość.',
  },
  'akwizycja.kampanie': {
    nazwa: 'Kampanie UTM',
    liczy:
      'Wizyty z kombinacji utm_source, utm_medium i utm_campaign (każde do 60 znaków, małymi literami).',
    pulapka:
      'Literówka w znaczniku tworzy osobną kampanię („fb” i „facebook” to dwa wiersze). Wizyty bez znaczników UTM nie ma tu wcale.',
  },
  'akwizycja.kraje': {
    nazwa: 'Kraje',
    liczy:
      'Kraj z nagłówka hostingu albo pośrednika, przypisany wizycie. Gdy nagłówka brak, wizyta trafia do pozycji „(nieznany)”.',
    pulapka:
      'To położenie adresu IP: VPN i sieci operatorów pokazują inny kraj niż ten, w którym ktoś siedzi. „(nieznany)” jest osobną pozycją, bo brak nagłówka to brak wiedzy, nie zero.',
  },
  'akwizycja.urzadzenia': {
    nazwa: 'Urządzenia',
    liczy: 'Klasa urządzenia (telefon, tablet, komputer, inne) wywnioskowana z przeglądarki.',
    pulapka:
      'Klasa pochodzi z nagłówka przeglądarki, więc tablet z włączoną „wersją na komputer” liczy się jako komputer.',
  },

  // ── Sesje (FR-032) ──────────────────────────────────────────────────────────────────────

  'sesje.sesje': {
    nazwa: 'Sesje',
    liczy:
      'Wizyty złożone z odsłon tego samego odcisku. Przerwa dłuższa niż 30 minut zaczyna nową sesję. Sesja nie jest zapisana w bazie, powstaje dopiero w zapytaniu.',
    pulapka:
      'Sesja nie przechodzi przez północ (tożsamość wygasa co dobę), a wspólny adres skleja kilka osób w jedną. Obie rzeczy zaniżają liczbę sesji i zawyżają ich długość.',
  },
  'sesje.stronNaSesje': {
    nazwa: 'Strony na sesję',
    liczy: 'Mediana i średnia liczby odsłon w jednej sesji.',
    pulapka:
      'Mediana nie reaguje na pojedynczego bota ani bardzo aktywną osobę, średnia tak. Duży rozjazd między nimi oznacza ogon bardzo długich sesji.',
  },
  'sesje.czasWizyty': {
    nazwa: 'Czas wizyty',
    liczy: 'Mediana (i percentyl 75) sumy czasu, przez jaki karta była widoczna, w obrębie sesji.',
    pulapka:
      'To PODŁOGA. Czas biegnie tylko przy widocznej karcie (karta w tle go nie nabija), doba przecina wizytę, a sesja bez sygnału wyjścia (przeglądarka ubiła kartę) nie dostaje czasu ostatniej odsłony. Prawdziwa wizyta zwykle trwa dłużej.',
  },
  'sesje.zaangazowane': {
    nazwa: 'Sesje zaangażowane',
    liczy:
      'Jaki udział wszystkich sesji okna miał co najmniej 2 odsłony albo co najmniej 30 sekund widoczności.',
    kierunek: 'Więcej znaczy lepiej.',
    pulapka:
      'Warunki są alternatywne (wystarczy jeden), więc to miara „coś się wydarzyło”, a nie „przeczytał”.',
  },
  'sesje.jednostronicowe': {
    nazwa: 'Sesje jednostronicowe',
    liczy: 'Jaki udział wszystkich sesji okna miał dokładnie jedną odsłonę.',
    pulapka:
      'To nie jest dopełnienie „zaangażowanych”: sesja z jedną odsłoną, która trwała 30 sekund i dłużej, jest jednocześnie jednostronicowa i zaangażowana. Wysoki udział bywa naturalny – ktoś trafia z wyszukiwarki na kartę adresu, czyta ją i wychodzi.',
  },
  'sesje.przejscia': {
    nazwa: 'Przejścia ekran → ekran',
    liczy:
      'Ile razy po odsłonie ekranu „skąd” następną odsłoną w tej samej sesji był ekran „dokąd”. „(wyjście)” oznacza koniec sesji.',
    pulapka:
      '„(wyjście)” jest pełnoprawnym celem: mówi, na czym kończy się droga. Przejście liczy się dla każdej pary kolejnych odsłon, więc A → B → A to dwa przejścia.',
  },
  'sesje.udostepnienia': {
    nazwa: 'Udostępnienia',
    liczy:
      'Zdarzenia udostępnienia według elementu i sposobu: link, kopiowanie, menu systemowe, anulowanie.',
    pulapka:
      'Mierzymy użycie przycisku, nie to, czy ktoś naprawdę wkleił link; „anulowano” to menu otwarte i zamknięte. Link skopiowany ręcznie z paska adresu nie jest tu widoczny.',
  },

  // ── Zaangażowanie (FR-033) ──────────────────────────────────────────────────────────────

  'zaangazowanie.sciezki': {
    nazwa: 'Ścieżki 3-krokowe',
    liczy:
      'Pierwsze trzy ekrany sesji w kolejności. Brak kroku oznacza „(wyjście)”: sesja skończyła się wcześniej.',
    pulapka:
      'Ścieżka zaczyna się od pierwszego ekranu sesji, nie od dowolnego miejsca wizyty, a dłuższe wizyty są obcięte do trzech kroków, więc ich dalszy ciąg jest niewidoczny.',
  },
  'zaangazowanie.sekcjaCzas': {
    nazwa: 'Czas w sekcji (mediana)',
    liczy:
      'Mediana czasu, przez jaki sekcja ekranu była widoczna w oknie przeglądarki, liczona dla odsłon, w których sekcja się pokazała.',
    pulapka:
      'To czas widoczny, nie czas czytania: sekcja na drugim monitorze też „biegnie”. Czas przychodzi z sygnałem wyjścia, więc karty ubite bez sygnału go nie mają.',
  },
  'zaangazowanie.sekcjaZasieg': {
    nazwa: 'Zasięg sekcji',
    liczy:
      'Jaki odsetek odsłon ekranu zobaczył daną sekcję: odsłony z tą sekcją podzielone przez odsłony ekranu.',
    pulapka:
      'Sekcja widoczna od razu po wejściu ma zasięg bliski 100% bez względu na jakość treści – to pozycja na ekranie, nie ocena. Odsłony zakończone bez sygnału wyjścia nie niosą pomiaru sekcji, więc zasięg bywa zaniżony.',
  },
  'zaangazowanie.sekcjaPozycja': {
    nazwa: 'Pozycja sekcji',
    liczy:
      'Mediana pozycji sekcji w dokumencie zapisana przez pomiar; większa wartość znaczy, że sekcja leży niżej na stronie. Czytaj razem z zasięgiem.',
    pulapka:
      'Pozycja zależy od układu strony na danym urządzeniu: na telefonie ta sama sekcja leży niżej niż na komputerze.',
  },
  'zaangazowanie.punktUrwania': {
    nazwa: 'Punkt urwania',
    liczy:
      'Ostatni ekran wizyty i ostatnia widziana na nim sekcja (ta o najwyższej pozycji, w której zmierzono czas). „(brak pomiaru)” oznacza sesję bez pomiaru sekcji.',
    pulapka:
      'Pokazuje, gdzie wizyta SIĘ KOŃCZY, a nie dlaczego. Zakończenie na karcie adresu po przeczytaniu wyniku to sukces, nie utrata. Udział liczymy od sumy wszystkich urwań okna.',
  },

  // ── CTA (FR-034) ────────────────────────────────────────────────────────────────────────

  'cta.klikalnosc': {
    nazwa: 'Klikalność sekcji',
    liczy:
      'Kliknięcia podzielone przez WYŚWIETLENIA przycisku (element widoczny w co najmniej połowie przez pół sekundy), nie przez odsłony strony.',
    kierunek: 'Więcej znaczy lepiej.',
    pulapka:
      'Dzielenie przez odsłony kazałoby przyciskowi pod linią zgięcia wyglądać na martwy, choć jego problemem byłby zasięg, nie treść. Wyświetlenia rozdzielają „nikt tu nie dotarł” od „dotarli i nie kliknęli”. Niska klikalność elementu informacyjnego nie jest zarzutem.',
  },
  'cta.wyswietlenia': {
    nazwa: 'Wyświetlenia przycisku',
    liczy:
      'Ile razy przycisk pojawił się na ekranie na dłużej niż pół sekundy w co najmniej połowie swojej powierzchni.',
    pulapka:
      'Dane o wyświetleniach przychodzą z sygnałem wyjścia, więc odsłony zakończone bez sygnału (ubita karta) nie są ich częścią.',
  },
  'cta.klikniecia': {
    nazwa: 'Kliknięcia',
    liczy: 'Kliknięcia w oznaczone przyciski i linki sekcji, zliczone razem z wyjściem z odsłony.',
    pulapka:
      'Kliknięcie to użycie przycisku, nie skutek: nie wiemy, czy po kliknięciu coś się udało.',
  },
  'cta.martwe': {
    nazwa: 'Martwe przyciski',
    liczy: 'Przyciski wyświetlone co najmniej 50 razy i ani razu niekliknięte w oknie.',
    pulapka:
      'Próg 50 wyświetleń chroni przed wnioskami z przypadku. Zero kliknięć może znaczyć też, że element jest informacją (etykietą), a nie zachętą – sprawdź, co to jest, zanim go usuniesz.',
  },
  'cta.furia': {
    nazwa: 'Szybkie wielokrotne kliknięcia',
    liczy:
      'Serie co najmniej 3 kliknięć w promieniu 30 pikseli w ciągu 800 ms – typowy znak, że coś nie reaguje albo reaguje za wolno. Na 1000 odsłon danego ekranu.',
    kierunek: 'Mniej znaczy lepiej.',
    pulapka:
      'Przeliczenie na 1000 odsłon jest po to, żeby na czele nie stał po prostu najpopularniejszy ekran. Na małym ekranie jedna sfrustrowana osoba potrafi nabić wynik.',
  },
  'cta.martwyKlik': {
    nazwa: 'Kliknięcia w nieklikalne',
    liczy:
      'Kliknięcia w element, który nie jest ani linkiem, ani przyciskiem – ktoś spodziewał się, że zadziała. Na 1000 odsłon danego ekranu.',
    kierunek: 'Mniej znaczy lepiej.',
    pulapka:
      'Część takich kliknięć to zwykłe zaznaczanie tekstu albo przypadkowy dotyk. Sygnałem jest dopiero ekran lub sekcja, która wyraźnie odstaje od reszty.',
  },

  // ── Treść (FR-035) ──────────────────────────────────────────────────────────────────────

  'tresc.topEkrany': {
    nazwa: 'Top ekrany',
    liczy: 'Ekrany z największą liczbą odsłon (bez botów) i sumą dobowych odcisków.',
    pulapka:
      '„Karta adresu” obejmuje wszystkie adresy razem; konkretne karty są w „Top adresy”. „Unikalni” to suma dobowych odcisków, nie osoby.',
  },
  'tresc.topAdresy': {
    nazwa: 'Top adresy',
    liczy: 'Najczęściej oglądane karty adresów, według ścieżki strony w serwisie.',
    pulapka:
      'Na liście stoi ścieżka strony (np. /adres/…), nie nazwa ulicy. Karty otwarte z wyszukiwarki internetowej i z wyszukiwarki serwisu są policzone razem.',
  },
  'tresc.bezWyniku': {
    nazwa: 'Wyszukiwania bez wyniku',
    liczy:
      'Frazy wpisane w wyszukiwarce serwisu, na które nie było wyniku: znormalizowane (małe litery, do 80 znaków), z liczbą powtórzeń i datą ostatniego razu.',
    pulapka:
      'To gotowa lista braków w danych, ale też literówek i pytań spoza zakresu serwisu (inne miasta). Frazy wyglądające na dane osobowe (e-mail, telefon, długi ciąg cyfr) nie są zapisywane, tylko liczone pod znacznikiem „odrzucono”.',
  },
  'tresc.lejek': {
    nazwa: 'Lejek produktowy',
    liczy:
      'Ile sesji wykonało dany krok: wyszukanie, otwarcie karty adresu, dodanie do porównania, zmiana warstwy mapy, wejście w tryb Biznes. Każdy krok jest liczony na sesjach NIEZALEŻNIE.',
    pulapka:
      'Sesja liczy się do kroku, gdy ma jego zdarzenie, niezależnie od kolejności, więc krok późniejszy może mieć więcej sesji niż wcześniejszy: kartę można otworzyć bez wyszukiwania (link z wyszukiwarki internetowej).',
  },
  'tresc.lejekOdPierwszego': {
    nazwa: '% od pierwszego kroku',
    liczy:
      'Sesje kroku podzielone przez sesje pierwszego kroku (wyszukanie), razy 100. Pierwszy krok to 100%.',
    pulapka:
      'Wartość powyżej 100% jest możliwa i prawdziwa (karty otwarte bez wyszukiwania). Przy zerowym pierwszym kroku nie ma czego dzielić i procent jest pusty, nie zerowy.',
  },
  'tresc.lejekOdPoprzedniego': {
    nazwa: '% od poprzedniego kroku',
    liczy: 'Sesje kroku podzielone przez sesje kroku bezpośrednio wyżej w lejku.',
    pulapka:
      'Kroki po karcie (porównanie, warstwa mapy, tryb Biznes) są alternatywami, a nie kolejnymi etapami, więc procent „od poprzedniego” między nimi nic nie mówi. Porównuj je z liczbą kart.',
  },

  // ── Jakość (FR-036) ─────────────────────────────────────────────────────────────────────

  'jakosc.ostatnieZdarzenie': {
    nazwa: 'Ostatnie zdarzenie',
    liczy: 'Czas ostatniego zapisanego zdarzenia pomiaru (dowolnego typu, także robotów).',
    pulapka:
      'Cisza dłuższa niż zwykła przerwa w ruchu to pierwszy sygnał zepsutego pomiaru: „zero ruchu” przy zepsutym pomiarze wygląda dokładnie tak samo jak brak odwiedzin. Sprawdź to, zanim uwierzysz w niskie liczby.',
  },
  'jakosc.zdarzenia24h': {
    nazwa: 'Zdarzenia na typ (24 h)',
    liczy:
      'Liczba zdarzeń każdego z siedmiu typów w ostatnich 24 godzinach: odsłona, wyjście, klik, udostępnienie, produktowe, pomiar szybkości i błąd klienta.',
    okno: '24 godziny',
    pulapka:
      'Zero przy jednym typie, gdy inne mają ruch, wskazuje, który kawałek pomiaru nie działa (brak „wyjść” = nie dochodzą sygnały przy zamykaniu karty). Zero błędów klienta jest dobrą wiadomością, nie awarią.',
  },
  'jakosc.bezOdcisku': {
    nazwa: 'Zdarzenia bez odcisku (24 h)',
    liczy: 'Zdarzenia zapisane bez odcisku dobowego, bo sól dnia była niedostępna dla endpointu.',
    okno: '24 godziny',
    kierunek: 'Mniej znaczy lepiej.',
    pulapka:
      'Takie zdarzenia liczą się do odsłon, ale nie do unikalnych ani do sesji. Większa liczba znaczy, że unikalni i sesje są zaniżeni.',
  },
  'jakosc.ostatniBieg': {
    nazwa: 'Ostatni bieg zestawienia',
    liczy:
      'Kiedy zakończyło się ostatnie nocne zestawienie dnia poprzedniego (albo sprzątanie) i czy zapisało błąd.',
    pulapka:
      'Bieg starszy niż 26 godzin albo z błędem znaczy, że historia dłuższa niż 30 dni się nie zapisuje. Surowe zdarzenia są usuwane po 90 dniach, więc luka w zestawieniu staje się po tym czasie nieodwracalna.',
  },
  'jakosc.dniWZestawieniu': {
    nazwa: 'Dni w zestawieniu',
    liczy:
      'Liczba dób zapisanych w zestawieniu dziennym – historii, która przeżywa usunięcie surowych zdarzeń.',
    pulapka:
      'Rośnie o jeden na dobę od startu pomiaru. Mniejsza liczba niż dni od startu oznacza dziury w historii.',
  },
  'jakosc.najstarszeZdarzenie': {
    nazwa: 'Najstarsze zdarzenie',
    liczy:
      'Czas najstarszego surowego zdarzenia, które jeszcze nie zostało usunięte. Surowe zdarzenia żyją 90 dni.',
    pulapka:
      'Starsze dni są dostępne tylko w zestawieniu dziennym, bez szczegółów (ścieżek, sekcji, fraz).',
  },
  'jakosc.witaleP75': {
    nazwa: 'Web Vitals (p75)',
    liczy:
      'Wartość, poniżej której mieści się 75% pomiarów danej metryki na danym ekranie. Ocena według progów Google: dobra, do poprawy, słaba.',
    okno: 'wybrane okno',
    kierunek: 'Mniej znaczy lepiej (dla CLS także).',
    pulapka:
      'To percentyl 75, nie średnia: odpowiada na pytanie, jak jest dla trzech czwartych wizyt. Przy kilkunastu próbkach wynik skacze, dlatego obok stoi liczba próbek. Jeden pomiar to jedno wczytanie ekranu, nie osoba.',
  },
  'jakosc.lcp': {
    nazwa: 'LCP – największa treść',
    liczy:
      'Czas od rozpoczęcia wczytywania do narysowania największego elementu widocznego na ekranie (zwykle zdjęcia albo bloku tekstu), w milisekundach.',
    kierunek: 'Mniej znaczy lepiej: dobra do 2 500 ms, słaba powyżej 4 000 ms.',
  },
  'jakosc.inp': {
    nazwa: 'INP – reakcja na interakcję',
    liczy:
      'Czas od kliknięcia, dotyku albo klawisza do kolejnego narysowania ekranu, w milisekundach. U nas liczony jako najdłuższa interakcja wizyty.',
    kierunek: 'Mniej znaczy lepiej: dobra do 200 ms, słaba powyżej 500 ms.',
    pulapka:
      'Najdłuższa interakcja wizyty bywa nieco wyższa niż INP z raportów Google, które przy wielu interakcjach pomijają skrajne wartości. Metryka istnieje tylko dla wizyt, w których ktoś coś kliknął.',
  },
  'jakosc.cls': {
    nazwa: 'CLS – przesunięcia układu',
    liczy:
      'Suma nieoczekiwanych przesunięć elementów strony podczas wczytywania i czytania. To bezwymiarowy ułamek, nie milisekundy.',
    kierunek: 'Mniej znaczy lepiej: dobra do 0,1, słaba powyżej 0,25.',
  },
  'jakosc.fcp': {
    nazwa: 'FCP – pierwsza treść',
    liczy: 'Czas do pierwszego narysowania jakiejkolwiek treści strony, w milisekundach.',
    kierunek: 'Mniej znaczy lepiej: dobra do 1 800 ms, słaba powyżej 3 000 ms.',
  },
  'jakosc.ttfb': {
    nazwa: 'TTFB – odpowiedź serwera',
    liczy: 'Czas od żądania strony do pierwszego bajtu odpowiedzi serwera, w milisekundach.',
    kierunek: 'Mniej znaczy lepiej: dobra do 800 ms, słaba powyżej 1 800 ms.',
    pulapka:
      'Zależy od hostingu i połączenia, nie od kodu aplikacji. Po przeprowadzce na własny serwer może się wyraźnie zmienić, więc porównania sprzed i po są zakłócone.',
  },
  'jakosc.probki': {
    nazwa: 'Próbki',
    liczy:
      'Liczba pomiarów, z których policzono p75. Jedno wczytanie ekranu daje jeden pomiar danej metryki.',
    pulapka:
      'Pomiarów jest mniej niż odsłon: nie każda przeglądarka raportuje każdą metrykę (INP wymaga interakcji, LCP widocznej karty).',
  },
  'jakosc.bledy': {
    nazwa: 'Błędy klienta',
    liczy:
      'Nieprzechwycone wyjątki i odrzucone obietnice w przeglądarce użytkownika: skrócony komunikat (do 200 znaków, długie liczby zamienione na #), ekran, liczba wystąpień i ostatni raz.',
    kierunek: 'Mniej znaczy lepiej.',
    pulapka:
      'To liczba ZDARZEŃ, nie osób: jedna przeglądarka w pętli błędu da wiele wpisów (klient wysyła najwyżej 5 na odsłonę). Błędy rozszerzeń przeglądarki i skryptów spoza serwisu też tu trafiają.',
  },
} as const satisfies Record<string, HasloPanelu>

/** Klucz hasła. Unia, nie `string`: literówka w `Podpowiedz` nie przejdzie `pnpm typecheck`. */
export type KluczHasla = keyof typeof SLOWNIK_PANELU

/**
 * Hasło po kluczu, rozszerzone do `HasloPanelu`. `as const satisfies` daje unię kluczy, ale zawęża
 * każdy wpis do jego literałów (wtedy `pulapka` nie istnieje na wpisach bez pułapki); czytelnicy
 * słownika mają dostawać jeden, przewidywalny kształt.
 */
export function haslo(klucz: KluczHasla): HasloPanelu {
  return SLOWNIK_PANELU[klucz]
}

/** Wszystkie klucze w kolejności deklaracji (dla testu kompletności). */
export const KLUCZE_HASEL = Object.keys(SLOWNIK_PANELU) as KluczHasla[]
