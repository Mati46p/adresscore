// Same adresy bieżącego miasta, bez warstw: katalog potrzebuje ~25 MB adresów, a nie ~300 MB pełnych
// danych (#239). Gdy pełne dane już są w pamięci, bierze adresy z nich, bez drugiego pobrania.
import { useSyncExternalStore } from 'react'
import { type Adres, bazaDanych, rozwinAdresy, type SlugMiasta, wczytajAdresy } from '@/kontrakty'
import { daneJesliGotowe } from './dane.ts'
import { pobierzStan, subskrybuj as subskrybujStan } from './stan.ts'

export type StanAdresow =
  | { stan: 'ladowanie' }
  | { stan: 'blad'; blad: string }
  | { stan: 'gotowe'; adresy: Adres[] }

const LADOWANIE: StanAdresow = { stan: 'ladowanie' }
const wpisy = new Map<SlugMiasta, StanAdresow>()
const sluchacze = new Set<() => void>()

function powiadom() {
  for (const f of sluchacze) f()
}

function zaladuj(slug: SlugMiasta) {
  if (wpisy.has(slug)) return
  // Jedno miasto naraz w pamięci: adresy innych miast wypadają, żeby nie trzymać kilku po 25 MB.
  for (const [s, w] of wpisy) if (s !== slug && w.stan !== 'ladowanie') wpisy.delete(s)
  wpisy.set(slug, LADOWANIE)
  wczytajAdresy(bazaDanych(slug))
    .then((p): StanAdresow => ({ stan: 'gotowe', adresy: rozwinAdresy(p) }))
    .catch((e: unknown): StanAdresow => ({ stan: 'blad', blad: String(e) }))
    .then((s) => {
      wpisy.set(slug, s)
      powiadom()
    })
}

function stan(): StanAdresow {
  const slug = pobierzStan().miasto
  const pelne = daneJesliGotowe()
  if (pelne?.miasto === slug) return { stan: 'gotowe', adresy: pelne.adresy }
  zaladuj(slug)
  return wpisy.get(slug) ?? LADOWANIE
}

// Stabilna referencja dla useSyncExternalStore: nowy obiekt tylko, gdy zmienia się źródło adresów.
let ostatni: StanAdresow = LADOWANIE
function migawka(): StanAdresow {
  const s = stan()
  if (s.stan === 'gotowe' && ostatni.stan === 'gotowe' && s.adresy === ostatni.adresy)
    return ostatni
  if (s.stan !== 'gotowe' && s === ostatni) return ostatni
  ostatni = s
  return s
}

function subskrybuj(f: () => void) {
  sluchacze.add(f)
  const odStanu = subskrybujStan(f)
  return () => {
    sluchacze.delete(f)
    odStanu()
  }
}

/** Adresy bieżącego miasta: z pełnych danych, gdy są, inaczej z osobnego, lekkiego pobrania. */
export function useAdresyMiasta(): StanAdresow {
  return useSyncExternalStore(subskrybuj, migawka, migawka)
}
