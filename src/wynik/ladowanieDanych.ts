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

/** Tyle elementów kolumny tekstowej na wiadomość: klon porcji to ułamek ms, a nie wielka pauza. */
export const ELEMENTOW_W_PORCJI = 20_000

type KluczKolumny = keyof PlikAdresow['kolumny']

/**
 * Wynik ładowania pocięty na wiadomości workera. Każda jest tania do sklonowania na wątku głównym
 * (kawałek kolumny, etykiet albo jedna warstwa); wartości warstw idą jako tablice typowane z transferem.
 * Kolumny tekstowe w kawałkach zamiast słownika: nie wymagają kodowania ani dekodowania, a h3
 * w ogóle nie jedzie – wątek główny odtwarza je z `heksy` + `indeksHeksu`, które i tak są potrzebne.
 */
export type Porcja =
  | {
      typ: 'start'
      miasto: SlugMiasta
      wersja: string
      zrodla: PlikAdresow['zrodla']
      atrapa?: boolean
      manifest: Manifest
      n: number
    }
  | { typ: 'kolumna'; klucz: Exclude<KluczKolumny, 'h3'>; od: number; dane: unknown[] }
  | { typ: 'heksy'; od: number; dane: string[] }
  | { typ: 'indeksHeksu'; dane: Uint32Array }
  | { typ: 'okolice'; okolice: PlikOkolic | null }
  | { typ: 'okolica'; od: number; dane: (number | null)[] }
  | {
      typ: 'warstwa'
      meta: WskaznikPrzygotowany['meta']
      skala: Skala
      niedostepny?: string
      slownikEtykiet?: WskaznikPrzygotowany['slownikEtykiet']
      wartosci: Float64Array
      /** Długość kolumny etykiet, gdy warstwa je ma; same napisy idą kolejnymi porcjami `etykiety`. */
      liczbaEtykiet?: number
    }
  | { typ: 'etykiety'; warstwa: number; od: number; dane: (string | null)[] }
  | { typ: 'koniec'; pominiete: WynikLadowania['pominiete'] }

/** Porcje wyniku po kolei, każda z listą buforów do transferu. Kolejność: start … warstwy, koniec. */
export function* porcjeWyniku(
  wynik: WynikLadowania,
  wPorcji = ELEMENTOW_W_PORCJI,
): Generator<{ porcja: Porcja; transfer: ArrayBuffer[] }> {
  const { plikAdresow, grupyHeksow, okolice } = wynik
  const n = plikAdresow.kolumny.id.length
  yield {
    porcja: {
      typ: 'start',
      miasto: wynik.miasto,
      wersja: plikAdresow.wersja,
      zrodla: plikAdresow.zrodla,
      atrapa: plikAdresow.atrapa,
      manifest: wynik.manifest,
      n,
    },
    transfer: [],
  }
  for (const klucz of Object.keys(plikAdresow.kolumny) as KluczKolumny[]) {
    if (klucz === 'h3') continue
    const kolumna: readonly unknown[] = plikAdresow.kolumny[klucz]
    for (let od = 0; od < n; od += wPorcji) {
      yield {
        porcja: { typ: 'kolumna', klucz, od, dane: kolumna.slice(od, od + wPorcji) },
        transfer: [],
      }
    }
  }
  for (let od = 0; od < grupyHeksow.heksy.length; od += wPorcji) {
    yield {
      porcja: { typ: 'heksy', od, dane: grupyHeksow.heksy.slice(od, od + wPorcji) },
      transfer: [],
    }
  }
  yield {
    porcja: { typ: 'indeksHeksu', dane: grupyHeksow.indeksHeksu },
    transfer: [grupyHeksow.indeksHeksu.buffer as ArrayBuffer],
  }
  // Okolice bez kolumny adresów (ta idzie kawałkami); składacz dokłada ją z powrotem.
  yield {
    porcja: {
      typ: 'okolice',
      okolice: okolice ? { ...okolice, kolumny: { okolica: [] } } : null,
    },
    transfer: [],
  }
  if (okolice) {
    const kol = okolice.kolumny.okolica
    for (let od = 0; od < kol.length; od += wPorcji) {
      yield { porcja: { typ: 'okolica', od, dane: kol.slice(od, od + wPorcji) }, transfer: [] }
    }
  }
  for (const [warstwa, w] of wynik.wskazniki.entries()) {
    const { wartosci, etykiety, ...reszta } = w
    yield {
      porcja: { typ: 'warstwa', ...reszta, wartosci, liczbaEtykiet: etykiety?.length },
      transfer: [wartosci.buffer as ArrayBuffer],
    }
    // Etykiety bywają unikalne dla każdego adresu (słownik nic nie daje, a to ~16 MB napisów): kawałkami.
    const krok = Math.max(1, wPorcji >> 2) // napisy ~170 B każdy, więc porcje 4x mniejsze
    for (let od = 0; etykiety && od < etykiety.length; od += krok) {
      yield {
        porcja: {
          typ: 'etykiety',
          warstwa,
          od,
          dane: etykiety.slice(od, od + krok) as (string | null)[],
        },
        transfer: [],
      }
    }
  }
  yield { porcja: { typ: 'koniec', pominiete: wynik.pominiete }, transfer: [] }
}

/**
 * Składa porcje z workera w `WynikLadowania` identyczny z tym, który dostałby wątek główny bez
 * porcjowania. Każde `dodaj` to krótka praca (przepisanie kawałka), więc każda wiadomość
 * workera to osobne, małe zadanie.
 */
export function utworzSkladacza() {
  let start: Extract<Porcja, { typ: 'start' }> | null = null
  let kolumny: Record<string, unknown[]> = {}
  const heksy: string[] = []
  let indeksHeksu: Uint32Array | null = null
  let okolice: PlikOkolic | null = null
  let okolica: (number | null)[] = []
  const wskazniki: WskaznikPrzygotowany[] = []
  let pominiete: WynikLadowania['pominiete'] | null = null

  const wpisz = (cel: unknown[], od: number, dane: readonly unknown[]) => {
    for (let i = 0; i < dane.length; i++) cel[od + i] = dane[i]
  }

  return {
    /** Dodaje porcję; zwraca true po ostatniej (`koniec`). */
    dodaj(p: Porcja): boolean {
      switch (p.typ) {
        case 'start':
          start = p
          kolumny = {}
          return false
        case 'kolumna': {
          const cel = (kolumny[p.klucz] ??= new Array(start?.n ?? 0))
          wpisz(cel, p.od, p.dane)
          return false
        }
        case 'heksy':
          wpisz(heksy, p.od, p.dane)
          return false
        case 'indeksHeksu':
          indeksHeksu = p.dane
          return false
        case 'okolice':
          okolice = p.okolice
          okolica = new Array(start?.n ?? 0)
          return false
        case 'okolica':
          wpisz(okolica, p.od, p.dane)
          return false
        case 'warstwa': {
          const { typ: _typ, liczbaEtykiet, ...w } = p
          wskazniki.push(
            liczbaEtykiet === undefined ? w : { ...w, etykiety: new Array(liczbaEtykiet) },
          )
          return false
        }
        case 'etykiety': {
          const cel = wskazniki[p.warstwa]?.etykiety as (string | null)[] | undefined
          if (cel) wpisz(cel, p.od, p.dane)
          return false
        }
        case 'koniec':
          pominiete = p.pominiete
          return true
      }
    },
    zloz(): WynikLadowania {
      if (!start || !indeksHeksu || !pominiete) throw new Error('Niekompletne porcje danych')
      const h3 = new Array<string>(start.n)
      for (let i = 0; i < start.n; i++) h3[i] = heksy[indeksHeksu[i] as number] as string
      const plikAdresow: PlikAdresow = {
        wersja: start.wersja,
        zrodla: start.zrodla,
        ...(start.atrapa === undefined ? {} : { atrapa: start.atrapa }),
        kolumny: { ...kolumny, h3 } as unknown as PlikAdresow['kolumny'],
      }
      return {
        miasto: start.miasto,
        plikAdresow,
        manifest: start.manifest,
        wskazniki,
        pominiete,
        grupyHeksow: { heksy, indeksHeksu },
        okolice: okolice ? { ...okolice, kolumny: { okolica } } : null,
      }
    },
  }
}
