import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { DANE } from './lib/wspolne.mjs'
import { GMINY, PIT, POWIATY, ROK, WYNAGRODZENIE, wartoscBDL } from './zamoznosc.mjs'

test('BDL: przyjmujemy wyłącznie żądaną jednostkę, zmienną i rok', () => {
  const odp = {
    unitId: '011212161011',
    unitName: 'Kraków',
    results: [{ id: String(PIT), values: [{ year: String(ROK), val: 6147.94 }] }],
  }
  assert.equal(wartoscBDL(odp, '011212161011', 'Kraków', PIT), 6147.94)
  assert.throws(() => wartoscBDL(odp, '011212161011', 'Kraków', WYNAGRODZENIE))
  assert.throws(() => wartoscBDL(odp, '011212161011', 'Wieliczka', PIT))
  assert.throws(() => wartoscBDL(odp, '011212161011', 'Kraków', PIT, 2024))
})

test('GUS: pełne pokrycie adresów, bez fałszywej rozdzielczości i wpływu na wynik', () => {
  const adresy = JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8'))
  const pit = JSON.parse(readFileSync(join(DANE, 'wskazniki/gmina_pit_na_mieszkanca.json'), 'utf8'))
  const placa = JSON.parse(
    readFileSync(join(DANE, 'wskazniki/powiat_wynagrodzenie_brutto.json'), 'utf8'),
  )
  const gminy = JSON.parse(readFileSync(join(DANE, 'gminy-porownanie.json'), 'utf8'))
  const n = adresy.kolumny.id.length
  assert.equal(Object.keys(GMINY).length, 14)
  assert.equal(Object.keys(POWIATY).length, 4)
  for (const [plik, skala] of [
    [pit, 'gmina'],
    [placa, 'powiat'],
  ]) {
    assert.equal(plik.wersjaAdresow, adresy.wersja)
    assert.equal(plik.wartosci.length, n)
    assert.equal(plik.wartosci.filter((v) => v === null).length, 0)
    assert.equal(plik.meta.kategoria, 'kontekst')
    assert.equal(plik.meta.kierunek, 'neutralny')
    assert.equal(plik.meta.rozdzielczosc, skala)
    assert.equal(plik.meta.zrodla[0].dataDanych, String(ROK))
  }
  const wzorzec = new Map()
  for (let i = 0; i < n; i++) {
    const t = adresy.kolumny.teryt[i]
    if (!wzorzec.has(t)) wzorzec.set(t, { pit: pit.wartosci[i], placa: placa.wartosci[i] })
    assert.equal(pit.wartosci[i], wzorzec.get(t).pit)
    assert.equal(placa.wartosci[i], wzorzec.get(t).placa)
  }
  assert.equal(gminy.gminy.length, 14)
  for (const g of gminy.gminy) {
    assert.equal(g.miary.gmina_pit_na_mieszkanca.wartosc, wzorzec.get(g.teryt).pit)
    assert.equal(g.miary.powiat_wynagrodzenie_brutto.wartosc, wzorzec.get(g.teryt).placa)
  }
})
