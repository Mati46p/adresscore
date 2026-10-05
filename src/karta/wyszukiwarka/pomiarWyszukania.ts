// Pomiar wyszukiwarki (T062): czysta logika bez Reacta i DOM. Komponent `Wyszukiwarka.tsx` tylko ją
// wykonuje; reguły (kiedy wyszukanie jest zatwierdzone, jakiego jest rodzaju, jaką frazę wolno
// wysłać) siedzą tutaj, bo logika w komponencie jest nietestowalna, gdy testy chodzą bez DOM.
//
// KIEDY POWSTAJE ZDARZENIE (nigdy przy każdym znaku):
//   - wybór podpowiedzi (kliknięcie albo Enter na liście),
//   - Enter bez listy (zapytanie bez wyników albo z zamkniętą listą),
//   - bezczynność `BEZCZYNNOSC_MS` po ostatniej zmianie tekstu, przy co najmniej
//     `MIN_ZNAKOW_BEZCZYNNOSC` znakach (człowiek przeczytał listę i na niej poprzestał).
// Jedno zatwierdzenie to jedno zdarzenie: niezmieniony tekst potwierdzony drugi raz (bezczynność,
// a potem Enter albo klik) nie liczy się dwa razy – pilnuje tego komponent kluczem z `kluczWyszukania`.
//
// KTÓRE ZDARZENIE: są wyniki → `wyszukanie` (liczba podpowiedzi i rodzaj), nie ma → `wyszukanie_bez_wyniku`
// z frazą po `normalizujFraze` (lista braków w danych). Fraza wygląda na e-mail albo telefon → do sieci
// idzie znacznik „odrzucono”, nigdy treść (FR-007; `rdzen.ts` filtruje ją jeszcze raz).
//
// Importy względne z rozszerzeniem, bez aliasu `@/`: ten plik ładuje się w gołym Node (testy).

import { normalizujFraze, type WynikFrazy, ZNACZNIK_ODRZUCONO } from '../../pomiar/fraza.ts'
import type { RodzajWyszukania } from '../../pomiar/kontrakt.ts'
import { maNumerDomu } from './indeks.ts'
import type { Podpowiedz } from './podpowiedzi.ts'

/** Po ilu ms od ostatniej zmiany tekstu zapytanie uznajemy za zatwierdzone. */
export const BEZCZYNNOSC_MS = 1000

/** Krótsze zapytanie nie zatwierdza się samą bezczynnością (dwie litery to jeszcze nie wyszukanie). */
export const MIN_ZNAKOW_BEZCZYNNOSC = 3

/** Czy tekst w polu jest dość długi, by bezczynność zatwierdziła wyszukanie. */
export function czyBezczynnoscZatwierdza(zapytanie: string): boolean {
  return zapytanie.trim().length >= MIN_ZNAKOW_BEZCZYNNOSC
}

/**
 * Rodzaj wyszukania w kontrakcie pomiaru (`adres | ulica | okolica`). Okolica to podpowiedź okolicy.
 * Podpowiedź adresu przy zapytaniu Z numerem domu to `adres`, BEZ numeru – `ulica` (człowiek szukał
 * ulicy, a lista pokazała jej adresy; miejscowość bez ulic też trafia tu, bo to najbliższy rodzaj).
 */
export function rodzajWyszukania(
  rodzajPodpowiedzi: Podpowiedz['rodzaj'],
  zapytanie: string,
): RodzajWyszukania {
  if (rodzajPodpowiedzi === 'okolica') return 'okolica'
  return maNumerDomu(zapytanie) ? 'adres' : 'ulica'
}

export type ZdarzenieWyszukania =
  | { nazwa: 'wyszukanie'; wlasciwosci: { wynikow: number; rodzaj: RodzajWyszukania } }
  | { nazwa: 'wyszukanie_bez_wyniku'; wlasciwosci: WynikFrazy }

/**
 * Zdarzenie dla zatwierdzonego zapytania. `wynikow` to liczba podpowiedzi na liście, a
 * `rodzajPodpowiedzi` – rodzaj tej, którą wybrał człowiek (przy bezczynności: pierwszej na liście,
 * czyli najlepszego trafienia). Brak podpowiedzi = `wyszukanie_bez_wyniku`.
 */
export function zdarzenieWyszukania(
  zapytanie: string,
  wynikow: number,
  rodzajPodpowiedzi: Podpowiedz['rodzaj'] | undefined,
): ZdarzenieWyszukania {
  if (wynikow <= 0 || rodzajPodpowiedzi === undefined) {
    return { nazwa: 'wyszukanie_bez_wyniku', wlasciwosci: normalizujFraze(zapytanie) }
  }
  return {
    nazwa: 'wyszukanie',
    wlasciwosci: { wynikow, rodzaj: rodzajWyszukania(rodzajPodpowiedzi, zapytanie) },
  }
}

/**
 * Klucz „tego samego zapytania”: fraza po normalizacji (wielkość liter i odstępy nie robią różnicy).
 * Zapytania odrzucone przez filtr danych osobowych dzielą jeden klucz – nie mają treści, którą dałoby
 * się odróżnić, i nie mają się powtarzać w pomiarze.
 */
export function kluczWyszukania(zapytanie: string): string {
  const fraza = normalizujFraze(zapytanie)
  return 'fraza' in fraza ? fraza.fraza : ZNACZNIK_ODRZUCONO
}
