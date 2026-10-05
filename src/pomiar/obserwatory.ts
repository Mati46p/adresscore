// Leniwa fasada obserwatorów: czas w sekcjach, przyciski (CTA) i Web Vitals. Rdzeń pomiaru
// (`pomiar.ts`) ładuje ten moduł dynamicznym `import()` po pierwszym renderze, w czasie
// bezczynności wątku, więc cała ta część (IntersectionObserver, MutationObserver,
// PerformanceObserver) nie obciąża głównej paczki aplikacji (SC-002) ani pierwszego malowania
// (SC-003). Jeden moduł zamiast czterech `import()` = jeden chunk i jedno żądanie.
//
// Rdzeń zna tylko interfejs `Obserwatory` z `rdzen.ts`; ten plik go spełnia (plus `start`/`stop`).
//
// SKANOWANIE DOM: ekrany ładują się leniwie, a ich treść dochodzi po wczytaniu danych, więc
// jednorazowy przegląd po zmianie ekranu nie wystarcza. Jeden `MutationObserver` na `body`
// (tylko `childList` + `subtree`, żadnych atrybutów) zaplanowuje przegląd; kolejne mutacje
// w międzyczasie niczego nie planują. To NIE jest debounce „od ostatniej mutacji” – przy
// stale zmieniającym się DOM-ie (animacje, wykresy) taki debounce nie odpaliłby nigdy,
// a ten daje przegląd najwyżej raz na OPOZNIENIE_SKANU_MS. Przegląd tylko czyta DOM,
// więc nie wzbudza własnego obserwatora (brak pętli samowzbudnej).

import { type SurowyBlad, zacznijBledy } from './bledy.ts'
import * as cta from './cta.ts'
import type { CtaPomiar, MetrykaWital, RodzajKliku, SekcjaPomiar } from './kontrakt.ts'
import * as sekcje from './sekcje.ts'
import * as odczytWitali from './witale.ts'

/** Co ile najwyżej przeglądamy DOM po zmianach. */
const OPOZNIENIE_SKANU_MS = 250
/** Po zmianie ekranu React zdąży wyrenderować nowy ekran (albo jego szkielet) przed przeglądem. */
const OPOZNIENIE_PO_ZMIANIE_MS = 120

let aktywne = false
let obserwatorDom: MutationObserver | null = null
let skan: ReturnType<typeof setTimeout> | null = null
let koniecBledow: (() => void) | null = null

function zaplanujSkan(opoznienie: number) {
  if (skan !== null) return
  skan = setTimeout(() => {
    skan = null
    // W tle nic nie widać, a wznowienie i tak robi świeży odczyt.
    if (document.visibilityState === 'hidden') return
    sekcje.skanuj()
    cta.skanuj()
  }, opoznienie)
}

/**
 * Uruchamia obserwatory. `zglosKlik` dostaje sygnały UX (furia, martwy klik), `zglosBlad`
 * oczyszczone komunikaty błędów, a `wczesneBledy` to błędy zebrane przed załadowaniem tego
 * modułu. Wołaj `nowyWidok()` zaraz potem dla odsłony, która już trwa.
 */
export function start(
  zglosKlik: (sekcja: string, rodzaj: RodzajKliku, cel: string) => void,
  zglosBlad: (komunikat: string) => void,
  wczesneBledy: readonly SurowyBlad[] = [],
): void {
  if (aktywne) return
  aktywne = true
  koniecBledow = zacznijBledy(zglosBlad, wczesneBledy)
  odczytWitali.zacznij()
  sekcje.zacznij()
  cta.zacznij(zglosKlik)
  if (typeof MutationObserver !== 'undefined') {
    obserwatorDom = new MutationObserver(() => zaplanujSkan(OPOZNIENIE_SKANU_MS))
    obserwatorDom.observe(document.body, { childList: true, subtree: true })
  }
  zaplanujSkan(0)
}

/** Nowa odsłona: zerowanie liczników i przegląd nowego ekranu. */
export function nowyWidok(): void {
  if (!aktywne) return
  sekcje.resetuj()
  cta.resetuj()
  zaplanujSkan(OPOZNIENIE_PO_ZMIANIE_MS)
}

export function wstrzymaj(): void {
  sekcje.wstrzymaj()
  cta.wstrzymaj()
}

export function wznow(): void {
  sekcje.wznow()
  cta.wznow()
  zaplanujSkan(0)
}

/** Sekcje i CTA od otwarcia odsłony (do jedynego `wyjscie` tej odsłony; rdzeń woła to raz). */
export function zbierz(): { sk?: SekcjaPomiar[]; ct?: CtaPomiar[] } {
  const sk = sekcje.zbierz()
  const ct = cta.zbierz()
  return { ...(sk ? { sk } : {}), ...(ct ? { ct } : {}) }
}

/** Web Vitals jeszcze niewysłane (każda metryka wychodzi raz). */
export function witale(): { n: MetrykaWital; v: number }[] {
  return odczytWitali.zbierz()
}

export function stop(): void {
  aktywne = false
  koniecBledow?.()
  koniecBledow = null
  obserwatorDom?.disconnect()
  obserwatorDom = null
  if (skan !== null) clearTimeout(skan)
  skan = null
  sekcje.zatrzymaj()
  cta.zatrzymaj()
  odczytWitali.zatrzymaj()
}
