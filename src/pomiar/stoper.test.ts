// Stoper czasu widocznego. Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { utworzStoper } from './stoper.ts'

function zegar(start = 0) {
  let t = start
  return { teraz: () => t, tyk: (ms: number) => void (t += ms) }
}

describe('stoper', () => {
  it('liczy tylko odcinki między start i stop', () => {
    const z = zegar()
    const s = utworzStoper(z.teraz)
    s.start()
    z.tyk(1000)
    s.stop()
    z.tyk(5000) // karta w tle
    s.start()
    z.tyk(250)
    s.stop()
    assert.equal(s.ms(), 1250)
  })

  it('ms() uwzględnia otwarty odcinek, a stop go nie podwaja', () => {
    const z = zegar()
    const s = utworzStoper(z.teraz)
    s.start()
    z.tyk(400)
    assert.equal(s.ms(), 400)
    z.tyk(100)
    s.stop()
    s.stop()
    assert.equal(s.ms(), 500)
  })

  it('podwójny start nie przesuwa początku odcinka', () => {
    const z = zegar()
    const s = utworzStoper(z.teraz)
    s.start()
    z.tyk(300)
    s.start()
    z.tyk(300)
    assert.equal(s.ms(), 600)
  })

  it('zatrzymany stoper trzyma wynik i niczego nie dolicza, dopóki nie ruszy znowu', () => {
    const z = zegar()
    const s = utworzStoper(z.teraz)
    assert.equal(s.dziala(), false)
    s.start()
    z.tyk(700)
    s.stop()
    assert.equal(s.dziala(), false)
    z.tyk(900)
    assert.equal(s.ms(), 700)
    s.start()
    z.tyk(100)
    assert.equal(s.ms(), 800)
  })

  it('start przy zegarze równym 0 działa (zero nie oznacza „stoi”)', () => {
    const z = zegar(0)
    const s = utworzStoper(z.teraz)
    s.start()
    z.tyk(50)
    assert.equal(s.dziala(), true)
    assert.equal(s.ms(), 50)
  })

  it('zegar cofnięty nie daje ujemnego czasu', () => {
    const z = zegar(1000)
    const s = utworzStoper(z.teraz)
    s.start()
    z.tyk(-500)
    s.stop()
    assert.equal(s.ms(), 0)
  })
})
