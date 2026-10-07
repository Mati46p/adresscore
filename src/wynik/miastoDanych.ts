// Bieżące miasto (#223) dla plików, które nie są częścią stanu: ścieżki danych pobocznych (budynki 3D,
// dojazd, usługi), bramki „tylko Kraków” i teksty z nazwą miasta. Jedno miejsce zamiast sprawdzania
// `pobierzStan().miasto` i składania `bazaDanych(...)` w każdym pliku osobno. Kontrakt:
// specs/002-wszystkie-miasta/contracts/url.md.
//
// Wersje bez Reacta (`miastoBiezace`, `bazaBiezaca`, `tylkoKrakow`) czytają stan w chwili wywołania,
// więc nadają się do funkcji, workerów i handlerów. UWAGA: w workerze to jego własna kopia modułu
// stanu (zawsze Kraków) – worker dostaje bazę od wątku głównego, nie woła `bazaBiezaca()`.
// Wersje z Reactem (`useMiasto`, `useTylkoKrakow`) odświeżają komponent przy zmianie miasta; wołana
// w renderze wersja bez Reacta sama tego nie zrobi (komponent bez `useDane()`/`useStan()` zostałby
// ze starym miastem).
import { bazaDanych, MIASTO_DOMYSLNE, type Miasto, miasto } from '@/kontrakty'
import { pobierzStan, useStan } from './stan.ts'

/** Bieżące miasto: nazwa, forma „w …”, katalog danych, środek. */
export function miastoBiezace(): Miasto {
  return miasto(pobierzStan().miasto)
}

/**
 * Katalog danych bieżącego miasta: `<BASE_URL>dane` dla Krakowa, `<BASE_URL>dane/miasta/<slug>` dla
 * reszty. Pliki każdego zbioru leżą w tym samym układzie, więc ścieżka pliku to `${bazaBiezaca()}/…`
 * (np. `/dojazd/graf.json`, `/uslugi/katalog.json`, `/budynki/…`).
 */
export function bazaBiezaca(): string {
  return bazaDanych(pobierzStan().miasto)
}

/** Bieżące miasto w komponencie: odświeża go przy każdej zmianie miasta. */
export function useMiasto(): Miasto {
  return miasto(useStan((s) => s.miasto))
}

/**
 * Czy funkcje, które mają dane tylko w Krakowie (D8: wyszukiwarka okolic SIM, tryb Biznes, MPZP,
 * pozwolenia na budowę), są teraz niedostępne – czyli bieżące miasto NIE jest Krakowem. `true` =
 * pokaż „Na razie tylko w Krakowie” zamiast pustych albo zerowych wartości, `false` = Kraków, pełny
 * zestaw funkcji:
 *
 *   if (tylkoKrakow()) return <NaRazieTylkoKrakow />
 */
export function tylkoKrakow(): boolean {
  return pobierzStan().miasto !== MIASTO_DOMYSLNE
}

/** `tylkoKrakow()` w komponencie: odświeża go przy zmianie miasta. */
export function useTylkoKrakow(): boolean {
  return useStan((s) => s.miasto !== MIASTO_DOMYSLNE)
}
