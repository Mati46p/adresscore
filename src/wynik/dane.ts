// Jedno ładowanie danych na aplikację: obietnica w pamięci modułu, więc każdy komponent
// może wołać useDane() bez dublowania 70 tys. adresów i kilku MB wskaźników.
import { useSyncExternalStore } from 'react'
import {
  type Adres,
  type Manifest,
  type PlikAdresow,
  rozwinAdresy,
  wczytajAdresy,
  wczytajManifest,
  wczytajWskaznik,
} from '@/kontrakty'
import {
  type GrupyHeksow,
  grupujHeksy,
  przygotujWskaznik,
  type WskaznikPrzygotowany,
} from './silnik.ts'
import { podlaczDane } from './stan.ts'

export interface Dane {
  plikAdresow: PlikAdresow
  adresy: Adres[]
  manifest: Manifest
  /** Tylko warstwy zgodne z wersją adresów, w kolejności manifestu. */
  wskazniki: WskaznikPrzygotowany[]
  /** Id warstw pominiętych (inna wersja adresów albo błąd pobrania) z powodem. */
  pominiete: { id: string; powod: string }[]
  grupyHeksow: GrupyHeksow
}

export type StanDanych =
  | { stan: 'ladowanie' }
  | { stan: 'blad'; blad: string }
  | ({ stan: 'gotowe' } & Dane)

async function wczytajWszystko(): Promise<Dane> {
  const [plikAdresow, manifest] = await Promise.all([wczytajAdresy(), wczytajManifest()])
  const pominiete: Dane['pominiete'] = []
  const wyniki = await Promise.all(
    manifest.wskazniki.map(async (m) => {
      if (m.wersjaAdresow !== plikAdresow.wersja) {
        pominiete.push({ id: m.id, powod: `adresy ${m.wersjaAdresow}, mamy ${plikAdresow.wersja}` })
        return null
      }
      try {
        const plik = await wczytajWskaznik(m.id, plikAdresow.wersja)
        if (!plik) pominiete.push({ id: m.id, powod: 'niezgodna wersja adresów' })
        return plik ? przygotujWskaznik(plik) : null
      } catch (e) {
        // Jedna zepsuta warstwa nie może zablokować całej mapy.
        pominiete.push({ id: m.id, powod: String(e) })
        return null
      }
    }),
  )
  for (const p of pominiete) console.warn(`Pomijam wskaźnik ${p.id}: ${p.powod}`)
  const wskazniki = wyniki.filter((w) => w !== null)
  const adresy = rozwinAdresy(plikAdresow)
  podlaczDane(
    plikAdresow.kolumny.id,
    wskazniki.map((w) => w.meta),
  )
  return {
    plikAdresow,
    adresy,
    manifest,
    wskazniki,
    pominiete,
    grupyHeksow: grupujHeksy(plikAdresow.kolumny.h3),
  }
}

let obietnica: Promise<StanDanych> | null = null
let biezacy: StanDanych = { stan: 'ladowanie' }
const sluchacze = new Set<() => void>()

function ustaw(s: StanDanych): StanDanych {
  biezacy = s
  for (const f of sluchacze) f()
  return s
}

/** Startuje ładowanie (raz na aplikację) i zwraca obietnicę stanu końcowego. */
export function zaladujDane(): Promise<StanDanych> {
  obietnica ??= wczytajWszystko().then(
    (d) => ustaw({ stan: 'gotowe', ...d }),
    (e) => ustaw({ stan: 'blad', blad: e instanceof Error ? e.message : String(e) }),
  )
  return obietnica
}

function subskrybuj(f: () => void) {
  sluchacze.add(f)
  void zaladujDane()
  return () => sluchacze.delete(f)
}

/** Stan danych: `ladowanie` → `gotowe` albo `blad`. Każde wywołanie dzieli jedno ładowanie. */
export function useDane(): StanDanych {
  return useSyncExternalStore(
    subskrybuj,
    () => biezacy,
    () => biezacy,
  )
}

/** Dane albo null, bez Reacta. */
export function daneJesliGotowe(): Dane | null {
  return biezacy.stan === 'gotowe' ? biezacy : null
}
