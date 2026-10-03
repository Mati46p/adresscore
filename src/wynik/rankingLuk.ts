// Ranking okolic „Gdzie miasto ma luki” (#91) – czysta logika panelu z `src/karta/luki`.
// Dane bierze z `policzLuki` (#89), tu tylko kolejność, teksty i szerokości pasków.
//
// Zasady:
// - Bez numerów miejsc: kierunek rankingu stoi słowami w nagłówku („najwięcej adresów …”).
// - Pasek udziału = % adresów jednostki (podstawa = wszystkie jej adresy), nie % największej pozycji.
// - Jednostka bez żadnych danych (`udzial: null`) jest szara i stoi na końcu przy obu sortowaniach.
// - Suma kolumny „w luce” = liczba w nagłówku panelu (pilnuje tego rankingLuk.test.ts).
import type { WskaznikMeta } from '../kontrakty/index.ts'
import type { LukaOkolicy, ProgLuki, WynikLuk } from './luki.ts'

export type SortowanieLuk = 'liczba' | 'udzial'

const LICZBA = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })

/** Pełna liczba po polsku („12 345”), bez skrótów typu „12 tys.”. */
export function liczbaPelna(n: number): string {
  return LICZBA.format(n)
}

/** Odmiana po liczebniku: 1 adres, 2 adresy, 5 adresów, 22 adresy, 112 adresów. */
export function odmianaAdresow(n: number): 'adres' | 'adresy' | 'adresów' {
  if (n === 1) return 'adres'
  const j = n % 10
  const d = n % 100
  return j >= 2 && j <= 4 && (d < 12 || d > 14) ? 'adresy' : 'adresów'
}

/** Podstawa udziału: „z 1 adresu”, „z 4210 adresów”. */
export function podstawaUdzialu(wszystkie: number): string {
  return `z ${liczbaPelna(wszystkie)} ${wszystkie === 1 ? 'adresu' : 'adresów'}`
}

/**
 * Udział w procentach do wyświetlenia albo null (szary brak danych). Zaokrąglenie nie może
 * kłamać: kilka adresów w luce to „<1%”, nie „0%”, a prawie wszystkie to „>99%”, nie „100%”.
 */
export function procentUdzialu(udzial: number | null): string | null {
  if (udzial === null || Number.isNaN(udzial)) return null
  const p = Math.round(udzial * 100)
  if (p === 0 && udzial > 0) return '<1%'
  if (p === 100 && udzial < 1) return '>99%'
  return `${p}%`
}

/** „bez przystanku w 500 m” z nagłówka progu „adresy bez przystanku w 500 m”. */
export function ogonNaglowka(prog: Pick<ProgLuki, 'naglowek'>): string {
  return prog.naglowek.replace(/^adresy\s+/, '')
}

/** Kierunek rankingu słowami – zamiast numerów miejsc, które niosą ocenę. */
export function kierunekRankingu(
  prog: Pick<ProgLuki, 'naglowek'>,
  sortowanie: SortowanieLuk,
): string {
  const ogon = ogonNaglowka(prog)
  return sortowanie === 'liczba'
    ? `Od góry: najwięcej adresów ${ogon}`
    : `Od góry: największy udział adresów ${ogon}`
}

export interface PasekLuki {
  /** Szerokość części „w luce” w % adresów jednostki (0–100). */
  wLuce: number
  /** Szerokość szarej części „brak danych” w % adresów jednostki (0–100). */
  brakDanych: number
}

/** Pasek skalowany do 100% jednostki: pełna szerokość = wszystkie adresy okolicy. */
export function pasekLuki(l: Pick<LukaOkolicy, 'wLuce' | 'brakDanych' | 'wszystkie'>): PasekLuki {
  if (l.wszystkie <= 0) return { wLuce: 0, brakDanych: 0 }
  const proc = (x: number) => Math.min(100, Math.max(0, (x / l.wszystkie) * 100))
  return { wLuce: proc(l.wLuce), brakDanych: proc(l.brakDanych) }
}

/** Nowa tablica okolic w kolejności rankingu; wejście zostaje bez zmian. */
export function posortujOkolice(
  okolice: readonly LukaOkolicy[],
  sortowanie: SortowanieLuk,
): LukaOkolicy[] {
  const nazwa = (a: LukaOkolicy, b: LukaOkolicy) => a.nazwa.localeCompare(b.nazwa, 'pl')
  return [...okolice].sort((a, b) => {
    // Szare (bez żadnych danych) zawsze na końcu – nie udają „zera luk”.
    const szaryA = a.udzial === null
    const szaryB = b.udzial === null
    if (szaryA !== szaryB) return szaryA ? 1 : -1
    if (szaryA) return nazwa(a, b)
    if (sortowanie === 'udzial') {
      return (b.udzial as number) - (a.udzial as number) || b.wLuce - a.wLuce || nazwa(a, b)
    }
    return b.wLuce - a.wLuce || (b.udzial as number) - (a.udzial as number) || nazwa(a, b)
  })
}

export interface WierszLuki {
  /** `okolicaAdresu(...).id` – to samo id dostaje mapa (#90) jako `okolicaDoPokazania`. */
  id: string
  nazwa: string
  typ: LukaOkolicy['typ']
  wLuce: number
  wszystkie: number
  brakDanych: number
  udzial: number | null
  /** „17%”, „<1%” albo null (szary brak danych). */
  procent: string | null
  /** „z 4210 adresów”. */
  podstawa: string
  pasek: PasekLuki
}

export interface NaglowekLuk {
  /** Liczba w nagłówku panelu – adresy w luce w całym obszarze. */
  wLuce: number
  wszystkie: number
  brakDanych: number
  udzial: number | null
  procent: string | null
  /** „adresów bez przystanku w 500 m” – podpis po liczbie, z odmianą. */
  podpis: string
  /** „z 70 217 adresów”. */
  podstawa: string
}

export interface RankingLuk {
  naglowek: NaglowekLuk
  /** „Od góry: najwięcej adresów bez przystanku w 500 m”. */
  kierunek: string
  wiersze: WierszLuki[]
}

export function rankingLuk(
  wynik: Pick<WynikLuk, 'prog' | 'razem' | 'okolice'>,
  sortowanie: SortowanieLuk,
): RankingLuk {
  const { razem, prog } = wynik
  return {
    naglowek: {
      wLuce: razem.wLuce,
      wszystkie: razem.wszystkie,
      brakDanych: razem.brakDanych,
      udzial: razem.udzial,
      procent: procentUdzialu(razem.udzial),
      podpis: `${odmianaAdresow(razem.wLuce)} ${ogonNaglowka(prog)}`,
      podstawa: podstawaUdzialu(razem.wszystkie),
    },
    kierunek: kierunekRankingu(prog, sortowanie),
    wiersze: posortujOkolice(wynik.okolice, sortowanie).map((o) => ({
      id: o.id,
      nazwa: o.nazwa,
      typ: o.typ,
      wLuce: o.wLuce,
      wszystkie: o.wszystkie,
      brakDanych: o.brakDanych,
      udzial: o.udzial,
      procent: procentUdzialu(o.udzial),
      podstawa: podstawaUdzialu(o.wszystkie),
      pasek: pasekLuki(o),
    })),
  }
}

/** Suma kolumny „w luce” – musi się równać `naglowek.wLuce`. */
export function sumaWLuce(wiersze: readonly Pick<WierszLuki, 'wLuce'>[]): number {
  let s = 0
  for (const w of wiersze) s += w.wLuce
  return s
}

const NAZWY_ROZDZIELCZOSCI: Record<WskaznikMeta['rozdzielczosc'], string> = {
  adres: 'adres',
  budynek: 'budynek',
  heks: 'heks',
  siatka: 'siatka',
  rejon: 'rejon',
  gmina: 'gmina',
  powiat: 'powiat',
}

/** „adres”, „heks 1 km”, „rejon wielokąt pasma mapy akustycznej”. */
export function rozdzielczoscWarstwy(meta: Pick<WskaznikMeta, 'rozdzielczosc' | 'rozmiar'>) {
  const nazwa = NAZWY_ROZDZIELCZOSCI[meta.rozdzielczosc]
  return meta.rozmiar && meta.rozmiar !== nazwa ? `${nazwa} ${meta.rozmiar}` : nazwa
}

/** Źródła warstwy z datą stanu danych: „ZTP Kraków GTFS A (2026-09-30) · …”. */
export function zrodlaWarstwy(meta: Pick<WskaznikMeta, 'zrodla'>): string {
  if (meta.zrodla.length === 0) return 'brak opisu źródła'
  return meta.zrodla
    .map((z) => (z.dataDanych ? `${z.nazwa} (stan ${z.dataDanych})` : z.nazwa))
    .join(' · ')
}
