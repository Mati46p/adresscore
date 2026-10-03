// Strategiczna mapa hałasu Krakowa 2022: najwyższe pasmo LDWN spośród dróg,
// torów i przemysłu. Uruchom po aktualizacji adresów: node etl/halas.mjs.
// Przez HTTP Range pobiera tylko trzy potrzebne pliki z archiwum ~614 MB.
import { spawn } from 'node:child_process'
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
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
// ZIP gubi ISOV1/ISOV2 dla przemysłu; REST ma atrybuty (geometrii nie pobieramy drugi raz).
const URL_PRZEM_ATRYBUTY =
  'https://msip.um.krakow.pl/arcgis/rest/services/Mapa_halasu_2022/8_2_MH_2022_IMISJA_5/MapServer/8/query?where=1%3D1&outFields=ISOV1%2CISOV2%2CShape_Area%2CShape_Length&returnGeometry=false&f=json'
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

async function wypakuj(archiwum, katalog, warstwa) {
  const cel = join(CACHE, `halas_2022_${warstwa.id}_LDWN.geojson`)
  if (existsSync(cel) && statSync(cel).size > 1_000) return cel
  const tymczasowy = `${cel}.tmp`
  try {
    if (warstwa.id === 'przemysl') {
      const wpis = (katalog ?? (await katalogZip(URL))).get(warstwa.sciezka)
      if (!wpis) throw new Error('Brak warstwy przemysłowej w ZIP')
      const surowy = `${tymczasowy}.raw`
      await wypakujZdalnie(URL, wpis, surowy)
      try {
        const dane = JSON.parse(readFileSync(surowy, 'utf8'))
        const odpowiedz = await fetch(URL_PRZEM_ATRYBUTY)
        if (!odpowiedz.ok) throw new Error(`Atrybuty przemysłowe: HTTP ${odpowiedz.status}`)
        const atrybuty = await odpowiedz.json()
        if (atrybuty.exceededTransferLimit || atrybuty.features?.length !== dane.features?.length) {
          throw new Error('Niepełne atrybuty przemysłowe MSIP REST')
        }
        const klucz = (pole, obwod) => `${Number(pole).toFixed(2)}|${Number(obwod).toFixed(2)}`
        const indeks = new Map(
          atrybuty.features.map(({ attributes: a }) => [
            klucz(a.Shape_Area, a.Shape_Length),
            { isov1: a.ISOV1, isov2: a.ISOV2 },
          ]),
        )
        if (indeks.size !== dane.features.length) throw new Error('Niejednoznaczny klucz geometrii')
        for (const obiekt of dane.features) {
          const p = obiekt.properties
          const pasmo = indeks.get(klucz(p['st_area(shape)'], p['st_length(shape)']))
          if (!pasmo) throw new Error('Brak atrybutów dla wielokąta przemysłowego')
          obiekt.properties = pasmo
        }
        writeFileSync(tymczasowy, JSON.stringify(dane))
      } finally {
        if (existsSync(surowy)) unlinkSync(surowy)
      }
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
        opis: 'Najwyższe pasmo LDWN spośród hałasu drogowego, szynowego i przemysłowego. Mapa imisyjna 2022, 4 m nad terenem. Wartość liczbowa jest reprezentantem pasma dla punktacji, nie dokładnym pomiarem ani sumą hałasu. Brak pasma oznacza brak danych.',
        jednostka: 'dB',
        kierunek: 'mniej-lepiej',
        rozdzielczosc: 'adres',
        zakres: [50, 80],
        zadanie: 4,
        zrodla: [
          {
            nazwa: 'Gmina Miejska Kraków, Portal MSIP Obserwatorium — Mapa hałasu 2022',
            url: 'https://msip.krakow.pl/dataset/1361',
            licencja: 'Ponowne wykorzystanie zgodnie z regulaminem MSIP',
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
