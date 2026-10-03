// Uruchom: node --test src/miasto3d/*.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { grupa, liczbyGrup, opisDaty, pozwoleniaWokol, zGeojson } from './pozwolenia.ts'

const LON = 19.937
const LAT = 50.0617

const geojson = {
  features: [
    {
      geometry: { type: 'Point', coordinates: [LON + 0.001, LAT] },
      properties: { d: '2025-02-04', r: 'dom jednorodzinny', z: 'budowa', o: 'Budowa domu' },
    },
    {
      geometry: { type: 'Point', coordinates: [LON, LAT + 0.002] },
      properties: { d: '2025-11-13', r: 'obiekt usługowy', z: 'rozbudowa' },
    },
    {
      geometry: { type: 'Point', coordinates: [LON + 0.05, LAT] },
      properties: { d: '2025-01-01', r: 'budynek wielorodzinny', z: 'budowa' },
    },
    { geometry: null, properties: { r: 'inny' } },
  ],
}

describe('pozwolenia', () => {
  const wszystkie = zGeojson(geojson)

  it('pomija cechy bez punktu, brak opisu to null', () => {
    assert.equal(wszystkie.length, 3)
    assert.equal(wszystkie[1]?.opis, null)
  })

  it('tylko w promieniu 500 m', () => {
    assert.deepEqual(
      pozwoleniaWokol(wszystkie, LON, LAT).map((p) => p.data),
      ['2025-02-04', '2025-11-13'],
    )
  })

  it('grupy rodzajów z danych #27', () => {
    assert.equal(grupa('dom jednorodzinny'), 'mieszkaniowe')
    assert.equal(grupa('budynek wielorodzinny'), 'mieszkaniowe')
    assert.equal(grupa('budynek mieszkalno-usługowy'), 'mieszkaniowe')
    assert.equal(grupa('obiekt usługowy'), 'uslugowe')
    assert.equal(grupa('obiekt publiczny'), 'uslugowe')
    assert.equal(grupa('inny'), 'inne')
  })

  it('liczby grup sumują się do liczby pozwoleń', () => {
    const l = liczbyGrup(wszystkie)
    assert.equal(l.mieszkaniowe + l.uslugowe + l.inne, wszystkie.length)
  })

  it('data po polsku', () => {
    assert.equal(opisDaty('2025-02-04'), '4 lutego 2025')
    assert.equal(opisDaty(''), 'data nieznana')
  })
})
