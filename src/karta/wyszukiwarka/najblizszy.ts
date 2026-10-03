// Najbliższy adres do punktu kliknięcia na mapie. Siatka komórek zamiast pełnego przeglądu,
// bo mapa woła to przy każdym kliknięciu (a w przyszłości może przy ruchu kursora).
import type { Adres } from '../../kontrakty/index.ts'

const PROMIEN_M = 300
const M_NA_STOPIEN = 111_320
// Komórka większa od promienia, więc wystarczy sprawdzić 3 × 3 komórki.
const KOMORKA_M = 350

interface Siatka {
  lat0: number
  dLat: number
  dLon: number
  komorki: Map<number, number[]>
}

const siatki = new WeakMap<Adres[], Siatka>()

const klucz = (cx: number, cy: number) => cx * 1_000_003 + cy

function zbuduj(adresy: Adres[]): Siatka {
  const lat0 = adresy.length > 0 ? (adresy[0] as Adres).lat : 50
  const dLat = KOMORKA_M / M_NA_STOPIEN
  const dLon = dLat / Math.cos((lat0 * Math.PI) / 180)
  const komorki = new Map<number, number[]>()
  for (let p = 0; p < adresy.length; p++) {
    const a = adresy[p] as Adres
    const k = klucz(Math.floor(a.lon / dLon), Math.floor(a.lat / dLat))
    const lista = komorki.get(k)
    if (lista) lista.push(p)
    else komorki.set(k, [p])
  }
  return { lat0, dLat, dLon, komorki }
}

/** Zwraca Adres.i najbliższego adresu albo null, gdy najbliższy jest dalej niż ~300 m. */
export function najblizszyAdres(adresy: Adres[], lon: number, lat: number): number | null {
  if (adresy.length === 0) return null
  let s = siatki.get(adresy)
  if (!s) {
    s = zbuduj(adresy)
    siatki.set(adresy, s)
  }
  const cx = Math.floor(lon / s.dLon)
  const cy = Math.floor(lat / s.dLat)
  const mLon = M_NA_STOPIEN * Math.cos((lat * Math.PI) / 180)
  let najlepszy: number | null = null
  let najmniejsza = PROMIEN_M * PROMIEN_M
  for (let x = cx - 1; x <= cx + 1; x++) {
    for (let y = cy - 1; y <= cy + 1; y++) {
      const lista = s.komorki.get(klucz(x, y))
      if (!lista) continue
      for (const p of lista) {
        const a = adresy[p] as Adres
        const dx = (a.lon - lon) * mLon
        const dy = (a.lat - lat) * M_NA_STOPIEN
        const d2 = dx * dx + dy * dy
        if (d2 <= najmniejsza) {
          najmniejsza = d2
          najlepszy = a.i
        }
      }
    }
  }
  return najlepszy
}
