// Nazwy źródeł rozkładu jazdy do podpisu panelu „Dojazd do Twojego celu” (#223, F6). Rozkład ma graf
// każdego miasta (`<baza>/dojazd/graf.json`, pole `zrodla`), więc podpis nie może zakładać Krakowa
// („GTFS ZTP Kraków”). Czysta funkcja bez Reacta – test na gołym `node --test` czyta prawdziwe grafy.

/**
 * Krótka nazwa źródła z pełnej nazwy w grafie. ETL składa ją jako „<przewoźnik> – rozkład GTFS (<jak
 * pobrano>) (<wydawca; wersja>)”, a Kraków i Warszawa mają inne szyki („ZTP Kraków GTFS A (…)”, „ZTM
 * Warszawa (rozkład GTFS …) (…)”). Bierzemy tekst do pierwszego nawiasu i zdejmujemy końcówkę „– rozkład
 * GTFS …”: zostaje przewoźnik, a pełna nazwa, licencja i adres siedzą w Metodzie i źródłach.
 */
export function nazwaZrodlaRozkladu(nazwa: string): string {
  const doNawiasu = (nazwa.split(' (')[0] ?? nazwa).trim()
  const przewoznik = doNawiasu.replace(/\s+[–-]\s+rozkład GTFS.*$/i, '').trim()
  return przewoznik || nazwa.trim()
}

/** Źródła rozkładu do zdania „Rozkład GTFS: …”: krótkie nazwy bez powtórzeń, po przecinku. */
export function opisZrodelRozkladu(zrodla: readonly { nazwa: string }[]): string {
  return [...new Set(zrodla.map((z) => nazwaZrodlaRozkladu(z.nazwa)))].join(', ')
}
