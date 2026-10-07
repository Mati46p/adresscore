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
  type PlikAdresow,
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
  /**
   * Obietnica adresów, a nie pochodna z samą wersją: gdy funkcja skończy wcześniej (np. po
   * przerwaniu), nikt nie czeka na pochodną, a jej odrzucenie trafia do konsoli jako nieobsłużone.
   */
  adresy: Promise<PlikAdresow>,
  /** Katalog danych miasta (`bazaDanych`): kompakt leży w nim w `kompakt/`. */
  baza: string,
  signal?: AbortSignal,
): Promise<SkaleGotowe | null> {
  try {
    const kompakt = `${baza}/kompakt/`
    const odp = await fetch(`${kompakt}indeks.json`, { signal })
    if (!odp.ok) return null
    const indeks = (await odp.json()) as IndeksKompaktu
    if (niezgodnoscKompaktu(indeks, await manifest)) return null
    const plikSkal = await fetch(`${kompakt}${indeks.skale.plik}`, { signal })
    if (!plikSkal.ok) return null
    const skale = (await plikSkal.json()) as Record<string, Skala>
    if (indeks.wersjaAdresow !== (await adresy).wersja) return null
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

/**
 * Pełne dane miasta. `signal` przerywa pobieranie (pamięć robi to, gdy miasto wypada z pamięci w
 * trakcie ładowania): wtedy funkcja odrzuca się błędem przerwania, bez wpisów do `pominiete` i bez
 * ostrzeżeń w konsoli – przerwanie nie jest awarią pliku.
 */
async function wczytajWszystko(slug: SlugMiasta, signal?: AbortSignal): Promise<Dane> {
  const baza = bazaDanych(slug)
  const adresyP = wczytajAdresy(baza, signal)
  const manifestP = wczytajManifest(baza, signal)
  const skaleP = wczytajSkaleKompaktu(manifestP, adresyP, baza, signal)
  const [plikAdresow, manifest] = await Promise.all([adresyP, manifestP])
  const skaleGotowe = await skaleP
  // Skale kończą się `null` także po przerwaniu (ich błąd jest tam połykany), więc przerwane
  // ładowanie staje tu, zanim ruszy kilkadziesiąt pobrań warstw.
  signal?.throwIfAborted()
  const pominiete: Dane['pominiete'] = []
  const n = plikAdresow.kolumny.id.length
  // Okolice ładują się równolegle ze wskaźnikami. Brak pliku nie blokuje mapy: zapas to dzielnica/gmina.
  // Plik `okolice.json` (jednostki SIM i miejscowości obwarzanka) istnieje tylko dla Krakowa (D8):
  // miasta go nie pobierają, więc nie ma zbędnego żądania 404 przy każdej zmianie miasta. Gdyby ETL
  // dołożył okolice dla miast, ten warunek jest jedynym miejscem do zmiany.
  const okolicePlik: Promise<PlikOkolic | null> =
    slug === MIASTO_DOMYSLNE
      ? wczytajOkolice(plikAdresow.wersja, n, baza, signal).catch((e: unknown) => {
          // Przerwanie nie jest brakiem pliku, więc bez ostrzeżenia. Obietnica nie odrzuca się nigdy:
          // po przerwaniu ładowanie kończy się wcześniej i nikt już na nią nie czeka.
          if (!signal?.aborted) console.warn(`Okolice (okolice.json) bez danych: ${String(e)}`)
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
        const plik = await wczytajWskaznik(meta.id, plikAdresow.wersja, baza, signal)
        return plik
          ? przygotujWskaznikZeSkala(plik, skaleGotowe?.get(meta.id))
          : pomin('niezgodna wersja adresów')
      } catch (e) {
        // Przerwanie przerywa całe ładowanie. Nie jest awarią warstwy: inaczej każda z kilkudziesięciu
        // warstw trafiłaby do `pominiete` i do konsoli jako „bez danych”.
        if (signal?.aborted) throw e
        // Jedna zepsuta warstwa nie może zablokować całej mapy.
        return pomin(String(e))
      }
    }),
  )
  // Przerwane po ostatnim pobraniu: bez ostrzeżeń niżej i bez rozwijania adresów, których nikt nie użyje.
  signal?.throwIfAborted()
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
