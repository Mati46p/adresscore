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

test('sumaryczny heks znika, gdy warstwy z danymi niosą mniej niż połowę wagi (#148)', () => {
  const grupy = grupujHeksy(['a', 'a', 'a', 'b', 'b'])
  const pelna = warstwa('pelna', [10, 20, 30, 40, 50])
  const luka = warstwa('luka', [null, null, 30, null, 50])
  const srednie = Float32Array.from([20, 45])
  // Heks a: pelna 3/3, luka 1/3. Wagi 1 i 4 → pokrycie (1 + 4/3) / 5 ≈ 47% < 50% → znika.
  const suma = zakryjBrakiHeksow(srednie, grupy, [pelna, luka], { pelna: 1, luka: 4 }, {}, 'wynik')
  assert.ok(Number.isNaN(suma[0]))
  assert.equal(suma[1], 45)
  // Równe wagi: pokrycie (2 + 2/3) / 4 ≈ 67% → heks zostaje, choć jedna warstwa ma lukę.
  const rowne = zakryjBrakiHeksow(srednie, grupy, [pelna, luka], { pelna: 2, luka: 2 }, {}, 'wynik')
  assert.deepEqual([...rowne], [20, 45])
  // Warstwa tylko z jednej części mapy (0% w heksie) przy równej wadze: połowa wagi → zostaje.
  const tylkoB = warstwa('tylkoB', [null, null, null, 40, 50])
  const polowa = zakryjBrakiHeksow(
    srednie,
    grupy,
    [pelna, tylkoB],
    { pelna: 1, tylkoB: 1 },
    {},
    'wynik',
  )
  assert.deepEqual([...polowa], [20, 45])
  // Dla mapy pojedynczej warstwy liczy się tylko wybrana warstwa.
  const pojedyncza = zakryjBrakiHeksow(srednie, grupy, [pelna, luka], {}, {}, 'luka')
  assert.ok(Number.isNaN(pojedyncza[0]))
  assert.equal(pojedyncza[1], 45)
})
