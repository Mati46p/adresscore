// Układ danych zakładki „Zaangażowanie” (T058): ścieżki, sekcje ekranu, punkt urwania. Czyste funkcje,
// bez DOM i bez aliasu `@/`, żeby dało się je objąć testem na gołym `node --test`; komponent
// (`Zaangazowanie.tsx`) tylko je woła i rysuje. Okres, wybór ekranu i lista z udziałami są wspólne dla
// trzech zakładek (Zaangażowanie, CTA, Treść), więc `Cta.tsx`, `Tresc.tsx` i `tresc-dane.ts` importują
// je stąd: kolejność ekranów i podstawa udziału mają JEDNĄ definicję.
//
// Trzy zasady, które tu żyją, a nie w komponencie (CLAUDE.md „Liczby na ekranie”):
//  1. 100% to CAŁOŚĆ. Udział wiersza listy = jego liczność / SUMA liczności całej listy (`udzialy`,
//     metoda największej reszty), więc segmenty domykają się do 100,0 i zgadzają z podpisem
//     „liczony od N”. Lista musi przy tym być KOMPLETNA: jeśli baza obcięła ją limitem, suma listy
//     nie jest całością i udziałów nie liczymy wcale (patrz `listaZUdzialami`).
//  2. Zasięg sekcji to NIE udział: każda sekcja ma własny procent tej samej całości (odsłon ekranu),
//     więc kolumna zasięgów nie sumuje się do 100% i nie przechodzi przez `udzialy`.
//  3. Brak danych to `null`, nigdy 0: dzielenie przez zero i wartość niepoprawna dają `null`.
import { nazwaSekcji } from '../../pomiar/sekcje-nazwy.ts'
import { czyLiczba, formatLiczby, procentOd, udzialy } from '../arytmetyka.ts'
import type { WierszSekcji } from '../typy.ts'

// ── Okres ─────────────────────────────────────────────────────────────────────────────────

/** Okno zakładki w dobach warszawskich. Baza przycina `p_dni` do 30 dla surowych zdarzeń. */
export type Okres = 7 | 30

export const OKRESY: readonly { id: Okres; etykieta: string; tytul: string }[] = [
  { id: 7, etykieta: '7 dni', tytul: 'Ostatnie 7 dób warszawskich, razem z trwającą dzisiejszą' },
  {
    id: 30,
    etykieta: '30 dni',
    tytul: 'Ostatnie 30 dób warszawskich, razem z trwającą dzisiejszą',
  },
]

/**
 * Domyślnie 7 dni: krótsze okno to mniej wierszy do przeliczenia w sesjach (zapytania ścieżek,
 * punktu urwania i lejka są najcięższe w panelu), a tydzień obejmuje pełny cykl ruchu.
 */
export const OKRES_DOMYSLNY: Okres = 7

/** Największy `p_limit`, jaki przyjmuje baza (contracts/rpc.md: `p_limit ≤ 200`). */
export const MAKS_LIMIT_ZAPYTANIA = 200

// ── Ekran ─────────────────────────────────────────────────────────────────────────────────

/**
 * Ekrany z oznaczonymi sekcjami w tej kolejności (spec, Założenia: karta adresu, wyszukiwarka,
 * porównanie, Biznes). Inne ekrany, które pojawią się w danych, idą za nimi: wiersz, którego
 * front jeszcze nie zna, musi być w panelu widoczny, a nie zniknąć z przełącznika.
 */
const EKRANY_Z_SEKCJAMI: readonly string[] = ['okolica', 'szukaj', 'porownanie', 'biznes']

/** Ekrany obecne w danych: najpierw znane (w ustalonej kolejności), potem reszta alfabetycznie. */
export function opcjeEkranow(ekrany: Iterable<string>): string[] {
  const obecne = new Set(ekrany)
  const znane = EKRANY_Z_SEKCJAMI.filter((e) => obecne.has(e))
  const inne = [...obecne]
    .filter((e) => !EKRANY_Z_SEKCJAMI.includes(e))
    .sort((a, b) => a.localeCompare(b, 'pl'))
  return [...znane, ...inne]
}

/**
 * Nazwa sekcji ekranu do pokazania w tabelach (mapa kluczy → nazw żyje w `src/pomiar/sekcje-nazwy.ts`
 * i rośnie razem z oznaczeniami w ekranach). Nieznany klucz wraca sam, a pusty klucz (przycisk poza
 * oznaczoną sekcją) to „(bez sekcji)”: wiersz bez nazwy nie może zniknąć ani zostać pustą komórką.
 */
export function etykietaSekcji(klucz: string): string {
  return klucz === '' ? '(bez sekcji)' : nazwaSekcji(klucz)
}

/**
 * Ekran do pokazania: wybrany, jeśli ma dane w tym oknie, a w przeciwnym razie pierwszy dostępny.
 * Po zmianie okresu wybrany ekran może nie mieć danych; wtedy zakładka nie pokazuje pustki, tylko
 * pierwszy ekran z danymi (a po powrocie danych wraca do wyboru użytkownika).
 */
export function wybierzEkran(wybrany: string | null, dostepne: readonly string[]): string | null {
  if (wybrany !== null && dostepne.includes(wybrany)) return wybrany
  return dostepne[0] ?? null
}

// ── Lista z udziałami ─────────────────────────────────────────────────────────────────────

/** Klucz wiersza zbiorczego „pozostałe”. */
export const KLUCZ_ZBIORCZEGO = '__pozostale'

/** Ile pozycji zostaje na liście, zanim reszta zostanie zwinięta do jednego wiersza. */
export const MAKS_POZYCJI_LISTY = 15

export interface WierszListy<T> {
  klucz: string
  /** Dane pozycji; `null` dla wiersza zbiorczego „pozostałe”. */
  pozycja: T | null
  wartosc: number
  /** Ile pozycji zbiera wiersz (1 dla zwykłego). */
  pozycji: number
  zbiorczy: boolean
  /** Udział w SUMIE listy; `null`, gdy lista jest niekompletna albo suma wynosi zero. */
  udzial: number | null
}

export interface ListaZUdzialami<T> {
  wiersze: WierszListy<T>[]
  /** Suma liczności wszystkich pozycji, które przyszły z bazy (100% udziałów). */
  podstawa: number
  /**
   * Lista obejmuje całość okna: baza zwróciła mniej wierszy, niż wolno jej było zwrócić. Gdy
   * dostała tyle, ile wynosi limit, ogon mógł zostać obcięty, więc suma listy nie jest całością i
   * udziałów nie liczymy (inaczej pierwszy wiersz wyglądałby na większy, niż jest).
   */
  kompletna: boolean
}

/**
 * Lista „top N + pozostałe” z udziałami w SUMIE całości.
 *
 * - Sortuje malejąco po liczności (stabilnie: remis zachowuje kolejność z bazy).
 * - Pozycje o niepoprawnej liczności (ujemnej, NaN, ±∞) odpadają: nie wchodzą do podstawy.
 * - Gdy lista jest kompletna i dłuższa niż `maks + 1`, ogon zwija się do jednego wiersza
 *   „pozostałe”, a udziały liczy `udzialy` na WIERSZACH LISTY, więc suma wypisanych procentów to
 *   dokładnie 100,0, a wiersz zbiorczy ma swój udział jak każdy inny.
 * - Gdy lista jest niekompletna (limit zapytania), pokazujemy wszystko, co przyszło, bez udziałów.
 */
export function listaZUdzialami<T>(
  pozycje: readonly T[],
  wartosc: (pozycja: T) => number | null | undefined,
  klucz: (pozycja: T, indeks: number) => string,
  opcje: { maks: number; limitZapytania: number },
): ListaZUdzialami<T> {
  const poprawne: { pozycja: T; wartosc: number; klucz: string }[] = []
  pozycje.forEach((pozycja, indeks) => {
    const w = wartosc(pozycja)
    if (czyLiczba(w) && w >= 0)
      poprawne.push({ pozycja, wartosc: w, klucz: klucz(pozycja, indeks) })
  })
  poprawne.sort((a, b) => b.wartosc - a.wartosc)

  const podstawa = poprawne.reduce((suma, p) => suma + p.wartosc, 0)
  const kompletna = pozycje.length < opcje.limitZapytania
  const zwijaj = kompletna && poprawne.length > opcje.maks + 1
  const glowne = zwijaj ? poprawne.slice(0, opcje.maks) : poprawne
  const reszta = zwijaj ? poprawne.slice(opcje.maks) : []

  const wiersze: Omit<WierszListy<T>, 'udzial'>[] = glowne.map((p) => ({
    klucz: p.klucz,
    pozycja: p.pozycja,
    wartosc: p.wartosc,
    pozycji: 1,
    zbiorczy: false,
  }))
  if (reszta.length > 0) {
    wiersze.push({
      klucz: KLUCZ_ZBIORCZEGO,
      pozycja: null,
      wartosc: reszta.reduce((suma, p) => suma + p.wartosc, 0),
      pozycji: reszta.length,
      zbiorczy: true,
    })
  }
  const procenty = kompletna ? udzialy(wiersze, 'wartosc') : wiersze.map(() => null)
  return {
    wiersze: wiersze.map((w, i) => ({ ...w, udzial: procenty[i] ?? null })),
    podstawa,
    kompletna,
  }
}

/**
 * Podpis pod tabelą: od czego liczony jest udział. `null`, gdy lista jest pusta (nie ma czego
 * podpisywać). Jedno miejsce na tekst, żeby każda tabela z udziałami mówiła o podstawie tak samo.
 */
export function opisPodstawyUdzialu(
  lista: Pick<ListaZUdzialami<unknown>, 'wiersze' | 'podstawa' | 'kompletna'>,
  jednostka: string,
): string | null {
  if (lista.wiersze.length === 0) return null
  if (!lista.kompletna) {
    return 'Lista jest przycięta limitem zapytania, więc nie znam całości i nie liczę udziałów.'
  }
  if (!(lista.podstawa > 0)) return 'Udział: brak danych (suma równa zero).'
  const zbiorczy = lista.wiersze.some((w) => w.zbiorczy)
  return `Udział liczony od ${formatLiczby(lista.podstawa)} ${jednostka} łącznie: to suma wszystkich pozycji okna${
    zbiorczy ? ' (razem z wierszem „pozostałe”)' : ''
  }, więc udziały dają 100%.`
}

// ── Ścieżki ───────────────────────────────────────────────────────────────────────────────

/** Cel „koniec wizyty” w ścieżkach i przejściach (tak zapisuje go baza). */
export const WYJSCIE = '(wyjście)'

/**
 * Podpis ścieżki: ekrany po nazwach, połączone strzałką. Baza dopełnia krótką wizytę cele
 * „(wyjście)” do trzech kroków, więc „szukaj → (wyjście) → (wyjście)” zwija się do jednego
 * „(wyjście)”: po wyjściu nie ma już kroków. Brakująca nazwa kroku to „(brak)”, nie pusty napis.
 */
export function etykietaSciezki(
  kroki: readonly (string | null | undefined)[],
  nazwaEkranu: (ekran: string) => string,
): string {
  const czesci: string[] = []
  for (const krok of kroki) {
    if (krok === WYJSCIE) {
      czesci.push(WYJSCIE)
      break
    }
    czesci.push(krok ? nazwaEkranu(krok) : '(brak)')
  }
  return czesci.join(' → ')
}

// ── Sekcje ekranu ─────────────────────────────────────────────────────────────────────────

export interface WierszZasiegu {
  klucz: string
  sekcja: string
  /** Numer w kolejności dokumentu (1 = pierwsza od góry), z mediany pozycji zapisanej przez pomiar. */
  kolejnosc: number
  odslonySekcji: number | null
  odslonyEkranu: number | null
  /** Odsłony z sekcją / odsłony ekranu z pomiarem sekcji, w procentach. Może być > 100 tylko przy błędzie danych. */
  zasieg: number | null
  /** Mediana czasu WIDOCZNEGO w ms; `null`, gdy brak pomiaru. */
  medianaMs: number | null
}

export interface SekcjeEkranu {
  wiersze: WierszZasiegu[]
  /** Wspólny mianownik zasięgów ekranu; `null`, gdy brak wierszy albo wiersze podają różne wartości. */
  odslonyEkranu: number | null
}

function liczbaLubNull(wartosc: number | null | undefined): number | null {
  return czyLiczba(wartosc) && wartosc >= 0 ? wartosc : null
}

/** Rosnąco po pozycji; brak pozycji (null, NaN) na końcu. */
function porownajPozycje(a: number | null | undefined, b: number | null | undefined): number {
  const aOk = czyLiczba(a)
  const bOk = czyLiczba(b)
  if (aOk && bOk) return a - b
  if (aOk) return -1
  if (bOk) return 1
  return 0
}

/**
 * Sekcje jednego ekranu w kolejności dokumentu (mediana pozycji rosnąco, remis: nazwa), z zasięgiem
 * liczonym `procentOd(odsłony z sekcją, odsłony ekranu)`. Zasięgi NIE sumują się do 100%: każda
 * sekcja jest procentem tej samej całości (odsłon ekranu z pomiarem sekcji), nie jej częścią.
 */
export function sekcjeEkranu(wiersze: readonly WierszSekcji[], ekran: string): SekcjeEkranu {
  const posortowane = wiersze
    .filter((w) => w.ekran === ekran)
    .sort(
      (a, b) =>
        porownajPozycje(a.pozycja_med, b.pozycja_med) ||
        String(a.sekcja).localeCompare(String(b.sekcja), 'pl'),
    )
  const wynik = posortowane.map((w, i) => {
    const odslonySekcji = liczbaLubNull(w.odslony_z_sekcja)
    const odslonyEkranu = liczbaLubNull(w.odslony_ekranu)
    return {
      klucz: `${w.ekran}§${w.sekcja}§${i}`,
      sekcja: String(w.sekcja),
      kolejnosc: i + 1,
      odslonySekcji,
      odslonyEkranu,
      zasieg: procentOd(odslonySekcji, odslonyEkranu),
      medianaMs: liczbaLubNull(w.mediana_ms),
    }
  })
  const mianowniki = new Set(wynik.map((w) => w.odslonyEkranu).filter((n) => n !== null))
  const [jedyny] = [...mianowniki]
  return { wiersze: wynik, odslonyEkranu: mianowniki.size === 1 ? (jedyny ?? null) : null }
}
