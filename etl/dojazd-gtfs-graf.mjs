// GTFS ZTP → kompaktowy graf rozkładu do liczenia dojazdu do celu wybranego w przeglądarce (#85).
// Uruchom: node etl/dojazd-gtfs-graf.mjs [YYYY-MM-DD] [HH-HH]
// Zapisuje public/dane/dojazd/graf.json: przystanki z kursami w oknie godzin i odjazdy wybranego
// dnia. Bez surowych identyfikatorów kursów i bez nazw linii – tylko to, czego potrzebuje silnik.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataRobocza, listaFeedow, odczytajFeed } from './dojazd-gtfs.mjs'
import { DATA_OBSLUGI_MIASTA } from './lib/gtfs-miasta.mjs'
import { DANE } from './lib/wspolne.mjs'

// Okno: wyjście 05:00–21:00 + 2 h na podróż (ok. 3,9 MB, 0,6 MB gzip). Rozmiar rośnie liniowo
// z oknem; pobierany dopiero po wybraniu celu.
const OKNO_DOMYSLNE = '5-23'

/** Koduje kursy jako płaskie tablice [przystanek, Δprzyjazd, postój, flagi] z deltami czasu. */
export function kodujKursy(zdarzenia, mapaPrzystankow) {
  const poKursie = new Map()
  for (const z of zdarzenia) {
    let lista = poKursie.get(z.trip)
    if (!lista) poKursie.set(z.trip, (lista = []))
    lista.push(z)
  }
  const kursy = []
  for (const lista of poKursie.values()) {
    if (lista.length < 2) continue
    lista.sort((a, b) => a.sequence - b.sequence)
    const wiersz = []
    let poprzedni = 0
    for (const z of lista) {
      const arr = Math.min(z.arr, z.dep)
      const flagi = (z.pickup ? 1 : 0) | (z.dropoff ? 2 : 0)
      wiersz.push(mapaPrzystankow.get(z.stop), arr - poprzedni, z.dep - arr, flagi)
      poprzedni = z.dep
    }
    kursy.push(wiersz)
  }
  // Kolejność po pierwszym odjeździe – deterministyczny plik, łatwiejszy diff.
  return kursy.sort((a, b) => a[1] - b[1] || a[0] - b[0])
}

export async function generuj(data = dataRobocza(), okno = OKNO_DOMYSLNE) {
  const [h0, h1] = okno.split('-').map(Number)
  if (!Number.isInteger(h0) || !Number.isInteger(h1) || h0 < 0 || h1 > 30 || h0 >= h1)
    throw new Error('Okno: HH-HH, np. 6-11')
  const start = h0 * 60
  const koniec = h1 * 60
  const punkty = []
  const zdarzenia = []
  const zrodla = []
  for (const { grupa, bufor, zrodlo } of await listaFeedow()) {
    const feed = odczytajFeed(bufor, grupa, data, punkty.length, { start, koniec })
    punkty.push(...feed.punkty)
    for (const z of feed.zdarzenia) if (z.dep >= start) zdarzenia.push(z)
    zrodla.push(zrodlo(feed.info))
  }
  const uzyte = [...new Set(zdarzenia.map((z) => z.stop))].sort((a, b) => a - b)
  const mapa = new Map(uzyte.map((s, i) => [s, i]))
  const przystanki = uzyte.flatMap((s) => [
    Math.round(punkty[s].lon * 1e5),
    Math.round(punkty[s].lat * 1e5),
  ])
  const kursy = kodujKursy(zdarzenia, mapa)
  const graf = {
    wersja: 1,
    dataRozkladu: data,
    okno: { start, koniec },
    zrodla,
    przystanki,
    kursy,
  }
  mkdirSync(join(DANE, 'dojazd'), { recursive: true })
  const plik = join(DANE, 'dojazd', 'graf.json')
  const tekst = JSON.stringify(graf)
  writeFileSync(plik, tekst)
  console.log(
    `graf.json: ${uzyte.length} przystanków, ${kursy.length} kursów, ${zdarzenia.length} zdarzeń, ${(tekst.length / 1e6).toFixed(2)} MB`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [data, okno] = process.argv.slice(2)
  await generuj(data || DATA_OBSLUGI_MIASTA || dataRobocza(), okno || OKNO_DOMYSLNE)
}
