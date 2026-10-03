// Stan aplikacji bez biblioteki: jeden obiekt niemutowalny + subskrybenci, czytany przez
// useSyncExternalStore. Wystarcza na kilka pól, a równoległe okna nie dokładają zależności.
// Hash URL trzyma to, co warto udostępnić linkiem: ekran, wybrany adres, persona, tryb, porównanie.

import { useSyncExternalStore } from 'react'
import type { WskaznikMeta } from '@/kontrakty'
import {
  PERSONA_DOMYSLNA,
  type PersonaId,
  TRYB_DOMYSLNY,
  type Tryb,
  ustawieniaPersony,
} from './persony.ts'
import type { KierunekOceny, Kierunki } from './silnik.ts'
import { czytajHash, type Ekran, MAKS_POROWNANIE, type StanUrl, zapiszHash } from './url.ts'

/** `'wynik'` = wynik łączny; inaczej id wskaźnika pokazywanego na mapie. */
export type WarstwaMapy = 'wynik' | (string & {})

export interface StanAplikacji {
  ekran: Ekran
  tryb: Tryb
  /** `'wlasna'` po ręcznej zmianie którejkolwiek wagi. */
  persona: PersonaId | 'wlasna'
  /** Wagi 0–4 per id wskaźnika. */
  wagi: Readonly<Record<string, number>>
  /** Nadpisane kierunki (makieta: ↑ ↓ ≈); brak klucza = kierunek z meta. */
  kierunki: Kierunki
  /** Indeks wybranego adresu w adresy.json albo null. */
  wybrany: number | null
  /** Indeksy adresów do porównania, najwyżej 5. */
  porownanie: readonly number[]
  warstwa: WarstwaMapy
}

let stan: StanAplikacji = {
  ekran: 'szukaj',
  tryb: TRYB_DOMYSLNY,
  persona: PERSONA_DOMYSLNA,
  wagi: {},
  kierunki: {},
  wybrany: null,
  porownanie: [],
  warstwa: 'wynik',
}

const sluchacze = new Set<() => void>()

// Słownik id ↔ indeks dostajemy dopiero po wczytaniu adresów. Do tego czasu id z URL czekają.
let idAdresow: readonly string[] | null = null
let indeksPoId = new Map<string, number>()
let metaWskaznikow: readonly Pick<WskaznikMeta, 'id' | 'kategoria'>[] = []
let oczekujacyUrl: StanUrl | null = null

export function pobierzStan(): StanAplikacji {
  return stan
}

export function subskrybuj(sluchacz: () => void): () => void {
  sluchacze.add(sluchacz)
  return () => sluchacze.delete(sluchacz)
}

function zmien(latka: Partial<StanAplikacji>) {
  const poprzedni = stan
  stan = { ...stan, ...latka }
  zapiszDoUrl(poprzedni)
  for (const s of sluchacze) s()
}

/**
 * Hook ze selektorem. Selektor musi zwracać wartość stabilną (pole stanu albo prymityw),
 * nie nowy obiekt – inaczej React wpadnie w pętlę renderów.
 */
export function useStan<T>(selektor: (s: StanAplikacji) => T): T {
  return useSyncExternalStore(
    subskrybuj,
    () => selektor(stan),
    () => selektor(stan),
  )
}

// ── Akcje ────────────────────────────────────────────────────────────────────────────────

export function wybierzPersone(persona: PersonaId) {
  const { wagi, kierunki } = ustawieniaPersony(persona, stan.tryb, metaWskaznikow)
  zmien({ persona, wagi, kierunki })
}

export function ustawTryb(tryb: Tryb) {
  if (stan.persona === 'wlasna') return zmien({ tryb })
  const { wagi, kierunki } = ustawieniaPersony(stan.persona, tryb, metaWskaznikow)
  zmien({ tryb, wagi, kierunki })
}

export function ustawWage(id: string, waga: number) {
  zmien({
    wagi: { ...stan.wagi, [id]: Math.min(Math.max(Math.round(waga), 0), 4) },
    persona: 'wlasna',
  })
}

/** null przywraca kierunek z meta wskaźnika. */
export function ustawKierunek(id: string, kierunek: KierunekOceny | null) {
  const kierunki = { ...stan.kierunki }
  if (kierunek) kierunki[id] = kierunek
  else delete kierunki[id]
  zmien({ kierunki, persona: 'wlasna' })
}

/** Zaznacza adres bez zmiany ekranu (np. klik w mapę na ekranie Szukaj). */
export function wybierzAdres(i: number | null) {
  zmien({ wybrany: i })
}

/** Zaznacza adres i otwiera kartę okolicy. */
export function pokazOkolice(i: number) {
  zmien({ wybrany: i, ekran: 'okolica' })
}

export function przejdz(ekran: Ekran) {
  zmien({ ekran })
}

export function dodajDoPorownania(i: number) {
  if (stan.porownanie.includes(i) || stan.porownanie.length >= MAKS_POROWNANIE) return
  zmien({ porownanie: [...stan.porownanie, i] })
}

export function usunZPorownania(i: number) {
  zmien({ porownanie: stan.porownanie.filter((x) => x !== i) })
}

export function przelaczPorownanie(i: number) {
  if (stan.porownanie.includes(i)) usunZPorownania(i)
  else dodajDoPorownania(i)
}

export function wyczyscPorownanie() {
  zmien({ porownanie: [] })
}

export function ustawWarstwe(warstwa: WarstwaMapy) {
  zmien({ warstwa })
}

/** Id adresu pod indeksem – do linków `#/adres/<id>`. */
export function idAdresu(i: number | null): string | null {
  return i === null ? null : (idAdresow?.[i] ?? null)
}

export function indeksAdresu(id: string | null): number | null {
  return id === null ? null : (indeksPoId.get(id) ?? null)
}

/**
 * Woła useDane po wczytaniu danych: podpina słownik id ↔ indeks, liczy wagi persony dla
 * żywych warstw i rozwiązuje id z URL, które czekały na adresy.
 */
export function podlaczDane(
  ids: readonly string[],
  wskazniki: readonly Pick<WskaznikMeta, 'id' | 'kategoria'>[],
) {
  idAdresow = ids
  indeksPoId = new Map(ids.map((id, i) => [id, i]))
  metaWskaznikow = wskazniki
  const url = oczekujacyUrl ?? (typeof window === 'undefined' ? null : czytajHash(location.hash))
  oczekujacyUrl = null
  const persona = url?.ustawienia
    ? 'wlasna'
    : (url?.persona ?? (stan.persona === 'wlasna' ? PERSONA_DOMYSLNA : stan.persona))
  const tryb = url?.tryb ?? stan.tryb
  const domyslne = ustawieniaPersony(
    persona === 'wlasna' ? PERSONA_DOMYSLNA : persona,
    tryb,
    wskazniki,
  )
  const { wagi, kierunki } = url?.ustawienia
    ? sprawdzUstawienia(url.ustawienia, wskazniki, domyslne)
    : domyslne
  zmien({
    persona,
    tryb,
    wagi,
    kierunki,
    ...(url ? zUrl(url) : {}),
  })
}

// ── Synchronizacja z URL ─────────────────────────────────────────────────────────────────

function zUrl(url: StanUrl): Partial<StanAplikacji> {
  const wybrany = indeksAdresu(url.idAdresu)
  return {
    // Nieznany adres w linku → wracamy do wyszukiwania zamiast pustej karty.
    ekran: url.ekran === 'okolica' && wybrany === null ? 'szukaj' : url.ekran,
    wybrany: url.ekran === 'okolica' ? wybrany : stan.wybrany,
    porownanie: url.porownanie.map((id) => indeksPoId.get(id)).filter((i) => i !== undefined),
  }
}

function sprawdzUstawienia(
  ustawienia: NonNullable<StanUrl['ustawienia']>,
  wskazniki: readonly Pick<WskaznikMeta, 'id' | 'kategoria'>[],
  domyslne: { wagi: Record<string, number>; kierunki: Kierunki },
) {
  const znane = new Set(wskazniki.map((w) => w.id))
  const wagi = { ...domyslne.wagi }
  const kierunki = { ...domyslne.kierunki }
  for (const [id, waga] of Object.entries(ustawienia.wagi)) if (znane.has(id)) wagi[id] = waga
  for (const [id, kierunek] of Object.entries(ustawienia.kierunki))
    if (znane.has(id)) kierunki[id] = kierunek
  return { wagi, kierunki }
}

function doUrl(s: StanAplikacji): StanUrl {
  return {
    ekran: s.ekran,
    idAdresu: s.ekran === 'okolica' ? idAdresu(s.wybrany) : null,
    persona: s.persona === 'wlasna' ? null : s.persona,
    tryb: s.tryb,
    porownanie: s.porownanie.map((i) => idAdresu(i)).filter((id) => id !== null),
    ustawienia:
      s.persona === 'wlasna' ? { wagi: { ...s.wagi }, kierunki: { ...s.kierunki } } : null,
  }
}

/**
 * Stan z łatką jako hash – do `<a href>`. Stan podaj z `useStan((s) => s)`, żeby React
 * Compiler widział zależność i odświeżał link.
 */
export function hrefDla(s: StanAplikacji, latka: Partial<StanAplikacji>): string {
  return zapiszHash(doUrl({ ...s, ...latka }))
}

function zapiszDoUrl(poprzedni: StanAplikacji) {
  // Przed wczytaniem adresów nie znamy id – zapis wyczyściłby link, z którym ktoś wszedł.
  if (typeof window === 'undefined' || !idAdresow) return
  const hash = zapiszHash(doUrl(stan))
  if (hash === location.hash || (hash === '#/' && location.hash === '')) return
  // Zmiana ekranu albo adresu to krok w historii (działa „Wstecz"), reszta tylko podmienia URL.
  const krok = poprzedni.ekran !== stan.ekran || poprzedni.wybrany !== stan.wybrany
  if (krok) history.pushState(null, '', hash)
  else history.replaceState(null, '', hash)
}

if (typeof window !== 'undefined') {
  const startowy = czytajHash(location.hash)
  oczekujacyUrl = startowy
  stan = { ...stan, ekran: startowy.ekran }
  if (startowy.persona) stan = { ...stan, persona: startowy.persona }
  if (startowy.tryb) stan = { ...stan, tryb: startowy.tryb }
  window.addEventListener('hashchange', () => {
    const url = czytajHash(location.hash)
    if (!idAdresow) {
      oczekujacyUrl = url
      return zmien({ ekran: url.ekran })
    }
    const latka: Partial<StanAplikacji> = zUrl(url)
    const persona = url.ustawienia ? 'wlasna' : (url.persona ?? PERSONA_DOMYSLNA)
    const tryb = url.tryb ?? stan.tryb
    const domyslne = ustawieniaPersony(
      persona === 'wlasna' ? PERSONA_DOMYSLNA : persona,
      tryb,
      metaWskaznikow,
    )
    Object.assign(latka, {
      persona,
      tryb,
      ...(url.ustawienia ? sprawdzUstawienia(url.ustawienia, metaWskaznikow, domyslne) : domyslne),
    })
    zmien(latka)
  })
}
