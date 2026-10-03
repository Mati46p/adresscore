import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { DANE } from './lib/wspolne.mjs'
import { PRZENIESIONE } from './uprosc-kryteria.mjs'

const dane = (sciezka) => JSON.parse(readFileSync(join(DANE, sciezka), 'utf8'))

test('wynik E8 i szczegóły odnoszą się do tej samej szkoły i wersji adresów', () => {
  const adresy = dane('adresy.json')
  const wskaznik = dane('wskazniki/szkola_podst_wynik_e8.json')
  const szczegoly = dane('szkoly_e8_szczegoly.json')
  const n = adresy.kolumny.id.length
  assert.equal(wskaznik.wersjaAdresow, adresy.wersja)
  assert.equal(szczegoly.wersjaAdresow, adresy.wersja)
  assert.equal(wskaznik.wartosci.length, n)
  assert.equal(szczegoly.najblizsza.length, n)
  assert.equal(szczegoly.odleglosciM.length, n)
  // Od #171 grupę i kierunek nadaje PRZENIESIONE (etl/uprosc-kryteria.mjs), z wagą startową 0.
  const przeniesione = PRZENIESIONE.szkola_podst_wynik_e8
  assert.deepEqual([wskaznik.meta.kategoria, wskaznik.meta.kierunek], przeniesione)
  assert.equal(wskaznik.meta.domyslnaWaga, 0)

  let zDanymi = 0
  let brak = 0
  for (let i = 0; i < n; i++) {
    const wartosc = wskaznik.wartosci[i]
    const indeks = szczegoly.najblizsza[i]
    const odleglosc = szczegoly.odleglosciM[i]
    if (wartosc === null) {
      assert.equal(indeks, null)
      assert.equal(odleglosc, null)
      brak++
      continue
    }
    const szkola = szczegoly.szkoly[indeks]
    assert.ok(szkola, `Brak szkoły dla adresu ${i}`)
    assert.equal(wartosc, szkola.wynik)
    assert.ok(odleglosc >= 0 && odleglosc <= 1500)
    zDanymi++
  }
  assert.ok(zDanymi > 0 && brak > 0)
})
