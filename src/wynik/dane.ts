// Dane bieżącego miasta: jedno ładowanie na miasto, więc każdy komponent może wołać useDane() bez
// dublowania 70 tys. adresów i kilku MB wskaźników. Pełne dane (adresy, wszystkie warstwy, okolice)
// ma tylko bieżące miasto (FR-005, #223): `useDane()` zwraca zawsze jego stan, a pozostałe miasta
// widać wyłącznie jako przegląd na mapie (`przeglad.ts`). Pamięć i jej reguły (najwyżej 2 miasta,
// podpięcie słownika w stanie, ponowienie po błędzie) są w `pamiecDanych.ts` – testowalne bez Vite.
import { useSyncExternalStore } from 'react'
import {
  type Adres,
  bazaDanych,
  type PlikAdresow,
  rozwinAdresy,
  type SlugMiasta,
} from '@/kontrakty'
import { ladujDaneWTle } from './daneWTle.ts'
import { type Dane, type StanDanych, utworzPamiecDanych } from './pamiecDanych.ts'
import { pobierzStan, podlaczDane, subskrybuj as subskrybujStan } from './stan.ts'

export type { Dane, StanDanych } from './pamiecDanych.ts'

/** Tyle adresów rozwijamy naraz, zanim oddamy wątek (kawałek ~kilka ms, bez zamrażania karty). */
const ADRESOW_W_PORCJI = 20_000

/**
 * `rozwinAdresy` w porcjach: każda porcja to to samo rozwinięcie co dla całego pliku (jedno źródło
 * mapowania kolumn), tylko na wycinku kolumn, z `i` przesuniętym o początek wycinka. Między
 * porcjami wątek wraca do pętli zdarzeń. Przerwanie kończy się błędem przerwania.
 */
async function rozwinAdresyPorcjami(plik: PlikAdresow, signal?: AbortSignal): Promise<Adres[]> {
  const n = plik.kolumny.id.length
  if (n <= ADRESOW_W_PORCJI) return rozwinAdresy(plik)
  const wynik: Adres[] = []
  for (let od = 0; od < n; od += ADRESOW_W_PORCJI) {
    signal?.throwIfAborted()
    const kolumny = Object.fromEntries(
      Object.entries(plik.kolumny).map(([k, kolumna]) => [
        k,
        kolumna.slice(od, od + ADRESOW_W_PORCJI),
      ]),
    ) as PlikAdresow['kolumny']
    for (const a of rozwinAdresy({ ...plik, kolumny })) {
      a.i += od
      wynik.push(a)
    }
    await new Promise<void>((gotowe) => setTimeout(gotowe, 0))
  }
  return wynik
}

/**
 * Pełne dane miasta. Pobranie, parsowanie i skale robi worker (`daneWorker.ts`); tu zostaje tylko
 * rozwinięcie adresów w obiekty. `signal` przerywa ładowanie (pamięć robi to, gdy miasto wypada z
 * pamięci w trakcie): wtedy funkcja odrzuca się błędem przerwania, bez wpisów do `pominiete` i bez
 * ostrzeżeń w konsoli – przerwanie nie jest awarią pliku.
 */
async function wczytajWszystko(slug: SlugMiasta, signal?: AbortSignal): Promise<Dane> {
  // Bezwzględny adres, bo worker nie zna bazy strony (`BASE_URL` bywa względny).
  const baza = new URL(bazaDanych(slug), location.href).href
  const wynik = await ladujDaneWTle({ slug, baza }, signal)
  const adresy = await rozwinAdresyPorcjami(wynik.plikAdresow, signal)
  return { ...wynik, adresy }
}

/** Zapas bramki: po tylu ms od startu strony pełne dane ruszają, nawet gdy mapa nie dała sygnału. */
const ZAPAS_BRAMKI_MS = 4000

// Bramka zamknięta (A4): pełne dane nie konkurują z mapą o sieć i CPU, dopóki mapa się nie pokoloruje.
const pamiec = utworzPamiecDanych(
  wczytajWszystko,
  { pobierzStan, podlaczDane, subskrybuj: subskrybujStan },
  { bramkaZamknieta: true, zapasMs: ZAPAS_BRAMKI_MS },
)

/**
 * Pozwala na pobranie pełnych danych (do wywołania `useDane()` zwraca `ladowanie` bez startu). Idempotentne;
 * woła ją ekran Szukaj po pierwszym pokolorowaniu mapy, a pozostałe ekrany przy wejściu.
 */
export const pozwolNaPelneDane = pamiec.pozwolNaPelneDane

/**
 * Startuje ładowanie danych miasta (raz na miasto, dopóki mieści się w pamięci) i zwraca obietnicę
 * stanu końcowego. Bez argumentu: bieżące miasto.
 */
export const zaladujDane = pamiec.zaladujDane

/**
 * Stan danych BIEŻĄCEGO miasta: `ladowanie` → `gotowe` albo `blad`. Każde wywołanie dzieli jedno
 * ładowanie na miasto; zmiana miasta w stanie odświeża komponent (`ladowanie` do wczytania nowych danych).
 */
export function useDane(): StanDanych {
  return useSyncExternalStore(pamiec.subskrybuj, pamiec.stanBiezacego, pamiec.stanBiezacego)
}

/** Stan danych bieżącego miasta bez startu ładowania (powłoka: czyta, gdy ekran już je pobrał). */
export function useDaneJesliSa(): StanDanych {
  return useSyncExternalStore(pamiec.obserwuj, pamiec.stanBiezacego, pamiec.stanBiezacego)
}

/** Dane bieżącego miasta albo null, bez Reacta. */
export const daneJesliGotowe = pamiec.daneJesliGotowe
