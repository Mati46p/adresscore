// Odległość od najbliższego lokalu gastronomicznego OSM do porównywania konkurencji.
import { pathToFileURL } from 'node:url'
import { indeksPunktow } from './lib/codziennosc-geo.mjs'
import { punktyOsm } from './lib/codziennosc-zrodla.mjs'
import { dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export async function main() {
  const { adresy } = wczytajAdresy()
  const { stan, rodzaje } = await punktyOsm()
  if (rodzaje.gastro.length < 100) throw new Error('Za mało lokali gastronomicznych w ekstrakcie')
  const najblizszy = indeksPunktow(rodzaje.gastro)
  const wartosci = []
  const etykiety = []
  for (const a of adresy) {
    const p = najblizszy(a.lat, a.lon, 15_000)
    wartosci.push(p ? Math.round(p.metry) : null)
    etykiety.push(p ? `${p.punkt.nazwa || 'Lokal gastronomiczny'}, ${Math.round(p.metry)} m` : null)
  }
  zapiszWskaznik(
    {
      id: 'gastronomia_odleglosc',
      nazwa: 'Najbliższa gastronomia',
      opis: 'Odległość w linii prostej do najbliższego lokalu restaurant, cafe lub fast_food oznaczonego w OpenStreetMap. To przybliżenie konkurencji dla nowej gastronomii: nie uwzględnia typu kuchni, cen, obrotu ani ruchu pieszego.',
      jednostka: 'm',
      kategoria: 'codziennosc',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 2500],
      zadanie: 171,
      zrodla: [
        {
          nazwa: 'OpenStreetMap, ekstrakt Geofabrik – małopolskie (restaurant, cafe, fast_food)',
          url: 'https://download.geofabrik.de/europe/poland/malopolskie.html',
          licencja:
            'ODbL 1.0 – © współtwórcy OpenStreetMap: https://www.openstreetmap.org/copyright',
          dataDanych: stan ?? dzis(),
          pobrano: dzis(),
        },
      ],
    },
    wartosci,
    etykiety,
  )
  console.log(
    `Gastronomia OSM: ${rodzaje.gastro.length} obiektów, ${wartosci.filter((x) => x !== null).length} adresów z pomiarem`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
