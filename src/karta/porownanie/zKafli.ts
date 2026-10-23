// Porównanie bez pełnych danych (#247, B7b): adresy i wyniki z kafli kompaktu, lista kandydatów z
// `szukaj.bin`. Czysty moduł (bez Reacta i `import.meta.env`), żeby test na gołym `node --test` sprawdził,
// że liczby są takie same jak ze ścieżki pełnych danych.
import type { Adres } from '../../kontrakty/index.ts'
import { policzWykluczenia, type TwardyFiltr } from '../../wynik/filtry.ts'
import { type KafelGotowy, pozycjaWKaflu } from '../../wynik/kafle.ts'
import { type Rozpakowany, slownikowa } from '../../wynik/kompakt.ts'
import { type Kierunki, type WynikAdresu, wynikAdresu } from '../../wynik/silnik.ts'

export interface AdresZKafla {
  adres: Adres
  wynik: WynikAdresu
  wykluczony: boolean
  /** Brak danych dla filtra: nie wiemy, czy adres go spełnia (to nie jest wykluczenie). */
  niewiadomy: boolean
}

/**
 * Adres `i` (pozycja w adresy.json) z jego kafla: te same funkcje silnika i filtrów co dla pełnych danych,
 * tylko na wartościach kafla, więc liczby są identyczne. null, gdy kafla nie ma albo nie zawiera adresu.
 */
export function adresZKafla(
  kafel: KafelGotowy | null,
  i: number,
  wagi: Readonly<Record<string, number>>,
  kierunki: Kierunki,
  filtry: readonly TwardyFiltr[],
): AdresZKafla | null {
  if (!kafel) return null
  const j = pozycjaWKaflu(kafel, i)
  const adres = j < 0 ? undefined : kafel.adresy[j]
  if (!adres) return null
  const w = policzWykluczenia(kafel.wskazniki, filtry, kafel.adresy.length)
  return {
    adres,
    // `i` w wyniku to pozycja w adresy.json (jak w ścieżce pełnych danych), nie pozycja w kaflu.
    wynik: { ...wynikAdresu(j, kafel.wskazniki, wagi, kierunki), i },
    wykluczony: w.wykluczony[j] === 1,
    niewiadomy: w.niewiadomy[j] === 1,
  }
}

/**
 * Odwraca `i` → indeks kompaktu (tablica z `wczytajMapeAdresow`) do `indeks kompaktu` → `i`, czyli
 * `kolejnosc` z id.bin. Pozycje bez adresu w kompakcie (-1) są pomijane.
 */
export function kolejnoscZMapy(mapa: ArrayLike<number>): Uint32Array {
  let n = 0
  for (let i = 0; i < mapa.length; i++) if ((mapa[i] as number) >= 0) n++
  const kolejnosc = new Uint32Array(n)
  for (let i = 0; i < mapa.length; i++) {
    const c = mapa[i] as number
    if (c >= 0) kolejnosc[c] = i
  }
  return kolejnosc
}

const KOLUMNY_TEKSTU = ['miejscowosc', 'ulica', 'nr', 'kod', 'dzielnica', 'gmina', 'teryt'] as const

/**
 * Adresy do wyszukiwarki z `szukaj.bin` (kolumny tekstowe w kolejności kompaktu) i `kolejnosc`
 * (indeks kompaktu → pozycja w adresy.json). Wyszukiwarka czyta tylko teksty i `i`; `id`, współrzędne i
 * `h3` są puste, bo pełny adres po wyborze dochodzi z kafla.
 */
export function adresyZSzukaj(r: Rozpakowany, kolejnosc: ArrayLike<number>): Adres[] {
  const k = Object.fromEntries(
    KOLUMNY_TEKSTU.map((nazwa) => [nazwa, slownikowa(r, nazwa)]),
  ) as Record<(typeof KOLUMNY_TEKSTU)[number], ReturnType<typeof slownikowa>>
  const tekst = (nazwa: (typeof KOLUMNY_TEKSTU)[number], c: number) =>
    k[nazwa].slownik[k[nazwa].indeksy[c] as number] ?? null
  const wynik: Adres[] = new Array(kolejnosc.length)
  for (let c = 0; c < kolejnosc.length; c++) {
    wynik[c] = {
      i: kolejnosc[c] as number,
      id: '',
      miejscowosc: tekst('miejscowosc', c) ?? '',
      ulica: tekst('ulica', c),
      nr: tekst('nr', c) ?? '',
      kod: tekst('kod', c),
      dzielnica: tekst('dzielnica', c),
      gmina: tekst('gmina', c) ?? '',
      teryt: tekst('teryt', c) ?? '',
      lon: 0,
      lat: 0,
      h3: '',
    }
  }
  return wynik
}
