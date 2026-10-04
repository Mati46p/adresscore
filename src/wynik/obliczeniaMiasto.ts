// Tryb „Miasto” we wspólnym workerze obliczeń (#96, #108): baza przychodzi raz (po zmianie wag),
// potem każde postawienie, przesunięcie czy usunięcie obiektu to jedno `licz` – mapa nie zamarza
// przy przeliczeniu. Moduł nie dotyka `self`: obsługę wywołuje router (`obliczenia.ts`) w workerze
// i test w Node, więc jedyne, czego potrzebuje, to funkcja wysyłająca odpowiedzi.
//
// Kontrakt wiadomości (do routera dochodzą z polem `tryb: 'miasto'`):
//   → { typ: 'baza', baza: BazaSymulacji }
//   → { typ: 'licz', id: number, warianty: Obiekt[][] }
//   ← { typ: 'wynik', id: number, wyniki: WynikSymulacji[], ms: number }
//   → { typ: 'sugeruj', id: number, typObiektu: TypObiektu, obiekty: Obiekt[] }
//   ← { typ: 'sugestia', id: number, sugestia: SugestiaMiejsca | null, ms: number }
//   ← { typ: 'blad', id: number | null, blad: string }   (wyjątek w obsłudze; wysyła go router)
import {
  type BazaSymulacji,
  type Obiekt,
  type SugestiaMiejsca,
  sugerujMiejsce,
  symuluj,
  type TypObiektu,
  type WynikSymulacji,
} from './symulacja.ts'

export type WiadomoscMiasta =
  | { typ: 'baza'; baza: BazaSymulacji }
  | { typ: 'licz'; id: number; warianty: Obiekt[][] }
  | { typ: 'sugeruj'; id: number; typObiektu: TypObiektu; obiekty: Obiekt[] }

export type OdpowiedzMiasta =
  | { typ: 'wynik'; id: number; wyniki: WynikSymulacji[]; ms: number }
  | { typ: 'sugestia'; id: number; sugestia: SugestiaMiejsca | null; ms: number }

export interface ObslugaMiasta {
  obsluz(w: WiadomoscMiasta): void
  /** Oddaje bazę (największy obiekt trybu), gdy ekran Miasto się zamknął, a worker żyje dla innego trybu. */
  zwolnij(): void
}

export function utworzObslugeMiasta(wyslij: (odpowiedz: OdpowiedzMiasta) => void): ObslugaMiasta {
  let baza: BazaSymulacji | null = null
  return {
    obsluz(w) {
      if (w.typ === 'baza') {
        baza = w.baza
        return
      }
      if (!baza) return
      const t0 = performance.now()
      if (w.typ === 'sugeruj') {
        const sugestia = sugerujMiejsce(baza, w.typObiektu, w.obiekty)
        wyslij({ typ: 'sugestia', id: w.id, sugestia, ms: performance.now() - t0 })
        return
      }
      const wyniki = w.warianty.map((obiekty) => symuluj(baza as BazaSymulacji, obiekty))
      wyslij({ typ: 'wynik', id: w.id, wyniki, ms: performance.now() - t0 })
    },
    zwolnij() {
      baza = null
    },
  }
}
