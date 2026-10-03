// Indeks jakości powietrza z czujników paczkomatów InPost (Kraków + obwarzanek).
// Uruchom: node etl/powietrze-inpost.mjs
// Warstwa pomocnicza (decyzja #63): kategoria `kontekst`, nie wchodzi do wyniku.
// Podstawą oceny powietrza zostaje GIOŚ (#7).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import KDBush from 'kdbush'
import { CACHE, DANE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const API = 'https://api-shipx-pl.easypack24.net/v1/points'
const PROMIEN_M = 1_000
const RAD = Math.PI / 180
const ZIEMIA_M = 6_371_000

/** Skala InPost (jak indeks GIOŚ): 1 = bardzo dobry … 6 = bardzo zły. */
export const POZIOMY = {
  VERY_GOOD: { wartosc: 1, nazwa: 'bardzo dobry' },
  GOOD: { wartosc: 2, nazwa: 'dobry' },
  SATISFACTORY: { wartosc: 3, nazwa: 'umiarkowany' },
  MODERATE: { wartosc: 3, nazwa: 'umiarkowany' },
  SUFFICIENT: { wartosc: 4, nazwa: 'dostateczny' },
  BAD: { wartosc: 5, nazwa: 'zły' },
  VERY_BAD: { wartosc: 6, nazwa: 'bardzo zły' },
}

/** Paczkomaty z czujnikiem w prostokącie adresów; nieznany poziom = brak danych, nie zgadujemy. */
export function punktyZCzujnikiem(items, granice) {
  const nieznane = new Set()
  const features = []
  for (const p of items) {
    if (!p.air_index_level) continue
    const poziom = POZIOMY[p.air_index_level]
    if (!poziom) {
      nieznane.add(p.air_index_level)
      continue
    }
    const { longitude: lon, latitude: lat } = p.location ?? {}
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (
      lat < granice.lat[0] ||
      lat > granice.lat[1] ||
      lon < granice.lon[0] ||
      lon > granice.lon[1]
    )
      continue
    features.push({
      type: 'Feature',
      id: p.name,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { poziom: p.air_index_level, wartosc: poziom.wartosc, nazwa: poziom.nazwa },
    })
  }
  return { features, nieznane: [...nieznane] }
}

function metryGeodezyjne(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * RAD
  const dLon = (bLon - aLon) * RAD
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * ZIEMIA_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Najbliższy czujnik w promieniu; dalej null – odczyt z drugiego końca dzielnicy nic nie mówi. */
export function najblizszyCzujnik(adres, features, indeks, promien = PROMIEN_M) {
  if (!Number.isFinite(adres.lat) || !Number.isFinite(adres.lon) || !features.length) return null
  const dLat = promien / 110_500
  const dLon = promien / (110_500 * Math.cos((Math.abs(adres.lat) + dLat) * RAD))
  let trafienie = null
  let minimum = Infinity
  for (const i of indeks.range(
    adres.lon - dLon,
    adres.lat - dLat,
    adres.lon + dLon,
    adres.lat + dLat,
  )) {
    const [lon, lat] = features[i].geometry.coordinates
    const m = metryGeodezyjne(adres.lat, adres.lon, lat, lon)
    if (m < minimum) {
      minimum = m
      trafienie = features[i]
    }
  }
  return trafienie && minimum <= promien ? { punkt: trafienie, metry: minimum } : null
}

async function pobierzWojewodztwo() {
  const items = []
  for (let strona = 1, stron = 1; strona <= stron; strona++) {
    const url = `${API}?province=${encodeURIComponent('małopolskie')}&per_page=500&page=${strona}&fields=name,air_index_level,location`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`API punktów InPost: HTTP ${r.status}`)
    const j = await r.json()
    stron = j.total_pages
    items.push(...j.items)
  }
  return items
}

async function main() {
  const { adresy } = wczytajAdresy()
  const zapas = 0.02
  const granice = { lat: [Infinity, -Infinity], lon: [Infinity, -Infinity] }
  for (const a of adresy) {
    granice.lat = [Math.min(granice.lat[0], a.lat - zapas), Math.max(granice.lat[1], a.lat + zapas)]
    granice.lon = [Math.min(granice.lon[0], a.lon - zapas), Math.max(granice.lon[1], a.lon + zapas)]
  }
  const items = await pobierzWojewodztwo()
  if (items.length < 2_000) throw new Error(`Podejrzanie mało punktów InPost: ${items.length}`)
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(join(CACHE, `inpost_malopolskie_${dzis()}.json`), JSON.stringify(items))
  const { features, nieznane } = punktyZCzujnikiem(items, granice)
  if (nieznane.length) console.warn(`Nieznane poziomy indeksu (pominięte): ${nieznane.join(', ')}`)
  if (features.length < 50) throw new Error(`Podejrzanie mało czujników: ${features.length}`)

  const opisZrodla =
    'Publiczne API punktów InPost (ShipX Points), pole air_index_level – indeks z czujnika wbudowanego w część paczkomatów. Dane prywatnego operatora, nie rejestr publiczny; InPost nie publikuje metodyki ani kalibracji czujników.'
  writeFileSync(
    join(DANE, 'inpost_powietrze.geojson'),
    JSON.stringify({
      type: 'FeatureCollection',
      metadane: {
        nazwa: 'Indeks powietrza z czujników paczkomatów InPost – Kraków i obwarzanek',
        znaczenie: `${opisZrodla} Migawka z chwili pobrania, nie średnia roczna.`,
        zrodlo: API,
        pobrano: dzis(),
        przetworzono:
          'Województwo małopolskie, przycięte do prostokąta adresów projektu (+ ok. 2 km); tylko punkty z polem air_index_level.',
        liczbaCzujnikow: features.length,
      },
      features,
    }),
  )

  const indeks = new KDBush(features.length)
  for (const f of features) indeks.add(...f.geometry.coordinates)
  indeks.finish()
  const najblizsze = adresy.map((a) => najblizszyCzujnik(a, features, indeks))
  zapiszWskaznik(
    {
      id: 'powietrze_inpost_indeks',
      kategoria: 'kontekst',
      nazwa: 'Powietrze – czujnik w paczkomacie (nieoficjalne)',
      opis: `Indeks jakości powietrza z najbliższego paczkomatu InPost z czujnikiem, w promieniu ${PROMIEN_M} m (1 = bardzo dobry … 6 = bardzo zły). Migawka z dnia pobrania, nie średnia roczna. Źródło prywatne i bez opisanej kalibracji – tylko kontekst, nie wpływa na wynik; ocenę powietrza daje GIOŚ. Dalej niż ${PROMIEN_M} m od czujnika: brak danych.`,
      jednostka: 'indeks 1–6',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'siatka',
      rozmiar: `najbliższy czujnik ≤ ${PROMIEN_M} m`,
      zakres: [1, 6],
      zadanie: 80,
      zrodla: [
        {
          nazwa: 'InPost – API punktów (ShipX Points), pole air_index_level',
          url: API,
          licencja:
            'Dane operatora prywatnego udostępniane publicznie bez licencji otwartej; przetworzono: najbliższy czujnik ≤ 1 km',
          dataDanych: dzis(),
          pobrano: dzis(),
        },
      ],
    },
    // Bez etykiet: plik musiałby przekroczyć 2 MB; nazwę paczkomatu niesie inpost_powietrze.geojson.
    najblizsze.map((w) => w?.punkt.properties.wartosc ?? null),
  )
  console.log(
    `Czujniki InPost: ${features.length} w obszarze / ${items.length} punktów w małopolskim`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
