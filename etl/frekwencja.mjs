// Frekwencja w wyborach samorządowych 2024 (dzień głosowania 7.04.2024) na poziomie gminy (#142).
// Kontekst na karcie, bez wpływu na wynik. Uruchom: node etl/frekwencja.mjs
//
// Wartość = ważne karty do głosowania do sejmiku województwa / wyborcy uprawnieni, w gminie adresu.
// Tak liczy tabela wybory_frekwencja z-dykty.pl: 2411 z 2411 gmin w tej tabeli zgadza się co do
// jednostki z sumą protokołów obwodowych komisji KBW (uprawnieni i „Liczba kart ważnych”).
//
// Źródła:
//  1. z-dykty.pl, PostgREST: wybory_frekwencja, elekcja samorzad-2024 (publiczny klucz anon z env
//     albo .env.local, nigdy w repo). Odpowiedź leży w etl/.cache/ (drugi bieg nie pyta ponownie).
//  2. KBW (danewyborcze.kbw.gov.pl), protokoły po obwodach, sejmiki województw. Uzupełnia gminy,
//     których z-dykty nie ma: 66 miast na prawach powiatu, w tym Kraków (40% naszych adresów).
//     Ta sama metoda, więc liczba jest porównywalna. Dla gmin obecnych w obu źródłach skrypt
//     porównuje liczby i przerywa przy najmniejszej różnicy – nie mieszamy dwóch definicji.
//
// Rozdzielczość: gmina, nie okręg. Tabela okregi_wyborcze w z-dykty to 41 okręgów sejmowych
// (nazwa i siedziba, bez geometrii), a okręgi rad gmin 2024 KBW opisuje wolnym tekstem („Opis
// granic”: ulice z zakresami numerów i sołectwa, w Krakowie do 10 tys. znaków na okręg), bez
// geometrii. Przypisanie 176 tys. adresów takim opisom byłoby zgadywaniem na nazwach ulic.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'
import {
  CACHE,
  dzis,
  MIASTO,
  KORZEN,
  pobierzDoCache,
  wczytajAdresy,
  zapiszWskaznik,
} from './lib/wspolne.mjs'
import { csv } from './wybory-sejm-2023.mjs'

export const ID = 'frekwencja_samorzad_2024'
export const ELEKCJA = 'samorzad-2024'
const DATA_WYBOROW = '2024-04-07'
const ZDYKTY_STRONA = 'https://z-dykty.pl/dane'
const KBW_STRONA = 'https://danewyborcze.kbw.gov.pl/indexbea2.html?title=Samorz%C4%85d_2024'
const KBW_ZIP =
  'https://danewyborcze.kbw.gov.pl/dane/2024/samorzad/protokoly_po_obwodach_sejmik_wojewodztwa_csv.zip'
const PLIK_ZDYKTY = join(CACHE, 'zdykty-wybory-frekwencja-samorzad-2024.json')
const PLIK_KBW = 'kbw-samorzad2024-protokoly-sejmik.zip'
/** PostgREST Supabase tnie odpowiedź do 1000 wierszy; mniejszą stronę wyłapie kontrola sumy. */
const ROZMIAR_STRONY = 1000
const MAX_STRON = 20

// --- Wspólna arytmetyka ---------------------------------------------------------------------

/** Odsetek z dokładnością do 0,01 (jak w z-dykty). Brak uprawnionych = brak danych, nie 0. */
export function procent(wazne, uprawnieni) {
  if (!(uprawnieni > 0)) return null
  return Math.round((10000 * wazne) / uprawnieni) / 100
}

function calkowita(tekst, opis) {
  if (!/^\d+$/.test(tekst ?? '')) throw new Error(`KBW: ${opis} nie jest liczbą: „${tekst}”`)
  return Number(tekst)
}

// --- z-dykty --------------------------------------------------------------------------------

/**
 * Wszystkie wiersze wybory_frekwencja dla samorzad-2024, strona po stronie (limit/offset, stabilny
 * order). Klucz idzie wyłącznie w nagłówku, więc nie trafia do adresu ani do komunikatów błędów.
 */
export async function pobierzZdykty({ baza, klucz, fetchFn = fetch, rozmiar = ROZMIAR_STRONY }) {
  const wiersze = []
  let razem = null
  for (let strona = 0; strona < MAX_STRON; strona++) {
    const url =
      `${baza}/rest/v1/wybory_frekwencja?select=gmina_teryt,uprawnieni,glosy_oddane,frekwencja_pct` +
      `&elekcja_id=eq.${ELEKCJA}&order=gmina_teryt.asc&limit=${rozmiar}&offset=${strona * rozmiar}`
    const odp = await fetchFn(url, {
      headers: { apikey: klucz, Accept: 'application/json', Prefer: 'count=exact' },
    })
    if (!odp.ok) throw new Error(`z-dykty wybory_frekwencja: HTTP ${odp.status}`)
    const porcja = await odp.json()
    if (!Array.isArray(porcja)) throw new Error('z-dykty wybory_frekwencja: to nie tablica')
    const suma = /\/(\d+)$/.exec(odp.headers.get('content-range') ?? '')
    if (suma) razem = Number(suma[1])
    wiersze.push(...porcja)
    if (porcja.length < rozmiar) {
      if (razem !== null && razem !== wiersze.length)
        throw new Error(`z-dykty wybory_frekwencja: pobrano ${wiersze.length} z ${razem} wierszy`)
      return wiersze
    }
  }
  throw new Error(`z-dykty wybory_frekwencja: ponad ${MAX_STRON} stron`)
}

/** Sprawdza wiersz z-dykty (liczby spójne z odsetkiem) i zwraca postać wewnętrzną. */
export function walidujWierszZdykty(w) {
  const teryt = w?.gmina_teryt
  if (!/^\d{7}$/.test(teryt ?? '')) throw new Error(`z-dykty: niepoprawny TERYT „${teryt}”`)
  if (!Number.isInteger(w.uprawnieni) || w.uprawnieni <= 0)
    throw new Error(`z-dykty ${teryt}: uprawnieni ${w.uprawnieni}`)
  if (!Number.isInteger(w.glosy_oddane) || w.glosy_oddane < 0 || w.glosy_oddane > w.uprawnieni)
    throw new Error(`z-dykty ${teryt}: glosy_oddane ${w.glosy_oddane} poza zakresem 0..uprawnieni`)
  const licz = procent(w.glosy_oddane, w.uprawnieni)
  // 0,011, nie 0,01: różnica jednego miejsca po przecinku w zapisie zmiennoprzecinkowym bywa 0,01000…1
  if (!Number.isFinite(w.frekwencja_pct) || Math.abs(w.frekwencja_pct - licz) > 0.011)
    throw new Error(
      `z-dykty ${teryt}: frekwencja_pct ${w.frekwencja_pct}, z liczb wychodzi ${licz}`,
    )
  return { teryt, uprawnieni: w.uprawnieni, wazne: w.glosy_oddane }
}

function kluczeZdykty() {
  if (!process.env.ZDYKTY_SUPABASE_URL || !process.env.ZDYKTY_ANON_KEY) {
    try {
      process.loadEnvFile(join(KORZEN, '.env.local'))
    } catch {
      // brak pliku: komunikat o brakujących zmiennych poniżej
    }
  }
  const baza = process.env.ZDYKTY_SUPABASE_URL?.replace(/\/+$/, '')
  const klucz = process.env.ZDYKTY_ANON_KEY
  if (!baza || !klucz)
    throw new Error(
      'Brak ZDYKTY_SUPABASE_URL albo ZDYKTY_ANON_KEY (zmienne środowiska, .env.local)',
    )
  return { baza, klucz }
}

async function wczytajZdykty() {
  if (existsSync(PLIK_ZDYKTY)) return JSON.parse(readFileSync(PLIK_ZDYKTY, 'utf8'))
  // Miasta na prawach powiatu (ADRESCORE_MIASTO) pokrywa w całości KBW – bez klucza z-dykty pomijamy.
  if (MIASTO) {
    try {
      kluczeZdykty()
    } catch {
      return { elekcja: ELEKCJA, pobrano: dzis(), wiersze: [] }
    }
  }
  const { baza, klucz } = kluczeZdykty()
  const wiersze = await pobierzZdykty({ baza, klucz })
  const zapis = { elekcja: ELEKCJA, pobrano: dzis(), wiersze }
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(PLIK_ZDYKTY, JSON.stringify(zapis))
  return zapis
}

// --- KBW ------------------------------------------------------------------------------------

/** „gm. Skawina”, „m. Kraków”, „m. st. Warszawa” → nazwa gminy bez przedrostka rodzaju. */
export function nazwaGminyKbw(tekst) {
  return String(tekst ?? '')
    .replace(/^(m\.\s*st\.|m\.|gm\.)\s+/i, '')
    .trim()
}

/**
 * Sumy po obwodach dla gmin z `potrzebne` (6-cyfrowy TERYT). KBW zapisuje kod liczbowo, więc dla
 * województw 02, 04, 06 i 08 gubi zero z przodu – stąd padStart. Puste albo nieliczbowe pole to
 * błąd: cicho pominięty protokół zaniżyłby frekwencję całej gminy.
 */
export function sumujProtokoly(wiersze, potrzebne) {
  const [naglowek, ...dane] = wiersze
  const kolumna = (nazwa) => {
    const i = naglowek?.indexOf(nazwa) ?? -1
    if (i < 0) throw new Error(`KBW: brak kolumny „${nazwa}”`)
    return i
  }
  const iTeryt = kolumna('Teryt Gminy')
  const iGmina = kolumna('Gmina')
  const iUpr = kolumna('Liczba wyborców uprawnionych do głosowania')
  const iWazne = kolumna('Liczba kart ważnych')
  const wynik = new Map()
  for (const w of dane) {
    let teryt = (w[iTeryt] ?? '').trim().padStart(6, '0')
    // Warszawa: KBW podaje 18 dzielnic (146502…146519) jako osobne „gminy” – sumujemy do 146501.
    const warszawa = /^1465(0[2-9]|1\d)$/.test(teryt) && potrzebne.has('146501')
    if (warszawa) teryt = '146501'
    if (!potrzebne.has(teryt)) continue
    const a = wynik.get(teryt) ?? {
      teryt,
      nazwa: warszawa ? 'Warszawa' : nazwaGminyKbw(w[iGmina]),
      uprawnieni: 0,
      wazne: 0,
      obwodow: 0,
    }
    a.uprawnieni += calkowita(w[iUpr], `uprawnieni, gmina ${teryt}`)
    a.wazne += calkowita(w[iWazne], `karty ważne, gmina ${teryt}`)
    a.obwodow++
    wynik.set(teryt, a)
  }
  return wynik
}

/** Rozpakowuje ZIP KBW (jeden CSV na województwo) i zbiera sumy gmin z `potrzebne`. */
export function wczytajProtokolyKbw(sciezkaZip, potrzebne) {
  const pliki = unzipSync(readFileSync(sciezkaZip), { filter: (p) => p.name.endsWith('.csv') })
  const wynik = new Map()
  for (const [nazwa, bajty] of Object.entries(pliki)) {
    const tekst = new TextDecoder().decode(bajty).replace(/^\uFEFF/, '')
    for (const [teryt, a] of sumujProtokoly(csv(tekst), potrzebne)) {
      if (wynik.has(teryt))
        throw new Error(`KBW: gmina ${teryt} w więcej niż jednym pliku (${nazwa})`)
      wynik.set(teryt, a)
    }
  }
  return wynik
}

// --- Składanie wskaźnika --------------------------------------------------------------------

const liczba = (n) => n.toLocaleString('pl-PL')

function opisGminy(g) {
  const baza = `${g.nazwa} (TERYT ${g.teryt}): ${liczba(g.wazne)} z ${liczba(g.uprawnieni)} uprawnionych oddało ważną kartę w wyborach samorządowych 7.04.2024. Wynik całej gminy, nie okolicy adresu.`
  return g.zrodlo === 'kbw'
    ? `${baza} Liczone z protokołów komisji obwodowych (KBW), bo z-dykty.pl nie ma tej gminy.`
    : baza
}

/**
 * Wartości dla adresów. `zdykty`: wiersze po walidujWierszZdykty, `kbw`: Map 6-cyfrowy TERYT →
 * sumy z KBW. Gmina z obu źródeł musi mieć identyczne liczby, inaczej błąd (inna metoda liczenia).
 * Gmina bez żadnego źródła dostaje null. Etykiety to jednoznakowe klucze słownika: pełny TERYT
 * przy 176 tys. adresów przekroczyłby limit 2 MB pliku wskaźnika.
 */
export function zbudujFrekwencje({ adresy, zdykty, kbw }) {
  const gminy = new Map()
  for (const a of adresy) {
    if (!/^\d{7}$/.test(a.teryt)) throw new Error(`Niepoprawny TERYT adresu: ${a.teryt}`)
    const g = gminy.get(a.teryt) ?? { teryt: a.teryt, nazwa: a.gmina, adresow: 0 }
    if (g.nazwa !== a.gmina)
      throw new Error(`Niespójna nazwa gminy ${a.teryt}: ${g.nazwa}, ${a.gmina}`)
    g.adresow++
    gminy.set(a.teryt, g)
  }
  const zdyktyPoTeryt = new Map(zdykty.map((w) => [w.teryt, w]))
  const gminyZDanymi = []
  let zgodnych = 0
  for (const g of [...gminy.values()].sort((x, y) => (x.teryt < y.teryt ? -1 : 1))) {
    const z = zdyktyPoTeryt.get(g.teryt) ?? null
    const k = kbw.get(g.teryt.slice(0, 6)) ?? null
    if (k && k.nazwa !== g.nazwa)
      throw new Error(`Gmina ${g.teryt}: w adresach „${g.nazwa}”, w KBW „${k.nazwa}”`)
    if (z && k) {
      if (z.uprawnieni !== k.uprawnieni || z.wazne !== k.wazne)
        throw new Error(
          `Gmina ${g.nazwa} (${g.teryt}): z-dykty ${z.wazne} z ${z.uprawnieni}, KBW ${k.wazne} z ${k.uprawnieni} – źródła liczą inaczej`,
        )
      zgodnych++
    }
    const dane = z ?? k
    gminyZDanymi.push({
      ...g,
      zrodlo: z ? 'z-dykty' : k ? 'kbw' : null,
      uprawnieni: dane?.uprawnieni ?? null,
      wazne: dane?.wazne ?? null,
      procent: dane ? procent(dane.wazne, dane.uprawnieni) : null,
    })
  }
  const poTeryt = new Map(gminyZDanymi.map((g) => [g.teryt, g]))
  const klucze = new Map(gminyZDanymi.map((g, i) => [g.teryt, i.toString(36)]))
  const slownikEtykiet = Object.fromEntries(
    gminyZDanymi.filter((g) => g.procent !== null).map((g) => [klucze.get(g.teryt), opisGminy(g)]),
  )
  return {
    gminy: gminyZDanymi,
    zgodnych,
    wartosci: adresy.map((a) => poTeryt.get(a.teryt).procent),
    etykiety: adresy.map((a) =>
      poTeryt.get(a.teryt).procent === null ? null : klucze.get(a.teryt),
    ),
    slownikEtykiet,
  }
}

function dataPliku(sciezka) {
  return statSync(sciezka).mtime.toISOString().slice(0, 10)
}

export async function uruchom() {
  const { adresy } = wczytajAdresy()
  const teryty = new Set(adresy.map((a) => a.teryt))
  const zrodloZdykty = await wczytajZdykty()
  const sciezkaKbw = await pobierzDoCache(KBW_ZIP, PLIK_KBW)
  const zdykty = zrodloZdykty.wiersze
    .filter((w) => teryty.has(w.gmina_teryt))
    .map(walidujWierszZdykty)
  const kbw = wczytajProtokolyKbw(sciezkaKbw, new Set([...teryty].map((t) => t.slice(0, 6))))
  const wynik = zbudujFrekwencje({ adresy, zdykty, kbw })

  const zGmin = (zrodlo) => wynik.gminy.filter((g) => g.zrodlo === zrodlo)
  const bezDanych = wynik.gminy.filter((g) => g.zrodlo === null)
  console.log(
    `Frekwencja: ${wynik.gminy.length} gmin, ${adresy.length} adresów; z-dykty ${zGmin('z-dykty').length}, KBW ${zGmin('kbw').length} (${
      zGmin('kbw')
        .map((g) => g.nazwa)
        .join(', ') || '-'
    }), bez danych ${bezDanych.length}; zgodność obu źródeł: ${wynik.zgodnych} gmin`,
  )

  const zrodla = []
  if (zGmin('z-dykty').length)
    zrodla.push({
      nazwa:
        'Państwowa Komisja Wyborcza – frekwencja w wyborach samorządowych 2024, gminy (przetworzone przez z-dykty.pl, CC BY 4.0)',
      url: ZDYKTY_STRONA,
      licencja:
        'Dane źródłowe PKW: informacja publiczna. Opracowanie z-dykty.pl: CC BY 4.0 – https://creativecommons.org/licenses/by/4.0/',
      dataDanych: DATA_WYBOROW,
      pobrano: zrodloZdykty.pobrano,
    })
  if (zGmin('kbw').length)
    zrodla.push({
      nazwa:
        'Krajowe Biuro Wyborcze / PKW – protokoły obwodowych komisji, wybory do sejmików województw 2024 (suma po obwodach gminy; tylko gminy, których nie ma w z-dykty.pl)',
      url: KBW_STRONA,
      licencja: 'Dane urzędowe; na stronie zbioru nie wskazano odrębnej licencji',
      dataDanych: DATA_WYBOROW,
      pobrano: dataPliku(sciezkaKbw),
    })

  zapiszWskaznik(
    {
      id: ID,
      kategoria: 'kontekst',
      nazwa: 'Frekwencja w wyborach samorządowych 2024',
      jednostka: '%',
      opis: 'Odsetek uprawnionych do głosowania, którzy oddali ważną kartę w wyborach samorządowych 7 kwietnia 2024 (głosowanie do sejmiku województwa), w gminie adresu. To wynik całej gminy w jeden dzień, bez podziału na okręgi i obwody, więc nie opisuje okolicy ani mieszkańców samego adresu. Kontekst: nie wpływa na wynik.',
      kierunek: 'neutralny',
      rozdzielczosc: 'gmina',
      rozmiar: 'gmina',
      zakres: [0, 100],
      zadanie: 142,
      zrodla,
    },
    wynik.wartosci,
    wynik.etykiety,
    wynik.slownikEtykiet,
  )
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  uruchom().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
