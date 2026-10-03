import assert from 'node:assert/strict'
import { test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import {
  aktywneStopIds,
  csv,
  indeksPrzystankow,
  najblizszyPrzystanek,
  obslugaDnia,
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

test('GTFS: wyjątek kalendarza aktywuje kurs, bez wsiadania nie liczy peronu', () => {
  const pliki = {
    'calendar.txt': strToU8(
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\ns,0,0,0,0,0,0,0,20261001,20261031\n',
    ),
    'calendar_dates.txt': strToU8('service_id,date,exception_type\ns,20261003,1\n'),
    'trips.txt': strToU8('trip_id,service_id\nt,s\n'),
    'stop_times.txt': strToU8(
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\nt,07:00:00,07:00:00,bez_wsiadania,1,"Centrum, Kraków",1,0\nt,07:05:00,07:05:00,z_wsiadaniem,2,"Centrum, Kraków",0,0',
    ),
  }
  assert.deepEqual([...aktywneStopIds(pliki, '2026-10-03')], ['z_wsiadaniem'])
  assert.equal(obslugaDnia(pliki, '2026-10-03').odjazdySzczyt.get('z_wsiadaniem'), 1)
  assert.equal(obslugaDnia(pliki, '2026-10-03').odjazdySzczyt.has('bez_wsiadania'), false)
  assert.throws(() => aktywneStopIds(pliki, '2026-10-04'), /brak aktywnych usług/)
})
