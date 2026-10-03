import type { ExpressionSpecification } from 'maplibre-gl'

// Heks wykluczony twardym filtrem (#37) wygląda inaczej niż brak danych: ciemny, pełny kolor
// bez szrafury. Brak danych to jasnoszara szrafura – obie rzeczy różnią się wzorem i jasnością.
// W feature-state `w`: -1 = brak danych, -2 = wykluczony filtrem.
export const W_BRAK = -1
export const W_WYKLUCZONY = -2
export const KOLOR_WYKLUCZONEGO = '#2F3438'
export const KRYCIE_WYKLUCZONEGO = 0.62

export const jestWykluczony = (wartosc: ExpressionSpecification): ExpressionSpecification => [
  '<',
  wartosc,
  W_WYKLUCZONY + 0.5,
]
export const jestBrakiem = (wartosc: ExpressionSpecification): ExpressionSpecification => [
  'all',
  ['<', wartosc, 0],
  ['>', wartosc, W_WYKLUCZONY + 0.5],
]

/** Heks jest wykluczony, gdy wszystkie jego dzieci są wykluczone (res 8 i 9). */
export function wszystkieWykluczone(
  dzieci: readonly string[],
  wykluczone: ReadonlySet<string>,
): boolean {
  return dzieci.length > 0 && dzieci.every((h) => wykluczone.has(h))
}
