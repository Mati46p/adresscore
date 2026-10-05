// Czysta logika zakładki „Sesje” (T057, FR-032): kafle wizyty, przejścia ekran → ekran i udostępnienia
// ułożone z odpowiedzi RPC. Bez React, bez DOM i bez aliasu `@/` (test: `sesje-dane.test.ts`);
// `Sesje.tsx` tylko to rysuje. Okres 7/30 dni jest wspólny z zakładką Akwizycja, więc jego definicja
// leży w `akwizycja-dane.ts` i `Sesje.tsx` importuje ją stamtąd (druga kopia listy okresów po cichu by
// się rozjechała).
//
// Zasady (CLAUDE.md „Liczby na ekranie”):
//  - odsetek sesji zaangażowanych i jednostronicowych liczy się od LICZBY SESJI okresu (`procentOd`).
//    Obie grupy nie są dopełnieniem: sesja z jedną odsłoną, która trwała 30 s i dłużej, należy do obu;
//  - przejścia mają osobną całość dla KAŻDEGO ekranu źródłowego. Udział przejścia to jego liczba
//    podzielona przez wszystkie przejścia z tego ekranu, więc udziały w jednej tabeli sumują się do
//    100,0 (liczy je `TabelaTop` przez `udzialy` z sumy tabeli, a ta suma to `razem` grupy), a
//    podstawę mówi podpis pod tabelą. Jedna kolumna z mieszanymi podstawami (raz suma ekranu, raz
//    suma listy) wyglądałaby na jedną skalę i nią nie byłaby;
//  - odsetek dokończeń udostępnienia ma podstawę równą wszystkim próbom TEGO elementu;
//  - brak pomiaru (sesje = 0, mediana `null`) to `null` i szary „brak danych”, nigdy 0;
//  - tekst z bazy (nazwa elementu udostępnienia, nieznany ekran) jest niezaufany: trafia tylko do
//    treści, nigdy do linku.
import { czyLiczba, procentOd } from '../arytmetyka.ts'
import { NAZWA_EKRANU, NAZWA_SPOSOBU_UDOSTEPNIENIA, nazwa } from '../nazwy.ts'
import type { SesjePrzeglad, WierszPrzejscia, WierszUdostepnienia } from '../typy.ts'

// ── Pomocnicze ────────────────────────────────────────────────────────────────────────────

/** Liczność nadająca się do sumy i do udziału: skończona i nieujemna. Inaczej `null`. */
function licznosc(wartosc: unknown): number | null {
  return czyLiczba(wartosc) && wartosc >= 0 ? wartosc : null
}

function tekstLubZastepczy(wartosc: unknown, zastepczy: string): string {
  return typeof wartosc === 'string' && wartosc.trim() !== '' ? wartosc : zastepczy
}

function porownajTekst(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ── Kafle wizyty ──────────────────────────────────────────────────────────────────────────

export interface KafleSesji {
  sesje: number
  /** Odsłony wszystkich sesji okresu (suma, z której baza liczy średnią stron na sesję). */
  odslony: number | null
  medianaStron: number | null
  sredniaStron: number | null
  /** Mediana czasu wizyty w MILISEKUNDACH (baza podaje sekundy): wejście dla `formatCzasu`. */
  medianaCzasMs: number | null
  p75CzasMs: number | null
  zaangazowane: number | null
  /** % sesji zaangażowanych od LICZBY SESJI okresu. */
  zaangazowanePct: number | null
  jednostronicowe: number | null
  /** % sesji jednostronicowych od LICZBY SESJI okresu (nie od dopełnienia zaangażowanych). */
  jednostronicowePct: number | null
}

function sekundyNaMs(sekundy: unknown): number | null {
  const s = licznosc(sekundy)
  return s === null ? null : Math.round(s * 1000)
}

/**
 * Kafle z `admin_sesje_przeglad`. Zwraca `null`, gdy w okresie nie było sesji: mediany i średnie nie
 * istnieją bez sesji (baza daje wtedy `null`), a „0 sesji, 0%” udawałoby pomiar. Komponent pokazuje
 * wtedy szary „brak danych” z wyjaśnieniem, nie kafle z zerami.
 */
export function kafleSesji(przeglad: SesjePrzeglad | null | undefined): KafleSesji | null {
  const sesje = licznosc(przeglad?.sesje)
  if (!przeglad || sesje === null || sesje <= 0) return null
  const zaangazowane = licznosc(przeglad.zaangazowane)
  const jednostronicowe = licznosc(przeglad.jednostronicowe)
  return {
    sesje,
    odslony: licznosc(przeglad.odslony),
    medianaStron: licznosc(przeglad.mediana_stron),
    sredniaStron: licznosc(przeglad.srednia_stron),
    medianaCzasMs: sekundyNaMs(przeglad.mediana_czas_s),
    p75CzasMs: sekundyNaMs(przeglad.p75_czas_s),
    zaangazowane,
    zaangazowanePct: procentOd(zaangazowane, sesje),
    jednostronicowe,
    jednostronicowePct: procentOd(jednostronicowe, sesje),
  }
}

// ── Przejścia ekran → ekran ───────────────────────────────────────────────────────────────

/** Cel „koniec wizyty”: pełnoprawny cel przejścia, nie brak danych. */
export const WYJSCIE = '(wyjście)'
const BRAK = '(brak)'
const TEN_SAM_EKRAN = ' (ten sam ekran)'

/** Wiersz celu w kształcie `WierszTop` (`klucz`, `etykieta`, `wartosc`) plus znaczniki do testów. */
export interface CelPrzejscia {
  klucz: string
  etykieta: string
  wartosc: number
  /** Cel to koniec wizyty. */
  wyjscie: boolean
  /** Cel to ten sam ekran co źródło (np. przejście z karty adresu na kartę innego adresu). */
  tenSamEkran: boolean
}

export interface GrupaPrzejsc {
  /** Klucz ekranu źródłowego (tekst z bazy). */
  skad: string
  etykieta: string
  /** Wszystkie przejścia z tego ekranu: 100% udziałów w jego tabeli. */
  razem: number
  /** Cele malejąco wg liczby przejść. */
  cele: CelPrzejscia[]
}

export interface WynikGrupowania {
  /** Ekrany źródłowe malejąco wg liczby przejść, przycięte do `maksEkranow`. */
  grupy: GrupaPrzejsc[]
  /** Ile różnych ekranów źródłowych było w odpowiedzi (przed przycięciem). */
  ekranow: number
  /** Suma wszystkich przejść w odpowiedzi. */
  lacznie: number
}

/**
 * Grupuje przejścia po ekranie źródłowym. Każda grupa to osobna całość: `razem` jest sumą jej
 * przejść, a udział celu liczy się od niej. Powtórzona para (skąd, dokąd) jest sumowana, wiersze o
 * liczbie niepoprawnej lub zerowej pomijane (przejście, którego nie było, nie jest wierszem).
 * Przycięcie do `maksEkranow` dotyczy tylko liczby tabel; w każdej zostają WSZYSTKIE cele, więc
 * suma udziałów w pokazanej tabeli domyka się do 100,0.
 */
export function grupujPrzejscia(
  wiersze: readonly WierszPrzejscia[],
  maksEkranow = 8,
): WynikGrupowania {
  const wgEkranu = new Map<string, Map<string, number>>()
  for (const w of wiersze) {
    const ile = licznosc(w.ile)
    if (ile === null || ile <= 0) continue
    const skad = tekstLubZastepczy(w.skad, BRAK)
    const dokad = tekstLubZastepczy(w.dokad, BRAK)
    let cele = wgEkranu.get(skad)
    if (!cele) {
      cele = new Map()
      wgEkranu.set(skad, cele)
    }
    cele.set(dokad, (cele.get(dokad) ?? 0) + ile)
  }

  const grupy = [...wgEkranu.entries()].map(([skad, cele]): GrupaPrzejsc => {
    const lista = [...cele.entries()]
      .map(([dokad, ile]): CelPrzejscia => {
        const wyjscie = dokad === WYJSCIE
        const tenSamEkran = !wyjscie && dokad === skad
        return {
          klucz: dokad,
          etykieta: wyjscie
            ? WYJSCIE
            : nazwa(NAZWA_EKRANU, dokad) + (tenSamEkran ? TEN_SAM_EKRAN : ''),
          wartosc: ile,
          wyjscie,
          tenSamEkran,
        }
      })
      .sort((a, b) => b.wartosc - a.wartosc || porownajTekst(a.klucz, b.klucz))
    return {
      skad,
      etykieta: nazwa(NAZWA_EKRANU, skad),
      razem: lista.reduce((suma, c) => suma + c.wartosc, 0),
      cele: lista,
    }
  })
  grupy.sort((a, b) => b.razem - a.razem || porownajTekst(a.skad, b.skad))

  return {
    grupy: grupy.slice(0, Math.max(0, Math.floor(maksEkranow))),
    ekranow: grupy.length,
    lacznie: grupy.reduce((suma, g) => suma + g.razem, 0),
  }
}

// ── Udostępnienia ─────────────────────────────────────────────────────────────────────────

/**
 * Sposoby, które kończą udostępnienie: link, kopiowanie, menu systemowe. „Anulowano” (otwarte i
 * zamknięte menu) i „błąd” nie są dokończeniem. Nieznany sposób liczy się jako próba, nie jako
 * dokończenie: odsetek jest podłogą, nie zawyżeniem.
 */
export const SPOSOBY_DOKONCZONE: readonly string[] = ['link', 'kopia', 'natywne']

/** Etykiety zastępcze z bazy (`analityka_panel_udostepnienia`). */
export const ELEMENT_BEZ_ZNACZNIKA = '(bez znacznika)'
export const SPOSOB_NIEZNANY = '(nieznany)'

interface PoprawneUdostepnienie {
  element: string
  sposob: string
  ile: number
}

function poprawneUdostepnienia(wiersze: readonly WierszUdostepnienia[]): PoprawneUdostepnienie[] {
  const wynik: PoprawneUdostepnienie[] = []
  for (const w of wiersze) {
    const ile = licznosc(w.ile)
    if (ile === null || ile <= 0) continue
    wynik.push({
      element: tekstLubZastepczy(w.element, ELEMENT_BEZ_ZNACZNIKA),
      sposob: tekstLubZastepczy(w.kanal, SPOSOB_NIEZNANY),
      ile,
    })
  }
  return wynik
}

/** Wszystkie próby udostępnienia w odpowiedzi (podstawa tabeli „według sposobu”). */
export function lacznieUdostepnien(wiersze: readonly WierszUdostepnienia[]): number {
  return poprawneUdostepnienia(wiersze).reduce((suma, w) => suma + w.ile, 0)
}

/** Wiersz w kształcie `WierszTop`. */
export interface WierszSposobu {
  klucz: string
  etykieta: string
  wartosc: number
}

/** Próby udostępnienia według sposobu, zsumowane po elementach. Malejąco wg liczby. */
export function udostepnieniaWgSposobu(wiersze: readonly WierszUdostepnienia[]): WierszSposobu[] {
  const mapa = new Map<string, number>()
  for (const w of poprawneUdostepnienia(wiersze)) {
    mapa.set(w.sposob, (mapa.get(w.sposob) ?? 0) + w.ile)
  }
  return [...mapa.entries()]
    .map(([klucz, wartosc]) => ({
      klucz,
      etykieta: nazwa(NAZWA_SPOSOBU_UDOSTEPNIENIA, klucz),
      wartosc,
    }))
    .sort((a, b) => b.wartosc - a.wartosc || porownajTekst(a.klucz, b.klucz))
}

export interface WierszElementu {
  klucz: string
  /** Etykieta elementu zapisana przez pomiar (tekst NIEZAUFANY). */
  element: string
  /** Wszystkie próby udostępnienia tego elementu: podstawa odsetka. */
  proby: number
  dokonczone: number
  /** % dokończeń od WSZYSTKICH prób tego elementu (więcej znaczy lepiej). */
  odsetekDokonczen: number | null
}

/**
 * Elementy z liczbą prób, dokończeń i odsetkiem dokończeń. Element, którego wszystkie próby
 * anulowano, ma odsetek 0,0% (zmierzone zero), a nie „brak danych”: próby były. Malejąco wg prób.
 */
export function udostepnieniaWgElementu(wiersze: readonly WierszUdostepnienia[]): WierszElementu[] {
  const mapa = new Map<string, { proby: number; dokonczone: number }>()
  for (const w of poprawneUdostepnienia(wiersze)) {
    const suma = mapa.get(w.element) ?? { proby: 0, dokonczone: 0 }
    suma.proby += w.ile
    if (SPOSOBY_DOKONCZONE.includes(w.sposob)) suma.dokonczone += w.ile
    mapa.set(w.element, suma)
  }
  return [...mapa.entries()]
    .map(
      ([element, suma]): WierszElementu => ({
        klucz: element,
        element,
        proby: suma.proby,
        dokonczone: suma.dokonczone,
        odsetekDokonczen: procentOd(suma.dokonczone, suma.proby),
      }),
    )
    .sort((a, b) => b.proby - a.proby || porownajTekst(a.element, b.element))
}
