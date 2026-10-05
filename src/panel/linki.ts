// Linki budowane z danych pomiaru. Ścieżki, frazy i komunikaty w bazie pochodzą od KAŻDEGO klienta,
// który potrafi wysłać żądanie do publicznego endpointu zapisu (kontrolę robi walidacja po stronie
// serwera, ale panel nie może na niej polegać): admin klikający link ze „ścieżki” nie może
// wykonać cudzego kodu (`javascript:`), wyjść na obcy host (`//host`) ani dostać znaków spoza adresu.
//
// Zasada dla zakładek: tekst z bazy wstawiaj wyłącznie jako treść (React ją escapuje), a do
// `href` przepuszczaj TYLKO przez `linkDoSerwisu`. Nigdy `dangerouslySetInnerHTML`.

/** Ścieżka w obrębie serwisu: początkowy `/`, potem znaki adresu; bez schematu, bez `//`, bez `..`. */
const BEZPIECZNA_SCIEZKA = /^\/(?!\/)[A-Za-z0-9\-._~%/]*$/

/**
 * Zwraca ścieżkę, jeśli nadaje się na `href` w obrębie serwisu (np. `/adres/ul-dluga-5`), a w
 * przeciwnym razie `null` (wtedy pokaż sam tekst, bez linku).
 */
export function linkDoSerwisu(sciezka: string | null | undefined): string | null {
  if (typeof sciezka !== 'string' || sciezka.length === 0 || sciezka.length > 512) return null
  if (!BEZPIECZNA_SCIEZKA.test(sciezka)) return null
  if (sciezka.includes('..')) return null
  return sciezka
}
