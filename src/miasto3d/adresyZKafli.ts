// Adresy i wyniki dla budynków 3D z kafli kompaktu (#247): bez pełnych danych Szukaj nie ma
// `dane.adresy`, a kolor budynku to średni wynik adresów w jego obrysie. Kafle okolicy dają te same
// adresy (lon/lat, `i`) i wartości warstw, więc wynik liczy ten sam `wynikAdresu` co karta.
import { type KafelGotowy, kafelPunktu } from '../wynik/kafle.ts'
import type { IndeksKompaktu, KafelKompaktu } from '../wynik/kompakt.ts'
import { type Kierunki, type Wagi, wynikAdresu } from '../wynik/silnik.ts'
import { odlegloscM, PROMIEN_M, type PunktAdresu } from './laczenie.ts'

/** Krok siatki próbek: mniejszy od boku kafla r8 (ok. 460 m), więc żaden kafel w promieniu nie ucieka. */
const KROK_PROBKI_M = 250
const M_NA_STOPIEN = 111_320

/** Wpisy kafli pokrywających okolicę (promień budynków + zapas na adresy przy granicy), bez powtórzeń. */
export function kafleWokol(
  indeks: IndeksKompaktu,
  lon: number,
  lat: number,
  promienM = PROMIEN_M + 200,
): KafelKompaktu[] {
  const dLat = KROK_PROBKI_M / M_NA_STOPIEN
  const dLon = KROK_PROBKI_M / (M_NA_STOPIEN * Math.cos((lat * Math.PI) / 180))
  const n = Math.ceil(promienM / KROK_PROBKI_M)
  const wpisy = new Set<KafelKompaktu>()
  for (let x = -n; x <= n; x++)
    for (let y = -n; y <= n; y++) {
      const k = kafelPunktu(indeks, lon + x * dLon, lat + y * dLat)
      if (k) wpisy.add(k)
    }
  return [...wpisy]
}

/**
 * Adresy z kafli i ich wynik wg bieżącego profilu. `wyniki` jest rzadką mapą po `Adres.i` (NaN = brak
 * danych, nigdy 0), więc pasuje do `budynkiOkolicy`, które czyta `wyniki[a.i]`.
 */
export function adresyZKafli(
  kafle: readonly KafelGotowy[],
  wagi: Wagi,
  kierunki: Kierunki,
  lon: number,
  lat: number,
): { adresy: PunktAdresu[]; wyniki: ArrayLike<number> & Record<number, number> } {
  const adresy: PunktAdresu[] = []
  const wyniki = { length: 0 } as ArrayLike<number> & Record<number, number>
  for (const kafel of kafle) {
    kafel.adresy.forEach((a, j) => {
      if (wyniki[a.i] !== undefined) return
      if (odlegloscM(lon, lat, a.lon, a.lat) > PROMIEN_M + 200) return
      adresy.push({ i: a.i, lon: a.lon, lat: a.lat })
      wyniki[a.i] = wynikAdresu(j, kafel.wskazniki, wagi, kierunki).wynik ?? Number.NaN
    })
  }
  // Kolejność jak w adresy.json: `budynkiOkolicy` sumuje wyniki adresów w obrysie po kolei, więc ta sama
  // kolejność daje tę samą średnią co ścieżka pełnych danych co do ostatniego bitu.
  adresy.sort((x, y) => x.i - y.i)
  return { adresy, wyniki }
}
