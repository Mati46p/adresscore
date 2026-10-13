import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DANE } from './lib/wspolne.mjs'
import { punktyEkopunktow, typStaly } from './warszawa-ekopunkty.mjs'

const r = (typy, lon = 21, lat = 52) => ({
  dlugosc: lon,
  szerokosc: lat,
  dzielnica: 'Wola',
  typ_punktu: typy.map((rodzaj) => ({ rodzaj })),
})

test('typy stałe: mobilne i jadłodzielnie odpadają', () => {
  assert.equal(typStaly('Odbiór przeterminowanych leków'), true)
  assert.equal(typStaly('Miejski Punkt Elektroodpadów'), true)
  assert.equal(typStaly('Mobilny punkt zbierania elektrośmieci'), false)
  assert.equal(typStaly('Mobilny Punkt Selektywnego Zbierania Odpadów Komunalnych'), false)
  assert.equal(typStaly('Jadłodzielnia'), false)
})

test('punkt z typem stałym i mobilnym zostaje; sam mobilny i bez współrzędnych odpada', () => {
  const { punkty, odrzucone } = punktyEkopunktow([
    r(['Odbiór przeterminowanych leków', 'Mobilny punkt zbierania elektrośmieci']),
    r(['Jadłodzielnia']),
    r(['Miejski Punkt Elektroodpadów'], 0, 0),
    r(['Punkt Selektywnego Zbierania Odpadów Komunalnych'], 'brak', 52),
  ])
  assert.equal(punkty.length, 1)
  assert.deepEqual(odrzucone, { bezWspolrzednych: 2, tylkoMobilneLubJadlodzielnie: 1 })
})

const plik = join(DANE, 'wskazniki', 'ekopunkt_odleglosc.json')
test('wygenerowany plik: kontrakt i brak ujemnych', { skip: !existsSync(plik) }, () => {
  const w = JSON.parse(readFileSync(plik, 'utf8'))
  assert.equal(w.meta.kategoria, 'codziennosc')
  assert.equal(w.meta.kierunek, 'mniej-lepiej')
  assert.ok(w.wartosci.every((v) => v === null || v >= 0))
})
