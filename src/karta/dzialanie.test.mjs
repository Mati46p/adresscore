import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DOMYSLNE_ZALOZENIA, policzScenariusze } from './dzialanie.ts'

const meta = {
  id: 'przystanek_odleglosc',
  kategoria: 'transport',
  nazwa: 'Najbliższy przystanek',
  opis: 'Odległość',
  jednostka: 'm',
  kierunek: 'mniej-lepiej',
  rozdzielczosc: 'adres',
  zrodla: [],
  zadanie: 5,
}

const warstwa = (wartosc, ocena) => ({
  id: meta.id,
  meta,
  wartosc,
  ocena,
})

test('liczy roczny czas i wartość czasu z jawnych założeń', () => {
  const wynik = policzScenariusze([warstwa(780, 40)])
  assert.equal(wynik.length, 1)
  assert.equal(wynik[0]?.roznicaMetry, 480)
  assert.equal(wynik[0]?.godzinyRocznie, 104)
  assert.equal(wynik[0]?.wartoscCzasuRocznie, 2600)
  assert.equal(wynik[0]?.wyjsciaTygodniowo, DOMYSLNE_ZALOZENIA.wyjsciaTygodniowo[meta.id])
})

test('brak pomiaru albo oceny nie tworzy pozornej oszczędności', () => {
  assert.deepEqual(policzScenariusze([warstwa(null, 20)]), [])
  assert.deepEqual(policzScenariusze([warstwa(780, null)]), [])
  assert.deepEqual(policzScenariusze([warstwa(280, 20)]), [])
})

test('scenariusz wymaga właściwej jednostki i pokazuje mierzalną zmianę niezależnie od progu oceny', () => {
  assert.equal(policzScenariusze([warstwa(780, 80)]).length, 1)
  assert.deepEqual(
    policzScenariusze([{ ...warstwa(780, 20), meta: { ...meta, jednostka: 'min' } }]),
    [],
  )
})

test('nieprawidłowe założenia są ograniczane do bezpiecznych wartości', () => {
  const wynik = policzScenariusze([warstwa(780, 20)], {
    kmNaGodzine: 0,
    zlZaGodzine: Number.POSITIVE_INFINITY,
    wyjsciaTygodniowo: { przystanek_odleglosc: 500 },
  })
  assert.equal(wynik.length, 1)
  assert.equal(wynik[0]?.godzinyRocznie, 2496)
  assert.equal(wynik[0]?.wartoscCzasuRocznie, 0)
})
