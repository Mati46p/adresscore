// Wynik na poziomie heksów H3 z macierzy ocen policzonej w ETL (etl/kompakt.mjs). Czyste
// funkcje bez Reacta i sieci – testy na gołym `node --test`.
//
// Ocena heksu w macierzy = średnia ocen adresów z danymi dla kierunku „więcej = lepiej".
// - „mniej = lepiej": 100 − ocena. Dokładnie, bo per adres ocena(mniej) = 100 − ocena(więcej).
// - Wynik ważony heksu = średnia ważona ocen warstw heksu. Przeglądarka z pełnymi danymi
//   liczyłaby najpierw wynik adresu, potem średnią po heksie – przy pełnych danych to to samo
//   (średnia jest liniowa), różnica pojawia się tylko przy lukach w danych w obrębie heksu.
// - Obszar bez danych = wyłączony (#34, #148): heks dostaje kolor, gdy warstwy z danymi niosą
//   co najmniej PROG_UDZIALU łącznej wagi (średnia ważona udziału adresów z danymi – ta sama
//   „pewność" co na karcie adresu). Inaczej null – „brak danych dla wybranych warstw".
//   Wcześniej wystarczyła jedna ważona warstwa z luką; przy ~26 warstwach tylko-Kraków albo
//   tylko-obwarzanek gasło tak pół mapy albo cała (np. hałas poza Krakowem: 0% w Krakowie).
//   Warstwa bez pliku heksów liczy się jak brak danych, nie wyłącza heksu sama.
import type { WskaznikMeta } from '../kontrakty/index.ts'
import { ocenFiltr, type TwardyFiltr } from './filtry.ts'
import {
  type GrupyHeksow,
  type KierunekOceny,
  type Kierunki,
  kierunekEfektywny,
  ocenWartosc,
  type Skala,
  type Wagi,
  type WskaznikPrzygotowany,
  wagaUzytkownika,
} from './silnik.ts'

/** Heks jest wyłączony, gdy warstwy z danymi niosą mniej niż połowę łącznej wagi. */
export const PROG_UDZIALU = 0.5
export const BRAK = 255

const udzialWarstwy = new WeakMap<WskaznikPrzygotowany, WeakMap<GrupyHeksow, Float32Array>>()

/** Udział adresów heksu (0–1) z pomiarem z danej warstwy. */
function pokrycieWarstwy(w: WskaznikPrzygotowany, grupy: GrupyHeksow): Float32Array {
  let poGrupach = udzialWarstwy.get(w)
  if (!poGrupach) {
    poGrupach = new WeakMap()
    udzialWarstwy.set(w, poGrupach)
  }
  const gotowe = poGrupach.get(grupy)
  if (gotowe) return gotowe
  const razem = new Uint32Array(grupy.heksy.length)
  const zDanymi = new Uint32Array(grupy.heksy.length)
  for (let i = 0; i < grupy.indeksHeksu.length; i++) {
    const h = grupy.indeksHeksu[i] as number
    razem[h] = (razem[h] as number) + 1
    const v = w.wartosci[i]
    if (v !== null && v !== undefined && Number.isFinite(v)) zDanymi[h] = (zDanymi[h] as number) + 1
  }
  const pokrycie = new Float32Array(grupy.heksy.length)
  for (let h = 0; h < pokrycie.length; h++) {
    const r = razem[h] as number
    pokrycie[h] = r > 0 ? (zDanymi[h] as number) / r : 0
  }
  poGrupach.set(grupy, pokrycie)
  return pokrycie
}

/** Po ocenie adresów wyłącza heks, w którym warstwy z danymi niosą < PROG_UDZIALU wagi. */
export function zakryjBrakiHeksow(
  srednie: Float32Array,
  grupy: GrupyHeksow,
  wskazniki: readonly WskaznikPrzygotowany[],
  wagi: Wagi,
  kierunki: Kierunki,
  warstwa: string,
): Float32Array {
  const liczone = liczoneWarstwy(
    wskazniki.map((w) => w.meta),
    wagi,
    kierunki,
    warstwa,
  )
  if (liczone.length === 0) return srednie
  const mapa = new Map(wskazniki.map((w) => [w.meta.id, w]))
  const wynik = new Float32Array(srednie)
  const zDanymi = new Float64Array(wynik.length)
  let wszystkie = 0
  for (const { id, waga } of liczone) {
    wszystkie += waga
    const w = mapa.get(id)
    if (!w) continue
    const pokrycie = pokrycieWarstwy(w, grupy)
    for (let h = 0; h < wynik.length; h++)
      zDanymi[h] = (zDanymi[h] as number) + waga * (pokrycie[h] as number)
  }
  for (let h = 0; h < wynik.length; h++)
    if ((zDanymi[h] as number) < PROG_UDZIALU * wszystkie) wynik[h] = Number.NaN
  return wynik
}

export type Res = 10 | 9 | 8
export const POZIOMY: readonly Res[] = [10, 9, 8]

export interface PoziomHeksow {
  /** Posortowane id H3 tej rozdzielczości. */
  heksy: string[]
  /** Liczba adresów w heksie. */
  liczba: ArrayLike<number>
}

/** Plik heksy.bin: geometria heksów bez warstw. */
export interface PodstawaHeksow {
  skalaOceny: number
  skalaUdzialu: number
  poziomy: Record<Res, PoziomHeksow>
  /** Indeks kompaktu pierwszego adresu każdego heksu r10 (heks = ciągły zakres adresów). */
  od: Uint32Array
  /** Najczęstsza ulica (albo miejscowość) i dzielnica (albo gmina) heksu r10 – do rankingu. */
  ulica: string[]
  dzielnica: string[]
}

/** Plik warstwy/<id>.bin: wiersz macierzy jednej warstwy dla każdej rozdzielczości. */
export interface WarstwaHeksow {
  /** Średnia ocena 0–100 (×skalaOceny); BRAK = brak danych. */
  ocena: Record<Res, Uint8Array>
  /** Udział adresów z danymi (×skalaUdzialu). */
  udzial: Record<Res, Uint8Array>
}

/** Plik filtry/<id>.bin: min i max ocen heksów r10 jednej warstwy – do twardego filtra. */
export interface FiltrHeksow {
  udzial: Uint8Array
  min: Uint8Array
  max: Uint8Array
}

/** Ocena heksu dla kierunku z oceny „więcej = lepiej". */
export function ocenaWKierunku(wiecej: number, kierunek: KierunekOceny): number {
  if (kierunek === 'wiecej-lepiej') return wiecej
  if (kierunek === 'mniej-lepiej') return 100 - wiecej
  return 100 * (1 - 2 * Math.abs(wiecej / 100 - 0.5))
}

export interface WynikiHeksow {
  /** Wynik 0–100 per heks; NaN = brak danych albo heks wyłączony. */
  wartosc: Float32Array
  /** 0–1: udział wagi z danymi, jak pasek pewności karty. */
  pewnosc: Float32Array
}

export interface Liczona {
  id: string
  kierunek: KierunekOceny
  waga: number
}

/** Warstwy, które liczą się do wyniku (albo jedna aktywna warstwa mapy). */
export function liczoneWarstwy(
  meta: readonly WskaznikMeta[],
  wagi: Wagi,
  kierunki: Kierunki,
  warstwa: string,
): Liczona[] {
  const wynik: Liczona[] = []
  for (const m of meta) {
    if (warstwa !== 'wynik' && m.id !== warstwa) continue
    const waga = warstwa === 'wynik' ? wagaUzytkownika(wagi, m.id) : 1
    // Kontekst liczy się tylko z wagą > 0 (jak w wynikAdresu).
    if (waga <= 0) continue
    const kierunek = kierunekEfektywny(m, kierunki)
    if (kierunek) wynik.push({ id: m.id, kierunek, waga })
  }
  return wynik
}

/**
 * Wynik każdego heksu rozdzielczości `res`. `warstwy` daje wiersz warstwy albo null, gdy
 * warstwy nie ma (heks wyłączony – nie liczymy wyniku z części warstw).
 */
export function wynikiHeksow(
  podstawa: PodstawaHeksow,
  res: Res,
  liczone: readonly Liczona[],
  warstwy: (id: string) => WarstwaHeksow | null,
): WynikiHeksow {
  const { skalaOceny, skalaUdzialu } = podstawa
  const H = podstawa.poziomy[res].heksy.length
  const wartosc = new Float32Array(H).fill(Number.NaN)
  const pewnosc = new Float32Array(H)
  if (liczone.length === 0) return { wartosc, pewnosc }
  const wiersze = liczone.map((l) => {
    const w = warstwy(l.id)
    return { ...l, ocena: w?.ocena[res] ?? null, udzial: w?.udzial[res] ?? null }
  })
  for (let h = 0; h < H; h++) {
    let suma = 0
    let sumaWag = 0
    let wszystkie = 0
    let zDanymi = 0
    for (const { ocena, udzial, kierunek, waga } of wiersze) {
      wszystkie += waga
      // Warstwa bez pliku heksów = brak danych w każdym heksie (obniża pokrycie, nie wyłącza).
      if (!ocena || !udzial) continue
      const u = udzial[h] as number
      zDanymi += (waga * u) / skalaUdzialu
      const o = ocena[h] as number
      if (o === BRAK) continue
      suma += waga * ocenaWKierunku(o / skalaOceny, kierunek)
      sumaWag += waga
    }
    pewnosc[h] = wszystkie > 0 ? zDanymi / wszystkie : 0
    if (sumaWag > 0 && (pewnosc[h] as number) >= PROG_UDZIALU) wartosc[h] = suma / sumaWag
  }
  return { wartosc, pewnosc }
}

export interface WykluczeniaHeksow {
  /** 1 = heks wykluczony filtrem (wszystkie jego adresy na pewno go naruszają). */
  wykluczony: Uint8Array
  liczbaWykluczonych: number
  liczbaNiewiadomych: number
  liczbaAdresow: number
}

/**
 * Twarde filtry na heksach. Adres narusza filtr „max p", gdy wartość > p; ocena rośnie z
 * wartością, więc wszystkie adresy heksu go naruszają, gdy min oceny heksu > ocena(p) i każdy
 * adres ma dane. Analogicznie „min" (max oceny < ocena(p)) i „równe zero" (ocena(0) poza
 * [min, max]). Min i max ETL zaokrągla na zewnątrz, a wartość spoza skali przycina, więc
 * heks wypada tylko wtedy, gdy na pewno – przy wątpliwości zostaje na mapie.
 * Przybliżenie: dwa filtry, z których każdy wyklucza tylko część adresów heksu, razem nie
 * wykluczą heksu (bez danych adresowych nie wiemy, czy to te same adresy). Średnia heksu
 * nie pomija wykluczonych adresów – robi to dopiero karta i ranking adresów w JSON-ie.
 */
export function wykluczeniaHeksow(
  liczba: ArrayLike<number>,
  skalaUdzialu: number,
  filtry: readonly TwardyFiltr[],
  dane: (id: string) => { filtr: FiltrHeksow; skala: Skala } | null,
): WykluczeniaHeksow {
  const H = liczba.length
  const wykluczony = new Uint8Array(H)
  const niewiadomy = new Float32Array(H)
  for (const filtr of filtry) {
    // Filtr warstwy, której nie ma, nie wyklucza nikogo (jak policzWykluczenia).
    const d = dane(filtr.id)
    if (!d || d.skala.zrodlo === 'brak') continue
    const f = d.filtr
    const prog = filtr.warunek === 'rowne-zero' ? 0 : filtr.prog
    const c = ocenWartosc(prog, d.skala, 'wiecej-lepiej')
    if (c === null) continue
    for (let p = 0; p < H; p++) {
      const u = (f.udzial[p] as number) / skalaUdzialu
      niewiadomy[p] = Math.max(niewiadomy[p] as number, 1 - u)
      if (u < 1 || f.min[p] === BRAK) continue
      const mn = f.min[p] as number
      const mx = f.max[p] as number
      const wszystkieNaruszaja =
        filtr.warunek === 'max' ? mn > c : filtr.warunek === 'min' ? mx < c : c < mn || c > mx
      if (wszystkieNaruszaja) wykluczony[p] = 1
    }
  }
  let liczbaWykluczonych = 0
  let liczbaNiewiadomych = 0
  let liczbaAdresow = 0
  for (let h = 0; h < H; h++) {
    const l = liczba[h] as number
    liczbaAdresow += l
    if (wykluczony[h]) liczbaWykluczonych += l
    else liczbaNiewiadomych += Math.round(l * (niewiadomy[h] as number))
  }
  return { wykluczony, liczbaWykluczonych, liczbaNiewiadomych, liczbaAdresow }
}

/** Indeksy najlepszych heksów (bez wykluczonych i wyłączonych), malejąco. */
export function najlepszeHeksy(
  wartosc: Float32Array,
  wykluczony: Uint8Array | null,
  liczba: ArrayLike<number>,
  ile: number,
): number[] {
  const lepszy = (a: number, b: number) =>
    (wartosc[a] as number) - (wartosc[b] as number) ||
    (liczba[a] as number) - (liczba[b] as number) ||
    b - a
  const wynik: number[] = []
  for (let h = 0; h < wartosc.length; h++) {
    const v = wartosc[h] as number
    if (v !== v || wykluczony?.[h]) continue
    if (wynik.length < ile || lepszy(h, wynik[wynik.length - 1] as number) > 0) {
      wynik.push(h)
      wynik.sort((a, b) => lepszy(b, a))
      if (wynik.length > ile) wynik.pop()
    }
  }
  return wynik
}

/** Heks r10, w którym leży adres o indeksie kompaktu i (wyszukiwanie binarne po `od`). */
export function heksAdresu(od: Uint32Array, i: number): number {
  let lo = 0
  let hi = od.length - 1
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1
    if ((od[m] as number) <= i) lo = m
    else hi = m - 1
  }
  return lo
}

/** Ocena filtra dla jednego adresu z surowych wartości kafla (jak w filtry.ts). */
export function wykluczenieAdresu(
  wartosc: (id: string) => number | null,
  filtry: readonly TwardyFiltr[],
): 'wykluczony' | 'nie-wiemy' | null {
  let niewiadomy = false
  for (const f of filtry) {
    const o = ocenFiltr(wartosc(f.id), f)
    if (o === 'narusza') return 'wykluczony'
    if (o === 'nie-wiemy') niewiadomy = true
  }
  return niewiadomy ? 'nie-wiemy' : null
}
