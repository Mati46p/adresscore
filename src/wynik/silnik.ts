// Silnik wyniku: czyste funkcje bez DOM i bez Reacta, żeby testy szły na gołym `node --test`.
// Dlatego z kontraktu bierzemy tylko typy (`import type` znika przy type stripping) –
// moduł src/kontrakty czyta import.meta.env, którego w Node nie ma.
import type { KategoriaId, PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'

/** Kierunek, który może nadpisać użytkownik. */
export type KierunekOceny = 'mniej-lepiej' | 'wiecej-lepiej'

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
  'spolecznosc',
  'przyszlosc',
  'bezpieczenstwo',
  'kontekst',
] as const satisfies readonly KategoriaId[]
type BrakujaceKategorie = Exclude<KategoriaId, (typeof KOLEJNOSC_KATEGORII)[number]>
export const KATEGORIE_KOMPLETNE: [BrakujaceKategorie] extends [never] ? true : never = true

/**
 * Dolne progi liter. Wynik poniżej ostatniego progu = G.
 * Wynik to średnia ważona ocen rangowych, więc skupia się wokół 50 – im więcej warstw, tym
 * ciaśniej. Progi co 10 punktów wokół 50 dają na danych Krakowa A dla ok. 5% najlepszych adresów
 * (przy progach 85/70/…/10 litery A i G praktycznie nie występowały, a 78% adresów miało C lub D).
 */
export const PROGI_LITER = [
  ['A', 75],
  ['B', 65],
  ['C', 55],
  ['D', 45],
  ['E', 35],
  ['F', 25],
] as const
export type Litera = (typeof PROGI_LITER)[number][0] | 'G'

export function literaZWyniku(wynik: number | null): Litera | null {
  if (wynik === null || Number.isNaN(wynik)) return null
  for (const [litera, prog] of PROGI_LITER) if (wynik >= prog) return litera
  return 'G'
}

// ── Skala ────────────────────────────────────────────────────────────────────────────────
//
// Skala zamienia pomiar na pozycję u ∈ [0, 1], a kierunek zamienia u na ocenę 0–100.
//
// Warstwy bez normy dostają skalę rangową (percentylową): u to ranga wartości w rozkładzie
// adresów z danymi, czyli „lepiej niż X% adresów". Dlaczego nie skala liniowa w `zakres`:
// rozkłady są mocno skośne (odległości, liczby kursów). Kursy w szczycie mają zakres 0–80
// przy medianie 2,5, więc liniowo mediana dostawała 3 przy „więcej = lepiej" i 97 przy
// „mniej = lepiej" – po odwróceniu 98% adresów miało ≥ 70 i mapa była „wszędzie dobra".
// Na rangach mediana ma 50 w obu kierunkach, a odwrócenie kierunku daje dokładne lustro.
// - Remisy dostają średnią rangę (ważne przy wielu zerach): u = (średnia pozycja w posortowanych
//   danych) / (n − 1). Mediana ma 0,5.
// - Wyjątek: blok remisu na krańcu rozkładu dostaje 0 albo 1, nie średnią. Inaczej 61% adresów
//   bez azbestu w promieniu 100 m miałoby ocenę 61, a adres z ciszą poniżej progu mapy hałasu 76 –
//   brak zagrożenia „tracił” punkty tylko dlatego, że dzieli go z wieloma adresami. Dotyczy też
//   bloku z przycięcia do `zakres` (np. ponad połowa adresów dalej niż 500 m od osuwiska).
// - `zakres` tylko przycina wartości odstające przed liczeniem rang, nie wyznacza skali.
// - Rangi liczymy raz na warstwę: posortowane unikalne wartości z ich rangami (węzły), potem
//   wyszukiwanie binarne. Przy więcej niż WEZLY_MAKS unikalnych wartościach bierzemy węzły
//   w równych odstępach rang i interpolujemy liniowo między nimi (błąd < 0,5 punktu).
//   Wartość z co najmniej 1/(WEZLY_MAKS − 1) adresów zawsze trafia do węzłów, więc remisy
//   zostają remisami. Tablice są zwykłe (number[]), żeby skalę dało się zapisać w JSON.
//
// Warstwy z normą (`meta.norma`, np. PM2,5) zostają na skali odcinkowo liniowej na [od, do]:
// - przedział to `meta.zakres`, a bez zakresu 5. i 95. percentyl danych;
// - norma to punkt 50: przekroczenie normy zawsze daje ocenę poniżej połowy, dotrzymanie – co
//   najmniej połowę. Norma na brzegu albo poza przedziałem (WHO PM2,5 = 5 przy zakresie 5–30)
//   ściska cały przedział do jednej połowy skali, zamiast ją pomijać.
//
// Warstwy gminne i powiatowe (kilkanaście jednostek, jedna z nich to większość adresów) idą na
// skalę liniową od najniższej do najwyższej wartości. Ranga kilkunastu liczb udaje precyzję,
// a remis Krakowa w środku rozkładu przestawiał pozostałe gminy na krańce.
//
// Warstwy dyskretne (najwyżej MAKS_POZIOMOW różnych wartości: strefy 0/1, powódź 0–4) też
// zostają na skali liniowej. Ranga kategorii nic nie mówi, a przy przewadze zer psuje ocenę:
// 99,7% adresów bez zagrożenia powodzią Q100 dostałoby ok. 50, a przy Q10 (same zera) – wszyscy 50.
//
// Kierunki:
// - `wiecej-lepiej` = 100 · u, `mniej-lepiej` = 100 − 100 · u (dokładne lustro).
// - `neutralny` bez kierunku od użytkownika nie wchodzi do wyniku (ocena null).

export interface Skala {
  /** Skala liniowa: początek przedziału. Skala rangowa: najniższa wartość po przycięciu. */
  od: number
  do: number
  /** Punkt 50 na skali (może leżeć na brzegu albo poza przedziałem) albo null bez normy. */
  norma: number | null
  zrodlo: 'zakres' | 'percentyle' | 'jednostki' | 'rangi' | 'brak'
  /** Skala rangowa: rosnące wartości węzłów. */
  wezly?: number[]
  /** Skala rangowa: ranga 0–1 każdego węzła (średnia przy remisach). */
  rangi?: number[]
}

/** Najwięcej węzłów skali rangowej; powyżej interpolujemy. */
export const WEZLY_MAKS = 257
/** Warstwa z najwyżej tyloma różnymi wartościami jest dyskretna i zostaje na skali liniowej. */
export const MAKS_POZIOMOW = 5

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

function posortowaneLiczby(wartosci: readonly (number | null)[], zakres?: [number, number]) {
  // Wołane raz na warstwę przy starcie na ~176 tys. adresów: tablica typowana z góry zamiast
  // push do number[] i kopii w Float64Array.from – to był najdroższy kawałek startu.
  const liczby = new Float64Array(wartosci.length)
  let n = 0
  for (let i = 0; i < wartosci.length; i++) {
    const w = wartosci[i]
    // Zmierzone zero to liczba – odpada tylko brak danych.
    if (w === null || w === undefined || Number.isNaN(w)) continue
    liczby[n++] = zakres ? Math.min(Math.max(w, zakres[0]), zakres[1]) : w
  }
  return liczby.subarray(0, n).sort()
}

function liczbaPoziomow(posortowane: Float64Array, limit: number): number {
  let poziomy = 0
  for (let i = 0; i < posortowane.length; i++) {
    if (i === 0 || posortowane[i] !== posortowane[i - 1]) poziomy++
    if (poziomy > limit) break
  }
  return poziomy
}

function skalaRangowa(posortowane: Float64Array): Skala {
  const n = posortowane.length
  const wezly: number[] = []
  const rangi: number[] = []
  // Przy dużej liczbie unikalnych wartości bierzemy te, na które wypadają pozycje docelowe
  // co (n − 1)/(WEZLY_MAKS − 1); pierwsza i ostatnia wartość zawsze są węzłami.
  const wszystkie = liczbaPoziomow(posortowane, WEZLY_MAKS) <= WEZLY_MAKS
  const krok = (n - 1) / (WEZLY_MAKS - 1)
  let cel = 0
  let i = 0
  while (i < n) {
    const v = posortowane[i] as number
    let j = i
    while (j + 1 < n && posortowane[j + 1] === v) j++
    let bierz = wszystkie || j === n - 1
    // Pozycje (i − 0,5; j + 0,5] należą do tej wartości – przedziały kolejnych wartości stykają się.
    while (cel <= j + 0.5) {
      bierz = true
      cel += krok
    }
    if (bierz) {
      wezly.push(v)
      rangi.push(n > 1 ? (i + j) / 2 / (n - 1) : 0.5)
    }
    i = j + 1
  }
  if (wezly.length > 1) {
    rangi[0] = 0
    rangi[rangi.length - 1] = 1
  }
  return {
    od: posortowane[0] as number,
    do: posortowane[n - 1] as number,
    norma: null,
    zrodlo: 'rangi',
    wezly,
    rangi,
  }
}

function skalaLiniowa(meta: WskaznikMeta, posortowane: () => Float64Array): Skala {
  let od: number
  let doo: number
  let zrodlo: Skala['zrodlo']
  if (meta.zakres) {
    ;[od, doo] = meta.zakres
    zrodlo = 'zakres'
  } else {
    const liczby = posortowane()
    od = percentyl(liczby, 0.05)
    doo = percentyl(liczby, 0.95)
    zrodlo = 'percentyle'
  }
  if (!(doo > od)) return { od, do: doo, norma: null, zrodlo: 'brak' }
  const n = meta.norma?.wartosc
  return { od, do: doo, norma: n !== undefined && Number.isFinite(n) ? n : null, zrodlo }
}

const JEDNOSTKI_ADMINISTRACYJNE: readonly WskaznikMeta['rozdzielczosc'][] = ['gmina', 'powiat']

export function zbudujSkale(meta: WskaznikMeta, wartosci: readonly (number | null)[]): Skala {
  if (meta.norma) return skalaLiniowa(meta, () => posortowaneLiczby(wartosci))
  const liczby = posortowaneLiczby(wartosci, meta.zakres)
  if (liczby.length === 0) return { od: Number.NaN, do: Number.NaN, norma: null, zrodlo: 'brak' }
  if (JEDNOSTKI_ADMINISTRACYJNE.includes(meta.rozdzielczosc)) {
    const od = liczby[0] as number
    const doo = liczby[liczby.length - 1] as number
    // Jedna wartość dla wszystkich: jak przy skali rangowej – 50, nie brak danych.
    if (!(doo > od)) return skalaRangowa(liczby)
    return { od, do: doo, norma: null, zrodlo: 'jednostki' }
  }
  // Wszystkie adresy mają taki sam poprawny pomiar: 50 jest uczciwsze od „brak danych”.
  // Dla klas ze znanym zakresem (np. sama wartość 0 w strefie 0/1) zostaje skala liniowa.
  if (!meta.zakres && liczby[0] === liczby[liczby.length - 1]) return skalaRangowa(liczby)
  if (liczbaPoziomow(liczby, MAKS_POZIOMOW) <= MAKS_POZIOMOW) {
    return skalaLiniowa(meta, () => liczby)
  }
  return skalaRangowa(liczby)
}

/** Pozycja wartości na skali, 0–1 (0 = początek, 1 = koniec); brak danych → null. */
export function pozycjaNaSkali(wartosc: number | null | undefined, skala: Skala): number | null {
  if (wartosc === null || wartosc === undefined || Number.isNaN(wartosc)) return null
  if (skala.zrodlo === 'brak') return null
  const { od, do: doo, norma, wezly, rangi } = skala
  const x = Math.min(Math.max(wartosc, od), doo)
  if (wezly && rangi) {
    // Ostatni węzeł ≤ x (wyszukiwanie binarne), potem interpolacja do następnego.
    let lo = 0
    let hi = wezly.length - 1
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1
      if ((wezly[m] as number) <= x) lo = m
      else hi = m - 1
    }
    const a = wezly[lo] as number
    const ra = rangi[lo] as number
    if (x === a || lo === wezly.length - 1) return ra
    const b = wezly[lo + 1] as number
    const rb = rangi[lo + 1] as number
    return ra + ((rb - ra) * (x - a)) / (b - a)
  }
  // Skala liniowa: norma (jeśli jest) ląduje dokładnie na 0,5.
  const t = (x - od) / (doo - od)
  if (norma === null) return t
  // Norma na brzegu albo poza przedziałem: cały przedział po jednej stronie normy.
  if (norma <= od) return 0.5 + 0.5 * t
  if (norma >= doo) return 0.5 * t
  if (x <= norma) return (0.5 * (x - od)) / (norma - od)
  return 0.5 + (0.5 * (x - norma)) / (doo - norma)
}

function ocenaZPozycji(u: number, kierunek: KierunekOceny): number {
  return kierunek === 'wiecej-lepiej' ? 100 * u : 100 - 100 * u
}

/** Kierunek, który faktycznie liczy ocenę; null = wskaźnik nie wchodzi do wyniku. */
export function kierunekEfektywny(meta: WskaznikMeta, kierunki?: Kierunki): KierunekOceny | null {
  if (meta.kategoria === 'kontekst') return null
  // Atrapa ceny nie może zmienić prawdziwego wyniku, nawet przez stare ustawienia w URL.
  if (meta.id === 'cena_m2_mediana' && meta.atrapa) return null
  const k = kierunki?.[meta.id] ?? meta.kierunek
  return k === 'neutralny' ? null : k
}

/** Ocena 0–100, gdzie 100 = najlepiej. Brak danych albo brak kierunku → null, nigdy 0. */
export function ocenWartosc(
  wartosc: number | null | undefined,
  skala: Skala,
  kierunek: KierunekOceny | null,
): number | null {
  if (kierunek === null) return null
  const pozycja = pozycjaNaSkali(wartosc, skala)
  return pozycja === null ? null : ocenaZPozycji(pozycja, kierunek)
}

// ── Wskaźnik przygotowany ────────────────────────────────────────────────────────────────

export interface WskaznikPrzygotowany {
  meta: WskaznikMeta
  wartosci: readonly (number | null)[]
  etykiety?: readonly (string | null)[]
  slownikEtykiet?: Readonly<Record<string, string>>
  skala: Skala
  /** Powód, gdy plik warstwy się nie wczytał; wtedy każdy adres ma brak danych. */
  niedostepny?: string
}

export function przygotujWskaznik(plik: PlikWskaznika): WskaznikPrzygotowany {
  return {
    meta: plik.meta,
    wartosci: plik.wartosci,
    etykiety: plik.etykiety,
    slownikEtykiet: plik.slownikEtykiet,
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
    const wu = wagaUzytkownika(wagi, w.meta.id)
    const kierunek = kierunekEfektywny(w.meta, kierunki)
    const wartosc = w.wartosci[i] ?? null
    const ocena = kierunek ? ocenyWskaznika(w, kierunek)[i] : Number.NaN
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
      etykieta: s.w.slownikEtykiet?.[s.w.etykiety?.[i] ?? ''] ?? s.w.etykiety?.[i] ?? null,
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
  const wynik = new Float32Array(liczbaAdresow).fill(Number.NaN)
  const { suma, sumaWag } = sumyWyniku(wskazniki, wagi, kierunki, liczbaAdresow)
  for (let i = 0; i < liczbaAdresow; i++) {
    const sw = sumaWag[i] as number
    if (sw > 0) wynik[i] = (suma[i] as number) / sw
  }
  return wynik
}

/**
 * Licznik i mianownik wyniku: wynik = suma / sumaWag (sumaWag 0 = brak danych).
 * Osobno, bo symulator (#96) zmienia jedną warstwę pod adresem i przelicza wynik
 * dokładnie z tych sum: suma' = suma − waga · stara ocena + waga · nowa ocena.
 */
export function sumyWyniku(
  wskazniki: readonly WskaznikPrzygotowany[],
  wagi: Wagi,
  kierunki: Kierunki | undefined,
  liczbaAdresow: number,
): { suma: Float64Array; sumaWag: Float64Array } {
  const warstwy: { oceny: Float32Array; waga: number }[] = []
  for (const w of wskazniki) {
    const kierunek = kierunekEfektywny(w.meta, kierunki)
    const waga = wagaUzytkownika(wagi, w.meta.id)
    if (kierunek && waga > 0) warstwy.push({ oceny: ocenyWskaznika(w, kierunek), waga })
  }
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
  return { suma, sumaWag }
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
