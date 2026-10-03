// Osiadanie terenu (zadanie #117, część opcjonalna): pionowa prędkość przemieszczeń powierzchni
// z interferometrii radarowej Sentinel-1 (European Ground Motion Service, Copernicus, 2016–2020),
// udostępniona przez PIG-PIB jako ImageServer geozagrozenia/egms_2016_2020_pion.
//
// Usługa nie ma metadanych, ale zna `exportImage`: format `bsq` oddaje surowe bajty piksela
// (liczba całkowita ze znakiem, mm/rok) i dopisaną na końcu maskę ważności (1 bit na piksel, od
// najstarszego bitu). Maska odróżnia „zmierzone 0 mm/rok” od „brak punktu pomiarowego”, czego
// `identify` nie robi. Eksportujemy raster dokładnie na siatce źródła (bbox przyciągnięty do
// komórek, rozmiar w pikselach = liczba komórek, interpolacja najbliższego sąsiada), więc każdy
// piksel wyniku to jedna komórka źródła, bez przeliczania wartości.
//
// Wskaźnik: osiadanie_mm_rok – wartość komórki 123 m, w której leży adres (ujemna = osiadanie).
// Komórki bez pomiaru (ok. 2/3 obszaru: pola, lasy, woda) dają null, nie 0. Kategoria „kontekst”:
// fakt na karcie, bez wpływu na wynik.
//
// Uruchom: node etl/osiadanie.mjs   (jedno zapytanie exportImage; potem cache w etl/.cache/osiadanie/)
// Kontrola: SPRAWDZ=1 node etl/osiadanie.mjs – porównuje próbkę adresów z `identify` usługi.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import proj4 from 'proj4'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const USLUGA =
  'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/geozagrozenia/egms_2016_2020_pion/ImageServer'
const EGMS = 'https://egms.land.copernicus.eu'
const KAT = join(CACHE, 'osiadanie')
const MARGINES_KOMOREK = 1

proj4.defs(
  'EPSG:2180',
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs',
)
const DO_PUWG = proj4('EPSG:4326', 'EPSG:2180')

/** Komórka siatki źródła dla punktu w metrach (EPSG:2180); null, gdy poza wyeksportowanym wycinkiem. */
export function indeksKomorki(x, y, siatka) {
  const kol = Math.floor((x - siatka.x0) / siatka.piksel) - siatka.kol0
  const wiersz = Math.floor((siatka.y1 - y) / siatka.piksel) - siatka.wiersz0
  if (kol < 0 || wiersz < 0 || kol >= siatka.w || wiersz >= siatka.h) return null
  return wiersz * siatka.w + kol
}

/**
 * Wycinek siatki źródła pokrywający prostokąt [xmin, ymin, xmax, ymax] w metrach z marginesem
 * w komórkach. `zrodlo` = lewy górny róg rastra (x0, y1) i rozmiar komórki.
 */
export function wycinekSiatki(zrodlo, [xmin, ymin, xmax, ymax], margines = MARGINES_KOMOREK) {
  const { x0, y1, piksel } = zrodlo
  const kol0 = Math.floor((xmin - x0) / piksel) - margines
  const kol1 = Math.floor((xmax - x0) / piksel) + margines
  const wiersz0 = Math.floor((y1 - ymax) / piksel) - margines
  const wiersz1 = Math.floor((y1 - ymin) / piksel) + margines
  return {
    x0,
    y1,
    piksel,
    kol0,
    wiersz0,
    w: kol1 - kol0 + 1,
    h: wiersz1 - wiersz0 + 1,
    // bbox w metrach dla exportImage (xmin, ymin, xmax, ymax)
    bbox: [
      x0 + kol0 * piksel,
      y1 - (wiersz1 + 1) * piksel,
      x0 + (kol1 + 1) * piksel,
      y1 - wiersz0 * piksel,
    ],
  }
}

/**
 * Dekoduje odpowiedź exportImage w formacie bsq: w·h bajtów Int8, potem maska ważności
 * (⌈w·h/8⌉ bajtów, bit 1 = piksel ważny, od najstarszego bitu).
 */
export function dekodujBsq(bufor, w, h) {
  const n = w * h
  const maska = Math.ceil(n / 8)
  if (bufor.length !== n + maska)
    throw new Error(`bsq: ${bufor.length} B, oczekiwano ${n + maska} (${w}×${h} + maska)`)
  const wartosci = new Int8Array(n)
  const wazne = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    wartosci[i] = bufor.readInt8(i)
    wazne[i] = (bufor[n + (i >> 3)] >> (7 - (i & 7))) & 1
  }
  return { wartosci, wazne }
}

async function pobierzJson(url) {
  for (let proba = 1; ; proba++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      if (d.error) throw new Error(JSON.stringify(d.error))
      return d
    } catch (e) {
      if (proba >= 3) throw new Error(`${url.slice(0, 200)} → ${e.message}`)
      await new Promise((ok) => setTimeout(ok, 1500 * proba))
    }
  }
}

/** Raster dla obszaru adresów: z cache albo jeden exportImage. */
async function pobierzRaster(adresyMetry) {
  const plikMeta = join(KAT, 'egms-pion.json')
  const plikBsq = join(KAT, 'egms-pion.bsq')
  if (existsSync(plikMeta) && existsSync(plikBsq)) {
    const meta = JSON.parse(readFileSync(plikMeta, 'utf8'))
    return { ...meta, ...dekodujBsq(readFileSync(plikBsq), meta.siatka.w, meta.siatka.h) }
  }
  mkdirSync(KAT, { recursive: true })
  const opis = await pobierzJson(`${USLUGA}?f=json`)
  const zrodlo = {
    x0: opis.extent.xmin,
    y1: opis.extent.ymax,
    piksel: opis.pixelSizeX,
  }
  if (!(zrodlo.piksel > 50 && zrodlo.piksel < 300) || opis.pixelSizeX !== opis.pixelSizeY)
    throw new Error(`Nieoczekiwana siatka usługi: ${opis.pixelSizeX} × ${opis.pixelSizeY}`)
  if (opis.pixelType !== 'S8' || opis.bandCount !== 1)
    throw new Error(`Nieoczekiwany typ rastra: ${opis.pixelType}, pasm ${opis.bandCount}`)
  let [xmin, ymin, xmax, ymax] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of adresyMetry) {
    if (x < xmin) xmin = x
    if (x > xmax) xmax = x
    if (y < ymin) ymin = y
    if (y > ymax) ymax = y
  }
  const siatka = wycinekSiatki(zrodlo, [xmin, ymin, xmax, ymax])
  const q = new URLSearchParams({
    bbox: siatka.bbox.join(','),
    bboxSR: '2180',
    imageSR: '2180',
    size: `${siatka.w},${siatka.h}`,
    format: 'bsq',
    pixelType: 'S8',
    interpolation: 'RSP_NearestNeighbor',
    f: 'image',
  })
  const r = await fetch(`${USLUGA}/exportImage?${q}`, { signal: AbortSignal.timeout(180_000) })
  if (!r.ok) throw new Error(`exportImage: HTTP ${r.status}`)
  const bufor = Buffer.from(await r.arrayBuffer())
  const dane = dekodujBsq(bufor, siatka.w, siatka.h) // rzuca przy odpowiedzi błędu (JSON zamiast rastra)
  writeFileSync(plikBsq, bufor)
  const meta = { pobrano: dzis(), siatka, pixelType: opis.pixelType }
  writeFileSync(plikMeta, JSON.stringify(meta))
  console.log(`exportImage: ${siatka.w}×${siatka.h} komórek, ${bufor.length} B`)
  return { ...meta, ...dane }
}

async function kontrolaZIdentify({ adresy, wynik }) {
  // Deterministyczna próbka: co n-ty adres z wartością i co n-ty bez.
  const zWartoscia = []
  const bez = []
  adresy.forEach((_, i) => (wynik[i] === null ? bez : zWartoscia).push(i))
  const wybierz = (lista, n) =>
    Array.from(
      { length: Math.min(n, lista.length) },
      (_, j) => lista[Math.floor((j * lista.length) / n)],
    )
  let niezgodne = 0
  const proby = [...wybierz(zWartoscia, 40), ...wybierz(bez, 40)]
  for (const i of proby) {
    const a = adresy[i]
    const q = new URLSearchParams({
      geometry: JSON.stringify({ x: a.lon, y: a.lat, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryPoint',
      returnGeometry: 'false',
      returnCatalogItems: 'false',
      f: 'json',
    })
    const d = await pobierzJson(`${USLUGA}/identify?${q}`)
    const tekst = String(d.value ?? '')
    const serwer = /^-?\d+$/.test(tekst) ? Number(tekst) : null
    // identify nie pokazuje maski: „0” może znaczyć zmierzone zero albo brak pomiaru, więc przy
    // naszym null akceptujemy 0 i brak wartości, a przy naszej wartości wymagamy równości.
    const zgodne = wynik[i] === null ? serwer === null || serwer === 0 : serwer === wynik[i]
    if (!zgodne) {
      niezgodne++
      console.log(
        `  NIEZGODNE: adres ${a.id} (${a.lon}, ${a.lat}) – my: ${wynik[i]}, usługa: ${tekst}`,
      )
    }
  }
  console.log(
    `Kontrola z identify: ${proby.length} adresów (40 z wartością, 40 bez), niezgodnych ${niezgodne}`,
  )
}

async function main() {
  const t0 = performance.now()
  const { adresy } = wczytajAdresy()
  const metry = adresy.map((a) => DO_PUWG.forward([a.lon, a.lat]))
  const raster = await pobierzRaster(metry)
  const wynik = metry.map(([x, y]) => {
    const i = indeksKomorki(x, y, raster.siatka)
    if (i === null) throw new Error(`Adres poza wyeksportowanym wycinkiem rastra: ${x}, ${y}`)
    return raster.wazne[i] ? raster.wartosci[i] : null
  })
  const pobrano = raster.pobrano
  zapiszWskaznik(
    {
      id: 'osiadanie_mm_rok',
      kategoria: 'kontekst',
      nazwa: 'Ruch pionowy terenu (InSAR)',
      opis: 'Pionowa prędkość przemieszczeń powierzchni w komórce 123 m, w której leży adres: mm na rok z interferometrii radarowej Sentinel-1 (European Ground Motion Service, lata 2016–2020). Wartość ujemna = osiadanie, dodatnia = wypiętrzenie, 0 = mniej niż ±0,5 mm/rok; źródło podaje liczby całkowite. Pomiar dotyczy trwałych odbiorników radarowych (głównie budynków i dróg), nie gruntu pod każdym adresem, i nie wskazuje przyczyny ruchu. Komórki bez punktów pomiarowych (pola, lasy, woda) to brak danych. Fakt informacyjny, nie ocena stanu budynku.',
      jednostka: 'mm/rok',
      kierunek: 'neutralny',
      rozdzielczosc: 'siatka',
      rozmiar: '123 m',
      zakres: [-20, 5],
      zadanie: 117,
      zrodla: [
        {
          nazwa:
            'PIG-PIB – usługa obrazowa egms_2016_2020_pion (pionowa składowa ruchu terenu 2016–2020, dane EGMS na siatce 123 m)',
          url: USLUGA,
          licencja:
            'Usługa PIG-PIB nie publikuje metadanych ani własnych warunków; pochodzenie danych (EGMS, 2016–2020, składowa pionowa) wynika z nazwy usługi. Dane EGMS są częścią Copernicus Land Monitoring Service (pełny, otwarty i bezpłatny dostęp, rozporządzenie delegowane UE 1159/2013) – wymagane wskazanie źródła i informacja o zmianach: wartość komórki rastra odczytana w punkcie adresu',
          dataDanych: '2016–2020',
          pobrano,
        },
        {
          nazwa:
            'European Ground Motion Service (EGMS), Copernicus Land Monitoring Service, Europejska Agencja Środowiska (EEA)',
          url: EGMS,
          licencja:
            'Copernicus: pełny, otwarty i bezpłatny dostęp; przy ponownym wykorzystaniu należy podać źródło i zaznaczyć zmiany',
          dataDanych: '2016–2020',
          pobrano,
        },
      ],
    },
    wynik,
  )
  const z = wynik.filter((v) => v !== null)
  const ujemne = z.filter((v) => v <= -5).length
  console.log(
    `Ruch pionowy: ${z.length} adresów z pomiarem (${((100 * z.length) / wynik.length).toFixed(1)}%), ≤ −5 mm/rok: ${ujemne}. Czas: ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  )
  const poGminie = new Map()
  adresy.forEach((a, i) => {
    const e = poGminie.get(a.gmina) ?? { n: 0, z: 0, min: Infinity, ujemne: 0 }
    e.n++
    if (wynik[i] !== null) {
      e.z++
      e.min = Math.min(e.min, wynik[i])
      if (wynik[i] <= -5) e.ujemne++
    }
    poGminie.set(a.gmina, e)
  })
  console.log('gmina | adresów | z pomiarem | min mm/rok | ≤ −5 mm/rok')
  for (const [g, e] of [...poGminie].sort())
    console.log(`${g} | ${e.n} | ${e.z} | ${e.z ? e.min : '-'} | ${e.ujemne}`)
  if (process.env.SPRAWDZ === '1') await kontrolaZIdentify({ adresy, wynik })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
