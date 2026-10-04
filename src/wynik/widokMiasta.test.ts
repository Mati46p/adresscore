// Widoki trybu Dla miasta (#92, #108): który widok otwiera link i jakie widoki zna pasek.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { obiektyDoTekstu } from './symulacjaUrl.ts'
import { czytajHash } from './url.ts'
import { WIDOKI_MIASTA, widokPoczatkowy } from './widokMiasta.ts'

const OBIEKTY = obiektyDoTekstu([{ typ: 'przystanek', lon: 19.9372, lat: 50.0614 }])

/** Widok dla linku, tak jak liczy go ekran Miasto: z obiektów w stanie z linku. */
const widokLinku = (hash: string) => widokPoczatkowy(czytajHash(hash).symulacja ?? { a: '', b: '' })

describe('widok początkowy trybu Miasto', () => {
  it('gołe #/miasto i link do konkretnej luki otwierają luki', () => {
    assert.equal(widokLinku('#/miasto'), 'luki')
    assert.equal(widokLinku('#/miasto?w=przystanek_odleglosc'), 'luki')
    assert.equal(widokLinku('#/miasto?w=halas_ldwn&p=senior'), 'luki')
  })

  it('link z obiektami symulatora (wariant A albo B) otwiera symulator, także ze starego adresu', () => {
    assert.equal(widokLinku(`#/miasto?a=${OBIEKTY}`), 'symulator')
    assert.equal(widokLinku(`#/miasto?b=${OBIEKTY}`), 'symulator')
    assert.equal(widokLinku(`#/symulator?a=${OBIEKTY}&w=przystanek_odleglosc`), 'symulator')
  })

  it('puste parametry a= i b= to nadal luki, a nie pusty symulator', () => {
    assert.equal(widokLinku('#/miasto?a=&b='), 'luki')
  })
})

describe('pasek widoków', () => {
  it('są dokładnie dwa widoki: luki i symulator, każdy z własnym napisem', () => {
    assert.deepEqual(
      WIDOKI_MIASTA.map((w) => w.id),
      ['luki', 'symulator'],
    )
    assert.equal(new Set(WIDOKI_MIASTA.map((w) => w.etykieta)).size, WIDOKI_MIASTA.length)
    for (const w of WIDOKI_MIASTA) assert.ok(w.etykieta.length > 0)
  })
})
