// Przełącznik trybów w nagłówku (#92, #108): „Dla miasta” i „Dla biznesu” obok zwykłej pracy
// mieszkańca (Szukaj, Okolica, Porównanie…). Czysta tablica i jedna funkcja – nagłówek tylko
// ją wyświetla, a test pilnuje, że każdy tryb ma własny ekran i adres.
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
