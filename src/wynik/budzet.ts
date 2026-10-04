// Budżet zakupu (#77): kwota w zł i metraż w m² zamieniają się na twardy filtr ceny za m².
// Źródło wyłącznie ceny transakcyjne RCN (warstwa `cena_m2_mediana`, rozdzielczość heks),
// bez ogłoszeń. Heks, w którym mediana × metraż > budżet, jest wyszarzony i znika z rankingu.
// Brak ceny to „nie wiemy” (ocenFiltr), nigdy 0 – takiego heksu nie wykluczamy.
import { type TwardyFiltr, zPodmienionymFiltrem } from './filtry.ts'

export const WARSTWA_CENY = 'cena_m2_mediana'

export interface Budzet {
  /** Kwota w zł. */
  kwota: number
  /** Metraż w m². */
  metraz: number
}

export const BUDZET_DOMYSLNY: Budzet = { kwota: 700_000, metraz: 50 }
export const ZAKRES_KWOTY = { min: 200_000, max: 3_000_000, krok: 10_000 } as const
export const ZAKRES_METRAZU = { min: 15, max: 200, krok: 1 } as const

function poprawny(b: Budzet | null | undefined): b is Budzet {
  return !!b && Number.isFinite(b.kwota) && Number.isFinite(b.metraz) && b.kwota > 0 && b.metraz > 0
}

/** Czy mieszkanie o danej medianie ceny m² mieści się w budżecie. null = brak danych. */
export function miesciSieWBudzecie(
  cenaM2: number | null | undefined,
  budzet: Budzet,
): boolean | null {
  if (cenaM2 === null || cenaM2 === undefined || Number.isNaN(cenaM2)) return null
  return cenaM2 * budzet.metraz <= budzet.kwota
}

/** Filtr `cena_m2_mediana ≤ kwota / metraż`; null, gdy budżet wyłączony albo błędny. */
export function filtrBudzetu(budzet: Budzet | null | undefined): TwardyFiltr | null {
  if (!poprawny(budzet)) return null
  return { id: WARSTWA_CENY, warunek: 'max', prog: budzet.kwota / budzet.metraz }
}

let ostatni: {
  filtry: readonly TwardyFiltr[]
  budzet: Budzet | null
  wynik: readonly TwardyFiltr[]
} | null = null

/**
 * Twarde filtry razem z filtrem budżetu (budżet wygrywa z ręcznym filtrem ceny).
 * Dla tych samych wejść zwraca tę samą tablicę – pamięć wyników w useWyniki porównuje referencje.
 */
export function filtryZBudzetem(
  filtry: readonly TwardyFiltr[],
  budzet: Budzet | null,
): readonly TwardyFiltr[] {
  if (ostatni && ostatni.filtry === filtry && ostatni.budzet === budzet) return ostatni.wynik
  const f = filtrBudzetu(budzet)
  const wynik = f ? zPodmienionymFiltrem(filtry, f) : filtry
  ostatni = { filtry, budzet, wynik }
  return wynik
}

/** „700 tys. zł”, „1,25 mln zł”. */
export function opisKwoty(kwota: number): string {
  if (kwota >= 1_000_000)
    return `${String(Math.round(kwota / 10_000) / 100).replace('.', ',')} mln zł`
  return `${Math.round(kwota / 1000)} tys. zł`
}
