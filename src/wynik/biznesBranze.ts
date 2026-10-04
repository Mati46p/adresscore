// Słownik branż trybu „Biznes” po stronie frontu (E10, #105–#107): identyfikatory i aliasy starych
// linków, grupy na liście, nazwy w dopełniaczu i filtry flagowe. Katalog usług
// (`public/dane/uslugi/katalog.json`) zna tylko mianownik i flagi, a reszta jest decyzją
// prezentacji, więc leży tu. Test na prawdziwym katalogu pilnuje, żeby żadna z jego branż nie
// została bez grupy, odmiany i (gdy ma flagi) filtra, a każdy wpis stąd miał pokrycie w danych.
import type { FiltryUslug, TrybFlagi } from './biznesUslugi.ts'

// ── Identyfikatory ───────────────────────────────────────────────────────────────────────

/**
 * Branża pokazywana, gdy link nie podaje żadnej. `url.ts` i `stan.ts` zostają przy starym id
 * `sklep` (alias niżej), więc tu jest nowe id z katalogu usług.
 */
export const DOMYSLNA_BRANZA = 'sklep_spozywczy'

/**
 * Stare identyfikatory z linków sprzed katalogu usług (`#/biznes?b=sklep`) → id z katalogu.
 * Parametr `b` czyta `url.ts` (bez zmian), a alias stosuje się dopiero przy wyborze pliku.
 * Pierwsze dwa to jedyne branże starego eksportu z `public/dane/biznes`, które zmieniły id
 * (apteka, fryzjer, piekarnia, kawiarnia i paczkomat mają w katalogu to samo id i aliasu nie
 * potrzebują). Kolejne trzy to nazwy z rozszerzonego eksportu OSM opisanego w `etl/uslugi.md`;
 * żaden link z nimi nie powinien istnieć, ale alias nic nie kosztuje, a stary link nie zgłosi
 * błędu. Alias nie może przesłonić id z katalogu (pilnuje test).
 */
export const ALIASY_BRANZ: Readonly<Record<string, string>> = {
  sklep: 'sklep_spozywczy',
  przychodnia: 'poz',
  kosmetyczka: 'salon_kosmetyczny',
  mieso: 'sklep_miesny',
  zoologiczny: 'sklep_zoologiczny',
}

/**
 * Id branży do wczytania dla wartości z linku albo stanu: stary alias zamienia się na id z katalogu,
 * a id spoza katalogu (literówka, branża usunięta) wraca do domyślnej, zamiast kończyć się
 * błędem 404. Bez listy `znane` (katalog jeszcze się nie wczytał) tylko alias.
 */
export function rozwiazBranze(id: string, znane?: Iterable<string>): string {
  const docelowe = Object.hasOwn(ALIASY_BRANZ, id) ? (ALIASY_BRANZ[id] as string) : id
  if (!znane) return docelowe
  const zbior = znane instanceof Set ? znane : new Set(znane)
  return zbior.has(docelowe) ? docelowe : DOMYSLNA_BRANZA
}

// ── Grupy na liście ──────────────────────────────────────────────────────────────────────

export interface GrupaBranz {
  id: string
  nazwa: string
  /** Id branż w kolejności na liście. */
  branze: readonly string[]
}

/**
 * Grupy listy branż. Kolejność grup i branż w grupie jest ustalona tutaj, a nie alfabetyczna:
 * w każdej grupie na początku stoją najczęściej szukane lokalizacje.
 */
export const GRUPY_BRANZ: readonly GrupaBranz[] = [
  {
    id: 'zdrowie',
    nazwa: 'Zdrowie',
    branze: ['apteka', 'poz', 'dentysta', 'fizjoterapia', 'laboratorium', 'weterynarz'],
  },
  {
    id: 'jedzenie',
    nazwa: 'Jedzenie i picie',
    branze: ['restauracja', 'kawiarnia', 'bar', 'piekarnia', 'cukiernia', 'lodziarnia'],
  },
  {
    id: 'uslugi',
    nazwa: 'Usługi',
    branze: ['fryzjer', 'salon_kosmetyczny', 'silownia', 'pralnia', 'paczkomat'],
  },
  {
    id: 'handel',
    nazwa: 'Handel',
    branze: [
      'sklep_spozywczy',
      'warzywniak',
      'sklep_miesny',
      'drogeria',
      'sklep_zoologiczny',
      'kwiaciarnia',
      'optyk',
    ],
  },
  { id: 'auto', nazwa: 'Auto', branze: ['warsztat', 'myjnia'] },
]

/** Branża spoza słownika trafia tu, żeby nie zniknęła z listy; test pilnuje, że to nie zachodzi. */
export const GRUPA_INNE: Pick<GrupaBranz, 'id' | 'nazwa'> = { id: 'inne', nazwa: 'Inne' }

export interface GrupaZBranzami<T> {
  id: string
  nazwa: string
  branze: T[]
}

/**
 * Branże z katalogu pogrupowane do `<optgroup>`. Grupy bez branż z katalogu znikają, branże
 * spoza słownika idą do „Inne” na końcu (w kolejności z katalogu).
 */
export function grupujBranze<T extends { id: string }>(branze: readonly T[]): GrupaZBranzami<T>[] {
  const poId = new Map(branze.map((b) => [b.id, b]))
  const uzyte = new Set<string>()
  const wynik: GrupaZBranzami<T>[] = []
  for (const g of GRUPY_BRANZ) {
    const wGrupie = g.branze.flatMap((id) => {
      const b = poId.get(id)
      if (!b) return []
      uzyte.add(id)
      return [b]
    })
    if (wGrupie.length) wynik.push({ id: g.id, nazwa: g.nazwa, branze: wGrupie })
  }
  const reszta = branze.filter((b) => !uzyte.has(b.id))
  if (reszta.length) wynik.push({ ...GRUPA_INNE, branze: reszta })
  return wynik
}

// ── Dopełniacz ───────────────────────────────────────────────────────────────────────────

/**
 * Nazwa branży w dopełniaczu liczby mnogiej („istniejących aptek”). Katalog zna tylko mianownik
 * („Apteka”), więc odmiana jest tutaj; nowa branża bez wpisu dostaje bezpieczne „punktów tej
 * branży”, a test pilnuje, żeby żadna branża z katalogu nie spadła na ten zapas.
 */
export const BRANZE_W_DOPELNIACZU: Readonly<Record<string, string>> = {
  sklep_spozywczy: 'sklepów spożywczych',
  apteka: 'aptek',
  fryzjer: 'fryzjerów lub barberów',
  piekarnia: 'piekarni',
  kawiarnia: 'kawiarni',
  poz: 'przychodni POZ',
  dentysta: 'gabinetów stomatologicznych',
  fizjoterapia: 'gabinetów fizjoterapii',
  laboratorium: 'laboratoriów i punktów pobrań',
  silownia: 'siłowni i klubów fitness',
  weterynarz: 'gabinetów weterynaryjnych',
  restauracja: 'restauracji i fast foodów',
  warsztat: 'warsztatów samochodowych',
  myjnia: 'myjni samochodowych',
  salon_kosmetyczny: 'salonów kosmetycznych',
  kwiaciarnia: 'kwiaciarni',
  optyk: 'optyków',
  drogeria: 'drogerii',
  cukiernia: 'cukierni',
  sklep_miesny: 'sklepów mięsnych',
  warzywniak: 'warzywniaków',
  pralnia: 'pralni',
  sklep_zoologiczny: 'sklepów zoologicznych',
  bar: 'barów i pubów',
  lodziarnia: 'lodziarni',
  paczkomat: 'automatów paczkowych',
}

const ZAPASOWY_DOPELNIACZ = 'punktów tej branży'

/** Dopełniacz dla id z katalogu; stary alias (`sklep`) też działa, bo przechodzi przez `rozwiazBranze`. */
export function branzaWDopelniaczu(id: string): string {
  const docelowe = rozwiazBranze(id)
  // `hasOwn`, bo id z linku może brzmieć „constructor”, a to klucz prototypu obiektu, nie branża.
  return Object.hasOwn(BRANZE_W_DOPELNIACZU, docelowe)
    ? (BRANZE_W_DOPELNIACZU[docelowe] as string)
    : ZAPASOWY_DOPELNIACZ
}

// ── Filtry flagowe ───────────────────────────────────────────────────────────────────────

export interface DefinicjaFiltraFlagi {
  /** Klucz flagi w `bityFlag` pliku branży. */
  flaga: string
  tryb: TrybFlagi
  /** Napis przy przełączniku. */
  etykieta: string
  /** Jedno zdanie pod napisem: co filtr robi i czego nie dowodzi. */
  opis: string
  /** Konkurencja po filtrze w dopełniaczu mnogim, do zdania „… niż 7 na 10 istniejących <tu>”. */
  konkurencja: string
}

/**
 * Filtry oparte na flagach z plików branż. Każda flaga z `bityFlag` ma tu wpis (test na katalogu),
 * a dentysta „z umową NFZ” jest zawężeniem z zastrzeżeniem, bo flaga znaczy „jest w Informatorze
 * o Terminach Leczenia”, a brak flagi nie dowodzi braku umowy (`etl/uslugi.md`).
 */
export const FILTRY_FLAG: Readonly<Record<string, readonly DefinicjaFiltraFlagi[]>> = {
  dentysta: [
    {
      flaga: 'nfz',
      tryb: 'tylko',
      etykieta: 'Tylko gabinety z umową NFZ',
      opis: 'Gabinet widnieje w Informatorze o Terminach Leczenia NFZ. Brak wpisu nie dowodzi braku umowy, więc filtr może pominąć część gabinetów.',
      konkurencja: 'gabinetów stomatologicznych z umową NFZ',
    },
  ],
  restauracja: [
    {
      flaga: 'fast_food',
      tryb: 'bez',
      etykieta: 'Bez fast foodów',
      opis: 'Pomija lokale oznaczone w źródłach jako fast food, burgerownie, kebaby i hot dogi. Oznaczenie jest przybliżone.',
      konkurencja: 'restauracji bez fast foodów',
    },
  ],
  fryzjer: [
    {
      flaga: 'barber',
      tryb: 'tylko',
      etykieta: 'Tylko barberzy',
      opis: 'Zostają miejsca oznaczone jako barber. Pozostałe salony fryzjerskie nie liczą się jako konkurencja.',
      konkurencja: 'barberów',
    },
  ],
}

const BRAK_FILTROW_FLAG: readonly DefinicjaFiltraFlagi[] = []

/** Filtry flagowe dostępne dla branży (pusta lista, gdy branża nie ma flag). */
export function filtryFlagBranzy(id: string): readonly DefinicjaFiltraFlagi[] {
  const docelowe = rozwiazBranze(id)
  return Object.hasOwn(FILTRY_FLAG, docelowe)
    ? (FILTRY_FLAG[docelowe] as readonly DefinicjaFiltraFlagi[])
    : BRAK_FILTROW_FLAG
}

/** Czy filtr z definicji jest włączony w ustawieniach (ten sam tryb dla tej flagi). */
export const filtrFlagiWlaczony = (filtry: FiltryUslug, def: DefinicjaFiltraFlagi): boolean =>
  filtry.flagi[def.flaga] === def.tryb

/** Ustawienia z włączonym albo wyłączonym filtrem flagowym; reszta bez zmian. */
export function zFiltremFlagi(
  filtry: FiltryUslug,
  def: DefinicjaFiltraFlagi,
  wlaczony: boolean,
): FiltryUslug {
  const flagi = { ...filtry.flagi }
  if (wlaczony) flagi[def.flaga] = def.tryb
  else delete flagi[def.flaga]
  return { ...filtry, flagi }
}

/** Ustawienia z przełączonym filtrem „≥ 2 źródeł”; reszta bez zmian. */
export const zFiltremZrodel = (filtry: FiltryUslug, wlaczony: boolean): FiltryUslug => ({
  ...filtry,
  min2Zrodla: wlaczony,
})

const maleLitery = (tekst: string) => tekst.charAt(0).toLocaleLowerCase('pl') + tekst.slice(1)

/** Napis przełącznika „≥ 2 źródeł”; ten sam tekst idzie do panelu i do opisu na karcie. */
export const ETYKIETA_MIN_2_ZRODLA = 'Tylko punkty potwierdzone w co najmniej 2 źródłach'

/**
 * Jedno zdanie o tym, jak zawężono konkurencję, albo `null` bez filtrów. Karta pokazuje je pod
 * główną liczbą: zrzut ekranu z kartą ma mówić, z kim miejsce porównano.
 */
export function opisFiltrow(id: string, filtry: FiltryUslug): string | null {
  const czesci = [
    ...(filtry.min2Zrodla ? [maleLitery(ETYKIETA_MIN_2_ZRODLA)] : []),
    ...filtryFlagBranzy(id)
      .filter((def) => filtrFlagiWlaczony(filtry, def))
      .map((def) => maleLitery(def.etykieta)),
  ]
  return czesci.length ? `Konkurencja po filtrach: ${czesci.join(', ')}.` : null
}

/**
 * Konkurencja w dopełniaczu do zdania na karcie. Aktywny filtr flagowy zmienia znaczenie
 * rzeczownika („restauracji bez fast foodów”), więc zdanie mówi, z kim naprawdę porównano.
 * Filtr „≥ 2 źródeł” nie zmienia rodzaju punktów, tylko ich pewność, więc ma osobne zdanie na
 * karcie (`opisFiltrow`).
 */
export function konkurencjaWDopelniaczu(id: string, filtry: FiltryUslug): string {
  const aktywne = filtryFlagBranzy(id).filter((def) => filtrFlagiWlaczony(filtry, def))
  if (aktywne.length === 1) return (aktywne[0] as DefinicjaFiltraFlagi).konkurencja
  return branzaWDopelniaczu(id)
}
