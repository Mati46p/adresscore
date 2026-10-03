import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { latLngToCell } from 'h3-js'
import { odlegloscMetry, policzHeksy, wpisyPrzyPunkcie } from './imprezy-stale.mjs'

const katalog = JSON.parse(readFileSync(new URL('./imprezy-stale-2026.json', import.meta.url)))

test('katalog ma 81 pozycji z dziewięciu miejsc, a nie podwójnie liczone Bulwary', () => {
  assert.equal(katalog.lokalizacje.length, 9)
  assert.equal(
    katalog.lokalizacje.reduce((suma, x) => suma + x.wpisy, 0),
    81,
  )
  assert.deepEqual(
    katalog.pominiete.map((x) => x.wpisy),
    [11],
  )
  assert.ok(katalog.lokalizacje.every((x) => x.osm.startsWith('https://www.openstreetmap.org/')))
})

test('liczy pozycje wykazu przy heksie i wskazuje miejsca', () => {
  const rynek = katalog.lokalizacje[0]
  const wynik = wpisyPrzyPunkcie(rynek.lat, rynek.lon, [rynek])
  assert.equal(wynik.wartosc, 28)
  assert.deepEqual(wynik.nazwy, ['Rynek Główny (28)'])
  assert.ok(odlegloscMetry(rynek.lat, rynek.lon, rynek.lat, rynek.lon) < 0.01)
  assert.deepEqual(wpisyPrzyPunkcie(49.9, 20.1, [rynek]), { wartosc: 0, nazwy: [] })
})

test('adresy w tym samym heksie mają identyczny wynik; poza Krakowem null', () => {
  const h3 = latLngToCell(50.0614956, 19.9371133, 10)
  const wynik = policzHeksy([
    { h3, teryt: '1261011' },
    { h3, teryt: '1261011' },
    { h3, teryt: '1206042' },
  ])
  assert.equal(wynik.wartosci[0], wynik.wartosci[1])
  assert.ok(wynik.wartosci[0] >= 28)
  assert.equal(wynik.wartosci[2], null)
  assert.equal(wynik.etykiety[2], null)
  assert.equal(wynik.liczbaHeksow, 1)
})
