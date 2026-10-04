// Adapter katalogu usług (`public/dane/uslugi`, #104 i #160) dla trybu „Biznes” (E10, #105–#107).
//
// Plik branży jest kolumnowy (`lon`, `lat`, `zr`, `flagi`, `nazwa`), a silnik (`biznes.ts`) liczy
// na krotkach `PunktUslugi`. Tu leży cała konwersja, filtry konkurencji i typy plików, żeby worker
// i testy czytały dane tą samą drogą. Czyste funkcje: bez fetch i DOM, więc działają w workerze
// i w Node. Format pliku opisuje `etl/uslugi.md` (sekcja „Co powstaje”).
import type { PunktUslugi } from './biznes.ts'

/** Wersja formatu plików branż i katalogu, którą ten adapter rozumie (`wersja` w pliku). */
export const WERSJA_FORMATU = 1

/** Kolumny pliku branży; `flagi` tylko tam, gdzie branża ma flagi (`bityFlag`). */
export interface KolumnyUslug {
  lon: readonly number[]
  lat: readonly number[]
  /** Maska bitowa źródeł punktu (`bityZrodel`): osm = 1, overture = 2, rejestr = 4, ceidg = 8. */
  zr: readonly number[]
  /** Maska flag branży (`bityFlag`): barber, nfz albo fast_food. */
  flagi?: readonly number[]
  /** Nazwa lokalu albo `null` (brak nazwy albo mogłaby być daną osoby fizycznej). */
  nazwa: readonly (string | null)[]
}

/** `public/dane/uslugi/<branza>.json`. */
export interface PlikUslug {
  wersja: number
  branza: string
  nazwa: string
  zasiegPieszyM: number
  n: number
  bityZrodel: Readonly<Record<string, number>>
  bityFlag?: Readonly<Record<string, number>>
  licencja: string
  atrybucja: string
  kolumny: KolumnyUslug
}

/** Źródło z `katalog.json` (`zrodla.<klucz>`): licencja, atrybucja i data danych. */
export interface ZrodloKatalogu {
  nazwa: string
  url: string
  licencja: string
  licencjaUrl?: string
  atrybucja: string
  uwagi?: string
  dataDanych: string
  pobrano?: string
}

/** Wpis branży z `katalog.json` (podzbiór pól, z których korzysta front). */
export interface BranzaKatalogu {
  id: string
  nazwa: string
  zasiegPieszyM: number
  plik: string
  n: number
  /** Nazwy bitów źródeł obecnych w pliku (`osm`, `overture`, `rejestr`, `ceidg`). */
  zrodlaWPliku: readonly string[]
  mapowanie: {
    /** Klucz źródła w `zrodla`, który znaczy bit `rejestr` tej branży (`rpwdl`, `rejestr_aptek`). */
    rejestr: string | null
    /** Flagi branży; `zrodlo` ma flaga z osobnego źródła (nfz), pozostałe powstają z OSM i Overture. */
    flagi: Readonly<Record<string, { zrodlo?: string }>>
  }
  liczby: {
    potwierdzoneWielomaZrodlami: number
    zFlaga: Readonly<Record<string, number>>
  }
  /** Zbiorcza atrybucja źródeł pliku, np. „© OpenStreetMap contributors, ODbL; Overture Maps Foundation…”. */
  atrybucja: string
  /** Pełny opis licencji pliku (ODbL i share-alike dla punktów z OSM). */
  licencja: string
}

/** `public/dane/uslugi/katalog.json`. */
export interface KatalogUslug {
  wersja: number
  wygenerowano: string
  /** Prostokąt, w którym leżą punkty wszystkich branż (Kraków i obwarzanek z marginesem). */
  obszar: { bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number } }
  zrodla: Readonly<Record<string, ZrodloKatalogu>>
  branze: readonly BranzaKatalogu[]
}

/**
 * Minimalna kontrola katalogu po pobraniu. Zły format ma zatrzymać ekran z komunikatem, a nie
 * dać pustą listę branż bez słowa wyjaśnienia.
 */
export function czytajKatalog(dane: unknown): KatalogUslug {
  const k = dane as Partial<KatalogUslug> | null
  if (!k || typeof k !== 'object') throw new Error('Katalog usług ma nieprawidłowy format')
  if (k.wersja !== WERSJA_FORMATU)
    throw new Error(
      `Katalog usług ma wersję ${String(k.wersja)}, a front rozumie ${WERSJA_FORMATU}`,
    )
  if (
    !Array.isArray(k.branze) ||
    k.branze.length === 0 ||
    !k.zrodla ||
    typeof k.zrodla !== 'object'
  )
    throw new Error('Katalog usług nie zawiera branż albo źródeł')
  return k as KatalogUslug
}

// ── Filtry konkurencji ───────────────────────────────────────────────────────────────────

/** `tylko` – punkt musi mieć flagę, `bez` – punkt nie może jej mieć. */
export type TrybFlagi = 'tylko' | 'bez'

export interface FiltryUslug {
  /** Tylko punkty potwierdzone w co najmniej dwóch źródłach (OSM, Overture, rejestr). */
  min2Zrodla: boolean
  /** Flaga branży → tryb. Flaga, której plik nie zna, nic nie wyklucza. */
  flagi: Readonly<Record<string, TrybFlagi>>
}

export const BEZ_FILTROW: FiltryUslug = { min2Zrodla: false, flagi: {} }

/** Ile bitów źródeł ma punkt: tyle źródeł go potwierdza (tak liczy też katalog w ETL). */
export function liczbaZrodel(zr: number): number {
  let n = 0
  for (let m = zr; m > 0; m >>>= 1) n += m & 1
  return n
}

export interface WczytanaBranza {
  id: string
  nazwa: string
  /** Zasięg pieszy z katalogu (m): promień modelu Huffa. */
  zasiegM: number
  /**
   * Punkty pliku z potwierdzonym lokalem, czyli bez tych wyłącznie z CEIDG. To podstawa, od której
   * liczy się filtr („812 z 2619”).
   */
  wPliku: number
  /** Punkty po filtrach: konkurencja w silniku, rozkład porównawczy i znaczniki na mapie. */
  punkty: PunktUslugi[]
}

/** To, co worker odsyła ekranowi o wczytanej branży (bez samych punktów, które idą osobno). */
export interface MetaBranzy {
  id: string
  nazwa: string
  zasiegM: number
  /** Punkty przed filtrami (podstawa „z N”). */
  wPliku: number
  /** Punkty po filtrach (to ich dotyczy mapa i ocena). */
  poFiltrach: number
  /**
   * Filtry, dla których policzono indeks. Karta opisuje konkurencję z TYCH ustawień, a nie z
   * przełączników na ekranie, które po kliknięciu zmieniają się wcześniej niż wynik.
   */
  filtry: FiltryUslug
}

export const metaBranzy = (b: WczytanaBranza, filtry: FiltryUslug = BEZ_FILTROW): MetaBranzy => ({
  id: b.id,
  nazwa: b.nazwa,
  zasiegM: b.zasiegM,
  wPliku: b.wPliku,
  poFiltrach: b.punkty.length,
  filtry,
})

/**
 * Plik branży → punkty dla silnika, po filtrach.
 *
 * - Punkt z samym bitem `ceidg` to adres działalności, nie potwierdzony lokal (`etl/uslugi.md`):
 *   nie liczy się jako konkurent, niezależnie od filtrów. Pliki w repo są bez CEIDG, więc dziś to
 *   zabezpieczenie na przyszłość; bit czytamy z pliku, nie z kopii stałej.
 * - Filtr „≥ 2 źródeł” liczy bity `zr` jak katalog (`liczby.potwierdzoneWielomaZrodlami`). Bit
 *   flagi z osobnego źródła (nfz) nie jest źródłem punktu, więc nie wchodzi do tej liczby.
 * - Wiele flag naraz to koniunkcja: wszystkie `tylko` muszą być ustawione, żadna `bez` nie może.
 */
export function punktyBranzy(plik: PlikUslug, filtry: FiltryUslug = BEZ_FILTROW): WczytanaBranza {
  if (plik.wersja !== WERSJA_FORMATU)
    throw new Error(
      `Plik branży ${plik.branza} ma wersję ${plik.wersja}, front rozumie ${WERSJA_FORMATU}`,
    )
  if (!(plik.zasiegPieszyM > 0))
    throw new Error(`Plik branży ${plik.branza} nie ma zasięgu pieszego`)
  const { lon, lat, zr, flagi, nazwa } = plik.kolumny
  const n = lon.length
  if (lat.length !== n || zr.length !== n || nazwa.length !== n || (flagi && flagi.length !== n))
    throw new Error(`Plik branży ${plik.branza}: kolumny mają różne długości`)

  const bitCeidg = plik.bityZrodel.ceidg ?? 0
  let wymagane = 0
  let zakazane = 0
  if (flagi)
    for (const [flaga, tryb] of Object.entries(filtry.flagi)) {
      const bit = plik.bityFlag?.[flaga]
      if (!bit) continue
      if (tryb === 'tylko') wymagane |= bit
      else zakazane |= bit
    }

  const punkty: PunktUslugi[] = []
  let wPliku = 0
  for (let i = 0; i < n; i++) {
    const zrodla = zr[i] as number
    if (bitCeidg !== 0 && zrodla === bitCeidg) continue
    wPliku++
    if (filtry.min2Zrodla && liczbaZrodel(zrodla) < 2) continue
    const f = flagi ? (flagi[i] as number) : 0
    if ((f & wymagane) !== wymagane || (f & zakazane) !== 0) continue
    punkty.push([lon[i] as number, lat[i] as number, nazwa[i] ?? ''])
  }
  return { id: plik.branza, nazwa: plik.nazwa, zasiegM: plik.zasiegPieszyM, wPliku, punkty }
}
