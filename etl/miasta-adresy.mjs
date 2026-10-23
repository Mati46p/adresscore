// Składa public/dane/miasta/<slug>/adresy.json (format PlikAdresow) z pobrania etl/prg-miasta.py.
// Uruchom: node etl/miasta-adresy.mjs [slug ...]. Kraków pomijamy – ma własny import (adresy.mjs).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { latLngToCell } from 'h3-js'
import proj4 from 'proj4'
import { CACHE, KORZEN, wersjaAdresow } from './lib/wspolne.mjs'

const PRG_URL = 'https://mapy.geoportal.gov.pl/wss/ext/wfs/KrajowaIntegracjaNumeracjiAdresowej'
const PRG_CRS =
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs'
export const MIASTA = {
  warszawa: ['1465011', 'Warszawa'],
  lodz: ['1061011', 'Łódź'],
  wroclaw: ['0264011', 'Wrocław'],
  poznan: ['3064011', 'Poznań'],
  gdansk: ['2261011', 'Gdańsk'],
  szczecin: ['3262011', 'Szczecin'],
  bydgoszcz: ['0461011', 'Bydgoszcz'],
  lublin: ['0663011', 'Lublin'],
  bialystok: ['2061011', 'Białystok'],
  katowice: ['2469011', 'Katowice'],
  gdynia: ['2262011', 'Gdynia'],
  czestochowa: ['2464011', 'Częstochowa'],
  rzeszow: ['1863011', 'Rzeszów'],
  torun: ['0463011', 'Toruń'],
  radom: ['1463011', 'Radom'],
  sosnowiec: ['2475011', 'Sosnowiec'],
  kielce: ['2661011', 'Kielce'],
  gliwice: ['2466011', 'Gliwice'],
  olsztyn: ['2862011', 'Olsztyn'],
  bielskobiala: ['2461011', 'Bielsko-Biała'],
  zabrze: ['2478011', 'Zabrze'],
  bytom: ['2462011', 'Bytom'],
  zielonagora: ['0862011', 'Zielona Góra'],
  rybnik: ['2473011', 'Rybnik'],
  rudaslaska: ['2472011', 'Ruda Śląska'],
  opole: ['1661011', 'Opole'],
  tychy: ['2477011', 'Tychy'],
  gorzowwielkopolski: ['0861011', 'Gorzów Wielkopolski'],
  dabrowagornicza: ['2465011', 'Dąbrowa Górnicza'],
  redziny: ['2404152', 'Rędziny'],
}
const tekst = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const zaokr = (x) => Math.round(x * 1e6) / 1e6

export function zloz(plik) {
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
  const adresy = []
  for (const p of plik.wiersze) {
    const [lon, lat] = proj4(PRG_CRS, 'EPSG:4326', [p.x, p.y])
    if (!p.nr || !p.miejscowosc || !Number.isFinite(lon) || !Number.isFinite(lat)) continue
    adresy.push({
      id: `prg-${p.id}`,
      miejscowosc: p.miejscowosc,
      ulica: tekst(p.ulica),
      nr: p.nr,
      kod: tekst(p.kod),
      dzielnica: null,
      gmina: p.gmina,
      teryt: p.teryt,
      lon: zaokr(lon),
      lat: zaokr(lat),
      h3: latLngToCell(zaokr(lat), zaokr(lon), 10),
    })
  }
  adresy.sort((a, b) => a.id.localeCompare(b.id))
  if (new Set(adresy.map((a) => a.id)).size !== adresy.length) throw new Error('Duplikaty ID')
  const kolumny = Object.fromEntries(klucze.map((k) => [k, adresy.map((a) => a[k])]))
  return {
    wersja: wersjaAdresow(kolumny),
    zrodla: [
      {
        nazwa: 'GUGiK, Państwowy Rejestr Granic — punkty adresowe (stan usługi w dniu pobrania)',
        url: PRG_URL,
        licencja:
          'Bezpłatne do dowolnego wykorzystania: https://www.geoportal.gov.pl/pl/dane/panstwowy-rejestr-granic-prg/',
        dataDanych: plik.pobrano,
        pobrano: plik.pobrano,
      },
    ],
    kolumny,
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const wybrane = process.argv.slice(2)
  for (const [slug, [teryt]] of Object.entries(MIASTA)) {
    if (wybrane.length && !wybrane.includes(slug)) continue
    const plik = JSON.parse(readFileSync(join(CACHE, 'prg-miasta', `${teryt}.json`), 'utf8'))
    const wynik = zloz(plik)
    const katalog = join(KORZEN, 'public', 'dane', 'miasta', slug)
    mkdirSync(katalog, { recursive: true })
    writeFileSync(join(katalog, 'adresy.json'), JSON.stringify(wynik))
    console.log(`${slug}: ${wynik.kolumny.id.length} adresów, wersja ${wynik.wersja}`)
  }
}
