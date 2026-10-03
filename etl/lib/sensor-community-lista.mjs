// Lista czujników Sensor.Community wokół Krakowa (zadanie #144): żywe API + wybór czujników pyłu
// z partnerem wilgotności. Osobny plik od sensor-community.mjs, bo ta część rozmawia z żywym API
// (jedno pobranie, wynik w etl/.cache), a tamta liczy.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { constants, gunzipSync } from 'node:zlib'
import {
  ARCHIWUM,
  DANE_ZYWE,
  rownolegle,
  TYPY_PYLU,
  TYPY_WILGOTNOSCI,
  USER_AGENT,
} from './sensor-community.mjs'
import { CACHE } from './wspolne.mjs'

const KATALOG = join(CACHE, 'sensor-community')

/**
 * Rekordy żywego API (data.24h.json) → lokalizacje w prostokącie `granice` z listą czujników.
 * Rekord: { location: { id, latitude, longitude, indoor, exact_location }, sensor: { id, sensor_type: { name } } }.
 * Lokalizacja bez współrzędnych albo spoza prostokąta odpada; ten sam czujnik w wielu rekordach
 * liczy się raz.
 */
export function lokalizacjeZRekordow(rekordy, granice) {
  const mapa = new Map()
  for (const r of rekordy) {
    const l = r.location
    const lat = Number(l?.latitude)
    const lon = Number(l?.longitude)
    const typ = String(r.sensor?.sensor_type?.name ?? '').toUpperCase()
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !typ || r.sensor?.id === undefined)
      continue
    if (
      lat < granice.lat[0] ||
      lat > granice.lat[1] ||
      lon < granice.lon[0] ||
      lon > granice.lon[1]
    )
      continue
    const e = mapa.get(l.id) ?? {
      location: l.id,
      lat,
      lon,
      wewnatrz: Boolean(l.indoor),
      dokladna: Boolean(l.exact_location),
      sensory: [],
    }
    if (!e.sensory.some((s) => s.id === r.sensor.id)) e.sensory.push({ id: r.sensor.id, typ })
    mapa.set(l.id, e)
  }
  return [...mapa.values()]
}

/** Lokalizacje z czujnikiem pyłu zewnętrznym: pył i wilgotność osobno (wilgotność od najlepszego typu). */
export function kandydaci(lokalizacje) {
  const kolejnosc = (t) => TYPY_WILGOTNOSCI.indexOf(t)
  return lokalizacje
    .filter((l) => !l.wewnatrz)
    .map((l) => ({
      location: l.location,
      lat: l.lat,
      lon: l.lon,
      dokladna: l.dokladna,
      pyl: l.sensory.filter((s) => TYPY_PYLU.includes(s.typ)),
      wilgotnosc: l.sensory
        .filter((s) => TYPY_WILGOTNOSCI.includes(s.typ))
        .sort((a, b) => kolejnosc(a.typ) - kolejnosc(b.typ)),
    }))
    .filter((k) => k.pyl.length)
}

/** Granice prostokąta z adresów plus margines w stopniach. */
export function granicePrzyAdresach(adresy, margines = 0.03) {
  const granice = { lat: [Infinity, -Infinity], lon: [Infinity, -Infinity] }
  for (const a of adresy) {
    granice.lat = [Math.min(granice.lat[0], a.lat), Math.max(granice.lat[1], a.lat)]
    granice.lon = [Math.min(granice.lon[0], a.lon), Math.max(granice.lon[1], a.lon)]
  }
  return {
    lat: [granice.lat[0] - margines, granice.lat[1] + margines],
    lon: [granice.lon[0] - margines, granice.lon[1] + margines],
  }
}

/** Jedno pobranie żywego API (ok. 9 MB, 1 zapytanie) i zapis lokalizacji z prostokąta do cache. */
export async function pobierzZywe(granice) {
  const plik = join(KATALOG, 'zywe.json')
  if (existsSync(plik)) return JSON.parse(readFileSync(plik, 'utf8'))
  const r = await fetch(DANE_ZYWE, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(300_000),
  })
  if (!r.ok) throw new Error(`${DANE_ZYWE} → ${r.status}`)
  const rekordy = await r.json()
  if (!Array.isArray(rekordy) || rekordy.length < 5_000)
    throw new Error(`Podejrzanie mało rekordów żywego API: ${rekordy.length}`)
  const wynik = {
    pobrano: new Date().toISOString().slice(0, 10),
    rekordow: rekordy.length,
    lokalizacje: lokalizacjeZRekordow(rekordy, granice),
  }
  mkdirSync(KATALOG, { recursive: true })
  writeFileSync(plik, JSON.stringify(wynik))
  return wynik
}

const POLSKA = { lat: [48.9, 55.1], lon: [14, 24.5] }

/** Spis plików archiwum z doby: { typ (małe litery): [id czujnika, …] } – z indeksu katalogu, 1 żądanie. */
export async function spisDnia(dzien) {
  const plik = join(KATALOG, `spis_${dzien}.json`)
  if (existsSync(plik)) return JSON.parse(readFileSync(plik, 'utf8'))
  const url = `${ARCHIWUM}/${dzien.slice(0, 4)}/${dzien}/`
  let html = null
  for (let proba = 1; html === null; proba++) {
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(180_000),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      html = await r.text()
    } catch (e) {
      if (proba >= 4) throw new Error(`${url}: ${e.message}`)
      await new Promise((ok) => setTimeout(ok, 2000 * proba))
    }
  }
  const spis = {}
  for (const m of html.matchAll(/href="\d{4}-\d{2}-\d{2}_([a-z0-9_]+?)_sensor_(\d+)\.csv\.gz"/g))
    (spis[m[1]] ??= []).push(Number(m[2]))
  if ((spis.sds011?.length ?? 0) < 1_000)
    throw new Error(`${url}: podejrzanie mało czujników SDS011`)
  mkdirSync(KATALOG, { recursive: true })
  writeFileSync(plik, JSON.stringify(spis))
  return spis
}

/**
 * Pozycja czujnika z pierwszego wiersza pliku dobowego: żądanie Range o 2 KB (plik .gz rozpakowany
 * częściowo), więc spis ~11 tys. czujników kosztuje kilka MB. null = brak pliku albo wiersza.
 */
export async function pozycjaZPliku(typ, id, dzien, { proby = 4 } = {}) {
  const url = `${ARCHIWUM}/${dzien.slice(0, 4)}/${dzien}/${dzien}_${typ}_sensor_${id}.csv.gz`
  for (let p = 1; ; p++) {
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, range: 'bytes=0-2047' },
        signal: AbortSignal.timeout(60_000),
      })
      if (r.status === 404 || r.status === 416) return null
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const bajty = Buffer.from(await r.arrayBuffer())
      const tekst = gunzipSync(bajty, { finishFlush: constants.Z_SYNC_FLUSH }).toString('utf8')
      const c = tekst.split('\n')[1]?.split(';')
      if (!c || c.length < 6) return null
      const wynik = { location: Number(c[2]), lat: Number(c[3]), lon: Number(c[4]) }
      return Number.isFinite(wynik.lat) && Number.isFinite(wynik.lon) ? wynik : null
    } catch (e) {
      if (p >= proby) throw new Error(`${url}: ${e.cause?.code ?? e.message}`)
      await new Promise((ok) => setTimeout(ok, 500 * 2 ** (p - 1)))
    }
  }
}

/**
 * Pozycje wszystkich czujników pyłu z doby (spis → pierwszy wiersz każdego pliku), tylko w Polsce.
 * Dzięki temu lista obejmuje też czujniki, które działały w roku modelu, a dziś już nie nadają
 * (żywe API ich nie pokazuje). Wynik w cache; drugi bieg nie pyta serwera.
 */
export async function pozycjeDnia(dzien, { limit = 6 } = {}) {
  const plik = join(KATALOG, `pozycje_${dzien}.json`)
  if (existsSync(plik)) return JSON.parse(readFileSync(plik, 'utf8'))
  const spis = await spisDnia(dzien)
  const zadania = TYPY_PYLU.map((t) => t.toLowerCase()).flatMap((typ) =>
    (spis[typ] ?? []).map((id) => ({ typ, id })),
  )
  console.log(`  ${dzien}: skanuję pierwszy wiersz ${zadania.length} plików czujników pyłu`)
  let zrobione = 0
  const wyniki = await rownolegle(zadania, limit, async (z) => {
    const p = await pozycjaZPliku(z.typ, z.id, dzien)
    if (++zrobione % 2000 === 0) console.log(`  ${dzien}: ${zrobione}/${zadania.length}`)
    return p ? { ...z, ...p } : null
  })
  const wPolsce = wyniki.filter(
    (w) =>
      w &&
      w.lat >= POLSKA.lat[0] &&
      w.lat <= POLSKA.lat[1] &&
      w.lon >= POLSKA.lon[0] &&
      w.lon <= POLSKA.lon[1],
  )
  const wynik = {
    dzien,
    pobrano: new Date().toISOString().slice(0, 10),
    przeskanowano: zadania.length,
    wPolsce,
  }
  mkdirSync(KATALOG, { recursive: true })
  writeFileSync(plik, JSON.stringify(wynik))
  return wynik
}

/**
 * Partnerzy wilgotności czujnika pyłu: pliki czujników wilgotności o identyfikatorach w odległości
 * ≤ 3 (rejestruje się je parami) z doby spisu, uznane przy tej samej kolumnie `location`.
 * `dniSpisow`: [{ dzien, spis }] – sprawdzamy w każdej dobie osobno, bo czujnik mógł nie nadawać.
 */
export async function partnerzyZeSpisu(pyl, location, dniSpisow) {
  const wynik = new Map()
  for (const { dzien, spis } of dniSpisow)
    for (const typ of TYPY_WILGOTNOSCI.map((t) => t.toLowerCase()))
      for (const id of spis[typ] ?? []) {
        if (id === pyl.id || Math.abs(id - pyl.id) > 3 || wynik.has(`${typ}:${id}`)) continue
        const p = await pozycjaZPliku(typ, id, dzien)
        if (p && p.location === location) wynik.set(`${typ}:${id}`, { id, typ: typ.toUpperCase() })
      }
  return [...wynik.values()]
}

/** Partnerzy wilgotności dla kandydatów bez czujnika wilgotności w żywym API; cache w etl/.cache. */
export async function uzupelnijPartnerow(lista, dniSpisow, rok) {
  const plik = join(KATALOG, `partnerzy_${rok}.json`)
  const zapisani = existsSync(plik) ? JSON.parse(readFileSync(plik, 'utf8')) : {}
  for (const k of lista) {
    if (k.wilgotnosc.length) continue
    const klucz = String(k.pyl[0].id)
    if (!(klucz in zapisani)) {
      zapisani[klucz] = await partnerzyZeSpisu(k.pyl[0], k.location, dniSpisow)
      mkdirSync(KATALOG, { recursive: true })
      writeFileSync(plik, JSON.stringify(zapisani))
    }
    k.wilgotnosc = zapisani[klucz]
    k.partnerZeSpisu = k.wilgotnosc.length > 0
  }
  return lista
}

/**
 * Lokalizacje z żywego API i z archiwum (czujniki, które w roku modelu nadawały, a dziś nie) w jedną
 * listę po identyfikatorze lokalizacji. Współrzędne z żywego API mają pierwszeństwo.
 */
export function polaczLokalizacje(zywe, pozycjeDni, granice) {
  const mapa = new Map()
  for (const l of zywe) mapa.set(l.location, { ...l, sensory: [...l.sensory], zrodlo: ['zywe'] })
  for (const dzien of pozycjeDni)
    for (const p of dzien.wPolsce) {
      if (
        p.lat < granice.lat[0] ||
        p.lat > granice.lat[1] ||
        p.lon < granice.lon[0] ||
        p.lon > granice.lon[1]
      )
        continue
      const e = mapa.get(p.location) ?? {
        location: p.location,
        lat: p.lat,
        lon: p.lon,
        wewnatrz: false,
        dokladna: null,
        sensory: [],
        zrodlo: [],
      }
      if (!e.sensory.some((s) => s.id === p.id))
        e.sensory.push({ id: p.id, typ: p.typ.toUpperCase() })
      if (!e.zrodlo.includes('archiwum')) e.zrodlo.push('archiwum')
      mapa.set(p.location, e)
    }
  return [...mapa.values()]
}
