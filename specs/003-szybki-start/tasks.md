# Zadania: Szybki start (#247)

Reguły: Biome, alias `@/`, React Compiler (bez `useMemo`/`useCallback`), polski tekst z półpauzą
`–`, nigdy pauzą. Brak danych nigdy jako 0. Commity po polsku z `Refs #247`. Agenci nie commitują –
commituje sesja nadrzędna po review. Verify: `pnpm verify` + `node --test 'src/**/*.test.ts'`.

## Etap A
- [ ] A1 [P] `serwer/serwer.mjs` (+ `vercel.json`): ETag, 304, cache wg rodzaju pliku
- [ ] A2 [P] `public/sw.js`: cache v5, kompakt cache-first, pełne dane max raz na 24 h
- [ ] A3 [P] worker danych + `Float64Array` (NaN = brak) w `WskaznikPrzygotowany.wartosci`
- [ ] A4 (po A3) `pozwolNaPelneDane()`, wczesny import mapy, `h3-js` poza wejściem
- [ ] A5 `scripts/pomiar-startu.mjs` + pomiar przed/po

## Etap B
- [ ] B1 ETL kompakt format 3 (kolumna `i`, podział kafli > 1500 na r8, bbox okolic)
- [ ] B2 `useDaneHeksow()` (`src/wynik/kompaktBiezacy.ts`)
- [ ] B3 `src/wynik/kafle.ts` (`wczytajKafel`, `useKafel`, `useAdres`, `adresZPunktu`)
- [ ] B4 `useWynikiMapy()` na `wynikiHeksow`/`wykluczeniaHeksow`/`najlepszeHeksy`
- [ ] B5 `rankingKompakt.ts` + `etl/ranking-zgodnosc.mjs`
- [ ] B6 `stan.ts`: `podlaczMeta` + `podlaczSlownik`
- [ ] B7 przepięcie konsumentów (Szukaj po 004-P3, Okolica, Porównanie, Metoda)
