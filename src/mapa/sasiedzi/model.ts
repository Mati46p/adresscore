// „Lepszy sąsiad” na mapie (#95): czyste funkcje bez MapLibre i Reacta – testy na gołym
// `node --test`. Warstwa (ZnacznikiSasiadow.ts) tylko rysuje to, co tu policzone.
//
// Warstwa nie ma własnego stanu wyboru: wspólny stan karty i mapy trzyma sekcja z #94
// (`src/wynik/sasiedziStan.ts`), a propsy to wprost jej `PropsSasiadowMapy`
// (`usePropsSasiadowMapy()` z `src/wynik/useSasiedzi.ts`). Wybór i otwarcie mówią pozycją `k`
// na liście `kandydaci`, nie indeksem adresu.

import { KOLORY_ETYKIETY, type LiteraEtykiety } from '../../karta/okolica/kolory.ts'
import type { KandydatMapy, PropsSasiadowMapy } from '../../wynik/sasiedziStan.ts'

export type SasiedziNaMapie = PropsSasiadowMapy
export type KandydatNaMapie = KandydatMapy

export interface Znacznik {
  /** Pozycja na liście `kandydaci` – tym mówią `wybrany`, `onWybierz` i `onOtworz`. */
  k: number
  /** Indeks adresu kandydata. */
  adres: number
  lon: number
  lat: number
  litera: string
  /** Kolor litery z palety etykiety – tylko jako wypełnienie znacznika. */
  tlo: string
  /** Kolor tekstu z kontrastem ≥ 4,5:1 do `tlo` – nigdy kolor z palety liter. */
  tekst: string
  /** Etykieta dostępności przycisku. */
  opis: string
  /** Tekst dymka po najechaniu i fokusie. */
  dymek: string
  wybrany: boolean
}

/** Litera spoza A–G (np. brak danych) – szary, jak brak danych na mapie. */
const TLO_NIEZNANEJ = '#8A9097'
const TEKST_NIEZNANEJ = '#18202B'

const R_ZIEMI_M = 6_371_008.8

function kolorLitery(litera: string): { tlo: string; tekst: string } {
  return KOLORY_ETYKIETY[litera as LiteraEtykiety] ?? { tlo: TLO_NIEZNANEJ, tekst: TEKST_NIEZNANEJ }
}

const skonczona = (v: number) => typeof v === 'number' && Number.isFinite(v)

/** Pusta lista albo brak środka = nic do narysowania (sekcja zamknięta). */
export function czyWidoczne(p: Pick<SasiedziNaMapie, 'kandydaci' | 'srodek'> | undefined) {
  return !!p && p.srodek !== null && p.kandydaci.length > 0
}

/** Dane znaczników w kolejności propsów; kandydat bez współrzędnych jest pomijany. */
export function znacznikiSasiadow(
  p: Pick<SasiedziNaMapie, 'kandydaci' | 'srodek' | 'wybrany'> | undefined,
): Znacznik[] {
  if (!p || !czyWidoczne(p)) return []
  const widziane = new Set<number>()
  const wynik: Znacznik[] = []
  for (const [poz, kand] of p.kandydaci.entries()) {
    if (!skonczona(kand.lon) || !skonczona(kand.lat) || widziane.has(kand.adres)) continue
    widziane.add(kand.adres)
    const litera =
      String(kand.litera ?? '')
        .trim()
        .toUpperCase() || '?'
    const etykieta = kand.etykieta.trim() || 'adres bez opisu'
    wynik.push({
      k: poz,
      adres: kand.adres,
      lon: kand.lon,
      lat: kand.lat,
      litera,
      ...kolorLitery(litera),
      opis: `Lepszy sąsiad: ${etykieta}, litera ${litera}. Otwórz kartę adresu`,
      dymek: `${etykieta} – litera ${litera}`,
      wybrany: p.wybrany === poz,
    })
  }
  return wynik
}

/** Klucz zbioru znaczników bez wyboru – znaczniki odtwarzamy tylko, gdy się zmieni. */
export function kluczZnacznikow(z: readonly Znacznik[]): string {
  return z.map((x) => `${x.k}|${x.adres}|${x.lon}|${x.lat}|${x.litera}|${x.dymek}`).join('\n')
}

/** Punkt w odległości `m` od (lon, lat) w kierunku `azymut` (stopnie od północy), na sferze. */
export function punktWOdleglosci(
  lon: number,
  lat: number,
  m: number,
  azymut: number,
): [number, number] {
  const rad = Math.PI / 180
  const d = m / R_ZIEMI_M
  const f1 = lat * rad
  const l1 = lon * rad
  const t = azymut * rad
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t))
  const l2 =
    l1 +
    Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2))
  return [l2 / rad, f2 / rad]
}

export interface OkragGeoJson {
  type: 'Feature'
  properties: Record<string, never>
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }
}

/**
 * Okrąg o promieniu `promienM` jako wielokąt GeoJSON: `krokow` wierzchołków co równy azymut,
 * pierścień zamknięty (pierwszy punkt = ostatni), przeciwnie do wskazówek zegara (RFC 7946).
 */
export function okragWokol(lon: number, lat: number, promienM: number, krokow = 96): OkragGeoJson {
  const n = Math.max(8, Math.floor(krokow))
  const pierscien: [number, number][] = []
  // Azymut maleje: północ → zachód → południe → wschód, czyli przeciwnie do wskazówek zegara.
  for (let k = 0; k < n; k++)
    pierscien.push(punktWOdleglosci(lon, lat, promienM, 360 - (k * 360) / n))
  pierscien.push(pierscien[0] as [number, number])
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [pierscien] },
  }
}

/** Prostokąt [[zachód, południe], [wschód, północ]] opisany na okręgu – do ustawienia kamery. */
export function graniceOkregu(
  lon: number,
  lat: number,
  promienM: number,
): [[number, number], [number, number]] {
  const [, polnoc] = punktWOdleglosci(lon, lat, promienM, 0)
  const [, poludnie] = punktWOdleglosci(lon, lat, promienM, 180)
  // Najdalej na wschód i zachód sięgają punkty z azymutem 90° i 270° (przy małym promieniu).
  const [wschod] = punktWOdleglosci(lon, lat, promienM, 90)
  const [zachod] = punktWOdleglosci(lon, lat, promienM, 270)
  return [
    [zachod, poludnie],
    [wschod, polnoc],
  ]
}
