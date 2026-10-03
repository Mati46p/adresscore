import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DANE } from './lib/wspolne.mjs'

test('MPZP: status i szczegóły odnoszą się do tych samych punktów adresowych', () => {
  const adresy = JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8'))
  const status = JSON.parse(readFileSync(join(DANE, 'wskazniki/mpzp_status.json'), 'utf8'))
  const katalog = JSON.parse(readFileSync(join(DANE, 'mpzp_adresy.json'), 'utf8'))
  const teryty = adresy.kolumny.teryt

  assert.equal(status.wersjaAdresow, adresy.wersja)
  assert.equal(katalog.wersjaAdresow, adresy.wersja)
  assert.equal(status.wartosci.length, teryty.length)
  assert.equal(status.etykiety.length, teryty.length)
  assert.equal(katalog.adresy.length, teryty.length)
  assert.equal(status.meta.kierunek, 'neutralny')
  assert.equal(status.meta.kategoria, 'kontekst')
  assert.equal(status.meta.zrodla[0].dataDanych, katalog.dataDanych)

  let objetePlanem = 0
  let bezPlanu = 0
  for (let i = 0; i < teryty.length; i++) {
    const v = status.wartosci[i]
    const refs = katalog.adresy[i]
    if (teryty[i] !== '1261011') {
      assert.equal(v, null)
      assert.equal(status.etykiety[i], null)
      assert.equal(refs, null)
    } else if (v === 0) {
      bezPlanu++
      assert.equal(status.etykiety[i], 'Brak obowiązującego planu w punkcie adresu')
      assert.equal(refs, null)
    } else {
      assert.equal(v, 1)
      objetePlanem++
      assert.match(status.etykiety[i], /^(Plan obowiązuje:|Nakładające się plany)/)
      assert.ok(Array.isArray(refs) && refs.length >= 1)
      const obiekty = refs.map((n) => {
        assert.ok(Number.isInteger(n) && n >= 0 && n < katalog.slownik.length)
        return katalog.slownik[n]
      })
      assert.ok(obiekty.some((x) => x.typ === 'plan' && x.www?.includes('bip.krakow.pl')))
      for (const obiekt of obiekty) {
        assert.ok(['plan', 'teren'].includes(obiekt.typ))
        assert.match(obiekt.www, /^https?:\/\//)
      }
    }
  }
  assert.ok(objetePlanem > 0)
  assert.ok(bezPlanu > 0)
})
