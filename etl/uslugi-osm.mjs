// Punkty usługowe OpenStreetMap -> odległość od każdego adresu w linii prostej.
// Uruchom: node etl/uslugi-osm.mjs. Surowa odpowiedź Overpass trafia do etl/.cache/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { indeksPrzystankow, najblizszyPrzystanek } from './gtfs-przystanki.mjs'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const API = 'https://overpass-api.de/api/interpreter'
const DEFINICJE = [
  {
    id: 'sklep_odleglosc',
    nazwa: 'Najbliższy sklep spożywczy',
    kategoria: 'codziennosc',
    tagi: { shop: ['supermarket', 'convenience', 'grocery'] },
    zakres: [0, 2000],
  },
  {
    id: 'szkola_odleglosc',
    nazwa: 'Najbliższa szkoła',
    kategoria: 'codziennosc',
    tagi: { amenity: ['school'] },
    zakres: [0, 3000],
  },
  {
    id: 'przedszkole_odleglosc',
    nazwa: 'Najbliższe przedszkole',
    kategoria: 'codziennosc',
    tagi: { amenity: ['kindergarten'] },
    zakres: [0, 3000],
  },
  {
    id: 'apteka_odleglosc',
    nazwa: 'Najbliższa apteka',
    kategoria: 'codziennosc',
    tagi: { amenity: ['pharmacy'] },
    zakres: [0, 3000],
  },
  {
    id: 'przychodnia_odleglosc',
    nazwa: 'Najbliższa przychodnia lub gabinet lekarski',
    kategoria: 'codziennosc',
    tagi: { amenity: ['clinic', 'doctors'], healthcare: ['clinic', 'doctor'] },
    zakres: [0, 5000],
  },
  {
    id: 'zlobek_odleglosc',
    nazwa: 'Najbliższy żłobek lub punkt opieki',
    kategoria: 'codziennosc',
    tagi: { amenity: ['childcare'] },
    zakres: [0, 4000],
  },
  {
    id: 'piekarnia_odleglosc',
    nazwa: 'Najbliższa piekarnia',
    kategoria: 'kontekst',
    tagi: { shop: ['bakery'] },
    zakres: [0, 3000],
  },
  {
    id: 'fryzjer_odleglosc',
    nazwa: 'Najbliższy fryzjer',
    kategoria: 'kontekst',
    tagi: { shop: ['hairdresser'] },
    zakres: [0, 3000],
  },
  {
    id: 'poczta_odleglosc',
    nazwa: 'Najbliższa placówka pocztowa',
    kategoria: 'kontekst',
    tagi: { amenity: ['post_office'] },
    zakres: [0, 5000],
  },
  {
    id: 'paczkomat_odleglosc',
    nazwa: 'Najbliższy automat paczkowy',
    kategoria: 'kontekst',
    tagi: { amenity: ['parcel_locker'] },
    zakres: [0, 3000],
  },
  {
    id: 'bankomat_odleglosc',
    nazwa: 'Najbliższy bankomat',
    kategoria: 'kontekst',
    tagi: { amenity: ['atm'] },
    zakres: [0, 3000],
  },
]

const POLE = { lat: [49.7, 50.5], lon: [19.3, 20.8] }
const MIN_PUNKTOW = {
  sklep_odleglosc: 200,
  szkola_odleglosc: 100,
  przedszkole_odleglosc: 100,
  apteka_odleglosc: 100,
  przychodnia_odleglosc: 100,
  zlobek_odleglosc: 10,
  piekarnia_odleglosc: 50,
  fryzjer_odleglosc: 50,
  poczta_odleglosc: 30,
  paczkomat_odleglosc: 50,
  bankomat_odleglosc: 50,
}

export function zapytanie(adresy) {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLon = Infinity,
    maxLon = -Infinity
  for (const a of adresy) {
    minLat = Math.min(minLat, a.lat)
    maxLat = Math.max(maxLat, a.lat)
    minLon = Math.min(minLon, a.lon)
    maxLon = Math.max(maxLon, a.lon)
  }
  minLat -= 0.1
  maxLat += 0.1
  minLon -= 0.16
  maxLon += 0.16
  const bbox = [minLat, minLon, maxLat, maxLon].map((v) => v.toFixed(6)).join(',')
  const selektory = [
    'nwr["shop"~"^(supermarket|convenience|grocery|bakery|hairdresser)$"]',
    'nwr["amenity"~"^(school|kindergarten|pharmacy|clinic|doctors|childcare|post_office|parcel_locker|atm)$"]',
    'nwr["healthcare"~"^(clinic|doctor)$"]',
    'nwr["amenity"="kindergarten"]["nursery"="yes"]',
  ]
  return `[out:json][timeout:180];(${selektory.map((s) => `${s}(${bbox});`).join('')});out center;`
}

export function punktyZOverpass(odpowiedz) {
  if (!Array.isArray(odpowiedz?.elements) || !odpowiedz.osm3s?.timestamp_osm_base)
    throw new Error('Overpass: brak listy elementów albo daty stanu OSM')
  const punkty = new Map(DEFINICJE.map((d) => [d.id, new Map()]))
  for (const el of odpowiedz.elements) {
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < POLE.lat[0] ||
      lat > POLE.lat[1] ||
      lon < POLE.lon[0] ||
      lon > POLE.lon[1]
    )
      continue
    const nazwa = typeof el.tags?.name === 'string' ? el.tags.name.trim().slice(0, 120) : ''
    const punkt = { id: `${el.type}/${el.id}`, lat, lon, nazwa }
    for (const d of DEFINICJE) {
      const zwyklyTag = Object.entries(d.tagi).some(([klucz, wartosci]) =>
        wartosci.includes(el.tags?.[klucz]),
      )
      const zlobekWPrzedszkolu =
        d.id === 'zlobek_odleglosc' &&
        el.tags?.amenity === 'kindergarten' &&
        el.tags?.nursery === 'yes'
      if (zwyklyTag || zlobekWPrzedszkolu) punkty.get(d.id).set(punkt.id, punkt)
    }
  }
  return new Map([...punkty].map(([id, mapa]) => [id, [...mapa.values()]]))
}

async function pobierz(adresy) {
  mkdirSync(CACHE, { recursive: true })
  const sciezka = join(CACHE, `uslugi-osm-v2-${dzis()}.json`)
  if (existsSync(sciezka)) return JSON.parse(readFileSync(sciezka, 'utf8'))
  const body = new URLSearchParams({ data: zapytanie(adresy) })
  const r = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'adresscore-etl/1.0 (https://adresscore.pl)',
    },
    body,
    signal: AbortSignal.timeout(240_000),
  })
  if (!r.ok) throw new Error(`Overpass: HTTP ${r.status}`)
  const wynik = await r.json()
  if (!Array.isArray(wynik.elements) || !wynik.osm3s?.timestamp_osm_base)
    throw new Error('Overpass: niekompletna odpowiedź')
  writeFileSync(sciezka, JSON.stringify(wynik))
  return wynik
}

export async function generuj() {
  const { adresy } = wczytajAdresy()
  const odpowiedz = await pobierz(adresy)
  const punkty = punktyZOverpass(odpowiedz)
  const dataDanych = odpowiedz.osm3s.timestamp_osm_base.slice(0, 10)
  for (const d of DEFINICJE) {
    const lista = punkty.get(d.id)
    if (lista.length < MIN_PUNKTOW[d.id])
      throw new Error(`OSM: za mało punktów ${d.id}: ${lista.length}`)
    const indeks = indeksPrzystankow(lista)
    const wyniki = adresy.map((a) => najblizszyPrzystanek(a, lista, indeks))
    const etykiety = wyniki.map((w) => (w ? w.punkt.nazwa || 'Miejsce bez nazwy' : null))
    zapiszWskaznik(
      {
        id: d.id,
        kategoria: d.kategoria,
        nazwa: d.nazwa,
        opis: `Odległość w linii prostej od punktu adresowego do najbliższego obiektu oznaczonego w OpenStreetMap jako ${Object.entries(
          d.tagi,
        )
          .map(([k, v]) => `${k}=${v.join('|')}`)
          .join(
            ' lub ',
          )}${d.id === 'zlobek_odleglosc' ? ' albo amenity=kindergarten + nursery=yes' : ''}. Obliczona z punktu albo środka obrysu obiektu. Nie jest to długość dojścia ulicami; baza OSM może być niepełna i nie potwierdza godzin otwarcia ani, w przypadku placówek medycznych, umowy z NFZ. Brak obiektu w promieniu 16 km oznacza brak danych.`,
        jednostka: 'm',
        kierunek: 'mniej-lepiej',
        rozdzielczosc: 'adres',
        zakres: d.zakres,
        zadanie: d.kategoria === 'kontekst' ? 104 : 8,
        zrodla: [
          {
            nazwa: '© OpenStreetMap contributors',
            url: 'https://www.openstreetmap.org/copyright',
            licencja: 'Open Database License (ODbL) 1.0',
            dataDanych,
            pobrano: dzis(),
          },
          ...(odpowiedz.extract_source
            ? [
                {
                  nazwa: 'Geofabrik: wyciąg OSM dla Małopolski',
                  url: odpowiedz.extract_source,
                  licencja: 'Open Database License (ODbL) 1.0',
                  dataDanych,
                  pobrano: dzis(),
                },
              ]
            : []),
        ],
      },
      wyniki.map((w) => w?.metry ?? null),
      etykiety,
    )
    console.log(`${d.id}: ${lista.length} punktów OSM`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await generuj()
