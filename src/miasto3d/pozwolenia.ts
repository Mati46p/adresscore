// Pozwolenia na budowę 2025–2026 (#27) na „Okolicy w 3D” (#31). Dane to punkty – środki
// działek – bez obrysu i wysokości, więc pokazujemy MIEJSCE, a nie bryłę: zmyślona bryła
// byłaby liczbą, której nie ma w rejestrze. Czyste funkcje, testy na gołym `node --test`.
import { odlegloscM, PROMIEN_M, type Rgba } from './laczenie.ts'

export interface Pozwolenie {
  lon: number
  lat: number
  /** Data decyzji, ISO. */
  data: string
  rodzaj: string
  /** budowa / rozbudowa / nadbudowa. */
  zakres: string
  opis: string | null
}

/** Cecha z public/dane/pozwolenia.geojson (skrócone klucze z ETL #27). */
interface CechaPozwolenia {
  geometry: { type: string; coordinates: number[] } | null
  properties: { d?: string; r?: string; z?: string; o?: string | null }
}

export function zGeojson(g: { features: CechaPozwolenia[] }): Pozwolenie[] {
  const wynik: Pozwolenie[] = []
  for (const f of g.features) {
    const [lon, lat] = f.geometry?.type === 'Point' ? f.geometry.coordinates : []
    if (lon === undefined || lat === undefined) continue
    wynik.push({
      lon,
      lat,
      data: f.properties.d ?? '',
      rodzaj: f.properties.r ?? 'inny',
      zakres: f.properties.z ?? '',
      opis: f.properties.o ?? null,
    })
  }
  return wynik
}

export function pozwoleniaWokol(
  wszystkie: readonly Pozwolenie[],
  lon: number,
  lat: number,
  promienM = PROMIEN_M,
): Pozwolenie[] {
  return wszystkie.filter((p) => odlegloscM(lon, lat, p.lon, p.lat) <= promienM)
}

export type GrupaPozwolenia = 'mieszkaniowe' | 'uslugowe' | 'inne'

export const GRUPY: Record<GrupaPozwolenia, { nazwa: string; kolor: Rgba }> = {
  // Barwy spoza skali A–G (zieleń–żółć–czerwień), żeby znacznik nie czytał się jako ocena.
  mieszkaniowe: { nazwa: 'mieszkaniowe', kolor: [47, 107, 216, 235] },
  uslugowe: { nazwa: 'usługowe i publiczne', kolor: [138, 63, 209, 235] },
  inne: { nazwa: 'inne', kolor: [75, 85, 99, 235] },
}

export function grupa(rodzaj: string): GrupaPozwolenia {
  if (/jednorodzinny|wielorodzinny|mieszkaln/u.test(rodzaj)) return 'mieszkaniowe'
  if (/usługow|publiczn/u.test(rodzaj)) return 'uslugowe'
  return 'inne'
}

export function liczbyGrup(p: readonly Pozwolenie[]): Record<GrupaPozwolenia, number> {
  const liczby = { mieszkaniowe: 0, uslugowe: 0, inne: 0 }
  for (const x of p) liczby[grupa(x.rodzaj)]++
  return liczby
}

/** „4 lutego 2025”. */
export function opisDaty(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso || 'data nieznana'
  const miesiace = [
    'stycznia',
    'lutego',
    'marca',
    'kwietnia',
    'maja',
    'czerwca',
    'lipca',
    'sierpnia',
    'września',
    'października',
    'listopada',
    'grudnia',
  ]
  return `${Number(m[3])} ${miesiace[Number(m[2]) - 1]} ${m[1]}`
}
