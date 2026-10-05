// Ścieżka odsłony. Router ma DWA źródła ścieżki (contracts/rpc.md, „Uzupełnienia wykonawcze”):
//   - indeksowalne ścieżki serwera (`/adres/<slug>`, `/katalog`, `/katalog/<ulica>`, `/metoda`),
//     gdzie aplikacja startuje z `location.pathname` ≠ `/`,
//   - ekrany aplikacji na hashu (`/#/porownanie?cmp=a,b`), gdzie pathname to samo `/`.
// Do pomiaru idzie ścieżka BEZ query i bez fragmentu z parametrami – parametry linku (wagi,
// punkty Biznesu, lista porównania) niosą ustawienia użytkownika, nie adres ekranu.

import { MAX_SCIEZKA } from './kontrakt.ts'

/**
 * `pathname` ≠ `/` wygrywa. W przeciwnym razie część hasha przed `?` (np. `#/porownanie?cmp=a`
 * → `/porownanie`); hash bez ukośnika (kotwica `#met-jak`) nie jest ścieżką, więc wychodzi `/`.
 * Końcowy ukośnik odpada (`/katalog/` i `/katalog` to ta sama strona).
 */
export function sciezkaStrony(pathname: string, hash: string): string {
  let sciezka = pathname
  if (sciezka === '' || sciezka === '/') {
    const bezZnaku = hash.startsWith('#') ? hash.slice(1) : hash
    const koniec = bezZnaku.search(/[?#]/)
    const czesc = koniec === -1 ? bezZnaku : bezZnaku.slice(0, koniec)
    sciezka = czesc.startsWith('/') ? czesc : '/'
  }
  // Query w samym pathname się nie zdarza, ale ta funkcja jest ostatnią bramką przed siecią.
  const poZnaku = sciezka.search(/[?#]/)
  if (poZnaku !== -1) sciezka = sciezka.slice(0, poZnaku) || '/'
  if (sciezka.length > 1) sciezka = sciezka.replace(/\/+$/, '') || '/'
  return sciezka.slice(0, MAX_SCIEZKA)
}
