// Znaczniki postawionych miejsc A i B dla mapy trybu „Biznes”.
//
// Mapa odtwarza znaczniki przy KAŻDEJ zmianie referencji tablicy `postawionePunkty` (zdejmuje
// stare i stawia nowe), więc nowa tablica z tymi samymi punktami przy każdym renderze kasowałaby
// znacznik w trakcie przeciągania i zabierała mu fokus klawiatury. Funkcja zwraca TĘ SAMĄ tablicę,
// dopóki oba punkty są tymi samymi obiektami, niezależnie od tego, czy React Compiler
// skompiluje wołający komponent.
import { GRANICE_PUNKTU } from './url.ts'

export interface PunktBiznesu {
  lon: number
  lat: number
}
export interface PostawionyPunkt extends PunktBiznesu {
  id: 'a' | 'b'
}

const BRAK: readonly PostawionyPunkt[] = []
let ostatnie: {
  a: PunktBiznesu | null
  b: PunktBiznesu | null
  lista: readonly PostawionyPunkt[]
} | null = null

export function postawionePunkty(
  a: PunktBiznesu | null,
  b: PunktBiznesu | null,
): readonly PostawionyPunkt[] {
  if (ostatnie && ostatnie.a === a && ostatnie.b === b) return ostatnie.lista
  const lista =
    a || b
      ? [
          ...(a ? [{ id: 'a' as const, lon: a.lon, lat: a.lat }] : []),
          ...(b ? [{ id: 'b' as const, lon: b.lon, lat: b.lat }] : []),
        ]
      : BRAK
  ostatnie = { a, b, lista }
  return lista
}

/**
 * Przeciągnięcie albo krok strzałki mogą wypchnąć znacznik poza obszar, w którym link przyjmuje
 * punkt (po odświeżeniu punkt by zniknął). Zwraca najbliższy punkt dozwolonego prostokąta.
 */
export function ograniczDoGranic(lon: number, lat: number): [number, number] {
  return [
    Math.min(GRANICE_PUNKTU.lonMax, Math.max(GRANICE_PUNKTU.lonMin, lon)),
    Math.min(GRANICE_PUNKTU.latMax, Math.max(GRANICE_PUNKTU.latMin, lat)),
  ]
}
