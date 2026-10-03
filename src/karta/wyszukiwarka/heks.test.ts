import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js'
import type { Adres } from '../../kontrakty/index.ts'
import { adresWKliknietymHeksie } from './heks.ts'

const h3 = latLngToCell(50.06, 19.94, 10)
const [lat, lon] = cellToLatLng(h3)
const sasiedni = gridDisk(h3, 1).find((h) => h !== h3) as string
const [latSasiada, lonSasiada] = cellToLatLng(sasiedni)

const adres = (i: number, hex: string, x: number, y: number): Adres =>
  ({ i, h3: hex, lon: x, lat: y }) as Adres

test('nie wybiera najbliższego adresu z sąsiedniego heksu', () => {
  const wynik = adresWKliknietymHeksie([adres(1, sasiedni, lonSasiada, latSasiada)], lon, lat)
  assert.deepEqual(wynik, { h3, adres: null })
})

test('wybiera reprezentanta najbliższego kliknięciu w tym samym heksie', () => {
  const bliski = adres(2, h3, lon, lat)
  const dalszy = adres(3, h3, lon + 0.0001, lat)
  assert.equal(adresWKliknietymHeksie([dalszy, bliski], lon, lat).adres?.i, 2)
})
