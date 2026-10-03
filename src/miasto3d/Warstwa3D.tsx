// Budynki 3D na mapie głównej: ta sama scena co w `?pokaz`, ale nałożona na istniejącą mapę.
// Ciężki moduł (deck.gl) – MapaKrakowa ładuje go leniwie dopiero przy dużym zoomie albo po
// wybraniu adresu, więc pierwsze wejście na stronę go nie pobiera. Godzina i dzień cienia
// otwierają się w okienku na mapie, nie w panelu bocznym (tam zostają ustawienia silnika).
import { SolidPolygonLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import type { Map as MapaLibre } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { useDane } from '@/wynik/dane'
import { useStan } from '@/wynik/stan'
import { policzWyniki } from '@/wynik/useWyniki'
import { type BudynkiOkolicy, wczytajBudynkiWokol } from './kontrakt'
import { budynekAdresu, budynkiOkolicy } from './laczenie'
import './miasto3d.css'
import { dymek, efektSwiatla, warstwy, ziemia } from './Okolica3D'
import { PanelCienia, useSwiatlo } from './PanelCienia'

const NACHYLENIE_3D = 55

export default function Warstwa3D({
  mapa,
  lon,
  lat,
}: {
  mapa: MapaLibre
  /** Środek okolicy: wybrany adres albo środek widoku. */
  lon: number
  lat: number
}) {
  const dane = useDane()
  const wybrany = useStan((s) => s.wybrany)
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const nakladkaRef = useRef<MapboxOverlay | null>(null)
  const [budynkiDane, setBudynkiDane] = useState<BudynkiOkolicy | null>(null)
  const [otwarte, setOtwarte] = useState(false)

  // Nakładka i nachylenie kamery na czas trybu 3D; po wyjściu mapa wraca do widoku z góry.
  useEffect(() => {
    const nakladka = new MapboxOverlay({ interleaved: false, layers: [] })
    mapa.addControl(nakladka)
    nakladkaRef.current = nakladka
    if (mapa.getPitch() < 20) mapa.easeTo({ pitch: NACHYLENIE_3D, duration: 600 })
    return () => {
      nakladkaRef.current = null
      mapa.removeControl(nakladka)
      if (mapa.getPitch() > 0) mapa.easeTo({ pitch: 0, bearing: 0, duration: 400 })
    }
  }, [mapa])

  useEffect(() => {
    let aktualne = true
    wczytajBudynkiWokol(lon, lat).then(
      (d) => aktualne && setBudynkiDane(d),
      () => aktualne && setBudynkiDane(null),
    )
    return () => {
      aktualne = false
    }
  }, [lon, lat])

  const adres = dane.stan === 'gotowe' && wybrany !== null ? dane.adresy[wybrany] : null
  const budynki =
    dane.stan === 'gotowe' && budynkiDane
      ? budynkiOkolicy(
          budynkiDane.budynki,
          dane.adresy,
          policzWyniki(dane, wagi, kierunki, 'wynik').naAdres,
          lon,
          lat,
        )
      : []
  const wybranyBudynek = adres ? budynekAdresu(budynki, adres) : null
  const swiatlo = useSwiatlo(lon, lat)
  const s = swiatlo.swiatlo
  const cien = s?.cien === true && !s.noc

  useEffect(() => {
    nakladkaRef.current?.setProps({
      layers: [
        ...(cien
          ? [
              new SolidPolygonLayer<[number, number][]>({
                id: 'ziemia',
                data: [ziemia(lon, lat)],
                getPolygon: (p) => p,
                getFillColor: [0, 0, 0, 0],
              }),
            ]
          : []),
        ...warstwy(budynki, wybranyBudynek),
      ],
      getTooltip: dymek,
    })
  }, [budynki, wybranyBudynek, cien, lon, lat])

  const znacznik = s?.znacznik
  const noc = s?.noc
  const zSlonca = s !== null
  useEffect(() => {
    nakladkaRef.current?.setProps({
      effects: [
        efektSwiatla(
          zSlonca && znacznik !== undefined ? { znacznik, cien, noc: noc === true } : null,
        ),
      ],
    })
  }, [zSlonca, znacznik, cien, noc])

  useEffect(() => {
    if (!otwarte) return
    const klawisz = (e: KeyboardEvent) => e.key === 'Escape' && setOtwarte(false)
    window.addEventListener('keydown', klawisz)
    return () => window.removeEventListener('keydown', klawisz)
  }, [otwarte])

  if (budynki.length === 0 || swiatlo.lekki) return null

  return (
    <div className="m3d-pora">
      <button
        type="button"
        className="m3d-pora-przycisk"
        aria-expanded={otwarte}
        aria-haspopup="dialog"
        onClick={() => setOtwarte((o) => !o)}
      >
        ☀ Pora dnia i roku
      </button>
      {otwarte && (
        <div className="m3d-pora-okno" role="dialog" aria-label="Cień o wybranej porze">
          <button
            type="button"
            className="m3d-pora-zamknij"
            aria-label="Zamknij"
            onClick={() => setOtwarte(false)}
          >
            ×
          </button>
          <PanelCienia {...swiatlo} />
        </div>
      )}
    </div>
  )
}
