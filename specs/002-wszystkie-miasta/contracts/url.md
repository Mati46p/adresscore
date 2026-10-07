# Kontrakt: bieżące miasto w linku i stanie

## Link

- Parametr `mst=<slug>` w query hasha (`#/?mst=lodz&p=rodzina`, `#/adres/<id>?mst=lodz`).
- Kraków: parametr pomijany. Brak parametru = Kraków (każdy link sprzed funkcji działa jak dziś).
- Nieznany slug → Kraków + komunikat „Nie mamy danych dla tego miasta".
- `m` (miejsca Biznesu) i ekran `#/miasto` bez zmian.

## Stan (`src/wynik/stan.ts`)

```ts
interface StanAplikacji { /* … */ miasto: SlugMiasta }
export function ustawMiasto(slug: SlugMiasta, opcje?: { klik?: { lon: number; lat: number } }): void
```

- Zmiana miasta czyści: `wybrany`, `porownanie`, `symulacja`, miejsca i filtry Biznesu zależne od punktów.
- `klik` = oczekujący klik: po `podlaczDane` nowego miasta wybiera adres z klikniętego heksu
  (ta sama reguła co `adresWKliknietymHeksie`).
- `podlaczDane` scala `wagi`/`kierunki` (id spoza meta bieżącego miasta zostają) – D9.

## Nie-React (`src/wynik/miastoDanych.ts`)

```ts
export function miastoBiezace(): Miasto          // z pobierzStan()
export function bazaBiezaca(): string            // bazaDanych(miastoBiezace().slug)
export function useMiasto(): Miasto
export function tylkoKrakow(): boolean           // funkcje D8
```
