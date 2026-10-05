// Pamięć podręczna wyników RPC panelu: TTL, jedno pobranie na klucz naraz, subskrypcje dla
// `useSyncExternalStore` i „najstarszy pobrano” dla znacznika w nagłówku.
//
// Czysta logika z wstrzykiwanym zegarem i funkcją pobierającą, bez React i bez klienta bazy, żeby
// dało się ją przetestować w Node (`dane.test.ts`). `dane.ts` dokłada do niej klienta Supabase i hook.
//
// DLACZEGO WŁASNY MAGAZYN, A NIE TANSTACK QUERY (research.md R14): panel ma jednego admina i
// ruch hackathonowy, więc wystarcza Map z TTL 5 minut; biblioteka to nowa zależność (plik toru
// integracji) i kolejny kilkudziesięciokilobajtowy chunk.

/** Błąd, jak go widzi panel. `brak_dostepu` (kod 42501) to odmowa bramki w bazie, nie awaria. */
export type BladWidoku = { rodzaj: 'brak_dostepu' } | { rodzaj: 'blad'; komunikat: string }

export type WynikPobrania<T> = { rodzaj: 'dane'; dane: T } | BladWidoku

/** Migawka jednego wpisu. Niemutowalna: nowa migawka = nowy obiekt (wymóg `useSyncExternalStore`). */
export interface StanWpisu<T> {
  /** Ostatnie udane dane. Zostają widoczne podczas ponownego pobierania i po nieudanym odświeżeniu. */
  dane: T | null
  /** Moment ostatniego UDANEGO pobrania (ms od epoki). */
  pobrano: number | null
  /** Błąd ostatniej próby. */
  blad: BladWidoku | null
  ladowanie: boolean
}

export const PUSTY_WPIS: StanWpisu<never> = Object.freeze({
  dane: null,
  pobrano: null,
  blad: null,
  ladowanie: false,
})

/** Stan widoku dla komponentu: to, co zwraca hook `useWidok`. */
export interface StanWidoku<T> {
  /** Ostatnie udane dane (zostają na ekranie podczas odświeżania). `null`: jeszcze brak albo błąd. */
  dane: T | null
  blad: BladWidoku | null
  /** Pierwsze ładowanie albo odświeżanie. Zakładka nie pokazuje wtedy szkieletu, jeśli ma `dane`. */
  ladowanie: boolean
  /** Moment ostatniego udanego pobrania (ms od epoki). */
  pobrano: number | null
}

/**
 * Łączy stany dwóch widoków w jeden (sekcja zależna od dwóch funkcji bazy). Dane są dopiero, gdy
 * są oba; błąd pierwszego z błędnych; ładowanie, gdy którykolwiek się ładuje; wiek danych to
 * starszy z dwóch. Trzy widoki: `polaczStany(polaczStany(a, b), c)`.
 */
export function polaczStany<A, B>(a: StanWidoku<A>, b: StanWidoku<B>): StanWidoku<[A, B]> {
  return {
    dane: a.dane !== null && b.dane !== null ? [a.dane, b.dane] : null,
    blad: a.blad ?? b.blad,
    ladowanie: a.ladowanie || b.ladowanie,
    pobrano:
      a.pobrano !== null && b.pobrano !== null
        ? Math.min(a.pobrano, b.pobrano)
        : (a.pobrano ?? b.pobrano),
  }
}

export interface Magazyn {
  /** Aktualna migawka wpisu (ta sama referencja, dopóki wpis się nie zmieni). */
  odczytaj(klucz: string): StanWpisu<unknown>
  /** Subskrypcja zmian wpisu. Subskrybowany wpis liczy się jako „na ekranie”. */
  subskrybuj(klucz: string, naZmiane: () => void): () => void
  /** Subskrypcja zmian dowolnego wpisu i zbioru wpisów na ekranie (do znacznika wieku danych). */
  subskrybujOgolne(naZmiane: () => void): () => void
  /**
   * Prosi o dane. Świeży wpis (młodszy niż TTL, bez błędu) nic nie robi, trwające pobranie jest
   * współdzielone, reszta woła `pobierz`. `wymus` pomija TTL.
   */
  zazadaj(
    klucz: string,
    pobierz: () => Promise<WynikPobrania<unknown>>,
    wymus?: boolean,
  ): Promise<void>
  /**
   * „Odśwież”: ponownie pobiera wszystkie wpisy z subskrybentami (stare dane zostają widoczne do
   * czasu odpowiedzi), a wpisy, których nikt nie ogląda, zapomina, żeby kolejne wejście w zakładkę
   * nie wzięło wczorajszego wyniku za świeży.
   */
  odswiezWszystko(): Promise<void>
  /**
   * Zapomina WSZYSTKIE dane od razu (zmiana lub wylogowanie konta: dane poprzedniego admina nie mogą
   * zostać pokazane następnemu) i, domyślnie, ponownie prosi o te, które ktoś ogląda (`ponow`).
   * Przy wylogowaniu `ponow = false`: ponowne pytania szłyby już bez sesji i kończyły się odmową.
   * Odpowiedzi na pytania zadane przed zapomnieniem są ignorowane.
   */
  zapomnij(ponow?: boolean): Promise<void>
  /** Najstarszy moment pobrania wśród wpisów na ekranie (z danymi), `null`, gdy brak. */
  najstarszePobranie(): number | null
}

interface Wpis {
  stan: StanWpisu<unknown>
  pobierz: (() => Promise<WynikPobrania<unknown>>) | null
  wLocie: Promise<void> | null
  sluchacze: Set<() => void>
}

export function utworzMagazyn(opcje: { ttlMs: number; zegar?: () => number }): Magazyn {
  const { ttlMs } = opcje
  const zegar = opcje.zegar ?? Date.now
  const wpisy = new Map<string, Wpis>()
  const ogolne = new Set<() => void>()
  /** Zwiększany przy `zapomnij`: odpowiedź z poprzedniej epoki nie wolno wpisać się do magazynu. */
  let epoka = 0

  function powiadomOgolne() {
    for (const s of [...ogolne]) s()
  }

  function wpis(klucz: string): Wpis {
    let w = wpisy.get(klucz)
    if (!w) {
      w = { stan: PUSTY_WPIS, pobierz: null, wLocie: null, sluchacze: new Set() }
      wpisy.set(klucz, w)
    }
    return w
  }

  function ustaw(w: Wpis, stan: StanWpisu<unknown>) {
    w.stan = stan
    for (const s of [...w.sluchacze]) s()
    powiadomOgolne()
  }

  function swiezy(w: Wpis): boolean {
    const { dane, pobrano, blad } = w.stan
    return dane !== null && pobrano !== null && blad === null && zegar() - pobrano < ttlMs
  }

  function uruchom(w: Wpis): Promise<void> {
    const pobierz = w.pobierz
    if (!pobierz) return Promise.resolve()
    const epokaStartu = epoka
    ustaw(w, { ...w.stan, ladowanie: true })
    const dzialanie: Promise<void> = (async () => {
      let wynik: WynikPobrania<unknown>
      try {
        wynik = await pobierz()
      } catch (e) {
        wynik = {
          rodzaj: 'blad',
          komunikat: e instanceof Error && e.message ? e.message : 'Nie udało się pobrać danych.',
        }
      }
      // Dane z epoki sprzed `zapomnij` należą do poprzedniego konta: wyrzucamy je.
      if (epokaStartu !== epoka) return
      if (wynik.rodzaj === 'dane') {
        ustaw(w, { dane: wynik.dane, pobrano: zegar(), blad: null, ladowanie: false })
      } else if (wynik.rodzaj === 'brak_dostepu') {
        // Odmowa bramki: nie zostawiamy na ekranie danych, do których już nie mamy prawa.
        ustaw(w, { dane: null, pobrano: null, blad: wynik, ladowanie: false })
      } else {
        ustaw(w, { ...w.stan, blad: wynik, ladowanie: false })
      }
    })().finally(() => {
      if (w.wLocie === dzialanie) w.wLocie = null
    })
    w.wLocie = dzialanie
    return dzialanie
  }

  function zazadaj(
    klucz: string,
    pobierz: () => Promise<WynikPobrania<unknown>>,
    wymus = false,
  ): Promise<void> {
    const w = wpis(klucz)
    w.pobierz = pobierz
    if (w.wLocie) {
      // Wymuszone odświeżenie w trakcie pobierania: poczekaj na bieżące i pobierz jeszcze raz,
      // bo bieżące ruszyło przed kliknięciem i może nie widzieć nowszych danych.
      return wymus ? w.wLocie.then(() => uruchom(w)) : w.wLocie
    }
    if (!wymus && swiezy(w)) return Promise.resolve()
    return uruchom(w)
  }

  function ponowZaznaczone(): Promise<void> {
    const zadania: Promise<void>[] = []
    for (const [klucz, w] of wpisy) {
      if (w.sluchacze.size > 0 && w.pobierz) zadania.push(zazadaj(klucz, w.pobierz, true))
    }
    return Promise.all(zadania).then(() => undefined)
  }

  return {
    odczytaj: (klucz) => wpisy.get(klucz)?.stan ?? PUSTY_WPIS,

    subskrybuj(klucz, naZmiane) {
      const w = wpis(klucz)
      w.sluchacze.add(naZmiane)
      powiadomOgolne()
      return () => {
        w.sluchacze.delete(naZmiane)
        powiadomOgolne()
      }
    },

    subskrybujOgolne(naZmiane) {
      ogolne.add(naZmiane)
      return () => {
        ogolne.delete(naZmiane)
      }
    },

    zazadaj,

    odswiezWszystko() {
      for (const w of wpisy.values()) {
        if (w.sluchacze.size === 0 && !w.wLocie) w.stan = PUSTY_WPIS
      }
      return ponowZaznaczone()
    },

    zapomnij(ponow = true) {
      epoka++
      for (const w of wpisy.values()) {
        w.wLocie = null
        w.stan = PUSTY_WPIS
        for (const s of [...w.sluchacze]) s()
      }
      powiadomOgolne()
      return ponow ? ponowZaznaczone() : Promise.resolve()
    },

    najstarszePobranie() {
      let najstarsze: number | null = null
      for (const w of wpisy.values()) {
        const { pobrano } = w.stan
        if (w.sluchacze.size === 0 || pobrano === null) continue
        if (najstarsze === null || pobrano < najstarsze) najstarsze = pobrano
      }
      return najstarsze
    },
  }
}
