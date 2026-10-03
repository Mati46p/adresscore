import { cellsToMultiPolygon, cellToBoundary, cellToParent } from 'h3-js'

// Własne minimalne typy GeoJSON: pakiet @types/geojson nie jest bezpośrednią zależnością.
interface Polygon {
  type: 'Polygon'
  coordinates: [number, number][][]
}
interface Feature<G = Polygon, P = Record<string, unknown>> {
  type: 'Feature'
  properties: P
  geometry: G
}
interface FeatureCollection<G = Polygon, P = Record<string, unknown>> {
  type: 'FeatureCollection'
  features: Feature<G, P>[]
}

// Poziomy szczegółu: heks r10 (~65 m krawędzi) ma przy zoomie 12 ok. 5 px szerokości, przy 11
// już 2–3 px – wtedy kilkanaście tysięcy heksów Krakowa zlewa się w szum i obciąża telefon.
// Dlatego poniżej zoomu 13 rysujemy rodzica r9 (~175 m, ok. 7 px przy zoomie 11), a poniżej 11
// rodzica r8 (~460 m). Granice dobrane tak, by heks miał co najmniej ok. 5 px.
export const POZIOMY = [
  { res: 8, minzoom: 0, maxzoom: 11 },
  { res: 9, minzoom: 11, maxzoom: 13 },
  { res: 10, minzoom: 13, maxzoom: 24 },
] as const

export type Rozdzielczosc = (typeof POZIOMY)[number]['res']

export interface Geometria {
  klucze: ReadonlySet<string>
  /** Rozdzielczość → poligony heksów (właściwość h3 = id do feature-state). */
  zrodla: Record<Rozdzielczosc, FeatureCollection<Polygon, { h3: string }>>
  /** Rodzic r8/r9 → jego heksy r10 z danymi; do średniej przy oddaleniu. */
  dzieci: Record<8 | 9, Map<string, string[]>>
  /** Świat z dziurami w miejscu obszaru z danymi – mgła wojny. */
  mgla: Feature<Polygon>
  /** Obrys obszaru z danymi (linia przerywana na granicy mgły). */
  obrys: FeatureCollection<Polygon>
  granice: [[number, number], [number, number]]
}

const SWIAT: [number, number][] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
]

function kolekcja(h3: Iterable<string>): FeatureCollection<Polygon, { h3: string }> {
  const features: Feature<Polygon, { h3: string }>[] = []
  for (const h of h3) {
    features.push({
      type: 'Feature',
      properties: { h3: h },
      geometry: { type: 'Polygon', coordinates: [cellToBoundary(h, true)] },
    })
  }
  return { type: 'FeatureCollection', features }
}

/** Liczone raz na zbiór kluczy – zmiana samych wyników nie przebudowuje geometrii. */
export function zbudujGeometrie(klucze: Iterable<string>): Geometria {
  const zbior = new Set(klucze)
  const dzieci: Geometria['dzieci'] = { 8: new Map(), 9: new Map() }
  for (const h of zbior) {
    for (const res of [8, 9] as const) {
      const rodzic = cellToParent(h, res)
      const lista = dzieci[res].get(rodzic)
      if (lista) lista.push(h)
      else dzieci[res].set(rodzic, [h])
    }
  }

  // Otoczka z rodziców r8, nie z r10: r10 dałby postrzępiony brzeg i setki dziur w parkach.
  // Wewnętrzne dziury pomijamy – mgła ma przykrywać to, co poza Krakowem, nie łąki w mieście.
  const wielokat = zbior.size ? cellsToMultiPolygon([...dzieci[8].keys()], true) : []
  const zewnetrzne = wielokat.map((p) => p[0]).filter((r): r is [number, number][] => !!r)

  let minX = 180
  let minY = 90
  let maxX = -180
  let maxY = -90
  for (const pierscien of zewnetrzne) {
    for (const [x, y] of pierscien) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }

  return {
    klucze: zbior,
    zrodla: { 8: kolekcja(dzieci[8].keys()), 9: kolekcja(dzieci[9].keys()), 10: kolekcja(zbior) },
    dzieci,
    mgla: {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [SWIAT, ...zewnetrzne] },
    },
    obrys: {
      type: 'FeatureCollection',
      features: zewnetrzne.map((r) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [r] },
      })),
    },
    granice: [
      [minX, minY],
      [maxX, maxY],
    ],
  }
}

/** Średnia znanych wyników dzieci; same braki → null (nigdy 0). */
export function sredniaDzieci(
  dzieciRodzica: readonly string[],
  heksy: ReadonlyMap<string, number | null>,
): number | null {
  let suma = 0
  let n = 0
  for (const h of dzieciRodzica) {
    const v = heksy.get(h)
    if (v === null || v === undefined || Number.isNaN(v)) continue
    suma += v
    n++
  }
  return n ? suma / n : null
}

export function takieSameKlucze(
  g: Geometria | null,
  heksy: ReadonlyMap<string, unknown>,
): g is Geometria {
  if (!g || g.klucze.size !== heksy.size) return false
  for (const k of heksy.keys()) if (!g.klucze.has(k)) return false
  return true
}
