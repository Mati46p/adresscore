// Nazwy zakładów z rejestrów publicznych: skracanie do etykiet i porównywanie między rejestrami.

// Forma prawna na końcu nazwy: skrót („Sp. z o.o.”, „S.A.”, „Sp.k.”) albo pełna nazwa; w rejestrach
// trafiają się też literówki („Ograniconą”), więc przymiotniki łapiemy po przedrostku.
const SPOLKA = new RegExp(
  `[\\s,]+(?:${[
    String.raw`sp\.\s?z\s?o\.\s?o\.`,
    String.raw`s\.\s?a\.`,
    String.raw`sp\.\s?k\.`,
    String.raw`sp\.\s?j\.`,
    String.raw`sp[oó]łka z ogr\S+ odpowiedzialno\S+`,
    String.raw`sp[oó]łka akcyjna`,
    String.raw`sp[oó]łka komandytowa`,
    String.raw`sp[oó]łka jawna`,
  ].join('|')})$`,
  'i',
)
const POMIJANE_SLOWA = new Set(['sp', 'zoo', 'spolka', 'akcyjna', 'oddzial', 'zaklad', 'nr', 'ul'])

/** Nazwa bez nadmiarowych spacji i bez formy prawnej na końcu (Sp. z o.o., S.A., Sp.k.). */
export function skrocNazwe(nazwa) {
  return String(nazwa).replace(/\s+/g, ' ').trim().replace(SPOLKA, '').trim()
}

/** Skraca do `maks` znaków na granicy słowa, z wielokropkiem; krótsze nazwy zostają bez zmian. */
export function przytnijNazwe(nazwa, maks) {
  if (nazwa.length <= maks) return nazwa
  const ciecie = nazwa.slice(0, maks - 1)
  const spacja = ciecie.lastIndexOf(' ')
  const wynik = spacja >= maks * 0.6 ? ciecie.slice(0, spacja) : ciecie
  return `${wynik.trimEnd().replace(/[,\-–]$/, '')}…`
}

/** Małe litery bez polskich znaków diakrytycznych (ł nie rozkłada się w NFD, więc osobno). */
export const bezOgonkow = (s) =>
  String(s).toLowerCase().replaceAll('ł', 'l').normalize('NFD').replace(/\p{M}/gu, '')

/** Słowa nazwy do porównań: bez ogonków, bez słów prawnych i krótszych niż 3 znaki. */
export function slowaNazwy(nazwa) {
  return new Set(
    bezOgonkow(nazwa)
      .split(/[^a-z0-9]+/)
      .filter((s) => s.length >= 3 && !POMIJANE_SLOWA.has(s)),
  )
}

/**
 * Czy dwie nazwy to ten sam zakład: co najmniej 60% słów krótszej nazwy występuje w drugiej.
 * Rejestry zapisują ten sam zakład różnie („ORLEN S. A. Terminal Paliw…” i „Terminal Paliw… - ORLEN S.A.”),
 * więc równość tekstu byłaby za ostra. To kontrola zgodności, nie klucz łączenia danych.
 */
export function tenSamZaklad(a, b) {
  const sa = slowaNazwy(a)
  const sb = slowaNazwy(b)
  if (!sa.size || !sb.size) return false
  let wspolne = 0
  for (const s of sa) if (sb.has(s)) wspolne++
  return wspolne / Math.min(sa.size, sb.size) >= 0.6
}
