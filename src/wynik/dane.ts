// Jedno ładowanie danych na aplikację: obietnica w pamięci modułu, więc każdy komponent
// może wołać useDane() bez dublowania 70 tys. adresów i kilku MB wskaźników.
import { useSyncExternalStore } from 'react'
import {
  type Adres,
  type Manifest,
  type PlikAdresow,
  type PlikOkolic,
  rozwinAdresy,
  wczytajAdresy,
  wczytajManifest,
  wczytajOkolice,
  wczytajWskaznik,
} from '@/kontrakty'
import { type IndeksKompaktu, niezgodnoscKompaktu } from './kompakt.ts'
import {
  type GrupyHeksow,
  grupujHeksy,
  przygotujWskaznikZeSkala,
  type Skala,
  type WskaznikPrzygotowany,
  wskaznikNiedostepny,
} from './silnik.ts'
import { podlaczDane } from './stan.ts'

export interface Dane {
  plikAdresow: PlikAdresow
  adresy: Adres[]
  manifest: Manifest
  /**
   * Wszystkie warstwy manifestu w jego kolejności. Warstwa, która się nie wczytała, ma
   * `niedostepny` i brak danych pod każdym adresem – liczy się do pewności, nie do wyniku.
   */
  wskazniki: WskaznikPrzygotowany[]
  /** Id warstw pominiętych (inna wersja adresów albo błąd pobrania) z powodem. */
  pominiete: { id: string; powod: string }[]
  grupyHeksow: GrupyHeksow
  /**
   * Okolice adresów (jednostki SIM i miejscowości, #185). null = plik się nie wczytał albo jest
   * z innej wersji adresów – okolicą zostaje wtedy dzielnica Krakowa albo gmina (`okolicaAdresu`).
   */
  okolice: PlikOkolic | null
}

export type StanDanych =
  | { stan: 'ladowanie' }
  | { stan: 'blad'; blad: string }
  | ({ stan: 'gotowe' } & Dane)

type SkaleGotowe = Map<string, { skala: Skala; zDanymi: number }>

/**
 * Skale warstw z kompaktu (ETL liczy je tym samym silnikiem). Każdy błąd albo niezgodność = null
 * i przeglądarka liczy skale sama, jak wcześniej. Każda skala jest jeszcze sprawdzana przy warstwie
 * (`skalaPasuje`), bo kompakt mógł nie zostać przebudowany po zmianie wartości.
 */
async function wczytajSkaleKompaktu(
  manifest: Promise<Manifest>,
  wersjaAdresow: Promise<string>,
): Promise<SkaleGotowe | null> {
  try {
    const baza = `${import.meta.env.BASE_URL}dane/kompakt/`
    const odp = await fetch(`${baza}indeks.json`)
    if (!odp.ok) return null
    const indeks = (await odp.json()) as IndeksKompaktu
    if (niezgodnoscKompaktu(indeks, await manifest)) return null
    const plikSkal = await fetch(`${baza}${indeks.skale.plik}`)
    if (!plikSkal.ok) return null
    const skale = (await plikSkal.json()) as Record<string, Skala>
    if (indeks.wersjaAdresow !== (await wersjaAdresow)) return null
    const wynik: SkaleGotowe = new Map()
    for (const [id, wpis] of Object.entries(indeks.wskazniki)) {
      const skala = skale[id]
      if (skala) wynik.set(id, { skala, zDanymi: wpis.pokrycie.zDanymi })
    }
    return wynik
  } catch {
    return null
  }
}

async function wczytajWszystko(): Promise<Dane> {
  const adresyP = wczytajAdresy()
  const manifestP = wczytajManifest()
  const skaleP = wczytajSkaleKompaktu(
    manifestP,
    adresyP.then((p) => p.wersja),
  )
  const [plikAdresow, manifest] = await Promise.all([adresyP, manifestP])
  const skaleGotowe = await skaleP
  const pominiete: Dane['pominiete'] = []
  const n = plikAdresow.kolumny.id.length
  // Okolice ładują się równolegle ze wskaźnikami. Brak pliku nie blokuje mapy: zapas to dzielnica/gmina.
  const okolicePlik = wczytajOkolice(plikAdresow.wersja, n).catch((e: unknown) => {
    console.warn(`Okolice (okolice.json) bez danych: ${String(e)}`)
    return null
  })
  const wskazniki = await Promise.all(
    manifest.wskazniki.map(async ({ wersjaAdresow, ...meta }) => {
      const pomin = (powod: string) => {
        pominiete.push({ id: meta.id, powod })
        return wskaznikNiedostepny(meta, n, powod)
      }
      if (wersjaAdresow !== plikAdresow.wersja) {
        return pomin(`adresy ${wersjaAdresow}, mamy ${plikAdresow.wersja}`)
      }
      try {
        const plik = await wczytajWskaznik(meta.id, plikAdresow.wersja)
        return plik
          ? przygotujWskaznikZeSkala(plik, skaleGotowe?.get(meta.id))
          : pomin('niezgodna wersja adresów')
      } catch (e) {
        // Jedna zepsuta warstwa nie może zablokować całej mapy.
        return pomin(String(e))
      }
    }),
  )
  for (const p of pominiete) console.warn(`Wskaźnik ${p.id} bez danych: ${p.powod}`)
  const adresy = rozwinAdresy(plikAdresow)
  podlaczDane(
    plikAdresow.kolumny.id,
    wskazniki.map((w) => w.meta),
    adresy,
  )
  return {
    plikAdresow,
    adresy,
    manifest,
    wskazniki,
    pominiete,
    grupyHeksow: grupujHeksy(plikAdresow.kolumny.h3),
    okolice: await okolicePlik,
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
