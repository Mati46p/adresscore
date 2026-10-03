import assert from 'node:assert/strict'
import { test } from 'node:test'
import { odlegloscMetry } from './lib/codziennosc-geo.mjs'
import {
  budujNajblizszy,
  GRUPY,
  KLUCZE_TAGOW,
  klasyfikuj,
  komorkaDla,
  liczbaPL,
  licznikNa1000,
  obiektyWGminach,
  odleglosci,
  paczkomaty,
  punktyBrzegu,
  scalDuplikaty,
  srodekLinii,
  warunekSql,
} from './lib/osm-uslugi.mjs'

test('klasyfikacja: bankomat i poczta w jednej grupie, punkty kurierskie odpadają', () => {
  assert.deepEqual(klasyfikuj({ amenity: 'atm' }), ['bankomat_poczta'])
  assert.deepEqual(klasyfikuj({ amenity: 'post_office', operator: 'Poczta Polska SA' }), [
    'bankomat_poczta',
  ])
  assert.deepEqual(klasyfikuj({ amenity: 'post_office', operator: 'InPost' }), [])
  assert.deepEqual(klasyfikuj({ amenity: 'post_office', operator: 'DPD Polska' }), [])
  assert.deepEqual(klasyfikuj({ amenity: 'bank' }), [])
})

test('klasyfikacja: kultura bierze domy kultury po nazwie, nie świetlice i domy parafialne', () => {
  for (const amenity of ['theatre', 'cinema', 'arts_centre', 'library'])
    assert.deepEqual(klasyfikuj({ amenity }), ['kultura'], amenity)
  assert.deepEqual(klasyfikuj({ tourism: 'museum' }), ['kultura'])
  assert.deepEqual(klasyfikuj({ tourism: 'gallery' }), ['kultura'])
  assert.deepEqual(klasyfikuj({ amenity: 'community_centre', name: 'Gminny Ośrodek Kultury' }), [
    'kultura',
  ])
  assert.deepEqual(
    klasyfikuj({ amenity: 'community_centre', community_centre: 'cultural_centre' }),
    ['kultura'],
  )
  assert.deepEqual(
    klasyfikuj({ amenity: 'community_centre', name: 'Świetlica wiejska w Łękach' }),
    [],
  )
  assert.deepEqual(klasyfikuj({ amenity: 'library', access: 'private' }), [])
})

test('klasyfikacja: place zabaw, toalety i woda tylko ogólnodostępne', () => {
  assert.deepEqual(klasyfikuj({ leisure: 'playground' }), ['plac_zabaw'])
  assert.deepEqual(klasyfikuj({ leisure: 'playground', access: 'yes' }), ['plac_zabaw'])
  for (const access of ['private', 'customers', 'no', 'permit'])
    assert.deepEqual(klasyfikuj({ leisure: 'playground', access }), [], access)
  assert.deepEqual(klasyfikuj({ amenity: 'toilets' }), ['toaleta_woda'])
  assert.deepEqual(klasyfikuj({ amenity: 'drinking_water', access: 'yes' }), ['toaleta_woda'])
  assert.deepEqual(klasyfikuj({ amenity: 'toilets', access: 'customers' }), [])
})

test('klasyfikacja: sale zabaw, trampoliny i płatne atrakcje to nie place zabaw', () => {
  assert.deepEqual(klasyfikuj({ leisure: 'playground', name: 'Plac zabaw przy szkole' }), [
    'plac_zabaw',
  ])
  assert.deepEqual(klasyfikuj({ leisure: 'playground', indoor: 'yes' }), [])
  assert.deepEqual(klasyfikuj({ leisure: 'playground', fee: 'yes' }), [])
  assert.deepEqual(klasyfikuj({ leisure: 'playground', fee: 'no' }), ['plac_zabaw'])
  for (const name of [
    'Sala Zabaw Na Fali',
    'Bawialnia Chwilka',
    'Park Linowy ABlandia',
    'Trampoliny',
  ])
    assert.deepEqual(klasyfikuj({ leisure: 'playground', name }), [], name)
})

test('klasyfikacja: woda niezdatna do picia odpada, toaleta płatna zostaje', () => {
  assert.deepEqual(klasyfikuj({ amenity: 'drinking_water', drinking_water: 'yes' }), [
    'toaleta_woda',
  ])
  assert.deepEqual(klasyfikuj({ amenity: 'drinking_water', drinking_water: 'no' }), [])
  assert.deepEqual(klasyfikuj({ amenity: 'drinking_water', 'drinking_water:legal': 'no' }), [])
  assert.deepEqual(klasyfikuj({ amenity: 'toilets', fee: 'yes' }), ['toaleta_woda'])
})

test('klasyfikacja: defibrylator wymaga dostępu publicznego, bez tagu tylko poza budynkiem', () => {
  assert.deepEqual(klasyfikuj({ emergency: 'defibrillator', access: 'yes' }), ['defibrylator'])
  assert.deepEqual(klasyfikuj({ emergency: 'defibrillator', access: 'yes', indoor: 'yes' }), [
    'defibrylator',
  ])
  assert.deepEqual(klasyfikuj({ emergency: 'defibrillator', access: 'permissive' }), [
    'defibrylator',
  ])
  assert.deepEqual(klasyfikuj({ emergency: 'defibrillator' }), ['defibrylator'])
  assert.deepEqual(klasyfikuj({ emergency: 'defibrillator', indoor: 'no' }), ['defibrylator'])
  assert.deepEqual(klasyfikuj({ emergency: 'defibrillator', indoor: 'yes' }), [])
  for (const access of ['customers', 'private', 'permit'])
    assert.deepEqual(klasyfikuj({ emergency: 'defibrillator', access }), [], access)
})

test('klasyfikacja: recykling, ROD, weterynarz, akademik', () => {
  assert.deepEqual(klasyfikuj({ amenity: 'recycling', recycling_type: 'container' }), ['recykling'])
  assert.deepEqual(klasyfikuj({ amenity: 'recycling', access: 'private' }), [])
  assert.deepEqual(klasyfikuj({ landuse: 'allotments' }), ['rod'])
  assert.deepEqual(klasyfikuj({ amenity: 'veterinary' }), ['weterynarz'])
  assert.deepEqual(klasyfikuj({ building: 'dormitory', name: 'Dom Studencki Piast' }), ['akademik'])
  assert.deepEqual(klasyfikuj({ building: 'dormitory' }), ['akademik'])
  assert.deepEqual(klasyfikuj({ amenity: 'student_accommodation', name: 'Basecamp' }), ['akademik'])
  for (const name of [
    'Internat Zespołu Szkół nr 1',
    'Bursa Młodzieży Żeńskiej',
    'Stołówka internatu',
  ])
    assert.deepEqual(klasyfikuj({ building: 'dormitory', name }), [], name)
  assert.deepEqual(klasyfikuj({ amenity: 'coworking_space' }), [], 'coworking odpadł z zakresu')
})

test('klasyfikacja: obiekt z dwoma tagami trafia do obu grup, nieznany do żadnej', () => {
  assert.deepEqual(
    klasyfikuj({ amenity: 'library', building: 'dormitory', name: 'Dom Studencki' }),
    ['kultura', 'akademik'],
  )
  assert.deepEqual(klasyfikuj({ shop: 'supermarket' }), [])
  assert.deepEqual(klasyfikuj({}), [])
})

test('zapytanie SQL i lista kluczy wynikają z definicji grup', () => {
  const sql = warunekSql()
  for (const g of GRUPY)
    for (const [k, v] of g.tagi) {
      assert.ok(sql.includes(`map_extract_value(tags, '${k}')`), `${k} w SQL`)
      assert.ok(new RegExp(`'${v}'`).test(sql), `${v} w SQL`)
    }
  for (const k of [
    'amenity',
    'access',
    'name',
    'operator',
    'indoor',
    'fee',
    'community_centre',
    'drinking_water',
    'drinking_water:legal',
  ])
    assert.ok(KLUCZE_TAGOW.includes(k), k)
  assert.equal(new Set(KLUCZE_TAGOW).size, KLUCZE_TAGOW.length)
  assert.equal(new Set(GRUPY.map((g) => g.id)).size, GRUPY.length)
})

test('środek linii: zamknięty kwadrat bez podwójnego liczenia pierwszego punktu', () => {
  const [lat, lon] = srodekLinii([50, 50, 50.002, 50.002, 50], [20, 20.002, 20.002, 20, 20])
  assert.ok(Math.abs(lat - 50.001) < 1e-9)
  assert.ok(Math.abs(lon - 20.001) < 1e-9)
  // linia otwarta liczy wszystkie wierzchołki
  const [aLat] = srodekLinii([50, 50.002, 50.004], [20, 20, 20])
  assert.ok(Math.abs(aLat - 50.002) < 1e-9)
})

test('obrys: punkty co najwyżej co 50 m wzdłuż krawędzi, z wierzchołkami', () => {
  // krawędź ok. 111 m (0,001° szerokości) -> 3 odcinki po ok. 37 m + wierzchołek końcowy
  const p = punktyBrzegu([50, 50.001], [20, 20], 50)
  assert.equal(p.length, 4)
  assert.deepEqual(p[0], [50, 20])
  assert.deepEqual(p[3], [50.001, 20])
  for (let i = 1; i < p.length; i++)
    assert.ok(odlegloscMetry(...p[i - 1], ...p[i]) <= 50 + 1e-6, `odcinek ${i}`)
  // pojedynczy punkt i pusta lista nie wywracają funkcji
  assert.deepEqual(punktyBrzegu([50], [20]), [[50, 20]])
  assert.deepEqual(punktyBrzegu([], []), [])
})

test('obrys ogrodu: odległość do granicy, nie do środka', () => {
  // kwadrat ok. 220 m x 140 m; adres 70 m na wschód od krawędzi, na wysokości środka
  const lats = [50, 50, 50.002, 50.002, 50]
  const lons = [20, 20.002, 20.002, 20, 20]
  const brzeg = punktyBrzegu(lats, lons, 50).map(([lat, lon]) => ({ lat, lon }))
  const [sLat, sLon] = srodekLinii(lats, lons)
  const adres = { lat: sLat, lon: 20.002 + 70 / (111_195 * Math.cos((sLat * Math.PI) / 180)) }
  const doBrzegu = odleglosci([adres], brzeg, 30_000)[0]
  const doSrodka = Math.round(odlegloscMetry(adres.lat, adres.lon, sLat, sLon))
  // Błąd zagęszczenia: do połowy kroku wzdłuż krawędzi (22 m), czyli najwyżej ok. 4 m w poprzek.
  assert.ok(doBrzegu >= 70 && doBrzegu <= 75, `do brzegu ${doBrzegu}`)
  assert.ok(doSrodka > 120, `do środka ${doSrodka}`)
})

test('scalanie duplikatów: węzeł i budynek tego samego obiektu to jeden punkt', () => {
  const wynik = scalDuplikaty([
    { lat: 50.06, lon: 19.94, nazwa: 'Biblioteka' },
    { lat: 50.06001, lon: 19.94001, nazwa: null }, // ok. 1 m dalej
    { lat: 50.061, lon: 19.94, nazwa: 'Inna biblioteka' }, // ok. 111 m dalej
    { lat: 50.0501, lon: 19.94, nazwa: 'Daleko' },
  ])
  assert.equal(wynik.length, 3)
  // kolejność wejścia nie zmienia wyniku
  const odwrotnie = scalDuplikaty(
    [
      { lat: 50.0501, lon: 19.94, nazwa: 'Daleko' },
      { lat: 50.061, lon: 19.94, nazwa: 'Inna biblioteka' },
      { lat: 50.06001, lon: 19.94001, nazwa: null },
      { lat: 50.06, lon: 19.94, nazwa: 'Biblioteka' },
    ],
    25,
  )
  assert.deepEqual(odwrotnie, wynik)
})

test('najbliższy obiekt: wartości w metrach, null poza promieniem, nigdy 0 dla braku', () => {
  const punkty = [
    { lat: 50.001, lon: 20 },
    { lat: 50.2, lon: 19.7 },
  ]
  const adresy = [
    { lat: 50, lon: 20 },
    { lat: 50.3, lon: 19.3 },
  ]
  const [bliski, daleki] = odleglosci(adresy, punkty, 20_000)
  assert.ok(Math.abs(bliski - 111) <= 1, `bliski ${bliski}`)
  assert.equal(daleki, null)
  assert.equal(budujNajblizszy(punkty, 20_000)(50.0001, 20).punkt, punkty[0])
})

test('komórka indeksu rośnie, gdy punktów jest mało', () => {
  assert.ok(komorkaDla(10) > komorkaDla(1000))
  assert.ok(komorkaDla(1000) > komorkaDla(10_000))
  assert.equal(komorkaDla(10_000), 500)
})

test('licznik na 1000 mieszkańców: osobno Kraków i reszta, obiekty poza gminami odpadają', () => {
  const adresy = [
    { lat: 50.06, lon: 19.94, teryt: '1261011' },
    { lat: 50.1, lon: 20.2, teryt: '1214012' },
  ]
  const najblizszyAdres = budujNajblizszy(adresy, 1000)
  const obiekty = [
    { lat: 50.0601, lon: 19.94 }, // Kraków
    { lat: 50.0602, lon: 19.94 }, // Kraków
    { lat: 50.1001, lon: 20.2 }, // Koniusza
    { lat: 50.5, lon: 21 }, // daleko od adresów, nie liczy się
  ]
  const wg = obiektyWGminach(obiekty, najblizszyAdres)
  assert.equal(wg.get('1261011'), 2)
  assert.equal(wg.get('1214012'), 1)
  const l = licznikNa1000(
    wg,
    new Map([
      ['1261011', 1000],
      ['1214012', 500],
    ]),
    '1261011',
  )
  assert.equal(l.krakow.na1000, 2)
  assert.equal(l.obwarzanek.na1000, 2)
  assert.equal(l.krakow.obiekty, 2)
  assert.equal(l.obwarzanek.mieszkancy, 500)
})

test('liczba po polsku: przecinek, dwa miejsca poniżej 0,1', () => {
  assert.equal(liczbaPL(0.94), '0,9')
  assert.equal(liczbaPL(3), '3,0')
  assert.equal(liczbaPL(0.043), '0,04')
  assert.equal(liczbaPL(0), '0,0')
})

test('InPost: tylko paczkomaty (parcel_locker) w użyciu, punkty obsługi i stare wpisy odpadają', () => {
  const punkt = (name, type, lat, lon, status = 'Operating') => ({
    name,
    type,
    status,
    location: { latitude: lat, longitude: lon },
  })
  const wynik = paczkomaty([
    punkt('KRA10M', ['parcel_locker'], 50.06, 19.94),
    punkt('KRA11M', ['parcel_locker', 'parcel_locker_superpop', 'pok', 'pop'], 50.05, 19.95),
    punkt('KRA12P', ['pok', 'pop', 'pudo_mini'], 50.07, 19.96),
    punkt('KRA13M', ['parcel_locker'], 50.08, 19.97, 'Disabled'),
    { name: 'KRA14M', type: ['parcel_locker'], status: 'Operating', location: null },
    { name: 'KRA15M', status: 'Operating', location: { latitude: 50, longitude: 20 } },
  ])
  assert.deepEqual(
    wynik.map((p) => p.nazwa),
    ['KRA11M', 'KRA10M'],
  )
  assert.equal(wynik[0].lat, 50.05)
})
