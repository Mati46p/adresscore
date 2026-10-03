// Źródło: MSIP Kraków, Warstwa_BO (ArcGIS REST), regulamin MSIP: https://msip.krakow.pl/zalacznik/317495.
// Liczy unikalne zrealizowane projekty BO do 1 km od adresu; w etykiecie podaje projekty w realizacji.
// Uruchom: node etl/bo.mjs. Pobrane dane zapisuje w etl/.cache/bo-raw.json.
import { readFileSync, statSync } from 'node:fs'
import { pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ZRODLO = 'https://msip.um.krakow.pl/arcgis/rest/services/Obserwatorium/Warstwa_BO/MapServer/0'
const url = `${ZRODLO}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`
const plik = await pobierzDoCache(url, 'bo-raw.json')
const dane = JSON.parse(readFileSync(plik, 'utf8'))
if (
  dane.type !== 'FeatureCollection' ||
  !Array.isArray(dane.features) ||
  dane.exceededTransferLimit
)
  throw new Error('MSIP BO: niekompletny lub niepoprawny zbiór')

const POLE = 'Stan_realizacji_na_31_marca_2024_r_'
function status(tekst) {
  const s = String(tekst ?? '').toLowerCase()
  // Najpierw wyklucz opis prac częściowych: często zawiera też słowo „zrealizowane”.
  if (/w trakcie|planowan|do realizacji|nie zrealiz|opracowywan|pozostał|pozostal/.test(s))
    return 'w_realizacji'
  if (
    /^zrealizowane$|^zadanie zrealizowane|^zrealizowano zadanie|^wykonano|^zakończono roboty|^zadanie wykonane|projekt w całości został zrealizowany/.test(
      s,
    )
  )
    return 'zrealizowane'
  return null
}

// Oczka 0,01°; dla promienia 1 km przeglądamy ±2 oczka i mierzymy dokładną odległość.
const klucz = (x, y) => `${x},${y}`
const siatka = new Map()
let bezGeometrii = 0
let niejasnyStatus = 0
for (const f of dane.features) {
  const [lon, lat] = f.geometry?.coordinates ?? []
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    bezGeometrii++
    continue
  }
  const s = status(f.properties?.[POLE])
  if (!s) {
    niejasnyStatus++
    continue
  }
  const id = f.properties?.BP_SNAME || f.properties?.LINK
  if (!id) continue
  const k = klucz(Math.floor(lon * 100), Math.floor(lat * 100))
  if (!siatka.has(k)) siatka.set(k, [])
  siatka.get(k).push({ lon, lat, id, status: s })
}

function odleglosc(a, p) {
  const rad = Math.PI / 180
  const dLat = (p.lat - a.lat) * rad
  const dLon = (p.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(p.lat * rad) * Math.sin(dLon / 2) ** 2
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

const { adresy } = wczytajAdresy()
const wartosci = []
const etykiety = []
for (const a of adresy) {
  if (a.gmina !== 'Kraków') {
    wartosci.push(null)
    etykiety.push(null)
    continue
  }
  const gotowe = new Set()
  const wToku = new Set()
  const x = Math.floor(a.lon * 100),
    y = Math.floor(a.lat * 100)
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++)
      for (const p of siatka.get(klucz(x + dx, y + dy)) ?? []) {
        if (odleglosc(a, p) > 1000) continue
        if (p.status === 'zrealizowane') gotowe.add(p.id)
        else wToku.add(p.id)
      }
  for (const id of gotowe) wToku.delete(id)
  wartosci.push(gotowe.size)
  etykiety.push(`${gotowe.size} zrealizowanych, ${wToku.size} w realizacji`)
}

const pobrano = statSync(plik).mtime.toISOString().slice(0, 10)
zapiszWskaznik(
  {
    id: 'bo_projekty_1km',
    kategoria: 'przyszlosc',
    nazwa: 'Zrealizowane projekty BO do 1 km',
    opis: 'Liczba różnych projektów budżetu obywatelskiego Krakowa z potwierdzonym zakończeniem, mających co najmniej jedną lokalizację do 1 km od adresu. Etykieta podaje projekty w realizacji. Stan opisów: 31 grudnia 2024 r.; niejednoznaczne opisy pominięto. Poza Krakowem brak pokrycia.',
    jednostka: 'projekty',
    kierunek: 'neutralny',
    rozdzielczosc: 'adres',
    rozmiar: 'promień 1 km',
    zakres: [0, 70],
    zadanie: 26,
    zrodla: [
      {
        nazwa: 'MSIP Kraków – Warstwa_BO',
        url: ZRODLO,
        licencja:
          'Regulamin MSIP Obserwatorium i zasady ponownego wykorzystania: https://msip.krakow.pl/getHtml?dok_id=228972',
        dataDanych: '2024-12-31',
        pobrano,
      },
    ],
  },
  wartosci,
  etykiety,
)
console.log(
  `BO: ${dane.features.length} punktów źródłowych, ${bezGeometrii} bez geometrii, ${niejasnyStatus} z niejednoznacznym statusem`,
)
