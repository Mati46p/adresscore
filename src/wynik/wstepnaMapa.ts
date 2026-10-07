// Cienka nakładka (#223, faza F3): dawna „mapa wstępna” (kolory r10 z kompaktu przed pełnymi danymi)
// to dziś `biezaceR10` przeglądu wszystkich miast. Plik zostaje tylko po to, żeby `EkranSzukaj` działał
// do fazy F6 (T051), która przechodzi na `usePrzeglad()` i może go usunąć.
import { usePrzeglad } from './przeglad.ts'

/** Zwraca kolor heksów przed pobraniem pełnych adresów; null oznacza fallback na JSON. */
export function useWstepnaMapa(aktywna = true): {
  heksy: ReadonlyMap<string, number | null>
  podpis: string
} | null {
  const przeglad = usePrzeglad()
  return aktywna && przeglad.biezaceR10
    ? { heksy: przeglad.biezaceR10, podpis: przeglad.podpis }
    : null
}
