// Adresy na żądanie z kafli kompaktu (Etap B, paczka B3, #247). Zamiast 176 tys. adresów z
// adresy.json ekran Szukaj pobiera jeden kafel (kilkadziesiąt adresów z wartościami wszystkich
// warstw) tam, gdzie użytkownik kliknął. Kafel daje `Adres[]` i `WskaznikPrzygotowany[]` tylko dla
// swoich adresów, więc `wynikAdresu` z silnika liczy kartę tym samym kodem co dla pełnych danych.
// UWAGA na indeksy: `wynikAdresu(j, kafel.wskazniki, …)` bierze pozycję W KAFLU (`j`), a nie `Adres.i`
// (pozycję w adresy.json); do przeliczenia służy `pozycjaWKaflu`. Moduł bez twardego
// `import.meta.env`, żeby działał na gołym `node --test`.
import { cellToParent, latLngToCell } from 'h3-js'
import { useSyncExternalStore } from 'react'
import { adresWKliknietymHeksie } from '../karta/wyszukiwarka/heks.ts'
import type { Adres, WskaznikMeta } from '../kontrakty/index.ts'
import { miasto, type SlugMiasta } from '../kontrakty/miasta.ts'
import {
  type IndeksKompaktu,
  type KafelKompaktu,
  kolejnoscId,
  odczytajKafel,
  type PlikKafla,
  rozpakuj,
} from './kompakt.ts'
import { naFloat64, type Skala, type WskaznikPrzygotowany } from './silnik.ts'

/** Tyle kafli trzymamy naraz (kafel to ~70 KB gzip, kilkaset KB po rozpakowaniu). */
export const KAFLI_W_PAMIECI = 40

export interface KafelGotowy {
  wpis: KafelKompaktu
  /** Adresy kafla w kolejności kafla; `i` = pozycja w adresy.json. */
  adresy: Adres[]
  /** Jedna pozycja na warstwę, wartości tylko adresów kafla (NaN = brak, nigdy 0). */
  wskazniki: WskaznikPrzygotowany[]
  /** Pozycja w adresy.json → pozycja w kaflu. */
  pozycje: ReadonlyMap<number, number>
}

/** Skale i meta warstw w kolejności `indeks.wskazniki` (to samo, co ścieżka pełnych danych). */
export interface SkaleKafli {
  skale: Readonly<Record<string, Skala>>
  meta: Readonly<Record<string, WskaznikMeta>>
  /**
   * Słowniki etykiet warstw (kod z kafla → tekst). Kafel niesie same kody, a słownik leży dziś tylko
   * w `wskazniki/<id>.json` (luka ETL); bez niego etykiety zostaną kodami.
   */
  slowniki?: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** Skale kafli z indeksu i pliku `skale.<skrót>.json` (ten sam, który czyta pełna ścieżka). */
export function skaleKafli(indeks: IndeksKompaktu, skale: Record<string, Skala>): SkaleKafli {
  const meta: Record<string, WskaznikMeta> = {}
  for (const [id, w] of Object.entries(indeks.wskazniki)) meta[id] = w.meta
  return { skale, meta }
}

export interface OpcjeKafla {
  signal?: AbortSignal
  /** Zapas dla testów; domyślnie `fetch`. */
  pobierz?: (url: string) => Promise<ArrayBuffer | Uint8Array>
}

async function domyslnePobranie(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Kafel ${url}: HTTP ${r.status}`)
  return r.arrayBuffer()
}

// ── Pamięć: LRU + deduplikacja ───────────────────────────────────────────────────────────

const gotowe = new Map<string, KafelGotowy>() // kolejność wstawiania = kolejność użycia
const wLocie = new Map<string, Promise<KafelGotowy>>()
const sluchacze = new Set<() => void>()
let wersja = 0
// Pozycja w adresy.json → kafel, tylko dla kafli będących w pamięci.
const poI = new Map<number, KafelGotowy>()

function powiadom() {
  wersja++
  for (const s of sluchacze) s()
}

function wstaw(klucz: string, kafel: KafelGotowy) {
  gotowe.set(klucz, kafel)
  for (const i of kafel.pozycje.keys()) poI.set(i, kafel)
  while (gotowe.size > KAFLI_W_PAMIECI) {
    const [stary, k] = gotowe.entries().next().value as [string, KafelGotowy]
    gotowe.delete(stary)
    for (const i of k.pozycje.keys()) if (poI.get(i) === k) poI.delete(i)
  }
  powiadom()
}

/** Czyści pamięć kafli (zmiana miasta, testy). */
export function wyczyscKafle() {
  gotowe.clear()
  poI.clear()
  wLocie.clear()
  powiadom()
}

/** Kafel z pamięci bez pobierania (i odświeżenie jego miejsca w LRU). */
export function kafelZPamieci(baza: string, wpis: KafelKompaktu): KafelGotowy | null {
  const klucz = `${baza}/${wpis.plik}`
  const k = gotowe.get(klucz)
  if (!k) return null
  gotowe.delete(klucz)
  gotowe.set(klucz, k)
  return k
}

/** Rozwija plik kafla w obiekty. Czysta funkcja – testowana bez sieci. */
export function zbudujKafel(wpis: KafelKompaktu, plik: PlikKafla, skale: SkaleKafli): KafelGotowy {
  const k = plik.kolumny
  const n = k.id.length
  if (!k.i) throw new Error('Kafel bez kolumny i (stary kompakt)')
  const adresy: Adres[] = new Array(n)
  const pozycje = new Map<number, number>()
  for (let j = 0; j < n; j++) {
    const i = k.i[j] as number
    adresy[j] = {
      i,
      id: k.id[j] as string,
      miejscowosc: k.miejscowosc[j] as string,
      ulica: k.ulica[j] ?? null,
      nr: k.nr[j] as string,
      kod: k.kod[j] ?? null,
      dzielnica: k.dzielnica[j] ?? null,
      gmina: k.gmina[j] as string,
      teryt: k.teryt[j] as string,
      lon: k.lon[j] as number,
      lat: k.lat[j] as number,
      h3: k.h3[j] as string,
    }
    pozycje.set(i, j)
  }
  const wskazniki: WskaznikPrzygotowany[] = []
  for (const [id, meta] of Object.entries(skale.meta)) {
    const skala = skale.skale[id]
    const wartosci = plik.wartosci[id]
    if (!skala || !wartosci) continue
    const etykiety = plik.etykiety[id]
    const slownik = skale.slowniki?.[id]
    wskazniki.push({
      meta,
      wartosci: naFloat64(wartosci),
      ...(etykiety ? { etykiety } : {}),
      ...(slownik ? { slownikEtykiet: slownik } : {}),
      skala,
    })
  }
  return { wpis, adresy, wskazniki, pozycje }
}

/**
 * Pobiera i rozpakowuje kafel (`<baza>/kompakt/<plik>`). Równoległe żądania tego samego pliku dzielą
 * jedno pobranie; `signal` odcina tylko wołającego, nie pobranie, z którego korzystają inni.
 */
export function wczytajKafel(
  baza: string,
  wpis: KafelKompaktu,
  skale: SkaleKafli,
  opcje: OpcjeKafla = {},
): Promise<KafelGotowy> {
  const { signal } = opcje
  const klucz = `${baza}/${wpis.plik}`
  const zPamieci = kafelZPamieci(baza, wpis)
  let obietnica: Promise<KafelGotowy>
  if (zPamieci) obietnica = Promise.resolve(zPamieci)
  else {
    const trwa = wLocie.get(klucz)
    if (trwa) obietnica = trwa
    else {
      const pobierz = opcje.pobierz ?? domyslnePobranie
      obietnica = (async () => {
        const bufor = await pobierz(`${baza}/kompakt/${wpis.plik}`)
        const kafel = zbudujKafel(wpis, await odczytajKafel(bufor), skale)
        wstaw(klucz, kafel)
        return kafel
      })()
      wLocie.set(klucz, obietnica)
      const sprzatnij = () => {
        if (wLocie.get(klucz) === obietnica) wLocie.delete(klucz)
      }
      obietnica.then(sprzatnij, sprzatnij)
    }
  }
  if (!signal) return obietnica
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<KafelGotowy>((ok, blad) => {
    const przerwij = () => blad(signal.reason)
    signal.addEventListener('abort', przerwij, { once: true })
    obietnica.then(ok, blad).finally(() => signal.removeEventListener('abort', przerwij))
  })
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

/** Kafel zawierający punkt: dziecko r8, a gdy go nie ma (r7 nie był dzielony), rodzic r7. */
export function kafelPunktu(
  indeks: IndeksKompaktu,
  lon: number,
  lat: number,
): KafelKompaktu | null {
  const m = mapaKafli(indeks)
  // Przez r10, nie bezpośrednio r8: adresy są przypisane do kafla po rodzicu swojego heksu r10, a
  // r8 liczone wprost z punktu przy granicy komórek bywa sąsiadem (hierarchia H3 nie jest zagnieżdżona dokładnie).
  const h8 = cellToParent(latLngToCell(lat, lon, 10), 8)
  const k8 = m.get(h8)
  if (k8 && (k8.res ?? 7) === 8) return k8
  const k7 = m.get(cellToParent(h8, 7))
  return k7 && (k7.res ?? 7) === 7 ? k7 : null
}

/**
 * Kafel adresu o pozycji `i` w adresy.json. Kompakt sam tego nie mówi: indeksy kompaktu idą po
 * heksach, a `i` jest nieciągłe w kaflu. Wymaga mapy `i` → indeks kompaktu (`kompaktuAdresu`), której
 * ETL nie wydaje; bez niej zwraca kafel tylko dla adresu już wczytanego.
 */
export function kafelAdresu(
  indeks: IndeksKompaktu,
  i: number,
  kompaktuAdresu?: ArrayLike<number>,
): KafelKompaktu | null {
  const wczytany = poI.get(i)
  if (wczytany) return wczytany.wpis
  const c = kompaktuAdresu?.[i]
  if (c === undefined || c < 0) return null
  // Kafle są posortowane po `od`: wyszukiwanie połówkowe.
  let lo = 0
  let hi = indeks.kafle.length - 1
  while (lo <= hi) {
    const sr = (lo + hi) >> 1
    const k = indeks.kafle[sr] as KafelKompaktu
    if (c < k.od) hi = sr - 1
    else if (c >= k.od + k.n) lo = sr + 1
    else return k
  }
  return null
}

const mapyAdresow = new WeakMap<IndeksKompaktu, Promise<Int32Array | null>>()

/**
 * Leniwie ładuje `id.bin` i odwraca `kolejnosc` (indeks kompaktu → pozycja w adresy.json) do tablicy
 * `i` → indeks kompaktu, którą przyjmuje `kafelAdresu`. Stary plik bez `kolejnosc` daje null.
 */
export function wczytajMapeAdresow(
  baza: string,
  indeks: IndeksKompaktu,
  pobierz: (url: string) => Promise<ArrayBuffer | Uint8Array> = domyslnePobranie,
): Promise<Int32Array | null> {
  let p = mapyAdresow.get(indeks)
  if (!p) {
    p = (async () => {
      const r = await rozpakuj(await pobierz(`${baza}/kompakt/${indeks.id.plik}`))
      const kolejnosc = kolejnoscId(r)
      if (!kolejnosc) return null
      const odwrotna = new Int32Array(kolejnosc.length).fill(-1)
      for (let c = 0; c < kolejnosc.length; c++) odwrotna[kolejnosc[c] as number] = c
      return odwrotna
    })()
    p.catch(() => mapyAdresow.delete(indeks))
    mapyAdresow.set(indeks, p)
  }
  return p
}

/** Pozycja adresu `i` (z adresy.json) w kaflu albo -1; to ją przyjmuje `wynikAdresu`. */
export function pozycjaWKaflu(kafel: KafelGotowy, i: number): number {
  return kafel.pozycje.get(i) ?? -1
}

/** Adres w klikniętym heksie r10: ta sama logika co przy pełnych danych, na adresach kafla. */
export function adresZPunktu(kafel: KafelGotowy, lon: number, lat: number) {
  return adresWKliknietymHeksie(kafel.adresy, lon, lat)
}

// ── Hooki ────────────────────────────────────────────────────────────────────────────────

function subskrybuj(cb: () => void) {
  sluchacze.add(cb)
  return () => {
    sluchacze.delete(cb)
  }
}
const migawka = () => wersja

/** Katalog danych miasta; `import.meta.env` bywa nieobecne pod `node --test`. */
function bazaMiasta(slug: SlugMiasta): string {
  const m = miasto(slug)
  const rdzen = `${import.meta.env?.BASE_URL ?? '/'}dane`
  return m.katalog ? `${rdzen}/${m.katalog}` : rdzen
}

/**
 * Kafel z pamięci i, gdy go brak, start pobierania (idempotentny dzięki deduplikacji). Zwraca null
 * do czasu wczytania; błędy łyka (karta zostaje bez danych, a ponowne wyrenderowanie ponawia pobranie).
 */
export function useKafel(
  slug: SlugMiasta,
  wpis: KafelKompaktu | null,
  skale: SkaleKafli | null,
): KafelGotowy | null {
  useSyncExternalStore(subskrybuj, migawka, migawka)
  if (!wpis || !skale) return null
  const baza = bazaMiasta(slug)
  const k = kafelZPamieci(baza, wpis)
  if (!k) wczytajKafel(baza, wpis, skale).catch(() => {})
  return k
}

/** Adres o pozycji `i`, jeśli jego kafel jest już w pamięci; inaczej null. */
export function useAdresKompakt(i: number | null): Adres | null {
  useSyncExternalStore(subskrybuj, migawka, migawka)
  if (i === null) return null
  const k = poI.get(i)
  return k ? (k.adresy[k.pozycje.get(i) as number] ?? null) : null
}
