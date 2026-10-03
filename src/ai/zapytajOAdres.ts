// „Zapytaj o adres” (#17): pytanie po polsku → jedna warstwa z manifestu → jej wartość pod
// tym adresem ze źródłem i rozdzielczością. Czysta logika bez Reacta i bez `import.meta.env`,
// żeby testy szły na gołym `node --test` (z kontraktu bierzemy tylko typy).
//
// JEV NIE GENERUJE ODPOWIEDZI. Wybiera tylko id warstwy z zamkniętej listy (choice). Liczba,
// jednostka, źródło i rozdzielczość zawsze pochodzą z `public/dane` (wartosci[i] + meta).
// Brak klucza, błąd, wybór spoza listy albo niska pewność → reguła słów kluczowych poniżej.
import type { WskaznikMeta, Zrodlo } from '../kontrakty/index.ts'
import { KOLEJNOSC_KATEGORII } from '../wynik/silnik.ts'
import { type OdpowiedzJev, type OpcjeKlienta, wybor, type ZapytanieJev, zJevem } from './jev.ts'

/** Id pytania w zapytaniu do pośrednika. */
export const ID_PYTANIA = 'warstwa'
/** Opcja „żadna warstwa nie pasuje” – zawsze ostatnia na liście. */
export const NIE_WIEM = 'nie_wiem'
/** Poniżej tej pewności (albo bez pewności) wyboru JEV nie bierzemy – decyduje reguła. */
export const PROG_PEWNOSCI = 0.5
/** Limity pośrednika (api/_jev.js): do 128 opcji choice (JEV sprawdzony na żywo na 76), opis opcji do 300 znaków. */
const MAKS_WARSTW = 127
const MAKS_OPISU = 300

// Zdanie o pytaniach złożonych dodane po pomiarze #18: bez niego JEV na „Jak tu z powietrzem,
// hałasem i drzewami?” wybierał nie_wiem zamiast jednej z pasujących warstw.
export const POLECENIE =
  'Użytkownik pyta o jeden adres. Wybierz warstwę danych, która odpowiada na jego pytanie. ' +
  'Jeśli pytanie dotyczy kilku rzeczy naraz, wybierz warstwę dla pierwszej z nich. ' +
  'Jeśli żadna nie pasuje, wybierz nie_wiem.'

/**
 * Dopiski do opisu warstwy dla JEV (przed opisem z danych, żeby nie uciął ich limit 300 znaków).
 * Trzy warstwy powodzi różnią się tylko prawdopodobieństwem, więc JEV rozkładał pewność między
 * nie i na „Czy piwnica może zalać?” spadał pod próg (pomiar #18) – wskazujemy domyślną.
 */
const DOPISKI_WARSTW: Readonly<Record<string, string>> = {
  powodz_1proc:
    'Domyślna odpowiedź na pytania, czy tu zalewa, czy zaleje piwnicę, o powódź i podtopienia.',
  powodz_10proc: 'Tylko gdy pytanie wprost dotyczy częstych zalań (co kilka lat).',
  powodz_02proc: 'Tylko gdy pytanie wprost dotyczy najgorszego, skrajnie rzadkiego scenariusza.',
}

/** Warstwa z danymi pod adresami – podzbiór `WskaznikPrzygotowany` z src/wynik/silnik.ts. */
export interface WarstwaDanych {
  meta: WskaznikMeta
  wartosci: readonly (number | null)[]
  etykiety?: readonly (string | null)[]
  /** Powód, gdy plik warstwy się nie wczytał. */
  niedostepny?: string
}

export interface PozycjaListy {
  id: string
  nazwa: string
  /** Opis dla klasyfikatora JEV (≤ 300 znaków). */
  opis: string
}

const kolejnoscKategorii = (k: string) => {
  const i = (KOLEJNOSC_KATEGORII as readonly string[]).indexOf(k)
  return i < 0 ? KOLEJNOSC_KATEGORII.length : i
}

function przytnij(tekst: string, maks: number): string {
  const t = tekst.replace(/\s+/g, ' ').trim()
  return t.length <= maks ? t : `${t.slice(0, maks - 1).trimEnd()}…`
}

/** Pierwsze zdanie opisu – wystarczy klasyfikatorowi, a mieści się w limicie. */
function pierwszeZdanie(opis: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(opis.trim())
  return m?.[1] ?? opis
}

/**
 * Zamknięta lista warstw dla JEV: bez atrap, w stałej kolejności (kategoria karty, potem id),
 * niezależnej od kolejności manifestu. Kolejność opcji JEV widzi, więc nie może skakać.
 */
export function listaWarstw(metas: readonly WskaznikMeta[]): PozycjaListy[] {
  return metas
    .filter((m) => !m.atrapa)
    .slice()
    .sort(
      (a, b) =>
        kolejnoscKategorii(a.kategoria) - kolejnoscKategorii(b.kategoria) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, MAKS_WARSTW)
    .map((m) => ({
      id: m.id,
      nazwa: m.nazwa,
      opis: przytnij(
        [`${m.nazwa} (${m.jednostka}).`, DOPISKI_WARSTW[m.id], pierwszeZdanie(m.opis)]
          .filter(Boolean)
          .join(' '),
        MAKS_OPISU,
      ),
    }))
}

/** Kryteria choice: id warstwy → opis, plus `nie_wiem` na końcu. */
export function kryteria(lista: readonly PozycjaListy[]): Record<string, string> {
  const k: Record<string, string> = {}
  for (const p of lista) k[p.id] = p.opis
  k[NIE_WIEM] = 'Pytanie nie dotyczy żadnej z warstw powyżej albo jest niejasne.'
  return k
}

export function zapytanieJev(pytanie: string, lista: readonly PozycjaListy[]): ZapytanieJev {
  return {
    stan: pytanie.slice(0, 2000),
    pytania: { [ID_PYTANIA]: wybor(POLECENIE, kryteria(lista)) },
  }
}

/** Wybór warstwy: id z listy albo null = „nie wiem”. */
export interface WyborWarstwy {
  warstwa: string | null
}

/**
 * Odpowiedź JEV → wybór. null (= reguła zapasowa), gdy brak odpowiedzi, wybór spoza listy,
 * brak pewności albo pewność poniżej progu. `nie_wiem` z pewnością to uczciwe „nie wiem”.
 */
export function przetworz(
  odpowiedzi: Record<string, OdpowiedzJev | null>,
  lista: readonly PozycjaListy[],
): WyborWarstwy | null {
  const o = odpowiedzi[ID_PYTANIA]
  if (!o || o.typ !== 'choice') return null
  if (o.pewnosc === null || !(o.pewnosc >= PROG_PEWNOSCI)) return null
  if (o.wybor === NIE_WIEM) return { warstwa: null }
  return lista.some((p) => p.id === o.wybor) ? { warstwa: o.wybor } : null
}

// --- Reguła zapasowa: słowa kluczowe po polsku -------------------------------------------

/** Małe litery bez polskich znaków – „Głośno” i „glosno” to to samo. */
export function normalizuj(tekst: string): string {
  return tekst
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Reguły w kolejności pierwszeństwa (bardziej szczegółowe wyżej). Każda ma kandydatów –
 * pierwsza warstwa z listy, która istnieje. Wzorce działają na tekście po `normalizuj`.
 * Wygrywa reguła z największą liczbą trafionych wzorców; remis – wyższa na liście.
 */
export const REGULY: readonly { warstwy: readonly string[]; wzorce: readonly RegExp[] }[] = [
  { warstwy: ['szkola_podst_wynik_e8'], wzorce: [/\be8\b/, /egzamin/, /(dobr|najlepsz)\w* szkol/] },
  {
    warstwy: ['przychodnia_bez_barier_odleglosc'],
    wzorce: [/bez barier/, /dostepn\w* (przychodn|lekarz)/],
  },
  { warstwy: ['kursy_szczyt_h'], wzorce: [/jak czesto/, /\bkurs/, /czestotliw/, /szczyt/] },
  { warstwy: ['lotnisko_czas_min'], wzorce: [/lotnisk/, /balic/, /samolot/] },
  { warstwy: ['rynek_czas_min'], wzorce: [/\brynek/, /\brynku/, /centrum/, /do miasta/] },
  {
    warstwy: ['przystanek_odleglosc'],
    wzorce: [/przystan/, /autobus/, /tramwaj/, /komunikacj/, /\bmpk\b/],
  },
  {
    warstwy: ['halas_ldwn'],
    wzorce: [/glos/, /halas/, /\bcich/, /\bcisz/, /spokojn/, /\bhuk/, /decybel/, /\bdb\b/],
  },
  { warstwy: ['pm10_srednia'], wzorce: [/pm ?10/] },
  { warstwy: ['no2_srednia'], wzorce: [/\bno2\b/, /azot/, /spalin/] },
  { warstwy: ['bap_srednia'], wzorce: [/benzo/, /\bbap\b/, /piec(e|ow|uch)/, /wegl/] },
  {
    warstwy: ['pm25_srednia', 'pm10_srednia'],
    wzorce: [/powietrz/, /smog/, /\bpyl/, /pm ?2/, /oddych/, /zanieczyszcz/],
  },
  { warstwy: ['drzewa_100m'], wzorce: [/drzew/] },
  {
    warstwy: ['zielen_worldcover_100m', 'zielen_udzial', 'drzewa_100m'],
    wzorce: [/ziel/, /\bpark(u|i|ow|iem)?\b/, /traw/, /przyrod/, /natur/],
  },
  {
    warstwy: ['powodz_1proc', 'powodz_10proc', 'powodz_02proc', 'gmina_powodz_powierzchnia_pct'],
    wzorce: [/zalew/, /zalan/, /powodz/, /podtop/, /wylew/],
  },
  {
    warstwy: ['cena_m2_mediana'],
    wzorce: [
      /kosztuj/,
      /\bcen(a|y|e|ie|ach)\b/,
      /\bdrog(o|ie)\b/,
      /\bmetr/,
      /\bm2\b/,
      /\bzl\b/,
      /tanio/,
    ],
  },
  { warstwy: ['apteka_odleglosc'], wzorce: [/aptek/, /\bleki\b/, /\blekow\b/, /lekarstw/] },
  { warstwy: ['przedszkole_odleglosc'], wzorce: [/przedszkol/] },
  { warstwy: ['zlobek_odleglosc'], wzorce: [/zlob/] },
  { warstwy: ['szkola_podst_odleglosc'], wzorce: [/szkol/, /podstawowk/] },
  { warstwy: ['przychodnia_odleglosc'], wzorce: [/przychodn/, /lekarz/, /\bpoz\b/, /doktor/] },
  {
    warstwy: ['sklep_odleglosc'],
    wzorce: [/sklep/, /zakup/, /spozyw/, /biedronk/, /zabk/, /\blidl/],
  },
  { warstwy: ['uslugi_15min'], wzorce: [/uslug/, /15 minut/, /wszystko blisko/, /pod reka/] },
  { warstwy: ['lawki_300m'], wzorce: [/lawk/, /usiasc/] },
  { warstwy: ['obnizone_krawezniki_300m'], wzorce: [/kraweznik/, /wozk/, /niepelnospraw/] },
  { warstwy: ['oswietlenie_100m'], wzorce: [/latarn/, /oswietl/, /ciemno/] },
  { warstwy: ['sct_w_strefie'], wzorce: [/\bsct\b/, /czystego transportu/, /diesl/] },
  { warstwy: ['spp_podstrefa'], wzorce: [/parkow/, /parkuj/, /parking/, /strefa platn/] },
  { warstwy: ['bo_projekty_1km'], wzorce: [/budzet\w* obywatel/, /projekt\w* (bo|obywatel)/] },
  { warstwy: ['inwestycje_500m'], wzorce: [/budow/, /buduj/, /inwestycj/, /dzwig/, /pozwoleni/] },
  { warstwy: ['mpzp_status'], wzorce: [/plan\w* miejscow/, /\bmpzp\b/, /zabudow/] },
  { warstwy: ['punkt_schronienia_odleglosc'], wzorce: [/schron/, /ukryc/] },
  { warstwy: ['przetargi_dzielnica'], wzorce: [/przetarg/, /zamowien/] },
  { warstwy: ['gmina_dlug_pc'], wzorce: [/dlug/, /zadluz/] },
  { warstwy: ['pozary_gmina_2025'], wzorce: [/pozar/, /ogien/, /strazak/] },
  { warstwy: ['miejscowe_zagrozenia_gmina_2025'], wzorce: [/zagrozen/, /wypadk/, /bezpieczn/] },
  { warstwy: ['udzial_65plus'], wzorce: [/senior/, /emeryt/, /starsz/] },
  { warstwy: ['udzial_0_14'], wzorce: [/dzieci/, /dziecm/, /mlodych rodzin/] },
  { warstwy: ['ludnosc_1km'], wzorce: [/ludn/, /zaludn/, /gest/, /tlum/, /ile osob/, /ilu ludzi/] },
]

/** Przykładowe pytania na „nie wiem” – pokazujemy tylko te, których warstwa jest na liście. */
export const PODPOWIEDZI: readonly { pytanie: string; warstwa: string }[] = [
  { pytanie: 'Jak głośno tu jest?', warstwa: 'halas_ldwn' },
  { pytanie: 'Daleko do przystanku?', warstwa: 'przystanek_odleglosc' },
  { pytanie: 'Czy jest tu zielono?', warstwa: 'zielen_worldcover_100m' },
  { pytanie: 'Jakie jest powietrze?', warstwa: 'pm25_srednia' },
  { pytanie: 'Czy tu zalewa?', warstwa: 'powodz_1proc' },
  { pytanie: 'Ile kosztuje metr?', warstwa: 'cena_m2_mediana' },
]

export function podpowiedzi(lista: readonly PozycjaListy[]): string[] {
  const ids = new Set(lista.map((p) => p.id))
  return PODPOWIEDZI.filter((p) => ids.has(p.warstwa)).map((p) => p.pytanie)
}

/** Reguła bez AI: pytanie → id warstwy z listy albo null („nie wiem”). Deterministyczna. */
export function regula(pytanie: string, lista: readonly PozycjaListy[]): WyborWarstwy {
  const tekst = normalizuj(pytanie)
  const ids = new Set(lista.map((p) => p.id))
  let najlepsza: string | null = null
  let trafien = 0
  for (const r of REGULY) {
    const warstwa = r.warstwy.find((w) => ids.has(w))
    if (!warstwa) continue
    const n = r.wzorce.filter((w) => w.test(tekst)).length
    if (n > trafien) {
      trafien = n
      najlepsza = warstwa
    }
  }
  return { warstwa: najlepsza }
}

// --- Odpowiedź z danych ------------------------------------------------------------------

export type ZrodloOdpowiedzi = 'jev' | 'reguly'

export interface OdpowiedzWarstwy {
  rodzaj: 'warstwa'
  warstwa: string
  /** Nazwa warstwy z metadanych. */
  etykieta: string
  /** Surowa wartość pod adresem z public/dane; null = brak danych (nigdy 0). */
  wartosc: number | null
  /** Do wyświetlenia: „240 m – Rondo Mogilskie”, „tak”, „brak danych”. */
  tekst: string
  /** Sama wartość z jednostką („240 m”, „tak”, „brak danych”) – bez opisu miejsca. */
  tekstWartosci: string
  /** Opis z danych dla tego adresu (etykiety[i]), np. „Rondo Mogilskie”; null = brak. */
  opisMiejsca: string | null
  jednostka: string
  /** Nazwy źródeł z metadanych, rozdzielone „; ”. */
  zrodlo: string
  zrodla: Zrodlo[]
  /** „adres”, „siatka 100 m”, „gmina”… – czego naprawdę dotyczy liczba. */
  rozdzielczosc: string
  dataDanych: string | null
  atrapa: boolean
  /** Plik warstwy się nie wczytał – brak danych z powodu warstwy, nie adresu. */
  niedostepny: boolean
  zrodloOdpowiedzi: ZrodloOdpowiedzi
}

export interface OdpowiedzNieWiem {
  rodzaj: 'nie-wiem'
  podpowiedzi: string[]
  zrodloOdpowiedzi: ZrodloOdpowiedzi
}

export type Odpowiedz = OdpowiedzWarstwy | OdpowiedzNieWiem

const FORMAT = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })
export const BRAK_DANYCH = 'brak danych'

export function tekstWartosci(
  wartosc: number | null,
  jednostka: string,
  etykieta: string | null,
): string {
  if (wartosc === null || !Number.isFinite(wartosc)) return BRAK_DANYCH
  if (jednostka === 'status' && etykieta) return etykieta
  const baza =
    jednostka === '0/1' && (wartosc === 0 || wartosc === 1)
      ? wartosc === 1
        ? 'tak'
        : 'nie'
      : `${FORMAT.format(wartosc)} ${jednostka === 'status' ? '' : jednostka}`.trim()
  return etykieta ? `${baza} – ${etykieta}` : baza
}

export function opisRozdzielczosci(meta: Pick<WskaznikMeta, 'rozdzielczosc' | 'rozmiar'>) {
  return meta.rozmiar && meta.rozmiar !== meta.rozdzielczosc
    ? `${meta.rozdzielczosc} ${meta.rozmiar}`
    : meta.rozdzielczosc
}

/**
 * Buduje odpowiedź z danych dla adresu `i`. Jedyne wejście z JEV albo reguły to `wybor.warstwa`
 * (id) – wartość, jednostkę, źródło i rozdzielczość czytamy z warstwy w `wskazniki`.
 */
export function odpowiedz(
  wybor: WyborWarstwy,
  wskazniki: readonly WarstwaDanych[],
  i: number,
  zrodloOdpowiedzi: ZrodloOdpowiedzi,
): Odpowiedz {
  const w = wybor.warstwa ? wskazniki.find((x) => x.meta.id === wybor.warstwa) : undefined
  if (!w || w.meta.atrapa) {
    return {
      rodzaj: 'nie-wiem',
      podpowiedzi: podpowiedzi(listaWarstw(wskazniki.map((x) => x.meta))),
      zrodloOdpowiedzi,
    }
  }
  const surowa = w.niedostepny ? null : (w.wartosci[i] ?? null)
  const wartosc = typeof surowa === 'number' && Number.isFinite(surowa) ? surowa : null
  const etykieta = wartosc === null ? null : (w.etykiety?.[i] ?? null)
  const m = w.meta
  return {
    rodzaj: 'warstwa',
    warstwa: m.id,
    etykieta: m.nazwa,
    wartosc,
    tekst: tekstWartosci(wartosc, m.jednostka, etykieta),
    tekstWartosci:
      m.jednostka === 'status' && etykieta ? etykieta : tekstWartosci(wartosc, m.jednostka, null),
    opisMiejsca: m.jednostka === 'status' ? null : etykieta,
    jednostka: m.jednostka,
    zrodlo: m.zrodla.map((z) => z.nazwa).join('; '),
    zrodla: m.zrodla,
    rozdzielczosc: opisRozdzielczosci(m),
    dataDanych: m.zrodla[0]?.dataDanych ?? null,
    atrapa: Boolean(m.atrapa),
    niedostepny: Boolean(w.niedostepny),
    zrodloOdpowiedzi,
  }
}

/**
 * Całość: JEV wybiera warstwę z listy (przez pośrednika #15), a gdy nie może – reguła.
 * Nigdy nie rzuca. `zrodloOdpowiedzi` mówi, kto wybrał warstwę; liczba zawsze z danych.
 */
export async function zapytajOAdres(
  pytanie: string,
  wskazniki: readonly WarstwaDanych[],
  i: number,
  opcje: OpcjeKlienta = {},
): Promise<Odpowiedz> {
  const lista = listaWarstw(wskazniki.map((w) => w.meta))
  const { wynik, zrodlo } = await zJevem(
    zapytanieJev(pytanie, lista),
    (odp) => przetworz(odp, lista),
    () => regula(pytanie, lista),
    opcje,
  )
  return odpowiedz(wynik, wskazniki, i, zrodlo === 'jev' ? 'jev' : 'reguly')
}
