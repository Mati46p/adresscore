// Dekoder kompaktu z etl/kompakt.mjs. Czysty moduł (bez import.meta.env i Reacta), żeby
// round-trip testował się na gołym `node --test`. Kompakt to transport pochodny: `kompaktZgodny`
// sprawdza go z manifestem, a przy jakiejkolwiek niezgodności loader bierze JSON-y.
import type { Manifest, WskaznikMeta, Zrodlo } from '../kontrakty/index.ts'

export const FORMAT_KOMPAKTU = 2
const MAGIA = 'AKS1'

export interface PlikKompaktu {
  plik: string
  bajty: number
  sha256: string
}

export interface KafelKompaktu {
  /** Heks H3 kafla (rozdzielczość `resKafla`). */
  h3: string
  /** Pierwszy indeks adresu w kaflu (indeksy kompaktu są ciągłe w kaflu). */
  od: number
  n: number
  plik: string
}

/** public/dane/kompakt/indeks.json */
export interface IndeksKompaktu {
  format: number
  /** Skrót z wersji adresów i treści wszystkich warstw. */
  wersja: string
  wersjaAdresow: string
  n: number
  zrodla: Zrodlo[]
  atrapa?: boolean
  resKafla: number
  heksy: PlikKompaktu
  skale: PlikKompaktu
  szukaj: PlikKompaktu
  id: PlikKompaktu
  wskazniki: Record<
    string,
    {
      wersjaAdresow: string
      meta: WskaznikMeta
      pokrycie: { zDanymi: number; wszystkich: number }
      heksy: PlikKompaktu
      filtr: PlikKompaktu
    }
  >
  /** Warstwy policzone dla innej wersji adresów: id → ich wersjaAdresow. */
  pominiete: Record<string, string>
  kafle: KafelKompaktu[]
}

/** Plik kafla kafle/<h3>.<skrót>.json.gz – JSON spakowany gzipem. */
export interface PlikKafla {
  format: number
  wersja: string
  kafel: string
  od: number
  n: number
  kolumny: {
    id: string[]
    miejscowosc: string[]
    ulica: (string | null)[]
    nr: string[]
    kod: (string | null)[]
    dzielnica: (string | null)[]
    gmina: string[]
    teryt: string[]
    lon: number[]
    lat: number[]
    h3: string[]
  }
  wartosci: Record<string, (number | null)[]>
  etykiety: Record<string, (string | null)[]>
}

type Tablica = Uint8Array | Uint16Array | Uint32Array | Int32Array | Float64Array
const TYPY = {
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  i32: Int32Array,
  f64: Float64Array,
} as const

type OpisKolumny =
  | { rodzaj: 'slownik'; sekcja: string; slownik: (string | null)[] }
  | { rodzaj: 'h3'; gora: string; dol: string }
  | {
      rodzaj: 'id'
      rodzaje: { prefiks: string; typ: 'liczba' | 'uuid' | 'tekst' }[]
      inne: string[]
      sekcja: string
      liczby: string
      uuid: string
    }

export interface Naglowek {
  format: number
  n: number
  wersja: string
  warstwy?: string[]
  skalaOceny?: number
  skalaUdzialu?: number
  brak?: number
  kolumny: Record<string, OpisKolumny>
  sekcje: { nazwa: string; typ: keyof typeof TYPY; n: number }[]
}

export interface Rozpakowany {
  naglowek: Naglowek
  sekcje: Record<string, Tablica>
}

// ── Plik ─────────────────────────────────────────────────────────────────────────────────

async function rozgzipuj(bajty: Uint8Array): Promise<Uint8Array> {
  // Hosting, który sam doda Content-Encoding: gzip, odda już rozpakowane bajty – wtedy
  // nie ma nagłówka gzip i bierzemy je wprost.
  if (bajty[0] !== 0x1f || bajty[1] !== 0x8b) return bajty
  const strumien = new Blob([bajty as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(strumien).arrayBuffer())
}

export async function odczytajKafel(bufor: ArrayBuffer | Uint8Array): Promise<PlikKafla> {
  const bajty = await rozgzipuj(bufor instanceof Uint8Array ? bufor : new Uint8Array(bufor))
  const kafel = JSON.parse(new TextDecoder().decode(bajty)) as PlikKafla
  if (kafel.format !== FORMAT_KOMPAKTU || !kafel.kolumny || !kafel.wartosci)
    throw new Error('Nieprawidłowy kafel kompaktu')
  return kafel
}

function odtasuj(
  bajty: Uint8Array,
  przes: number,
  Typ: (typeof TYPY)[keyof typeof TYPY],
  n: number,
) {
  const t = new Typ(n)
  const w = Typ.BYTES_PER_ELEMENT
  const cel = new Uint8Array(t.buffer)
  if (w === 1) {
    cel.set(bajty.subarray(przes, przes + n))
    return t
  }
  for (let b = 0; b < w; b++) {
    const zrodlo = przes + b * n
    for (let i = 0; i < n; i++) cel[i * w + b] = bajty[zrodlo + i] as number
  }
  return t
}

/** Rozpakowuje plik .bin. Rzuca błąd, gdy to nie kompakt (np. index.html z przepisania SPA). */
export async function rozpakuj(bufor: ArrayBuffer | Uint8Array): Promise<Rozpakowany> {
  const bajty = await rozgzipuj(bufor instanceof Uint8Array ? bufor : new Uint8Array(bufor))
  if (String.fromCharCode(...bajty.subarray(0, 4)) !== MAGIA) {
    throw new Error('To nie jest plik kompaktu')
  }
  const dlugosc = new DataView(bajty.buffer, bajty.byteOffset, bajty.byteLength).getUint32(4, true)
  const naglowek = JSON.parse(new TextDecoder().decode(bajty.subarray(8, 8 + dlugosc))) as Naglowek
  if (naglowek.format !== FORMAT_KOMPAKTU) throw new Error(`Format kompaktu ${naglowek.format}`)
  const wyrownaj = (x: number) => Math.ceil(x / 8) * 8
  let przes = wyrownaj(8 + dlugosc)
  const sekcje: Record<string, Tablica> = {}
  for (const s of naglowek.sekcje) {
    const Typ = TYPY[s.typ]
    const rozmiar = s.n * Typ.BYTES_PER_ELEMENT
    if (przes + rozmiar > bajty.length) throw new Error(`Ucięta sekcja ${s.nazwa}`)
    sekcje[s.nazwa] = odtasuj(bajty, przes, Typ, s.n)
    przes += wyrownaj(rozmiar)
  }
  return { naglowek, sekcje }
}

export function sekcja(r: Rozpakowany, nazwa: string): Tablica {
  const t = r.sekcje[nazwa]
  if (!t) throw new Error(`Brak sekcji ${nazwa}`)
  return t
}

function kolumna<R extends OpisKolumny['rodzaj']>(
  r: Rozpakowany,
  nazwa: string,
  rodzaj: R,
): Extract<OpisKolumny, { rodzaj: R }> {
  const k = r.naglowek.kolumny[nazwa]
  if (!k || k.rodzaj !== rodzaj) throw new Error(`Kolumna ${nazwa} nie jest typu ${rodzaj}`)
  return k as Extract<OpisKolumny, { rodzaj: R }>
}

// ── Kolumny ──────────────────────────────────────────────────────────────────────────────

/** Kolumna słownikowa jako słownik + indeksy – bez rozwijania 176 tys. odwołań. */
export function slownikowa(r: Rozpakowany, nazwa: string) {
  const k = kolumna(r, nazwa, 'slownik')
  return { slownik: k.slownik, indeksy: sekcja(r, k.sekcja) }
}

export function listaHeksow(r: Rozpakowany, nazwa: string): string[] {
  const k = kolumna(r, nazwa, 'h3')
  const dol = sekcja(r, k.dol)
  return Array.from(
    sekcja(r, k.gora),
    (g, p) => g.toString(16).padStart(7, '0') + (dol[p] as number).toString(16).padStart(8, '0'),
  )
}

const HEX = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'))

export function dekodujId(r: Rozpakowany): string[] {
  const k = kolumna(r, 'id', 'id')
  const rodzaj = sekcja(r, k.sekcja)
  const liczby = sekcja(r, k.liczby)
  const uuid = sekcja(r, k.uuid)
  const wynik = new Array<string>(rodzaj.length)
  let l = 0
  let u = 0
  let t = 0
  let suma = 0
  for (let i = 0; i < rodzaj.length; i++) {
    const opis = k.rodzaje[rodzaj[i] as number]
    if (!opis) throw new Error('Nieznany rodzaj id')
    if (opis.typ === 'liczba') {
      suma += liczby[l++] as number
      wynik[i] = opis.prefiks + suma
    } else if (opis.typ === 'uuid') {
      let h = ''
      for (let b = 0; b < 16; b++) {
        h += HEX[uuid[u * 16 + b] as number]
        if (b === 3 || b === 5 || b === 7 || b === 9) h += '-'
      }
      u++
      wynik[i] = opis.prefiks + h
    } else {
      wynik[i] = k.inne[t++] ?? ''
    }
  }
  return wynik
}

// ── Decyzja: kompakt czy JSON ────────────────────────────────────────────────────────────

/** Porównanie meta bez wrażliwości na kolejność kluczy. */
function stabilnie(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stabilnie).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stabilnie(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/**
 * Czy kompakt odpowiada manifestowi. Heksy łączą wszystkie warstwy w jednej macierzy, więc
 * nie da się mieszać warstw z kompaktu i z JSON-a: każda warstwa manifestu musi mieć w kompakcie
 * tę samą meta i wersję adresów (albo być w nim pominięta z tą samą obcą wersją, jak w JSON-ie).
 * Zwraca powód niezgodności albo null, gdy kompakt jest aktualny.
 */
export function niezgodnoscKompaktu(indeks: unknown, manifest: Manifest): string | null {
  const ix = indeks as IndeksKompaktu | null
  if (!ix || typeof ix !== 'object') return 'brak indeksu kompaktu'
  if (ix.format !== FORMAT_KOMPAKTU) return `format ${String(ix.format)}`
  if (!ix.heksy?.plik || !ix.skale?.plik || !ix.wskazniki || !Array.isArray(ix.kafle))
    return 'niepełny indeks'
  const ids = new Set(manifest.wskazniki.map((w) => w.id))
  for (const id of Object.keys(ix.wskazniki)) if (!ids.has(id)) return `${id}: nadmiarowa warstwa`
  for (const id of Object.keys(ix.pominiete ?? {}))
    if (!ids.has(id)) return `${id}: nadmiarowa warstwa`
  for (const { wersjaAdresow, ...meta } of manifest.wskazniki) {
    const wpis = ix.wskazniki[meta.id]
    if (wpis) {
      if (wpis.wersjaAdresow !== wersjaAdresow) return `${meta.id}: inna wersja adresów`
      if (stabilnie(wpis.meta) !== stabilnie(meta)) return `${meta.id}: inna meta`
      if (!wpis.heksy?.plik || !wpis.filtr?.plik) return `${meta.id}: brak plików warstwy`
    } else if (ix.pominiete?.[meta.id] !== wersjaAdresow || wersjaAdresow === ix.wersjaAdresow) {
      return `${meta.id}: brak w kompakcie`
    }
  }
  return null
}
