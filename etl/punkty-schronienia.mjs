// Publiczny katalog Punktów Schronienia KG PSP, ograniczony do gminy Kraków.
// Uruchom: node etl/punkty-schronienia.mjs [ścieżka do CSV]
// Bez argumentu pobiera bieżący CSV do ignorowanego etl/.cache/.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import KDBush from 'kdbush'
import { CACHE, DANE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const URL = 'https://gdziesieukryc.pl/PS_XML/punkty_schronienia.csv'
const KATALOG = 'https://dane.gov.pl/pl/dataset/28058,punkty-schronienia-w-polsce'
const GRANICE = { lat: [49.95, 50.15], lon: [19.75, 20.2] }
const RAD = Math.PI / 180
const ZIEMIA_M = 6_371_000

/** CSV z BOM, cudzysłowami, przecinkami w polach i CRLF. */
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
  if (cytat) throw new Error('Niekompletny CSV: niedomknięty cudzysłów')
  if (pole || wiersz.length) wiersze.push([...wiersz, pole])
  const [naglowek, ...dane] = wiersze
  if (!naglowek) throw new Error('Pusty CSV')
  naglowek[0] = naglowek[0].replace(/^\uFEFF/, '')
  if (new Set(naglowek).size !== naglowek.length) throw new Error('Powtórzona kolumna CSV')
  if (dane.some((pola) => pola.length !== naglowek.length))
    throw new Error('Niekompletny CSV: niespójna liczba kolumn')
  return dane.map((pola) => Object.fromEntries(naglowek.map((n, i) => [n, pola[i]])))
}

export function punktyKrakowa(tekst) {
  const wiersze = csv(tekst)
  const wymagane = [
    'Identyfikator publiczny',
    'Gmina',
    'Szerokosc geograficzna',
    'Dlugosc geograficzna',
    'Dostepnosc',
  ]
  if (!wiersze.length || wymagane.some((n) => !(n in wiersze[0])))
    throw new Error('Nieoczekiwany schemat CSV KG PSP')
  const krakow = wiersze.filter((w) => w.Gmina === 'Kraków')
  const identyfikatory = new Set()
  const features = krakow.map((w) => {
    const lat = Number(w['Szerokosc geograficzna'])
    const lon = Number(w['Dlugosc geograficzna'])
    const id = w['Identyfikator publiczny']
    if (!id || identyfikatory.has(id)) throw new Error(`Brak lub duplikat ID: ${id}`)
    identyfikatory.add(id)
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < GRANICE.lat[0] ||
      lat > GRANICE.lat[1] ||
      lon < GRANICE.lon[0] ||
      lon > GRANICE.lon[1]
    )
      throw new Error(`Współrzędne poza Krakowem: ${id}`)
    return {
      type: 'Feature',
      id,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        nazwa: w.Nazwa || null,
        rodzajZrodla: w['Rodzaj obiektu'] || null,
        adres: w.Adres || null,
        dostepnosc: w.Dostepnosc || null,
      },
    }
  })
  return { liczbaWszystkich: wiersze.length, features }
}

function metryGeodezyjne(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * RAD
  const dLon = (bLon - aLon) * RAD
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * ZIEMIA_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function indeksPunktow(features) {
  const indeks = new KDBush(features.length)
  for (const f of features) indeks.add(...f.geometry.coordinates)
  indeks.finish()
  return indeks
}

/** Tylko Kraków: poza zakresem źródła brak wyniku, a nie odległość do Krakowa. */
export function najblizszyPunkt(adres, features, indeks) {
  if (adres.gmina !== 'Kraków' || !Number.isFinite(adres.lat) || !Number.isFinite(adres.lon))
    return null
  for (let promien = 500; promien <= 8_000; promien *= 2) {
    const deltaLat = promien / 110_500
    const deltaLon = promien / (110_500 * Math.cos((Math.abs(adres.lat) + deltaLat) * RAD))
    let trafienie = null
    let minimum = Infinity
    for (const i of indeks.range(
      adres.lon - deltaLon,
      adres.lat - deltaLat,
      adres.lon + deltaLon,
      adres.lat + deltaLat,
    )) {
      const punkt = features[i]
      const [lon, lat] = punkt.geometry.coordinates
      const metry = metryGeodezyjne(adres.lat, adres.lon, lat, lon)
      if (metry < minimum) {
        minimum = metry
        trafienie = punkt
      }
    }
    if (minimum <= promien) return { punkt: trafienie, metry: minimum }
  }
  return null
}

async function main() {
  const sciezka = process.argv[2]
  let bufor
  let dataDanych
  if (sciezka) {
    bufor = readFileSync(sciezka)
    dataDanych = process.env.PSP_DATA_DANYCH
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDanych ?? ''))
      throw new Error('Dla pliku lokalnego ustaw PSP_DATA_DANYCH=YYYY-MM-DD')
  } else {
    const r = await fetch(URL)
    if (!r.ok) throw new Error(`CSV KG PSP: HTTP ${r.status}`)
    bufor = Buffer.from(await r.arrayBuffer())
    const deklarowanaDlugosc = Number(r.headers.get('content-length'))
    if (
      Number.isFinite(deklarowanaDlugosc) &&
      deklarowanaDlugosc > 0 &&
      bufor.length !== deklarowanaDlugosc
    )
      throw new Error(`Ucięty CSV KG PSP: ${bufor.length}/${deklarowanaDlugosc} B`)
    const lastModified = r.headers.get('last-modified')
    dataDanych = lastModified ? new Date(lastModified).toISOString().slice(0, 10) : null
    if (!dataDanych) throw new Error('Brak daty Last-Modified źródła')
  }
  const wynik = punktyKrakowa(bufor.toString('utf8'))
  if (wynik.liczbaWszystkich < 80_000 || wynik.features.length < 2_000)
    throw new Error(
      `Podejrzanie niepełny katalog: ${wynik.liczbaWszystkich} / Kraków ${wynik.features.length}`,
    )
  const sha256 = createHash('sha256').update(bufor).digest('hex')
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(join(CACHE, `punkty_schronienia_${sha256.slice(0, 12)}.csv`), bufor)
  const geojson = {
    type: 'FeatureCollection',
    metadane: {
      nazwa: 'Punkty Schronienia KG PSP – Kraków',
      znaczenie:
        'Punkty informacyjne doraźnej osłony; nie są potwierdzonymi schronami, ukryciami ani miejscami doraźnego schronienia w rozumieniu ustawy.',
      zrodlo: URL,
      katalog: KATALOG,
      licencja: 'CC BY 4.0',
      wydawca: 'Komenda Główna Państwowej Straży Pożarnej',
      dataDanych,
      znaczenieDatyDanych:
        'Data nagłówka HTTP Last-Modified pobranego pliku CSV; nie oznacza daty weryfikacji każdego punktu.',
      pobrano: dzis(),
      przetworzono:
        'Odfiltrowano rekordy Gmina=Kraków; zachowano publiczny identyfikator i współrzędne WGS84. Dostępność pochodzi z katalogu i nie gwarantuje wejścia.',
      sha256Zrodla: sha256,
      liczbaWszystkich: wynik.liczbaWszystkich,
      liczbaKrakow: wynik.features.length,
    },
    features: wynik.features,
  }
  writeFileSync(join(DANE, 'punkty_schronienia.geojson'), JSON.stringify(geojson))
  const { adresy } = wczytajAdresy()
  const indeks = indeksPunktow(wynik.features)
  const najblizsze = adresy.map((adres) => najblizszyPunkt(adres, wynik.features, indeks))
  const maksOdleglosc = najblizsze.reduce((maks, w) => Math.max(maks, w?.metry ?? 0), 0)
  if (maksOdleglosc > 6_000)
    throw new Error(`Odległość ${maksOdleglosc} m wykracza poza deklarowany zakres 6000 m`)
  zapiszWskaznik(
    {
      id: 'punkt_schronienia_odleglosc',
      kategoria: 'kontekst',
      nazwa: 'Najbliższy Punkt Schronienia KG PSP',
      opis: 'Odległość geodezyjna w linii prostej od adresu w gminie Kraków do najbliższego Punktu Schronienia KG PSP. Nie jest to trasa ani czas dojścia. Punkty są kategorią informacyjną, nie potwierdzonymi schronami, ukryciami lub MDS; dostępność wejścia nie jest gwarantowana. Poza gminą Kraków i promieniem 8 km: brak danych.',
      jednostka: 'm',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      zakres: [0, 6_000],
      zadanie: 25,
      zrodla: [
        {
          nazwa: 'Komenda Główna Państwowej Straży Pożarnej – Punkty Schronienia',
          url: URL,
          licencja: `CC BY 4.0 (${KATALOG}); przetworzono: filtr gminy i odległość geodezyjna`,
          dataDanych,
          pobrano: dzis(),
        },
      ],
    },
    najblizsze.map((w) => w?.metry ?? null),
    najblizsze.map((w) =>
      w
        ? `${w.punkt.properties.nazwa || 'Punkt Schronienia'} – ${w.punkt.properties.rodzajZrodla || 'typ niepodany'} (${w.punkt.id}), ${Math.round(w.metry)} m w linii prostej`
        : null,
    ),
  )
  console.log(
    `Punkty Schronienia KG PSP: ${wynik.features.length} Kraków / ${wynik.liczbaWszystkich} Polska, ${dataDanych}`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
