// Karta okolicy bez pełnych danych (#247, B7b): dba, żeby kafel wybranego adresu był w pamięci, gdy
// ekran otwarto linkiem albo „Otwórz kartę” przy sąsiedzie (kafla nie wczytał wtedy klik w mapę).
// Kafel wybranego adresu i porównania zostaje przypięty w LRU. Gdy kafla nie da się znaleźć (stary
// `id.bin` bez `kolejnosc`, błąd sieci), karta wraca do pełnych danych – tak samo jak Szukaj.
import { useEffect } from 'react'
import { bazaDanych } from '@/kontrakty'
import { pozwolNaPelneDane, useDane } from './dane.ts'
import {
  kafelAdresu,
  przypnijAdresy,
  useKafelAdresu,
  wczytajKafel,
  wczytajMapeAdresow,
} from './kafle.ts'
import { useDaneHeksow } from './kompaktBiezacy.ts'
import { useStan } from './stan.ts'
import { wczytajSkaleKafli } from './startKompakt.ts'

/** Wczytuje kafel adresu `i` (pozycja w adresy.json), jeśli go nie ma; przy niepowodzeniu otwiera pełne dane. */
export function useKafelWybranego(i: number | null) {
  const hk = useDaneHeksow()
  const pelne = useDane().stan === 'gotowe'
  const porownanie = useStan((s) => s.porownanie)
  const wPamieci = useKafelAdresu(i) !== null
  const indeks = hk.stan === 'gotowe' ? hk.indeks : null
  const miasto = hk.stan === 'gotowe' ? hk.miasto : null

  useEffect(() => {
    przypnijAdresy(i === null ? porownanie : [i, ...porownanie])
  }, [i, porownanie])

  useEffect(() => {
    if (pelne || i === null || wPamieci || !indeks || !miasto) return
    let aktualne = true
    const baza = bazaDanych(miasto)
    Promise.all([wczytajMapeAdresow(baza, indeks), wczytajSkaleKafli(miasto, indeks)])
      .then(([mapa, skale]) => {
        const wpis = mapa ? kafelAdresu(indeks, i, mapa) : null
        if (!wpis) throw new Error(`Brak kafla adresu ${i} w kompakcie`)
        return wczytajKafel(baza, wpis, skale)
      })
      .catch((e: unknown) => {
        if (!aktualne) return
        console.warn('Kafel adresu niedostępny, wracam do pełnych danych', e)
        pozwolNaPelneDane()
      })
    return () => {
      aktualne = false
    }
  }, [pelne, i, wPamieci, indeks, miasto])
}
