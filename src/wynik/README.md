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
| `literaZWyniku(wynik)` | Daje literę A–G z `PROGI_LITER` (A ≥ 85, B ≥ 70, C ≥ 55, D ≥ 40, E ≥ 25, F ≥ 10). |

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

- `PERSONY`: `rodzina`, `singiel`, `senior`, `inwestor`, `od-zera`. Każda ma `wagi`, opcjonalne `kierunki` i `wagaNowych`.
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

Uszkodzony hash (np. `#/adres/%`) daje ekran Szukaj.
Parametry: `p` (persona), `t` (tryb), `cmp` (id adresów do porównania, po przecinku).
Stan i hash synchronizują się w obie strony. Zmiana ekranu albo adresu dodaje krok w historii przeglądarki.

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
- `okolicaAdresu(adres)` – dzielnica Krakowa, poza Krakowem cała gmina. Jednostki SIM przyjdą z #75.
- `policzLuki(wskaznik, adresy, grupy?)` daje `{ prog, razem, okolice[], heksy: Map<h3, …>, jednostka: 'adresy' }`
  albo `null` dla atrapy. Każda jednostka: `wszystkie = wLuce + bezLuki + brakDanych`,
  `udzial = wLuce / wszystkie`; `udzial: null`, gdy jednostka nie ma żadnego adresu z danymi (szara).
- Podpis „adresy”, nie „mieszkańcy”, dopóki nie wejdzie #74 albo #40.

## Ranking luk – `rankingLuk.ts` (panel „Gdzie miasto ma luki”, #91)

Czyste funkcje dla `src/karta/luki/PanelLuk.tsx`. Dane z `policzLuki`, tu tylko kolejność i teksty.

- `rankingLuk(wynik, 'liczba' | 'udzial')` daje `{ naglowek, kierunek, wiersze[] }`. Suma `wiersze[].wLuce`
  = `naglowek.wLuce` (`sumaWLuce`, pilnuje test). Jednostki szare (`udzial: null`) zawsze na końcu.
- `kierunek` – kierunek słowami („Od góry: najwięcej adresów bez przystanku w 500 m”) zamiast numerów miejsc.
- `pasekLuki(okolica)` – szerokości w % adresów jednostki (w luce + szary brak danych), nie % największej pozycji.
- `procentUdzialu` nie zaokrągla do kłamstwa: „<1%” zamiast „0%”, „>99%” zamiast „100%”.
- `rozdzielczoscWarstwy(meta)`, `zrodlaWarstwy(meta)` – podpis pod rankingiem.
