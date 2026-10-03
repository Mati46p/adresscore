// Czysta logika wyszukiwania adresów (bez DOM) po indeksie zbudowanym raz na tablicę.
// Dlaczego własny indeks, a nie zewnętrzne API: działa offline i nie zależy od limitów.
import type { Adres } from '../../kontrakty/index.ts'

export interface Wynik {
  /** Adres.i – klucz do wartości wskaźników. */
  i: number
  /** „Grodzka 52” – ulica (albo miejscowość, gdy brak ulicy) i numer. */
  tytul: string
  /** „I Stare Miasto, 31-001” – dzielnica albo gmina, potem kod. */
  opis: string
  wynik: number
}

interface Ulica {
  nazwa: string
  tokeny: string[]
  /** Tokeny miejscowości i gminy – do zawężania zapytań typu „Wieliczka Kościuszki 3”. */
  miejsc: string[]
  /** Pozycje w tablicy adresów (nie Adres.i). */
  pozycje: number[]
  nry: string[]
  kolejnosc?: number[]
}

export interface Indeks {
  adresy: Adres[]
  ulice: Ulica[]
  /** token ulicy → ulice, które go zawierają */
  slowa: Map<string, number[]>
  slownik: string[]
  slownikMiejsc: string[]
}

// Skróty ignorowane po obu stronach (w zapytaniu i w nazwach ulic), więc „ul. Grodzka”
// i „Grodzka” są tym samym, a „al. Pokoju” trafia w „Aleja Pokoju”.
const POMIJANE = new Set([
  'ul',
  'ulica',
  'al',
  'aleja',
  'alei',
  'os',
  'osiedle',
  'pl',
  'plac',
  'w',
  'we',
])

const LIMIT_ULIC = 40

export function normalizuj(tekst: string): string {
  return tekst
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/ ?\/ ?/g, '/')
    .trim()
}

function tokenizuj(tekst: string): string[] {
  const wynik: string[] = []
  for (const t of normalizuj(tekst).split(' ')) {
    const czysty = t.replace(/^\/+|\/+$/g, '')
    if (czysty) wynik.push(czysty)
  }
  return wynik
}

export function normalizujNr(nr: string): string {
  return normalizuj(nr)
    .replaceAll(' ', '')
    .replace(/^\/+|\/+$/g, '')
}

function tokenyUlicy(nazwa: string): string[] {
  const wszystkie = tokenizuj(nazwa)
  const bez = wszystkie.filter((t) => !POMIJANE.has(t))
  return bez.length > 0 ? bez : wszystkie
}

const indeksy = new WeakMap<Adres[], Indeks>()

export function indeksDla(adresy: Adres[]): Indeks {
  let ind = indeksy.get(adresy)
  if (!ind) {
    ind = zbudujIndeks(adresy)
    indeksy.set(adresy, ind)
  }
  return ind
}

export function zbudujIndeks(adresy: Adres[]): Indeks {
  const ulice: Ulica[] = []
  const poKluczu = new Map<string, number>()
  const slowa = new Map<string, number[]>()
  const slownikMiejsc = new Set<string>()
  const nrCache = new Map<string, string>()

  for (let pozycja = 0; pozycja < adresy.length; pozycja++) {
    const a = adresy[pozycja]
    if (!a) continue
    const klucz = `${a.ulica ?? ''}|${a.miejscowosc}|${a.teryt}`
    let id = poKluczu.get(klucz)
    if (id === undefined) {
      id = ulice.length
      poKluczu.set(klucz, id)
      const nazwa = a.ulica ?? a.miejscowosc
      const tokeny = tokenyUlicy(nazwa)
      const miejsc = [...tokenizuj(a.miejscowosc), ...tokenizuj(a.gmina)]
      for (const m of miejsc) slownikMiejsc.add(m)
      ulice.push({ nazwa, tokeny, miejsc, pozycje: [], nry: [] })
      for (const t of new Set(tokeny)) {
        const lista = slowa.get(t)
        if (lista) lista.push(id)
        else slowa.set(t, [id])
      }
    }
    let nr = nrCache.get(a.nr)
    if (nr === undefined) {
      nr = normalizujNr(a.nr)
      nrCache.set(a.nr, nr)
    }
    const u = ulice[id]
    if (!u) continue
    u.pozycje.push(pozycja)
    u.nry.push(nr)
  }
  return { adresy, ulice, slowa, slownik: [...slowa.keys()], slownikMiejsc: [...slownikMiejsc] }
}

/** Czy a i b różnią się o najwyżej jedną edycję (wstawienie, usunięcie, zamiana, przestawienie). */
function jedenBlad(a: string, b: string): boolean {
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  let i = 0
  while (i < la && i < lb && a.charCodeAt(i) === b.charCodeAt(i)) i++
  if (i === la || i === lb) return true
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/**
 * Jakość dopasowania tokenu zapytania q do słowa w: 4 pełne, 3,5 odmiana, 3 prefiks
 * (pisanie w toku), 1,5 literówka, 0 brak.
 */
function jakosc(q: string, w: string): number {
  if (q === w) return 4
  if (w.startsWith(q)) return 3
  const lq = q.length
  const lw = w.length
  if (lq < 4) return 0
  const m = Math.min(lq, lw)
  let p = 0
  while (p < m && q.charCodeAt(p) === w.charCodeAt(p)) p++
  // Wspólny rdzeń + końcówki do 4 znaków: „Grodzkiej” ~ „Grodzka”, „Kościuszce” ~ „Kościuszki”.
  if (p >= Math.max(4, m - 2) && lq - p <= 4 && lw - p <= 4) return 3.5
  const dl = Math.max(4, m - 2)
  const a = q.slice(0, dl)
  for (let n = dl - 1; n <= dl + 1; n++) {
    if (n >= 3 && n <= lw && jedenBlad(a, w.slice(0, n))) return 1.5
  }
  return 0
}

function pasujeMiejscowosc(q: string, mw: string): boolean {
  if (q === mw) return true
  if (q.length < 4) return false
  let p = 0
  const m = Math.min(q.length, mw.length)
  while (p < m && q.charCodeAt(p) === mw.charCodeAt(p)) p++
  // „w Krakowie” ~ „Kraków”, ale „Krakowska” (ulica) nie.
  return p >= 4 && p >= m - 2 && q.length - p <= 2 && mw.length - p <= 2
}

function porownajNr(a: string, b: string): number {
  const na = Number.parseInt(a, 10)
  const nb = Number.parseInt(b, 10)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

function kolejnoscNr(u: Ulica): number[] {
  if (!u.kolejnosc) {
    const widziane = new Set<string>()
    const idx: number[] = []
    for (let k = 0; k < u.nry.length; k++) {
      const nr = u.nry[k] as string
      if (!widziane.has(nr)) {
        widziane.add(nr)
        idx.push(k)
      }
    }
    idx.sort((x, y) => porownajNr(u.nry[x] as string, u.nry[y] as string))
    u.kolejnosc = idx
  }
  return u.kolejnosc
}

/** Rozbija zapytanie na słowa ulicy i numer domu („52a”, „5/7”). */
function rozbij(zapytanie: string): { slowa: string[]; nr: string | null } {
  const t = tokenizuj(zapytanie)
  // Numer to ostatni token od cyfry, ale nie pierwszy: „3 Maja” to ulica, „Grodzka 52 Kraków” ma numer w środku.
  let j = t.length - 1
  while (j > 0 && !/^\d/.test(t[j] as string)) j--
  let nr: string | null = null
  if (j > 0 && /^\d/.test(t[j] as string)) {
    nr = t[j] as string
    const nastepny = t[j + 1]
    // „52 a” pisane z odstępem
    if (nastepny && /^\d+$/.test(nr) && /^[a-z]$/.test(nastepny) && !POMIJANE.has(nastepny)) {
      nr += nastepny
      t.splice(j, 2)
    } else {
      t.splice(j, 1)
    }
  }
  return { slowa: t.filter((s) => !POMIJANE.has(s)), nr }
}

function mapaTokenu(ind: Indeks, q: string): Map<number, number> {
  const wynik = new Map<number, number>()
  for (const w of ind.slownik) {
    const j = jakosc(q, w)
    if (j === 0) continue
    for (const id of ind.slowa.get(w) as number[]) {
      if ((wynik.get(id) ?? 0) < j) wynik.set(id, j)
    }
  }
  return wynik
}

function przebieg(
  ind: Indeks,
  slowaUlicy: string[],
  lokalne: string[],
  nr: string | null,
  limit: number,
): Wynik[] {
  const mapy = slowaUlicy.map((q) => mapaTokenu(ind, q))
  const najmniejsza = mapy.reduce((a, b) => (b.size < a.size ? b : a))
  const ulice: { id: number; wynik: number }[] = []
  for (const id of najmniejsza.keys()) {
    const u = ind.ulice[id] as Ulica
    let suma = 0
    let ok = true
    for (const m of mapy) {
      const j = m.get(id)
      if (j === undefined) {
        ok = false
        break
      }
      suma += j
    }
    if (!ok) continue
    if (lokalne.length > 0) {
      const wszystkie = lokalne.every((q) =>
        u.miejsc.some((mw) => pasujeMiejscowosc(q, mw) || (q.length >= 3 && mw.startsWith(q))),
      )
      if (!wszystkie) continue
    }
    const pokrycie = Math.min(1, slowaUlicy.length / u.tokeny.length)
    ulice.push({ id, wynik: suma / mapy.length + 0.5 * pokrycie })
  }
  ulice.sort(
    (a, b) =>
      b.wynik - a.wynik ||
      (ind.ulice[a.id] as Ulica).tokeny.length - (ind.ulice[b.id] as Ulica).tokeny.length ||
      a.id - b.id,
  )
  const najlepsze = ulice.slice(0, LIMIT_ULIC)
  const trafienia: { pozycja: number; wynik: number }[] = []

  if (nr !== null) {
    for (const { id, wynik } of najlepsze) {
      const u = ind.ulice[id] as Ulica
      const widziane = new Set<string>()
      const lokalnie: { pozycja: number; wynik: number; nr: string }[] = []
      for (let k = 0; k < u.nry.length; k++) {
        const n = u.nry[k] as string
        let jakoscNr = 0
        if (n === nr) jakoscNr = 3
        else if (n.startsWith(nr)) jakoscNr = /\d/.test(n.charAt(nr.length)) ? 1.5 : 2
        if (jakoscNr === 0 || widziane.has(n)) continue
        widziane.add(n)
        lokalnie.push({ pozycja: u.pozycje[k] as number, wynik: wynik * 10 + jakoscNr, nr: n })
      }
      lokalnie.sort((a, b) => b.wynik - a.wynik || porownajNr(a.nr, b.nr))
      trafienia.push(...lokalnie.slice(0, limit))
    }
    trafienia.sort((a, b) => b.wynik - a.wynik)
  } else if (najlepsze.length > 0) {
    // Bez numeru: kilka pierwszych numerów ulicy. Przy wielu równorzędnych ulicach – po trochu z każdej.
    const szczyt = (najlepsze[0] as { wynik: number }).wynik
    const k = najlepsze.filter((s) => s.wynik >= szczyt - 0.01).length
    const naUlice = Math.max(1, Math.ceil(limit / k))
    for (const { id, wynik } of najlepsze) {
      if (trafienia.length >= limit) break
      const u = ind.ulice[id] as Ulica
      const ile = wynik >= szczyt - 0.01 ? naUlice : 1
      for (const kk of kolejnoscNr(u).slice(0, ile)) {
        trafienia.push({ pozycja: u.pozycje[kk] as number, wynik: wynik * 10 })
      }
    }
  }

  return trafienia.slice(0, limit).map(({ pozycja, wynik }) => {
    const a = ind.adresy[pozycja] as Adres
    return {
      i: a.i,
      tytul: tytulAdresu(a),
      opis: opisAdresu(a),
      wynik,
    }
  })
}

export function tytulAdresu(a: Adres): string {
  return `${a.ulica ?? a.miejscowosc} ${a.nr}`.trim()
}

export function opisAdresu(a: Adres): string {
  const miejsce = a.dzielnica ?? a.gmina
  return a.kod ? `${miejsce}, ${a.kod}` : miejsce
}

export function szukaj(ind: Indeks, zapytanie: string, limit = 8): Wynik[] {
  const { slowa, nr } = rozbij(zapytanie)
  if (slowa.length === 0 || ind.ulice.length === 0) return []

  const lokalne = slowa.filter((q) => ind.slownikMiejsc.some((mw) => pasujeMiejscowosc(q, mw)))
  const ulicowe = slowa.filter((q) => !lokalne.includes(q))
  if (lokalne.length > 0 && ulicowe.length > 0) {
    const w = przebieg(ind, ulicowe, lokalne, nr, limit)
    if (w.length > 0) return w
  }
  // Brak podziału albo zawężenie nic nie dało: „Krakowska” jest ulicą, nie miejscowością.
  return przebieg(ind, slowa, [], nr, limit)
}
