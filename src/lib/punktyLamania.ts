// Punkty łamania układu (breakpointy) – jedno źródło dla JS.
// Po co: progi w `matchMedia` i w logice ekranów muszą być tymi samymi co w CSS,
// inaczej telefon i komputer rozjeżdżają się przy granicy szerokości.
// Uwaga: CSS ma te same liczby literalnie, z komentarzem `/* bp-l */` / `/* bp-m */`
// (zmienne CSS nie działają w `@media`). Zmiana progu wymaga zmiany w obu miejscach.

/** Punkty łamania: m – telefon, l – układ z arkuszem, xl – szeroki ekran. */
export const PUNKTY = { m: 640, l: 1024, xl: 1440 } as const

/** Zapytanie `matchMedia` dla układu z arkuszem (poniżej punktu l). */
export const MEDIA_ARKUSZA = '(max-width: 1023.98px)'

/** Zapytanie `matchMedia` dla telefonu (poniżej punktu m). */
export const MEDIA_TELEFONU = '(max-width: 639.98px)'
