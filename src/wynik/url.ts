// Router na hashu bez biblioteki: trzy ekrany i kilka parametrów do udostępniania.
// Hash, a nie ścieżka, bo hosting SPA nie musi wtedy przepisywać adresów na index.html.
import { filtryDoTekstu, filtryZTekstu, type TwardyFiltr } from './filtry.ts'
import type { PersonaId, Tryb } from './persony.ts'
import { PERSONY } from './persony.ts'
import type { Kierunki } from './silnik.ts'

export type Ekran = 'szukaj' | 'okolica' | 'porownanie' | 'metoda' | 'katalog'

export interface StanUrl {
  ekran: Ekran
  /** Id adresu z adresy.json (nie indeks – indeks zmienia się po przeliczeniu ETL). */
  idAdresu: string | null
  persona: PersonaId | null
  tryb: Tryb | null
  /** Id adresów na liście porównania. */
  porownanie: string[]
  /** Własne ustawienia wyniku, zapisane wyłącznie dla persony „własna”. */
  ustawienia: { wagi: Record<string, number>; kierunki: Kierunki } | null
  /** Twarde filtry (parametr `f`). */
  filtry: TwardyFiltr[]
}

export const MAKS_POROWNANIE = 5
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
        ([id, wartosc]) =>
          !id || !['wiecej-lepiej', 'mniej-lepiej', 'optimum'].includes(wartosc as string),
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
  }

  const p = parametry.get('p')
  const t = parametry.get('t')
  const cmp = parametry.get('cmp')
  const ustawienia = czytajUstawienia(parametry.get('u'))
  return {
    ekran,
    idAdresu,
    persona: PERSONY.some((x) => x.id === p) ? (p as PersonaId) : null,
    tryb: t === 'kupuje' || t === 'wynajmuje' ? t : null,
    porownanie: cmp ? cmp.split(',').filter(Boolean).slice(0, MAKS_POROWNANIE) : [],
    ustawienia,
    filtry: filtryZTekstu(parametry.get('f')),
  }
}

export function zapiszHash(s: StanUrl): string {
  let sciezka = '/'
  if (s.ekran === 'okolica' && s.idAdresu) sciezka = `/adres/${encodeURIComponent(s.idAdresu)}`
  else if (s.ekran === 'porownanie') sciezka = '/porownanie'
  else if (s.ekran === 'metoda') sciezka = '/metoda'
  else if (s.ekran === 'katalog') sciezka = '/katalog'
  const parametry = new URLSearchParams()
  if (s.persona) parametry.set('p', s.persona)
  if (s.tryb) parametry.set('t', s.tryb)
  if (s.porownanie.length) parametry.set('cmp', s.porownanie.join(','))
  if (s.ustawienia)
    parametry.set('u', JSON.stringify({ v: 1, w: s.ustawienia.wagi, k: s.ustawienia.kierunki }))
  if (s.filtry.length) parametry.set('f', filtryDoTekstu(s.filtry))
  const q = parametry.toString().replaceAll('%2C', ',').replaceAll('%3A', ':')
  return `#${sciezka}${q ? `?${q}` : ''}`
}

/** Link do ekranu z zachowaniem bieżących parametrów – do `<a href>`. */
export function hrefEkranu(s: StanUrl, ekran: Ekran, idAdresu?: string | null): string {
  return zapiszHash({ ...s, ekran, idAdresu: idAdresu ?? s.idAdresu })
}
