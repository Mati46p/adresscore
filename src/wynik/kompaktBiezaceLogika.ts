// Dane heksów bieżącego miasta z kompaktu (#247, paczka B2): źródło dla mapy i filtrów, gdy pełne
// dane (adresy.json, wskazniki/*.json) jeszcze nie przyszły albo nie są potrzebne. Podstawę i warstwy
// profilu trzyma menedżer przeglądu (`przegladMenedzer.ts`), więc nic nie jest pobierane drugi raz;
// tu dochodzą wyłącznie filtry (`filtry/<id>.bin`) i skale (`skale.<skrót>.json`), leniwie i z cache.
//
// Czysty plik (bez Reacta, `fetch` i `import.meta.env`) – sieć wchodzi z zewnątrz, żeby `node --test`
// sprawdził leniwość i deduplikację. Hook React: `kompaktBiezacy.ts`.
import type { Manifest } from '../kontrakty/index.ts'
import type { SlugMiasta } from '../kontrakty/miasta.ts'
import type { FiltrHeksow, PodstawaHeksow, WarstwaHeksow } from './heksy.ts'
import { type IndeksKompaktu, type Rozpakowany, rozpakuj, sekcja } from './kompakt.ts'
import type { WpisPrzegladu } from './przegladMenedzer.ts'
import type { Skala } from './silnik.ts'

export interface DaneHeksowGotowe {
  stan: 'gotowe'
  miasto: SlugMiasta
  manifest: Manifest
  indeks: IndeksKompaktu
  podstawa: PodstawaHeksow
  /** Warstwy, których plik już jest (rośnie w miarę dochodzenia plików). */
  warstwy: ReadonlyMap<string, WarstwaHeksow>
  /** Warstwy, których plik się nie wczytał: liczą się jak brak danych. */
  nieudane: ReadonlySet<string>
  /** Filtr heksów warstwy; null, dopóki plik nie doszedł (pierwsze wywołanie zamawia pobranie). */
  filtr(id: string): FiltrHeksow | null
  /** Skala warstwy; null, dopóki `skale.json` nie doszło albo gdy warstwy nie ma (pierwsze wywołanie zamawia pobranie). */
  skala(id: string): Skala | null
  /** Czy pobranie filtra warstwy zawiodło (do ponowienia automatycznego albo po zmianie filtrów). */
  filtrBlad(id: string): boolean
  /** Czy pobranie skal zawiodło. */
  skalaBlad(): boolean
}

export type StanDanychHeksow =
  | { stan: 'ladowanie' }
  | DaneHeksowGotowe
  | { stan: 'brak'; powod: string }

export interface ZaleznosciZrodla {
  /** Wpis przeglądu miasta (z menedżera) albo undefined, gdy jeszcze się ładuje. */
  wpis: (slug: SlugMiasta) => WpisPrzegladu | undefined
  /** Subskrypcja zmian menedżera; zwraca funkcję odpinającą. */
  subskrybujWpisy: (sluchacz: () => void) => () => void
  baza: (slug: SlugMiasta) => string
  json: <T>(url: string) => Promise<T>
  bajty: (url: string) => Promise<ArrayBuffer>
  ostrzez: (komunikat: string, powod?: unknown) => void
  /** Opóźnione wywołanie (ponowienie nieudanego pobrania); domyślnie `setTimeout`. */
  opoznij?: (f: () => void, ms: number) => void
}

/** Po tylu ms od błędu pobranie filtra albo skal jest zamawiane od nowa (kolejna zmiana migawki). */
export const PRZERWA_PONOWIENIA_MS = 5000
/** Tyle automatycznych ponowień na plik; dalej user wywoła je zmianą filtrów (nowa migawka, nowy indeks). */
const MAX_PONOWIEN = 3

/** Pliki dociągane leniwie dla jednego indeksu kompaktu (nowy indeks = świeży cache). */
interface Cache {
  filtry: Map<string, FiltrHeksow | 'blad'>
  zamowione: Set<string>
  skale: Record<string, Skala> | 'blad' | null
  skaleZamowione: boolean
  /** Liczba dotychczasowych ponowień: filtry po id, skale pod kluczem ''. */
  ponowienia: Map<string, number>
  /** Rośnie przy każdym dojściu pliku: odświeża migawkę. */
  wersja: number
}

export function filtrZPliku(r: Rozpakowany): FiltrHeksow {
  return {
    udzial: sekcja(r, 'udzial') as Uint8Array,
    min: sekcja(r, 'min') as Uint8Array,
    max: sekcja(r, 'max') as Uint8Array,
  }
}

export function utworzZrodloHeksow(z: ZaleznosciZrodla) {
  const sluchacze = new Set<() => void>()
  const cache = new WeakMap<IndeksKompaktu, Cache>()
  const migawki = new Map<
    SlugMiasta,
    { wpis: WpisPrzegladu | undefined; wersja: number; stan: StanDanychHeksow }
  >()

  function powiadom() {
    for (const f of [...sluchacze]) f()
  }

  function cacheIndeksu(indeks: IndeksKompaktu): Cache {
    let c = cache.get(indeks)
    if (!c) {
      c = {
        filtry: new Map(),
        zamowione: new Set(),
        skale: null,
        skaleZamowione: false,
        ponowienia: new Map(),
        wersja: 0,
      }
      cache.set(indeks, c)
    }
    return c
  }

  /** Po przerwie czyści błąd pliku, żeby kolejne `filtr`/`skala` zamówiły pobranie od nowa. */
  function zaplanujPonowienie(c: Cache, klucz: string, wyczysc: () => void) {
    const proby = c.ponowienia.get(klucz) ?? 0
    if (proby >= MAX_PONOWIEN) return
    c.ponowienia.set(klucz, proby + 1)
    const opoznij = z.opoznij ?? ((f, ms) => void setTimeout(f, ms))
    opoznij(() => {
      wyczysc()
      c.wersja++
      powiadom()
    }, PRZERWA_PONOWIENIA_MS)
  }

  function zamowSkale(slug: SlugMiasta, indeks: IndeksKompaktu, c: Cache) {
    if (c.skaleZamowione) return
    c.skaleZamowione = true
    z.json<Record<string, Skala>>(`${z.baza(slug)}/kompakt/${indeks.skale.plik}`).then(
      (skale) => {
        c.skale = skale
        c.wersja++
        powiadom()
      },
      (e: unknown) => {
        z.ostrzez(`Skale kompaktu (${slug}) niedostępne`, e)
        c.skale = 'blad'
        zaplanujPonowienie(c, '', () => {
          if (c.skale !== 'blad') return
          c.skale = null
          c.skaleZamowione = false
        })
        c.wersja++
        powiadom()
      },
    )
  }

  function zamowFiltr(slug: SlugMiasta, indeks: IndeksKompaktu, c: Cache, id: string) {
    const plik = indeks.wskazniki[id]?.filtr.plik
    if (!plik || c.zamowione.has(id)) return
    c.zamowione.add(id)
    z.bajty(`${z.baza(slug)}/kompakt/${plik}`)
      .then(rozpakuj)
      .then(filtrZPliku)
      .then(
        (f) => c.filtry.set(id, f),
        (e: unknown) => {
          z.ostrzez(`Filtr ${id} (${slug}) niedostępny`, e)
          c.filtry.set(id, 'blad')
          zaplanujPonowienie(c, id, () => {
            if (c.filtry.get(id) !== 'blad') return
            c.filtry.delete(id)
            c.zamowione.delete(id)
          })
        },
      )
      .finally(() => {
        c.wersja++
        powiadom()
      })
  }

  function zbuduj(slug: SlugMiasta, wpis: WpisPrzegladu | undefined): StanDanychHeksow {
    if (!wpis) return { stan: 'ladowanie' }
    if (wpis.stan === 'brak') return { stan: 'brak', powod: wpis.powod }
    const { indeks } = wpis
    // Stary format kompaktu: bez kolumny `i`, kafli r8 i sekcji `kolejnosc` (id.bin) ekran szukania nie
    // ma czym zastąpić pełnych danych. Marker 'slowniki' nie jest wymagany: ETL wystawia go tylko,
    // gdy słowniki etykiet powstały, a bez nich etykiety kafli i tak nie są kodami.
    if (!indeks.rozszerzenia?.includes('kolejnosc')) {
      return { stan: 'brak', powod: 'kompakt bez rozszerzeń (stary format)' }
    }
    const c = cacheIndeksu(indeks)
    return {
      stan: 'gotowe',
      miasto: slug,
      manifest: wpis.manifest,
      indeks,
      podstawa: wpis.podstawa,
      warstwy: wpis.warstwy,
      nieudane: wpis.nieudane,
      filtr(id) {
        zamowFiltr(slug, indeks, c, id)
        const f = c.filtry.get(id)
        return f && f !== 'blad' ? f : null
      },
      skala(id) {
        if (!indeks.wskazniki[id]) return null
        zamowSkale(slug, indeks, c)
        return c.skale && c.skale !== 'blad' ? (c.skale[id] ?? null) : null
      },
      filtrBlad: (id) => c.filtry.get(id) === 'blad',
      skalaBlad: () => c.skale === 'blad',
    }
  }

  return {
    /** Migawka dla `useSyncExternalStore`: ta sama (`===`), dopóki nie zmieni się wpis ani cache. */
    stan(slug: SlugMiasta): StanDanychHeksow {
      const wpis = z.wpis(slug)
      const wersja = wpis?.stan === 'gotowe' ? cacheIndeksu(wpis.indeks).wersja : 0
      const m = migawki.get(slug)
      if (m && m.wpis === wpis && m.wersja === wersja) return m.stan
      const stan = zbuduj(slug, wpis)
      migawki.set(slug, { wpis, wersja, stan })
      return stan
    },
    subskrybuj(sluchacz: () => void): () => void {
      sluchacze.add(sluchacz)
      const odepnij = z.subskrybujWpisy(sluchacz)
      return () => {
        sluchacze.delete(sluchacz)
        odepnij()
      }
    },
  }
}

export type ZrodloHeksow = ReturnType<typeof utworzZrodloHeksow>
