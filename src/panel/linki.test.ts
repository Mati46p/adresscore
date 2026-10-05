// Linki z danych pomiaru: tylko ścieżki w obrębie serwisu, nigdy schematy ani obce hosty.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { linkDoSerwisu } from './linki.ts'

describe('linkDoSerwisu', () => {
  it('przepuszcza zwykłe ścieżki serwisu', () => {
    for (const sciezka of [
      '/',
      '/adres/ul-dluga-5',
      '/katalog',
      '/katalog/ulica-pilsudskiego',
      '/metoda',
      '/adres/a%20b',
    ]) {
      assert.equal(linkDoSerwisu(sciezka), sciezka, sciezka)
    }
  })

  it('odrzuca schematy, obce hosty i ścieżki względne', () => {
    for (const zle of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'https://evil.example/adres/x',
      '//evil.example/adres/x',
      '/\\evil.example',
      'adres/x',
      '#/panel',
      '?panel',
    ]) {
      assert.equal(linkDoSerwisu(zle), null, zle)
    }
  })

  it('odrzuca znaki spoza adresu i przejścia w górę', () => {
    for (const zle of [
      '/adres/<script>',
      '/adres/a b',
      '/adres/"x"',
      "/adres/'x'",
      '/adres/a?x=1',
      '/adres/a#x',
      '/adres/../x',
      '/..',
    ]) {
      assert.equal(linkDoSerwisu(zle), null, zle)
    }
  })

  it('odrzuca puste, brakujące i zbyt długie wartości', () => {
    assert.equal(linkDoSerwisu(''), null)
    assert.equal(linkDoSerwisu(null), null)
    assert.equal(linkDoSerwisu(undefined), null)
    assert.equal(linkDoSerwisu(`/${'a'.repeat(600)}`), null)
  })
})
