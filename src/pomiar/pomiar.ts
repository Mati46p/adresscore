// Pomiar ruchu bez ciasteczek: publiczne API modułu i podpięcie rdzenia do przeglądarki.
// Kontrakt: specs/001-panel-analityka/contracts/pomiar-klient.md.
//
//   startPomiaru()                 – montuje nasłuchy, zwraca sprzątanie (wołane z `Pomiar.tsx`)
//   odslona(ekran, sciezka)        – nowa odsłona ekranu (poprzednią domyka jej jedyne `wyjscie`)
//   produktowe(nazwa, wlasciwosci) – krok lejka produktowego (zamknięta lista nazw)
//   udostepnienie(element, kanal)  – udostępnienie
//   klasaUrzadzenia()              – klasa urządzenia z UA (do sieci wychodzi klasa, nie UA)
//   pomiarWylaczony(), ustawPomiar(), subskrybujZgode() – sprzeciw (zgoda.ts), dla przełącznika
//
// Wszystko jest NO-OP-em, dopóki pomiar nie wystartował, i przy wyłączonym pomiarze (sprzeciw
// użytkownika albo Global Privacy Control). Żadna funkcja tego modułu nie rzuca wyjątku:
// analityka nie ma prawa zepsuć nawigacji ani interakcji.
//
// BUDŻET PACZKI (SC-002, SC-003): ten plik i jego statyczne zależności (rdzeń, kolejka, transport,
// źródło, fraza) siedzą w głównej paczce, więc są małe i bez obserwatorów. Cięższe obserwatory
// (czas w sekcjach, przyciski, Web Vitals, czyszczenie błędów) ładuje dynamiczny `import()`
// w czasie bezczynności wątku, po pierwszym renderze (`obserwatory.ts`).

import type { Ekran } from '@/wynik/url'
import type { SurowyBlad } from './bledy.ts'
import { utworzKolejke } from './kolejka.ts'
import type { KanalUdostepnienia, NazwaProduktowa, Urzadzenie, Wlasciwosci } from './kontrakt.ts'
import type { Rdzen } from './rdzen.ts'
import { utworzRdzen } from './rdzen.ts'
import { utworzTransport } from './transport.ts'
import { klasaUrzadzeniaZUa } from './urzadzenie.ts'
import { pomiarWylaczony } from './zgoda.ts'
import { hostWewnetrzny, zrodloWejscia } from './zrodlo.ts'

export { pomiarWylaczony, subskrybujZgode, ustawPomiar, wylaczonyPrzezGpc } from './zgoda.ts'

type ModulObserwatorow = typeof import('./obserwatory.ts')

/** Po ilu ms najpóźniej startują obserwatory, gdy wątek jest stale zajęty. */
const MAKS_OPOZNIENIE_OBSERWATOROW_MS = 1500

/** Ile surowych błędów pamiętamy, zanim załaduje się moduł czyszczący (`bledy.ts`). */
const MAKS_WCZESNYCH_BLEDOW = 5

let rdzen: Rdzen | null = null
let aktywny = false
let obserwatory: ModulObserwatorow | null = null
/** Błędy z pierwszych sekund: surowe, bez obróbki – czyści je leniwy moduł, gdy się załaduje. */
const wczesneBledy: SurowyBlad[] = []

// Maleńki nasłuch zamiast całego modułu błędów w głównej paczce: reszta (regexpy czyszczące,
// kontrakt z rdzeniem) przychodzi razem z obserwatorami. Nic z pierwszych sekund nie ginie.
const naWczesnyBlad = (zdarzenie: ErrorEvent) => {
  if (wczesneBledy.length < MAKS_WCZESNYCH_BLEDOW) {
    wczesneBledy.push({ powod: zdarzenie.error ?? zdarzenie.message, plik: zdarzenie.filename })
  }
}
const naWczesneOdrzucenie = (zdarzenie: PromiseRejectionEvent) => {
  if (wczesneBledy.length < MAKS_WCZESNYCH_BLEDOW) {
    wczesneBledy.push({ powod: zdarzenie.reason, obietnica: true })
  }
}
function odepnijWczesne() {
  window.removeEventListener('error', naWczesnyBlad)
  window.removeEventListener('unhandledrejection', naWczesneOdrzucenie)
}

function bezpiecznie(funkcja: () => void) {
  try {
    funkcja()
  } catch {
    // Pomiar nie psuje niczego, co robi użytkownik.
  }
}

/** Klasa urządzenia z UA, liczona lokalnie. */
export function klasaUrzadzenia(): Urzadzenie {
  if (typeof navigator === 'undefined') return 'inne'
  return klasaUrzadzeniaZUa(navigator.userAgent, window.innerWidth, navigator.maxTouchPoints)
}

/** Rdzeń z prawdziwymi zależnościami przeglądarki. Tworzony raz (przeżywa ponowny start). */
function utworzRdzenPrzegladarki(): Rdzen {
  const transport = utworzTransport({
    beacon:
      typeof navigator.sendBeacon === 'function' ? navigator.sendBeacon.bind(navigator) : undefined,
    zadanie: typeof fetch === 'function' ? fetch.bind(globalThis) : undefined,
  })
  const kolejka = utworzKolejke({
    wyslij: transport,
    wylaczony: pomiarWylaczony,
    czyUkryta: () => document.visibilityState === 'hidden',
  })
  return utworzRdzen({
    kolejka,
    teraz: () => performance.now(),
    widoczna: () => document.visibilityState === 'visible',
    okno: () => ({
      dno: window.scrollY + window.innerHeight,
      wysokoscDokumentu: document.documentElement.scrollHeight,
      wysokoscOkna: window.innerHeight,
    }),
    dno: () => window.scrollY + window.innerHeight,
    wylaczony: pomiarWylaczony,
    urzadzenie: klasaUrzadzenia(),
    // Źródło ŁADOWANIA strony czytamy raz, zanim cokolwiek zdąży przepisać adres.
    wejscie: zrodloWejscia(location.href, document.referrer, location.host),
    wlasnyHost: hostWewnetrzny(location.host),
  })
}

/**
 * Ładuje obserwatory (czas w sekcjach, CTA, Web Vitals, czyszczenie błędów) po pierwszym
 * renderze, w bezczynności wątku. Do tego czasu błędy łapie maleńki nasłuch z bufora.
 * Zwraca funkcję anulującą. Ponowny start (StrictMode, ponowne zamontowanie) korzysta
 * z już załadowanego modułu i włącza go od razu, bez okna, w którym błąd by przepadł.
 */
function zaplanujObserwatory(r: Rdzen): () => void {
  let anulowano = false
  const wlacz = (modul: ModulObserwatorow) => {
    odepnijWczesne()
    modul.start(
      (sekcja, rodzaj, cel) => bezpiecznie(() => r.klik(sekcja, rodzaj, cel)),
      (komunikat) => bezpiecznie(() => r.blad(komunikat)),
      wczesneBledy.splice(0),
    )
    r.ustawObserwatory(modul)
  }
  const wylacz = () => {
    r.ustawObserwatory(null)
    obserwatory?.stop()
  }

  if (obserwatory) {
    wlacz(obserwatory)
    return wylacz
  }

  window.addEventListener('error', naWczesnyBlad)
  window.addEventListener('unhandledrejection', naWczesneOdrzucenie)
  const zaladuj = () => {
    if (anulowano) return
    import('./obserwatory.ts')
      .then((modul) => {
        obserwatory = modul
        if (!anulowano) bezpiecznie(() => wlacz(modul))
      })
      .catch(() => {
        // Brak obserwatorów (np. chunk niedostępny) = brak czasu w sekcjach i CTA, reszta działa.
      })
  }
  // Safari nie ma `requestIdleCallback` – tam zwykły timer po pierwszym malowaniu.
  const bezczynnosc = typeof window.requestIdleCallback === 'function'
  const uchwyt = bezczynnosc
    ? window.requestIdleCallback(zaladuj, { timeout: MAKS_OPOZNIENIE_OBSERWATOROW_MS })
    : window.setTimeout(zaladuj, 500)
  return () => {
    anulowano = true
    if (bezczynnosc) window.cancelIdleCallback(uchwyt)
    else window.clearTimeout(uchwyt)
    odepnijWczesne()
    wylacz()
  }
}

/**
 * Montuje nasłuchy pomiaru i zwraca sprzątanie. Drugi start przed sprzątaniem jest ignorowany.
 *
 * Sprzątanie odpina nasłuchy i obserwatory, ale NIE zamyka bieżącej odsłony: StrictMode w dev
 * montuje efekt dwa razy (start → sprzątanie → start) i zamknięcie odsłony dałoby fałszywe
 * `wyjscie` + `odslona` tuż po starcie. Ponowny start trafia w tę samą odsłonę i jest
 * ignorowany przez jej klucz.
 */
export function startPomiaru(): () => void {
  if (typeof window === 'undefined' || aktywny) return () => {}
  try {
    rdzen ??= utworzRdzenPrzegladarki()
    const r = rdzen
    aktywny = true

    // Pierwsze ukrycie karty domyka bieżącą odsłonę (jej jedyne `wyjscie`); powrót na kartę nie
    // otwiera nowego odcinka tej odsłony – szczegóły w nagłówku `rdzen.ts`.
    const naWidocznosc = () =>
      bezpiecznie(() => (document.visibilityState === 'hidden' ? r.ukryj() : r.pokaz()))
    // `pagehide` bywa jedynym zdarzeniem zamknięcia (Safari, nawigacja do innej strony);
    // dubel po `visibilitychange` jest nieszkodliwy – odsłona jest już domknięta.
    const naUkrycie = () => bezpiecznie(() => r.ukryj())
    // Powrót z pamięci podręcznej stron (bfcache): `pageshow` z `persisted`.
    const naPowrot = (zdarzenie: PageTransitionEvent) =>
      bezpiecznie(() => {
        if (zdarzenie.persisted && document.visibilityState === 'visible') r.pokaz()
      })
    let ramka = 0
    const naScroll = () => {
      if (ramka) return
      ramka = window.requestAnimationFrame(() => {
        ramka = 0
        bezpiecznie(() => r.scroll())
      })
    }

    document.addEventListener('visibilitychange', naWidocznosc)
    window.addEventListener('pagehide', naUkrycie)
    window.addEventListener('pageshow', naPowrot)
    window.addEventListener('scroll', naScroll, { passive: true })
    const anulujObserwatory = zaplanujObserwatory(r)

    return () => {
      document.removeEventListener('visibilitychange', naWidocznosc)
      window.removeEventListener('pagehide', naUkrycie)
      window.removeEventListener('pageshow', naPowrot)
      window.removeEventListener('scroll', naScroll)
      if (ramka) window.cancelAnimationFrame(ramka)
      anulujObserwatory()
      aktywny = false
    }
  } catch {
    aktywny = false
    return () => {}
  }
}

/** Nowa odsłona ekranu. `sciezka` bez query i fragmentu (patrz `sciezkaStrony`). */
export function odslona(ekran: Ekran, sciezka: string): void {
  if (aktywny) bezpiecznie(() => rdzen?.odslona(ekran, sciezka))
}

/** Krok lejka produktowego z zamkniętej listy nazw; nieznane klucze właściwości giną. */
export function produktowe(nazwa: NazwaProduktowa, wlasciwosci?: Wlasciwosci): void {
  if (aktywny) bezpiecznie(() => rdzen?.produktowe(nazwa, wlasciwosci))
}

/** Udostępnienie: `element` to identyfikator przycisku z kodu (nie tekst użytkownika). */
export function udostepnienie(element: string, kanal: KanalUdostepnienia): void {
  if (aktywny) bezpiecznie(() => rdzen?.udostepnienie(element, kanal))
}
