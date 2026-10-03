// Najbliższe kąpielisko (#125): odległość w linii prostej od adresu do najbliższego kąpieliska
// z wykazu na sezon 2026. Kategoria „kontekst": fakt na karcie, bez wpływu na wynik.
//
// Wykaz to ręcznie ułożony plik etl/kapieliska-2026.json, z źródłem przy każdym punkcie.
// Serwisu Kąpieliskowego GIS (sk.gis.gov.pl) skrypt nie odpytuje: serwis nie ma API, a WAF
// odrzuca automaty. Czynne kąpieliska Krakowa potwierdza PDF wykazu z BIP Krakowa (uchwała
// XLVII/1013/26), pozostałe karty z Serwisu; położenie punktów pochodzi z OpenStreetMap.
// Uruchom: node etl/kapieliska.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { odlegloscMetry } from './lib/codziennosc-geo.mjs'
import { dzis, KORZEN, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const PLIK_WYKAZU = join(KORZEN, 'etl', 'kapieliska-2026.json')
const ISO = /^\d{4}-\d{2}-\d{2}$/
/** Okno Małopolski: punkt poza nim to prawie na pewno przestawione współrzędne. */
const OKNO = { lat: [49.5, 50.6], lon: [19.3, 20.8] }
/** Położenie znamy z dokładnością rzędu 250 m, więc odległość zaokrąglamy do 50 m. */
export const KROK_M = 50

/** Waliduje wykaz i zwraca listę kąpielisk; błąd w pliku ma zatrzymać skrypt, nie wejść na kartę. */
export function sprawdzWykaz(wykaz) {
  const bledy = []
  const lista = wykaz?.kapieliska
  if (!Array.isArray(lista) || !lista.length) throw new Error('Wykaz kąpielisk: brak pozycji')
  if (wykaz.sezon !== 2026) bledy.push('sezon: oczekiwano 2026')
  const id = new Set()
  const etykiety = new Set()
  for (const k of lista) {
    const g = `${k.id ?? '?'}`
    for (const pole of ['id', 'etykieta', 'nazwa', 'gmina', 'powiat', 'adres'])
      if (typeof k[pole] !== 'string' || !k[pole].trim()) bledy.push(`${g}: brak pola ${pole}`)
    if (id.has(k.id)) bledy.push(`${g}: powtórzone id`)
    if (etykiety.has(k.etykieta)) bledy.push(`${g}: powtórzona etykieta`)
    id.add(k.id)
    etykiety.add(k.etykieta)
    if (k.status2026 !== 'czynne') bledy.push(`${g}: do wykazu trafiają tylko kąpieliska czynne`)
    if (
      !Number.isFinite(k.lat) ||
      !Number.isFinite(k.lon) ||
      k.lat < OKNO.lat[0] ||
      k.lat > OKNO.lat[1] ||
      k.lon < OKNO.lon[0] ||
      k.lon > OKNO.lon[1]
    )
      bledy.push(`${g}: współrzędne poza Małopolską`)
    if (!k.wykaz?.url?.startsWith('https://sk.gis.gov.pl/kapielisko/'))
      bledy.push(`${g}: wykaz.url musi wskazywać stronę kąpieliska w Serwisie Kąpieliskowym`)
    if (!k.wykaz?.nazwa) bledy.push(`${g}: brak wykaz.nazwa`)
    if (k.gmina === 'Kraków' && !k.uchwala?.url?.startsWith('https://www.bip.krakow.pl/'))
      bledy.push(`${g}: kąpielisko Krakowa wymaga uchwala.url z BIP Krakowa`)
    const p = k.polozenie
    if (!p?.zrodlo || !p.url?.startsWith('https://www.openstreetmap.org/') || !p.dokladnosc)
      bledy.push(`${g}: polozenie wymaga zrodlo, url z OpenStreetMap i dokladnosc`)
    if (!ISO.test(p?.pobrano ?? '')) bledy.push(`${g}: polozenie.pobrano w formacie RRRR-MM-DD`)
  }
  if (bledy.length) throw new Error(`Wykaz kąpielisk: ${bledy.join('; ')}`)
  return lista
}

export function wczytajWykaz(sciezka = PLIK_WYKAZU) {
  const wykaz = JSON.parse(readFileSync(sciezka, 'utf8'))
  return { wykaz, kapieliska: sprawdzWykaz(wykaz) }
}

/** Najbliższe kąpielisko w linii prostej; przy remisie wygrywa wcześniejsze w wykazie. */
export function najblizsze(adres, kapieliska) {
  if (!Number.isFinite(adres.lat) || !Number.isFinite(adres.lon)) return null
  let wynik = null
  for (const k of kapieliska) {
    const metry = odlegloscMetry(adres.lat, adres.lon, k.lat, k.lon)
    if (!wynik || metry < wynik.metry) wynik = { kapielisko: k, metry }
  }
  return wynik
}

export const zaokraglij = (metry, krok = KROK_M) => Math.round(metry / krok) * krok

export function opisWskaznika(kapieliska) {
  const nazwy = kapieliska.map((k) => `${k.etykieta} (${k.gmina})`).join(', ')
  return `Odległość w linii prostej od adresu do najbliższego kąpieliska z wykazu na sezon 2026: ${nazwy}. To nie jest trasa ani czas dojazdu. Kąpieliska działają tylko w sezonie (od czerwca do września), a sanepid może zakazać kąpieli. Wykaz ułożono ręcznie z Serwisu Kąpieliskowego GIS i uchwał rad gmin; kąpieliska z dalszych powiatów pominięto, więc na skraju obszaru odległość może być zawyżona. Położenie punktów z OpenStreetMap z dokładnością ok. 250 m, stąd zaokrąglenie do 50 m. Etykieta podaje nazwę kąpieliska.`
}

async function main() {
  const { wykaz, kapieliska } = wczytajWykaz()
  const { adresy } = wczytajAdresy()
  const wyniki = adresy.map((a) => najblizsze(a, kapieliska))
  const maks = wyniki.reduce((m, w) => Math.max(m, w?.metry ?? 0), 0)
  const zakres = [0, Math.ceil(maks / 5_000) * 5_000]
  const wartosci = wyniki.map((w) => (w ? zaokraglij(w.metry) : null))
  const etykiety = wyniki.map((w) => w?.kapielisko.etykieta ?? null)
  const pobrano = dzis()
  zapiszWskaznik(
    {
      id: 'kapielisko_odleglosc',
      kategoria: 'kontekst',
      nazwa: 'Najbliższe kąpielisko',
      opis: opisWskaznika(kapieliska),
      jednostka: 'm',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      zakres,
      zadanie: 125,
      zrodla: [
        {
          nazwa:
            'Główny Inspektorat Sanitarny – Serwis Kąpieliskowy (wykaz kąpielisk 2026, ułożony ręcznie)',
          url: 'https://sk.gis.gov.pl/',
          licencja:
            'Informacja publiczna GIS (zbiór „Serwis Kąpieliskowy” w dane.gov.pl: CC0 1.0, bez plików do pobrania); strony kąpielisk wskazano przy każdym punkcie w etl/kapieliska-2026.json',
          dataDanych: String(wykaz.sezon),
          pobrano,
        },
        {
          nazwa:
            'Gmina Miejska Kraków – uchwała XLVII/1013/26 Rady Miasta Krakowa z 19 marca 2026 r. i wykaz kąpielisk (BIP Krakowa)',
          url: 'https://www.bip.krakow.pl/?dok_id=247780',
          licencja: 'Akt prawa miejscowego i informacja publiczna (BIP)',
          dataDanych: '2026-03-19',
          pobrano,
        },
        {
          nazwa: 'OpenStreetMap – położenie punktów kąpielisk (© autorzy OpenStreetMap)',
          url: 'https://www.openstreetmap.org/copyright',
          licencja: 'ODbL 1.0',
          dataDanych: '2026-10-03',
          pobrano,
        },
      ],
    },
    wartosci,
    etykiety,
  )

  // Rozkład: ile adresów ma za najbliższe które kąpielisko i jak daleko jest najdalszy adres.
  const rozklad = new Map()
  for (const e of etykiety) rozklad.set(e, (rozklad.get(e) ?? 0) + 1)
  console.log(
    `Kąpieliska: ${kapieliska.length} punktów; najdalszy adres ${Math.round(maks)} m; ` +
      [...rozklad.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([e, n]) => `${e} ${n}`)
        .join(', '),
  )
  const kontrola = [
    ['Kraków', 'Rynek Główny', '1'],
    ['Kraków', 'Kozia', '14'],
    ['Kraków', 'Rzepakowa', '10'],
    ['Wieliczka', 'Rynek Górny', '1'],
    ['Niepołomice', 'Rynek', '1'],
  ]
  for (const [miejscowosc, ulica, nr] of kontrola) {
    const i = adresy.findIndex(
      (a) => a.miejscowosc === miejscowosc && a.ulica === ulica && a.nr === nr,
    )
    console.log(
      `Kontrola ${miejscowosc}, ${ulica} ${nr}: ${i < 0 ? 'brak adresu w PRG' : `${wartosci[i]} m – ${etykiety[i]}`}`,
    )
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
