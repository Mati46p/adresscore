// Hooki „Lepszego sąsiada” (#94) – łączą wspólny stan (sasiedziStan.ts) z danymi i wagami.
// Osobny plik, bo dane.ts czyta `import.meta.env`, a sasiedziStan.ts testujemy w gołym Node.

import { useDane } from './dane.ts'
import type { LepsiSasiedzi } from './sasiedzi.ts'
import {
  type PropsSasiadowMapy,
  propsSasiadowMapy,
  sasiedziOtwartej,
  useStanSasiadow,
  type WejscieSasiadow,
  wybranyKandydat,
} from './sasiedziStan.ts'
import { useStan } from './stan.ts'

export interface SasiedziKarty {
  /** Sekcja otwarta dla adresu wybranego w aplikacji. */
  otwarta: boolean
  /** null = sekcja zamknięta albo dane jeszcze się wczytują. */
  wynik: LepsiSasiedzi | null
  /** Pozycja podświetlonego kandydata albo null. */
  wybrany: number | null
}

/** Stan sekcji i bieżąca lista kandydatów; zmiana wag, kierunków albo filtrów liczy ją od nowa. */
export function useLepsiSasiedzi(): SasiedziKarty {
  const dane = useDane()
  const wybranyAdres = useStan((s) => s.wybrany)
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const filtry = useStan((s) => s.filtry)
  const zrodlo = useStanSasiadow((s) => s.zrodlo)
  const wybrany = useStanSasiadow((s) => s.wybrany)
  const wejscie: WejscieSasiadow | null =
    dane.stan === 'gotowe'
      ? { adresy: dane.adresy, wskazniki: dane.wskazniki, wagi, kierunki, filtry }
      : null
  const s = { zrodlo, wybrany }
  const wynik = sasiedziOtwartej(s, wybranyAdres, wejscie)
  return {
    otwarta: zrodlo !== null && zrodlo === wybranyAdres,
    wynik,
    wybrany: wybranyKandydat(s, wynik),
  }
}

/**
 * Propsy dla znaczników na mapie (#95). Integrator podaje je komponentowi mapy:
 * `const sasiedzi = usePropsSasiadowMapy()` → `<ZnacznikiSasiadow {...sasiedzi} />`.
 */
export function usePropsSasiadowMapy(): PropsSasiadowMapy {
  const dane = useDane()
  const { wynik } = useLepsiSasiedzi()
  const zrodlo = useStanSasiadow((s) => s.zrodlo)
  const wybrany = useStanSasiadow((s) => s.wybrany)
  return propsSasiadowMapy({ zrodlo, wybrany }, wynik, dane.stan === 'gotowe' ? dane.adresy : [])
}
