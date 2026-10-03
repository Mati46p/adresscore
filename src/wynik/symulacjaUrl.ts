// Obiekty symulatora w linku (#98): `a=p:19.93720,50.06140;s:19.90000,50.05000`, osobno wariant
// A i B („tu czy tam?”). Link do wysłania radnemu albo do wniosku w budżecie obywatelskim.
// Czyste funkcje bez DOM – test na gołym `node --test`.
import { type Obiekt, TYPY_OBIEKTOW, type TypObiektu } from './symulacja.ts'

/** Więcej obiektów w jednym wariancie to już nie symulacja inwestycji, tylko błąd albo śmieci. */
export const MAKS_OBIEKTOW = 20

// Polska z zapasem – współrzędne spoza to uszkodzony link, nie obiekt.
const LON: [number, number] = [14, 24.2]
const LAT: [number, number] = [49, 55]

const typPoZnaku = new Map<string, TypObiektu>(
  TYPY_OBIEKTOW.map((d) => [d.znak.toLowerCase(), d.typ]),
)
const znakTypu = new Map<TypObiektu, string>(
  TYPY_OBIEKTOW.map((d) => [d.typ, d.znak.toLowerCase()]),
)

export function obiektyDoTekstu(obiekty: readonly Obiekt[]): string {
  return obiekty
    .slice(0, MAKS_OBIEKTOW)
    .map((o) => `${znakTypu.get(o.typ)}:${o.lon.toFixed(5)},${o.lat.toFixed(5)}`)
    .join(';')
}

/** Nieznany typ, zła liczba albo punkt poza Polską odpada; reszta linku działa. */
export function obiektyZTekstu(tekst: string | null | undefined): Obiekt[] {
  if (!tekst || tekst.length > MAKS_OBIEKTOW * 32) return []
  const obiekty: Obiekt[] = []
  for (const czesc of tekst.split(';')) {
    const m = /^([a-z]):(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(czesc.trim())
    if (!m) continue
    const typ = typPoZnaku.get(m[1] as string)
    const lon = Number(m[2])
    const lat = Number(m[3])
    if (!typ || lon < LON[0] || lon > LON[1] || lat < LAT[0] || lat > LAT[1]) continue
    obiekty.push({ typ, lon, lat })
    if (obiekty.length === MAKS_OBIEKTOW) break
  }
  return obiekty
}
