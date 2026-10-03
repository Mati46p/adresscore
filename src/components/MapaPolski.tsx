import { Map as MapaLibre, NavigationControl } from 'maplibre-gl'
import { useEffect, useRef } from 'react'

// Środek i obrys Polski – start widoku kraju, zanim użytkownik poda adres.
const SRODEK_POLSKI: [number, number] = [19.4, 52.0]
const GRANICE_POLSKI: [[number, number], [number, number]] = [
  [14.0, 49.0],
  [24.2, 54.9],
]

// Darmowe kafle OpenFreeMap bez klucza; do zamiany na własne PMTiles.
const STYL_MAPY = 'https://tiles.openfreemap.org/styles/positron'

export function MapaPolski() {
  const kontener = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!kontener.current) return
    const mapa = new MapaLibre({
      container: kontener.current,
      style: STYL_MAPY,
      center: SRODEK_POLSKI,
      zoom: 5.5,
    })
    mapa.fitBounds(GRANICE_POLSKI, { padding: 24, animate: false })
    mapa.addControl(new NavigationControl(), 'bottom-right')
    return () => mapa.remove()
  }, [])

  return <div ref={kontener} className="mapa" role="region" aria-label="Mapa Polski" />
}
