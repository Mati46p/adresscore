// Symulator w workerze (#96): baza wysyłana tylko po zmianie danych albo wag, a każde postawienie
// obiektu to jedno `licz`. Worker jest WSPÓLNY z trybem Biznes (#108) – bierzemy go z menedżera
// (`menedzerObliczen.ts`) na czas życia ekranu Miasto i oddajemy przy wyjściu. Bez Workera (stara
// przeglądarka, błąd ładowania, wyjątek w obsłudze) liczymy synchronicznie – ta sama czysta
// funkcja, wynik identyczny.
import { useEffect, useState } from 'react'
import type { Dane } from './dane.ts'
import { menedzerObliczen, type Uchwyt } from './menedzerObliczen.ts'
import type { Kierunki } from './silnik.ts'
import {
  type BazaSymulacji,
  type Obiekt,
  przygotujBaze,
  type SugestiaMiejsca,
  sugerujMiejsce,
  symuluj,
  type TypObiektu,
  type WynikSymulacji,
} from './symulacja.ts'

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
    okolice: dane.okolice,
  })
  ostatniaBaza = { dane, wagi, kierunki, baza }
  return baza
}

// Uchwyt do wspólnego workera, otwarty przez ekran Miasto (jeden naraz) i baza, którą worker ma
// w pamięci dla tego uchwytu. Nowy uchwyt = nowa (albo oddana) instancja, więc baza idzie od nowa.
let uchwyt: Uchwyt<'miasto'> | null = null
let bazaWWorkerze: BazaSymulacji | null = null
let licznik = 0

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

  // Uchwyt do workera żyje tyle, ile ekran Miasto. Deklaracja PRZED efektem liczącym: efekty tego
  // samego komponentu biegną w kolejności deklaracji, więc uchwyt już jest, gdy liczymy. Otwarcie
  // zaraz po wejściu (jeszcze przed danymi) rozgrzewa worker, zanim dojdą adresy.
  useEffect(() => {
    const moj = menedzerObliczen.otworz('miasto')
    uchwyt = moj
    bazaWWorkerze = null
    return () => {
      if (uchwyt === moj) {
        uchwyt = null
        bazaWWorkerze = null
      }
      moj?.zwolnij()
    }
  }, [])

  useEffect(() => {
    if (!dane) return
    const lista = JSON.parse(klucz) as Obiekt[][]
    const baza = bazaDla(dane, wagi, kierunki)
    const id = ++licznik
    const liczTutaj = () => {
      const t0 = performance.now()
      const wyniki = lista.map((o) => symuluj(baza, o))
      ustawStan({ baza, wyniki, ms: performance.now() - t0, liczy: false })
    }
    const u = uchwyt
    if (!u) {
      liczTutaj()
      return
    }
    ustawStan((s) => ({ ...s, baza, liczy: true }))
    const zdejmijOdpowiedzi = u.nasluchuj((o) => {
      // Starsze odpowiedzi (szybkie przeciąganie znacznika) pomijamy – liczy się ostatnia.
      if (o.typ === 'wynik' && o.id === id) {
        ustawStan({ baza, wyniki: o.wyniki, ms: o.ms, liczy: false })
      } else if (o.typ === 'blad' && o.id === id) {
        liczTutaj() // wyjątek w workerze: ten sam wynik z wątku głównego
      }
    })
    const zdejmijBlad = u.naBledzie(liczTutaj)
    if (bazaWWorkerze !== baza && u.wyslij({ typ: 'baza', baza })) bazaWWorkerze = baza
    if (!u.wyslij({ typ: 'licz', id, warianty: lista })) liczTutaj()
    return () => {
      zdejmijOdpowiedzi()
      zdejmijBlad()
    }
  }, [dane, wagi, kierunki, klucz])

  return stan
}

/**
 * Sugestia miejsca (#98) w workerze; bez Workera liczy synchronicznie. Bazę bierze z ostatniego
 * `useSymulacja` – wywoływać dopiero, gdy hook ją zwrócił.
 */
export function sugerujWTle(
  baza: BazaSymulacji,
  typ: TypObiektu,
  obiekty: readonly Obiekt[],
): Promise<SugestiaMiejsca | null> {
  const u = uchwyt
  if (!u) return Promise.resolve(sugerujMiejsce(baza, typ, obiekty))
  const id = ++licznik
  return new Promise((ok) => {
    let zdejmijOdpowiedzi = () => {}
    let zdejmijBlad = () => {}
    const koniec = (sugestia: SugestiaMiejsca | null) => {
      zdejmijOdpowiedzi()
      zdejmijBlad()
      ok(sugestia)
    }
    const wWatkuGlownym = () => koniec(sugerujMiejsce(baza, typ, obiekty))
    zdejmijOdpowiedzi = u.nasluchuj((o) => {
      if (o.id !== id) return
      if (o.typ === 'sugestia') koniec(o.sugestia)
      else if (o.typ === 'blad') wWatkuGlownym()
    })
    zdejmijBlad = u.naBledzie(wWatkuGlownym)
    if (bazaWWorkerze !== baza && u.wyslij({ typ: 'baza', baza })) bazaWWorkerze = baza
    if (!u.wyslij({ typ: 'sugeruj', id, typObiektu: typ, obiekty: [...obiekty] })) wWatkuGlownym()
  })
}
