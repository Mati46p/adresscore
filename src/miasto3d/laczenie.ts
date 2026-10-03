// Łączenie budynków z adresami i wynikiem: czyste funkcje bez DOM, testy na gołym `node --test`.
// Dlaczego przypisanie robi front, a nie ETL: wynik zależy od wag użytkownika, więc kolor
// budynku i tak liczy się w przeglądarce, a ETL budynków nie musi znać pliku adresów.
import { KOLORY_ETYKIETY, type LiteraEtykiety } from '../karta/okolica/kolory.ts'
import { literaZWyniku } from '../wynik/silnik.ts'
import type { Budynek } from './kontrakt.ts'

export type Rgba = [number, number, number, number]

/** Promień okolicy na karcie adresu (burza E5, 13a). */
export const PROMIEN_M = 500

const M_NA_STOPIEN = 111_320

/** Odległość w metrach; przybliżenie równoodległościowe wystarcza w skali 1 km. */
export function odlegloscM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const kx = M_NA_STOPIEN * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180))
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * M_NA_STOPIEN)
}

export function srodekObrysu(obrys: readonly [number, number][]): [number, number] {
  let lon = 0
  let lat = 0
  for (const [x, y] of obrys) {
    lon += x
    lat += y
  }
  const n = Math.max(obrys.length, 1)
  return [lon / n, lat / n]
}

/** Test promienia (ray casting). Punkt na krawędzi może wypaść w dowolną stronę – bez znaczenia. */
export function punktWObrysie(lon: number, lat: number, obrys: readonly [number, number][]) {
  let wewnatrz = false
  for (let i = 0, j = obrys.length - 1; i < obrys.length; j = i++) {
    const [xi, yi] = obrys[i] as [number, number]
    const [xj, yj] = obrys[j] as [number, number]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      wewnatrz = !wewnatrz
    }
  }
  return wewnatrz
}

export interface PunktAdresu {
  i: number
  lon: number
  lat: number
}

export interface BudynekOkolicy extends Budynek {
  /** Indeksy adresów (PlikAdresow) leżących w obrysie. */
  adresy: number[]
  /** Średni wynik adresów z danymi; null = budynek bez adresu albo bez danych. */
  wynik: number | null
  litera: LiteraEtykiety | null
}

/**
 * Budynki w promieniu od punktu (po środku obrysu) z przypisanymi adresami i wynikiem.
 * `wyniki` to wynik 0–100 per adres (NaN = brak danych), jak z silnika.
 */
export function budynkiOkolicy(
  budynki: readonly Budynek[],
  adresy: readonly PunktAdresu[],
  wyniki: ArrayLike<number>,
  lon: number,
  lat: number,
  promienM = PROMIEN_M,
): BudynekOkolicy[] {
  // Adresy z zapasem 200 m: budynek przy granicy promienia może mieć adres tuż za nią.
  const bliskie = adresy.filter((a) => odlegloscM(lon, lat, a.lon, a.lat) <= promienM + 200)
  const wynikiBudynkow: BudynekOkolicy[] = []
  for (const b of budynki) {
    if (b.obrys.length < 3) continue
    const [sx, sy] = srodekObrysu(b.obrys)
    if (odlegloscM(lon, lat, sx, sy) > promienM) continue
    const ramka = ramkaObrysu(b.obrys)
    const wObrysie: number[] = []
    let suma = 0
    let zDanymi = 0
    for (const a of bliskie) {
      if (a.lon < ramka[0] || a.lon > ramka[2] || a.lat < ramka[1] || a.lat > ramka[3]) continue
      if (!punktWObrysie(a.lon, a.lat, b.obrys)) continue
      wObrysie.push(a.i)
      const w = wyniki[a.i]
      if (w !== undefined && !Number.isNaN(w)) {
        suma += w
        zDanymi++
      }
    }
    const wynik = zDanymi > 0 ? suma / zDanymi : null
    wynikiBudynkow.push({
      ...b,
      adresy: wObrysie,
      wynik,
      litera: literaZWyniku(wynik) as LiteraEtykiety | null,
    })
  }
  return wynikiBudynkow
}

function ramkaObrysu(obrys: readonly [number, number][]): [number, number, number, number] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of obrys) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}

/**
 * Budynek wybranego adresu: ten, w którego obrysie leży adres; gdy żaden (punkt adresowy
 * stoi przy wejściu, poza obrysem) – ten, którego ściana jest najbliżej, do 20 m.
 * Odległość od ściany, nie od środka: przy dużym bloku środek bywa 50 m od wejścia.
 */
export function budynekAdresu(
  budynki: readonly BudynekOkolicy[],
  adres: PunktAdresu,
): BudynekOkolicy | null {
  const zawierajacy = budynki.find((b) => b.adresy.includes(adres.i))
  if (zawierajacy) return zawierajacy
  let najblizszy: BudynekOkolicy | null = null
  let min = 20
  for (const b of budynki) {
    const d = odlegloscOdObrysuM(adres.lon, adres.lat, b.obrys)
    if (d < min) {
      min = d
      najblizszy = b
    }
  }
  return najblizszy
}

/** Najmniejsza odległość punktu od krawędzi obrysu, w metrach (rzut lokalny). */
export function odlegloscOdObrysuM(
  lon: number,
  lat: number,
  obrys: readonly [number, number][],
): number {
  const kx = M_NA_STOPIEN * Math.cos(lat * (Math.PI / 180))
  let min = Infinity
  for (let i = 0, j = obrys.length - 1; i < obrys.length; j = i++) {
    const [xi, yi] = obrys[i] as [number, number]
    const [xj, yj] = obrys[j] as [number, number]
    // Współrzędne w metrach względem punktu.
    const ax = (xj - lon) * kx
    const ay = (yj - lat) * M_NA_STOPIEN
    const bx = (xi - lon) * kx
    const by = (yi - lat) * M_NA_STOPIEN
    const dx = bx - ax
    const dy = by - ay
    const dl2 = dx * dx + dy * dy
    const t = dl2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / dl2))
    const d = Math.hypot(ax + t * dx, ay + t * dy)
    if (d < min) min = d
  }
  return min
}

/** Brak adresu albo danych: szarość, nigdy kolor złej oceny. Ten sam ton co brak na mapie. */
export const SZARY_BUDYNKU: Rgba = [169, 175, 180, 255]

export function naRgba(hex: string, alfa = 255): Rgba {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alfa]
}

/** Kolor bryły: litera A–G albo szarość; reszta okolicy przygaszona, gdy coś jest wybrane. */
export function kolorBudynku(
  litera: LiteraEtykiety | null,
  stan: 'wybrany' | 'zwykly' | 'przygaszony',
): Rgba {
  const baza = litera ? naRgba(KOLORY_ETYKIETY[litera].tlo) : SZARY_BUDYNKU
  // Wybrany zostaje w pełnym kolorze, reszta blednie. Przygaszenie przez rozjaśnienie, nie
  // przezroczystość: półprzezroczyste bryły nakładają się i tworzą plamy, w których ginie wybrany.
  return stan === 'przygaszony' ? rozjasnij(baza, 0.5) : baza
}

function rozjasnij([r, g, b, a]: Rgba, t: number): Rgba {
  return [r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t, a].map(Math.round) as Rgba
}

/** Wysokość bryły: brak danych = niska płyta 3 m, żeby budynek był widoczny, ale nie udawał bloku. */
export function wysokoscBryly(b: Budynek): number {
  return b.wysokosc !== null && b.wysokosc > 0 ? b.wysokosc : 3
}

/** „1 budynek”, „2 budynki”, „5 budynków”, „22 budynki”, „12 budynków”. */
export function odmiana(n: number, [jeden, kilka, wiele]: readonly [string, string, string]) {
  if (n === 1) return `${n} ${jeden}`
  const d = n % 10
  const s = n % 100
  return `${n} ${d >= 2 && d <= 4 && (s < 12 || s > 14) ? kilka : wiele}`
}
