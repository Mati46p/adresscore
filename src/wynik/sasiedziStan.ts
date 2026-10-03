// Jeden wspólny stan „Lepszego sąsiada” (#94) dla sekcji na karcie i znaczników na mapie (#95).
// Wzorzec jak w stan.ts: obiekt niemutowalny + subskrybenci. Lista kandydatów nie jest
// kopiowana do stanu, tylko liczona z `lepsiSasiedzi` (#93) z bieżącymi wagami i filtrami –
// dzięki temu zmiana wagi przelicza ją wszędzie naraz. Pamięć ostatniego wyniku jest w module.
// Plik czysty (bez dane.ts), więc testy biegną na gołym `node --test`. Hooki: useSasiedzi.ts.
import { useSyncExternalStore } from 'react'
import type { Adres } from '../kontrakty/index.ts'
import type { TwardyFiltr } from './filtry.ts'
import {
  type AdresSasiada,
  type LepsiSasiedzi,
  lepsiSasiedzi,
  type OpcjeSasiadow,
  PROMIEN_SASIADA_M,
} from './sasiedzi.ts'
import type { Kierunki, Litera, Wagi, WskaznikPrzygotowany } from './silnik.ts'
import { dodajDoPorownania, pobierzStan, pokazOkolice, przejdz } from './stan.ts'
import { MAKS_POROWNANIE } from './url.ts'

export interface StanSasiadow {
  /** Indeks adresu, dla którego sekcja jest otwarta; null = sekcja zamknięta. */
  zrodlo: number | null
  /** Pozycja podświetlonego kandydata na liście `kandydaci` (0, 1, 2); null = żaden. */
  wybrany: number | null
}

let stan: StanSasiadow = { zrodlo: null, wybrany: null }
const sluchacze = new Set<() => void>()

export function pobierzStanSasiadow(): StanSasiadow {
  return stan
}

export function subskrybujSasiadow(sluchacz: () => void): () => void {
  sluchacze.add(sluchacz)
  return () => sluchacze.delete(sluchacz)
}

function zmien(latka: Partial<StanSasiadow>) {
  const nowy = { ...stan, ...latka }
  if (nowy.zrodlo === stan.zrodlo && nowy.wybrany === stan.wybrany) return
  stan = nowy
  for (const s of sluchacze) s()
}

/** Selektor jak w `useStan`: zwraca pole albo prymityw, nigdy nowy obiekt. */
export function useStanSasiadow<T>(selektor: (s: StanSasiadow) => T): T {
  return useSyncExternalStore(
    subskrybujSasiadow,
    () => selektor(stan),
    () => selektor(stan),
  )
}

// ── Akcje ────────────────────────────────────────────────────────────────────────────────

export function otworzSasiadow(i: number) {
  zmien({ zrodlo: i, wybrany: null })
}

/** Zamknięcie czyści kandydatów i podświetlenie – znaczniki na mapie znikają. */
export function zamknijSasiadow() {
  zmien({ zrodlo: null, wybrany: null })
}

export function przelaczSasiadow(i: number) {
  if (stan.zrodlo === i) zamknijSasiadow()
  else otworzSasiadow(i)
}

/** Podświetla kandydata na pozycji `k` listy (karta i mapa naraz); null zdejmuje podświetlenie. */
export function wybierzSasiada(k: number | null) {
  zmien({ wybrany: k })
}

/** „Otwórz kartę”: zamyka sekcję (znaczniki znikają) i otwiera kartę kandydata. */
export function otworzKarteSasiada(adres: number) {
  zamknijSasiadow()
  pokazOkolice(adres)
}

export type WynikPorownania = 'dodano' | 'pelne'

/**
 * „Porównaj”: dodaje adres wyjściowy i kandydata do Porównania (#48) i przechodzi na ten ekran.
 * Gdy oba się nie mieszczą (limit 5), nic nie zmienia i zwraca `'pelne'` – karta mówi dlaczego.
 */
export function porownajZSasiadem(zrodlo: number, adres: number): WynikPorownania {
  const obecne = pobierzStan().porownanie
  const brakujace = [zrodlo, adres].filter((i, k, t) => !obecne.includes(i) && t.indexOf(i) === k)
  if (obecne.length + brakujace.length > MAKS_POROWNANIE) return 'pelne'
  for (const i of brakujace) dodajDoPorownania(i)
  przejdz('porownanie')
  return 'dodano'
}

// ── Lista kandydatów ─────────────────────────────────────────────────────────────────────

export interface WejscieSasiadow {
  adresy: readonly AdresSasiada[]
  wskazniki: readonly WskaznikPrzygotowany[]
  wagi: Wagi
  kierunki: Kierunki
  filtry: readonly TwardyFiltr[]
  opcje?: OpcjeSasiadow
}

let pamiec: { i: number; wejscie: WejscieSasiadow; wynik: LepsiSasiedzi } | null = null

/**
 * `lepsiSasiedzi` z pamięcią ostatniego wywołania: karta i mapa pytają naraz o to samo, a nowe
 * wagi albo filtry (nowe obiekty w stanie aplikacji) liczą listę od nowa.
 */
export function policzSasiadow(i: number, w: WejscieSasiadow): LepsiSasiedzi {
  const p = pamiec
  if (
    p &&
    p.i === i &&
    p.wejscie.adresy === w.adresy &&
    p.wejscie.wskazniki === w.wskazniki &&
    p.wejscie.wagi === w.wagi &&
    p.wejscie.kierunki === w.kierunki &&
    p.wejscie.filtry === w.filtry &&
    p.wejscie.opcje === w.opcje
  ) {
    return p.wynik
  }
  const wynik = lepsiSasiedzi(
    i,
    w.adresy,
    w.wskazniki,
    { wagi: w.wagi, kierunki: w.kierunki, filtry: w.filtry },
    w.opcje,
  )
  pamiec = { i, wejscie: w, wynik }
  return wynik
}

/**
 * Wynik dla otwartej sekcji albo null, gdy sekcja jest zamknięta albo otwarta dla innego
 * adresu niż wybrany (np. po kliknięciu innego adresu na mapie).
 */
export function sasiedziOtwartej(
  s: StanSasiadow,
  wybranyAdres: number | null,
  w: WejscieSasiadow | null,
): LepsiSasiedzi | null {
  if (s.zrodlo === null || s.zrodlo !== wybranyAdres || !w) return null
  return policzSasiadow(s.zrodlo, w)
}

/** Podświetlenie, które nadal wskazuje istniejącego kandydata (lista mogła się skrócić). */
export function wybranyKandydat(s: StanSasiadow, wynik: LepsiSasiedzi | null): number | null {
  if (!wynik || s.wybrany === null) return null
  return s.wybrany >= 0 && s.wybrany < wynik.kandydaci.length ? s.wybrany : null
}

// ── Propsy dla mapy (#95) ────────────────────────────────────────────────────────────────

export interface KandydatMapy {
  /** Indeks adresu w adresy.json (do `pokazOkolice`). */
  adres: number
  lon: number
  lat: number
  litera: Litera
  /** „ul. Długa 12, Kraków” – do podpisu znacznika po najechaniu. */
  etykieta: string
}

export interface PropsSasiadowMapy {
  /** Pusta lista = sekcja zamknięta albo brak lepszych sąsiadów: mapa nic nie rysuje. */
  kandydaci: readonly KandydatMapy[]
  /** Adres wyjściowy – środek okręgu; null = sekcja zamknięta. */
  srodek: { lon: number; lat: number } | null
  promienM: number
  /** Pozycja podświetlonego kandydata w `kandydaci`; null = żaden. */
  wybrany: number | null
  /** Podświetla kandydata `k` (pozycja w `kandydaci`) na karcie i mapie; null zdejmuje. */
  onWybierz: (k: number | null) => void
  /** Otwiera kartę kandydata `k` (pozycja w `kandydaci`) i zamyka sekcję. */
  onOtworz: (k: number) => void
}

/** Etykieta adresu jak `opisAdresu` w karcie (ulica bywa null na wsiach). */
export function etykietaAdresu(a: Pick<Adres, 'ulica' | 'nr' | 'miejscowosc'>): string {
  return a.ulica ? `${a.ulica} ${a.nr}, ${a.miejscowosc}` : `${a.miejscowosc} ${a.nr}`
}

const BRAK_KANDYDATOW: readonly KandydatMapy[] = []
// Ta sama lista dla tego samego wyniku – mapa nie przerysowuje znaczników przy każdym renderze.
let pamiecMapy: { wynik: LepsiSasiedzi; kandydaci: readonly KandydatMapy[] } | null = null

function kandydaciMapy(
  wynik: LepsiSasiedzi | null,
  adresy: readonly AdresSasiada[],
): readonly KandydatMapy[] {
  if (!wynik || wynik.kandydaci.length === 0) return BRAK_KANDYDATOW
  if (pamiecMapy?.wynik === wynik) return pamiecMapy.kandydaci
  const kandydaci = wynik.kandydaci.flatMap((k) => {
    const a = adresy[k.i]
    return a
      ? [{ adres: k.i, lon: a.lon, lat: a.lat, litera: k.litera, etykieta: etykietaAdresu(a) }]
      : []
  })
  pamiecMapy = { wynik, kandydaci }
  return kandydaci
}

function wybierzZMapy(k: number | null) {
  wybierzSasiada(k)
}

/** Czyste złożenie propsów mapy; hook `usePropsSasiadowMapy` (useSasiedzi.ts) woła to z danymi. */
export function propsSasiadowMapy(
  s: StanSasiadow,
  wynik: LepsiSasiedzi | null,
  adresy: readonly AdresSasiada[],
): PropsSasiadowMapy {
  const zrodlo = wynik ? adresy[wynik.wyjsciowy.i] : undefined
  const kandydaci = zrodlo ? kandydaciMapy(wynik, adresy) : BRAK_KANDYDATOW
  return {
    kandydaci,
    srodek: zrodlo ? { lon: zrodlo.lon, lat: zrodlo.lat } : null,
    promienM: PROMIEN_SASIADA_M,
    wybrany: wybranyKandydat(s, wynik),
    onWybierz: wybierzZMapy,
    onOtworz: (k) => {
      const kandydat = kandydaci[k]
      if (kandydat) otworzKarteSasiada(kandydat.adres)
    },
  }
}
