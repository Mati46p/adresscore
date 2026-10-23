// Uruchom: node --test src/karta/arkusz/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { najblizszyProg, predkosc, przesunieciaStanow, zGumka } from './fizykaArkusza.ts'

const progi = [0, 300, 600]

describe('najblizszyProg', () => {
  it('wolne puszczenie bierze najbliższy próg', () => {
    assert.equal(najblizszyProg(280, 0.1, progi), 300)
    assert.equal(najblizszyProg(100, -0.2, progi), 0)
  })
  it('rzut w górę przeskakuje najbliższy próg', () => {
    assert.equal(najblizszyProg(590, -1.5, progi), 300)
    assert.equal(najblizszyProg(590, -3, progi), 0)
  })
  it('rzut w dół', () => {
    assert.equal(najblizszyProg(10, 1, progi), 300)
    assert.equal(najblizszyProg(250, 2, progi), 600)
  })
  it('rzut w kierunku bez progów wraca do najbliższego', () => {
    assert.equal(najblizszyProg(600, 2, progi), 600)
    assert.equal(najblizszyProg(0, -2, progi), 0)
  })
  it('skrajne wartości', () => {
    assert.equal(najblizszyProg(-50, 0, progi), 0)
    assert.equal(najblizszyProg(900, 0, progi), 600)
    assert.equal(najblizszyProg(10, 1, []), 10)
  })
})

describe('zGumka', () => {
  it('w przedziale bez zmian', () => assert.equal(zGumka(100, 0, 600), 100))
  it('poza skrajami tłumi', () => {
    assert.equal(zGumka(-100, 0, 600), -35)
    assert.equal(zGumka(700, 0, 600), 635)
  })
})

describe('predkosc', () => {
  it('liczy px/ms', () =>
    assert.equal(
      predkosc([
        { y: 0, t: 0 },
        { y: 50, t: 100 },
      ]),
      0.5,
    ))
  it('brak próbek', () => assert.equal(predkosc([]), 0))
})

describe('przesunieciaStanow', () => {
  it('kolejność: pełny < połowa < zwinięty', () => {
    const p = przesunieciaStanow(800, 84, 120)
    assert.equal(p.pelny, 0)
    assert.equal(p.polowa, 800 - 84 - 8 - 400)
    assert.equal(p.zwiniety, 800 - 84 - 8 - 120)
  })
  it('mały ekran nie daje wartości ujemnych', () => {
    const p = przesunieciaStanow(300, 84, 120)
    assert.ok(p.polowa >= 0 && p.zwiniety >= p.polowa)
  })
})
