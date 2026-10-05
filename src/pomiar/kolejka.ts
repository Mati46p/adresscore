// Kolejka zdarzeń: bufor, paczki, harmonogram wysyłki. Bez DOM – transport, zegar i bramka
// sprzeciwu są wstrzykiwane, więc całość testuje się na atrapach (kolejka.test.ts).
//
// PO CO PACZKI (FR-006): zdarzenie na żądanie to dziesiątki żądań na wizytę. Bufor do 10 zdarzeń
// zamienia je na jedno-dwa, a sam pomiar nigdy nie blokuje ani nie opóźnia interakcji
// (wysyłka jest fire-and-forget).
//
// KIEDY WYCHODZI PACZKA:
//   - 5 s po OSTATNIM zdarzeniu (bezczynność, zegar odnawiany przy każdym dodaniu),
//   - gdy bufor się zapełni (MAX_PACZKA),
//   - przy `zamknij()` – ostatnia chwila przed ukryciem karty,
//   - od razu, gdy karta jest ukryta (zdarzenie dodane po `zamknij()`, np. wital zgłoszony przez
//     przeglądarkę już po naszym nasłuchu `visibilitychange`; zegar 5 s nie dożyłby wysyłki),
//   - od razu na życzenie (`natychmiast`).
//
// SPRZECIW MA PIERWSZEŃSTWO: przy wyłączonym pomiarze nic nie wychodzi, a to, co już leżało
// w buforze, jest wyrzucane (użytkownik mógł wyłączyć pomiar między dodaniem a wysyłką).
//
// BEZ PONAWIANIA: nieudana wysyłka przepada. Pętla ponowień przy awarii endpointu (deploy,
// przerwa w bazie) mnożyłaby ruch dokładnie wtedy, gdy serwer go nie potrzebuje.

import type { Zdarzenie } from './kontrakt.ts'
import { LIMIT_CIALA, MAX_PACZKA } from './kontrakt.ts'

/** Po tylu ms od ostatniego zdarzenia bufor wychodzi sam. */
export const BEZCZYNNOSC_MS = 5000

/**
 * Bezpiecznik na jedną kartę: pętla w kodzie (np. stan przełączany w kółko) nie ma prawa
 * zasypać endpointu. Serwer tnie dodatkowo 1500 zdarzeń/h na odcisk – to jest pierwsza linia.
 */
export const LIMIT_NA_KARTE = 400

export interface Zegar {
  ustaw(funkcja: () => void, ms: number): unknown
  wyczysc(uchwyt: unknown): void
}

export const zegarSystemowy: Zegar = {
  ustaw: (funkcja, ms) => setTimeout(funkcja, ms),
  wyczysc: (uchwyt) => clearTimeout(uchwyt as ReturnType<typeof setTimeout>),
}

export interface OpcjeKolejki {
  /** Wysyła gotowe ciało żądania (fire-and-forget). Wyjątki tłumi kolejka. */
  wyslij: (cialo: string) => void
  /** Bramka sprzeciwu (`pomiarWylaczony`). */
  wylaczony: () => boolean
  zegar?: Zegar
  bezczynnoscMs?: number
  /** Czy karta jest ukryta – wtedy zdarzenie wychodzi bez czekania na zegar. */
  czyUkryta?: () => boolean
  limitNaKarte?: number
}

export interface Kolejka {
  dodaj(zdarzenie: Zdarzenie, opcje?: { natychmiast?: boolean }): void
  /**
   * Wysyła wszystko, co czeka (razem z `dodatkowe`, dopisanymi na końcu) i kasuje zegar.
   * Drugie wywołanie z pustym buforem niczego nie wysyła – dubel `pagehide` po
   * `visibilitychange` jest nieszkodliwy.
   */
  zamknij(dodatkowe?: readonly Zdarzenie[]): void
  rozmiar(): number
}

const kodowanie = new TextEncoder()

/** Długość w bajtach UTF-8 – tak liczy limit ciała serwer (polskie litery to 2 bajty). */
function bajty(tekst: string): number {
  return kodowanie.encode(tekst).length
}

function dodajCiala(grupa: readonly Zdarzenie[], wynik: string[]) {
  const cialo = JSON.stringify({ z: grupa })
  if (bajty(cialo) <= LIMIT_CIALA) {
    wynik.push(cialo)
    return
  }
  // Pojedyncze zdarzenie ponad limit odrzucamy: serwer i tak by je odrzucił (413), a dzielić
  // nie ma czego. Przy ograniczonych polach (ścieżka ≤ 512, ≤ 24 sekcje, ≤ 12 CTA) nie wystąpi.
  if (grupa.length <= 1) return
  const polowa = Math.ceil(grupa.length / 2)
  dodajCiala(grupa.slice(0, polowa), wynik)
  dodajCiala(grupa.slice(polowa), wynik)
}

/**
 * Zdarzenia → ciała żądań `{"z":[…]}`: po najwyżej MAX_PACZKA zdarzeń i najwyżej LIMIT_CIALA
 * bajtów każde. Kolejność zachowana (serwer wstawia w kolejności tablicy).
 */
export function podzielNaCiala(zdarzenia: readonly Zdarzenie[]): string[] {
  const wynik: string[] = []
  for (let i = 0; i < zdarzenia.length; i += MAX_PACZKA) {
    dodajCiala(zdarzenia.slice(i, i + MAX_PACZKA), wynik)
  }
  return wynik
}

export function utworzKolejke(opcje: OpcjeKolejki): Kolejka {
  const {
    wyslij,
    wylaczony,
    zegar = zegarSystemowy,
    bezczynnoscMs = BEZCZYNNOSC_MS,
    czyUkryta = () => false,
    limitNaKarte = LIMIT_NA_KARTE,
  } = opcje

  let bufor: Zdarzenie[] = []
  let uchwyt: unknown = null
  let przyjete = 0

  function wylaczZegar() {
    if (uchwyt === null) return
    zegar.wyczysc(uchwyt)
    uchwyt = null
  }

  function przyjmij(zdarzenie: Zdarzenie): boolean {
    if (przyjete >= limitNaKarte) return false
    przyjete++
    bufor.push(zdarzenie)
    return true
  }

  function oproznij() {
    wylaczZegar()
    if (bufor.length === 0) return
    const paczka = bufor
    bufor = []
    if (wylaczony()) return
    for (const cialo of podzielNaCiala(paczka)) {
      try {
        wyslij(cialo)
      } catch {
        // Pomiar nie może zepsuć niczego, co robi użytkownik.
      }
    }
  }

  function wyczysc() {
    bufor = []
    wylaczZegar()
  }

  return {
    dodaj(zdarzenie, { natychmiast = false } = {}) {
      if (wylaczony()) return wyczysc()
      if (!przyjmij(zdarzenie)) return
      if (natychmiast || bufor.length >= MAX_PACZKA || czyUkryta()) return oproznij()
      wylaczZegar()
      uchwyt = zegar.ustaw(oproznij, bezczynnoscMs)
    },
    zamknij(dodatkowe = []) {
      if (wylaczony()) return wyczysc()
      for (const zdarzenie of dodatkowe) przyjmij(zdarzenie)
      oproznij()
    },
    rozmiar: () => bufor.length,
  }
}
