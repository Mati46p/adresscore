// Pierwsza mapa korzysta z kilkuset kB agregatów heksów. Pełne dane adresowe mogą
// wczytywać się równolegle; po ich nadejściu karta i porównanie liczą dokładne wyniki.
import { useEffect, useSyncExternalStore } from 'react'
import { type Manifest, wczytajManifest } from '@/kontrakty'
import {
  liczoneWarstwy,
  POZIOMY,
  type PodstawaHeksow,
  type Res,
  type WarstwaHeksow,
  wynikiHeksow,
} from './heksy.ts'
import {
  type IndeksKompaktu,
  listaHeksow,
  niezgodnoscKompaktu,
  rozpakuj,
  sekcja,
  slownikowa,
} from './kompakt.ts'
import { PERSONA_DOMYSLNA, ustawieniaPersony } from './persony.ts'
import { useStan } from './stan.ts'

interface Gotowe {
  stan: 'gotowe'
  indeks: IndeksKompaktu
  manifest: Manifest
  podstawa: PodstawaHeksow
  warstwy: ReadonlyMap<string, WarstwaHeksow>
}
type Stan = { stan: 'ladowanie' } | { stan: 'brak' } | Gotowe

let biezacy: Stan = { stan: 'ladowanie' }
let obietnica: Promise<void> | null = null
const sluchacze = new Set<() => void>()
const pobierane = new Set<string>()
const baza = `${import.meta.env.BASE_URL}dane/kompakt/`

function ustaw(nowy: Stan) {
  biezacy = nowy
  for (const s of sluchacze) s()
}

async function pobierz(plik: string): Promise<ArrayBuffer> {
  const odp = await fetch(`${baza}${plik}`)
  if (!odp.ok) throw new Error(`Kompakt ${plik}: HTTP ${odp.status}`)
  return odp.arrayBuffer()
}

function slownik(r: Awaited<ReturnType<typeof rozpakuj>>, nazwa: string): string[] {
  const { slownik, indeksy } = slownikowa(r, nazwa)
  return Array.from(indeksy, (i) => slownik[i] ?? '')
}

function podstawaZPliku(r: Awaited<ReturnType<typeof rozpakuj>>): PodstawaHeksow {
  const poziomy = {} as PodstawaHeksow['poziomy']
  for (const res of POZIOMY) {
    poziomy[res] = { heksy: listaHeksow(r, `r${res}`), liczba: sekcja(r, `liczba${res}`) }
  }
  return {
    skalaOceny: r.naglowek.skalaOceny ?? 1,
    skalaUdzialu: r.naglowek.skalaUdzialu ?? 200,
    poziomy,
    od: sekcja(r, 'od') as Uint32Array,
    ulica: slownik(r, 'ulica'),
    dzielnica: slownik(r, 'dzielnica'),
  }
}

async function start(): Promise<void> {
  try {
    const [manifest, odp] = await Promise.all([wczytajManifest(), fetch(`${baza}indeks.json`)])
    if (!odp.ok) throw new Error(`Brak indeksu kompaktu: HTTP ${odp.status}`)
    const indeks = (await odp.json()) as IndeksKompaktu
    const blad = niezgodnoscKompaktu(indeks, manifest)
    if (blad) throw new Error(`Nieaktualny kompakt: ${blad}`)
    const podstawa = podstawaZPliku(await rozpakuj(await pobierz(indeks.heksy.plik)))
    ustaw({ stan: 'gotowe', indeks, manifest, podstawa, warstwy: new Map() })
  } catch (e) {
    // Pełny JSON pozostaje bezpieczną ścieżką przy braku albo niezgodności pochodnych plików.
    console.warn('Mapa wstępna użyje pełnych danych:', e)
    ustaw({ stan: 'brak' })
  }
}

function subskrybuj(f: () => void) {
  sluchacze.add(f)
  obietnica ??= start()
  return () => sluchacze.delete(f)
}

function bezSubskrypcji(_f: () => void) {
  return () => {}
}

function pobierzWarstwe(id: string, stan: Gotowe) {
  if (stan.warstwy.has(id) || pobierane.has(id)) return
  const wpis = stan.indeks.wskazniki[id]
  if (!wpis) return
  pobierane.add(id)
  void pobierz(wpis.heksy.plik)
    .then(rozpakuj)
    .then((r) => {
      if (biezacy.stan !== 'gotowe' || biezacy.indeks !== stan.indeks) return
      const ocena = {} as WarstwaHeksow['ocena']
      const udzial = {} as WarstwaHeksow['udzial']
      for (const res of POZIOMY) {
        ocena[res] = sekcja(r, `ocena${res}`) as Uint8Array
        udzial[res] = sekcja(r, `udzial${res}`) as Uint8Array
      }
      const warstwy = new Map(biezacy.warstwy)
      warstwy.set(id, { ocena, udzial })
      ustaw({ ...biezacy, warstwy })
    })
    .catch((e) => console.warn(`Warstwa ${id} poza mapą wstępną:`, e))
    .finally(() => pobierane.delete(id))
}

/** Zwraca kolor heksów przed pobraniem pełnych adresów; null oznacza fallback na JSON. */
export function useWstepnaMapa(aktywna = true): {
  heksy: ReadonlyMap<string, number | null>
  podpis: string
} | null {
  const stan = useSyncExternalStore(
    aktywna ? subskrybuj : bezSubskrypcji,
    () => biezacy,
    () => biezacy,
  )
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const warstwa = useStan((s) => s.warstwa)
  const persona = useStan((s) => s.persona)
  const tryb = useStan((s) => s.tryb)
  const gotowe = stan.stan === 'gotowe' ? stan : null
  const meta = gotowe?.manifest.wskazniki ?? []
  const domyslne =
    Object.keys(wagi).length === 0
      ? ustawieniaPersony(persona === 'wlasna' ? PERSONA_DOMYSLNA : persona, tryb, meta)
      : null
  const efektywneWagi = domyslne?.wagi ?? wagi
  const efektywneKierunki = domyslne?.kierunki ?? kierunki
  const liczone = gotowe ? liczoneWarstwy(meta, efektywneWagi, efektywneKierunki, warstwa) : []

  useEffect(() => {
    if (!gotowe || !aktywna) return
    for (const { id } of liczone) pobierzWarstwe(id, gotowe)
  }, [gotowe, liczone, aktywna])

  if (
    !aktywna ||
    !gotowe ||
    liczone.some(({ id }) => gotowe.indeks.wskazniki[id] && !gotowe.warstwy.has(id))
  )
    return null
  const wynik = wynikiHeksow(
    gotowe.podstawa,
    10 as Res,
    liczone,
    (id) => gotowe.warstwy.get(id) ?? null,
  )
  const heksy = new Map<string, number | null>()
  gotowe.podstawa.poziomy[10].heksy.forEach((h, i) => {
    const v = wynik.wartosc[i] as number
    heksy.set(h, Number.isFinite(v) ? v : null)
  })
  const podpis =
    warstwa === 'wynik'
      ? 'Wynik tej okolicy'
      : (meta.find((w) => w.id === warstwa)?.nazwa ?? warstwa)
  return { heksy, podpis }
}
