// Stan aplikacji bez biblioteki: jeden obiekt niemutowalny + subskrybenci, czytany przez
// useSyncExternalStore. Wystarcza na kilka pól, a równoległe okna nie dokładają zależności.
// Kanoniczne ścieżki trzymają adres i katalog; preferencje pozostają w sesji przeglądarki.

import { useSyncExternalStore } from 'react'
import type { Adres, WskaznikMeta } from '@/kontrakty'
import { type TwardyFiltr, zPodmienionymFiltrem } from './filtry.ts'
import {
  PERSONA_DOMYSLNA,
  type PersonaId,
  RODZAJ_BIZNESU_DOMYSLNY,
  type RodzajBiznesu,
  TRYB_DOMYSLNY,
  type Tryb,
  ustawieniaPersony,
  warstwyBiznesu,
} from './persony.ts'
import {
  odczytajPreferencje,
  odczytajPreferencjeTrybu,
  polaczPreferencje,
  zapiszPreferencje,
} from './sesja.ts'
import type { KierunekOceny, Kierunki } from './silnik.ts'
import { hashAdresu, hashZeSluga, slugAdresu } from './slug.ts'
import { czytajHash, type Ekran, MAKS_POROWNANIE, type StanUrl, zapiszHash } from './url.ts'
import { czyWarstwaWyborow, zmienKomitet } from './wybory.ts'

/** `'wynik'` = wynik łączny; inaczej id wskaźnika pokazywanego na mapie. */
export type WarstwaMapy = 'wynik' | (string & {})
export type TrybMapy = 'suma' | 'ostatnia'

export interface StanAplikacji {
  ekran: Ekran
  tryb: Tryb
  biznes: RodzajBiznesu
  /** `'wlasna'` po ręcznej zmianie którejkolwiek wagi. */
  persona: PersonaId | 'wlasna'
  /** Wagi 0–4 per id wskaźnika. */
  wagi: Readonly<Record<string, number>>
  /** Nadpisane kierunki; brak klucza = kierunek z meta. */
  kierunki: Kierunki
  /** Indeks wybranego adresu w adresy.json albo null. */
  wybrany: number | null
  /** Indeksy adresów do porównania, najwyżej 5. */
  porownanie: readonly number[]
  warstwa: WarstwaMapy
  /** Czy mapa śledzi wynik łączny, czy ostatnio zmienioną warstwę. */
  trybMapy: TrybMapy
  ostatniaWarstwa: string | null
  /** Twarde filtry: adres, który ich nie spełnia, jest wykluczony (nie dostaje kary w wyniku). */
  filtry: readonly TwardyFiltr[]
  branza: string
  punktA: { lon: number; lat: number } | null
  punktB: { lon: number; lat: number } | null
  /** Obiekty symulatora (#98), warianty A i B jako tekst `symulacjaUrl.ts`. */
  symulacja: { a: string; b: string }
}

let stan: StanAplikacji = {
  ekran: 'szukaj',
  tryb: TRYB_DOMYSLNY,
  biznes: RODZAJ_BIZNESU_DOMYSLNY,
  persona: PERSONA_DOMYSLNA,
  wagi: {},
  kierunki: {},
  wybrany: null,
  porownanie: [],
  warstwa: 'wynik',
  trybMapy: 'suma',
  ostatniaWarstwa: null,
  filtry: [],
  branza: 'sklep',
  punktA: null,
  punktB: null,
  symulacja: { a: '', b: '' },
}

const sluchacze = new Set<() => void>()

// Słownik id ↔ indeks dostajemy dopiero po wczytaniu adresów. Do tego czasu id z URL czekają.
let idAdresow: readonly string[] | null = null
let indeksPoId = new Map<string, number>()
let indeksPoHash = new Map<string, number>()
let slugPoIndeks: readonly string[] = []
let metaWskaznikow: readonly (Pick<WskaznikMeta, 'id' | 'kategoria'> &
  Partial<Pick<WskaznikMeta, 'atrapa' | 'domyslnaWaga'>>)[] = []
let oczekujacyUrl: StanUrl | null = null
let odczytujemyHistorie = false
type UstawieniaTrybu = Pick<StanAplikacji, 'persona' | 'wagi' | 'kierunki' | 'filtry'>
let mieszkaniePrzedBiznesem: UstawieniaTrybu | null = null
let ostatniBiznes: UstawieniaTrybu | null = null

function ustawieniaBiezacegoTrybu(): UstawieniaTrybu {
  return {
    persona: stan.persona,
    wagi: stan.wagi,
    kierunki: stan.kierunki,
    filtry: stan.filtry,
  }
}

function ustawieniaZSesji(rodzaj: 'mieszkanie' | 'biznes', tryb: Tryb): UstawieniaTrybu | null {
  const url = odczytajPreferencjeTrybu(rodzaj)
  if (!url) return null
  const persona = url.ustawienia ? 'wlasna' : (url.persona ?? PERSONA_DOMYSLNA)
  const domyslne = ustawieniaPersony(
    persona === 'wlasna' ? PERSONA_DOMYSLNA : persona,
    tryb,
    metaWskaznikow,
    url.biznes ?? stan.biznes,
  )
  const { wagi, kierunki } = url.ustawienia
    ? sprawdzUstawienia(url.ustawienia, metaWskaznikow, domyslne, tryb, url.biznes ?? stan.biznes)
    : domyslne
  return { persona, wagi, kierunki, filtry: [] }
}

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
  if (idAdresow) zapiszPreferencje(doUrl(stan))
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
  if (tryb === stan.tryb) return
  if (tryb === 'biznes') {
    mieszkaniePrzedBiznesem = ustawieniaBiezacegoTrybu()
    const zapis = ostatniBiznes ?? ustawieniaZSesji('biznes', 'biznes')
    const domyslne = ustawieniaPersony(PERSONA_DOMYSLNA, 'biznes', metaWskaznikow, stan.biznes)
    return zmien({
      tryb,
      persona: zapis?.persona ?? PERSONA_DOMYSLNA,
      wagi: zapis?.wagi ?? domyslne.wagi,
      kierunki: zapis?.kierunki ?? domyslne.kierunki,
      filtry: [],
      warstwa: 'wynik',
      trybMapy: 'suma',
      ostatniaWarstwa: null,
    })
  }
  if (stan.tryb === 'biznes') {
    ostatniBiznes = ustawieniaBiezacegoTrybu()
    const zapis = mieszkaniePrzedBiznesem ?? ustawieniaZSesji('mieszkanie', tryb)
    const persona = zapis?.persona ?? (stan.persona === 'wlasna' ? PERSONA_DOMYSLNA : stan.persona)
    const domyslne = ustawieniaPersony(
      persona === 'wlasna' ? PERSONA_DOMYSLNA : persona,
      tryb,
      metaWskaznikow,
    )
    return zmien({
      tryb,
      persona,
      wagi: persona === 'wlasna' && zapis ? zapis.wagi : domyslne.wagi,
      kierunki: persona === 'wlasna' && zapis ? zapis.kierunki : domyslne.kierunki,
      filtry: [],
      warstwa: 'wynik',
      trybMapy: 'suma',
      ostatniaWarstwa: null,
    })
  }
  if (stan.persona === 'wlasna') return zmien({ tryb })
  const { wagi, kierunki } = ustawieniaPersony(stan.persona, tryb, metaWskaznikow)
  zmien({ tryb, wagi, kierunki })
}

export function ustawWage(id: string, waga: number) {
  const inneWagi = czyWarstwaWyborow(id)
    ? Object.fromEntries(
        Object.entries(stan.wagi).map(([klucz, wartosc]) => [
          klucz,
          czyWarstwaWyborow(klucz) && klucz !== id ? 0 : wartosc,
        ]),
      )
    : stan.wagi
  zmien({
    wagi: { ...inneWagi, [id]: Math.min(Math.max(Math.round(waga), 0), 4) },
    persona: 'wlasna',
    ostatniaWarstwa: id,
    ...(stan.trybMapy === 'ostatnia' ? { warstwa: id } : {}),
  })
}

export function ustawRodzajBiznesu(biznes: RodzajBiznesu) {
  if (biznes === stan.biznes) return
  const { wagi, kierunki } = ustawieniaPersony(PERSONA_DOMYSLNA, 'biznes', metaWskaznikow, biznes)
  zmien({
    biznes,
    wagi,
    kierunki,
    filtry: [],
    persona: PERSONA_DOMYSLNA,
    warstwa: 'wynik',
    trybMapy: 'suma',
  })
}

export function ustawKomitet(id: string) {
  if (!czyWarstwaWyborow(id) || !metaWskaznikow.some((m) => m.id === id)) return
  const ustawienia = zmienKomitet(id, stan.wagi, stan.kierunki, stan.filtry)
  zmien({
    ...ustawienia,
    persona: 'wlasna',
    ostatniaWarstwa: id,
    ...(stan.trybMapy === 'ostatnia' ? { warstwa: id } : {}),
  })
}

/**
 * Wszystkie wagi naraz (np. „opisz siebie”, #16): jedna zmiana stanu = jedno przeliczenie mapy,
 * bez przestawiania ostatniej warstwy, którą robi `ustawWage`.
 */
export function ustawWagi(wagi: Readonly<Record<string, number>>, kierunki: Kierunki) {
  const przyciete: Record<string, number> = {}
  for (const [id, w] of Object.entries(wagi))
    przyciete[id] = Math.min(Math.max(Math.round(w), 0), 4)
  zmien({ wagi: przyciete, kierunki: { ...kierunki }, persona: 'wlasna' })
}

/** null przywraca kierunek z meta wskaźnika. */
export function ustawKierunek(id: string, kierunek: KierunekOceny | null) {
  const kierunki = { ...stan.kierunki }
  if (kierunek) kierunki[id] = kierunek
  else delete kierunki[id]
  zmien({
    kierunki,
    persona: 'wlasna',
    ostatniaWarstwa: id,
    ...(stan.trybMapy === 'ostatnia' ? { warstwa: id } : {}),
  })
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
  zmien({ ekran, ...(ekran === 'biznes' ? { tryb: 'biznes' as const } : {}) })
}

export function ustawBranze(branza: string) {
  zmien({ branza, punktA: null, punktB: null })
}

export function ustawPunktBiznesu(id: 'a' | 'b', punkt: { lon: number; lat: number } | null) {
  zmien(id === 'a' ? { punktA: punkt } : { punktB: punkt })
}

/** Warianty symulatora (#98); zapis do URL tylko na ekranie symulatora. */
export function ustawSymulacje(symulacja: { a: string; b: string }) {
  if (symulacja.a === stan.symulacja.a && symulacja.b === stan.symulacja.b) return
  zmien({ symulacja })
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
  zmien({
    warstwa,
    trybMapy: warstwa === 'wynik' ? 'suma' : 'ostatnia',
    ...(warstwa === 'wynik' ? {} : { ostatniaWarstwa: warstwa }),
  })
}

export function ustawTrybMapy(trybMapy: TrybMapy) {
  zmien({
    trybMapy,
    warstwa: trybMapy === 'suma' ? 'wynik' : (stan.ostatniaWarstwa ?? 'wynik'),
  })
}

/** Dodaje twardy filtr albo podmienia filtr tej samej warstwy. */
export function ustawFiltr(filtr: TwardyFiltr) {
  zmien({
    filtry: zPodmienionymFiltrem(stan.filtry, filtr),
    ostatniaWarstwa: filtr.id,
    ...(stan.trybMapy === 'ostatnia' ? { warstwa: filtr.id } : {}),
  })
}

export function usunFiltr(id: string) {
  zmien({
    filtry: stan.filtry.filter((f) => f.id !== id),
    ostatniaWarstwa: id,
    ...(stan.trybMapy === 'ostatnia' ? { warstwa: id } : {}),
  })
}

export function wyczyscFiltry() {
  zmien({ filtry: [] })
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
  wskazniki: readonly (Pick<WskaznikMeta, 'id' | 'kategoria'> &
    Partial<Pick<WskaznikMeta, 'atrapa' | 'domyslnaWaga'>>)[],
  adresy: readonly Adres[],
) {
  idAdresow = ids
  indeksPoId = new Map(ids.map((id, i) => [id, i]))
  indeksPoHash = new Map(ids.map((id, i) => [hashAdresu(id), i]))
  slugPoIndeks = adresy.map(slugAdresu)
  metaWskaznikow = wskazniki
  const url = typeof window === 'undefined' ? oczekujacyUrl : czytajBiezacyUrl()
  oczekujacyUrl = null
  const persona = url?.ustawienia
    ? 'wlasna'
    : (url?.persona ?? (stan.persona === 'wlasna' ? PERSONA_DOMYSLNA : stan.persona))
  const tryb = url?.tryb ?? stan.tryb
  const domyslne = ustawieniaPersony(
    persona === 'wlasna' ? PERSONA_DOMYSLNA : persona,
    tryb,
    wskazniki,
    url?.biznes ?? stan.biznes,
  )
  const { wagi, kierunki } = url?.ustawienia
    ? sprawdzUstawienia(url.ustawienia, wskazniki, domyslne, tryb, url?.biznes ?? stan.biznes)
    : domyslne
  zmien({
    persona,
    tryb,
    biznes: url?.biznes ?? stan.biznes,
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
    filtry: [],
    biznes: url.biznes ?? stan.biznes,
    ...(url.symulacja ? { symulacja: url.symulacja } : {}),
    branza: url.branza ?? 'sklep',
    punktA: url.punktA ?? null,
    punktB: url.punktB ?? null,
  }
}

function sprawdzUstawienia(
  ustawienia: NonNullable<StanUrl['ustawienia']>,
  wskazniki: readonly (Pick<WskaznikMeta, 'id' | 'kategoria'> &
    Partial<Pick<WskaznikMeta, 'atrapa' | 'domyslnaWaga'>>)[],
  domyslne: { wagi: Record<string, number>; kierunki: Kierunki },
  tryb: Tryb,
  biznes: RodzajBiznesu = RODZAJ_BIZNESU_DOMYSLNY,
) {
  const znane = new Set(
    wskazniki
      .filter((w) =>
        tryb === 'biznes' ? !w.atrapa && warstwyBiznesu(biznes).includes(w.id) : true,
      )
      .map((w) => w.id),
  )
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
    biznes: s.biznes,
    porownanie: s.porownanie.map((i) => idAdresu(i)).filter((id) => id !== null),
    ustawienia:
      s.persona === 'wlasna' ? { wagi: { ...s.wagi }, kierunki: { ...s.kierunki } } : null,
    filtry: [],
    ...(s.ekran === 'symulator' ? { symulacja: s.symulacja } : {}),
    branza: s.branza,
    punktA: s.punktA,
    punktB: s.punktB,
  }
}

function czytajBiezacyUrl(): StanUrl {
  const parametry = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const trybLinku = parametry.get('t')
  const zapis = trybLinku
    ? odczytajPreferencjeTrybu(trybLinku === 'biznes' ? 'biznes' : 'mieszkanie')
    : odczytajPreferencje()
  const url = polaczPreferencje(czytajHash(location.hash), location.hash, zapis)
  const sciezka = location.pathname
  if (sciezka === '/katalog' || sciezka.startsWith('/katalog/')) {
    return { ...url, ekran: 'katalog', idAdresu: null }
  }
  if (sciezka.startsWith('/adres/')) {
    const slug = sciezka.slice('/adres/'.length)
    const hash = hashZeSluga(slug)
    const indeks = hash ? indeksPoHash.get(hash) : undefined
    return {
      ...url,
      ekran: 'okolica',
      idAdresu: indeks === undefined ? null : (idAdresow?.[indeks] ?? null),
    }
  }
  return url
}

function sciezkaStanu(s: StanAplikacji): string {
  if (s.ekran === 'okolica' && s.wybrany !== null) {
    const slug = slugPoIndeks[s.wybrany]
    if (slug) return `/adres/${slug}`
  }
  if (s.ekran === 'katalog') return '/katalog'
  if (s.ekran === 'biznes') return '/' + zapiszHash(doUrl(s))
  return `/${zapiszHash(doUrl(s))}`
}

/**
 * Stan z łatką jako hash – do `<a href>`. Stan podaj z `useStan((s) => s)`, żeby React
 * Compiler widział zależność i odświeżał link.
 */
export function hrefDla(s: StanAplikacji, latka: Partial<StanAplikacji>): string {
  return sciezkaStanu({ ...s, ...latka })
}

function zapiszDoUrl(poprzedni: StanAplikacji) {
  // Przed wczytaniem adresów nie znamy id – zapis wyczyściłby link, z którym ktoś wszedł.
  if (typeof window === 'undefined' || !idAdresow || odczytujemyHistorie) return
  // Strona konkretnej ulicy ma własną ścieżkę, chociaż w aplikacji używa ekranu katalogu.
  if (
    stan.ekran === 'katalog' &&
    poprzedni.ekran === 'katalog' &&
    location.pathname.startsWith('/katalog/')
  )
    return
  const cel = sciezkaStanu(stan)
  const obecny = `${location.pathname}${location.hash}`
  if (cel === obecny || (cel === '/#/' && obecny === '/')) return
  // Zmiana ekranu albo adresu to krok w historii (działa „Wstecz"), reszta tylko podmienia URL.
  const krok = poprzedni.ekran !== stan.ekran || poprzedni.wybrany !== stan.wybrany
  // Stare linki #/adres/<id> otwierają kartę i dostają kanoniczną ścieżkę bez drugiego wpisu.
  if (krok && !location.hash.startsWith('#/adres/')) history.pushState(null, '', cel)
  else history.replaceState(null, '', cel)
}

if (typeof window !== 'undefined') {
  const startowy = czytajBiezacyUrl()
  oczekujacyUrl = startowy
  stan = { ...stan, ekran: startowy.ekran }
  if (startowy.persona) stan = { ...stan, persona: startowy.persona }
  if (startowy.tryb) stan = { ...stan, tryb: startowy.tryb }
  if (startowy.biznes) stan = { ...stan, biznes: startowy.biznes }
  stan = { ...stan, filtry: [] }
  if (startowy.symulacja) stan = { ...stan, symulacja: startowy.symulacja }
  if (startowy.ekran === 'biznes') stan = { ...stan, tryb: 'biznes' }
  const odczytajZmianeUrl = () => {
    const url = czytajBiezacyUrl()
    if (!idAdresow) {
      oczekujacyUrl = url
      return zmien({
        ekran: url.ekran,
        filtry: [],
        ...(url.symulacja ? { symulacja: url.symulacja } : {}),
      })
    }
    const latka: Partial<StanAplikacji> = zUrl(url)
    const persona = url.ustawienia ? 'wlasna' : (url.persona ?? PERSONA_DOMYSLNA)
    const tryb = url.tryb ?? stan.tryb
    const domyslne = ustawieniaPersony(
      persona === 'wlasna' ? PERSONA_DOMYSLNA : persona,
      tryb,
      metaWskaznikow,
      url.biznes ?? stan.biznes,
    )
    Object.assign(latka, {
      persona,
      tryb,
      ...(url.ustawienia
        ? sprawdzUstawienia(
            url.ustawienia,
            metaWskaznikow,
            domyslne,
            tryb,
            url.biznes ?? stan.biznes,
          )
        : domyslne),
    })
    odczytujemyHistorie = true
    try {
      zmien(latka)
    } finally {
      odczytujemyHistorie = false
    }
  }
  window.addEventListener('hashchange', odczytajZmianeUrl)
  window.addEventListener('popstate', odczytajZmianeUrl)
}
