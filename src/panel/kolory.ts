// Paleta danych panelu: kolory WYPEŁNIEŃ (słupki, segmenty, linie, kropki w legendzie). Wartości
// siedzą w `panel.css` jako zmienne `--panel-kat-N`; tu są tylko nazwy slotów i odwołania do nich.
//
// Zasady (CLAUDE.md „Liczby na ekranie”, skill dataviz):
//  - Slot palety to kolor ZNAKU (wypełnienia), nigdy kolor pisma. Etykieta i liczba obok używają
//    tokenów tekstu (`--tekst`, `--tekst-2`), a barwa kategorii idzie na kropkę przy nazwie.
//  - Kolor idzie za BYTEM (kanał, seria), nie za pozycją w rankingu: po przefiltrowaniu pozostałe
//    pozycje nie zmieniają barwy. Sloty przydzielamy w stałej kolejności, bez cyklowania.
//  - Paleta przeszła walidator (`validate_palette.js`, tło białe `--powierzchnia`): osiem slotów
//    spełnia wszystkie sprawdzenia sąsiednich par (CVD ΔE ≥ 8,4; normalne widzenie ≥ 19,3) i
//    kontrast ≥ 3:1 z tłem; trzy pierwsze sloty także w trybie „wszystkie pary”.
//  - Szary (`szary`) to wygaszenie: roboty, „inne”, kontekst. Nie jest slotem kategorii.

export type KolorDanych = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 'szary'

export const KOLOR_DANYCH: Readonly<Record<KolorDanych, string>> = {
  1: 'var(--panel-kat-1)',
  2: 'var(--panel-kat-2)',
  3: 'var(--panel-kat-3)',
  4: 'var(--panel-kat-4)',
  5: 'var(--panel-kat-5)',
  6: 'var(--panel-kat-6)',
  7: 'var(--panel-kat-7)',
  8: 'var(--panel-kat-8)',
  szary: 'var(--panel-szary)',
}

/** Wartości slotów (lustro `panel.css`, do testu zgodności z walidatorem palety). */
export const PALETA_DANYCH: Readonly<Record<KolorDanych, string>> = {
  1: '#2a78d6',
  2: '#eb6834',
  3: '#199e70',
  4: '#c98500',
  5: '#d55181',
  6: '#008300',
  7: '#4a3aa7',
  8: '#e34948',
  szary: '#898781',
}
