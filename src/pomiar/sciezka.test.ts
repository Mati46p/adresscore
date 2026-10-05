// Ścieżka odsłony z dwóch źródeł routera. Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_SCIEZKA } from './kontrakt.ts'
import { sciezkaStrony } from './sciezka.ts'

describe('sciezkaStrony', () => {
  it('pathname ≠ „/” wygrywa z hashem', () => {
    assert.equal(sciezkaStrony('/adres/ul-dluga-5-krakow', ''), '/adres/ul-dluga-5-krakow')
    assert.equal(sciezkaStrony('/katalog', '#/porownanie'), '/katalog')
    assert.equal(sciezkaStrony('/metoda', '#met-jak'), '/metoda')
    assert.equal(sciezkaStrony('/katalog/ulica-dluga', ''), '/katalog/ulica-dluga')
  })

  it('ekrany aplikacji: część hasha przed „?”', () => {
    assert.equal(sciezkaStrony('/', '#/porownanie'), '/porownanie')
    assert.equal(sciezkaStrony('/', '#/porownanie?cmp=a,b&p=rodzina'), '/porownanie')
    assert.equal(sciezkaStrony('/', '#/adres/abc?u=%7B%22v%22%3A1%7D'), '/adres/abc')
    assert.equal(sciezkaStrony('/', '#/miasto?a=1&b=2&w=halas'), '/miasto')
    assert.equal(sciezkaStrony('/', '#/biznes?b=apteka&m=19.9,50.0'), '/biznes')
  })

  it('puste źródła dają „/”', () => {
    assert.equal(sciezkaStrony('/', ''), '/')
    assert.equal(sciezkaStrony('', ''), '/')
    assert.equal(sciezkaStrony('/', '#'), '/')
    assert.equal(sciezkaStrony('/', '#/'), '/')
    assert.equal(sciezkaStrony('/', '#/?t=biznes'), '/')
  })

  it('kotwica bez ukośnika nie jest ścieżką', () => {
    assert.equal(sciezkaStrony('/', '#met-jak'), '/')
    assert.equal(sciezkaStrony('/', '#sekcja?x=1'), '/')
  })

  it('nigdy nie zawiera zapytania ani fragmentu', () => {
    for (const [pathname, hash] of [
      ['/', '#/okolica?token=tajne#glebiej'],
      ['/adres/a?b=c', ''],
      ['/katalog#x', ''],
      ['/', '#/a#b'],
    ] as const) {
      const wynik = sciezkaStrony(pathname, hash)
      assert.ok(!/[?#]/.test(wynik), `${pathname}${hash} → ${wynik}`)
    }
  })

  it('końcowy ukośnik odpada, korzeń zostaje', () => {
    assert.equal(sciezkaStrony('/katalog/', ''), '/katalog')
    assert.equal(sciezkaStrony('/katalog//', ''), '/katalog')
    assert.equal(sciezkaStrony('/', '#/porownanie/'), '/porownanie')
    assert.equal(sciezkaStrony('/', ''), '/')
  })

  it('limit długości ścieżki', () => {
    assert.equal(sciezkaStrony(`/adres/${'a'.repeat(1000)}`, '').length, MAX_SCIEZKA)
    assert.equal(sciezkaStrony('/', `#/adres/${'b'.repeat(1000)}`).length, MAX_SCIEZKA)
  })

  it('hash bez wiodącego „#” też działa (location.hash zawsze go ma, ale funkcja nie zakłada)', () => {
    assert.equal(sciezkaStrony('/', '/porownanie?x=1'), '/porownanie')
  })
})
