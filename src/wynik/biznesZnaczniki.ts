// Znaczniki postawionych miejsc A–E dla mapy trybu „Biznes”.
//
// Mapa odtwarza znaczniki przy KAŻDEJ zmianie referencji tablicy `postawionePunkty` (zdejmuje
// stare i stawia nowe), więc nowa tablica z tymi samymi punktami przy każdym renderze kasowałaby
// znacznik w trakcie przeciągania i zabierała mu fokus klawiatury. Funkcja zwraca TĘ SAMĄ tablicę,
// dopóki wszystkie punkty są tymi samymi obiektami, niezależnie od tego, czy React Compiler
// skompiluje wołający komponent.
import { GRANICE_PUNKTU, ID_MIEJSC, type IdMiejsca } from './url.ts'

export interface PunktBiznesu {
  lon: number
  lat: number
}
export interface PostawionyPunkt extends PunktBiznesu {
  id: IdMiejsca
}

const BRAK: readonly PostawionyPunkt[] = []
let ostatnie: {
  miejsca: readonly (PunktBiznesu | null)[]
  lista: readonly PostawionyPunkt[]
} | null = null

/** Miejsca A–E jako lista znaczników; ta sama tablica, dopóki żadne miejsce się nie zmieniło. */
export function postawionePunkty(
  miejsca: readonly (PunktBiznesu | null)[],
): readonly PostawionyPunkt[] {
  if (
    ostatnie &&
    ostatnie.miejsca.length === miejsca.length &&
    ostatnie.miejsca.every((p, i) => p === miejsca[i])
  )
    return ostatnie.lista
  const lista: PostawionyPunkt[] = []
  ID_MIEJSC.forEach((id, i) => {
    const p = miejsca[i]
    if (p) lista.push({ id, lon: p.lon, lat: p.lat })
  })
  ostatnie = { miejsca: [...miejsca], lista: lista.length ? lista : BRAK }
  return ostatnie.lista
}

/** Pierwsze wolne miejsce po `od` (z zawinięciem) albo `null`, gdy wszystkie są zajęte. */
export function nastepneWolne(
  miejsca: readonly (PunktBiznesu | null)[],
  od: IdMiejsca,
): IdMiejsca | null {
  const start = ID_MIEJSC.indexOf(od)
  for (let k = 1; k <= ID_MIEJSC.length; k++) {
    const i = (start + k) % ID_MIEJSC.length
    if (!miejsca[i]) return ID_MIEJSC[i] ?? null
  }
  return null
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
