# Dni z wydarzeniem w dużych obiektach (sezon 2025/26)

Warstwa `imprezy_obiekty_dni_500m_2025_26` (#71) liczy, **ile różnych dni** od 1 lipca 2025 do
30 czerwca 2026 miało wydarzenie w którymkolwiek z pięciu dużych obiektów w promieniu 500 m od
heksu H3. Kategoria `kontekst`, kierunek `neutralny`: to fakt na karcie, bez wpływu na wynik.

Uzupełnia warstwę `imprezy_stale_wpisy_500m_2026` (`etl/imprezy-stale.md`), która liczy pozycje
planu imprez w centrum miasta, ale nie ma dat. Tutaj są daty, za to tylko dla obiektów, które
publikują własny kalendarz albo terminarz. Miejsca bez kalendarza (Błonia, Rynek, plenery)
zostają w warstwie wykazu.

## Co jest policzone, a czego nie

- **Dzień z wydarzeniem** = dzień kalendarzowy, w którym kalendarz obiektu wymienia co najmniej
  jedno wydarzenie (po odrzuceniu odwołanych), albo mecz ligowy gospodarza na jego stadionie.
- To **nie jest** liczba imprez masowych, poziom hałasu ani rejestr zezwoleń. Wpis kalendarza to
  i koncert dla kilkunastu tysięcy osób, i konferencja czy spektakl w sali na 400 miejsc, i
  wykład w sali konferencyjnej. Warstwa nie waży wydarzeń wielkością.
- Mecze: tylko ligowe (Ekstraklasa, Betclic 1 Liga). Bez pucharowych, towarzyskich i koncertów
  na stadionach.
- Zero w Krakowie znaczy: przy tych pięciu obiektach nie było takiego dnia. Nie znaczy braku
  innych wydarzeń w okolicy. Poza Krakowem brak danych (`null`), bo obiektów tamtych gmin nie
  zbieraliśmy.

## Źródła

| Obiekt | Skąd daty | Wynik w oknie |
|---|---|---|
| TAURON Arena Kraków | REST API kalendarza na stronie obiektu (wtyczka The Events Calendar), `tauronarenakrakow.pl/wp-json/tribe/events/v1/events` | 161 wpisów, 134 dni, 3 odwołane |
| EXPO Kraków | endpoint kalendarza strony, `expokrakow.com/ajax/modules/calendar/index/2/pl?year=…&showIncoming=false` | 38 wpisów, 74 dni, 1 wpis z innego miejsca |
| ICE Kraków | archiwum kalendarium: `icekrakow.pl/events/pl/ajax` (POST, partie po 12 wpisów) plus blok wyróżnionych na stronie `icekrakow.pl/kalendarium/archiwum` | 155 wpisów, 140 dni, 1 odwołany, 2 z błędną datą |
| Stadion Cracovii | mecze domowe Ekstraklasy 2025/26, `football-data.co.uk/new/POL.csv` | 17 dni |
| Stadion Wisły | mecze domowe Betclic 1 Ligi 2025/26, strona klubu na `1liga.org` | 17 dni |
| Obrysy obiektów | OpenStreetMap przez Overpass: budynki (`building=stadium` lub `yes`) | 5 obrysów |

Z kalendarzy bierzemy **wyłącznie daty** (fakty). Tytułów i opisów nie przechowujemy (poza
tytułami kilku odrzuconych wpisów, żeby było widać, co wypadło i dlaczego), a plik wskaźnika
zawiera tylko liczby dni i nazwy obiektów. Serwisy nie mają otwartej licencji (poza OSM:
ODbL 1.0); `football-data.co.uk` deklaruje, że dane są bezpłatne.

Kontrole źródeł (jednorazowe, 2026-10-03):

- Ekstraklasa: 17 domowych dat Cracovii z CSV jest **zgodnych co do dnia** z oficjalnym
  terminarzem Ekstraklasy SA (`ekstraklasa.org/terminarz/2025-2026`, 34 kolejki).
- 1 liga: bilans domowy Wisły z `1liga.org` (17 meczów: 12 zwycięstw, 4 remisy, 1 porażka)
  jest taki sam jak w tabeli 90minut.pl. Daty są rzeczywiste (z przełożeniami), nie plan
  z początku sezonu.
- EXPO: daty ze znaczników czasu (UTC → Europa/Warszawa) skrypt porównuje z datą wyświetlaną
  na stronie (`processed_date`); rozbieżność zatrzymuje bieg.

## Reguły, które skrypt stosuje

- **Okno** 2025-07-01 – 2026-06-30. Wpis wielodniowy liczy się dniami z okna (np. kongres od 30.06
  do 1.07 daje w oknie jeden dzień). Wpis dłuższy niż 7 dni to błąd danych (wystawa, pomyłka).
- **Odwołane**: wpis odpada, gdy tytuł albo początek opisu (200 znaków) zawiera „odwołany/
  odwołane/odwołana/odwołano”. „W razie odwołania…” nie liczy się jako odwołanie.
- **EXPO**: wpisy z innym miejscem niż EXPO Kraków odpadają (organizator bywa gościem
  w innych obiektach, np. kongres w Manggha).
- **ICE**: miesiące w dacie bywają w mianowniku i z wielkiej litery („27 - 28 Marzec 2026”),
  skrypt to czyta. Zapisy niejednoznaczne (zakres od końca, np. „21.02.2026 - 29.05.2025”)
  odpadają i trafiają do listy `odrzucone` w migawce, zamiast zgadywania. Wydarzenia wyróżnione
  (np. „Dzień Dobry ICE Kraków”, 31.05.2026) strona pokazuje w osobnym bloku, a listy partiami
  ich nie zawierają, więc skrypt czyta też ten blok. Wyróżnione w przeszłości, które przestały
  być wyróżnione, są już w listach.
- **Mecze**: tylko rozegrane (stan `Finished`), z datą rzeczywistą po przełożeniach. Pełny sezon
  to 17 meczów domowych; inna liczba zatrzymuje skrypt (źródło zwróciło niepełny sezon).

## Obliczenie

1. Dla każdego obiektu zbiór dni z kalendarza (migawka `etl/imprezy-obiekty-2025-26.json`).
2. Dla każdego heksu H3 r10 z adresami Krakowa: odległość od środka heksu do obrysu obiektu
   w EPSG:2180 (0 m wewnątrz obrysu). Obiekt jest „w zasięgu”, gdy odległość wynosi najwyżej
   500 m (jak w warstwie wykazu).
3. Wartość heksu = liczba **różnych** dni z sumy zbiorów obiektów w zasięgu (dzień z dwóch obiektów
   liczy się raz). Etykieta: przy jednym obiekcie sama nazwa („ICE Kraków”), bo karta pokazuje
   „140 dni z wydarzeniem – ICE Kraków” i liczba nie może się powtórzyć; przy kilku obiektach
   nazwy z dniami każdego („Stadion Cracovii (17 dni), Stadion Wisły Kraków (17 dni)” przy
   wartości 34), żeby było widać, z czego wynika suma.
4. Ta sama wartość przypada wszystkim adresom heksu. Poza Krakowem `null`.

Zasięg jest przybliżeniem: liczymy od środka heksu (~65 m), a hałas i ruch idą po ulicach, nie
po linii prostej.

## Wyniki (dla adresów z `public/dane/adresy.json`)

- Pomiar ma 70 217 z 176 684 adresów (39,7%, czyli Kraków); pozostałe leżą poza Krakowem.
- 1 371 adresów ma co najmniej jeden dzień z wydarzeniem w zasięgu: Stadion Cracovii 534
  (17 dni), ICE Kraków 428 (140), Stadion Wisły 232 (17), EXPO Kraków 125 (74), TAURON Arena 49
  (134), a 3 adresy leżą w zasięgu obu stadionów (34 dni). Pozostałe adresy Krakowa mają 0.
- Plik wskaźnika ma ok. 1,6 MB (limit kontraktu: 2 MB).

## Odtworzenie i kontrola

```
node etl/imprezy-obiekty.mjs             # liczy z migawki, bez sieci, wynik powtarzalny
node etl/imprezy-obiekty.mjs --pobierz   # odświeża migawkę ze źródeł, potem liczy
node etl/imprezy-obiekty.mjs --pobierz --swieze   # j.w., ale ignoruje etl/.cache
node --test etl/imprezy-obiekty.test.mjs
```

Test sprawdza m.in.: parsery (formy dat ICE, strefa czasowa EXPO, odwołania), migawkę
(5 obiektów, dni w oknie, 17 meczów na stadion, dość dużo dni w kalendarzach), zasięg 500 m
**niezależnym liczeniem** w lokalnym układzie płaskim (inne niż EPSG:2180) dla ponad 1500 punktów
wokół wszystkich obiektów oraz zgodność pliku wskaźnika z migawką i adresami (null tylko poza
Krakowem, etykieta tylko przy dodatniej wartości, liczba z wartości nie wraca w etykiecie).

Odpowiedzi serwisów trafiają do `etl/.cache/imprezy-obiekty/` (poza gitem). Skrypt przedstawia
się nazwą i adresem projektu w nagłówku User-Agent (zwyczajowa forma `Mozilla/5.0 (compatible; …)`,
bo `1liga.org` odpowiada 403 na inne), robi kilkadziesiąt zapytań z odstępem 0,4 s i czyta tylko
ścieżki dozwolone w `robots.txt` serwisów (TAURON: poza `/wp-admin/`; EXPO: poza `/api/`, a
używamy `/ajax/`; `1liga.org` bez ograniczeń; ICE nie publikuje reguł). `football-data.co.uk`
zamyka w `robots.txt` dostęp botom trenującym modele AI; skrypt pobiera z niego jeden plik CSV
i takim botem nie jest.

## Kolejny sezon

Zmienić `OKNO`, sezon w CSV (`'2025/2026'`) i identyfikator wskaźnika w `etl/imprezy-obiekty.mjs`,
uruchomić z `--pobierz`, przejrzeć listy `odrzucone` w migawce i `node --test`. Strona klubu na
`1liga.org` pokazuje bieżący sezon, więc dla minionego sezonu daty Wisły trzeba wziąć
z archiwum rozgrywek (albo z innego terminarza) i sprawdzić 17 meczów.

## Czego nie zrobiono

- Błonia, Rynek, plenery i festiwale miejskie (Karnet): brak kompletnego kalendarza. Karnet
  zostaje poza warstwą, bo nie jest kompletnym, stabilnym rocznym rejestrem (ta sama ocena
  co w `etl/imprezy-stale.md`).
- Inne stadiony (Wieczysta, Hutnik) i mecze pucharowe: poza listą obiektów z zadania.
- Waga wydarzeń (pojemność hali, rodzaj imprezy): wymagałaby źródła, którego nie mamy.
