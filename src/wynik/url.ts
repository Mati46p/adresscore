// Router na hashu bez biblioteki: trzy ekrany i kilka parametrów do udostępniania.
// Hash, a nie ścieżka, bo hosting SPA nie musi wtedy przepisywać adresów na index.html.
import type { PersonaId, Tryb } from './persony.ts'
import { PERSONY } from './persony.ts'

export type Ekran = 'szukaj' | 'okolica' | 'porownanie'

export interface StanUrl {
  ekran: Ekran
  /** Id adresu z adresy.json (nie indeks – indeks zmienia się po przeliczeniu ETL). */
  idAdresu: string | null
  persona: PersonaId | null
  tryb: Tryb | null
  /** Id adresów na liście porównania. */
  porownanie: string[]
}

export const MAKS_POROWNANIE = 5

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
  }

  const p = parametry.get('p')
  const t = parametry.get('t')
  const cmp = parametry.get('cmp')
  return {
    ekran,
    idAdresu,
    persona: PERSONY.some((x) => x.id === p) ? (p as PersonaId) : null,
    tryb: t === 'kupuje' || t === 'wynajmuje' ? t : null,
    porownanie: cmp ? cmp.split(',').filter(Boolean).slice(0, MAKS_POROWNANIE) : [],
  }
}

export function zapiszHash(s: StanUrl): string {
  let sciezka = '/'
  if (s.ekran === 'okolica' && s.idAdresu) sciezka = `/adres/${encodeURIComponent(s.idAdresu)}`
  else if (s.ekran === 'porownanie') sciezka = '/porownanie'
  const parametry = new URLSearchParams()
  if (s.persona) parametry.set('p', s.persona)
  if (s.tryb) parametry.set('t', s.tryb)
  if (s.porownanie.length) parametry.set('cmp', s.porownanie.join(','))
  const q = parametry.toString().replaceAll('%2C', ',')
  return `#${sciezka}${q ? `?${q}` : ''}`
}

/** Link do ekranu z zachowaniem bieżących parametrów – do `<a href>`. */
export function hrefEkranu(s: StanUrl, ekran: Ekran, idAdresu?: string | null): string {
  return zapiszHash({ ...s, ekran, idAdresu: idAdresu ?? s.idAdresu })
}
