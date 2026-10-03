// Symulator w workerze (#96): jedna instancja na aplikację, baza wysyłana tylko po zmianie
// danych albo wag, a każde postawienie obiektu to jedno `licz`. Bez Workera (stara przeglądarka,
// błąd ładowania) liczymy synchronicznie – ta sama czysta funkcja, wynik identyczny.
import { useEffect, useState } from 'react'
import type { Dane } from './dane.ts'
import type { Kierunki } from './silnik.ts'
import {
  type BazaSymulacji,
  type Obiekt,
  przygotujBaze,
  symuluj,
  type WynikSymulacji,
} from './symulacja.ts'
import type { OdpowiedzWorkera, WiadomoscDoWorkera } from './symulacja.worker.ts'

export interface StanSymulacji {
  baza: BazaSymulacji | null
  /** Wynik per wariant (A, B) w kolejności wejścia; null przed pierwszym przeliczeniem. */
  wyniki: WynikSymulacji[] | null
  /** Czas samego przeliczenia w workerze, ms. */
  ms: number | null
  liczy: boolean
}

let ostatniaBaza: {
  dane: Dane
  wagi: Readonly<Record<string, number>>
  kierunki: Kierunki
  baza: BazaSymulacji
} | null = null

function bazaDla(dane: Dane, wagi: Readonly<Record<string, number>>, kierunki: Kierunki) {
  const o = ostatniaBaza
  if (o && o.dane === dane && o.wagi === wagi && o.kierunki === kierunki) return o.baza
  const baza = przygotujBaze({
    adresy: dane.adresy,
    grupy: dane.grupyHeksow,
    wskazniki: dane.wskazniki,
    wagi,
    kierunki,
  })
  ostatniaBaza = { dane, wagi, kierunki, baza }
  return baza
}

let worker: Worker | null | undefined
let bazaWWorkerze: BazaSymulacji | null = null
let licznik = 0

function pobierzWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./symulacja.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('error', () => {
      // Worker się nie załadował – dalej liczymy w wątku głównym.
      worker?.terminate()
      worker = null
      bazaWWorkerze = null
    })
  } catch {
    worker = null
  }
  return worker
}

function wyslij(w: Worker, wiadomosc: WiadomoscDoWorkera) {
  w.postMessage(wiadomosc)
}

export function useSymulacja(
  dane: Dane | null,
  wagi: Readonly<Record<string, number>>,
  kierunki: Kierunki,
  warianty: readonly (readonly Obiekt[])[],
): StanSymulacji {
  const [stan, ustawStan] = useState<StanSymulacji>({
    baza: null,
    wyniki: null,
    ms: null,
    liczy: false,
  })
  // Klucz treści, nie tożsamości: nowa tablica z tymi samymi obiektami nie liczy od nowa.
  const klucz = JSON.stringify(warianty)

  useEffect(() => {
    if (!dane) return
    const lista = JSON.parse(klucz) as Obiekt[][]
    const baza = bazaDla(dane, wagi, kierunki)
    const id = ++licznik
    const w = pobierzWorker()
    if (!w) {
      const t0 = performance.now()
      const wyniki = lista.map((o) => symuluj(baza, o))
      ustawStan({ baza, wyniki, ms: performance.now() - t0, liczy: false })
      return
    }
    ustawStan((s) => ({ ...s, baza, liczy: true }))
    const odbierz = (e: MessageEvent<OdpowiedzWorkera>) => {
      // Starsze odpowiedzi (szybkie przeciąganie znacznika) pomijamy – liczy się ostatnia.
      if (e.data.typ !== 'wynik' || e.data.id !== id) return
      ustawStan({ baza, wyniki: e.data.wyniki, ms: e.data.ms, liczy: false })
    }
    w.addEventListener('message', odbierz)
    if (bazaWWorkerze !== baza) {
      wyslij(w, { typ: 'baza', baza })
      bazaWWorkerze = baza
    }
    wyslij(w, { typ: 'licz', id, warianty: lista })
    return () => w.removeEventListener('message', odbierz)
  }, [dane, wagi, kierunki, klucz])

  return stan
}
