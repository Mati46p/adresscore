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
import {
  type CSSProperties,
  type JSX,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  MIASTO_DOMYSLNE,
  miasto as miastoZRejestru,
  type SlugMiasta,
  type TloMapy,
} from '@/kontrakty/miasta'
import { MEDIA_ARKUSZA } from '@/lib/punktyLamania'
import { useZnacznikiBiznesu } from '@/mapa/biznes/ZnacznikiBiznesu'
import { DostawcaGeoJson } from '@/mapa/dostawcaGeoJson'
import { useEtykietyZrodel } from '@/mapa/etykietyZrodel'
import {
  type Geometria,
  type GeometriaTla,
  type Otoczka,
  POZIOMY,
  POZIOMY_TLA,
  PROG_PRZEBUDOWY_WARTOSCI,
  poziomyTlaDoOdswiezenia,
  type Ramka,
  type RozdzielczoscTla,
  rowneKlucze,
  roznice,
  sredniaDzieci,
  takieSameKlucze,
  takieSameKluczeTla,
  zbudujGeometrie,
  zbudujGeometrieTla,
  zbudujOtoczke,
} from '@/mapa/geometria'
import {
  dodajWarstwyLotu,
  GRANICE_WIDOKU,
  introDoPokazania,
  kadrZapasowyMiasta,
  kameraDlaGranic,
  lec,
  odstepKadruStartowego,
  ograniczonyRuch,
  PAUZA_PRZED_LOTEM,
  WIDOK_POLSKI,
  ZOOM_MIASTA,
  zapamietajLotStartowy,
} from '@/mapa/lot'
import type { OkolicaNaMapie } from '@/mapa/okolica/granice'
import { useObrysOkolicy } from '@/mapa/okolica/ObrysOkolicy'
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
  kotwicaPodpisu,
  podpisHeksuTla,
  podpisMgly,
  podpisPrzyciskuIntro,
  ramkaPodpisuMgly,
  TEKST_SKALI_MIAST,
  tekstIntro,
} from '@/mapa/tlo'
import {
  jestBrakiem,
  jestWykluczony,
  KOLOR_WYKLUCZONEGO,
  KRYCIE_WYKLUCZONEGO,
  stanHeksu,
  W_WYKLUCZONY,
  wszystkieWykluczone,
} from '@/mapa/wykluczenie'
import { odlegloscM } from '@/miasto3d/laczenie'
import { trybLekki } from '@/wynik/lekki'
import type { IdMiejsca } from '@/wynik/url'
import 'maplibre-gl/dist/maplibre-gl.css'
import './mapa.css'

export interface MapaKrakowaProps {
  /**
   * Wysokość dolnego arkusza (px), który zasłania mapę. Mapa dostaje padding od dołu, więc wybrany
   * punkt i środek kadru stoją nad arkuszem; kontrolki dolne i legenda przesuwają się o tyle samo.
   */
  odstepDolny?: number
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
  postawionePunkty?: readonly { id: IdMiejsca; lon: number; lat: number }[]
  onPrzesunPunkt?: (id: IdMiejsca, lon: number, lat: number) => void
  /** Delete albo Backspace na fokusowanym znaczniku miejsca A/B (tryb „Biznes”). */
  onUsunPunkt?: (id: IdMiejsca) => void
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
  /**
   * Okolica wybrana w wyszukiwarce (#185): obrys jednostki SIM i przelot do jej granic. Każdy nowy
   * obiekt to nowy przelot, także dla tej samej okolicy (`granice` reaguje tylko na zmianę liczb).
   */
  okolica?: OkolicaNaMapie | null
  /** „Lepszy sąsiad” (#95): okrąg i znaczniki kandydatów; brak = warstwa wyłączona. */
  sasiedzi?: SasiedziNaMapie
  /** Hipotetyczne obiekty symulatora (#97): przeciąganie, klawiatura, usuwanie. */
  obiekty?: ObiektyNaMapie
  /**
   * Heksy r10 do wyróżnienia (#97: zmieniła się litera albo luka). Nowy zbiór = obrys na
   * 1,5 s; przy ograniczonym ruchu obrys bez przejścia, do następnej zmiany.
   */
  wyroznione?: ReadonlySet<string>
  /**
   * Środek widoku i zoom po każdym ruchu kamery – np. do stawiania obiektu z klawiatury i do
   * przełączania miasta kamerą (#223). Zoom to trzeci argument, więc wywołania z dwoma parametrami
   * działają jak dotąd.
   */
  onWidok?: (lon: number, lat: number, zoom: number) => void
  /**
   * Wywoływany raz: po pierwszym zastosowaniu niepustego zbioru heksów i najbliższym zdarzeniu `idle`
   * mapy, czyli gdy pierwsze kolory są już narysowane. W tym samym miejscu mapa robi
   * `performance.mark('mapa-kolor')`.
   */
  onPierwszyKolor?: () => void
  /**
   * Mapa nie wstała: brak WebGL albo błąd stylu przed pierwszym `load`. Wołany raz. Ekran Szukaj otwiera
   * wtedy pełne dane (zapas zamiast kolorów z kompaktu, których nie ma na czym narysować).
   */
  onAwaria?: () => void
  /** Budynki 3D przy dużym zoomie albo przy wybranym adresie (mapa główna). */
  widok3d?: boolean
  /**
   * Tło (#223): miasta inne niż bieżące, rysowane pod mgłą jako heksy r8 (zoom poniżej 11) i r9
   * (11–13), tymi samymi kolorami, szrafurą i kryciem co heksy bieżącego miasta. Obecność propa
   * (także z pustymi mapami, zanim przeglądy się wczytają) znaczy „to mapa wszystkich miast": zmienia
   * podpis mgły i dopisuje do legendy, że skala jest liczona osobno w każdym mieście. Bez niego mapa
   * pokazuje jedno miasto, jak dotąd.
   */
  tlo?: TloMapy
  /**
   * Kadr startowy, gdy nie ma wybranego adresu ani granic: prostokąt wszystkich miast (D4). Mapa
   * dopasowuje go do pierwszego ruchu kamery (gest albo lot do adresu, okolicy, ramki), więc kadr
   * może dojść po starcie bez odbierania użytkownikowi kamery. `null` albo brak = kadr obrysu
   * bieżącego miasta, jak dotąd (link z miastem). Stały kadr (`WIDOK_MIAST` z `@/mapa/lot`) nie
   * skacze, a kadr z przeglądów rósłby z każdym doczytanym miastem.
   */
  kadrStartowy?: Ramka | null
  /**
   * Bieżące miasto: środek kamery, zanim wczytają się jego heksy, miasto lotu startowego (`?pokaz`)
   * i podpis przycisku intro. Domyślnie Kraków. Ekrany jednego miasta (luki, symulator, biznes)
   * podają je tak samo, żeby mapa nie startowała w Krakowie, gdy dane są z innego miasta.
   */
  miasto?: SlugMiasta
}

const BRAK_WYKLUCZONYCH: ReadonlySet<string> = new Set()
const BRAK_PUNKTOW: readonly { lon: number; lat: number; nazwa: string }[] = []
const BRAK_POSTAWIONYCH: readonly { id: IdMiejsca; lon: number; lat: number }[] = []
const BRAK_WARTOSCI: ReadonlyMap<string, number | null> = new Map()
const BRAK_TLA: TloMapy = { heksy: { 8: BRAK_WARTOSCI, 9: BRAK_WARTOSCI }, miastoHeksu: () => null }
const PUSTA_GEOMETRIA_TLA: GeometriaTla = zbudujGeometrieTla([], [])

// MapLibre 6 szuka workera obok własnego pliku (import.meta.url). Po pre-bundlingu Vite i w buildzie
// tego pliku tam nie ma (404, mapa bez kafli), więc Vite pakuje worker osobno i podajemy jego adres.
setWorkerUrl(adresWorkera)
const protokolPmtiles = new Protocol()
addProtocol('pmtiles', protokolPmtiles.tile)

const AKCENT = '#1F5C46'
/** Odstęp kadru obrysu miasta od krawędzi mapy (px). Kadr wszystkich miast ma własny: `odstepKadruStartowego`. */
const ODSTEP_KADRU_MIASTA = 32

export { STYL } from '@/mapa/podklad'

// Budynki 3D (deck.gl) pobierane dopiero przy dużym zoomie albo po wybraniu adresu.
const Warstwa3D = lazy(() => import('@/miasto3d/Warstwa3D'))
/** Od tego zoomu mapa sama przechodzi w 3D (bez wybranego adresu). */
const ZOOM_3D = 16
/** Środek okolicy 3D przesuwa się za widokiem, gdy ten odjedzie dalej niż tyle metrów. */
const PRZESUNIECIE_3D_M = 300

// Wartość heksu to stan `w` (-1 = brak danych, -2 = wykluczony), bo ani stan, ani właściwość nie
// odróżniają null od nieustawionego. Feature-state ma pierwszeństwo, właściwość `w` jest bazą:
// duże zmiany idą hurtem we właściwościach (jedno setData z URL-em z workera), drobne przez
// setFeatureState.
const WARTOSC: ExpressionSpecification = ['coalesce', ['feature-state', 'w'], ['get', 'w'], -1]
const BRAK = jestBrakiem(WARTOSC)
const WYKLUCZONY = jestWykluczony(WARTOSC)
const zrodloHeksow = (res: number) => `heksy-r${res}`
const zrodloTla = (res: RozdzielczoscTla) => `tlo-r${res}`
const BLYSK: ExpressionSpecification = ['boolean', ['feature-state', 'blysk'], false]
const CZAS_BLYSKU_MS = 1500
/** Zwłoka przed zleceniem mgły workerowi: tło kolejnych miast dochodzi seriami, po kilka naraz. */
const MGLA_DEBOUNCE_MS = 300
const SZRAFURA = 'szrafura-braku'
/** Czas, po którym znika dymek tła otwarty kliknięciem: na dotyku nie ma `mouseleave`, który by go zdjął. */
const CZAS_DYMKU_TLA_MS = 3500

/** Krycie nakladki nie zmienia danych ani wybranej warstwy wyniku. */
function ustawKrycieHeksow(mapa: MapaLibre, procent: number) {
  const krycie = procent / 100
  const widoczne = procent > 0
  const visibility = widoczne ? 'visible' : 'none'
  // Suwak obejmuje też tło: inaczej przy 0% inne miasta świeciłyby spod odsłoniętej mapy.
  for (const id of [
    ...POZIOMY.map(({ res }) => zrodloHeksow(res)),
    ...POZIOMY_TLA.map(({ res }) => zrodloTla(res)),
  ]) {
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

/**
 * Warstwy jednego źródła heksów: wypełnienie, szrafura braku, linia, obrys braku i (tylko heksy
 * bieżącego miasta) błysk symulatora. Heksy bieżącego miasta i tła przechodzą przez tę samą funkcję,
 * więc tło wygląda jak ich przedłużenie, a nie osobna warstwa z własnymi wyrażeniami do pilnowania.
 */
function dodajWarstwyHeksow(
  mapa: MapaLibre,
  id: string,
  minzoom: number,
  maxzoom: number,
  zBlyskiem: boolean,
) {
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
      'fill-opacity': ['case', WYKLUCZONY, KRYCIE_WYKLUCZONEGO, BRAK, KRYCIE_BRAKU, KRYCIE_DANYCH],
    },
  })
  // Filtr nie widzi feature-state, więc szrafura leży na wszystkich heksach,
  // a widać ją tylko tam, gdzie krycie z wartości `w` mówi „brak danych".
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
  if (!zBlyskiem) return
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
}

/** Wartości `w` widoczne już na mapie (właściwość albo feature-state), per rozdzielczość: h3 → w (-1 = brak). */
type Wyslane = Record<8 | 9 | 10, Map<string, number>>
const pusteWyslane = (): Wyslane => ({ 8: new Map(), 9: new Map(), 10: new Map() })
type WyslaneTla = Record<RozdzielczoscTla, Map<string, number>>
const pusteWyslaneTla = (): WyslaneTla => ({ 8: new Map(), 9: new Map() })

/** Stany `w` wszystkich heksów mapy wartości (brak danych → W_BRAK, nigdy 0). */
function naStany(wartosci: ReadonlyMap<string, number | null>): Map<string, number> {
  const stany = new Map<string, number>()
  for (const [h, w] of wartosci) stany.set(h, stanHeksu(w))
  return stany
}

/**
 * Dostarcza mapie wartości `w` jednego źródła i zapisuje je w `wyslane` (stan, do którego dąży mapa).
 * Po zmianie zbioru kluczy (`przebuduj`) albo gdy różnic jest więcej niż PROG_PRZEBUDOWY_WARTOSCI:
 * worker składa poligony z nowymi właściwościami `w`, mapa dostaje je jako URL (`setData`), a dopiero
 * po załadowaniu tych danych znika feature-state, który inaczej przesłaniałby nową bazę. Poniżej progu:
 * `setFeatureState` tylko dla zmienionych heksów.
 *
 * Dopóki przebudowa czeka na załadowanie, każda kolejna zmiana wartości też idzie przebudową (nowsze
 * zlecenie wygrywa, starsze wyniki są odrzucane): `setFeatureState` w tym oknie zostałby zmazany przez
 * `removeFeatureState` po załadowaniu, a stare dane z feature-state wyglądałyby jak nowsze.
 */
function wyslijWartosci(
  mapa: MapaLibre,
  dostawca: DostawcaGeoJson,
  zrodlo: string,
  docelowe: ReadonlyMap<string, number>,
  wyslane: Map<string, number>,
  przebuduj: boolean,
) {
  const zmiany = przebuduj ? [] : roznice(docelowe, wyslane)
  const oczekuje = dostawca.czeka(zrodlo)
  if (przebuduj || zmiany.length > PROG_PRZEBUDOWY_WARTOSCI || (oczekuje && zmiany.length)) {
    dostawca.zlec(zrodlo, [...docelowe.keys()], Float64Array.from(docelowe.values()), () =>
      mapa.removeFeatureState({ source: zrodlo }),
    )
    wyslane.clear()
    for (const [h, v] of docelowe) wyslane.set(h, v)
    return
  }
  if (oczekuje) return
  for (const [h, v] of zmiany) {
    wyslane.set(h, v)
    mapa.setFeatureState({ source: zrodlo, id: h }, { w: v })
  }
}

function podpisHeksu(w: number | null | undefined, res: number): string {
  if (w === W_WYKLUCZONY) return res === 10 ? 'wykluczony filtrem' : 'wykluczony filtrem (okolica)'
  const tekst = w === null || w === undefined || w < 0 ? 'brak danych' : `wynik ${Math.round(w)}`
  return res === 10 ? tekst : `${tekst} (średnia okolicy)`
}

/** Etap intro (#19): widok Polski → lot do bieżącego miasta → zwykła mapa miasta. */
type Etap = 'polska' | 'lot' | 'miasto'

/** Dolna krawędź paska ustawień licząc od góry mapy (px); 0, gdy paska nie ma (intro Polski). */
function dolnaKrawedzPaska(plotno: HTMLElement): number {
  const pasek = plotno.parentElement?.querySelector('.mapa-ustawienia')
  if (!pasek) return 0
  return pasek.getBoundingClientRect().bottom - plotno.getBoundingClientRect().top
}

/** Klucz kadru z liczb: nowa tablica o tych samych granicach nie może ruszać kamery. */
const kluczKadru = (kadr: Ramka | null | undefined): string | null =>
  kadr ? kadr.flat().join(',') : null

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
  okolica,
  sasiedzi,
  obiekty,
  wyroznione,
  onWidok,
  onPierwszyKolor,
  onAwaria,
  widok3d = false,
  tlo,
  kadrStartowy,
  miasto: slugMiasta = MIASTO_DOMYSLNE,
  odstepDolny = 0,
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
  const onPierwszyKolorRef = useRef(onPierwszyKolor)
  const onAwariaRef = useRef(onAwaria)
  // Pierwszy niepusty zbiór heksów już zlecił czekanie na `idle`: wywołanie następuje raz.
  const kolorZlecony = useRef(false)
  // Pierwszy kolor się narysował: dopiero wtedy ruszają tło i mgła (worker kanału tła jest wstrzymany).
  const kolorGotowy = useRef(false)
  // Worker geometrii (poligony heksów jako URL dla mapy, mgła) – jeden na mapę, życie razem z nią.
  const dostawcaRef = useRef<DostawcaGeoJson | null>(null)
  const tloRef = useRef(tlo)
  const kadrStartowyRef = useRef(kadrStartowy)
  const slugMiastaRef = useRef(slugMiasta)
  // Tło: poligony i wartości już wysłane do mapy. Geometria tła startuje pusta, tak jak źródła.
  const geometriaTlaRef = useRef<GeometriaTla>(PUSTA_GEOMETRIA_TLA)
  const wyslaneTloRef = useRef<WyslaneTla>(pusteWyslaneTla())
  // r9 tła buduje się dopiero po pierwszym przybliżeniu, które go dotyka (poziomyTlaDoOdswiezenia).
  const r9TlaWlaczoneRef = useRef(false)
  const aktywnePoziomyTlaRef = useRef('')
  // Prostokąty obszarów z danymi: bieżącego miasta i wszystkiego razem (miasto + tło) – dla podpisu mgły.
  const obszaryRef = useRef<{ biezace: Ramka | null; wszystkie: Ramka | null }>({
    biezace: null,
    wszystkie: null,
  })
  // Kadr startowy należy do mapy do pierwszego ruchu kamery, którego nie wykonała ona sama.
  const kadrRuszonyRef = useRef(false)
  const kadrZastosowanyRef = useRef<string | null>(null)
  // Pierwszy niepusty zbiór heksów już był: tylko wtedy kadrujemy po obrysie danych.
  const kadrDanychRef = useRef(false)
  const dymekTlaRef = useRef<number | null>(null)
  const [gotowa, setGotowa] = useState(false)
  const [legenda, setLegenda] = useState<HTMLElement | null>(null)
  const [krycieHeksow, setKrycieHeksow] = useState(100)
  // Telefon: panel ustawień jest zwinięty do przycisku; na większych ekranach CSS pokazuje go zawsze.
  const [ustawieniaOtwarte, setUstawieniaOtwarte] = useState(false)
  // Legenda: rozwinięta od szerokości arkusza w górę, na telefonie i tablecie zwinięta do paska.
  const [legendaRozwinieta, setLegendaRozwinieta] = useState(
    () => !window.matchMedia(MEDIA_ARKUSZA).matches,
  )
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
    onPierwszyKolorRef.current = onPierwszyKolor
    onAwariaRef.current = onAwaria
    tloRef.current = tlo
    kadrStartowyRef.current = kadrStartowy
    slugMiastaRef.current = slugMiasta
  })

  useEffect(() => {
    const plotno = kontener.current
    if (!plotno) return
    const kadr = kadrStartowyRef.current
    // Kontener bez rozmiaru (ukryta zakładka) nie pomieści `bounds`: MapLibre zostawiłby domyślną
    // kamerę i kadr nie wróciłby sam. Wtedy mapa startuje od środka miasta, a kadr dojdzie z efektu
    // poniżej, gdy mapa będzie gotowa.
    const maRozmiar = plotno.clientWidth > 0 && plotno.clientHeight > 0
    const kamera = kameraStartowa(
      etapRef.current,
      wybranyRef.current,
      maRozmiar ? kadr : null,
      slugMiastaRef.current,
      dolnaKrawedzPaska(plotno),
    )
    if ('bounds' in kamera && kamera.bounds === kadr) kadrZastosowanyRef.current = kluczKadru(kadr)
    let mapa: MapaLibre
    try {
      mapa = new MapaLibre({
        container: plotno,
        style: STYL,
        ...kamera,
        minZoom: 5,
        maxBounds: GRANICE_WIDOKU,
        attributionControl: false,
        locale: POLSKIE_NAPISY,
      })
    } catch (e) {
      // Brak WebGL: konstruktor rzuca. Zgłaszamy awarię i oddajemy błąd dalej, jak dotąd.
      onAwariaRef.current?.()
      throw e
    }
    mapaRef.current = mapa
    // Błąd stylu przed pierwszym `load` znaczy, że mapa się nie narysuje; późniejsze błędy niczego nie otwierają.
    let zaladowana = false
    mapa.once('load', () => {
      zaladowana = true
    })
    mapa.on('error', (e) => {
      // Błąd kafla albo źródła (`sourceId`) to zwykła usterka sieci; awarią jest błąd samego stylu.
      if (zaladowana || (e as { sourceId?: string }).sourceId) return
      zaladowana = true
      onAwariaRef.current?.()
    })
    dostawcaRef.current = new DostawcaGeoJson(mapa)
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
        dodajWarstwyHeksow(mapa, id, minzoom, maxzoom, true)

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
            // Stan (drobne zmiany) przesłania właściwość `w` (baza z ostatniej przebudowy).
            const w = (mapa.getFeatureState({ source: id, id: f.id }).w ?? f.properties?.w) as
              | number
              | undefined
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
      // Tło: te same warstwy co heksy bieżącego miasta, ale tylko r8 i r9 (bez błysku symulatora).
      // Leży pod mgłą, której dziury obejmują bieżące miasto i tło razem.
      for (const { res, minzoom, maxzoom } of POZIOMY_TLA) {
        const id = zrodloTla(res)
        dodajWarstwyHeksow(mapa, id, minzoom, maxzoom, false)

        const pokazDymekTla = (e: MapLayerMouseEvent) => {
          const f = e.features?.[0]
          if (f?.id === undefined) return
          const nazwa = tloRef.current?.miastoHeksu(String(f.id)) ?? null
          if (nazwa === null) return void dymek.remove()
          const w = (mapa.getFeatureState({ source: id, id: f.id }).w ?? f.properties?.w) as
            | number
            | undefined
          dymek.setLngLat(e.lngLat).setText(podpisHeksuTla(nazwa, w)).addTo(mapa)
        }
        mapa.on('mousemove', id, (e: MapLayerMouseEvent) => {
          mapa.getCanvas().style.cursor = 'pointer'
          pokazDymekTla(e)
        })
        // Dotyk nie ma najechania, a tap w tło ma pokazać nazwę miasta i wynik (to też zmieni miasto,
        // ale o tym decyduje `onKlik`). Bez `mouseleave` dymek zdjąłby dopiero kolejny dotyk, więc znika sam.
        mapa.on('click', id, (e: MapLayerMouseEvent) => {
          pokazDymekTla(e)
          if (dymekTlaRef.current !== null) clearTimeout(dymekTlaRef.current)
          dymekTlaRef.current = window.setTimeout(() => {
            dymekTlaRef.current = null
            dymek.remove()
          }, CZAS_DYMKU_TLA_MS)
        })
        mapa.on('mouseleave', id, () => {
          mapa.getCanvas().style.cursor = ''
          dymek.remove()
        })
      }
      // Przybliżenie, które dotyka innego poziomu tła, odświeża go (geometria i wartości); patrz
      // poziomyTlaDoOdswiezenia. Samo odświeżenie wykonuje się w kolejnej klatce.
      mapa.on('zoom', () => {
        if (poziomyTlaDoOdswiezenia(mapa.getZoom()).join() !== aktywnePoziomyTlaRef.current) {
          zaplanujZastosowanie()
        }
      })
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
      // Mgła, poświata i obrys leżą POD heksami (przed pierwszą warstwą danych). Dziury w mgle obejmują
      // wszystkie miasta z danymi, więc dane niczego nie tracą na widoczności, a biała poświata nie zasłania
      // ich kolorów. Nad heksami wybielała małe miasta na widoku kraju: pomiar na zrzucie (#223, F6) dał 0%
      // pikseli w kolorze wokół dziewięciu z dziesięciu miast, a pod heksami od 0,1% (Białystok) do 39% (Kraków).
      const nadDanymi = zrodloHeksow(POZIOMY[0]?.res ?? 8)
      mapa.addLayer(
        {
          id: 'mgla',
          type: 'fill',
          source: 'mgla',
          paint: { 'fill-color': '#EEF0EE', 'fill-opacity': 0.78 },
        },
        nadDanymi,
      )
      mapa.addLayer(
        {
          id: 'obrys',
          type: 'line',
          source: 'obrys',
          paint: { 'line-color': '#9AA2A8', 'line-width': 1.5, 'line-dasharray': [4, 3] },
        },
        nadDanymi,
      )
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
      onWidokRef.current?.(c.lng, c.lat, mapa.getZoom())
      // Podpis mgły przechodzi z całości na bieżące miasto, gdy zbliżenie przekroczy próg.
      ustawPodpisMgly(mapa)
      if (krycieHeksowRef.current !== 0) return
      queueMicrotask(() => {
        if (mapaRef.current === mapa) ustawKrycieHeksow(mapa, 0)
      })
    })
    sledzGesty(mapa)

    return () => {
      dymek.remove()
      if (dymekRef.current === dymek) dymekRef.current = null
      mapa.remove()
      if (mapaRef.current === mapa) mapaRef.current = null
      geometriaRef.current = null
      geometriaTlaRef.current = PUSTA_GEOMETRIA_TLA
      wyslaneTloRef.current = pusteWyslaneTla()
      r9TlaWlaczoneRef.current = false
      aktywnePoziomyTlaRef.current = ''
      obszaryRef.current = { biezace: null, wszystkie: null }
      kadrRuszonyRef.current = false
      kadrZastosowanyRef.current = null
      kadrDanychRef.current = false
      kolorZlecony.current = false
      kolorGotowy.current = false
      anulujMgle()
      dostawcaRef.current?.zniszcz()
      dostawcaRef.current = null
      if (dymekTlaRef.current !== null) clearTimeout(dymekTlaRef.current)
      dymekTlaRef.current = null
      znacznikRef.current = null
      podpisMglyRef.current = null
      if (pauzaRef.current !== null) clearTimeout(pauzaRef.current)
      pauzaRef.current = null
      setGotowa(false)
      setLegenda(null)
    }
  }, [])

  // Suwak wag potrafi zmienić `heksy` (i `tlo`) kilka razy na klatkę, a każda rewizja to ok. 23 tys.
  // wywołań setFeatureState. Dlatego zmiana tylko zapamiętuje najnowsze mapy, a mapa dostaje
  // je raz na klatkę i wyłącznie dla heksów, których wartość się zmieniła.
  const najnowszeRef = useRef(heksy)
  const najnowszeWykluczoneRef = useRef(wykluczone)
  const najnowszeTloRef = useRef(tlo ?? BRAK_TLA)
  const klatkaRef = useRef<number | null>(null)
  const wyslaneRef = useRef<Wyslane>(pusteWyslane())
  // Mgła z sumy r8 wszystkich miast liczy się w workerze geometrii (po debounce); `timer` to zwłoka.
  const mglaRef = useRef<{ timer: number | null }>({ timer: null })

  useEffect(() => {
    najnowszeRef.current = heksy
    najnowszeWykluczoneRef.current = wykluczone
    najnowszeTloRef.current = tlo ?? BRAK_TLA
    if (gotowa) zaplanujZastosowanie()
  }, [heksy, wykluczone, tlo, gotowa])

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
    const elementPodpisu = podpisMglyRef.current?.getElement()
    if (elementPodpisu) elementPodpisu.hidden = krycieHeksow === 0
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

  /** Jedna klatka na zmiany heksów i tła, także na przybliżenie, które wprowadza poziom tła w zakres. */
  function zaplanujZastosowanie() {
    const mapa = mapaRef.current
    if (!mapa || klatkaRef.current !== null) return
    klatkaRef.current = requestAnimationFrame(() => {
      klatkaRef.current = null
      zastosuj(mapa)
    })
  }

  function zastosuj(mapa: MapaLibre) {
    // Mapa mogła zostać zdjęta (Strict Mode, zmiana ekranu) między zmianą a klatką.
    if (mapaRef.current !== mapa) return
    const zmienioneHeksy = zastosujHeksy(mapa, najnowszeRef.current, najnowszeWykluczoneRef.current)
    const zmienioneTlo = zastosujTlo(mapa, najnowszeTloRef.current)
    // Mgła zależy od sumy r8 bieżącego miasta i tła, więc przelicza się, gdy zmieni się któryś zbiór.
    if (zmienioneHeksy || zmienioneTlo) odswiezMgle(mapa)
  }

  /** Zwraca true, gdy zmienił się zbiór heksów (geometria przebudowana), czyli mgła wymaga przeliczenia. */
  function zastosujHeksy(
    mapa: MapaLibre,
    heksy: ReadonlyMap<string, number | null>,
    wykluczone: ReadonlySet<string>,
  ): boolean {
    let g = geometriaRef.current
    let zmieniona = false
    if (!takieSameKlucze(g, heksy)) {
      zmieniona = true
      g = zbudujGeometrie(heksy.keys())
      geometriaRef.current = g
    }
    // Wartości r10 oraz rodziców r8/r9 (średnia dzieci albo `wartoscRodzica`).
    const dostawca = dostawcaRef.current
    if (!dostawca) return false
    const stany: Record<8 | 9 | 10, Map<string, number>> = {
      8: new Map(),
      9: new Map(),
      10: new Map(),
    }
    for (const [h, w] of heksy) stany[10].set(h, stanHeksu(wykluczone.has(h) ? W_WYKLUCZONY : w))
    const rodzic = wartoscRodzicaRef.current ?? ((dzieci) => sredniaDzieci(dzieci, heksy))
    for (const res of [8, 9] as const) {
      for (const [h, dzieci] of g.dzieci[res])
        stany[res].set(
          h,
          stanHeksu(wszystkieWykluczone(dzieci, wykluczone) ? W_WYKLUCZONY : rodzic(dzieci)),
        )
    }
    // Nowa geometria wchodzi razem z wartościami we właściwościach: jedno setData (URL z workera)
    // na źródło, bez dziesiątek tysięcy setFeatureState (profil: 5 s na wątku głównym).
    for (const { res } of POZIOMY) {
      wyslijWartosci(
        mapa,
        dostawca,
        zrodloHeksow(res),
        stany[res],
        wyslaneRef.current[res],
        zmieniona,
      )
    }
    if (zmieniona && heksy.size && !kadrDanychRef.current) {
      // Pierwszy niepusty zbiór decyduje o kadrze. Pierwszy w ogóle bywa pusty (mapa wstaje, zanim
      // dojdą dane), a wtedy kadr po obrysie danych nigdy by nie nastąpił.
      kadrDanychRef.current = true
      if (!wybranyRef.current && !graniceRef.current) kadrujPoDanych(mapa, g.granice)
    }
    if (heksy.size && !kolorZlecony.current) {
      kolorZlecony.current = true
      // Pierwszy kolor to pierwsza klatka po załadowaniu danych r10 (worker + parsowanie). Nie `idle`:
      // ono czeka też na wszystkie kafle podkładu, co na telefonie przesuwało znacznik (i start
      // pełnych danych, i tło) o kilka sekund po tym, jak heksy były już widoczne.
      dostawca.kiedyZaladowane(zrodloHeksow(10), () => {
        mapa.once('render', () => {
          if (mapaRef.current !== mapa) return
          performance.mark('mapa-kolor')
          onPierwszyKolorRef.current?.()
          // Tło i mgła nie ścigają się z heksami bieżącego miasta o wątek; teraz mogą ruszyć.
          kolorGotowy.current = true
          dostawca.otworzTlo()
          zaplanujZastosowanie()
        })
      })
    }
    return zmieniona
  }

  /**
   * Kadr po obrysie danych bieżącego miasta, gdy nie ma ani adresu, ani ramki, ani kadru startowego
   * wszystkich miast (link z miastem albo ekran jednego miasta); w intro (`?pokaz`) zamiast tego
   * planuje lot z widoku Polski.
   */
  function kadrujPoDanych(mapa: MapaLibre, granice: Ramka | null) {
    if (etapRef.current === 'polska') return zaplanujLot(mapa)
    if (etapRef.current !== 'miasto' || kadrStartowyRef.current || kadrRuszonyRef.current) return
    if (granice) mapa.fitBounds(granice, { padding: ODSTEP_KADRU_MIASTA, animate: false })
  }

  /**
   * Tło: poligony i wartości miast innych niż bieżące. Zwraca true, gdy zmienił się zbiór heksów r8,
   * z którego składa się mgła.
   *
   * Odświeża tylko poziomy, które są widoczne przy tym zoomie (poziomyTlaDoOdswiezenia): tło ma
   * ok. 20 tys. heksów, więc przy zoomie ulicznym, gdzie nikt go nie widzi, suwak wag nie ma płacić
   * za nie zmian wartości. Nowa geometria niesie wartości we właściwościach także na poziomie
   * niewidocznym (to samo setData), a poziom, który wraca w zakres, dostaje zaległe wartości (różnica
   * względem `wyslaneTloRef`: drobna przez setFeatureState, duża przez przebudowę właściwości).
   */
  function zastosujTlo(mapa: MapaLibre, tlo: TloMapy): boolean {
    const poziomy = poziomyTlaDoOdswiezenia(mapa.getZoom())
    aktywnePoziomyTlaRef.current = poziomy.join()
    if (poziomy.includes(9)) r9TlaWlaczoneRef.current = true
    // Dopóki r9 nie był potrzebny, jego klucze liczą się jako puste, a poligony nie powstają.
    const wartosci = { 8: tlo.heksy[8], 9: r9TlaWlaczoneRef.current ? tlo.heksy[9] : BRAK_WARTOSCI }
    const stara = geometriaTlaRef.current
    let zmienionyR8 = false
    const juzWyslane = new Set<RozdzielczoscTla>()
    const dostawca = dostawcaRef.current
    if (!dostawca) return false
    if (!takieSameKluczeTla(stara, wartosci)) {
      // Poziom o niezmienionych kluczach zachowuje poligony, więc zlecenie do workera i `setData`
      // idą tylko do źródeł, które się zmieniły.
      const pelna = zbudujGeometrieTla(wartosci[8].keys(), wartosci[9].keys())
      // Przed pierwszym kolorem poziom niewidoczny przy tym zoomie w ogóle nie idzie do workera: jego
      // klucze zostają stare, więc po kolorze (`zaplanujZastosowanie`) wyjdzie jako zmiana.
      const nowa: GeometriaTla = kolorGotowy.current
        ? pelna
        : {
            klucze: {
              8: poziomy.includes(8) ? pelna.klucze[8] : stara.klucze[8],
              9: poziomy.includes(9) ? pelna.klucze[9] : stara.klucze[9],
            },
          }
      geometriaTlaRef.current = nowa
      for (const { res } of POZIOMY_TLA) {
        if (rowneKlucze(stara.klucze[res], nowa.klucze[res])) continue
        wyslijWartosci(
          mapa,
          dostawca,
          zrodloTla(res),
          naStany(wartosci[res]),
          wyslaneTloRef.current[res],
          true,
        )
        juzWyslane.add(res)
      }
      zmienionyR8 = !rowneKlucze(stara.klucze[8], nowa.klucze[8])
    }
    for (const res of poziomy) {
      if (juzWyslane.has(res)) continue
      wyslijWartosci(
        mapa,
        dostawca,
        zrodloTla(res),
        naStany(tlo.heksy[res]),
        wyslaneTloRef.current[res],
        false,
      )
    }
    return zmienionyR8
  }

  /**
   * Mgła i obrys z sumy r8 bieżącego miasta i tła: dziury w mgle obejmują wszystkie miasta z danymi.
   * Bez tła mgła bieżącego miasta jest już policzona razem z jego geometrią (od ręki). Z tłem suma
   * r8 wszystkich miast to kilka sekund `cellsToMultiPolygon`, więc liczy ją worker, a zlecenie
   * czeka MGLA_DEBOUNCE_MS: kolejne miasta dochodzą seriami i bez tego każde liczyłoby się od nowa.
   * Do czasu wyniku stoi poprzednia mgła; pierwsza mgła (jeszcze żadnej) to otoczka bieżącego miasta.
   */
  function odswiezMgle(mapa: MapaLibre) {
    const g = geometriaRef.current
    const r8Tla = geometriaTlaRef.current.klucze[8]
    if (!r8Tla.size) {
      anulujMgle()
      zastosujOtoczke(mapa, g ?? zbudujOtoczke())
      return
    }
    if (!obszaryRef.current.wszystkie) zastosujOtoczke(mapa, g ?? zbudujOtoczke())
    const st = mglaRef.current
    if (st.timer !== null) clearTimeout(st.timer)
    st.timer = window.setTimeout(() => {
      st.timer = null
      zlecMgle(mapa)
    }, MGLA_DEBOUNCE_MS)
  }

  function zastosujOtoczke(mapa: MapaLibre, otoczka: Otoczka) {
    mapa.getSource<GeoJSONSource>('mgla')?.setData(otoczka.mgla)
    mapa.getSource<GeoJSONSource>('obrys')?.setData(otoczka.obrys)
    obszaryRef.current = {
      biezace: geometriaRef.current?.granice ?? null,
      wszystkie: otoczka.granice,
    }
    ustawPodpisMgly(mapa)
  }

  /** Zleca najnowszy zbiór r8 workerowi geometrii; bez workera (albo po jego błędzie) liczy na wątku głównym. */
  function zlecMgle(mapa: MapaLibre) {
    const dostawca = dostawcaRef.current
    if (mapaRef.current !== mapa || !dostawca) return
    const r8 = [
      ...(geometriaRef.current?.dzieci[8].keys() ?? []),
      ...geometriaTlaRef.current.klucze[8],
    ]
    dostawca.mgla(r8, (otoczka) => {
      if (mapaRef.current === mapa) zastosujOtoczke(mapa, otoczka)
    })
  }

  /** Odrzuca oczekujące zlecenie mgły (timer i wynik z workera) – mgła ma zostać taka, jak jest. */
  function anulujMgle() {
    const st = mglaRef.current
    if (st.timer !== null) clearTimeout(st.timer)
    st.timer = null
    dostawcaRef.current?.anulujMgle()
  }

  /**
   * Podpis mgły stoi nad północną krawędzią obszaru z danymi: bieżącego miasta przy zbliżeniu,
   * wszystkich miast przy widoku kraju (ramkaPodpisuMgly). Marker HTML zamiast warstwy symboli:
   * podpis nie wymaga glifów ani zewnętrznego serwera.
   */
  function ustawPodpisMgly(mapa: MapaLibre) {
    const { biezace, wszystkie } = obszaryRef.current
    const ramka = ramkaPodpisuMgly(mapa.getZoom(), biezace, wszystkie)
    if (!ramka) {
      podpisMglyRef.current?.remove()
      podpisMglyRef.current = null
      return
    }
    let znacznik = podpisMglyRef.current
    if (!znacznik) {
      const el = document.createElement('div')
      el.className = 'mapa-mgla-podpis'
      el.setAttribute('aria-hidden', 'true')
      el.hidden = krycieHeksowRef.current === 0
      // Nad północną krawędzią: na wąskim ekranie bok obszaru bywa tuż przy brzegu mapy.
      znacznik = new Marker({ element: el, anchor: 'bottom', offset: [0, -10] })
      podpisMglyRef.current = znacznik
      znacznik.setLngLat(kotwicaPodpisu(ramka)).addTo(mapa)
    }
    znacznik.getElement().textContent = podpisMgly(tloRef.current !== undefined)
    znacznik.setLngLat(kotwicaPodpisu(ramka))
  }

  useEtykietyZrodel(mapaRef, gotowa, tlo !== undefined)
  useZnacznikiSasiadow(mapaRef, gotowa, sasiedzi)
  useZnacznikiObiektow(mapaRef, gotowa, obiekty)
  useObrysOkolicy(mapaRef, gotowa, okolica, () => {
    kadrRuszonyRef.current = true
    if (etapRef.current !== 'miasto') zakonczIntro()
  })

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
    // Lot do adresu należy do użytkownika: późniejszy kadr startowy nie może go cofnąć.
    kadrRuszonyRef.current = true
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

  // Miejsca A–E trybu „Biznes”: przyciski z klawiaturą i opisem dla czytnika (#106).
  useZnacznikiBiznesu(mapaRef, gotowa, postawionePunkty, onPrzesunPunkt, onUsunPunkt)
  // Przelot do ramki (okolica z rankingu). Klucz z liczb, bo nowa tablica przy tych samych
  // granicach nie może ruszać kamery.
  const kluczGranic = kluczKadru(granice)
  useEffect(() => {
    const mapa = mapaRef.current
    const g = graniceRef.current
    if (!mapa || !gotowa || kluczGranic === null || !g) return
    kadrRuszonyRef.current = true
    if (etapRef.current !== 'miasto') zakonczIntro()
    const kamera = mapa.cameraForBounds(g, { padding: 48, maxZoom: 16 })
    if (kamera) void lec(mapa, kamera)
  }, [gotowa, kluczGranic])

  // Kadr startowy wszystkich miast, który dotarł po starcie mapy (kadr znany od początku trafia
  // do konstruktora). Dopasowanie bez animacji, dopóki użytkownik nie ruszył kamery i nic innego
  // nie wskazało miejsca (adres, ramka, intro Polski); gest, lot albo link z adresem go wyprzedzają.
  const kluczKadruStartowego = kluczKadru(kadrStartowy)
  useEffect(() => {
    const mapa = mapaRef.current
    const kadr = kadrStartowyRef.current
    if (!mapa || !gotowa || !kadr || kluczKadruStartowego === null) return
    if (kadrZastosowanyRef.current === kluczKadruStartowego) return
    if (etapRef.current !== 'miasto' || kadrRuszonyRef.current) return
    if (wybranyRef.current || graniceRef.current) return
    kadrZastosowanyRef.current = kluczKadruStartowego
    mapa.fitBounds(kadr, {
      padding: odstepKadruStartowego(dolnaKrawedzPaska(mapa.getContainer())),
      animate: false,
    })
  }, [gotowa, kluczKadruStartowego])

  // Padding dolny mapy: flyTo/jumpTo (lec) i cameraForBounds liczą środek z transform.padding,
  // a fitBounds go nie nadpisuje (MapLibre kasuje padding z opcji przed ruchem), więc wystarczy
  // ustawić go tu raz. easeTo przerwałby trwający przelot (wybór okolicy, miasta, adresu), więc w ruchu
  // czekamy na jego koniec.
  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa || !gotowa) return
    const ustaw = () => {
      mapa.easeTo({
        padding: { top: 0, bottom: odstepDolny, left: 0, right: 0 },
        duration: ograniczonyRuch() ? 0 : 300,
      })
    }
    if (!mapa.isMoving()) {
      ustaw()
      return
    }
    mapa.once('moveend', ustaw)
    return () => {
      mapa.off('moveend', ustaw)
    }
  }, [gotowa, odstepDolny])

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
    kadrRuszonyRef.current = true
    // Lot ląduje w bieżącym mieście; zanim dojdzie obrys jego danych (klik „Pokaż <miasto>"
    // tuż po starcie), kadrem jest ramka wokół środka miasta z rejestru.
    const kamera = kameraDlaGranic(
      mapa,
      geometriaRef.current?.granice ?? kadrZapasowyMiasta(slugMiastaRef.current),
    )
    if (!kamera) return zakonczIntro()
    etapRef.current = 'lot'
    setEtap('lot')
    void lec(mapa, kamera).then(() => {
      if (mapaRef.current !== mapa || etapRef.current !== 'lot') return
      etapRef.current = 'miasto'
      setEtap('miasto')
    })
  }

  /**
   * Gest użytkownika (ruch z `originalEvent`) odbiera mapie prawo do poprawiania kadru startowego,
   * a w trakcie intro MapLibre sam przerywa lot i my kończymy etap. Własne ruchy mapy – kadr startowy,
   * loty do adresu, okolicy i ramki – nie mają `originalEvent`; loty zaznaczają to osobno (`kadrRuszonyRef`).
   */
  function sledzGesty(mapa: MapaLibre) {
    mapa.on('movestart', (e) => {
      if (!('originalEvent' in e) || !e.originalEvent) return
      kadrRuszonyRef.current = true
      if (etapRef.current !== 'miasto') zakonczIntro()
    })
  }

  return (
    <div
      className={etap === 'miasto' ? 'mapa-krakowa' : 'mapa-krakowa mapa-krakowa--intro'}
      style={{ '--arkusz-odstep': `${odstepDolny}px` } as CSSProperties}
    >
      <div
        ref={kontener}
        className="mapa-krakowa__plotno"
        role="region"
        aria-label={`Mapa miast – ${podpisWarstwy}`}
      />
      {etap === 'miasto' && (
        <div className="mapa-ustawienia" role="group" aria-label="Ustawienia mapy">
          <button
            type="button"
            className="mapa-ustawienia__przycisk"
            aria-label="Ustawienia mapy"
            aria-expanded={ustawieniaOtwarte}
            aria-controls={`${idKrycia}-panel`}
            onClick={() => setUstawieniaOtwarte((o) => !o)}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="8" cy="17" r="2" />
            </svg>
          </button>
          <div
            id={`${idKrycia}-panel`}
            className="mapa-ustawienia__panel"
            data-otwarte={ustawieniaOtwarte || undefined}
          >
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
          nazwaMiasta={miastoZRejestru(slugMiasta).nazwa}
          onPokaz={() => {
            const mapa = mapaRef.current
            if (mapa) startujLot(mapa)
          }}
        />
      )}
      {legenda &&
        krycieHeksow > 0 &&
        createPortal(
          <>
            <button
              type="button"
              className="mapa-legenda__naglowek"
              aria-expanded={legendaRozwinieta}
              data-cel="legenda-przelacznik"
              onClick={() => setLegendaRozwinieta((r) => !r)}
            >
              <span className="mapa-legenda__tytul">{podpisWarstwy}</span>
              <span className="mapa-legenda__strzalka" aria-hidden="true" />
            </button>
            {!legendaRozwinieta && wlasnaLegenda === undefined && (
              <div className="mapa-legenda__zwinieta">
                <div
                  className="mapa-legenda__pasek"
                  style={{
                    background: gradientCss(),
                    opacity: (KRYCIE_DANYCH * krycieHeksow) / 100,
                  }}
                />
                <span
                  className="mapa-legenda__probka mapa-legenda__probka--brak"
                  style={{ background: szrafuraCss() }}
                  role="img"
                  aria-label="brak danych"
                />
              </div>
            )}
            {legendaRozwinieta && wlasnaLegenda !== undefined && wlasnaLegenda}
            {legendaRozwinieta && wlasnaLegenda === undefined && (
              <>
                <div
                  className="mapa-legenda__pasek"
                  style={{
                    background: gradientCss(),
                    opacity: (KRYCIE_DANYCH * krycieHeksow) / 100,
                  }}
                />
                <div className="mapa-legenda__skala" aria-hidden="true">
                  {etykietySkali.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                {/* Ocena warstwy to pozycja w rozkładzie adresów danego miasta (D10): kolor 70 w Łodzi
                    i w Krakowie znaczy co innego, więc przy tle mapa mówi to wprost, zamiast sugerować
                    porównywalność. */}
                {tlo && tlo.heksy[8].size > 0 && (
                  <div className="mapa-legenda__nota">{TEKST_SKALI_MIAST}</div>
                )}
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
                  {podpisMgly(tlo !== undefined)}
                </div>
              </>
            )}
          </>,
          legenda,
        )}
    </div>
  )
}

/**
 * Kamera w chwili utworzenia mapy: adres z linku, widok Polski (intro), kadr wszystkich miast, a bez
 * niczego z tego środek bieżącego miasta (rejestr zna tylko punkt, więc zoom jest stały).
 */
function kameraStartowa(
  etap: Etap,
  wybrany: { lon: number; lat: number } | null | undefined,
  kadr: Ramka | null | undefined,
  slug: SlugMiasta,
  dolnaKrawedzPaskaPx: number,
):
  | { bounds: Ramka; fitBoundsOptions?: { padding: ReturnType<typeof odstepKadruStartowego> } }
  | { center: [number, number]; zoom: number } {
  if (wybrany) return { center: [wybrany.lon, wybrany.lat], zoom: 16 }
  if (etap === 'polska') return { bounds: WIDOK_POLSKI }
  if (kadr) {
    return {
      bounds: kadr,
      fitBoundsOptions: { padding: odstepKadruStartowego(dolnaKrawedzPaskaPx) },
    }
  }
  return { center: miastoZRejestru(slug).srodek, zoom: ZOOM_MIASTA }
}

/** Winieta i podpis nad widokiem Polski; znikają, gdy kamera dolatuje do bieżącego miasta. */
function IntroPolski({
  lot,
  nazwaMiasta,
  onPokaz,
}: {
  lot: boolean
  nazwaMiasta: string
  onPokaz: () => void
}): JSX.Element {
  return (
    <>
      <div className="mapa-intro-winieta" aria-hidden="true" />
      <div className={lot ? 'mapa-intro-podpis mapa-intro-podpis--lot' : 'mapa-intro-podpis'}>
        <p>{tekstIntro()}</p>
        {!lot && (
          <button type="button" className="mapa-intro-przycisk" onClick={onPokaz}>
            {podpisPrzyciskuIntro(nazwaMiasta)}
          </button>
        )}
      </div>
    </>
  )
}
