import assert from 'node:assert/strict'
import { test } from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { indeksPrzystankow, odlegloscMetry } from './gtfs-przystanki.mjs'
import {
  dataAktualizacjiZIndeksu,
  dataIso,
  liczWarstwe,
  najblizszaSroda,
  najblizszyPunkt,
  odczytajFeed,
  odjazdyPrzystankow,
  sekundyDnia,
  uslugiDnia,
  wybierzDateDanych,
} from './kolej-km.mjs'

const zip = (pliki) =>
  zipSync(
    Object.fromEntries(Object.entries(pliki).map(([nazwa, tekst]) => [nazwa, strToU8(tekst)])),
  )
const tekst = (pliki) => Object.fromEntries(Object.entries(pliki).map(([n, t]) => [n, strToU8(t)]))

test('czas GTFS: godziny po północy i błędne wartości', () => {
  assert.equal(sekundyDnia('07:00:00'), 25_200)
  assert.equal(sekundyDnia('7:05:30'), 25_530)
  assert.equal(sekundyDnia('24:30:00'), 88_200)
  assert.equal(sekundyDnia(''), null)
  assert.equal(sekundyDnia(undefined), null)
  assert.equal(sekundyDnia('07:61:00'), null)
  assert.equal(sekundyDnia('abc'), null)
})

test('dzień pomiaru: najbliższa środa włącznie z dzisiejszą', () => {
  assert.equal(najblizszaSroda('2026-10-03'), '2026-10-07') // sobota
  assert.equal(najblizszaSroda('2026-10-07'), '2026-10-07') // środa
  assert.equal(najblizszaSroda('2026-10-08'), '2026-10-14') // czwartek
  assert.equal(najblizszaSroda('2026-10-06'), '2026-10-07') // wtorek
  assert.throws(() => najblizszaSroda('nie-data'), /Niepoprawna data/)
})

test('kalendarz: feed SKA ma tylko calendar_dates, a wyjątek 2 usuwa usługę z calendar', () => {
  const ska = tekst({
    'calendar_dates.txt': 'service_id,date,exception_type\na,20261007,1\nb,20261008,1\n',
  })
  assert.deepEqual([...uslugiDnia(ska, '2026-10-07')], ['a'])
  assert.throws(() => uslugiDnia(ska, '2026-10-09'), /brak aktywnych usług/)

  const klasyczny = tekst({
    'calendar.txt':
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
      'robocze,1,1,1,1,1,0,0,20261001,20261130\nweekend,0,0,0,0,0,1,1,20261001,20261130\n',
    'calendar_dates.txt':
      'service_id,date,exception_type\nrobocze,20261014,2\nweekend,20261014,1\n',
  })
  assert.deepEqual([...uslugiDnia(klasyczny, '2026-10-07')], ['robocze'])
  assert.deepEqual([...uslugiDnia(klasyczny, '2026-10-14')], ['weekend'])
  assert.deepEqual([...uslugiDnia(klasyczny, '2026-10-10')], ['weekend'])
  assert.throws(() => uslugiDnia(klasyczny, '2026-12-02'), /brak aktywnych usług/)
  assert.throws(() => uslugiDnia({}, '2026-10-07'), /brak calendar/)
  assert.throws(() => uslugiDnia(klasyczny, '2026-13-45'), /niepoprawna data/)
})

test('odjazdy: ostatni przystanek kursu, pickup_type i granice szczytu', () => {
  const w = (trip, seq, stop, czas, pickup = '') => ({
    trip_id: trip,
    stop_sequence: String(seq),
    stop_id: stop,
    departure_time: czas,
    arrival_time: czas,
    pickup_type: pickup,
  })
  const wiersze = [
    // kolejność w pliku zmieszana: sortowanie po stop_sequence ma ją naprawić
    w('t1', 3, 'D', '09:10:00'),
    w('t1', 1, 'A', '07:00:00'),
    w('t1', 2, 'B', '07:30:00', '3'),
    w('t1', 4, 'E', '09:20:00', '1'),
    w('t2', 1, 'A', '09:00:00'), // 09:00:00 jest już poza szczytem
    w('t2', 2, 'B', '25:10:00'), // po północy
    w('t2', 3, 'C', '08:59:59'),
    w('t3', 1, 'A', '06:59:59'),
    w('t3', 2, 'B', '08:59:59'),
    w('t3', 3, 'C', ''),
    w('inny', 1, 'Z', '07:30:00'), // kurs spoza dnia
    w('inny', 2, 'Z', '07:40:00'),
  ]
  const { odjazdy, odrzucone } = odjazdyPrzystankow(wiersze, new Set(['t1', 't2', 't3']))
  assert.equal(odrzucone, 0)
  // t1: A, B, D odjeżdżają (E to koniec kursu i pickup 1); t2: A, B (C to koniec); t3: A, B (C koniec)
  assert.deepEqual(odjazdy.get('A'), { dzien: 3, szczyt: 1 })
  assert.deepEqual(odjazdy.get('B'), { dzien: 3, szczyt: 2 }) // 07:30 (na żądanie) i 08:59:59
  assert.deepEqual(odjazdy.get('D'), { dzien: 1, szczyt: 0 })
  assert.equal(odjazdy.has('C'), false, 'C jest tylko końcem kursów')
  assert.equal(odjazdy.has('E'), false)
  assert.equal(odjazdy.has('Z'), false)
})

test('odjazdy: pickup_type=1 w środku kursu wyklucza wsiadanie, błędny czas jest liczony jako odrzucony', () => {
  const w = (seq, stop, czas, pickup = '') => ({
    trip_id: 't',
    stop_sequence: String(seq),
    stop_id: stop,
    departure_time: czas,
    arrival_time: czas,
    pickup_type: pickup,
  })
  const { odjazdy, odrzucone } = odjazdyPrzystankow(
    [w(1, 'A', '07:00:00'), w(2, 'B', '07:10:00', '1'), w(3, 'C', 'xx:yy'), w(4, 'D', '07:30:00')],
    new Set(['t']),
  )
  assert.equal(odjazdy.has('B'), false)
  assert.equal(odjazdy.has('C'), false)
  assert.equal(odrzucone, 1)
  assert.deepEqual(odjazdy.get('A'), { dzien: 1, szczyt: 1 })
})

const STOPS_SKA =
  'stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station\n' +
  'A,,STACJA A,50.0,20.0,,\nB,,STACJA B (tylko koniec),50.1,20.1,,\nC,,STACJA C (bez kursów),50.2,20.2,,\n' +
  'D,,STACJA D (zła współrzędna),abc,20.3,,\n'

test('feed SKA bez calendar.txt: czynne są tylko punkty z odjazdem w danym dniu', () => {
  const feed = zip({
    'feed_info.txt': 'feed_publisher_name,feed_start_date,feed_end_date\nKM,20261002,20261212\n',
    'stops.txt': STOPS_SKA,
    'trips.txt': 'route_id,service_id,trip_id\nr,s1,t1\nr,s2,t2\n',
    'calendar_dates.txt': 'service_id,date,exception_type\ns1,20261007,1\ns2,20261008,1\n',
    'stop_times.txt':
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\n' +
      't1,07:00:00,07:00:00,A,0,,,\nt1,07:30:00,07:30:00,B,1,,,\n' +
      't2,07:00:00,07:00:00,C,0,,,\nt2,07:10:00,07:10:00,A,1,,,\n',
  })
  const wynik = odczytajFeed(feed, '2026-10-07', 'test')
  assert.deepEqual(
    wynik.punkty.map((p) => [p.id, p.odjazdyDnia, p.odjazdySzczyt]),
    [['A', 1, 1]],
  )
  assert.equal(wynik.informacje.feed_start_date, '20261002')
  assert.equal(wynik.statystyki.kursy, 1)
  assert.equal(wynik.statystyki.punktowWFeedzie, 4)
  assert.deepEqual(wynik.grupy.get('A'), { odjazdyDnia: 1, odjazdySzczyt: 1 })
  assert.throws(() => odczytajFeed(feed, '2026-10-09', 'test'), /brak aktywnych usług/)
})

test('feed MLD: stacje nadrzędne nie są przystankami, a kursy zespołu sumują oba stanowiska', () => {
  const feed = zip({
    'stops.txt':
      'stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station\n' +
      'S1,100,Rynek,50.00,20.00,1,\nP1,101,Rynek,50.0001,20.0001,0,S1\nP2,102,Rynek,50.0002,20.0,0,S1\n' +
      'P3,103,Osiedle,50.05,20.05,0,\n',
    'trips.txt': 'route_id,service_id,trip_id\nA1,x,t1\nA1,x,t2\n',
    'calendar.txt':
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
      'x,1,1,1,1,1,0,0,20261001,20261130\n',
    'stop_times.txt':
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\n' +
      't1,07:00:00,07:00:00,P1,1,,0,1\nt1,07:20:00,07:20:00,P3,2,,3,3\nt1,07:40:00,07:40:00,P2,3,,3,0\n' +
      't2,08:00:00,08:00:00,P2,1,,0,1\nt2,08:10:00,08:10:00,P1,2,,3,3\nt2,08:20:00,08:20:00,P3,3,,1,0\n',
  })
  const wynik = odczytajFeed(feed, '2026-10-07', 'mld')
  assert.deepEqual(wynik.punkty.map((p) => p.id).sort(), ['P1', 'P2', 'P3'])
  assert.equal(wynik.statystyki.punktowWFeedzie, 3, 'stacja S1 (location_type=1) się nie liczy')
  // P1: t1 07:00 i t2 08:10 (na żądanie); P2: t2 08:00 (t1 kończy się na P2); P3: t1 07:20 (t2 kończy)
  assert.deepEqual(wynik.grupy.get('S1'), { odjazdyDnia: 3, odjazdySzczyt: 3 })
  assert.deepEqual(wynik.grupy.get('P3'), { odjazdyDnia: 1, odjazdySzczyt: 1 })
  assert.equal(wynik.punkty.find((p) => p.id === 'P1').grupa, 'S1')
  assert.equal(wynik.punkty.find((p) => p.id === 'P3').grupa, 'P3')
})

test('ZIP: ucięty plik i brak wymaganych plików kończą się błędem, nie pustym wynikiem', () => {
  const pelny = zip({
    'stops.txt': STOPS_SKA,
    'trips.txt': 'route_id,service_id,trip_id\n',
    'calendar_dates.txt': 'service_id,date,exception_type\n',
    'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n',
  })
  assert.throws(() => odczytajFeed(pelny.subarray(0, pelny.length - 8), '2026-10-07'), /ZIP/)
  const bezStopTimes = zip({ 'stops.txt': STOPS_SKA, 'trips.txt': 'route_id,service_id,trip_id\n' })
  assert.throws(() => odczytajFeed(bezStopTimes, '2026-10-07', 'x'), /x: brak stop_times\.txt/)
  assert.throws(() => odczytajFeed(pelny, '2026-10-07'), /brak aktywnych usług/)
})

test('najbliższy punkt zgadza się z przeszukaniem pełnym i nie zmyśla trafień poza zasięgiem', () => {
  let ziarno = 12_345
  const los = () => {
    ziarno = (ziarno * 1_664_525 + 1_013_904_223) % 4_294_967_296
    return ziarno / 4_294_967_296
  }
  const punkty = Array.from({ length: 150 }, (_, i) => ({
    id: `p${i}`,
    lon: 19.6 + los() * 0.8,
    lat: 49.9 + los() * 0.4,
  }))
  const indeks = indeksPrzystankow(punkty)
  for (let k = 0; k < 300; k++) {
    const adres = { lon: 19.6 + los() * 0.8, lat: 49.9 + los() * 0.4 }
    let najlepszy = null
    let minimum = Number.POSITIVE_INFINITY
    for (const p of punkty) {
      const m = odlegloscMetry(adres.lat, adres.lon, p.lat, p.lon)
      if (m < minimum) {
        minimum = m
        najlepszy = p
      }
    }
    const wynik = najblizszyPunkt(adres, punkty, indeks)
    assert.equal(wynik.punkt.id, najlepszy.id)
    assert.ok(Math.abs(wynik.metry - minimum) < 1e-6)
  }
  const daleki = { lon: 19.9, lat: 52.5 }
  assert.equal(najblizszyPunkt(daleki, punkty, indeks), null)
  const bliski = { lon: punkty[0].lon, lat: punkty[0].lat }
  assert.equal(najblizszyPunkt(bliski, punkty, indeks).metry, 0)
  assert.equal(najblizszyPunkt({ lon: Number.NaN, lat: 50 }, punkty, indeks), null)
})

test('maksymalny promień jest ścisły, także gdy nie jest potęgą dwójki razy 500 m', () => {
  const punkty = [{ id: 'p', lon: 20.0, lat: 50.0 }]
  const indeks = indeksPrzystankow(punkty)
  const adres = { lon: 20.0, lat: 50.0 + 6_000 / 111_195 }
  assert.ok(Math.abs(najblizszyPunkt(adres, punkty, indeks, 7_000).metry - 6_000) < 5)
  assert.equal(najblizszyPunkt(adres, punkty, indeks, 5_000), null)
})

test('warstwa: odległość zaokrąglona do metra, kursy na godzinę z zespołu, brak współrzędnych = null', () => {
  const feed = {
    punkty: [
      { id: 'a1', grupa: 'G', lon: 20.0, lat: 50.0 },
      { id: 'a2', grupa: 'G', lon: 20.0, lat: 50.01 },
      { id: 'b', grupa: 'b', lon: 20.2, lat: 50.0 },
    ],
    grupy: new Map([
      ['G', { odjazdyDnia: 20, odjazdySzczyt: 5 }],
      ['b', { odjazdyDnia: 3, odjazdySzczyt: 0 }],
    ]),
  }
  const adresy = [
    { lon: 20.0, lat: 50.0005 },
    { lon: 20.19, lat: 50.0 },
    { lon: Number.NaN, lat: 50.0 },
  ]
  const { odleglosc, kursy } = liczWarstwe(adresy, feed)
  assert.deepEqual(odleglosc, [
    Math.round(odlegloscMetry(50.0005, 20, 50.0, 20)),
    Math.round(odlegloscMetry(50.0, 20.19, 50.0, 20.2)),
    null,
  ])
  assert.ok(odleglosc[0] === 56 && odleglosc[1] >= 714 && odleglosc[1] <= 716)
  assert.deepEqual(kursy, [2.5, 0, null])
})

test('data stanu danych: Last-Modified, potem indeks, potem początek ważności feedu', () => {
  assert.equal(dataIso('20261002'), '2026-10-02')
  assert.equal(dataIso('2026-10-02'), null)
  assert.equal(dataIso(''), null)
  assert.equal(dataIso(undefined), null)
  assert.equal(
    wybierzDateDanych({
      lastModified: 'Fri, 02 Oct 2026 08:00:40 GMT',
      dataIndeksu: '2026-10-01',
      poczatekWaznosci: '20260901',
    }),
    '2026-10-02',
  )
  // 23:30 UTC to już następny dzień w Warszawie
  assert.equal(wybierzDateDanych({ lastModified: 'Sun, 30 Aug 2026 22:59:50 GMT' }), '2026-08-31')
  assert.equal(
    wybierzDateDanych({
      lastModified: null,
      dataIndeksu: '2026-10-01',
      poczatekWaznosci: '20260901',
    }),
    '2026-10-01',
  )
  assert.equal(wybierzDateDanych({ poczatekWaznosci: '20261001' }), '2026-10-01')
  assert.throws(() => wybierzDateDanych({ lastModified: 'to nie data' }), /Brak daty/)
})

test('indeks plików KM: data aktualizacji przypisana do właściwego linku', () => {
  const html = `
    <li class="file-item"><span class="update-label">
      aktualizacja: 2026-10-02 10:00:40                        </span>
      <a class="file-link" href="?download=AAA%3D%3D">kml-ska-gtfs.zip</a></li>
    <li class="file-item"><span class="update-label">
      aktualizacja: 2026-10-01 07:57:15                        </span>
      <a class="file-link" href="?download=BBB%3D">GTFS.zip</a></li>`
  assert.equal(dataAktualizacjiZIndeksu(html, 'AAA%3D%3D'), '2026-10-02')
  assert.equal(dataAktualizacjiZIndeksu(html, 'BBB%3D'), '2026-10-01')
  assert.equal(dataAktualizacjiZIndeksu(html, 'CCC'), null)
  assert.equal(dataAktualizacjiZIndeksu('', 'AAA%3D%3D'), null)
})
