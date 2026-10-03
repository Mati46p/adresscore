import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WskaznikMeta } from '../../kontrakty/index.ts'
import { etykietaKierunku, kierunkiWarstwy } from './preferencje.ts'

function meta(id: string): WskaznikMeta {
  return {
    id,
    kategoria: id === 'cena_m2_mediana' || id === 'drzewa_100m' ? 'kontekst' : 'transport',
    nazwa: id,
    opis: '',
    jednostka: id === 'sct_w_strefie' || id === 'spp_podstrefa' ? '0/1' : '',
    kierunek: 'neutralny',
    rozdzielczosc: 'adres',
    zrodla: [],
    zadanie: 0,
  }
}

test('SCT i SPP mają tylko dwie preferencje odpowiadające 1 i 0', () => {
  for (const id of ['sct_w_strefie', 'spp_podstrefa']) {
    const m = meta(id)
    assert.deepEqual(kierunkiWarstwy(m), ['wiecej-lepiej', 'mniej-lepiej'])
    assert.equal(etykietaKierunku(m, 'wiecej-lepiej'), 'W strefie lepiej')
    assert.equal(etykietaKierunku(m, 'mniej-lepiej'), 'Poza strefą lepiej')
  }
})

test('cena i drzewa mają własne etykiety preferencji bez optimum', () => {
  const cena = meta('cena_m2_mediana')
  const drzewa = meta('drzewa_100m')
  assert.deepEqual(kierunkiWarstwy(cena), ['wiecej-lepiej', 'mniej-lepiej'])
  assert.equal(etykietaKierunku(cena, 'mniej-lepiej'), 'Taniej lepiej')
  assert.equal(etykietaKierunku(cena, 'wiecej-lepiej'), 'Drożej lepiej')
  assert.equal(etykietaKierunku(drzewa, 'mniej-lepiej'), 'Mniej drzew lepiej')
  assert.equal(etykietaKierunku(drzewa, 'wiecej-lepiej'), 'Więcej drzew lepiej')
})
