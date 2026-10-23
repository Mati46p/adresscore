// Lista warstw dla strony Metoda bez pełnych danych (#247, B7b): meta z manifestu kompaktu, pokrycie
// z `indeks.wskazniki[id].pokrycie`. Logika bez Reacta: `warstwyMetodyLogika.ts` (z testem).
import { useEffect } from 'react'
import { pozwolNaPelneDane, useDane } from '@/wynik/dane'
import { useDaneHeksow } from '@/wynik/kompaktBiezacy'
import { przegladMenedzer } from '@/wynik/przeglad'
import { useStan } from '@/wynik/stan'
import { metaWarstw } from '@/wynik/startKompakt'
import { type WarstwaMetody, warstwyZKompaktu, warstwyZPelnych } from './warstwyMetodyLogika'

export type StanWarstwMetody =
  | { stan: 'ladowanie' }
  | { stan: 'blad'; blad: string }
  | { stan: 'gotowe'; warstwy: WarstwaMetody[] }

/** Warstwy do tabeli źródeł: z pełnych danych, gdy już są, inaczej z kompaktu; stary kompakt otwiera pełne dane. */
export function useWarstwyMetody(): StanWarstwMetody {
  const dane = useDane()
  const miasto = useStan((s) => s.miasto)
  useEffect(() => {
    // Wpis przeglądu miasta (indeks i manifest) bez żadnych warstw heksów.
    przegladMenedzer.zazadaj(miasto, new Map())
  }, [miasto])
  const hk = useDaneHeksow()
  const stanKompaktu = hk.stan
  useEffect(() => {
    if (stanKompaktu === 'brak') pozwolNaPelneDane()
  }, [stanKompaktu])
  if (dane.stan === 'gotowe') return { stan: 'gotowe', warstwy: warstwyZPelnych(dane.wskazniki) }
  if (dane.stan === 'blad') return { stan: 'blad', blad: dane.blad }
  if (hk.stan === 'gotowe')
    return { stan: 'gotowe', warstwy: warstwyZKompaktu(metaWarstw(hk.manifest), hk.indeks) }
  return { stan: 'ladowanie' }
}
