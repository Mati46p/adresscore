import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KROK_M, KROK_SHIFT_M, opisZnacznika, polecenieKlawisza, przesunOMetry } from './model.ts'

// Pauza zapisana kodem: w pliku nie ma literalnego znaku (w polskim tekście obowiązuje półpauza).
const PAUZA = String.fromCodePoint(0x2014)
const punkt = { lon: 19.94, lat: 50.06 }
const M_NA_STOPIEN = 111_320

/** Odległość w metrach między dwoma punktami (płaska aproksymacja, jak w modelu). */
function metry(a: { lon: number; lat: number }, b: [number, number]) {
  const dx = (b[0] - a.lon) * M_NA_STOPIEN * Math.cos((a.lat * Math.PI) / 180)
  const dy = (b[1] - a.lat) * M_NA_STOPIEN
  return { dx, dy }
}

test('strzałki przesuwają o 10 m, z Shift o 50 m, we właściwą stronę', () => {
  const kroki = [
    ['ArrowRight', 1, 0],
    ['ArrowLeft', -1, 0],
    ['ArrowUp', 0, 1],
    ['ArrowDown', 0, -1],
  ] as const
  for (const [klawisz, sx, sy] of kroki) {
    for (const [shift, oczekiwane] of [
      [false, KROK_M],
      [true, KROK_SHIFT_M],
    ] as const) {
      const polecenie = polecenieKlawisza(klawisz, shift, punkt)
      assert.equal(polecenie?.rodzaj, 'przesun')
      if (polecenie?.rodzaj !== 'przesun') continue
      const { dx, dy } = metry(punkt, [polecenie.lon, polecenie.lat])
      assert.ok(Math.abs(dx - sx * oczekiwane) < 1e-6, `${klawisz} dx=${dx}`)
      assert.ok(Math.abs(dy - sy * oczekiwane) < 1e-6, `${klawisz} dy=${dy}`)
    }
  }
  assert.equal(KROK_M, 10)
  assert.equal(KROK_SHIFT_M, 50)
})

test('Delete i Backspace usuwają miejsce, pozostałe klawisze zostają przeglądarce', () => {
  assert.deepEqual(polecenieKlawisza('Delete', false, punkt), { rodzaj: 'usun' })
  assert.deepEqual(polecenieKlawisza('Backspace', false, punkt), { rodzaj: 'usun' })
  for (const klawisz of ['Tab', 'Enter', ' ', 'Escape', 'a', 'Home'])
    assert.equal(polecenieKlawisza(klawisz, false, punkt), null, klawisz)
})

test('przesunięcie o metry zachowuje się symetrycznie', () => {
  const [lon, lat] = przesunOMetry(punkt.lon, punkt.lat, 100, 0)
  const [wracaLon] = przesunOMetry(lon, lat, -100, 0)
  assert.ok(Math.abs(wracaLon - punkt.lon) < 1e-12)
  assert.equal(lat, punkt.lat)
})

test('opis znacznika dla czytnika: litera, współrzędne i sterowanie klawiaturą', () => {
  const a = opisZnacznika({ id: 'a', ...punkt })
  assert.match(a, /^Miejsce A, 50\.06000 szerokości, 19\.94000 długości\./)
  assert.match(a, /Strzałki przesuwają o 10 m, z Shift o 50 m, Delete usuwa\.$/)
  assert.match(opisZnacznika({ id: 'b', lon: 20, lat: 50 }), /^Miejsce B,/)
  assert.ok(!a.includes(PAUZA))
})
