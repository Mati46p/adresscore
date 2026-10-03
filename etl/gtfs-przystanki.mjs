// Statyczne rozkłady ZTP -> odległość w linii prostej do najbliższego peronu.
// Uruchom: node etl/gtfs-przystanki.mjs. Bez argumentów pobiera aktualne A/M/T.

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { strFromU8, unzipSync } from 'fflate'
import KDBush from 'kdbush'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const BAZA = 'https://gtfs.ztp.krakow.pl'
const GRUPY = ['A', 'M', 'T']
const RAD = Math.PI / 180
const PROMIEN_ZIEMI = 6_371_000
const MAX_PROMIEN = 16_000
const DNI = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const execFileAsync = promisify(execFile)

function dataLokalna(data = new Date()) {
  const czesci = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(data)
  const pole = (nazwa) => czesci.find((czesc) => czesc.type === nazwa).value
  return `${pole('year')}-${pole('month')}-${pole('day')}`
}

export function odlegloscMetry(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * RAD
  const dLon = (bLon - aLon) * RAD
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * PROMIEN_ZIEMI * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Parsuje CSV GTFS z cytowaniem, przecinkami i CRLF bez dodatkowych zależności. */
export function csv(tekst) {
  const wiersze = []
  let wiersz = []
  let pole = ''
  let cytat = false
  for (let i = 0; i < tekst.length; i++) {
    const znak = tekst[i]
    if (cytat) {
      if (znak === '"' && tekst[i + 1] === '"') {
        pole += '"'
        i++
      } else if (znak === '"') cytat = false
      else pole += znak
    } else if (znak === '"') cytat = true
    else if (znak === ',') {
      wiersz.push(pole)
      pole = ''
    } else if (znak === '\n') {
      wiersz.push(pole.replace(/\r$/, ''))
      if (wiersz.some(Boolean)) wiersze.push(wiersz)
      wiersz = []
      pole = ''
    } else pole += znak
  }
  if (cytat) throw new Error('Niekompletne pole CSV')
  if (pole || wiersz.length) {
    wiersz.push(pole)
    wiersze.push(wiersz)
  }
  const [naglowek, ...dane] = wiersze
  if (!naglowek) throw new Error('Pusty CSV')
  naglowek[0] = naglowek[0].replace(/^\uFEFF/, '')
  return dane.map((pola) => Object.fromEntries(naglowek.map((n, i) => [n, pola[i] ?? ''])))
}

/** Wybiera przystanki i odjazdy w szczycie z kursów dostępnych danego dnia. */
export function obslugaDnia(pliki, data) {
  for (const nazwa of ['calendar.txt', 'calendar_dates.txt', 'trips.txt', 'stop_times.txt'])
    if (!pliki[nazwa]) throw new Error(`GTFS: brak ${nazwa}`)
  const dzien = data.replaceAll('-', '')
  const dzienTygodnia = DNI[new Date(`${data}T12:00:00Z`).getUTCDay()]
  if (!dzienTygodnia) throw new Error(`Niepoprawna data: ${data}`)
  const uslugi = new Set()
  for (const w of csv(strFromU8(pliki['calendar.txt'])))
    if (w.start_date <= dzien && w.end_date >= dzien && w[dzienTygodnia] === '1')
      uslugi.add(w.service_id)
  for (const w of csv(strFromU8(pliki['calendar_dates.txt']))) {
    if (w.date !== dzien) continue
    if (w.exception_type === '1') uslugi.add(w.service_id)
    if (w.exception_type === '2') uslugi.delete(w.service_id)
  }
  if (!uslugi.size) throw new Error(`GTFS: brak aktywnych usług na ${data}`)
  const kursy = new Set(
    csv(strFromU8(pliki['trips.txt']))
      .filter((w) => uslugi.has(w.service_id))
      .map((w) => w.trip_id),
  )
  if (!kursy.size) throw new Error(`GTFS: brak kursów na ${data}`)

  // stop_times.txt w autobusowym A ma ~140 MB. Skanujemy go po kawałku, bez
  // tworzenia setek tysięcy obiektów JS; w publicznym feedzie ID i czasy nie
  // zawierają cudzysłowów ani przecinków.
  const bajty = pliki['stop_times.txt']
  const dekoder = new TextDecoder()
  const przystanki = new Set()
  const odjazdySzczyt = new Map()
  let reszta = ''
  let pierwsza = true
  const przecinekPoPolu = (linia, od) => {
    let cytat = false
    for (let i = od; i < linia.length; i++) {
      if (linia[i] === '"') {
        if (cytat && linia[i + 1] === '"') i++
        else cytat = !cytat
      } else if (linia[i] === ',' && !cytat) return i
    }
    return -1
  }
  const dodajLinie = (linia) => {
    if (pierwsza) {
      pierwsza = false
      if (!linia.replace(/^\uFEFF/, '').startsWith('trip_id,arrival_time,departure_time,stop_id,'))
        throw new Error('GTFS: nieoczekiwany układ stop_times.txt')
      return
    }
    const a = przecinekPoPolu(linia, 0)
    if (a < 0 || !kursy.has(linia.slice(0, a))) return
    const b = przecinekPoPolu(linia, a + 1)
    const c = przecinekPoPolu(linia, b + 1)
    const d = przecinekPoPolu(linia, c + 1)
    const e = przecinekPoPolu(linia, d + 1)
    const f = przecinekPoPolu(linia, e + 1)
    const g = przecinekPoPolu(linia, f + 1)
    if (b < 0 || c < 0 || d < 0 || e < 0 || f < 0 || g < 0) return
    if (linia.slice(f + 1, g) === '1') return
    const id = linia.slice(c + 1, d)
    przystanki.add(id)
    const odjazd = linia.slice(b + 1, c)
    if (odjazd >= '07:00:00' && odjazd < '09:00:00')
      odjazdySzczyt.set(id, (odjazdySzczyt.get(id) ?? 0) + 1)
  }
  for (let od = 0; od < bajty.length; od += 1024 * 1024) {
    const tekst = reszta + dekoder.decode(bajty.subarray(od, od + 1024 * 1024), { stream: true })
    const linie = tekst.split('\n')
    reszta = linie.pop()
    for (const linia of linie) dodajLinie(linia)
  }
  if (reszta) dodajLinie(reszta)
  if (!przystanki.size) throw new Error(`GTFS: brak obsługiwanych przystanków na ${data}`)
  return { przystanki, odjazdySzczyt }
}

export function aktywneStopIds(pliki, data) {
  return obslugaDnia(pliki, data).przystanki
}

export function odczytajGtfs(bufor, grupa, dataObslugi) {
  let pliki
  try {
    pliki = unzipSync(bufor, {
      filter: ({ name }) =>
        [
          'stops.txt',
          'feed_info.txt',
          'calendar.txt',
          'calendar_dates.txt',
          'trips.txt',
          'stop_times.txt',
        ].includes(name),
    })
  } catch (blad) {
    throw new Error(`GTFS ${grupa}: niekompletny/uszkodzony ZIP: ${blad.message}`)
  }
  if (!pliki['stops.txt'] || !pliki['feed_info.txt'])
    throw new Error(`GTFS ${grupa}: brak stops.txt lub feed_info.txt`)
  const informacje = csv(strFromU8(pliki['feed_info.txt']))[0]
  const wiersze = csv(strFromU8(pliki['stops.txt']))
  if (!wiersze.length) throw new Error(`GTFS ${grupa}: puste stops.txt`)
  const obsluga = dataObslugi ? obslugaDnia(pliki, dataObslugi) : null
  const punkty = wiersze.flatMap((p) => {
    if (obsluga && !obsluga.przystanki.has(p.stop_id)) return []
    if (!p.stop_lat || !p.stop_lon) return []
    const lat = Number(p.stop_lat)
    const lon = Number(p.stop_lon)
    if (p.location_type && p.location_type !== '0') return []
    if (
      !p.stop_id ||
      !p.stop_name ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    )
      return []
    return [
      {
        id: `${grupa}:${p.stop_id}`,
        kod: p.stop_code || null,
        nazwa: p.stop_name,
        lat,
        lon,
        odjazdySzczyt: obsluga?.odjazdySzczyt.get(p.stop_id) ?? 0,
      },
    ]
  })
  if (!punkty.length) throw new Error(`GTFS ${grupa}: brak poprawnych przystanków`)
  return { informacje, punkty, odrzucone: wiersze.length - punkty.length }
}

function odczytajDwieDaty(bufor, grupa, dataObslugi, dataSzczyt) {
  return {
    ...odczytajGtfs(bufor, grupa, dataObslugi),
    szczyt: odczytajGtfs(bufor, grupa, dataSzczyt),
  }
}

async function pobierzGrupe(grupa, dataObslugi, dataSzczyt) {
  mkdirSync(CACHE, { recursive: true })
  const url = `${BAZA}/GTFS_KRK_${grupa}.zip`
  const cel = join(CACHE, `GTFS_KRK_${grupa}_${dzis()}.zip`)
  const metaplik = `${cel}.json`
  if (existsSync(cel) && existsSync(metaplik)) {
    try {
      const bufor = readFileSync(cel)
      const meta = JSON.parse(readFileSync(metaplik, 'utf8'))
      if (
        bufor.length === meta.bajty &&
        createHash('sha256').update(bufor).digest('hex') === meta.sha256
      ) {
        return { ...odczytajDwieDaty(bufor, grupa, dataObslugi, dataSzczyt), url, ...meta }
      }
    } catch {
      /* uszkodzony cache trzeba pobrać ponownie */
    }
    rmSync(cel, { force: true })
    rmSync(metaplik, { force: true })
  }

  let ostatniBlad
  for (let proba = 1; proba <= 5; proba++) {
    try {
      // Serwer ZTP potrafi uciąć transfer HTTP/2 bez błędu; curl przez HTTP/1.1
      // jest stabilniejszy. Fallback fetch pozwala uruchomić ETL bez curl.
      const tymczasowy = `${cel}.tmp`
      const naglowki = `${cel}.headers.tmp`
      let bufor
      let lastModified
      let oczekiwane
      try {
        await execFileAsync(
          'curl',
          ['-fsSL', '--http1.1', '--max-time', '180', '-D', naglowki, '-o', tymczasowy, url],
          { timeout: 190_000 },
        )
        const tekstNaglowkow = readFileSync(naglowki, 'utf8')
        bufor = readFileSync(tymczasowy)
        lastModified = [...tekstNaglowkow.matchAll(/^last-modified:\s*(.+)$/gim)]
          .at(-1)?.[1]
          ?.trim()
        oczekiwane = Number([...tekstNaglowkow.matchAll(/^content-length:\s*(\d+)/gim)].at(-1)?.[1])
      } catch (blad) {
        if (blad.code !== 'ENOENT') throw blad
        const odpowiedz = await fetch(url, { signal: AbortSignal.timeout(120_000) })
        if (!odpowiedz.ok) throw new Error(`HTTP ${odpowiedz.status}`)
        bufor = Buffer.from(await odpowiedz.arrayBuffer())
        lastModified = odpowiedz.headers.get('last-modified')
        oczekiwane = Number(odpowiedz.headers.get('content-length'))
        writeFileSync(tymczasowy, bufor)
      } finally {
        rmSync(naglowki, { force: true })
      }
      if (oczekiwane && bufor.length !== oczekiwane)
        throw new Error(`ucięte pobranie: ${bufor.length}/${oczekiwane} bajtów`)
      const dane = odczytajDwieDaty(bufor, grupa, dataObslugi, dataSzczyt)
      const meta = {
        bajty: bufor.length,
        sha256: createHash('sha256').update(bufor).digest('hex'),
        lastModified,
      }
      renameSync(tymczasowy, cel)
      writeFileSync(metaplik, JSON.stringify(meta))
      return { ...dane, url, ...meta }
    } catch (blad) {
      rmSync(`${cel}.tmp`, { force: true })
      ostatniBlad = blad
      console.warn(`GTFS ${grupa}, próba ${proba}/5: ${blad.message}`)
      if (proba < 5) await new Promise((resolve) => setTimeout(resolve, proba * 1000))
    }
  }
  throw new Error(`GTFS ${grupa}: nie udało się pobrać poprawnego archiwum: ${ostatniBlad.message}`)
}

export function indeksPrzystankow(punkty) {
  const indeks = new KDBush(punkty.length)
  for (const p of punkty) indeks.add(p.lon, p.lat)
  indeks.finish()
  return indeks
}

/** Szuka adaptacyjnie; kończy dopiero, gdy znaleziony punkt leży wewnątrz koła. */
export function najblizszyPrzystanek(adres, punkty, indeks) {
  if (!Number.isFinite(adres.lat) || !Number.isFinite(adres.lon) || !punkty.length) return null
  for (let promien = 500; promien <= MAX_PROMIEN; promien *= 2) {
    const deltaLat = promien / 110_500
    const cos = Math.cos((Math.abs(adres.lat) + deltaLat) * RAD)
    const deltaLon = promien / (110_500 * Math.max(cos, 0.01))
    const kandydaci = indeks.range(
      adres.lon - deltaLon,
      adres.lat - deltaLat,
      adres.lon + deltaLon,
      adres.lat + deltaLat,
    )
    let trafienie = null
    let minimum = Infinity
    for (const i of kandydaci) {
      const p = punkty[i]
      const metry = odlegloscMetry(adres.lat, adres.lon, p.lat, p.lon)
      if (metry < minimum) {
        minimum = metry
        trafienie = p
      }
    }
    if (minimum <= promien) return { punkt: trafienie, metry: minimum }
  }
  // Adres daleko poza obszarem feedu: brak pokrycia, nie zmierzone 0 m.
  return null
}

function dataZNaglowka(naglowek, informacje) {
  const data = naglowek && new Date(naglowek)
  if (data && !Number.isNaN(data.getTime())) return dataLokalna(data)
  const wersja = informacje.feed_version?.match(/^(\d{4})(\d{2})(\d{2})/)
  if (wersja) return `${wersja[1]}-${wersja[2]}-${wersja[3]}`
  throw new Error('Brak daty stanu GTFS w Last-Modified i feed_version')
}

function najblizszaSroda(data) {
  const dzien = new Date(`${data}T12:00:00Z`)
  const przesuniecie = (3 - dzien.getUTCDay() + 7) % 7
  dzien.setUTCDate(dzien.getUTCDate() + przesuniecie)
  return dzien.toISOString().slice(0, 10)
}

export async function generuj() {
  const dataObslugi = dataLokalna()
  const dataSzczyt = najblizszaSroda(dataObslugi)
  // Kolejno, żeby nie trzymać w pamięci równocześnie trzech dużych stop_times.
  const feedy = []
  for (const grupa of GRUPY) feedy.push(await pobierzGrupe(grupa, dataObslugi, dataSzczyt))
  for (const [i, f] of feedy.entries())
    console.log(
      `GTFS ${GRUPY[i]}: ${f.punkty.length} peronów, ${f.odrzucone} odrzuconych, SHA-256 ${f.sha256}`,
    )
  const punkty = feedy.flatMap((f) => f.punkty)
  const indeks = indeksPrzystankow(punkty)
  const { adresy } = wczytajAdresy()
  const wyniki = adresy.map((a) => najblizszyPrzystanek(a, punkty, indeks))
  const odjazdyPoKodzie = new Map()
  for (const p of feedy.flatMap((f) => f.szczyt.punkty)) {
    const klucz = p.kod || p.id
    odjazdyPoKodzie.set(klucz, (odjazdyPoKodzie.get(klucz) ?? 0) + p.odjazdySzczyt)
  }
  const kursy = wyniki.map((w) =>
    w ? (odjazdyPoKodzie.get(w.punkt.kod || w.punkt.id) ?? 0) / 2 : null,
  )
  const stanowisko = (w) => `${w.punkt.nazwa} (${w.punkt.kod || w.punkt.id})`
  const zrodla = feedy.map((f, i) => ({
    nazwa: `ZTP Kraków GTFS ${GRUPY[i]} (wydawca w feed_info: ${f.informacje.feed_publisher_name || 'nie podano'}; wersja ${f.informacje.feed_version || 'bez numeru'})`,
    url: f.url,
    licencja:
      'Warunki ponownego wykorzystania informacji GMK: źródło, daty, przetworzenie i klauzula odpowiedzialności; prawa osób trzecich zastrzeżone. https://bip.krakow.pl/?dok_id=48482',
    dataDanych: f.dataDanych || dataZNaglowka(f.lastModified, f.informacje),
    pobrano: dzis(),
  }))
  zapiszWskaznik(
    {
      id: 'przystanek_odleglosc',
      kategoria: 'transport',
      nazwa: 'Najbliższy przystanek',
      opis: `Odległość geodezyjna w linii prostej do najbliższego przystanku z kursami umożliwiającymi wsiadanie w dniu ${dataObslugi} (rozkład GTFS ZTP). To nie jest długość dojścia pieszo; warstwę należy przeliczać dla nowej daty. Poza zasięgiem 16 km: brak danych.`,
      jednostka: 'm',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 1500],
      zadanie: 5,
      zrodla,
    },
    wyniki.map((w) => w?.metry ?? null),
    wyniki.map((w) => (w ? `${stanowisko(w)}, ${Math.round(w.metry)} m w linii prostej` : null)),
  )
  zapiszWskaznik(
    {
      id: 'kursy_szczyt_h',
      kategoria: 'transport',
      nazwa: 'Kursy w porannym szczycie',
      opis: `Średnia liczba planowych odjazdów na godzinę z najbliższego stanowiska przystankowego (tego samego co dla odległości) między 07:00 a 09:00 w środę ${dataSzczyt}. Zsumowano kursy A/M/T o tym samym kodzie stanowiska, bez kursów bez wsiadania. Nie jest to częstotliwość całego zespołu przystankowego ani gwarancja rzeczywistego odjazdu.`,
      jednostka: 'kursy/h',
      kierunek: 'wiecej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 80],
      zadanie: 5,
      zrodla,
    },
    kursy,
    wyniki.map((w, i) => (w ? `${stanowisko(w)}, ${kursy[i]} kursów/h 07:00–09:00` : null)),
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await generuj()
}
