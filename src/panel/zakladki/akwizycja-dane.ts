// Czysta logika zakładki „Akwizycja” (T056, FR-031): układ odpowiedzi RPC na segmenty paska i wiersze
// tabel. Bez React, bez DOM i bez aliasu `@/`, żeby dało się ją objąć testem na gołym `node --test`
// (`akwizycja-dane.test.ts`); `Akwizycja.tsx` tylko to rysuje. Moduł jest też źródłem wyboru okresu
// 7/30 dni, wspólnego dla zakładek Akwizycja i Sesje (`sesje-dane.ts` importuje go stąd, zamiast
// trzymać drugą kopię listy okresów).
//
// Zasady, które siedzą tutaj, a nie w komponencie (CLAUDE.md „Liczby na ekranie”):
//  - podstawą udziału jest SUMA całości, nigdy największa pozycja: segmenty jednej całości dają 100,0
//    (metoda największej reszty z `arytmetyka.udzialy`), a pilnuje tego test inwariantu;
//  - lista przycięta do N pozycji (źródła, kraje) liczy udział od PRAWDZIWEJ całości okresu, nie od
//    sumy widocznych wierszy: inaczej ostatni wiersz wyglądałby na całość;
//  - brak pomiaru to `null` (szary „brak danych”), nigdy 0. Za to znany kanał bez wizyt w okresie, w
//    którym wizyty były, to prawdziwe 0 i legenda paska go pokazuje;
//  - „(nieznany)” (kraj bez nagłówka hostingu) jest osobną pozycją i nie wchodzi do przyciętej reszty;
//  - tekst z bazy (źródło, host, kampania) jest niezaufany: tu dostaje wyłącznie etykietę, a komponent
//    wstawia go jako treść React. Odsyłacze (host + ścieżka) NIE są linkami: `linkDoSerwisu` przyjmuje
//    tylko ścieżki w obrębie serwisu, a zewnętrzny adres z bazy mógłby wskazywać cokolwiek.
import { czyLiczba, procentOd, udzialy, zaokraglij } from '../arytmetyka.ts'
import type { KolorDanych } from '../kolory.ts'
import { KOLEJNOSC_KANALOW, NAZWA_KANALU, NAZWA_URZADZENIA, nazwa, SLOT_KANALU } from '../nazwy.ts'
import type {
  KanalRuchu,
  WierszKampanii,
  WierszKanalu,
  WierszKraju,
  WierszUrzadzenia,
  WierszZrodla,
} from '../typy.ts'

// ── Okres ─────────────────────────────────────────────────────────────────────────────────

/** Okresy do wyboru (doby warszawskie). Baza przycina `p_dni` do 30 dla surowych zdarzeń. */
export const OKNA_DNI = [7, 30] as const
export type OknoDni = (typeof OKNA_DNI)[number]
/** Domyślnie 7 dni: tyle samo, co domyślne okno funkcji `admin_kanaly`, `admin_zrodla` i reszty. */
export const OKNO_DOMYSLNE: OknoDni = 7

/**
 * Opis okresu pod przełącznikiem. Okno to ostatnie `dni` DÓB WARSZAWSKICH razem z dzisiejszą (nie
 * „teraz − N × 24 h”), więc dzisiejsza doba jest niepełna i kolejne wejście pokaże nieco więcej.
 */
export function opisOkna(dni: number): string {
  return `Ostatnie ${dni} dób warszawskich, razem z dzisiejszą (jeszcze niepełną).`
}

// ── Pomocnicze ────────────────────────────────────────────────────────────────────────────

/** Liczność nadająca się do sumy: skończona i nieujemna. Inaczej `null` (błąd danych, nie zero). */
function licznosc(wartosc: unknown): number | null {
  return czyLiczba(wartosc) && wartosc >= 0 ? wartosc : null
}

/** Tekst z bazy albo `zastepczy`, gdy go brak (null, pusty, same spacje). Wartość wraca bez zmian. */
function tekstLubZastepczy(wartosc: unknown, zastepczy: string): string {
  return typeof wartosc === 'string' && wartosc.trim() !== '' ? wartosc : zastepczy
}

/** Suma z pominięciem błędnych liczb; `null`, dopóki nie trafił się żaden poprawny składnik. */
function dodaj(dotychczas: number | null | undefined, skladnik: number | null): number | null {
  if (skladnik === null) return dotychczas ?? null
  return (dotychczas ?? 0) + skladnik
}

function porownajTekst(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Malejąco wg wizyt, puste na końcu. `sort` jest stabilny, więc remis zostaje w kolejności z bazy. */
function malejacoWgWizyt<T extends { wizyty: number | null }>(a: T, b: T): number {
  return (b.wizyty ?? -1) - (a.wizyty ?? -1)
}

/** Suma wizyt wszystkich wierszy (błędne liczby pominięte). To podstawa udziału „z całości okresu”. */
export function sumaWizyt(wiersze: readonly { wizyty: number }[]): number {
  return wiersze.reduce((suma, w) => suma + (licznosc(w.wizyty) ?? 0), 0)
}

function znanyKanal(kanal: string): kanal is KanalRuchu {
  return Object.hasOwn(NAZWA_KANALU, kanal)
}

function etykietaKanalu(kanal: string): string {
  return znanyKanal(kanal) ? NAZWA_KANALU[kanal] : kanal
}

/** Kolor idzie za kanałem (slot stały), a kanał nieznany frontowi dostaje szarość „inne”. */
function kolorKanalu(kanal: string): KolorDanych {
  return znanyKanal(kanal) ? SLOT_KANALU[kanal] : 'szary'
}

// ── Kanały ────────────────────────────────────────────────────────────────────────────────

export interface SegmentKanalu {
  klucz: string
  etykieta: string
  /** Wizyty kanału. `null`: baza zwróciła niepoprawną liczbę (nie wchodzi do podstawy udziału). */
  wartosc: number | null
  kolor: KolorDanych
}

interface SumaKanalu {
  wizyty: number | null
  odslony: number | null
}

/** Wiersze po kanałach; powtórzony kanał (nie powinien się zdarzyć) jest sumowany, nie gubiony. */
function sumujKanaly(wiersze: readonly WierszKanalu[]): Map<string, SumaKanalu> {
  const mapa = new Map<string, SumaKanalu>()
  for (const w of wiersze) {
    const klucz = tekstLubZastepczy(w.kanal, '(brak)')
    const poprzednia = mapa.get(klucz)
    mapa.set(klucz, {
      wizyty: dodaj(poprzednia?.wizyty, licznosc(w.wizyty)),
      odslony: dodaj(poprzednia?.odslony, licznosc(w.odslony)),
    })
  }
  return mapa
}

/**
 * Kanały, których front jeszcze nie zna: wiersz z bazy musi być widoczny, inaczej liczby przestałyby
 * się sumować bez śladu dlaczego. Malejąco wg wizyt, remis alfabetycznie (deterministycznie).
 */
function kanalyNieznane(mapa: ReadonlyMap<string, SumaKanalu>): string[] {
  return [...mapa.keys()]
    .filter((k) => !znanyKanal(k))
    .sort(
      (a, b) => (mapa.get(b)?.wizyty ?? -1) - (mapa.get(a)?.wizyty ?? -1) || porownajTekst(a, b),
    )
}

/**
 * Segmenty paska „Kanały wejścia”: znane kanały zawsze w stałej kolejności `KOLEJNOSC_KANALOW` (legenda
 * nie przeskakuje po zmianie okresu), kanał bez wizyt jako prawdziwe 0, na końcu kanały nieznane
 * frontowi w szarości. Wyjątek: „wewnętrzne” nie jest wejściem (baza liczy taką wizytę jako
 * bezpośrednią), więc pojawia się tylko wtedy, gdy baza je zwróciła z wizytami.
 */
export function segmentyKanalow(wiersze: readonly WierszKanalu[]): SegmentKanalu[] {
  const mapa = sumujKanaly(wiersze)
  const segmenty: SegmentKanalu[] = []
  for (const kanal of KOLEJNOSC_KANALOW) {
    const suma = mapa.get(kanal)
    if (kanal === 'wewnetrzne' && !((suma?.wizyty ?? 0) > 0)) continue
    segmenty.push({
      klucz: kanal,
      etykieta: NAZWA_KANALU[kanal],
      wartosc: suma === undefined ? 0 : suma.wizyty,
      kolor: SLOT_KANALU[kanal],
    })
  }
  for (const kanal of kanalyNieznane(mapa)) {
    segmenty.push({
      klucz: kanal,
      etykieta: kanal,
      wartosc: mapa.get(kanal)?.wizyty ?? null,
      kolor: 'szary',
    })
  }
  return segmenty
}

export interface WierszOdslonKanalu {
  klucz: string
  etykieta: string
  kolor: KolorDanych
  wizyty: number
  odslony: number | null
  /** Odsłony ÷ wizyty kanału, jedno miejsce po przecinku. `null` bez poprawnej liczby odsłon. */
  odslonNaWizyte: number | null
}

/**
 * Tabela „odsłony wizyt według kanału”: tylko kanały z wizytami (kanał bez wizyt nie ma głębokości,
 * a jego zero jest już w legendzie paska), w kolejności paska. `odslony` bazy to wszystkie odsłony
 * sesji kanału, nie tylko pierwsze, więc iloraz mówi o głębokości wizyty, nie o jej jakości.
 */
export function wierszeOdslonKanalow(wiersze: readonly WierszKanalu[]): WierszOdslonKanalu[] {
  const mapa = sumujKanaly(wiersze)
  const wynik: WierszOdslonKanalu[] = []
  for (const klucz of [...KOLEJNOSC_KANALOW, ...kanalyNieznane(mapa)]) {
    const suma = mapa.get(klucz)
    const wizyty = suma?.wizyty ?? null
    if (suma === undefined || wizyty === null || wizyty <= 0) continue
    wynik.push({
      klucz,
      etykieta: etykietaKanalu(klucz),
      kolor: kolorKanalu(klucz),
      wizyty,
      odslony: suma.odslony,
      odslonNaWizyte: suma.odslony === null ? null : zaokraglij(suma.odslony / wizyty, 1),
    })
  }
  return wynik
}

// ── Źródła ────────────────────────────────────────────────────────────────────────────────

/** Etykiety zastępcze z bazy (`analityka_panel_wizyty`); null z kontraktu traktujemy tak samo. */
export const ZRODLO_BEZPOSREDNIE = '(bezpośrednie)'
const SCIEZKA_BRAK = '(brak)'

export interface WierszZrodlaUI {
  klucz: string
  kanal: string
  etykietaKanalu: string
  kolor: KolorDanych
  /** Host referera, `utm_source` albo nazwa identyfikatora kliknięcia (tekst NIEZAUFANY). */
  zrodlo: string
  /** Ścieżka referera (tekst NIEZAUFANY); `null`, gdy jej nie zapisano. */
  sciezka: string | null
  wizyty: number | null
  /** % od `lacznieWizyt`; `null` bez poprawnej całości (nie 0%). */
  udzial: number | null
}

/**
 * Wiersze tabeli źródeł. Lista z bazy jest PRZYCIĘTA do najliczniejszych (`p_limit`), więc udział
 * liczymy od `lacznieWizyt`, czyli od wszystkich wizyt okresu (suma kanałów), a nie od sumy widocznych
 * wierszy. `lacznieWizyt` ≤ 0 albo `null` → udział `null`, bez dzielenia przez zero.
 */
export function wierszeZrodel(
  wiersze: readonly WierszZrodla[],
  lacznieWizyt: number | null,
): WierszZrodlaUI[] {
  const lista = wiersze.map((w, i): WierszZrodlaUI => {
    const kanal = tekstLubZastepczy(w.kanal, '(brak)')
    const zrodlo = tekstLubZastepczy(w.zrodlo, ZRODLO_BEZPOSREDNIE)
    const sciezkaTekst = tekstLubZastepczy(w.sciezka, SCIEZKA_BRAK)
    const sciezka = sciezkaTekst === SCIEZKA_BRAK ? null : sciezkaTekst
    const wizyty = licznosc(w.wizyty)
    return {
      klucz: `${i}|${kanal}|${zrodlo}|${sciezka ?? ''}`,
      kanal,
      etykietaKanalu: etykietaKanalu(kanal),
      kolor: kolorKanalu(kanal),
      zrodlo,
      sciezka,
      wizyty,
      udzial: procentOd(wizyty, lacznieWizyt),
    }
  })
  return lista.sort(malejacoWgWizyt)
}

// ── Kampanie UTM ──────────────────────────────────────────────────────────────────────────

export const UTM_BRAK = '(brak)'

export interface WierszKampaniiUI {
  klucz: string
  zrodlo: string
  medium: string
  kampania: string
  wizyty: number | null
  /** % od sumy wizyt z listy (lista = wszystkie wizyty ze znacznikami UTM); `null` bez podstawy. */
  udzial: number | null
}

/**
 * Wiersze tabeli kampanii. Lista obejmuje WYŁĄCZNIE wizyty ze znacznikami UTM, więc jej suma jest
 * całością, o którą pytamy („która kampania ile z wizyt kampanijnych”), i od niej liczy się udział
 * (`udzialy`: segmenty dają 100,0). Wizyty bez UTM są poza listą, co mówi podpis pod tabelą.
 */
export function wierszeKampanii(wiersze: readonly WierszKampanii[]): WierszKampaniiUI[] {
  const lista = wiersze
    .map((w, i) => ({
      klucz: `${i}|${w.utm_source}|${w.utm_medium}|${w.utm_campaign}`,
      zrodlo: tekstLubZastepczy(w.utm_source, UTM_BRAK),
      medium: tekstLubZastepczy(w.utm_medium, UTM_BRAK),
      kampania: tekstLubZastepczy(w.utm_campaign, UTM_BRAK),
      wizyty: licznosc(w.wizyty),
    }))
    .sort(malejacoWgWizyt)
  const procenty = udzialy(lista, 'wizyty')
  return lista.map((w, i) => ({ ...w, udzial: procenty[i] ?? null }))
}

// ── Kraje ─────────────────────────────────────────────────────────────────────────────────

/** Kraj bez nagłówka hostingu: osobna pozycja (brak wiedzy), nie zero i nie „reszta”. */
export const KRAJ_NIEZNANY = '(nieznany)'

const NAZWY_REGIONOW: Intl.DisplayNames | null = (() => {
  try {
    return new Intl.DisplayNames(['pl'], { type: 'region', fallback: 'code' })
  } catch {
    return null
  }
})()

/**
 * Nazwa kraju z kodu ISO: „Polska (PL)”. Kod zostaje w nawiasie, bo to on jest w bazie. Kod
 * nierozpoznany (`XX`, brak danych ICU) i „(nieznany)” wracają bez zmian.
 */
export function nazwaKraju(kod: string): string {
  if (!/^[A-Z]{2}$/.test(kod)) return kod
  let pelna: string | undefined
  try {
    pelna = NAZWY_REGIONOW?.of(kod)
  } catch {
    pelna = undefined
  }
  return pelna && pelna !== kod ? `${pelna} (${kod})` : kod
}

export interface WierszKrajuUI {
  klucz: string
  kod: string
  etykieta: string
  wartosc: number | null
}

export interface CzolowkaKrajow {
  /** `ile` najliczniejszych krajów plus „(nieznany)”, jeśli nie mieści się wśród nich. */
  wiersze: WierszKrajuUI[]
  /** Wizyty ze WSZYSTKICH krajów, także niepokazanych: prawdziwa całość okresu. */
  lacznie: number
  /** Ile różnych pozycji (krajów i „(nieznany)”) zwróciła baza. */
  pozycji: number
  /** Ile pozycji nie weszło do `wiersze`. */
  pominietych: number
  /** Wizyty z pominiętych pozycji (ogon), żeby podpis pod tabelą mówił, ile ona ukrywa. */
  wizytyPominietych: number
}

/**
 * Czołówka krajów do tabeli. Lista z bazy ma ogon (kilkadziesiąt krajów po jednej wizycie), więc
 * pokazujemy `ile` najliczniejszych, a udział liczymy od `lacznie` (całość okresu). „(nieznany)” jest
 * zawsze osobną pozycją: brak nagłówka kraju to brak wiedzy, której nie wolno wchłonąć do ogona.
 */
export function czolowkaKrajow(wiersze: readonly WierszKraju[], ile: number): CzolowkaKrajow {
  const mapa = new Map<string, number | null>()
  for (const w of wiersze) {
    const kod = tekstLubZastepczy(w.kraj, KRAJ_NIEZNANY).trim()
    mapa.set(kod, dodaj(mapa.get(kod), licznosc(w.wizyty)))
  }
  const wszystkie = [...mapa.entries()]
    .map(
      ([kod, wartosc]): WierszKrajuUI => ({
        klucz: kod,
        kod,
        etykieta: nazwaKraju(kod),
        wartosc,
      }),
    )
    .sort((a, b) => (b.wartosc ?? -1) - (a.wartosc ?? -1) || porownajTekst(a.kod, b.kod))

  const widoczne = wszystkie.slice(0, Math.max(0, Math.floor(ile)))
  const nieznany = wszystkie.find((w) => w.kod === KRAJ_NIEZNANY)
  if (nieznany && !widoczne.includes(nieznany)) widoczne.push(nieznany)

  const lacznie = wszystkie.reduce((suma, w) => suma + (w.wartosc ?? 0), 0)
  const wizytyWidocznych = widoczne.reduce((suma, w) => suma + (w.wartosc ?? 0), 0)
  return {
    wiersze: widoczne,
    lacznie,
    pozycji: wszystkie.length,
    pominietych: wszystkie.length - widoczne.length,
    wizytyPominietych: lacznie - wizytyWidocznych,
  }
}

// ── Urządzenia ────────────────────────────────────────────────────────────────────────────

export interface WierszUrzadzeniaUI {
  klucz: string
  etykieta: string
  wartosc: number | null
}

/** Urządzenia z polskimi nazwami (nieznana klasa wraca sama, powtórzona jest sumowana). */
export function wierszeUrzadzen(wiersze: readonly WierszUrzadzenia[]): WierszUrzadzeniaUI[] {
  const mapa = new Map<string, number | null>()
  for (const w of wiersze) {
    const klucz = tekstLubZastepczy(w.urzadzenie, '(brak)')
    mapa.set(klucz, dodaj(mapa.get(klucz), licznosc(w.wizyty)))
  }
  return [...mapa.entries()]
    .map(([klucz, wartosc]) => ({ klucz, etykieta: nazwa(NAZWA_URZADZENIA, klucz), wartosc }))
    .sort((a, b) => (b.wartosc ?? -1) - (a.wartosc ?? -1) || porownajTekst(a.klucz, b.klucz))
}
