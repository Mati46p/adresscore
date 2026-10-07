// „Opisz siebie” a wiele miast (#223, F6). Opis zamienia się w wagi tylko dla warstw bieżącego miasta
// (`wagiZeZrozumienia` dostaje jego meta), a `ustawWagi` zastępuje cały profil. Bez tej funkcji wagi
// warstw, które ma tylko INNE miasto (Kraków ma ok. 60 własnych, miasta kilka własnych), znikałyby
// przy każdym opisie, a przegląd tamtego miasta liczyłby się innym profilem niż bieżące (FR-003, D9).
// Czysta funkcja bez Reacta – test na gołym `node --test`.

/**
 * Wpisy z `stare`, których id NIE należy do `idBiezacegoMiasta`: to profil, którego opis z bieżącego
 * miasta nie dotyczy i którego nie wolno zgubić. Wołający składa nowy profil jako
 * `{ ...poza(stare, id), ...nowe }`, więc nowe wartości bieżącego miasta wygrywają.
 */
export function poza<T>(
  stare: Readonly<Record<string, T>>,
  idBiezacegoMiasta: ReadonlySet<string>,
): Record<string, T> {
  const wynik: Record<string, T> = {}
  for (const [id, wartosc] of Object.entries(stare)) {
    if (!idBiezacegoMiasta.has(id)) wynik[id] = wartosc
  }
  return wynik
}
