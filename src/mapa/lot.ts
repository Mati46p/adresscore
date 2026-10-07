import type { CameraOptions, Map as MapaLibre } from 'maplibre-gl'
// Importy względne z `.ts` (nie `@/`): kadry poniżej są czystymi funkcjami i mają test na gołym
// `node --test` (lot.test.ts), a Node nie zna aliasu. Reszta pliku dotyka mapy tylko w funkcjach.
import { MIASTA, miasto, type SlugMiasta } from '../kontrakty/miasta.ts'
import { POZIOMY, type Ramka } from './geometria.ts'

// Lot kamery (#19): Polska we mgle → bieżące miasto → adres. Wszystkie loty mapy idą przez `lec`,
// żeby miały tę samą krzywą i tempo, a przy prefers-reduced-motion skakały bez animacji.

/** Polska z małym zapasem – kadr intro. */
export const WIDOK_POLSKI: Ramka = [
  [14.0, 48.9],
  [24.2, 54.9],
]

/**
 * Granice, poza które kamera nie wyjedzie (`maxBounds`): Polska z zapasem, żeby lot z widoku kraju
 * do miasta nie uderzał w granicę. Każdy kadr z tego pliku musi się w nich mieścić (lot.test.ts).
 */
export const GRANICE_WIDOKU: Ramka = [
  [11.5, 47.5],
  [27.0, 56.2],
]

/** Najmniejsza ramka z zapasem (w stopniach) wokół punktów [lon, lat]; bez punktów null. */
export function ramkaPunktow(
  punkty: readonly (readonly [number, number])[],
  zapasLon: number,
  zapasLat: number,
): Ramka | null {
  if (!punkty.length) return null
  const lony = punkty.map(([lon]) => lon)
  const laty = punkty.map(([, lat]) => lat)
  return [
    [Math.min(...lony) - zapasLon, Math.min(...laty) - zapasLat],
    [Math.max(...lony) + zapasLon, Math.max(...laty) + zapasLat],
  ]
}

/**
 * Kadr startowy bez linku (D4): wszystkie miasta z rejestru. Zapas 0,6° × 0,4° mieści dane miasta
 * wokół jego środka (najdalej sięga obwarzanek Krakowa: 0,41° na wschód); mieszczenie się
 * danych każdego miasta w kadrze pilnuje lot.test.ts.
 *
 * Liczony z rejestru, a nie z przeglądów, które już się wczytały: ramka z przeglądów rosłaby
 * z każdym doczytanym miastem i kamera skakałaby po każdym z nich, a ten kadr jest znany od pierwszej
 * klatki mapy. Nowe miasto w rejestrze poszerza go samo.
 */
export const WIDOK_MIAST: Ramka =
  ramkaPunktow(
    MIASTA.map((m) => m.srodek),
    0.6,
    0.4,
  ) ?? WIDOK_POLSKI

const ODSTEP_BRZEGU_PX = 32
const ODSTEP_POD_PASKIEM_PX = 8

/**
 * Odstęp kadru wszystkich miast od krawędzi mapy (px). U góry zostaje miejsce na pasek ustawień
 * (jego dolna krawędź licząc od góry mapy: 56 px w jednym rzędzie, 96 px, gdy zawinie się na wąskim
 * telefonie), żeby najdalsze miasto nie wylądowało pod nim. Wysokość mierzy wołający z DOM, bo
 * zawijanie zależy od szerokości i fontów; wnioskowanie o nim z szerokości mapy łatwo się myli.
 * Podpis mgły nad Gdańskiem (północną krawędzią obszaru z danymi) mieści się w zapasie 0,4° szerokości
 * geograficznej kadru, więc osobnego miejsca nie wymaga. Bez paska (0) zostaje zwykły odstęp.
 */
export function odstepKadruStartowego(dolnaKrawedzPaskaPx: number): {
  top: number
  right: number
  bottom: number
  left: number
} {
  return {
    top: Math.max(ODSTEP_BRZEGU_PX, Math.ceil(dolnaKrawedzPaskaPx) + ODSTEP_POD_PASKIEM_PX),
    right: ODSTEP_BRZEGU_PX,
    bottom: ODSTEP_BRZEGU_PX,
    left: ODSTEP_BRZEGU_PX,
  }
}

/** Zoom, od którego mapa startuje przy środku miasta, zanim zna jego obrys (jak dotąd Kraków). */
export const ZOOM_MIASTA = 10.5

// Połowa boku kadru zapasowego w stopniach: ok. 41 × 33 km, czyli zwarta zabudowa miasta bez
// obwarzanka. To tylko kadr „na chwilę", do czasu aż wczyta się obrys danych miasta.
const POL_KADRU_LON = 0.3
const POL_KADRU_LAT = 0.15

/**
 * Kadr zapasowy bieżącego miasta, gdy lot rusza przed obrysem danych (klik „Pokaż <miasto>"
 * w intro). `srodek` z rejestru to punkt bez obrysu, więc kadr to ramka o stałym rozmiarze wokół niego.
 */
export function kadrZapasowyMiasta(slug: SlugMiasta): Ramka {
  const [lon, lat] = miasto(slug).srodek
  return [
    [lon - POL_KADRU_LON, lat - POL_KADRU_LAT],
    [lon + POL_KADRU_LON, lat + POL_KADRU_LAT],
  ]
}

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
export function kameraDlaGranic(mapa: MapaLibre, granice: Ramka): CameraOptions | null {
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
