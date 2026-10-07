// Oceny wybranej warstwy mapy per adres (#223, F6). Wyjęte z `useWyniki.ts`, żeby inwariant „warstwy,
// której miasto nie ma, nie zastępuje wynik łączny” miał test na gołym `node --test` (`useWyniki`
// importuje dane i stan, a te alias `@/`).
//
// Warstwa mapy to stan ogólnokrajowy: użytkownik wybiera ją w jednym mieście, a przegląd koloruje nią
// wszystkie (`przegladSklad.ts`). Po przejściu do miasta, które jej nie ma, mapa ma je pokazać w
// szrafurze (FR-004, SC-005), a nie podstawić wynik łączny pod nazwą warstwy.
import {
  type Kierunki,
  ocenyWarstwy,
  type Wagi,
  type WskaznikPrzygotowany,
  wynikiWszystkich,
} from './silnik.ts'

export interface OcenyMapy {
  /** Wartość 0–100 per adres; `NaN` = brak danych. */
  naAdres: Float32Array
  /**
   * Wybrana warstwa nie istnieje w danych bieżącego miasta. Wszystkie adresy mają wtedy brak danych,
   * a ekran ma to powiedzieć wprost (warstwa z plikiem, który się nie wczytał, to INNY przypadek:
   * jest w meta, więc `brakWarstwy` zostaje `false`).
   */
  brakWarstwy: boolean
}

/**
 * Oceny adresów dla `warstwa`: `'wynik'` = wynik łączny z wag; id wskaźnika = jego oceny. Warstwa bez
 * kierunku (kontekst, neutralna) i warstwa nieobecna w mieście dają brak danych pod każdym adresem.
 */
export function ocenyMapy(
  wskazniki: readonly WskaznikPrzygotowany[],
  wagi: Wagi,
  kierunki: Kierunki,
  warstwa: string,
  liczbaAdresow: number,
): OcenyMapy {
  if (warstwa === 'wynik') {
    return {
      naAdres: wynikiWszystkich(wskazniki, wagi, kierunki, liczbaAdresow),
      brakWarstwy: false,
    }
  }
  const wskaznik = wskazniki.find((w) => w.meta.id === warstwa)
  const braki = () => new Float32Array(liczbaAdresow).fill(Number.NaN)
  if (!wskaznik) return { naAdres: braki(), brakWarstwy: true }
  return { naAdres: ocenyWarstwy(wskaznik, kierunki) ?? braki(), brakWarstwy: false }
}
