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
  katowice: {
    nfz: '12',
    nazwa: 'Katowice',
    woj: 'śląskie',
    teryt2: '24',
    pbf: 'slaskie',
    centrum: { nazwa: 'Rynek w Katowicach', lon: 19.0222, lat: 50.2597 },
  },
  gdynia: {
    nfz: '11',
    nazwa: 'Gdynia',
    woj: 'pomorskie',
    teryt2: '22',
    pbf: 'pomorskie',
    centrum: { nazwa: 'Skwer Kościuszki w Gdyni', lon: 18.5427, lat: 54.5192 },
  },
  czestochowa: {
    nfz: '12',
    nazwa: 'Częstochowa',
    woj: 'śląskie',
    teryt2: '24',
    pbf: 'slaskie',
    centrum: { nazwa: 'Plac Biegańskiego w Częstochowie', lon: 19.1143, lat: 50.8119 },
  },
  rzeszow: {
    nfz: '09',
    nazwa: 'Rzeszów',
    woj: 'podkarpackie',
    teryt2: '18',
    pbf: 'podkarpackie',
    centrum: { nazwa: 'Rynek w Rzeszowie', lon: 22.005, lat: 50.0375 },
  },
  torun: {
    nfz: '02',
    nazwa: 'Toruń',
    woj: 'kujawsko-pomorskie',
    teryt2: '04',
    pbf: 'kujawsko_pomorskie',
    centrum: { nazwa: 'Rynek Staromiejski w Toruniu', lon: 18.6037, lat: 53.0105 },
  },
  radom: {
    nfz: '07',
    nazwa: 'Radom',
    woj: 'mazowieckie',
    teryt2: '14',
    pbf: 'mazowieckie',
    centrum: { nazwa: 'Rynek w Radomiu', lon: 21.1433, lat: 51.4028 },
  },
  sosnowiec: {
    nfz: '12',
    nazwa: 'Sosnowiec',
    woj: 'śląskie',
    teryt2: '24',
    pbf: 'slaskie',
    centrum: { nazwa: 'Plac Stulecia w Sosnowcu', lon: 19.1274, lat: 50.278 },
  },
  kielce: {
    nfz: '13',
    nazwa: 'Kielce',
    woj: 'świętokrzyskie',
    teryt2: '26',
    pbf: 'swietokrzyskie',
    centrum: { nazwa: 'Rynek w Kielcach', lon: 20.6321, lat: 50.8716 },
  },
  gliwice: {
    nfz: '12',
    nazwa: 'Gliwice',
    woj: 'śląskie',
    teryt2: '24',
    pbf: 'slaskie',
    centrum: { nazwa: 'Rynek w Gliwicach', lon: 18.6661, lat: 50.294 },
  },
  olsztyn: {
    nfz: '14',
    nazwa: 'Olsztyn',
    woj: 'warmińsko-mazurskie',
    teryt2: '28',
    pbf: 'warminsko_mazurskie',
    centrum: { nazwa: 'Wysoka Brama w Olsztynie', lon: 20.4776, lat: 53.7776 },
  },
  bielskobiala: {
    nfz: '12',
    nazwa: 'Bielsko-Biała',
    woj: 'śląskie',
    teryt2: '24',
    pbf: 'slaskie',
    centrum: { nazwa: 'Plac Ratuszowy w Bielsku-Białej', lon: 19.051, lat: 49.822 },
  },
  zabrze: {
    nfz: '12',
    nazwa: 'Zabrze',
    woj: 'śląskie',
    teryt2: '24',
    pbf: 'slaskie',
    centrum: { nazwa: 'Plac Wolności w Zabrzu', lon: 18.7854, lat: 50.307 },
  },
  bytom: {
    nfz: '12',
    nazwa: 'Bytom',
    woj: 'śląskie',
    teryt2: '24',
    pbf: 'slaskie',
    centrum: { nazwa: 'Rynek w Bytomiu', lon: 18.9234, lat: 50.347 },
  },
  zielonagora: {
    nfz: '04',
    nazwa: 'Zielona Góra',
    woj: 'lubuskie',
    teryt2: '08',
    pbf: 'lubuskie',
    centrum: { nazwa: 'Stary Rynek w Zielonej Górze', lon: 15.5055, lat: 51.9383 },
  },
  rybnik: {
    nfz: '12',
    nazwa: 'Rybnik',
    woj: 'śląskie',
    teryt2: '24',
    pbf: 'slaskie',
    centrum: { nazwa: 'Rynek w Rybniku', lon: 18.542, lat: 50.0955 },
  },
  rudaslaska: {
    nfz: '12',
    nazwa: 'Ruda Śląska',
    woj: 'śląskie',
    teryt2: '24',
    pbf: 'slaskie',
    centrum: { nazwa: 'Plac Jana Pawła II w Rudzie Śląskiej', lon: 18.8745, lat: 50.2857 },
  },
  opole: {
    nfz: '08',
    nazwa: 'Opole',
    woj: 'opolskie',
    teryt2: '16',
    pbf: 'opolskie',
    centrum: { nazwa: 'Rynek w Opolu', lon: 17.9227, lat: 50.6682 },
  },
  tychy: {
    nfz: '12',
    nazwa: 'Tychy',
    woj: 'śląskie',
    teryt2: '24',
    pbf: 'slaskie',
    centrum: { nazwa: 'Rynek w Tychach', lon: 18.9817, lat: 50.1299 },
  },
  gorzowwielkopolski: {
    nfz: '04',
    nazwa: 'Gorzów Wielkopolski',
    woj: 'lubuskie',
    teryt2: '08',
    pbf: 'lubuskie',
    centrum: { nazwa: 'Stary Rynek w Gorzowie Wielkopolskim', lon: 15.2401, lat: 52.7312 },
  },
  dabrowagornicza: {
    nfz: '12',
    nazwa: 'Dąbrowa Górnicza',
    woj: 'śląskie',
    teryt2: '24',
    pbf: 'slaskie',
    centrum: { nazwa: 'Plac Wolności w Dąbrowie Górniczej', lon: 19.1883, lat: 50.3255 },
  },
}

export const MIASTO_INFO = MIASTO ? (MIASTA[MIASTO] ?? null) : null
if (MIASTO && !MIASTO_INFO) throw new Error(`Nieznane miasto ADRESCORE_MIASTO=${MIASTO}`)

/**
 * Czy miejscowość z rejestru należy do miasta: „Łódź", „Łódź-Bałuty", „Łódź-Górna, delegatura".
 * Poza trybem miasta zawsze prawda (rejestry Małopolski bierzemy w całości).
 */
// Cała nazwa albo człon przed „-" / „," (dzielnica: „Kraków-Nowa Huta"). Samo dzielenie po „-" gubiło
// miasta z myślnikiem w nazwie: „Bielsko-Biała" dawało „bielsko" i rejestry zwracały 0 wpisów (#236).
export const wMiescieMiasta = (miejscowosc) => {
  if (!MIASTO_INFO) return true
  const m = (miejscowosc ?? '').trim().toLocaleLowerCase('pl')
  const nazwa = MIASTO_INFO.nazwa.toLocaleLowerCase('pl')
  return m === nazwa || m.split(/[-,]/)[0].trim() === nazwa
}

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
