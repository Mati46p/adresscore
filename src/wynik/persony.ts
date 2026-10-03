// Persony i tryby to dane, nie UI: panel filtrów (#36) i JEV (#4x) wybierają z tej listy,
// a silnik dostaje gotowe wagi. Klucze to id wskaźników z manifestu – nieznane id
// (warstwa jeszcze nie istnieje) po prostu nie wpływa na wynik.
import type { WskaznikMeta } from '../kontrakty/index.ts'
import type { Kierunki, Wagi } from './silnik.ts'

export type PersonaId = 'rodzina' | 'singiel' | 'senior' | 'inwestor' | 'od-zera'
export type Tryb = 'kupuje' | 'wynajmuje' | 'biznes'

/** Warstwy mające sens przy wyborze miejsca na sklep spożywczy. */
export const WARSTWY_BIZNESU = ['sklep_odleglosc', 'ludnosc_1km'] as const

export interface Persona {
  id: PersonaId
  nazwa: string
  opis: string
  wagi: Wagi
  /** Kierunek dla warstw neutralnych, które persona chce liczyć (np. pozwolenia na budowę). */
  kierunki?: Kierunki
  /** Waga dla warstw z manifestu, których persona jeszcze nie zna. */
  wagaNowych: number
}

export const PERSONY: readonly Persona[] = [
  {
    id: 'rodzina',
    nazwa: 'Rodzina z dziećmi',
    opis: 'Zieleń, cisza, czyste powietrze, sklep blisko',
    wagi: {
      sklep_odleglosc: 3,
      przystanek_odleglosc: 3,
      halas_ldwn: 3,
      pm25_srednia: 3,
      zielen_udzial: 4,
      inwestycje_500m: 1,
      powodz_1proc: 2,
    },
    // Budowa obok to hałas i ruch ciężarówek przez lata.
    kierunki: { inwestycje_500m: 'mniej-lepiej' },
    wagaNowych: 2,
  },
  {
    id: 'singiel',
    nazwa: 'Singiel w centrum',
    opis: 'Komunikacja i sklepy pod ręką',
    wagi: {
      sklep_odleglosc: 4,
      przystanek_odleglosc: 4,
      halas_ldwn: 1,
      pm25_srednia: 2,
      zielen_udzial: 2,
      inwestycje_500m: 0,
      powodz_1proc: 1,
    },
    wagaNowych: 2,
  },
  {
    id: 'senior',
    nazwa: 'Senior',
    opis: 'Cisza, powietrze, przystanek blisko',
    wagi: {
      sklep_odleglosc: 3,
      przystanek_odleglosc: 3,
      halas_ldwn: 4,
      pm25_srednia: 4,
      zielen_udzial: 3,
      inwestycje_500m: 1,
      powodz_1proc: 2,
    },
    kierunki: { inwestycje_500m: 'mniej-lepiej' },
    wagaNowych: 2,
  },
  {
    id: 'inwestor',
    nazwa: 'Inwestor',
    opis: 'Rozwój okolicy, komunikacja, niskie ryzyko',
    wagi: {
      sklep_odleglosc: 2,
      przystanek_odleglosc: 4,
      halas_ldwn: 1,
      pm25_srednia: 1,
      zielen_udzial: 1,
      inwestycje_500m: 4,
      powodz_1proc: 3,
    },
    // Nowe pozwolenia = okolica rośnie, ceny pójdą w górę.
    kierunki: { inwestycje_500m: 'wiecej-lepiej' },
    wagaNowych: 1,
  },
  {
    id: 'od-zera',
    nazwa: 'Od zera',
    opis: 'Wszystkie wagi na 0 – ustaw sam',
    wagi: {},
    wagaNowych: 0,
  },
]

export const PERSONA_DOMYSLNA: PersonaId = 'rodzina'
export const TRYB_DOMYSLNY: Tryb = 'kupuje'

export const TRYBY: readonly { id: Tryb; nazwa: string; opis: string }[] = [
  { id: 'kupuje', nazwa: 'Kupuję', opis: 'Na lata: liczy się przyszłość okolicy i ryzyko' },
  { id: 'wynajmuje', nazwa: 'Wynajmuję', opis: 'Na teraz: liczy się dojazd i codzienność' },
  {
    id: 'biznes',
    nazwa: 'Miejsca do założenia biznesu',
    opis: 'Wybierz branżę: konkurencja i lokalny popyt',
  },
]

// Kupujący zostaje na dekady, więc mocniej waży to, co się zmieni i co może zalać mieszkanie.
// Najemca może się wyprowadzić – waży bieżący dojazd. Zmiana działa tylko na wagi > 0,
// żeby „Od zera" zostało puste.
export const MODYFIKATORY_TRYBU: Readonly<
  Record<Tryb, Partial<Record<WskaznikMeta['kategoria'], number>>>
> = {
  kupuje: { przyszlosc: 1, bezpieczenstwo: 1 },
  wynajmuje: { przyszlosc: -1, transport: 1 },
  biznes: {},
}

export function znajdzPersone(id: string | null | undefined): Persona | undefined {
  return PERSONY.find((p) => p.id === id)
}

/**
 * Wagi i kierunki persony dopasowane do żywych warstw z manifestu.
 * Profile mieszkaniowe dają kontekstowi 0; biznes jawnie ocenia ludność NSP 2021.
 */
export function ustawieniaPersony(
  personaId: PersonaId,
  tryb: Tryb,
  wskazniki: readonly (Pick<WskaznikMeta, 'id' | 'kategoria'> &
    Partial<Pick<WskaznikMeta, 'atrapa'>>)[],
): { wagi: Record<string, number>; kierunki: Kierunki } {
  if (tryb === 'biznes') {
    const rzeczywiste = new Set(wskazniki.filter((w) => !w.atrapa).map((w) => w.id))
    const wagi = Object.fromEntries(wskazniki.map((w) => [w.id, 0]))
    const kierunki: Record<string, Kierunki[string]> = {}
    for (const id of WARSTWY_BIZNESU) {
      if (!rzeczywiste.has(id)) continue
      wagi[id] = 4
      kierunki[id] = 'wiecej-lepiej'
    }
    return { wagi, kierunki }
  }
  const persona = znajdzPersone(personaId) ?? (PERSONY[0] as Persona)
  const wagi: Record<string, number> = {}
  const kierunki: Record<string, Kierunki[string]> = {}
  for (const { id, kategoria } of wskazniki) {
    if (kategoria === 'kontekst') {
      wagi[id] = 0
      continue
    }
    let w = persona.wagi[id] ?? persona.wagaNowych
    if (w > 0) w = Math.min(Math.max(w + (MODYFIKATORY_TRYBU[tryb][kategoria] ?? 0), 1), 4)
    wagi[id] = w
    const k = persona.kierunki?.[id]
    if (k) kierunki[id] = k
  }
  return { wagi, kierunki }
}
