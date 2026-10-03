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
- Kierunek użytkownika: `mniej-lepiej` (↓), `wiecej-lepiej` (↑), `optimum` (≈, najlepszy środek przedziału).

`WynikAdresu`:

- `wynik` 0–100 albo `null`, `litera` A–G albo `null`.
- `pewnosc` 0–1: udział wagi warstw z danymi w wadze wszystkich liczonych warstw. To jest pasek pewności.
  Warstwa, której plik się nie wczytał, liczy się do mianownika jako brak danych, więc obniża pewność, nie wynik.
- `warstwy[]`: `ocena`, `waga` (po normalizacji, suma = 1), `wagaUzytkownika` (0–4), `wklad` (suma = `wynik`),
  `wartosc` (surowy pomiar), `etykieta`, `meta` (źródła, `dataDanych`, `rozdzielczosc`, `rozmiar`, `atrapa`),
  `niedostepny` (powód, gdy plik warstwy się nie wczytał; pokaż „warstwa niedostępna", nie „brak danych pod adresem").
- `kategorie[]`: `ocena` (`null` = szara kategoria), `waga`, `wklad`, `pewnosc`, `warstwy`.

Kolory: `PALETA_WYNIKU` (5 stopni z makiety, od słabo do idealnie) i `KOLOR_BRAKU` (szary).

## Persony – `persony.ts` (dane)

- `PERSONY`: `rodzina`, `singiel`, `senior`, `inwestor`, `od-zera`. Każda ma `wagi`, opcjonalne `kierunki` i `wagaNowych`.
- `TRYBY`: `kupuje`, `wynajmuje`, `biznes`. Kupno i najem używają person oraz modyfikatorów
  kategorii; biznes pokazuje odległość od sklepu i ludność NSP 2021. Atrapa sklepu dostaje wagę 0
  i nie jest pokazywana jako rzeczywista konkurencja.
- `ustawieniaPersony(persona, tryb, metaWskaznikow)` daje `{ wagi, kierunki }` dla żywych warstw.
  Nieznane id persona pomija. Nowa warstwa z manifestu dostaje `wagaNowych`.

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
