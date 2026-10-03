// Pozycje oficjalnego wykazu imprez stałych 2026, a nie odbytych imprez ani dni z hałasem.
// Uruchom: node etl/imprezy-stale.mjs. Dane wejściowe audytowane ręcznie z PDF BIP.
import { readFileSync } from 'node:fs'
import { cellToLatLng } from 'h3-js'
import { dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const KATALOG = JSON.parse(readFileSync(new URL('./imprezy-stale-2026.json', import.meta.url)))
export const PROMIEN_M = 500
export const TERYT_KRAKOW = '1261011'

export function odlegloscMetry(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function wpisyPrzyPunkcie(lat, lon, lokalizacje = KATALOG.lokalizacje) {
  const bliskie = lokalizacje.filter(
    (miejsce) => odlegloscMetry(lat, lon, miejsce.lat, miejsce.lon) <= PROMIEN_M,
  )
  return {
    wartosc: bliskie.reduce((suma, miejsce) => suma + miejsce.wpisy, 0),
    nazwy: bliskie.map((miejsce) => `${miejsce.nazwa} (${miejsce.wpisy})`),
  }
}

export function policzHeksy(adresy, lokalizacje = KATALOG.lokalizacje) {
  const heksy = new Map()
  const wartosci = []
  const etykiety = []
  const slownikEtykiet = {}
  const kluczeEtykiet = new Map()
  for (const adres of adresy) {
    if (adres.teryt !== TERYT_KRAKOW) {
      wartosci.push(null)
      etykiety.push(null)
      continue
    }
    if (!heksy.has(adres.h3)) {
      const [lat, lon] = cellToLatLng(adres.h3)
      heksy.set(adres.h3, wpisyPrzyPunkcie(lat, lon, lokalizacje))
    }
    const wynik = heksy.get(adres.h3)
    wartosci.push(wynik.wartosc)
    const tekst = wynik.nazwy.join(', ')
    if (!tekst) {
      etykiety.push(null)
      continue
    }
    if (!kluczeEtykiet.has(tekst)) {
      const kod = String(kluczeEtykiet.size + 1)
      kluczeEtykiet.set(tekst, kod)
      slownikEtykiet[kod] = tekst
    }
    etykiety.push(kluczeEtykiet.get(tekst))
  }
  return { wartosci, etykiety, slownikEtykiet, liczbaHeksow: heksy.size }
}

function main() {
  const { adresy, atrapa } = wczytajAdresy()
  if (atrapa) throw new Error('Wymagane rzeczywiste adresy MSIP')
  if (KATALOG.lokalizacje.reduce((suma, miejsce) => suma + miejsce.wpisy, 0) !== 81)
    throw new Error('Zmieniła się liczba pozycji wykazu – sprawdź PDF BIP')
  const wynik = policzHeksy(adresy)
  const pobrano = dzis()
  zapiszWskaznik(
    {
      id: 'imprezy_stale_wpisy_500m_2026',
      nazwa: 'Wpisy wykazu imprez stałych w 500 m (2026)',
      opis: 'Suma pozycji oficjalnego wykazu imprez stałych 2026 przy dziewięciu punktowo zlokalizowanych przestrzeniach publicznych w Krakowie. Zasięg 500 m liczony od reprezentatywnych punktów OSM do środka heksu H3. Wykaz dopuszcza organizację po spełnieniu warunków, nie potwierdza odbycia imprezy; pozycja może trwać wiele dni albo dotyczyć trasy. To nie liczba dni, pomiar hałasu ani kompletny rejestr wydarzeń. Pominięto 11 pozycji z Bulwarów Wisły, bo wykaz nie określa odcinka. Zero oznacza brak wpisów tych dziewięciu lokalizacji w promieniu, nie brak innych wydarzeń. Poza Krakowem brak danych.',
      jednostka: 'pozycji wykazu',
      kategoria: 'kontekst',
      kierunek: 'neutralny',
      rozdzielczosc: 'heks',
      zadanie: 71,
      zrodla: [
        {
          nazwa: 'BIP Krakowa, zarządzenie 3080/2025, wykaz obowiązujący od 1 stycznia 2026',
          url: KATALOG.zrodlo,
          licencja:
            'Warunki ponownego wykorzystywania informacji BIP Krakowa – https://www.bip.krakow.pl/?dok_id=48482',
          dataDanych: '2026',
          pobrano,
        },
        {
          nazwa: 'OpenStreetMap – lokalizacje przestrzeni publicznych (Nominatim)',
          url: 'https://www.openstreetmap.org/copyright',
          licencja: 'Open Database License 1.0 – https://opendatacommons.org/licenses/odbl/1-0/',
          dataDanych: '2026-10-03',
          pobrano,
        },
      ],
    },
    wynik.wartosci,
    wynik.etykiety,
    wynik.slownikEtykiet,
  )
  console.log(`Sprawdzono ${wynik.liczbaHeksow} heksów Krakowa`)
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main()
