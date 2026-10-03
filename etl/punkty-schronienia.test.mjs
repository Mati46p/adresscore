import assert from 'node:assert/strict'
import { test } from 'node:test'
import { csv, indeksPunktow, najblizszyPunkt, punktyKrakowa } from './punkty-schronienia.mjs'

const NAGLOWEK =
  'Identyfikator publiczny,Nazwa,Rodzaj obiektu,Opis ogolny,Gmina,Powiat,Wojewodztwo,Szerokosc geograficzna,Dlugosc geograficzna,Adres,Dostepnosc\r\n'

test('CSV KG PSP zachowuje przecinek w adresie, BOM i CRLF', () => {
  const rekord = `${NAGLOWEK}OZO-123,Miejsce ochronne,Obiekt ochrony ludności,,Kraków,Kraków,małopolskie,50.06,19.94,"ul. Testowa 1, Kraków",Na żądanie\r\n`
  const wynik = punktyKrakowa(`\uFEFF${rekord}`)
  assert.equal(wynik.features[0].properties.adres, 'ul. Testowa 1, Kraków')
  assert.deepEqual(wynik.features[0].geometry.coordinates, [19.94, 50.06])
  assert.equal(wynik.features[0].properties.dostepnosc, 'Na żądanie')
})

test('tylko gmina Kraków i błędna geometria zatrzymuje eksport', () => {
  const dobra =
    'OZO-123,Miejsce ochronne,Obiekt ochrony ludności,,Kraków,Kraków,małopolskie,50.06,19.94,Test,Całodobowa\r\n'
  const obca =
    'OZO-456,Miejsce ochronne,Obiekt ochrony ludności,,Wieliczka,wielicki,małopolskie,49.98,20.06,Test,Całodobowa\r\n'
  assert.equal(punktyKrakowa(NAGLOWEK + dobra + obca).features.length, 1)
  assert.throws(() => punktyKrakowa(NAGLOWEK + dobra + dobra), /duplikat/)
  assert.throws(() => punktyKrakowa(NAGLOWEK + dobra.replace('50.06', '0')), /poza Krakowem/)
})

test('ucięty albo zmieniony schemat CSV jest odrzucany', () => {
  assert.throws(() => csv(`${NAGLOWEK}OZO-123,"niezamknięty`), /niedomknięty/)
  assert.throws(() => punktyKrakowa('id,lat,lon\na,50,19\n'), /schemat/)
})

test('odległość jest w linii prostej tylko dla adresu w Krakowie', () => {
  const features = [
    { id: 'bliski', geometry: { coordinates: [19.94, 50.06] } },
    { id: 'daleki', geometry: { coordinates: [20.04, 50.06] } },
  ]
  const indeks = indeksPunktow(features)
  const trafienie = najblizszyPunkt({ gmina: 'Kraków', lat: 50.0601, lon: 19.94 }, features, indeks)
  assert.equal(trafienie.punkt.id, 'bliski')
  assert.ok(trafienie.metry > 10 && trafienie.metry < 12)
  assert.equal(
    najblizszyPunkt({ gmina: 'Wieliczka', lat: 50.0601, lon: 19.94 }, features, indeks),
    null,
  )
})
