// Drobne funkcje na tekście wspólne dla modułów pomiaru. Czyste, bez DOM.

/**
 * Przycina do `limit` jednostek UTF-16 (tak liczy długość `.length`, więc tak samo liczy ją
 * walidacja serwera) bez rozcinania pary zastępczej – pół emoji to nieprawidłowy tekst, który
 * baza by odrzuciła – i bez spacji na końcu.
 */
export function przytnij(tekst: string, limit: number): string {
  if (tekst.length <= limit) return tekst
  let wynik = tekst.slice(0, limit)
  const ostatni = wynik.charCodeAt(wynik.length - 1)
  if (ostatni >= 0xd800 && ostatni <= 0xdbff) wynik = wynik.slice(0, -1)
  return wynik.trimEnd()
}

/**
 * Tekst bez znaków sterujących, ze zbitymi białymi znakami i bez spacji na brzegach.
 * Nazwy przycisków i komunikaty błędów przychodzą z DOM-u i z wyjątków – mogą zawierać
 * nowe linie, tabulatory i resztki formatowania, których w kluczach nie chcemy.
 */
export function oczyscBiale(tekst: string): string {
  return tekst
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
