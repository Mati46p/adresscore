// Przełącznik trybów w nagłówku (#92, #108): „Dla miasta” i „Dla biznesu” obok zwykłej pracy
// mieszkańca (Szukaj, Okolica, Porównanie…). Czysta tablica i dwie funkcje – nagłówek tylko
// ją wyświetla, a test pilnuje, że każdy tryb ma własny ekran i adres.
import type { Tryb } from './persony.ts'
import type { Ekran } from './url.ts'

export type TrybAplikacji = 'miasto' | 'biznes'

export interface WpisTrybu {
  id: TrybAplikacji
  /** Ekran, który otwiera tryb. Adres w linku: `#/miasto` albo `#/biznes`. */
  ekran: Ekran
  /** Napis na przełączniku. */
  etykieta: string
}

/** Kolejność jest kolejnością na ekranie. */
export const TRYBY_APLIKACJI: readonly WpisTrybu[] = [
  { id: 'miasto', ekran: 'miasto', etykieta: 'Dla miasta' },
  { id: 'biznes', ekran: 'biznes', etykieta: 'Dla biznesu' },
]

/**
 * Tryb, do którego należy ekran. `null` to zwykła praca mieszkańca (Szukaj, Okolica, Porównanie,
 * Katalog, Metoda): żaden z przełączników nie jest wtedy wybrany, więc akcent w nagłówku ma
 * dokładnie jeden element – krok albo tryb.
 */
export function trybEkranu(ekran: Ekran): TrybAplikacji | null {
  return TRYBY_APLIKACJI.find((t) => t.ekran === ekran)?.id ?? null
}

/**
 * Czy po przejściu na `nastepny.ekran` stan musi wrócić do profilu mieszkańca (E10, #108).
 *
 * Tryb „biznes” w stanie (wagi sklepu i ludności zamiast profilu) należy do ekranu Biznes. Wejście
 * na ten ekran ustawia go, ale wcześniej nic go stamtąd nie zdejmowało: tryb zostawał po powrocie,
 * a symulator Miasta liczył litery na wagach Biznesu (ten sam obiekt awansował adresy przed wizytą
 * w Biznesie i żadnego po niej). Dlatego tryb wraca do mieszkańca:
 *
 * na każdym ekranie poza Biznes, skąd by tryb biznes nie przyszedł (link z `t=biznes`, zapis sesji).
 * Ekrany mieszkańca nie mają już kafla biznesu – biznes żyje tylko pod „Dla biznesu” w nagłówku.
 */
export function czyDoMieszkanca(
  poprzedniEkran: Ekran,
  nastepny: { ekran: Ekran; tryb: Tryb },
): boolean {
  void poprzedniEkran
  return nastepny.tryb === 'biznes' && nastepny.ekran !== 'biznes'
}
