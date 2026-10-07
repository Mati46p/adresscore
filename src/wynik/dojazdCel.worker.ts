// Worker dojazdu do celu użytkownika (#85). Graf rozkładu pobiera dopiero przy pierwszym
// zapytaniu (Kraków 3,9 MB JSON, ok. 0,6 MB gzip; Warszawa 10 MB JSON) i trzyma w pamięci razem z
// cache 8 profili (cel, godzina).
//
// Graf jest PER MIASTO (#223): worker ma własną kopię modułów stanu (zawsze Kraków), więc nie zna
// bieżącego miasta – ścieżkę grafu (`<baza>/dojazd/graf.json`) przysyła wątek główny w każdej
// wiadomości. Modele trzymamy po pełnej ścieżce (najwyżej dwa: bieżące miasto i poprzednie), więc
// zmiana miasta nie poda profilu ani przystanków Krakowa pod adresem z innego miasta.
// Kontrakt wiadomości:
//   → { typ: 'licz', id, graf: string, cel: Punkt, odjazd: number, punkty: Punkt[] }
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
import { MAKS_MIAST_W_PAMIECI } from './pamiecDanych.ts'
import { utworzPamiecPlikow } from './pamiecPlikow.ts'
import { czySciezkaGrafu } from './sciezkiDanych.ts'

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
  /** Ścieżka grafu bieżącego miasta (`sciezkaGrafu(bazaBiezaca())`), np. `/dane/miasta/lublin/dojazd/graf.json`. */
  graf: string
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

// Błąd pobrania nie zostaje w pamięci (kolejne zapytanie ponawia), a model miasta, które wypadło,
// wraca dopiero z nowym pobraniem.
const modele = utworzPamiecPlikow<CacheProfili>(MAKS_MIAST_W_PAMIECI)

function wczytaj(graf: string): Promise<CacheProfili> {
  return modele.pobierz(graf, () =>
    fetch(graf)
      .then((odp) => {
        if (!odp.ok) throw new Error(`graf dojazdu: HTTP ${odp.status}`)
        return odp.json() as Promise<GrafPlik>
      })
      .then((g) => new CacheProfili(zbudujModel(g))),
  )
}

self.onmessage = async (e: MessageEvent<WiadomoscDoWorkera>) => {
  const w = e.data
  if (w.typ !== 'licz') return
  try {
    // Do `fetch` trafia wyłącznie graf dojazdu w katalogu danych, nie dowolny adres z wiadomości.
    if (!czySciezkaGrafu(w.graf)) throw new Error('Nieprawidłowa ścieżka grafu dojazdu')
    const c = await wczytaj(w.graf)
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
