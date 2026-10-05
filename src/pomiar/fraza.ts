// Normalizacja frazy wyszukiwania i filtr danych osobowych (FR-007). Czyste funkcje, bez DOM.
//
// DLACZEGO TO W KLIENCIE: fraza z pola wyszukiwania jest jedyną treścią użytkownika, która
// trafia do pomiaru (lista „wyszukiwania bez wyniku” to gotowa lista braków w danych). Człowiek
// bywa jednak nieuważny i wklei do pola e-mail albo numer telefonu – takie dane nie mogą wyjść
// z przeglądarki, więc filtr stoi PRZED siecią, a nie dopiero w bazie.
//
// Filtr jest zachowawczy: fałszywe odrzucenie kosztuje jedną frazę na liście braków (zostaje
// znacznik „[odrzucono]”), fałszywe przepuszczenie kosztuje wyciek danych osobowych.

import { MAX_FRAZA } from './kontrakt.ts'
import { przytnij } from './tekst.ts'

/** Znacznik zapisywany w miejsce frazy odrzuconej przez filtr (mieści się w MAX_FRAZA). */
export const ZNACZNIK_ODRZUCONO = '[odrzucono]'

export type WynikFrazy = { fraza: string } | { odrzucono: true }

/**
 * Ile znaków wejścia w ogóle oglądamy. Wklejony akapit nie ma po co przechodzić przez
 * wyrażenia regularne, a do bazy i tak zostanie 80 znaków.
 */
const LIMIT_WEJSCIA = 500

/**
 * Cyfry rozdzielone najwyżej trzema znakami „ozdobnymi” (spacja, kropka, myślnik i jego odmiany):
 * 9 cyfr w ten sposób to telefon (`123 456 789`, `123-456-789`, `12 345 67 89`), NIP, REGON,
 * numer karty albo PESEL. Ukośnik i przecinek NIE są separatorem, więc `ul. Długa 123/45, 31-001`
 * (numer domu, lokal, kod pocztowy) nie wpada w ten wzorzec.
 */
const CIAG_CYFR = /\d(?:[\s.\-‐-―]{0,3}\d){8,}/

/**
 * Czy tekst wygląda na dane osobowe: dowolny `@` (adres e-mail; także pełnoszerokie ＠)
 * albo 9+ cyfr z rzędu, także rozdzielonych jak w numerze telefonu.
 * Nawiasy i plus z numeru (`+48 (12) 345 67 89`) zamieniamy na spacje przed sprawdzeniem.
 */
export function zawieraDaneOsobowe(tekst: string): boolean {
  if (/[@＠]/.test(tekst)) return true
  return CIAG_CYFR.test(tekst.replace(/[()+]/g, ' '))
}

/**
 * Fraza gotowa do wysłania: małe litery (z polskimi regułami), złożone znaki diakrytyczne
 * (NFC – ta sama fraza z klawiatury macOS i Windows daje jeden klucz), zbite białe znaki,
 * przycięcie do 80 znaków. Dane osobowe (sprawdzane na CAŁYM znormalizowanym tekście, zanim
 * obetniemy go do 80 znaków) albo fraza pusta dają `{ odrzucono: true }`.
 */
export function normalizujFraze(tekst: string): WynikFrazy {
  const znormalizowana = tekst
    .slice(0, LIMIT_WEJSCIA)
    .normalize('NFC')
    .toLocaleLowerCase('pl')
    .replace(/\s+/g, ' ')
    .trim()
  if (!znormalizowana || zawieraDaneOsobowe(znormalizowana)) return { odrzucono: true }
  return { fraza: przytnij(znormalizowana, MAX_FRAZA) }
}
