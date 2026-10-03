// Kontrakt danych #9 (ETL budynków, tor dane) → #20 (bryły 3D na karcie adresu).
// Dlaczego kafle H3 r7, a nie jeden plik: karta pokazuje tylko 500 m wokół adresu, a cały
// Kraków to ok. 90 tys. obrysów (kilkanaście MB). Komórka r7 ma ok. 5 km², więc komórka
// adresu z sąsiadami zawsze pokrywa promień 500 m, a pobieramy ok. 1 MB.
// Uzgodnienie formatu: komentarz w issue #9.
import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js'
import type { Zrodlo } from '@/kontrakty'

export const ROZDZIELCZOSC_KAFLA = 7

/** Plik public/dane/budynki/<h3r7>.json – kolumnowo, jak adresy.json. */
export interface KafelBudynkow {
  wersja: string
  zrodla: Zrodlo[]
  /** Komórka H3 r7 kafla; budynek należy do kafla, w którym leży środek jego obrysu. */
  h3: string
  budynki: {
    /** Id BDOT10k. */
    id: string[]
    /** Metry nad terenem; null = brak wysokości (bryła rysowana nisko i szaro). */
    wysokosc: (number | null)[]
    zrodloWysokosci: ('lod1' | 'kondygnacje' | null)[]
    /** Pierścień zewnętrzny płasko: [lon, lat, lon, lat, …], WGS84. */
    obrys: number[][]
  }
}

export interface Budynek {
  id: string
  wysokosc: number | null
  zrodloWysokosci: 'lod1' | 'kondygnacje' | null
  /** Pierścień zewnętrzny jako pary [lon, lat]. */
  obrys: [number, number][]
}

export function rozwinKafel(k: KafelBudynkow): Budynek[] {
  const b = k.budynki
  return b.id.map((id, i) => {
    const plaski = b.obrys[i] ?? []
    const obrys: [number, number][] = []
    for (let j = 0; j + 1 < plaski.length; j += 2) {
      obrys.push([plaski[j] as number, plaski[j + 1] as number])
    }
    return {
      id,
      wysokosc: b.wysokosc[i] ?? null,
      zrodloWysokosci: b.zrodloWysokosci[i] ?? null,
      obrys,
    }
  })
}

/** Komórki kafli, które pokrywają promień 500 m wokół punktu. */
export function kafleWokol(lon: number, lat: number): string[] {
  return gridDisk(latLngToCell(lat, lon, ROZDZIELCZOSC_KAFLA), 1)
}

/** Środek komórki – przydatny w testach i atrapie. */
export function srodekKafla(h3: string): [number, number] {
  const [lat, lon] = cellToLatLng(h3)
  return [lon, lat]
}

export interface BudynkiOkolicy {
  budynki: Budynek[]
  zrodla: Zrodlo[]
}

/**
 * Brak kafla (404) to brak budynków w tym miejscu albo dane jeszcze nie gotowe, nie błąd.
 * Błąd sieci jednego kafla nie blokuje pozostałych.
 */
export async function wczytajBudynkiWokol(lon: number, lat: number): Promise<BudynkiOkolicy> {
  const baza = `${import.meta.env.BASE_URL}dane/budynki`
  const kafle = await Promise.all(
    kafleWokol(lon, lat).map(async (h3) => {
      try {
        const r = await fetch(`${baza}/${h3}.json`)
        // Vite dev zwraca index.html zamiast 404 – sprawdzamy typ treści.
        if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null
        return (await r.json()) as KafelBudynkow
      } catch {
        return null
      }
    }),
  )
  const budynki: Budynek[] = []
  const zrodla = new Map<string, Zrodlo>()
  for (const k of kafle) {
    if (!k) continue
    budynki.push(...rozwinKafel(k))
    for (const z of k.zrodla) zrodla.set(z.url, z)
  }
  return { budynki, zrodla: [...zrodla.values()] }
}
