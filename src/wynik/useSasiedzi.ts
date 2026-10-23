// Hooki „Lepszego sąsiada” (#94) – łączą wspólny stan (sasiedziStan.ts) z danymi i wagami.
// Osobny plik, bo dane.ts czyta `import.meta.env`, a sasiedziStan.ts testujemy w gołym Node.
// Bez pełnych danych (karta okolicy i Szukaj na kompakcie, #247 B7b) adresy w promieniu 500 m biorą
// się z kafli wokół adresu wyjściowego i są liczone tą samą funkcją (`sasiedziZKafli.ts`).

import { useEffect, useState } from 'react'
import { bazaDanych } from '@/kontrakty'
import { kafleWokol } from '../miasto3d/adresyZKafli.ts'
import { useDane } from './dane.ts'
import { type KafelGotowy, useAdresKompakt, wczytajKafel } from './kafle.ts'
import { useDaneHeksow } from './kompaktBiezacy.ts'
import { type AdresSasiada, type LepsiSasiedzi, PROMIEN_SASIADA_M } from './sasiedzi.ts'
import {
  type PropsSasiadowMapy,
  propsSasiadowMapy,
  sasiedziOtwartej,
  sasiedziOtwartejKafli,
  useStanSasiadow,
  type WejscieSasiadow,
  wybranyKandydat,
} from './sasiedziStan.ts'
import { zbiorZKafliPamiec } from './sasiedziZKafli.ts'
import { useStan } from './stan.ts'
import { wczytajSkaleKafli } from './startKompakt.ts'

export interface SasiedziKarty {
  /** Sekcja otwarta dla adresu wybranego w aplikacji. */
  otwarta: boolean
  /** null = sekcja zamknięta albo dane jeszcze się wczytują. */
  wynik: LepsiSasiedzi | null
  /** Pozycja podświetlonego kandydata albo null. */
  wybrany: number | null
}

/** Zapas ponad promień sąsiada: kafel r8 ma ok. 0,9 km, a siatka próbek 250 m (patrz `kafleWokol`). */
const ZAPAS_KAFLI_M = 250

/**
 * Kafle pokrywające promień sąsiada wokół adresu `zrodlo` (pozycja w adresy.json), pobierane dopiero
 * gdy `zrodlo` nie jest null. null do czasu wczytania kafli. Kafel samego adresu musi już być w pamięci
 * (wybór adresu go wczytuje) – stąd środek okręgu.
 */
function useKafleSasiadow(zrodlo: number | null): readonly KafelGotowy[] | null {
  const hk = useDaneHeksow()
  const adres = useAdresKompakt(zrodlo)
  const indeks = hk.stan === 'gotowe' ? hk.indeks : null
  const miasto = hk.stan === 'gotowe' ? hk.miasto : null
  const lon = adres?.lon ?? null
  const lat = adres?.lat ?? null
  const klucz = miasto !== null && lon !== null && lat !== null ? `${miasto}:${lon}:${lat}` : null
  const [wczytane, ustaw] = useState<{ klucz: string; kafle: readonly KafelGotowy[] } | null>(null)
  useEffect(() => {
    if (!indeks || !miasto || lon === null || lat === null || klucz === null) return
    let aktualne = true
    wczytajSkaleKafli(miasto, indeks)
      .then((skale) =>
        Promise.all(
          kafleWokol(indeks, lon, lat, PROMIEN_SASIADA_M + ZAPAS_KAFLI_M).map((w) =>
            wczytajKafel(bazaDanych(miasto), w, skale),
          ),
        ),
      )
      .then(
        (kafle) => aktualne && ustaw({ klucz, kafle }),
        (e: unknown) => console.warn('Kafle sąsiadów niedostępne', e),
      )
    return () => {
      aktualne = false
    }
  }, [indeks, miasto, lon, lat, klucz])
  return wczytane && wczytane.klucz === klucz ? wczytane.kafle : null
}

const BRAK_ADRESOW: readonly AdresSasiada[] = []

/** Karta i mapa liczą z jednego miejsca: wynik sekcji i adresy, pod którymi leżą pozycje kandydatów. */
function useSasiedziIAdresy(): { karta: SasiedziKarty; adresy: readonly AdresSasiada[] } {
  const dane = useDane()
  const wybranyAdres = useStan((s) => s.wybrany)
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const filtry = useStan((s) => s.filtry)
  const zrodlo = useStanSasiadow((s) => s.zrodlo)
  const wybrany = useStanSasiadow((s) => s.wybrany)
  const pelne = dane.stan === 'gotowe'
  // Kafle tylko przy otwartej sekcji i bez pełnych danych: zamknięta sekcja niczego nie pobiera.
  const kafle = useKafleSasiadow(pelne ? null : zrodlo)
  const zbior = kafle ? zbiorZKafliPamiec(kafle) : null
  const wejscie: WejscieSasiadow | null = pelne
    ? { adresy: dane.adresy, wskazniki: dane.wskazniki, wagi, kierunki, filtry }
    : null
  const s = { zrodlo, wybrany }
  const wynik = pelne
    ? sasiedziOtwartej(s, wybranyAdres, wejscie)
    : sasiedziOtwartejKafli(s, wybranyAdres, zbior ? { zbior, wagi, kierunki, filtry } : null)
  return {
    karta: {
      otwarta: zrodlo !== null && zrodlo === wybranyAdres,
      wynik,
      wybrany: wybranyKandydat(s, wynik),
    },
    adresy: pelne ? dane.adresy : (zbior?.poI ?? BRAK_ADRESOW),
  }
}

/** Stan sekcji i bieżąca lista kandydatów; zmiana wag, kierunków albo filtrów liczy ją od nowa. */
export function useLepsiSasiedzi(): SasiedziKarty {
  return useSasiedziIAdresy().karta
}

/**
 * Propsy dla znaczników na mapie (#95). Integrator podaje je komponentowi mapy:
 * `const sasiedzi = usePropsSasiadowMapy()` → `<ZnacznikiSasiadow {...sasiedzi} />`.
 */
export function usePropsSasiadowMapy(): PropsSasiadowMapy {
  const { karta, adresy } = useSasiedziIAdresy()
  const zrodlo = useStanSasiadow((s) => s.zrodlo)
  const wybrany = useStanSasiadow((s) => s.wybrany)
  return propsSasiadowMapy({ zrodlo, wybrany }, karta.wynik, adresy)
}
