// Źródło: GUS NSP 2021 przez Eurostat INSPIRE, polska siatka 1 km (EPSG:3035).
// Licencja: CC BY 4.0; należy podać źródło i opisać przetworzenie danych.
// Liczy liczbę rezydentów/km² oraz odsetek osób w wieku 0–14 i 65+ w oczku adresu.
// Uruchomienie: node etl/gus.mjs
import { createReadStream } from 'node:fs'
import { Unzip, UnzipInflate } from 'fflate'
import proj4 from 'proj4'
import { dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const URL = 'https://gisco-services.ec.europa.eu/census/2021/INSPIRE/Data/PL_PD_3035_CSV.zip'
const PLIK = 'PL_PD_3035_CSV.zip'
const CSV = 'CSV/CENSUS_GRID_N_PL_2021.csv'
const PREFIX = 'PL_CRS3035RES1000m'
const CRS3035 =
  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +datum=WGS84 +units=m +no_defs'
proj4.defs('EPSG:3035', CRS3035)

function oczko(lon, lat) {
  const [x, y] = proj4('WGS84', 'EPSG:3035', [lon, lat])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return `${PREFIX}N${Math.floor(y / 1000) * 1000}E${Math.floor(x / 1000) * 1000}`
}

function liczba(wartosc, specjalna) {
  // Eurostat: puste OBS_VALUE z SPECIAL_VALUE=confidential to tajemnica statystyczna.
  if (specjalna || wartosc === '') return null
  const n = Number(wartosc)
  return Number.isInteger(n) && n >= 0 ? n : null
}

async function wczytajSiatke(zip, potrzebne) {
  const siatka = new Map()
  let znalezionoPlik = false
  let koniecPliku = false
  let blad = null
  const rozpakuj = new Unzip((plik) => {
    if (plik.name !== CSV) return
    znalezionoPlik = true
    const dekoder = new TextDecoder()
    let reszta = ''
    let naglowek = null
    plik.ondata = (err, chunk, final) => {
      if (err) {
        blad = err
        return
      }
      const tekst = reszta + dekoder.decode(chunk, { stream: !final })
      const wiersze = tekst.split('\n')
      reszta = wiersze.pop() ?? ''
      if (final && reszta) wiersze.push(reszta)
      for (const wiersz of wiersze) {
        if (!naglowek) {
          naglowek = wiersz.replace(/\r$/, '').split(',')
          for (const pole of ['STAT', 'SPATIAL', 'OBS_VALUE', 'SPECIAL_VALUE'])
            if (!naglowek.includes(pole))
              throw new Error(`Brak kolumny ${pole} w pliku GUS/Eurostat`)
          continue
        }
        // W pliku występuje jeden wiersz na zmienną i oczko. Filtrujemy przed
        // tworzeniem obiektów, bo źródłowy CSV ma ponad 700 MB.
        const kol = wiersz.split(',')
        const id = kol[naglowek.indexOf('SPATIAL')]
        if (!potrzebne.has(id)) continue
        const stat = kol[naglowek.indexOf('STAT')]
        if (stat !== 'T' && stat !== 'Y_LT15' && stat !== 'Y_GE65') continue
        const wpis = siatka.get(id) ?? {}
        wpis[stat] = liczba(
          kol[naglowek.indexOf('OBS_VALUE')],
          kol[naglowek.indexOf('SPECIAL_VALUE')],
        )
        siatka.set(id, wpis)
      }
      if (final) koniecPliku = true
    }
    plik.start()
  })
  rozpakuj.register(UnzipInflate)
  for await (const fragment of createReadStream(zip, { highWaterMark: 256 * 1024 })) {
    rozpakuj.push(new Uint8Array(fragment))
    if (blad) throw blad
  }
  rozpakuj.push(new Uint8Array(), true)
  if (blad) throw blad
  if (!znalezionoPlik || !koniecPliku) throw new Error(`Nie znaleziono pełnego ${CSV} w archiwum`)
  return siatka
}

const start = performance.now()
const { adresy } = wczytajAdresy()
const ids = adresy.map((a) => oczko(a.lon, a.lat))
const potrzebne = new Set(ids.filter(Boolean))
const zip = await pobierzDoCache(URL, PLIK)
const siatka = await wczytajSiatke(zip, potrzebne)
console.log(`GUS NSP 2021: ${siatka.size}/${potrzebne.size} oczek adresowych w źródle`)
for (const [id, rekord] of siatka) {
  const razem = rekord.T
  const mlodzi = rekord.Y_LT15
  const starsi = rekord.Y_GE65
  if (razem !== null && razem !== undefined) {
    if (
      (mlodzi !== null && mlodzi !== undefined && mlodzi > razem) ||
      (starsi !== null && starsi !== undefined && starsi > razem) ||
      (mlodzi !== null &&
        mlodzi !== undefined &&
        starsi !== null &&
        starsi !== undefined &&
        mlodzi + starsi > razem)
    )
      throw new Error(`Niespójne liczebności grup wieku w oczku ${id}`)
  }
}

const zrodlo = [
  {
    nazwa:
      'GUS, NSP 2021 – dane o rezydentach w siatce 1 km, udostępnione przez Eurostat INSPIRE; przeliczenie i przypisanie oczka przez adresscore',
    url: URL,
    licencja:
      'CC BY 4.0 – https://creativecommons.org/licenses/by/4.0/legalcode.pl; atrybucja GUS i Eurostat, wskazano przetworzenie',
    dataDanych: '2021',
    pobrano: dzis(),
  },
]
const baza = {
  kategoria: 'kontekst',
  kierunek: 'neutralny',
  rozdzielczosc: 'siatka',
  rozmiar: '1 km',
  zrodla: zrodlo,
  zadanie: 40,
}
const wartosci = (pole) => ids.map((id) => (id ? (siatka.get(id)?.[pole] ?? null) : null))
const ludnosc = wartosci('T')
zapiszWskaznik(
  {
    ...baza,
    id: 'ludnosc_1km',
    nazwa: 'Ludność rezydująca w oczku 1 km',
    opis: 'Liczba osób według miejsca zwykłego pobytu w NSP 2021 w oczku siatki 1 km² zawierającym adres; liczbowo równa liczbie osób/km². Kontekst z 2021 r., nie bieżąca liczba klientów ani ruch pieszy. Wartości utajnione są pominięte.',
    jednostka: 'osoby/km²',
    zakres: [0, 20000],
  },
  ludnosc,
)

for (const [id, pole, nazwa] of [
  ['udzial_65plus', 'Y_GE65', 'Udział osób w wieku 65+'],
  ['udzial_0_14', 'Y_LT15', 'Udział osób w wieku 0–14 lat'],
]) {
  const liczebnosc = wartosci(pole)
  const udzial = liczebnosc.map((n, i) =>
    n === null || ludnosc[i] === null || ludnosc[i] <= 0 ? null : (100 * n) / ludnosc[i],
  )
  zapiszWskaznik(
    {
      ...baza,
      id,
      nazwa,
      opis: `Odsetek ${pole === 'Y_GE65' ? 'osób w wieku 65+' : 'osób w wieku 0–14 lat'} wśród osób zwykle zamieszkałych w oczku 1 km² według NSP 2021; brak przy utajnieniu licznika lub mianownika. Kontekst demograficzny z 2021 r., bez wpływu na wynik adresu.`,
      jednostka: '%',
      zakres: [0, 100],
    },
    udzial,
  )
}
console.log(`Czas przeliczenia: ${((performance.now() - start) / 1000).toFixed(1)} s`)
