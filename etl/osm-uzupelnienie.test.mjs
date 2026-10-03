import assert from 'node:assert/strict'
import { test } from 'node:test'
import { odlegloscMetry } from './lib/codziennosc-geo.mjs'
import {
  czyLadowarkaSamochodow,
  GRUPY,
  klasyfikuj,
  kluczeTagow,
  normalizujNazwe,
  policzWPromieniu,
  scalPunkty,
  warunekSql,
  zaokraglijWGore,
  zewnetrzneLinie,
} from './lib/osm-uzupelnienie.mjs'

// Przesunięcie w stopniach szerokości o `m` metrów (1° szerokości = 111 195 m w modelu haversine'a).
const naPolnoc = (lat, m) => lat + m / 111_195
const naWschod = (lat, lon, m) => lon + m / (111_195 * Math.cos((lat * Math.PI) / 180))

test('ładowarki: tylko publiczne stacje samochodowe', () => {
  assert.deepEqual(klasyfikuj({ amenity: 'charging_station' }), ['ladowarka_ev'])
  assert.deepEqual(klasyfikuj({ amenity: 'charging_station', access: 'yes', motorcar: 'yes' }), [
    'ladowarka_ev',
  ])
  assert.deepEqual(klasyfikuj({ amenity: 'charging_station', access: 'permissive' }), [
    'ladowarka_ev',
  ])
  for (const access of ['private', 'customers', 'no', 'employees', 'permit'])
    assert.deepEqual(klasyfikuj({ amenity: 'charging_station', access }), [], access)
  assert.deepEqual(klasyfikuj({ amenity: 'charging_station', disused: 'yes' }), [])
  assert.deepEqual(klasyfikuj({ amenity: 'parking' }), [])
})

test('ładowarki: autobusy MPK, rowery elektryczne i hulajnogi to nie ładowarki samochodów', () => {
  // ładowarka autobusów MPK: motorcar=no, bus=yes (i zwykle access=private)
  assert.equal(czyLadowarkaSamochodow({ motorcar: 'no', bus: 'yes' }), false)
  assert.equal(czyLadowarkaSamochodow({ bus: 'yes', vehicle: 'no' }), false)
  assert.equal(czyLadowarkaSamochodow({ bus: 'yes' }), false)
  // punkt ładowania rowerów (econec): bicycle=yes bez motorcar=yes
  assert.equal(czyLadowarkaSamochodow({ bicycle: 'yes', moped: 'yes' }), false)
  assert.equal(czyLadowarkaSamochodow({ bicycle: 'designated', capacity: '4' }), false)
  assert.equal(czyLadowarkaSamochodow({ motorcar: 'no' }), false)
  // jawne motorcar=yes wygrywa z resztą (stacja wielopojazdowa)
  assert.equal(czyLadowarkaSamochodow({ motorcar: 'yes', bicycle: 'yes' }), true)
  assert.equal(czyLadowarkaSamochodow({ motorcar: 'yes', bus: 'yes' }), true)
  // bez tagów pojazdów to zwykła stacja samochodowa
  assert.equal(czyLadowarkaSamochodow({}), true)
  assert.equal(czyLadowarkaSamochodow({ bicycle: 'no' }), true)
  assert.deepEqual(
    klasyfikuj({ amenity: 'charging_station', motorcar: 'no', bus: 'yes', access: 'private' }),
    [],
  )
  assert.deepEqual(klasyfikuj({ amenity: 'charging_station', bicycle: 'designated' }), [])
})

test('życie nocne: bar, pub i klub, także dla klientów; miejsca zamknięte dla ogółu odpadają', () => {
  for (const amenity of ['bar', 'pub', 'nightclub'])
    assert.deepEqual(klasyfikuj({ amenity, name: 'Lokal' }), ['zycie_nocne'], amenity)
  // bar „tylko dla klientów" jest zwykłym barem
  assert.deepEqual(klasyfikuj({ amenity: 'bar', access: 'customers' }), ['zycie_nocne'])
  for (const access of ['private', 'no', 'members'])
    assert.deepEqual(klasyfikuj({ amenity: 'nightclub', access }), [], access)
  assert.deepEqual(klasyfikuj({ amenity: 'pub', disused: 'yes' }), [])
  assert.deepEqual(klasyfikuj({ amenity: 'restaurant' }), [])
  assert.deepEqual(klasyfikuj({ amenity: 'cafe' }), [])
})

test('targowisko: nieczynne i zamknięte dla ogółu odpadają, centrum handlowe z tagiem zostaje', () => {
  assert.deepEqual(klasyfikuj({ amenity: 'marketplace', name: 'Stary Kleparz' }), ['targowisko'])
  assert.deepEqual(klasyfikuj({ amenity: 'marketplace' }), ['targowisko'])
  assert.deepEqual(klasyfikuj({ amenity: 'marketplace', name: 'Plac Targowy nieczynny' }), [])
  assert.deepEqual(klasyfikuj({ amenity: 'marketplace', name: 'Targ zlikwidowany' }), [])
  assert.deepEqual(klasyfikuj({ amenity: 'marketplace', access: 'private' }), [])
  // OSM nie odróżnia bazaru od pawilonu handlowego i my też nie zgadujemy po nazwie
  assert.deepEqual(klasyfikuj({ amenity: 'marketplace', name: 'Centrum Targowe KING' }), [
    'targowisko',
  ])
})

test('wybieg dla psów: ogólnodostępny i bezpłatny, bez placów szkoleniowych', () => {
  assert.deepEqual(klasyfikuj({ leisure: 'dog_park' }), ['wybieg_psy'])
  assert.deepEqual(klasyfikuj({ leisure: 'dog_park', access: 'yes', name: 'Psi Park' }), [
    'wybieg_psy',
  ])
  assert.deepEqual(klasyfikuj({ leisure: 'dog_park', access: 'permissive' }), ['wybieg_psy'])
  for (const access of ['customers', 'permit', 'private'])
    assert.deepEqual(klasyfikuj({ leisure: 'dog_park', access }), [], access)
  assert.deepEqual(klasyfikuj({ leisure: 'dog_park', fee: 'yes' }), [])
  for (const name of [
    'Szoła Psiej Tresury PsieEgo',
    'Szkoła dla psów Burek',
    'Szkolenie psów – plac',
    'Psie przedszkole',
  ])
    assert.deepEqual(klasyfikuj({ leisure: 'dog_park', name }), [], name)
  // wąski wzorzec: wybieg przy szkole to nadal wybieg
  assert.deepEqual(klasyfikuj({ leisure: 'dog_park', name: 'Wybieg dla psów przy Szkole nr 5' }), [
    'wybieg_psy',
  ])
})

test('siłownia plenerowa: bez prywatnych, pracowniczych, wojskowych i płatnych', () => {
  assert.deepEqual(klasyfikuj({ leisure: 'fitness_station' }), ['silownia_plenerowa'])
  assert.deepEqual(klasyfikuj({ leisure: 'fitness_station', access: 'yes' }), [
    'silownia_plenerowa',
  ])
  for (const access of ['private', 'employees', 'military', 'customers'])
    assert.deepEqual(klasyfikuj({ leisure: 'fitness_station', access }), [], access)
  assert.deepEqual(klasyfikuj({ leisure: 'fitness_station', fee: 'yes' }), [])
  assert.deepEqual(klasyfikuj({ leisure: 'fitness_station', indoor: 'yes' }), [])
  // komercyjna siłownia to inny tag i inna warstwa
  assert.deepEqual(klasyfikuj({ leisure: 'fitness_centre', name: 'Fitness Klub' }), [])
})

test('urząd: gmina, miasto, dzielnica i ratusz, z townhall albo office=government', () => {
  const przyjete = [
    { amenity: 'townhall', name: 'Urząd Miasta Krakowa' },
    { office: 'government', government: 'administrative', name: 'Urząd Gminy Zabierzów' },
    { office: 'government', name: 'Urząd Miasta i Gminy Skawina' },
    { office: 'government', name: 'Urząd gminy w Czernichowie' },
    { office: 'government', name: 'Urząd Miejski w Wojniczu' },
    { office: 'government', name: 'Rada i Zarząd Dzielnicy VIII Dębniki' },
    { amenity: 'townhall', name: 'Ratusz' },
    { office: 'government', name: 'Urząd Miasta Krakowa - Wydział Architektury i Urbanistyki' },
  ]
  for (const t of przyjete) assert.deepEqual(klasyfikuj(t), ['urzad'], t.name)
  const odrzucone = [
    { office: 'government', name: 'Małopolski Urząd Wojewódzki w Krakowie' },
    { office: 'government', name: 'Urząd Marszałkowski Województwa Małopolskiego' },
    { office: 'government', name: 'Starostwo Powiatowe w Krakowie' },
    { office: 'government', name: 'Urząd Skarbowy Kraków-Krowodrza' },
    { office: 'government', name: 'Regionalna Dyrekcja Ochrony Środowiska w Krakowie' },
    { amenity: 'townhall', name: 'Kuria Diecezjalna' },
    { amenity: 'townhall', name: 'Okregowy Inspektorat Pracy' },
    { amenity: 'townhall' }, // bez nazwy nie wiemy, co to
    { office: 'government' },
    // gmina oznaczona jako archiwum albo remiza to nie urząd
    { office: 'government', amenity: 'archive', name: 'Urząd Miasta Krakowa Archiwum' },
    { office: 'government', amenity: 'fire_station', name: 'Urząd Gminy Straż' },
    { amenity: 'townhall', name: 'Urząd Gminy', access: 'private' },
  ]
  for (const t of odrzucone) assert.deepEqual(klasyfikuj(t), [], t.name ?? '(bez nazwy)')
  // nazwa „Mestský úrad" po drugiej stronie granicy nie jest urzędem gminy
  assert.deepEqual(klasyfikuj({ amenity: 'townhall', name: 'Mestský úrad Spišská Stará Ves' }), [])
})

test('zapytanie SQL i lista kluczy wynikają z definicji grup', () => {
  const sql = warunekSql()
  for (const g of GRUPY)
    for (const [k, v] of g.tagi) {
      assert.ok(sql.includes(`map_extract_value(tags, '${k}')`), `${k} w SQL`)
      assert.ok(new RegExp(`'${v}'`).test(sql), `${v} w SQL`)
    }
  // jeden warunek na klucz: amenity ma wszystkie wartości z różnych grup
  assert.match(
    sql,
    /map_extract_value\(tags, 'amenity'\) in \('charging_station', 'bar', 'pub', 'nightclub', 'marketplace', 'townhall'\)/,
  )
  const klucze = kluczeTagow()
  for (const k of [
    'amenity',
    'leisure',
    'office',
    'name',
    'access',
    'indoor',
    'fee',
    'disused',
    'abandoned',
    'motorcar',
    'vehicle',
    'bicycle',
    'bus',
  ])
    assert.ok(klucze.includes(k), k)
  assert.equal(new Set(klucze).size, klucze.length)
  assert.equal(new Set(GRUPY.map((g) => g.id)).size, GRUPY.length)
  for (const g of GRUPY) assert.ok(g.scalM > 0, `${g.id}: promień scalania`)
})

test('klasyfikacja przyjmuje własną listę grup', () => {
  const grupy = [{ id: 'x', tagi: [['shop', 'bakery']], akceptuj: null, scalM: 10 }]
  assert.deepEqual(klasyfikuj({ shop: 'bakery' }, grupy), ['x'])
  assert.deepEqual(klasyfikuj({ amenity: 'bar' }, grupy), [])
  assert.equal(warunekSql(grupy), "map_extract_value(tags, 'shop') in ('bakery')")
})

test('relacje wielokątów: tylko linie zewnętrzne, bez wnętrz, węzłów i innych ról', () => {
  // Plac Nowy: obrys placu (outer) i Okrąglak w środku (inner)
  assert.deepEqual(zewnetrzneLinie(['39243528', '294598892'], ['way', 'way'], ['outer', 'inner']), [
    '39243528',
  ])
  // kilka zewnętrznych linii (np. kilka budynków urzędu), węzeł i członek bez roli odpadają
  assert.deepEqual(
    zewnetrzneLinie(
      ['1', '2', '3', '4', '5'],
      ['way', 'node', 'way', 'way', 'relation'],
      ['outer', 'outer', null, 'outer', 'outer'],
    ),
    ['1', '4'],
  )
  assert.deepEqual(zewnetrzneLinie([], [], []), [])
  // relacja typu site (bez ról) nie daje obrysu
  assert.deepEqual(zewnetrzneLinie(['1', '2'], ['way', 'node'], [null, null]), [])
  // brak tablic ról i typów (węzeł albo linia) nie wywraca funkcji
  assert.deepEqual(zewnetrzneLinie(['1'], undefined, undefined), [])
})

test('nazwy do porównań: wielkość liter i spacje nie mają znaczenia', () => {
  assert.equal(normalizujNazwe('  Pijana   Wiśnia '), 'pijana wiśnia')
  assert.equal(normalizujNazwe('PIJANA WIŚNIA'), normalizujNazwe('Pijana Wiśnia'))
  assert.equal(normalizujNazwe(null), '')
  assert.equal(normalizujNazwe('   '), '')
})

test('scalanie lokali: ta sama nazwa blisko = jeden lokal, różne nazwy w jednej kamienicy zostają', () => {
  const lat = 50.06
  const lon = 19.94
  const wynik = scalPunkty(
    [
      { lat, lon, nazwa: 'Pijana Wiśnia' }, // węzeł
      { lat: naPolnoc(lat, 2), lon, nazwa: 'pijana  wiśnia' }, // ten sam lokal jako budynek, 2 m dalej
      { lat: naPolnoc(lat, 10), lon, nazwa: 'Pijalnia Wódki i Piwa' }, // sąsiedni lokal, 10 m
      { lat: naPolnoc(lat, 12), lon, nazwa: 'Pijana Wiśnia' }, // ten sam lokal, 12 m od węzła: scalony
      { lat: naPolnoc(lat, 500), lon, nazwa: 'Pijana Wiśnia' }, // ta sama sieć, inny adres
      { lat: naPolnoc(lat, 300), lon, nazwa: null }, // bez nazwy: nie ma jak wykazać duplikatu
      { lat: naPolnoc(lat, 300), lon, nazwa: null },
    ],
    25,
    true,
  )
  // Pijana Wiśnia (3 wpisy w 12 m) → 1, Pijalnia → 1, Pijana Wiśnia 500 m → 1, dwa bez nazwy → 2
  assert.equal(wynik.length, 5)
  assert.equal(wynik.filter((p) => p.nazwa === null).length, 2)
  const wisnie = wynik.filter((p) => normalizujNazwe(p.nazwa) === 'pijana wiśnia')
  assert.equal(wisnie.length, 2)
})

test('scalanie bez nazw: łańcuch wpisów do 50 m to jedno miejsce, dalsze osobne', () => {
  const lat = 50.06
  const lon = 19.94
  // przyrządy siłowni co 40 m: A–B 40 m, B–C 40 m, C–D 40 m (łańcuch 120 m), E 300 m dalej
  const przyrzady = [0, 40, 80, 120].map((m) => ({ lat: naPolnoc(lat, m), lon, nazwa: null }))
  const dalej = { lat: naPolnoc(lat, 420), lon, nazwa: null }
  const wynik = scalPunkty([dalej, ...przyrzady], 50)
  assert.equal(wynik.length, 2)
  // środek grupy to średnia, więc leży w środku łańcucha
  const grupa = wynik.find((p) => p.lat < naPolnoc(lat, 200))
  assert.ok(Math.abs(odlegloscMetry(grupa.lat, grupa.lon, naPolnoc(lat, 60), lon)) < 1)
  // 51 m rozdziela, 49 m scala
  assert.equal(
    scalPunkty(
      [
        { lat, lon, nazwa: null },
        { lat: naPolnoc(lat, 51), lon, nazwa: null },
      ],
      50,
    ).length,
    2,
  )
  assert.equal(
    scalPunkty(
      [
        { lat, lon, nazwa: null },
        { lat: naPolnoc(lat, 49), lon, nazwa: null },
      ],
      50,
    ).length,
    1,
  )
})

test('scalanie: wynik nie zależy od kolejności wejścia, puste i pojedyncze wejście działa', () => {
  const lat = 50.06
  const lon = 19.94
  const punkty = [
    { lat, lon, nazwa: 'A' },
    { lat: naPolnoc(lat, 5), lon, nazwa: 'A' },
    { lat: naPolnoc(lat, 6), lon, nazwa: 'B' },
    { lat: naPolnoc(lat, 900), lon, nazwa: 'C' },
  ]
  assert.deepEqual(scalPunkty([...punkty].reverse(), 25, true), scalPunkty(punkty, 25, true))
  assert.deepEqual(scalPunkty([], 25, true), [])
  assert.equal(scalPunkty([punkty[0]], 25).length, 1)
})

test('liczenie w promieniu: punkty w 300 m wliczone, dalsze nie, brzeg włącznie', () => {
  const adres = { lat: 50.06, lon: 19.94 }
  const punkty = [
    { lat: naPolnoc(adres.lat, 100), lon: adres.lon },
    { lat: adres.lat, lon: naWschod(adres.lat, adres.lon, 250) },
    { lat: naPolnoc(adres.lat, 290), lon: adres.lon },
    { lat: naPolnoc(adres.lat, 310), lon: adres.lon }, // za daleko
    { lat: naPolnoc(adres.lat, 1000), lon: adres.lon },
  ]
  assert.deepEqual(policzWPromieniu([adres], punkty, 300), [3])
  // drugi adres 280 m na północ: widzi punkty 100 (180 m), 290 (10 m), 310 (30 m), nie 1000 (720 m);
  // punkt na wschodzie leży w 376 m
  const drugi = { lat: naPolnoc(adres.lat, 280), lon: adres.lon }
  assert.deepEqual(policzWPromieniu([drugi], punkty, 300), [3])
  // adres w środku niczego: zero to zmierzone zero, nie brak danych
  const pusty = { lat: 50.2, lon: 20.3 }
  assert.deepEqual(policzWPromieniu([pusty], punkty, 300), [0])
  // wiele adresów naraz zachowuje kolejność
  assert.deepEqual(policzWPromieniu([pusty, adres, pusty], punkty, 300), [0, 3, 0])
})

test('liczenie w promieniu: granica 300 m we wszystkich kierunkach, miary kuli i elipsoidy różnią się o 0,3%', () => {
  const adres = { lat: 50.06, lon: 19.94 }
  // 295 m (wewnątrz) i 305 m (na zewnątrz) na północ, południe, wschód i zachód. Wzdłuż równoleżnika
  // układ 1992 (elipsoida) daje na tej szerokości o ok. 0,2% więcej niż model kulisty użyty do
  // zbudowania punktów, więc 295 m i 305 m to marginesy bezpieczne w obie strony.
  const w = (dLat, dLon, d) => ({
    lat: dLat ? adres.lat + (dLat * d) / 111_195 : adres.lat,
    lon: dLon ? naWschod(adres.lat, adres.lon, dLon * d) : adres.lon,
  })
  const kierunki = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  const punkty = kierunki.flatMap(([dLat, dLon]) => [w(dLat, dLon, 295), w(dLat, dLon, 305)])
  assert.deepEqual(policzWPromieniu([adres], punkty, 300), [4])
  // dokładnie ten sam wynik dla punktów tylko z zewnątrz i tylko z wewnątrz
  assert.deepEqual(
    policzWPromieniu(
      [adres],
      kierunki.map(([dLat, dLon]) => w(dLat, dLon, 305)),
      300,
    ),
    [0],
  )
  assert.deepEqual(
    policzWPromieniu(
      [adres],
      kierunki.map(([dLat, dLon]) => w(dLat, dLon, 295)),
      300,
    ),
    [4],
  )
})

test('liczenie w promieniu: brak punktów daje zera dla każdego adresu', () => {
  assert.deepEqual(
    policzWPromieniu(
      [
        { lat: 50, lon: 20 },
        { lat: 50.1, lon: 20.1 },
      ],
      [],
      300,
    ),
    [0, 0],
  )
  assert.deepEqual(policzWPromieniu([], [{ lat: 50, lon: 20 }], 300), [])
})

test('skala: górna granica w górę do wielokrotności kroku', () => {
  assert.equal(zaokraglijWGore(2513, 500), 3000)
  assert.equal(zaokraglijWGore(3638, 500), 4000)
  assert.equal(zaokraglijWGore(3993, 500), 4000)
  assert.equal(zaokraglijWGore(4000, 500), 4000)
  assert.equal(zaokraglijWGore(4261, 500), 4500)
  assert.equal(zaokraglijWGore(1, 500), 500)
})
