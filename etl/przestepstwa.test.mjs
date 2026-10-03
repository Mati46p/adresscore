import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KOMISARIATY, komisariatDzielnicy, powiatAdresu, wartoscBdl } from './przestepstwa.mjs'
import { PRZENIESIONE } from './uprosc-kryteria.mjs'

test('każda z 18 dzielnic ma dokładnie jeden komisariat', () => {
  const wszystkie = KOMISARIATY.flatMap((k) => k.dzielnice)
  assert.equal(wszystkie.length, 18)
  assert.equal(new Set(wszystkie).size, 18)
})

test('dzielnica z adresów → komisariat', () => {
  assert.equal(komisariatDzielnicy('XIII Podgórze'), 'KP V')
  assert.equal(komisariatDzielnicy('IV Prądnik Biały'), 'KP III')
  assert.equal(komisariatDzielnicy('IX Łagiewniki-Borek Fałęcki'), 'KP V')
  assert.equal(komisariatDzielnicy('XVIII Nowa Huta'), 'KP VIII')
  assert.equal(komisariatDzielnicy(null), null)
  assert.equal(komisariatDzielnicy('Bez numeru'), null)
})

test('powiat adresu z TERYT', () => {
  assert.equal(powiatAdresu('1261011'), '1261')
  assert.equal(powiatAdresu('1214012'), '1214')
  assert.equal(powiatAdresu('1201011'), null)
  assert.throws(() => powiatAdresu('126'))
})

test('wartość BDL: rok, brak = null, kontrola nazwy', () => {
  const odp = {
    results: [
      { id: 'A', name: 'Powiat m. Kraków', values: [{ year: '2025', val: 22.95 }] },
      { id: 'B', name: 'Powiat krakowski', values: [] },
    ],
  }
  assert.equal(wartoscBdl(odp, 'A', 'Powiat m. Kraków', 2025), 22.95)
  assert.equal(wartoscBdl(odp, 'B', 'Powiat krakowski', 2025), null)
  assert.equal(wartoscBdl(odp, 'C', 'x', 2025), null)
  assert.throws(() => wartoscBdl(odp, 'A', 'Powiat wielicki', 2025))
})

test('wskaźniki przestępstw mają grupę z PRZENIESIONE i domyślnie nie wpływają na wynik', async () => {
  const { readFileSync } = await import('node:fs')
  for (const id of ['przestepstwa_1000_powiat_2025', 'wykrywalnosc_powiat_2025']) {
    const w = JSON.parse(
      readFileSync(new URL(`../public/dane/wskazniki/${id}.json`, import.meta.url), 'utf8'),
    )
    const m = w.meta ?? w
    // Od #171 grupę i kierunek nadaje PRZENIESIONE (etl/uprosc-kryteria.mjs), z wagą startową 0.
    assert.deepEqual([m.kategoria, m.kierunek], PRZENIESIONE[id], id)
    assert.equal(m.domyslnaWaga, 0, id)
  }
})
