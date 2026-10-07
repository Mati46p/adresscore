// Pamięć plików pobocznych miasta (#223): jedno wczytanie na PEŁNĄ ŚCIEŻKĘ pliku, najwyżej kilka
// ścieżek naraz, najdawniej użyta odpada. Dotyczy plików, które wczytuje się dopiero na żądanie
// (graf dojazdu, szczegóły szkół), a nie pełnych danych miasta – tych pilnuje `pamiecDanych.ts`.
//
// Dlaczego klucz to pełna ścieżka, a nie sam plik albo adres: pliki każdego miasta mają te same nazwy
// (`dojazd/graf.json`, `szkoly_e8_szczegoly.json`), więc pamięć kluczowana nazwą oddałaby po zmianie
// miasta plik poprzedniego. Ścieżka niesie katalog miasta (`/dane/miasta/lublin/…`), więc dwa miasta
// nigdy nie dzielą wpisu. Osobny plik bez Reacta, `import.meta.env` i `self`, żeby działał w workerze,
// w komponencie i na gołym `node --test`.

export interface PamiecPlikow<T> {
  /**
   * Wynik wczytania pliku spod `sciezka`. Pierwsze wywołanie uruchamia `wczytaj`, kolejne dostają tę
   * samą obietnicę (także w trakcie ładowania). Odrzucona obietnica znika z pamięci, więc następne
   * wywołanie ponawia pobranie, a nie oddaje błędu do końca sesji.
   */
  pobierz(sciezka: string, wczytaj: () => Promise<T>): Promise<T>
  /** Czy ścieżka jest w pamięci (wczytana albo w trakcie ładowania). */
  ma(sciezka: string): boolean
  /** Oddaje wszystko (np. gdy ekran, który trzymał pliki, się zamknął). */
  wyczysc(): void
  /** Ile ścieżek jest w pamięci. */
  readonly rozmiar: number
}

/**
 * @param maks ile ścieżek trzymać naraz; trzeci plik wypiera ten, którego użyto najdawniej. Dla plików
 *   miasta zwykle tyle, co `MAKS_MIAST_W_PAMIECI`: bieżące miasto i poprzednie (powrót jest od ręki).
 */
export function utworzPamiecPlikow<T>(maks: number): PamiecPlikow<T> {
  if (!Number.isInteger(maks) || maks < 1) throw new Error(`Pamięć plików: maks = ${maks}`)
  // Kolejność wstawiania = kolejność ostatniego użycia (`pobierz` przesuwa wpis na koniec).
  const wpisy = new Map<string, Promise<T>>()
  return {
    pobierz(sciezka, wczytaj) {
      const istniejacy = wpisy.get(sciezka)
      if (istniejacy) {
        wpisy.delete(sciezka)
        wpisy.set(sciezka, istniejacy)
        return istniejacy
      }
      const obietnica = wczytaj()
      wpisy.set(sciezka, obietnica)
      // Błąd zdejmuje wyłącznie własny wpis: w tym czasie ścieżka mogła wypaść i wrócić z nowym
      // wczytaniem, którego nie wolno usunąć przez cudzą porażkę.
      obietnica.catch(() => {
        if (wpisy.get(sciezka) === obietnica) wpisy.delete(sciezka)
      })
      while (wpisy.size > maks) {
        const najdawniejszy = wpisy.keys().next().value
        if (najdawniejszy === undefined) break
        wpisy.delete(najdawniejszy)
      }
      return obietnica
    },
    ma: (sciezka) => wpisy.has(sciezka),
    wyczysc: () => wpisy.clear(),
    get rozmiar() {
      return wpisy.size
    },
  }
}
