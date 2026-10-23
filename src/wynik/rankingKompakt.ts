// Ranking ulic bez pełnych danych (#247, paczka B5): zamiast 176 tys. adresów z adresy.json ekran
// Szukaj składa top 5 w dwóch krokach.
//   1. Przybliżenie z heksów r10 (średnia wyników ważona liczbą adresów, grupowanie po dominującej
//      ulicy heksu) – gotowe od ręki, bo wyniki heksów i podstawa są już w pamięci.
//   2. Doprecyzowanie: kafle zawierające heksy 25 najlepszych ulic (limit ~1,5 MB), wynik każdego adresu
//      tymi samymi funkcjami co pełna ścieżka i dokładny `rankingUlic` na adresach z kafli.
// Czysty plik (bez Reacta i `@/`), więc idzie na gołym `node --test`; hook: `useRankingKompakt.ts`.
// Brak danych nigdy nie jest zerem: heks bez wyniku nie wchodzi do średniej.
import { cellToParent, gridDisk } from 'h3-js'
import type { Adres, PlikOkolic } from '../kontrakty/index.ts'
import type { TwardyFiltr } from './filtry.ts'
import { policzWykluczenia } from './filtry.ts'
import type { PodstawaHeksow } from './heksy.ts'
import type { KafelGotowy } from './kafle.ts'
import type { IndeksKompaktu, KafelKompaktu } from './kompakt.ts'
import { type PozycjaUlicy, rankingUlic } from './rankingUlic.ts'
import type { Kierunki } from './silnik.ts'
import { slugTekstu } from './slug.ts'
import { ocenyMapy } from './warstwaMapy.ts'

/** Ile ulic z przybliżenia dostaje doprecyzowanie (spec: 25; gdy bramka zgodności nie wychodzi, 40). */
export const KANDYDACI = 25

/** Budżet pobrania kafli: ~70 KB gzip na kafel, więc ok. 21 kafli. */
export const LIMIT_BAJTOW = 1_500_000
const SZACOWANY_KAFEL = 70_000

/** Wejście z `WynikiMapy`: tyle wystarcza rankingowi (test nie musi budować całego obiektu). */
export interface WynikiHeksow {
  heksy: ReadonlyMap<string, number | null>
  wykluczoneHeksy: ReadonlySet<string>
}

/** Ulica z przybliżenia: średnia po heksach, w których jest dominująca. */
export interface Kandydat {
  /** Nazwa ulicy (albo miejscowości, gdy heks nie ma ulicy) – tak samo jak `ulica ?? miejscowosc` adresu. */
  nazwa: string
  /** Dzielnica albo gmina z podstawy; to, co mamy, zanim przyjdą adresy. */
  okolica: string
  /** Heksy r10 ulicy z wynikiem i niewykluczone. */
  heksy: string[]
  /** Suma adresów w tych heksach (waga średniej). */
  liczbaAdresow: number
  wynik: number
}

/**
 * Przybliżenie: ulice posortowane malejąco po średniej ważonej, remis po nazwie (stabilnie). Zwraca
 * najwyżej `ile` ulic. Heks bez wyniku (`null`/brak), wykluczony albo pusty nie wchodzi do średniej.
 */
export function przyblizenieUlic(
  podstawa: PodstawaHeksow,
  wyniki: WynikiHeksow,
  ile = KANDYDACI,
): Kandydat[] {
  const { heksy: idHeksow, liczba } = podstawa.poziomy[10]
  const grupy = new Map<string, Kandydat & { suma: number }>()
  for (let h = 0; h < idHeksow.length; h++) {
    const id = idHeksow[h] as string
    const wynik = wyniki.heksy.get(id)
    const waga = liczba[h] as number
    if (wynik === null || wynik === undefined || !Number.isFinite(wynik)) continue
    if (wyniki.wykluczoneHeksy.has(id) || !(waga > 0)) continue
    const nazwa = podstawa.ulica[h] ?? ''
    if (!nazwa) continue
    const okolica = podstawa.dzielnica[h] ?? ''
    const klucz = `${nazwa}\u0000${okolica}`
    const g = grupy.get(klucz)
    if (g) {
      g.suma += wynik * waga
      g.liczbaAdresow += waga
      g.heksy.push(id)
    } else {
      grupy.set(klucz, {
        nazwa,
        okolica,
        heksy: [id],
        liczbaAdresow: waga,
        suma: wynik * waga,
        wynik,
      })
    }
  }
  return [...grupy.values()]
    .map(({ suma, ...k }) => ({ ...k, wynik: suma / k.liczbaAdresow }))
    .sort((a, b) => b.wynik - a.wynik || a.nazwa.localeCompare(b.nazwa, 'pl'))
    .slice(0, ile)
}

/**
 * Kandydaci w kształcie pozycji rankingu, na czas, zanim przyjdą kafle. Brakuje im sluga, okolicy i
 * adresu do porównania (heks ich nie niesie), więc: `slug` zaczyna się od `~` (nigdy prawdziwy link, ale
 * stabilny klucz listy), `miejscowosc` to dzielnica/gmina z heksu, `okolica` null, `adresDoPorownania` -1.
 * Ekran ma nie robić z tych wierszy linków, dopóki hook mówi `przyblizony`.
 */
export function pozycjeZPrzyblizenia(kandydaci: readonly Kandydat[], ile = 5): PozycjaUlicy[] {
  return kandydaci.slice(0, ile).map((k) => ({
    slug: `~${slugTekstu(k.nazwa)}-${slugTekstu(k.okolica)}`,
    nazwa: k.nazwa,
    miejscowosc: k.okolica,
    okolica: null,
    liczbaAdresow: k.liczbaAdresow,
    wynik: k.wynik,
    adresDoPorownania: -1,
  }))
}

// ── Który kafel ──────────────────────────────────────────────────────────────────────────

const poHeksie = new WeakMap<IndeksKompaktu, Map<string, KafelKompaktu>>()

function mapaKafli(indeks: IndeksKompaktu) {
  let m = poHeksie.get(indeks)
  if (!m) {
    m = new Map(indeks.kafle.map((k) => [k.h3, k]))
    poHeksie.set(indeks, m)
  }
  return m
}

/**
 * Kafel zawierający heks r10: dziecko r8, a gdy go nie ma (r7 nie był dzielony), rodzic r7. Adresy
 * są przypisane do kafla po rodzicu swojego heksu r10 (tak samo `kafelPunktu`), więc ten sam wzór.
 */
export function kafelHeksu(indeks: IndeksKompaktu, heks: string): KafelKompaktu | null {
  const m = mapaKafli(indeks)
  const h8 = cellToParent(heks, 8)
  const k8 = m.get(h8)
  if (k8 && (k8.res ?? 7) === 8) return k8
  const k7 = m.get(cellToParent(h8, 7))
  return k7 && (k7.res ?? 7) === 7 ? k7 : null
}

/**
 * Plan z najlepszych heksów (zamiast ulic): kafle pod kolejnymi heksami od najwyższego wyniku, aż do
 * limitu. Łapie ulice, które nigdzie nie są dominujące w heksie (np. jeden adres przy rogu), a których
 * przybliżenie po `podstawa.ulica` nie widzi.
 */
export function planKafliZHeksow(
  indeks: IndeksKompaktu,
  podstawa: PodstawaHeksow,
  wyniki: WynikiHeksow,
  limitBajtow = LIMIT_BAJTOW,
): PlanKafli {
  const { heksy: idHeksow, liczba } = podstawa.poziomy[10]
  const lista: { id: string; wynik: number }[] = []
  for (let h = 0; h < idHeksow.length; h++) {
    const id = idHeksow[h] as string
    const wynik = wyniki.heksy.get(id)
    if (wynik === null || wynik === undefined || !Number.isFinite(wynik)) continue
    if (wyniki.wykluczoneHeksy.has(id) || !((liczba[h] as number) > 0)) continue
    lista.push({ id, wynik })
  }
  lista.sort((a, b) => b.wynik - a.wynik || (a.id < b.id ? -1 : 1))
  const wybrane = new Map<string, KafelKompaktu>()
  let bajty = 0
  const rozmiar = (k: KafelKompaktu) =>
    (k as KafelKompaktu & { bajty?: number }).bajty ?? SZACOWANY_KAFEL
  for (const { id } of lista) {
    const k = kafelHeksu(indeks, id)
    if (!k || wybrane.has(k.plik)) continue
    if (bajty + rozmiar(k) > limitBajtow) break
    wybrane.set(k.plik, k)
    bajty += rozmiar(k)
  }
  return { kafle: [...wybrane.values()], pokryci: [], bajty }
}

export interface PlanKafli {
  kafle: KafelKompaktu[]
  /** Kandydaci, których wszystkie heksy mają kafel w planie – tylko im ufa dokładny ranking. */
  pokryci: Kandydat[]
  bajty: number
}

/**
 * Które kafle pobrać. Kandydaci idą od najlepszego: ulica wchodzi do planu w całości (wszystkie jej
 * kafle) albo wcale, bo średnia z połowy ulicy mogłaby wyprzedzić prawdziwie lepszą. Rozmiar z `bajty`
 * kafla, a gdy indeks go nie niesie (dziś nie niesie), ~70 KB na kafel.
 */
export function planKafli(
  indeks: IndeksKompaktu,
  kandydaci: readonly Kandydat[],
  limitBajtow = LIMIT_BAJTOW,
  promien = 0,
): PlanKafli {
  const wybrane = new Map<string, KafelKompaktu>()
  const pokryci: Kandydat[] = []
  let bajty = 0
  const rozmiar = (k: KafelKompaktu) =>
    (k as KafelKompaktu & { bajty?: number }).bajty ?? SZACOWANY_KAFEL
  for (const kandydat of kandydaci) {
    const nowe = new Map<string, KafelKompaktu>()
    let komplet = true
    for (const h of kandydat.heksy) {
      const k = kafelHeksu(indeks, h)
      if (!k) {
        komplet = false
        break
      }
      if (!wybrane.has(k.plik)) nowe.set(k.plik, k)
      // Adresy ulicy leżą też w sąsiednich heksach, w których dominuje inna ulica: kafle sąsiadów.
      if (promien > 0)
        for (const sasiad of gridDisk(h, promien)) {
          const ks = kafelHeksu(indeks, sasiad)
          if (ks && !wybrane.has(ks.plik)) nowe.set(ks.plik, ks)
        }
    }
    if (!komplet) continue
    let dodatek = 0
    for (const k of nowe.values()) dodatek += rozmiar(k)
    if (bajty + dodatek > limitBajtow) continue
    for (const [plik, k] of nowe) wybrane.set(plik, k)
    bajty += dodatek
    pokryci.push(kandydat)
  }
  return { kafle: [...wybrane.values()], pokryci, bajty }
}

// ── Dokładny ranking ─────────────────────────────────────────────────────────────────────

export interface WejscieDokladne {
  kafle: readonly KafelGotowy[]
  /** Nazwy ulic, które mają wejść do rankingu (kafel niesie też inne ulice, z urywkami). */
  nazwy: ReadonlySet<string> | null
  wagi: Readonly<Record<string, number>>
  kierunki: Kierunki
  warstwa: string
  filtry: readonly TwardyFiltr[]
  heksy: ReadonlyMap<string, number | null>
  okolice?: PlikOkolic | null
  ile?: number
}

/**
 * Dokładny `rankingUlic` na adresach z kafli. Wynik adresu liczą te same funkcje co pełna ścieżka
 * (`ocenyMapy`, `policzWykluczenia`) na wskaźnikach kafla. `adresDoPorownania` to `Adres.i` (pozycja w
 * adresy.json), a nie pozycja na sklejonej liście.
 */
export function rankingZKafli(w: WejscieDokladne): PozycjaUlicy[] {
  const adresy: Adres[] = []
  const wyniki: number[] = []
  const wykluczone: number[] = []
  for (const kafel of w.kafle) {
    const n = kafel.adresy.length
    const oceny = ocenyMapy(kafel.wskazniki, w.wagi, w.kierunki, w.warstwa, n).naAdres
    const wykl = policzWykluczenia(kafel.wskazniki, w.filtry, n).wykluczony
    for (let j = 0; j < n; j++) {
      const adres = kafel.adresy[j] as Adres
      if (w.nazwy && !w.nazwy.has(adres.ulica ?? adres.miejscowosc)) continue
      adresy.push(adres)
      wyniki.push(oceny[j] as number)
      wykluczone.push(wykl[j] as number)
    }
  }
  return rankingUlic(adresy, wyniki, wykluczone, w.heksy, w.okolice ?? null, w.ile ?? 5).map(
    (p) => ({ ...p, adresDoPorownania: adresy[p.adresDoPorownania]?.i ?? -1 }),
  )
}

export interface OpcjeRankingu {
  podstawa: PodstawaHeksow
  indeks: IndeksKompaktu
  wyniki: WynikiHeksow
  wagi: Readonly<Record<string, number>>
  kierunki: Kierunki
  warstwa: string
  filtry: readonly TwardyFiltr[]
  /** Wczytanie kafla (w aplikacji `wczytajKafel` z bazą i skalami); musi respektować `signal`. */
  wczytaj: (wpis: KafelKompaktu, signal?: AbortSignal) => Promise<KafelGotowy>
  okolice?: PlikOkolic | null
  ile?: number
  kandydaci?: number
  /** 'ulice' (kandydaci z przybliżenia) albo 'heksy' (kafle pod najlepszymi heksami). */
  strategia?: 'ulice' | 'heksy'
  limitBajtow?: number
  /** Ile pierścieni sąsiadów heksów kandydata wchodzi do planu kafli (0 = tylko heksy ulicy). */
  promien?: number
  signal?: AbortSignal
}

export interface WynikDokladny {
  ulice: PozycjaUlicy[]
  kafli: number
  bajty: number
}

/**
 * Pełny ranking dwuetapowy bez etapu pośredniego (przybliżenie dostaje hook osobno, bo jest
 * synchroniczne). Przerwanie odrzuca obietnicę błędem przerwania.
 */
export async function rankingKompakt(o: OpcjeRankingu): Promise<WynikDokladny> {
  const poHeksach = o.strategia === 'heksy'
  const plan = poHeksach
    ? planKafliZHeksow(o.indeks, o.podstawa, o.wyniki, o.limitBajtow)
    : planKafli(
        o.indeks,
        przyblizenieUlic(o.podstawa, o.wyniki, o.kandydaci ?? KANDYDACI),
        o.limitBajtow,
        o.promien ?? 0,
      )
  const kafle = await Promise.all(plan.kafle.map((k) => o.wczytaj(k, o.signal)))
  o.signal?.throwIfAborted()
  const ulice = rankingZKafli({
    kafle,
    nazwy: poHeksach ? null : new Set(plan.pokryci.map((k) => k.nazwa)),
    wagi: o.wagi,
    kierunki: o.kierunki,
    warstwa: o.warstwa,
    filtry: o.filtry,
    heksy: o.wyniki.heksy,
    okolice: o.okolice ?? null,
    ile: o.ile ?? 5,
  })
  return { ulice, kafli: kafle.length, bajty: plan.bajty }
}
