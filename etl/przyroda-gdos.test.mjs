import assert from 'node:assert/strict'
import test from 'node:test'
import { do2180, IndeksWielokatow } from './lib/geo.mjs'
import {
  bboxPobierania,
  czyOtulina,
  etykietaObszaru,
  FORMY,
  metryDoObszaru,
  wielokatyForm,
} from './przyroda-gdos.mjs'

const kwadrat = (lon, lat, bok = 0.01) => [
  [
    [lon, lat],
    [lon + bok, lat],
    [lon + bok, lat + bok],
    [lon, lat + bok],
    [lon, lat],
  ],
]
const obiekt = (id, nazwa, geometria) => ({
  type: 'Feature',
  id,
  geometry: geometria,
  properties: { gid: 1, nazwa, kodinspire: 'PL.ZIPOP.1393.RP.1' },
})
const REZERWAT = FORMY.find((f) => f.warstwa === 'Rezerwaty')
const PARK = FORMY.find((f) => f.warstwa === 'ParkiKrajobrazowe')

test('czyOtulina: otulina to strefa buforowa, więc odpada; sama nazwa obszaru zostaje', () => {
  assert.equal(czyOtulina('Dolina Potoku Rudno - otulina'), true)
  assert.equal(czyOtulina('Ojcowski Park Narodowy - Otulina'), true)
  assert.equal(czyOtulina('Dolinki Krakowskie'), false)
  assert.equal(czyOtulina(null), false)
})

test('wielokatyForm: pomija otuliny, rozbija MultiPolygon, niesie nazwę, rodzaj i pierwszeństwo', () => {
  const { wielokaty, otuliny } = wielokatyForm(
    [
      obiekt('a', 'Skałki Przegorzalskie', { type: 'Polygon', coordinates: kwadrat(19.87, 50.04) }),
      obiekt('b', 'Skałki Przegorzalskie - otulina', {
        type: 'Polygon',
        coordinates: kwadrat(19.86, 50.03, 0.03),
      }),
      obiekt('c', 'Dwuczęściowy', {
        type: 'MultiPolygon',
        coordinates: [kwadrat(20.0, 50.0), kwadrat(20.1, 50.0)],
      }),
      obiekt('d', null, { type: 'Polygon', coordinates: kwadrat(20.2, 50.0) }),
    ],
    REZERWAT,
  )
  assert.equal(otuliny, 1)
  assert.equal(wielokaty.length, 4)
  assert.deepEqual(wielokaty[0].dane, {
    nazwa: 'Skałki Przegorzalskie',
    rodzaj: 'rezerwat przyrody',
    priorytet: 2,
  })
  assert.equal(wielokaty[3].dane.nazwa, null)
  assert.throws(
    () => wielokatyForm([obiekt('x', 'Bez geometrii', null)], REZERWAT),
    /bez geometrii/,
  )
})

test('adres w obrębie obszaru = 0, tuż za granicą co najmniej 1 m; etykieta z rodzajem i nazwą', () => {
  const { wielokaty } = wielokatyForm(
    [obiekt('a', 'Skałki Przegorzalskie', { type: 'Polygon', coordinates: kwadrat(19.87, 50.04) })],
    REZERWAT,
  )
  const indeks = new IndeksWielokatow(wielokaty)
  const [xw, yw] = do2180(19.875, 50.045)
  const wewnatrz = indeks.najblizszy(xw, yw, 25_000)
  assert.equal(metryDoObszaru(wewnatrz.odleglosc), 0)
  assert.equal(
    etykietaObszaru(wielokaty[wewnatrz.wielokat].dane),
    'rezerwat przyrody: Skałki Przegorzalskie',
  )
  // 0,5 km na wschód od wschodniej granicy (lon 19.88): ok. 0,5 km, nie 0
  const [xz, yz] = do2180(19.88 + 0.5 / 71.5, 50.045)
  const poza = indeks.najblizszy(xz, yz, 25_000)
  assert.ok(Math.abs(poza.odleglosc - 500) < 10, `odległość ${poza.odleglosc}`)
  assert.equal(metryDoObszaru(0.3), 1)
  assert.equal(metryDoObszaru(1234.6), 1235)
  assert.equal(etykietaObszaru({ nazwa: null, rodzaj: 'użytek ekologiczny' }), 'użytek ekologiczny')
})

test('w obrębie parku krajobrazowego i rezerwatu naraz etykieta wskazuje ostrzejszą ochronę', () => {
  const rezerwat = wielokatyForm(
    [obiekt('r', 'Skałki', { type: 'Polygon', coordinates: kwadrat(19.87, 50.04, 0.005) })],
    REZERWAT,
  ).wielokaty
  const park = wielokatyForm(
    [
      obiekt('p', 'Bielańsko-Tyniecki', {
        type: 'Polygon',
        coordinates: kwadrat(19.85, 50.03, 0.05),
      }),
    ],
    PARK,
  ).wielokaty
  const indeks = new IndeksWielokatow([...park, ...rezerwat])
  const [x, y] = do2180(19.8725, 50.0425)
  const wynik = indeks.najblizszy(x, y, 25_000)
  assert.equal(wynik.odleglosc, 0)
  assert.equal(
    etykietaObszaru([...park, ...rezerwat][wynik.wielokat].dane),
    'rezerwat przyrody: Skałki',
  )
})

test('bboxPobierania: zakres adresów powiększony o margines, zaokrąglony do 0,01°', () => {
  const bbox = bboxPobierania(
    [
      { lon: 19.653461, lat: 49.888085 },
      { lon: 20.363227, lat: 50.245059 },
      { lon: 19.9, lat: 50.0 },
    ],
    { lon: 0.4, lat: 0.25 },
  )
  assert.deepEqual(bbox, [19.25, 49.64, 20.76, 50.5])
})
