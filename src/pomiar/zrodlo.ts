// Źródło wejścia przycięte JUŻ W PRZEGLĄDARCE – do sieci nie wychodzi nic, czego nie wolno
// zapisać. Czyste funkcje, bez DOM (adres i referer dostajemy jako teksty).
//
// Co wychodzi (FR-002, contracts/pomiar-klient.md „Prywatność”):
//   rh  – host referera (małe litery, bez `www.`; port zostaje, gdy jest niestandardowy),
//   rs  – ścieżka referera, TYLKO dla hostów publicznych, nigdy z query ani fragmentem,
//   us/um/uc – `utm_source|medium|campaign` (małe litery, ≤ 60 znaków),
//   ci  – NAZWA identyfikatora kliknięcia (gclid, fbclid…), nigdy jego wartość.
// Cała reszta adresu i referera (inne parametry, token w query, fragment) zostaje w przeglądarce.
//
// Serwer przycina po raz drugi (endpoint jest publiczny, klient nie jest dowodem) i to on
// klasyfikuje kanał (`api/_ruch.js#kanal`). Klient tylko zawęża dane.
//
// DLACZEGO ŚCIEŻKA REFERERA TYLKO Z LISTY: nagłówek Referer bywa nośnikiem cudzych danych
// (ścieżki intranetu, tokeny w adresie webmaila, fraza w wyszukiwarce innej niż Google).
// Ścieżkę zostawiamy wyłącznie dla serwisów, gdzie jest identyfikatorem treści publicznej
// (post, wątek) – tam widać, KTÓRY wpis przyprowadził ruch. Wyszukiwarki i czaty AI są poza
// listą celowo: ich ścieżka nic nie mówi, a `chatgpt.com/c/<id>` to prywatna rozmowa.
// Lista jest kopią `HOSTY_PUBLICZNE` z api/_ruch.js; dopisujesz host tylko wtedy, gdy jego
// ścieżki są z definicji publiczne.

import { zawieraDaneOsobowe } from './fraza.ts'
import type { ClickId } from './kontrakt.ts'
import { CLICK_ID, MAX_HOST, MAX_SCIEZKA_REFERERA, MAX_UTM } from './kontrakt.ts'
import { oczyscBiale, przytnij } from './tekst.ts'

export interface ZrodloWejscia {
  rh?: string
  rs?: string
  us?: string
  um?: string
  uc?: string
  ci?: ClickId
}

/** Dopasowanie po sufiksie domeny: `m.facebook.com` i `l.facebook.com` wpadają pod `facebook.com`. */
const HOSTY_PUBLICZNE = [
  't.co',
  'x.com',
  'twitter.com',
  'facebook.com',
  'fb.me',
  'instagram.com',
  'tiktok.com',
  'reddit.com',
  'redd.it',
  'wykop.pl',
  'youtube.com',
  'youtu.be',
  'linkedin.com',
  'lnkd.in',
  'news.ycombinator.com',
  'bsky.app',
  'mastodon.social',
  'threads.net',
  'threads.com',
  'medium.com',
  'substack.com',
] as const

/**
 * Protokoły referera, które w ogóle czytamy. `android-app://com.google.android.googlequicksearchbox`
 * to aplikacja Google na Androidzie (realny ruch z wyszukiwarki, który serwer rozpoznaje po nazwie
 * pakietu), reszta (`file:`, `javascript:`, `data:`) nie jest odesłaniem.
 */
const PROTOKOLY_REFERERA = new Set(['http:', 'https:', 'android-app:'])

/** Host małymi literami, bez końcowej kropki i bez `www.`; port (jeśli jest) zostaje. */
function normalizujHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/^www\./, '')
    .slice(0, MAX_HOST)
}

function bezPortu(host: string): string {
  return host.replace(/:\d{1,5}$/, '')
}

function pasujeDomena(host: string, domena: string): boolean {
  return host === domena || host.endsWith(`.${domena}`)
}

function hostPubliczny(host: string): boolean {
  const sam = bezPortu(host)
  return HOSTY_PUBLICZNE.some((domena) => pasujeDomena(sam, domena))
}

/**
 * Własny host w postaci, w jakiej wysyłamy go jako `rh` przy przejściach wewnątrz aplikacji
 * (patrz `rdzen.ts`): serwer rozpoznaje go jako kanał „wewnętrzne”.
 */
export function hostWewnetrzny(wlasnyHost: string): string {
  return normalizujHost(wlasnyHost)
}

/** Referer: host i (tylko dla hostów publicznych) ścieżka bez query i fragmentu. */
function przytnijReferer(
  referrer: string,
  wlasnyHost: string,
): { host: string; sciezka?: string } | null {
  if (!referrer) return null
  let url: URL
  try {
    url = new URL(referrer)
  } catch {
    return null
  }
  if (!PROTOKOLY_REFERERA.has(url.protocol)) return null
  const host = normalizujHost(url.host)
  if (!host) return null
  // Referer z własnego hosta zostaje (sam host): serwer klasyfikuje go jako przejście wewnętrzne,
  // a bez niego pełne przeładowanie z podstrony wyglądałoby jak wejście bezpośrednie. Ścieżki
  // własnego serwisu nie wysyłamy nigdy – nie jest źródłem ruchu i nie ma być w statystykach.
  if (host === normalizujHost(wlasnyHost)) return { host }
  if (url.protocol !== 'android-app:' && hostPubliczny(host)) {
    const sciezka = url.pathname
    if (sciezka && sciezka !== '/') return { host, sciezka: sciezka.slice(0, MAX_SCIEZKA_REFERERA) }
  }
  return { host }
}

/**
 * Parametry zapytania strony: z `?…` przed hashem ORAZ z `?…` wewnątrz hasha (`#/okolica?utm_source=x`).
 * Router żyje na hashu i narzędzia do znakowania linków doklejają znaczniki czasem po hashu,
 * czasem przed nim – obie postacie to to samo wejście.
 */
function parametryStrony(href: string): URLSearchParams[] {
  try {
    const url = new URL(href)
    const lista = [url.searchParams]
    const q = url.hash.indexOf('?')
    if (q !== -1) lista.push(new URLSearchParams(url.hash.slice(q + 1)))
    return lista
  } catch {
    return []
  }
}

function pierwsza(parametry: readonly URLSearchParams[], nazwa: string): string | null {
  for (const p of parametry) {
    const wartosc = p.get(nazwa)
    if (wartosc) return wartosc
  }
  return null
}

/** Znacznik UTM: małe litery, zbite spacje, bez znaków sterujących, ≤ MAX_UTM; dane osobowe odpadają. */
function oczyscUtm(surowy: string | null): string | undefined {
  if (!surowy) return undefined
  const tekst = oczyscBiale(surowy.normalize('NFC').toLowerCase())
  // `utm_source=jan@example.pl` zdarza się w linkach z mailingu – to adres osoby, nie źródło.
  if (!tekst || zawieraDaneOsobowe(tekst)) return undefined
  return przytnij(tekst, MAX_UTM) || undefined
}

/**
 * Źródło wejścia dla odsłony. Wołaj RAZ na załadowanie strony (pierwsza odsłona): kolejne
 * odsłony w obrębie aplikacji nie mają zewnętrznego źródła, a `document.referrer` trzyma
 * przez cały czas życia strony referer ZEWNĘTRZNY, więc dokładanie go każdej odsłonie
 * przypisywałoby nawigację wewnętrzną Google’owi.
 */
export function zrodloWejscia(href: string, referrer: string, wlasnyHost: string): ZrodloWejscia {
  const wynik: ZrodloWejscia = {}

  const ref = przytnijReferer(referrer, wlasnyHost)
  if (ref) {
    wynik.rh = ref.host
    if (ref.sciezka) wynik.rs = ref.sciezka
  }

  const parametry = parametryStrony(href)
  const us = oczyscUtm(pierwsza(parametry, 'utm_source'))
  const um = oczyscUtm(pierwsza(parametry, 'utm_medium'))
  const uc = oczyscUtm(pierwsza(parametry, 'utm_campaign'))
  if (us) wynik.us = us
  if (um) wynik.um = um
  if (uc) wynik.uc = uc

  // Identyfikator kliknięcia: sama obecność parametru i jego NAZWA. Wartość jest unikalna dla
  // kliknięcia, czyli byłaby trwałym identyfikatorem człowieka – dokładnie tym, czego pomiar nie zbiera.
  const ci = CLICK_ID.find((nazwa) => parametry.some((p) => p.has(nazwa)))
  if (ci) wynik.ci = ci

  return wynik
}
