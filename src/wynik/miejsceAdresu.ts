// Okolica adresu na karcie i w porównaniu (#185): nazwa jednostki SIM albo miejscowości z
// okolice.json, z zapasem na dzielnicę Krakowa albo gminę. Czyste funkcje bez DOM i bez Reacta
// (testy na gołym `node --test`), z kontraktu tylko typy.
//
// Zasady:
// - Okolica adresu to jednostka SIM (Kraków) albo miejscowość (poza Krakowem) – nazwa, numer i dzielnica
//   z pliku. Zapas to dawny podpis „Dzielnica …” / „Gmina …”: dostaje go adres, gdy pliku nie ma
//   (nie wczytał się albo jest z innej wersji adresów) i gdy w kolumnie okolic stoi `null`.
//   Brak okolicy nie jest zerem ani pustym polem: karta mówi dalej, w jakiej dzielnicy albo gminie leży adres.
// - Nazwy potoczne (OSM) to punkty `place=neighbourhood|quarter` leżące w jednostce, nie granice osiedli
//   (etl/okolice.md). Karta mówi więc, że w jednostce „leżą”, i nigdy nie twierdzi, że adres leży
//   w konkretnym osiedlu: nazwa wybrana po najbliższym punkcie byłaby zgadywaniem.
// - Uwagi to gotowe teksty `rozjazdy[].opis` o tej jednostce, ale tylko te, które tłumaczą samą nazwę
//   jednostki. Rozjazdy o wyszukiwaniu i o braku miejsc OSM nic nie mówią o adresie, więc na kartę nie idą.
import type { Adres, PlikOkolic, RodzajRozjazdu } from '../kontrakty/index.ts'
import { okolicaAdresu } from './luki.ts'
import { opisOkolicy, podpisOkolicy } from './rankingLuk.ts'

/**
 * Ile nazw potocznych karta wylicza. Jednostka Nowa Huta ma ich 18 (same „Osiedle …”), a pasek pod
 * nazwą okolicy ma zostać krótki; reszta idzie liczbą. Przy jednej nazwie ponad limit pokazujemy ją całą:
 * „i jeszcze 1 nazwa” zajmuje tyle samo miejsca co sama nazwa.
 */
export const MAKS_POTOCZNYCH = 6

/** Rozjazdy, które karta pokazuje przy jednostce (reszta dotyczy wyszukiwania, nie adresu). */
const UWAGI_NA_KARCIE: ReadonlySet<RodzajRozjazdu> = new Set([
  'nazwa-jednostki-jak-dzielnica',
  'nazwa-jednostki-z-innej-dzielnicy',
  'nazwa-poza-jednostka-o-tej-nazwie',
])

export type RodzajMiejsca = 'sim' | 'miejscowosc' | 'zapas'

export interface MiejsceAdresu {
  /** `sim` i `miejscowosc` z okolice.json, `zapas` = dzielnica Krakowa albo gmina z adresu. */
  rodzaj: RodzajMiejsca
  /** Id okolicy jak w rankingach luk („sim-803”, „m-1219064-grabowki”); w zapasie null. */
  id: string | null
  /** Do nagłówka: „Kazimierz”, „Grabówki”; w zapasie „Dzielnica I Stare Miasto” albo „Gmina Liszki”. */
  nazwa: string
  /** Pod nazwą: „jednostka SIM I.2, dzielnica I Stare Miasto”, „miejscowość, gmina Liszki”; w zapasie null. */
  podpis: string | null
  /** Podpis i liczba adresów okolicy jak w rankingach luk; w zapasie null (nie znamy liczby). */
  opis: string | null
  /** Liczba adresów okolicy z pliku; w zapasie null. */
  liczbaAdresow: number | null
  /** Nazwy OSM leżące w jednostce (tylko `sim`), w kolejności z pliku. */
  potoczne: readonly string[]
  /** Teksty rozjazdów o tej jednostce, gotowe do pokazania; zwykle zero albo jeden. */
  uwagi: readonly string[]
}

function zapas(adres: Pick<Adres, 'dzielnica' | 'gmina'>): MiejsceAdresu {
  const nazwa = adres.dzielnica
    ? `Dzielnica ${adres.dzielnica}`
    : adres.gmina
      ? `Gmina ${adres.gmina}`
      : 'Brak danych o okolicy'
  return {
    rodzaj: 'zapas',
    id: null,
    nazwa,
    podpis: null,
    opis: null,
    liczbaAdresow: null,
    potoczne: [],
    uwagi: [],
  }
}

function uwagiJednostki(okolice: PlikOkolic, id: string): string[] {
  const uwagi: string[] = []
  for (const r of okolice.rozjazdy) {
    if (!UWAGI_NA_KARCIE.has(r.rodzaj) || !r.jednostki?.includes(id)) continue
    if (!uwagi.includes(r.opis)) uwagi.push(r.opis)
  }
  return uwagi
}

/**
 * Okolica adresu `i` (indeks w adresy.json) do pokazania na karcie i w porównaniu. Z plikiem okolic
 * to jednostka SIM albo miejscowość; bez pliku, bez okolicy w kolumnie albo poza kolumną – zapas.
 */
export function miejsceAdresu(
  adres: Pick<Adres, 'dzielnica' | 'gmina'>,
  i: number,
  okolice: PlikOkolic | null | undefined,
): MiejsceAdresu {
  if (!okolice) return zapas(adres)
  const o = okolicaAdresu(adres, i, okolice)
  const wpis = okolice.okolice[o.id]
  if (!wpis || (o.typ !== 'sim' && o.typ !== 'miejscowosc')) return zapas(adres)
  return {
    rodzaj: o.typ,
    id: o.id,
    nazwa: o.nazwa,
    podpis: podpisOkolicy(o),
    opis: opisOkolicy(o, wpis.liczbaAdresow),
    liczbaAdresow: wpis.liczbaAdresow,
    potoczne: wpis.rodzaj === 'sim' ? wpis.potoczne : [],
    uwagi: o.typ === 'sim' ? uwagiJednostki(okolice, o.id) : [],
  }
}

/** „nazwa”, „nazwy”, „nazw” po liczebniku: 1 nazwa, 2 nazwy, 5 nazw, 12 nazw, 22 nazwy. */
function odmianaNazw(n: number): 'nazwa' | 'nazwy' | 'nazw' {
  if (n === 1) return 'nazwa'
  const j = n % 10
  const d = n % 100
  return j >= 2 && j <= 4 && (d < 12 || d > 14) ? 'nazwy' : 'nazw'
}

/**
 * Zdanie o nazwach potocznych w jednostce albo null, gdy OSM nie ma tam żadnego osiedla ani części
 * miasta. „W tej jednostce leżą też osiedla i części miasta z OpenStreetMap: Ugorek, Wieczysta.”
 */
export function zdaniePotocznych(
  potoczne: readonly string[],
  limit: number = MAKS_POTOCZNYCH,
): string | null {
  if (potoczne.length === 0) return null
  const widoczne = potoczne.length <= limit + 1 ? potoczne : potoczne.slice(0, limit)
  const reszta = potoczne.length - widoczne.length
  const ogon = reszta > 0 ? ` i jeszcze ${reszta} ${odmianaNazw(reszta)}` : ''
  return `W tej jednostce leżą też osiedla i części miasta z OpenStreetMap: ${widoczne.join(', ')}${ogon}.`
}

// ── Źródła okolic ────────────────────────────────────────────────────────────────────────

/** Strona z prawami do danych OSM – nazwa źródła w pliku wskazuje na API Overpass, nie na licencję. */
export const URL_PRAW_OSM = 'https://www.openstreetmap.org/copyright'

export interface ZrodloOkolic {
  /** Krótka nazwa do podpisu, np. „Jednostki SIM Krakowa”. */
  nazwa: string
  url: string
  dataDanych: string
  /** Dane z OpenStreetMap: wymagają atrybucji „© OpenStreetMap contributors” i licencji ODbL. */
  osm: boolean
}

/**
 * Nazwy źródeł w pliku są opisami („Jednostki SIM Krakowa – granice (MSIP, warstwa …)”). Do podpisu
 * bierzemy to, co stoi przed pierwszym „ – ”, „ (” albo „:”; bez takiego miejsca nazwę całą.
 */
export function krotkaNazwaZrodla(nazwa: string): string {
  const koniec = nazwa.search(/ – | \(|:/)
  return (koniec > 0 ? nazwa.slice(0, koniec) : nazwa).trim()
}

/** Źródła okolic z pliku `okolice.json` w kolejności pliku, z krótką nazwą i znacznikiem OSM. */
export function zrodlaOkolic(plik: Pick<PlikOkolic, 'zrodla'>): ZrodloOkolic[] {
  return plik.zrodla.map((z) => ({
    nazwa: krotkaNazwaZrodla(z.nazwa),
    url: z.url,
    dataDanych: z.dataDanych,
    osm: /openstreetmap|\bosm\b/i.test(`${z.nazwa} ${z.url}`),
  }))
}

/**
 * Jedno zdanie pod rankingiem: skąd okolice. Ranking pokazuje nazwy jednostek SIM i miejscowości,
 * nie nazwy potoczne, więc źródło OSM zostaje poza zdaniem (atrybucję OSM niesie karta adresu,
 * która te nazwy pokazuje). Bez pliku okolicą jest dzielnica albo gmina z rejestru adresów
 * i zdanie mówi to wprost.
 */
export function opisZrodelOkolic(plik: Pick<PlikOkolic, 'zrodla'> | null | undefined): string {
  if (!plik) return 'Okolice: dzielnice Krakowa i gminy z rejestru adresów.'
  const lista = zrodlaOkolic(plik)
    .filter((z) => !z.osm)
    .map((z) => (z.dataDanych ? `${z.nazwa} (stan ${z.dataDanych})` : z.nazwa))
  return lista.length > 0 ? `Okolice: ${lista.join(' · ')}.` : 'Okolice: brak opisu źródła.'
}
