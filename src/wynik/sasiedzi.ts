// „Lepszy sąsiad” (#93): do 3 adresów w promieniu 500 m z lepszą literą przy podobnej cenie.
// Czysta funkcja bez Reacta i sieci – testy na gołym `node --test`. Z kontraktu tylko typy
// (patrz nagłówek silnik.ts). Kartę (#94) i mapę (#95) wypełniają osobne zadania.
//
// Zasady:
// - Kandydaci z pierścieni H3 wokół heksu adresu, potem odległość geodezyjna ≤ promień.
// - Wynik i litera z bieżącymi wagami i kierunkami; dealbreaker wyklucza kandydata, a brak
//   danych dla filtra nie wyklucza (jak w filtry.ts).
// - Cena: mediana RCN w heksie w granicach ±15%. Brak ceny po którejś stronie nie wyklucza –
//   kandydat dostaje podpis „brak cen transakcyjnych”. Brak danych to nie zero.
// - Jeden wpis na budynek, a budynek adresu wyjściowego się pomija.
import { getHexagonEdgeLengthAvg, getResolution, gridDisk, isValidCell } from 'h3-js'
import type { Adres, KategoriaId } from '../kontrakty/index.ts'
import { ocenFiltr, type TwardyFiltr } from './filtry.ts'
import {
  type Kierunki,
  KOLEJNOSC_KATEGORII,
  type Litera,
  PROGI_LITER,
  type Wagi,
  type WskaznikPrzygotowany,
  type WynikAdresu,
  wynikAdresu,
} from './silnik.ts'

export const PROMIEN_SASIADA_M = 500
export const LIMIT_SASIADOW = 3
/** Cena kandydata może się różnić od ceny adresu o tyle (względnie). */
export const TOLERANCJA_CENY = 0.15
export const ID_CENY = 'cena_m2_mediana'
export const PODPIS_BRAKU_CEN = 'brak cen transakcyjnych'
/** Przybliżenie budynku bez obrysów: ta sama ulica, ten sam numer bez litery, nie dalej niż tyle. */
export const PROMIEN_BUDYNKU_M = 30

export type AdresSasiada = Pick<Adres, 'lon' | 'lat' | 'h3' | 'miejscowosc' | 'ulica' | 'nr'>

export interface UstawieniaSasiadow {
  wagi: Wagi
  kierunki?: Kierunki
  filtry?: readonly TwardyFiltr[]
}

export interface OpcjeSasiadow {
  promienM?: number
  limit?: number
  tolerancjaCeny?: number
  /**
   * Klucz budynku dla adresu (np. id obrysu z `miasto3d`). null = adres bez budynku – wtedy
   * działa przybliżenie z ulicy, numeru i odległości.
   */
  budynekAdresu?: (i: number) => string | number | null
}

export type CenaSasiada =
  | {
      stan: 'podobna'
      cenaM2: number
      /** Względna różnica do ceny adresu wyjściowego, np. −0,08. */
      roznica: number
    }
  | { stan: 'brak'; podpis: typeof PODPIS_BRAKU_CEN }

export type StopienRoznicy = 'nieco' | 'wyraźnie' | 'znacznie'

export interface Wyroznik {
  kategoria: KategoriaId
  nazwa: string
  stopien: StopienRoznicy
  /** Opis słowami, bez punktów, np. „wyraźnie ciszej i zdrowiej”. */
  opis: string
}

export interface LepszySasiad {
  i: number
  odlegloscM: number
  wynik: number
  litera: Litera
  pewnosc: number
  /** Kandydat ma niższą pewność niż adres wyjściowy – karta to oznacza. */
  nizszaPewnosc: boolean
  cena: CenaSasiada
  /** Do 2 kategorii z największą przewagą wkładu, od największej. */
  wyroznia: Wyroznik[]
}

export interface LepsiSasiedzi {
  wyjsciowy: {
    i: number
    wynik: number | null
    litera: Litera | null
    pewnosc: number
    cenaM2: number | null
  }
  kandydaci: LepszySasiad[]
}

// Kopia nazw z KATEGORIE w kontrakcie (wartości z kontraktu nie importujemy – patrz nagłówek).
const NAZWY_KATEGORII: Record<KategoriaId, string> = {
  codziennosc: 'Codzienność pieszo',
  transport: 'Transport',
  spokoj: 'Spokój i zdrowie',
  spolecznosc: 'Społeczność i koszty',
  przyszlosc: 'Przyszłość okolicy',
  bezpieczenstwo: 'Bezpieczeństwo i ryzyko',
  kontekst: 'Kontekst',
}

/** Fraza po stopniu: „znacznie” + „ciszej i zdrowiej”. Kontekst nie liczy się do wyniku. */
const FRAZY_KATEGORII: Record<Exclude<KategoriaId, 'kontekst'>, string> = {
  codziennosc: 'bliżej do codziennych spraw pieszo',
  transport: 'lepszy dojazd komunikacją',
  spokoj: 'ciszej i zdrowiej',
  spolecznosc: 'korzystniejsze warunki społeczne i koszty',
  przyszlosc: 'lepsze perspektywy okolicy',
  bezpieczenstwo: 'bezpieczniej',
}

/** Progi przewagi wkładu (punkty wyniku 0–100) dla słów; liczby nie trafiają na kartę. */
const PROG_ZNACZNIE = 15
const PROG_WYRAZNIE = 5

const R_ZIEMI_M = 6_371_008.8

/** Odległość po kole wielkim (haversine) w metrach. */
export function odlegloscGeodezyjnaM(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R_ZIEMI_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Pozycja litery: A = 0 … G = 6. Mniejsza = lepsza. */
function rangaLitery(l: Litera): number {
  const p = PROGI_LITER.findIndex(([litera]) => litera === l)
  return p === -1 ? PROGI_LITER.length : p
}

// Indeks heks → adresy liczony raz na tablicę adresów.
const indeksyHeksow = new WeakMap<readonly AdresSasiada[], Map<string, number[]>>()

function adresyWHeksach(adresy: readonly AdresSasiada[]): Map<string, number[]> {
  const gotowy = indeksyHeksow.get(adresy)
  if (gotowy) return gotowy
  const mapa = new Map<string, number[]>()
  for (let i = 0; i < adresy.length; i++) {
    const h = (adresy[i] as AdresSasiada).h3
    const lista = mapa.get(h)
    if (lista) lista.push(i)
    else mapa.set(h, [i])
  }
  indeksyHeksow.set(adresy, mapa)
  return mapa
}

/**
 * Indeksy adresów z heksów w promieniu (nadmiarowo – odległość sprawdza wywołujący).
 * Dwa sąsiednie środki heksów dzieli √3·krawędź > 1,5·krawędź, więc k = ⌈R / 1,5·krawędź⌉ + 1
 * pierścieni na pewno pokrywa koło o promieniu R. Heks nieprawidłowy = przegląd wszystkich adresów.
 */
function adresyWPierscieniach(adresy: readonly AdresSasiada[], h3: string, promienM: number) {
  if (!isValidCell(h3)) return adresy.map((_, i) => i)
  const krawedz = getHexagonEdgeLengthAvg(getResolution(h3), 'm')
  const k = Math.ceil(promienM / (1.5 * krawedz)) + 1
  const poHeksach = adresyWHeksach(adresy)
  const wynik: number[] = []
  for (const h of gridDisk(h3, k)) {
    const lista = poHeksach.get(h)
    if (lista) for (const i of lista) wynik.push(i)
  }
  return wynik
}

function cenaAdresu(cena: WskaznikPrzygotowany | undefined, i: number): number | null {
  // Atrapa ceny nie może odsiać prawdziwego kandydata – traktujemy ją jak brak cen.
  if (!cena || cena.meta.atrapa || cena.niedostepny) return null
  const v = cena.wartosci[i]
  return v !== null && v !== undefined && Number.isFinite(v) && v > 0 ? v : null
}

function wykluczony(
  i: number,
  filtry: readonly TwardyFiltr[],
  poId: ReadonlyMap<string, WskaznikPrzygotowany>,
): boolean {
  for (const f of filtry) {
    const w = poId.get(f.id)
    if (w && ocenFiltr(w.wartosci[i], f) === 'narusza') return true
  }
  return false
}

/** Numer bez litery i ułamka: „12A” → „12”, „7/9” → „7”. */
function rdzenNumeru(nr: string): string {
  return /^\s*(\d+)/.exec(nr)?.[1] ?? nr.trim().toLowerCase()
}

function tenSamBudynek(
  a: number,
  b: number,
  adresy: readonly AdresSasiada[],
  budynekAdresu: OpcjeSasiadow['budynekAdresu'],
): boolean {
  const ka = budynekAdresu?.(a) ?? null
  const kb = budynekAdresu?.(b) ?? null
  if (ka !== null && kb !== null) return ka === kb
  const x = adresy[a] as AdresSasiada
  const y = adresy[b] as AdresSasiada
  return (
    x.miejscowosc === y.miejscowosc &&
    x.ulica === y.ulica &&
    rdzenNumeru(x.nr) === rdzenNumeru(y.nr) &&
    odlegloscGeodezyjnaM(x.lon, x.lat, y.lon, y.lat) <= PROMIEN_BUDYNKU_M
  )
}

function stopienRoznicy(roznica: number): StopienRoznicy {
  if (roznica >= PROG_ZNACZNIE) return 'znacznie'
  if (roznica >= PROG_WYRAZNIE) return 'wyraźnie'
  return 'nieco'
}

/**
 * Dwie kategorie z największą dodatnią różnicą wkładu. Szara kategoria (brak wkładu) po
 * którejś stronie nie wchodzi do porównania – brak danych to nie zero. Remis: kolejność karty.
 */
export function coWyroznia(kandydat: WynikAdresu, wyjsciowy: WynikAdresu, ile = 2): Wyroznik[] {
  const roznice: { kategoria: Exclude<KategoriaId, 'kontekst'>; roznica: number }[] = []
  for (const kategoria of KOLEJNOSC_KATEGORII) {
    if (kategoria === 'kontekst') continue
    const k = kandydat.kategorie.find((x) => x.kategoria === kategoria)?.wklad ?? null
    const w = wyjsciowy.kategorie.find((x) => x.kategoria === kategoria)?.wklad ?? null
    if (k === null || w === null) continue
    const roznica = k - w
    if (roznica > 1e-9) roznice.push({ kategoria, roznica })
  }
  roznice.sort((a, b) => b.roznica - a.roznica)
  return roznice.slice(0, ile).map(({ kategoria, roznica }) => {
    const stopien = stopienRoznicy(roznica)
    return {
      kategoria,
      nazwa: NAZWY_KATEGORII[kategoria],
      stopien,
      opis: `${stopien} ${FRAZY_KATEGORII[kategoria]}`,
    }
  })
}

/**
 * Do `limit` adresów w promieniu z literą lepszą niż adres `i`.
 * Kolejność: lepsza litera → bliżej → wyższy wynik → niższy indeks (stała przy remisach).
 * Adres wyjściowy bez wyniku (brak danych) = brak kandydatów.
 */
export function lepsiSasiedzi(
  i: number,
  adresy: readonly AdresSasiada[],
  wskazniki: readonly WskaznikPrzygotowany[],
  ustawienia: UstawieniaSasiadow,
  opcje: OpcjeSasiadow = {},
): LepsiSasiedzi {
  const promienM = opcje.promienM ?? PROMIEN_SASIADA_M
  const limit = opcje.limit ?? LIMIT_SASIADOW
  const tolerancja = opcje.tolerancjaCeny ?? TOLERANCJA_CENY
  const { wagi, kierunki, filtry = [] } = ustawienia

  const poId = new Map(wskazniki.map((w) => [w.meta.id, w]))
  const cena = poId.get(ID_CENY)
  const zrodlo = wynikAdresu(i, wskazniki, wagi, kierunki)
  const cenaZrodla = cenaAdresu(cena, i)
  const wyjsciowy = {
    i,
    wynik: zrodlo.wynik,
    litera: zrodlo.litera,
    pewnosc: zrodlo.pewnosc,
    cenaM2: cenaZrodla,
  }
  const a = adresy[i]
  if (!a || zrodlo.litera === null || limit <= 0) return { wyjsciowy, kandydaci: [] }
  const rangaZrodla = rangaLitery(zrodlo.litera)

  const pasujacy: (LepszySasiad & { rozbicie: WynikAdresu })[] = []
  for (const j of adresyWPierscieniach(adresy, a.h3, promienM)) {
    if (j === i) continue
    const b = adresy[j] as AdresSasiada
    const odlegloscM = odlegloscGeodezyjnaM(a.lon, a.lat, b.lon, b.lat)
    if (odlegloscM > promienM) continue
    if (wykluczony(j, filtry, poId)) continue

    const cenaKandydata = cenaAdresu(cena, j)
    let cenaSasiada: CenaSasiada
    if (cenaZrodla === null || cenaKandydata === null) {
      cenaSasiada = { stan: 'brak', podpis: PODPIS_BRAKU_CEN }
    } else {
      const roznica = (cenaKandydata - cenaZrodla) / cenaZrodla
      // Mały zapas na zaokrąglenie: 115 zł przy 100 zł to wciąż „±15%”.
      if (Math.abs(roznica) > tolerancja + 1e-9) continue
      cenaSasiada = { stan: 'podobna', cenaM2: cenaKandydata, roznica }
    }

    const rozbicie = wynikAdresu(j, wskazniki, wagi, kierunki)
    if (rozbicie.litera === null || rozbicie.wynik === null) continue
    if (rangaLitery(rozbicie.litera) >= rangaZrodla) continue

    pasujacy.push({
      i: j,
      odlegloscM,
      wynik: rozbicie.wynik,
      litera: rozbicie.litera,
      pewnosc: rozbicie.pewnosc,
      nizszaPewnosc: rozbicie.pewnosc < zrodlo.pewnosc - 1e-9,
      cena: cenaSasiada,
      wyroznia: [],
      rozbicie,
    })
  }

  pasujacy.sort(
    (x, y) =>
      rangaLitery(x.litera) - rangaLitery(y.litera) ||
      x.odlegloscM - y.odlegloscM ||
      y.wynik - x.wynik ||
      x.i - y.i,
  )

  const kandydaci: LepszySasiad[] = []
  for (const { rozbicie, ...s } of pasujacy) {
    if (kandydaci.length >= limit) break
    if (tenSamBudynek(s.i, i, adresy, opcje.budynekAdresu)) continue
    if (kandydaci.some((k) => tenSamBudynek(s.i, k.i, adresy, opcje.budynekAdresu))) continue
    kandydaci.push({ ...s, wyroznia: coWyroznia(rozbicie, zrodlo) })
  }
  return { wyjsciowy, kandydaci }
}
