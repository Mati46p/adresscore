// Hook B5 (#247): ranking ulic bez pełnych danych. Najpierw przybliżenie z heksów (od ręki), po dojściu
// kafli wynik dokładny. Logika: `rankingKompakt.ts`. Każda zmiana wejść (wagi, kierunki, warstwa, filtry,
// budżet, miasto, dane) przerywa trwające wczytywanie, a przerwany przebieg niczego nie zapisuje, więc
// starszy wynik nie nadpisze nowszego.
import { useEffect, useState } from 'react'
import type { PlikOkolic } from '@/kontrakty'
import { bazaDanych } from '@/kontrakty'
import { filtryZBudzetem } from './budzet.ts'
import { skaleKafli, wczytajKafel } from './kafle.ts'
import { useDaneHeksow } from './kompaktBiezacy.ts'
import { pozycjeZPrzyblizenia, przyblizenieUlic, rankingKompakt } from './rankingKompakt.ts'
import type { PozycjaUlicy } from './rankingUlic.ts'
import type { Skala } from './silnik.ts'
import { useStan } from './stan.ts'
import { useWynikiMapy } from './useWynikiMapy.ts'

export interface RankingKompaktu {
  ulice: PozycjaUlicy[]
  /**
   * true = przybliżenie z heksów: kolejność i wyniki orientacyjne, a pozycje nie mają prawdziwego sluga
   * ani adresu do porównania (`slug` zaczyna się od „~”, `adresDoPorownania` = -1). Ekran nie robi z nich linków.
   */
  przyblizony: boolean
}

/** Ranking ulic z kompaktu; null, gdy dane heksów albo wyniki mapy nie są gotowe (ekran wraca do `useDane()`). */
export function useRankingKompakt(
  ile = 5,
  okolice: PlikOkolic | null = null,
): RankingKompaktu | null {
  const dane = useDaneHeksow()
  const wyniki = useWynikiMapy()
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const warstwa = useStan((s) => s.warstwa)
  const filtry = useStan((s) => s.filtry)
  const budzet = useStan((s) => s.budzet)
  const tryb = useStan((s) => s.tryb)
  const razem = tryb === 'biznes' ? filtry : filtryZBudzetem(filtry, budzet)
  const [ranking, ustaw] = useState<RankingKompaktu | null>(null)

  useEffect(() => {
    if (dane.stan !== 'gotowe' || !wyniki) {
      ustaw(null)
      return
    }
    const kontrola = new AbortController()
    const { signal } = kontrola
    const { podstawa, indeks } = dane
    ustaw({
      ulice: pozycjeZPrzyblizenia(przyblizenieUlic(podstawa, wyniki), ile),
      przyblizony: true,
    })
    // Skale przychodzą jednym plikiem (`skale.<skrót>.json`); zanim dojdzie, zostaje przybliżenie, a
    // dojście pliku odświeża `dane`, więc ten efekt rusza ponownie.
    const skale: Record<string, Skala> = {}
    for (const id of Object.keys(indeks.wskazniki)) {
      const s = dane.skala(id)
      if (s) skale[id] = s
    }
    if (Object.keys(skale).length === 0) return () => kontrola.abort()
    const baza = bazaDanych(dane.miasto)
    const skaleKaf = skaleKafli(indeks, skale)
    rankingKompakt({
      podstawa,
      indeks,
      wyniki,
      wagi,
      kierunki,
      warstwa,
      filtry: razem,
      wczytaj: (wpis, sig) => wczytajKafel(baza, wpis, skaleKaf, { signal: sig }),
      okolice,
      ile,
      signal,
    }).then(
      (wynik) => {
        if (!signal.aborted) ustaw({ ulice: wynik.ulice, przyblizony: false })
      },
      (e: unknown) => {
        // Przerwanie to zwykła zmiana wejść; awaria sieci zostawia przybliżenie.
        if (!signal.aborted) console.warn('Ranking ulic z kafli niedostępny', e)
      },
    )
    return () => kontrola.abort()
  }, [dane, wyniki, wagi, kierunki, warstwa, razem, ile, okolice])

  return ranking
}
