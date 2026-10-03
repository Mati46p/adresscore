// Źródło: © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright).
// Liczy węzły highway=street_lamp w odległości do 100 m od każdego adresu.
// Uruchom: node etl/bezpieczenstwo.mjs. Odpowiedź Overpass jest buforowana w etl/.cache/.

import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DuckDBInstance } from '@duckdb/node-api'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

// Publiczna instancja z globalnym pokryciem; główna overpass-api.de była niedostępna przy pobraniu.
const OVERPASS = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
const GEOFABRIK = 'https://download.geofabrik.de/europe/poland/malopolskie-latest.osm.pbf'
const PROMIEN = 100
const RAD = Math.PI / 180
const PROMIEN_ZIEMI = 6_371_000
const KROK = 0.001

function odleglosc(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * RAD
  const dLon = (bLon - aLon) * RAD
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * PROMIEN_ZIEMI * Math.asin(Math.min(1, Math.sqrt(s)))
}

function bboxAdresow(adresy) {
  let s = Infinity
  let w = Infinity
  let n = -Infinity
  let e = -Infinity
  for (const { lat, lon } of adresy) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Adres bez współrzędnych')
    s = Math.min(s, lat)
    w = Math.min(w, lon)
    n = Math.max(n, lat)
    e = Math.max(e, lon)
  }
  // 0,002° przekracza 100 m zarówno w szerokości, jak i długości geograficznej tutaj.
  return [s - 0.002, w - 0.002, n + 0.002, e + 0.002].map((v) => v.toFixed(6)).join(',')
}

async function pobierzLatarnie(bbox) {
  mkdirSync(CACHE, { recursive: true })
  const skrot = createHash('sha256').update(bbox).digest('hex').slice(0, 12)
  const sciezka = join(CACHE, `osm-latarnie-${skrot}.json`)
  if (existsSync(sciezka)) return JSON.parse(readFileSync(sciezka, 'utf8'))

  const zapytanie = `[out:json][timeout:180];node["highway"="street_lamp"](${bbox});out body;`
  let wynik
  try {
    const odpowiedz = await fetch(OVERPASS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'adresscore-etl/1.0 (https://github.com/Mati46p/adresscore)',
      },
      body: new URLSearchParams({ data: zapytanie }),
      signal: AbortSignal.timeout(210_000),
    })
    if (!odpowiedz.ok) throw new Error(`HTTP ${odpowiedz.status}`)
    const dane = await odpowiedz.json()
    if (!dane.osm3s?.timestamp_osm_base) throw new Error('brak daty danych')
    wynik = {
      elements: dane.elements,
      dataDanych: dane.osm3s.timestamp_osm_base.slice(0, 10),
      url: OVERPASS,
    }
    walidujOdpowiedz(wynik)
  } catch (blad) {
    console.warn(`Overpass niedostępny (${blad.message}); używam wyciągu OSM Geofabrik.`)
    wynik = await latarnieZGeofabrik(bbox)
  }
  walidujOdpowiedz(wynik)
  writeFileSync(sciezka, JSON.stringify(wynik))
  console.log(`OSM: pobrano ${wynik.elements.length} latarni do ${sciezka}`)
  return wynik
}

function walidujOdpowiedz(wynik) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wynik.dataDanych ?? '') || !Array.isArray(wynik.elements))
    throw new Error('OSM: niekompletna odpowiedź')
  if (wynik.elements.length < 1000) throw new Error('OSM: podejrzanie mało latarni')
  if (
    wynik.elements.some(
      (e) => e.type !== 'node' || !Number.isFinite(e.lat) || !Number.isFinite(e.lon),
    )
  )
    throw new Error('OSM: niepoprawne współrzędne latarni')
}

async function latarnieZGeofabrik(bbox) {
  const odp = await fetch(GEOFABRIK, { method: 'HEAD', signal: AbortSignal.timeout(30_000) })
  if (!odp.ok) throw new Error(`Geofabrik: HTTP ${odp.status}`)
  const oczekiwane = Number(odp.headers.get('content-length'))
  const stan = odp.url.match(/malopolskie-(\d{2})(\d{2})(\d{2})\.osm\.pbf/)
  if (!stan || !Number.isFinite(oczekiwane))
    throw new Error('Geofabrik: brak daty lub rozmiaru pliku')
  const dataDanych = `20${stan[1]}-${stan[2]}-${stan[3]}`
  const pbf = join(CACHE, `malopolskie-${stan[1]}${stan[2]}${stan[3]}.osm.pbf`)
  if (!existsSync(pbf) || statSync(pbf).size !== oczekiwane) {
    const plik = await fetch(GEOFABRIK, { signal: AbortSignal.timeout(1_800_000) })
    if (!plik.ok || !plik.body) throw new Error(`Geofabrik: HTTP ${plik.status}`)
    const tymczasowy = `${pbf}.tmp`
    await pipeline(Readable.fromWeb(plik.body), createWriteStream(tymczasowy))
    if (statSync(tymczasowy).size !== oczekiwane) throw new Error('Geofabrik: niepełny plik PBF')
    renameSync(tymczasowy, pbf)
  }
  const [s, w, n, e] = bbox.split(',').map(Number)
  const db = await DuckDBInstance.create(':memory:')
  const conn = await db.connect()
  await conn.run('LOAD spatial')
  const sql = `SELECT lat, lon FROM ST_ReadOSM('${pbf}') WHERE kind = 'node' AND map_extract_value(tags, 'highway') = 'street_lamp' AND lat BETWEEN ${s} AND ${n} AND lon BETWEEN ${w} AND ${e}`
  const rows = (await conn.runAndReadAll(sql)).getRows()
  conn.closeSync()
  return {
    elements: rows.map(([lat, lon]) => ({ type: 'node', lat, lon })),
    dataDanych,
    url: GEOFABRIK,
  }
}

function policz(adresy, latarnie) {
  const siatka = new Map()
  const klucz = (y, x) => `${y},${x}`
  for (const l of latarnie) {
    const key = klucz(Math.floor(l.lat / KROK), Math.floor(l.lon / KROK))
    if (!siatka.has(key)) siatka.set(key, [])
    siatka.get(key).push(l)
  }
  return adresy.map((a) => {
    const y = Math.floor(a.lat / KROK)
    const x = Math.floor(a.lon / KROK)
    let liczba = 0
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (const l of siatka.get(klucz(y + dy, x + dx)) ?? []) {
          if (odleglosc(a.lat, a.lon, l.lat, l.lon) <= PROMIEN) liczba++
        }
      }
    }
    return liczba
  })
}

const start = performance.now()
const { adresy } = wczytajAdresy()
const bbox = bboxAdresow(adresy)
const wynik = await pobierzLatarnie(bbox)
walidujOdpowiedz(wynik)
const wartosci = policz(adresy, wynik.elements)
zapiszWskaznik(
  {
    id: 'oswietlenie_100m',
    kategoria: 'bezpieczenstwo',
    nazwa: 'Latarnie uliczne w promieniu 100 m',
    opis: 'Liczba latarni oznaczonych w OpenStreetMap jako highway=street_lamp w promieniu 100 m w linii prostej od adresu. Kompletność OSM bywa nierówna; zero oznacza brak oznaczonych latarni, nie dowód braku oświetlenia.',
    jednostka: 'szt.',
    kierunek: 'wiecej-lepiej',
    rozdzielczosc: 'adres',
    zakres: [0, 30],
    zadanie: 45,
    zrodla: [
      {
        nazwa: '© OpenStreetMap contributors – latarnie uliczne',
        url: wynik.url,
        licencja: 'Open Database License (ODbL) 1.0: https://www.openstreetmap.org/copyright',
        dataDanych: wynik.dataDanych,
        pobrano: dzis(),
      },
    ],
  },
  wartosci,
)
console.log(
  `BBox ${bbox}; latarnie ${wynik.elements.length}; czas ${(performance.now() - start).toFixed(0)} ms`,
)
