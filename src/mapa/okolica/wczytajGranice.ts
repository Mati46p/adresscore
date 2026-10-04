// Wczytanie granic jednostek SIM (#185): `public/dane/okolice-granice.geojson`, ok. 1,1 MB. Osobny plik od
// `granice.ts`, bo czyta `import.meta.env` (Vite) i nie da się go załadować pod gołym `node --test`.
//
// Plik ładuje się dopiero, gdy ktoś wybierze okolicę z wyszukiwarki (albo ustawi w niej fokus), a nie
// z resztą danych: większość odwiedzających Szukaj nigdy z niego nie skorzysta.
import type { PlikGranic } from './granice.ts'

const ADRES = `${import.meta.env.BASE_URL}dane/okolice-granice.geojson`

let obietnica: Promise<PlikGranic | null> | null = null

async function pobierz(): Promise<PlikGranic> {
  const r = await fetch(ADRES)
  if (!r.ok) throw new Error(`Brak pliku granic okolic (${r.status})`)
  const plik = (await r.json()) as Partial<PlikGranic>
  if (plik.type !== 'FeatureCollection' || !Array.isArray(plik.features)) {
    throw new Error('Plik granic okolic nie jest FeatureCollection')
  }
  return plik as PlikGranic
}

/**
 * Granice jednostek SIM albo null, gdy plik się nie wczytał (mapa pokazuje wtedy ramkę adresów okolicy
 * bez obrysu). Jedno pobranie na aplikację; po błędzie następny wybór próbuje jeszcze raz.
 */
export function wczytajGraniceOkolic(): Promise<PlikGranic | null> {
  obietnica ??= pobierz().catch((e: unknown) => {
    console.warn(`Granice okolic (okolice-granice.geojson) bez danych: ${String(e)}`)
    obietnica = null
    return null
  })
  return obietnica
}
