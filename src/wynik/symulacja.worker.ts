// Worker symulatora (#96): baza przychodzi raz (po zmianie wag), potem każde postawienie,
// przesunięcie czy usunięcie obiektu to jedno `licz` – mapa nie zamarza przy przeliczeniu.
// Kontrakt wiadomości (do złączenia z workerem trybu Biznes w #108):
//   → { typ: 'baza', baza: BazaSymulacji }
//   → { typ: 'licz', id: number, warianty: Obiekt[][] }
//   ← { typ: 'wynik', id: number, wyniki: WynikSymulacji[], ms: number }
//   → { typ: 'sugeruj', id: number, typObiektu: TypObiektu, obiekty: Obiekt[] }
//   ← { typ: 'sugestia', id: number, sugestia: SugestiaMiejsca | null, ms: number }
import {
  type BazaSymulacji,
  type Obiekt,
  type SugestiaMiejsca,
  sugerujMiejsce,
  symuluj,
  type TypObiektu,
  type WynikSymulacji,
} from './symulacja.ts'

export type WiadomoscDoWorkera =
  | { typ: 'baza'; baza: BazaSymulacji }
  | { typ: 'licz'; id: number; warianty: Obiekt[][] }
  | { typ: 'sugeruj'; id: number; typObiektu: TypObiektu; obiekty: Obiekt[] }

export type OdpowiedzWorkera =
  | { typ: 'wynik'; id: number; wyniki: WynikSymulacji[]; ms: number }
  | { typ: 'sugestia'; id: number; sugestia: SugestiaMiejsca | null; ms: number }

// tsconfig ma lib DOM, nie WebWorker – opisujemy tylko to, czego używamy z zakresu workera.
const zakres = self as unknown as {
  onmessage: ((e: MessageEvent<WiadomoscDoWorkera>) => void) | null
  postMessage(odpowiedz: OdpowiedzWorkera): void
}

let baza: BazaSymulacji | null = null

zakres.onmessage = (e) => {
  const w = e.data
  if (w.typ === 'baza') {
    baza = w.baza
    return
  }
  if (!baza) return
  const t0 = performance.now()
  if (w.typ === 'sugeruj') {
    const sugestia = sugerujMiejsce(baza, w.typObiektu, w.obiekty)
    zakres.postMessage({ typ: 'sugestia', id: w.id, sugestia, ms: performance.now() - t0 })
    return
  }
  const wyniki = w.warianty.map((obiekty) => symuluj(baza as BazaSymulacji, obiekty))
  const odpowiedz: OdpowiedzWorkera = { typ: 'wynik', id: w.id, wyniki, ms: performance.now() - t0 }
  zakres.postMessage(odpowiedz)
}
