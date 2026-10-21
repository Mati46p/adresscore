// Spójność meta warstw: każde miasto ma tę samą kategorię, kierunek oceny i domyślną wagę co Kraków
// (wzorzec), a jego id warstw są podzbiorem krakowskich (#232). Dane są poza gitem, więc bez
// public/dane test miast się pomija; test czystego modułu działa zawsze.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  POLA_WZORCA,
  PRZENIESIONE,
  TYLKO_W_MIASTACH,
  USUWANE,
  zastosujWzorzec,
} from './lib/meta-wzorzec.mjs'

const DANE = join(fileURLToPath(new URL('..', import.meta.url)), 'public', 'dane')
const indeks = (katalog) =>
  JSON.parse(readFileSync(join(katalog, 'kompakt', 'indeks.json'), 'utf8')).wskazniki

test('zastosujWzorzec nakłada kategorię, kierunek i wagę 0', () => {
  const m = zastosujWzorzec({ id: 'ludnosc_1km', kategoria: 'kontekst', kierunek: 'neutralny' })
  assert.equal(m.kategoria, 'spolecznosc')
  assert.equal(m.kierunek, 'wiecej-lepiej')
  assert.equal(m.domyslnaWaga, 0)
  const inna = { id: 'apteka_odleglosc', kierunek: 'mniej-lepiej' }
  assert.equal(zastosujWzorzec(inna), inna)
})

test('wzorzec nie zawiera usuwanych id i ma poprawne kierunki', () => {
  for (const [id, [kategoria, kierunek]] of Object.entries(PRZENIESIONE)) {
    assert.ok(!USUWANE.includes(id), id)
    assert.ok(['mniej-lepiej', 'wiecej-lepiej'].includes(kierunek), `${id}: ${kierunek}`)
    assert.notEqual(kategoria, 'kontekst', id)
  }
})

const wzorzecIstnieje = existsSync(join(DANE, 'kompakt', 'indeks.json'))
const katalogMiast = join(DANE, 'miasta')
const miasta =
  wzorzecIstnieje && existsSync(katalogMiast)
    ? readdirSync(katalogMiast).filter((m) =>
        existsSync(join(katalogMiast, m, 'kompakt', 'indeks.json')),
      )
    : []

for (const miasto of miasta) {
  test(`meta miasta ${miasto} zgodna z Krakowem`, () => {
    const wzorzec = indeks(DANE)
    const m = indeks(join(katalogMiast, miasto))
    const bledy = []
    for (const [id, w] of Object.entries(m)) {
      const k = wzorzec[id]
      if (!k) {
        if (!(id in TYLKO_W_MIASTACH)) bledy.push(`${id}: id tylko w mieście`)
        continue
      }
      for (const pole of POLA_WZORCA)
        if (w.meta[pole] !== k.meta[pole])
          bledy.push(`${id}.${pole}: miasto ${w.meta[pole]} / Kraków ${k.meta[pole]}`)
    }
    assert.deepEqual(bledy, [])
  })
}
