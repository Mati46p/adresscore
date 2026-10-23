// Kafle kompaktu wokół punktu dla sceny 3D bez pełnych danych (#247, B7b). To samo robi `Warstwa3D` dla
// mapy głównej; tu wersja dla karty okolicy (`Okolica3D`). null do czasu wczytania kafli.
import { useEffect, useState } from 'react'
import { bazaDanych } from '@/kontrakty'
import type { KafelGotowy } from '@/wynik/kafle'
import { wczytajKafel } from '@/wynik/kafle'
import { useDaneHeksow } from '@/wynik/kompaktBiezacy'
import { wczytajSkaleKafli } from '@/wynik/startKompakt'
import { kafleWokol } from './adresyZKafli'

/** Kafle okolicy punktu (`lon`, `lat`); pobierane tylko gdy `aktywne` (brak pełnych danych) i punkt znany. */
export function useKafleOkolicy(
  lon: number | null,
  lat: number | null,
  aktywne: boolean,
): readonly KafelGotowy[] | null {
  const hk = useDaneHeksow()
  const indeks = hk.stan === 'gotowe' ? hk.indeks : null
  const miasto = hk.stan === 'gotowe' ? hk.miasto : null
  const klucz = miasto !== null && lon !== null && lat !== null ? `${miasto}:${lon}:${lat}` : null
  const [wczytane, ustaw] = useState<{ klucz: string; kafle: readonly KafelGotowy[] } | null>(null)
  useEffect(() => {
    if (!aktywne || !indeks || !miasto || lon === null || lat === null || klucz === null) return
    let aktualne = true
    wczytajSkaleKafli(miasto, indeks)
      .then((skale) =>
        Promise.all(
          kafleWokol(indeks, lon, lat).map((w) => wczytajKafel(bazaDanych(miasto), w, skale)),
        ),
      )
      .then(
        (kafle) => aktualne && ustaw({ klucz, kafle }),
        (e: unknown) => console.warn('Kafle okolicy budynków niedostępne', e),
      )
    return () => {
      aktualne = false
    }
  }, [aktywne, indeks, miasto, lon, lat, klucz])
  return wczytane && wczytane.klucz === klucz ? wczytane.kafle : null
}
