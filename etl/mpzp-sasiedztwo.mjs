// MPZP Krakowa: tereny planu w sąsiedztwie adresu (#66, kontynuacja #22).
// Wejście: public/dane/mpzp_adresy.json (z etl/mpzp.mjs, MSIP) i public/dane/adresy.json.
// Sąsiedztwo = tereny planu (symbol + przeznaczenie) trafione przez INNE punkty adresowe Krakowa
// w promieniu PROMIEN_M od adresu. To próbka terenów, nie pełna geometria: teren bez adresów
// (droga, zieleń, teren niezabudowany) nie pojawi się na liście. Granic działek nie mamy.
// Działa offline na plikach z repo, bo MSIP (msip.um.krakow.pl) i BIP Krakowa nie są osiągalne
// z sieci, w której liczono (#66). Licencja MSIP zakazuje ciągłego pośredniczenia – plik statyczny.
// Uruchom: node etl/mpzp-sasiedztwo.mjs (po etl/mpzp.mjs)

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import KDBush from 'kdbush'
import proj4 from 'proj4'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'

export const PROMIEN_M = 100
const TERYT_KRAKOW = '1261011'
const EPSG2178 =
  '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'

/** Indeksy terenów (typ 'teren' w słowniku) sąsiadów, bez terenów samego adresu; posortowane. */
export function terenySasiadow(wlasne, sasiedzi, szczegoly, czyTeren) {
  const zbior = new Set()
  for (const j of sasiedzi) {
    for (const k of szczegoly[j] ?? []) if (czyTeren(k)) zbior.add(k)
  }
  for (const k of wlasne ?? []) zbior.delete(k)
  return [...zbior].sort((a, b) => a - b)
}

function main() {
  const { wersja, adresy } = wczytajAdresy()
  const katalog = JSON.parse(readFileSync(join(DANE, 'mpzp_adresy.json'), 'utf8'))
  if (katalog.wersjaAdresow !== wersja) {
    throw new Error('mpzp_adresy.json ma inną wersję adresów – najpierw node etl/mpzp.mjs')
  }
  const czyTeren = (k) => katalog.slownik[k]?.typ === 'teren'
  const doMetrow = proj4('EPSG:4326', EPSG2178)
  const krakow = adresy.filter((a) => a.teryt === TERYT_KRAKOW)
  const xy = krakow.map((a) => doMetrow.forward([a.lon, a.lat]))
  const drzewo = new KDBush(krakow.length)
  for (const [x, y] of xy) drzewo.add(x, y)
  drzewo.finish()

  const wynik = adresy.map(() => null)
  const stat = { krakow: krakow.length, zSasiedztwem: 0, pusteSasiedztwo: 0, sumaTerenow: 0 }
  krakow.forEach((a, n) => {
    const [x, y] = xy[n]
    const sasiedzi = drzewo
      .range(x - PROMIEN_M, y - PROMIEN_M, x + PROMIEN_M, y + PROMIEN_M)
      .filter((m) => m !== n && Math.hypot(xy[m][0] - x, xy[m][1] - y) <= PROMIEN_M)
      .map((m) => krakow[m].i)
    const lista = terenySasiadow(katalog.adresy[a.i], sasiedzi, katalog.adresy, czyTeren)
    // Pusta lista = żaden sąsiedni punkt adresowy nie leży w terenie planu (to fakt, nie brak danych).
    wynik[a.i] = lista
    if (lista.length) stat.zSasiedztwem++
    else stat.pusteSasiedztwo++
    stat.sumaTerenow += lista.length
  })
  console.log(stat)
  const sciezka = join(DANE, 'mpzp_sasiedztwo.json')
  writeFileSync(
    sciezka,
    JSON.stringify({
      wersjaAdresow: wersja,
      dataDanych: katalog.dataDanych,
      promienM: PROMIEN_M,
      metoda:
        'Tereny MPZP trafione przez inne punkty adresowe Krakowa w promieniu 100 m (próbka, bez terenów bez adresów). Indeksy do słownika mpzp_adresy.json.',
      adresy: wynik,
    }),
  )
  console.log(`mpzp_sasiedztwo.json: ${(readFileSync(sciezka).length / 1024).toFixed(0)} kB`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
