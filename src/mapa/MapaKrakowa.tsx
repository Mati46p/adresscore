import {
  AttributionControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type IControl,
  Map as MapaLibre,
  type MapLayerMouseEvent,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  type StyleSpecification,
  setWorkerUrl,
} from 'maplibre-gl'
import adresWorkera from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { type JSX, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  gradientCss,
  KOLOR_SZRAFURY,
  KRYCIE_BRAKU,
  KRYCIE_DANYCH,
  obrazSzrafury,
  szrafuraCss,
  wyrazenieKoloru,
} from '@/mapa/skala'
import {
  jestBrakiem,
  jestWykluczony,
  KOLOR_WYKLUCZONEGO,
  KRYCIE_WYKLUCZONEGO,
  W_BRAK,
  W_WYKLUCZONY,
  wszystkieWykluczone,
} from '@/mapa/wykluczenie'
import './mapa.css'

export interface MapaKrakowaProps {
  /** h3 r10 → wynik 0–100; null = brak danych (szary). */
  heksy: ReadonlyMap<string, number | null>
  /** Np. „Twój wynik" – nagłówek legendy. */
  podpisWarstwy: string
  /** Znacznik wybranego adresu + lot kamery do niego. */
  wybrany?: { lon: number; lat: number } | null
  onKlik?: (lon: number, lat: number) => void
  /** h3 r10 wykluczone twardym filtrem (#37) – rysowane inaczej niż brak danych. */
  wykluczone?: ReadonlySet<string>
}

const BRAK_WYKLUCZONYCH: ReadonlySet<string> = new Set()

// MapLibre 6 szuka workera obok własnego pliku (import.meta.url). Po pre-bundlingu Vite i w buildzie
// tego pliku tam nie ma (404, mapa bez kafli), więc Vite pakuje worker osobno i podajemy jego adres.
setWorkerUrl(adresWorkera)

const AKCENT = '#1F5C46'
const KRAKOW: [number, number] = [19.94, 50.06]
// Z zapasem wokół Polski: lot z widoku kraju do Krakowa (etap 5) nie może uderzać w granicę.
const GRANICE_WIDOKU: [[number, number], [number, number]] = [
  [11.5, 47.5],
  [27.0, 56.2],
]

const STYL: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>',
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      // Wyszarzony i rozjaśniony podkład: kolory heksów niosą treść, mapa daje tylko orientację.
      paint: { 'raster-saturation': -0.7, 'raster-brightness-min': 0.12, 'raster-contrast': -0.1 },
    },
  ],
}

// Brak danych trzymamy w feature-state jako -1, bo stan nie odróżnia null od nieustawionego.
const WARTOSC: ExpressionSpecification = ['coalesce', ['feature-state', 'w'], -1]
const BRAK = jestBrakiem(WARTOSC)
const WYKLUCZONY = jestWykluczony(WARTOSC)
const zrodloHeksow = (res: number) => `heksy-r${res}`
const SZRAFURA = 'szrafura-braku'

/** Widocznosc nakladki nie zmienia danych ani wybranej warstwy wyniku. */
function ustawWidocznoscHeksow(mapa: MapaLibre, widoczne: boolean) {
  const visibility = widoczne ? 'visible' : 'none'
  for (const { res } of POZIOMY) {
    const id = zrodloHeksow(res)
    for (const warstwa of [id, `${id}-szrafura`, `${id}-linia`, `${id}-obrys-braku`]) {
      if (mapa.getLayer(warstwa)) mapa.setLayoutProperty(warstwa, 'visibility', visibility)
    }
  }
  // Mgla i granica zasiegu tez przeslaniaja podklad podczas ogladania ulic.
  for (const warstwa of ['mgla', 'obrys']) {
    if (mapa.getLayer(warstwa)) mapa.setLayoutProperty(warstwa, 'visibility', visibility)
  }
  // OSM ma bardziej czytelne nazwy ulic, gdy nie musi pozostawac tlem dla kolorowych heksow.
  if (mapa.getLayer('osm')?.type === 'raster') {
    mapa.setPaintProperty('osm', 'raster-saturation', widoczne ? -0.7 : 0)
    mapa.setPaintProperty('osm', 'raster-brightness-min', widoczne ? 0.12 : 0)
    mapa.setPaintProperty('osm', 'raster-contrast', widoczne ? -0.1 : 0)
  }
}

const POLSKIE_NAPISY = {
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
}: MapaKrakowaProps): JSX.Element {
  const kontener = useRef<HTMLDivElement>(null)
  const mapaRef = useRef<MapaLibre | null>(null)
  const geometriaRef = useRef<Geometria | null>(null)
  const znacznikRef = useRef<Marker | null>(null)
  const podpisMglyRef = useRef<Marker | null>(null)
  const dymekRef = useRef<Popup | null>(null)
  const onKlikRef = useRef(onKlik)
  const wybranyRef = useRef(wybrany)
  const [gotowa, setGotowa] = useState(false)
  const [legenda, setLegenda] = useState<HTMLElement | null>(null)
  const [pokazHeksy, setPokazHeksy] = useState(true)
  const pokazHeksyRef = useRef(pokazHeksy)
  // Wejście z wybranym adresem (link, powrót z karty) pomija intro – kamera od razu przy adresie.
  const [etap, setEtap] = useState<Etap>(() =>
    !wybrany && introDoPokazania() ? 'polska' : 'miasto',
  )
  const etapRef = useRef(etap)
  const pauzaRef = useRef<number | null>(null)

  useEffect(() => {
    onKlikRef.current = onKlik
    wybranyRef.current = wybrany
    etapRef.current = etap
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

        mapa.on('mousemove', id, (e: MapLayerMouseEvent) => {
          const f = e.features?.[0]
          if (f?.id === undefined) return
          mapa.getCanvas().style.cursor = 'pointer'
          const w = mapa.getFeatureState({ source: id, id: f.id }).w as number | undefined
          dymek.setLngLat(e.lngLat).setText(podpisHeksu(w, res)).addTo(mapa)
        })
        mapa.on('mouseleave', id, () => {
          mapa.getCanvas().style.cursor = ''
          dymek.remove()
        })
      }
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
      // Strict Mode montuje dwa razy – zdarzenie ze zdjętej mapy nie może ustawić stanu.
      if (mapaRef.current === mapa) setGotowa(true)
    })

    mapa.on('click', (e) => {
      // Klik w widoku Polski znaczy „pokaż mi dane", nie „najbliższy adres w Krakowie".
      if (etapRef.current === 'polska') return startujLot(mapa)
      onKlikRef.current?.(e.lngLat.lng, e.lngLat.lat)
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
    pokazHeksyRef.current = pokazHeksy
    const mapa = mapaRef.current
    if (!mapa || !gotowa) return
    ustawWidocznoscHeksow(mapa, pokazHeksy)
    if (legenda) legenda.hidden = !pokazHeksy
    const podpisMgly = podpisMglyRef.current?.getElement()
    if (podpisMgly) podpisMgly.hidden = !pokazHeksy
    if (!pokazHeksy) {
      mapa.getCanvas().style.cursor = ''
      dymekRef.current?.remove()
    }
  }, [gotowa, legenda, pokazHeksy])

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
        el.hidden = !pokazHeksyRef.current
        // Nad północną krawędzią: na wąskim ekranie bok obszaru bywa tuż przy brzegu mapy.
        const [[minX], [maxX, maxY]] = g.granice
        podpisMglyRef.current = new Marker({ element: el, anchor: 'bottom', offset: [0, -10] })
          .setLngLat([(minX + maxX) / 2, maxY])
          .addTo(mapa)
      }
      if (pierwsza && heksy.size && !wybranyRef.current) {
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
    for (const res of [8, 9] as const) {
      for (const [rodzic, dzieci] of g.dzieci[res])
        wyslij(
          res,
          rodzic,
          wszystkieWykluczone(dzieci, wykluczone) ? W_WYKLUCZONY : sredniaDzieci(dzieci, heksy),
        )
    }
  }

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
          <span className="mapa-ustawienia__tytul">Ustawienia mapy</span>
          <button
            type="button"
            className="mapa-ustawienia__przelacznik"
            aria-pressed={pokazHeksy}
            onClick={() => setPokazHeksy((wartosc) => !wartosc)}
          >
            <span className="mapa-ustawienia__znacznik" aria-hidden="true" />
            Pokaż heksy
          </button>
          {!pokazHeksy && (
            <span className="mapa-ustawienia__podpowiedz">Przeglądaj ulice na mapie</span>
          )}
        </div>
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
        pokazHeksy &&
        createPortal(
          <>
            <div className="mapa-legenda__tytul">{podpisWarstwy}</div>
            <div
              className="mapa-legenda__pasek"
              style={{ background: gradientCss(), opacity: KRYCIE_DANYCH }}
            />
            <div className="mapa-legenda__skala" aria-hidden="true">
              <span>0</span>
              <span>50</span>
              <span>100</span>
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
