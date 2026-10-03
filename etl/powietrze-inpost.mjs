// Indeks jakości powietrza z czujników paczkomatów InPost (Kraków + obwarzanek).
// Moduł dla etl/powietrze.mjs: dopisek do warstwy PM2,5 (decyzja #63, zadanie #80).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import KDBush from 'kdbush'
import { CACHE, dzis } from './lib/wspolne.mjs'

const API = 'https://api-shipx-pl.easypack24.net/v1/points'
const PROMIEN_M = 300
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

/**
 * Odczyty czujników dla adresów: etykieta „Czujnik: …" (krótka – limit 2 MB pliku) albo null dalej niż PROMIEN_M.
 * Dopisek do oficjalnej warstwy PM2,5 (#80, decyzja #63) – wartości i wynik zostają z GIOŚ.
 * Pozycji paczkomatów nie publikujemy; nazwa operatora idzie wyłącznie do listy źródeł.
 */
export async function odczytyCzujnikow(adresy) {
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
  const indeks = new KDBush(features.length)
  for (const f of features) indeks.add(...f.geometry.coordinates)
  indeks.finish()
  const etykiety = adresy.map((a) => {
    const w = najblizszyCzujnik(a, features, indeks)
    return w ? `Czujnik: ${w.punkt.properties.nazwa}` : null
  })
  const liczba = etykiety.filter(Boolean).length
  console.log(`Czujniki: ${features.length}, adresów do ${PROMIEN_M} m: ${liczba}/${adresy.length}`)
  return {
    etykiety,
    zrodlo: {
      nazwa: `InPost – indeks powietrza z czujników punktów odbioru (migawka z dnia pobrania), dopisek przy adresach do ${PROMIEN_M} m od czujnika`,
      url: API,
      licencja:
        'Dane operatora prywatnego bez licencji otwartej; tylko dopisek na karcie, nie zmienia wartości GIOŚ ani wyniku',
      dataDanych: dzis(),
      pobrano: dzis(),
    },
  }
}
