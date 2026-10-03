// Uruchom: node --test src/miasto3d/*.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  chwilaLokalna,
  dzienRoku,
  klatkiZaWolne,
  opisDnia,
  opisGodziny,
  przesuniecieWarszawy,
  wysokoscSlonca,
  znacznikCzasu,
} from './slonce.ts'

const LAT = 50.0617
const LON = 19.9373

describe('czas lokalny Krakowa', () => {
  it('przesunięcie: zimą +60 min, latem +120 min', () => {
    assert.equal(przesuniecieWarszawy(Date.UTC(2026, 11, 21, 12)), 60)
    assert.equal(przesuniecieWarszawy(Date.UTC(2026, 5, 21, 12)), 120)
  })

  it('14:00 w Krakowie to 13:00 UTC zimą i 12:00 UTC latem', () => {
    assert.equal(znacznikCzasu(2026, dzienRoku(2026, 12, 21), 14 * 60), Date.UTC(2026, 11, 21, 13))
    assert.equal(znacznikCzasu(2026, dzienRoku(2026, 6, 21), 14 * 60), Date.UTC(2026, 5, 21, 12))
  })

  it('chwila lokalna odwraca znacznik', () => {
    const t = znacznikCzasu(2026, 100, 9 * 60 + 30)
    assert.deepEqual(chwilaLokalna(t), { rok: 2026, dzien: 100, minuta: 570 })
  })

  it('opisy po polsku', () => {
    assert.equal(opisDnia(2026, dzienRoku(2026, 12, 21)), '21 grudnia')
    assert.equal(opisGodziny(14 * 60 + 5), '14:05')
  })
})

describe('wysokość słońca nad Krakowem', () => {
  it('przesilenie letnie w południe słoneczne ≈ 63,4°', () => {
    // Południe słoneczne w Krakowie ≈ 10:40 UTC.
    const h = wysokoscSlonca(Date.UTC(2026, 5, 21, 10, 40), LAT, LON)
    assert.ok(Math.abs(h - 63.4) < 1, `${h}`)
  })

  it('przesilenie zimowe w południe ≈ 16,5°, a o 16:00 słońce już zaszło', () => {
    const poludnie = wysokoscSlonca(Date.UTC(2026, 11, 21, 10, 40), LAT, LON)
    assert.ok(Math.abs(poludnie - 16.5) < 1, `${poludnie}`)
    const szesnasta = wysokoscSlonca(
      znacznikCzasu(2026, dzienRoku(2026, 12, 21), 16 * 60),
      LAT,
      LON,
    )
    assert.ok(szesnasta < 0, `${szesnasta}`)
  })
})

describe('bezpiecznik klatek', () => {
  it('za mała próbka niczego nie wyłącza', () => {
    assert.equal(klatkiZaWolne([100, 100, 100]), false)
  })
  it('60 kl./s przechodzi, 20 kl./s wyłącza cień', () => {
    assert.equal(klatkiZaWolne(Array(30).fill(16.7)), false)
    assert.equal(klatkiZaWolne(Array(30).fill(50)), true)
  })
  it('pojedyncze przycięcia nie wyłączają cienia (mediana, nie średnia)', () => {
    assert.equal(klatkiZaWolne([...Array(25).fill(16), 400, 400, 400]), false)
  })
})
