# Kontrakt: przegląd wszystkich miast i tło mapy

Granica między torem `karta` (`src/wynik/przeglad*.ts`, F3) a torem `mapa` (`MapaKrakowa`, F4).
Obie fazy piszą do tego kontraktu równolegle; F6 je łączy.

## Tło mapy – nowy opcjonalny prop `MapaKrakowa`

```ts
// src/kontrakty/miasta.ts (F1, integracja) – typ wspólny dla F3 i F4, żeby żadna faza nie czekała na drugą
export interface TloMapy {
  /** Heksy r8 i r9 miast innych niż bieżące; null = brak danych (szrafura), nigdy 0. */
  heksy: { 8: ReadonlyMap<string, number | null>; 9: ReadonlyMap<string, number | null> }
  /** Nazwa miasta heksu tła (r8 albo r9) – do dymku; null = heks nie należy do tła. */
  miastoHeksu: (h3: string) => string | null
}

interface MapaKrakowaProps {
  // …istniejące pola bez zmian…
  tlo?: TloMapy
  /** Rozszerzenie istniejącego onWidok: trzeci argument zoom (wstecznie zgodne). */
  onWidok?: (lon: number, lat: number, zoom: number) => void
  /** Kadr startowy, gdy nie ma wybranego adresu ani granic: prostokąt wszystkich miast. */
  kadrStartowy?: [[number, number], [number, number]] | null
}
```

Reguły rysowania (F4):
- źródła `tlo-r8` (minzoom 0, maxzoom 11) i `tlo-r9` (11–13), te same: `wyrazenieKoloru`,
  krycie danych/braku, szrafura, obrys braku, linia; suwak „Krycie heksów" działa też na tło;
- tło nie ma r10 – przy zoomie ≥ 13 w mieście nie-bieżącym widać podkład i komunikat F6;
- geometria tła przebudowywana tylko przy zmianie zbioru kluczy (jak `takieSameKlucze`);
- mgła i obrys: otoczka z sumy r8 bieżącego miasta i tła; podpis mgły „poza obsługiwanymi miastami – brak danych";
- dymek tła: „<Miasto> · wynik N (średnia okolicy)" albo „<Miasto> · brak danych";
- legenda dopisuje wiersz „Skala liczona osobno w każdym mieście" gdy `tlo` niepuste.

## Przegląd – `src/wynik/przeglad.ts` (F3)

```ts
export interface StanPrzegladuMiasta {
  slug: SlugMiasta
  stan: 'ladowanie' | 'gotowe' | 'brak'
  granice: [[number, number], [number, number]] | null
}

export interface Przeglad {
  miasta: readonly StanPrzegladuMiasta[]
  /** Tło do MapaKrakowa: wszystkie miasta gotowe poza bieżącym. */
  tlo: TloMapy
  /** r10 bieżącego miasta zanim jego pełne dane będą gotowe (dawna rola useWstepnaMapa); null = czekaj na pełne. */
  biezaceR10: ReadonlyMap<string, number | null> | null
  podpis: string
  /** Prostokąt wszystkich gotowych miast – kadr startowy. */
  kadrWszystkich: [[number, number], [number, number]] | null
  /** Miasto pod punktem (po r8 z kompaktu); null = poza miastami. */
  miastoPunktu: (lon: number, lat: number) => SlugMiasta | null
}

export function usePrzeglad(): Przeglad
```

```ts
// src/wynik/przegladLiczenie.ts – czyste funkcje, bez import.meta.env, test w node --test
export function wynikiPrzegladu(
  podstawa: PodstawaHeksow,
  liczone: readonly Liczona[],
  warstwa: (id: string) => WarstwaHeksow | null,
  res: Res,
): Map<string, number | null>          // NaN/brak → null; liczone=[] → same null
export function zlaczTlo(per: ReadonlyMap<SlugMiasta, Record<8 | 9, Map<string, number | null>>>, biezace: SlugMiasta): …
export function graniceZHeksow(r8: readonly string[]): [[number, number], [number, number]] | null
```

Kolejność pobierania: bieżące miasto (indeks + `heksy.bin` + warstwy profilu), potem reszta
w kolejności rejestru, maks. 3 żądania naraz. Typ `TloMapy` obie fazy importują z `@/kontrakty/miasta`.
