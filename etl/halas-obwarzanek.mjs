// Hałas poza Krakowem (zadanie #114): najwyższe pasmo Lden z map strategicznych dyrektywy END
// 2002/49/WE, runda 4 (rok referencyjny 2021), udostępnionych przez Europejską Agencję
// Środowiska (EEA). Uruchom po aktualizacji adresów: node etl/halas-obwarzanek.mjs
//
// Dlaczego osobny wskaźnik: halas_ldwn to mapa akustyczna samego Krakowa (MSIP 2022), obwarzanek
// nie miał żadnej wartości. Kraków zostaje tu null – tam obowiązuje halas_ldwn, a mieszanie
// dwóch map o różnych pasmach i progach w jednej kolumnie ukryłoby, skąd jest liczba.
//
// Dlaczego eksport rastra, a nie GPKG ani getSamples: wektorowy PL.gpkg waży 9,3 GB. Operacja
// getSamples na ImageServerze działa tylko na gęstych rastrach (drogi, koleje), a na rzadkich
// (przemysł, lotniska) zwraca błąd „Invalid or missing input parameters” dla punktów bez bloku
// danych. exportImage z surowymi klasami (PNG 8-bitowy, 0 = NoData) działa na wszystkich
// czterech warstwach i potrzebuje kilku żądań zamiast setek. Bbox kafla jest wyrównany do siatki
// rastra (kotwica = lewy dolny róg pozycji PL), więc piksel eksportu to dokładnie piksel źródła.
// Odczyt sprawdzono względem getSamples dla dróg i kolei: zgodność na wszystkich 106 467
// adresach poza Krakowem.
//
// Brak konturu to null, nigdy 0: mapy END obejmują drogi z ruchem powyżej 3 mln pojazdów rocznie,
// linie kolejowe powyżej 30 tys. pociągów, lotniska powyżej 50 tys. operacji i aglomeracje
// (Kraków), pasma zaczynają się od 55 dB. Adres poza konturem może być cichy albo stać przy
// lokalnej ulicy, której mapa nie obejmuje – danych na to nie ma.
//
// Surowe kafle PNG trafiają do etl/.cache/halas-eea/<wersja adresów>/. Odświeżenie danych EEA:
// usuń ten katalog.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import proj4 from 'proj4'
import { dekodujPngSzary } from './lib/png.mjs'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const BAZA_EEA = 'https://noise.discomap.eea.europa.eu/arcgis/rest/services/noiseStoryMap'
export const KATALOG_EEA =
  'https://sdi.eea.europa.eu/catalogue/srv/api/records/853e72e4-4642-47d1-8556-2cc231bd43e0'
export const TERYT_KRAKOWA = '1261011'
/** Bok piksela rastra EEA w metrach (EPSG:3035). */
export const KROK = 10
/** Wierszy na jedno żądanie exportImage; serwis przyjmuje do 4100 wierszy i 15000 kolumn. */
export const WYS_KAFLA = 2000
const MAX_SZER = 15000

// ETRS89 / LAEA Europe. towgs84 zerowe: różnica WGS84–ETRS89 (do ~1 m) mieści się w pikselu 10 m.
proj4.defs(
  'EPSG:3035',
  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)

/** Cztery źródła hałasu z map END; przemysł i lotniska poza aglomeracją zwykle nic nie dają. */
export const ZRODLA = [
  { rodzaj: 'drogowy', warstwa: 'NoiseContours_road_lden' },
  { rodzaj: 'kolejowy', warstwa: 'NoiseContours_rail_lden' },
  { rodzaj: 'przemysłowy', warstwa: 'NoiseContours_ind_lden' },
  { rodzaj: 'lotniczy', warstwa: 'NoiseContours_air_lden' },
]

// Kody rastra EEA 1–5 = 55–60, 60–65, 65–70, 70–75, >75 dB Lden (legenda usługi, klasyfikacja
// ClassifiedLden; zgodność z pasmami MSIP sprawdzona na 10 tys. adresów Krakowa). Liczba to
// reprezentant pasma dla silnika wyniku, nie pomiar. Pasmo >75 jest otwarte: bierzemy 77,5 jak
// pasmo 75–80 w halas_ldwn, bo to ono dominuje: wśród adresów z klasą 5, które mapa GDDKiA
// pokazuje w paśmie od 75 dB, 92% leży w 75–79,9 dB, a 8% w 80 dB i więcej (średnia MSIP
// dla klasy 5 w Krakowie: 77,0 dB).
export const PASMA = [
  null,
  { wartosc: 57.5, etykieta: '55–59,9 dB Lden (pasmo mapy EEA)' },
  { wartosc: 62.5, etykieta: '60–64,9 dB Lden (pasmo mapy EEA)' },
  { wartosc: 67.5, etykieta: '65–69,9 dB Lden (pasmo mapy EEA)' },
  { wartosc: 72.5, etykieta: '70–74,9 dB Lden (pasmo mapy EEA)' },
  { wartosc: 77.5, etykieta: 'powyżej 75 dB Lden (pasmo mapy EEA)' },
]

/** Kod rastra → pasmo albo null (brak konturu, kod spoza 1–5). */
export function pasmoEea(kod) {
  return Number.isInteger(kod) && kod >= 1 && kod <= 5 ? PASMA[kod] : null
}

/** „a”, „a i b”, „a, b i c”. */
export function wymien(rodzaje) {
  return rodzaje.length < 2
    ? (rodzaje[0] ?? '')
    : `${rodzaje.slice(0, -1).join(', ')} i ${rodzaje[rodzaje.length - 1]}`
}

/**
 * Najwyższe pasmo spośród źródeł. trafienia: [{ rodzaj, kod }], kod null albo 0 = brak konturu.
 * Przy remisie etykieta wymienia wszystkie źródła z tym pasmem.
 */
export function najwyzszePasmoEea(trafienia) {
  let najwyzszy = 0
  for (const t of trafienia) if (pasmoEea(t.kod) && t.kod > najwyzszy) najwyzszy = t.kod
  if (!najwyzszy) return null
  const rodzaje = trafienia.filter((t) => t.kod === najwyzszy).map((t) => t.rodzaj)
  const pasmo = PASMA[najwyzszy]
  return {
    kod: najwyzszy,
    wartosc: pasmo.wartosc,
    etykieta: `${pasmo.etykieta}; hałas ${wymien(rodzaje)}`,
    rodzaje,
  }
}

/** WGS84 (lon, lat) → EPSG:3035 (x, y) w metrach, zaokrąglone do 1 cm. */
export function doEpsg3035(lon, lat) {
  return proj4('EPSG:4326', 'EPSG:3035', [lon, lat]).map((v) => Math.round(v * 100) / 100)
}

/**
 * Dzieli zasięg punktów na kafle exportImage, wyrównane do siatki rastra (kotwica {x, y} =
 * lewy dolny róg siatki) z marginesem jednego piksela. Kafel: { x0, y0, x1, y1, szer, wys },
 * y1 to górna krawędź. Wiersz 0 kafla leży przy y1.
 */
export function kafle(punkty, kotwica, wysKafla = WYS_KAFLA) {
  if (!punkty.length) throw new Error('Brak punktów do odczytu')
  if (!Number.isInteger(wysKafla) || wysKafla < 1) throw new Error('Wysokość kafla: liczba ≥ 1')
  let xmin = Number.POSITIVE_INFINITY
  let ymin = Number.POSITIVE_INFINITY
  let xmax = Number.NEGATIVE_INFINITY
  let ymax = Number.NEGATIVE_INFINITY
  for (const [x, y] of punkty) {
    xmin = Math.min(xmin, x)
    xmax = Math.max(xmax, x)
    ymin = Math.min(ymin, y)
    ymax = Math.max(ymax, y)
  }
  const xa = kotwica.x + (Math.floor((xmin - kotwica.x) / KROK) - 1) * KROK
  const xb = kotwica.x + (Math.floor((xmax - kotwica.x) / KROK) + 2) * KROK
  const ya = kotwica.y + (Math.floor((ymin - kotwica.y) / KROK) - 1) * KROK
  const yb = kotwica.y + (Math.floor((ymax - kotwica.y) / KROK) + 2) * KROK
  const szer = Math.round((xb - xa) / KROK)
  const wysCalk = Math.round((yb - ya) / KROK)
  if (szer > MAX_SZER) throw new Error(`Zasięg adresów szerszy niż ${MAX_SZER} pikseli (${szer})`)
  const wynik = []
  for (let od = 0; od < wysCalk; od += wysKafla) {
    const wys = Math.min(wysKafla, wysCalk - od)
    const y1 = yb - od * KROK
    wynik.push({ x0: xa, y0: y1 - wys * KROK, x1: xb, y1, szer, wys })
  }
  return wynik
}

/** Kod z piksela kafla zawierającego punkt (0 = NoData); null, gdy punkt leży poza kaflem. */
export function kodWPikselu(kafel, dane, x, y) {
  const kolumna = Math.floor((x - kafel.x0) / KROK)
  const wiersz = Math.floor((kafel.y1 - y) / KROK)
  if (kolumna < 0 || kolumna >= kafel.szer || wiersz < 0 || wiersz >= kafel.wys) return null
  return dane[wiersz * kafel.szer + kolumna]
}

/** Map(indeks punktu → kod 1–5) dla punktów w konturze; punkty poza kaflami to błąd. */
export function odczytajKlasy(punkty, kaflePunktow, rastry) {
  const wynik = new Map()
  punkty.forEach(([x, y], n) => {
    for (let t = 0; t < kaflePunktow.length; t++) {
      const kod = kodWPikselu(kaflePunktow[t], rastry[t], x, y)
      if (kod === null) continue
      if (kod > 0) wynik.set(n, kod)
      return
    }
    throw new Error(`Punkt ${n} (${x}, ${y}) poza kaflami`)
  })
  return wynik
}

/** Dane rastra mają zawierać wyłącznie 0 (NoData) i klasy 1–5; inna wartość to zły eksport. */
export function sprawdzKlasy(dane) {
  let zDanymi = 0
  for (const v of dane) {
    if (v > 5) throw new Error(`Wartość rastra spoza 0–5: ${v}`)
    if (v > 0) zDanymi++
  }
  return zDanymi
}

const czekaj = (ms) => new Promise((r) => setTimeout(r, ms))

async function zapytaj(url, odczyt) {
  for (let proba = 1; ; proba++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await odczyt(r)
    } catch (e) {
      if (proba >= 4) throw new Error(`${url.split('?')[0]}: ${e.message}`)
      await czekaj(1000 * 2 ** (proba - 1))
    }
  }
}

async function json(r) {
  const j = await r.json()
  if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error))
  return j
}

async function png(r) {
  if (!r.headers.get('content-type')?.includes('image/png'))
    throw new Error(`Odpowiedź nie jest PNG: ${(await r.text()).slice(0, 200)}`)
  return Buffer.from(await r.arrayBuffer())
}

/** Pozycja PL w mozaice ImageServera: OBJECTID i kotwica siatki (lewy dolny róg zasięgu). */
async function pozycjaPl(warstwa) {
  const p = new URLSearchParams({
    where: "Name LIKE 'PL%'",
    outFields: 'OBJECTID,Name',
    returnGeometry: 'true',
    outSR: '3035',
    f: 'json',
  })
  const { features } = await zapytaj(`${BAZA_EEA}/${warstwa}/ImageServer/query?${p}`, json)
  if (features?.length !== 1 || !/^PL_/.test(features[0].attributes.Name))
    throw new Error(`${warstwa}: oczekiwano jednej pozycji PL w katalogu mozaiki`)
  const pierscien = features[0].geometry?.rings?.[0]
  if (!pierscien?.length) throw new Error(`${warstwa}: pozycja PL bez obrysu`)
  return {
    id: features[0].attributes.OBJECTID,
    kotwica: {
      x: Math.min(...pierscien.map((w) => w[0])),
      y: Math.min(...pierscien.map((w) => w[1])),
    },
  }
}

function adresKafla(warstwa, pozycja, kafel) {
  const p = new URLSearchParams({
    bbox: [kafel.x0, kafel.y0, kafel.x1, kafel.y1].map((v) => v.toFixed(4)).join(','),
    bboxSR: '3035',
    imageSR: '3035',
    size: `${kafel.szer},${kafel.wys}`,
    format: 'png',
    pixelType: 'U8',
    noData: '0',
    // surowe klasy zamiast kolorów; mozaika zablokowana na pozycji PL (żadnego kraju obok)
    renderingRule: JSON.stringify({ rasterFunction: 'None' }),
    mosaicRule: JSON.stringify({
      mosaicMethod: 'esriMosaicLockRaster',
      lockRasterIds: [pozycja.id],
      ascending: true,
      mosaicOperation: 'MT_FIRST',
    }),
    interpolation: 'RSP_NearestNeighbor',
    f: 'image',
  })
  return `${BAZA_EEA}/${warstwa}/ImageServer/exportImage?${p}`
}

/** Kody rastra jednej warstwy dla punktów: { klasy: Map(indeks → kod), pikseli z danymi }. */
async function odczytajWarstwe(zrodlo, punkty, wersja) {
  const pozycja = await pozycjaPl(zrodlo.warstwa)
  const kaflePunktow = kafle(punkty, pozycja.kotwica)
  const katalog = join(CACHE, 'halas-eea', wersja)
  mkdirSync(katalog, { recursive: true })
  const rastry = []
  let pikseli = 0
  for (const [n, kafel] of kaflePunktow.entries()) {
    const plik = join(katalog, `${zrodlo.warstwa}_${kafel.szer}x${kafel.wys}_${n}.png`)
    if (!existsSync(plik)) {
      const bajty = await zapytaj(adresKafla(zrodlo.warstwa, pozycja, kafel), png)
      const tymczasowy = `${plik}.tmp`
      writeFileSync(tymczasowy, bajty)
      renameSync(tymczasowy, plik)
    }
    const obraz = dekodujPngSzary(readFileSync(plik))
    if (obraz.szer !== kafel.szer || obraz.wys !== kafel.wys)
      throw new Error(`${zrodlo.warstwa}: kafel ${n} ma ${obraz.szer}×${obraz.wys} px`)
    pikseli += sprawdzKlasy(obraz.dane)
    rastry.push(obraz.dane)
  }
  return { klasy: odczytajKlasy(punkty, kaflePunktow, rastry), pikseli }
}

/**
 * Składa kolumny wskaźnika. probki: tablica Map (po jednej na źródło, w kolejności ZRODLA),
 * klucz = adres.i, wartość = kod rastra. Kraków i adresy bez konturu dostają null.
 */
export function zlozWskaznik(adresy, probki) {
  const wartosci = []
  const etykiety = []
  const rozklad = [0, 0, 0, 0, 0, 0]
  for (const a of adresy) {
    const pasmo =
      a.teryt === TERYT_KRAKOWA
        ? null
        : najwyzszePasmoEea(
            ZRODLA.map((z, n) => ({ rodzaj: z.rodzaj, kod: probki[n]?.get(a.i) ?? null })),
          )
    wartosci.push(pasmo ? pasmo.wartosc : null)
    etykiety.push(pasmo ? pasmo.etykieta : null)
    if (pasmo) rozklad[pasmo.kod]++
  }
  return { wartosci, etykiety, rozklad }
}

async function main() {
  const { wersja, adresy } = wczytajAdresy()
  const poza = adresy.filter((a) => a.teryt !== TERYT_KRAKOWA)
  if (!poza.length) throw new Error('Brak adresów poza Krakowem')
  if (!poza.every((a) => Number.isFinite(a.lon) && Number.isFinite(a.lat)))
    throw new Error('Adres bez współrzędnych')
  const punkty = poza.map((a) => doEpsg3035(a.lon, a.lat))
  console.log(`Adresy poza Krakowem: ${poza.length} z ${adresy.length}`)

  const wyniki = await Promise.all(ZRODLA.map((z) => odczytajWarstwe(z, punkty, wersja)))
  ZRODLA.forEach((z, n) => {
    const rozklad = [0, 0, 0, 0, 0, 0]
    for (const kod of wyniki[n].klasy.values()) rozklad[kod]++
    console.log(
      `hałas ${z.rodzaj}: ${wyniki[n].pikseli} pikseli z danymi w zasięgu adresów, ${wyniki[n].klasy.size} adresów w konturze (klasy 1–5: ${rozklad.slice(1).join(', ')})`,
    )
  })
  // Kontrola, że odczyt cokolwiek zmierzył: przy drogach głównych wokół Krakowa to tysiące adresów.
  if (wyniki[0].klasy.size < 1000)
    throw new Error('Odczyt hałasu drogowego prawie pusty – sprawdź parametry exportImage')

  const probki = wyniki.map(({ klasy }) => new Map([...klasy].map(([n, kod]) => [poza[n].i, kod])))
  const { wartosci, etykiety, rozklad } = zlozWskaznik(adresy, probki)
  console.log(`Najwyższe pasmo na adres (klasy 1–5): ${rozklad.slice(1).join(', ')}`)
  const gminy = new Map()
  for (const a of poza) {
    const g = gminy.get(a.gmina) ?? { razem: 0, zWartoscia: 0 }
    g.razem++
    if (wartosci[a.i] !== null) g.zWartoscia++
    gminy.set(a.gmina, g)
  }
  for (const [nazwa, g] of [...gminy].sort((a, b) => b[1].razem - a[1].razem))
    console.log(
      `  ${nazwa}: ${g.zWartoscia}/${g.razem} (${((100 * g.zWartoscia) / g.razem).toFixed(1)}%)`,
    )

  // Zdanie o źródłach liczone z danych, żeby opis nie zestarzał się po odświeżeniu EEA.
  const uzyte = ZRODLA.filter((_, n) => probki[n].size > 0).map((z) => z.rodzaj)
  const puste = ZRODLA.filter((_, n) => probki[n].size === 0).map((z) => z.rodzaj)
  const zdanieZrodel = `Źródła wartości w tym zbiorze: hałas ${wymien(uzyte)}.${puste.length ? ` Hałas ${wymien(puste)} nie ma konturów przy tych adresach.` : ''}`

  const pobrano = dzis()
  const licencja = `EEA, zbiór „Noise contours reported under END 2022”: dane do celów badawczych i niekomercyjnych, bez konturów oznaczonych przez kraj jako ograniczone; wymagane wskazanie źródła © European Environment Agency; warunki: ${KATALOG_EEA}`
  zapiszWskaznik(
    {
      id: 'halas_obwarzanek_lden',
      kategoria: 'spokoj',
      nazwa: 'Najwyższe pasmo hałasu poza Krakowem (Lden)',
      opis: `Najwyższe pasmo hałasu Lden (dzień–wieczór–noc) z map strategicznych dyrektywy END, runda 4 (rok referencyjny 2021), zebranych przez Europejską Agencję Środowiska: drogi, koleje, przemysł i lotniska. Dotyczy adresów poza Krakowem; w Krakowie obowiązuje warstwa halas_ldwn z mapy MSIP. Lden to ten sam wskaźnik co polskie LDWN, ale mapy END obejmują tylko drogi z ruchem powyżej 3 mln pojazdów rocznie, linie kolejowe powyżej 30 tys. pociągów, duże lotniska i aglomeracje, a pasma zaczynają się od 55 dB (w halas_ldwn od 50 dB). Brak liczby nie oznacza ciszy: adres leży poza konturem mapy albo przy lokalnej ulicy, której mapa nie obejmuje. Wartość liczbowa to środek pasma 5 dB (pasmo powyżej 75 dB ma 77,5 dB jak pasmo 75–80 w halas_ldwn), nie pomiar w punkcie. Odczyt z rastra 10 m w punkcie adresu, wysokość oceny zwykle 4 m nad terenem. ${zdanieZrodel}`,
      jednostka: 'dB',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'rejon',
      rozmiar: 'pasmo mapy akustycznej EEA (raster 10 m)',
      zakres: [50, 80],
      zadanie: 114,
      zrodla: [
        {
          nazwa:
            'Europejska Agencja Środowiska (EEA) – mapy hałasu END 2022, runda 4 (usługi ImageServer NoiseContours road, rail, ind, air Lden)',
          url: BAZA_EEA,
          licencja,
          dataDanych: '2021 (rok referencyjny mapowania END, runda 4)',
          pobrano,
        },
        {
          nazwa:
            'EEA – opis zbioru „Noise contours reported under END 2022” (metadane, warunki użycia)',
          url: KATALOG_EEA,
          licencja,
          dataDanych: '2021 (rok referencyjny mapowania END, runda 4)',
          pobrano,
        },
      ],
    },
    wartosci,
    etykiety,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
