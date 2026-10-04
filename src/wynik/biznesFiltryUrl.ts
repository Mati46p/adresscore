// Filtry konkurencji trybu „Biznes” w linku (#108): jeden krótki parametr `k`, np. `k=2z,-fast_food`.
// Czyste funkcje bez DOM – test na gołym `node --test`.
//
// Tokeny rozdziela przecinek:
// - `2z`        – „tylko punkty potwierdzone w co najmniej 2 źródłach” (każda branża);
// - `barber`    – filtr flagowy „tylko” (konkurencja MUSI mieć flagę);
// - `-fast_food` – filtr flagowy „bez” (konkurencja NIE MOŻE mieć flagi).
// `2z` zaczyna się od cyfry, a nazwa flagi od litery, więc token źródeł nie zderzy się z żadną flagą.
//
// Link niesie wyłącznie to, co ekran dla danej branży pokazuje jako przełącznik (`filtryFlagBranzy`):
// token spoza definicji (zła nazwa, zły tryb, flaga innej branży) odpada, więc link nie włączy filtra,
// którego użytkownik nie zobaczy ani nie wyłączy. Brak parametru = wszystkie filtry wyłączone, czyli
// stare linki (sprzed #108) otwierają się tak jak dawniej.
import { filtryFlagBranzy } from './biznesBranze.ts'
import { BEZ_FILTROW, type FiltryUslug, type TrybFlagi } from './biznesUslugi.ts'

/** Token filtra „co najmniej 2 źródła”. */
export const TOKEN_MIN_2_ZRODLA = '2z'

/** Przed nazwą flagi: filtr „bez”. Bez znaku: filtr „tylko”. */
const PREFIKS_BEZ = '-'

/** Najdłuższy poprawny parametr to dziś kilkanaście znaków; więcej to śmieci, nie filtry. */
const MAKS_DLUGOSC = 120

/**
 * Parametr `k` dla filtrów branży `idBranzy` (stare id też działa) albo pusty tekst, gdy nic nie jest
 * włączone. Kolejność jest stała (źródła, potem flagi w kolejności definicji), więc ten sam stan
 * zawsze daje ten sam link.
 */
export function filtryDoTekstuLinku(filtry: FiltryUslug, idBranzy: string): string {
  const czesci: string[] = filtry.min2Zrodla ? [TOKEN_MIN_2_ZRODLA] : []
  for (const def of filtryFlagBranzy(idBranzy)) {
    if (filtry.flagi[def.flaga] === def.tryb)
      czesci.push((def.tryb === 'bez' ? PREFIKS_BEZ : '') + def.flaga)
  }
  return czesci.join(',')
}

/**
 * Filtry z parametru `k`. Brak parametru, śmieci i nieznane tokeny dają filtry wyłączone (albo
 * te z tokenów, które się zgadzają) – nigdy wyjątek. Zwraca tę samą stałą `BEZ_FILTROW`, gdy nic nie
 * jest włączone, żeby stan nie dostawał nowej tożsamości przy każdym odczycie linku.
 */
export function filtryZTekstuLinku(
  tekst: string | null | undefined,
  idBranzy: string,
): FiltryUslug {
  if (!tekst || tekst.length > MAKS_DLUGOSC) return BEZ_FILTROW
  const dozwolone = filtryFlagBranzy(idBranzy)
  let min2Zrodla = false
  const flagi: Record<string, TrybFlagi> = {}
  for (const token of tekst.split(',')) {
    if (token === TOKEN_MIN_2_ZRODLA) {
      min2Zrodla = true
      continue
    }
    const bez = token.startsWith(PREFIKS_BEZ)
    const nazwa = bez ? token.slice(PREFIKS_BEZ.length) : token
    const tryb: TrybFlagi = bez ? 'bez' : 'tylko'
    if (dozwolone.some((def) => def.flaga === nazwa && def.tryb === tryb)) flagi[nazwa] = tryb
  }
  return !min2Zrodla && Object.keys(flagi).length === 0 ? BEZ_FILTROW : { min2Zrodla, flagi }
}
