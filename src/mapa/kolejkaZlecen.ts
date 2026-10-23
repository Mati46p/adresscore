// Kolejka zleceń dla workera, który liczy po jednym zleceniu naraz. Czysta, bez DOM: testy w
// kolejkaZlecen.test.ts. Dwie reguły: zlecenie o tym samym kluczu zastępuje starsze (worker nie
// liczy tego, co już nieaktualne), a z oczekujących wychodzi to o najniższym priorytecie.
export class KolejkaZlecen<T> {
  private readonly wpisy = new Map<string, { priorytet: number; zlecenie: T }>()

  ustaw(klucz: string, priorytet: number, zlecenie: T) {
    // Delete + set: zastępnik staje na końcu wśród równych priorytetów.
    this.wpisy.delete(klucz)
    this.wpisy.set(klucz, { priorytet, zlecenie })
  }

  /** Zdejmuje następne zlecenie (najniższy priorytet, przy remisie najstarsze). */
  nastepne(): { klucz: string; zlecenie: T } | undefined {
    let najlepszy: string | undefined
    let p = Number.POSITIVE_INFINITY
    for (const [k, w] of this.wpisy) {
      if (w.priorytet < p) {
        p = w.priorytet
        najlepszy = k
      }
    }
    if (najlepszy === undefined) return undefined
    const wpis = this.wpisy.get(najlepszy)
    this.wpisy.delete(najlepszy)
    return wpis && { klucz: najlepszy, zlecenie: wpis.zlecenie }
  }

  /** Zdejmuje oczekujące zlecenie o kluczu (bez skutku, gdy go nie ma). */
  usun(klucz: string) {
    this.wpisy.delete(klucz)
  }

  get rozmiar() {
    return this.wpisy.size
  }
}
