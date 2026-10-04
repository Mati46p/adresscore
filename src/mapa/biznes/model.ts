// Czysta logika znaczników miejsc A i B w trybie „Biznes” (#106): krok klawiatury, polecenia
// klawiszy i opis dla czytnika ekranu. Bez maplibre i DOM, żeby dało się ją testować w Node.
export interface PunktBiznesuNaMapie {
  id: 'a' | 'b'
  lon: number
  lat: number
}

/** Krok strzałki w metrach; z Shift większy, jak w obiektach symulatora (#97). */
export const KROK_M = 10
export const KROK_SHIFT_M = 50
const M_NA_STOPIEN = 111_320

/** Przesunięcie o metry na wschód (dx) i północ (dy). */
export function przesunOMetry(lon: number, lat: number, dx: number, dy: number): [number, number] {
  return [lon + dx / (M_NA_STOPIEN * Math.cos((lat * Math.PI) / 180)), lat + dy / M_NA_STOPIEN]
}

const KIERUNKI: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
}

export type PolecenieKlawisza =
  | { rodzaj: 'przesun'; lon: number; lat: number }
  | { rodzaj: 'usun' }
  | null

/**
 * Co robi klawisz na fokusowanym znaczniku: strzałki przesuwają o `KROK_M` (z Shift o
 * `KROK_SHIFT_M`), Delete i Backspace usuwają miejsce. Inne klawisze (Tab, Enter) zostają
 * przeglądarce, żeby nie psuć nawigacji.
 */
export function polecenieKlawisza(
  klawisz: string,
  shift: boolean,
  punkt: Pick<PunktBiznesuNaMapie, 'lon' | 'lat'>,
): PolecenieKlawisza {
  if (klawisz === 'Delete' || klawisz === 'Backspace') return { rodzaj: 'usun' }
  const kierunek = KIERUNKI[klawisz]
  if (!kierunek) return null
  const krok = shift ? KROK_SHIFT_M : KROK_M
  const [lon, lat] = przesunOMetry(punkt.lon, punkt.lat, kierunek[0] * krok, kierunek[1] * krok)
  return { rodzaj: 'przesun', lon, lat }
}

/** Opis znacznika dla czytnika ekranu: kto, gdzie i jak nim sterować z klawiatury. */
export function opisZnacznika(punkt: PunktBiznesuNaMapie): string {
  const wspolrzedne = `${punkt.lat.toFixed(5)} szerokości, ${punkt.lon.toFixed(5)} długości`
  return (
    `Miejsce ${punkt.id.toUpperCase()}, ${wspolrzedne}. ` +
    `Strzałki przesuwają o ${KROK_M} m, z Shift o ${KROK_SHIFT_M} m, Delete usuwa.`
  )
}
