// Rdzeń endpointu POST /api/zdarzenie – CZYSTA logika bez obiektów HTTP. Adapter
// (`api/zdarzenie.js`) czyta ciało i nagłówki, tu zapada decyzja o statusie, a testy
// (`_zdarzenie.test.js`) wołają to bez sieci i bez bazy, bo `fetch` jest wstrzykiwany.
// Plik z prefiksem `_` nie jest funkcją Vercela.
//
// KOLEJNOŚĆ (każdy krok może zakończyć żądanie):
//   metoda (405) → origin (403) → rozmiar (413) → parsowanie (400) → walidacja zdarzeń
//   (zdarzenie niezgodne jest pomijane, zero poprawnych → 400) → odcisk, bot, kraj, kanał
//   → wiersze w kształcie kolumn `zdarzenia` → RPC `zdarzenie_zapisz` (limit 2 s) → 204.
//
// ANALITYKA NIGDY NIE PSUJE NAWIGACJI. Po przejściu walidacji każda awaria (baza, sieć,
// timeout, brak zmiennych SUPABASE_*, wyjątek w kodzie) kończy się 204. Przyczynę widać
// w polu `zapis` wyniku, a adapter loguje je stałym tekstem. `obsluz` nigdy nie rzuca.
// Nagłówka Content-Type nie sprawdzamy: beacon wysyła text/plain (żeby uniknąć preflightu),
// a ciało i tak parsujemy z tekstu.
//
// PRYWATNOŚĆ (wymaganie nr 1): adres IP i User-Agent są tu tylko argumentami funkcji
// skrótu `policzOdcisk` i klasyfikatora botów `rodzinaBota`. Nie trafiają do wierszy, logów
// ani odpowiedzi. Z `ci` (click-id) przechodzi wyłącznie NAZWA parametru. Każde pole tekstowe
// z sieci jest oczyszczane ze znaków sterujących (NUL w jsonb przewróciłby cały zapis paczki)
// i przycinane; liczby muszą być skończone i mieszczą się w zakresach z kontraktu.
//
// ZASADA WALIDACJI. Pole WYMAGANE zepsute → zdarzenie pomijane. Dodatek opcjonalny zepsuty
// (referer, UTM, wpis sekcji lub CTA, właściwość produktowa) → ginie sam dodatek, zdarzenie
// zostaje: lepiej stracić szczegół niż odsłonę. Liczby poza zakresem: czas, przewinięcie
// i liczniki są PRZYCINANE (jak trigger w bazie), pomiar wita poza zakresem jest odrzucany
// (zaniżony albo zawyżony do granicy zepsułby p75).

import { policzOdcisk, solDnia, TIMEOUT_MS, TIMEOUT_SOLI_MS, wolajRpc } from './_odcisk.js'
import { czyHostPubliczny, kanal, kraj, naglowek, normalizujHost, rodzinaBota } from './_ruch.js'
import {
  CLICK_ID,
  KANALY_UDOSTEPNIENIA,
  KOLUMNY_WIERSZA,
  LIMIT_CIALA,
  MAX_CEL,
  MAX_CTA,
  MAX_CZAS_MS,
  MAX_ELEMENT,
  MAX_ETYKIETA,
  MAX_FRAZA,
  MAX_HOST,
  MAX_KOMUNIKAT,
  MAX_LICZNIK_CTA,
  MAX_PACZKA,
  MAX_POZYCJA,
  MAX_SCIEZKA,
  MAX_SCIEZKA_REFERERA,
  MAX_SEKCJI,
  MAX_UTM,
  MAX_WITAL_CLS,
  MAX_WITAL_MS,
  MAX_WLASCIWOSCI,
  MAX_WYNIKOW,
  METRYKI_WITAL,
  NAZWY_PRODUKTOWE,
  RODZAJE_KLIKU,
  RODZAJE_WYSZUKANIA,
  SEPARATOR,
  TYPY,
  URZADZENIA,
  WZORZEC_EKRANU,
  WZORZEC_SEKCJI,
  WZORZEC_WARSTWY,
  ZNACZNIK_ODRZUCONO,
} from './_zdarzenie-kontrakt.js'

/**
 * Wartość `cialo`, którą adapter podaje, gdy strumień przekroczył limit i przestał go czytać.
 * Osobny znacznik (a nie ucięty tekst), żeby kolejność kroków zostawała w `obsluz`: zły
 * origin nadal dostaje 403, a nie 413.
 */
export const CIALO_ZA_DUZE = Symbol('cialo-za-duze')

/** Origin deweloperski (`pnpm dev`, port 5180) – tylko poza produkcją. */
const HOSTY_LOKALNE = ['localhost:5180', '127.0.0.1:5180']

const TYPY_ZBIOR = new Set(TYPY)
const URZADZENIA_ZBIOR = new Set(URZADZENIA)
const NAZWY_PRODUKTOWE_ZBIOR = new Set(NAZWY_PRODUKTOWE)
const METRYKI_ZBIOR = new Set(METRYKI_WITAL)
const KANALY_UDOSTEPNIENIA_ZBIOR = new Set(KANALY_UDOSTEPNIENIA)
const CLICK_ID_ZBIOR = new Set(CLICK_ID)
const RODZAJE_KLIKU_ZBIOR = new Set(RODZAJE_KLIKU)
const RODZAJE_WYSZUKANIA_ZBIOR = new Set(RODZAJE_WYSZUKANIA)

/* -------------------------------------------------------------------------- */
/* Narzędzia do tekstu i liczb                                                 */
/* -------------------------------------------------------------------------- */

// Znaki sterujące (kategoria Cc, w tym NUL) oraz separatory linii i akapitu (Zl, Zp). Zapis
// przez właściwości Unicode, bo literał z U+2028 w kodzie to niewidoczny znak, który w JS
// kończy linię i rozbija wyrażenie regularne. Dwie wersje: z `g` do podmiany, bez `g` do
// testu (wzorzec z `g` pamięta `lastIndex` i `test` dawałby wyniki zależne od historii).
const STEROWANE_PODMIANA = /[\p{Cc}\p{Zl}\p{Zp}]/gu
const STEROWANE_TEST = /[\p{Cc}\p{Zl}\p{Zp}]/u

const czyObiekt = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const liczba = (x) => typeof x === 'number' && Number.isFinite(x)
const przytnij = (x, min, max) => Math.min(max, Math.max(min, Math.round(x)))

/** Ucina do `max` jednostek UTF-16, nie zostawiając połowy pary zastępczej. */
function utnij(tekst, max) {
  if (tekst.length <= max) return tekst
  const ucieta = tekst.slice(0, max)
  const ostatni = ucieta.charCodeAt(ucieta.length - 1)
  return ostatni >= 0xd800 && ostatni <= 0xdbff ? ucieta.slice(0, -1) : ucieta
}

/**
 * Tekst z sieci → bezpieczny tekst do jsonb albo null: znaki sterujące i białe znaki
 * zbite do pojedynczej spacji, osierocone połówki par zastępczych zamienione na U+FFFD
 * (jsonb ich nie przyjmuje), brzegi przycięte, całość ucięta do `max`. Pusty wynik → null.
 */
function czystyTekst(x, max) {
  if (typeof x !== 'string') return null
  const t = utnij(
    x.replace(STEROWANE_PODMIANA, ' ').toWellFormed().replace(/\s+/g, ' ').trim(),
    max,
  )
  const wynik = t.trimEnd()
  return wynik === '' ? null : wynik
}

/* -------------------------------------------------------------------------- */
/* Pola wspólne i odsłona                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Ścieżka strony: tekst 1..512 zaczynający się od „/”, bez znaków sterujących. Wszystko od
 * „?” i „#” odcinamy mimo że klient już to robi (obrona w głąb) – w query siedzą tokeny
 * i dane osobowe, a ten endpoint jest publiczny.
 */
function czystaSciezka(x) {
  if (typeof x !== 'string') return null
  const ciete = x.split(/[?#]/, 1)[0] ?? ''
  if (ciete.length === 0 || ciete.length > MAX_SCIEZKA || !ciete.startsWith('/')) return null
  if (STEROWANE_TEST.test(ciete) || !ciete.isWellFormed()) return null
  return ciete
}

// Etykiety rozdzielone kropkami, w etykiecie myślnik tylko w środku (ani „-zly.pl”, ani
// „zly-.pl”, ani „a..b”); podkreślnik dopuszczamy, bo `URL.host` go przepuszcza.
const WZORZEC_HOSTA =
  /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*(?::\d{1,5})?$/

/** Host referera: małe litery, bez `www.`, kształt nazwy hosta (z portem). Inaczej null. */
function czystyHost(x) {
  if (typeof x !== 'string') return null
  const host = normalizujHost(x)
  return host.length > 0 && host.length <= MAX_HOST && WZORZEC_HOSTA.test(host) ? host : null
}

/**
 * Ścieżka referera: druga bramka prywatności (klient już ją przyciął). Zostaje tylko dla
 * hostów publicznych (post, wątek), zawsze bez query i fragmentu; sam „/” nic nie mówi.
 */
function czystaSciezkaReferera(x, host) {
  if (typeof x !== 'string' || host === null || !czyHostPubliczny(host)) return null
  const ciete = x.split(/[?#]/, 1)[0] ?? ''
  if (ciete === '/' || !ciete.startsWith('/')) return null
  if (STEROWANE_TEST.test(ciete) || !ciete.isWellFormed()) return null
  return utnij(ciete, MAX_SCIEZKA_REFERERA)
}

/** Wartość UTM: małe litery (PRZED ucięciem – zamiana wielkości bywa dłuższa), ≤ 60 znaków. */
function utm(x) {
  return typeof x === 'string' ? czystyTekst(x.toLowerCase(), MAX_UTM) : null
}

function odslona(z, ctx) {
  const refererHost = czystyHost(z.rh)
  const zrodlo = utm(z.us)
  const medium = utm(z.um)
  const kampania = utm(z.uc)
  // Identyfikator kliknięcia: tylko NAZWA z zamkniętej listy. Gdyby klient przysłał wartość
  // („gclid=EAIaIQ…”), nie pasuje do listy i ginie – nigdy nie jest zapisana.
  const clickId = CLICK_ID_ZBIOR.has(z.ci) ? z.ci : null
  return {
    kanal: kanal({
      rh: refererHost,
      us: zrodlo,
      um: medium,
      uc: kampania,
      ci: clickId,
      wlasnyHost: ctx.wlasneHosty,
    }),
    referer_host: refererHost,
    referer_sciezka: czystaSciezkaReferera(z.rs, refererHost),
    utm_source: zrodlo,
    utm_medium: medium,
    utm_campaign: kampania,
    click_id: clickId,
  }
}

/* -------------------------------------------------------------------------- */
/* Wyjście: sekcje i CTA                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `sk`: trójki `[klucz, ms, pozycja]` → `[{ k, ms, p }]`, najwyżej 24. Pozycja zepsuta
 * pomija wpis, nie całe wyjście. Powtórzony klucz liczymy raz: zasięg sekcji to liczba
 * odsłon, w których wystąpiła, i dubel zawyżałby go.
 */
function zwalidujSekcje(surowe) {
  if (!Array.isArray(surowe)) return null
  const wynik = []
  const widziane = new Set()
  for (const poz of surowe.slice(0, MAX_SEKCJI)) {
    if (!Array.isArray(poz)) continue
    const [klucz, ms, pozycja] = poz
    if (typeof klucz !== 'string' || !WZORZEC_SEKCJI.test(klucz) || widziane.has(klucz)) continue
    if (!liczba(ms) || !liczba(pozycja)) continue
    widziane.add(klucz)
    wynik.push({ k: klucz, ms: przytnij(ms, 0, MAX_CZAS_MS), p: przytnij(pozycja, 0, MAX_POZYCJA) })
  }
  return wynik.length > 0 ? wynik : null
}

/**
 * Cel przycisku z klucza CTA albo etykiety kliknięcia. Pusty cel (ikona bez podpisu) staje
 * się `bez-nazwy`: przycisk bez opisu to właśnie to, co admin chce zobaczyć na liście martwych.
 */
const cel = (x) => czystyTekst(x, MAX_CEL) ?? 'bez-nazwy'

/**
 * `ct`: trójki `[sekcja§cel, ekspozycje, kliki]` → `[{ k, e, n }]`, najwyżej 12. Wpis bez
 * jednej i drugiej liczby (0 i 0) niczego nie mówi, więc go pomijamy. Separator w celu
 * rozbiłby klucz na trzy człony, więc taki wpis ginie (SQL rozbija po separatorze).
 */
function zwalidujCta(surowe) {
  if (!Array.isArray(surowe)) return null
  const wynik = []
  const widziane = new Set()
  for (const poz of surowe.slice(0, MAX_CTA)) {
    if (!Array.isArray(poz)) continue
    const [klucz, ekspozycje, kliki] = poz
    if (typeof klucz !== 'string' || klucz.length > 200) continue
    const czesci = klucz.split(SEPARATOR)
    if (czesci.length !== 2 || !WZORZEC_SEKCJI.test(czesci[0] ?? '')) continue
    if (!liczba(ekspozycje) || !liczba(kliki)) continue
    const e = przytnij(ekspozycje, 0, MAX_LICZNIK_CTA)
    const n = przytnij(kliki, 0, MAX_LICZNIK_CTA)
    const k = `${czesci[0]}${SEPARATOR}${cel(czesci[1])}`
    if ((e === 0 && n === 0) || widziane.has(k)) continue
    widziane.add(k)
    wynik.push({ k, e, n })
  }
  return wynik.length > 0 ? wynik : null
}

function wyjscie(z) {
  if (!liczba(z.ms) || !liczba(z.sc)) return null
  return {
    czas_ms: przytnij(z.ms, 0, MAX_CZAS_MS),
    scroll_pc: przytnij(z.sc, 0, 100),
    sekcje: zwalidujSekcje(z.sk),
    cta: zwalidujCta(z.ct),
  }
}

/* -------------------------------------------------------------------------- */
/* Klik, udostępnienie                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Etykieta kliknięcia `sekcja§rodzaj§cel`: dokładnie trzy człony, sekcja jak klucz
 * z `data-sekcja`, rodzaj z zamkniętej listy, cel ≤ 40 znaków (pusty → `bez-nazwy`).
 * Składamy ją od nowa z członów, więc na wyjściu zawsze mieści się w 120 znakach.
 */
function etykietaKlika(x) {
  if (typeof x !== 'string' || x.length > 300) return null
  const czesci = x.split(SEPARATOR)
  if (czesci.length !== 3) return null
  const [sekcja = '', rodzaj = '', surowyCel = ''] = czesci
  if (!WZORZEC_SEKCJI.test(sekcja) || !RODZAJE_KLIKU_ZBIOR.has(rodzaj)) return null
  const etykieta = [sekcja, rodzaj, cel(surowyCel)].join(SEPARATOR)
  return etykieta.length <= MAX_ETYKIETA ? etykieta : null
}

function klik(z) {
  const etykieta = etykietaKlika(z.et)
  return etykieta === null ? null : { etykieta }
}

/** Element udostępnienia to krótka nazwa z kodu aplikacji; za długą ucinamy, nie odrzucamy. */
function udostepnienie(z) {
  const element = czystyTekst(z.et, MAX_ELEMENT)
  if (element === null || !KANALY_UDOSTEPNIENIA_ZBIOR.has(z.ku)) return null
  return { etykieta: element, kanal_udostepnienia: z.ku }
}

/* -------------------------------------------------------------------------- */
/* Zdarzenia produktowe                                                        */
/* -------------------------------------------------------------------------- */

// Filtr danych osobowych we frazie – odpowiednik filtra z klienta (src/pomiar/fraza.ts). Serwer
// jest drugą bramką, więc ma być co najmniej tak ostry; test porównuje oba na wspólnym zestawie.
// Cyfry rozdzielone najwyżej trzema znakami ozdobnymi (spacja, kropka, dowolny myślnik – \p{Pd}
// obejmuje też półpauzę i pauzę): 9 cyfr w ten sposób to telefon, NIP, REGON, numer karty albo
// PESEL. Ukośnik i przecinek NIE są separatorem, więc „ul. Długa 123/45, 31-001” przechodzi.
// Zapis przez klasę Unicode zamiast wypisanych znaków, bo wypisane myślniki i znaki
// pełnoszerokie łatwo w kodzie pomylić ze zwykłymi.
const CIAG_CYFR = /\d(?:[\s.\p{Pd}]{0,3}\d){8,}/u

/**
 * Czy tekst wygląda na dane osobowe: dowolne „@” albo 9+ cyfr z rzędu. Sprawdzamy postać NFKC,
 * która zamienia pełnoszerokie odmiany małpy i cyfr na zwykłe (inaczej omijałyby wzorzec),
 * a nawiasy i plus z numeru telefonu (+48 (12) 345 67 89) zamieniamy na spacje.
 */
export function zawieraDaneOsobowe(tekst) {
  const t = tekst.normalize('NFKC')
  return t.includes('@') || CIAG_CYFR.test(t.replace(/[()+]/g, ' '))
}

/**
 * Właściwości „wyszukanie bez wyniku”: fraza w postaci jak u klienta (NFC, małe litery, zbite
 * spacje, ≤ 80 znaków). Fraza z danymi osobowymi NIE jest zapisywana: zostaje znacznik
 * `{ fraza: '[odrzucono]', odrzucono: true }` (FR-007), żeby licznik braków się zgadzał,
 * a odrzucone wyszukania trafiły do jednej pozycji listy. Ta sama postać wychodzi, gdy klient
 * sam odrzucił frazę, i gdy fraza jest pusta (jak w `normalizujFraze` klienta). Filtr działa
 * na CAŁYM tekście przed ucięciem do 80 znaków – inaczej ucięcie mogłoby rozciąć adres e-mail
 * i przepuścić jego początek. Brak pola `fraza` to brak właściwości, nie znacznik.
 */
function wlasciwosciFrazy(w) {
  const znacznik = { fraza: ZNACZNIK_ODRZUCONO, odrzucono: true }
  if (w.odrzucono === true) return znacznik
  if (typeof w.fraza !== 'string') return {}
  const fraza = czystyTekst(w.fraza.normalize('NFC').toLowerCase(), 2000)
  if (fraza === null || zawieraDaneOsobowe(fraza)) return znacznik
  return { fraza: utnij(fraza, MAX_FRAZA).trimEnd() }
}

/**
 * Właściwości zdarzenia produktowego wg zamkniętej listy kluczy z kontraktu
 * (`WLASCIWOSCI_PRODUKTOWE`); klucz obcy albo wartość spoza reguł ginie sam. Test pilnuje,
 * że to, co tu może wyjść, jest dokładnie tym, co deklaruje kontrakt.
 */
function wlasciwosciProduktowe(nazwa, w) {
  if (!czyObiekt(w)) return null
  let wynik
  switch (nazwa) {
    case 'wyszukanie': {
      const ile = liczba(w.wynikow) ? Math.round(w.wynikow) : -1
      wynik = {
        wynikow: ile >= 0 && ile <= MAX_WYNIKOW ? ile : undefined,
        rodzaj: RODZAJE_WYSZUKANIA_ZBIOR.has(w.rodzaj) ? w.rodzaj : undefined,
      }
      break
    }
    case 'wyszukanie_bez_wyniku':
      wynik = wlasciwosciFrazy(w)
      break
    case 'warstwa_mapy':
      wynik = {
        warstwa:
          typeof w.warstwa === 'string' && WZORZEC_WARSTWY.test(w.warstwa) ? w.warstwa : undefined,
      }
      break
    case 'udostepnij':
      wynik = {
        element: czystyTekst(w.element, MAX_ELEMENT) ?? undefined,
        kanal: KANALY_UDOSTEPNIENIA_ZBIOR.has(w.kanal) ? w.kanal : undefined,
      }
      break
    default:
      return null
  }
  const niepuste = Object.entries(wynik).filter(([, wartosc]) => wartosc !== undefined)
  return niepuste.length > 0 ? Object.fromEntries(niepuste) : null
}

function produktowe(z) {
  if (!NAZWY_PRODUKTOWE_ZBIOR.has(z.n)) return null
  // `w` nie-obiekt albo ponad 12 kluczy łamie kształt z kontraktu → zdarzenie pomijane.
  if (z.w !== undefined && z.w !== null) {
    if (!czyObiekt(z.w) || Object.keys(z.w).length > MAX_WLASCIWOSCI) return null
  }
  return { nazwa: z.n, wlasciwosci: wlasciwosciProduktowe(z.n, z.w) }
}

/* -------------------------------------------------------------------------- */
/* Wital, błąd                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Pomiar Web Vitals: ms (CLS – ułamek ≤ 10), zaokrąglony do trzech miejsc. Poza zakresem
 * odrzucony, nie przycięty: wartość sztucznie zrównana z granicą zepsułaby p75.
 */
function wital(z) {
  if (!METRYKI_ZBIOR.has(z.n) || !liczba(z.v) || z.v < 0) return null
  if (z.v > (z.n === 'cls' ? MAX_WITAL_CLS : MAX_WITAL_MS)) return null
  return { nazwa: z.n, wartosc: Math.round(z.v * 1000) / 1000 }
}

// Redakcja idzie po szerszym kawałku niż limit, żeby ucięcie nie rozcięło tego, co redagujemy.
const SZEROKOSC_REDAKCJI = MAX_KOMUNIKAT * 4

/**
 * Komunikat błędu klienta. Poza oczyszczeniem znaków sterujących usuwamy to, co mogłoby
 * identyfikować człowieka, gdyby wyjątek je zacytował: query i fragment adresów, e-maile
 * i liczby od 7 cyfr (telefon, PESEL) – to samo, co robi trigger w bazie, tyle że TUTAJ,
 * zanim cokolwiek opuści endpoint.
 */
function oczyscKomunikat(x) {
  const t = czystyTekst(x, SZEROKOSC_REDAKCJI)
  if (t === null) return null
  const zredagowany = t
    .replace(/(https?:\/\/[^\s?#]*)[?#]\S*/gi, '$1')
    .replace(/[^\s@<>()"']+@[^\s@<>()"']+/g, '(email)')
    .replace(/\d{7,}/g, '#')
  const wynik = utnij(zredagowany, MAX_KOMUNIKAT).trimEnd()
  return wynik === '' ? null : wynik
}

function blad(z) {
  const komunikat = oczyscKomunikat(z.k)
  return komunikat === null ? null : { komunikat }
}

/* -------------------------------------------------------------------------- */
/* Zdarzenie → część wiersza                                                   */
/* -------------------------------------------------------------------------- */

const SZCZEGOLY_TYPU = { odslona, wyjscie, klik, udostepnienie, produktowe, wital, blad }

/**
 * Jedno zdarzenie z sieci → część wiersza (pola wspólne + pola typu) albo null, gdy
 * zdarzenie nie zgadza się z kontraktem. Pola wspólne są wymagane dla każdego typu.
 * `ctx.wlasneHosty` to hosty serwisu (do rozpoznania wejścia „wewnętrznego”).
 */
export function zwalidujZdarzenie(surowe, ctx = {}) {
  if (!czyObiekt(surowe)) return null
  const typ = surowe.t
  if (!TYPY_ZBIOR.has(typ)) return null
  const ekran = surowe.e
  if (typeof ekran !== 'string' || !WZORZEC_EKRANU.test(ekran)) return null
  const sciezka = czystaSciezka(surowe.s)
  if (sciezka === null) return null
  const urzadzenie = surowe.u
  if (!URZADZENIA_ZBIOR.has(urzadzenie)) return null

  const szczegoly = SZCZEGOLY_TYPU[typ](surowe, { wlasneHosty: ctx.wlasneHosty ?? [] })
  if (szczegoly === null) return null
  return { typ, ekran, sciezka, urzadzenie, ...szczegoly }
}

/**
 * Część wiersza + kontekst żądania → wiersz dla RPC. WSZYSTKIE klucze z `KOLUMNY_WIERSZA`
 * są zawsze obecne (puste jako null): funkcja bazy czyta paczkę przez jsonb_to_record z jawną
 * listą kolumn, a stały zestaw kluczy w każdym wierszu daje przewidywalny kształt paczki.
 * Kontekst żądania (odcisk, kraj, bot) jest wspólny dla całej paczki.
 */
export function zbudujWiersz(czesc, kontekst) {
  const wiersz = {}
  for (const kolumna of KOLUMNY_WIERSZA) wiersz[kolumna] = czesc[kolumna] ?? null
  wiersz.odcisk = kontekst.odcisk ?? null
  wiersz.kraj = kontekst.kraj ?? null
  wiersz.czy_bot = kontekst.bot.czyBot
  wiersz.bot_rodzina = kontekst.bot.rodzina
  wiersz.bot_klasa = kontekst.bot.klasa
  return wiersz
}

/* -------------------------------------------------------------------------- */
/* Origin i hosty                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Hosty serwisu z `ADRESSCORE_HOSTY` (lista po przecinku): małe litery, bez `www.`,
 * bez powtórzeń; wpis z schematem albo ścieżką („https://adresscore.pl/”) też działa.
 * Kolejność z konfiguracji zostaje, a PIERWSZY host jest kanoniczny.
 */
function hostyWlasne(env) {
  const surowe = typeof env?.ADRESSCORE_HOSTY === 'string' ? env.ADRESSCORE_HOSTY : ''
  const hosty = []
  for (const wpis of surowe.split(',')) {
    const bezSchematu = wpis.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    const host = normalizujHost(bezSchematu.split(/[/?#]/, 1)[0] ?? '')
    if (host && !hosty.includes(host)) hosty.push(host)
  }
  return hosty
}

const czyProdukcja = (env) => env?.NODE_ENV === 'production' || env?.VERCEL_ENV === 'production'

/**
 * Host z nagłówka `Origin`, jeśli wolno go przyjąć, inaczej null. Brak nagłówka i obcy host
 * to odmowa: pomiar pochodzi wyłącznie z naszej strony, a przeglądarka zawsze dokłada Origin
 * do POST-a. Parsowanie przez `URL` zamyka sztuczki z `adresscore.pl.evil.com` czy
 * `adresscore.pl@evil.com`. To bramka przeciw przypadkowemu nadużyciu, nie przeciw
 * napastnikowi z curlem, który Origin ustawi sobie sam.
 */
function sprawdzOrigin(origin, env, hosty) {
  if (typeof origin !== 'string' || origin === '') return null
  let url
  try {
    url = new URL(origin)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = normalizujHost(url.host)
  if (hosty.includes(host)) return host
  if (!czyProdukcja(env) && HOSTY_LOKALNE.includes(url.host)) return url.host
  return null
}

/* -------------------------------------------------------------------------- */
/* Ciało żądania                                                               */
/* -------------------------------------------------------------------------- */

/** Rozmiar w bajtach UTF-8 albo null, gdy `cialo` nie jest tekstem, bajtami ani obiektem. */
function rozmiarCiala(cialo) {
  if (cialo === CIALO_ZA_DUZE) return Number.POSITIVE_INFINITY
  if (typeof cialo === 'string') return Buffer.byteLength(cialo, 'utf8')
  if (cialo instanceof Uint8Array) return cialo.byteLength
  if (cialo !== null && typeof cialo === 'object') {
    // Obiekt już sparsowany przez hosting (Vercel przy application/json): mierzymy jego postać
    // tekstową, bo surowego ciała nie mamy.
    try {
      return Buffer.byteLength(JSON.stringify(cialo), 'utf8')
    } catch {
      return null
    }
  }
  return null
}

/** `{ "z": [...] }` z 1..10 elementami → lista zdarzeń, inaczej null (zły JSON albo kształt). */
function rozpakujPaczke(cialo) {
  let surowe = cialo
  try {
    if (typeof cialo === 'string') surowe = JSON.parse(cialo)
    else if (cialo instanceof Uint8Array) surowe = JSON.parse(new TextDecoder().decode(cialo))
  } catch {
    return null
  }
  if (!czyObiekt(surowe) || !Array.isArray(surowe.z)) return null
  // Więcej niż MAX_PACZKA to naruszony kształt, nie powód do cichego przycinania: klient
  // zgodny z kontraktem tego nie wyśle, a paczka bez limitu mnożyłaby pracę na żądanie.
  if (surowe.z.length === 0 || surowe.z.length > MAX_PACZKA) return null
  return surowe.z
}

/* -------------------------------------------------------------------------- */
/* obsluz                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Całe żądanie bez obiektów HTTP. Zwraca `{ status, naglowki?, zapis?, przyjete? }` i NIGDY
 * NIE RZUCA.
 *
 * Wejście: `metoda` (np. 'POST'), `cialo` (tekst, bajty, już sparsowany obiekt albo
 * `CIALO_ZA_DUZE`), `naglowki` (obiekt Node, `Headers` albo zwykły obiekt), `ip` (tylko do
 * skrótu), `env` (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADRESSCORE_HOSTY, NODE_ENV,
 * VERCEL_ENV), `fetch` (wstrzykiwany), `timeoutMs` (domyślnie 2 s), `teraz` (zegar testów).
 *
 * `zapis` mówi, co stało się z zapisem po przejściu walidacji: `ok`, `brak-konfiguracji`,
 * `brak-fetch`, `timeout`, `siec`, `http-<kod>` albo `blad`. To stałe teksty bez danych
 * z żądania, więc adapter może je logować.
 */
export async function obsluz({
  metoda,
  cialo,
  naglowki,
  ip,
  env = {},
  fetch: fetchImpl,
  timeoutMs = TIMEOUT_MS,
  teraz,
} = {}) {
  if (metoda !== 'POST') return { status: 405, naglowki: { Allow: 'POST' } }

  let czesci
  let hostKanoniczny
  try {
    const hosty = hostyWlasne(env)
    const hostOrigin = sprawdzOrigin(naglowek(naglowki, 'origin'), env, hosty)
    if (hostOrigin === null) return { status: 403 }

    // Deklarowana długość przed czytaniem, a mierzona po – nagłówek bywa kłamliwy.
    const deklarowana = Number.parseInt(naglowek(naglowki, 'content-length') ?? '', 10)
    const rozmiar = rozmiarCiala(cialo)
    if (
      (Number.isFinite(deklarowana) && deklarowana > LIMIT_CIALA) ||
      (rozmiar ?? 0) > LIMIT_CIALA
    ) {
      // Połączenie zamykamy: przy przerwanym czytaniu strumienia nie ma po co czekać na resztę.
      return { status: 413, naglowki: { Connection: 'close' } }
    }
    if (rozmiar === null) return { status: 400 }

    const paczka = rozpakujPaczke(cialo)
    if (paczka === null) return { status: 400 }

    const wlasneHosty = [...new Set([...hosty, hostOrigin])]
    hostKanoniczny = hosty[0] ?? hostOrigin
    czesci = []
    for (const surowe of paczka) {
      const czesc = zwalidujZdarzenie(surowe, { wlasneHosty })
      if (czesc !== null) czesci.push(czesc)
    }
    if (czesci.length === 0) return { status: 400 }
  } catch {
    // Wyjątek przed zapisem to ciało, którego nie umiemy obsłużyć – nie awaria bazy.
    return { status: 400 }
  }

  try {
    // IP i UA czytamy tutaj i tylko tutaj; dalej istnieje już wyłącznie skrót i flagi bota.
    const ua = naglowek(naglowki, 'user-agent') ?? ''
    const bot = rodzinaBota(ua)
    const sol = await solDnia({
      env,
      fetch: fetchImpl,
      teraz,
      timeoutMs: Math.min(timeoutMs, TIMEOUT_SOLI_MS),
    })
    // Bez soli skrót byłby stały w czasie, czyli trwałym identyfikatorem – zapisujemy null.
    const odcisk =
      sol === null ? null : policzOdcisk(sol, typeof ip === 'string' ? ip : '', ua, hostKanoniczny)
    const kontekst = { odcisk, kraj: kraj(naglowki), bot }
    const wiersze = czesci.map((czesc) => zbudujWiersz(czesc, kontekst))

    const wynik = await wolajRpc({
      env,
      fetch: fetchImpl,
      nazwa: 'zdarzenie_zapisz',
      cialo: { p_paczka: wiersze },
      timeoutMs,
    })
    return { status: 204, zapis: wynik.ok ? 'ok' : wynik.powod, przyjete: wiersze.length }
  } catch {
    return { status: 204, zapis: 'blad' }
  }
}
