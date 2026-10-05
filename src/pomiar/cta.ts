// Przyciski i linki w sekcjach: ekspozycje, kliknięcia i sygnały frustracji. Ładowany LENIWIE
// (`obserwatory.ts`). Wzorzec: z-dykty `analityka-cta.ts`.
//
// CO MIERZYMY (FR-003, FR-034):
//   - EKSPOZYCJE: element sterujący (`[data-cel]`, `button`, `a`, `[role=button]`) widoczny
//     w ≥ 50% przez ≥ 500 ms. Liczymy raz na element i odsłonę – przewijanie w górę i w dół
//     nie jest nową ekspozycją. Bez ekspozycji „przycisk z zerowym CTR” byłby nie do odróżnienia
//     od „nikt tu nie doszedł”.
//   - KLIKI w te same elementy. Klucz `sekcja§cel`; doklejany do `wyjscie` jako
//     `[klucz, ekspozycje, kliki]`, bez osobnego żądania na każde kliknięcie.
//   - SYGNAŁY UX jako osobne zdarzenia `klik`: furia (≥ 3 kliknięcia w promieniu 30 px
//     w 800 ms) i martwy klik (klik w element, który nic nie robi). Etykieta `sekcja§rodzaj§cel`.
//
// PRYWATNOŚĆ: stąd nie wychodzi treść. Nazwę celu daje `data-cel`, a bez niego `aria-label`
// albo tekst elementu zamieniony na slug (bez cyfr, żeby „Pokaż 2019” i „Pokaż 2020” były jednym
// przyciskiem), przycięty do 40 znaków, a dane osobowe w nazwie zastępuje `bez-nazwy`. Linki do
// stron o dynamicznym adresie (`/adres/<slug>`) dostają nazwę wzorca, nie adresu – inaczej każdy
// adres z listy rankingowej byłby osobnym „przyciskiem”. Zawartość pól formularza nie jest
// czytana wcale. Martwy klik zapisuje nazwę znacznika, nigdy tekst.
//
// Dwie warstwy jak w sekcje.ts: czyste funkcje i rejestr (testowane w cta.test.ts) oraz cienka
// warstwa DOM.

import { zawieraDaneOsobowe } from './fraza.ts'
import type { CtaPomiar, RodzajKliku } from './kontrakt.ts'
import { MAX_CEL, MAX_CTA, MAX_LICZNIK_CTA, SEPARATOR, WZORZEC_SEKCJI } from './kontrakt.ts'
import { oczyscBiale, przytnij } from './tekst.ts'

/* -------------------------------------------------------------------------- */
/* Furia                                                                       */
/* -------------------------------------------------------------------------- */

/** Ile kliknięć w jednym miejscu to frustracja. */
export const FURIA_KLIKNIEC = 3
/** W jakim czasie (ms) muszą paść – liczone od NAJNOWSZEGO kliknięcia wstecz. */
export const FURIA_OKNO_MS = 800
/** Promień (px), w którym kliknięcia to „to samo miejsce”. */
export const FURIA_PROMIEN_PX = 30

export interface KlikWMiejscu {
  x: number
  y: number
  t: number
}

export interface StanFurii {
  /** Ostatnie kliknięcia z bieżącej serii, najwyżej FURIA_KLIKNIEC. */
  historia: readonly KlikWMiejscu[]
  /** Czy ta seria została już zgłoszona (jedna osoba = jeden sygnał na serię). */
  zgloszona: boolean
}

export const FURIA_POCZATEK: StanFurii = { historia: [], zgloszona: false }

/**
 * Czy to kliknięcie domyka serię frustracji: co najmniej FURIA_KLIKNIEC kliknięć, wszystkie
 * w promieniu FURIA_PROMIEN_PX od nowego i nie starsze niż FURIA_OKNO_MS od niego.
 *
 * Seria zostaje zgłoszona DOKŁADNIE RAZ: siedem kliknięć w niedziałający przycisk to jeden sygnał,
 * nie pięć (wtedy jedna osoba wyglądałaby w panelu jak pięć). Nowa seria zaczyna się, gdy
 * od poprzedniego kliknięcia minie więcej niż okno. Czysta: stan wchodzi i wychodzi jako wartość.
 */
export function czyFuria(stan: StanFurii, klik: KlikWMiejscu): { stan: StanFurii; furia: boolean } {
  const ostatni = stan.historia[stan.historia.length - 1]
  const nowaSeria = !ostatni || klik.t - ostatni.t > FURIA_OKNO_MS
  const zgloszona = nowaSeria ? false : stan.zgloszona
  const wMiejscuICzasie = stan.historia.filter(
    (k) =>
      klik.t - k.t <= FURIA_OKNO_MS && Math.hypot(klik.x - k.x, klik.y - k.y) <= FURIA_PROMIEN_PX,
  )
  const historia = [...wMiejscuICzasie, klik].slice(-FURIA_KLIKNIEC)
  const furia = !zgloszona && historia.length >= FURIA_KLIKNIEC
  return { stan: { historia, zgloszona: zgloszona || furia }, furia }
}

/* -------------------------------------------------------------------------- */
/* Nazwy                                                                       */
/* -------------------------------------------------------------------------- */

/** Nazwa, gdy element nie ma nic, z czego dałoby się ją bezpiecznie ułożyć. */
export const CEL_BRAK = 'bez-nazwy'
/** Sekcja zastępcza dla elementów z `data-cel` poza jakąkolwiek sekcją. */
export const SEKCJA_BRAK = 'brak'

const ZNAKI_LACZACE = /[̀-ͯ]/g

/** Napis → slug `[a-z0-9-]`: bez diakrytyków (ł osobno, nie rozkłada się w NFD), z myślnikami. */
function slug(tekst: string): string {
  return tekst
    .normalize('NFD')
    .replace(ZNAKI_LACZACE, '')
    .replace(/[łŁ]/g, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function ciecie(nazwa: string): string {
  return przytnij(nazwa, MAX_CEL).replace(/-+$/, '')
}

export interface OpisElementu {
  /** Wartość `data-cel` – jawna nazwa nadana przez autora ekranu. */
  dataCel?: string | null
  ariaLabel?: string | null
  /** Widoczny tekst elementu. NIGDY zawartość pola formularza. */
  tekst?: string | null
  /** Surowy `href` linku. */
  href?: string | null
}

/**
 * Wzorzec dla linków do stron o dynamicznym adresie, `null` dla pozostałych. Dotyczy tylko
 * własnego serwisu (`baza` = adres bieżącej strony). Trasy: `/adres/<slug>` (także stare
 * `#/adres/<id>`) i `/katalog/<ulica>`.
 */
export function wzorzecLinku(href: string | null | undefined, baza: string): string | null {
  if (!href) return null
  let url: URL
  let wlasny: URL
  try {
    url = new URL(href, baza)
    wlasny = new URL(baza)
  } catch {
    return null
  }
  if (url.origin !== wlasny.origin) return null
  const sciezka =
    url.pathname === '/' && url.hash.startsWith('#/') ? url.hash.slice(1) : url.pathname
  if (/^\/adres\/./.test(sciezka)) return 'adres'
  if (/^\/katalog\/./.test(sciezka)) return 'katalog-ulica'
  return null
}

/**
 * Nazwa celu przycisku. Pierwszeństwo: jawne `data-cel` (cyfry zostają – autor wie, co robi),
 * wzorzec linku dynamicznego, `aria-label`, tekst. Nazwy wyprowadzone z tekstu tracą cyfry
 * (grupowanie wariantów jednego przycisku), a zawierające dane osobowe dają `CEL_BRAK`.
 * Wynik: `[a-z0-9-]`, ≤ MAX_CEL, nigdy pusty, nigdy z separatorem klucza.
 */
export function nazwaCelu(opis: OpisElementu, baza = 'https://adresscore.pl/'): string {
  const jawna = opis.dataCel ? ciecie(slug(opis.dataCel)) : ''
  if (jawna) return jawna
  const wzorzec = wzorzecLinku(opis.href, baza)
  if (wzorzec) return wzorzec
  for (const zrodlo of [opis.ariaLabel, opis.tekst]) {
    const tekst = oczyscBiale(zrodlo ?? '')
    if (!tekst) continue
    if (zawieraDaneOsobowe(tekst)) return CEL_BRAK
    const nazwa = ciecie(slug(tekst.replace(/\d+/g, ' ')))
    if (nazwa) return nazwa
  }
  return CEL_BRAK
}

/** Klucz CTA `sekcja§cel`. */
export function kluczCta(sekcja: string, cel: string): string {
  return `${sekcja}${SEPARATOR}${cel}`
}

/* -------------------------------------------------------------------------- */
/* Rejestr                                                                     */
/* -------------------------------------------------------------------------- */

interface WpisCta {
  klucz: string
  /** Czy nazwę nadał autor (`data-cel`) – takie przyciski mają pierwszeństwo przy cięciu do limitu. */
  jawny: boolean
  ekspozycje: number
  kliki: number
}

export interface RejestrCta {
  ekspozycja(klucz: string, jawny: boolean): void
  klik(klucz: string, jawny: boolean): void
  /**
   * Stan od otwarcia odsłony, ≤ MAX_CTA pozycji; niczego nie zeruje (rdzeń woła to raz, przy
   * jedynym `wyjscie` odsłony – nowa odsłona zaczyna od zera przez `reset()`).
   */
  zbierz(): CtaPomiar[] | null
  reset(): void
}

/** Ile różnych kluczy CTA śledzimy w jednej odsłonie (bezpiecznik na ekrany z długimi listami). */
const LIMIT_KLUCZY = 60

export function utworzRejestrCta(maks = MAX_CTA): RejestrCta {
  const wpisy = new Map<string, WpisCta>()

  function pobierz(klucz: string, jawny: boolean): WpisCta | null {
    const istniejacy = wpisy.get(klucz)
    if (istniejacy) {
      if (jawny) istniejacy.jawny = true
      return istniejacy
    }
    if (wpisy.size >= LIMIT_KLUCZY) return null
    const nowy: WpisCta = { klucz, jawny, ekspozycje: 0, kliki: 0 }
    wpisy.set(klucz, nowy)
    return nowy
  }

  return {
    ekspozycja(klucz, jawny) {
      const wpis = pobierz(klucz, jawny)
      if (wpis && wpis.ekspozycje < MAX_LICZNIK_CTA) wpis.ekspozycje++
    },
    klik(klucz, jawny) {
      const wpis = pobierz(klucz, jawny)
      if (wpis && wpis.kliki < MAX_LICZNIK_CTA) wpis.kliki++
    },
    zbierz() {
      // Kolejność przy cięciu do limitu: klikane najpierw (to ich dotyczy „klikalność”), potem
      // nazwane jawnie, potem najczęściej widziane. Przycisk widziany, a nieklikany, mieści się
      // w limicie dzięki temu, że kliknięć na ekranie jest zwykle mało.
      const wynik = [...wpisy.values()]
        .filter((w) => w.ekspozycje > 0 || w.kliki > 0)
        .sort(
          (a, b) =>
            b.kliki - a.kliki || Number(b.jawny) - Number(a.jawny) || b.ekspozycje - a.ekspozycje,
        )
        .slice(0, maks)
        .map((w): CtaPomiar => [w.klucz, w.ekspozycje, w.kliki])
      return wynik.length ? wynik : null
    },
    reset() {
      wpisy.clear()
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Warstwa DOM                                                                 */
/* -------------------------------------------------------------------------- */

/** Zgłoszenie sygnału UX (furia, martwy klik) do rdzenia. */
export type ZglosKlik = (sekcja: string, rodzaj: RodzajKliku, cel: string) => void

/** Co uznajemy za CTA warte liczenia. */
const SELEKTOR_CTA = '[data-cel], button, a, [role="button"]'

/** Cokolwiek, co z natury przyjmuje kliknięcie albo ma własną obsługę wskaźnika. */
const SELEKTOR_INTERAKTYWNY =
  'a, button, input, select, textarea, summary, label, [data-cel], [tabindex], [contenteditable], ' +
  '[draggable="true"], [role="button"], [role="link"], [role="tab"], [role="menuitem"], ' +
  '[role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], ' +
  '[role="combobox"], [role="textbox"], [role="searchbox"], [role="treeitem"]'

/** Mapa obsługuje wskaźnik sama (przeciąganie, klik w obiekt) – klik w nią nie jest „martwy”. */
const SELEKTOR_MAPY = 'canvas, .maplibregl-map, .mapboxgl-map'

/** Pola, z których NIE WOLNO czytać tekstu – mogłyby nieść treść użytkownika. */
const SELEKTOR_POLA = 'input, textarea, select, [contenteditable]'

/** Ile elementów obserwujemy naraz (bezpiecznik; realnie kilkanaście–kilkadziesiąt). */
const LIMIT_ELEMENTOW = 80
/** Przez ile ms element musi być widoczny, żeby liczyć się jako wyświetlony. */
const CZAS_EKSPOZYCJI_MS = 500

const rejestr = utworzRejestrCta()
let zglosKlik: ZglosKlik | null = null
let furia = FURIA_POCZATEK
let obserwator: IntersectionObserver | null = null
let kartaWidoczna = true
let sluchaKlikniec = false

interface StanElementu {
  policzony: boolean
  zegar: ReturnType<typeof setTimeout> | 0
}
const elementy = new Map<Element, StanElementu>()

/** Klucz sekcji, w której stoi element, albo `null` poza sekcjami (albo z błędnym kluczem). */
function sekcjaElementu(el: Element): string | null {
  const klucz = el.closest('[data-sekcja]')?.getAttribute('data-sekcja')
  return klucz && WZORZEC_SEKCJI.test(klucz) ? klucz : null
}

function opisElementu(el: Element): OpisElementu {
  const pole = el.matches(SELEKTOR_POLA)
  return {
    dataCel: el.getAttribute('data-cel'),
    ariaLabel: el.getAttribute('aria-label'),
    // Tekst pól formularza to treść użytkownika – nie czytamy go wcale.
    tekst: pole ? null : el.textContent,
    href: el.getAttribute('href'),
  }
}

function kluczElementu(el: Element): { klucz: string; jawny: boolean } | null {
  const sekcja = sekcjaElementu(el)
  const jawny = Boolean(el.getAttribute('data-cel')?.trim())
  // Poza sekcją liczymy tylko to, co autor oznaczył wprost.
  if (sekcja === null && !jawny) return null
  return {
    klucz: kluczCta(sekcja ?? SEKCJA_BRAK, nazwaCelu(opisElementu(el), location.href)),
    jawny,
  }
}

function znacznik(el: Element): string {
  return (
    el.tagName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 16) || 'wezel'
  )
}

/** Klik w coś, co nie reaguje na klik: ani semantycznie, ani wyglądem (kursor), ani mapa. */
function czyMartwy(el: Element): boolean {
  if (el.closest(SELEKTOR_INTERAKTYWNY) || el.closest(SELEKTOR_MAPY)) return false
  // `cursor: pointer` (dziedziczony) zdradza element z własną obsługą kliknięcia, np. kartę
  // zrobioną z `div` – to nie „martwy przycisk”.
  if (getComputedStyle(el).cursor === 'pointer') return false
  // Zaznaczanie tekstu to nie próba kliknięcia w przycisk.
  return (window.getSelection()?.toString() ?? '') === ''
}

function naKlik(zdarzenie: MouseEvent) {
  try {
    // Kliknięcia wywołane skryptem (`element.click()`) nie są działaniem człowieka.
    if (!zdarzenie.isTrusted || !(zdarzenie.target instanceof Element) || !zglosKlik) return
    const cel = zdarzenie.target
    const przycisk = cel.closest(SELEKTOR_CTA)
    const sekcja = sekcjaElementu(przycisk ?? cel)

    const wynik = czyFuria(furia, {
      x: zdarzenie.clientX,
      y: zdarzenie.clientY,
      t: zdarzenie.timeStamp,
    })
    furia = wynik.stan
    if (wynik.furia) {
      // Na przycisku nazwa celu mówi, w CO ludzie walą; poza nim wystarczy znacznik.
      const nazwa = przycisk ? nazwaCelu(opisElementu(przycisk), location.href) : znacznik(cel)
      zglosKlik(sekcja ?? SEKCJA_BRAK, 'furia', nazwa)
    }

    if (przycisk) {
      const k = kluczElementu(przycisk)
      if (k) rejestr.klik(k.klucz, k.jawny)
      return
    }
    if (sekcja !== null && czyMartwy(cel)) zglosKlik(sekcja, 'martwy', znacznik(cel))
  } catch {
    // Pomiar nie ma prawa zepsuć kliknięcia.
  }
}

function policz(el: Element, stan: StanElementu) {
  stan.zegar = 0
  if (stan.policzony || !el.isConnected || !kartaWidoczna) return
  stan.policzony = true
  obserwator?.unobserve(el)
  const k = kluczElementu(el)
  if (k) rejestr.ekspozycja(k.klucz, k.jawny)
}

function naPrzeciecie(wpisy: IntersectionObserverEntry[]) {
  for (const wpis of wpisy) {
    const stan = elementy.get(wpis.target)
    if (!stan || stan.policzony) continue
    const widoczny = wpis.isIntersecting && wpis.intersectionRatio >= 0.5
    if (widoczny && !stan.zegar) {
      stan.zegar = setTimeout(() => policz(wpis.target, stan), CZAS_EKSPOZYCJI_MS)
    } else if (!widoczny && stan.zegar) {
      clearTimeout(stan.zegar)
      stan.zegar = 0
    }
  }
}

function zwolnij(el: Element, stan: StanElementu) {
  if (stan.zegar) clearTimeout(stan.zegar)
  obserwator?.unobserve(el)
  elementy.delete(el)
}

/**
 * Zaczyna pomiar. `zglos` dostaje sygnały UX (furia, martwy klik). Nasłuch kliknięć w fazie
 * PRZECHWYTYWANIA: część elementów woła `stopPropagation`, a wtedy nasłuch w fazie bąbelkowania
 * milczałby dokładnie tam, gdzie pomiar jest najpotrzebniejszy. Kliknięcie, które zmienia ekran,
 * jest policzone zanim rdzeń zamknie odsłonę (nasłuch przechwytujący biegnie przed obsługą celu).
 */
export function zacznij(zglos: ZglosKlik): void {
  zglosKlik = zglos
  if (!sluchaKlikniec) {
    document.addEventListener('click', naKlik, { capture: true })
    sluchaKlikniec = true
  }
  if (!obserwator && typeof IntersectionObserver !== 'undefined') {
    obserwator = new IntersectionObserver(naPrzeciecie, { threshold: [0.5] })
  }
}

/** Nowa odsłona: zapomina poprzedni ekran. Nasłuch kliknięć zostaje. */
export function resetuj(): void {
  for (const [el, stan] of elementy) zwolnij(el, stan)
  rejestr.reset()
  furia = FURIA_POCZATEK
}

/** Rejestruje nowe elementy sterujące; nic nie zmienia w DOM. */
export function skanuj(): void {
  if (!obserwator) return
  for (const [el, stan] of elementy) if (!el.isConnected) zwolnij(el, stan)
  for (const el of document.querySelectorAll(SELEKTOR_CTA)) {
    if (elementy.size >= LIMIT_ELEMENTOW) break
    if (elementy.has(el)) continue
    // Pomijamy elementy, których nie policzylibyśmy i tak (poza sekcją, bez `data-cel`).
    if (sekcjaElementu(el) === null && !el.getAttribute('data-cel')?.trim()) continue
    elementy.set(el, { policzony: false, zegar: 0 })
    obserwator.observe(el)
  }
}

/** Karta w tle: wstrzymujemy odliczanie ekspozycji (500 ms widoczności to widoczność karty). */
export function wstrzymaj(): void {
  kartaWidoczna = false
  for (const stan of elementy.values()) {
    if (stan.zegar) clearTimeout(stan.zegar)
    stan.zegar = 0
  }
}

export function wznow(): void {
  kartaWidoczna = true
  if (!obserwator) return
  // `unobserve` + `observe` kolejkuje świeże powiadomienie – zegar ekspozycji ruszy od nowa.
  for (const [el, stan] of elementy) {
    if (stan.policzony) continue
    obserwator.unobserve(el)
    obserwator.observe(el)
  }
}

export function zbierz(): CtaPomiar[] | null {
  return rejestr.zbierz()
}

export function zatrzymaj(): void {
  if (sluchaKlikniec) {
    document.removeEventListener('click', naKlik, { capture: true })
    sluchaKlikniec = false
  }
  for (const [el, stan] of elementy) zwolnij(el, stan)
  obserwator?.disconnect()
  obserwator = null
  rejestr.reset()
  furia = FURIA_POCZATEK
  zglosKlik = null
}
