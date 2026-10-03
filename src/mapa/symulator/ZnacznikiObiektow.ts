// Obiekty symulatora na mapie (#97): hipotetyczny przystanek, sklep, punkt zdrowia, schron.
// Romb, nie koło jak znaczniki z rejestrów – od razu widać, że obiektu nie ma naprawdę.
//
// - Mysz i dotyk: przeciągnięcie przesuwa (`onPrzesun` po puszczeniu).
// - Klawiatura: znacznik to `<button>`; strzałki przesuwają o 10 m (z Shift o 50 m),
//   Delete albo Backspace usuwa. Fokus zostaje na znaczniku po przesunięciu.
// - Klik w znacznik nie stawia nowego obiektu – `MapaKrakowa` pomija kliki z `.mapa-obiekt`.
import { type Map as MapaLibre, Marker } from 'maplibre-gl'
import { type RefObject, useEffect, useRef } from 'react'
import './obiekty.css'

export interface ObiektNaMapie {
  /** Stały klucz obiektu (np. „a-0”): ten sam klucz = ten sam znacznik, fokus nie ginie. */
  klucz: string
  lon: number
  lat: number
  /** Jedna litera w rombie. */
  znak: string
  /** Pełny opis dla czytnika ekranu i dymka, np. „Hipotetyczny przystanek, wariant A”. */
  opis: string
  /** Wariant B rysujemy innym kolorem. */
  wariant: 'a' | 'b'
}

export interface ObiektyNaMapie {
  lista: readonly ObiektNaMapie[]
  onPrzesun: (klucz: string, lon: number, lat: number) => void
  onUsun: (klucz: string) => void
}

/** Krok klawiatury w metrach. */
export const KROK_M = 10
export const KROK_SHIFT_M = 50
const M_NA_STOPIEN = 111_320

/** Przesunięcie o metry na wschód (dx) i północ (dy). */
export function przesunOMetry(lon: number, lat: number, dx: number, dy: number): [number, number] {
  return [lon + dx / (M_NA_STOPIEN * Math.cos((lat * Math.PI) / 180)), lat + dy / M_NA_STOPIEN]
}

const KIERUNKI: Readonly<Record<string, [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
}

interface Wpis {
  marker: Marker
  przycisk: HTMLButtonElement
}

function opiszPrzycisk(p: HTMLButtonElement, o: ObiektNaMapie) {
  p.querySelector('.mapa-obiekt__znak')?.replaceChildren(o.znak)
  p.classList.toggle('mapa-obiekt--b', o.wariant === 'b')
  p.setAttribute(
    'aria-label',
    `${o.opis}. Strzałki przesuwają o ${KROK_M} m, z Shift o ${KROK_SHIFT_M} m, Delete usuwa.`,
  )
  p.title = o.opis
}

export function useZnacznikiObiektow(
  mapaRef: RefObject<MapaLibre | null>,
  gotowa: boolean,
  obiekty: ObiektyNaMapie | undefined,
): void {
  const obiektyRef = useRef(obiekty)
  const wpisyRef = useRef(new Map<string, Wpis>())
  useEffect(() => {
    obiektyRef.current = obiekty
  })

  // Klucz treści: nowa tablica z tymi samymi obiektami nie rusza znaczników.
  const klucz = JSON.stringify(obiekty?.lista ?? [])

  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa || !gotowa) return
    const wpisy = wpisyRef.current
    const lista = obiektyRef.current?.lista ?? []
    const obecne = new Set(lista.map((o) => o.klucz))
    for (const [k, w] of wpisy) {
      if (obecne.has(k)) continue
      w.marker.remove()
      wpisy.delete(k)
    }
    for (const o of lista) {
      let w = wpisy.get(o.klucz)
      if (!w) {
        const przycisk = document.createElement('button')
        przycisk.type = 'button'
        przycisk.className = 'mapa-obiekt'
        const znak = document.createElement('span')
        znak.className = 'mapa-obiekt__znak'
        przycisk.append(znak)
        const marker = new Marker({ element: przycisk, anchor: 'center', draggable: true })
          .setLngLat([o.lon, o.lat])
          .addTo(mapa)
        const k = o.klucz
        marker.on('dragend', () => {
          const p = marker.getLngLat()
          obiektyRef.current?.onPrzesun(k, p.lng, p.lat)
        })
        przycisk.addEventListener('keydown', (e) => {
          const biezacy = obiektyRef.current?.lista.find((x) => x.klucz === k)
          if (!biezacy) return
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault()
            obiektyRef.current?.onUsun(k)
            return
          }
          const kierunek = KIERUNKI[e.key]
          if (!kierunek) return
          // Strzałki nie mogą przesuwać mapy pod spodem.
          e.preventDefault()
          e.stopPropagation()
          const krok = e.shiftKey ? KROK_SHIFT_M : KROK_M
          const [lon, lat] = przesunOMetry(
            biezacy.lon,
            biezacy.lat,
            kierunek[0] * krok,
            kierunek[1] * krok,
          )
          obiektyRef.current?.onPrzesun(k, lon, lat)
        })
        w = { marker, przycisk }
        wpisy.set(k, w)
      }
      const p = w.marker.getLngLat()
      if (p.lng !== o.lon || p.lat !== o.lat) w.marker.setLngLat([o.lon, o.lat])
      opiszPrzycisk(w.przycisk, o)
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
