// Strategiczna mapa hałasu Krakowa 2022: najwyższe pasmo LDWN spośród dróg,
// torów i przemysłu. Uruchom po aktualizacji adresów: node etl/halas.mjs.
// Przez HTTP Range pobiera drogi i tory z ZIP; przemysł bezpośrednio z REST.
import { spawn } from 'node:child_process'
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { DuckDBInstance } from '@duckdb/node-api'
import proj4 from 'proj4'
import { pasmoLdwn } from './halas-pasma.mjs'
import { katalogZip, wypakujZdalnie } from './halas-zip.mjs'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const URL = 'https://msip.um.krakow.pl/Dane/Mapa_Halasu_2022_JSON.zip'
// ZIP przemysłu ma 649 pustych geometrii; REST publikuje 286 pasm >=55 dB z geometrią.
const REST_PRZEM =
  'https://msip.um.krakow.pl/arcgis/rest/services/Mapa_halasu_2022/8_2_MH_2022_IMISJA_5/MapServer/8/query'
const WARSTWY = [
  {
    id: 'drogi',
    nazwa: 'drogowy',
    sciezka: 'Mapa_imisyjna_2022_JSON/halas_2022_imisja_dr_LDWN.geojson',
  },
  {
    id: 'tory',
    nazwa: 'szynowy',
    sciezka: 'Mapa_imisyjna_2022_JSON/halas_2022_imisja_szyn_LDWN.geojson',
  },
  {
    id: 'przemysl',
    nazwa: 'przemysłowy',
    sciezka: 'Mapa_imisyjna_2022_JSON/halas_2022_imisja_przem_LDWN.geojson',
  },
]

proj4.defs(
  'EPSG:2178',
  '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs',
)

function cytuj(s) {
  return `'${s.replaceAll("'", "''")}'`
}

async function pobierzPrzemysl(cel) {
  const baza = {
    where: 'ISOV1>=55',
    outFields: 'ISOV1,ISOV2',
    returnGeometry: 'true',
    outSR: '2178',
    geometryPrecision: '2',
    maxAllowableOffset: '1',
    orderByFields: 'OBJECTID ASC',
  }
  const url = (parametry) => `${REST_PRZEM}?${new URLSearchParams(parametry)}`
  const policz = await fetch(url({ where: baza.where, returnCountOnly: 'true', f: 'json' }))
  if (!policz.ok) throw new Error(`Liczba pasm przemysłowych: HTTP ${policz.status}`)
  const { count } = await policz.json()
  if (!Number.isInteger(count) || count < 200)
    throw new Error('Nieoczekiwana liczba pasm przemysłowych')
  const cechy = []
  let crs = null
  for (let offset = 0; offset < count; offset += 50) {
    const odpowiedz = await fetch(
      url({ ...baza, resultOffset: String(offset), resultRecordCount: '50', f: 'geojson' }),
    )
    if (!odpowiedz.ok) throw new Error(`Pasmo przemysłowe od ${offset}: HTTP ${odpowiedz.status}`)
    const strona = await odpowiedz.json()
    if (
      !Array.isArray(strona.features) ||
      strona.features.length !== Math.min(50, count - offset)
    ) {
      throw new Error(`Niepełna strona przemysłu od ${offset}`)
    }
    if (!strona.features.every((f) => f.geometry && Number.isFinite(f.properties?.ISOV1))) {
      throw new Error(`Brak geometrii lub pasma przemysłu od ${offset}`)
    }
    crs ??= strona.crs
    cechy.push(...strona.features)
  }
  writeFileSync(cel, JSON.stringify({ type: 'FeatureCollection', crs, features: cechy }))
}

async function wypakuj(archiwum, katalog, warstwa) {
  const cel = join(CACHE, `halas_2022_${warstwa.id}_LDWN.geojson`)
  if (existsSync(cel) && statSync(cel).size > 1_000) return cel
  const tymczasowy = `${cel}.tmp`
  try {
    if (warstwa.id === 'przemysl') {
      await pobierzPrzemysl(tymczasowy)
    } else if (archiwum) {
      const proces = spawn('unzip', ['-p', archiwum, warstwa.sciezka], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const zakonczono = new Promise((resolve, reject) => {
        proces.once('error', reject)
        proces.once('close', resolve)
      })
      let stderr = ''
      proces.stderr.setEncoding('utf8')
      proces.stderr.on('data', (dane) => {
        stderr += dane
      })
      await pipeline(proces.stdout, createWriteStream(tymczasowy))
      const kod = await zakonczono
      if (kod !== 0) throw new Error(`unzip ${warstwa.id}: ${stderr || `exit ${kod}`}`)
    } else {
      const wpis = katalog.get(warstwa.sciezka)
      if (!wpis) throw new Error(`Brak warstwy w ZIP: ${warstwa.sciezka}`)
      await wypakujZdalnie(URL, wpis, tymczasowy)
    }
    const fd = openSync(tymczasowy, 'r')
    const poczatek = Buffer.alloc(256)
    readSync(fd, poczatek, 0, poczatek.length, 0)
    closeSync(fd)
    if (!poczatek.toString('utf8').includes('EPSG:2178')) {
      throw new Error(`Nieoczekiwany format albo układ współrzędnych: ${warstwa.id}`)
    }
    renameSync(tymczasowy, cel)
  } catch (blad) {
    if (existsSync(tymczasowy)) unlinkSync(tymczasowy)
    throw blad
  }
  return cel
}

async function main() {
  const { adresy } = wczytajAdresy()
  if (!adresy.length) throw new Error('Brak adresów')
  mkdirSync(CACHE, { recursive: true })
  const archiwum = process.argv[2] ?? null
  const katalog = archiwum ? null : await katalogZip(URL)
  const csv = join(CACHE, 'halas_adresy_2178.csv')
  const wiersze = ['i,x,y']
  for (const adres of adresy) {
    if (adres.gmina !== 'Kraków' || !Number.isFinite(adres.lon) || !Number.isFinite(adres.lat))
      continue
    const [x, y] = proj4('EPSG:4326', 'EPSG:2178', [adres.lon, adres.lat])
    wiersze.push(`${adres.i},${x},${y}`)
  }
  writeFileSync(csv, `${wiersze.join('\n')}\n`)

  const instancja = await DuckDBInstance.create(':memory:', {
    temp_directory: join(CACHE, 'duckdb_halas_tmp'),
    memory_limit: '4GB',
  })
  const polaczenie = await instancja.connect()
  try {
    await polaczenie.run('INSTALL spatial; LOAD spatial')
    await polaczenie.run(
      `CREATE TABLE adresy AS SELECT i::INTEGER AS i, ST_Point(x, y) AS geom FROM read_csv_auto(${cytuj(csv)})`,
    )
    const wyniki = WARSTWY.map(() => Array(adresy.length).fill(null))
    for (let n = 0; n < WARSTWY.length; n++) {
      const warstwa = WARSTWY[n]
      const plik = await wypakuj(archiwum, katalog, warstwa)
      console.log(`Dopasowuję ${warstwa.nazwa} LDWN…`)
      const sql = `
        SELECT a.i, max(p.isov1) AS isov1, arg_max(p.isov2, p.isov1) AS isov2
        FROM adresy a
        JOIN ST_Read(${cytuj(plik)}) p ON ST_Intersects(p.geom, a.geom)
        GROUP BY a.i
      `
      const czytnik = await polaczenie.runAndReadAll(sql)
      for (const rekord of czytnik.getRowObjectsJS()) {
        const pasmo = pasmoLdwn(Number(rekord.isov1), Number(rekord.isov2))
        if (pasmo) wyniki[n][Number(rekord.i)] = pasmo
      }
      console.log(`${warstwa.nazwa}: ${wyniki[n].filter(Boolean).length}/${adresy.length} adresów`)
    }

    const wartosci = []
    const etykiety = []
    for (const adres of adresy) {
      const trafienia = WARSTWY.map((warstwa, n) => ({ warstwa, pasmo: wyniki[n][adres.i] }))
        .filter((trafienie) => trafienie.pasmo)
        .sort((a, b) => b.pasmo.wartosc - a.pasmo.wartosc)
      if (!trafienia.length) {
        wartosci.push(null)
        etykiety.push(null)
        continue
      }
      const { warstwa, pasmo } = trafienia[0]
      wartosci.push(pasmo.wartosc)
      etykiety.push(`${pasmo.etykieta}; hałas ${warstwa.nazwa}; 4 m nad terenem`)
    }

    zapiszWskaznik(
      {
        id: 'halas_ldwn',
        kategoria: 'spokoj',
        nazwa: 'Najwyższe pasmo hałasu (LDWN)',
        opis: 'Najwyższe opublikowane pasmo LDWN spośród hałasu drogowego, szynowego i przemysłowego; nie opisuje całego hałasu Krakowa. Mapa imisyjna 2022, 4 m nad terenem. Wartość liczbowa reprezentuje pasmo dla punktacji, nie dokładny pomiar ani sumę hałasu. Na granicy pasm wybieramy wyższe. Brak liczby może oznaczać poziom poniżej prezentowanego zakresu albo brak pokrycia mapą. Geometrię przemysłu pobrano z tolerancją 1 m.',
        jednostka: 'dB',
        kierunek: 'mniej-lepiej',
        rozdzielczosc: 'rejon',
        rozmiar: 'wielokąt pasma mapy akustycznej',
        zakres: [50, 80],
        zadanie: 4,
        zrodla: [
          {
            nazwa: 'Gmina Miejska Kraków, MSIP — Mapa hałasu 2022 (drogi, tory)',
            url: 'https://msip.krakow.pl/dataset/1361',
            licencja: 'Regulamin MSIP: https://msip.krakow.pl/getPdf?dok_id=288055',
            dataDanych: '2022',
            pobrano: dzis(),
          },
          {
            nazwa: 'Gmina Miejska Kraków, MSIP — hałas przemysłowy LDWN 2022',
            url: 'https://msip.um.krakow.pl/arcgis/rest/services/Mapa_halasu_2022/8_2_MH_2022_IMISJA_5/MapServer/8',
            licencja: 'Regulamin MSIP: https://msip.krakow.pl/getPdf?dok_id=288055',
            dataDanych: '2022',
            pobrano: dzis(),
          },
        ],
      },
      wartosci,
      etykiety,
    )
  } finally {
    polaczenie.closeSync()
    instancja.closeSync()
  }
}

await main()
