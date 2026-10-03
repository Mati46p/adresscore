// Statyczne rozkłady ZTP -> odległość w linii prostej do najbliższego peronu.
// Uruchom: node etl/gtfs-przystanki.mjs. Bez argumentów pobiera aktualne A/M/T.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import KDBush from 'kdbush'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const BAZA = 'https://gtfs.ztp.krakow.pl'
const GRUPY = ['A', 'M', 'T']
const RAD = Math.PI / 180
const PROMIEN_ZIEMI = 6_371_000
const MAX_PROMIEN = 16_000

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

export function odczytajGtfs(bufor, grupa) {
  let pliki
  try {
    pliki = unzipSync(bufor, {
      filter: ({ name }) => name === 'stops.txt' || name === 'feed_info.txt',
    })
  } catch (blad) {
    throw new Error(`GTFS ${grupa}: niekompletny/uszkodzony ZIP: ${blad.message}`)
  }
  if (!pliki['stops.txt'] || !pliki['feed_info.txt'])
    throw new Error(`GTFS ${grupa}: brak stops.txt lub feed_info.txt`)
  const informacje = csv(strFromU8(pliki['feed_info.txt']))[0]
  const wiersze = csv(strFromU8(pliki['stops.txt']))
  if (!wiersze.length) throw new Error(`GTFS ${grupa}: puste stops.txt`)
  const punkty = wiersze.flatMap((p) => {
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
    return [{ id: `${grupa}:${p.stop_id}`, nazwa: p.stop_name, lat, lon }]
  })
  if (!punkty.length) throw new Error(`GTFS ${grupa}: brak poprawnych przystanków`)
  return { informacje, punkty, odrzucone: wiersze.length - punkty.length }
}

async function pobierzGrupe(grupa) {
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
        return { ...odczytajGtfs(bufor, grupa), url, ...meta }
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
      const odpowiedz = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!odpowiedz.ok) throw new Error(`HTTP ${odpowiedz.status}`)
      const bufor = Buffer.from(await odpowiedz.arrayBuffer())
      const oczekiwane = Number(odpowiedz.headers.get('content-length'))
      if (oczekiwane && bufor.length !== oczekiwane)
        throw new Error(`ucięte pobranie: ${bufor.length}/${oczekiwane} bajtów`)
      const dane = odczytajGtfs(bufor, grupa)
      const meta = {
        bajty: bufor.length,
        sha256: createHash('sha256').update(bufor).digest('hex'),
        lastModified: odpowiedz.headers.get('last-modified'),
      }
      const tymczasowy = `${cel}.tmp`
      writeFileSync(tymczasowy, bufor)
      renameSync(tymczasowy, cel)
      writeFileSync(metaplik, JSON.stringify(meta))
      return { ...dane, url, ...meta }
    } catch (blad) {
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
  if (data && !Number.isNaN(data.getTime())) {
    const czesci = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(data)
    const pole = (nazwa) => czesci.find((czesc) => czesc.type === nazwa).value
    return `${pole('year')}-${pole('month')}-${pole('day')}`
  }
  const wersja = informacje.feed_version?.match(/^(\d{4})(\d{2})(\d{2})/)
  if (wersja) return `${wersja[1]}-${wersja[2]}-${wersja[3]}`
  throw new Error('Brak daty stanu GTFS w Last-Modified i feed_version')
}

export async function generuj() {
  const feedy = await Promise.all(GRUPY.map(pobierzGrupe))
  for (const [i, f] of feedy.entries())
    console.log(
      `GTFS ${GRUPY[i]}: ${f.punkty.length} peronów, ${f.odrzucone} odrzuconych, SHA-256 ${f.sha256}`,
    )
  const punkty = feedy.flatMap((f) => f.punkty)
  const indeks = indeksPrzystankow(punkty)
  const { adresy } = wczytajAdresy()
  const wyniki = adresy.map((a) => najblizszyPrzystanek(a, punkty, indeks))
  zapiszWskaznik(
    {
      id: 'przystanek_odleglosc',
      kategoria: 'transport',
      nazwa: 'Najbliższy przystanek',
      opis: 'Odległość geodezyjna w linii prostej od punktu adresowego do najbliższego punktu przystankowego w plikach GTFS ZTP. To nie jest długość trasy pieszej ani gwarancja bieżącej obsługi. Poza zasięgiem 16 km: brak danych.',
      jednostka: 'm',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 1500],
      zadanie: 5,
      zrodla: feedy.map((f, i) => ({
        nazwa: `ZTP Kraków GTFS ${GRUPY[i]} (wydawca w feed_info: ${f.informacje.feed_publisher_name || 'nie podano'}; wersja ${f.informacje.feed_version || 'bez numeru'})`,
        url: f.url,
        licencja:
          'Warunki ponownego wykorzystania informacji GMK: źródło, daty, przetworzenie i klauzula odpowiedzialności; prawa osób trzecich zastrzeżone. https://bip.krakow.pl/?dok_id=48482',
        dataDanych: dataZNaglowka(f.lastModified, f.informacje),
        pobrano: dzis(),
      })),
    },
    wyniki.map((w) => w?.metry ?? null),
    wyniki.map((w) => (w ? `${w.punkt.nazwa}, ${Math.round(w.metry)} m w linii prostej` : null)),
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await generuj()
}
