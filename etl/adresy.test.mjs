import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { isValidCell } from 'h3-js'
import { zPrg } from './adresy.mjs'
import { DANE, wersjaAdresow } from './lib/wspolne.mjs'

test('PRG WFS EPSG:2180 ma odwróconą kolejność osi GML i trafia w okolice Krakowa', () => {
  const [adres] = zPrg([
    {
      id: 'a618c99a-ba2a-4be5-9f8b-90e32fb65d84',
      gmina: 'Liszki',
      teryt: '1206072',
      miejscowosc: 'Jeziorzany',
      ulica: null,
      nr: '229',
      kod: '32-060',
      x: 555515.74,
      y: 236818.97,
    },
  ])
  assert.equal(adres.id, 'prg-a618c99a-ba2a-4be5-9f8b-90e32fb65d84')
  assert.equal(adres.lon, 19.774807)
  assert.equal(adres.lat, 49.996068)
  assert.equal(adres.ulica, null)
  assert.ok(isValidCell(adres.h3))
})

test('public/dane/adresy.json zawiera prawdziwe MSIP i 13 gmin PRG', () => {
  const plik = JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8'))
  const k = plik.kolumny
  const n = k.id.length
  assert.equal(plik.atrapa, undefined)
  assert.ok(n > 70217)
  assert.ok(k.id.filter((id) => id.startsWith('msip-')).length >= 70000)
  assert.equal(new Set(k.id).size, n)
  for (const kolumna of Object.values(k)) assert.equal(kolumna.length, n)
  assert.equal(wersjaAdresow(k), plik.wersja)
  assert.equal(new Set(k.gmina).size, 14)
  assert.ok(k.teryt.every((teryt) => /^\d{7}$/u.test(teryt)))
  for (let i = 0; i < n; i++) {
    assert.ok(k.lon[i] > 19 && k.lon[i] < 21)
    assert.ok(k.lat[i] > 49 && k.lat[i] < 51)
    assert.ok(isValidCell(k.h3[i]))
  }
  assert.ok(plik.zrodla.every((z) => z.url.startsWith('https://') && z.dataDanych))
})
