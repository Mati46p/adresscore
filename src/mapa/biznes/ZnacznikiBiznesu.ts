// Miejsca A–E trybu „Biznes” na mapie (#106).
//
// - Mysz i dotyk: przeciągnięcie przesuwa (`onPrzesun` po puszczeniu).
// - Klawiatura: znacznik to `<button>` z opisem dla czytnika; strzałki przesuwają o 10 m (z Shift
//   o 50 m), Delete albo Backspace usuwa. Fokus zostaje na znaczniku po przesunięciu, a po
//   usunięciu przechodzi na mapę, żeby nie wypaść poza stronę.
// - Klik w znacznik nie stawia nowego punktu – `MapaKrakowa` pomija kliki z `.mapa-punkt-biznesu`.
// Znaczniki są kluczowane literą A–E: ta sama litera = ten sam element, więc przy każdej zmianie
// współrzędnych przesuwamy istniejący znacznik zamiast go odtwarzać (nie ginie fokus).
import { type Map as MapaLibre, Marker } from 'maplibre-gl'
import { type RefObject, useEffect, useRef } from 'react'
import type { IdMiejsca } from '@/wynik/url'
import { opisZnacznika, type PunktBiznesuNaMapie, polecenieKlawisza } from './model'
import './znaczniki-biznesu.css'

interface Wpis {
  marker: Marker
  przycisk: HTMLButtonElement
}

export function useZnacznikiBiznesu(
  mapaRef: RefObject<MapaLibre | null>,
  gotowa: boolean,
  punkty: readonly PunktBiznesuNaMapie[],
  onPrzesun: ((id: IdMiejsca, lon: number, lat: number) => void) | undefined,
  onUsun: ((id: IdMiejsca) => void) | undefined,
): void {
  const punktyRef = useRef(punkty)
  const onPrzesunRef = useRef(onPrzesun)
  const onUsunRef = useRef(onUsun)
  const wpisyRef = useRef(new Map<IdMiejsca, Wpis>())
  useEffect(() => {
    punktyRef.current = punkty
    onPrzesunRef.current = onPrzesun
    onUsunRef.current = onUsun
  })

  // Klucz treści: nowa tablica z tymi samymi punktami nie rusza znaczników.
  const klucz = punkty.map((p) => `${p.id}:${p.lon}:${p.lat}`).join('|')

  useEffect(() => {
    const mapa = mapaRef.current
    const wpisy = wpisyRef.current
    if (!mapa || !gotowa) {
      // Mapa zniknęła (albo jeszcze jej nie ma): znaczniki starej mapy nie mają do czego wracać.
      for (const w of wpisy.values()) w.marker.remove()
      wpisy.clear()
      return
    }
    const lista = punktyRef.current
    const obecne = new Set(lista.map((p) => p.id))
    for (const [id, w] of wpisy) {
      if (obecne.has(id)) continue
      w.marker.remove()
      wpisy.delete(id)
    }
    for (const p of lista) {
      let w = wpisy.get(p.id)
      if (!w) {
        const przycisk = document.createElement('button')
        przycisk.type = 'button'
        przycisk.className = 'mapa-punkt-biznesu'
        const znak = document.createElement('span')
        znak.className = 'mapa-punkt-biznesu__znak'
        znak.setAttribute('aria-hidden', 'true')
        znak.textContent = p.id.toUpperCase()
        przycisk.append(znak)
        const marker = new Marker({ element: przycisk, anchor: 'center', draggable: true })
          .setLngLat([p.lon, p.lat])
          .addTo(mapa)
        const id = p.id
        marker.on('dragend', () => {
          const ll = marker.getLngLat()
          onPrzesunRef.current?.(id, ll.lng, ll.lat)
        })
        przycisk.addEventListener('keydown', (e) => {
          const biezacy = punktyRef.current.find((x) => x.id === id)
          if (!biezacy) return
          const polecenie = polecenieKlawisza(e.key, e.shiftKey, biezacy)
          if (!polecenie) return
          // Strzałki nie mogą przesuwać mapy pod spodem; Delete nie może cofać strony.
          e.preventDefault()
          e.stopPropagation()
          if (polecenie.rodzaj === 'usun') {
            onUsunRef.current?.(id)
            // Element znika wraz ze znacznikiem – fokus wraca na mapę, a nie na <body>.
            queueMicrotask(() => mapaRef.current?.getCanvas().focus())
            return
          }
          onPrzesunRef.current?.(id, polecenie.lon, polecenie.lat)
        })
        w = { marker, przycisk }
        wpisy.set(id, w)
      }
      const polozenie = w.marker.getLngLat()
      if (polozenie.lng !== p.lon || polozenie.lat !== p.lat) w.marker.setLngLat([p.lon, p.lat])
      w.przycisk.setAttribute('aria-label', opisZnacznika(p))
      w.przycisk.title = `Miejsce ${p.id.toUpperCase()}`
    }
  }, [mapaRef, gotowa, klucz])

  useEffect(
    () => () => {
      for (const w of wpisyRef.current.values()) w.marker.remove()
      wpisyRef.current.clear()
    },
    [],
  )
}
