// Źródła: ZTP Kraków, granica SCT (uchwała XXXII/619/25, dane 2025-07-08),
// oraz aktualna mapa ZDMK, sektory SPP (warstwa Granice_Stref_2026, 2026-08-10).
// Publiczne warstwy ArcGIS Online są poglądową interpretacją uchwał; licencja nie jest
// wskazana w metadanych AGOL. Liczy przynależność punktu adresowego do stref.
// Uruchomienie: node etl/strefy.mjs (pobrane GeoJSON są buforowane w etl/.cache/).
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DANE, dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const SCT =
  'https://services-eu1.arcgis.com/svTzSt3AvH7sK6q9/ArcGIS/rest/services/Granice_Strefy_Czystego_Transportu_w_Krakowie/FeatureServer/0'
const SPP =
  'https://services-eu1.arcgis.com/svTzSt3AvH7sK6q9/arcgis/rest/services/Granice_Stref_2026/FeatureServer/1'
const MAPA_SPP = 'https://zdmk.krakow.pl/parkowanie/strefa-platnego-parkowania/mapy/mapa-strefy/'
const STAN_PRAWNY =
  'https://zdmk.krakow.pl/nasze-dzialania/skarga-kasacyjna-wojewody-dot-wyroku-wsa-dotyczacego-sct/'
const LICENCJA =
  'Dane publicznie udostępnione przez ZTP/ZDMK; licencja w AGOL nieokreślona; granice poglądowe'

function bboxWspolrzednych(wspolrzedne) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity]
  function odwiedz(w) {
    if (typeof w[0] === 'number') {
      bbox[0] = Math.min(bbox[0], w[0])
      bbox[1] = Math.min(bbox[1], w[1])
      bbox[2] = Math.max(bbox[2], w[0])
      bbox[3] = Math.max(bbox[3], w[1])
    } else for (const x of w) odwiedz(x)
  }
  odwiedz(wspolrzedne)
  return bbox
}

function wPierścieniu(punkt, pierscien) {
  const [x, y] = punkt
  let wSrodku = false
  for (let i = 0, j = pierscien.length - 1; i < pierscien.length; j = i++) {
    const [xi, yi] = pierscien[i]
    const [xj, yj] = pierscien[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) wSrodku = !wSrodku
  }
  return wSrodku
}

function wGeometrii(punkt, geometria) {
  const wielokaty = geometria.type === 'Polygon' ? [geometria.coordinates] : geometria.coordinates
  return wielokaty.some(
    (pierscienie) =>
      wPierścieniu(punkt, pierscienie[0]) &&
      !pierscienie.slice(1).some((otwor) => wPierścieniu(punkt, otwor)),
  )
}

function warstwa(geojson) {
  if (geojson.type !== 'FeatureCollection' || !geojson.features?.length)
    throw new Error('Pusta warstwa GeoJSON')
  return geojson.features.map((f) => {
    if (!['Polygon', 'MultiPolygon'].includes(f.geometry?.type))
      throw new Error('Oczekiwano wielokątów')
    return { ...f, bbox: bboxWspolrzednych(f.geometry.coordinates) }
  })
}

function znajdz(punkt, obiekty) {
  const [x, y] = punkt
  return obiekty.find((f) => {
    const [xmin, ymin, xmax, ymax] = f.bbox
    return x >= xmin && x <= xmax && y >= ymin && y <= ymax && wGeometrii(punkt, f.geometry)
  })
}

// Uproszczenie dla mapy; klasyfikację adresów liczymy zawsze na oryginalnych granicach.
function odchudzGeometrie(geometria) {
  const punkt = ([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]
  const pierscien = (w) => {
    const wynik = w
      .map(punkt)
      .filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])
    if (wynik.length < 4) return w.map(punkt)
    wynik[wynik.length - 1] = wynik[0]
    return wynik
  }
  return {
    type: geometria.type,
    coordinates:
      geometria.type === 'Polygon'
        ? geometria.coordinates.map(pierscien)
        : geometria.coordinates.map((w) => w.map(pierscien)),
  }
}

async function pobierzWarstwe(url, plik) {
  const sciezka = await pobierzDoCache(
    `${url}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson`,
    plik,
  )
  return JSON.parse(readFileSync(sciezka, 'utf8'))
}

function zapiszMape(nazwa, geojson) {
  const mapa = {
    type: 'FeatureCollection',
    features: geojson.features.map((f) => ({
      type: 'Feature',
      properties: f.properties,
      geometry: odchudzGeometrie(f.geometry),
    })),
  }
  const tekst = JSON.stringify(mapa)
  if (Buffer.byteLength(tekst) >= 300_000) throw new Error(`${nazwa}.geojson przekracza 300 kB`)
  writeFileSync(join(DANE, `${nazwa}.geojson`), `${tekst}\n`)
  console.log(`${nazwa}.geojson: ${Buffer.byteLength(tekst)} B`)
}

const start = performance.now()
const [sctGeojson, sppGeojson] = await Promise.all([
  pobierzWarstwe(SCT, 'sct-2025-07-08.geojson'),
  pobierzWarstwe(SPP, 'spp-2026-08-10.geojson'),
])
const sct = warstwa(sctGeojson)
const spp = warstwa(sppGeojson)
if (
  !spp.every(
    (f) => /^[ABC]$/.test(f.properties?.Podstrefa_) && Number.isInteger(f.properties?.Nr_sektora),
  )
) {
  throw new Error('Warstwa SPP nie zawiera oczekiwanych podstref i sektorów')
}
zapiszMape('sct', sctGeojson)
zapiszMape('spp', sppGeojson)

const { adresy } = wczytajAdresy()
const sctWartosci = []
const sctEtykiety = []
const sppWartosci = []
const sppEtykiety = []
for (const a of adresy) {
  if (a.teryt !== '1261011') {
    sctWartosci.push(null)
    sctEtykiety.push(null)
    sppWartosci.push(null)
    sppEtykiety.push(null)
    continue
  }
  const punkt = [a.lon, a.lat]
  const wSct = Boolean(znajdz(punkt, sct))
  const sektor = znajdz(punkt, spp)
  sctWartosci.push(wSct ? 1 : 0)
  sctEtykiety.push(wSct ? 'SCT od 1.01.2026; wyrok WSA nieprawomocny' : null)
  sppWartosci.push(sektor ? 1 : 0)
  sppEtykiety.push(
    sektor
      ? `Podstrefa ${sektor.properties.Podstrefa_}, sektor ${sektor.properties.Podstrefa_}${sektor.properties.Nr_sektora}`
      : null,
  )
}

const wspolne = {
  kategoria: 'transport',
  kierunek: 'neutralny',
  rozdzielczosc: 'adres',
  jednostka: '0/1',
  zakres: [0, 1],
  zadanie: 24,
  atrapa: false,
}
const pobrano = dzis()
zapiszWskaznik(
  {
    ...wspolne,
    id: 'sct_w_strefie',
    nazwa: 'Strefa Czystego Transportu',
    opis: `1 = adres w SCT, 0 = poza SCT w Krakowie, null = poza zasięgiem opracowania. Obowiązuje od 1.01.2026. Wyrok WSA z 14.01.2026 nieprawomocny; stan prawny na ${pobrano}. Granica to poglądowa interpretacja uchwały według danych przestrzennych z 2025-07-08, a uprawnienie do wjazdu zależy od pojazdu i zwolnień.`,
    zrodla: [
      {
        nazwa: 'ZTP Kraków – granice SCT',
        url: SCT,
        licencja: LICENCJA,
        dataDanych: '2025-07-08',
        pobrano,
      },
      {
        nazwa: 'ZDMK – skarga kasacyjna i nieprawomocność wyroku WSA',
        url: STAN_PRAWNY,
        licencja: 'Informacja publiczna ZDMK',
        dataDanych: '2026-03-27',
        pobrano,
      },
    ],
  },
  sctWartosci,
  sctEtykiety,
)
zapiszWskaznik(
  {
    ...wspolne,
    id: 'spp_podstrefa',
    nazwa: 'Podstrefa płatnego parkowania',
    opis: '1 = adres w obszarze płatnego parkowania, 0 = poza nim w Krakowie, null = poza zasięgiem opracowania. Etykieta podaje podstrefę i sektor. Granice poglądowe; opłata zależy od miejsca postoju, oznakowania i obowiązujących godzin.',
    zrodla: [
      {
        nazwa: 'ZDMK – Mapa Strefy, Granice_Stref_2026',
        url: SPP,
        licencja: `${LICENCJA}; mapa: ${MAPA_SPP}`,
        dataDanych: '2026-08-10',
        pobrano,
      },
    ],
  },
  sppWartosci,
  sppEtykiety,
)
console.log(
  `Przeliczono ${adresy.length} adresów w ${((performance.now() - start) / 1000).toFixed(2)} s`,
)
