// Dojazd do celu użytkownika (#85) na małym sztucznym rozkładzie. Uruchom: node --test src/wynik/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CacheProfili,
  czasZPunktu,
  dostepneGodziny,
  type GrafPlik,
  type Punkt,
  profilDoCelu,
  zbudujModel,
} from './dojazdCel.ts'

// Cztery przystanki na południku 19°, co ok. 2,2 km (poza zasięgiem dojścia między sobą).
const P: [Punkt, Punkt, Punkt, Punkt] = [
  { lat: 50.0, lon: 19.0 },
  { lat: 50.02, lon: 19.0 },
  { lat: 50.04, lon: 19.0 },
  { lat: 50.06, lon: 19.0 },
]
const PZ = 1 | 2
/** Kurs z listy [przystanek, przyjazd, odjazd, flagi] → format delt z ETL. */
function kurs(...z: [number, number, number, number][]): number[] {
  const w: number[] = []
  let poprzedni = 0
  for (const [s, arr, dep, f] of z) {
    w.push(s, arr - poprzedni, dep - arr, f)
    poprzedni = dep
  }
  return w
}
function graf(kursy: number[][]): GrafPlik {
  return {
    wersja: 1,
    dataRozkladu: '2026-10-07',
    okno: { start: 420, koniec: 600 },
    zrodla: [],
    przystanki: P.flatMap((p) => [Math.round(p.lon * 1e5), Math.round(p.lat * 1e5)]),
    kursy,
  }
}

describe('dojazd do wybranego celu', () => {
  it('czekanie, przejazd i przesiadka dają najwcześniejszy przyjazd', () => {
    const model = zbudujModel(
      graf([
        kurs([0, 425, 425, PZ], [1, 430, 430, PZ]),
        kurs([1, 433, 433, PZ], [3, 445, 445, PZ]),
        kurs([0, 440, 440, PZ], [3, 460, 460, PZ]),
      ]),
    )
    const profil = profilDoCelu(model, P[3], 420)
    assert.equal(czasZPunktu(model, profil, P[0]), 25)
    assert.equal(czasZPunktu(model, profil, P[3]), 0)
  })

  it('zostaje w pojeździe i odrzuca przesiadkę krótszą niż 2 min', () => {
    const model = zbudujModel(
      graf([
        kurs([0, 425, 425, PZ], [1, 430, 430, PZ], [2, 435, 435, PZ], [3, 470, 470, PZ]),
        kurs([1, 431, 431, PZ], [3, 440, 440, PZ]),
      ]),
    )
    assert.equal(czasZPunktu(model, profilDoCelu(model, P[3], 420), P[0]), 50)
  })

  it('respektuje zakaz wsiadania i wysiadania', () => {
    const model = zbudujModel(graf([kurs([0, 425, 425, 2], [3, 445, 445, PZ])]))
    assert.equal(czasZPunktu(model, profilDoCelu(model, P[3], 420), P[0]), null)
    const bezWysiadania = zbudujModel(graf([kurs([0, 425, 425, PZ], [3, 445, 445, 1])]))
    assert.equal(czasZPunktu(bezWysiadania, profilDoCelu(bezWysiadania, P[3], 420), P[0]), null)
  })

  it('bez trasy w 2 h i poza zasięgiem dojścia zwraca null, nie zero', () => {
    const model = zbudujModel(graf([kurs([0, 425, 425, PZ], [3, 545, 545, PZ])]))
    const profil = profilDoCelu(model, P[3], 420)
    assert.equal(czasZPunktu(model, profil, P[0]), null)
    assert.equal(czasZPunktu(model, profil, { lat: 50.5, lon: 19.5 }), null)
  })

  it('dolicza dojście po prostej do przystanku i od przystanku do celu', () => {
    const model = zbudujModel(graf([kurs([0, 430, 430, PZ], [3, 445, 445, PZ])]))
    // ok. 556 m od przystanku → 8 min pieszo przy 1,25 m/s, z obu stron.
    const cel = { lat: 50.065, lon: 19.0 }
    const profil = profilDoCelu(model, cel, 420)
    assert.equal(czasZPunktu(model, profil, { lat: 49.995, lon: 19.0 }), 33)
    // Bezpośredni marsz bez komunikacji, gdy cel jest blisko.
    assert.equal(czasZPunktu(model, profil, { lat: 50.06, lon: 19.0 }), 8)
  })

  it('odrzuca godziny poza oknem, a cache zwraca ten sam profil dla bliskiego celu', () => {
    const model = zbudujModel(graf([kurs([0, 425, 425, PZ], [3, 445, 445, PZ])]))
    assert.deepEqual(dostepneGodziny(model), [420, 480])
    assert.throws(() => profilDoCelu(model, P[3], 540))
    const cache = new CacheProfili(model)
    assert.equal(cache.profil(P[3], 420).zCache, false)
    assert.equal(cache.profil({ lat: 50.0601, lon: 19.0002 }, 420).zCache, true)
    assert.equal(cache.profil(P[3], 480).zCache, false)
  })
})
