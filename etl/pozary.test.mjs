import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dopasujZdarzenia, wartoscDlaGminy } from './pozary.mjs'

const tabela = {
  126101: { name: 'Kraków', fires: 224, threats: 557 },
  120602: { name: 'Igołomia-Wawrzeńczyce', fires: 43, threats: 107 },
}

test('mapuje siedmiocyfrowy TERYT adresu na sześciocyfrowy TERYT PSP', () => {
  const adresy = [
    { teryt: '1261011', gmina: 'Kraków' },
    { teryt: '1206022', gmina: 'Igołomia-Wawrzeńczyce' },
  ]
  assert.equal(dopasujZdarzenia(adresy, tabela).size, 2)
  assert.equal(wartoscDlaGminy('1206022', tabela, 'fires'), 43)
})

test('nie przenosi rozbieżnych danych KG PSP dla Krakowa na adres', () => {
  assert.equal(wartoscDlaGminy('1261011', tabela, 'fires'), 2623)
  assert.equal(wartoscDlaGminy('1261011', tabela, 'threats'), null)
  assert.equal(wartoscDlaGminy('1206032', tabela, 'fires'), null)
})

test('odrzuca niezgodną nazwę gminy i błędny TERYT', () => {
  assert.throws(() => dopasujZdarzenia([{ teryt: '1206022', gmina: 'Kraków' }], tabela))
  assert.throws(() =>
    dopasujZdarzenia([{ teryt: '120602', gmina: 'Igołomia-Wawrzeńczyce' }], tabela),
  )
})
