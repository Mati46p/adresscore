import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bilansPopytu,
  type KomorkaPopytu,
  obliczBazowePunkty,
  obliczBialePlamy,
  ocenMiejsce,
  type PunktUslugi,
  progNasycenia,
  udzialyHuffa,
} from './biznes.ts'

const komorki: KomorkaPopytu[] = [
  ['h1', 19.999, 50, 100, 200, 0],
  ['h2', 20.001, 50, 100, 200, 0],
  ['h3', 20.03, 50, 10, 20, 0],
]
const apteki: PunktUslugi[] = [
  [20, 50, 'Apteka A'],
  [20.004, 50, 'Apteka B'],
]

test('Huff dzieli popyt w każdym heksie do 100%', () => {
  const udzialy = udzialyHuffa([100, 200, 500])
  assert.ok(Math.abs(udzialy.reduce((a, b) => a + b, 0) - 1) < 1e-12)
  assert.ok((udzialy[0] ?? 0) > (udzialy[1] ?? 0))
  const bilans = bilansPopytu(komorki, apteki, 800)
  assert.ok(Math.abs(bilans.przydzielone + bilans.nieobsluzone - 210) < 1e-9)
  assert.equal(bilans.nieobsluzone, 10)
})

test('punkt na istniejącej aptece jest porównywany bez podwójnego liczenia apteki', () => {
  const wynik = ocenMiejsce(komorki, apteki, 800, { lon: 20, lat: 50 })
  assert.equal(wynik.konkurenci, 1)
  assert.equal(wynik.adresyWZasiegu, 200)
  assert.ok(wynik.przydzieloneAdresy > 0)
  const bazowe = obliczBazowePunkty(komorki, apteki, 800)
  assert.ok(Math.abs(wynik.przydzielonyPopyt - (bazowe[0] ?? 0)) < 1e-9)
  assert.ok(wynik.percentyl >= 0 && wynik.percentyl <= 100)
})

test('remisy bez popytu nie są fałszywie pokazywane jako najlepsza lokalizacja', () => {
  const wynik = ocenMiejsce([], apteki, 800, { lon: 20, lat: 50 })
  assert.equal(wynik.percentyl, 50)
  assert.equal(wynik.udzialProcent, 0)
})

test('skala mapy nasyca się na 95. percentylu, nie na maksimum', () => {
  const wartosci = Array.from({ length: 100 }, (_, i) => i + 1)
  assert.equal(progNasycenia(wartosci), 96)
  const plamy = obliczBialePlamy(komorki, apteki, 800)
  const prog = progNasycenia(plamy.map((p) => p.adresyNaPunkt))
  for (const p of plamy) assert.equal(p.skala, Math.min(100, (100 * p.adresyNaPunkt) / prog))
})

test('konkurent bez nazwy zachowuje odległość i nie jest uznany za brak punktu', () => {
  const wynik = ocenMiejsce(komorki, [[20.002, 50, '']], 800, { lon: 20, lat: 50 })
  assert.equal(wynik.konkurenci, 1)
  assert.equal(wynik.najblizszyKonkurent, null)
  assert.ok((wynik.odlegloscKonkurenta ?? 0) > 0)
})
