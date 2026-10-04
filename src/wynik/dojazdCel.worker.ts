// Worker dojazdu do celu użytkownika (#85). Graf rozkładu pobiera dopiero przy pierwszym
// zapytaniu (ok. 0,6 MB gzip) i trzyma w pamięci razem z cache 8 profili (cel, godzina).
// Kontrakt wiadomości:
//   → { typ: 'licz', id, cel: Punkt, odjazd: number, punkty: Punkt[] }
//   ← { typ: 'wynik', id, czasy: (number | null)[], info: InfoDojazdu, zCache, ms }
//   ← { typ: 'blad', id, komunikat }
import {
  CacheProfili,
  czasZPunktu,
  dostepneGodziny,
  type GrafPlik,
  type Punkt,
  type ZrodloGrafu,
  zaokraglijCel,
  zbudujModel,
} from './dojazdCel.ts'

export interface InfoDojazdu {
  dataRozkladu: string
  godziny: number[]
  zrodla: ZrodloGrafu[]
  celLiczony: Punkt
  osiagalnePrzystanki: number
}

export type WiadomoscDoWorkera = {
  typ: 'licz'
  id: number
  cel: Punkt
  odjazd: number
  punkty: Punkt[]
}
export type OdpowiedzWorkera =
  | {
      typ: 'wynik'
      id: number
      czasy: (number | null)[]
      info: InfoDojazdu
      zCache: boolean
      ms: number
    }
  | { typ: 'blad'; id: number; komunikat: string }

let cache: Promise<CacheProfili> | null = null

function wczytaj(): Promise<CacheProfili> {
  cache ??= fetch('/dane/dojazd/graf.json')
    .then((odp) => {
      if (!odp.ok) throw new Error(`graf dojazdu: HTTP ${odp.status}`)
      return odp.json() as Promise<GrafPlik>
    })
    .then((g) => new CacheProfili(zbudujModel(g)))
  cache.catch(() => {
    cache = null
  })
  return cache
}

self.onmessage = async (e: MessageEvent<WiadomoscDoWorkera>) => {
  const w = e.data
  if (w.typ !== 'licz') return
  try {
    const c = await wczytaj()
    const t0 = performance.now()
    const godziny = dostepneGodziny(c.model)
    if (!godziny.includes(w.odjazd)) throw new Error('Godzina wyjścia poza oknem rozkładu')
    const { profil, zCache } = c.profil(w.cel, w.odjazd)
    const czasy = w.punkty.slice(0, 64).map((p) => czasZPunktu(c.model, profil, p))
    const odp: OdpowiedzWorkera = {
      typ: 'wynik',
      id: w.id,
      czasy,
      zCache,
      ms: Math.round(performance.now() - t0),
      info: {
        dataRozkladu: c.model.dataRozkladu,
        godziny,
        zrodla: c.model.zrodla,
        celLiczony: zaokraglijCel(w.cel),
        osiagalnePrzystanki: profil.osiagalne,
      },
    }
    self.postMessage(odp)
  } catch (err) {
    const odp: OdpowiedzWorkera = {
      typ: 'blad',
      id: w.id,
      komunikat: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(odp)
  }
}
