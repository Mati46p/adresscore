// Stan heksu w feature-state (#223). Uruchom: node --test src/mapa/wykluczenie.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stanHeksu, W_BRAK, W_WYKLUCZONY, wszystkieWykluczone } from './wykluczenie.ts'

describe('stanHeksu (brak danych to W_BRAK, nigdy 0)', () => {
  it('null, undefined i NaN to brak danych', () => {
    assert.equal(stanHeksu(null), W_BRAK)
    assert.equal(stanHeksu(undefined), W_BRAK)
    assert.equal(stanHeksu(Number.NaN), W_BRAK)
  })

  it('prawdziwe zero jest wynikiem, nie brakiem: dostaje kolor skali, nie szrafurę', () => {
    assert.equal(stanHeksu(0), 0)
    assert.notEqual(stanHeksu(0), W_BRAK)
  })

  it('wynik przechodzi bez zmian, także ułamkowy i skrajny', () => {
    for (const w of [0.5, 1, 49.99, 50, 100]) assert.equal(stanHeksu(w), w)
  })

  it('W_BRAK i W_WYKLUCZONY to różne, ujemne stany (brak ≠ wykluczony filtrem)', () => {
    assert.ok(W_BRAK < 0 && W_WYKLUCZONY < 0)
    assert.notEqual(W_BRAK, W_WYKLUCZONY)
    // Wykluczenie przechodzi przez stanHeksu jak zwykła liczba: nie wolno go zamienić na brak.
    assert.equal(stanHeksu(W_WYKLUCZONY), W_WYKLUCZONY)
  })
})

describe('wszystkieWykluczone', () => {
  it('rodzic jest wykluczony tylko, gdy wszystkie jego dzieci są; bez dzieci nie jest', () => {
    const wykluczone = new Set(['a', 'b'])
    assert.equal(wszystkieWykluczone(['a', 'b'], wykluczone), true)
    assert.equal(wszystkieWykluczone(['a', 'c'], wykluczone), false)
    assert.equal(wszystkieWykluczone([], wykluczone), false)
  })
})
