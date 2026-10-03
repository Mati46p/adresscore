// Silnik wyniku: czyste funkcje bez DOM i bez Reacta, żeby testy szły na gołym `node --test`.
// Dlatego z kontraktu bierzemy tylko typy (`import type` znika przy type stripping) –
// moduł src/kontrakty czyta import.meta.env, którego w Node nie ma.
import type { KategoriaId, PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'

/** Kierunek, który może nadpisać użytkownik (makieta: ↑ ↓ ≈). */
export type KierunekOceny = 'mniej-lepiej' | 'wiecej-lepiej' | 'optimum'

/** Waga użytkownika per id wskaźnika, 0–4 jak w makiecie. Brak klucza = 0. */
export type Wagi = Readonly<Record<string, number>>
export type Kierunki = Readonly<Record<string, KierunekOceny>>

export const WAGA_MAX = 4

// Kopia kluczy KATEGORIE w stałej kolejności karty. Nie importujemy wartości z kontraktu
// (patrz nagłówek); kompilator pilnuje, żeby lista pokrywała cały typ KategoriaId.
export const KOLEJNOSC_KATEGORII = [
  'codziennosc',
  'transport',
  'spokoj',
  'przyszlosc',
  'bezpieczenstwo',
  'kontekst',
] as const satisfies readonly KategoriaId[]
type BrakujaceKategorie = Exclude<KategoriaId, (typeof KOLEJNOSC_KATEGORII)[number]>
export const KATEGORIE_KOMPLETNE: [BrakujaceKategorie] extends [never] ? true : never = true

/** Dolne progi liter. Wynik poniżej ostatniego progu = G. */
export const PROGI_LITER = [
  ['A', 85],
  ['B', 70],
  ['C', 55],
  ['D', 40],
  ['E', 25],
  ['F', 10],
] as const
export type Litera = (typeof PROGI_LITER)[number][0] | 'G'

export function literaZWyniku(wynik: number | null): Litera | null {
  if (wynik === null || Number.isNaN(wynik)) return null
  for (const [litera, prog] of PROGI_LITER) if (wynik >= prog) return litera
  return 'G'
}

// ── Skala ────────────────────────────────────────────────────────────────────────────────
//
// Podejście: skala odcinkowo liniowa na przedziale [od, do].
// - Przedział to `meta.zakres`. Bez zakresu bierzemy 5. i 95. percentyl danych, żeby jeden
//   odstający adres nie spłaszczył skali reszcie miasta (stąd „percentyle" w zadaniu).
// - Norma leżąca wewnątrz przedziału to punkt 50: przekroczenie przepisu zawsze daje ocenę
//   poniżej połowy, niezależnie od tego, jak szeroki jest zakres. Norma na brzegu przedziału
//   (np. WHO PM2,5 = 5 przy zakresie 5–30) nic nie wnosi do skali – zostaje skala liniowa.
// - Wartości poza przedziałem przycinamy do 0 albo 100.
// - `optimum` (≈ w makiecie): 100 w środku przedziału, 0 na obu brzegach.
// - `neutralny` bez kierunku od użytkownika nie wchodzi do wyniku (ocena null).

export interface Skala {
  od: number
  do: number
  /** Punkt 50 na skali albo null, gdy norma nie leży wewnątrz przedziału. */
  norma: number | null
  zrodlo: 'zakres' | 'percentyle' | 'brak'
}

export function percentyl(posortowane: ArrayLike<number>, p: number): number {
  const n = posortowane.length
  if (n === 0) return Number.NaN
  const poz = (n - 1) * p
  const d = Math.floor(poz)
  const g = Math.min(d + 1, n - 1)
  const a = posortowane[d] as number
  const b = posortowane[g] as number
  return a + (b - a) * (poz - d)
}

export function zbudujSkale(meta: WskaznikMeta, wartosci: readonly (number | null)[]): Skala {
  let od: number
  let doo: number
  let zrodlo: Skala['zrodlo']
  if (meta.zakres) {
    ;[od, doo] = meta.zakres
    zrodlo = 'zakres'
  } else {
    const liczby = Float64Array.from(wartosci.filter((w): w is number => w !== null)).sort()
    od = percentyl(liczby, 0.05)
    doo = percentyl(liczby, 0.95)
    zrodlo = 'percentyle'
  }
  if (!(doo > od)) return { od, do: doo, norma: null, zrodlo: 'brak' }
  const n = meta.norma?.wartosc
  const norma = n !== undefined && n > od && n < doo ? n : null
  return { od, do: doo, norma, zrodlo }
}

/** Kierunek, który faktycznie liczy ocenę; null = wskaźnik nie wchodzi do wyniku. */
export function kierunekEfektywny(meta: WskaznikMeta, kierunki?: Kierunki): KierunekOceny | null {
  if (meta.kategoria === 'kontekst') return null
  const k = kierunki?.[meta.id] ?? meta.kierunek
  return k === 'neutralny' ? null : k
}

/** Ocena 0–100, gdzie 100 = najlepiej. Brak danych albo brak kierunku → null, nigdy 0. */
export function ocenWartosc(
  wartosc: number | null | undefined,
  skala: Skala,
  kierunek: KierunekOceny | null,
): number | null {
  if (wartosc === null || wartosc === undefined || Number.isNaN(wartosc) || kierunek === null) {
    return null
  }
  if (skala.zrodlo === 'brak') return null
  // u = 0 na początku przedziału, 1 na końcu; norma (jeśli jest) ląduje dokładnie na 0,5.
  const { od, do: doo, norma } = skala
  const x = Math.min(Math.max(wartosc, od), doo)
  let u: number
  if (norma === null) u = (x - od) / (doo - od)
  else if (x <= norma) u = (0.5 * (x - od)) / (norma - od)
  else u = 0.5 + (0.5 * (x - norma)) / (doo - norma)
  if (kierunek === 'mniej-lepiej') return 100 * (1 - u)
  if (kierunek === 'wiecej-lepiej') return 100 * u
  return 100 * (1 - 2 * Math.abs(u - 0.5))
}

// ── Wskaźnik przygotowany ────────────────────────────────────────────────────────────────

export interface WskaznikPrzygotowany {
  meta: WskaznikMeta
  wartosci: readonly (number | null)[]
  etykiety?: readonly (string | null)[]
  skala: Skala
  /** Powód, gdy plik warstwy się nie wczytał; wtedy każdy adres ma brak danych. */
  niedostepny?: string
}

export function przygotujWskaznik(plik: PlikWskaznika): WskaznikPrzygotowany {
  return {
    meta: plik.meta,
    wartosci: plik.wartosci,
    etykiety: plik.etykiety,
    skala: zbudujSkale(plik.meta, plik.wartosci),
  }
}

/**
 * Warstwa z manifestu, której plik nie doszedł (błąd pobrania, inna wersja adresów).
 * Zostaje w obliczeniach jako brak danych pod każdym adresem: nie zmienia wyniku, ale jej
 * waga liczy się do mianownika pewności – inaczej awaria pobrania podnosiłaby pewność.
 */
export function wskaznikNiedostepny(
  meta: WskaznikMeta,
  liczbaAdresow: number,
  powod: string,
): WskaznikPrzygotowany {
  const wartosci: (number | null)[] = new Array(liczbaAdresow).fill(null)
  return { meta, wartosci, skala: zbudujSkale(meta, wartosci), niedostepny: powod }
}

// Oceny zależą tylko od kierunku, nie od wag – liczymy je raz na kierunek. Zmiana wag
// na żywo to potem tylko suma ważona po gotowych tablicach.
const pamiecOcen = new WeakMap<WskaznikPrzygotowany, Map<KierunekOceny, Float32Array>>()

/** Oceny 0–100 dla wszystkich adresów (NaN = brak danych). Wynik z pamięci podręcznej. */
export function ocenyWskaznika(w: WskaznikPrzygotowany, kierunek: KierunekOceny): Float32Array {
  let poKierunku = pamiecOcen.get(w)
  if (!poKierunku) {
    poKierunku = new Map()
    pamiecOcen.set(w, poKierunku)
  }
  const gotowe = poKierunku.get(kierunek)
  if (gotowe) return gotowe
  const oceny = new Float32Array(w.wartosci.length)
  for (let i = 0; i < oceny.length; i++) {
    oceny[i] = ocenWartosc(w.wartosci[i], w.skala, kierunek) ?? Number.NaN
  }
  poKierunku.set(kierunek, oceny)
  return oceny
}

// ── Wynik adresu ─────────────────────────────────────────────────────────────────────────

/** Waga 0–4 przycięta i zaokrąglona; nieznane id = 0. */
export function wagaUzytkownika(wagi: Wagi, id: string): number {
  const w = wagi[id] ?? 0
  return Number.isFinite(w) ? Math.min(Math.max(Math.round(w), 0), WAGA_MAX) : 0
}

export interface RozbicieWarstwy {
  id: string
  meta: WskaznikMeta
  kategoria: KategoriaId
  /** Surowy pomiar z pliku (dB, m, µg/m³…); null = brak danych. */
  wartosc: number | null
  etykieta: string | null
  /** 0–100 albo null (brak danych, kontekst albo kierunek neutralny). */
  ocena: number | null
  kierunek: KierunekOceny | null
  /** Waga z suwaka, 0–4. */
  wagaUzytkownika: number
  /** Udział w wyniku po normalizacji; 0, gdy warstwa nie ma danych pod tym adresem. */
  waga: number
  /** Punkty wniesione do wyniku = waga × ocena; suma wkładów = wynik. */
  wklad: number | null
  /** Czy warstwa w ogóle liczy się do wyniku (ma kierunek i wagę > 0). */
  liczona: boolean
  /** Powód, gdy plik warstwy się nie wczytał (patrz `wskaznikNiedostepny`). */
  niedostepny?: string
}

export interface RozbicieKategorii {
  kategoria: KategoriaId
  /** Średnia ważona ocen warstw z danymi; null = szara kategoria. */
  ocena: number | null
  waga: number
  wklad: number | null
  /** Udział wagi warstw z danymi w wadze wszystkich liczonych warstw kategorii. */
  pewnosc: number
  warstwy: RozbicieWarstwy[]
}

export interface WynikAdresu {
  i: number
  wynik: number | null
  litera: Litera | null
  /** 0–1: udział wagi warstw z danymi w wadze wszystkich liczonych warstw. */
  pewnosc: number
  kategorie: RozbicieKategorii[]
  warstwy: RozbicieWarstwy[]
}

export function wynikAdresu(
  i: number,
  wskazniki: readonly WskaznikPrzygotowany[],
  wagi: Wagi,
  kierunki?: Kierunki,
): WynikAdresu {
  let sumaWszystkich = 0
  let sumaZDanymi = 0
  const surowe = wskazniki.map((w) => {
    const kierunek = kierunekEfektywny(w.meta, kierunki)
    const wartosc = w.wartosci[i] ?? null
    const ocena = kierunek ? ocenyWskaznika(w, kierunek)[i] : Number.NaN
    const wu = wagaUzytkownika(wagi, w.meta.id)
    const liczona = kierunek !== null && wu > 0
    const maDane = ocena !== undefined && !Number.isNaN(ocena)
    if (liczona) {
      sumaWszystkich += wu
      if (maDane) sumaZDanymi += wu
    }
    return { w, kierunek, wartosc, ocena: maDane ? (ocena as number) : null, wu, liczona }
  })

  const warstwy: RozbicieWarstwy[] = surowe.map((s) => {
    const waga = s.liczona && s.ocena !== null && sumaZDanymi > 0 ? s.wu / sumaZDanymi : 0
    return {
      id: s.w.meta.id,
      meta: s.w.meta,
      kategoria: s.w.meta.kategoria,
      wartosc: s.wartosc,
      etykieta: s.w.etykiety?.[i] ?? null,
      ocena: s.ocena,
      kierunek: s.kierunek,
      wagaUzytkownika: s.wu,
      waga,
      wklad: s.ocena !== null && waga > 0 ? waga * s.ocena : null,
      liczona: s.liczona,
      ...(s.w.niedostepny === undefined ? {} : { niedostepny: s.w.niedostepny }),
    }
  })

  const wynik = sumaZDanymi > 0 ? warstwy.reduce((suma, w) => suma + (w.wklad ?? 0), 0) : null

  const kategorie = KOLEJNOSC_KATEGORII.map((kategoria): RozbicieKategorii => {
    const swoje = warstwy.filter((w) => w.kategoria === kategoria)
    const liczone = swoje.filter((w) => w.liczona)
    const wszystkie = liczone.reduce((s, w) => s + w.wagaUzytkownika, 0)
    const zDanymi = liczone.filter((w) => w.ocena !== null)
    const wagaDanych = zDanymi.reduce((s, w) => s + w.wagaUzytkownika, 0)
    const ocena =
      wagaDanych > 0
        ? zDanymi.reduce((s, w) => s + w.wagaUzytkownika * (w.ocena as number), 0) / wagaDanych
        : null
    const waga = zDanymi.reduce((s, w) => s + w.waga, 0)
    return {
      kategoria,
      ocena,
      waga,
      wklad: ocena === null ? null : zDanymi.reduce((s, w) => s + (w.wklad ?? 0), 0),
      pewnosc: wszystkie > 0 ? wagaDanych / wszystkie : 0,
      warstwy: swoje,
    }
  }).filter((k) => k.warstwy.length > 0)

  return {
    i,
    wynik,
    litera: literaZWyniku(wynik),
    pewnosc: sumaWszystkich > 0 ? sumaZDanymi / sumaWszystkich : 0,
    kategorie,
    warstwy,
  }
}

// ── Szybka ścieżka dla mapy ──────────────────────────────────────────────────────────────

/** Wyniki 0–100 dla wszystkich adresów; NaN = brak danych (szary), nigdy 0. */
export function wynikiWszystkich(
  wskazniki: readonly WskaznikPrzygotowany[],
  wagi: Wagi,
  kierunki: Kierunki | undefined,
  liczbaAdresow: number,
): Float32Array {
  const warstwy: { oceny: Float32Array; waga: number }[] = []
  for (const w of wskazniki) {
    const kierunek = kierunekEfektywny(w.meta, kierunki)
    const waga = wagaUzytkownika(wagi, w.meta.id)
    if (kierunek && waga > 0) warstwy.push({ oceny: ocenyWskaznika(w, kierunek), waga })
  }
  const wynik = new Float32Array(liczbaAdresow).fill(Number.NaN)
  if (warstwy.length === 0) return wynik
  const suma = new Float64Array(liczbaAdresow)
  const sumaWag = new Float64Array(liczbaAdresow)
  for (const { oceny, waga } of warstwy) {
    const n = Math.min(oceny.length, liczbaAdresow)
    for (let i = 0; i < n; i++) {
      const o = oceny[i] as number
      // NaN !== NaN – najtańszy test braku danych w gorącej pętli.
      if (o === o) {
        suma[i] = (suma[i] as number) + waga * o
        sumaWag[i] = (sumaWag[i] as number) + waga
      }
    }
  }
  for (let i = 0; i < liczbaAdresow; i++) {
    const sw = sumaWag[i] as number
    if (sw > 0) wynik[i] = (suma[i] as number) / sw
  }
  return wynik
}

/** Oceny jednej warstwy dla mapy (aktywna warstwa ≠ „wynik"). */
export function ocenyWarstwy(w: WskaznikPrzygotowany, kierunki?: Kierunki): Float32Array | null {
  const kierunek = kierunekEfektywny(w.meta, kierunki)
  return kierunek ? ocenyWskaznika(w, kierunek) : null
}

export interface GrupyHeksow {
  /** Unikalne komórki H3 w kolejności pierwszego wystąpienia. */
  heksy: string[]
  /** Dla i-tego adresu indeks jego heksu w `heksy`. */
  indeksHeksu: Uint32Array
}

/** Grupowanie raz po wczytaniu adresów – potem średnie liczą się po indeksach. */
export function grupujHeksy(h3: readonly string[]): GrupyHeksow {
  const pozycja = new Map<string, number>()
  const heksy: string[] = []
  const indeksHeksu = new Uint32Array(h3.length)
  for (let i = 0; i < h3.length; i++) {
    const h = h3[i] as string
    let p = pozycja.get(h)
    if (p === undefined) {
      p = heksy.length
      pozycja.set(h, p)
      heksy.push(h)
    }
    indeksHeksu[i] = p
  }
  return { heksy, indeksHeksu }
}

/** Średnia wyników adresów w heksie; heks bez żadnego wyniku = NaN, nie 0. */
export function srednieHeksow(wartosci: Float32Array, grupy: GrupyHeksow): Float32Array {
  const suma = new Float64Array(grupy.heksy.length)
  const liczba = new Uint32Array(grupy.heksy.length)
  const n = Math.min(wartosci.length, grupy.indeksHeksu.length)
  for (let i = 0; i < n; i++) {
    const v = wartosci[i] as number
    if (v === v) {
      const h = grupy.indeksHeksu[i] as number
      suma[h] = (suma[h] as number) + v
      liczba[h] = (liczba[h] as number) + 1
    }
  }
  const wynik = new Float32Array(grupy.heksy.length)
  for (let h = 0; h < wynik.length; h++) {
    const l = liczba[h] as number
    wynik[h] = l > 0 ? (suma[h] as number) / l : Number.NaN
  }
  return wynik
}

/** Format dla MapaKrakowa (#13): h3 → wynik 0–100, null = brak danych (szary). */
export function mapaHeksow(srednie: Float32Array, grupy: GrupyHeksow): Map<string, number | null> {
  const mapa = new Map<string, number | null>()
  for (let h = 0; h < grupy.heksy.length; h++) {
    const v = srednie[h] as number
    mapa.set(grupy.heksy[h] as string, v === v ? v : null)
  }
  return mapa
}

/** Paleta heksów z makiety (KrakowMap): od „słabo" do „idealnie dla Ciebie". */
export const PALETA_WYNIKU = ['#E9F2EC', '#BFDCCB', '#8BC0A3', '#4E9A78', '#1F5C46'] as const
/** Kolor braku danych – szara kategoria. */
export const KOLOR_BRAKU = '#A9AFB4'
