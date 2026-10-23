// Etykiety nad miastami w widoku kraju: ile różnych źródeł danych stoi za wynikiem miasta.
// Liczba z `manifest.json` miasta (unikalne nazwy źródeł wszystkich warstw), więc rośnie sama
// razem z ETL-em. Marker HTML jak podpis mgły: bez glifów i zewnętrznego serwera.
import { type Map as MapaLibre, Marker } from 'maplibre-gl'
import { type RefObject, useEffect } from 'react'
import { MEDIA_ARKUSZA } from '@/lib/punktyLamania'
import { bazaDanych, type Manifest, wczytajManifest } from '../kontrakty/index.ts'
import { MIASTA, type Miasto } from '../kontrakty/miasta.ts'

/** Od tego zoomu etykiety znikają: przy zbliżeniu zasłaniałyby heksy jednego miasta. */
export const ZOOM_ETYKIET_ZRODEL = 7

export function liczbaZrodel(manifest: Manifest): number {
  const nazwy = new Set<string>()
  for (const w of manifest.wskazniki) for (const z of w.zrodla) nazwy.add(z.nazwa)
  return nazwy.size
}

/** „1 źródło danych”, „3 źródła danych”, „12 źródeł danych”. */
export function podpisZrodel(n: number): string {
  const d = n % 10
  const s = n % 100
  const slowo = n === 1 ? 'źródło' : d >= 2 && d <= 4 && (s < 12 || s > 14) ? 'źródła' : 'źródeł'
  return `${n} ${slowo} danych`
}

export function useEtykietyZrodel(
  mapaRef: RefObject<MapaLibre | null>,
  gotowa: boolean,
  wlaczone: boolean,
): void {
  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa || !gotowa || !wlaczone) return
    const przerwanie = new AbortController()
    const znaczniki: Marker[] = []
    const pokazWgZoomu = () => {
      const ukryj =
        mapa.getZoom() >= ZOOM_ETYKIET_ZRODEL || window.matchMedia(MEDIA_ARKUSZA).matches
      for (const z of znaczniki) z.getElement().hidden = ukryj
    }
    const dodaj = (m: Miasto, manifest: Manifest) => {
      const n = liczbaZrodel(manifest)
      if (n === 0 || przerwanie.signal.aborted) return
      const el = document.createElement('div')
      el.className = 'mapa-zrodla-miasta'
      el.textContent = podpisZrodel(n)
      el.title = `${m.nazwa}: ${podpisZrodel(n)}`
      const z = new Marker({ element: el, anchor: 'bottom', offset: [0, -22] })
        .setLngLat(m.srodek)
        .addTo(mapa)
      znaczniki.push(z)
      pokazWgZoomu()
    }
    for (const m of MIASTA) {
      wczytajManifest(bazaDanych(m.slug), przerwanie.signal)
        .then((man) => dodaj(m, man))
        .catch(() => {
          // Brak manifestu = brak etykiety; miasto i tak pokazuje się jako brak danych.
        })
    }
    mapa.on('zoom', pokazWgZoomu)
    return () => {
      przerwanie.abort()
      mapa.off('zoom', pokazWgZoomu)
      for (const z of znaczniki) z.remove()
    }
  }, [mapaRef, gotowa, wlaczone])
}
