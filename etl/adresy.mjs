// Import oficjalnych punktów adresowych: EMUiA/MSIP Kraków i PRG gmin ościennych.
// Uruchom: node etl/adresy.mjs (pobrania są przechowywane w etl/.cache).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { latLngToCell } from 'h3-js'
import proj4 from 'proj4'
import { CACHE, DANE, dzis, pobierzDoCache, wersjaAdresow } from './lib/wspolne.mjs'

const MSIP_URL = 'https://msip.um.krakow.pl/Dane/Adresy_JSON.zip'
const PRG_URL = 'https://mapy.geoportal.gov.pl/wss/ext/wfs/KrajowaIntegracjaNumeracjiAdresowej'
const MSIP_CRS =
  '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'
const PRG_CRS =
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs'
const GMINY = new Set([
  'Igołomia-Wawrzeńczyce',
  'Kocmyrzów-Luborzyca',
  'Koniusza',
  'Liszki',
  'Michałowice',
  'Mogilany',
  'Niepołomice',
  'Skawina',
  'Świątniki Górne',
  'Wieliczka',
  'Wielka Wieś',
  'Zabierzów',
  'Zielonki',
])

const zaokraglij = (x) => Math.round(x * 1e6) / 1e6
const tekst = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

function nowyAdres({ id, miejscowosc, ulica, nr, kod, dzielnica, gmina, teryt, lon, lat }) {
  if (
    !id ||
    !miejscowosc ||
    !nr ||
    !gmina ||
    !/^\d{7}$/u.test(teryt) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat)
  ) {
    throw new Error(`Niekompletny adres: ${id}`)
  }
  if (lon < 19 || lon > 21 || lat < 49 || lat > 51) throw new Error(`Poza Małopolską: ${id}`)
  const x = zaokraglij(lon)
  const y = zaokraglij(lat)
  return {
    id,
    miejscowosc,
    ulica,
    nr,
    kod,
    dzielnica,
    gmina,
    teryt,
    lon: x,
    lat: y,
    h3: latLngToCell(y, x, 10),
  }
}

export function zMsip(geojson) {
  if (geojson.crs?.properties?.name !== 'EPSG:2178') throw new Error('Nieznany CRS MSIP')
  if (!Array.isArray(geojson.features) || geojson.features.length < 70000) {
    throw new Error('Niepełna paczka MSIP')
  }
  return geojson.features.map((f) => {
    const p = f.properties
    const [lon, lat] = proj4(MSIP_CRS, 'EPSG:4326', f.geometry.coordinates)
    const dzielnica = tekst(p.nazwa_dzielnicy)?.replace(/^Dzielnica\s+/u, '') ?? null
    // kod_teryt w MSIP to 5-cyfrowy kod ulicy ULIC, nie TERYT gminy.
    return nowyAdres({
      id: `msip-${p.id}`,
      miejscowosc: p.miejscowosc,
      ulica: tekst(p.nazwa_ulicy),
      nr: String(p.numer_adresowy),
      kod: tekst(p.kod_pocztowy),
      dzielnica,
      gmina: 'Kraków',
      teryt: '1261011',
      lon,
      lat,
    })
  })
}

export function zPrg(wiersze) {
  if (!Array.isArray(wiersze)) throw new Error('PRG: brak rekordów')
  return wiersze
    .filter((p) => GMINY.has(p.gmina))
    .map((p) => {
      const [lon, lat] = proj4(PRG_CRS, 'EPSG:4326', [p.x, p.y])
      return nowyAdres({
        id: `prg-${p.id}`,
        miejscowosc: p.miejscowosc,
        ulica: tekst(p.ulica),
        nr: p.nr,
        kod: tekst(p.kod),
        dzielnica: null,
        gmina: p.gmina,
        teryt: p.teryt,
        lon,
        lat,
      })
    })
}

export function zloz(msip, prg, pobrano = dzis(), dataMsip = pobrano, dataPrg = pobrano) {
  if (msip.length < 70000) throw new Error(`MSIP: zbyt mało punktów: ${msip.length}`)
  const gminy = new Map()
  for (const a of prg) {
    const poprzedni = gminy.get(a.gmina)
    if (poprzedni && poprzedni !== a.teryt) throw new Error(`Niespójny TERYT: ${a.gmina}`)
    gminy.set(a.gmina, a.teryt)
  }
  for (const g of GMINY) if (!gminy.has(g)) throw new Error(`Brak punktów PRG: ${g}`)
  const adresy = [...msip, ...prg].sort((a, b) => a.id.localeCompare(b.id))
  const ids = new Set(adresy.map((a) => a.id))
  if (ids.size !== adresy.length) throw new Error('Duplikaty ID adresów')
  const klucze = [
    'id',
    'miejscowosc',
    'ulica',
    'nr',
    'kod',
    'dzielnica',
    'gmina',
    'teryt',
    'lon',
    'lat',
    'h3',
  ]
  const kolumny = Object.fromEntries(klucze.map((k) => [k, adresy.map((a) => a[k])]))
  return {
    wersja: wersjaAdresow(kolumny),
    zrodla: [
      {
        nazwa: 'Gmina Miejska Kraków, Portal MSIP Obserwatorium — punkty adresowe EMUiA',
        url: 'https://msip.krakow.pl/dataset/1492',
        licencja: 'Regulamin MSIP: https://msip.krakow.pl/getHtml?dok_id=228972',
        dataDanych: dataMsip,
        pobrano,
      },
      {
        nazwa: 'GUGiK, Państwowy Rejestr Granic — punkty adresowe (stan usługi w dniu pobrania)',
        url: PRG_URL,
        licencja:
          'Bezpłatne do dowolnego wykorzystania: https://www.geoportal.gov.pl/pl/dane/panstwowy-rejestr-granic-prg/',
        dataDanych: dataPrg,
        pobrano: dataPrg,
      },
    ],
    kolumny,
  }
}

async function main() {
  const msipZip = await pobierzDoCache(MSIP_URL, 'msip-adresy.zip')
  const archiwum = unzipSync(readFileSync(msipZip))
  const geojson = JSON.parse(new TextDecoder().decode(archiwum['Adresy.geojson']))
  const dataMsip =
    new TextDecoder().decode(archiwum['__Aktualnosc__.txt']).match(/\d{4}-\d{2}-\d{2}/u)?.[0] ??
    dzis()
  const msip = zMsip(geojson)
  const prgCache = join(CACHE, 'prg-obwarzanek.json')
  if (!existsSync(prgCache)) {
    execFileSync('python3', [join(CACHE, '..', 'prg-wfs.py')], { stdio: 'inherit' })
  }
  const plikPrg = JSON.parse(readFileSync(prgCache, 'utf8'))
  const prg = zPrg(plikPrg.wiersze)
  const wynik = zloz(msip, prg, dzis(), dataMsip, plikPrg.pobrano)
  writeFileSync(join(DANE, 'adresy.json'), JSON.stringify(wynik))
  console.log(
    `Adresy: MSIP ${msip.length}, PRG ${prg.length}, razem ${wynik.kolumny.id.length}; wersja ${wynik.wersja}`,
  )
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
