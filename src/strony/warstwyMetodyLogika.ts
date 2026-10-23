// Czysta część listy warstw strony Metoda (bez Reacta i `import.meta.env`).
import type { WskaznikMeta } from '../kontrakty/index.ts'
import type { IndeksKompaktu } from '../wynik/kompakt.ts'
import type { WskaznikPrzygotowany } from '../wynik/silnik.ts'

export interface Pokrycie {
  zDanymi: number
  wszystkich: number
}

export interface WarstwaMetody {
  meta: WskaznikMeta
  /** Plik warstwy się nie wczytał albo jest liczony dla innej wersji adresów. */
  niedostepny: boolean
  pokrycie: Pokrycie
}

/**
 * Warstwy z manifestu i indeksu kompaktu. Warstwa pominięta w kompakcie (`pominiete`, inna wersja adresów)
 * jest niedostępna, tak jak w pełnych danych; jej pokrycia nie znamy, więc zostaje 0 z 0 (brak, nie zero).
 */
export function warstwyZKompaktu(
  meta: readonly WskaznikMeta[],
  indeks: IndeksKompaktu,
): WarstwaMetody[] {
  return meta.map((m) => {
    const wpis = indeks.wskazniki[m.id]
    return {
      meta: m,
      niedostepny: !wpis,
      pokrycie: wpis ? wpis.pokrycie : { zDanymi: 0, wszystkich: 0 },
    }
  })
}

/** Warstwy z pełnych danych: pokrycie liczone po wartościach (null i NaN to brak). */
export function warstwyZPelnych(
  wskazniki: readonly Pick<WskaznikPrzygotowany, 'meta' | 'wartosci' | 'niedostepny'>[],
): WarstwaMetody[] {
  return wskazniki.map((w) => {
    let zDanymi = 0
    for (const v of w.wartosci) if (v !== null && !Number.isNaN(v)) zDanymi++
    return {
      meta: w.meta,
      niedostepny: Boolean(w.niedostepny),
      pokrycie: { zDanymi, wszystkich: w.wartosci.length },
    }
  })
}
