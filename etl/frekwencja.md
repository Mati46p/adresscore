# Frekwencja w wyborach samorządowych 2024 – poziom gminy

Uruchom `node etl/frekwencja.mjs` (Node 24). Wynik: `wskazniki/frekwencja_samorzad_2024.json`,
kategoria `kontekst`, kierunek `neutralny`, rozdzielczość `gmina`, zadanie 142. Test:
`node --test etl/frekwencja.test.mjs`.

**Co mierzy.** Odsetek uprawnionych do głosowania, którzy oddali ważną kartę w wyborach
samorządowych 7 kwietnia 2024 (głosowanie do sejmiku województwa), w gminie adresu. Jedna liczba
na gminę, powtórzona przy każdym adresie (kontrakt wymaga liczby na adres). To nie jest frekwencja
okolicy ani mieszkańców adresu, a dogrywki wyborów wójtów, burmistrzów i prezydentów
(21.04.2024) nie wchodzą do wskaźnika. Etykieta adresu podaje liczby gminy (ważne karty z liczby
uprawnionych); klucze słownika są jednoznakowe, bo pełny TERYT przy 176 tys. adresów przekroczyłby
limit 2 MB pliku.

## Źródła

| Gminy | Źródło | Jak |
|---|---|---|
| 13 gmin obwarzanka | z-dykty.pl, tabela `wybory_frekwencja`, elekcja `samorzad-2024` | PostgREST z publicznym kluczem anon (`ZDYKTY_SUPABASE_URL`, `ZDYKTY_ANON_KEY` w `.env.local`), strony `limit`/`offset`, odpowiedź w `etl/.cache/` |
| Kraków | KBW (danewyborcze.kbw.gov.pl), protokoły po obwodach, sejmiki województw | suma uprawnionych i „Liczba kart ważnych” po 454 obwodach |

**Dlaczego dwa źródła.** z-dykty.pl nie ma frekwencji samorządowej 2024 dla żadnego z 66 miast
na prawach powiatu (2411 z 2479 gmin), więc brakuje Krakowa, czyli 40% adresów. Uzupełnienie
z KBW liczy tak samo jak z-dykty:

- `uprawnieni` i `glosy_oddane` w z-dykty to dokładnie suma uprawnionych i suma „Liczba kart
  ważnych” z protokołów sejmikowych KBW, a `frekwencja_pct` to ich iloraz zaokrąglony do 0,01.
  Sprawdzone 2026-10-03 na wszystkich 2411 gminach z-dykty: 2411 zgodnych, 0 różnic.
- Skrypt powtarza to porównanie przy każdym biegu dla gmin obecnych w obu źródłach i przerywa
  przy najmniejszej różnicy, żeby nie mieszać dwóch definicji. Obecnie: 13 z 13 zgodnych.
- Inne arkusze KBW (rady gmin, wójt) dają inne liczby o 0,01–0,1 pp, bo każde głosowanie ma własne
  protokoły; do Krakowa używamy tego samego głosowania co z-dykty, nie najbliższego.

Kod KBW „Teryt Gminy” jest liczbą, więc dla województw 02, 04, 06 i 08 traci zero z przodu
(skrypt je odtwarza). Adresy mają TERYT 7-cyfrowy, KBW 6-cyfrowy: dopasowanie obcina siódmą
cyfrę (rodzaj gminy) i sprawdza nazwę gminy.

## Dlaczego gmina, a nie okręg

Tabela `okregi_wyborcze` w z-dykty to 41 okręgów sejmowych (numer, nazwa, siedziba), bez geometrii
i bez ulic. KBW opisuje okręgi rad gmin 2024 wolnym tekstem w kolumnie „Opis granic” (ulice
z zakresami numerów, np. „nieparzyste do 149 i parzyste do 154”, albo sołectwa; w Krakowie 7
okręgów po 4,5–10 tys. znaków), bez geometrii. Przypisanie takim opisom 176 tys. adresów byłoby
zgadywaniem na nazwach ulic. Frekwencję per obwód KBW podaje, ale granic obwodów nie ma w żadnej
formie przypisywalnej do adresu. Rozdzielczość to więc gmina; okręgi Krakowa wymagałyby osobnego
zadania (parser opisów granic).

## Atrybucja

Państwowa Komisja Wyborcza, wybory samorządowe 2024 (dane źródłowe: informacja publiczna).
Dla 13 gmin: przetworzone przez z-dykty.pl ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)).
Dla Krakowa: Krajowe Biuro Wyborcze, dane urzędowe; na stronie zbioru nie wskazano odrębnej
licencji (to samo założenie co w warstwie Sejm 2023). Przekształcenia: selekcja gmin obszaru,
suma po obwodach (Kraków), iloraz do 0,01, powtórzenie wartości gminy przy każdym adresie.
