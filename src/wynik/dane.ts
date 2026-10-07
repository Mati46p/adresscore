// Dane bieżącego miasta: jedno ładowanie na miasto, więc każdy komponent może wołać useDane() bez
// dublowania 70 tys. adresów i kilku MB wskaźników. Pełne dane (adresy, wszystkie warstwy, okolice)
// ma tylko bieżące miasto (FR-005, #223): `useDane()` zwraca zawsze jego stan, a pozostałe miasta
// widać wyłącznie jako przegląd na mapie (`przeglad.ts`). Pamięć i jej reguły (najwyżej 2 miasta,
// podpięcie słownika w stanie, ponowienie po błędzie) są w `pamiecDanych.ts` – testowalne bez Vite.
import { useSyncExternalStore } from 'react'
import {
  bazaDanych,
  type Manifest,
  MIASTO_DOMYSLNE,
  type PlikOkolic,
  rozwinAdresy,
  type SlugMiasta,
  wczytajAdresy,
  wczytajManifest,
  wczytajOkolice,
  wczytajWskaznik,
} from '@/kontrakty'
import { type IndeksKompaktu, niezgodnoscKompaktu } from './kompakt.ts'
import { type Dane, type StanDanych, utworzPamiecDanych } from './pamiecDanych.ts'
import { grupujHeksy, przygotujWskaznikZeSkala, type Skala, wskaznikNiedostepny } from './silnik.ts'
import { pobierzStan, podlaczDane, subskrybuj as subskrybujStan } from './stan.ts'

export type { Dane, StanDanych } from './pamiecDanych.ts'

type SkaleGotowe = Map<string, { skala: Skala; zDanymi: number }>

/**
 * Skale warstw z kompaktu (ETL liczy je tym samym silnikiem). Każdy błąd albo niezgodność = null
 * i przeglądarka liczy skale sama, jak wcześniej. Każda skala jest jeszcze sprawdzana przy warstwie
 * (`skalaPasuje`), bo kompakt mógł nie zostać przebudowany po zmianie wartości.
 */
async function wczytajSkaleKompaktu(
  manifest: Promise<Manifest>,
  wersjaAdresow: Promise<string>,
  /** Katalog danych miasta (`bazaDanych`): kompakt leży w nim w `kompakt/`. */
  baza: string,
): Promise<SkaleGotowe | null> {
  try {
    const kompakt = `${baza}/kompakt/`
    const odp = await fetch(`${kompakt}indeks.json`)
    if (!odp.ok) return null
    const indeks = (await odp.json()) as IndeksKompaktu
    if (niezgodnoscKompaktu(indeks, await manifest)) return null
    const plikSkal = await fetch(`${kompakt}${indeks.skale.plik}`)
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

async function wczytajWszystko(slug: SlugMiasta): Promise<Dane> {
  const baza = bazaDanych(slug)
  const adresyP = wczytajAdresy(baza)
  const manifestP = wczytajManifest(baza)
  const skaleP = wczytajSkaleKompaktu(
    manifestP,
    adresyP.then((p) => p.wersja),
    baza,
  )
  const [plikAdresow, manifest] = await Promise.all([adresyP, manifestP])
  const skaleGotowe = await skaleP
  const pominiete: Dane['pominiete'] = []
  const n = plikAdresow.kolumny.id.length
  // Okolice ładują się równolegle ze wskaźnikami. Brak pliku nie blokuje mapy: zapas to dzielnica/gmina.
  // Plik `okolice.json` (jednostki SIM i miejscowości obwarzanka) istnieje tylko dla Krakowa (D8):
  // miasta go nie pobierają, więc nie ma zbędnego żądania 404 przy każdej zmianie miasta. Gdyby ETL
  // dołożył okolice dla miast, ten warunek jest jedynym miejscem do zmiany.
  const okolicePlik: Promise<PlikOkolic | null> =
    slug === MIASTO_DOMYSLNE
      ? wczytajOkolice(plikAdresow.wersja, n, baza).catch((e: unknown) => {
          console.warn(`Okolice (okolice.json) bez danych: ${String(e)}`)
          return null
        })
      : Promise.resolve(null)
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
        const plik = await wczytajWskaznik(meta.id, plikAdresow.wersja, baza)
        return plik
          ? przygotujWskaznikZeSkala(plik, skaleGotowe?.get(meta.id))
          : pomin('niezgodna wersja adresów')
      } catch (e) {
        // Jedna zepsuta warstwa nie może zablokować całej mapy.
        return pomin(String(e))
      }
    }),
  )
  // Id warstw powtarzają się między miastami, więc ostrzeżenie mówi, o które miasto chodzi.
  for (const p of pominiete) console.warn(`Wskaźnik ${p.id} (${slug}) bez danych: ${p.powod}`)
  return {
    miasto: slug,
    plikAdresow,
    adresy: rozwinAdresy(plikAdresow),
    manifest,
    wskazniki,
    pominiete,
    grupyHeksow: grupujHeksy(plikAdresow.kolumny.h3),
    okolice: await okolicePlik,
  }
}

const pamiec = utworzPamiecDanych(wczytajWszystko, {
  pobierzStan,
  podlaczDane,
  subskrybuj: subskrybujStan,
})

/**
 * Startuje ładowanie danych miasta (raz na miasto, dopóki mieści się w pamięci) i zwraca obietnicę
 * stanu końcowego. Bez argumentu: bieżące miasto.
 */
export const zaladujDane = pamiec.zaladujDane

/**
 * Stan danych BIEŻĄCEGO miasta: `ladowanie` → `gotowe` albo `blad`. Każde wywołanie dzieli jedno
 * ładowanie na miasto; zmiana miasta w stanie odświeża komponent (`ladowanie` do wczytania nowych danych).
 */
export function useDane(): StanDanych {
  return useSyncExternalStore(pamiec.subskrybuj, pamiec.stanBiezacego, pamiec.stanBiezacego)
}

/** Dane bieżącego miasta albo null, bez Reacta. */
export const daneJesliGotowe = pamiec.daneJesliGotowe
