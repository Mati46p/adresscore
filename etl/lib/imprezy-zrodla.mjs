// Źródła dat dla warstwy „dni z wydarzeniem w dużych obiektach” (#71). Dwie części:
//   1. czyste parsery (testowalne bez sieci): kalendarze TAURON Areny, EXPO i ICE, terminarze
//      meczów, obrysy z OpenStreetMap,
//   2. pobieranie z sieci (tylko przy `node etl/imprezy-obiekty.mjs --pobierz`).
// Z kalendarzy bierzemy wyłącznie DATY (fakty): tytułów i opisów nie przechowujemy.
// Metoda, ograniczenia i kontrola: etl/imprezy-obiekty.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE } from './wspolne.mjs'

// Początek „Mozilla/5.0 (compatible; …)” to zwyczajowa forma botów (jak Googlebot), a 1liga.org
// odpowiada 403 na każdy User-Agent bez niego. Bot dalej się przedstawia nazwą i adresem projektu.
export const UA =
  'Mozilla/5.0 (compatible; adresscore-etl/1.0; +https://github.com/Mati46p/adresscore)'
/** Wpis kalendarza dłuższy niż tyle dni to nie „dzień z imprezą”, tylko wystawa lub błąd danych. */
export const MAKS_DNI_WPISU = 7

// ── Daty (kalendarz bez stref czasowych: dzień to napis RRRR-MM-DD) ──────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** RRRR-MM-DD albo null, gdy takiego dnia nie ma w kalendarzu (np. 31 lutego). */
export function dzienISO(rok, mies, dzien) {
  const d = new Date(Date.UTC(rok, mies - 1, dzien))
  const dobry =
    d.getUTCFullYear() === rok && d.getUTCMonth() === mies - 1 && d.getUTCDate() === dzien
  return dobry ? d.toISOString().slice(0, 10) : null
}

export function dodajDni(iso, n) {
  const [r, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(r, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Kolejne dni od `od` do `doo` włącznie. Odwrócony lub zbyt długi zakres to błąd danych. */
export function zakresDni(od, doo, maks = MAKS_DNI_WPISU) {
  if (!ISO.test(od) || !ISO.test(doo)) throw new Error(`Zła data: ${od} – ${doo}`)
  if (doo < od) throw new Error(`Zakres od końca: ${od} – ${doo}`)
  const dni = []
  for (let d = od; d <= doo; d = dodajDni(d, 1)) {
    dni.push(d)
    if (dni.length > maks) throw new Error(`Wpis dłuższy niż ${maks} dni: ${od} – ${doo}`)
  }
  return dni
}

export const wOknie = (dzien, okno) => dzien >= okno.od && dzien <= okno.do

const FORMAT_WARSZAWA = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Dzień kalendarzowy w Warszawie dla znacznika czasu w UTC (np. „2025-06-30T22:30:00Z”). */
export const dzienWarszawski = (znacznik) => FORMAT_WARSZAWA.format(new Date(znacznik))

// ── Teksty ───────────────────────────────────────────────────────────────────────────────

const ENCJE = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }

export function tekstZHtml(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (calosc, nazwa) => ENCJE[nazwa.toLowerCase()] ?? calosc)
    .replace(/\s+/g, ' ')
    .trim()
}

// „odwołany/odwołane/odwołana/odwołano…”, ale nie „odwołania” (w razie odwołania, do odwołania).
const ODWOLANE = /odwo[łl]an(?:y|a|e|ym|ych|ego|ej|o)(?![\p{L}])|cancell?ed/iu

/**
 * Wpis oznaczony jako odwołany: w tytule albo na początku opisu (tam obiekty wstawiają
 * komunikat). Dalszy tekst pomijamy, bo „w razie odwołania koncertu…” nie znaczy odwołania.
 */
export function czyOdwolane(tytul, opis = '') {
  return ODWOLANE.test(tytul) || ODWOLANE.test(opis.slice(0, 200))
}

// ── TAURON Arena Kraków: REST API wtyczki The Events Calendar ────────────────────────────

/**
 * @param {Array<{title: string, description?: string, start_date: string, end_date?: string}>} wydarzenia
 *   wpisy z /wp-json/tribe/events/v1/events (daty w czasie lokalnym obiektu)
 * @param {{od: string, do: string}} okno
 */
export function dniTauron(wydarzenia, okno) {
  const dni = new Set()
  const odrzucone = []
  let wpisow = 0
  for (const w of wydarzenia) {
    const od = w.start_date.slice(0, 10)
    const doo = (w.end_date ?? w.start_date).slice(0, 10)
    const wZakresie = zakresDni(od, doo < od ? od : doo).filter((d) => wOknie(d, okno))
    if (!wZakresie.length) continue
    const tytul = tekstZHtml(w.title)
    if (czyOdwolane(tytul, tekstZHtml(w.description))) {
      odrzucone.push({ data: od, tytul, powod: 'wpis oznaczony jako odwołany' })
      continue
    }
    wpisow++
    for (const d of wZakresie) dni.add(d)
  }
  return { dni: [...dni].sort(), wpisow, odrzucone }
}

// ── EXPO Kraków: endpoint AJAX modułu kalendarza ─────────────────────────────────────────

/**
 * Data wyświetlana na stronie („15-16.02”, „03.10”, „30.06-01.07”) + rok jako zakres dni.
 * Służy do kontroli dat policzonych ze znaczników czasu; null, gdy format jest inny.
 */
export function zakresZDatyEXPO(dataIMiesiac, rok) {
  const t = String(dataIMiesiac).trim()
  const r = Number(rok)
  let m = /^(\d{1,2})\.(\d{2})$/.exec(t)
  if (m) {
    const d = dzienISO(r, Number(m[2]), Number(m[1]))
    return d ? { od: d, do: d } : null
  }
  m = /^(\d{1,2})-(\d{1,2})\.(\d{2})$/.exec(t)
  if (m) {
    const od = dzienISO(r, Number(m[3]), Number(m[1]))
    const doo = dzienISO(r, Number(m[3]), Number(m[2]))
    return od && doo ? { od, do: doo } : null
  }
  m = /^(\d{1,2})\.(\d{2})-(\d{1,2})\.(\d{2})$/.exec(t)
  if (m) {
    const od = dzienISO(r, Number(m[2]), Number(m[1]))
    const rokKonca = Number(m[4]) < Number(m[2]) ? r + 1 : r
    const doo = dzienISO(rokKonca, Number(m[4]), Number(m[3]))
    return od && doo ? { od, do: doo } : null
  }
  return null
}

/**
 * @param {Array<{title: string, start_date: string, end_date: string, place?: string,
 *   processed_date?: {day_and_month: string, year: string}}>} wydarzenia
 * @param {{od: string, do: string}} okno
 * @param {RegExp} miejsce wpisy z innym miejscem (organizator bywa gościem w innych obiektach) odpadają
 */
export function dniExpo(wydarzenia, okno, miejsce = /expo/i) {
  const dni = new Set()
  const odrzucone = []
  let wpisow = 0
  for (const w of wydarzenia) {
    const od = dzienWarszawski(w.start_date)
    const doo = dzienWarszawski(w.end_date)
    const wZakresie = zakresDni(od, doo < od ? od : doo).filter((d) => wOknie(d, okno))
    if (!wZakresie.length) continue
    const tytul = tekstZHtml(w.title)
    const wyswietlana = w.processed_date
      ? zakresZDatyEXPO(w.processed_date.day_and_month, w.processed_date.year)
      : null
    if (wyswietlana && (wyswietlana.od !== od || wyswietlana.do !== doo))
      throw new Error(
        `EXPO „${tytul}”: znaczniki czasu dają ${od} – ${doo}, strona pokazuje ${w.processed_date.day_and_month} ${w.processed_date.year}`,
      )
    if (!miejsce.test(w.place ?? '')) {
      odrzucone.push({ data: od, tytul, powod: `inne miejsce: ${w.place ?? 'brak'}` })
      continue
    }
    if (czyOdwolane(tytul)) {
      odrzucone.push({ data: od, tytul, powod: 'wpis oznaczony jako odwołany' })
      continue
    }
    wpisow++
    for (const d of wZakresie) dni.add(d)
  }
  return { dni: [...dni].sort(), wpisow, odrzucone }
}

// ── ICE Kraków: archiwum wydarzeń (HTML partiami) ────────────────────────────────────────

const MIESIACE_PL = {
  stycznia: 1,
  styczeń: 1,
  lutego: 2,
  luty: 2,
  marca: 3,
  marzec: 3,
  kwietnia: 4,
  kwiecień: 4,
  maja: 5,
  maj: 5,
  czerwca: 6,
  czerwiec: 6,
  lipca: 7,
  lipiec: 7,
  sierpnia: 8,
  sierpień: 8,
  września: 9,
  wrzesień: 9,
  października: 10,
  październik: 10,
  listopada: 11,
  listopad: 11,
  grudnia: 12,
  grudzień: 12,
}

const miesiac = (nazwa) => MIESIACE_PL[nazwa.toLocaleLowerCase('pl')] ?? null

/**
 * Data wpisu ICE jako zakres dni albo null, gdy zapis jest niejednoznaczny. Spotykane formy:
 * „sobota, 26 lipca 2025 19:00”, „17 - 19 czerwca 2025 12:00”, „27 - 28 Marzec 2026 18:00”
 * (nazwa miesiąca bywa w mianowniku i z wielkiej litery). Zapisy typu „21.02.2026 - 29.05.2025”
 * (zakres od końca) i nieznane miesiące dają null – wpis trafia do odrzuconych, nie do liczby.
 */
export function parsujDateICE(tekst) {
  const t = tekstZHtml(tekst).replace(/^\p{L}+,\s*/u, '')
  const slowo = '(\\p{L}+)'
  const dopasuj = (wzor) => new RegExp(`^${wzor}(?=\\s|$)`, 'u').exec(t)
  const zakres = (od, doo) => (od && doo && doo >= od ? { od, do: doo } : null)
  // Kolejność ma znaczenie: dłuższe formy przed pojedynczym dniem, który byłby ich przedrostkiem.
  let m = dopasuj(`(\\d{1,2}) ${slowo} (\\d{4}) - (\\d{1,2}) ${slowo} (\\d{4})`)
  if (m)
    return zakres(
      dzienISO(Number(m[3]), miesiac(m[2]) ?? 0, Number(m[1])),
      dzienISO(Number(m[6]), miesiac(m[5]) ?? 0, Number(m[4])),
    )
  m = dopasuj(`(\\d{1,2}) ${slowo} - (\\d{1,2}) ${slowo} (\\d{4})`)
  if (m)
    return zakres(
      dzienISO(Number(m[5]), miesiac(m[2]) ?? 0, Number(m[1])),
      dzienISO(Number(m[5]), miesiac(m[4]) ?? 0, Number(m[3])),
    )
  m = dopasuj(`(\\d{1,2}) - (\\d{1,2}) ${slowo} (\\d{4})`)
  if (m)
    return zakres(
      dzienISO(Number(m[4]), miesiac(m[3]) ?? 0, Number(m[1])),
      dzienISO(Number(m[4]), miesiac(m[3]) ?? 0, Number(m[2])),
    )
  m = dopasuj(`(\\d{1,2}) ${slowo} (\\d{4})`)
  if (m) {
    const d = dzienISO(Number(m[3]), miesiac(m[2]) ?? 0, Number(m[1]))
    return d ? { od: d, do: d } : null
  }
  return null
}

/** Wpisy z fragmentu HTML zwróconego przez archiwum ICE (data, kategoria, tytuł, miejsce, opis). */
export function wpisyICE(szablon) {
  const pole = (blok, wzor) => {
    const m = wzor.exec(blok)
    return m?.[1] === undefined ? '' : tekstZHtml(m[1])
  }
  // Blok wydarzenia to <div class="event modal-entity"> albo <div class="event featured …">;
  // kontener <div class="events-list …"> na pełnej stronie nie może się pod to łapać.
  return szablon
    .split(/<div class="event(?=[ "])/)
    .slice(1)
    .map((blok) => ({
      data: pole(blok, /<span class="date">([^<]*)/),
      kategoria: pole(blok, /<span class="cat">([^<]*)/),
      tytul: pole(blok, /<h4>([^<]*)/),
      miejsce: pole(blok, /<a[^>]*class="upperline"[^>]*>([^<]*)/),
      opis: pole(blok, /<div class="paragraph-text">([\s\S]*?)<\/div>/),
    }))
    .filter((w) => w.data)
}

export function dniICE(wpisy, okno) {
  const dni = new Set()
  const odrzucone = []
  let wpisow = 0
  for (const w of wpisy) {
    const zakres = parsujDateICE(w.data)
    if (!zakres) {
      // Bez daty nie wiadomo, czy wpis leży w oknie – odnotowujemy, żeby ktoś mógł to sprawdzić.
      odrzucone.push({ data: w.data, tytul: w.tytul, powod: 'niejednoznaczna data w kalendarzu' })
      continue
    }
    const wZakresie = zakresDni(zakres.od, zakres.do).filter((d) => wOknie(d, okno))
    if (!wZakresie.length) continue
    if (czyOdwolane(w.tytul, w.opis)) {
      odrzucone.push({ data: zakres.od, tytul: w.tytul, powod: 'wpis oznaczony jako odwołany' })
      continue
    }
    wpisow++
    for (const d of wZakresie) dni.add(d)
  }
  return { dni: [...dni].sort(), wpisow, odrzucone }
}

// ── Mecze domowe ─────────────────────────────────────────────────────────────────────────

/**
 * Dni meczów domowych drużyny z pliku CSV football-data.co.uk (kolumny Season, Date, Home).
 * Plik zawiera wyłącznie rozegrane mecze ligowe, z datą rzeczywistą (po przełożeniach).
 */
export function meczeDomoweCSV(csv, { druzyna, sezon }) {
  const [naglowek, ...wiersze] = csv.replace(/^﻿/, '').trim().split(/\r?\n/)
  const kolumny = (naglowek ?? '').split(',')
  const ix = Object.fromEntries(kolumny.map((k, i) => [k, i]))
  for (const k of ['Season', 'Date', 'Home'])
    if (ix[k] === undefined) throw new Error(`CSV: brak kolumny ${k}`)
  const dni = []
  for (const wiersz of wiersze) {
    const c = wiersz.split(',')
    if (c[ix.Season] !== sezon || c[ix.Home] !== druzyna) continue
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(c[ix.Date] ?? '')
    const d = m ? dzienISO(Number(m[3]), Number(m[2]), Number(m[1])) : null
    if (!d) throw new Error(`CSV: zła data „${c[ix.Date]}”`)
    dni.push(d)
  }
  return dni.sort()
}

/**
 * Dni meczów domowych drużyny ze strony klubu na 1liga.org (oficjalna strona rozgrywek):
 * liczą się tylko mecze o stanie „Finished”, z datą rzeczywistą z terminarza.
 */
export function meczeDomoweLiga(html, druzyna) {
  const dni = []
  for (const blok of html.split('class="single-match-wrapper"').slice(1)) {
    const pole = (wzor) => {
      const m = wzor.exec(blok)
      return m?.[1] === undefined ? '' : tekstZHtml(m[1])
    }
    const stan = pole(/class="match-state">([^<]*)</)
    const gospodarz = pole(/class="team-name home-team-name[^"]*">([^<]*)</)
    const data = pole(/class="round-date-info">([^<]*)</)
    if (!gospodarz) throw new Error('1liga.org: zmieniła się budowa strony meczu')
    if (gospodarz !== druzyna || stan !== 'Finished' || !data) continue
    const m = /(\d{2})\.(\d{2})\.(\d{4})$/.exec(data)
    const d = m ? dzienISO(Number(m[3]), Number(m[2]), Number(m[1])) : null
    if (!d) throw new Error(`1liga.org: zła data „${data}”`)
    dni.push(d)
  }
  return dni.sort()
}

// ── Obrysy z OpenStreetMap (Overpass, `out geom`) ────────────────────────────────────────

/** Pierścień [[lon, lat], …] z elementu Overpass: zamknięta linia albo relacja z jednym obrysem. */
export function obrysZElementu(el) {
  const punkty = (geometria) => geometria.map((p) => [p.lon, p.lat])
  const zamkniety = (p) => p.length >= 4 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1]
  if (el.type === 'way') {
    const p = punkty(el.geometry ?? [])
    if (!zamkniety(p)) throw new Error(`OSM way/${el.id}: obrys nie jest zamknięty`)
    return p
  }
  if (el.type === 'relation') {
    const zewnetrzne = (el.members ?? []).filter((m) => m.role === 'outer' && m.geometry)
    if (zewnetrzne.length !== 1)
      throw new Error(
        `OSM relation/${el.id}: ${zewnetrzne.length} obrysów zewnętrznych, oczekiwano 1`,
      )
    const p = punkty(zewnetrzne[0].geometry)
    if (!zamkniety(p)) throw new Error(`OSM relation/${el.id}: obrys nie jest zamknięty`)
    return p
  }
  throw new Error(`OSM: nieobsługiwany typ ${el.type}`)
}

// ── Zapis obrysu i dni w migawce (tekst, żeby JSON był czytelny i stabilny dla Biome) ─────

/** [[lon, lat], …] → „POLYGON((lon lat, …))” (WKT, 6 miejsc po przecinku ≈ 0,1 m). */
export function obrysDoWkt(pierscien) {
  const p = pierscien.map(([lon, lat]) => `${lon.toFixed(6)} ${lat.toFixed(6)}`)
  return `POLYGON((${p.join(', ')}))`
}

export function obrysZWkt(wkt) {
  const m = /^POLYGON\(\((.+)\)\)$/.exec(wkt)
  if (!m?.[1]) throw new Error('Obrys: oczekiwano POLYGON((…))')
  return m[1].split(',').map((p) => {
    const [lon, lat] = p.trim().split(/\s+/).map(Number)
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(`Obrys: zły punkt „${p}”`)
    return [lon, lat]
  })
}

/** Dni → { „2025-07”: „03 04 10”, … } (dni miesiąca po spacji). */
export function dniDoMiesiecy(dni) {
  const wynik = {}
  for (const d of [...dni].sort()) {
    const klucz = d.slice(0, 7)
    wynik[klucz] = wynik[klucz] ? `${wynik[klucz]} ${d.slice(8)}` : d.slice(8)
  }
  return wynik
}

export function dniZMiesiecy(miesiace) {
  const dni = []
  for (const [klucz, dniMiesiaca] of Object.entries(miesiace)) {
    if (!/^\d{4}-\d{2}$/.test(klucz)) throw new Error(`Dni: zły miesiąc „${klucz}”`)
    for (const dz of dniMiesiaca.split(' ')) {
      const d = `${klucz}-${dz}`
      if (!ISO.test(d) || dzienISO(...d.split('-').map(Number)) !== d)
        throw new Error(`Dni: zły dzień „${d}”`)
      dni.push(d)
    }
  }
  return dni.sort()
}

// ── Pobieranie z sieci (tylko --pobierz) ─────────────────────────────────────────────────

const pauza = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** Odstęp między zapytaniami do jednego serwisu: kilkadziesiąt zapytań, bez obciążania stron. */
const ODSTEP_MS = 400

async function zapytanie(url, opcje = {}, proby = 3) {
  let blad = new Error('brak prób')
  for (let proba = 1; proba <= proby; proba++) {
    try {
      const odp = await fetch(url, {
        ...opcje,
        headers: { 'user-agent': UA, ...opcje.headers },
        signal: AbortSignal.timeout(90_000),
      })
      if (!odp.ok) throw new Error(`${url} → HTTP ${odp.status}`)
      return odp
    } catch (e) {
      blad = e
      await pauza(1500 * proba)
    }
  }
  throw blad
}

/** Odpowiedź tekstowa z cache etl/.cache/imprezy-obiekty (drugi bieg nie pyta serwisu ponownie). */
async function zCache(plik, pobierz, odswiez) {
  const katalog = join(CACHE, 'imprezy-obiekty')
  const sciezka = join(katalog, plik)
  if (!odswiez && existsSync(sciezka)) {
    console.log(`  z cache: ${plik} (--swieze pobiera ponownie)`)
    return readFileSync(sciezka, 'utf8')
  }
  const tekst = await pobierz()
  mkdirSync(katalog, { recursive: true })
  writeFileSync(sciezka, tekst)
  return tekst
}

export async function pobierzTauron(okno, odswiez = false) {
  const marginesOd = dodajDni(okno.od, -7)
  const marginesDo = dodajDni(okno.do, 7)
  const tekst = await zCache(
    `tauron-${okno.od}-${okno.do}.json`,
    async () => {
      let url = `https://www.tauronarenakrakow.pl/wp-json/tribe/events/v1/events?per_page=50&status=publish&start_date=${marginesOd}&end_date=${marginesDo}`
      const wszystkie = []
      let razem = 0
      while (url) {
        const j = await (await zapytanie(url)).json()
        wszystkie.push(...j.events)
        razem = j.total
        url = j.next_rest_url ?? null
        await pauza(ODSTEP_MS)
      }
      if (wszystkie.length !== razem)
        throw new Error(`TAURON: pobrano ${wszystkie.length} wpisów z ${razem}`)
      return JSON.stringify(wszystkie)
    },
    odswiez,
  )
  return JSON.parse(tekst)
}

export async function pobierzExpo(okno, odswiez = false) {
  const lata = []
  for (let r = Number(okno.od.slice(0, 4)); r <= Number(okno.do.slice(0, 4)); r++) lata.push(r)
  const tekst = await zCache(
    `expo-${okno.od}-${okno.do}.json`,
    async () => {
      const wszystkie = []
      for (const rok of lata) {
        for (let strona = 1; ; strona++) {
          const url = `https://expokrakow.com/ajax/modules/calendar/index/2/pl?year=${rok}&showIncoming=false&page=${strona}`
          const j = await (await zapytanie(url)).json()
          wszystkie.push(...j.events)
          await pauza(ODSTEP_MS)
          if (!j.pager || strona >= j.pager.totalPages) break
        }
      }
      return JSON.stringify(wszystkie)
    },
    odswiez,
  )
  return JSON.parse(tekst)
}

export async function pobierzIce(okno, odswiez = false) {
  const tekst = await zCache(
    `ice-${okno.od}-${okno.do}.json`,
    async () => {
      // Wydarzenia wyróżnione ICE pokazuje w osobnym bloku na górze strony archiwum, a listy
      // partiami (AJAX) ich nie zawierają – bez tego wypadłby np. „Dzień Dobry ICE Kraków”
      // z 31.05.2026. Strona niesie też pierwszą partię; powtórzenia nie szkodzą (liczymy dni).
      const wpisy = wpisyICE(
        await (await zapytanie('https://icekrakow.pl/kalendarium/archiwum')).text(),
      )
      await pauza(ODSTEP_MS)
      const gorna = dodajDni(okno.do, 7)
      for (let start = 0; start < 100; start++) {
        const odp = await zapytanie('https://icekrakow.pl/events/pl/ajax', {
          method: 'POST',
          headers: {
            'x-requested-with': 'XMLHttpRequest',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            referer: 'https://icekrakow.pl/kalendarium/archiwum',
          },
          body: new URLSearchParams({ type: 'archived', date: gorna, start: String(start) }),
        })
        const j = JSON.parse(await odp.text())
        const partia = wpisyICE(j.template)
        wpisy.push(...partia)
        await pauza(ODSTEP_MS)
        // Archiwum idzie od najnowszych: kończymy, gdy cała partia jest przed oknem.
        const zakresy = partia.map((w) => parsujDateICE(w.data))
        const przedOknem =
          partia.length > 0 && zakresy.every((z) => z !== null && z.do < dodajDni(okno.od, -30))
        if (!j.exists || przedOknem) return JSON.stringify(wpisy)
      }
      throw new Error('ICE: archiwum dłuższe niż 100 partii – sprawdź stronicowanie')
    },
    odswiez,
  )
  return JSON.parse(tekst)
}

export async function pobierzCsvLigi(odswiez = false) {
  return zCache(
    'football-data-pol.csv',
    async () => (await zapytanie('https://www.football-data.co.uk/new/POL.csv')).text(),
    odswiez,
  )
}

export async function pobierzStroneKlubu1Ligi(adres, odswiez = false) {
  return zCache(
    `1liga-${adres.replace(/\W+/g, '-')}.html`,
    async () => (await zapytanie(adres)).text(),
    odswiez,
  )
}

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

/**
 * Obrysy obiektów z Overpass. `refs` = [{ typ: 'way' | 'relation', id }].
 * Zwraca { obrysy: { 'way/123': [[lon, lat], …] }, znacznik } (znacznik = stan bazy OSM).
 */
export async function pobierzObrysy(refs, odswiez = false) {
  const zapytanieOverpass = `[out:json][timeout:90];(${refs
    .map((r) => `${r.typ === 'way' ? 'way' : 'rel'}(${r.id});`)
    .join('')});out geom;`
  const tekst = await zCache(
    'obrysy-osm.json',
    async () => {
      let blad = new Error('brak instancji Overpass')
      for (const adres of OVERPASS) {
        try {
          const odp = await zapytanie(
            adres,
            {
              method: 'POST',
              headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
              body: new URLSearchParams({ data: zapytanieOverpass }),
            },
            2,
          )
          const tresc = await odp.text()
          JSON.parse(tresc) // 504 i komunikaty błędów przychodzą jako XML
          return tresc
        } catch (e) {
          blad = e
        }
      }
      throw blad
    },
    odswiez,
  )
  const j = JSON.parse(tekst)
  const obrysy = {}
  for (const el of j.elements) obrysy[`${el.type}/${el.id}`] = obrysZElementu(el)
  for (const r of refs)
    if (!obrysy[`${r.typ}/${r.id}`]) throw new Error(`OSM: brak obiektu ${r.typ}/${r.id}`)
  return { obrysy, znacznik: j.osm3s?.timestamp_osm_base ?? null }
}
