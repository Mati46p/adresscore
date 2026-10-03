import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { cellToParent, latLngToCell } from 'h3-js'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import {
  bezNumeru,
  jednostkiSim,
  nazwaPotoczna,
  okolicaZastepcza,
  ROZDZIELCZOSC_NAZW,
  slug,
  zloz,
  znajdzJednostke,
} from './okolice.mjs'

const PAUZA = String.fromCharCode(0x2014)
const h3 = (lat, lon) => latLngToCell(lat, lon, 10)
const krk = (dzielnica, lat, lon) => ({
  gmina: 'Kraków',
  dzielnica,
  miejscowosc: 'Kraków',
  teryt: '1261011',
  lat,
  lon,
  h3: h3(lat, lon),
})

test('nazwy: numer dzielnicy, slug, potoczna z Nominatim', () => {
  assert.equal(bezNumeru('XVIII Nowa Huta'), 'Nowa Huta')
  assert.equal(slug('Łagiewniki-Borek Fałęcki'), 'lagiewniki-borek-falecki')
  assert.equal(nazwaPotoczna({ quarter: 'Żabiniec', residential: 'Osiedle Żabiniec' }), 'Żabiniec')
  assert.equal(nazwaPotoczna({ residential: 'Osiedle Podwawelskie' }), 'os. Podwawelskie')
  assert.equal(nazwaPotoczna({ suburb: 'Dębniki' }), null)
  assert.equal(nazwaPotoczna(null), null)
})

test('okolicaZastepcza: osiedle OSM, sama dzielnica, miejscowość, brak danych = null', () => {
  const a = krk('IV Prądnik Biały', 50.0807, 19.942)
  const pot = new Map([[cellToParent(a.h3, ROZDZIELCZOSC_NAZW), 'Żabiniec']])
  assert.deepEqual(okolicaZastepcza(a, pot), {
    id: 'krk-pradnik-bialy-zabiniec',
    nazwa: 'Żabiniec',
    nazwaUrzedowa: 'IV Prądnik Biały',
    dzielnica: 'IV Prądnik Biały',
    gmina: 'Kraków',
    rodzaj: 'osiedle-osm',
  })
  assert.equal(okolicaZastepcza(a, new Map()).id, 'krk-pradnik-bialy')
  const w = { gmina: 'Wieliczka', dzielnica: null, miejscowosc: 'Grabówki', teryt: '1219064' }
  assert.equal(okolicaZastepcza(w, new Map()).id, 'm-1219064-grabowki')
  assert.equal(okolicaZastepcza({ gmina: 'Kraków', dzielnica: null }, new Map()), null)
})

test('zloz: rozjazd, gdy osiedle leży w dwóch dzielnicach; null zostaje null', () => {
  const a = krk('V Krowodrza', 50.07, 19.92)
  const b = krk('VI Bronowice', 50.08, 19.89)
  const pot = new Map([
    [cellToParent(a.h3, ROZDZIELCZOSC_NAZW), 'Azory'],
    [cellToParent(b.h3, ROZDZIELCZOSC_NAZW), 'Azory'],
  ])
  const { kolumna, slownik, rozjazdy } = zloz([a, b, { gmina: null }], (x) =>
    okolicaZastepcza(x, pot),
  )
  assert.deepEqual(kolumna, ['krk-krowodrza-azory', 'krk-bronowice-azory', null])
  assert.equal(slownik['krk-krowodrza-azory'].liczbaAdresow, 1)
  assert.equal(rozjazdy.length, 1)
  assert.ok(rozjazdy[0].opis.includes(' – '))
  assert.ok(!rozjazdy[0].opis.includes(PAUZA))
})

test('jednostki SIM: punkt w wielokącie z GeoJSON', () => {
  const kw = [
    [19.9, 50.0],
    [19.95, 50.0],
    [19.95, 50.05],
    [19.9, 50.05],
    [19.9, 50.0],
  ]
  const j = jednostkiSim({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { ID: 7, NAZWA: 'Dębniki' },
        geometry: { type: 'Polygon', coordinates: [kw] },
      },
    ],
  })
  assert.equal(znajdzJednostke(j, 19.92, 50.02)?.id, 'sim-7')
  assert.equal(znajdzJednostke(j, 19.8, 50.02), null)
})

test('public/dane/okolice.json: id okolicy dla adresów, zgodny ze słownikiem', (t) => {
  const plik = join(DANE, 'okolice.json')
  if (!existsSync(plik)) return t.skip('brak pliku – uruchom node etl/okolice.mjs')
  const d = JSON.parse(readFileSync(plik, 'utf8'))
  const { wersja, adresy } = wczytajAdresy()
  assert.equal(d.wersjaAdresow, wersja)
  assert.equal(d.kolumny.okolica.length, adresy.length)
  for (const n of d.kolumny.okolica) if (n !== null) assert.ok(d.okolice[d.idOkolic[n]], String(n))
  const zOkolica = d.kolumny.okolica.filter((x) => x !== null).length
  assert.ok(zOkolica / adresy.length > 0.99)
  assert.ok(!JSON.stringify(d).includes(PAUZA))
})
