// Ustawienia „tryb miasta": ADRESCORE_MIASTO=<slug> przełącza ogólnopolskie warstwy ETL z Krakowa
// na jedno z miast z public/dane/miasta/<slug>/adresy.json. Bez zmiennej MIASTO_INFO === null,
// a skrypty zachowują się jak dotąd (Kraków i obwarzanek, Małopolska).
// Surowe pobrania (PBF województwa, rejestry krajowe, GTFS) leżą w etl/.cache i są wspólne dla miast.
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { CACHE, DANE, MIASTO } from './wspolne.mjs'

/**
 * woj: nazwa województwa (małe litery, jak w rejestrach), teryt2: prefiks TERYT województwa,
 * nfz: kod oddziału wojewódzkiego NFZ (API Terminów Leczenia), pbf: ekstrakt OSM województwa, centrum: cel dla czasu podróży do centrum (rynek / plac główny),
 * gtfs: pliki z etl/.cache/gtfs-miasta (patrz etl/lib/gtfs-miasta.mjs).
 */
export const MIASTA = {
  warszawa: {
    nfz: '07',
    nazwa: 'Warszawa',
    woj: 'mazowieckie',
    teryt2: '14',
    pbf: 'mazowieckie',
    centrum: { nazwa: 'Rynek Starego Miasta w Warszawie', lon: 21.0122, lat: 52.2497 },
  },
  lodz: {
    nfz: '05',
    nazwa: 'Łódź',
    woj: 'łódzkie',
    teryt2: '10',
    pbf: 'lodzkie',
    centrum: { nazwa: 'Plac Wolności w Łodzi', lon: 19.4553, lat: 51.7765 },
  },
  wroclaw: {
    nfz: '01',
    nazwa: 'Wrocław',
    woj: 'dolnośląskie',
    teryt2: '02',
    pbf: 'dolnoslaskie',
    centrum: { nazwa: 'Rynek we Wrocławiu', lon: 17.0322, lat: 51.11 },
  },
  poznan: {
    nfz: '15',
    nazwa: 'Poznań',
    woj: 'wielkopolskie',
    teryt2: '30',
    pbf: 'wielkopolskie',
    centrum: { nazwa: 'Stary Rynek w Poznaniu', lon: 16.9335, lat: 52.4082 },
  },
  gdansk: {
    nfz: '11',
    nazwa: 'Gdańsk',
    woj: 'pomorskie',
    teryt2: '22',
    pbf: 'pomorskie',
    centrum: { nazwa: 'Długi Targ w Gdańsku', lon: 18.6531, lat: 54.3487 },
  },
  szczecin: {
    nfz: '16',
    nazwa: 'Szczecin',
    woj: 'zachodniopomorskie',
    teryt2: '32',
    pbf: 'zachodniopomorskie',
    centrum: { nazwa: 'Plac Żołnierza Polskiego w Szczecinie', lon: 14.5533, lat: 53.429 },
  },
  bydgoszcz: {
    nfz: '02',
    nazwa: 'Bydgoszcz',
    woj: 'kujawsko-pomorskie',
    teryt2: '04',
    pbf: 'kujawsko_pomorskie',
    centrum: { nazwa: 'Stary Rynek w Bydgoszczy', lon: 18.0003, lat: 53.1235 },
  },
  lublin: {
    nfz: '03',
    nazwa: 'Lublin',
    woj: 'lubelskie',
    teryt2: '06',
    pbf: 'lubelskie',
    centrum: { nazwa: 'Rynek w Lublinie', lon: 22.5697, lat: 51.2477 },
  },
  bialystok: {
    nfz: '10',
    nazwa: 'Białystok',
    woj: 'podlaskie',
    teryt2: '20',
    pbf: 'podlaskie',
    centrum: { nazwa: 'Rynek Kościuszki w Białymstoku', lon: 23.1586, lat: 53.1325 },
  },
}

export const MIASTO_INFO = MIASTO ? (MIASTA[MIASTO] ?? null) : null
if (MIASTO && !MIASTO_INFO) throw new Error(`Nieznane miasto ADRESCORE_MIASTO=${MIASTO}`)

/**
 * Czy miejscowość z rejestru należy do miasta: „Łódź", „Łódź-Bałuty", „Łódź-Górna, delegatura".
 * Poza trybem miasta zawsze prawda (rejestry Małopolski bierzemy w całości).
 */
export const wMiescieMiasta = (miejscowosc) =>
  !MIASTO_INFO ||
  (miejscowosc ?? '').split(/[-,]/)[0].trim().toLocaleLowerCase('pl') ===
    MIASTO_INFO.nazwa.toLocaleLowerCase('pl')

/** Prefiks TERYT województwa, dla którego pobieramy rejestry krajowe (Małopolska = 12). */
export const TERYT_WOJ = MIASTO_INFO ? MIASTO_INFO.teryt2 : '12'
/** Nazwa województwa w rejestrach (małe litery). */
export const WOJEWODZTWO = MIASTO_INFO ? MIASTO_INFO.woj : 'małopolskie'
/** Nazwa pliku PBF województwa w etl/.cache (bez rozszerzenia). */
export const REGION_PBF = MIASTO_INFO ? MIASTO_INFO.pbf : 'malopolskie'
/** Sufiks do nazw plików cache zależnych od województwa; pusty dla Małopolski (zachowuje stare nazwy). */
export const SUFIKS_REGIONU = MIASTO_INFO ? `-${MIASTO_INFO.pbf}` : ''

let kolumnyAdresow = null
const kolumny = () => {
  kolumnyAdresow ??= JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8')).kolumny
  return kolumnyAdresow
}

/** TERYT gminy miasta z adresy.json (7 cyfr, z wiodącym zerem, np. „0461011"); null poza trybem miasta. */
export function terytMiasta() {
  return MIASTO_INFO ? String(kolumny().teryt[0]) : null
}

/** Prostokąt adresów miasta z zapasem (ok. 11 km); null poza trybem miasta. */
export function bboxMiasta(zapasLat = 0.1, zapasLon = 0.16) {
  if (!MIASTO_INFO) return null
  const k = kolumny()
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  for (let i = 0; i < k.lat.length; i++) {
    if (k.lat[i] < minLat) minLat = k.lat[i]
    if (k.lat[i] > maxLat) maxLat = k.lat[i]
    if (k.lon[i] < minLon) minLon = k.lon[i]
    if (k.lon[i] > maxLon) maxLon = k.lon[i]
  }
  return {
    minLat: minLat - zapasLat,
    maxLat: maxLat + zapasLat,
    minLon: minLon - zapasLon,
    maxLon: maxLon + zapasLon,
  }
}

const MIRROR = 'https://download.openstreetmap.fr/extracts/europe/poland'
const STRONA_EKSTRAKTU = `${MIRROR}/`

/**
 * Ekstrakt OSM województwa miasta: etl/.cache/<region>.osm.pbf (wspólny dla miast z tego województwa).
 * Geofabrik bywa niedostępny z maszyn zespołu, więc używamy lustra download.openstreetmap.fr
 * (ten sam podział na województwa, ODbL). Stan zapisany obok pliku (.stan), a bez niego data pliku.
 */
export async function pbfRegionu() {
  if (!MIASTO_INFO) throw new Error('pbfRegionu tylko w trybie miasta')
  mkdirSync(CACHE, { recursive: true })
  const plik = join(CACHE, `${REGION_PBF}.osm.pbf`)
  if (!existsSync(plik)) {
    const url = `${MIRROR}/${REGION_PBF}-latest.osm.pbf`
    console.log(`Pobieram ${url} (jednorazowo)…`)
    const odp = await fetch(url, { signal: AbortSignal.timeout(3_600_000) })
    if (!odp.ok || !odp.body) throw new Error(`${url} → HTTP ${odp.status}`)
    const oczekiwane = Number(odp.headers.get('content-length'))
    const tmp = `${plik}.tmp`
    await pipeline(Readable.fromWeb(odp.body), createWriteStream(tmp))
    if (oczekiwane && statSync(tmp).size !== oczekiwane) throw new Error('Ucięty PBF')
    renameSync(tmp, plik)
  }
  let stan
  try {
    stan = readFileSync(`${plik}.stan`, 'utf8').trim()
  } catch {
    stan = statSync(plik).mtime.toISOString().slice(0, 10)
  }
  return { plik, stan, url: STRONA_EKSTRAKTU }
}
