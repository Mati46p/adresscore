// Router na hashu bez biblioteki: trzy ekrany i kilka parametrów do udostępniania.
// Hash, a nie ścieżka, bo hosting SPA nie musi wtedy przepisywać adresów na index.html.
import { filtryDoTekstuLinku, filtryZTekstuLinku } from './biznesFiltryUrl.ts'
import { BEZ_FILTROW, type FiltryUslug } from './biznesUslugi.ts'
import { filtryDoTekstu, filtryZTekstu, type TwardyFiltr } from './filtry.ts'
import type { PersonaId, RodzajBiznesu, Tryb } from './persony.ts'
import { BIZNESY, PERSONY } from './persony.ts'
import type { Kierunki } from './silnik.ts'

export type Ekran =
  | 'szukaj'
  | 'okolica'
  | 'porownanie'
  | 'metoda'
  | 'katalog'
  /**
   * Tryb „Miasto”: luki w usługach (ranking i mapa) oraz symulator inwestycji. Adres w linku to
   * `#/miasto`, a stary `#/symulator` (sprzed #108) też działa.
   */
  | 'miasto'
  | 'biznes'

export interface StanUrl {
  ekran: Ekran
  /** Id adresu z adresy.json (nie indeks – indeks zmienia się po przeliczeniu ETL). */
  idAdresu: string | null
  persona: PersonaId | null
  tryb: Tryb | null
  biznes?: RodzajBiznesu
  /** Id adresów na liście porównania. */
  porownanie: string[]
  /** Własne ustawienia wyniku, zapisane wyłącznie dla persony „własna”. */
  ustawienia: { wagi: Record<string, number>; kierunki: Kierunki } | null
  /** Twarde filtry (parametr `f`). */
  filtry: TwardyFiltr[]
  branza?: string
  /** Miejsca A–E trybu „Biznes”, zawsze `MAKS_MIEJSC` pozycji (`null` = puste miejsce). */
  miejsca?: readonly ({ lon: number; lat: number } | null)[]
  /**
   * Filtry konkurencji trybu „Biznes” (parametr `k`, `biznesFiltryUrl.ts`). Tylko na ekranie Biznes,
   * jak `branza` i `miejsca`; brak parametru w linku = wszystkie filtry wyłączone.
   */
  filtryBiznesu?: FiltryUslug
  /**
   * Obiekty symulatora (#98) jako tekst `symulacjaUrl.ts`, warianty A i B (parametry `a`, `b`).
   * Tylko na ekranie Miasto – gdzie indziej pola nie ma.
   */
  symulacja?: { a: string; b: string }
  /**
   * Warstwa rankingu i mapy luk trybu „Miasto” (parametr `w`, #92: link do konkretnej luki).
   * `null` = domyślna (pierwsza warstwa z progiem luki). Tylko na ekranie Miasto.
   */
  warstwaLuk?: string | null
}

export const MAKS_POROWNANIE = 5

/** Ile miejsc testowych można postawić w trybie „Biznes” (A–E). */
export const ID_MIEJSC = ['a', 'b', 'c', 'd', 'e'] as const
export type IdMiejsca = (typeof ID_MIEJSC)[number]
export const MAKS_MIEJSC = ID_MIEJSC.length
const MAKS_USTAWIENIA = 4096

function czytajUstawienia(tekst: string | null): StanUrl['ustawienia'] {
  if (!tekst || tekst.length > MAKS_USTAWIENIA) return null
  try {
    const dane: unknown = JSON.parse(tekst)
    if (!dane || typeof dane !== 'object' || Array.isArray(dane)) return null
    const { v, w, k } = dane as Record<string, unknown>
    if (v !== 1 || !w || typeof w !== 'object' || Array.isArray(w)) return null
    if (!k || typeof k !== 'object' || Array.isArray(k)) return null
    const wagi = Object.entries(w)
    const kierunki = Object.entries(k)
    if (wagi.length > 100 || kierunki.length > 100) return null
    if (
      wagi.some(
        ([id, wartosc]) =>
          !id || !Number.isInteger(wartosc) || (wartosc as number) < 0 || (wartosc as number) > 4,
      )
    )
      return null
    if (
      kierunki.some(
        ([id, wartosc]) => !id || !['wiecej-lepiej', 'mniej-lepiej'].includes(wartosc as string),
      )
    )
      return null
    return { wagi: Object.fromEntries(wagi), kierunki: Object.fromEntries(kierunki) }
  } catch {
    return null
  }
}

function odkoduj(tekst: string): string | null {
  try {
    return decodeURIComponent(tekst)
  } catch {
    return null
  }
}

/**
 * Prostokąt (Małopolska), w którym punkt trybu „Biznes” jest dozwolony. Poza nim link go odrzuca,
 * a dane o popycie i punktach i tak się kończą – stąd jedno miejsce prawdy dla linku, formularza
 * współrzędnych i przeciągania znaczników.
 */
export const GRANICE_PUNKTU = { lonMin: 19.3, lonMax: 20.8, latMin: 49.7, latMax: 50.5 } as const

export function wGranicachPunktu(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= GRANICE_PUNKTU.lonMin &&
    lon <= GRANICE_PUNKTU.lonMax &&
    lat >= GRANICE_PUNKTU.latMin &&
    lat <= GRANICE_PUNKTU.latMax
  )
}

/**
 * Miejsca z linku: `m=lon,lat;;lon,lat` (pusta pozycja = puste miejsce). Stary link z dwoma
 * punktami (`a=` dla A, `c=` dla B) dalej działa.
 */
function czytajMiejsca(parametry: URLSearchParams): ({ lon: number; lat: number } | null)[] {
  const m = parametry.get('m')
  const lista: ({ lon: number; lat: number } | null)[] = m
    ? m.split(';').slice(0, MAKS_MIEJSC).map(czytajPunkt)
    : [czytajPunkt(parametry.get('a')), czytajPunkt(parametry.get('c'))]
  while (lista.length < MAKS_MIEJSC) lista.push(null)
  return lista
}

function zapiszMiejsca(miejsca: readonly ({ lon: number; lat: number } | null)[]): string {
  const czesci = miejsca
    .slice(0, MAKS_MIEJSC)
    .map((p) => (p ? p.lon.toFixed(6) + ',' + p.lat.toFixed(6) : ''))
  while (czesci.length && !czesci[czesci.length - 1]) czesci.pop()
  return czesci.join(';')
}

/** Id warstwy z linku (`w=`): jak id wskaźników (małe litery, cyfry, podkreślenia); reszta odpada. */
const WARSTWA_LUK = /^[a-z][a-z0-9_]{0,63}$/

function czytajWarstweLuk(tekst: string | null): string | null {
  return tekst !== null && WARSTWA_LUK.test(tekst) ? tekst : null
}

function czytajPunkt(tekst: string | null): { lon: number; lat: number } | null {
  if (!tekst) return null
  const czesci = tekst.split(',')
  if (czesci.length !== 2) return null
  const lon = Number(czesci[0])
  const lat = Number(czesci[1])
  return wGranicachPunktu(lon, lat) ? { lon, lat } : null
}

export function czytajHash(hash: string): StanUrl {
  const bez = hash.replace(/^#/, '')
  const [sciezka = '', zapytanie = ''] = bez.split('?')
  const czesci = sciezka.split('/').filter(Boolean)
  const parametry = new URLSearchParams(zapytanie)

  let ekran: Ekran = 'szukaj'
  let idAdresu: string | null = null
  if (czesci[0] === 'adres' && czesci[1]) {
    idAdresu = odkoduj(czesci[1])
    // Uszkodzony link (np. `#/adres/%`) prowadzi do wyszukiwania, a nie wywraca aplikacji.
    if (idAdresu !== null) ekran = 'okolica'
  } else if (czesci[0] === 'porownanie') {
    ekran = 'porownanie'
  } else if (czesci[0] === 'metoda') {
    ekran = 'metoda'
  } else if (czesci[0] === 'katalog') {
    ekran = 'katalog'
  } else if (czesci[0] === 'biznes') {
    ekran = 'biznes'
  } else if (czesci[0] === 'miasto' || czesci[0] === 'symulator') {
    // Jeden ekran, dwa adresy: `#/miasto` jest właściwym (tryb Miasto obok Biznesu), `#/symulator` to
    // adres sprzed #108 i linki z obiektami (`a=`, `b=`) wysłane wcześniej muszą dalej działać.
    ekran = 'miasto'
  }

  const p = parametry.get('p')
  const t = parametry.get('t')
  const b = parametry.get('biz')
  const cmp = parametry.get('cmp')
  const ustawienia = czytajUstawienia(parametry.get('u'))
  const branzaBiznesu = /^[a-z_]+$/.test(parametry.get('b') ?? '')
    ? (parametry.get('b') as string)
    : 'sklep'
  return {
    ekran,
    idAdresu,
    persona: PERSONY.some((x) => x.id === p) ? (p as PersonaId) : null,
    tryb: t === 'kupuje' || t === 'wynajmuje' || t === 'biznes' ? t : null,
    ...(BIZNESY.some((x) => x.id === b) ? { biznes: b as RodzajBiznesu } : {}),
    porownanie: cmp ? cmp.split(',').filter(Boolean).slice(0, MAKS_POROWNANIE) : [],
    ustawienia,
    filtry: filtryZTekstu(parametry.get('f')),
    ...(ekran === 'biznes'
      ? {
          branza: branzaBiznesu,
          miejsca: czytajMiejsca(parametry),
          filtryBiznesu: filtryZTekstuLinku(parametry.get('k'), branzaBiznesu),
        }
      : {}),
    ...(ekran === 'miasto'
      ? {
          symulacja: { a: parametry.get('a') ?? '', b: parametry.get('b') ?? '' },
          warstwaLuk: czytajWarstweLuk(parametry.get('w')),
        }
      : {}),
  }
}

export function zapiszHash(s: StanUrl): string {
  let sciezka = '/'
  if (s.ekran === 'okolica' && s.idAdresu) sciezka = `/adres/${encodeURIComponent(s.idAdresu)}`
  else if (s.ekran === 'porownanie') sciezka = '/porownanie'
  else if (s.ekran === 'metoda') sciezka = '/metoda'
  else if (s.ekran === 'katalog') sciezka = '/katalog'
  else if (s.ekran === 'biznes') sciezka = '/biznes'
  else if (s.ekran === 'miasto') sciezka = '/miasto'
  const parametry = new URLSearchParams()
  if (s.persona) parametry.set('p', s.persona)
  if (s.tryb) parametry.set('t', s.tryb)
  if (s.tryb === 'biznes' && s.biznes && s.biznes !== 'sklep') parametry.set('biz', s.biznes)
  if (s.porownanie.length) parametry.set('cmp', s.porownanie.join(','))
  if (s.ustawienia)
    parametry.set('u', JSON.stringify({ v: 1, w: s.ustawienia.wagi, k: s.ustawienia.kierunki }))
  if (s.filtry.length) parametry.set('f', filtryDoTekstu(s.filtry))
  if (s.ekran === 'miasto') {
    if (s.symulacja?.a) parametry.set('a', s.symulacja.a)
    if (s.symulacja?.b) parametry.set('b', s.symulacja.b)
    if (s.warstwaLuk) parametry.set('w', s.warstwaLuk)
  }
  // Parametry biznesu muszą trafić do `parametry` PRZED zbudowaniem `q`. Wcześniej `q` powstawało
  // pierwsze, więc `#/biznes?b=apteka&a=…&c=…` zapisywał się jako `#/biznes` i link z punktami
  // ginął przy pierwszej zmianie stanu (odświeżenie strony gubiło branżę i oba punkty).
  if (s.ekran === 'biznes') {
    parametry.set('b', s.branza ?? 'sklep')
    const m = zapiszMiejsca(s.miejsca ?? [])
    if (m) parametry.set('m', m)
    // Filtry konkurencji (`k=2z,-fast_food`): brak parametru = wszystkie wyłączone.
    const filtry = filtryDoTekstuLinku(s.filtryBiznesu ?? BEZ_FILTROW, s.branza ?? 'sklep')
    if (filtry) parametry.set('k', filtry)
  }
  const q = parametry
    .toString()
    .replaceAll('%2C', ',')
    .replaceAll('%3A', ':')
    .replaceAll('%3B', ';')
  return `#${sciezka}${q ? `?${q}` : ''}`
}

/** Link do ekranu z zachowaniem bieżących parametrów – do `<a href>`. */
export function hrefEkranu(s: StanUrl, ekran: Ekran, idAdresu?: string | null): string {
  return zapiszHash({ ...s, ekran, idAdresu: idAdresu ?? s.idAdresu })
}
