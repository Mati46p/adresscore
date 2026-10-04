// Okolica wybrana w wyszukiwarce na mapie (#185): obrys jednostki SIM z `okolice-granice.geojson`
// i ramka do przelotu kamery. Czyste funkcje bez MapLibre i Reacta – testy na gołym `node --test`.
//
// Zasady:
// - Jednostka SIM ma granice w pliku (123 wielokąty z MSIP), więc mapa pokazuje jej obrys i leci do jego ramki.
// - Miejscowość poza Krakowem nie ma granic w pliku (są tylko punkty adresowe): ramka adresów, bez obrysu.
//   Tak samo jednostka, której pliku granic nie udało się wczytać albo którego wpis nie zgadza się z okolice.json
//   (inny numer = inny podział; lepiej bez obrysu niż z obrysem innej jednostki).
// - Obrys to jednostka SIM, nie osiedle: nazwy z OSM są punktami (etl/okolice.md), a mapa pokazuje granice
//   z podziału miasta. Mówi o tym pasek okolicy pod wyszukiwarką.
import type { Adres } from '../../kontrakty/index.ts'
import type { PlikOkolic } from '../../kontrakty/okolice.ts'
import { type Granice, graniceOkolicy } from '../luki/skalaLuk.ts'

export type { Granice }

/** Jednostka SIM w `okolice-granice.geojson`: wielokąt z numerem i nazwą (`etl/okolice.md`). */
export interface JednostkaGeoJson {
  type: 'Feature'
  properties: {
    id: string
    numer: string
    nazwa: string
    dzielnica: string
    powierzchniaKm2: number
  }
  geometry: { type: 'Polygon'; coordinates: number[][][] }
}

/** Plik `public/dane/okolice-granice.geojson`. */
export interface PlikGranic {
  type: 'FeatureCollection'
  features: JednostkaGeoJson[]
}

/** Okolica gotowa do pokazania na mapie. Nowy obiekt = nowy wybór = nowy przelot kamery. */
export interface OkolicaNaMapie {
  /** Id okolicy jak w `okolice.json`: „sim-805”, „m-1219064-grabowki”. */
  id: string
  /** Ramka do przelotu kamery: [[zachód, południe], [wschód, północ]]. */
  granice: Granice
  /** Obrys jednostki SIM; null dla miejscowości i dla jednostki bez wpisu w pliku granic. */
  obrys: JednostkaGeoJson | null
}

/**
 * Najmniejszy prostokąt obejmujący wielokąt (pierścień zewnętrzny i ewentualne dziury) albo null,
 * gdy nie ma w nim ani jednego punktu ze skończonymi współrzędnymi.
 */
export function graniceWielokata(
  wspolrzedne: readonly (readonly (readonly number[])[])[],
): Granice | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const pierscien of wspolrzedne) {
    for (const punkt of pierscien) {
      const x = punkt[0]
      const y = punkt[1]
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return minX > maxX
    ? null
    : [
        [minX, minY],
        [maxX, maxY],
      ]
}

/**
 * Jednostka SIM o danym id z pliku granic. Z `numer` sprawdza też, że to ta sama jednostka co w `okolice.json`:
 * oba pliki powstają z jednego źródła, ale każdy ma własną wersję, więc rozjazd ma wyjść jako brak obrysu.
 */
export function znajdzJednostke(
  plik: Pick<PlikGranic, 'features'> | null | undefined,
  id: string,
  numer?: string,
): JednostkaGeoJson | null {
  const j = plik?.features.find((f) => f.properties.id === id)
  if (!j || j.geometry.type !== 'Polygon') return null
  if (numer !== undefined && j.properties.numer !== numer) return null
  return j
}

/**
 * Okolica o id z `okolice.json` do pokazania na mapie albo null, gdy nie da się wskazać miejsca
 * (nieznane id, okolica bez adresu ze współrzędnymi i bez granic).
 */
export function okolicaNaMapie(
  id: string,
  granice: Pick<PlikGranic, 'features'> | null | undefined,
  adresy: readonly Pick<Adres, 'dzielnica' | 'gmina' | 'lon' | 'lat'>[],
  okolice: PlikOkolic,
): OkolicaNaMapie | null {
  const wpis = okolice.okolice[id]
  if (!wpis) return null
  if (wpis.rodzaj === 'sim') {
    const jednostka = znajdzJednostke(granice, id, wpis.numer)
    const ramka = jednostka ? graniceWielokata(jednostka.geometry.coordinates) : null
    if (jednostka && ramka) return { id, granice: ramka, obrys: jednostka }
  }
  // Miejscowość albo jednostka bez granic: ramka adresów okolicy (ma minimalny bok, żeby jeden adres
  // nie przybliżał mapy do maksimum).
  const ramka = graniceOkolicy(adresy, id, okolice)
  return ramka ? { id, granice: ramka, obrys: null } : null
}
