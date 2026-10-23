// „Lepszy sąsiad” z kafli kompaktu (#247, B7b): bez pełnych danych adresy w promieniu 500 m biorą się z
// kafli wokół adresu, a liczy je ta sama `lepsiSasiedzi` co dla pełnych danych. Moduł czysty (bez Reacta
// i sieci), więc test zgodności jedzie na gołym `node --test`.
//
// Zasada zgodności: kafle łączymy w jeden zbiór posortowany po `Adres.i` (pozycji w adresy.json), więc
// kolejność lokalna jest taka sama jak globalna, a remisy (`x.i - y.i`) rozstrzygają się tak samo.
// Wyniki wracają z globalnym `i`, bo karta, mapa i Porównanie mówią pozycją w adresy.json.
import type { Adres } from '../kontrakty/index.ts'
import type { KafelGotowy } from './kafle.ts'
import {
  type LepsiSasiedzi,
  lepsiSasiedzi,
  type OpcjeSasiadow,
  type UstawieniaSasiadow,
} from './sasiedzi.ts'
import type { WskaznikPrzygotowany } from './silnik.ts'

/** Adresy kilku kafli złożone w jedną „małą wersję” pełnych danych. */
export interface ZbiorKafli {
  /** Adresy posortowane po `Adres.i`; pozycja na liście to indeks lokalny. */
  adresy: Adres[]
  /** Warstwy ze wspólnymi tablicami wartości (indeks lokalny); brak danych = NaN, nigdy 0. */
  wskazniki: WskaznikPrzygotowany[]
  /** `Adres.i` → indeks lokalny. */
  lokalny: ReadonlyMap<number, number>
  /** Adresy pod swoim `i` (rzadka tablica) – dla `propsSasiadowMapy`, które czyta `adresy[k.i]`. */
  poI: readonly Adres[]
}

/** Łączy kafle w zbiór. Adres obecny w kilku kaflach (nie powinien) liczy się raz. */
export function zbiorZKafli(kafle: readonly KafelGotowy[]): ZbiorKafli {
  const widziane = new Set<number>()
  const wpisy: { kafel: KafelGotowy; j: number; adres: Adres }[] = []
  for (const kafel of kafle)
    kafel.adresy.forEach((adres, j) => {
      if (widziane.has(adres.i)) return
      widziane.add(adres.i)
      wpisy.push({ kafel, j, adres })
    })
  wpisy.sort((a, b) => a.adres.i - b.adres.i)
  const n = wpisy.length

  const poIdKafla = new Map<KafelGotowy, Map<string, WskaznikPrzygotowany>>()
  const wzorce = new Map<string, WskaznikPrzygotowany>()
  for (const kafel of kafle) {
    const m = new Map<string, WskaznikPrzygotowany>()
    for (const w of kafel.wskazniki) {
      m.set(w.meta.id, w)
      if (!wzorce.has(w.meta.id)) wzorce.set(w.meta.id, w)
    }
    poIdKafla.set(kafel, m)
  }

  const wskazniki: WskaznikPrzygotowany[] = []
  for (const [id, wzor] of wzorce) {
    const wartosci = new Float64Array(n).fill(Number.NaN)
    const maEtykiety = kafle.some((k) => poIdKafla.get(k)?.get(id)?.etykiety)
    const etykiety: (string | null)[] | null = maEtykiety ? new Array(n).fill(null) : null
    wpisy.forEach(({ kafel, j }, p) => {
      const w = poIdKafla.get(kafel)?.get(id)
      if (!w) return
      wartosci[p] = w.wartosci[j] as number
      if (etykiety) etykiety[p] = w.etykiety?.[j] ?? null
    })
    wskazniki.push({
      meta: wzor.meta,
      wartosci,
      ...(etykiety ? { etykiety } : {}),
      ...(wzor.slownikEtykiet ? { slownikEtykiet: wzor.slownikEtykiet } : {}),
      skala: wzor.skala,
    })
  }

  const lokalny = new Map<number, number>()
  const adresy = wpisy.map(({ adres }, p) => {
    lokalny.set(adres.i, p)
    return adres
  })
  const poI: Adres[] = []
  for (const a of adresy) poI[a.i] = a
  return { adresy, wskazniki, lokalny, poI }
}

let ostatniZbior: { kafle: readonly KafelGotowy[]; zbior: ZbiorKafli } | null = null

/** `zbiorZKafli` z pamięcią ostatniego wywołania: te same kafle dają ten sam obiekt (pamięć `policzSasiadow` po tożsamości). */
export function zbiorZKafliPamiec(kafle: readonly KafelGotowy[]): ZbiorKafli {
  const o = ostatniZbior
  if (o && o.kafle.length === kafle.length && o.kafle.every((k, p) => k === kafle[p]))
    return o.zbior
  const zbior = zbiorZKafli(kafle)
  ostatniZbior = { kafle: [...kafle], zbior }
  return zbior
}

/**
 * Lepsi sąsiedzi adresu `i` (pozycja w adresy.json) policzeni na adresach z kafli; `i` w wyniku to też
 * pozycja w adresy.json. Adresu nie ma w zbiorze (kafel jeszcze się nie wczytał) = null.
 */
export function lepsiSasiedziZKafli(
  i: number,
  zbior: ZbiorKafli,
  ustawienia: UstawieniaSasiadow,
  opcje: OpcjeSasiadow = {},
): LepsiSasiedzi | null {
  const lokalny = zbior.lokalny.get(i)
  if (lokalny === undefined) return null
  // Opcja budynku dostaje indeks lokalny, a zna go wołający po globalnym.
  const budynek = opcje.budynekAdresu
  const lokalneOpcje: OpcjeSasiadow = budynek
    ? { ...opcje, budynekAdresu: (p) => budynek((zbior.adresy[p] as Adres).i) }
    : opcje
  const w = lepsiSasiedzi(lokalny, zbior.adresy, zbior.wskazniki, ustawienia, lokalneOpcje)
  const globalnie = (p: number) => (zbior.adresy[p] as Adres).i
  return {
    wyjsciowy: { ...w.wyjsciowy, i },
    kandydaci: w.kandydaci.map((k) => ({ ...k, i: globalnie(k.i) })),
  }
}
