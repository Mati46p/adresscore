import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coWyrozniaTekst, odlegloscTekst, opisCeny, PUSTY_STAN } from './sasiadTeksty.ts'

test('odległość w pełnych dziesiątkach metrów', () => {
  assert.equal(odlegloscTekst(123), '120 m')
  assert.equal(odlegloscTekst(497), '500 m')
  assert.equal(odlegloscTekst(4), 'mniej niż 10 m')
  assert.equal(odlegloscTekst(1250), '1,3 km')
  assert.equal(odlegloscTekst(Number.NaN), '–')
})

test('cena: różnica ze znakiem minus, brak cen na szaro', () => {
  assert.deepEqual(opisCeny({ stan: 'podobna', cenaM2: 15000, roznica: -0.08 }), {
    tekst: 'cena za m² podobna (−8%)',
    brak: false,
  })
  assert.equal(
    opisCeny({ stan: 'podobna', cenaM2: 15000, roznica: 0.12 }).tekst.includes('+12%'),
    true,
  )
  assert.equal(
    opisCeny({ stan: 'podobna', cenaM2: 15000, roznica: 0.001 }).tekst,
    'cena za m² taka sama',
  )
  assert.deepEqual(opisCeny({ stan: 'brak', podpis: 'brak cen transakcyjnych' }), {
    tekst: 'brak cen transakcyjnych',
    brak: true,
  })
})

test('co go wyróżnia: słowa, bez punktów', () => {
  const tekst = coWyrozniaTekst({
    wyroznia: [
      {
        kategoria: 'spokoj',
        nazwa: 'Spokój i zdrowie',
        stopien: 'znacznie',
        opis: 'znacznie ciszej i zdrowiej',
      },
      {
        kategoria: 'transport',
        nazwa: 'Transport',
        stopien: 'nieco',
        opis: 'nieco lepszy dojazd komunikacją',
      },
    ],
  })
  assert.equal(tekst, 'znacznie ciszej i zdrowiej, nieco lepszy dojazd komunikacją')
  assert.equal(coWyrozniaTekst({ wyroznia: [] }), 'wyższy wynik łączny przy Twoich wagach')
})

test('pusty stan po ludzku, bez pauzy', () => {
  assert.equal(PUSTY_STAN, 'W promieniu 500 m nie ma adresu z wyższą literą przy Twoich wagach')
  assert.equal(PUSTY_STAN.includes('—'), false)
})
