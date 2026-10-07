// Pamięć pełnych danych per miasto (#223): ładowanie raz na miasto, najwyżej dwa miasta w pamięci,
// podpięcie słownika adresów w stanie aplikacji dla bieżącego miasta. Osobny plik bez Reacta i bez
// `import.meta.env` (jak `kompakt.ts`), żeby logikę dało się sprawdzić na gołym `node --test`:
// ładowanie (`wczytaj`) i stan aplikacji wchodzą z zewnątrz, a `dane.ts` składa pamięć z prawdziwym
// ładowaniem i Reactem (`useDane`). Względne importy typów, bo `@/kontrakty` Node nie rozwiąże.
import type { Adres, Manifest, PlikAdresow, PlikOkolic, WskaznikMeta } from '../kontrakty/index.ts'
import type { SlugMiasta } from '../kontrakty/miasta.ts'
import type { GrupyHeksow, WskaznikPrzygotowany } from './silnik.ts'

export interface Dane {
  /** Miasto, którego to dane. `useDane()` zwraca zawsze dane bieżącego miasta. */
  miasto: SlugMiasta
  plikAdresow: PlikAdresow
  adresy: Adres[]
  manifest: Manifest
  /**
   * Wszystkie warstwy manifestu w jego kolejności. Warstwa, która się nie wczytała, ma
   * `niedostepny` i brak danych pod każdym adresem – liczy się do pewności, nie do wyniku.
   */
  wskazniki: WskaznikPrzygotowany[]
  /** Id warstw pominiętych (inna wersja adresów albo błąd pobrania) z powodem. */
  pominiete: { id: string; powod: string }[]
  grupyHeksow: GrupyHeksow
  /**
   * Okolice adresów (jednostki SIM i miejscowości, #185). null = plik się nie wczytał albo jest
   * z innej wersji adresów – okolicą zostaje wtedy dzielnica Krakowa albo gmina (`okolicaAdresu`).
   * Miasta poza Krakowem nie mają tego pliku (D8): zawsze null.
   */
  okolice: PlikOkolic | null
}

export type StanDanych =
  | { stan: 'ladowanie' }
  | { stan: 'blad'; blad: string }
  | ({ stan: 'gotowe' } & Dane)

/**
 * Pełne dane trzymamy najwyżej dla tylu miast: bieżącego i poprzedniego (powrót do niego jest
 * natychmiastowy). Dane jednego miasta to 30–180 tys. obiektów adresów i 65–127 tablic wskaźników,
 * więc zbiór wszystkich 10 miast nie zmieściłby się w pamięci telefonu.
 */
export const MAKS_MIAST_W_PAMIECI = 2

/** Wycinek stanu aplikacji (`stan.ts`), którego potrzebuje pamięć; test podstawia własną instancję. */
export interface StanDlaPamieci {
  pobierzStan(): { miasto: SlugMiasta }
  podlaczDane(
    ids: readonly string[],
    wskazniki: readonly WskaznikMeta[],
    adresy: readonly Adres[],
  ): void
  subskrybuj(sluchacz: () => void): () => void
}

interface WpisMiasta {
  /** Jedno ładowanie na miasto, dopóki mieści się w pamięci: kolejne wywołania dostają tę samą obietnicę. */
  obietnica: Promise<StanDanych>
  /** Stan do odczytu bez czekania (`useDane`): `ladowanie` → `gotowe` albo `blad`. */
  stan: StanDanych
}

export function utworzPamiecDanych(
  wczytaj: (slug: SlugMiasta) => Promise<Dane>,
  aplikacja: StanDlaPamieci,
) {
  const LADOWANIE: StanDanych = { stan: 'ladowanie' }
  // Kolejność wstawiania = kolejność ostatniego użycia (`zaladujDane` przesuwa miasto na koniec).
  const wpisy = new Map<SlugMiasta, WpisMiasta>()
  const sluchacze = new Set<() => void>()
  let obserwujemyMiasto = false

  function powiadom() {
    for (const f of sluchacze) f()
  }

  /** Stan danych miasta bez uruchamiania ładowania; tożsamość stabilna, dopóki stan się nie zmieni. */
  function stanMiasta(slug: SlugMiasta): StanDanych {
    return wpisy.get(slug)?.stan ?? LADOWANIE
  }

  /**
   * Podpina słownik adresów w stanie aplikacji – wyłącznie dla miasta, które nadal jest bieżące.
   * Użytkownik mógł przełączyć miasto w trakcie ładowania: słownik miasta, które już nie jest
   * bieżące, dałby id adresów rozwiązane na cudzych danych. Dane tego miasta zostają w pamięci, a
   * podepnie je powrót do niego (`aktywuj`).
   */
  function podlaczGotowe(d: Dane) {
    if (aplikacja.pobierzStan().miasto !== d.miasto) return
    aplikacja.podlaczDane(
      d.plikAdresow.kolumny.id,
      d.wskazniki.map((w) => w.meta),
      d.adresy,
    )
  }

  function zakoncz(slug: SlugMiasta, wpis: WpisMiasta, wynik: StanDanych): StanDanych {
    // Miasto mogło wypaść z pamięci w trakcie ładowania (wyparły je dwa nowsze): wynik niepotrzebny.
    if (wpisy.get(slug) === wpis) {
      wpis.stan = wynik
      powiadom()
    }
    return wynik
  }

  /**
   * Startuje ładowanie danych miasta (raz na miasto, dopóki mieści się w pamięci) i zwraca obietnicę
   * stanu końcowego. Bez argumentu: bieżące miasto.
   */
  function zaladujDane(slug: SlugMiasta = aplikacja.pobierzStan().miasto): Promise<StanDanych> {
    const istniejacy = wpisy.get(slug)
    if (istniejacy) {
      // Ostatnio użyte na koniec: zwalniamy to miasto, którego nie używano najdłużej.
      wpisy.delete(slug)
      wpisy.set(slug, istniejacy)
      return istniejacy.obietnica
    }
    const wpis: WpisMiasta = { obietnica: Promise.resolve(LADOWANIE), stan: LADOWANIE }
    wpis.obietnica = wczytaj(slug)
      .then((d): StanDanych => {
        // Słownik adresów w stanie przed ogłoszeniem danych: id z linku rozwiązują się, zanim
        // komponenty zobaczą `gotowe` (kolejność jak przed #223). Wpis wyparty z pamięci nie podpina.
        if (wpisy.get(slug) === wpis) podlaczGotowe(d)
        return { stan: 'gotowe', ...d }
      })
      .then(
        (s) => zakoncz(slug, wpis, s),
        // Błąd ładowania i błąd podpięcia kończą się tak samo: komunikat zamiast wiecznego „ładowania”.
        (e: unknown) =>
          zakoncz(slug, wpis, { stan: 'blad', blad: e instanceof Error ? e.message : String(e) }),
      )
    wpisy.set(slug, wpis)
    while (wpisy.size > MAKS_MIAST_W_PAMIECI) {
      const najdawniejsze = wpisy.keys().next().value
      if (najdawniejsze === undefined) break
      wpisy.delete(najdawniejsze)
    }
    return wpis.obietnica
  }

  /**
   * Bieżące miasto się zmieniło: wczytuje jego dane albo bierze z pamięci. Dane z pamięci trzeba
   * podpiąć w stanie od razu – słownik adresów i meta warstw stanu wciąż należą do poprzedniego
   * miasta, a drugie ładowanie, które by je podpięło, nie nastąpi.
   */
  function aktywuj(slug: SlugMiasta) {
    // Błąd nie zostaje na całą sesję: ponowny wybór miasta ładuje je od nowa.
    if (wpisy.get(slug)?.stan.stan === 'blad') wpisy.delete(slug)
    void zaladujDane(slug)
    const s = stanMiasta(slug)
    if (s.stan === 'gotowe') podlaczGotowe(s)
    powiadom()
  }

  /**
   * Jedna subskrypcja stanu na pamięć: zmiana `miasto` uruchamia `aktywuj`, a komponenty dostają
   * powiadomienie, więc czytają stan nowego miasta. Trwa tyle, co moduł (jak sam stan), rejestruje
   * się przy pierwszym komponencie.
   */
  function obserwujMiasto() {
    if (obserwujemyMiasto) return
    obserwujemyMiasto = true
    let ostatnie = aplikacja.pobierzStan().miasto
    aplikacja.subskrybuj(() => {
      const slug = aplikacja.pobierzStan().miasto
      if (slug === ostatnie) return
      ostatnie = slug
      aktywuj(slug)
    })
  }

  /** Dla `useSyncExternalStore`: rejestruje komponent i uruchamia ładowanie bieżącego miasta. */
  function subskrybuj(f: () => void) {
    sluchacze.add(f)
    obserwujMiasto()
    void zaladujDane()
    return () => sluchacze.delete(f)
  }

  /** Stan danych bieżącego miasta (dla `useSyncExternalStore`: czysty odczyt, bez ładowania). */
  function stanBiezacego(): StanDanych {
    return stanMiasta(aplikacja.pobierzStan().miasto)
  }

  /** Dane bieżącego miasta albo null. */
  function daneJesliGotowe(): Dane | null {
    const s = stanBiezacego()
    return s.stan === 'gotowe' ? s : null
  }

  return { zaladujDane, stanMiasta, stanBiezacego, daneJesliGotowe, subskrybuj }
}
