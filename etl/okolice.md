# Okolice – jednostki SIM z MSIP (#75)

Okolica adresu w Krakowie to **jednostka SIM** (System Informacji Miejskiej): 123 jednostki
podstawowego podziału miasta, który sumuje się do granic dzielnic. Podział przygotował Zarząd
Transportu Publicznego w Krakowie, a nazwy dobrano m.in. na podstawie badania mieszkańców. Poza
Krakowem nie ma jednostek SIM, więc okolicą jest miejscowość w gminie. Potoczne nazwy osiedli (OSM)
są słownikiem na poziomie jednostki, a miejsca, w których oba światy się rozjeżdżają, są wypisane
jawnie w polu `rozjazdy`.

Wyniki: `public/dane/okolice.json` (id okolicy dla każdego adresu, słownik, rozjazdy) i
`public/dane/okolice-granice.geojson` (granice jednostek dla mapy i rankingu). To nie jest
wskaźnik: nie wchodzi do manifestu ani do kompaktu. Skrypt: `etl/okolice.mjs`, testy:
`etl/okolice.test.mjs`.

## Źródła

| Co | Skąd | Stan danych | Licencja |
|---|---|---|---|
| Granice 123 jednostek SIM | MSIP, warstwa `Obserwatorium/ZTP_SIM/MapServer/0` (wydawca: ZTP Kraków; [zbiór w Otwartych Danych](https://otwartedane.um.krakow.pl/zbiory-danych/system-informacji-miejskiej-w-krakowie-sim)) | import warstwy 2026-09-26 (pole `data_importu`), pobrane 2026-10-03 | ponowne wykorzystanie informacji sektora publicznego, [warunki portalu](https://otwartedane.um.krakow.pl/warunki-wykorzystania-danych-udostepnianych-w-portalu); regulamin MSIP: jednorazowe pobranie, bez ciągłego pośredniczenia |
| Kopia kontrolna jednostek | MSIP, `ZSOZ/Rc_Sim/MapServer/0` (daje `id_sim`) | import 2024-07-18 | jak wyżej |
| Potoczne nazwy osiedli i części miasta | OpenStreetMap przez Overpass: `place=neighbourhood`, `place=quarter` z nazwą (node, way, relation) | baza OSM z 2026-10-03T21:58:48Z | ODbL 1.0, © współtwórcy OpenStreetMap |
| Adres → gmina, miejscowość, dzielnica | `public/dane/adresy.json` (MSIP/EMUiA, PRG) | wg `zrodla` w tym pliku | jak w `adresy.json` |

Granice pobieramy z MSIP **jednorazowo** i zapisujemy jako plik statyczny w repo (regulamin MSIP
zabrania ciągłego pośredniczenia w usługach miasta). Plik w repo pozwala też przeliczyć okolice
offline, gdy zmieni się lista adresów. Migawka OSM leży w `etl/okolice-osm.json` z tego samego
powodu. Nie użyliśmy „Obszarów SIM” (105): to te same jednostki, z których 32 połączono w 14 obszarów
na potrzeby drogowskazów, czyli grubszy podział o tej samej logice.

## Metoda

1. `node etl/okolice.mjs --pobierz` pobiera warstwę ZTP i kontrolną (strony po zakresach OID,
   `lib/msip.mjs`), składa granice, a z Overpass bierze miejsca OSM w prostokącie wokół Krakowa.
   Surowe odpowiedzi trafiają do `etl/.cache/okolice/`, więc drugi bieg ich nie pobiera.
2. Granice: pierścienie z EPSG:2178 przeliczone do WGS84 (6 miejsc, ok. 0,1 m), zewnętrzne
   przeciwnie do ruchu wskazówek zegara (RFC 7946). Teksty oczyszczone z białych znaków (numer
   jednostki XVII.6 przychodzi z MSIP z końcowym znakiem nowej linii). Pominięto opisy słowne
   jednostek i opisy przebiegu granic.
3. `id` jednostki = `sim-<id_sim>`, gdzie `id_sim` = numer dzielnicy × 100 + numer jednostki
   (np. VIII.3 → `sim-803`). To ten sam klucz, który mają inne warstwy MSIP (np. ludność w
   `Elud_Sim`), więc kolejne dane da się dołączyć po `id`.
4. Adres w Krakowie → jednostka przez punkt w wielokącie (EPSG:2180, reguła parzystości). Do 30 m od
   granicy adres dostałby najbliższą jednostkę, dalej `null`; w obecnych danych nie zdarza się
   żaden z tych przypadków.
5. Adres poza Krakowem → miejscowość w gminie (`m-<teryt gminy>-<slug miejscowości>`). Bez
   miejscowości `null`.
6. Słownik: każde miejsce OSM trafia do jednostki, w której leży (punkt) albo która zajmuje
   największą część obrysu (siatka 10 m). Nazwa pasuje też do jednostek, w których nazwach występuje
   jako ciąg słów („Bronowice” → Bronowice Małe, Stare Bronowice Małe, Bronowice Wielkie).

## Dlaczego potoczna nazwa nie jest przypisana do adresu

Wcześniejsza, zastępcza wersja skryptu (jeszcze bez granic SIM) przypisywała adresom nazwę osiedla
z OSM przez odwrotne geokodowanie środka heksu H3. Pomiar na danych pokazuje, dlaczego nie
powtarzamy tego na jednostkach SIM:

- obrys ma w OSM tylko 33 osiedla (32 w Krakowie), a adresów w tych obrysach jest 1 193 (1,7%
  adresów Krakowa);
- reszta to punkty „w środku osiedla”: mediana odległości adresu do najbliższego takiego punktu
  w tej samej jednostce to 406 m, a dla 39% adresów punkt jest dalej niż 500 m albo jednostka
  nie ma go wcale;
- nazwa wybrana po najbliższym punkcie byłaby zgadywaniem, którego karta nie umiałaby uzasadnić.

Dlatego adres dostaje okolicę z SIM, a `okolice.<id>.potoczne` i `slownikNazw` mówią, jakie nazwy
potoczne leżą w jednostce i do jakich jednostek pasują. Jeśli front potrzebuje nazwy osiedla
konkretnego adresu, to wymaga obrysów osiedli (np. z rejestrów gminy), nie punktów OSM.

## Kontrola jakości (zrzut z 2026-10-03)

| Sprawdzenie | Wynik |
|---|---|
| Adresy Krakowa w dokładnie jednej jednostce | 70 217 z 70 217 (0 poza jednostkami, 0 w kilku) |
| Dzielnica adresu = dzielnica jednostki | 70 217 z 70 217 |
| Jednostki: unikalne numery i nazwy, `id` zgodne z `id_sim` w kopii kontrolnej | 123 z 123 |
| Powierzchnia z geometrii zgodna z `pow` (≤ 1%) i z kopią kontrolną (≤ 0,5%) | 123 z 123, największa różnica z kopią 0% |
| Suma powierzchni jednostek | 326,849 km² (Kraków: 326,85 km²) |
| Jednostki bez adresów | 0 (najmniejsza ma 10 adresów, mediana 447, największa 2 323) |
| Adresy poza Krakowem z okolicą | 106 467 z 106 467 (234 miejscowości) |
| Nazwy jednostek, które są też nazwami miejsc OSM | 101 ze 123 |
| Jednostki z co najmniej jednym miejscem OSM w środku | 113 ze 123 |
| Obrysy OSM rozcięte granicą jednostek (próg 10% powierzchni) | 0 z 32 |

Skrypt zatrzymuje się, gdy dwie kopie warstwy się rozjeżdżają, gdy numery albo nazwy się powtarzają
albo gdy liczba jednostek nie wynosi 123 (to znaczyłoby zmianę podziału). Testy
(`node --test etl/okolice.test.mjs`) powtarzają kontrolę „każdy adres w jednej jednostce” na
wszystkich adresach Krakowa i sprawdzają spójność trzech plików.

## Rozjazdy jednostek SIM i nazw potocznych

`rozjazdy[]` to lista z polami `rodzaj`, `opis` (tekst do pokazania), `jednostki` (id) i dodatkowymi
liczbami. Zrzut z 2026-10-03 ma 66 pozycji:

| `rodzaj` | Ile | Co znaczy | Przykład |
|---|---|---|---|
| `nazwa-szersza-niz-jednostka` | 16 | nazwa z OSM jest częścią nazw kilku jednostek: jedno miejsce w OSM, kilka okolic SIM | „Bronowice” → 3 jednostki |
| `nazwa-poza-jednostka-o-tej-nazwie` | 5 | punkt OSM o tej nazwie leży w innej jednostce niż jednostka o tej nazwie | „Wesoła” leży w Wesołej Wschód, a jednostka Wesoła to I.6 |
| `nazwa-w-kilku-jednostkach` | 9 | ta sama nazwa potoczna w kilku jednostkach: wyszukiwanie jest niejednoznaczne | „Gaj”, „Bugaj”, „Nowa Wieś” |
| `jednostka-bez-miejsc-osm` | 10 | w jednostce OSM nie ma osiedla ani części miasta: okolica ma tylko nazwę SIM | Bonarka, Mateczny, Ogródki |
| `nazwa-jednostki-jak-dzielnica` | 23 | nazwa jednostki zawiera nazwę dzielnicy, a jednostka to jej część | „Nowa Huta” (XVIII.1) to 6% dzielnicy XVIII Nowa Huta, „Dębniki” (VIII.1) 3% |
| `nazwa-jednostki-z-innej-dzielnicy` | 2 | nazwa jednostki zawiera nazwę innej dzielnicy niż ta, w której leży | Krowodrza Górka leży w dzielnicy IV, nie V Krowodrza |
| `okolica-poza-krakowem` | 1 | poza Krakowem okolica to miejscowość, nie jednostka SIM | inny rząd wielkości, więc ranking nie powinien mieszać obu bez podpisu |
| `osiedle-w-kilku-jednostkach` | 0 | obrys osiedla z OSM rozcięty granicą jednostek (druga jednostka ≥ 10% powierzchni) | żaden z 32 obrysów nie jest rozcięty |

## Format `okolice.json`

```ts
interface PlikOkolic {
  wersjaAdresow: string          // = wersja z adresy.json; niezgodny plik trzeba przeliczyć
  metoda: 'sim-msip'
  opis: string
  rozdzielczosc: 'adres'
  zrodla: Zrodlo[]               // nazwa, url, licencja, dataDanych, pobrano
  kontrola: Record<string, unknown>   // liczby z sekcji „Kontrola jakości”
  okolice: Record<string, Okolica>    // klucz = id okolicy
  idOkolic: string[]             // kolejność okolic: SIM po numerze, potem miejscowości po id
  slownikNazw: WpisSlownika[]
  rozjazdy: Rozjazd[]
  kolumny: { okolica: (number | null)[] }  // dla i-tego adresu z adresy.json: indeks w idOkolic
}
interface Okolica {              // rodzaj 'sim' (Kraków)
  nazwa: string                  // „Ludwinów”
  numer: string                  // „VIII.3”
  rodzaj: 'sim'
  dzielnica: string              // „VIII Dębniki” (jak w adresy.json)
  gmina: 'Kraków'
  powierzchniaKm2: number
  liczbaAdresow: number
  potoczne: string[]             // nazwy OSM leżące w jednostce, bez nazwy samej jednostki
}
interface OkolicaMiejscowosc {   // rodzaj 'miejscowosc' (poza Krakowem), id „m-1219064-grabowki”
  nazwa: string; rodzaj: 'miejscowosc'; dzielnica: null; gmina: string; liczbaAdresow: number
}
interface WpisSlownika {         // pomijamy wpisy, które tylko powtarzają nazwę jednostki
  nazwa: string                  // nazwa z OSM, bez zmian
  place: 'neighbourhood' | 'quarter'
  jednostki: string[]            // [0] = jednostka, w której leży punkt OSM; dalej pasujące
  osm: string[]                  // „node/123”, „way/456”
}
```

Okolica adresu `i`: `d.okolice[d.idOkolic[d.kolumny.okolica[i]]]`; `null` w kolumnie = brak danych.
Jednostek SIM jest zawsze 123 (także bez adresów), miejscowości tylko te z adresami.

## Format `okolice-granice.geojson`

`FeatureCollection` w WGS84 (ok. 1,1 MB, 51 265 wierzchołków) z polem `metadane` (źródło, katalog,
wydawca, licencja, `dataDanych`, `pobrano`, kontrola). Każdy obiekt: `Polygon` i właściwości
`id` (`sim-803`), `numer` (`VIII.3`), `nazwa`, `dzielnica`, `powierzchniaKm2`. Granice nie są
uproszczone: sąsiednie jednostki dzielą dokładnie te same wierzchołki, a upraszczanie każdej osobno
rozwarłoby szczeliny między nimi.

## Odświeżanie

- Zmieniła się lista adresów: `node etl/okolice.mjs` (bez sieci).
- Zmienił się podział SIM albo OSM: usuń `etl/.cache/okolice/` i `node etl/okolice.mjs --pobierz`.
  Skrypt przerwie się, jeśli liczba jednostek nie wynosi 123 albo kopie się rozjadą; wtedy
  zaktualizuj `LICZBA_JEDNOSTEK` świadomie.

## Co zostaje dla frontu i integratora

- **Integrator** (`src/kontrakty`): typy z sekcji „Format” i loader `okolice.json` z kontrolą
  `wersjaAdresow`.
- **Karta / wynik** (`src/wynik/luki.ts`, `okolicaAdresu`): dziś dzielnica lub gmina; docelowo
  `okolice.json`. Id okolic się zmieni (`sim-803`, `m-…` zamiast `dzielnica:…`, `gmina:…`),
  a jednostek w Krakowie będzie 123 zamiast 18, z czego część małych (10 adresów), więc ranking
  okolic powinien pokazywać liczbę adresów i nie mieszać jednostek SIM z miejscowościami bez podpisu.
- **Mapa**: granice z `okolice-granice.geojson` (podświetlenie okolicy, kolor rankingu).
- **Wyszukiwarka i JEV**: `slownikNazw` pozwala znaleźć okolicę po nazwie osiedla; nazwy
  niejednoznaczne (`jednostki.length > 1`) wymagają wyboru, a `rozjazdy[].opis` to gotowy tekst
  wyjaśnienia.
