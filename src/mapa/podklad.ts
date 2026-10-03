import type { LayerSpecification, Map as MapaLibre, StyleSpecification } from 'maplibre-gl'

/** Lokalny wycinek Protomaps Basemap v4 z OSM, stan 2026-10-02. */
const BASE = `${window.location.origin}${import.meta.env.BASE_URL}`
const ADRES_MIASTA = `pmtiles://${BASE}mapa/krakow-obwarzanek.pmtiles`
const ADRES_POLSKI = `pmtiles://${BASE}mapa/polska-przeglad.pmtiles`
const ATRYBUCJA =
  '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'

export type GrupaPodkladu = 'ulice' | 'tramwaje' | 'zielen' | 'woda' | 'nazwy'

export const GRUPY_PODKLADU: readonly { id: GrupaPodkladu; etykieta: string }[] = [
  { id: 'ulice', etykieta: 'Ulice' },
  { id: 'tramwaje', etykieta: 'Tramwaje' },
  { id: 'zielen', etykieta: 'Zieleń' },
  { id: 'woda', etykieta: 'Woda' },
  { id: 'nazwy', etykieta: 'Nazwy' },
]

const WARSTWY_GRUP: Record<GrupaPodkladu, string[]> = {
  ulice: [],
  tramwaje: [],
  zielen: [],
  woda: [],
  nazwy: [],
}

const warstwy: LayerSpecification[] = [
  { id: 'podklad-tlo', type: 'background', paint: { 'background-color': '#f6f7f4' } },
]

// Polska do z7 jest tłem intro. Od z8 mapa używa dokładnego wycinka Krakowa i obwarzanka.
// Granice wycinków i procedura odtworzenia są w public/mapa/README.md.
for (const [zrodlo, przedzial] of [
  ['polska', { minzoom: 0, maxzoom: 8 }],
  ['krakow', { minzoom: 8, maxzoom: 24 }],
] as const) {
  const dodaj = (grupa: GrupaPodkladu, warstwa: LayerSpecification) => {
    warstwy.push({
      ...warstwa,
      minzoom: Math.max(przedzial.minzoom, warstwa.minzoom ?? 0),
      maxzoom: Math.min(przedzial.maxzoom, warstwa.maxzoom ?? 24),
    })
    WARSTWY_GRUP[grupa].push(warstwa.id)
  }
  const nazwa = (id: string) => `podklad-${zrodlo}-${id}`
  const lokalnaNazwa: ['coalesce', ['get', string], ['get', string]] = [
    'coalesce',
    ['get', 'name:pl'],
    ['get', 'name'],
  ]

  dodaj('zielen', {
    id: nazwa('lasy'),
    type: 'fill',
    source: zrodlo,
    'source-layer': 'landcover',
    filter: ['in', ['get', 'kind'], ['literal', ['forest', 'grassland', 'scrub']]],
    paint: { 'fill-color': '#d9e7d8', 'fill-opacity': 0.85 },
  })
  dodaj('zielen', {
    id: nazwa('parki'),
    type: 'fill',
    source: zrodlo,
    'source-layer': 'landuse',
    filter: [
      'in',
      ['get', 'kind'],
      [
        'literal',
        [
          'forest',
          'wood',
          'park',
          'garden',
          'grass',
          'meadow',
          'nature_reserve',
          'recreation_ground',
          'playground',
        ],
      ],
    ],
    paint: { 'fill-color': '#d5e6d2', 'fill-opacity': 0.85 },
  })
  dodaj('woda', {
    id: nazwa('woda-obszar'),
    type: 'fill',
    source: zrodlo,
    'source-layer': 'water',
    paint: { 'fill-color': '#c5dce8' },
  })
  dodaj('woda', {
    id: nazwa('woda-linia'),
    type: 'line',
    source: zrodlo,
    'source-layer': 'water',
    paint: {
      'line-color': '#a6cddd',
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 15, 2],
    },
  })
  dodaj('ulice', {
    id: nazwa('budynki'),
    type: 'fill',
    source: zrodlo,
    'source-layer': 'buildings',
    minzoom: 13,
    filter: ['==', ['get', 'kind'], 'building'],
    paint: { 'fill-color': '#e7e3dc', 'fill-outline-color': '#d9d5ce' },
  })
  dodaj('ulice', {
    id: nazwa('drogi'),
    type: 'line',
    source: zrodlo,
    'source-layer': 'roads',
    filter: ['in', ['get', 'kind'], ['literal', ['highway', 'major_road', 'minor_road', 'path']]],
    paint: {
      'line-color': [
        'match',
        ['get', 'kind'],
        'highway',
        '#d7b798',
        'major_road',
        '#dfcbb0',
        'path',
        '#d8d5cd',
        '#ffffff',
      ],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        7,
        ['match', ['get', 'kind'], 'highway', 1.6, 'major_road', 1.1, 0.5],
        14,
        ['match', ['get', 'kind'], 'highway', 7, 'major_road', 5, 'minor_road', 3, 1.5],
        18,
        ['match', ['get', 'kind'], 'highway', 15, 'major_road', 12, 'minor_road', 8, 4],
      ],
    },
  })
  dodaj('tramwaje', {
    id: nazwa('tramwaje'),
    type: 'line',
    source: zrodlo,
    'source-layer': 'roads',
    minzoom: 10,
    filter: ['==', ['get', 'kind_detail'], 'tram'],
    paint: {
      'line-color': '#b45f63',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 17, 2.5],
    },
  })
  dodaj('nazwy', {
    id: nazwa('miejsca'),
    type: 'symbol',
    source: zrodlo,
    'source-layer': 'places',
    layout: {
      'text-field': lokalnaNazwa,
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 13, 15],
      'text-max-width': 8,
    },
    paint: { 'text-color': '#45505a', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
  })
  dodaj('nazwy', {
    id: nazwa('ulice-nazwy'),
    type: 'symbol',
    source: zrodlo,
    'source-layer': 'roads',
    minzoom: 12,
    filter: ['in', ['get', 'kind'], ['literal', ['highway', 'major_road', 'minor_road']]],
    layout: {
      'symbol-placement': 'line',
      'text-field': lokalnaNazwa,
      'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 17, 13],
      'text-max-angle': 30,
      'symbol-spacing': 300,
    },
    paint: { 'text-color': '#4d5157', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
  })
}

export const STYL: StyleSpecification = {
  version: 8,
  glyphs: `${BASE}mapa/fonts/{fontstack}/{range}.pbf`,
  sources: {
    polska: { type: 'vector', url: ADRES_POLSKI, attribution: ATRYBUCJA },
    krakow: { type: 'vector', url: ADRES_MIASTA, attribution: ATRYBUCJA },
  },
  layers: warstwy,
}

export function ustawGrupePodkladu(mapa: MapaLibre, grupa: GrupaPodkladu, widoczna: boolean) {
  for (const id of WARSTWY_GRUP[grupa]) {
    if (mapa.getLayer(id)) mapa.setLayoutProperty(id, 'visibility', widoczna ? 'visible' : 'none')
  }
}

/** Nazwy na wierzchu heksów ułatwiają orientację również przy włączonym wyniku. */
export function przeniesNazwyNaWierzch(mapa: MapaLibre) {
  for (const id of WARSTWY_GRUP.nazwy) if (mapa.getLayer(id)) mapa.moveLayer(id)
}
