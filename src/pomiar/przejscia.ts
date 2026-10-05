// Przejścia stanu aplikacji → zdarzenia pomiaru (contracts/pomiar-klient.md, tabela przejść).
// CZYSTA funkcja: porównuje poprzednią i następną migawkę stanu i zwraca listę akcji. Wołający
// (`Pomiar.tsx`) tylko je wykonuje – dzięki temu reguły („co jest nową odsłoną”, „kiedy karta
// adresu”) są pod testem, a nie schowane w komponencie bez UI.
//
// Migawka zawiera tylko to, co pomiar czyta ze stanu. Stan zmienia się przy każdym suwaku wag,
// więc funkcja musi być tania i zwracać pustą listę, gdy nic się nie liczy.

import type { StanAplikacji } from '@/wynik/stan'
import type { NazwaProduktowa } from './kontrakt.ts'

export interface Migawka {
  ekran: string
  /** Indeks wybranego adresu; ma znaczenie tylko na ekranie `okolica`. */
  wybrany: number | null
  /** Liczba adresów na liście porównania. */
  porownanie: number
  /** `'wynik'` = wynik łączny; inaczej id wskaźnika pokazywanego na mapie. */
  warstwa: string
  tryb: string
}

export type Akcja =
  | { rodzaj: 'odslona'; ekran: string }
  | { rodzaj: 'produktowe'; nazwa: NazwaProduktowa; wlasciwosci?: Record<string, string> }

export function migawka(
  s: Pick<StanAplikacji, 'ekran' | 'wybrany' | 'porownanie' | 'warstwa' | 'tryb'>,
): Migawka {
  return {
    ekran: s.ekran,
    wybrany: s.wybrany,
    porownanie: s.porownanie.length,
    warstwa: s.warstwa,
    tryb: s.tryb,
  }
}

/**
 * Akcje wynikające z przejścia `poprzedni` → `nastepny`. `poprzedni = null` to start pomiaru:
 * traktujemy go jak przejście z „niczego” – otwiera się odsłona bieżącego ekranu, a wejście od razu
 * na kartę adresu, ekran Miasto albo tryb Biznes (link) liczy się jako użycie tego kroku lejka.
 * Lista porównania i warstwa mapy ze startu NIE liczą się jako dodanie ani zmiana: użytkownik
 * jeszcze niczego nie zrobił, stan przyszedł z linku.
 *
 * KOLEJNOŚĆ jest znaczeniem: odsłona zawsze pierwsza, bo zdarzenia produktowe należą do ekranu,
 * który ta odsłona otwiera.
 */
export function przejscia(poprzedni: Migawka | null, nastepny: Migawka): Akcja[] {
  // Start: „poprzedni” stan ma te same lista porównania i warstwę (nic się nie zmieniło z ręki
  // użytkownika), ale żadnego ekranu ani trybu – stąd odsłona i kroki lejka zależne od wejścia.
  const p: Omit<Migawka, 'ekran' | 'tryb'> & { ekran: string | null; tryb: string | null } =
    poprzedni ?? {
      ekran: null,
      wybrany: null,
      porownanie: nastepny.porownanie,
      warstwa: nastepny.warstwa,
      tryb: null,
    }
  const akcje: Akcja[] = []
  const naOkolicy = nastepny.ekran === 'okolica'

  // Nowa odsłona: inny ekran albo, na karcie, inny adres. Wybór adresu na wyszukiwarce (klik w
  // mapę) niczego nie zmienia, a start z linku `/adres/<slug>` zaczyna na okolicy z `wybrany = null`
  // i dopiero po wczytaniu danych dostaje wartość – ten przeskok null → liczba NIE jest nową odsłoną
  // (adres w pasku ten sam).
  const innyEkran = p.ekran !== nastepny.ekran
  const innyAdres =
    naOkolicy && p.wybrany !== null && nastepny.wybrany !== null && p.wybrany !== nastepny.wybrany
  if (innyEkran || innyAdres) akcje.push({ rodzaj: 'odslona', ekran: nastepny.ekran })

  // Karta adresu: wybrany staje się niepusty (także po wczytaniu danych przy starcie z linku)
  // albo zmienia się na inny adres. Nie przy każdej zmianie stanu.
  if (naOkolicy && nastepny.wybrany !== null) {
    if (p.ekran !== 'okolica' || p.wybrany !== nastepny.wybrany) {
      akcje.push({ rodzaj: 'produktowe', nazwa: 'karta_adresu' })
    }
  }

  if (nastepny.porownanie > p.porownanie) {
    akcje.push({ rodzaj: 'produktowe', nazwa: 'porownanie_dodaj' })
  }

  if (nastepny.warstwa !== p.warstwa && nastepny.warstwa !== 'wynik') {
    akcje.push({
      rodzaj: 'produktowe',
      nazwa: 'warstwa_mapy',
      wlasciwosci: { warstwa: nastepny.warstwa },
    })
  }

  if (nastepny.tryb === 'biznes' && p.tryb !== 'biznes') {
    akcje.push({ rodzaj: 'produktowe', nazwa: 'tryb_biznes' })
  }

  if (nastepny.ekran === 'miasto' && p.ekran !== 'miasto') {
    akcje.push({ rodzaj: 'produktowe', nazwa: 'tryb_miasto' })
  }

  return akcje
}
