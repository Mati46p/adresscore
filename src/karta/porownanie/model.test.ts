import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type OkolicaPorownania, priorytety, punktyRadaru, ranking, werdykt } from './model.ts'

function okolica(id: string, wynik: number | null, pewnosc = 1): OkolicaPorownania {
  return {
    id,
    nazwa: id,
    wynik: {
      wynik,
      litera: wynik === null ? null : 'B',
      pewnosc,
      warstwy: [],
      kategorie: [
        {
          kategoria: 'codziennosc',
          ocena: wynik,
          pewnosc,
          warstwy: [{ liczona: true, wagaUzytkownika: 4, meta: {} }],
        },
        {
          kategoria: 'transport',
          ocena: wynik,
          pewnosc,
          warstwy: [{ liczona: true, wagaUzytkownika: 2, meta: {} }],
        },
      ],
    },
  }
}

test('brak wyniku trafia na koniec rankingu i nie staje się zerem', () => {
  assert.deepEqual(
    ranking([okolica('brak', null), okolica('dobry', 80), okolica('slaby', 20)]).map((x) => x.id),
    ['dobry', 'slaby', 'brak'],
  )
  assert.match(werdykt([okolica('brak', null), okolica('dobry', 80)]), /Dodaj drugi adres/)
})

test('werdykt nie wskazuje zwycięzcy przy małej dostępności danych lub remisie', () => {
  assert.match(werdykt([okolica('A', 85, 0.3), okolica('B', 70)]), /niepełne/)
  assert.match(werdykt([okolica('A', 80), okolica('B', 79.5)]), /zbliżone/)
})

test('linia priorytetów odczytuje wagi kategorii, a radar odrzuca braki', () => {
  const wagi = priorytety([okolica('A', 70)])
  assert.equal(wagi.codziennosc, 1)
  assert.equal(wagi.transport, 0.5)
  assert.equal(wagi.spokoj, 0)
  assert.equal(punktyRadaru([50, null, 80]), null)
  assert.equal(punktyRadaru([0, 50, 100])?.split(' ').length, 3)
})
