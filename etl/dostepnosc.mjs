// Dostępność bez barier: punkty OSM (ODbL 1.0) i miejsca POZ z GSL NFZ.
// Liczy obniżone krawężniki i ławki w 300 m oraz odległość do najbliższego POZ
// z potwierdzonym podjazdem, dostosowaną windą lub toaletą. Uruchom:
// node etl/dostepnosc.mjs. Surowe odpowiedzi zostają w etl/.cache/dostepnosc/.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { unzipSync } from 'fflate'
import KDBush from 'kdbush'
import proj4 from 'proj4'
import { CACHE, DANE, dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const OSM = 'https://overpass-api.de/api/interpreter'
const GSL = 'https://wspub.nfz.gov.pl/'
const PROMIEN = 300
const start = performance.now()
const { adresy } = wczytajAdresy()
const katalog = join(CACHE, 'dostepnosc')
mkdirSync(katalog, { recursive: true })

proj4.defs(
  'EPSG:2180',
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs',
)
const xy = (lon, lat) => proj4('EPSG:4326', 'EPSG:2180', [lon, lat])
const punktyAdresow = adresy.map((a) => xy(a.lon, a.lat))

function indeks(punkty) {
  if (!punkty.length) throw new Error('Brak punktów źródłowych')
  const bush = new KDBush(punkty.length)
  for (const p of punkty) bush.add(...p.xy)
  bush.finish()
  return bush
}

function dystans(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

async function pobierzOsm() {
  const cacheJson = join(katalog, 'osm.json')
  if (existsSync(cacheJson)) {
    try {
      const dane = JSON.parse(readFileSync(cacheJson, 'utf8'))
      if (Array.isArray(dane.elements) && dane.osm3s?.timestamp_osm_base) return dane
    } catch {
      /* uszkodzony cache pobieramy ponownie */
    }
    rmSync(cacheJson)
  }
  // BBox rozszerzamy o 1 km, by punkty na obrzeżu miały pełny promień 300 m.
  const ramka = adresy.reduce(
    (b, a) => [
      Math.min(b[0], a.lat),
      Math.min(b[1], a.lon),
      Math.max(b[2], a.lat),
      Math.max(b[3], a.lon),
    ],
    [90, 180, -90, -180],
  )
  const [s, w, n, e] = [ramka[0] - 0.01, ramka[1] - 0.015, ramka[2] + 0.01, ramka[3] + 0.015]
  const q = `[out:json][timeout:180];(node["kerb"~"^(lowered|flush)$"](${s},${w},${n},${e});node["amenity"="bench"](${s},${w},${n},${e}););out body;`
  try {
    const sciezka = await pobierzDoCache(OSM, join('dostepnosc', 'osm.json'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'adresscore-etl/1.0 (Mati46p/adresscore)',
      },
      body: new URLSearchParams({ data: q }),
      signal: AbortSignal.timeout(210_000),
    })
    const dane = JSON.parse(readFileSync(sciezka, 'utf8'))
    if (!Array.isArray(dane.elements) || !dane.osm3s?.timestamp_osm_base)
      throw new Error('Niepełna odpowiedź Overpass; usuń uszkodzony cache OSM')
    return { ...dane, zrodlo: OSM }
  } catch (blad) {
    rmSync(cacheJson, { force: true })
    console.warn(
      `Overpass niedostępny (${blad.message}); używam oficjalnego ekstraktu OSM Geofabrik.`,
    )
  }
  const url = 'https://download.geofabrik.de/europe/poland/malopolskie-latest.osm.pbf'
  const pbf = join(katalog, 'malopolskie-latest.osm.pbf')
  const naglowki = execFileSync('curl', ['-sSIL', '--max-time', '20', url], { encoding: 'utf8' })
  const nazwa = naglowki.match(/malopolskie-(\d{6})\.osm\.pbf/)
  if (!nazwa) throw new Error('Nie ustalono daty ekstraktu Geofabrik')
  const rozmiar = [...naglowki.matchAll(/content-length:\s*(\d+)/gi)].at(-1)?.[1]
  if (!rozmiar) throw new Error('Nie ustalono rozmiaru ekstraktu Geofabrik')
  if (!existsSync(pbf) || statSync(pbf).size < Number(rozmiar))
    execFileSync(
      'curl',
      ['-fLsS', '-C', '-', '--retry', '4', '--max-time', '1200', url, '-o', pbf],
      { stdio: 'inherit' },
    )
  if (statSync(pbf).size !== Number(rozmiar)) throw new Error('Niepełny ekstrakt Geofabrik w cache')
  const data = `20${nazwa[1].slice(0, 2)}-${nazwa[1].slice(2, 4)}-${nazwa[1].slice(4, 6)}`
  const instancja = await DuckDBInstance.create(':memory:')
  const polaczenie = await instancja.connect()
  await polaczenie.run('LOAD spatial')
  const sql = `SELECT id, lat, lon, tags['kerb'] AS kerb, tags['amenity'] AS amenity FROM ST_ReadOSM('${pbf.replaceAll("'", "''")}') WHERE kind = 'node' AND lat BETWEEN ${s} AND ${n} AND lon BETWEEN ${w} AND ${e} AND (tags['kerb'] IN ('lowered', 'flush') OR tags['amenity'] = 'bench')`
  const wynik = await polaczenie.runAndReadAll(sql)
  const elements = wynik.getRowObjectsJS().map((r) => ({
    type: 'node',
    id: String(r.id),
    lat: r.lat,
    lon: r.lon,
    tags: { kerb: r.kerb, amenity: r.amenity },
  }))
  polaczenie.closeSync()
  const dane = { elements, osm3s: { timestamp_osm_base: data }, zrodlo: url }
  writeFileSync(cacheJson, JSON.stringify(dane))
  return dane
}

async function pobierzGsl() {
  const koperta = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:bro="http://xml.kamsoft.pl/ws/broker" xmlns:com="http://xml.kamsoft.pl/ws/common"><soapenv:Header/><soapenv:Body><bro:executeService><com:location><com:namespace>www.nfz.gov.pl/ws/broker/cen/gslpub</com:namespace><com:localname>getGSLPub</com:localname><com:version>1.0</com:version></com:location><bro:date>${new Date().toISOString()}</bro:date><bro:params><bro:item><bro:name>ow</bro:name><bro:value>06</bro:value></bro:item></bro:params><bro:payload/></bro:executeService></soapenv:Body></soapenv:Envelope>`
  const sciezka = await pobierzDoCache(GSL, join('dostepnosc', 'gsl-06.mime'), {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'executeService' },
    body: koperta,
    signal: AbortSignal.timeout(90_000),
  })
  const mime = readFileSync(sciezka)
  const poczatekZip = mime.indexOf(Buffer.from('PK\x03\x04', 'binary'))
  if (poczatekZip < 0 || !mime.subarray(0, poczatekZip).includes(Buffer.from('status="OK"')))
    throw new Error('GSL NFZ nie zwrócił archiwum z danymi')
  const koniecZip = mime.indexOf(Buffer.from('PK\x05\x06', 'binary'), poczatekZip)
  if (koniecZip < 0) throw new Error('Niepełny ZIP z GSL NFZ')
  const komentarz = mime.readUInt16LE(koniecZip + 20)
  const zip = unzipSync(new Uint8Array(mime.subarray(poczatekZip, koniecZip + 22 + komentarz)))
  const nazwa = Object.keys(zip).find((n) => n.endsWith('.xml'))
  if (!nazwa) throw new Error('Brak XML w ZIP GSL NFZ')
  return Buffer.from(zip[nazwa]).toString('utf8')
}

function atrybuty(tekst) {
  return Object.fromEntries([...tekst.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
}

function normalizuj(tekst) {
  return (tekst ?? '')
    .replaceAll('ł', 'l')
    .replaceAll('Ł', 'L')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function lokalnosc(tekst) {
  const n = normalizuj(tekst)
  return n.startsWith('krakow') ? 'krakow' : n
}

function ulica(tekst) {
  let s = (tekst ?? '').trim().toLowerCase()
  s = s.replace(/^(?:ul\.|ulica\s+)/, '')
  s = s.replace(/^os(?:\.\s*|\s+)/, 'osiedle ')
  s = s.replace(/^oś\.\s*/, 'osiedle ')
  s = s.replace(/^al(?:\.\s*|\s+)/, 'aleja ')
  s = s.replace(/^pl(?:\.\s*|\s+)/, 'plac ')
  s = s.replace(/^gen\.\s*/, 'generała ')
  s = s.replace(/^prof\.\s*/, 'profesora ')
  s = s.replace(/^św\.\s*/, 'świętego ')
  return normalizuj(s)
}

function dekodujXml(tekst) {
  return tekst.replace(/&#(x[0-9a-f]+|\d+);|&(amp|quot|apos|lt|gt);/gi, (calosc, kod, encja) => {
    if (kod)
      return String.fromCodePoint(
        kod[0].toLowerCase() === 'x' ? Number.parseInt(kod.slice(1), 16) : Number(kod),
      )
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[encja] ?? calosc
  })
}

function miejscaPoz(xml) {
  const data = xml.match(/<komunikat\b[^>]*data-obowiazywania="([^"]+)"/)?.[1]
  if (!data) throw new Error('Brak daty obowiązywania GSL')
  const typy = xml.match(/<gsl-miejsca-typy>([\s\S]*?)<\/gsl-miejsca-typy>/)?.[1]
  const miejscaXml = xml.match(/<gsl-miejsca>([\s\S]*?)<\/gsl-miejsca>/)?.[1]
  if (!typy || !miejscaXml) throw new Error('Brak listy miejsc lub typów GSL')
  const ids = new Set(
    [...typy.matchAll(/<miejsce-typ\b([^>]+)\/>/g)]
      .map((m) => atrybuty(m[1]))
      .filter((a) => a.typ === '1')
      .map((a) => a['id-gsl-miej']),
  )
  if (!ids.size) throw new Error('GSL nie zawiera miejsc POZ')
  const miejsca = [...miejscaXml.matchAll(/<miejsce\s([^>]+)>/g)]
    .map((m) => atrybuty(m[1]))
    .filter((a) => ids.has(a['id-gsl-miej']))
  return { data, miejsca }
}

function pozZGeokodowaniem(miejsca) {
  const poAdresie = new Map()
  for (const a of adresy) {
    const klucz = [lokalnosc(a.miejscowosc), ulica(a.ulica), normalizuj(a.nr)].join('|')
    const lista = poAdresie.get(klucz) ?? []
    lista.push(a)
    poAdresie.set(klucz, lista)
  }
  const punkty = new Map()
  let kwalifikowane = 0
  let geokodowane = 0
  for (const m of miejsca) {
    const udogodnienia = [
      m['fl-podjazd'] === '1' && 'podjazd',
      m['st-winda'] === '1' && 'winda dostosowana',
      m['fl-laz-niepel'] === '1' && 'toaleta dostosowana',
    ].filter(Boolean)
    if (!udogodnienia.length) continue
    kwalifikowane++
    const klucz = [
      lokalnosc(m['adr-lok-miejsc']),
      ulica(m['adr-lok-ulica']),
      normalizuj(m['adr-lok-nr-domu']),
    ].join('|')
    const kandydaci = poAdresie.get(klucz) ?? []
    // Kod gminy GSL bywa kodem dawnej dzielnicy Krakowa; nazwa miejscowości i pełny adres są rozstrzygające.
    const dopasowane = kandydaci.filter((a) => lokalnosc(a.gmina) === lokalnosc(m['adr-lok-gmina']))
    const grupa = dopasowane.length ? dopasowane : kandydaci
    let punkt = null
    if (
      grupa.length &&
      grupa.every((a) => dystans(punktyAdresow[a.i], punktyAdresow[grupa[0].i]) < 100)
    ) {
      punkt = punktyAdresow[grupa[0].i]
    } else if (
      Number.isFinite(Number(m['wsp-geog-v'])) &&
      Number.isFinite(Number(m['wsp-geog-h']))
    ) {
      const lon = Number(m['wsp-geog-v'])
      const lat = Number(m['wsp-geog-h'])
      if (lon > 14 && lon < 25 && lat > 49 && lat < 55) punkt = xy(lon, lat)
    }
    if (!punkt) continue
    geokodowane++
    const opis = `${dekodujXml(m['nazwa-swd-skrocona'] || m['nazwa-swd'] || m['nazwa-miejsca'] || 'POZ')}, ${dekodujXml(m['adr-lok-ulica'] || m['adr-lok-miejsc'] || '')} ${m['adr-lok-nr-domu'] || ''} – ${udogodnienia.join(', ')}`
    const id = `${punkt[0].toFixed(0)}|${punkt[1].toFixed(0)}`
    const poprzedni = punkty.get(id)
    if (
      !poprzedni ||
      poprzedni.liczbaUdogodnien < udogodnienia.length ||
      (poprzedni.liczbaUdogodnien === udogodnienia.length && poprzedni.opis.length > opis.length)
    )
      punkty.set(id, { xy: punkt, opis, liczbaUdogodnien: udogodnienia.length })
  }
  if (!punkty.size) throw new Error('Nie udało się ustalić położenia żadnego POZ z udogodnieniami')
  return { punkty: [...punkty.values()], kwalifikowane, geokodowane }
}

const [osm, gslXml] = await Promise.all([pobierzOsm(), pobierzGsl()])
const wezly = osm.elements.filter(
  (e) => e.type === 'node' && Number.isFinite(e.lat) && Number.isFinite(e.lon),
)
const krawezniki = wezly
  .filter((e) => ['lowered', 'flush'].includes(e.tags?.kerb))
  .map((e) => ({ xy: xy(e.lon, e.lat) }))
const lawki = wezly
  .filter((e) => e.tags?.amenity === 'bench')
  .map((e) => ({ xy: xy(e.lon, e.lat) }))
if (!krawezniki.length || !lawki.length)
  throw new Error('Overpass nie zwrócił krawężników lub ławek')
const gslDane = miejscaPoz(gslXml)
const poz = pozZGeokodowaniem(gslDane.miejsca)
const dataNfz = gslDane.data
console.log(
  `OSM: ${krawezniki.length} obniżonych krawężników, ${lawki.length} ławek. NFZ: ${poz.geokodowane}/${poz.kwalifikowane} miejsc POZ z udogodnieniami ma położenie, ${poz.punkty.length} różnych punktów.`,
)

const baza = { kategoria: 'codziennosc', rozdzielczosc: 'adres', zadanie: 46 }
const zrodloOsm = {
  nazwa: osm.zrodlo === OSM ? 'OpenStreetMap przez Overpass API' : 'OpenStreetMap przez Geofabrik',
  url: osm.zrodlo ?? OSM,
  licencja: 'ODbL 1.0: https://www.openstreetmap.org/copyright',
  dataDanych: osm.osm3s.timestamp_osm_base,
  pobrano: dzis(),
}
const zrodloNfz = {
  nazwa: 'NFZ, Gdzie się Leczyć – GSL_PUB, oddział małopolski',
  url: 'https://www.nfz.gov.pl/dla-swiadczeniodawcy/sprawozdawczosc-elektroniczna/interfejsy-integracyjne/gsl--gdzie-sie-leczyc-/',
  licencja:
    'Publiczna usługa NFZ; dokumentacja GSL nie wskazuje odrębnej licencji. Źródło: https://www.nfz.gov.pl/',
  dataDanych: dataNfz,
  pobrano: dzis(),
}
const zrodlaAdresow = JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8')).zrodla

for (const [id, nazwa, punkty] of [
  ['obnizone_krawezniki_300m', 'Obniżone krawężniki w 300 m', krawezniki],
  ['lawki_300m', 'Ławki w 300 m', lawki],
]) {
  const bush = indeks(punkty)
  const wartosci = punktyAdresow.map(([x, y]) => bush.within(x, y, PROMIEN).length)
  zapiszWskaznik(
    {
      ...baza,
      id,
      nazwa,
      opis: `Liczba oznaczonych w OSM ${id.startsWith('lawki') ? 'ławek' : 'punktów krawężnika kerb=lowered|flush'} w promieniu 300 m w linii prostej. Kompletność OSM jest nierówna; zero oznacza brak wpisu w OSM, nie potwierdzenie braku obiektu.`,
      jednostka: 'szt.',
      kierunek: 'wiecej-lepiej',
      zakres: [0, id.startsWith('lawki') ? 40 : 20],
      zrodla: [zrodloOsm],
    },
    wartosci,
  )
}

const pozBush = indeks(poz.punkty)
const odleglosci = []
const etykiety = []
for (const p of punktyAdresow) {
  let najlepszy = null
  let minimum = Infinity
  // Typowa liczba geokodowanych placówek to kilkaset. Siatka KDBush ogranicza kandydatów.
  let promien = 1000
  let ids = []
  while (!ids.length && promien <= 128000) {
    ids = pozBush.within(p[0], p[1], promien)
    promien *= 2
  }
  for (const i of ids) {
    const d = dystans(p, poz.punkty[i].xy)
    if (d < minimum) {
      minimum = d
      najlepszy = poz.punkty[i]
    }
  }
  odleglosci.push(najlepszy ? minimum : null)
  etykiety.push(najlepszy?.opis ?? null)
}
zapiszWskaznik(
  {
    ...baza,
    id: 'przychodnia_bez_barier_odleglosc',
    nazwa: 'Najbliższa przychodnia POZ z udogodnieniami',
    opis: `Odległość w linii prostej do najbliższego miejsca POZ z potwierdzonym podjazdem, windą dostosowaną lub toaletą dostosowaną. Położenie ze współrzędnych NFZ lub dopasowania adresu do MSIP/PRG. Geokodowanie objęło ${poz.geokodowane} z ${poz.kwalifikowane} miejsc z udogodnieniami w oddziale małopolskim; odległość może być zawyżona przy pominiętych placówkach.`,
    jednostka: 'm',
    kierunek: 'mniej-lepiej',
    zakres: [0, 5000],
    zrodla: [zrodloNfz, ...zrodlaAdresow],
  },
  odleglosci,
  etykiety,
)
console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
