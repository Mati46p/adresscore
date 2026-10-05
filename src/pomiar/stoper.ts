// Stoper czasu WIDOCZNEGO: nalicza tylko odcinki, w których karta była widoczna. Zegar jest
// wstrzykiwany, więc logika (odcinki, wstrzymanie) testuje się bez przeglądarki.
//
// DLACZEGO CZAS WIDOCZNY, A NIE ŚCIENNY: przy kilkunastu kartach w tle „czas na stronie” mierzony
// zegarem ściennym mierzy nawyki przeglądarkowe, nie czytanie. Liczymy tak jak GA4 i Plausible
// (Page Visibility), więc liczby są porównywalne z innymi narzędziami.

export interface Stoper {
  /** Zaczyna naliczać; nie robi nic, gdy już liczy. */
  start(): void
  /** Wstrzymuje i dolicza otwarty odcinek; nie robi nic, gdy stoi. */
  stop(): void
  /** Zebrane milisekundy, razem z odcinkiem, który właśnie biegnie. */
  ms(): number
  /** Czy odcinek jest otwarty. */
  dziala(): boolean
}

export function utworzStoper(teraz: () => number): Stoper {
  let zebrane = 0
  // `null` = stoi. Zero nie może znaczyć „stoi”: `performance.now()` bywa 0 tuż po starcie.
  let odKiedy: number | null = null

  return {
    start() {
      if (odKiedy === null) odKiedy = teraz()
    },
    stop() {
      if (odKiedy === null) return
      zebrane += Math.max(0, teraz() - odKiedy)
      odKiedy = null
    },
    ms() {
      return zebrane + (odKiedy === null ? 0 : Math.max(0, teraz() - odKiedy))
    },
    dziala() {
      return odKiedy !== null
    },
  }
}
