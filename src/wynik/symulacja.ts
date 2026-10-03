// Symulator inwestycji, tryb „Miasto” (#96, #98): urzędnik stawia hipotetyczny obiekt
// (przystanek, punkt zdrowia, szkoła, przedszkole, plac zabaw, AED…) i widzi, ile adresów awansuje o literę
// i ile wychodzi z luki (progi z #89). Czyste funkcje bez DOM i Reacta – liczone w workerze
// (`symulacja.worker.ts`), testy na gołym `node --test`. Z kontraktu tylko typy.
//
// Zasady:
// - Obiekt zmienia jedną warstwę odległościową: nowa = min(stara, odległość do obiektu).
//   Odległość w linii prostej, jak w warstwach źródłowych – nie trasa pieszo.
// - Adres bez danych zostaje bez danych: nie znamy jego prawdziwej odległości, więc nie
//   udajemy, że obiekt ją ustala (szara kategoria, nigdy zero).
// - Skala warstwy zostaje bez zmian: jeden obiekt nie przesuwa wszystkim percentyli. Dzięki temu
//   wynik po zmianie liczy się dokładnie z sum bazowych (`sumyWyniku`), tylko dla adresów w zasięgu.
// - Zasięg = odległość, poza którą zmiana nie rusza ani oceny (koniec skali), ani luki (próg).
//   Adres poza zasięgiem jest nietknięty bit w bit.
// - Każde liczenie idzie od stanu bazowego dla pełnej listy obiektów – przesunięcie czy usunięcie
//   obiektu to po prostu nowe liczenie, bez stanu pośredniego.
// - Tylko obiekty, które stawia miasto. Sklep spożywczy to decyzja biznesu – ma swój tryb
//   „Biznes” (`persony.ts`), nie symulator inwestycji publicznych.
// - Park i zieleń poza v1: warstwa zieleni to siatka 100 m, potrzebny inny model niż odległość.
import type { Adres, WskaznikMeta } from '../kontrakty/index.ts'
import {
  type LiczbyLuki,
  type Okolica,
  okolicaAdresu,
  type ProgLuki,
  progLuki,
  type StanLuki,
  stanLuki,
} from './luki.ts'
import {
  type GrupyHeksow,
  type KierunekOceny,
  type Kierunki,
  kierunekEfektywny,
  type Litera,
  literaZWyniku,
  ocenWartosc,
  ocenyWskaznika,
  type Skala,
  sumyWyniku,
  type Wagi,
  type WskaznikPrzygotowany,
  wagaUzytkownika,
} from './silnik.ts'

// ── Typy obiektów ────────────────────────────────────────────────────────────────────────

export type TypObiektu =
  | 'przystanek'
  | 'zdrowie'
  | 'schron'
  | 'przedszkole'
  | 'zlobek'
  | 'szkola'
  | 'plac_zabaw'
  | 'aed'
  | 'kultura'
  | 'silownia'
  | 'toaleta'

export type GrupaObiektu = 'transport' | 'edukacja' | 'zdrowie' | 'rekreacja'

export const GRUPY_OBIEKTOW: readonly { id: GrupaObiektu; nazwa: string }[] = [
  { id: 'transport', nazwa: 'Transport' },
  { id: 'edukacja', nazwa: 'Edukacja i opieka' },
  { id: 'zdrowie', nazwa: 'Zdrowie i bezpieczeństwo' },
  { id: 'rekreacja', nazwa: 'Rekreacja i przestrzeń wspólna' },
]

export interface DefinicjaObiektu {
  typ: TypObiektu
  nazwa: string
  grupa: GrupaObiektu
  /** Id warstwy odległościowej, którą obiekt zmienia. */
  warstwa: string
  /** Id branży z katalogu usług (#104, `public/dane/uslugi/katalog.json`), gdy obiekt jest usługą. */
  branza?: string
  /** Jedna litera na znaczniku mapy i w linku (`a=k:…`) – unikalna, bez polskich znaków. */
  znak: string
}

// Znak „S” (dawny sklep) celowo wolny: stary link ze sklepem gubi tylko ten obiekt, nie
// podstawia pod niego innego typu.
export const TYPY_OBIEKTOW: readonly DefinicjaObiektu[] = [
  {
    typ: 'przystanek',
    nazwa: 'Przystanek',
    grupa: 'transport',
    warstwa: 'przystanek_odleglosc',
    znak: 'P',
  },
  {
    typ: 'przedszkole',
    nazwa: 'Przedszkole',
    grupa: 'edukacja',
    warstwa: 'przedszkole_odleglosc',
    znak: 'K',
  },
  { typ: 'zlobek', nazwa: 'Żłobek', grupa: 'edukacja', warstwa: 'zlobek_odleglosc', znak: 'J' },
  {
    typ: 'szkola',
    nazwa: 'Szkoła podstawowa',
    grupa: 'edukacja',
    warstwa: 'szkola_podst_odleglosc',
    znak: 'E',
  },
  {
    typ: 'zdrowie',
    nazwa: 'Punkt zdrowia (POZ)',
    grupa: 'zdrowie',
    warstwa: 'przychodnia_odleglosc',
    branza: 'poz',
    znak: 'Z',
  },
  {
    typ: 'aed',
    nazwa: 'Defibrylator AED',
    grupa: 'zdrowie',
    warstwa: 'defibrylator_odleglosc',
    znak: 'A',
  },
  {
    typ: 'schron',
    nazwa: 'Punkt schronienia',
    grupa: 'zdrowie',
    warstwa: 'punkt_schronienia_odleglosc',
    znak: 'U',
  },
  {
    typ: 'plac_zabaw',
    nazwa: 'Plac zabaw',
    grupa: 'rekreacja',
    warstwa: 'plac_zabaw_odleglosc',
    znak: 'L',
  },
  {
    typ: 'silownia',
    nazwa: 'Siłownia plenerowa',
    grupa: 'rekreacja',
    warstwa: 'silownia_plenerowa_odleglosc',
    znak: 'G',
  },
  {
    typ: 'kultura',
    nazwa: 'Biblioteka lub dom kultury',
    grupa: 'rekreacja',
    warstwa: 'kultura_odleglosc',
    znak: 'B',
  },
  {
    typ: 'toaleta',
    nazwa: 'Toaleta publiczna lub pitnik',
    grupa: 'rekreacja',
    warstwa: 'toaleta_woda_odleglosc',
    znak: 'T',
  },
]

export function definicjaObiektu(typ: TypObiektu): DefinicjaObiektu {
  return TYPY_OBIEKTOW.find((d) => d.typ === typ) as DefinicjaObiektu
}

export interface Obiekt {
  typ: TypObiektu
  lon: number
  lat: number
}

// ── Baza: wszystko, co worker musi mieć raz ──────────────────────────────────────────────

export interface WarstwaSymulacji {
  id: string
  meta: WskaznikMeta
  /** Pomiar pod adresem; NaN = brak danych. */
  wartosci: Float64Array
  skala: Skala
  /** Kierunek liczący ocenę; null = warstwa nie wchodzi do wyniku (np. kontekst). */
  kierunek: KierunekOceny | null
  /** Waga 0–4; 0 = warstwa nie wchodzi do wyniku. */
  waga: number
  /** Oceny bazowe (te same Float32, które weszły do sum), null gdy warstwa nie wchodzi do wyniku. */
  oceny: Float32Array | null
  prog: ProgLuki | null
  /** Poza tą odległością obiekt nie zmienia ani oceny, ani luki. */
  zasiegM: number
  /** Luka bazowa per heks (indeks jak w `heksy`), tylko gdy jest próg. */
  lukiHeksow: { wLuce: Uint32Array; bezLuki: Uint32Array; brakDanych: Uint32Array } | null
  /** Adresy w luce przed symulacją, cała mapa. */
  wLuceRazem: number
}

/** Kubełki ~250 m: kandydaci do promienia bez przeglądania wszystkich adresów. */
export interface Siatka {
  lon0: number
  lat0: number
  dLon: number
  dLat: number
  kolumny: number
  wiersze: number
  /** CSR: adresy kubełka k to `indeksy[start[k] .. start[k + 1])`. */
  start: Uint32Array
  indeksy: Uint32Array
}

export interface BazaSymulacji {
  n: number
  lon: Float64Array
  lat: Float64Array
  heksy: string[]
  indeksHeksu: Uint32Array
  okolice: Okolica[]
  indeksOkolicy: Uint16Array
  suma: Float64Array
  sumaWag: Float64Array
  /** Per heks: suma wyników adresów z wynikiem i ich liczba (średnia jak na mapie wyniku). */
  sumaWynikuHeksu: Float64Array
  liczbaWynikuHeksu: Uint32Array
  /** Warstwy symulowane po id; brak klucza = warstwa niedostępna (typ obiektu wyłączony). */
  warstwy: Record<string, WarstwaSymulacji>
  /** Typ obiektu → powód wyłączenia (warstwa nie wczytana albo atrapa). */
  wylaczone: Partial<Record<TypObiektu, string>>
  siatka: Siatka
}

export interface WejscieBazy {
  adresy: readonly Pick<Adres, 'lon' | 'lat' | 'dzielnica' | 'gmina'>[]
  grupy: GrupyHeksow
  wskazniki: readonly WskaznikPrzygotowany[]
  wagi: Wagi
  kierunki?: Kierunki
}

const M_NA_STOPIEN = 111_320
const KUBELEK_M = 250

function zbudujSiatke(lon: Float64Array, lat: Float64Array): Siatka {
  const n = lon.length
  let minLon = Number.POSITIVE_INFINITY
  let maxLon = Number.NEGATIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) {
    const x = lon[i] as number
    const y = lat[i] as number
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    if (x < minLon) minLon = x
    if (x > maxLon) maxLon = x
    if (y < minLat) minLat = y
    if (y > maxLat) maxLat = y
  }
  if (!(maxLon >= minLon)) {
    return {
      lon0: 0,
      lat0: 0,
      dLon: 1,
      dLat: 1,
      kolumny: 0,
      wiersze: 0,
      start: new Uint32Array(1),
      indeksy: new Uint32Array(0),
    }
  }
  const dLat = KUBELEK_M / M_NA_STOPIEN
  const dLon = KUBELEK_M / (M_NA_STOPIEN * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180))
  const kolumny = Math.floor((maxLon - minLon) / dLon) + 1
  const wiersze = Math.floor((maxLat - minLat) / dLat) + 1
  const kubelek = new Int32Array(n).fill(-1)
  const start = new Uint32Array(kolumny * wiersze + 1)
  for (let i = 0; i < n; i++) {
    const x = lon[i] as number
    const y = lat[i] as number
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const k = Math.floor((y - minLat) / dLat) * kolumny + Math.floor((x - minLon) / dLon)
    kubelek[i] = k
    start[k + 1] = (start[k + 1] as number) + 1
  }
  for (let k = 0; k < kolumny * wiersze; k++)
    start[k + 1] = (start[k + 1] as number) + (start[k] as number)
  const indeksy = new Uint32Array(start[kolumny * wiersze] as number)
  const kursor = start.slice(0, kolumny * wiersze)
  for (let i = 0; i < n; i++) {
    const k = kubelek[i] as number
    if (k < 0) continue
    indeksy[kursor[k] as number] = i
    kursor[k] = (kursor[k] as number) + 1
  }
  return { lon0: minLon, lat0: minLat, dLon, dLat, kolumny, wiersze, start, indeksy }
}

/** Odległość geodezyjna w metrach (haversine) – ta sama co w `sasiedzi.ts`. */
function odlegloscM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Wywołuje `f(i, odległość)` dla każdego adresu w promieniu `r` metrów od punktu. */
function wPromieniu(
  baza: Pick<BazaSymulacji, 'siatka' | 'lon' | 'lat'>,
  lon: number,
  lat: number,
  r: number,
  f: (i: number, d: number) => void,
) {
  const s = baza.siatka
  if (s.kolumny === 0 || !(r > 0)) return
  const rLat = r / M_NA_STOPIEN
  const rLon = r / (M_NA_STOPIEN * Math.cos((lat * Math.PI) / 180))
  const w0 = Math.max(0, Math.floor((lat - rLat - s.lat0) / s.dLat))
  const w1 = Math.min(s.wiersze - 1, Math.floor((lat + rLat - s.lat0) / s.dLat))
  const k0 = Math.max(0, Math.floor((lon - rLon - s.lon0) / s.dLon))
  const k1 = Math.min(s.kolumny - 1, Math.floor((lon + rLon - s.lon0) / s.dLon))
  for (let w = w0; w <= w1; w++) {
    for (let k = k0; k <= k1; k++) {
      const kub = w * s.kolumny + k
      for (let p = s.start[kub] as number; p < (s.start[kub + 1] as number); p++) {
        const i = s.indeksy[p] as number
        const d = odlegloscM(lon, lat, baza.lon[i] as number, baza.lat[i] as number)
        if (d <= r) f(i, d)
      }
    }
  }
}

/**
 * Baza symulacji z wczytanych danych i bieżących wag. Liczona raz na zmianę wag/kierunków
 * w wątku głównym (sumy wyniku są już w pamięci ocen), potem wysyłana do workera.
 */
export function przygotujBaze(we: WejscieBazy): BazaSymulacji {
  const n = we.adresy.length
  const lon = new Float64Array(n)
  const lat = new Float64Array(n)
  const okolice: Okolica[] = []
  const pozycjaOkolicy = new Map<string, number>()
  const indeksOkolicy = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    const a = we.adresy[i] as Pick<Adres, 'lon' | 'lat' | 'dzielnica' | 'gmina'>
    lon[i] = a.lon
    lat[i] = a.lat
    const o = okolicaAdresu(a)
    let p = pozycjaOkolicy.get(o.id)
    if (p === undefined) {
      p = okolice.length
      okolice.push(o)
      pozycjaOkolicy.set(o.id, p)
    }
    indeksOkolicy[i] = p
  }

  const { suma, sumaWag } = sumyWyniku(we.wskazniki, we.wagi, we.kierunki, n)
  const liczbaHeksow = we.grupy.heksy.length
  const sumaWynikuHeksu = new Float64Array(liczbaHeksow)
  const liczbaWynikuHeksu = new Uint32Array(liczbaHeksow)
  for (let i = 0; i < n; i++) {
    const sw = sumaWag[i] as number
    if (sw > 0) {
      const h = we.grupy.indeksHeksu[i] as number
      sumaWynikuHeksu[h] = (sumaWynikuHeksu[h] as number) + (suma[i] as number) / sw
      liczbaWynikuHeksu[h] = (liczbaWynikuHeksu[h] as number) + 1
    }
  }

  const warstwy: Record<string, WarstwaSymulacji> = {}
  const wylaczone: Partial<Record<TypObiektu, string>> = {}
  for (const def of TYPY_OBIEKTOW) {
    const w = we.wskazniki.find((x) => x.meta.id === def.warstwa)
    if (!w || w.niedostepny || w.meta.atrapa) {
      wylaczone[def.typ] = w?.niedostepny
        ? `warstwa ${def.warstwa} się nie wczytała`
        : w?.meta.atrapa
          ? `warstwa ${def.warstwa} to atrapa`
          : `brak warstwy ${def.warstwa}`
      continue
    }
    if (warstwy[w.meta.id]) continue
    const wartosci = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const v = w.wartosci[i]
      wartosci[i] = v === null || v === undefined ? Number.NaN : v
    }
    const kierunek = kierunekEfektywny(w.meta, we.kierunki)
    const waga = wagaUzytkownika(we.wagi, w.meta.id)
    const liczona = kierunek !== null && waga > 0
    const prog = progLuki(w.meta)
    // Za końcem skali ocena się nie zmienia (wartość jest przycinana), za progiem – luka.
    const zasiegOceny = liczona && Number.isFinite(w.skala.do) ? w.skala.do : 0
    const zasiegM = Math.max(zasiegOceny, prog?.prog ?? 0)

    let lukiHeksow: WarstwaSymulacji['lukiHeksow'] = null
    let wLuceRazem = 0
    if (prog) {
      lukiHeksow = {
        wLuce: new Uint32Array(liczbaHeksow),
        bezLuki: new Uint32Array(liczbaHeksow),
        brakDanych: new Uint32Array(liczbaHeksow),
      }
      for (let i = 0; i < n; i++) {
        const h = we.grupy.indeksHeksu[i] as number
        const s = stanLuki(wartosci[i], prog)
        const tablica =
          s === 'w-luce'
            ? lukiHeksow.wLuce
            : s === 'bez-luki'
              ? lukiHeksow.bezLuki
              : lukiHeksow.brakDanych
        tablica[h] = (tablica[h] as number) + 1
        if (s === 'w-luce') wLuceRazem++
      }
    }

    warstwy[w.meta.id] = {
      id: w.meta.id,
      meta: w.meta,
      wartosci,
      skala: w.skala,
      kierunek,
      waga,
      oceny: liczona ? ocenyWskaznika(w, kierunek) : null,
      prog,
      zasiegM,
      lukiHeksow,
      wLuceRazem,
    }
  }

  return {
    n,
    lon,
    lat,
    heksy: we.grupy.heksy,
    indeksHeksu: we.grupy.indeksHeksu,
    okolice,
    indeksOkolicy,
    suma,
    sumaWag,
    sumaWynikuHeksu,
    liczbaWynikuHeksu,
    warstwy,
    wylaczone,
    siatka: zbudujSiatke(lon, lat),
  }
}

// ── Symulacja ────────────────────────────────────────────────────────────────────────────

export interface LukaWarstwy {
  warstwa: string
  nazwa: string
  prog: ProgLuki
  /** Adresy w luce przed postawieniem obiektów (cała mapa). */
  przed: number
  /** Adresy, które wychodzą z luki (były w luce, są bez luki). */
  wychodzi: number
}

export interface BilansOkolicy extends Okolica {
  /** Adresy z lepszą literą o co najmniej jeden stopień. */
  awans: number
  /** Adresy z gorszą literą (możliwe tylko przy odwróconym kierunku warstwy). */
  spadek: number
  /** Warstwa → adresy wychodzące z luki. */
  wychodzi: Record<string, number>
}

export interface HeksPoSymulacji {
  /** Średni wynik heksu po zmianie; null = brak danych. */
  wynik: number | null
  /** Warstwa z progiem → liczby luki w heksie po zmianie. */
  luki: Record<string, LiczbyLuki>
  /** Czy pod którymś adresem heksu zmieniła się litera albo stan luki (do wyróżnienia na mapie). */
  zmiana: boolean
}

export interface WynikSymulacji {
  obiekty: number
  /** Adresy, którym zmienił się pomiar którejś warstwy. */
  zasieg: number
  awans: number
  spadek: number
  luki: LukaWarstwy[]
  /** Okolice z jakąkolwiek zmianą, malejąco po awansie i wyjściu z luki. */
  okolice: BilansOkolicy[]
  /** Tylko heksy z adresem ze zmienionym pomiarem. */
  heksy: Map<string, HeksPoSymulacji>
}

const KOLEJNOSC_LITER: Readonly<Record<Litera, number>> = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
  F: 5,
  G: 6,
}

function wynikZSum(suma: number, sumaWag: number): number | null {
  return sumaWag > 0 ? suma / sumaWag : null
}

/** Pusta symulacja – stan bazowy bez obiektów. */
export function pustyWynik(): WynikSymulacji {
  return { obiekty: 0, zasieg: 0, awans: 0, spadek: 0, luki: [], okolice: [], heksy: new Map() }
}

export function symuluj(baza: BazaSymulacji, obiekty: readonly Obiekt[]): WynikSymulacji {
  if (obiekty.length === 0) return pustyWynik()

  // 1. Nowe pomiary per warstwa: tylko adresy z danymi, którym obiekt skraca odległość.
  const nowe = new Map<string, Map<number, number>>()
  for (const o of obiekty) {
    const w = baza.warstwy[definicjaObiektu(o.typ)?.warstwa ?? '']
    if (!w || !Number.isFinite(o.lon) || !Number.isFinite(o.lat)) continue
    let zmiany = nowe.get(w.id)
    if (!zmiany) {
      zmiany = new Map()
      nowe.set(w.id, zmiany)
    }
    const z = zmiany
    wPromieniu(baza, o.lon, o.lat, w.zasiegM, (i, d) => {
      const stara = w.wartosci[i] as number
      if (Number.isNaN(stara)) return
      const biezaca = z.get(i) ?? stara
      if (d < biezaca) z.set(i, d)
    })
  }

  // 2. Adres po adresie: wynik, litera i luka przed i po.
  const dotkniete = new Set<number>()
  for (const z of nowe.values()) for (const i of z.keys()) dotkniete.add(i)

  const warstwyZProgiem = Object.values(baza.warstwy).filter((w) => w.prog !== null)
  const okolice = new Map<number, BilansOkolicy>()
  const heksy = new Map<
    number,
    { sumaWyniku: number; liczbaWyniku: number; luki: Record<string, number[]>; zmiana: boolean }
  >()
  const wychodziRazem: Record<string, number> = {}
  let awans = 0
  let spadek = 0

  for (const i of dotkniete) {
    let suma = baza.suma[i] as number
    let sumaWag = baza.sumaWag[i] as number
    const przedWynik = wynikZSum(suma, sumaWag)
    let zmianaLuki = false
    const wyjscia: string[] = []
    const stanyLuk: [WarstwaSymulacji, StanLuki, StanLuki][] = []

    for (const [id, z] of nowe) {
      const nowa = z.get(i)
      if (nowa === undefined) continue
      const w = baza.warstwy[id] as WarstwaSymulacji
      if (w.oceny && w.kierunek) {
        const stara = w.oceny[i] as number
        const ocenaNowa = ocenWartosc(nowa, w.skala, w.kierunek)
        // Float32 jak w `ocenyWskaznika` – inaczej przyrost różniłby się od pełnego przeliczenia.
        const nowaOcena = ocenaNowa === null ? Number.NaN : Math.fround(ocenaNowa)
        if (stara === stara) {
          suma -= w.waga * stara
          sumaWag -= w.waga
        }
        if (nowaOcena === nowaOcena) {
          suma += w.waga * nowaOcena
          sumaWag += w.waga
        }
      }
      if (w.prog) {
        const przed = stanLuki(w.wartosci[i], w.prog)
        const po = stanLuki(nowa, w.prog)
        if (przed !== po) {
          zmianaLuki = true
          stanyLuk.push([w, przed, po])
          if (przed === 'w-luce' && po === 'bez-luki') wyjscia.push(id)
        }
      }
    }

    const poWynik = wynikZSum(suma, sumaWag)
    const lPrzed = literaZWyniku(przedWynik)
    const lPo = literaZWyniku(poWynik)
    const roznica =
      lPrzed !== null && lPo !== null ? KOLEJNOSC_LITER[lPrzed] - KOLEJNOSC_LITER[lPo] : 0
    if (roznica > 0) awans++
    if (roznica < 0) spadek++
    for (const id of wyjscia) wychodziRazem[id] = (wychodziRazem[id] ?? 0) + 1

    const io = baza.indeksOkolicy[i] as number
    if (roznica !== 0 || wyjscia.length > 0) {
      let b = okolice.get(io)
      if (!b) {
        b = { ...(baza.okolice[io] as Okolica), awans: 0, spadek: 0, wychodzi: {} }
        okolice.set(io, b)
      }
      if (roznica > 0) b.awans++
      if (roznica < 0) b.spadek++
      for (const id of wyjscia) b.wychodzi[id] = (b.wychodzi[id] ?? 0) + 1
    }

    const ih = baza.indeksHeksu[i] as number
    let h = heksy.get(ih)
    if (!h) {
      const luki: Record<string, number[]> = {}
      for (const w of warstwyZProgiem) {
        const l = w.lukiHeksow as NonNullable<WarstwaSymulacji['lukiHeksow']>
        luki[w.id] = [l.wLuce[ih] as number, l.bezLuki[ih] as number, l.brakDanych[ih] as number]
      }
      h = {
        sumaWyniku: baza.sumaWynikuHeksu[ih] as number,
        liczbaWyniku: baza.liczbaWynikuHeksu[ih] as number,
        luki,
        zmiana: false,
      }
      heksy.set(ih, h)
    }
    if (przedWynik !== null) {
      h.sumaWyniku -= przedWynik
      h.liczbaWyniku--
    }
    if (poWynik !== null) {
      h.sumaWyniku += poWynik
      h.liczbaWyniku++
    }
    for (const [w, przed, po] of stanyLuk) {
      const l = h.luki[w.id] as number[]
      const poz = (s: StanLuki) => (s === 'w-luce' ? 0 : s === 'bez-luki' ? 1 : 2)
      l[poz(przed)] = (l[poz(przed)] as number) - 1
      l[poz(po)] = (l[poz(po)] as number) + 1
    }
    if (roznica !== 0 || zmianaLuki) h.zmiana = true
  }

  const luki: LukaWarstwy[] = []
  for (const id of nowe.keys()) {
    const w = baza.warstwy[id] as WarstwaSymulacji
    if (!w.prog) continue
    luki.push({
      warstwa: id,
      nazwa: w.meta.nazwa,
      prog: w.prog,
      przed: w.wLuceRazem,
      wychodzi: wychodziRazem[id] ?? 0,
    })
  }

  const sumaWyjsc = (b: BilansOkolicy) => Object.values(b.wychodzi).reduce((s, x) => s + x, 0)
  const listaOkolic = [...okolice.values()].sort(
    (a, b) =>
      b.awans + sumaWyjsc(b) - (a.awans + sumaWyjsc(a)) || a.nazwa.localeCompare(b.nazwa, 'pl'),
  )

  const heksyWynik = new Map<string, HeksPoSymulacji>()
  for (const [ih, h] of heksy) {
    const luki: Record<string, LiczbyLuki> = {}
    for (const [id, [wLuce, bezLuki, brakDanych]] of Object.entries(h.luki) as [
      string,
      [number, number, number],
    ][]) {
      const wszystkie = wLuce + bezLuki + brakDanych
      luki[id] = {
        wszystkie,
        wLuce,
        bezLuki,
        brakDanych,
        udzial: wLuce + bezLuki > 0 ? wLuce / wszystkie : null,
      }
    }
    heksyWynik.set(baza.heksy[ih] as string, {
      wynik: h.liczbaWyniku > 0 ? h.sumaWyniku / h.liczbaWyniku : null,
      luki,
      zmiana: h.zmiana,
    })
  }

  return {
    obiekty: obiekty.length,
    zasieg: dotkniete.size,
    awans,
    spadek,
    luki,
    okolice: listaOkolic,
    heksy: heksyWynik,
  }
}
