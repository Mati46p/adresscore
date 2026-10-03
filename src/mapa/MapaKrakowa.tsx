import { cellToParent, isValidCell } from 'h3-js'
import {
  AttributionControl,
  addProtocol,
  type ExpressionSpecification,
  type GeoJSONSource,
  type IControl,
  Map as MapaLibre,
  type MapLayerMouseEvent,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
} from 'maplibre-gl'
import adresWorkera from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Protocol } from 'pmtiles'
import { type JSX, lazy, type ReactNode, Suspense, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useZnacznikiBiznesu } from '@/mapa/biznes/ZnacznikiBiznesu'
import {
  type Geometria,
  POZIOMY,
  sredniaDzieci,
  takieSameKlucze,
  zbudujGeometrie,
} from '@/mapa/geometria'
import {
  dodajWarstwyLotu,
  introDoPokazania,
  kameraDlaGranic,
  lec,
  ograniczonyRuch,
  PAUZA_PRZED_LOTEM,
  WIDOK_KRAKOWA,
  WIDOK_POLSKI,
  zapamietajLotStartowy,
} from '@/mapa/lot'
import {
  GRUPY_PODKLADU,
  type GrupaPodkladu,
  przeniesNazwyNaWierzch,
  STYL,
  ustawGrupePodkladu,
} from '@/mapa/podklad'
import type { SasiedziNaMapie } from '@/mapa/sasiedzi/model'
import { useZnacznikiSasiadow } from '@/mapa/sasiedzi/ZnacznikiSasiadow'
import {
  gradientCss,
  KOLOR_SZRAFURY,
  KRYCIE_BRAKU,
  KRYCIE_DANYCH,
  obrazSzrafury,
  szrafuraCss,
  wyrazenieKoloru,
} from '@/mapa/skala'
import { type ObiektyNaMapie, useZnacznikiObiektow } from '@/mapa/symulator/ZnacznikiObiektow'
import {
  jestBrakiem,
  jestWykluczony,
  KOLOR_WYKLUCZONEGO,
  KRYCIE_WYKLUCZONEGO,
  W_BRAK,
  W_WYKLUCZONY,
  wszystkieWykluczone,
} from '@/mapa/wykluczenie'
import { odlegloscM } from '@/miasto3d/laczenie'
import { trybLekki } from '@/wynik/lekki'
import 'maplibre-gl/dist/maplibre-gl.css'
import './mapa.css'

export interface MapaKrakowaProps {
  /** h3 r10 → wynik 0–100; null = brak danych (szary). */
  heksy: ReadonlyMap<string, number | null>
  /** Np. „Wynik tej okolicy" – nagłówek legendy. */
  podpisWarstwy: string
  /** Znacznik wybranego adresu + lot kamery do niego. */
  wybrany?: { lon: number; lat: number } | null
  onKlik?: (lon: number, lat: number) => void
  /** h3 r10 wykluczone twardym filtrem (#37) – rysowane inaczej niż brak danych. */
  wykluczone?: ReadonlySet<string>
  punktyUslug?: readonly { lon: number; lat: number; nazwa: string }[]
  postawionePunkty?: readonly { id: 'a' | 'b'; lon: number; lat: number }[]
  onPrzesunPunkt?: (id: 'a' | 'b', lon: number, lat: number) => void
  /** Delete albo Backspace na fokusowanym znaczniku miejsca A/B (tryb „Biznes”). */
  onUsunPunkt?: (id: 'a' | 'b') => void
  etykietySkali?: readonly [string, string, string]
  /** Własna treść legendy (tryb „Dla miasta”, #90). Bez niej: skala wyniku 0–100. */
  legenda?: ReactNode
  /**
   * Własny tekst dymku. `heksyR10` = heksy r10 pod kursorem: jeden przy r10, dzieci przy r8/r9.
   * Bez niego: „wynik N” albo „brak danych”.
   */
  opisHeksu?: (heksyR10: readonly string[], res: 8 | 9 | 10) => string
  /**
   * Wartość rodzica r8/r9 z jego heksów r10. Bez niej: średnia dzieci. Mapa luk (#90) sumuje
   * adresy, bo średnia udziałów zawyżałaby heksy z kilkoma adresami.
   */
  wartoscRodzica?: (heksyR10: readonly string[]) => number | null
  /** Ramka do pokazania (np. okolica z rankingu, #91) – zmiana wartości = przelot kamery. */
  granice?: [[number, number], [number, number]] | null
  /** „Lepszy sąsiad” (#95): okrąg i znaczniki kandydatów; brak = warstwa wyłączona. */
  sasiedzi?: SasiedziNaMapie
  /** Hipotetyczne obiekty symulatora (#97): przeciąganie, klawiatura, usuwanie. */
  obiekty?: ObiektyNaMapie
  /**
   * Heksy r10 do wyróżnienia (#97: zmieniła się litera albo luka). Nowy zbiór = obrys na
   * 1,5 s; przy ograniczonym ruchu obrys bez przejścia, do następnej zmiany.
   */
  wyroznione?: ReadonlySet<string>
  /** Środek widoku po każdym ruchu kamery – np. do stawiania obiektu z klawiatury. */
  onWidok?: (lon: number, lat: number) => void
  /** Budynki 3D przy dużym zoomie albo przy wybranym adresie (mapa główna). */
  widok3d?: boolean
}

const BRAK_WYKLUCZONYCH: ReadonlySet<string> = new Set()
const BRAK_PUNKTOW: readonly { lon: number; lat: number; nazwa: string }[] = []
const BRAK_POSTAWIONYCH: readonly { id: 'a' | 'b'; lon: number; lat: number }[] = []

// MapLibre 6 szuka workera obok własnego pliku (import.meta.url). Po pre-bundlingu Vite i w buildzie
// tego pliku tam nie ma (404, mapa bez kafli), więc Vite pakuje worker osobno i podajemy jego adres.
setWorkerUrl(adresWorkera)
const protokolPmtiles = new Protocol()
addProtocol('pmtiles', protokolPmtiles.tile)

const AKCENT = '#1F5C46'
const KRAKOW: [number, number] = [19.94, 50.06]
// Z zapasem wokół Polski: lot z widoku kraju do Krakowa (etap 5) nie może uderzać w granicę.
const GRANICE_WIDOKU: [[number, number], [number, number]] = [
  [11.5, 47.5],
  [27.0, 56.2],
]

export { STYL } from '@/mapa/podklad'

// Budynki 3D (deck.gl) pobierane dopiero przy dużym zoomie albo po wybraniu adresu.
const Warstwa3D = lazy(() => import('@/miasto3d/Warstwa3D'))
/** Od tego zoomu mapa sama przechodzi w 3D (bez wybranego adresu). */
const ZOOM_3D = 16
/** Środek okolicy 3D przesuwa się za widokiem, gdy ten odjedzie dalej niż tyle metrów. */
const PRZESUNIECIE_3D_M = 300

// Brak danych trzymamy w feature-state jako -1, bo stan nie odróżnia null od nieustawionego.
const WARTOSC: ExpressionSpecification = ['coalesce', ['feature-state', 'w'], -1]
const BRAK = jestBrakiem(WARTOSC)
const WYKLUCZONY = jestWykluczony(WARTOSC)
const zrodloHeksow = (res: number) => `heksy-r${res}`
const BLYSK: ExpressionSpecification = ['boolean', ['feature-state', 'blysk'], false]
const CZAS_BLYSKU_MS = 1500
const SZRAFURA = 'szrafura-braku'

/** Krycie nakladki nie zmienia danych ani wybranej warstwy wyniku. */
function ustawKrycieHeksow(mapa: MapaLibre, procent: number) {
  const krycie = procent / 100
  const widoczne = procent > 0
  const visibility = widoczne ? 'visible' : 'none'
  for (const { res } of POZIOMY) {
    const id = zrodloHeksow(res)
    for (const warstwa of [
      id,
      `${id}-szrafura`,
      `${id}-linia`,
      `${id}-obrys-braku`,
      `${id}-blysk`,
    ]) {
      if (mapa.getLayer(warstwa)) mapa.setLayoutProperty(warstwa, 'visibility', visibility)
    }
    if (mapa.getLayer(id))
      mapa.setPaintProperty(id, 'fill-opacity', [
        '*',
        krycie,
        ['case', WYKLUCZONY, KRYCIE_WYKLUCZONEGO, BRAK, KRYCIE_BRAKU, KRYCIE_DANYCH],
      ])
    if (mapa.getLayer(`${id}-szrafura`))
      mapa.setPaintProperty(`${id}-szrafura`, 'fill-opacity', ['case', BRAK, krycie, 0])
    if (mapa.getLayer(`${id}-linia`))
      mapa.setPaintProperty(`${id}-linia`, 'line-opacity', 0.45 * krycie)
    if (mapa.getLayer(`${id}-obrys-braku`))
      mapa.setPaintProperty(`${id}-obrys-braku`, 'line-opacity', ['case', BRAK, 0.8 * krycie, 0])
  }
  // Mgla i granica zasiegu tez przeslaniaja podklad podczas ogladania ulic.
  for (const warstwa of ['mgla', 'obrys', 'obrys-poswiata']) {
    if (mapa.getLayer(warstwa)) mapa.setLayoutProperty(warstwa, 'visibility', visibility)
  }
  if (mapa.getLayer('mgla')) mapa.setPaintProperty('mgla', 'fill-opacity', 0.78 * krycie)
  if (mapa.getLayer('obrys')) mapa.setPaintProperty('obrys', 'line-opacity', krycie)
}

export const POLSKIE_NAPISY = {
  'NavigationControl.ZoomIn': 'Przybliż',
  'NavigationControl.ZoomOut': 'Oddal',
  'NavigationControl.ResetBearing': 'Obróć na północ',
}

/** Wartości feature-state wysłane już do mapy, per rozdzielczość: h3 → w (-1 = brak). */
type Wyslane = Record<8 | 9 | 10, Map<string, number>>
const pusteWyslane = (): Wyslane => ({ 8: new Map(), 9: new Map(), 10: new Map() })

function podpisHeksu(w: number | null | undefined, res: number): string {
  if (w === W_WYKLUCZONY) return res === 10 ? 'wykluczony filtrem' : 'wykluczony filtrem (okolica)'
  const tekst = w === null || w === undefined || w < 0 ? 'brak danych' : `wynik ${Math.round(w)}`
  return res === 10 ? tekst : `${tekst} (średnia okolicy)`
}

/** Etap intro (#19): widok Polski → lot do Krakowa → zwykła mapa miasta. */
type Etap = 'polska' | 'lot' | 'miasto'

class KontrolkaLegendy implements IControl {
  readonly el = document.createElement('div')
  onAdd() {
    this.el.className = 'maplibregl-ctrl mapa-legenda'
    return this.el
  }
  onRemove() {
    this.el.remove()
  }
}

export function MapaKrakowa({
  heksy,
  podpisWarstwy,
  wybrany,
  onKlik,
  wykluczone = BRAK_WYKLUCZONYCH,
  punktyUslug = BRAK_PUNKTOW,
  postawionePunkty = BRAK_POSTAWIONYCH,
  onPrzesunPunkt,
  onUsunPunkt,
  etykietySkali = ['0', '50', '100'],
  legenda: wlasnaLegenda,
  opisHeksu,
  wartoscRodzica,
  granice,
  sasiedzi,
  obiekty,
  wyroznione,
  onWidok,
  widok3d = false,
}: MapaKrakowaProps): JSX.Element {
  const kontener = useRef<HTMLDivElement>(null)
  const mapaRef = useRef<MapaLibre | null>(null)
  const geometriaRef = useRef<Geometria | null>(null)
  const znacznikRef = useRef<Marker | null>(null)
  const podpisMglyRef = useRef<Marker | null>(null)
  const dymekRef = useRef<Popup | null>(null)
  const onKlikRef = useRef(onKlik)
  const wybranyRef = useRef(wybrany)
  const opisHeksuRef = useRef(opisHeksu)
  const wartoscRodzicaRef = useRef(wartoscRodzica)
  const graniceRef = useRef(granice)
  const onWidokRef = useRef(onWidok)
  const [gotowa, setGotowa] = useState(false)
  const [legenda, setLegenda] = useState<HTMLElement | null>(null)
  const [krycieHeksow, setKrycieHeksow] = useState(100)
  const krycieHeksowRef = useRef(krycieHeksow)
  const idKrycia = useId()
  const [grupyPodkladu, setGrupyPodkladu] = useState<Record<GrupaPodkladu, boolean>>({
    ulice: true,
    tramwaje: true,
    zielen: true,
    woda: true,
    nazwy: true,
  })
  // Wejście z wybranym adresem (link, powrót z karty) pomija intro – kamera od razu przy adresie.
  const [etap, setEtap] = useState<Etap>(() =>
    !wybrany && introDoPokazania() ? 'polska' : 'miasto',
  )
  const etapRef = useRef(etap)
  const [srodek3d, setSrodek3d] = useState<[number, number] | null>(null)
  const [bezLekkiego] = useState(() => !trybLekki())
  const pauzaRef = useRef<number | null>(null)

  useEffect(() => {
    onKlikRef.current = onKlik
    wybranyRef.current = wybrany
    etapRef.current = etap
    opisHeksuRef.current = opisHeksu
    wartoscRodzicaRef.current = wartoscRodzica
    graniceRef.current = granice
    onWidokRef.current = onWidok
  })

  useEffect(() => {
    if (!kontener.current) return
    const mapa = new MapaLibre({
      container: kontener.current,
      style: STYL,
      ...kameraStartowa(etapRef.current, wybranyRef.current),
      minZoom: 5,
      maxBounds: GRANICE_WIDOKU,
      attributionControl: false,
      locale: POLSKIE_NAPISY,
    })
    mapaRef.current = mapa
    const kontrolkaLegendy = new KontrolkaLegendy()
    // Pozycje dolne wstawiają nowszą kontrolkę nad starszą: skala na dole, legenda nad nią.
    mapa.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    mapa.addControl(kontrolkaLegendy, 'bottom-left')
    // compact niepodane = zwinięta na wąskim ekranie, rozwinięta na szerokim.
    mapa.addControl(new AttributionControl(), 'bottom-right')
    mapa.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    setLegenda(kontrolkaLegendy.el)

    mapa.on('moveend', () => {
      if (mapa.getZoom() < ZOOM_3D) return setSrodek3d(null)
      const c = mapa.getCenter()
      setSrodek3d((p) =>
        p && odlegloscM(p[0], p[1], c.lng, c.lat) < PRZESUNIECIE_3D_M ? p : [c.lng, c.lat],
      )
    })

    const dymek = new Popup({ closeButton: false, closeOnClick: false, className: 'mapa-dymek' })
    dymekRef.current = dymek

    mapa.on('load', () => {
      mapa.addImage(SZRAFURA, obrazSzrafury(), { pixelRatio: 2 })
      mapa.addSource('mgla', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      mapa.addSource('obrys', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      for (const { res, minzoom, maxzoom } of POZIOMY) {
        const id = zrodloHeksow(res)
        mapa.addSource(id, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          promoteId: 'h3',
        })
        mapa.addLayer({
          id,
          type: 'fill',
          source: id,
          minzoom,
          maxzoom,
          paint: {
            'fill-color': ['case', WYKLUCZONY, KOLOR_WYKLUCZONEGO, wyrazenieKoloru(WARTOSC)],
            'fill-opacity': [
              'case',
              WYKLUCZONY,
              KRYCIE_WYKLUCZONEGO,
              BRAK,
              KRYCIE_BRAKU,
              KRYCIE_DANYCH,
            ],
          },
        })
        // Filtr nie widzi feature-state, więc szrafura leży na wszystkich heksach,
        // a widać ją tylko tam, gdzie krycie z feature-state mówi „brak danych".
        mapa.addLayer({
          id: `${id}-szrafura`,
          type: 'fill',
          source: id,
          minzoom,
          maxzoom,
          paint: { 'fill-pattern': SZRAFURA, 'fill-opacity': ['case', BRAK, 1, 0] },
        })
        mapa.addLayer({
          id: `${id}-linia`,
          type: 'line',
          source: id,
          minzoom: Math.max(minzoom, 12),
          maxzoom,
          paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.45, 'line-width': 0.5 },
        })
        mapa.addLayer({
          id: `${id}-obrys-braku`,
          type: 'line',
          source: id,
          minzoom,
          maxzoom,
          paint: {
            'line-color': KOLOR_SZRAFURY,
            'line-opacity': ['case', BRAK, 0.8, 0],
            'line-width': 1,
          },
        })
        // Wyróżnienie heksów po zmianie w symulatorze (#97); niewidoczne bez feature-state.
        mapa.addLayer({
          id: `${id}-blysk`,
          type: 'line',
          source: id,
          minzoom,
          maxzoom,
          paint: {
            'line-color': '#18202B',
            'line-width': 2.5,
            'line-opacity': ['case', BLYSK, 1, 0],
            'line-opacity-transition': { duration: ograniczonyRuch() ? 0 : 300, delay: 0 },
          },
        })

        const pokazDymek = (e: MapLayerMouseEvent) => {
          const f = e.features?.[0]
          if (f?.id === undefined) return
          const opis = opisHeksuRef.current
          let tekst: string
          if (opis) {
            const h = String(f.id)
            const dzieci = res === 10 ? [h] : (geometriaRef.current?.dzieci[res].get(h) ?? [])
            tekst = opis(dzieci, res)
          } else {
            const w = mapa.getFeatureState({ source: id, id: f.id }).w as number | undefined
            tekst = podpisHeksu(w, res)
          }
          dymek.setLngLat(e.lngLat).setText(tekst).addTo(mapa)
        }
        mapa.on('mousemove', id, (e: MapLayerMouseEvent) => {
          mapa.getCanvas().style.cursor = 'pointer'
          pokazDymek(e)
        })
        // Telefon nie ma najechania: bez własnej akcji klik pokazuje dymek (tryb „Dla miasta”).
        mapa.on('click', id, (e: MapLayerMouseEvent) => {
          if (!onKlikRef.current && opisHeksuRef.current) pokazDymek(e)
        })
        mapa.on('mouseleave', id, () => {
          mapa.getCanvas().style.cursor = ''
          dymek.remove()
        })
      }
      mapa.addSource('punkty-uslug', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      mapa.addLayer({
        id: 'punkty-uslug',
        type: 'circle',
        source: 'punkty-uslug',
        paint: {
          'circle-radius': 4,
          'circle-color': '#8b4a26',
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1,
        },
      })
      mapa.on('mouseenter', 'punkty-uslug', (e) => {
        const nazwa = e.features?.[0]?.properties?.nazwa
        if (nazwa) dymek.setLngLat(e.lngLat).setText(String(nazwa)).addTo(mapa)
      })
      mapa.on('mouseleave', 'punkty-uslug', () => dymek.remove())
      mapa.addLayer({
        id: 'mgla',
        type: 'fill',
        source: 'mgla',
        paint: { 'fill-color': '#EEF0EE', 'fill-opacity': 0.78 },
      })
      mapa.addLayer({
        id: 'obrys',
        type: 'line',
        source: 'obrys',
        paint: { 'line-color': '#9AA2A8', 'line-width': 1.5, 'line-dasharray': [4, 3] },
      })
      dodajWarstwyLotu(mapa)
      przeniesNazwyNaWierzch(mapa)
      // Strict Mode montuje dwa razy – zdarzenie ze zdjętej mapy nie może ustawić stanu.
      if (mapaRef.current === mapa) setGotowa(true)
    })

    mapa.on('click', (e) => {
      // Klik (albo koniec przeciągania) znacznika obiektu symulatora albo miejsca A/B z trybu
      // „Biznes” nie stawia nowego obiektu, a Enter na przycisku nie wysyła kliku w róg mapy.
      const cel = e.originalEvent.target
      if (cel instanceof Element && cel.closest('.mapa-obiekt, .mapa-punkt-biznesu')) return
      // Klik w widoku Polski znaczy „pokaż mi dane", nie „najbliższy adres w Krakowie".
      if (etapRef.current === 'polska') return startujLot(mapa)
      onKlikRef.current?.(e.lngLat.lng, e.lngLat.lat)
    })
    // Lot chwilowo ukrywa r10 i po lądowaniu go przywraca. Przy suwaku na 0%
    // ostatnie słowo musi należeć do ustawienia użytkownika.
    mapa.on('moveend', () => {
      const c = mapa.getCenter()
      onWidokRef.current?.(c.lng, c.lat)
      if (krycieHeksowRef.current !== 0) return
      queueMicrotask(() => {
        if (mapaRef.current === mapa) ustawKrycieHeksow(mapa, 0)
      })
    })
    sledzGestyPodczasIntro(mapa)

    return () => {
      dymek.remove()
      if (dymekRef.current === dymek) dymekRef.current = null
      mapa.remove()
      if (mapaRef.current === mapa) mapaRef.current = null
      geometriaRef.current = null
      znacznikRef.current = null
      podpisMglyRef.current = null
      if (pauzaRef.current !== null) clearTimeout(pauzaRef.current)
      pauzaRef.current = null
      setGotowa(false)
      setLegenda(null)
    }
  }, [])

  // Suwak wag potrafi zmienić `heksy` kilka razy na klatkę, a każda rewizja to ok. 23 tys.
  // wywołań setFeatureState. Dlatego zmiana tylko zapamiętuje najnowszą mapę, a mapa dostaje
  // ją raz na klatkę i wyłącznie dla heksów, których wartość się zmieniła.
  const najnowszeRef = useRef(heksy)
  const najnowszeWykluczoneRef = useRef(wykluczone)
  const klatkaRef = useRef<number | null>(null)
  const wyslaneRef = useRef<Wyslane>(pusteWyslane())

  useEffect(() => {
    najnowszeRef.current = heksy
    najnowszeWykluczoneRef.current = wykluczone
    const mapa = mapaRef.current
    if (!mapa || !gotowa || klatkaRef.current !== null) return
    klatkaRef.current = requestAnimationFrame(() => {
      klatkaRef.current = null
      zastosujHeksy(mapa, najnowszeRef.current, najnowszeWykluczoneRef.current)
    })
  }, [heksy, wykluczone, gotowa])

  useEffect(
    () => () => {
      if (klatkaRef.current !== null) cancelAnimationFrame(klatkaRef.current)
      klatkaRef.current = null
    },
    [],
  )

  useEffect(() => {
    krycieHeksowRef.current = krycieHeksow
    const mapa = mapaRef.current
    if (!mapa || !gotowa) return
    ustawKrycieHeksow(mapa, krycieHeksow)
    if (legenda) legenda.hidden = krycieHeksow === 0
    const podpisMgly = podpisMglyRef.current?.getElement()
    if (podpisMgly) podpisMgly.hidden = krycieHeksow === 0
    if (krycieHeksow === 0) {
      mapa.getCanvas().style.cursor = ''
      dymekRef.current?.remove()
    }
  }, [gotowa, legenda, krycieHeksow])

  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa || !gotowa) return
    for (const { id } of GRUPY_PODKLADU) ustawGrupePodkladu(mapa, id, grupyPodkladu[id])
  }, [gotowa, grupyPodkladu])

  function zastosujHeksy(
    mapa: MapaLibre,
    heksy: ReadonlyMap<string, number | null>,
    wykluczone: ReadonlySet<string>,
  ) {
    // Mapa mogła zostać zdjęta (Strict Mode, zmiana ekranu) między zmianą a klatką.
    if (mapaRef.current !== mapa) return
    let g = geometriaRef.current
    if (!takieSameKlucze(g, heksy)) {
      const pierwsza = g === null
      g = zbudujGeometrie(heksy.keys())
      geometriaRef.current = g
      wyslaneRef.current = pusteWyslane()
      for (const { res } of POZIOMY) {
        const zrodlo = mapa.getSource<GeoJSONSource>(zrodloHeksow(res))
        zrodlo?.setData(g.zrodla[res])
        mapa.removeFeatureState({ source: zrodloHeksow(res) })
      }
      mapa.getSource<GeoJSONSource>('mgla')?.setData(g.mgla)
      mapa.getSource<GeoJSONSource>('obrys')?.setData(g.obrys)
      podpisMglyRef.current?.remove()
      podpisMglyRef.current = null
      if (heksy.size) {
        // Marker HTML zamiast warstwy symboli: podpis nie wymaga glifów ani zewnętrznego serwera.
        const el = document.createElement('div')
        el.className = 'mapa-mgla-podpis'
        el.textContent = 'poza Krakowem – brak danych'
        el.setAttribute('aria-hidden', 'true')
        el.hidden = krycieHeksowRef.current === 0
        // Nad północną krawędzią: na wąskim ekranie bok obszaru bywa tuż przy brzegu mapy.
        const [[minX], [maxX, maxY]] = g.granice
        podpisMglyRef.current = new Marker({ element: el, anchor: 'bottom', offset: [0, -10] })
          .setLngLat([(minX + maxX) / 2, maxY])
          .addTo(mapa)
      }
      if (pierwsza && heksy.size && !wybranyRef.current && !graniceRef.current) {
        if (etapRef.current === 'polska') zaplanujLot(mapa)
        else if (etapRef.current === 'miasto') {
          mapa.fitBounds(g.granice, { padding: 32, animate: false })
        }
      }
    }
    const wyslane = wyslaneRef.current
    const wyslij = (res: 8 | 9 | 10, h: string, w: number | null | undefined) => {
      const v = w === null || w === undefined || Number.isNaN(w) ? W_BRAK : w
      if (wyslane[res].get(h) === v) return
      wyslane[res].set(h, v)
      mapa.setFeatureState({ source: zrodloHeksow(res), id: h }, { w: v })
    }
    for (const [h, w] of heksy) wyslij(10, h, wykluczone.has(h) ? W_WYKLUCZONY : w)
    const rodzic = wartoscRodzicaRef.current ?? ((dzieci) => sredniaDzieci(dzieci, heksy))
    for (const res of [8, 9] as const) {
      for (const [h, dzieci] of g.dzieci[res])
        wyslij(res, h, wszystkieWykluczone(dzieci, wykluczone) ? W_WYKLUCZONY : rodzic(dzieci))
    }
  }

  useZnacznikiSasiadow(mapaRef, gotowa, sasiedzi)
  useZnacznikiObiektow(mapaRef, gotowa, obiekty)

  // Błysk heksów: r10 i ich rodzice r9/r8, żeby było go widać przy każdym zoomie.
  const blyskRef = useRef<{ res: 8 | 9 | 10; h: string }[]>([])
  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa || !gotowa) return
    const ustaw = (wartosc: boolean) => {
      if (mapaRef.current !== mapa) return
      for (const { res, h } of blyskRef.current) {
        mapa.setFeatureState({ source: zrodloHeksow(res), id: h }, { blysk: wartosc })
      }
    }
    ustaw(false)
    const lista: { res: 8 | 9 | 10; h: string }[] = []
    const rodzice = new Set<string>()
    for (const h of wyroznione ?? []) {
      if (!isValidCell(h)) continue
      lista.push({ res: 10, h })
      for (const res of [9, 8] as const) {
        const r = cellToParent(h, res)
        if (rodzice.has(r)) continue
        rodzice.add(r)
        lista.push({ res, h: r })
      }
    }
    blyskRef.current = lista
    ustaw(true)
    if (ograniczonyRuch()) return
    const zgas = window.setTimeout(() => ustaw(false), CZAS_BLYSKU_MS)
    return () => clearTimeout(zgas)
  }, [gotowa, wyroznione])

  const lon = wybrany?.lon
  const lat = wybrany?.lat
  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa) return
    if (lon === undefined || lat === undefined) {
      znacznikRef.current?.remove()
      znacznikRef.current = null
      return
    }
    if (!znacznikRef.current) {
      const z = new Marker({ color: AKCENT })
      const el = z.getElement()
      el.setAttribute('role', 'img')
      el.setAttribute('aria-label', 'Wybrany adres')
      znacznikRef.current = z
    }
    znacznikRef.current.setLngLat([lon, lat]).addTo(mapa)
    const cel = { center: [lon, lat] as [number, number], zoom: Math.max(16, mapa.getZoom()) }
    if (etapRef.current === 'polska') {
      // Adres przyszedł przed startem lotu (link z adresem, dane wczytane później): bez intro.
      zakonczIntro()
      mapa.jumpTo(cel)
    } else {
      void lec(mapa, cel)
    }
  }, [lon, lat])

  useEffect(() => {
    if (!gotowa) return
    const mapa = mapaRef.current
    const zrodlo = mapa?.getSource<GeoJSONSource>('punkty-uslug')
    zrodlo?.setData({
      type: 'FeatureCollection',
      features: punktyUslug.map((p) => ({
        type: 'Feature',
        properties: { nazwa: p.nazwa || 'Punkt usługowy' },
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      })),
    })
  }, [gotowa, punktyUslug])

  // Miejsca A i B trybu „Biznes”: przyciski z klawiaturą i opisem dla czytnika (#106).
  useZnacznikiBiznesu(mapaRef, gotowa, postawionePunkty, onPrzesunPunkt, onUsunPunkt)
  // Przelot do ramki (okolica z rankingu). Klucz z liczb, bo nowa tablica przy tych samych
  // granicach nie może ruszać kamery.
  const kluczGranic = granice ? granice.flat().join(',') : null
  useEffect(() => {
    const mapa = mapaRef.current
    const g = graniceRef.current
    if (!mapa || !gotowa || kluczGranic === null || !g) return
    if (etapRef.current !== 'miasto') zakonczIntro()
    const kamera = mapa.cameraForBounds(g, { padding: 48, maxZoom: 16 })
    if (kamera) void lec(mapa, kamera)
  }, [gotowa, kluczGranic])

  function zakonczIntro() {
    if (pauzaRef.current !== null) clearTimeout(pauzaRef.current)
    pauzaRef.current = null
    zapamietajLotStartowy()
    etapRef.current = 'miasto'
    setEtap('miasto')
  }

  /** Dane są: chwila na obejrzenie Polski, potem lot (przy ograniczonym ruchu od razu skok). */
  function zaplanujLot(mapa: MapaLibre) {
    if (pauzaRef.current !== null) return
    pauzaRef.current = window.setTimeout(
      () => {
        pauzaRef.current = null
        startujLot(mapa)
      },
      ograniczonyRuch() ? 0 : PAUZA_PRZED_LOTEM,
    )
  }

  function startujLot(mapa: MapaLibre) {
    if (mapaRef.current !== mapa || etapRef.current !== 'polska') return
    if (pauzaRef.current !== null) clearTimeout(pauzaRef.current)
    pauzaRef.current = null
    zapamietajLotStartowy()
    const kamera = kameraDlaGranic(mapa, geometriaRef.current?.granice ?? WIDOK_KRAKOWA)
    if (!kamera) return zakonczIntro()
    etapRef.current = 'lot'
    setEtap('lot')
    void lec(mapa, kamera).then(() => {
      if (mapaRef.current !== mapa || etapRef.current !== 'lot') return
      etapRef.current = 'miasto'
      setEtap('miasto')
    })
  }

  /** Gest użytkownika w trakcie intro: MapLibre sam przerywa lot, my kończymy etap. */
  function sledzGestyPodczasIntro(mapa: MapaLibre) {
    mapa.on('movestart', (e) => {
      if (!('originalEvent' in e) || !e.originalEvent) return
      if (etapRef.current !== 'miasto') zakonczIntro()
    })
  }

  return (
    <div className={etap === 'miasto' ? 'mapa-krakowa' : 'mapa-krakowa mapa-krakowa--intro'}>
      <div
        ref={kontener}
        className="mapa-krakowa__plotno"
        role="region"
        aria-label={`Mapa Krakowa – ${podpisWarstwy}`}
      />
      {etap === 'miasto' && (
        <div className="mapa-ustawienia" role="group" aria-label="Ustawienia mapy">
          <label htmlFor={idKrycia}>Krycie heksów</label>
          <input
            id={idKrycia}
            className="mapa-ustawienia__suwak"
            type="range"
            min="0"
            max="100"
            step="5"
            value={krycieHeksow}
            aria-valuetext={`${krycieHeksow}% krycia heksów`}
            onChange={(e) => setKrycieHeksow(Number(e.currentTarget.value))}
          />
          <output htmlFor={idKrycia} className="mapa-ustawienia__wartosc">
            {krycieHeksow}%
          </output>
          <details className="mapa-ustawienia__warstwy">
            <summary title="Warstwy podkładu">Warstwy</summary>
            <div className="mapa-ustawienia__warstwy-lista">
              {GRUPY_PODKLADU.map(({ id, etykieta }) => (
                <button
                  key={id}
                  type="button"
                  className="mapa-ustawienia__przelacznik"
                  aria-pressed={grupyPodkladu[id]}
                  onClick={() =>
                    setGrupyPodkladu((aktualne) => ({
                      ...aktualne,
                      [id]: !aktualne[id],
                    }))
                  }
                >
                  <span className="mapa-ustawienia__znacznik" aria-hidden="true" />
                  {etykieta}
                </button>
              ))}
            </div>
          </details>
        </div>
      )}
      {widok3d &&
        bezLekkiego &&
        gotowa &&
        etap === 'miasto' &&
        mapaRef.current &&
        (wybrany || srodek3d) && (
          <Suspense fallback={null}>
            <Warstwa3D
              mapa={mapaRef.current}
              lon={wybrany?.lon ?? (srodek3d as [number, number])[0]}
              lat={wybrany?.lat ?? (srodek3d as [number, number])[1]}
            />
          </Suspense>
        )}
      {etap !== 'miasto' && (
        <IntroPolski
          lot={etap === 'lot'}
          onPokaz={() => {
            const mapa = mapaRef.current
            if (mapa) startujLot(mapa)
          }}
        />
      )}
      {legenda &&
        krycieHeksow > 0 &&
        wlasnaLegenda !== undefined &&
        createPortal(wlasnaLegenda, legenda)}
      {legenda &&
        krycieHeksow > 0 &&
        wlasnaLegenda === undefined &&
        createPortal(
          <>
            <div className="mapa-legenda__tytul">{podpisWarstwy}</div>
            <div
              className="mapa-legenda__pasek"
              style={{ background: gradientCss(), opacity: (KRYCIE_DANYCH * krycieHeksow) / 100 }}
            />
            <div className="mapa-legenda__skala" aria-hidden="true">
              {etykietySkali.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <div className="mapa-legenda__wiersz">
              <span
                className="mapa-legenda__probka mapa-legenda__probka--brak"
                style={{ background: szrafuraCss() }}
              />
              brak danych
            </div>
            {wykluczone.size > 0 && (
              <div className="mapa-legenda__wiersz">
                <span className="mapa-legenda__probka mapa-legenda__probka--wykluczony" />
                wykluczone filtrem
              </div>
            )}
            <div className="mapa-legenda__wiersz">
              <span className="mapa-legenda__probka mapa-legenda__probka--mgla" />
              poza Krakowem – brak danych
            </div>
          </>,
          legenda,
        )}
    </div>
  )
}

function kameraStartowa(
  etap: Etap,
  wybrany: { lon: number; lat: number } | null | undefined,
): { bounds: [[number, number], [number, number]] } | { center: [number, number]; zoom: number } {
  if (wybrany) return { center: [wybrany.lon, wybrany.lat], zoom: 16 }
  if (etap === 'polska') return { bounds: WIDOK_POLSKI }
  return { center: KRAKOW, zoom: 10.5 }
}

/** Winieta i podpis nad widokiem Polski; znikają, gdy kamera dolatuje do Krakowa. */
function IntroPolski({ lot, onPokaz }: { lot: boolean; onPokaz: () => void }): JSX.Element {
  return (
    <>
      <div className="mapa-intro-winieta" aria-hidden="true" />
      <div className={lot ? 'mapa-intro-podpis mapa-intro-podpis--lot' : 'mapa-intro-podpis'}>
        <p>Dane: Kraków i obwarzanek. Reszta Polski – wkrótce</p>
        {!lot && (
          <button type="button" className="mapa-intro-przycisk" onClick={onPokaz}>
            Pokaż Kraków
          </button>
        )}
      </div>
    </>
  )
}
