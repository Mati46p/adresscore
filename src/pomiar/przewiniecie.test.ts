// Głębokość przewinięcia. Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { procentPrzewiniecia } from './przewiniecie.ts'

describe('procentPrzewiniecia', () => {
  it('dokument mieszczący się w oknie jest przewinięty w 100%', () => {
    assert.equal(procentPrzewiniecia(800, 800, 800), 100)
    assert.equal(procentPrzewiniecia(800, 801, 800), 100)
    assert.equal(procentPrzewiniecia(0, 500, 800), 100)
  })

  it('długa strona bez przewijania: ułamek równy pierwszemu ekranowi', () => {
    assert.equal(procentPrzewiniecia(800, 4000, 800), 20)
    assert.equal(procentPrzewiniecia(800, 8000, 800), 10)
  })

  it('krok 5%: połowa dokumentu to 50', () => {
    assert.equal(procentPrzewiniecia(2000, 4000, 800), 50)
    assert.equal(procentPrzewiniecia(2100, 4000, 800), 55)
    assert.equal(procentPrzewiniecia(2049, 4000, 800), 50)
  })

  it('dno dokumentu i jego okolice dają 100', () => {
    assert.equal(procentPrzewiniecia(4000, 4000, 800), 100)
    assert.equal(procentPrzewiniecia(3997, 4000, 800), 100)
    assert.equal(procentPrzewiniecia(5000, 4000, 800), 100)
  })

  it('dno mniejsze od okna (nieprzewinięta strona) liczy się jak pierwszy ekran', () => {
    assert.equal(procentPrzewiniecia(0, 4000, 800), 20)
  })

  it('nieskończone i niepoliczalne wartości dają 0, nie NaN', () => {
    assert.equal(procentPrzewiniecia(Number.NaN, 4000, 800), 0)
    assert.equal(procentPrzewiniecia(800, Number.POSITIVE_INFINITY, 800), 0)
    assert.equal(procentPrzewiniecia(800, 4000, Number.NaN), 0)
  })

  it('wynik zawsze mieści się w 0–100 i jest wielokrotnością 5', () => {
    for (let dno = 0; dno <= 6000; dno += 137) {
      const p = procentPrzewiniecia(dno, 5000, 700)
      assert.ok(p >= 0 && p <= 100, String(p))
      assert.equal(p % 5, 0)
    }
  })
})
