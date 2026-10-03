// Zieleń: siatka 100 m z analizy MSIP „Narażenie na wysokie temperatury powietrza"
// (projekt LIFE-IP EKOMALOPOLSKA, 2023) i drzewa z inwentaryzacji Zarządu Zieleni Miejskiej.
// Źródło: usługi ArcGIS REST MSIP Kraków (EPSG:2178), licencja: Regulamin MSIP.
// Liczy dwa wskaźniki dla każdego adresu z adresy.json:
//   zielen_udzial  – % pokrycia roślinnością oczka 100 m, w którym leży adres,
//   drzewa_100m    – liczba żywych drzew z ewidencji ZZM w promieniu 100 m.
// Siatka obejmuje tylko Kraków: adres poza nią dostaje null (brak danych), nie 0.
// Uruchom: node etl/zielen.mjs. Surowe strony usług zapisuje w etl/.cache/zielen/.
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import KDBush from 'kdbush'
import proj4 from 'proj4'
import { CACHE, dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const MSIP = 'https://msip.um.krakow.pl/arcgis/rest/services'
const URL_SIATKI = `${MSIP}/LIFE_IP_EKOMALOPOLSKA_2023/Analiza_wysokie_temp_powietrza/MapServer/6`
const URL_DRZEW = `${MSIP}/ZZM/ZZM_Drzewa/MapServer/3`
const LICENCJA = 'Regulamin MSIP: https://msip.krakow.pl/?dok_id=228972'
const STRONA = 2000 // maxRecordCount obu usług
const OCZKO = 100 // m
const PROMIEN_DRZEW = 100 // m

proj4.defs(
  'EPSG:2178',
  '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs',
)

mkdirSync(join(CACHE, 'zielen'), { recursive: true })

async function pobierzJson(url, plik) {
  const sciezka = await pobierzDoCache(url, join('zielen', plik))
  const dane = JSON.parse(readFileSync(sciezka, 'utf8'))
  if (dane.error) throw new Error(`${url}: ${JSON.stringify(dane.error)} (usuń ${sciezka})`)
  return dane
}

/**
 * Siatka 100 m. Warstwa nie obsługuje stronicowania, więc pobieramy zakresami FID.
 * Każde oczko to kwadrat 100 × 100 m wyrównany do wspólnej siatki – sprawdzamy to,
 * bo indeks oczek opiera się na zaokrągleniu współrzędnych.
 */
async function wczytajSiatke() {
  const { objectIds } = await pobierzJson(
    `${URL_SIATKI}/query?where=1%3D1&returnIdsOnly=true&f=json`,
    'siatka_ids.json',
  )
  const maxFid = Math.max(...objectIds)
  const obiekty = []
  for (let od = 0; od <= maxFid; od += STRONA) {
    const where = encodeURIComponent(`FID>=${od} AND FID<${od + STRONA}`)
    const url = `${URL_SIATKI}/query?where=${where}&outFields=FID,Zielen_Ges&returnGeometry=true&f=json`
    const strona = await pobierzJson(url, `siatka_${od}.json`)
    obiekty.push(...strona.features)
  }
  if (obiekty.length !== objectIds.length)
    throw new Error(`Siatka: ${obiekty.length} oczek, usługa zgłasza ${objectIds.length}`)

  let x0 = Infinity
  let y0 = Infinity
  for (const o of obiekty)
    for (const [x, y] of o.geometry.rings[0]) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
    }
  const oczka = new Map()
  for (const o of obiekty) {
    const r = o.geometry.rings
    const xs = r[0].map((p) => p[0])
    const ys = r[0].map((p) => p[1])
    const ix = (Math.min(...xs) - x0) / OCZKO
    const iy = (Math.min(...ys) - y0) / OCZKO
    const kwadrat =
      r.length === 1 &&
      Math.abs(Math.max(...xs) - Math.min(...xs) - OCZKO) < 0.01 &&
      Math.abs(Math.max(...ys) - Math.min(...ys) - OCZKO) < 0.01 &&
      Math.abs(ix - Math.round(ix)) < 1e-4 &&
      Math.abs(iy - Math.round(iy)) < 1e-4
    if (!kwadrat) throw new Error(`Oczko FID ${o.attributes.FID} nie jest kwadratem siatki 100 m`)
    oczka.set(`${Math.round(ix)}|${Math.round(iy)}`, o.attributes)
  }
  const oczkoPunktu = (x, y) =>
    oczka.get(`${Math.floor((x - x0) / OCZKO)}|${Math.floor((y - y0) / OCZKO)}`) ?? null
  return { oczkoPunktu, liczba: oczka.size, zakres: { x0, y0 } }
}

/** Żywe drzewa z ewidencji ZZM (bez krzewów, pniaków i drzew martwych). */
async function wczytajDrzewa() {
  const where = encodeURIComponent("stato='Drzewo żywe'")
  const { count } = await pobierzJson(
    `${URL_DRZEW}/query?where=${where}&returnCountOnly=true&f=json`,
    'drzewa_liczba.json',
  )
  const punkty = []
  for (let od = 0; od < count; od += STRONA) {
    const url = `${URL_DRZEW}/query?where=${where}&outFields=objectid&orderByFields=objectid&resultOffset=${od}&resultRecordCount=${STRONA}&returnGeometry=true&f=json`
    const strona = await pobierzJson(url, `drzewa_${od}.json`)
    for (const f of strona.features) if (f.geometry) punkty.push([f.geometry.x, f.geometry.y])
  }
  if (punkty.length < count * 0.99)
    throw new Error(`Drzewa: ${punkty.length} punktów, usługa zgłasza ${count}`)
  // Kilka rekordów ma współrzędne poza Polską (błąd ewidencji) – zostawiamy tylko okolice Krakowa.
  const wKrakowie = punkty.filter(
    ([x, y]) => x > 7400000 && x < 7460000 && y > 5520000 && y < 5570000,
  )
  const indeks = new KDBush(wKrakowie.length)
  for (const [x, y] of wKrakowie) indeks.add(x, y)
  indeks.finish()
  return { indeks, liczba: wKrakowie.length, odrzucone: punkty.length - wKrakowie.length }
}

const start = performance.now()
const [siatka, drzewa] = await Promise.all([wczytajSiatke(), wczytajDrzewa()])
const { adresy } = wczytajAdresy()
console.log(
  `Siatka: ${siatka.liczba} oczek. Drzewa ZZM: ${drzewa.liczba} (poza Krakowem odrzucono ${drzewa.odrzucone}).`,
)

const zielen = []
const liczbaDrzew = []
for (const a of adresy) {
  const [x, y] = proj4('EPSG:4326', 'EPSG:2178', [a.lon, a.lat])
  const o = siatka.oczkoPunktu(x, y)
  zielen.push(o?.Zielen_Ges ?? null)
  // Oczka przy granicy sięgają do sąsiednich gmin, ale ewidencja ZZM kończy się na granicy
  // Krakowa – poza miastem brak danych, nie zero drzew.
  const wKrakowie = o && a.gmina === 'Kraków'
  liczbaDrzew.push(wKrakowie ? drzewa.indeks.within(x, y, PROMIEN_DRZEW).length : null)
}

const zrodloSiatki = {
  nazwa:
    'MSIP Kraków, LIFE-IP EKOMALOPOLSKA – analiza „Narażenie na wysokie temperatury powietrza" (siatka 100 m)',
  url: URL_SIATKI,
  licencja: LICENCJA,
  dataDanych: '2023',
  pobrano: dzis(),
}

zapiszWskaznik(
  {
    id: 'zielen_udzial',
    kategoria: 'spokoj',
    nazwa: 'Udział zieleni',
    opis: 'Odsetek powierzchni oczka 100 m pokrytej roślinnością (także trawą), w którym leży adres. Siatka MSIP obejmuje Kraków i oczka na jego granicy; dalej brak danych.',
    jednostka: '%',
    kierunek: 'wiecej-lepiej',
    rozdzielczosc: 'siatka',
    rozmiar: '100 m',
    zakres: [0, 100],
    zadanie: 6,
    zrodla: [zrodloSiatki],
  },
  zielen,
)

zapiszWskaznik(
  {
    id: 'drzewa_100m',
    kategoria: 'kontekst',
    nazwa: 'Drzewa miejskie w 100 m',
    opis: 'Liczba żywych drzew z ewidencji Zarządu Zieleni Miejskiej w promieniu 100 m. Ewidencja obejmuje drzewa pod opieką ZZM (ulice, parki, skwery, część osiedli) i nie jest kompletna; drzew na terenach prywatnych w niej nie ma. Liczymy tylko drzewa w granicach Krakowa, więc przy granicy miasta wynik jest zaniżony. Poza Krakowem brak danych.',
    jednostka: 'szt.',
    kierunek: 'wiecej-lepiej',
    rozdzielczosc: 'adres',
    zakres: [0, 150],
    zadanie: 6,
    zrodla: [
      {
        nazwa: 'MSIP Kraków, Zarząd Zieleni Miejskiej – ewidencja drzew (ZZM_Drzewa, warstwa P1)',
        url: URL_DRZEW,
        licencja: LICENCJA,
        dataDanych: '2025-02-11',
        pobrano: dzis(),
      },
    ],
  },
  liczbaDrzew,
)

console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
