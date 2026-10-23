// Ładowanie danych miasta bez Reacta i bez `import.meta.env` (jak `kompakt.ts`): ten sam kod chodzi
// w workerze danych (`daneWorker.ts`, ciężka praca poza wątkiem głównym: pobranie, parsowanie
// JSON, skale, grupowanie heksów) i na wątku głównym jako zapas, gdy `Worker` jest niedostępny,
// oraz pod `node --test`. Dostęp do sieci wchodzi przez `pobierzJson`, a ostrzeżenia przez
// `ostrzez`, bo worker nie ma wspólnej konsoli z kartą: wątek główny wypisuje je u siebie.
import type { Manifest, PlikAdresow, PlikWskaznika } from '../kontrakty/index.ts'
import { MIASTO_DOMYSLNE, type SlugMiasta } from '../kontrakty/miasta.ts'
import { niezgodnoscOkolic, type PlikOkolic } from '../kontrakty/okolice.ts'
import { type IndeksKompaktu, niezgodnoscKompaktu } from './kompakt.ts'
import {
  type GrupyHeksow,
  grupujHeksy,
  przygotujWskaznikZeSkala,
  type Skala,
  type WskaznikPrzygotowany,
  wskaznikNiedostepny,
} from './silnik.ts'

/** Pobranie i sparsowanie pliku JSON; błąd HTTP = wyjątek. Ścieżka jest już pełna (z katalogiem bazy). */
export type PobierzJson = (sciezka: string, signal?: AbortSignal) => Promise<unknown>

/** Najwięcej pobrań warstw naraz: kilkadziesiąt równoległych żądań tylko się wzajemnie głodzi. */
export const POBRAN_NARAZ = 6

export interface WejscieLadowania {
  slug: SlugMiasta
  /** Katalog danych miasta (`bazaDanych(slug)`), liczony na wątku głównym. */
  baza: string
  pobierzJson: PobierzJson
  /** Ostrzeżenie do konsoli wątku głównego (nie mylić z błędem: ładowanie idzie dalej). */
  ostrzez: (tekst: string) => void
}

/** To, co zwraca ładowanie: `Dane` bez rozwiniętych obiektów adresów (te składa wątek główny). */
export interface WynikLadowania {
  miasto: SlugMiasta
  plikAdresow: PlikAdresow
  manifest: Manifest
  wskazniki: WskaznikPrzygotowany[]
  pominiete: { id: string; powod: string }[]
  grupyHeksow: GrupyHeksow
  okolice: PlikOkolic | null
}

type SkaleGotowe = Map<string, { skala: Skala; zDanymi: number }>

/**
 * Skale warstw z kompaktu (ETL liczy je tym samym silnikiem). Każdy błąd albo niezgodność = null
 * i skale liczymy sami. Każda skala jest jeszcze sprawdzana przy warstwie (`skalaPasuje`), bo
 * kompakt mógł nie zostać przebudowany po zmianie wartości.
 */
async function wczytajSkaleKompaktu(
  manifest: Promise<Manifest>,
  /**
   * Obietnica adresów, a nie pochodna z samą wersją: gdy funkcja skończy wcześniej (np. po
   * przerwaniu), nikt nie czeka na pochodną, a jej odrzucenie trafia do konsoli jako nieobsłużone.
   */
  adresy: Promise<PlikAdresow>,
  baza: string,
  pobierzJson: PobierzJson,
  signal?: AbortSignal,
): Promise<SkaleGotowe | null> {
  try {
    const kompakt = `${baza}/kompakt/`
    const indeks = (await pobierzJson(`${kompakt}indeks.json`, signal)) as IndeksKompaktu
    if (niezgodnoscKompaktu(indeks, await manifest)) return null
    const skale = (await pobierzJson(`${kompakt}${indeks.skale.plik}`, signal)) as Record<
      string,
      Skala
    >
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

/** Uruchamia `zadania` po najwyżej `limit` naraz, wyniki w kolejności zadań. Pierwszy błąd przerywa. */
async function rownolegleZLimitem<T>(
  zadania: readonly (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const wyniki: T[] = new Array(zadania.length)
  let nastepne = 0
  const robotnik = async () => {
    while (nastepne < zadania.length) {
      const k = nastepne++
      wyniki[k] = await (zadania[k] as () => Promise<T>)()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, zadania.length) }, robotnik))
  return wyniki
}

/**
 * Pełne dane miasta poza obiektami adresów. `signal` przerywa pobieranie: funkcja odrzuca się
 * wtedy błędem przerwania, bez wpisów do `pominiete` i bez ostrzeżeń – przerwanie nie jest
 * awarią pliku.
 */
export async function ladujDaneMiasta(
  wej: WejscieLadowania,
  signal?: AbortSignal,
): Promise<WynikLadowania> {
  const { slug, baza, pobierzJson, ostrzez } = wej
  const adresyP = pobierzJson(`${baza}/adresy.json`, signal) as Promise<PlikAdresow>
  const manifestP = pobierzJson(`${baza}/manifest.json`, signal) as Promise<Manifest>
  const skaleP = wczytajSkaleKompaktu(manifestP, adresyP, baza, pobierzJson, signal)
  const [plikAdresow, manifest] = await Promise.all([adresyP, manifestP])
  const skaleGotowe = await skaleP
  // Skale kończą się `null` także po przerwaniu (ich błąd jest tam połykany), więc przerwane
  // ładowanie staje tu, zanim ruszy kilkadziesiąt pobrań warstw.
  signal?.throwIfAborted()
  const pominiete: WynikLadowania['pominiete'] = []
  const n = plikAdresow.kolumny.id.length
  // Okolice ładują się równolegle ze wskaźnikami. Brak pliku nie blokuje mapy: zapas to dzielnica/gmina.
  // Plik `okolice.json` (jednostki SIM i miejscowości obwarzanka) istnieje tylko dla Krakowa (D8):
  // miasta go nie pobierają, więc nie ma zbędnego żądania 404 przy każdej zmianie miasta. Gdyby ETL
  // dołożył okolice dla miast, ten warunek jest jedynym miejscem do zmiany.
  const okolicePlik: Promise<PlikOkolic | null> =
    slug === MIASTO_DOMYSLNE
      ? (async () => {
          const p = (await pobierzJson(`${baza}/okolice.json`, signal)) as PlikOkolic
          const powod = niezgodnoscOkolic(p, plikAdresow.wersja, n)
          if (powod !== null) {
            ostrzez(`Okolice (${baza}/okolice.json) pominięte: ${powod}`)
            return null
          }
          return p
        })().catch((e: unknown) => {
          // Przerwanie nie jest brakiem pliku, więc bez ostrzeżenia. Obietnica nie odrzuca się nigdy:
          // po przerwaniu ładowanie kończy się wcześniej i nikt już na nią nie czeka.
          if (!signal?.aborted) ostrzez(`Okolice (okolice.json) bez danych: ${String(e)}`)
          return null
        })
      : Promise.resolve(null)
  const wskazniki = await rownolegleZLimitem(
    manifest.wskazniki.map(({ wersjaAdresow, ...meta }) => async () => {
      const pomin = (powod: string) => {
        pominiete.push({ id: meta.id, powod })
        return wskaznikNiedostepny(meta, n, powod)
      }
      if (wersjaAdresow !== plikAdresow.wersja) {
        return pomin(`adresy ${wersjaAdresow}, mamy ${plikAdresow.wersja}`)
      }
      try {
        const plik = (await pobierzJson(
          `${baza}/wskazniki/${meta.id}.json`,
          signal,
        )) as PlikWskaznika
        if (plik.wersjaAdresow !== plikAdresow.wersja) {
          // Id warstw powtarzają się między miastami, więc komunikat mówi, o który zbiór chodzi.
          ostrzez(
            `Wskaźnik ${meta.id} (${baza}) liczony dla adresów ${plik.wersjaAdresow}, mamy ${plikAdresow.wersja}`,
          )
          return pomin('niezgodna wersja adresów')
        }
        return przygotujWskaznikZeSkala(plik, skaleGotowe?.get(meta.id))
      } catch (e) {
        // Przerwanie przerywa całe ładowanie. Nie jest awarią warstwy: inaczej każda z kilkudziesięciu
        // warstw trafiłaby do `pominiete` i do konsoli jako „bez danych”.
        if (signal?.aborted) throw e
        // Jedna zepsuta warstwa nie może zablokować całej mapy.
        return pomin(String(e))
      }
    }),
    POBRAN_NARAZ,
  )
  // Przerwane po ostatnim pobraniu: bez ostrzeżeń niżej i bez grupowania, którego nikt nie użyje.
  signal?.throwIfAborted()
  // Id warstw powtarzają się między miastami, więc ostrzeżenie mówi, o które miasto chodzi.
  for (const p of pominiete) ostrzez(`Wskaźnik ${p.id} (${slug}) bez danych: ${p.powod}`)
  return {
    miasto: slug,
    plikAdresow,
    manifest,
    wskazniki,
    pominiete,
    grupyHeksow: grupujHeksy(plikAdresow.kolumny.h3),
    okolice: await okolicePlik,
  }
}

/**
 * Bufory do przekazania z workera bez kopiowania: wartości warstw i indeks heksów. Każdy bufor
 * występuje raz (transfer tego samego bufora dwa razy rzuca wyjątek).
 */
export function listaTransferow(wynik: WynikLadowania): ArrayBuffer[] {
  const bufory = new Set<ArrayBuffer>()
  for (const w of wynik.wskazniki) bufory.add(w.wartosci.buffer as ArrayBuffer)
  bufory.add(wynik.grupyHeksow.indeksHeksu.buffer as ArrayBuffer)
  return [...bufory]
}
