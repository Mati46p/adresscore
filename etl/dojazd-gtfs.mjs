// GTFS ZTP: rozkładowy czas podróży do wskazanego punktu (07:00, dzień roboczy).
// Uruchom: node etl/dojazd-gtfs.mjs [YYYY-MM-DD] [lon lat]
// Bez współrzędnych celem są stanowiska "Kraków Airport" (dojście od nich = 0).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import KDBush from 'kdbush'
import { csv, odlegloscMetry } from './gtfs-przystanki.mjs'
import {
  DATA_OBSLUGI_MIASTA,
  dataDanychFeedu,
  FEEDY_MIASTA,
  wczytajFeedMiasta,
} from './lib/gtfs-miasta.mjs'
import { MIASTO_INFO } from './lib/miasto.mjs'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const GRUPY = ['A', 'M', 'T']
const BAZA = 'https://gtfs.ztp.krakow.pl'
const DNI = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const START = 7 * 60
const KONIEC = 14 * 60
const MAX_DOJSCIE = 1_200
const MAX_PRZESIADKA = 350
const PREDKOSC_PIESZO = 1.25 // m/s; przybliżenie po linii prostej
const BUFOR_PRZESIADKI = 2 // min na zmianę pojazdu na tym samym stanowisku
const BRAK = 65_535
export const RYNEK_GLOWNY = MIASTO_INFO
  ? { lon: MIASTO_INFO.centrum.lon, lat: MIASTO_INFO.centrum.lat }
  : { lon: 19.9373, lat: 50.0617 }

function minuty(czas) {
  const [h, m, s] = czas.split(':').map(Number)
  if (![h, m, s].every(Number.isInteger) || m > 59 || s > 59) return NaN
  return h * 60 + m + s / 60
}

export function aktywneUslugi(pliki, data) {
  const d = data.replaceAll('-', '')
  const dzien = DNI[new Date(`${data}T12:00:00Z`).getUTCDay()]
  if (!dzien || !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Niepoprawna data')
  const uslugi = new Set()
  // Feedy miast bywają bez calendar.txt albo bez calendar_dates.txt – wystarczy jeden z nich.
  if (pliki['calendar.txt'])
    for (const w of csv(strFromU8(pliki['calendar.txt'])))
      if (w.start_date <= d && w.end_date >= d && w[dzien] === '1') uslugi.add(w.service_id)
  if (pliki['calendar_dates.txt'])
    for (const w of csv(strFromU8(pliki['calendar_dates.txt']))) {
      if (w.date !== d) continue
      if (w.exception_type === '1') uslugi.add(w.service_id)
      if (w.exception_type === '2') uslugi.delete(w.service_id)
    }
  if (!uslugi.size) throw new Error(`Brak usług GTFS na ${data}`)
  return uslugi
}

function wierszeStopTimes(bajty, dodaj) {
  const dekoder = new TextDecoder()
  let reszta = ''
  let naglowek = null
  for (let od = 0; od < bajty.length; od += 1024 * 1024) {
    const fragment = reszta + dekoder.decode(bajty.subarray(od, od + 1024 * 1024), { stream: true })
    const linie = fragment.split('\n')
    reszta = linie.pop()
    for (const linia of linie) {
      if (!naglowek) {
        naglowek = linia
          .replace(/^\uFEFF/, '')
          .replace(/\r$/, '')
          .replaceAll('"', '')
          .split(',')
        // pickup_type i drop_off_type są opcjonalne (np. feed Bydgoszczy ich nie ma).
        for (const pole of [
          'trip_id',
          'arrival_time',
          'departure_time',
          'stop_id',
          'stop_sequence',
        ])
          if (!naglowek.includes(pole)) throw new Error(`GTFS stop_times: brak ${pole}`)
      } else if (linia) dodaj(linia.replace(/\r$/, '').replaceAll('"', '').split(','), naglowek)
    }
  }
  if (reszta) dodaj(reszta.replace(/\r$/, '').replaceAll('"', '').split(','), naglowek)
}

export function odczytajFeed(bufor, grupa, data, startId = 0, okno = {}) {
  const odMin = okno.start ?? START
  const doMin = okno.koniec ?? KONIEC
  const potrzebne = new Set([
    'stops.txt',
    'calendar.txt',
    'calendar_dates.txt',
    'trips.txt',
    'stop_times.txt',
    'feed_info.txt',
  ])
  const pliki = unzipSync(bufor, { filter: ({ name }) => potrzebne.has(name) })
  const wymagane = MIASTO_INFO ? ['stops.txt', 'trips.txt', 'stop_times.txt'] : [...potrzebne]
  for (const plik of wymagane) if (!pliki[plik]) throw new Error(`GTFS ${grupa}: brak ${plik}`)
  const uslugi = aktywneUslugi(pliki, data)
  const kursy = new Set(
    csv(strFromU8(pliki['trips.txt']))
      .filter((w) => uslugi.has(w.service_id))
      .map((w) => w.trip_id),
  )
  if (!kursy.size) throw new Error(`GTFS ${grupa}: brak kursów na ${data}`)
  const punkty = []
  const poId = new Map()
  for (const w of csv(strFromU8(pliki['stops.txt']))) {
    const lat = Number(w.stop_lat)
    const lon = Number(w.stop_lon)
    if (
      !w.stop_id ||
      !w.stop_name ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      (w.location_type && w.location_type !== '0')
    )
      continue
    const i = startId + punkty.length
    poId.set(w.stop_id, i)
    punkty.push({ i, id: `${grupa}:${w.stop_id}`, nazwa: w.stop_name, lat, lon })
  }
  const zdarzenia = []
  let odrzucone = 0
  wierszeStopTimes(pliki['stop_times.txt'], (p, naglowek) => {
    const pole = (nazwa) => p[naglowek.indexOf(nazwa)]
    const trip = pole('trip_id')
    if (!kursy.has(trip)) return
    const stop = poId.get(pole('stop_id'))
    const dep = minuty(pole('departure_time'))
    const arr = minuty(pole('arrival_time'))
    if (stop === undefined || !Number.isFinite(dep) || !Number.isFinite(arr)) {
      odrzucone++
      return
    }
    if (dep < odMin - 5 || dep > doMin || arr > doMin) return
    zdarzenia.push({
      trip: `${grupa}:${trip}`,
      stop,
      dep: Math.floor(dep),
      arr: Math.ceil(arr),
      sequence: Number(pole('stop_sequence')),
      pickup: pole('pickup_type') !== '1',
      dropoff: pole('drop_off_type') !== '1',
    })
  })
  const info = pliki['feed_info.txt'] ? (csv(strFromU8(pliki['feed_info.txt']))[0] ?? {}) : {}
  return { punkty, zdarzenia, info, odrzucone }
}

export function indeksPunktow(punkty) {
  const indeks = new KDBush(punkty.length)
  for (const p of punkty) indeks.add(p.lon, p.lat)
  indeks.finish()
  return indeks
}

export function sasiedzi(punkt, punkty, indeks, promien, limit = Infinity) {
  const dLat = promien / 110_500
  const dLon = promien / (110_500 * Math.cos((punkt.lat * Math.PI) / 180))
  return indeks
    .range(punkt.lon - dLon, punkt.lat - dLat, punkt.lon + dLon, punkt.lat + dLat)
    .map((i) => ({ i, metry: odlegloscMetry(punkt.lat, punkt.lon, punkty[i].lat, punkty[i].lon) }))
    .filter((p) => p.metry <= promien)
    .sort((a, b) => a.metry - b.metry)
    .slice(0, limit)
}

/** Wynik: najwcześniejszy przyjazd (minuta dnia) dla każdego stanowiska i każdej minuty. */
export function profilDoCelu(punkty, zdarzenia, dojscieDoCelu, opcje = {}) {
  const start = opcje.start ?? START
  const koniec = opcje.koniec ?? KONIEC
  const n = punkty.length
  const indeks = indeksPunktow(punkty)
  const sasiedztwo = punkty.map((p) =>
    sasiedzi(p, punkty, indeks, MAX_PRZESIADKA)
      .filter((q) => q.i !== p.i)
      .map((q) => ({
        i: q.i,
        min: Math.max(
          BUFOR_PRZESIADKI,
          Math.ceil(q.metry / PREDKOSC_PIESZO / 60) + BUFOR_PRZESIADKI,
        ),
      })),
  )
  const profil = Array.from({ length: koniec + 2 }, () => new Uint16Array(n).fill(BRAK))
  const kurs = new Map()
  const posortowane = zdarzenia
    .filter((z) => z.dep >= start && z.dep <= koniec && z.arr <= koniec)
    .sort((a, b) => b.dep - a.dep || b.sequence - a.sequence)
  let j = 0
  for (let t = koniec; t >= start; t--) {
    const obecny = profil[t]
    if (t < koniec) obecny.set(profil[t + 1]) // czekanie na następny kurs
    for (const [i, min] of dojscieDoCelu)
      if (t + min <= koniec) obecny[i] = Math.min(obecny[i], t + min)
    // Piesza przesiadka trwa co najmniej 2 min, więc jej stan docelowy jest już policzony.
    for (let i = 0; i < n; i++)
      for (const q of sasiedztwo[i])
        if (t + q.min <= koniec) obecny[i] = Math.min(obecny[i], profil[t + q.min][q.i])
    while (j < posortowane.length && posortowane[j].dep === t) {
      const z = posortowane[j++]
      let najlepszy = kurs.get(z.trip) ?? BRAK
      if (z.dropoff && z.arr <= koniec) {
        const doCelu = dojscieDoCelu.get(z.stop)
        const przesiadka =
          z.arr + BUFOR_PRZESIADKI <= koniec ? profil[z.arr + BUFOR_PRZESIADKI][z.stop] : BRAK
        najlepszy = Math.min(najlepszy, doCelu === undefined ? BRAK : z.arr + doCelu, przesiadka)
      }
      kurs.set(z.trip, najlepszy)
      if (z.pickup) obecny[z.stop] = Math.min(obecny[z.stop], najlepszy)
    }
  }
  return { profil, start, koniec, indeks }
}

export function czasAdresu(adres, punkty, model, celPieszy = null) {
  if (!Number.isFinite(adres.lat) || !Number.isFinite(adres.lon)) return null
  const kandydaci = sasiedzi(adres, punkty, model.indeks, MAX_DOJSCIE)
  let najlepszy = BRAK
  for (const p of kandydaci) {
    const wejscie = model.start + Math.ceil(p.metry / PREDKOSC_PIESZO / 60)
    if (wejscie <= model.koniec) najlepszy = Math.min(najlepszy, model.profil[wejscie][p.i])
  }
  if (celPieszy) {
    const odleglosc = odlegloscMetry(adres.lat, adres.lon, celPieszy.lat, celPieszy.lon)
    if (odleglosc <= MAX_DOJSCIE)
      najlepszy = Math.min(najlepszy, model.start + Math.ceil(odleglosc / PREDKOSC_PIESZO / 60))
  }
  return najlepszy === BRAK ? null : najlepszy - model.start
}

export function dataRobocza() {
  const lokalna = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const d = new Date(`${lokalna}T12:00:00Z`)
  do d.setUTCDate(d.getUTCDate() + 1)
  while (![1, 2, 3, 4, 5].includes(d.getUTCDay()))
  return d.toISOString().slice(0, 10)
}

export function pobierzGrupe(grupa) {
  mkdirSync(CACHE, { recursive: true })
  const url = `${BAZA}/GTFS_KRK_${grupa}.zip`
  const cel = join(CACHE, `GTFS_KRK_${grupa}.zip`)
  const metaplik = `${cel}.meta.json`
  const head = execFileSync('curl', ['-fsSI', '--http1.1', url], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  const rozmiarZdalny = Number([...head.matchAll(/^content-length:\s*(\d+)/gim)].at(-1)?.[1])
  const modyfikacjaZdalna = [...head.matchAll(/^last-modified:\s*(.+)$/gim)].at(-1)?.[1]?.trim()
  if (!rozmiarZdalny || !modyfikacjaZdalna) throw new Error(`Brak długości lub daty ZIP ${grupa}`)
  let bufor
  let meta = existsSync(metaplik) ? JSON.parse(readFileSync(metaplik, 'utf8')) : null
  if (existsSync(cel)) {
    bufor = readFileSync(cel)
    const skrot = createHash('sha256').update(bufor).digest('hex')
    if (
      meta?.bajty !== bufor.length ||
      meta?.sha256 !== skrot ||
      meta?.lastModified !== modyfikacjaZdalna ||
      bufor.length !== rozmiarZdalny
    )
      bufor = null
  }
  if (!bufor) {
    const tymczasowy = `${cel}.tmp`
    const naglowki = `${cel}.headers.tmp`
    try {
      execFileSync(
        'curl',
        [
          '-fsSL',
          '--http1.1',
          '--retry',
          '3',
          '--max-time',
          '180',
          '-D',
          naglowki,
          '-o',
          tymczasowy,
          url,
        ],
        { timeout: 190_000 },
      )
      bufor = readFileSync(tymczasowy)
      const headPobrania = readFileSync(naglowki, 'utf8')
      const rozmiar = Number([...headPobrania.matchAll(/^content-length:\s*(\d+)/gim)].at(-1)?.[1])
      if (bufor.length !== rozmiarZdalny || (rozmiar && rozmiar !== bufor.length))
        throw new Error(`Ucięty lub zmieniony ZIP ${grupa}: ${bufor.length}/${rozmiarZdalny}`)
      meta = {
        bajty: bufor.length,
        sha256: createHash('sha256').update(bufor).digest('hex'),
        lastModified: modyfikacjaZdalna,
      }
      renameSync(tymczasowy, cel)
      writeFileSync(metaplik, JSON.stringify(meta))
    } finally {
      rmSync(tymczasowy, { force: true })
      rmSync(naglowki, { force: true })
    }
  }
  return { url, bufor, meta }
}

/**
 * Feedy do liczenia dojazdu: ZTP Kraków (A/M/T) albo – w trybie miasta – feedy z gtfs-miasta.mjs.
 * Każdy element: { grupa, url, bufor, meta, zrodlo(info) } (zrodlo składa wpis do metadanych wskaźnika).
 */
export async function listaFeedow() {
  if (FEEDY_MIASTA) {
    const wynik = []
    for (const f of FEEDY_MIASTA) {
      const { bufor, meta } = await wczytajFeedMiasta(f)
      wynik.push({
        grupa: f.grupa,
        url: f.url,
        bufor,
        meta,
        zrodlo: (info) => ({
          nazwa: `${f.nazwa} (${info.feed_publisher_name || 'wydawca nie podany'}; ${info.feed_version || 'bez wersji'})`,
          url: f.url,
          licencja: f.licencja,
          dataDanych: dataDanychFeedu(info, meta.dataPobrania),
          pobrano: meta.dataPobrania,
        }),
      })
    }
    return wynik
  }
  return GRUPY.map((grupa) => {
    const { url, bufor, meta } = pobierzGrupe(grupa)
    return {
      grupa,
      url,
      bufor,
      meta,
      zrodlo: (info) => ({
        nazwa: `ZTP Kraków GTFS ${grupa} (${info.feed_publisher_name}; ${info.feed_version || ''})`,
        url,
        licencja:
          'Warunki ponownego wykorzystania informacji GMK: https://bip.krakow.pl/?dok_id=48482',
        dataDanych: meta.lastModified
          ? new Date(meta.lastModified).toISOString().slice(0, 10)
          : /^\d{8}/.test(info.feed_version || '')
            ? `${info.feed_version.slice(0, 4)}-${info.feed_version.slice(4, 6)}-${info.feed_version.slice(6, 8)}`
            : null,
        pobrano: dzis(),
      }),
    }
  })
}

export async function generuj(data = dataRobocza(), cel = null, opcje = {}) {
  const rynek = opcje.rynek === true
  if (rynek && !cel) throw new Error('Rynek wymaga współrzędnych celu')
  if (
    cel &&
    (!Number.isFinite(cel.lon) ||
      !Number.isFinite(cel.lat) ||
      Math.abs(cel.lon) > 180 ||
      Math.abs(cel.lat) > 90)
  )
    throw new Error('Cel: wymagane poprawne współrzędne lon, lat')
  const punkty = []
  const zdarzenia = []
  const zrodla = []
  for (const { grupa, bufor, meta, zrodlo } of await listaFeedow()) {
    const feed = odczytajFeed(bufor, grupa, data, punkty.length)
    punkty.push(...feed.punkty)
    // push(...tablica) przy milionach zdarzeń (Warszawa) przepełnia stos wywołań.
    for (const z of feed.zdarzenia) zdarzenia.push(z)
    const wpis = zrodlo(feed.info)
    if (!wpis.dataDanych) throw new Error(`GTFS ${grupa}: brak wiarygodnej daty stanu danych`)
    zrodla.push(wpis)
    console.log(
      `${grupa}: ${feed.punkty.length} stanowisk, ${feed.zdarzenia.length} zdarzeń, ${feed.odrzucone} odrzuconych; SHA-256 ${meta.sha256}`,
    )
  }
  const indeks = indeksPunktow(punkty)
  let dojscieDoCelu
  let nazwaCelu
  if (cel) {
    dojscieDoCelu = new Map(
      sasiedzi(cel, punkty, indeks, MAX_DOJSCIE).map((p) => [
        p.i,
        Math.ceil(p.metry / PREDKOSC_PIESZO / 60),
      ]),
    )
    nazwaCelu = rynek
      ? (MIASTO_INFO?.centrum.nazwa ?? 'Rynek Główny w Krakowie')
      : `punkt ${cel.lat}, ${cel.lon}`
  } else {
    if (MIASTO_INFO)
      throw new Error(
        'Tryb miasta: warstwa lotniska tylko dla Krakowa (użyj --rynek albo współrzędnych)',
      )
    const lotnisko = punkty.filter((p) => p.nazwa === 'Kraków Airport')
    if (!lotnisko.length) throw new Error('Brak stanowisk Kraków Airport w GTFS')
    dojscieDoCelu = new Map(lotnisko.map((p) => [p.i, 0]))
    nazwaCelu = 'stanowisko Kraków Airport'
  }
  if (!dojscieDoCelu.size) throw new Error('Cel poza zasięgiem GTFS')
  const model = profilDoCelu(punkty, zdarzenia, dojscieDoCelu)
  const { adresy, wersja } = wczytajAdresy()
  const wartosci = adresy.map((a) => czasAdresu(a, punkty, model, rynek ? cel : null))
  const metaWskaznika = {
    id: rynek ? 'rynek_czas_min' : cel ? 'dojazd_cel_test' : 'lotnisko_czas_min',
    kategoria: 'transport',
    nazwa: rynek
      ? MIASTO_INFO
        ? `Czas podróży do centrum (${MIASTO_INFO.centrum.nazwa})`
        : 'Czas podróży do Rynku Głównego'
      : cel
        ? 'Czas do wskazanego punktu'
        : 'Czas do lotniska Balice',
    opis: `Planowy najwcześniejszy przyjazd do celu (${nazwaCelu}${rynek ? `; punkt ${cel.lat}, ${cel.lon}` : ''}) przy wyjściu z punktu adresowego o 07:00 w dniu ${data}, obliczony z ${FEEDY_MIASTA ? `GTFS (${FEEDY_MIASTA.map((f) => f.nazwa).join('; ')})` : 'GTFS ZTP'}${DATA_OBSLUGI_MIASTA ? ' (uwaga: jedyny dostępny feed jest starszy, rozkład z tej daty może się różnić od obecnego)' : ''}. Obejmuje oczekiwanie, przejazd, przesiadki (min. 2 min) oraz dojścia do 1,2 km/przesiadki do 350 m, po prostej przy 1,25 m/s${rynek ? '; uwzględnia też dojście od przystanku do punktu na Rynku oraz bezpośredni marsz z adresu do 1,2 km' : ''}. To przybliżenie planowej podróży, nie pomiar rzeczywisty ani routing po chodnikach; nie obejmuje opóźnień ani dostępności pojazdu${cel ? '' : ', ani drogi od stanowiska lotniskowego do terminala'}. Brak możliwej trasy w modelu do 14:00 = brak danych.`,
    jednostka: 'min',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zadanie: rynek ? 60 : 38,
    zrodla,
  }
  if (cel && !rynek) {
    const etykiety = wartosci.map((v) =>
      v === null ? null : `${v} min planowo do ${nazwaCelu} od 07:00 (${data})`,
    )
    mkdirSync(CACHE, { recursive: true })
    writeFileSync(
      join(CACHE, 'dojazd_cel.json'),
      JSON.stringify({ meta: metaWskaznika, wersjaAdresow: wersja, wartosci, etykiety }),
    )
    console.log(
      `dojazd_cel.json: ${wartosci.filter((v) => v !== null).length}/${wartosci.length} adresów; wynik lokalny w etl/.cache/`,
    )
  } else zapiszWskaznik(metaWskaznika, wartosci)
  return {
    punkty: punkty.length,
    zdarzenia: zdarzenia.length,
    pokrycie: wartosci.filter((v) => v !== null).length,
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [data, lon, lat] = process.argv.slice(2)
  const rynek = lon === '--rynek'
  await generuj(
    data || DATA_OBSLUGI_MIASTA || dataRobocza(),
    rynek ? RYNEK_GLOWNY : lon === undefined ? null : { lon: Number(lon), lat: Number(lat) },
    { rynek },
  )
}
