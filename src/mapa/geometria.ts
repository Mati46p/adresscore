import { cellsToMultiPolygon, cellToBoundary, cellToParent } from 'h3-js'

// Czyste funkcje bez DOM i bez MapLibre – testy na gołym `node --test` (geometria.test.ts).

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

/** Prostokąt [[zachód, południe], [wschód, północ]] w stopniach. */
export type Ramka = [[number, number], [number, number]]

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

/**
 * Poziomy tła (#223): miasta inne niż bieżące rysujemy tylko jako r8 i r9, z tymi samymi zakresami
 * zoomu co heksy bieżącego miasta, żeby tło wyglądało jak ich przedłużenie. Bez r10: MapLibre i
 * telefon nie uniosą kilkudziesięciu tysięcy heksów r10 wszystkich miast naraz.
 */
export const POZIOMY_TLA = [POZIOMY[0], POZIOMY[1]] as const

export type RozdzielczoscTla = (typeof POZIOMY_TLA)[number]['res']

/** Mgła wojny i obrys obszaru z danymi – to, co zależy wyłącznie od zbioru heksów r8. */
export interface Otoczka {
  /** Świat z dziurami w miejscu obszaru z danymi – mgła wojny. */
  mgla: Feature<Polygon>
  /** Obrys obszaru z danymi (linia przerywana na granicy mgły). */
  obrys: FeatureCollection<Polygon>
  /** Prostokąt obszaru z danymi; null, gdy nie ma żadnego heksu (nie ma czego obejmować kadrem). */
  granice: Ramka | null
}

export interface Geometria extends Otoczka {
  klucze: ReadonlySet<string>
  /** Rozdzielczość → poligony heksów (właściwość h3 = id do feature-state). */
  zrodla: Record<Rozdzielczosc, FeatureCollection<Polygon, { h3: string }>>
  /** Rodzic r8/r9 → jego heksy r10 z danymi; do średniej przy oddaleniu. */
  dzieci: Record<8 | 9, Map<string, string[]>>
}

/** Poligony r8 i r9 miast tła; r10 tła nie ma (patrz POZIOMY_TLA). */
export interface GeometriaTla {
  /** Klucze obu poziomów – do porównania „czy zbiór się zmienił" bez przebudowy poligonów. */
  klucze: Record<RozdzielczoscTla, ReadonlySet<string>>
  zrodla: Record<RozdzielczoscTla, FeatureCollection<Polygon, { h3: string }>>
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

/**
 * Mgła, obrys i prostokąt z heksów r8 – jednego zbioru albo sumy kilku (bieżące miasto + tło, #223).
 * Otoczka z r8, nie z r10: r10 dałby postrzępiony brzeg i setki dziur w parkach. Wewnętrzne dziury
 * pomijamy – mgła ma przykrywać to, co poza miastami z danymi, nie łąki w mieście.
 *
 * Powtórzony heks (to samo r8 w dwóch zbiorach) liczy się raz: `cellsToMultiPolygon` wymaga
 * unikalnych komórek.
 */
export function zbudujOtoczke(...r8: Iterable<string>[]): Otoczka {
  const komorki = new Set<string>()
  for (const zbior of r8) for (const h of zbior) komorki.add(h)
  const wielokat = komorki.size ? cellsToMultiPolygon([...komorki], true) : []
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
    // Bez żadnego pierścienia min/max zostają wartościami początkowymi (odwrócony prostokąt), a taki
    // kadr nie ma sensu: null mówi wprost „nie ma czego pokazać".
    granice: zewnetrzne.length
      ? [
          [minX, minY],
          [maxX, maxY],
        ]
      : null,
  }
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

  return {
    klucze: zbior,
    zrodla: { 8: kolekcja(dzieci[8].keys()), 9: kolekcja(dzieci[9].keys()), 10: kolekcja(zbior) },
    dzieci,
    ...zbudujOtoczke(dzieci[8].keys()),
  }
}

/**
 * Poligony tła z kluczy r8 i r9 (kolekcje bez r10). Liczone raz na zbiór kluczy, tak samo jak
 * `zbudujGeometrie`: zmiana samych wartości (suwak wag) nie przebudowuje wielokątów. Mgłę z sumy
 * bieżącego miasta i tła składa `zbudujOtoczke` z kluczy r8 obu zbiorów, bo tło jej nie przechowuje.
 *
 * Z `poprzednia` poziom o tych samych kluczach dostaje tę samą kolekcję (ten sam obiekt): wołający
 * porównuje `zrodla[res]` z poprzednią i wysyła do mapy tylko poziomy, które naprawdę się zmieniły.
 * Doczytane miasto zmienia klucze r8 i r9 naraz, ale samo przybliżenie, które włącza r9, nie
 * powinno przebudowywać r8 (i odwrotnie).
 */
export function zbudujGeometrieTla(
  r8: Iterable<string>,
  r9: Iterable<string>,
  poprzednia: GeometriaTla | null = null,
): GeometriaTla {
  const klucze = { 8: new Set(r8), 9: new Set(r9) }
  const poziom = (res: RozdzielczoscTla) =>
    poprzednia && rowneKlucze(poprzednia.klucze[res], klucze[res])
      ? poprzednia.zrodla[res]
      : kolekcja(klucze[res])
  return { klucze, zrodla: { 8: poziom(8), 9: poziom(9) } }
}

/**
 * Zapas w poziomach zoomu: lot z widoku Polski do miasta mija próg zoomu w kilka klatek, a heks bez
 * feature-state wyglądałby przez ten czas jak „brak danych".
 */
const ZAPAS_ZOOMU_TLA = 1.5

/**
 * Poziomy tła, które mają być teraz aktualne (geometria i feature-state): widoczne przy tym zoomie
 * plus zapas na dolot kamery. Dwa powody, dla których nie odświeżamy wszystkiego zawsze:
 * - suwak wag zmienia wartości kilka razy na klatkę, a każda zmiana to setFeatureState na każdy heks;
 *   przy zoomie ulicznym tło (kilkanaście tysięcy r9 + kilka tysięcy r8) jest niewidoczne, więc te
 *   wywołania byłyby czystym kosztem,
 * - r9 tła to kilkanaście tysięcy poligonów liczonych na głównym wątku; przy widoku Polski nikt ich
 *   nie widzi, a start strony i tak czeka na sieć.
 */
export function poziomyTlaDoOdswiezenia(zoom: number): readonly RozdzielczoscTla[] {
  return POZIOMY_TLA.filter(
    (p) => zoom >= p.minzoom - ZAPAS_ZOOMU_TLA && zoom < p.maxzoom + ZAPAS_ZOOMU_TLA,
  ).map((p) => p.res)
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

/** Czy zbiór kluczy to dokładnie klucze mapy albo drugiego zbioru (kolejność bez znaczenia). */
export function rowneKlucze(
  zbior: ReadonlySet<string>,
  inne: { readonly size: number; keys(): Iterable<string> },
): boolean {
  if (zbior.size !== inne.size) return false
  for (const k of inne.keys()) if (!zbior.has(k)) return false
  return true
}

export function takieSameKlucze(
  g: Geometria | null,
  heksy: ReadonlyMap<string, unknown>,
): g is Geometria {
  return g !== null && rowneKlucze(g.klucze, heksy)
}

/**
 * To samo dla tła: oba poziomy muszą mieć te same klucze, inaczej wielokąty trzeba zbudować od nowa.
 * Zwykły boolean, nie predykat typu: wołający trzyma geometrię tła zawsze (pustą na starcie), więc
 * predykat zawężałby jej typ w gałęzi „inne klucze" do `never`.
 */
export function takieSameKluczeTla(
  g: GeometriaTla | null,
  tlo: Record<RozdzielczoscTla, ReadonlyMap<string, unknown>>,
): boolean {
  return g !== null && rowneKlucze(g.klucze[8], tlo[8]) && rowneKlucze(g.klucze[9], tlo[9])
}
