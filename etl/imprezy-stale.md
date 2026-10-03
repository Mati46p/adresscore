# Wpisy wykazu imprez stałych w pobliżu heksu

Warstwa `imprezy_stale_wpisy_500m_2026` przedstawia **liczbę pozycji wykazu**, nie liczbę
odbytych imprez, dni, uczestników ani pomiar hałasu. Domyślna kategoria to `kontekst` i
kierunek `neutralny`, więc warstwa nie wpływa na wynik adresu. To uczciwszy opis dostępnego
źródła niż przewidziane w #71 „dni z imprezą w zasięgu”.

## Źródła i zakres

- [Zarządzenie Prezydenta Miasta Krakowa nr 3080/2025](https://bip.krakow.pl/zarzadzenia/2025/3080/X19BS19fOTQ1ODM%3D/3080_2025.pdf)
  obowiązuje od 1 stycznia 2026 r. Załączniki 1–10 podają lokalizacje i pozycje planu.
  Do wskaźnika weszło 81 pozycji z dziewięciu punktowo lokalizowanych przestrzeni.
  Załącznik 7 zawiera 11 pozycji dla „Bulwarów Wisły” bez odcinka; pominięto je, aby nie
  przypisywać wszystkich imprez jednemu punktowi. Wpisanie do wykazu nie zwalnia z
  dodatkowych zgód lub umów (§ 2), zatem nie potwierdza, że impreza się odbyła.
- [OpenStreetMap](https://www.openstreetmap.org/copyright) lokalizuje reprezentatywne punkty
  dziewięciu miejsc. Obiekty i ich współrzędne są zapisane w `imprezy-stale-2026.json`; każdy
  ma odnośnik OSM. OSM jest udostępniany na licencji ODbL 1.0.
- [Karnet Kraków](https://karnet.krakowculture.pl/wydarzenia) publikuje kalendarz z terminami
  i miejscami, ale jego przeglądana część nie jest kompletnym, stabilnym rocznym rejestrem.
  Nie doliczamy arbitralnej próbki „top 30”, bo dawałaby pozorną przewagę opisanym obiektom.
  Karnet nie stanowi źródła liczbowego tej wersji warstwy.

Spis 10 miejsc i liczebności jest ręcznie zweryfikowany z PDF (SHA-256
`7cf001344fb29e5e2af96800451ea27778a5375dc36cd48c28fd082421e18e9c`).
Ręczna aktualizacja wymaga ponownego sprawdzenia wszystkich załączników, bo ich treść lub
liczba pozycji może się zmienić. Warunki ponownego wykorzystania informacji BIP:
<https://www.bip.krakow.pl/?dok_id=48482>.

## Obliczenie

Dla każdego heksu H3 r10 z adresami Krakowa liczymy odległość wielkiego koła od środka
heksu do reprezentatywnego punktu OSM. Jeśli wynosi najwyżej 500 m, dodajemy liczbę
pozycji danego miejsca i wpisujemy nazwę do etykiety. Ta sama liczba przypada wszystkim
adresom heksu. Zasięg jest przybliżeniem: szczególnie przy Błoniach, długiej trasie biegu
lub wydarzeniu na skraju placu środek miejsca nie opisuje dokładnie ekspozycji adresu.

Zero w Krakowie oznacza wyłącznie brak pozycji **tych dziewięciu miejsc** w 500 m.
Nie oznacza braku wydarzeń. Poza Krakowem wartość jest `null` (brak danych), choć adresy
obwarzanka mogą leżeć blisko miejskiego wydarzenia; wykaz nie obejmuje ich gmin.

## Odtworzenie i kontrola

`node etl/imprezy-stale.mjs` tworzy plik wskaźnika z obecnej wersji adresów.
`node --test etl/imprezy-stale.test.mjs` sprawdza katalog, punkt, heks i rozróżnienie
zera od braku danych. Przy aktualnej bazie: 70 217/176 684 adresów ma pomiar (39,7%);
większość pozostałych leży poza Krakowem. Plik jest mniejszy niż limit 2 MB.

## Daty dla dużych obiektów

Wykaz nie ma dat dziennych. Dni z wydarzeniem w TAURON Arenie, EXPO, ICE i na stadionach Cracovii
i Wisły (z kalendarzy i terminarzy obiektów) liczy osobna warstwa: `etl/imprezy-obiekty.md`.
