// Klient CEIDG API v3 dla warstwy usług (#104). Trzy zasady:
//  1. Budżet zapytań: limit API (1000/h) dzielimy z innym projektem, więc zapytań jest ograniczona
//     liczba, a odpowiedzi leżą w cache (drugi bieg nie pyta ponownie).
//  2. Minimalizacja danych osobowych: z odpowiedzi zostaje wyłącznie adres działalności i data
//     rozpoczęcia. Nazwa firmy, właściciel, NIP, REGON i identyfikator NIGDY nie trafiają na dysk.
//  3. Awaria CEIDG nie blokuje reszty: odmowa API albo brak tokenu kończy się raportem, nie błędem.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BRANZE, OBSZARY_CEIDG, pkdDoParametru } from './uslugi-katalog.mjs'
import { CACHE, KORZEN } from './wspolne.mjs'

export const CEIDG_URL = 'https://dane.biznes.gov.pl/api/ceidg/v3/firmy'
/** Maksymalny rozmiar strony API (większy daje błąd NIEPOPRAWNY_ROZMIAR_STRONY). */
export const ROZMIAR_STRONY = 25
/** Poniżej tylu pozostałych zapytań w oknie godzinnym przestajemy pytać – reszta należy do z-dykty. */
export const REZERWA_LIMITU = 500

/** Odmowa albo awaria po stronie CEIDG: warstwa idzie dalej bez uzupełnienia, nie przerywa ETL. */
export class CeidgOdmowa extends Error {}
/** Własny budżet zapytań wyczerpany – to nie awaria, tylko granica; reszta par zostaje częściowa. */
export class BudzetWyczerpany extends CeidgOdmowa {}
/** Zapas na ponowienia przy 5xx: tyle zapytań z budżetu nie wchodzi do planu stron. */
export const REZERWA_PONOWIEN = 5
/** Równoległe zapytania przy pobieraniu planu stron: API bywa wolne (kilkadziesiąt sekund na stronę). */
export const WSPOLBIEZNOSC = 3

// --- Token -------------------------------------------------------------------------------------

/** Wartość klucza z pliku .env (bez ładowania całego pliku do środowiska i bez wypisywania). */
export function kluczZPliku(sciezka, klucz) {
  if (!existsSync(sciezka)) return null
  for (const linia of readFileSync(sciezka, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linia)
    if (m?.[1] === klucz) return m[2].replace(/^(['"])(.*)\1$/, '$2') || null
  }
  return null
}

/** Katalog główny checkoutu, z którego utworzono worktree (tam leży .env.local, w worktree go nie ma). */
function glownyCheckout() {
  try {
    const wspolny = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: KORZEN,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim()
    return dirname(wspolny)
  } catch {
    return null
  }
}

/** Token z env, potem .env.local tego katalogu, potem .env.local głównego checkoutu. Brak = null. */
export function wczytajToken(env = process.env) {
  if (env.CEIDG_TOKEN) return env.CEIDG_TOKEN
  for (const katalog of [KORZEN, glownyCheckout()]) {
    if (!katalog) continue
    const token = kluczZPliku(join(katalog, '.env.local'), 'CEIDG_TOKEN')
    if (token) return token
  }
  return null
}

// --- Dane: minimalizacja ---------------------------------------------------------------------

/**
 * Z firmy z API zostaje tylko adres działalności, status i rok rozpoczęcia. Wszystko, co
 * identyfikuje osobę albo firmę (nazwa, wlasciciel, nip, regon, id, link), jest tu odcinane.
 */
export function zredukujFirme(firma) {
  const a = firma?.adresDzialalnosci ?? {}
  return {
    ulica: a.ulica ?? '',
    budynek: a.budynek ?? '',
    miasto: a.miasto ?? '',
    kod: a.kod ?? '',
    gmina: a.gmina ?? '',
    terc: a.terc ?? '',
    status: firma?.status ?? '',
    od: String(firma?.dataRozpoczecia ?? '').slice(0, 4),
  }
}

// --- Cache ---------------------------------------------------------------------------------------

const KATALOG_CACHE = join(CACHE, 'ceidg')
const plikStrony = (kluczPary, strona) =>
  join(KATALOG_CACHE, `${kluczPary.replace(/[^a-z0-9_.-]/gi, '_')}_s${strona}.json`)

/** Data (RRRR-MM-DD) zapisania strony w cache, czyli dzień pobrania z API. */
const dataStrony = (kluczPary, strona) =>
  statSync(plikStrony(kluczPary, strona)).mtime.toISOString().slice(0, 10)

function odczytajStrone(kluczPary, strona) {
  const p = plikStrony(kluczPary, strona)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function zapiszStrone(kluczPary, strona, dane) {
  mkdirSync(KATALOG_CACHE, { recursive: true })
  const p = plikStrony(kluczPary, strona)
  writeFileSync(`${p}.tmp`, JSON.stringify(dane))
  renameSync(`${p}.tmp`, p)
}

// --- Budżet i zapytania ----------------------------------------------------------------------

export class Budzet {
  /**
   * `limit`: ile zapytań wolno jeszcze wysłać w tym biegu. `plik` (opcjonalny): licznik łączny,
   * który przeżywa kolejne biegi (`bazowe` = zużycie sprzed tego biegu).
   */
  constructor(limit, { plik = null, bazowe = 0 } = {}) {
    this.limit = limit
    this.uzyte = 0
    this.plik = plik
    this.bazowe = bazowe
    this.pozostaloWOknie = null
  }
  /** Odnotowuje wysłane zapytanie (także nieudane – API liczy je tak samo). */
  zuzyj() {
    this.uzyte++
    if (this.plik) {
      mkdirSync(dirname(this.plik), { recursive: true })
      writeFileSync(this.plik, JSON.stringify({ lacznie: this.bazowe + this.uzyte }))
    }
  }
  get zostalo() {
    return Math.max(0, this.limit - this.uzyte)
  }
  /** Czy wolno wysłać kolejne zapytanie (własny limit i rezerwa okna godzinnego). */
  mozna() {
    if (this.zostalo <= 0) return false
    return this.pozostaloWOknie === null || this.pozostaloWOknie > REZERWA_LIMITU
  }
}

/** Budżet na cały cykl życia cache: limit łączny pomniejszony o zapytania z poprzednich biegów. */
export function budzetZCache(limitLaczny) {
  const plik = join(KATALOG_CACHE, 'zuzycie.json')
  let bazowe = 0
  try {
    bazowe = Number(JSON.parse(readFileSync(plik, 'utf8')).lacznie) || 0
  } catch {}
  return new Budzet(Math.max(0, limitLaczny - bazowe), { plik, bazowe })
}

const czekaj = (ms) => new Promise((ok) => setTimeout(ok, ms))

/** Jedno zapytanie HTTP (liczy się do budżetu). 204 = brak wyników. */
async function zapytaj(url, token, budzet, proby = 3) {
  for (let i = 0; i < proby; i++) {
    if (!budzet.mozna())
      throw new BudzetWyczerpany(
        budzet.zostalo <= 0 ? 'budżet zapytań wyczerpany' : 'rezerwa limitu godzinnego CEIDG',
      )
    budzet.zuzyj()
    let r
    try {
      r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(120_000),
      })
    } catch (e) {
      if (i === proby - 1) throw e
      await czekaj(1000 * (i + 1))
      continue
    }
    const zostalo = Number(r.headers.get('x-rate-limit-remaining'))
    if (Number.isFinite(zostalo)) budzet.pozostaloWOknie = zostalo
    if (r.status === 204) return { firmy: [], count: 0 }
    if (r.ok) return r.json()
    if (r.status === 401 || r.status === 403)
      throw new CeidgOdmowa(`CEIDG odmówił dostępu (${r.status})`)
    if (r.status === 429) throw new CeidgOdmowa('CEIDG: limit zapytań (429)')
    if (r.status >= 500 && i < proby - 1) {
      await czekaj(2000 * (i + 1))
      continue
    }
    throw new Error(`CEIDG ${r.status}: ${(await r.text()).slice(0, 200)}`)
  }
  return null
}

/**
 * Strona wyników dla pary (PKD × obszar). Z cache bez zapytania; inaczej jedno zapytanie.
 * Zwraca { count, firmy (zredukowane), zCache }.
 */
export async function pobierzStrone({ para, strona, token, budzet }) {
  const z = odczytajStrone(para.klucz, strona)
  if (z)
    return { count: z.count, firmy: z.firmy, zCache: true, pobrano: dataStrony(para.klucz, strona) }
  const parametry = new URLSearchParams({
    pkd: para.pkdParametr,
    status: 'AKTYWNY',
    ...para.filtr,
    limit: String(ROZMIAR_STRONY),
    page: String(strona),
  })
  const j = await zapytaj(`${CEIDG_URL}?${parametry}`, token, budzet)
  const firmy = (j?.firmy ?? []).map(zredukujFirme)
  const dane = { count: Number(j?.count ?? firmy.length), firmy }
  zapiszStrone(para.klucz, strona, dane)
  return { ...dane, zCache: false, pobrano: dataStrony(para.klucz, strona) }
}

// --- Pary zapytań ------------------------------------------------------------------------------

/**
 * Pary branża × PKD × obszar z katalogu. `polityka(branza, pkd, obszar)` zwraca { priorytet, limitStron }:
 * priorytet – mniejsza liczba = wcześniej (patrz planujStrony), limitStron – górna granica liczby stron
 * pary. API sortuje wpisy malejąco po dacie rozpoczęcia, więc limit stron oznacza „najnowsze wpisy".
 */
export function paryCeidg(polityka = () => ({})) {
  const pary = []
  for (const b of BRANZE)
    for (const pkd of b.pkd ?? [])
      for (const o of OBSZARY_CEIDG) {
        const { priorytet = 1, limitStron = null } = polityka(b, pkd, o)
        pary.push({
          klucz: `${pkdDoParametru(pkd)}_${o.id}`,
          branza: b.id,
          obszar: o.id,
          pkd,
          pkdParametr: pkdDoParametru(pkd),
          filtr: o.filtr,
          priorytet,
          limitStron,
        })
      }
  return pary
}

// --- Planowanie ------------------------------------------------------------------------------

/**
 * Polityka pobierania dla ETL (budżet ok. 300 zapytań łącznie, patrz plik opisu). Gminy obwarzanka
 * mają po kilka–kilkadziesiąt wpisów na PKD, więc idą w całości jako pierwsze. W Krakowie pary, które
 * mieszczą się w budżecie (fryzjerzy 96.21.Z, piekarnie), pobieramy w całości; starszy kod fryzjerów
 * ma limit 300 najnowszych wpisów, a resztę budżetu dzielimy po równo między sklepy spożywcze
 * i kawiarnie (tysiące wpisów, od najnowszych). Tam sieci pokrywają OSM i Overture najlepiej, więc
 * CEIDG wnosi najmniej. Liczby wpisów: pomiar z 2026-10-03.
 */
export function politykaCeidg(_branza, pkd, obszar) {
  if (obszar.id !== 'krakow') return { priorytet: 1 }
  const krakow = {
    '96.21.Z': { priorytet: 2, limitStron: 34 }, // 842 wpisów: komplet
    '10.71.Z': { priorytet: 2, limitStron: 17 }, // 404 wpisy: komplet
    '96.02.Z': { priorytet: 3, limitStron: 12 }, // 1740 wpisów, starszy kod: 300 najnowszych
    '56.30.Z': { priorytet: 4, limitStron: 45 }, // 2304 wpisy
    '47.11.Z': { priorytet: 4, limitStron: 45 }, // 2560 wpisów
  }
  return krakow[pkd] ?? { priorytet: 4, limitStron: 45 }
}

/** Liczba stron pary do pobrania: wszystkie wg count, ale nie więcej niż limitStron. */
const stronPary = (p) =>
  Math.min(Math.ceil(p.count / ROZMIAR_STRONY), p.limitStron ?? Number.POSITIVE_INFINITY)

/**
 * Które kolejne strony pobrać (strona 0 jest już pobrana: to ona dała count). Grupy priorytetów
 * idą po kolei (mniejsza liczba pierwsza); wewnątrz grupy strony rozdzielamy „rundami" – po jednej
 * kolejnej stronie dla każdej pary – więc przy braku budżetu pary w grupie są niepełne po równo.
 * Strony z cache nic nie kosztują i zawsze wchodzą do planu. Zwraca listę { para, strona }.
 */
export function planujStrony(pary, budzet, wCache = () => false) {
  const grupy = [...new Set(pary.map((p) => p.priorytet))].sort((x, y) => x - y)
  const plan = []
  let zostalo = budzet
  for (const g of grupy) {
    const wGrupie = pary
      .filter((p) => p.priorytet === g)
      .sort((x, y) => x.klucz.localeCompare(y.klucz))
    const maks = Math.max(0, ...wGrupie.map(stronPary))
    const wyczerpane = new Set()
    for (let s = 1; s < maks; s++) {
      for (const p of wGrupie) {
        if (s >= stronPary(p) || wyczerpane.has(p.klucz)) continue
        if (!wCache(p, s)) {
          if (zostalo <= 0) {
            wyczerpane.add(p.klucz)
            continue
          }
          zostalo--
        }
        plan.push({ para: p, strona: s })
      }
    }
  }
  return plan
}

/** Najstarszy i najnowszy rok rozpoczęcia wśród pobranych firm (pary niepełne = najnowsze wpisy). */
function zakresLat(firmy) {
  const lata = firmy.map((f) => Number(f.od)).filter(Number.isFinite)
  return lata.length ? { odRoku: Math.min(...lata), doRoku: Math.max(...lata) } : {}
}

/**
 * Pobiera pary PKD × obszar: najpierw strona 0 każdej pary (poznajemy count), potem kolejne strony
 * wg planujStrony w granicach budżetu. Zwraca { rekordy, raport }; przy odmowie API albo wyczerpaniu
 * budżetu rekordy są tym, co zdążyliśmy pobrać, a raport mówi dlaczego reszty brak.
 * `pary`: { klucz, branza, obszar, pkd, pkdParametr, filtr, priorytet }.
 */
export async function pobierzCeidg({ pary, token, budzet, log = console.log }) {
  const stan = pary.map((p) => ({ ...p, count: null, pobrane: 0, firmy: [] }))
  const raport = {
    odmowa: null,
    blad: null,
    budzetWyczerpany: false,
    zapytan: 0,
    zCache: 0,
    pobranoOd: null,
    pobranoDo: null,
    pary: [],
  }
  const dodaj = (p, w, strona) => {
    p.firmy.push(...w.firmy)
    p.pobrane = Math.max(p.pobrane, strona + 1)
    if (w.zCache) raport.zCache++
    if (!raport.pobranoOd || w.pobrano < raport.pobranoOd) raport.pobranoOd = w.pobrano
    if (!raport.pobranoDo || w.pobrano > raport.pobranoDo) raport.pobranoDo = w.pobrano
  }
  try {
    for (const p of stan) {
      const w = await pobierzStrone({ para: p, strona: 0, token, budzet })
      p.count = w.count
      dodaj(p, w, 0)
    }
    log(`CEIDG: poznano liczebność ${stan.length} par, w tym biegu użyto ${budzet.uzyte} zapytań`)
    const plan = planujStrony(stan, Math.max(0, budzet.zostalo - REZERWA_PONOWIEN), (p, s) =>
      existsSync(plikStrony(p.klucz, s)),
    )
    // Kilku pracowników bierze strony z jednej kolejki; pierwszy błąd zatrzymuje pozostałych.
    let nastepna = 0
    let przerwano = null
    const pracownik = async () => {
      while (nastepna < plan.length && !przerwano) {
        const { para, strona } = plan[nastepna++]
        const p = stan.find((x) => x.klucz === para.klucz)
        try {
          dodaj(p, await pobierzStrone({ para: p, strona, token, budzet }), strona)
        } catch (e) {
          przerwano ??= e
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(WSPOLBIEZNOSC, plan.length) }, pracownik))
    if (przerwano) throw przerwano
  } catch (e) {
    // Awaria CEIDG nie może zablokować reszty warstwy: zostaje to, co zdążyliśmy pobrać.
    if (e instanceof BudzetWyczerpany) raport.budzetWyczerpany = true
    else if (e instanceof CeidgOdmowa) raport.odmowa = e.message
    else raport.blad = String(e?.message ?? e)
    log(`CEIDG: ${e.message} – kończymy pobieranie, reszta par zostaje częściowa`)
  }
  raport.zapytan = budzet.uzyte
  raport.lacznieZUzytych = budzet.bazowe + budzet.uzyte
  raport.pozostaloWOknie = budzet.pozostaloWOknie
  raport.pary = stan.map((p) => ({
    branza: p.branza,
    obszar: p.obszar,
    pkd: p.pkd,
    count: p.count,
    pobranoFirm: p.firmy.length,
    kompletne: p.count !== null && p.firmy.length >= p.count,
    limitStron: p.limitStron,
    ...zakresLat(p.firmy),
  }))
  return {
    rekordy: stan.flatMap((p) =>
      p.firmy.map((f) => ({ ...f, branza: p.branza, obszar: p.obszar })),
    ),
    raport,
  }
}

/**
 * Rekordy CEIDG (zredukowane, z branżą) i współrzędne z geokodowania (w tej samej kolejności,
 * null = nie znaleziono) → punkty wejściowe do deduplikacji. Punkt nie ma nazwy ani żadnego pola
 * z rekordu poza branżą: CEIDG to adres działalności, nie nazwa lokalu.
 */
export function punktyZRekordow(rekordy, wspolrzedne, bbox) {
  const punkty = []
  rekordy.forEach((r, i) => {
    const w = wspolrzedne[i]
    if (!w) return
    if (w.lat < bbox.minLat || w.lat > bbox.maxLat || w.lon < bbox.minLon || w.lon > bbox.maxLon)
      return
    punkty.push({
      zrodlo: 'ceidg',
      branza: r.branza,
      nazwa: null,
      lat: w.lat,
      lon: w.lon,
      flagi: [],
    })
  })
  return punkty
}
