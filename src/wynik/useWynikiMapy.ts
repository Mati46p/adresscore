// Hook B4 (#247): wyniki mapy z kompaktu (r10 bieżącego miasta), te same wejścia co `useWyniki`.
// Liczenie: `wynikiMapy.ts`. Warstwy profilu zamawia przegląd (`usePrzeglad`), tu nic się nie pobiera
// poza filtrami aktywnych twardych filtrów (przez `useDaneHeksow`).
import { filtryZBudzetem } from './budzet.ts'
import { useDaneHeksow } from './kompaktBiezacy.ts'
import { useStan } from './stan.ts'
import { policzWynikiMapy, type WynikiMapy } from './wynikiMapy.ts'

export type { WynikiMapy } from './wynikiMapy.ts'

/** Wyniki mapy z kompaktu; null, gdy dane heksów nie są gotowe (ładowanie, brak rozszerzeń) albo brakuje plików warstw. */
export function useWynikiMapy(): WynikiMapy | null {
  const dane = useDaneHeksow()
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const warstwa = useStan((s) => s.warstwa)
  const filtry = useStan((s) => s.filtry)
  const budzet = useStan((s) => s.budzet)
  // W trybie „Biznes” budżet mieszkania nie ma sensu – ignorujemy go (jak w `useWyniki`).
  const tryb = useStan((s) => s.tryb)
  const razem = tryb === 'biznes' ? filtry : filtryZBudzetem(filtry, budzet)
  return dane.stan === 'gotowe' ? policzWynikiMapy(dane, wagi, kierunki, warstwa, razem) : null
}
