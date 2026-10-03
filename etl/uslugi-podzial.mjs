// Podział punktów usług wg obszaru (#104, #160): Kraków, obwarzanek (13 gmin) i margines prostokąta.
// Punkt należy do gminy najbliższego adresu z adresy.json w promieniu 400 m; bez adresu w tym promieniu
// to margines (prostokąt BBOX sięga kilku kilometrów poza granice gmin, więc część punktów leży poza nimi).
// Skrypt czyta gotowe pliki public/dane/uslugi, niczego nie pobiera i nie zapisuje.
// Uruchom po `node etl/uslugi.mjs`: node etl/uslugi-podzial.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { indeksPunktow } from './lib/codziennosc-geo.mjs'
import { BITY_ZRODEL, BRANZE } from './lib/uslugi-katalog.mjs'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'

export const PROMIEN_ADRESU_M = 400
const GMINA_KRAKOW = 'Kraków'

/**
 * Liczy punkty pliku branży w Krakowie, w obwarzanku i na marginesie oraz te z co najmniej dwoma
 * źródłami (bity w `zr`). `najblizszy(lat, lon, maxM)` to indeks adresów z codziennosc-geo.mjs.
 */
export function podzialWgObszaru(plik, najblizszy, promienM = PROMIEN_ADRESU_M) {
  const wynik = { n: plik.n, krakow: 0, obwarzanek: 0, margines: 0, wielZrodelWKrakowie: 0 }
  const maWiele = (zr) => Object.values(BITY_ZRODEL).filter((bit) => zr & bit).length >= 2
  for (let i = 0; i < plik.n; i++) {
    const r = najblizszy(plik.kolumny.lat[i], plik.kolumny.lon[i], promienM)
    if (!r) wynik.margines++
    else if (r.punkt.gmina === GMINA_KRAKOW) {
      wynik.krakow++
      if (maWiele(plik.kolumny.zr[i])) wynik.wielZrodelWKrakowie++
    } else wynik.obwarzanek++
  }
  return wynik
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const najblizszy = indeksPunktow(wczytajAdresy().adresy.map((a) => ({ ...a })))
  const wiersze = BRANZE.map((b) => {
    const plik = JSON.parse(readFileSync(join(DANE, 'uslugi', `${b.id}.json`), 'utf8'))
    return { branza: b.id, ...podzialWgObszaru(plik, najblizszy) }
  })
  console.table(wiersze)
}
