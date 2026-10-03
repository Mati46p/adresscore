// Agregacja adresów do H3 r10. Ludność z NSP 2021 dzielimy równomiernie
// między adresy w tym samym oczku siatki 1 km, aby nie liczyć jej wielokrotnie.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cellToLatLng } from 'h3-js'
import proj4 from 'proj4'

const BAZA = fileURLToPath(new URL('../public/dane/', import.meta.url))
const adresy = JSON.parse(readFileSync(join(BAZA, 'adresy.json'), 'utf8'))
const ludnosc = JSON.parse(readFileSync(join(BAZA, 'wskazniki/ludnosc_1km.json'), 'utf8'))
const kursy = JSON.parse(readFileSync(join(BAZA, 'wskazniki/kursy_szczyt_h.json'), 'utf8'))
if (ludnosc.wersjaAdresow !== adresy.wersja || kursy.wersjaAdresow !== adresy.wersja)
  throw new Error('Niezgodna wersja adresów')

proj4.defs(
  'EPSG:3035',
  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +datum=WGS84 +units=m +no_defs',
)
const k = adresy.kolumny
const oczka = k.lon.map((lon, i) => {
  const [x, y] = proj4('WGS84', 'EPSG:3035', [lon, k.lat[i]])
  return Math.floor(x / 1000) + ':' + Math.floor(y / 1000)
})
const liczbaAdresow = new Map()
for (const id of oczka) liczbaAdresow.set(id, (liczbaAdresow.get(id) ?? 0) + 1)

const heksy = new Map()
for (let i = 0; i < k.id.length; i++) {
  const h3 = k.h3[i]
  let cell = heksy.get(h3)
  if (!cell) {
    const [lat, lon] = cellToLatLng(h3)
    cell = { h3, lon, lat, adresy: 0, ludnosc: 0, kursy: 0, liczbaKursow: 0 }
    heksy.set(h3, cell)
  }
  cell.adresy++
  const pop = ludnosc.wartosci[i]
  if (Number.isFinite(pop)) cell.ludnosc += pop / liczbaAdresow.get(oczka[i])
  const kurs = kursy.wartosci[i]
  if (Number.isFinite(kurs)) {
    cell.kursy += kurs
    cell.liczbaKursow++
  }
}

const out = {
  wersjaAdresow: adresy.wersja,
  zrodla: [...adresy.zrodla, ...ludnosc.meta.zrodla, ...kursy.meta.zrodla],
  // [h3, lon, lat, adresy, przypisana_ludnosc_NSP, srednie_kursy_w_szczycie]
  komorki: [...heksy.values()].map((c) => [
    c.h3,
    Math.round(c.lon * 1e6) / 1e6,
    Math.round(c.lat * 1e6) / 1e6,
    c.adresy,
    Math.round(c.ludnosc * 100) / 100,
    c.liczbaKursow ? Math.round((c.kursy / c.liczbaKursow) * 100) / 100 : 0,
  ]),
}
const folder = join(BAZA, 'biznes')
mkdirSync(folder, { recursive: true })
writeFileSync(join(folder, 'popyt.json'), JSON.stringify(out))
console.log('Popyt: ' + out.komorki.length + ' heksów, ' + k.id.length + ' adresów')
