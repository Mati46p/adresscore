import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PlikWskaznika } from '../kontrakty/index.ts'
import { zakryjBrakiHeksow } from './heksy.ts'
import { grupujHeksy, przygotujWskaznik } from './silnik.ts'

function warstwa(id: string, wartosci: (number | null)[]) {
  const p: PlikWskaznika = {
    meta: {
      id,
      kategoria: 'transport',
      nazwa: id,
      opis: '',
      jednostka: '',
      kierunek: 'wiecej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 100],
      zadanie: 34,
      zrodla: [],
    },
    wersjaAdresow: 'test',
    wartosci,
  }
  return przygotujWskaznik(p)
}

test('sumaryczny heks znika, gdy ważona warstwa ma dane dla mniej niż połowy adresów', () => {
  const grupy = grupujHeksy(['a', 'a', 'a', 'b', 'b'])
  const pelna = warstwa('pelna', [10, 20, 30, 40, 50])
  const luka = warstwa('luka', [null, null, 30, null, 50])
  const srednie = Float32Array.from([20, 45])
  const suma = zakryjBrakiHeksow(srednie, grupy, [pelna, luka], { pelna: 2, luka: 2 }, {}, 'wynik')
  assert.ok(Number.isNaN(suma[0]))
  assert.equal(suma[1], 45)
  // Waga zero wyłącza wymóg pokrycia tej warstwy.
  const bezLuki = zakryjBrakiHeksow(
    srednie,
    grupy,
    [pelna, luka],
    { pelna: 2, luka: 0 },
    {},
    'wynik',
  )
  assert.deepEqual([...bezLuki], [20, 45])
  // Dla mapy pojedynczej warstwy liczy się tylko wybrana warstwa.
  const pojedyncza = zakryjBrakiHeksow(srednie, grupy, [pelna, luka], {}, {}, 'luka')
  assert.ok(Number.isNaN(pojedyncza[0]))
  assert.equal(pojedyncza[1], 45)
})
