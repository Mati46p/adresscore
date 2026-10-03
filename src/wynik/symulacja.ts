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
import type { Adres, PlikOkolic, WskaznikMeta } from '../kontrakty/index.ts'
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
  | 'kolej'
  | 'pr'
  | 'rower'
  | 'ev'
  | 'przedszkole'
  | 'zlobek'
  | 'szkola'
  | 'liceum'
  | 'cas'
  | 'zdrowie'
  | 'poz_bez_barier'
  | 'aed'
  | 'schron'
  | 'policja'
  | 'straz'
  | 'plac_zabaw'
  | 'silownia'
  | 'sport'
  | 'wybieg'
  | 'kapielisko'
  | 'kultura'
  | 'toaleta'
  | 'urzad'
  | 'recykling'
  | 'targowisko'
  | 'szkola_kampus'
  | 'centrum'
  | 'emitent'
  | 'seveso'

export type GrupaObiektu =
  | 'transport'
  | 'edukacja'
  | 'zdrowie'
  | 'rekreacja'
  | 'uslugi'
  | 'zlozone'
  | 'uciazliwe'

export const GRUPY_OBIEKTOW: readonly { id: GrupaObiektu; nazwa: string }[] = [
  { id: 'transport', nazwa: 'Transport' },
  { id: 'edukacja', nazwa: 'Edukacja i opieka' },
  { id: 'zdrowie', nazwa: 'Zdrowie i bezpieczeństwo' },
  { id: 'rekreacja', nazwa: 'Rekreacja i przestrzeń wspólna' },
  { id: 'uslugi', nazwa: 'Usługi miejskie' },
  { id: 'zlozone', nazwa: 'Obiekty złożone' },
  { id: 'uciazliwe', nazwa: 'Obiekty uciążliwe – koszt inwestycji' },
]

export interface DefinicjaObiektu {
  typ: TypObiektu
  nazwa: string
  grupa: GrupaObiektu
  /**
   * Warstwy odległościowe, które obiekt zmienia. Obiekt złożony (szkoła z boiskiem) zmienia
   * kilka naraz; pierwsza warstwa to ta, którą maluje mapa.
   */
  warstwy: readonly string[]
  /** Id branży z katalogu usług (#104, `public/dane/uslugi/katalog.json`), gdy obiekt jest usługą. */
  branza?: string
  /**
   * Obiekt uciążliwy: warstwa ma kierunek „im dalej, tym lepiej”, więc bliżej = gorzej.
   * Bilans pokazuje wtedy koszt (spadki liter), nie zysk.
   */
  negatywny?: true
  /** Kod w linku (`a=kl:…`): 1–2 małe litery, unikalny. Jednoliterowe – typy z pierwszej wersji. */
  kod: string
  /** Napis w rombie na mapie (1–2 znaki). */
  znak: string
}

// Kod „s” (dawny sklep) celowo wolny: stary link ze sklepem gubi tylko ten obiekt, nie
// podstawia pod niego innego typu.
export const TYPY_OBIEKTOW: readonly DefinicjaObiektu[] = [
  {
    typ: 'przystanek',
    nazwa: 'Przystanek',
    grupa: 'transport',
    warstwy: ['przystanek_odleglosc'],
    kod: 'p',
    znak: 'P',
  },
  {
    typ: 'kolej',
    nazwa: 'Przystanek kolejowy',
    grupa: 'transport',
    warstwy: ['kolej_odleglosc'],
    kod: 'kl',
    znak: 'KL',
  },
  {
    typ: 'pr',
    nazwa: 'Parking P+R',
    grupa: 'transport',
    warstwy: ['pr_odleglosc'],
    kod: 'pr',
    znak: 'PR',
  },
  {
    typ: 'rower',
    nazwa: 'Stacja roweru lub stojaki',
    grupa: 'transport',
    warstwy: ['rower_infrastruktura_odleglosc'],
    kod: 'rw',
    znak: 'RW',
  },
  {
    typ: 'ev',
    nazwa: 'Ładowarka EV',
    grupa: 'transport',
    warstwy: ['ladowarka_ev_odleglosc'],
    kod: 'ev',
    znak: 'EV',
  },
  {
    typ: 'przedszkole',
    nazwa: 'Przedszkole',
    grupa: 'edukacja',
    warstwy: ['przedszkole_odleglosc'],
    kod: 'k',
    znak: 'K',
  },
  {
    typ: 'zlobek',
    nazwa: 'Żłobek',
    grupa: 'edukacja',
    warstwy: ['zlobek_odleglosc'],
    kod: 'j',
    znak: 'J',
  },
  {
    typ: 'szkola',
    nazwa: 'Szkoła podstawowa',
    grupa: 'edukacja',
    warstwy: ['szkola_podst_odleglosc'],
    kod: 'e',
    znak: 'E',
  },
  {
    typ: 'liceum',
    nazwa: 'Liceum',
    grupa: 'edukacja',
    warstwy: ['liceum_odleglosc'],
    kod: 'lo',
    znak: 'LO',
  },
  {
    typ: 'cas',
    nazwa: 'Centrum aktywności seniora',
    grupa: 'edukacja',
    warstwy: ['cas_odleglosc'],
    kod: 'cs',
    znak: 'CS',
  },
  {
    typ: 'zdrowie',
    nazwa: 'Punkt zdrowia (POZ)',
    grupa: 'zdrowie',
    warstwy: ['przychodnia_odleglosc'],
    branza: 'poz',
    kod: 'z',
    znak: 'Z',
  },
  {
    typ: 'poz_bez_barier',
    nazwa: 'Przychodnia bez barier',
    grupa: 'zdrowie',
    warstwy: ['przychodnia_bez_barier_odleglosc'],
    kod: 'pb',
    znak: 'PB',
  },
  {
    typ: 'aed',
    nazwa: 'Defibrylator AED',
    grupa: 'zdrowie',
    warstwy: ['defibrylator_odleglosc'],
    kod: 'a',
    znak: 'A',
  },
  {
    typ: 'schron',
    nazwa: 'Punkt schronienia',
    grupa: 'zdrowie',
    warstwy: ['punkt_schronienia_odleglosc'],
    kod: 'u',
    znak: 'U',
  },
  {
    typ: 'policja',
    nazwa: 'Posterunek policji',
    grupa: 'zdrowie',
    warstwy: ['policja_odleglosc'],
    kod: 'po',
    znak: 'PO',
  },
  {
    typ: 'straz',
    nazwa: 'Remiza straży (PSP/OSP)',
    grupa: 'zdrowie',
    warstwy: ['straz_pozarna_odleglosc'],
    kod: 'st',
    znak: 'ST',
  },
  {
    typ: 'plac_zabaw',
    nazwa: 'Plac zabaw',
    grupa: 'rekreacja',
    warstwy: ['plac_zabaw_odleglosc'],
    kod: 'l',
    znak: 'L',
  },
  {
    typ: 'silownia',
    nazwa: 'Siłownia plenerowa',
    grupa: 'rekreacja',
    warstwy: ['silownia_plenerowa_odleglosc'],
    kod: 'g',
    znak: 'G',
  },
  {
    typ: 'sport',
    nazwa: 'Boisko lub hala sportowa',
    grupa: 'rekreacja',
    warstwy: ['sport_odleglosc'],
    kod: 'sp',
    znak: 'SP',
  },
  {
    typ: 'wybieg',
    nazwa: 'Wybieg dla psów',
    grupa: 'rekreacja',
    warstwy: ['wybieg_psy_odleglosc'],
    kod: 'ps',
    znak: 'PS',
  },
  {
    typ: 'kapielisko',
    nazwa: 'Kąpielisko',
    grupa: 'rekreacja',
    warstwy: ['kapielisko_odleglosc'],
    kod: 'kp',
    znak: 'KP',
  },
  {
    typ: 'kultura',
    nazwa: 'Biblioteka lub dom kultury',
    grupa: 'rekreacja',
    warstwy: ['kultura_odleglosc'],
    kod: 'b',
    znak: 'B',
  },
  {
    typ: 'toaleta',
    nazwa: 'Toaleta publiczna lub pitnik',
    grupa: 'rekreacja',
    warstwy: ['toaleta_woda_odleglosc'],
    kod: 't',
    znak: 'T',
  },
  {
    typ: 'urzad',
    nazwa: 'Punkt urzędu (filia)',
    grupa: 'uslugi',
    warstwy: ['urzad_odleglosc'],
    kod: 'ur',
    znak: 'UR',
  },
  {
    typ: 'recykling',
    nazwa: 'PSZOK lub punkt recyklingu',
    grupa: 'uslugi',
    warstwy: ['recykling_odleglosc'],
    kod: 're',
    znak: 'RE',
  },
  {
    typ: 'targowisko',
    nazwa: 'Targowisko miejskie',
    grupa: 'uslugi',
    warstwy: ['targowisko_odleglosc'],
    kod: 'tg',
    znak: 'TG',
  },
  {
    typ: 'szkola_kampus',
    nazwa: 'Szkoła z placem zabaw i boiskiem',
    grupa: 'zlozone',
    warstwy: ['szkola_podst_odleglosc', 'plac_zabaw_odleglosc', 'sport_odleglosc'],
    kod: 'sz',
    znak: 'SZ',
  },
  {
    typ: 'centrum',
    nazwa: 'Centrum lokalne (biblioteka, CAS, filia urzędu)',
    grupa: 'zlozone',
    warstwy: ['kultura_odleglosc', 'cas_odleglosc', 'urzad_odleglosc'],
    kod: 'cl',
    znak: 'CL',
  },
  {
    typ: 'emitent',
    nazwa: 'Zakład emitujący zanieczyszczenia',
    grupa: 'uciazliwe',
    warstwy: ['emitent_odleglosc'],
    negatywny: true,
    kod: 'em',
    znak: 'EM',
  },
  {
    typ: 'seveso',
    nazwa: 'Zakład Seveso (ryzyko awarii)',
    grupa: 'uciazliwe',
    warstwy: ['seveso_odleglosc'],
    negatywny: true,
    kod: 'sv',
    znak: 'SV',
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

/** Okolica w bazie: z liczbą jej adresów, żeby bilans pokazał skalę (jednostka SIM bywa mała). */
export interface OkolicaBazy extends Okolica {
  liczbaAdresow: number
}

export interface BazaSymulacji {
  n: number
  lon: Float64Array
  lat: Float64Array
  heksy: string[]
  indeksHeksu: Uint32Array
  okolice: OkolicaBazy[]
  /** Indeks w `okolice` dla i-tego adresu. */
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
  /** Szacunek zameldowanych pod adresem (`szacujMieszkancow`); NaN = brak szacunku (poza Krakowem). */
  mieszkancy: Float32Array
}

export interface WejscieBazy {
  adresy: readonly Pick<Adres, 'lon' | 'lat' | 'dzielnica' | 'gmina'>[]
  grupy: GrupyHeksow
  wskazniki: readonly WskaznikPrzygotowany[]
  wagi: Wagi
  kierunki?: Kierunki
  /** Jednostki SIM i miejscowości (#185); bez nich okolicą jest dzielnica albo gmina. */
  okolice?: PlikOkolic | null
}

const M_NA_STOPIEN = 111_320
/**
 * Górna granica zasięgu obiektu. Kąpielisko czy zakład Seveso mają skalę do 20 km – bez limitu
 * jeden obiekt przeliczałby pół województwa przy każdym przesunięciu znacznika.
 */
const ZASIEG_MAKS_M = 8000
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

/** Warstwa zameldowań MSIP (#74): os./ha w heksagonie o boku 100 m. */
export const WARSTWA_ZAMELDOWAN = 'gestosc_zaludnienia_100m'
/** Pole heksagonu foremnego o boku 100 m w ha: 3√3/2 · 100² m². */
const HA_HEKSAGONU_MSIP = (3 * Math.sqrt(3) * 100 * 100) / 2 / 10_000
const KOMORKA_GRUPY_M = 500

/**
 * Szacunek zameldowanych na adres: osoby w heksagonie MSIP (gęstość × 2,6 ha) dzielone równo
 * między adresy tego heksagonu. Granic heksagonów MSIP nie mamy, więc „ten sam heksagon” to
 * ta sama wartość gęstości w tej samej komórce ~500 m. To szacunek, nie liczba mieszkańców:
 * adres w kamienicy i domek dostają tyle samo, a zameldowanie to nie zamieszkanie.
 */
export function szacujMieszkancow(
  gestosc: ArrayLike<number | null | undefined>,
  lon: Float64Array,
  lat: Float64Array,
): Float32Array {
  const n = lon.length
  const wynik = new Float32Array(n).fill(Number.NaN)
  const klucze: (string | null)[] = new Array(n).fill(null)
  const liczba = new Map<string, number>()
  const dLat = KOMORKA_GRUPY_M / M_NA_STOPIEN
  for (let i = 0; i < n; i++) {
    const g = gestosc[i]
    const x = lon[i] as number
    const y = lat[i] as number
    if (g === null || g === undefined || !(g > 0) || !Number.isFinite(x) || !Number.isFinite(y))
      continue
    const dLon = KOMORKA_GRUPY_M / (M_NA_STOPIEN * Math.cos((y * Math.PI) / 180))
    const k = `${g}|${Math.floor(x / dLon)}|${Math.floor(y / dLat)}`
    klucze[i] = k
    liczba.set(k, (liczba.get(k) ?? 0) + 1)
  }
  for (let i = 0; i < n; i++) {
    const k = klucze[i]
    if (k === null || k === undefined) continue
    wynik[i] = ((gestosc[i] as number) * HA_HEKSAGONU_MSIP) / (liczba.get(k) as number)
  }
  return wynik
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
  const okolice: OkolicaBazy[] = []
  const pozycjaOkolicy = new Map<string, number>()
  const indeksOkolicy = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    const a = we.adresy[i] as Pick<Adres, 'lon' | 'lat' | 'dzielnica' | 'gmina'>
    lon[i] = a.lon
    lat[i] = a.lat
    const o = okolicaAdresu(a, i, we.okolice)
    let p = pozycjaOkolicy.get(o.id)
    if (p === undefined) {
      p = okolice.length
      okolice.push({ ...o, liczbaAdresow: 0 })
      pozycjaOkolicy.set(o.id, p)
    }
    const wpis = okolice[p] as OkolicaBazy
    wpis.liczbaAdresow++
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
  const powody: Record<string, string> = {}
  const idWarstw = new Set(TYPY_OBIEKTOW.flatMap((d) => d.warstwy))
  for (const id of idWarstw) {
    const w = we.wskazniki.find((x) => x.meta.id === id)
    if (!w || w.niedostepny || w.meta.atrapa) {
      powody[id] = w?.niedostepny
        ? `warstwa ${id} się nie wczytała`
        : w?.meta.atrapa
          ? `warstwa ${id} to atrapa`
          : `brak warstwy ${id}`
      continue
    }
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
    const zasiegOceny =
      liczona && Number.isFinite(w.skala.do) ? Math.min(w.skala.do, ZASIEG_MAKS_M) : 0
    // Warstwa bez oceny i bez progu (kierunek neutralny): liczymy choć krótszą drogę do końca skali.
    const zasiegM =
      Math.max(zasiegOceny, prog?.prog ?? 0) ||
      (Number.isFinite(w.skala.do) ? Math.min(w.skala.do, ZASIEG_MAKS_M) : 0)

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

  for (const def of TYPY_OBIEKTOW) {
    if (def.warstwy.some((id) => warstwy[id])) continue
    wylaczone[def.typ] = def.warstwy.map((id) => powody[id]).join('; ')
  }

  const zameldowania = we.wskazniki.find((x) => x.meta.id === WARSTWA_ZAMELDOWAN)
  const mieszkancy =
    zameldowania && !zameldowania.niedostepny && !zameldowania.meta.atrapa
      ? szacujMieszkancow(zameldowania.wartosci, lon, lat)
      : new Float32Array(n).fill(Number.NaN)

  return {
    n,
    lon,
    lat,
    mieszkancy,
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
  /** Szacunek zameldowanych pod adresami wychodzącymi z luki. */
  mieszkancyWychodzi: number
}

/** Szacunek zameldowanych (`szacujMieszkancow`) pod adresami ze zmianą. */
export interface MieszkancySymulacji {
  awans: number
  spadek: number
  /** Pod adresami, które wychodzą z którejkolwiek luki (adres liczony raz). */
  wychodzi: number
  /** Adresy z awansem, spadkiem albo wyjściem z luki, ale bez szacunku (np. poza Krakowem). */
  adresyBezSzacunku: number
}

export interface BilansOkolicy extends OkolicaBazy {
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
  /** Ile z obiektów to obiekty uciążliwe (`negatywny`). */
  uciazliwe: number
  mieszkancy: MieszkancySymulacji
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
  return {
    obiekty: 0,
    uciazliwe: 0,
    mieszkancy: { awans: 0, spadek: 0, wychodzi: 0, adresyBezSzacunku: 0 },
    zasieg: 0,
    awans: 0,
    spadek: 0,
    luki: [],
    okolice: [],
    heksy: new Map(),
  }
}

/** Każdy obiekt z każdą swoją dostępną warstwą (obiekt złożony daje kilka par). */
function paryObiektWarstwa(
  baza: BazaSymulacji,
  obiekty: readonly Obiekt[],
): { o: Obiekt; w: WarstwaSymulacji }[] {
  const pary: { o: Obiekt; w: WarstwaSymulacji }[] = []
  for (const o of obiekty) {
    if (!Number.isFinite(o.lon) || !Number.isFinite(o.lat)) continue
    for (const id of definicjaObiektu(o.typ)?.warstwy ?? []) {
      const w = baza.warstwy[id]
      if (w) pary.push({ o, w })
    }
  }
  return pary
}

/** Warstwa → (adres → nowy pomiar) dla adresów z danymi, którym obiekty skracają odległość. */
function nowePomiary(
  baza: BazaSymulacji,
  obiekty: readonly Obiekt[],
): Map<string, Map<number, number>> {
  const nowe = new Map<string, Map<number, number>>()
  for (const { o, w } of paryObiektWarstwa(baza, obiekty)) {
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

  return nowe
}

export function symuluj(baza: BazaSymulacji, obiekty: readonly Obiekt[]): WynikSymulacji {
  if (obiekty.length === 0) return pustyWynik()

  // 1. Nowe pomiary per warstwa: tylko adresy z danymi, którym obiekt skraca odległość.
  const nowe = nowePomiary(baza, obiekty)

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
  const mieszkancyWychodziWarstwy: Record<string, number> = {}
  const mieszkancy: MieszkancySymulacji = { awans: 0, spadek: 0, wychodzi: 0, adresyBezSzacunku: 0 }
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
    if (roznica !== 0 || wyjscia.length > 0) {
      const m = baza.mieszkancy[i] as number
      if (m === m) {
        if (roznica > 0) mieszkancy.awans += m
        if (roznica < 0) mieszkancy.spadek += m
        if (wyjscia.length > 0) mieszkancy.wychodzi += m
        for (const id of wyjscia)
          mieszkancyWychodziWarstwy[id] = (mieszkancyWychodziWarstwy[id] ?? 0) + m
      } else mieszkancy.adresyBezSzacunku++
    }

    const io = baza.indeksOkolicy[i] as number
    if (roznica !== 0 || wyjscia.length > 0) {
      let b = okolice.get(io)
      if (!b) {
        b = { ...(baza.okolice[io] as OkolicaBazy), awans: 0, spadek: 0, wychodzi: {} }
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
      mieszkancyWychodzi: mieszkancyWychodziWarstwy[id] ?? 0,
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
    uciazliwe: obiekty.filter((o) => definicjaObiektu(o.typ)?.negatywny).length,
    mieszkancy,
    zasieg: dotkniete.size,
    awans,
    spadek,
    luki,
    okolice: listaOkolic,
    heksy: heksyWynik,
  }
}

// ── Sugestia miejsca ─────────────────────────────────────────────────────────────────────

export interface SugestiaMiejsca {
  lon: number
  lat: number
  /** Wynik wariantu z dotychczasowymi obiektami i obiektem w sugerowanym miejscu. */
  wynik: WynikSymulacji
  /** Ile miejsc sprawdzono zgrubnie (środki kubełków ~250 m z adresami). */
  sprawdzone: number
}

/** Ilu najlepszych kandydatów z oceny zgrubnej liczymy pełną symulacją. */
const KANDYDACI_DOKLADNI = 12
/** Promień oceny zgrubnej warstwy bez progu – dalej zysk i tak jest mały. */
const PROMIEN_ZGRUBNY_M = 3000

const zyskWyniku = (w: WynikSymulacji) =>
  w.awans - w.spadek + w.luki.reduce((s, l) => s + l.wychodzi, 0)

/**
 * Gdzie postawić obiekt typu `typ`, żeby najwięcej adresów wyszło z luki i awansowało
 * (#98, „gdzie postawić?”). Dwa kroki: zgrubna ocena środka każdego kubełka siatki (ile adresów
 * w luce obejmie próg, ile skróci się droga w skali), potem pełna `symuluj` dla najlepszych.
 * Obiekty już postawione w wariancie się liczą – druga szkoła nie ląduje obok pierwszej.
 * Obiekt uciążliwy nie ma „najlepszego miejsca” – zwraca null.
 */
export function sugerujMiejsce(
  baza: BazaSymulacji,
  typ: TypObiektu,
  obiekty: readonly Obiekt[],
): SugestiaMiejsca | null {
  const def = definicjaObiektu(typ)
  if (!def || def.negatywny) return null
  const warstwy = def.warstwy
    .map((id) => baza.warstwy[id])
    .filter((w): w is WarstwaSymulacji => w !== undefined && w.zasiegM > 0)
  const s = baza.siatka
  if (warstwy.length === 0 || s.kolumny === 0) return null

  const obecne = nowePomiary(baza, obiekty)
  const promienie = warstwy.map((w) => w.prog?.prog ?? Math.min(w.zasiegM, PROMIEN_ZGRUBNY_M))
  const krok = Math.max(1, Math.floor(Math.max(...promienie) / 1000))

  const kandydaci: { lon: number; lat: number; ocena: number }[] = []
  for (let w = 0; w < s.wiersze; w += krok) {
    for (let k = 0; k < s.kolumny; k += krok) {
      const kub = w * s.kolumny + k
      if ((s.start[kub + 1] as number) === (s.start[kub] as number)) continue
      const lon = s.lon0 + (k + 0.5) * s.dLon
      const lat = s.lat0 + (w + 0.5) * s.dLat
      let ocena = 0
      warstwy.forEach((ws, j) => {
        const z = obecne.get(ws.id)
        const r = promienie[j] as number
        wPromieniu(baza, lon, lat, r, (i, d) => {
          const teraz = z?.get(i) ?? (ws.wartosci[i] as number)
          if (!(d < teraz)) return
          if (ws.prog) {
            if (teraz > ws.prog.prog && d <= ws.prog.prog) ocena += 1
          } else ocena += (Math.min(teraz, r) - d) / r
        })
      })
      if (ocena > 0) kandydaci.push({ lon, lat, ocena })
    }
  }
  if (kandydaci.length === 0) return null

  kandydaci.sort((a, b) => b.ocena - a.ocena)
  let najlepsza: SugestiaMiejsca | null = null
  for (const c of kandydaci.slice(0, KANDYDACI_DOKLADNI)) {
    const wynik = symuluj(baza, [...obiekty, { typ, lon: c.lon, lat: c.lat }])
    if (!najlepsza || zyskWyniku(wynik) > zyskWyniku(najlepsza.wynik)) {
      najlepsza = { lon: c.lon, lat: c.lat, wynik, sprawdzone: kandydaci.length }
    }
  }
  return najlepsza
}
