// Adresy i wyniki budynków 3D z kafli. Uruchom: node --test src/miasto3d/adresyZKafli.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { KafelGotowy } from '../wynik/kafle.ts'
import { adresyZKafli } from './adresyZKafli.ts'

describe('adresyZKafli', () => {
  it('bierze adresy w promieniu, brak danych to NaN (nie 0), bez powtórzeń między kaflami', () => {
    const adres = (i: number, lon: number) => ({ i, lon, lat: 50.06 })
    const kafel = {
      adresy: [adres(5, 19.937), adres(6, 19.9371), adres(7, 21)],
      wskazniki: [],
    } as unknown as KafelGotowy
    const w = adresyZKafli([kafel, kafel], {}, {}, 19.937, 50.06)
    assert.deepEqual(
      w.adresy.map((a) => a.i),
      [5, 6],
    )
    // bez warstw liczonych nie ma wyniku: NaN
    assert.ok(Number.isNaN(w.wyniki[5]))
    assert.equal(w.wyniki[7], undefined)
  })
})
