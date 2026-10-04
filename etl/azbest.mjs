// Budynki z azbestem w promieniu 100 m od adresu, według Bazy Azbestowej (Ministerstwo Rozwoju
// i Technologii). Źródło: usługa WFS https://esip.bazaazbestowa.gov.pl/geoserver/wfs/ows, warstwa
// `budynki_z_azbestem` (obrysy budynków, w których pozostały do unieszkodliwienia wyroby z azbestem),
// GML w EPSG:2180 (JSON serwer odrzuca). Baza powstaje z inwentaryzacji gmin i zgłoszeń właścicieli:
// 0 = brak wpisu w bazie, nie brak azbestu. Gmina, która nie ma w bazie żadnego obrysu budynku
// (ani z azbestem, ani oczyszczonego), nie raportuje – jej adresy dostają null, nie 0.
// Uruchom: node etl/azbest.mjs. Surowe pobrania: etl/.cache/ryzyka/.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { do2180, LicznikWielokatow, pierscien, wielokat } from './lib/geo.mjs'
import { dataPobrania, plikCache, pobierzTrwale } from './lib/pobieranie.mjs'
import { wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const WFS = 'https://esip.bazaazbestowa.gov.pl/geoserver/wfs/ows'
const WARSTWA = 'budynki_z_azbestem'
/** Warstwy obrysów budynków: samo istnienie wpisu w którejś oznacza, że gmina raportuje budynki. */
const WARSTWY_OBRYSOW = [WARSTWA, 'budynki_oczyszczone']
const ZBIOR = 'https://dane.gov.pl/pl/dataset/662,baza-azbestowa'
const PROMIEN_M = 100
const MARGINES_M = 500
/**
 * Miasta podzielone na kilka jednostek ewidencyjnych liczymy jako jedną gminę: Kraków (126101–126104),
 * Warszawa (146501–146518, adresy mają TERYT miasta 1465011) i Łódź (106101–106105).
 */
const MIASTA_WIELOJEDNOSTKOWE = ['1261', '1465', '1061']

/** Kolejność osi w GML: urn:ogc:def:crs:EPSG::2180 podaje północ, wschód; „EPSG:2180” wschód, północ. */
export function kolejnoscOsi(srsName) {
  return /^urn:|^http:\/\/www\.opengis\.net\/def\/crs\//i.test(srsName ?? '') ? 'NE' : 'EN'
}

function pierscienZPosList(tekst, osie) {
  const liczby = tekst.trim().split(/\s+/).map(Number)
  if (liczby.length < 8 || liczby.length % 2 || liczby.some((n) => !Number.isFinite(n)))
    throw new Error(`Zła lista współrzędnych GML (${liczby.length} liczb)`)
  const punkty = []
  for (let i = 0; i < liczby.length; i += 2)
    punkty.push(osie === 'NE' ? [liczby[i + 1], liczby[i]] : [liczby[i], liczby[i + 1]])
  return pierscien(punkty)
}

/**
 * Obiekty z odpowiedzi WFS (GML 3.2): numer działki i wielokąt w EPSG:2180 (x = wschód, y = północ).
 * Obsługuje pierścień zewnętrzny i otwory; inna geometria niż Polygon to błąd, nie pominięcie.
 */
export function parsujGml(xml) {
  const obiekty = []
  for (const blok of xml.split('<wfs:member>').slice(1)) {
    const id = /gml:id="([^"]+)"/.exec(blok)?.[1] ?? null
    const nrDzialki = /<\w+:nr_dzialki>([^<]*)<\/\w+:nr_dzialki>/.exec(blok)?.[1] ?? null
    const poligony = [...blok.matchAll(/<gml:Polygon\b([^>]*)>([\s\S]*?)<\/gml:Polygon>/g)]
    if (!poligony.length) throw new Error(`Obiekt ${id}: brak gml:Polygon (inny typ geometrii?)`)
    for (const p of poligony) {
      const osie = kolejnoscOsi(/srsName="([^"]+)"/.exec(p[1])?.[1])
      const pierscienie = [...p[2].matchAll(/<gml:posList[^>]*>([^<]*)<\/gml:posList>/g)].map((m) =>
        pierscienZPosList(m[1], osie),
      )
      if (!pierscienie.length) throw new Error(`Obiekt ${id}: wielokąt bez pierścienia`)
      obiekty.push({ id, nrDzialki, wielokat: wielokat(pierscienie) })
    }
  }
  return obiekty
}

/** Klucz gminy z numeru działki ewidencyjnej („120805_5.0028.404” → „120805”); Kraków ma 4 jednostki. */
export function kluczGminyDzialki(nrDzialki) {
  const teryt = /^(\d{6})_/.exec(nrDzialki ?? '')?.[1]
  return teryt ? kluczGminy(teryt) : null
}

/** Klucz gminy z 6 pierwszych cyfr TERYT: wszystkie jednostki ewidencyjne Krakowa (1261xx) = „1261”. */
export function kluczGminy(teryt) {
  const szesc = String(teryt).slice(0, 6)
  return MIASTA_WIELOJEDNOSTKOWE.find((m) => szesc.startsWith(m)) ?? szesc
}

/** Wartość dla adresu: liczba obrysów w promieniu albo null, gdy gmina adresu nie raportuje. */
export function liczbaBudynkow(licznik, x, y, gminaRaportuje) {
  return gminaRaportuje ? licznik.policz(x, y, PROMIEN_M) : null
}

function adresWfs(parametry) {
  const q = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    outputFormat: 'gml32',
    ...parametry,
  })
  return `${WFS}?${q}`
}

/** Liczba wpisów w warstwie dla gminy (prefiks nr_dzialki) – zapytanie „hits”, bez pobierania geometrii. */
async function liczbaWpisow(warstwa, prefiks) {
  const url = adresWfs({
    typeNames: `wfs:${warstwa}`,
    resultType: 'hits',
    cql_filter: `nr_dzialki LIKE '${prefiks}%'`,
  })
  const plik = await pobierzTrwale(url, plikCache(`azbest_hits_${warstwa}_${prefiks}.xml`))
  const n = /numberMatched="(\d+)"/.exec(readFileSync(plik, 'utf8'))?.[1]
  if (n === undefined)
    throw new Error(`Baza Azbestowa: brak numberMatched dla ${warstwa} ${prefiks}`)
  return Number(n)
}

async function main() {
  const { adresy } = wczytajAdresy()
  const punkty = adresy.map((a) => do2180(a.lon, a.lat))
  const zakres = (os) =>
    punkty.reduce((z, p) => [Math.min(z[0], p[os]), Math.max(z[1], p[os])], [Infinity, -Infinity])
  const [xMin, xMax] = zakres(0)
  const [yMin, yMax] = zakres(1)
  const x0 = Math.floor(xMin - MARGINES_M)
  const x1 = Math.ceil(xMax + MARGINES_M)
  const y0 = Math.floor(yMin - MARGINES_M)
  const y1 = Math.ceil(yMax + MARGINES_M)
  console.log(`bbox EPSG:2180 (E, N): ${x0}, ${y0}, ${x1}, ${y1}`)

  const bbox = `${x0},${y0},${x1},${y1},EPSG:2180`
  const urlLiczby = adresWfs({ typeNames: `wfs:${WARSTWA}`, resultType: 'hits', bbox })
  const plikLiczby = await pobierzTrwale(urlLiczby, plikCache(`azbest_hits_bbox_${x0}_${y0}.xml`))
  const zgloszone = Number(/numberMatched="(\d+)"/.exec(readFileSync(plikLiczby, 'utf8'))?.[1])
  const plikGml = await pobierzTrwale(
    adresWfs({ typeNames: `wfs:${WARSTWA}`, bbox }),
    plikCache(`azbest_budynki_${x0}_${y0}.gml`),
    { limitMs: 300_000 },
  )
  const xml = readFileSync(plikGml, 'utf8')
  const dataDanych = /timeStamp="(\d{4}-\d{2}-\d{2})/.exec(xml)?.[1] ?? dataPobrania(plikGml)
  const obiekty = parsujGml(xml)
  if (obiekty.length !== zgloszone)
    throw new Error(`Pobrano ${obiekty.length} obrysów, usługa zgłasza ${zgloszone}`)
  // Zamienione osie dałyby obrysy poza zapytanym obszarem – to wykrywa błąd kolejności współrzędnych.
  const poza = obiekty.filter(
    ({ wielokat: w }) =>
      w.bbox[0] < x0 - 1000 ||
      w.bbox[2] > x1 + 1000 ||
      w.bbox[1] < y0 - 1000 ||
      w.bbox[3] > y1 + 1000,
  )
  if (poza.length)
    throw new Error(`${poza.length} obrysów leży poza zapytanym obszarem (osie GML?)`)
  console.log(
    `Baza Azbestowa (${dataDanych}): ${obiekty.length} obrysów budynków z azbestem w obszarze`,
  )

  // Które gminy raportują: choć jeden obrys budynku (z azbestem albo oczyszczony) w całej bazie.
  const klucze = [...new Set(adresy.map((a) => kluczGminy(a.teryt)))].sort()
  const raportuje = new Map()
  for (const klucz of klucze) {
    let razem = 0
    for (const warstwa of WARSTWY_OBRYSOW) razem += await liczbaWpisow(warstwa, klucz)
    raportuje.set(klucz, razem)
  }
  console.log(
    `Wpisy obrysów w bazie wg gminy: ${[...raportuje].map(([k, n]) => `${k}=${n}`).join(' ')}`,
  )

  const licznik = new LicznikWielokatow(obiekty.map((o) => o.wielokat))
  const start = performance.now()
  const wartosci = adresy.map((a, i) => {
    const [x, y] = punkty[i]
    return liczbaBudynkow(licznik, x, y, (raportuje.get(kluczGminy(a.teryt)) ?? 0) > 0)
  })
  console.log(`Policzono w ${((performance.now() - start) / 1000).toFixed(1)} s`)
  const znane = wartosci.filter((v) => v !== null)
  const maks = znane.reduce((m, v) => Math.max(m, v), 0)
  const zero = znane.filter((v) => v === 0).length
  console.log(
    `Adresów z wynikiem ${znane.length}, null ${wartosci.length - znane.length}, bez obrysu w ${PROMIEN_M} m: ${zero}, maks. ${maks}`,
  )

  zapiszWskaznik(
    {
      id: 'azbest_budynki_100m',
      kategoria: 'bezpieczenstwo',
      nazwa: 'Budynki z azbestem w 100 m',
      opis: `Liczba budynków z wyrobami zawierającymi azbest, pozostałymi do unieszkodliwienia, w odległości do ${PROMIEN_M} m od punktu adresu (liczymy obrys, w którym leży adres) według Bazy Azbestowej. Baza powstaje z inwentaryzacji gmin i zgłoszeń właścicieli: 0 oznacza brak wpisu w bazie, a nie brak azbestu, i w części gmin obrysy budynków są przypisane tylko do części wpisów (reszta wpisów dotyczy całych działek). Gmina bez żadnego obrysu budynku w bazie nie raportuje, więc jej adresy nie mają wyniku.`,
      jednostka: 'szt.',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 5],
      zadanie: 116,
      zrodla: [
        {
          nazwa:
            'Ministerstwo Rozwoju i Technologii – Baza Azbestowa, usługa WFS, warstwa budynki_z_azbestem (obrysy budynków)',
          url: WFS,
          licencja: `CC BY 4.0 (dane.gov.pl, zbiór 662: ${ZBIOR})`,
          dataDanych,
          pobrano: dataPobrania(plikGml),
        },
      ],
    },
    wartosci,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
