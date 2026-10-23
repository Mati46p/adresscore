// Czysta fizyka dolnego arkusza: progi, rzut z prędkością i gumka poza skrajami. Bez DOM, testowalna w node.

/** Próg prędkości (px/ms), od którego puszczenie jest rzutem, a nie zwykłym przyciągnięciem. */
export const PROG_PREDKOSCI = 0.5
/** Jak daleko (ms) wybiegamy w przód przy rzucie. */
export const CZAS_RZUTU = 200
/** Opór gumki poza skrajami: tyle ruchu palca przechodzi na arkusz. */
export const OPOR_GUMKI = 0.35

export interface PrzesuniecieStanu {
  zwiniety: number
  polowa: number
  pelny: number
}

/** Przesunięcie od góry wysokości pełnej (px) dla każdego stanu; pełny = 0. */
export function przesunieciaStanow(
  wysokoscOkna: number,
  wysNaglowka: number,
  wysZwinietego: number,
): PrzesuniecieStanu {
  const wysokosc = Math.max(0, wysokoscOkna - wysNaglowka - 8)
  const polowa = Math.min(wysokosc, Math.max(0, wysokosc - wysokoscOkna / 2))
  const zwiniety = Math.max(polowa, wysokosc - wysZwinietego)
  return { zwiniety, polowa, pelny: 0 }
}

/**
 * Najbliższy próg po puszczeniu. `v` w px/ms (dodatnie = w dół). Szybki ruch rzuca arkusz
 * na `y + v * CZAS_RZUTU` i bierze najbliższy próg w kierunku ruchu; wolny – najbliższy próg.
 */
export function najblizszyProg(y: number, v: number, progi: number[]): number {
  if (progi.length === 0) return y
  const najblizszy = (cel: number, z: number[]) =>
    z.reduce((a, b) => (Math.abs(b - cel) < Math.abs(a - cel) ? b : a), z[0] ?? y)
  if (Math.abs(v) > PROG_PREDKOSCI) {
    const wKierunku = progi.filter((p) => (v > 0 ? p > y : p < y))
    if (wKierunku.length > 0) return najblizszy(y + v * CZAS_RZUTU, wKierunku)
  }
  return najblizszy(y, progi)
}

/** Gumka: poza przedziałem [min, max] ruch jest tłumiony oporem. */
export function zGumka(y: number, min: number, max: number): number {
  if (y < min) return min + (y - min) * OPOR_GUMKI
  if (y > max) return max + (y - max) * OPOR_GUMKI
  return y
}

/** Prędkość (px/ms) z próbek {y, t}: od najstarszej do najnowszej. */
export function predkosc(probki: { y: number; t: number }[]): number {
  if (probki.length < 2) return 0
  const a = probki[0]
  const b = probki[probki.length - 1]
  if (!a || !b) return 0
  const dt = b.t - a.t
  return dt > 0 ? (b.y - a.y) / dt : 0
}
