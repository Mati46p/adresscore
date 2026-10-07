// Arytmetyka przeglądu wszystkich miast (#223, faza F3): kolory heksów r8/r9 miast innych niż bieżące
// (tło mapy), r10 bieżącego miasta przed pełnymi danymi, granice miast i miasto pod punktem mapy.
// Czyste funkcje bez Reacta, sieci i `import.meta.env`, więc testy idą na gołym `node --test`
// (przegladLiczenie.test.ts). Kontrakt: specs/002-wszystkie-miasta/contracts/przeglad.md.
//
// Kolor liczy ten sam silnik co dla bieżącego miasta (`wynikiHeksow`), te same wagi i kierunki (FR-003),
// ale na meta I warstwach tego miasta: warstwa, której miasto nie ma, nie wchodzi do jego wyniku.
// Brak danych to `null` (szrafura), nigdy 0 (FR-004).
import { cellToBoundary, latLngToCell } from 'h3-js'
import { MIASTA, type SlugMiasta, type TloMapy } from '../kontrakty/miasta.ts'
import {
  type Liczona,
  POZIOMY,
  type PodstawaHeksow,
  type Res,
  type WarstwaHeksow,
  wynikiHeksow,
} from './heksy.ts'
import { listaHeksow, type Rozpakowany, sekcja, slownikowa } from './kompakt.ts'

/** Prostokąt [[zachód, południe], [wschód, północ]] w stopniach (ten sam kształt co `Ramka` mapy). */
export type Prostokat = [[number, number], [number, number]]

/** Wyniki miasta na poziomach, które tworzą tło mapy: heks H3 → wynik 0–100 albo `null` (brak danych). */
export type WynikiPoziomow = Record<8 | 9, ReadonlyMap<string, number | null>>

// ── Dekodowanie plików kompaktu ──────────────────────────────────────────────────────────

function slownik(r: Rozpakowany, nazwa: string): string[] {
  const { slownik, indeksy } = slownikowa(r, nazwa)
  return Array.from(indeksy, (i) => slownik[i] ?? '')
}

/**
 * Plik `heksy.<skrót>.bin` jako podstawa heksów: listy r10/r9/r8 i liczby adresów. Przegląd czyta z niej
 * tylko listy i skale (`ulica`, `dzielnica`, `od` służą rankingowi na pełnych danych), ale zostają
 * wypełnione, żeby typ nie obiecywał więcej, niż niesie.
 */
export function podstawaZPliku(r: Rozpakowany): PodstawaHeksow {
  const poziomy = {} as PodstawaHeksow['poziomy']
  for (const res of POZIOMY) {
    poziomy[res] = { heksy: listaHeksow(r, `r${res}`), liczba: sekcja(r, `liczba${res}`) }
  }
  return {
    skalaOceny: r.naglowek.skalaOceny ?? 1,
    skalaUdzialu: r.naglowek.skalaUdzialu ?? 200,
    poziomy,
    od: sekcja(r, 'od') as Uint32Array,
    ulica: slownik(r, 'ulica'),
    dzielnica: slownik(r, 'dzielnica'),
  }
}

/** Plik `warstwy/<id>.<skrót>.bin`: wiersze macierzy jednej warstwy na poziomach r10, r9 i r8. */
export function warstwaZPliku(r: Rozpakowany): WarstwaHeksow {
  const ocena = {} as WarstwaHeksow['ocena']
  const udzial = {} as WarstwaHeksow['udzial']
  for (const res of POZIOMY) {
    ocena[res] = sekcja(r, `ocena${res}`) as Uint8Array
    udzial[res] = sekcja(r, `udzial${res}`) as Uint8Array
  }
  return { ocena, udzial }
}

/**
 * Czy wiersze warstwy mają tyle komórek, ile heksów ma podstawa. Pliki mają nazwy z hasha i wskazuje je
 * jeden indeks, więc rozjazd zdarzyłby się tylko przy połowicznym wdrożeniu danych; wtedy `wynikiHeksow`
 * czytałby cudze komórki bez błędu, dlatego pilnujemy tego tu, a nie w silniku.
 */
export function warstwaPasuje(podstawa: PodstawaHeksow, warstwa: WarstwaHeksow): boolean {
  return POZIOMY.every((res) => {
    const n = podstawa.poziomy[res].heksy.length
    return warstwa.ocena[res].length === n && warstwa.udzial[res].length === n
  })
}

// ── Kolory ───────────────────────────────────────────────────────────────────────────────

/**
 * Wynik każdego heksu poziomu `res` jednego miasta: ten sam `wynikiHeksow` co dla bieżącego miasta.
 * `NaN` (brak danych albo za mało wagi z danymi) to `null`, a `liczone = []` – wybrana warstwa,
 * której miasto nie ma, albo profil bez żadnej warstwy tego miasta – daje same `null`: miasto jest
 * wtedy w szrafurze, nie w kolorze zera (SC-005). Mapa ma klucz dla KAŻDEGO heksu poziomu, także
 * dla tych bez danych, bo szrafurę trzeba narysować.
 */
export function wynikiPrzegladu(
  podstawa: PodstawaHeksow,
  liczone: readonly Liczona[],
  warstwa: (id: string) => WarstwaHeksow | null,
  res: Res,
): Map<string, number | null> {
  const { wartosc } = wynikiHeksow(podstawa, res, liczone, warstwa)
  const heksy = podstawa.poziomy[res].heksy
  const wynik = new Map<string, number | null>()
  for (let i = 0; i < heksy.length; i++) {
    const v = wartosc[i] as number
    wynik.set(heksy[i] as string, Number.isFinite(v) ? v : null)
  }
  return wynik
}

/**
 * Tło mapy z wyników miast: heksy r8 i r9 wszystkich miast POZA bieżącym (bieżące rysuje mapa z r10)
 * i `miastoHeksu` do dymku. `miastoHeksu` jest O(1) – woła je mousemove, dla r8 i r9.
 *
 * Miasta idą w kolejności rejestru, a nie wstawiania do `per`: heks wspólny dla dwóch miast (jeśli
 * kiedyś ich obszary się zetkną) zawsze trafia do tego samego, wcześniejszego w rejestrze.
 */
export function zlaczTlo(
  per: ReadonlyMap<SlugMiasta, WynikiPoziomow>,
  biezace: SlugMiasta,
): TloMapy {
  const heksy = {
    8: new Map<string, number | null>(),
    9: new Map<string, number | null>(),
  }
  // Jedna mapa na oba poziomy: indeks H3 niesie rozdzielczość, więc r8 i r9 się nie zderzą.
  const nazwy = new Map<string, string>()
  for (const m of MIASTA) {
    if (m.slug === biezace) continue
    const wyniki = per.get(m.slug)
    if (!wyniki) continue
    for (const res of [8, 9] as const) {
      for (const [h, w] of wyniki[res]) {
        if (nazwy.has(h)) continue
        heksy[res].set(h, w)
        nazwy.set(h, m.nazwa)
      }
    }
  }
  return { heksy, miastoHeksu: (h3) => nazwy.get(h3) ?? null }
}

// ── Granice i miasto pod punktem ─────────────────────────────────────────────────────────

/** Najmniejszy prostokąt obejmujący wszystkie wierzchołki heksów; bez heksów `null`. */
export function graniceZHeksow(heksy: Iterable<string>): Prostokat | null {
  let zachod = Number.POSITIVE_INFINITY
  let poludnie = Number.POSITIVE_INFINITY
  let wschod = Number.NEGATIVE_INFINITY
  let polnoc = Number.NEGATIVE_INFINITY
  for (const h of heksy) {
    for (const [lon, lat] of cellToBoundary(h, true)) {
      zachod = Math.min(zachod, lon)
      wschod = Math.max(wschod, lon)
      poludnie = Math.min(poludnie, lat)
      polnoc = Math.max(polnoc, lat)
    }
  }
  return Number.isFinite(zachod)
    ? [
        [zachod, poludnie],
        [wschod, polnoc],
      ]
    : null
}

/** Prostokąt obejmujący wszystkie podane (puste i `null` pomijamy); bez żadnego `null`. */
export function polaczProstokaty(prostokaty: Iterable<Prostokat | null>): Prostokat | null {
  let wynik: Prostokat | null = null
  for (const p of prostokaty) {
    if (!p) continue
    wynik = wynik
      ? [
          [Math.min(wynik[0][0], p[0][0]), Math.min(wynik[0][1], p[0][1])],
          [Math.max(wynik[1][0], p[1][0]), Math.max(wynik[1][1], p[1][1])],
        ]
      : p
  }
  return wynik
}

/**
 * Miasto pod punktem mapy: heks r8 punktu → miasto, do którego ten heks należy (z r8 kompaktu). To
 * przybliżenie obrysu miasta heksami ~460 m, ale to samo, które mapa rysuje i które ma pod kursorem:
 * klik w kolorowy heks innego miasta zawsze je rozpoznaje. Punkt poza wszystkimi miastami to `null`.
 * Rejestr rozstrzyga heks wspólny dla dwóch miast, jak w `zlaczTlo`.
 */
export function zbudujMiastoPunktu(
  r8PoMiescie: ReadonlyMap<SlugMiasta, Iterable<string>>,
): (lon: number, lat: number) => SlugMiasta | null {
  const wlasciciel = new Map<string, SlugMiasta>()
  for (const m of MIASTA) {
    for (const h of r8PoMiescie.get(m.slug) ?? []) if (!wlasciciel.has(h)) wlasciciel.set(h, m.slug)
  }
  return (lon, lat) =>
    // `latLngToCell` rzuca dla NaN i nieskończoności, a punkt bez współrzędnych nie leży w żadnym mieście.
    Number.isFinite(lon) && Number.isFinite(lat)
      ? (wlasciciel.get(latLngToCell(lat, lon, 8)) ?? null)
      : null
}
