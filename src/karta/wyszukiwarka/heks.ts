import { latLngToCell } from 'h3-js'
import type { Adres } from '../../kontrakty/index.ts'

const adresyPoHeksie = new WeakMap<readonly Adres[], Map<string, Adres[]>>()

function indeks(adresy: readonly Adres[]): Map<string, Adres[]> {
  let mapa = adresyPoHeksie.get(adresy)
  if (mapa) return mapa
  mapa = new Map()
  for (const adres of adresy) {
    const lista = mapa.get(adres.h3)
    if (lista) lista.push(adres)
    else mapa.set(adres.h3, [adres])
  }
  adresyPoHeksie.set(adresy, mapa)
  return mapa
}

/** Reprezentant najbliższy kliknięciu, ale wyłącznie w klikniętej komórce H3 r10. */
export function adresWKliknietymHeksie(
  adresy: readonly Adres[],
  lon: number,
  lat: number,
): { h3: string; adres: Adres | null } {
  const h3 = latLngToCell(lat, lon, 10)
  const lokalne = indeks(adresy).get(h3)
  if (!lokalne?.length) return { h3, adres: null }
  const metryLon = 111_320 * Math.cos((lat * Math.PI) / 180)
  let najlepszy = lokalne[0] as Adres
  let najmniejsza = Infinity
  for (const adres of lokalne) {
    const dx = (adres.lon - lon) * metryLon
    const dy = (adres.lat - lat) * 111_320
    const odleglosc2 = dx * dx + dy * dy
    if (odleglosc2 < najmniejsza) {
      najlepszy = adres
      najmniejsza = odleglosc2
    }
  }
  return { h3, adres: najlepszy }
}
