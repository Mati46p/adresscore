import type { CameraOptions, Map as MapaLibre } from 'maplibre-gl'
import { POZIOMY } from '@/mapa/geometria'

// Lot kamery (#19): Polska we mgle → Kraków → adres. Wszystkie loty mapy idą przez `lec`,
// żeby miały tę samą krzywą i tempo, a przy prefers-reduced-motion skakały bez animacji.

/** Polska z małym zapasem – kadr intro. */
export const WIDOK_POLSKI: [[number, number], [number, number]] = [
  [14.0, 48.9],
  [24.2, 54.9],
]
/** Zapasowy kadr Krakowa, gdy lot rusza przed obrysem danych (klik „Pokaż Kraków"). */
export const WIDOK_KRAKOWA: [[number, number], [number, number]] = [
  [19.6, 49.9],
  [20.3, 50.25],
]

// Krzywa domyślna MapLibre, tempo wolniejsze od domyślnego 1,2: przy 1,2 lot z kraju trwał
// 1,7 s i Kraków „wyskakiwał". Przy 0,8 lot z kraju trwa ok. 2,5 s, lot do adresu ok. 1–2 s.
const KRZYWA = 1.42
const TEMPO = 0.8
const MAKS_CZAS = 4500
/** Przerwa na obejrzenie Polski między załadowaniem danych a startem lotu. */
export const PAUZA_PRZED_LOTEM = 1200

const KLUCZ_SESJI = 'adresscore:lot-startowy'
// sessionStorage bywa niedostępny (tryb prywatny, zablokowane dane) – wtedy pamięta moduł.
let lotWykonany = false

export function ograniczonyRuch(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Intro tylko w linku do prezentacji (`?pokaz`), raz na sesję. Strona główna startuje w Krakowie. */
export function introDoPokazania(): boolean {
  if (lotWykonany) return false
  try {
    if (!new URLSearchParams(window.location.search).has('pokaz')) return false
    return sessionStorage.getItem(KLUCZ_SESJI) === null
  } catch {
    return false
  }
}

export function zapamietajLotStartowy(): void {
  lotWykonany = true
  try {
    sessionStorage.setItem(KLUCZ_SESJI, '1')
  } catch {
    // Pamięć modułu wystarczy do końca karty.
  }
}

// Przy zoomie poniżej 13 nie widać r10, a w trakcie lotu MapLibre i tak kafelkowałby ok. 35 tys.
// heksów przy przejściu przez próg. Dlatego lot rysuje tylko r8/r9; r10 wraca po zatrzymaniu.
const R10 = POZIOMY[2]

function widocznoscR10(mapa: MapaLibre, widoczne: boolean) {
  const zrodlo = `heksy-r${R10.res}`
  for (const warstwa of mapa.getStyle()?.layers ?? []) {
    if (!('source' in warstwa) || warstwa.source !== zrodlo) continue
    mapa.setLayoutProperty(warstwa.id, 'visibility', widoczne ? 'visible' : 'none')
  }
}

/**
 * Lot do celu. Gest użytkownika przerywa go (MapLibre zatrzymuje animację), a `moveend`
 * przychodzi także wtedy – po nim zawsze wraca r10. Zwraca obietnicę końca ruchu.
 */
export function lec(mapa: MapaLibre, cel: CameraOptions): Promise<void> {
  if (ograniczonyRuch()) {
    mapa.jumpTo(cel)
    return Promise.resolve()
  }
  const ukryjR10 = mapa.getZoom() < R10.minzoom && mapa.isStyleLoaded()
  // Nowy lot zatrzymuje poprzedni; jego `moveend` przychodzi przed ukryciem poniżej.
  mapa.stop()
  if (ukryjR10) widocznoscR10(mapa, false)
  return new Promise((gotowe) => {
    mapa.once('moveend', () => {
      if (ukryjR10) widocznoscR10(mapa, true)
      gotowe()
    })
    mapa.flyTo({
      ...cel,
      curve: KRZYWA,
      speed: TEMPO,
      maxDuration: MAKS_CZAS,
      // Ruch ograniczamy sami wyżej; essential wyłącza drugi, niezależny test w MapLibre.
      essential: true,
    })
  })
}

/** Kamera dla obrysu danych; null, gdy mapa nie ma jeszcze wymiarów. */
export function kameraDlaGranic(
  mapa: MapaLibre,
  granice: [[number, number], [number, number]],
): CameraOptions | null {
  return mapa.cameraForBounds(granice, { padding: 32 }) ?? null
}

/** Poświata wokół obrysu danych: przy widoku kraju Kraków ma ok. 20 px i bez niej ginie we mgle. */
export function dodajWarstwyLotu(mapa: MapaLibre): void {
  mapa.addLayer(
    {
      id: 'obrys-poswiata',
      type: 'line',
      source: 'obrys',
      maxzoom: 10,
      paint: {
        'line-color': '#FFFFFF',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 14, 9, 4],
        'line-blur': ['interpolate', ['linear'], ['zoom'], 5, 10, 9, 3],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.95, 9.5, 0],
      },
    },
    // Pod przerywaną linią obrysu, nad mgłą.
    'obrys',
  )
}
