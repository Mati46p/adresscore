// Widoki trybu „Dla miasta” (#92, #108): luki w usługach (ranking okolic i mapa luk) oraz symulator
// inwestycji. Pasek nad ekranem przełącza je bez zmiany adresu (`#/miasto`). Czysta tablica i jedna
// funkcja – ekran tylko je wyświetla, a test pilnuje reguły wyboru widoku.

export type WidokMiasta = 'luki' | 'symulator'

export interface WpisWidoku {
  id: WidokMiasta
  /** Napis na pasku widoków. */
  etykieta: string
}

/** Kolejność jest kolejnością na pasku. */
export const WIDOKI_MIASTA: readonly WpisWidoku[] = [
  { id: 'luki', etykieta: 'Luki w usługach' },
  { id: 'symulator', etykieta: 'Symulator inwestycji' },
]

/**
 * Widok, od którego zaczyna się tryb Miasto. Link z obiektami symulatora (`a=`, `b=`) otwiera symulator
 * (ktoś wysłał „postaw tu przystanek”), każdy inny – także `#/miasto?w=<warstwa>` (link do konkretnej
 * luki, #92) i gołe `#/miasto` – otwiera luki, bo to pierwsze pytanie urzędnika: gdzie czegoś brakuje.
 * Potem widok zmienia już tylko użytkownik, więc usunięcie ostatniego obiektu nie przerzuca go na luki.
 */
export function widokPoczatkowy(symulacja: { a: string; b: string }): WidokMiasta {
  return symulacja.a || symulacja.b ? 'symulator' : 'luki'
}
