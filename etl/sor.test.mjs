import assert from 'node:assert/strict'
import { test } from 'node:test'
import { najblizszy, unikalnePunkty, zaokraglij } from './sor.mjs'

test('dwie komórki pod jednym adresem to jeden SOR', () => {
  const p = unikalnePunkty([
    { nazwa: 'A', miejscowosc: 'Chrzanów', ulica: 'Topolowa', nr: '16.' },
    { nazwa: 'B', miejscowosc: 'Chrzanów', ulica: 'Topolowa', nr: '16' },
    { nazwa: 'C', miejscowosc: 'Kraków', ulica: 'Prądnicka', nr: '35' },
  ])
  assert.equal(p.length, 2)
  assert.equal(p[0].nr, '16')
})

test('najbliższy SOR i brak współrzędnych = null, nie zero', () => {
  const sory = [
    { lat: 50.06, lon: 19.94, etykieta: 'blisko' },
    { lat: 50.2, lon: 20.2, etykieta: 'daleko' },
  ]
  assert.equal(najblizszy({ lat: 50.061, lon: 19.94 }, sory).sor.etykieta, 'blisko')
  assert.equal(najblizszy({ lat: null, lon: 19.94 }, sory), null)
})

test('zaokrąglenie do 50 m', () => {
  assert.equal(zaokraglij(124), 100)
  assert.equal(zaokraglij(126), 150)
})
