# Kontrakt Etapu B – start Szukaj bez pełnych danych (#247)

Cel: ekran Szukaj nie pobiera `adresy.json` ani `wskazniki/*.json`. Mapa, filtry, ranking
i karta wybranego adresu liczą się z kompaktu (heksy) i kafli (adresy na żądanie). Pełne
dane (`useDane()`) zostają dla ekranów, które naprawdę potrzebują wszystkich adresów
(Symulator, Luki) i jako zapas, gdy kompakt nie ma `rozszerzenia` (stary format).

## Dane wejściowe (gotowe)

- `przegladMenedzer` trzyma dla bieżącego miasta `WpisGotowy`: `indeks`, `manifest`,
  `podstawa` (`PodstawaHeksow`: poziomy r10/r9/r8, `liczba`, `od`, `ulica`, `dzielnica`
  na heks r10), `warstwy` (id → `WarstwaHeksow`).
- `src/wynik/heksy.ts`: `liczoneWarstwy`, `wynikiHeksow`, `wykluczeniaHeksow`,
  `najlepszeHeksy`, `heksAdresu`, `wykluczenieAdresu` – czyste, przetestowane, nieużywane.
- Kompakt: `filtry/<id>.<hash>.bin` (`FiltrHeksow`), `skale.<hash>.json`, `szukaj.<hash>.bin`,
  `id.<hash>.bin`, `kafle/<h3>.<hash>.json.gz` z kolumną `i` (pozycja w adresy.json),
  `indeks.kafle[] = { h3, res (7|8), od, n, plik }`, `okolice.<hash>.json` (Kraków),
  `indeks.rozszerzenia = ['i', 'r8', 'okolice']`.

## Moduły (nowe pliki, każdy z testem na `node --test`)

| Plik | Eksport | Właściciel paczki |
|---|---|---|
| `src/wynik/kompaktBiezacy.ts` | `useDaneHeksow(): StanDanychHeksow` – `{ stan: 'ladowanie' } \| { stan: 'gotowe', miasto, manifest, indeks, podstawa, warstwy, filtr(id): FiltrHeksow \| null, skala(id): Skala \| null } \| { stan: 'brak', powod }`; filtry i skale dociągane leniwie (dopiero gdy filtr jest aktywny), z cache | B2 |
| `src/wynik/useWynikiMapy.ts` | `useWynikiMapy(): WynikiMapy \| null` – `{ heksy: ReadonlyMap<h3, number \| null>, wykluczoneHeksy: ReadonlySet<h3>, liczbaWykluczonych, liczbaNiewiadomych, liczbaAdresow, podpis, brakWarstwy }` na r10 bieżącego miasta, te same wagi/kierunki/warstwa/filtry co `useWyniki` | B4 |
| `src/wynik/kafle.ts` | `wczytajKafel(slug, wpisKafla): Promise<KafelGotowy>` (LRU 40, deduplikacja żądań), `kafelPunktu(indeks, lon, lat)`, `kafelAdresu(indeks, i)`, `useKafel(...)`, `useAdresKompakt(i): AdresKompakt \| null`; `KafelGotowy` daje adresy (`Adres` jak w kontraktach) i `WskaznikPrzygotowany[]` tylko dla adresów kafla (wartości z kafla, skale z `skale.json`), więc `wynikAdresu` z `silnik.ts` liczy kartę identycznie jak z pełnych danych | B3 |
| `src/wynik/rankingKompakt.ts` | `rankingKompakt(...)`: przybliżenie z heksów (średnia wyników heksów r10 ważona liczbą adresów, grupowanie po `podstawa.ulica`, pomija heksy wykluczone) → top 25 ulic → kafle tych heksów → dokładny `rankingUlic` na adresach z kafli; limit pobrania ~1,5 MB | B5 |
| `src/wynik/stan.ts` | `podlaczDane` rozbite na `podlaczMeta(manifest)` (profile, wagi, kierunki) i `podlaczSlownik(resolver)` (id z linku → indeks przez `id.bin`, tylko gdy link je niesie) | B6 |

Indeks adresu w stanie (`wybrany`, `porownanie`) zostaje pozycją w `adresy.json` (kolumna `i`).

## Zasady

- Brak danych = NaN / `BRAK` (255) / `null` – nigdy 0.
- Każda wartość pokazana użytkownikowi ma tę samą liczbę co ścieżka pełnych danych tam, gdzie
  istnieje odpowiednik adresowy (karta, ranking top 5). Mapa jest na heksach, więc średnia heksu
  może się różnić od średniej po adresach – to dopuszczalne (tak liczy już przegląd innych miast).
- Bez `indeks.rozszerzenia` (stary kompakt) moduły zwracają `brak`, a ekran wraca do `useDane()`.
- Przepięcie ekranów (B7) robi osobna paczka po scaleniu startu na kadrze miasta (#250).
