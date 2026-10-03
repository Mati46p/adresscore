import assert from 'node:assert/strict'
import { test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import {
  csv,
  indeksPrzystankow,
  najblizszyPrzystanek,
  odczytajGtfs,
  odlegloscMetry,
} from './gtfs-przystanki.mjs'

test('CSV GTFS: cytowane nazwy, przecinek i CRLF', () => {
  assert.deepEqual(csv('stop_id,stop_name\r\n1,"Rondo, Mogilskie"\r\n2,"Plac ""Nowy"""\r\n'), [
    { stop_id: '1', stop_name: 'Rondo, Mogilskie' },
    { stop_id: '2', stop_name: 'Plac "Nowy"' },
  ])
})

test('ZIP GTFS: odrzuca ucięty plik i stacje bez peronów', () => {
  const zip = zipSync({
    'stops.txt': strToU8(
      'stop_id,stop_name,stop_lat,stop_lon,location_type\n1,Peron,50.0,19.9,0\n2,Dworzec,50,20,1\n3,Zepsuty,abc,20,0\n',
    ),
    'feed_info.txt': strToU8('feed_version\n20261002\n'),
  })
  assert.throws(() => odczytajGtfs(zip.subarray(0, zip.length - 8), 'T'), /ZIP/)
  const wynik = odczytajGtfs(zip, 'T')
  assert.equal(wynik.punkty.length, 1)
  assert.equal(wynik.odrzucone, 2)
  assert.equal(wynik.punkty[0].id, 'T:1')
})

test('najbliższy peron: prawidłowa geodezja i brak pokrycia poza miastem', () => {
  const punkty = [
    { id: 'A:1', nazwa: 'Bliski', lat: 50.001, lon: 20 },
    { id: 'T:1', nazwa: 'Daleki', lat: 50.01, lon: 20 },
  ]
  const indeks = indeksPrzystankow(punkty)
  const wynik = najblizszyPrzystanek({ lat: 50, lon: 20 }, punkty, indeks)
  assert.equal(wynik.punkt.id, 'A:1')
  assert.ok(Math.abs(wynik.metry - 111.19) < 0.1)
  assert.equal(odlegloscMetry(50, 20, 50, 20), 0)
  assert.equal(najblizszyPrzystanek({ lat: 52, lon: 21 }, punkty, indeks), null)
})
