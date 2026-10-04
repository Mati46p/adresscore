// Szukanie okolic po nazwie (#185): jednostki SIM Krakowa, osiedla i części miasta z OpenStreetMap
// oraz miejscowości poza Krakowem – wszystko z `okolice.json`. Czysta logika bez DOM i bez Reacta
// (testy na gołym `node --test`), z kontraktu tylko typy.
//
// Zasady:
// - Okolica w wynikach to jednostka SIM albo miejscowość. Nazwa osiedla z OSM („Salwator”) to punkt
//   leżący w jednostce, nie granice osiedla (etl/okolice.md), więc taka podpowiedź prowadzi do jednostki,
//   w której punkt leży, i mówi o tym wprost: „nazwa z OpenStreetMap · Zwierzyniec (jednostka SIM …)”.
// - Wielkość liter i polskie znaki nie mają znaczenia („kurdwanow” = „Kurdwanów”), jak w szukaniu adresów.
// - „osiedle”, „dzielnica”, „na”, „w” nie niosą nazwy: wypadają z zapytania i z nazw, więc „osiedle
//   Oficerskie” i „na Ruczaju” trafiają tam, gdzie wpis „Oficerskie” i „Ruczaj”.
// - Słowo zapytania pasuje do słowa nazwy pełnym zapisem, początkiem (pisanie w toku), odmianą
//   (końcówki o łącznej długości do 2 liter: „Ruczaju” = „Ruczaj”) albo jedną literówką. Odmiana jest ciasna:
//   „Mogilska” (ulica) nie ma być „Mogiłą” (jednostka), a „Podgórze” nie „Podgórkami” – szersza reguła
//   z `indeks.ts` pasuje do ulic, nie do nazw okolic.
// - Jedna okolica to jedna podpowiedź. Gdy pasuje i jej nazwa, i nazwa OSM z jej wnętrza, wygrywa wyższy
//   wynik; przy remisie nazwa okolicy (nie OSM). Dzięki temu „Wesoła” pokazuje jednostkę o tej nazwie
//   i jednostkę „Wesoła Wschód”, w której leży punkt OSM „Wesoła” (rozjazd z etl/okolice.md).
import type { PlikOkolic } from '../../kontrakty/okolice.ts'
import { opisOkolicy, podpisOkolicy } from '../../wynik/rankingLuk.ts'
import { jedenBlad, normalizuj } from './indeks.ts'

export interface WynikOkolicy {
  /** Id okolicy jak w `okolice.json` i rankingach luk: „sim-805”, „m-1219064-grabowki”. */
  id: string
  rodzaj: 'sim' | 'miejscowosc'
  /** Nazwa okolicy: „Ruczaj”, „Zwierzyniec”. */
  nazwa: string
  /** Tytuł podpowiedzi: nazwa okolicy albo nazwa z OSM, po której dopasowano („Salwator”). */
  tytul: string
  /** Nazwa z OSM, po której dopasowano; null, gdy dopasowano po nazwie okolicy. */
  nazwaOsm: string | null
  /** Druga linia podpowiedzi: rodzaj okolicy, dzielnica albo gmina, liczba adresów. */
  opis: string
  /** Im wyżej, tym lepsze dopasowanie. Do kolejności i testów, nie do pokazania. */
  wynik: number
}

interface Kandydat {
  id: string
  rodzaj: 'sim' | 'miejscowosc'
  nazwa: string
  tytul: string
  nazwaOsm: string | null
  opis: string
  tokeny: string[]
  /** Nazwa składa się wyłącznie ze słów-wypełniaczy (wieś „Ulica”): tylko taki wpis znajdziemy po nich. */
  tylkoWypelniacze: boolean
  liczbaAdresow: number
}

export interface IndeksOkolic {
  kandydaci: Kandydat[]
}

/** Słowa bez nazwy: wypadają po obu stronach (zapytanie i nazwy), chyba że nazwa składa się tylko z nich. */
const WYPELNIACZE: ReadonlySet<string> = new Set([
  'os',
  'osiedle',
  'dzielnica',
  'okolica',
  'jednostka',
  'sim',
  'ul',
  'ulica',
  'w',
  'we',
  'na',
])

const JAKOSC_PELNA = 4
const JAKOSC_ODMIANA = 3.5
const JAKOSC_POCZATEK = 3
const JAKOSC_LITEROWKA = 1.5

function slowa(tekst: string): string[] {
  return normalizuj(tekst).split(' ').filter(Boolean)
}

function tokenyNazwy(nazwa: string): { tokeny: string[]; tylkoWypelniacze: boolean } {
  const wszystkie = slowa(nazwa)
  const bez = wszystkie.filter((t) => !WYPELNIACZE.has(t))
  return bez.length > 0
    ? { tokeny: bez, tylkoWypelniacze: false }
    : { tokeny: wszystkie, tylkoWypelniacze: true }
}

/**
 * Jakość dopasowania słowa zapytania `q` do słowa nazwy `w`: 4 pełne, 3,5 odmiana, 3 początek
 * (pisanie w toku), 1,5 literówka, 0 brak.
 */
function jakoscSlowa(q: string, w: string): number {
  if (q === w) return JAKOSC_PELNA
  if (w.startsWith(q)) return JAKOSC_POCZATEK
  if (q.length < 4 || w.length < 4) return 0
  let p = 0
  const m = Math.min(q.length, w.length)
  while (p < m && q.charCodeAt(p) === w.charCodeAt(p)) p++
  // Wspólny rdzeń i końcówki o łącznej długości do 2 liter: „Ruczaju” ~ „Ruczaj”, „Podgórzu” ~ „Podgórze”,
  // ale „Podgórki” to już inne miejsce niż „Podgórze”.
  if (p >= Math.max(3, m - 2) && q.length - p + (w.length - p) <= 2) return JAKOSC_ODMIANA
  // Literówka dopiero od 5 liter: krótkie nazwy („Łęg”, „Rżąka”) różniłyby się od połowy innych słów o jedną literę.
  if (q.length >= 5 && w.length >= 5 && jedenBlad(q, w)) return JAKOSC_LITEROWKA
  return 0
}

/** Wynik kandydata dla słów zapytania albo 0, gdy któreś słowo nie pasuje do żadnego słowa nazwy. */
function ocen(zapytanie: readonly string[], k: Kandydat): number {
  let suma = 0
  for (const q of zapytanie) {
    let najlepsza = 0
    for (const s of k.tokeny) {
      const j = jakoscSlowa(q, s)
      if (j > najlepsza) najlepsza = j
    }
    if (najlepsza === 0) return 0
    suma += najlepsza
  }
  // Pokrycie jak w szukaniu ulic: nazwa w całości objęta zapytaniem wyprzedza dłuższą o ten sam początek
  // („Rakowice” przed „Rakowice Lotnisko”).
  const pokrycie = Math.min(1, zapytanie.length / k.tokeny.length)
  return suma / zapytanie.length + 0.5 * pokrycie
}

export function zbudujIndeksOkolic(plik: Pick<PlikOkolic, 'okolice' | 'idOkolic'>): IndeksOkolic {
  const kandydaci: Kandydat[] = []
  for (const id of plik.idOkolic) {
    const o = plik.okolice[id]
    if (!o) continue
    const sim = o.rodzaj === 'sim'
    const rodzajOkolicy = {
      typ: o.rodzaj,
      numer: sim ? o.numer : undefined,
      dzielnica: sim ? o.dzielnica : undefined,
      gmina: o.gmina,
    }
    kandydaci.push({
      id,
      rodzaj: o.rodzaj,
      nazwa: o.nazwa,
      tytul: o.nazwa,
      nazwaOsm: null,
      opis: opisOkolicy(rodzajOkolicy, o.liczbaAdresow),
      ...tokenyNazwy(o.nazwa),
      liczbaAdresow: o.liczbaAdresow,
    })
    if (!sim) continue
    // Nazwy OSM leżące w jednostce: podpowiedź wskazuje jednostkę, nie granice osiedla.
    for (const osm of o.potoczne) {
      kandydaci.push({
        id,
        rodzaj: 'sim',
        nazwa: o.nazwa,
        tytul: osm,
        nazwaOsm: osm,
        opis: `nazwa z OpenStreetMap · ${o.nazwa} (${podpisOkolicy(rodzajOkolicy)})`,
        ...tokenyNazwy(osm),
        liczbaAdresow: o.liczbaAdresow,
      })
    }
  }
  return { kandydaci }
}

const indeksy = new WeakMap<object, IndeksOkolic>()

/** Indeks zbudowany raz na plik okolic (ok. 560 pozycji, kilka ms). */
export function indeksOkolicDla(plik: PlikOkolic): IndeksOkolic {
  let ind = indeksy.get(plik)
  if (!ind) {
    ind = zbudujIndeksOkolic(plik)
    indeksy.set(plik, ind)
  }
  return ind
}

/**
 * Opis okolicy bez złych miejsc łamania wiersza: separator „ · ” zostaje przy poprzednim słowie (wiersz nie
 * zaczyna się od kropki), a liczba przy słowie „adresów” („1241 / adresów” rozerwałoby jedną informację).
 */
export function spojnyOpis(opis: string): string {
  return opis.replaceAll(' · ', '\u00a0· ').replace(/(\d) (adres(?:y|ów)?)$/u, '$1\u00a0$2')
}

/**
 * Okolice pasujące do zapytania, najlepsze pierwsze (nie więcej niż `limit`). Pusta lista, gdy zapytanie
 * nie ma żadnego słowa z nazwą (same „osiedle”, „na”) albo nic nie pasuje.
 */
export function szukajOkolic(ind: IndeksOkolic, zapytanie: string, limit = 8): WynikOkolicy[] {
  const surowe = slowa(zapytanie)
  const bez = surowe.filter((t) => !WYPELNIACZE.has(t))
  // Same wypełniacze („Ulica”, „na”) szukają tylko nazw, które z nich się składają; puste zapytanie – niczego.
  const tylkoWypelniacze = bez.length === 0
  const q = tylkoWypelniacze ? surowe : bez
  if (q.length === 0) return []

  // Jedna okolica = jedna podpowiedź: wygrywa wyższy wynik, przy remisie nazwa okolicy przed OSM.
  const najlepsze = new Map<string, { k: Kandydat; wynik: number }>()
  for (const k of ind.kandydaci) {
    if (tylkoWypelniacze && !k.tylkoWypelniacze) continue
    const wynik = ocen(q, k)
    if (wynik === 0) continue
    const jest = najlepsze.get(k.id)
    const lepszy =
      !jest ||
      wynik > jest.wynik ||
      (wynik === jest.wynik && jest.k.nazwaOsm !== null && k.nazwaOsm === null)
    if (lepszy) najlepsze.set(k.id, { k, wynik })
  }

  return [...najlepsze.values()]
    .sort(
      (a, b) =>
        b.wynik - a.wynik ||
        a.k.tokeny.length - b.k.tokeny.length ||
        // Kraków przed miejscowościami, nazwa okolicy przed nazwą z OSM, większa okolica przed mniejszą.
        Number(a.k.rodzaj === 'miejscowosc') - Number(b.k.rodzaj === 'miejscowosc') ||
        Number(a.k.nazwaOsm !== null) - Number(b.k.nazwaOsm !== null) ||
        b.k.liczbaAdresow - a.k.liczbaAdresow ||
        a.k.tytul.localeCompare(b.k.tytul, 'pl') ||
        a.k.id.localeCompare(b.k.id),
    )
    .slice(0, limit)
    .map(({ k, wynik }) => ({
      id: k.id,
      rodzaj: k.rodzaj,
      nazwa: k.nazwa,
      tytul: k.tytul,
      nazwaOsm: k.nazwaOsm,
      opis: k.opis,
      wynik,
    }))
}
