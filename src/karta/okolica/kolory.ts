// Kolory etykiety A–G. Jasność zmienia się wyraźnie (ciemna A, jasna D, ciemna G),
// więc stopnie da się odróżnić bez koloru; litera stoi też na każdym pasku.
// Tekst na pasku ma kontrast ≥ 4,5:1 z tłem pasku.
export const LITERY = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const
export type LiteraEtykiety = (typeof LITERY)[number]

export const KOLORY_ETYKIETY: Record<LiteraEtykiety, { tlo: string; tekst: string }> = {
  A: { tlo: '#0B6B3A', tekst: '#FFFFFF' },
  B: { tlo: '#6DBE45', tekst: '#10210F' },
  C: { tlo: '#B7D335', tekst: '#18202B' },
  D: { tlo: '#F4DC3C', tekst: '#18202B' },
  E: { tlo: '#F6A935', tekst: '#18202B' },
  F: { tlo: '#EC6A2C', tekst: '#18202B' },
  G: { tlo: '#B3261E', tekst: '#FFFFFF' },
}
