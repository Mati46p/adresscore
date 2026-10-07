# Kontrakt: rejestr miast i ścieżki danych (`src/kontrakty/**`, tor integracja)

```ts
// src/kontrakty/miasta.ts – bez import.meta.env (testowalny w node --test)
export type SlugMiasta =
  | 'krakow' | 'warszawa' | 'lodz' | 'wroclaw' | 'poznan'
  | 'gdansk' | 'szczecin' | 'bydgoszcz' | 'lublin' | 'bialystok'

export interface Miasto {
  slug: SlugMiasta
  nazwa: string
  /** „w Krakowie", „we Wrocławiu" – gotowa fraza do tekstów. */
  wMiescie: string
  /** Katalog względem `dane/`: '' dla Krakowa, 'miasta/<slug>' dla reszty. */
  katalog: string
  srodek: [number, number]
}

export const MIASTA: readonly Miasto[]          // Kraków pierwszy
export const MIASTO_DOMYSLNE: SlugMiasta        // 'krakow'
export function miasto(slug: SlugMiasta): Miasto       // slug z typu: zawsze jest (bez `null`)
export function miasto(slug: string): Miasto | null    // napis z linku (`mst=`): może nie być
export function czySlugMiasta(s: string): s is SlugMiasta
export interface TloMapy { /* kształt: contracts/przeglad.md */ }
```

```ts
// src/kontrakty/index.ts – parametr `baza` opcjonalny, domyślnie Kraków (zgodność wstecz:
// pliki spoza tej funkcji kompilują się bez zmian)
export function bazaDanych(slug?: SlugMiasta): string   // `${BASE_URL}dane` albo `${BASE_URL}dane/miasta/<slug>`
export const wczytajAdresy: (baza?: string) => Promise<PlikAdresow>
export const wczytajManifest: (baza?: string) => Promise<Manifest>
export function wczytajWskaznik(id: string, wersjaAdresow: string, baza?: string): Promise<PlikWskaznika | null>
export function wczytajOkolice(wersjaAdresow: string, liczbaAdresow?: number, baza?: string): Promise<PlikOkolic | null>
```

## Pliki serwowane (bez zmian w `public/dane/**`)

| Ścieżka | Kraków | Miasto |
|---|---|---|
| `<baza>/adresy.json`, `wskazniki/<id>.json`, `kompakt/**` | ✅ | ✅ |
| `<baza>/manifest.json` | plugin (jest) | plugin (**nowe**, T004) |
| `<baza>/dojazd/graf.json`, `uslugi/**`, `budynki/**` | ✅ | ✅ |
| `<baza>/okolice.json`, `okolice-granice.geojson`, `biznes/**`, `mpzp_*`, `pozwolenia.geojson` | ✅ | ❌ → „Na razie tylko w Krakowie" |
