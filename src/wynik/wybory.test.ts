import assert from 'node:assert/strict'
import test from 'node:test'
import { zmienKomitet } from './wybory.ts'

test('zmiana komitetu przenosi wagę, kierunek i próg tylko na wybraną listę', () => {
  const wynik = zmienKomitet(
    'sejm2023_lista_2',
    { sejm2023_lista_1: 3, sejm2023_lista_2: 0, halas_ldwn: 4 },
    { sejm2023_lista_1: 'mniej-lepiej' },
    [
      { id: 'sejm2023_lista_1', warunek: 'min', prog: 20 },
      { id: 'halas_ldwn', warunek: 'max', prog: 55 },
    ],
  )
  assert.equal(wynik.wagi.sejm2023_lista_1, 0)
  assert.equal(wynik.wagi.sejm2023_lista_2, 3)
  assert.equal(wynik.kierunki.sejm2023_lista_2, 'mniej-lepiej')
  assert.deepEqual(wynik.filtry, [
    { id: 'halas_ldwn', warunek: 'max', prog: 55 },
    { id: 'sejm2023_lista_2', warunek: 'min', prog: 20 },
  ])
})

test('samo wskazanie komitetu nie włącza go do wyniku', () => {
  const wynik = zmienKomitet(
    'sejm2023_lista_4',
    { sejm2023_lista_1: 0, sejm2023_lista_4: 0 },
    {},
    [],
  )
  assert.equal(wynik.wagi.sejm2023_lista_4, 0)
  assert.equal(wynik.kierunki.sejm2023_lista_4, 'wiecej-lepiej')
})
