# src/wynik – silnik, stan, dane (kontrakt dla fazy 2)

Przeczytaj ten plik i makietę w `docs/makieta/` (`Main`, `Okolica`, `Porownanie`, `KrakowMap`).
Typy danych są w `src/kontrakty/index.ts`. Ten katalog należy do toru `karta`.

## Testy

```
node --test 'src/wynik/*.test.ts'
```

Node 24 uruchamia TypeScript bez kompilacji. Pliki czyste (`silnik.ts`, `persony.ts`, `url.ts`)
importują się względnie z rozszerzeniem `.ts`. Z kontraktu biorą tylko typy (`import type`),
bo `src/kontrakty` czyta `import.meta.env`, którego Node nie ma.

## Silnik – `silnik.ts` (czyste funkcje)

| Funkcja | Co robi |
|---|---|
| `przygotujWskaznik(plik)` | Dodaje skalę do pliku wskaźnika. `useDane` robi to za Ciebie. |
| `kierunekEfektywny(meta, kierunki?)` | Daje kierunek, który faktycznie liczy ocenę: kierunek użytkownika albo persony, a bez niego `meta.kierunek`. `null` = warstwa nie wchodzi do wyniku (kontekst albo `neutralny` bez nadanego kierunku). Warstwa `neutralny` z kierunkiem od persony daje kierunek, więc liczy się do wyniku – ekran musi wtedy pokazać jej przycisk. |
| `wskaznikNiedostepny(meta, n, powod)` | Daje warstwę bez danych pod każdym adresem dla pliku, który się nie wczytał. `useDane` robi to za Ciebie. |
| `ocenWartosc(wartosc, skala, kierunek)` | Daje ocenę 0–100. Brak danych albo brak kierunku daje `null`, nigdy 0. |
| `wynikAdresu(i, wskazniki, wagi, kierunki?)` | Daje pełne rozbicie jednego adresu (`WynikAdresu`). |
| `wynikiWszystkich(wskazniki, wagi, kierunki, n)` | Daje `Float32Array` wyników wszystkich adresów. `NaN` = brak danych. |
| `ocenyWarstwy(wskaznik, kierunki?)` | Daje oceny jednej warstwy dla mapy albo `null` dla warstwy bez kierunku. |
| `grupujHeksy(h3[])`, `srednieHeksow(wartosci, grupy)` | Liczą średnią po heksie H3 r10. Heks bez danych = `NaN`. |
| `mapaHeksow(srednie, grupy)` | Daje `Map<h3, number \| null>` – format propsa `heksy` w `MapaKrakowa`. |
| `literaZWyniku(wynik)` | Daje literę A–G z `PROGI_LITER` (A ≥ 75, B ≥ 65, C ≥ 55, D ≥ 45, E ≥ 35, F ≥ 25; skalibrowane na rozkładzie średniej z rang). |

Zasady skali:

- Przedział skali to `meta.zakres`. Bez zakresu silnik bierze 5. i 95. percentyl danych.
- Norma wewnątrz przedziału daje ocenę 50. Przekroczenie normy zawsze daje mniej niż 50.
- Kierunek `neutralny` nie liczy się do wyniku, dopóki użytkownik albo persona nie poda kierunku.
- Kategoria `kontekst` nigdy nie liczy się do wyniku. Karta pokazuje ją jako fakt (`wartosc`).
- Kierunek użytkownika: `mniej-lepiej` (↓) lub `wiecej-lepiej` (↑).

`WynikAdresu`:

- `wynik` 0–100 albo `null`, `litera` A–G albo `null`.
- `pewnosc` 0–1: udział wagi warstw z danymi w wadze wszystkich liczonych warstw. W UI jest to
  kompletność danych, nie miara dokładności. Warstwa, której plik się nie wczytał, liczy się do
  mianownika jako brak danych, więc obniża kompletność; wynik z dostępnych warstw może się zmienić
  po jej wczytaniu.
- `warstwy[]`: `ocena`, `waga` (po normalizacji, suma = 1), `wagaUzytkownika` (0–4), `wklad` (suma = `wynik`),
  `wartosc` (surowy pomiar), `etykieta`, `meta` (źródła, `dataDanych`, `rozdzielczosc`, `rozmiar`, `atrapa`),
  `niedostepny` (powód, gdy plik warstwy się nie wczytał; pokaż „warstwa niedostępna", nie „brak danych pod adresem").
- `kategorie[]`: `ocena` (`null` = szara kategoria), `waga`, `wklad`, `pewnosc`, `warstwy`.

Kolory: `PALETA_WYNIKU` (5 stopni z makiety, od słabo do idealnie) i `KOLOR_BRAKU` (szary).

## Persony – `persony.ts` (dane)

- `PERSONY`: 14 profili i `od-zera`. Każdy ma `wagi`, opcjonalne `kierunki` i `wagaNowych`. Skala 0–4 i dowody przy wagach: `docs/metoda-wag.md`. Waga na warstwie neutralnej wymaga kierunku w `kierunki`, a warstwa kontekstu nie dostaje wagi – inaczej test-strażnik w `persony.test.ts` jest czerwony.
- `TRYBY`: `kupuje`, `wynajmuje`, `biznes`. Kupno i najem używają person oraz modyfikatorów
  kategorii. Biznes ocenia odległość od wybranego rodzaju usługi (sklep spożywczy,
  gastronomia, apteka lub weterynarz) oraz ludność NSP 2021. Warstwa przykładowa dostaje wagę 0.
- `ustawieniaPersony(persona, tryb, metaWskaznikow)` daje `{ wagi, kierunki }` dla żywych warstw.
  Nieznane id persona pomija. Nowa warstwa z manifestu ma wagę 0, dopóki nie zostanie
  świadomie dodana do profilu. Profil `od-zera` pozostawia wszystkie wagi na 0.

## Dane – `dane.ts`

- `useDane()` daje `{ stan: 'ladowanie' } | { stan: 'blad', blad } | { stan: 'gotowe', ...Dane }`.
- `Dane`: `plikAdresow`, `adresy` (`Adres[]`), `manifest`, `wskazniki` (`WskaznikPrzygotowany[]`), `pominiete`, `grupyHeksow`.
- Aplikacja ładuje dane raz. Każdy komponent może wołać `useDane()` bez kosztu.
- `wskazniki` ma wszystkie warstwy manifestu. Warstwa z inną wersją adresów albo z błędem pobrania
  ma pole `niedostepny` i brak danych pod każdym adresem. Loader dopisuje ją też do `pominiete`
  i pisze ostrzeżenie w konsoli.

## Wyniki dla UI – `useWyniki.ts`

- `useWyniki()` daje `{ naAdres: Float32Array, heksy: Map<h3, number | null>, podpis }` dla aktywnej warstwy albo `null` w trakcie ładowania.
- `useWynikAdresu(i)` daje `WynikAdresu` dla karty i porównania.
- Przeliczenie po zmianie wagi trwa ok. 25 ms dla 70 tys. adresów.

## Twarde filtry – `filtry.ts` (czyste funkcje)

Filtr wyklucza adres, nie obniża jego wyniku: wynik adresu i wyniki innych adresów zostają bez zmian.
Działa po id wskaźnika, więc obejmie też warstwę, która dopiero się pojawi (np. czas dojazdu, #38).
Filtr nieznanej warstwy nic nie wyklucza, ale zostaje w stanie i w URL.

- `ocenFiltr(wartosc, filtr)` daje `spelnia`, `narusza` albo `nie-wiemy`. Brak danych daje `nie-wiemy`: adres NIE jest wykluczony.
- `policzWykluczenia(wskazniki, filtry, n)` daje `wykluczony[]`, `niewiadomy[]` i liczniki.
- `wykluczoneHeksy(wykluczony, grupy)` daje heksy, w których wszystkie adresy są wykluczone. `MapaKrakowa` dostaje je w propie `wykluczone`.
- `useWyniki()` zwraca `wykluczenia` i `wykluczoneHeksy`. Ranking pomija wykluczone adresy, a średnie heksów liczą się bez nich.

## Lepszy sąsiad – `sasiedzi.ts` (czysta funkcja, #93)

`lepsiSasiedzi(i, adresy, wskazniki, { wagi, kierunki, filtry }, opcje?)` daje
`{ wyjsciowy: { wynik, litera, pewnosc, cenaM2 }, kandydaci: LepszySasiad[] }`: do 3 adresów
w promieniu 500 m z literą lepszą niż adres `i`. Kartę (#94) i mapę (#95) robią osobne zadania.

- Kandydaci z pierścieni H3 wokół heksu adresu, potem odległość geodezyjna (`odlegloscM`) ≤ 500 m.
- Wynik liczy `wynikAdresu` z bieżącymi wagami i kierunkami. Adres naruszający dealbreaker nie jest
  kandydatem; brak danych dla filtra nie wyklucza. Adres wyjściowy bez wyniku = pusta lista.
- Cena: `cena_m2_mediana` w granicach ±15%. Brak ceny po którejś stronie (albo warstwa-atrapa) =
  kandydat zostaje z `cena: { stan: 'brak', podpis: 'brak cen transakcyjnych' }`.
- `wyroznia`: do 2 kategorii z największą przewagą wkładu, z `opis` słowami („znacznie ciszej i zdrowiej”).
  Szara kategoria po którejś stronie nie wchodzi do porównania. Punktów nie pokazuj.
- `nizszaPewnosc`: kandydat ma niższą pewność niż adres wyjściowy – oznacz go na karcie.
- Jeden wpis na budynek, budynek adresu wyjściowego pominięty. `opcje.budynekAdresu(i)` podaje klucz
  budynku (np. z obrysów `miasto3d`); bez niego ten sam budynek = ta sama ulica, ten sam numer bez
  litery („5”, „5A”) i ≤ 30 m.
- Kolejność: lepsza litera → bliżej → wyższy wynik → niższy indeks.
- Pierwsze wywołanie liczy indeks heksów i oceny warstw (ok. 200 ms przy 177 tys. adresów), kolejne trwają kilka ms.

### Wspólny stan karty i mapy – `sasiedziStan.ts` + `useSasiedzi.ts` (#94)

Jeden stan dla sekcji na karcie (`src/karta/okolica/LepszySasiad.tsx`) i znaczników na mapie (#95).
Stan trzyma tylko `{ zrodlo: number | null, wybrany: number | null }` – adres, dla którego sekcja
jest otwarta, i pozycję podświetlonego kandydata. Listę kandydatów liczy `policzSasiadow` z bieżącymi
wagami, kierunkami i filtrami (pamięć ostatniego wyniku w module), więc zmiana wagi przelicza kartę
i mapę naraz. Sekcja otwarta dla innego adresu niż `stan.wybrany` = zamknięta (pusta lista).

| Eksport | Co robi |
|---|---|
| `otworzSasiadow(i)`, `zamknijSasiadow()`, `przelaczSasiadow(i)` | Otwiera/zamyka sekcję. Zamknięcie czyści kandydatów i podświetlenie – znaczniki znikają. |
| `wybierzSasiada(k \| null)` | Podświetla kandydata `k` (pozycja w liście) na karcie i mapie. |
| `otworzKarteSasiada(adres)` | Zamyka sekcję i otwiera kartę kandydata (`pokazOkolice`). |
| `porownajZSasiadem(zrodlo, adres)` | Dodaje oba adresy do Porównania (#48) i przechodzi tam; `'pelne'`, gdy się nie mieszczą (nic nie zmienia). |
| `useStanSasiadow(selektor)` | Czyta stan jak `useStan`. |
| `useLepsiSasiedzi()` (useSasiedzi.ts) | `{ otwarta, wynik: LepsiSasiedzi \| null, wybrany }` dla karty. |
| `usePropsSasiadowMapy()` (useSasiedzi.ts) | Gotowe propsy dla komponentu znaczników na mapie (niżej). |

Propsy mapy (`PropsSasiadowMapy`):

```ts
kandydaci: readonly { adres: number; lon: number; lat: number; litera: Litera; etykieta: string }[]
srodek: { lon: number; lat: number } | null   // adres wyjściowy; null = sekcja zamknięta
promienM: number                              // 500
wybrany: number | null                        // pozycja w `kandydaci`
onWybierz: (k: number | null) => void         // podświetla kandydata k (pozycja w `kandydaci`)
onOtworz: (k: number) => void                 // otwiera kartę kandydata k i zamyka sekcję
```

Pusta `kandydaci` i `srodek: null` = nic nie rysuj. `kandydaci` ma stałą tożsamość dla tego samego
wyniku. Podpięcie w miejscu, gdzie renderuje się mapa:

```tsx
const sasiedzi = usePropsSasiadowMapy()
<MapaKrakowa … sasiedzi={sasiedzi} />   // albo {...sasiedzi} na komponencie znaczników z #95
```

## Stan – `stan.ts`

- `useStan((s) => s.pole)` czyta stan. Selektor zwraca pole stanu albo prymityw, nigdy nowy obiekt.
- Pola: `ekran`, `tryb`, `persona` (`'wlasna'` po ręcznej zmianie wagi), `wagi`, `kierunki`, `wybrany` (indeks | null), `porownanie` (do 5 indeksów), `warstwa` (`'wynik'` albo id wskaźnika).
- Pola trybów Miasto i Biznes (#92, #98, #108): `symulacja` (`{ a, b }`, obiekty wariantów), `warstwaLuk` (warstwa rankingu i mapy luk albo `null` = pierwsza z progiem), `branza`, `miejsca` (miejsca testowe A–E, zawsze 5 pozycji, `null` = puste), `filtryBiznesu`. Akcje: `ustawSymulacje`, `ustawWarstweLuk`, `ustawBranze` (miejsca zostają), `ustawPunktBiznesu('a'..'e', punkt | null)`, `dodajMiejsceBiznesu(punkt)`, `ustawFiltryBiznesu`.
- Akcje: `wybierzPersone`, `ustawTryb`, `ustawWage(id, 0–4)`, `ustawKierunek(id, k | null)`, `wybierzAdres(i | null)`, `pokazOkolice(i)`, `przejdz(ekran)`, `dodajDoPorownania`, `usunZPorownania`, `przelaczPorownanie`, `wyczyscPorownanie`, `ustawWarstwe`.
- Twarde filtry: pole `filtry` (`{ id, warunek: 'max' | 'min' | 'rowne-zero', prog }`, jeden na warstwę), akcje `ustawFiltr`, `usunFiltr`, `wyczyscFiltry`. W URL: `f=halas_ldwn:max:55,powodz_1proc:zero`.
- `hrefDla(stan, latka)` daje hash do `<a href>`. Stan weź z `useStan((s) => s)`.
- `idAdresu(i)` i `indeksAdresu(id)` tłumaczą indeks na id z `adresy.json` i z powrotem.

## Router – hash (`url.ts`)

| Hash | Ekran |
|---|---|
| `#/` | 1 Szukaj |
| `#/adres/<id adresu>` | 2 Okolica |
| `#/porownanie` | 3 Porównanie |
| `#/katalog`, `#/metoda` | katalog adresów, metoda i źródła |
| `#/miasto?w=<warstwa>&a=<obiekty>&b=<obiekty>` | tryb Miasto, dwa widoki (niżej): luki w usługach (`w` = warstwa rankingu i mapy luk, link do konkretnej luki, #92) i symulator inwestycji (`a`, `b` = obiekty wariantów A i B, #96–#98). Stary adres `#/symulator` dalej działa (ten sam ekran), a link zapisuje się już jako `#/miasto` |
| `#/biznes?b=<branża>&m=<lon,lat;lon,lat;…>&k=<filtry>` | tryb Biznes (E10): branża, miejsca A–E (`m`, puste pozycje między średnikami), filtry konkurencji (`k`). Stare linki z `a=` i `c=` (miejsca A i B) działają. Opis niżej |

Uszkodzony hash (np. `#/adres/%`) daje ekran Szukaj.
Parametry: `p` (persona), `t` (tryb), `cmp` (id adresów do porównania, po przecinku).
Stan i hash synchronizują się w obie strony. Zmiana ekranu albo adresu dodaje krok w historii przeglądarki.

### Tryb „Dla miasta”: luki w usługach i symulator – `karta/miasto`, `widokMiasta.ts` (#91, #92, #108)

Jeden adres `#/miasto`, dwa widoki pod paskiem „Luki w usługach” / „Symulator inwestycji” (`EkranMiasto`):

- **Luki w usługach** (`WidokLuk`): ranking okolic `PanelLuk` (#91) obok mapy luk `MapaLuk` (#90). Warstwę wybiera
  pasek nad mapą (panel go nie powtarza, `bezWyboruWarstwy`) i trafia do stanu (`warstwaLuk`) oraz linku (`w=`);
  klik w okolicę z rankingu przelatuje mapą do niej. Na telefonie pasek warstw to jeden przewijany rząd.
- **Symulator inwestycji** (`EkranSymulatora`, #96–#98): ładowany dopiero po wejściu w ten widok; worker obliczeń
  żyje tylko w nim (widok luk workera nie uruchamia).
- **Który widok otwiera link**: `widokPoczatkowy` – obiekty symulatora w linku (`a=`, `b=`) otwierają symulator,
  każdy inny link (gołe `#/miasto`, `#/miasto?w=…`) otwiera luki. Potem widok zmienia już tylko użytkownik
  (pasek stoi nad widokiem, więc przełączenie nie gubi fokusu klawiatury).
- `w=` jest poprawnym id warstwy (małe litery, cyfry, podkreślenia, do 64 znaków) albo odpada. Nieznane id panel
  zamienia na pierwszą warstwę z progiem luki, więc stary link nie kończy się pustym ekranem.

### Przełącznik trybów w nagłówku – `trybyAplikacji.ts` (#92, #108)

Obok kroków mieszkańca (Szukaj, Katalog, Porównanie, Metoda) nagłówek ma osobny przełącznik „Dla miasta”
(`#/miasto`) i „Dla biznesu” (`#/biznes`). `TRYBY_APLIKACJI` to tablica (ekran, napis), `trybEkranu(ekran)`
daje wybrany tryb albo `null` na ekranach mieszkańca. Akcent ma w nagłówku jeden element naraz: krok
na ekranach mieszkańca, tryb na #/miasto i #/biznes. Stan obu trybów (obiekty symulatora, warstwa luk, branża, miejsca
i filtry Biznesu) zostaje po przejściu na inny ekran i po powrocie, bo link bez ich parametrów niczego nie kasuje.

### Tryb biznes w stanie należy do ekranu Biznes – `czyDoMieszkanca` (#108)

Wejście na ekran Biznes ustawia w stanie tryb „biznes” (`stan.tryb`: wagi sklepu i ludności zamiast profilu
mieszkańca). Wcześniej tryb zostawał po wyjściu, a symulator Miasta liczy litery na `stan.wagi`, więc po wizycie
w Biznesie ten sam obiekt dawał inny bilans (przystanek pod Niepołomicami: 163 adresy z awansem przed wizytą w Biznesie,
zero po niej; pomiar w Chrome na danych produkcyjnych). Reguła to jedna funkcja,
`czyDoMieszkanca(poprzedniEkran, nastepny)` w `trybyAplikacji.ts`:

- **Miasto zawsze liczy na profilu mieszkańca.** Tryb biznes na tym ekranie, skąd by nie przyszedł (link z `t=biznes`,
  zapis sesji, kafel z ekranu Szukaj), zamienia się na mieszkańca.
- **Wyjście z ekranu Biznes** na każdy inny ekran też wraca do mieszkańca. Kafel „Miejsca do założenia biznesu” na
  ekranach mieszkańca (Szukaj, karta okolicy) zostaje, dopóki użytkownik z niego nie wyjdzie przez Biznes albo Miasto.
- **Kto wraca:** mieszkaniec zapamiętany przy wejściu w tryb biznes (tryb, persona, wagi, kierunki). Po F5 pamięć
  w zmiennych znika i służy sesja karty (zapis `mieszkanie`), a bez zapisu profil domyślny.
- Robi to jeden punkt, `zmien` (`zgodnyZTrybem` w `stan.ts`), więc reguła działa tak samo dla `przejdz`, kafla trybu,
  linku z nagłówka, Wstecz/Dalej i startu z linku. `hrefDla` składa te same linki: z Biznesu nagłówek prowadzi na adres
  z profilem mieszkańca (bez `t=biznes`), a link do Biznesu dalej niesie `t=biznes`. Start z `#/miasto?t=biznes`
  (stary link) też kończy na mieszkańcu.
- Ekran Biznes się nie zmienia: tryb biznes, branża, miejsca A–E i filtry z linku zostają, a po powrocie do Biznesu wracają.

Test: `miastoPoBiznesie.test.ts` (bilans Miasto → Biznes → Miasto równy bilansowi Miasta od razu, linki z `t=biznes`,
F5 z sesji). Każdy test bierze własną instancję `stan.ts` (`import('./stan.ts?x')`), bo stan jest jednym obiektem modułu.

### Link jest źródłem prawdy od pierwszej klatki – `stanZLinku.ts` (#108)

Adresy wczytują się 2–12 s. Wcześniej stan Biznesu dostawał branżę i miejsca z linku dopiero po tym czasie
(ekran startował od domyślnej branży, a zmiana użytkownika w tym oknie była cofana). Teraz:

- **Start** (`wczytajLinkStartowy`) i **zmiana hasha przed adresami** (`zastosujUrlPrzedDanymi`) od razu wpisują do
  stanu wszystko, co nie potrzebuje słownika adresów: branżę, miejsca A–E, filtry Biznesu, obiekty symulatora.
- `podlaczDane` (po adresach) bierze z linku tylko to, co potrzebuje słownika: id adresu i listę porównania.
  Nie czyta już branży, miejsc, filtrów ani symulatora, więc nie cofa zmiany z okna ładowania.
- Przed adresami `zapiszDoUrl` nie składa hasha od zera (zgubiłby `u=`, `cmp=`, `p=`), ale podmienia w bieżącym linku
  parametry ekranu (`PARAMETRY_EKRANU`: Biznes `b m a c k`, Miasto `a b w`), bez nowego wpisu w historii. Zmiana
  branży, miejsca albo filtra w pierwszych sekundach trafia więc do linku i przeżywa F5.
- Link bez parametrów Biznesu (np. `#/porownanie`) nie kasuje wyboru Biznesu; gołe `#/biznes` jest linkiem do Biznesu
  i przywraca domyślną branżę (`polaBiznesuZLinku`).

Filtry konkurencji Biznesu to parametr `k` (`biznesFiltryUrl.ts`), tokeny po przecinku: `2z` (≥ 2 źródła), `barber`
(„tylko” z flagą), `-fast_food` („bez” flagi), np. `k=2z,-fast_food`. Link niesie tylko filtry, które ekran pokazuje dla
branży linku (`filtryFlagBranzy`); token spoza definicji odpada, brak parametru = wszystkie filtry wyłączone.

## Tryb „Biznes” – `biznes.ts`, `biznesUslugi.ts`, `biznesBranze.ts`, `biznesOpis.ts` (E10, #105–#107)

Czyste funkcje. Wspólny worker obliczeń (`obliczenia.worker.ts`, sekcja niżej) trzyma indeks, ekran `src/karta/biznes/EkranBiznes.tsx`
(z `FiltryKonkurencji.tsx`) tylko wyświetla. Dane: popyt z `public/dane/biznes/popyt.json`, punkty
usług z katalogu `public/dane/uslugi` (#104 i #160: `katalog.json` i po jednym pliku na branżę, 26
branż). Testy: `biznes.test.ts` (dane syntetyczne i wyrocznia `biznesOdniesienie.ts` liczona „na brute
force”), `biznesUslugi.test.ts` i `biznesBranze.test.ts` (adapter, filtry, aliasy, grupy, zgodność
z prawdziwym katalogiem), `biznesWydajnosc.test.ts` (silnik na prawdziwych plikach: wyrocznia pełna
dla sklepu, paczkomatu i restauracji, rozkład bez punktów spoza popytu, filtry). Testy na plikach są
pomijane, gdy plików nie ma.

| Funkcja | Co robi |
|---|---|
| `przygotujKomorki(dane)` | Heksy popytu jako tablice i siatka wyszukiwania. Raz na worker, nie zależy od branży. |
| `zbudujIndeks(komorki, punkty, promien)` | Przydziały Huffa istniejących punktów, rozkład porównawczy, najbliższy punkt w heksie. Raz na branżę i na zestaw filtrów (4–27 ms). |
| `ocenMiejsceWIndeksie(indeks, miejsce)` | Ocena stawianego miejsca: liczy tylko heksy w jego promieniu (mediana 0,01–0,2 ms, najdłuższy zasięg 2000 m). Wynik jest taki sam jak po przeliczeniu całego miasta – pilnuje tego test na prawdziwych danych. |
| `bialePlamyZIndeksu(indeks)` | Per heks: adresy w zasięgu, punkty w zasięgu, najbliższy konkurent, skala 0–100. Adresy w zasięgu (`adresyWZasieguHeksow`) liczą się raz na heksy i promień: pierwsze liczenie zasięgu trwa 50–370 ms (500–2000 m), zmiana filtra albo branży o tym samym zasięgu 5–30 ms. |
| `ocenMiejsce`, `obliczBialePlamy` | To samo „od zera” (indeks budowany przy każdym wywołaniu): do testów i jednorazowych obliczeń. |
| `czynnikiOceny`, `PROGI_POZYCJI`, `PROGI_CZYNNIKOW` | 2–3 czynniki za i przeciw słowami; progi w jednym miejscu, z uzasadnieniem. |
| `rozbicieZasiegu` | Udziały na karcie: miejsce + konkurenci = adresy w zasięgu (liczby całkowite, procenty dają 100). |
| `punktyBranzy(plik, filtry)` (`biznesUslugi.ts`) | Adapter: plik branży (kolumny `lon`, `lat`, `zr`, `flagi`, `nazwa`) → `PunktUslugi[]` dla silnika, po filtrach. Punkt z samym bitem `ceidg` odpada zawsze. `wPliku` to podstawa „z N”. |
| `czytajKatalog`, `metaBranzy` (`biznesUslugi.ts`) | Kontrola katalogu po pobraniu i meta wczytanej branży (nazwa, zasięg, liczba punktów przed i po filtrach, filtry, dla których policzono wynik). |
| `rozwiazBranze`, `grupujBranze` (`biznesBranze.ts`) | Id z linku → id z katalogu (alias, nieznane = domyślna branża); lista branż w grupach (Zdrowie, Jedzenie i picie, Usługi, Handel, Auto). |
| `filtryFlagBranzy`, `konkurencjaWDopelniaczu`, `opisFiltrow` (`biznesBranze.ts`) | Filtry flagowe branży (etykieta, opis, konkurencja w dopełniaczu), zdanie o tym, z kim porównano, i zdanie o filtrach na karcie. |
| `zdaniePozycji`, `opisHeksuBiznesu`, `wpisyZrodel`, `wpisyZrodelBranzy` (`biznesOpis.ts`) | Zdanie główne karty, dymki heksów, atrybucja popytu i atrybucja punktów wybranej branży. |

Zasady:

- `percentyl` to pozycja wśród ISTNIEJĄCYCH punktów branży, które mają popyt w zasięgu; `null` =
  nie ma z czym porównać (miejsce bez adresów w zasięgu albo brak punktów odniesienia). Karta
  podaje go słowami („więcej klientów w zasięgu niż 7 na 10 istniejących aptek”), bez znaku %.
  Popyt obejmuje Kraków i 13 gmin obwarzanka (14 gmin, `etl/biznes-popyt.md`), a katalog usług leży
  w większym prostokącie z marginesem ok. 3 km. Punkty poza tymi 14 gminami (margines prostokąta
  i sąsiednie gminy) nie mają heksu popytu w zasięgu, więc nie wchodzą do rozkładu (test na wszystkich
  26 plikach), ale liczą się jako konkurenci miejsc, w których zasięgu leżą. To nie jest brak popytu
  w obwarzanku: każda z 13 gmin ma heksy popytu.
- Heks bez żadnego punktu w zasięgu to osobna kategoria: `adresyNaPunkt: null`, `bezPunktu(plama)`.
  Próg nasycenia skali liczy się tylko z heksów, które mają punkt (`progSkaliPlam`).
- Zasięg to `zasiegPieszyM` z katalogu (500–2000 m zależnie od branży), nie stała w kodzie.
- Filtry konkurencji (domyślnie wyłączone) działają PRZED silnikiem: adapter wycina punkty, a silnik
  liczy konkurentów, przydziały i percentyl tak, jakby wyciętych punktów nie było (test porównuje
  wynik z wyrocznią pełną na zawężonej liście). Są trzy rodzaje: „tylko punkty potwierdzone w co
  najmniej 2 źródłach” (liczba bitów `zr`, każda branża), flagi z plików branż (dentysta
  „tylko z umową NFZ”, restauracja „bez fast foodów”, fryzjer „tylko barber”). Flaga `nfz` znaczy
  „gabinet jest w Informatorze o Terminach Leczenia”, a brak flagi nie dowodzi braku umowy, więc opis
  filtra to mówi. Filtry żyją w stanie aplikacji i w linku jako parametr `k` (#108, patrz wyżej).
- Karta opisuje konkurencję z filtrów, dla których policzono wynik (`meta.filtry`), a nie z przełączników:
  po kliknięciu zmieniają się wcześniej niż liczby.
- Link: `#/biznes?b=<branża>&m=<lon,lat;lon,lat;…>&k=<filtry>` (do 5 miejsc A–E, stare `a=`/`c=` to A i B); `b` to id z katalogu usług (`sklep_spozywczy`,
  `poz`, `salon_kosmetyczny`...). Stare id (`sklep`, `przychodnia`, `kosmetyczka`, `mieso`, `zoologiczny`)
  działają przez `ALIASY_BRANZ` w `biznesBranze.ts`: `url.ts` czyta parametr bez zmian, a ekran
  zamienia id przy wyborze pliku. Id spoza katalogu pokazuje domyślną branżę z komunikatem.
  Dozwolony obszar punktu to `GRANICE_PUNKTU` w `url.ts` (formularz, przeciąganie i parser linku
  używają tej samej definicji).
- Atrybucja pod mapą bierze z `katalog.json` tylko źródła wybranej branży: OSM (ODbL, odnośnik do
  praw), Overture (CDLA), Rejestr Aptek albo RPWDL, NFZ (tylko dentysta); do tego źródła popytu.

### Nowa branża w katalogu usług

Branże dopisuje się w `etl/lib/uslugi-katalog.mjs` (mapowanie OSM, Overture, rejestr, zasięg pieszy,
flagi) i generuje `node etl/uslugi.mjs`; tryb Biznes widzi ją sam z `katalog.json`. Po stronie frontu
trzeba dopisać w `biznesBranze.ts` grupę listy (`GRUPY_BRANZ`), nazwę w dopełniaczu mnogim
(`BRANZE_W_DOPELNIACZU`) i, gdy branża ma flagi, filtr (`FILTRY_FLAG`). Bez tego branża trafia do
grupy „Inne” i dostaje zdanie „punktów tej branży”, a testy na prawdziwym katalogu (`biznesBranze.test.ts`)
nie przejdą. Usunięty został stary eksport `public/dane/biznes/<branza>.json` (7 branż, sam OSM);
`etl/biznes-poi.py` zostaje w repo bez zmian i zapisywałby tam z powrotem, ale front go nie czyta.

## Wspólny worker obliczeń – `obliczenia*.ts`, `menedzerObliczen.ts` (#96, #108)

Tryb Miasto (symulator) i tryb Biznes liczą w JEDNYM workerze. Każda wiadomość niesie pole `tryb`
(`'miasto'` albo `'biznes'`), router przekazuje ją do obsługi trybu, odpowiedź wraca z tym samym polem.

| Plik | Rola |
|---|---|
| `obliczenia.worker.ts` | Jedyny skrypt workera: `fetch` i `postMessage`, reszta w routerze. |
| `obliczenia.ts` | Protokół (`DoWorkera`, `ZWorkera`, `WiadomoscTrybu`) i router `utworzRouter`. Czysty, test na Node (`obliczenia.test.ts`). |
| `obliczeniaMiasto.ts` | Tryb Miasto: `baza` → `licz` / `sugeruj` na `symulacja.ts`. |
| `obliczeniaBiznes.ts` | Tryb Biznes: `start` / `init` / `ocen` na `biznes.ts`, popyt i pliki branż pobiera sam z katalogu danych z wiadomości (`baza`, patrz „Dane poboczne per miasto”). |
| `menedzerObliczen.ts` | Wątek główny: `menedzerObliczen.otworz(tryb)` daje uchwyt (`wyslij`, `nasluchuj`, `naBledzie`, `zwolnij`). Test: `menedzerObliczen.test.ts`. |

Ekran bierze uchwyt na czas życia (`useSymulacja` w Mieście, `EkranBiznes` w Biznesie) i oddaje go przy wyjściu.

Zasady menedżera:

- **Jedna instancja** na oba tryby, tworzona przy pierwszym uchwycie. Nigdy dwie naraz (test: obroty Miasto ↔ Biznes).
- **Nieużywany jest zwalniany.** Zwolnienie uchwytu jednego trybu, gdy worker żyje dla drugiego, wysyła `zwolnij`
  (tryb oddaje swój stan, a `init` czekający na pobranie zostaje unieważniony). Zwolnienie ostatniego uchwytu zamyka
  worker (`terminate`), więc po wyjściu z obu trybów nie zostaje po nim ani wątek, ani baza w pamięci.
- **Błąd nie przechodzi między trybami.** Wyjątek w obsłudze trybu wraca jako `blad` z `tryb`, a nie zdarzenie `error`,
  które zabiłoby worker obu trybów. Worker, który się nie załadował (albo padł poza obsługą), jest zamykany;
  Miasto liczy wtedy synchronicznie (ta sama funkcja, ten sam wynik), Biznes pokazuje komunikat. Następny ekran
  po zwolnieniu wszystkiego próbuje od nowa.

Dlaczego jeden worker, ale z osobnymi stanami i zwalnianiem (decyzja #108, komentarz w `obliczenia.ts`):

- Jedna instancja to jeden wątek, jedna sterta i jeden plik do pobrania (offline też: service worker cache'uje go
  razem z aplikacją). Skrypt ma 18 kB, więc wspólny kod nie obciąża żadnego trybu.
- Tryby mają jednak **różne dane i różny cykl życia**: Miasto dostaje od wątku głównego bazę (kopia danych 176 tys.
  adresów, po zmianie wag), Biznes sam pobiera popyt i pliki branż. Połączenie „na zawsze” trzymałoby bazę Miasta
  po wyjściu na Szukaj, a oddzielne stałe workery dwa razy tyle. Dlatego stany są rozłączne i zwalniane osobno.
- Cena zwalniania: powrót do Miasta wysyła bazę do nowego workera. Pomiar (Chrome 154, dane produkcyjne):
  `postMessage(baza)` to 50–100 ms w wątku głównym, a samo przeliczenie jednego obiektu 8–95 ms w workerze.
  Dziś ta cena nie jest nowa: stary układ (stały worker Miasta) też wysyłał bazę przy każdym powrocie, bo każda
  zmiana hasha (`zastosujZmianeUrl`) składa nowe wagi, więc `bazaDla` buduje nową bazę. Czas od kliknięcia
  „Dla miasta” na Szukaj do wyniku: mediana ok. 0,9 s w obu układach (6 powrotów każdy), bo wyznacza go
  montaż mapy, a nie worker.
- W trybie dev (React StrictMode) efekty montują się dwa razy, więc worker powstaje, jest zamykany i powstaje
  ponownie; na buildzie produkcyjnym konstruktor woła się raz na wejście w tryb.

Nowy tryb w tym samym workerze: obsługa `utworzObsluge<Tryb>` (stan + `obsluz` + `zwolnij`) w osobnym pliku,
wpis w `TrybObliczen`, w unii wiadomości i w `utworzRouter`.

## Dane poboczne per miasto – `sciezkiDanych.ts`, `pamiecPlikow.ts` (#223)

Pliki pobierane na żądanie (graf dojazdu, katalog i pliki branż, popyt Biznesu, szczegóły szkół, kafle budynków
3D) leżą w katalogu danych miasta: `public/dane` dla Krakowa, `public/dane/miasta/<slug>` dla reszty. Katalog
bieżącego miasta to `bazaBiezaca()` (`miastoDanych.ts`, poza Reactem) albo `bazaDanych(useMiasto().slug)`
(komponent, odświeża się przy zmianie miasta).

| Plik | Rola |
|---|---|
| `sciezkiDanych.ts` | Układ plików od katalogu danych: `sciezkaGrafu`, `sciezkaKataloguUslug`, `sciezkaBranzy`, `sciezkaPopytu`, `sciezkaSzkol`, `sciezkaKafla`; `czyKatalogDanych` i `czySciezkaGrafu` sprawdzają katalog z wiadomości do workera; `popytDostepny(baza)` mówi, czy zbiór ma popyt Biznesu. Czysty, test `sciezkiDanych.test.ts` porównuje to z plikami w `public/dane`. |
| `pamiecPlikow.ts` | `utworzPamiecPlikow<T>(maks)`: jedno wczytanie na PEŁNĄ ścieżkę pliku, najdawniej użyta odpada, błąd pobrania nie zostaje w pamięci. Używają jej: worker dojazdu (graf, najwyżej `MAKS_MIAST_W_PAMIECI` miasta), `SzczegolySzkoly`, `obliczeniaBiznes.ts`. |

- **Worker nie zna bieżącego miasta.** Ma własną kopię modułów stanu, więc `bazaBiezaca()` zwróci w nim zawsze
  Kraków. Ścieżkę przysyła wątek główny: Dojazd – pole `graf` w wiadomości `licz` (`sciezkaGrafu(bazaBiezaca())`
  w `PanelDojazdu`), Biznes – pole `baza` w `start` i `init`. Worker sprawdza ją, zanim trafi do `fetch`.
- **Pamięć kluczuje pełna ścieżka**, bo pliki każdego miasta mają te same nazwy (`dojazd/graf.json`,
  `szkoly_e8_szczegoly.json`): klucz z samą nazwą oddałby po zmianie miasta plik poprzedniego.
- **Funkcje tylko krakowskie (D8)**: wyszukiwarka okolic (`okolice.json`, granice SIM), tryb Biznes (popyt), plan
  miejscowy i pozwolenia na budowę. W innym mieście bramka `tylkoKrakow()` (`useTylkoKrakow()` w komponencie)
  pokazuje „Na razie tylko w Krakowie” zamiast pustych albo zerowych wartości i niczego nie pobiera. Tryb Biznes:
  `EkranBiznes` pokazuje komunikat z przyciskiem „Pokaż Kraków”, a worker odpowiada `blad` (`BLAD_BEZ_POPYTU`)
  na `init` z katalogiem miasta. Test `sciezkiDanych.test.ts` sprawdza, że żadne miasto nie ma tych plików – gdy
  ETL któreś doda, test jest czerwony i trzeba zdjąć bramkę tej funkcji.

## Sloty i kto je wypełnia

| Slot | Plik | Zadanie | Stan |
|---|---|---|---|
| Panel filtrów | `src/karta/panel/PanelFiltrow.tsx` | #36 | stub: tryb i persony działają, wagi do zrobienia |
| Wyszukiwarka | `src/karta/wyszukiwarka/Wyszukiwarka.tsx` | #11 | podpięta w `EkranSzukaj` |
| Mapa | `src/mapa/MapaKrakowa.tsx` | #13 | podpięta w `EkranSzukaj` |
| Karta okolicy | `src/karta/okolica/EkranOkolica.tsx` | #12 | stub z wynikiem i kategoriami |
| Porównanie | `src/karta/porownanie/EkranPorownanie.tsx` | #48 | stub z listą |

Podpięcie w `src/karta/EkranSzukaj.tsx` (miejsca oznaczone `TODO #11` i `TODO #13`):

```tsx
const wyniki = useWyniki()
const wybrany = useStan((s) => s.wybrany)
const a = dane.stan === 'gotowe' && wybrany !== null ? dane.adresy[wybrany] : null

<Wyszukiwarka adresy={dane.adresy} onWybierz={pokazOkolice} />
<MapaKrakowa
  heksy={wyniki?.heksy ?? new Map()}
  podpisWarstwy={wyniki?.podpis ?? ''}
  wybrany={a ? { lon: a.lon, lat: a.lat } : null}
  onKlik={(lon, lat) => wybierzAdres(najblizszyAdres(dane.adresy, lon, lat))}
/>
```

## Wygląd

Tokeny CSS są w `src/styles.css` (`--akcent`, `--tekst-2`, `--ramka`, `--ostrzezenie-tlo` i inne).
Klasy wspólne: `.seg` z `aria-pressed`, `.przycisk-glowny`, `.etykieta-sekcji`, `.karta`, `.atrapa`.
Przy każdej warstwie z `meta.atrapa` pokaż etykietę „dane przykładowe”.

## Luki w usługach – `luki.ts` (tryb „Dla miasta”, #89)

Czyste funkcje. Luka nie zależy od wag, persony ani kierunku – liczy się z surowego pomiaru i progu.

- `PROGI_LUK` – jedyne miejsce progów, każdy ze źródłem: sklep > 800 m, przystanek > 500 m,
  punkt schronienia > 1 km, hałas > 64 dB LDWN (albo `meta.norma`, gdy warstwa ją ma).
- `progLuki(meta)` daje próg albo `null` (atrapa, warstwa bez progu). Wybór warstwy w #90 pokazuje tylko te z progiem.
- `okolicaAdresu(adres, i?, okolice?)` – okolica adresu (#185). Z plikiem `okolice.json` (`useDane().okolice`)
  i indeksem `i` adresu to jednostka SIM w Krakowie (`sim-803`) albo miejscowość poza nim (`m-<teryt>-<slug>`),
  z pliku: `okolice[idOkolic[kolumny.okolica[i]]]`. `null` w kolumnie daje szarą okolicę `brak`, nie zero.
  Bez pliku (nie wczytał się albo jest z innej wersji adresów) zapas: dzielnica Krakowa, poza Krakowem cała gmina
  (`dzielnica:<nazwa>`, `gmina:<nazwa>`). Typ okolicy: `sim`, `miejscowosc`, `dzielnica`, `gmina`, `brak`.
- `policzLuki(wskaznik, adresy, grupy?, okolice?)` daje `{ prog, razem, okolice[], heksy: Map<h3, …>, jednostka: 'adresy' }`
  albo `null` dla atrapy. Każda jednostka: `wszystkie = wLuce + bezLuki + brakDanych`,
  `udzial = wLuce / wszystkie`; `udzial: null`, gdy jednostka nie ma żadnego adresu z danymi (szara).
  Suma `okolice[].wszystkie` = `razem.wszystkie` także z okolicami z pliku (adres bez okolicy liczy się w `brak`).
- Podpis „adresy”, nie „mieszkańcy”, dopóki nie wejdzie #74 albo #40.

## Ranking luk – `rankingLuk.ts` (panel „Gdzie miasto ma luki”, #91)

Czyste funkcje dla `src/karta/luki/PanelLuk.tsx`. Dane z `policzLuki`, tu tylko kolejność i teksty.

- `rankingLuk(wynik, 'liczba' | 'udzial')` daje `{ naglowek, kierunek, wiersze[] }`. Suma `wiersze[].wLuce`
  = `naglowek.wLuce` (`sumaWLuce`, pilnuje test). Jednostki szare (`udzial: null`) zawsze na końcu.
- `kierunek` – kierunek słowami („Od góry: najwięcej adresów bez przystanku w 500 m”) zamiast numerów miejsc.
- `pasekLuki(okolica)` – szerokości w % adresów jednostki (w luce + szary brak danych), nie % największej pozycji.
- Okolice mają różną skalę (jednostka SIM z 10 adresami, miejscowość z 1000), więc wiersz niesie `opis`
  pod nazwą (`opisOkolicy`): rodzaj i liczba adresów, np. „jednostka SIM VIII.3, dzielnica VIII Dębniki · 1 234 adresy”
  albo „miejscowość, gmina Wieliczka · 589 adresów”. Jednostek SIM i miejscowości nie mieszamy bez podpisu.
  Ten sam opis ma tabela bilansu w symulatorze (`BilansOkolicy.liczbaAdresow`).
- `procentUdzialu` nie zaokrągla do kłamstwa: „<1%” zamiast „0%”, „>99%” zamiast „100%”.
- `rozdzielczoscWarstwy(meta)`, `zrodlaWarstwy(meta)` – podpis pod rankingiem.
- Pod rankingiem stoi zdanie o źródle okolic (`opisZrodelOkolic`), a bez pliku okolic panel ostrzega, że okolicą
  jest dzielnica albo gmina.

## Okolica adresu na karcie i w porównaniu – `miejsceAdresu.ts` (#185)

Czyste funkcje dla `src/karta/okolica/EkranOkolica.tsx` i tabeli w `src/karta/porownanie/EkranPorownanie.tsx`.
Okolica adresu to jednostka SIM (Kraków) albo miejscowość (poza Krakowem) z `okolice.json`, z zapasem na dzielnicę
i gminę (`useDane().okolice`; `null` = plik się nie wczytał albo jest z innej wersji adresów).

| Funkcja | Co robi |
|---|---|
| `miejsceAdresu(adres, i, okolice)` | Daje `MiejsceAdresu`: `rodzaj` (`sim`, `miejscowosc`, `zapas`), `id` jak w rankingach luk, `nazwa`, `podpis` („jednostka SIM I.2, dzielnica I Stare Miasto”), `opis` (podpis i liczba adresów), `potoczne`, `uwagi`. |
| `miejsceOkolicy(okolice, id)` | To samo co `miejsceAdresu`, ale dla okolicy o danym id, bez adresu (wyszukiwarka, #185). `null`, gdy pliku nie ma albo id jest nieznane (id zapasu „dzielnica:…” też). `miejsceAdresu` korzysta z niej, więc karta, porównanie i wyszukiwarka mówią to samo. |
| `zdaniePotocznych(potoczne, limit?)` | „W tej jednostce leżą też osiedla i części miasta z OpenStreetMap: …”; do `MAKS_POTOCZNYCH` (6) nazw, reszta liczbą („i jeszcze 12 nazw”). Brak nazw = `null`. |
| `zrodlaOkolic(plik)`, `krotkaNazwaZrodla(nazwa)` | Źródła z pliku z krótką nazwą, datą i znacznikiem OSM (atrybucja ODbL, `URL_PRAW_OSM`). |
| `opisZrodelOkolic(plik)` | Zdanie pod rankingiem luk: źródła okolic bez OSM (ranking nie pokazuje nazw potocznych). |

Zasady:

- Zapas dostaje adres bez pliku okolic, z `null` w kolumnie i poza kolumną: „Dzielnica I Stare Miasto” albo „Gmina Liszki”,
  bez podpisu i bez liczby adresów. Brak okolicy nie jest zerem ani pustym polem.
- Nazwy potoczne to punkty OSM leżące w jednostce, nie granice osiedli (`etl/okolice.md`). Karta mówi, co leży w jednostce,
  i nie twierdzi, że adres leży w konkretnym osiedlu.
- `uwagi` to `rozjazdy[].opis` o tej jednostce: nazwa jak dzielnica, nazwa z innej dzielnicy, nazwa OSM leżąca w innej
  jednostce. Rozjazdy o wyszukiwaniu i o braku miejsc OSM nie mówią nic o adresie, więc na kartę nie idą. Jednostka ma ich
  najwyżej dwie (pilnuje test na prawdziwym pliku).
- Test `miejsceAdresu.test.ts` jedzie też na `public/dane` (każdy z 176 684 adresów ma okolicę z pliku; podpis niesie
  dzielnicę adresu; liczba adresów zgadza się z kolumną) i jest pomijany, gdy plików nie ma.

## Szukanie okolic na ekranie Szukaj – `karta/wyszukiwarka`, `mapa/okolica` (#185)

Pole „Nazwa okolicy” na Szukaj podpowiada okolicę po nazwie („Ruczaj”, „Rakowice”, „kurdwanow”, „na Ruczaju”), wybór leci
na mapie do granic jednostki SIM i rysuje jej obrys, a pod polem stoi pasek z nazwą, rodzajem i liczbą adresów. Logika jest
czysta (bez DOM), testy jadą na gołym `node --test`, część na prawdziwych plikach z `public/dane`:

```
node --test 'src/karta/**/*.test.ts' 'src/mapa/**/*.test.ts'
```

| Moduł | Co robi |
|---|---|
| `wyszukiwarka/szukajOkolic.ts` | `szukajOkolic(indeksOkolicDla(plik), zapytanie, limit?)` daje `WynikOkolicy[]` (`id`, `rodzaj`, `nazwa`, `tytul`, `nazwaOsm`, `opis`). Szuka po nazwie jednostki SIM, miejscowości i nazwach OSM z jednostek (`potoczne`). `spojnyOpis` wiąże separator i liczbę adresów twardą spacją, żeby wiersz nie zaczynał się od kropki. |
| `wyszukiwarka/podpowiedzi.ts` | `podpowiedzi(zapytanie, { adresy, okolice }, limit?)`: adresy i okolice w jednej liście. Źródło `null` = pole go nie szuka i nie buduje jego indeksu. |
| `wyszukiwarka/indeks.ts` | `maNumerDomu(zapytanie)` (wpis z numerem to adres), `jedenBlad` użyty też do literówek w nazwach okolic. |
| `wyszukiwarka/Wyszukiwarka.tsx` | Combobox: `adresy` + `onWybierz` szukają adresów (Porównanie, bez zmian), `okolice` + `onWybierzOkolice` okolic; oba naraz też działają. Ekran Szukaj podaje same okolice. |
| `mapa/okolica/granice.ts` | `okolicaNaMapie(id, granice, adresy, okolice)` daje `OkolicaNaMapie`: ramka do przelotu i obrys jednostki z `okolice-granice.geojson`. Miejscowość i jednostka bez wpisu w pliku granic dostają ramkę adresów okolicy (`graniceOkolicy` z mapy luk) i nie mają obrysu. |
| `mapa/okolica/wczytajGranice.ts` | Plik granic (1,1 MB) ładuje się przy pierwszym fokusie w polu albo wyborze, raz na aplikację; po błędzie następny wybór próbuje od nowa. |
| `mapa/okolica/ObrysOkolicy.ts` | Hak wołany z `MapaKrakowa` (prop `okolica`): ciemny obrys z białą poświatą i przelot kamery. Nowy obiekt `okolica` = nowy przelot, także dla tej samej okolicy (prop `granice` reaguje tylko na zmianę liczb). |
| `karta/okolicaWybrana.ts`, `karta/PasekOkolicy.tsx` | Pasek pod polem: teksty o nazwie z OSM i o braku obrysu są czystymi funkcjami z testem. |
| `rankingUlic(…, okolice, ile)` | Ranking ulic na Szukaj: `okolica` ulicy zamiast dzielnicy (patrz niżej). |

Zasady:

- **Szukaj nie szuka adresów.** Decyzja właściciela z 2026-10-03 (commit 80c7aad, #56): na Szukaj oglądamy mapę, kartę otwiera
  klik w mapę albo ranking. Pole szuka więc okolic, a wpis wyglądający na adres („Grodzka 52”) dostaje wskazówkę zamiast
  pustej listy. Włączenie adresów to `adresy` + `onWybierz` w `EkranSzukaj`; wpis z numerem domu zostaje wtedy adresem
  i wyprzedza okolice.
- Nazwa z OSM („Salwator”) to punkt leżący w jednostce, nie granice osiedla (`etl/okolice.md`). Podpowiedź mówi „nazwa z
  OpenStreetMap · Zwierzyniec (jednostka SIM …)”, wybór pokazuje całą jednostkę, a pasek mówi o tym wprost i podaje
  atrybucję ODbL. Jedna okolica to jedna podpowiedź; przy remisie wygrywa nazwa okolicy (nie OSM).
- Dopasowanie słowa: pełne, początek (pisanie w toku), odmiana z końcówkami o łącznej długości do 2 liter („Ruczaju”,
  „Krowodrzy”) albo jedna literówka od 5 liter. Odmiana jest ciasna celowo: „Mogilska” (ulica) to nie „Mogiła”, „Podgórze”
  to nie „Podgórki”. „osiedle”, „dzielnica”, „na” wypadają z zapytania i z nazw; wieś „Ulica” znajduje się po nazwie.
- Okolica z wyszukiwarki żyje w stanie ekranu (`useState` w `EkranSzukaj`), nie w linku: `url.ts` i `stan.ts` jej nie znają.
  Powrót z karty do mapy czyści wybór.
- Telefon: lista podpowiedzi leży nad przyklejoną mapą (`z-index` bloku pola), a po wyborze mapa przewija się tak, żeby była
  cała widoczna (`scrollIntoView({ block: 'nearest' })`, bez animacji przy ograniczonym ruchu).
- Ranking ulic: `okolicaUlicy` liczy okolice z adresów, które weszły do oceny ulicy (bez wykluczonych i bez wyniku). Ulica w
  jednej jednostce dostaje jej nazwę, w kilku: dwie największe i „i jeszcze N okolic” (przy trzech wszystkie nazwy). Miejscowość
  poza Krakowem, nazwana tak samo jak przy ulicy, nic nie dopisuje. Bez pliku okolic zapas z `miejsceAdresu`: „Dzielnica …”
  albo „Gmina …”. Kolejność i liczby rankingu nie zależą od okolic (pilnuje test), czas ten sam (ok. 155 ms na 176 684 adresach).
- Pasek wybranego adresu na Szukaj: „Okolica: Kazimierz, jednostka SIM I.8, dzielnica I Stare Miasto”, w zapasie sama dzielnica
  albo gmina. Pod rankingiem ulic stoi zdanie o źródle okolic (`opisZrodelOkolic`).
- Nie dodajemy średniej oceny okolicy: ranking i mapa pokazują ulice i heksy, a jedna liczba dla całej jednostki czytałaby się
  jak tablica wstydu (docs/burza-decyzje.md, sekcja o etyce score).
