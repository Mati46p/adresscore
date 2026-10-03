import assert from 'node:assert/strict'
import test from 'node:test'
import { branza, etykietaZakladu, nazwaDoEtykiety, zakladyPrtr } from './prtr.mjs'

const zaklad = (id, lon, lat, wlasciwosci = {}) => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: {
    status_statusType: 'sprawny',
    name: 'TAMEH Polska Sp. z o. o.\nZakład Wytwarzania Elektrociepłownia Kraków',
    function_activity: '35.30',
    ...wlasciwosci,
  },
})

test('branza: dział NACE po pierwszych dwóch cyfrach, rolnictwo po czterech, nieznany dział ogólnie', () => {
  assert.equal(branza('35.30'), 'energetyka i ciepłownictwo')
  assert.equal(branza('38.21'), 'gospodarka odpadami')
  assert.equal(branza('24.10'), 'hutnictwo i metalurgia')
  assert.equal(branza('01.47'), 'chów drobiu')
  assert.equal(branza('01.46'), 'chów świń')
  assert.equal(branza('01.11'), 'rolnictwo')
  assert.equal(branza('96.01'), 'inna działalność przemysłowa')
  assert.equal(branza(undefined), 'inna działalność przemysłowa')
})

test('nazwaDoEtykiety: zbija łamania wiersza, zdejmuje formę prawną, ucina długie nazwy', () => {
  assert.equal(nazwaDoEtykiety('REMONDIS KRAKÓW Sp. z o.o.'), 'REMONDIS KRAKÓW')
  // 68 znaków po zbiciu łamania wiersza, więc ucięte na granicy słowa przed limitem 60
  assert.equal(
    nazwaDoEtykiety('TAMEH Polska Sp. z o. o.\nZakład Wytwarzania Elektrociepłownia Kraków'),
    'TAMEH Polska Sp. z o. o. Zakład Wytwarzania…',
  )
  const dluga = nazwaDoEtykiety(`${'Bardzo długa nazwa zakładu '.repeat(5)}Sp. z o.o.`)
  assert.ok(dluga.length <= 60 && dluga.endsWith('…'))
})

test('zakladyPrtr: tylko sprawne, nazwane, z punktem w Polsce; etykieta to nazwa i branża', () => {
  const { zaklady, odrzucone } = zakladyPrtr([
    zaklad('ID-1', 20.0801, 50.0589, {
      name: 'Zakład Termicznego Przekształcania Odpadów',
      function_activity: '38.21',
    }),
    zaklad('ID-2', 20, 50, { status_statusType: 'wyłączony' }),
    zaklad('ID-3', 20, 50, { name: '  ' }),
    zaklad('ID-4', 200, 50),
    {
      type: 'Feature',
      id: 'ID-5',
      geometry: null,
      properties: { status_statusType: 'sprawny', name: 'Bez punktu' },
    },
  ])
  assert.deepEqual(odrzucone, { niesprawne: 1, bezPunktu: 1, poza: 1, bezNazwy: 1 })
  assert.equal(zaklady.length, 1)
  assert.equal(
    etykietaZakladu(zaklady[0]),
    'Zakład Termicznego Przekształcania Odpadów – gospodarka odpadami',
  )
  assert.ok(zaklady[0].x > 560_000 && zaklady[0].y > 230_000, 'współrzędne w EPSG:2180')
})
