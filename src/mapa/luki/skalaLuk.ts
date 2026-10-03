// Mapa luk (#90): czyste funkcje bez DOM i bez Reacta – testy na gołym `node --test`.
// Importy względne z rozszerzeniem `.ts`, z `luki.ts` i `skala.ts` (oba bez zależności
// czasu wykonania od przeglądarki).
//
// Zasady:
// - Kolor z palety wyniku, odwrócony: 0% adresów w luce = zieleń, 100% = pomarańcz.
//   Na mapie „więcej = gorzej obsłużone”, a pomarańcz w całej aplikacji znaczy „gorzej”.
// - Heks bez żadnego adresu z danymi (`udzial: null`) to brak danych (szary), nigdy 0%.
// - Rodzic r8/r9 sumuje adresy dzieci: udział = suma w luce / suma wszystkich, nie średnia udziałów.
import { type LiczbyLuki, okolicaAdresu } from '../../wynik/luki.ts'
import { STOPNIE_SKALI } from '../skala.ts'

/**
 * Wartość 0–100 dla `MapaKrakowa` (skala wyniku): 100 = nikt w luce, 0 = wszyscy w luce.
 * null = brak danych (szary).
 */
export function wartoscMapyLuki(udzial: number | null | undefined): number | null {
  if (udzial === null || udzial === undefined || Number.isNaN(udzial)) return null
  return 100 - Math.min(1, Math.max(0, udzial)) * 100
}

/** Suma liczb kilku heksów r10 (rodzic r8/r9). Heks spoza mapy pomijamy. */
export function sumaLiczb(
  heksy: readonly string[],
  liczby: ReadonlyMap<string, LiczbyLuki>,
): LiczbyLuki {
  let wLuce = 0
  let bezLuki = 0
  let brakDanych = 0
  for (const h of heksy) {
    const l = liczby.get(h)
    if (!l) continue
    wLuce += l.wLuce
    bezLuki += l.bezLuki
    brakDanych += l.brakDanych
  }
  const wszystkie = wLuce + bezLuki + brakDanych
  return {
    wszystkie,
    wLuce,
    bezLuki,
    brakDanych,
    udzial: wLuce + bezLuki > 0 ? wLuce / wszystkie : null,
  }
}

/** Liczba w pełnym zapisie polskim (12 345), bez skrótów „tys.”. */
export function liczbaPelna(n: number): string {
  return n.toLocaleString('pl-PL', { maximumFractionDigits: 0 })
}

/** „adres” / „adresy” / „adresów” – forma rzeczownika po liczbie n. */
export function formaAdresow(n: number): string {
  if (n === 1) return 'adres'
  const d = n % 10
  const s = n % 100
  return d >= 2 && d <= 4 && (s < 12 || s > 14) ? 'adresy' : 'adresów'
}

/** Procent bez fałszywego zera: 0,3% to „<1%”, nie „0%”. */
export function procentLuki(udzial: number): string {
  const p = udzial * 100
  if (p > 0 && p < 0.5) return '<1%'
  if (p < 100 && p > 99.5) return '>99%'
  return `${Math.round(p)}%`
}

/**
 * Dymek heksu: adresy w luce / wszystkie adresy, pełne liczby.
 * `zbiorczy` = rodzic r8/r9 przy oddaleniu (suma heksów r10).
 */
export function opisHeksuLuki(l: LiczbyLuki | undefined, zbiorczy = false): string {
  const dopisek = zbiorczy ? ' (większy heks, łącznie)' : ''
  if (!l || l.wszystkie === 0) return `brak adresów${dopisek}`
  if (l.udzial === null) {
    return `brak danych – ${liczbaPelna(l.wszystkie)} ${formaAdresow(l.wszystkie)}${dopisek}`
  }
  const brak = l.brakDanych > 0 ? `, bez danych: ${liczbaPelna(l.brakDanych)}` : ''
  return `w luce: ${liczbaPelna(l.wLuce)} / ${liczbaPelna(l.wszystkie)} ${formaAdresow(l.wszystkie)} (${procentLuki(l.udzial)})${brak}${dopisek}`
}

/** Gradient paska legendy: od 0% (lewo, zieleń) do 100% adresów w luce (prawo, pomarańcz). */
export function gradientLukCss(): string {
  const stopnie = [...STOPNIE_SKALI]
    .reverse()
    .map(([p, k]) => `${k} ${100 - p}%`)
    .join(', ')
  return `linear-gradient(to right, ${stopnie})`
}

export type Granice = [[number, number], [number, number]]

/** Najmniejszy bok ramki w stopniach (~300 m): okolica z jednym adresem nie przybliża do maksimum. */
const MIN_BOK = 0.003

/**
 * Ramka adresów okolicy o id z `okolicaAdresu(...).id` (`dzielnica:<nazwa>` | `gmina:<nazwa>`).
 * null, gdy okolica nie ma adresu ze współrzędnymi.
 */
export function graniceOkolicy(
  adresy: readonly { dzielnica: string | null; gmina: string; lon: number; lat: number }[],
  id: string,
): Granice | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const a of adresy) {
    if (okolicaAdresu(a).id !== id) continue
    // Współrzędne 0 to w kontrakcie brak położenia, nie punkt w Zatoce Gwinejskiej.
    if (!Number.isFinite(a.lon) || !Number.isFinite(a.lat) || (a.lon === 0 && a.lat === 0)) continue
    if (a.lon < minX) minX = a.lon
    if (a.lon > maxX) maxX = a.lon
    if (a.lat < minY) minY = a.lat
    if (a.lat > maxY) maxY = a.lat
  }
  if (minX > maxX) return null
  const dx = Math.max(0, MIN_BOK - (maxX - minX)) / 2
  const dy = Math.max(0, MIN_BOK - (maxY - minY)) / 2
  return [
    [minX - dx, minY - dy],
    [maxX + dx, maxY + dy],
  ]
}
