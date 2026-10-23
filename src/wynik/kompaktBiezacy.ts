// Hook B2 (#247): dane heksów bieżącego miasta z kompaktu. Logika i cache: `kompaktBiezaceLogika.ts`.
// Pobieraniem podstawy i warstw profilu zajmuje się przegląd (`usePrzeglad` zgłasza menedżerowi,
// czego potrzeba); ten hook tylko czyta jego wpis i dociąga filtry oraz skale na żądanie.
import { useSyncExternalStore } from 'react'
import { bazaDanych } from '@/kontrakty'
import { type StanDanychHeksow, utworzZrodloHeksow } from './kompaktBiezaceLogika.ts'
import { przegladMenedzer } from './przeglad.ts'
import { useStan } from './stan.ts'

export type { DaneHeksowGotowe, StanDanychHeksow } from './kompaktBiezaceLogika.ts'

async function pobierz(url: string): Promise<Response> {
  const odp = await fetch(url)
  if (!odp.ok) throw new Error(`${url}: HTTP ${odp.status}`)
  return odp
}

const zrodlo = utworzZrodloHeksow({
  wpis: (slug) => przegladMenedzer.migawka().wpisy.get(slug),
  subskrybujWpisy: przegladMenedzer.subskrybuj,
  baza: bazaDanych,
  json: async <T>(url: string) => (await (await pobierz(url)).json()) as T,
  bajty: async (url) => (await pobierz(url)).arrayBuffer(),
  ostrzez: (komunikat, powod) => console.warn(komunikat, powod),
})

/** Dane heksów bieżącego miasta; `brak` bez `indeks.rozszerzenia` (wtedy ekran wraca do `useDane()`). */
export function useDaneHeksow(): StanDanychHeksow {
  const miasto = useStan((s) => s.miasto)
  return useSyncExternalStore(
    zrodlo.subskrybuj,
    () => zrodlo.stan(miasto),
    () => zrodlo.stan(miasto),
  )
}
