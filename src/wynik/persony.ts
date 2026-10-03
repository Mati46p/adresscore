// Persony i tryby to dane, nie UI: panel filtrów (#36) i JEV (#4x) wybierają z tej listy,
// a silnik dostaje gotowe wagi. Klucze to id wskaźników z manifestu – nieznane id
// (warstwa jeszcze nie istnieje) po prostu nie wpływa na wynik.
import type { WskaznikMeta } from '../kontrakty/index.ts'
import type { Kierunki, Wagi } from './silnik.ts'

export type PersonaId = 'rodzina' | 'singiel' | 'senior' | 'inwestor' | 'od-zera'
export type Tryb = 'kupuje' | 'wynajmuje' | 'biznes'

export const BIZNESY = [
  { id: 'sklep', nazwa: 'Sklep spożywczy', konkurencja: 'sklep_odleglosc' },
  { id: 'gastronomia', nazwa: 'Gastronomia', konkurencja: 'gastronomia_odleglosc' },
  { id: 'apteka', nazwa: 'Apteka', konkurencja: 'apteka_odleglosc' },
  { id: 'weterynarz', nazwa: 'Gabinet weterynaryjny', konkurencja: 'weterynarz_odleglosc' },
  { id: 'kwiaciarnia', nazwa: 'Kwiaciarnia', konkurencja: 'kwiaciarnia_odleglosc' },
  { id: 'kosmetyczka', nazwa: 'Salon kosmetyczny', konkurencja: 'kosmetyczka_odleglosc' },
  { id: 'silownia', nazwa: 'Siłownia lub fitness', konkurencja: 'silownia_odleglosc' },
  { id: 'restauracja', nazwa: 'Restauracja lub fast food', konkurencja: 'restauracja_odleglosc' },
  { id: 'dentysta', nazwa: 'Gabinet stomatologiczny', konkurencja: 'dentysta_odleglosc' },
  { id: 'optyk', nazwa: 'Optyk', konkurencja: 'optyk_odleglosc' },
  { id: 'drogeria', nazwa: 'Drogeria', konkurencja: 'drogeria_odleglosc' },
  { id: 'cukiernia', nazwa: 'Cukiernia', konkurencja: 'cukiernia_odleglosc' },
  { id: 'mieso', nazwa: 'Sklep mięsny', konkurencja: 'mieso_odleglosc' },
  { id: 'warzywniak', nazwa: 'Warzywniak', konkurencja: 'warzywniak_odleglosc' },
  { id: 'pralnia', nazwa: 'Pralnia', konkurencja: 'pralnia_odleglosc' },
  { id: 'zoologiczny', nazwa: 'Sklep zoologiczny', konkurencja: 'zoologiczny_odleglosc' },
  { id: 'bar', nazwa: 'Bar lub pub', konkurencja: 'bar_odleglosc' },
  { id: 'lodziarnia', nazwa: 'Lodziarnia', konkurencja: 'lodziarnia_odleglosc' },
] as const
export type RodzajBiznesu = (typeof BIZNESY)[number]['id']
export const RODZAJ_BIZNESU_DOMYSLNY: RodzajBiznesu = 'sklep'
export const WARSTWY_BIZNESU = [...BIZNESY.map((b) => b.konkurencja), 'ludnosc_1km'] as const
export function warstwyBiznesu(rodzaj: RodzajBiznesu): readonly string[] {
  return [BIZNESY.find((b) => b.id === rodzaj)?.konkurencja ?? 'sklep_odleglosc', 'ludnosc_1km']
}

export interface Persona {
  id: PersonaId
  nazwa: string
  opis: string
  wagi: Wagi
  /** Kierunek dla warstw neutralnych, które persona chce liczyć (np. pozwolenia na budowę). */
  kierunki?: Kierunki
  /** Waga dla nowych warstw, których profil jeszcze nie uwzględnia. */
  wagaNowych: number
}

export const PERSONY: readonly Persona[] = [
  {
    id: 'rodzina',
    nazwa: 'Rodzina z dziećmi',
    opis: 'Szkoła, przedszkole i żłobek blisko; zieleń, cisza i bezpieczeństwo',
    wagi: {
      sklep_odleglosc: 3,
      apteka_odleglosc: 2,
      przychodnia_odleglosc: 2,
      zlobek_odleglosc: 3,
      przedszkole_odleglosc: 4,
      szkola_podst_odleglosc: 4,
      szkola_podst_wynik_e8: 1,
      plac_zabaw_odleglosc: 3,
      biblioteka_1200m: 1,
      obnizone_krawezniki_300m: 1,
      przystanek_odleglosc: 3,
      kursy_szczyt_h: 2,
      kolej_punktualnosc: 1,
      halas_ldwn: 4,
      pm25_srednia: 3,
      zielen_worldcover_100m: 4,
      zielen_udzial: 1,
      inwestycje_500m: 1,
      powodz_10proc: 3,
      teren_osuwiskowy: 2,
      emitent_odleglosc: 2,
      nfz_kolejki_dni: 1,
    },
    // Budowa obok to hałas i ruch ciężarówek przez lata.
    kierunki: { inwestycje_500m: 'mniej-lepiej' },
    wagaNowych: 0,
  },
  {
    id: 'singiel',
    nazwa: 'Singiel w centrum',
    opis: 'Częste kursy, szybki dojazd i codzienne usługi blisko',
    wagi: {
      sklep_odleglosc: 3,
      gastronomia_odleglosc: 2,
      kultura_odleglosc: 2,
      paczkomat_odleglosc: 2,
      przystanek_odleglosc: 4,
      kursy_szczyt_h: 4,
      rynek_czas_min: 4,
      kolej_odleglosc: 2,
      kolej_punktualnosc: 2,
      rower_infrastruktura_odleglosc: 3,
      stojaki_300m: 2,
      halas_ldwn: 1,
      pm25_srednia: 2,
      zielen_worldcover_100m: 1,
      powodz_10proc: 2,
    },
    wagaNowych: 0,
  },
  {
    id: 'senior',
    nazwa: 'Senior',
    opis: 'Przychodnia i apteka blisko, dostępna droga piesza, cisza i transport',
    wagi: {
      sklep_odleglosc: 4,
      apteka_odleglosc: 4,
      przychodnia_odleglosc: 4,
      przychodnia_bez_barier_odleglosc: 2,
      cas_odleglosc: 3,
      lawki_300m: 3,
      obnizone_krawezniki_300m: 3,
      nfz_kolejki_dni: 2,
      przystanek_odleglosc: 4,
      kursy_szczyt_h: 3,
      halas_ldwn: 3,
      pm25_srednia: 3,
      zielen_worldcover_100m: 2,
      powodz_10proc: 3,
      teren_osuwiskowy: 2,
      oswietlenie_100m: 1,
    },
    wagaNowych: 0,
  },
  {
    id: 'inwestor',
    nazwa: 'Inwestor',
    opis: 'Dostępność transportu, pozwolenia na budowę i podstawowe ryzyka',
    wagi: {
      sklep_odleglosc: 2,
      przystanek_odleglosc: 3,
      kursy_szczyt_h: 3,
      rynek_czas_min: 3,
      kolej_odleglosc: 2,
      halas_ldwn: 1,
      pm25_srednia: 1,
      zielen_worldcover_100m: 1,
      inwestycje_500m: 4,
      gmina_inwestycje_pc: 1,
      mpzp_status: 1,
      gmina_dlug_pc: 1,
      powodz_10proc: 4,
      teren_osuwiskowy: 3,
    },
    // Nowe pozwolenia = okolica rośnie, ceny pójdą w górę.
    kierunki: { inwestycje_500m: 'wiecej-lepiej' },
    wagaNowych: 0,
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
  { id: 'kupuje', nazwa: 'Kupuję', opis: 'Na lata: liczy się bezpieczeństwo i ryzyko' },
  { id: 'wynajmuje', nazwa: 'Wynajmuję', opis: 'Na teraz: liczy się dojazd i codzienność' },
  {
    id: 'biznes',
    nazwa: 'Miejsca do założenia biznesu',
    opis: 'Wybierz rodzaj usług: konkurencja i liczba mieszkańców',
  },
]

// Kupujący zostaje na dekady, więc mocniej waży to, co się zmieni i co może zalać mieszkanie.
// Najemca może się wyprowadzić – waży bieżący dojazd. Zmiana działa tylko na wagi > 0,
// żeby „Od zera" zostało puste.
export const MODYFIKATORY_TRYBU: Readonly<
  Record<Tryb, Partial<Record<WskaznikMeta['kategoria'], number>>>
> = {
  kupuje: { bezpieczenstwo: 1 },
  wynajmuje: { transport: 1 },
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
    Partial<Pick<WskaznikMeta, 'atrapa' | 'domyslnaWaga'>>)[],
  rodzajBiznesu: RodzajBiznesu = RODZAJ_BIZNESU_DOMYSLNY,
): { wagi: Record<string, number>; kierunki: Kierunki } {
  if (tryb === 'biznes') {
    const rzeczywiste = new Set(wskazniki.filter((w) => !w.atrapa).map((w) => w.id))
    const wagi = Object.fromEntries(wskazniki.map((w) => [w.id, 0]))
    const kierunki: Record<string, Kierunki[string]> = {}
    for (const id of warstwyBiznesu(rodzajBiznesu)) {
      if (!rzeczywiste.has(id)) continue
      wagi[id] = 4
      kierunki[id] = 'wiecej-lepiej'
    }
    return { wagi, kierunki }
  }
  const persona = znajdzPersone(personaId) ?? (PERSONY[0] as Persona)
  const wagi: Record<string, number> = {}
  const kierunki: Record<string, Kierunki[string]> = {}
  for (const { id, kategoria, domyslnaWaga } of wskazniki) {
    if (kategoria === 'kontekst') {
      wagi[id] = 0
      continue
    }
    let w = persona.wagi[id] ?? domyslnaWaga ?? persona.wagaNowych
    if (w > 0) w = Math.min(Math.max(w + (MODYFIKATORY_TRYBU[tryb][kategoria] ?? 0), 1), 4)
    wagi[id] = w
    const k = persona.kierunki?.[id]
    if (k) kierunki[id] = k
  }
  return { wagi, kierunki }
}
