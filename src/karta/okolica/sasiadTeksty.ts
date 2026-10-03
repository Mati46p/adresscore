// Teksty sekcji „Lepszy sąsiad” (#94). Czyste funkcje – testy na gołym `node --test`.
import type { CenaSasiada, LepszySasiad } from '../../wynik/sasiedzi.ts'

export const PUSTY_STAN = 'W promieniu 500 m nie ma adresu z wyższą literą przy Twoich wagach'

/** „120 m” – w pełnych dziesiątkach, bo i tak to linia prosta, nie trasa. */
export function odlegloscTekst(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '–'
  if (m < 10) return 'mniej niż 10 m'
  if (m >= 1000) return `${(Math.round(m / 100) / 10).toLocaleString('pl-PL')} km`
  return `${Math.round(m / 10) * 10} m`
}

/** Cena za m²: „podobna (−3%)”, „taka sama” albo szary podpis braku cen. Minus to znak U+2212. */
export function opisCeny(cena: CenaSasiada): { tekst: string; brak: boolean } {
  if (cena.stan === 'brak') return { tekst: cena.podpis, brak: true }
  const proc = Math.round(cena.roznica * 100)
  if (proc === 0) return { tekst: 'cena za m² taka sama', brak: false }
  const roznica = proc > 0 ? `+${proc}%` : `−${Math.abs(proc)}%`
  return { tekst: `cena za m² podobna (${roznica})`, brak: false }
}

/** „znacznie ciszej i zdrowiej, nieco bezpieczniej” – albo zdanie zapasowe. */
export function coWyrozniaTekst(s: Pick<LepszySasiad, 'wyroznia'>): string {
  if (s.wyroznia.length === 0) return 'wyższy wynik łączny przy Twoich wagach'
  return s.wyroznia.map((w) => w.opis).join(', ')
}
