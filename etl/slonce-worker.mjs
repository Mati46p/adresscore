// Wątek roboczy dla etl/slonce.mjs: bierze paczki adresów z atomowego licznika (adresy po
// północnej stronie kosztują ułamek tych po południowej, więc stały podział na równe części
// zostawiłby wątki bez pracy) i zapisuje wyniki wprost do wspólnej pamięci.
import { parentPort, workerData } from 'node:worker_threads'
import { obliczAdres } from './lib/slonce.mjs'

const { scena, slonce, x, y, doLiczenia, licznik, godziny, strony, paczka } = workerData

let policzone = 0
for (;;) {
  const od = Atomics.add(licznik, 0, paczka)
  if (od >= doLiczenia.length) break
  const koniec = Math.min(doLiczenia.length, od + paczka)
  for (let k = od; k < koniec; k++) {
    const i = doLiczenia[k]
    const wynik = obliczAdres(scena, slonce, x[i], y[i])
    if (!wynik) continue
    godziny[i] = wynik.godziny
    strony[i] = wynik.numerStrony
    policzone++
  }
}
parentPort.postMessage({ policzone })
