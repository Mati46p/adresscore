// Rdzeń pomiaru: cykl życia odsłony, składanie zdarzeń i reguły prywatności. BEZ DOM –
// wszystko, co dotyka przeglądarki (zegar, widoczność karty, wymiary okna, kolejka, obserwatory),
// wchodzi przez `Zaleznosci`, więc całość testuje się na atrapach (rdzen.test.ts). `pomiar.ts`
// podpina prawdziwe zależności i wystawia publiczne API.
//
// ODSŁONA I WYJŚCIE
//   `odslona(ekran, sciezka)` zamyka poprzednią odsłonę (`wyjscie` z czasem WIDOCZNYM, głębokością
//   przewinięcia, sekcjami i CTA), potem otwiera nową. Ta sama odsłona (ten sam ekran i ścieżka)
//   wołana drugi raz jest ignorowana: StrictMode montuje efekt dwa razy, a start z linku
//   `/adres/<slug>` zaczyna na okolicy bez wybranego adresu i dopiero po wczytaniu danych wybrany
//   dostaje wartość – adres w pasku ten sam, więc to nie jest nowa odsłona.
//
//   Ekran `panel` (admin) NIE jest mierzony: ruch admina nie wchodzi do statystyk. Wejście na
//   panel zamyka poprzednią odsłonę i nie otwiera żadnej; zdarzenia z panelu są ignorowane.
//
// `WYJŚCIE` WYCHODZI NAJWYŻEJ RAZ NA ODSŁONĘ (FR-003)
//   Przy pierwszym z trzech: zmiana odsłony (nawigacja w aplikacji), ukrycie karty
//   (`visibilitychange: hidden`) albo `pagehide`. Po wysłaniu odsłona jest DOMKNIĘTA: kolejne
//   ukrycia niczego nie wysyłają (dubel `pagehide` po `visibilitychange` blokuje ta sama flaga
//   `domknieta`), a powrót na kartę (`pokaz`) nie otwiera ani nowego odcinka czasu, ani nowej
//   odsłony. `ms`, sekcje i CTA to wartości od otwarcia odsłony (nie przyrost), `scroll_pc` to
//   najgłębszy punkt do tej chwili. Inny ekran lub adres otwiera się normalnie także po
//   domknięciu poprzedniej odsłony (jej zamknięcie jest wtedy no-opem, bo `wyjscie` już wyszło).
//   Zdarzenia `klik`, `produktowe`, `udostepnienie` i `blad` są osobne i wychodzą także po
//   domknięciu; jednorazowe jest tylko `wyjscie`.
//   POWÓD: baza dopasowuje do odsłony jedno `wyjscie` i liczy jeden wiersz `wyjscie` jako jedną
//   odsłonę (zasięg sekcji = odsłony z sekcją / odsłony ekranu), więc drugie `wyjscie` tej samej
//   odsłony zawyżyłoby zasięg ponad 100%.
//   KONSEKWENCJA DLA BAZY: czas, sekcje i CTA obejmują okres od otwarcia odsłony do pierwszego
//   ukrycia karty albo opuszczenia ekranu. To, co czytelnik robi po powrocie na kartę, nie jest
//   już raportowane, więc czasy są PODŁOGĄ (spec: „czasy wizyty są podłogą”).
//
// KOLEJNOŚĆ I CZAS W BAZIE
//   `czas` zdarzenia ustawia baza (`now()` transakcji), więc wszystkie zdarzenia z jednej paczki
//   mają ten sam czas. Żeby odsłony różnych ekranów nigdy nie dzieliły transakcji (a `lag(czas)`
//   po odcisku wymaga różnych czasów), zmiana odsłony ZAMYKA kolejkę: paczka kończy się
//   `wyjscie` poprzedniej odsłony, a `odslona` następnej otwiera nową. Zdarzenia w paczce
//   zachowują kolejność tablicy.
//
// WEB VITALS: dołączane do paczki przy pierwszym ukryciu karty i przypisane do ekranu WEJŚCIA
// (patrz witale.ts).

import type { Ekran } from '@/wynik/url'
import { normalizujFraze, ZNACZNIK_ODRZUCONO } from './fraza.ts'
import type { Kolejka } from './kolejka.ts'
import type {
  CtaPomiar,
  KanalUdostepnienia,
  MetrykaWital,
  NazwaProduktowa,
  RodzajKliku,
  SekcjaPomiar,
  Urzadzenie,
  Wlasciwosci,
  Zdarzenie,
} from './kontrakt.ts'
import {
  KANALY_UDOSTEPNIENIA,
  MAX_CZAS_MS,
  MAX_ELEMENT,
  MAX_ETYKIETA,
  MAX_KOMUNIKAT,
  MAX_WYNIKOW,
  NAZWY_PRODUKTOWE,
  RODZAJE_KLIKU,
  RODZAJE_WYSZUKANIA,
  SEPARATOR,
  WLASCIWOSCI_PRODUKTOWE,
  WZORZEC_WARSTWY,
} from './kontrakt.ts'
import { procentPrzewiniecia } from './przewiniecie.ts'
import { sciezkaStrony } from './sciezka.ts'
import { type Stoper, utworzStoper } from './stoper.ts'
import { oczyscBiale, przytnij } from './tekst.ts'
import type { ZrodloWejscia } from './zrodlo.ts'

/** Wymiary okna i dokumentu w px (do głębokości przewinięcia). */
export interface Okno {
  /** Dolna krawędź okna liczona od góry dokumentu: `scrollY + wysokość okna`. */
  dno: number
  wysokoscDokumentu: number
  wysokoscOkna: number
}

/** To, czego rdzeń potrzebuje od leniwie ładowanych obserwatorów (`obserwatory.ts`). */
export interface Obserwatory {
  nowyWidok(): void
  wstrzymaj(): void
  wznow(): void
  zbierz(): { sk?: SekcjaPomiar[]; ct?: CtaPomiar[] }
  witale(): readonly { n: MetrykaWital; v: number }[]
}

export interface Zaleznosci {
  kolejka: Pick<Kolejka, 'dodaj' | 'zamknij'>
  /** Monotoniczny zegar w ms (`performance.now`). */
  teraz: () => number
  /** Czy karta jest widoczna (`document.visibilityState === 'visible'`). */
  widoczna: () => boolean
  /** Wymiary okna i dokumentu: odczyt wysokości dokumentu wymusza układ, więc tylko przy wysyłce. */
  okno: () => Okno
  /** Samo `scrollY + wysokość okna` – tani odczyt dla zdarzenia przewinięcia (bez wymuszania układu). */
  dno: () => number
  wylaczony: () => boolean
  urzadzenie: Urzadzenie
  /** Źródło ŁADOWANIA strony (referer, UTM, identyfikator kliknięcia) – dla pierwszej odsłony. */
  wejscie: ZrodloWejscia
  /** Własny host w postaci `rh` (przejścia wewnątrz aplikacji; serwer czyta je jako wewnętrzne). */
  wlasnyHost: string
}

export interface Rdzen {
  odslona(ekran: Ekran, sciezka: string): void
  produktowe(nazwa: NazwaProduktowa, wlasciwosci?: Wlasciwosci): void
  udostepnienie(element: string, kanal: KanalUdostepnienia): void
  klik(sekcja: string, rodzaj: RodzajKliku, cel: string): void
  blad(komunikat: string): void
  /**
   * Karta zeszła w tło albo strona jest zamykana (`visibilitychange: hidden`, `pagehide`).
   * Pierwsze takie zdarzenie domyka bieżącą odsłonę (wysyła jej `wyjscie`) i dołącza Web Vitals;
   * kolejne niczego już nie wysyłają.
   */
  ukryj(): void
  /** Karta znów widoczna: wznawia obserwatory, ale NIE otwiera nowego odcinka domkniętej odsłony. */
  pokaz(): void
  /** Zdarzenie przewinięcia (już ograniczone do jednego na klatkę przez wołającego). */
  scroll(): void
  ustawObserwatory(obserwatory: Obserwatory | null): void
}

/** Błędów klienta zgłaszanych z jednej odsłony (kontrakt: najwyżej 5; powtórki liczą się raz). */
export const MAX_BLEDOW_NA_ODSLONE = 5
/** Sygnałów UX (`klik`: furia, martwy) z jednej odsłony. */
export const MAX_SYGNALOW_NA_ODSLONE = 8
/**
 * Identyczne zdarzenie produktowe lub sygnał w tym oknie to powtórka z tego samego momentu (efekt
 * zamontowany dwa razy w StrictMode, podwójne odświeżenie komponentu), nie dwa działania
 * człowieka. Okno jest krótkie celowo: człowiek, który klika kolejne adresy co pół sekundy,
 * wykonuje kolejne działania i każde ma się policzyć.
 */
export const OKNO_POWTORKI_MS = 400

/** Ekran panelu admina: porównujemy jako tekst, bo typ `Ekran` dostaje `panel` w osobnej fazie. */
const EKRAN_PANELU: string = 'panel'

interface Widok {
  klucz: string
  ekran: Ekran
  sciezka: string
  /** Czas WIDOCZNY od otwarcia odsłony do jej domknięcia. */
  czas: Stoper
  /** Najgłębszy dotąd punkt (px od góry dokumentu), kumulatywnie. */
  dno: number
  /** Czy `wyjscie` już wyszło: odsłona jest domknięta i drugiego nie będzie (strażnik dubla). */
  domknieta: boolean
  bledy: Set<string>
  sygnaly: number
}

type Dane = Record<string, string | number | boolean>

/* -------------------------------------------------------------------------- */
/* Właściwości zdarzeń produktowych                                            */
/* -------------------------------------------------------------------------- */

/** Wartość jednej dozwolonej właściwości albo `undefined`, gdy jest nieprawidłowa (właściwość ginie). */
function oczyscWartosc(klucz: string, wartosc: unknown): string | number | boolean | undefined {
  switch (klucz) {
    case 'wynikow':
      return typeof wartosc === 'number' && Number.isFinite(wartosc) && wartosc >= 0
        ? Math.min(Math.round(wartosc), MAX_WYNIKOW)
        : undefined
    case 'rodzaj':
      return typeof wartosc === 'string' &&
        (RODZAJE_WYSZUKANIA as readonly string[]).includes(wartosc)
        ? wartosc
        : undefined
    case 'warstwa':
      return typeof wartosc === 'string' && WZORZEC_WARSTWY.test(wartosc) ? wartosc : undefined
    case 'kanal':
      return typeof wartosc === 'string' &&
        (KANALY_UDOSTEPNIENIA as readonly string[]).includes(wartosc)
        ? wartosc
        : undefined
    case 'element': {
      const tekst = typeof wartosc === 'string' ? przytnij(oczyscBiale(wartosc), MAX_ELEMENT) : ''
      return tekst || undefined
    }
    default:
      return undefined
  }
}

/**
 * Właściwości `wyszukanie_bez_wyniku`. Fraza przechodzi TUTAJ przez filtr danych osobowych
 * (idempotentny: ponowna normalizacja już znormalizowanej frazy niczego nie zmienia), więc
 * nawet wywołanie z surowym tekstem nie wyśle e-maila ani telefonu. Odrzucona fraza zostawia
 * znacznik – `fraza: '[odrzucono]'` (grupuje się w liście braków) i `odrzucono: true`.
 */
function wlasciwosciBezWyniku(w: Wlasciwosci | undefined): Dane {
  const surowa = w?.fraza
  const wynik =
    typeof surowa === 'string' && w?.odrzucono !== true
      ? normalizujFraze(surowa)
      : { odrzucono: true as const }
  return 'fraza' in wynik ? { fraza: wynik.fraza } : { fraza: ZNACZNIK_ODRZUCONO, odrzucono: true }
}

/** Tylko klucze dozwolone dla danej nazwy, z poprawnymi wartościami; reszta ginie. */
function oczyscWlasciwosci(nazwa: NazwaProduktowa, w: Wlasciwosci | undefined): Dane | undefined {
  if (nazwa === 'wyszukanie_bez_wyniku') return wlasciwosciBezWyniku(w)
  const dozwolone: readonly string[] = WLASCIWOSCI_PRODUKTOWE[nazwa]
  const wynik: Dane = {}
  if (w) {
    for (const klucz of dozwolone) {
      const wartosc = oczyscWartosc(klucz, w[klucz])
      if (wartosc !== undefined) wynik[klucz] = wartosc
    }
  }
  return Object.keys(wynik).length > 0 ? wynik : undefined
}

/* -------------------------------------------------------------------------- */
/* Fabryka                                                                     */
/* -------------------------------------------------------------------------- */

/** Ścieżka z ostatniej bramki przed siecią: bez query i fragmentu, zaczyna się od „/”, ≤ limit. */
function czystaSciezka(sciezka: string): string {
  return sciezkaStrony(sciezka.startsWith('/') ? sciezka : `/${sciezka}`, '')
}

export function utworzRdzen(z: Zaleznosci): Rdzen {
  let biezaca: Widok | null = null
  /** Ekran i ścieżka pierwszej zmierzonej odsłony tego ładowania strony: do niej należą witale. */
  let wejsciowy: { ekran: Ekran; sciezka: string } | null = null
  let obserwatory: Obserwatory | null = null
  const ostatnie = new Map<string, number>()

  const kontekst = (w: Widok) => ({ e: w.ekran, s: w.sciezka, u: z.urzadzenie }) as const

  /**
   * Czy to powtórka tego samego zdarzenia w oknie OKNO_POWTORKI_MS od ostatniego PRZYJĘTEGO
   * (okno nie przesuwa się z każdą odrzuconą powtórką, więc seria świadomych kliknięć co sekundę
   * nie zostanie zdławiona w całości).
   */
  function powtorka(podpis: string): boolean {
    const teraz = z.teraz()
    const poprzednio = ostatnie.get(podpis)
    if (poprzednio !== undefined && teraz - poprzednio < OKNO_POWTORKI_MS) return true
    ostatnie.set(podpis, teraz)
    if (ostatnie.size > 64) {
      for (const [klucz, czas] of ostatnie)
        if (teraz - czas >= OKNO_POWTORKI_MS) ostatnie.delete(klucz)
    }
    return false
  }

  function zmierzScroll(widok: Widok): number {
    const okno = z.okno()
    widok.dno = Math.max(widok.dno, okno.dno)
    return procentPrzewiniecia(widok.dno, okno.wysokoscDokumentu, okno.wysokoscOkna)
  }

  /**
   * `wyjscie` odsłony albo `null`, gdy odsłona jest już domknięta (jedyne `wyjscie` wyszło).
   * Pierwsze wywołanie ją domyka: zatrzymuje czas widoczny i zbiera sekcje oraz CTA, wszystko od
   * otwarcia odsłony. Pierwsze wywołanie zawsze coś oddaje, także przy zerowym czasie: odsłona
   * otwarta i od razu opuszczona to też pomiar.
   */
  function zbudujWyjscie(widok: Widok): Zdarzenie | null {
    if (widok.domknieta) return null
    widok.domknieta = true
    widok.czas.stop()
    const ms = Math.min(Math.round(widok.czas.ms()), MAX_CZAS_MS)
    const sc = zmierzScroll(widok)
    const zebrane: { sk?: SekcjaPomiar[]; ct?: CtaPomiar[] } = obserwatory?.zbierz() ?? {}
    const { sk, ct } = zebrane
    return {
      t: 'wyjscie',
      ...kontekst(widok),
      ms,
      sc,
      ...(sk ? { sk } : {}),
      ...(ct ? { ct } : {}),
    }
  }

  /**
   * Zmiana odsłony: domyka poprzednią (no-op, gdy jej `wyjscie` już wyszło przy ukryciu karty)
   * i zamyka paczkę (patrz „Kolejność i czas w bazie”) – także wtedy, bo w buforze mogą leżeć
   * zdarzenia z domkniętej odsłony, które nie mają dzielić transakcji z następną.
   */
  function zamknijWidok(widok: Widok) {
    const wyjscie = zbudujWyjscie(widok)
    if (wyjscie) z.kolejka.dodaj(wyjscie)
    z.kolejka.zamknij()
  }

  function otworzWidok(ekran: Ekran, sciezka: string, klucz: string) {
    const widok: Widok = {
      klucz,
      ekran,
      sciezka,
      czas: utworzStoper(z.teraz),
      // Zakładamy, że nowy ekran startuje od góry: przy otwarciu `scrollY` bywa jeszcze
      // poprzedniego ekranu (aplikacja przewija do góry dopiero po renderze).
      dno: Math.max(z.okno().wysokoscOkna, 0),
      domknieta: false,
      bledy: new Set(),
      sygnaly: 0,
    }
    if (z.widoczna()) widok.czas.start()
    biezaca = widok

    const pierwsza = wejsciowy === null
    if (pierwsza) wejsciowy = { ekran, sciezka }
    // Zewnętrzne źródło ma tylko wejście na stronę. Przeglądarka trzyma referer zewnętrzny przez
    // całe życie strony, więc kolejne odsłony dostają własny host (nawigacja wewnętrzna).
    const zrodlo: ZrodloWejscia = pierwsza ? z.wejscie : { rh: z.wlasnyHost }
    z.kolejka.dodaj({ t: 'odslona', ...kontekst(widok), ...zrodlo })
    obserwatory?.nowyWidok()
  }

  /** Czy pomiar trwa i jest odsłona, do której można przypisać zdarzenie. */
  function widokDoZdarzenia(): Widok | null {
    if (z.wylaczony()) {
      biezaca = null
      return null
    }
    return biezaca
  }

  return {
    odslona(ekran, sciezka) {
      if (z.wylaczony()) {
        biezaca = null
        return
      }
      if (ekran === EKRAN_PANELU) {
        if (biezaca) zamknijWidok(biezaca)
        biezaca = null
        return
      }
      const czysta = czystaSciezka(sciezka)
      const klucz = `${ekran}|${czysta}`
      if (biezaca?.klucz === klucz) return
      if (biezaca) zamknijWidok(biezaca)
      otworzWidok(ekran, czysta, klucz)
    },

    produktowe(nazwa, wlasciwosci) {
      const widok = widokDoZdarzenia()
      if (!widok || !(NAZWY_PRODUKTOWE as readonly string[]).includes(nazwa)) return
      const w = oczyscWlasciwosci(nazwa, wlasciwosci)
      if (powtorka(`${nazwa}|${JSON.stringify(w ?? null)}`)) return
      z.kolejka.dodaj(
        { t: 'produktowe', ...kontekst(widok), n: nazwa, ...(w ? { w } : {}) },
        // Wyłączenie pomiaru: zdarzenie musi wyjść ZANIM wybór zostanie zapisany, a po zapisie
        // kolejka i tak wyrzuci wszystko, co w niej leży – stąd wysyłka od razu.
        { natychmiast: nazwa === 'pomiar_wylaczony' },
      )
    },

    udostepnienie(element, kanal) {
      const widok = widokDoZdarzenia()
      if (!widok || !(KANALY_UDOSTEPNIENIA as readonly string[]).includes(kanal)) return
      const et = przytnij(oczyscBiale(String(element)), MAX_ELEMENT)
      if (!et || powtorka(`udostepnienie|${et}|${kanal}`)) return
      z.kolejka.dodaj({ t: 'udostepnienie', ...kontekst(widok), et, ku: kanal })
    },

    klik(sekcja, rodzaj, cel) {
      const widok = widokDoZdarzenia()
      if (!widok || !(RODZAJE_KLIKU as readonly string[]).includes(rodzaj)) return
      if (widok.sygnaly >= MAX_SYGNALOW_NA_ODSLONE) return
      const czlon = (tekst: string) => tekst.split(SEPARATOR).join('-')
      const et = przytnij([czlon(sekcja), rodzaj, czlon(cel)].join(SEPARATOR), MAX_ETYKIETA)
      if (powtorka(`klik|${et}`)) return
      widok.sygnaly++
      z.kolejka.dodaj({ t: 'klik', ...kontekst(widok), et })
    },

    blad(komunikat) {
      const widok = widokDoZdarzenia()
      if (!widok) return
      const k = przytnij(oczyscBiale(komunikat), MAX_KOMUNIKAT)
      // Powtórzony komunikat nie zużywa limitu: pętla jednego błędu nie wypycha innych.
      if (!k || widok.bledy.has(k) || widok.bledy.size >= MAX_BLEDOW_NA_ODSLONE) return
      widok.bledy.add(k)
      z.kolejka.dodaj({ t: 'blad', ...kontekst(widok), k })
    },

    ukryj() {
      const widok = widokDoZdarzenia()
      if (!widok) {
        // Pomiar wyłączony albo brak odsłony: kolejka sama wyrzuci to, co w niej leży.
        z.kolejka.zamknij()
        return
      }
      const dodatkowe: Zdarzenie[] = []
      const wyjscie = zbudujWyjscie(widok)
      if (wyjscie) dodatkowe.push(wyjscie)
      obserwatory?.wstrzymaj()
      if (obserwatory && wejsciowy) {
        for (const m of obserwatory.witale()) {
          dodatkowe.push({
            t: 'wital',
            e: wejsciowy.ekran,
            s: wejsciowy.sciezka,
            u: z.urzadzenie,
            n: m.n,
            v: m.v,
          })
        }
      }
      z.kolejka.zamknij(dodatkowe)
    },

    pokaz() {
      const widok = widokDoZdarzenia()
      if (!widok) return
      // Obserwatory wznawiamy zawsze: odsłona, która otworzy się po powrocie na kartę, ma je zastać
      // działające (a nasłuch kliknięć, czyli furia i martwy klik, i tak działa cały czas).
      obserwatory?.wznow()
      // Domknięta odsłona nie dostaje nowego odcinka czasu: jej `wyjscie` już wyszło. Czas rusza
      // tu tylko dla odsłony otwartej na ukrytej karcie, która jeszcze niczego nie naliczyła.
      if (!widok.domknieta) widok.czas.start()
    },

    scroll() {
      if (biezaca) biezaca.dno = Math.max(biezaca.dno, z.dno())
    },

    ustawObserwatory(nowe) {
      obserwatory = nowe
      if (!nowe || !biezaca) return
      // Obserwatory dołączyły po otwarciu odsłony: zaczynają od niej, od teraz (czas w sekcjach
      // z pierwszych sekund jest podłogą).
      nowe.nowyWidok()
      if (!z.widoczna()) nowe.wstrzymaj()
    },
  }
}
