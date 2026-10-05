// Układ danych zakładki „CTA” (T059): klikalność sekcji, martwe przyciski, sygnały UX. Czyste funkcje,
// bez DOM i bez aliasu `@/` (test na gołym `node --test`); komponent (`Cta.tsx`) tylko je woła i
// rysuje.
//
// Zasady, które tu żyją (CLAUDE.md „Liczby na ekranie”):
//  - KLIKALNOŚĆ TO STAWKA, NIE UDZIAŁ: kliknięcia / wyświetlenia przycisku. Wiersze nie są częściami
//    jednej całości, więc kolumna nie sumuje się do 100% i nie przechodzi przez `udzialy`. Mianownik
//    to wyświetlenia PRZYCISKU, nie odsłony strony: przycisk w stopce widać rzadziej niż ten w
//    nagłówku, a dzielenie obu przez odsłony kazałoby stopce wyglądać na martwą (hasło `cta.klikalnosc`).
//  - Zbiorcza klikalność ekranu liczy się z SUM (Σ kliknięć / Σ wyświetleń), nie jako średnia z
//    wierszowych procentów: średnia dałaby miejscu z trzema wyświetleniami wagę miejsca z tysiącem.
//  - Dzielenie tylko przy DODATNIM mianowniku; zero wyświetleń lub odsłon to `null` („brak danych”).
//  - Wskaźniki UX są na 1000 odsłon danego EKRANU, bo liczba bezwzględna stawiałaby na czele
//    najpopularniejszy ekran. Łącznego wskaźnika dla całego serwisu NIE liczymy: baza podaje odsłony
//    tylko dla ekranów, na których wystąpił sygnał, więc suma mianowników byłaby zaniżona, a wynik
//    zawyżony.
import { czyLiczba, formatLiczby, procentOd, zaokraglij } from '../arytmetyka.ts'
import type { WierszCtaMartwego, WierszCtaSekcji, WierszSygnaluUx } from '../typy.ts'

/**
 * Próg „martwego przycisku” i „małej próby”: co najmniej 50 wyświetleń. Poniżej procent z kilku
 * sztuk to przypadek (hasło `cta.martwe`: „próg 50 wyświetleń chroni przed wnioskami z przypadku”).
 * Ta sama stała idzie do bazy jako `p_min` i do podpisu na ekranie, więc obie liczby się nie rozjadą.
 */
export const MIN_WYSWIETLEN = 50

// ── Klikalność sekcji ─────────────────────────────────────────────────────────────────────

export interface WierszKlikalnosci {
  klucz: string
  sekcja: string
  wyswietlenia: number
  klikniecia: number
  /** Kliknięcia / wyświetlenia w procentach; `null`, gdy sekcja nie ma wyświetleń. Może przekroczyć 100. */
  klikalnosc: number | null
  /** Mniej niż `MIN_WYSWIETLEN` wyświetleń: procent nie nadaje się do porównań. */
  malaProba: boolean
}

export interface KlikalnoscEkranu {
  wiersze: WierszKlikalnosci[]
  /**
   * Suma sekcji ekranu i klikalność z SUM (nie średnia z procentów). `malaProba` jak przy sekcji:
   * mniej niż `MIN_WYSWIETLEN` wyświetleń w sumie.
   */
  razem: {
    wyswietlenia: number
    klikniecia: number
    klikalnosc: number | null
    malaProba: boolean
  }
}

function liczebnosc(wartosc: number | null | undefined): number {
  return czyLiczba(wartosc) && wartosc >= 0 ? wartosc : 0
}

/**
 * Klikalność sekcji jednego ekranu. Kolejność: najpierw sekcje z wiarygodną próbą (co najmniej
 * `MIN_WYSWIETLEN` wyświetleń) od najwyższej klikalności, potem „mała próba” wg wyświetleń, żeby
 * 100% z dwóch wyświetleń nie otwierało rankingu.
 */
export function klikalnoscSekcji(
  wiersze: readonly WierszCtaSekcji[],
  ekran: string,
): KlikalnoscEkranu {
  const sekcje: WierszKlikalnosci[] = wiersze
    .filter((w) => w.ekran === ekran)
    .map((w, i) => {
      const wyswietlenia = liczebnosc(w.wyswietlenia)
      const klikniecia = liczebnosc(w.klikniecia)
      return {
        klucz: `${w.ekran}§${w.sekcja}§${i}`,
        sekcja: String(w.sekcja),
        wyswietlenia,
        klikniecia,
        klikalnosc: procentOd(klikniecia, wyswietlenia),
        malaProba: wyswietlenia < MIN_WYSWIETLEN,
      }
    })
  sekcje.sort((a, b) => {
    if (a.malaProba !== b.malaProba) return a.malaProba ? 1 : -1
    if (!a.malaProba) {
      const roznica = (b.klikalnosc ?? -1) - (a.klikalnosc ?? -1)
      if (roznica !== 0) return roznica
    }
    return b.wyswietlenia - a.wyswietlenia || a.sekcja.localeCompare(b.sekcja, 'pl')
  })
  const wyswietlenia = sekcje.reduce((suma, s) => suma + s.wyswietlenia, 0)
  const klikniecia = sekcje.reduce((suma, s) => suma + s.klikniecia, 0)
  return {
    wiersze: sekcje,
    razem: {
      wyswietlenia,
      klikniecia,
      klikalnosc: procentOd(klikniecia, wyswietlenia),
      malaProba: wyswietlenia < MIN_WYSWIETLEN,
    },
  }
}

// ── Martwe przyciski ──────────────────────────────────────────────────────────────────────

export interface WierszMartwy {
  klucz: string
  ekran: string
  sekcja: string
  cel: string
  wyswietlenia: number
}

/**
 * Martwe przyciski od najczęściej wyświetlanych (stabilnie: remis zostaje w kolejności z bazy).
 * Próg `MIN_WYSWIETLEN` egzekwuje baza (`p_min`); tu odpadają tylko wiersze o niepoprawnej liczbie.
 */
export function martwePrzyciski(wiersze: readonly WierszCtaMartwego[]): WierszMartwy[] {
  const wynik: WierszMartwy[] = []
  wiersze.forEach((w, i) => {
    if (!czyLiczba(w.wyswietlenia) || w.wyswietlenia < 0) return
    wynik.push({
      klucz: `${w.ekran}§${w.sekcja}§${w.cel}§${i}`,
      ekran: String(w.ekran),
      sekcja: String(w.sekcja),
      cel: String(w.cel),
      wyswietlenia: w.wyswietlenia,
    })
  })
  return wynik.sort((a, b) => b.wyswietlenia - a.wyswietlenia)
}

// ── Sygnały UX ────────────────────────────────────────────────────────────────────────────

export const RODZAJ_FURII = 'furia'
export const RODZAJ_MARTWEGO_KLIKU = 'martwy'

/**
 * Liczba zdarzeń na 1000 odsłon. `null`, gdy nie ma odsłon (mianownik ≤ 0 albo brak), gdy licznik
 * jest niepoprawny albo ujemny: dzielenie bez dodatniego mianownika nie daje wyniku.
 */
export function naTysiac(
  ile: number | null | undefined,
  odslony: number | null | undefined,
  miejsca = 1,
): number | null {
  if (!czyLiczba(ile) || !czyLiczba(odslony) || ile < 0 || odslony <= 0) return null
  return zaokraglij((ile * 1000) / odslony, miejsca)
}

/**
 * „1 zdarzenie”, „2 zdarzenia”, „5 zdarzeń”, „12 zdarzeń”, „22 zdarzenia”: polska odmiana przy
 * liczbie (pełna liczba z separatorem tysięcy). Dla wartości niecałkowitych bierze część całkowitą.
 */
export function liczbaZdarzen(ile: number): string {
  const n = Math.abs(Math.trunc(ile))
  const setki = n % 100
  const jednosci = n % 10
  const forma =
    n === 1
      ? 'zdarzenie'
      : jednosci >= 2 && jednosci <= 4 && !(setki >= 12 && setki <= 14)
        ? 'zdarzenia'
        : 'zdarzeń'
  return `${formatLiczby(n)} ${forma}`
}

export interface WartoscSygnalu {
  ile: number
  /** Na 1000 odsłon ekranu; `null`, gdy ekran nie ma policzonych odsłon. */
  na1000: number | null
}

export interface WierszSygnalow {
  ekran: string
  /** Odsłony ekranu w oknie (mianownik); `null`, gdy baza ich nie podała. */
  odslony: number | null
  furia: WartoscSygnalu
  martwy: WartoscSygnalu
  /** Oba sygnały razem (ten sam mianownik, więc wskaźniki się sumują). */
  razem: WartoscSygnalu
}

/**
 * Sygnały UX po ekranach: baza daje wiersz na parę (ekran, rodzaj), a tu składamy z nich jeden
 * wiersz na ekran. Rodzaj, którego baza nie zwróciła dla ekranu z mianownikiem, to ZMIERZONE zero
 * (baza zwraca każdy rodzaj, który wystąpił choć raz), więc ma 0 na 1000, a nie „brak danych”.
 * Ekrany: od największego łącznego wskaźnika, dalej od największego ruchu.
 */
export function sygnalyUx(wiersze: readonly WierszSygnaluUx[]): WierszSygnalow[] {
  const grupy = new Map<string, { odslony: number | null; furia: number; martwy: number }>()
  for (const w of wiersze) {
    // Rodzaj spoza dwóch znanych nie wchodzi do zestawienia: baza zwraca tylko te dwa, a nieznany
    // wiersz nie ma kolumny, w której dałoby się go pokazać.
    if (w.rodzaj !== RODZAJ_FURII && w.rodzaj !== RODZAJ_MARTWEGO_KLIKU) continue
    // Ekran jako tekst: odpowiedź z sieci nie jest zaufana, a sortowanie niżej woła localeCompare.
    const ekran = String(w.ekran)
    const grupa = grupy.get(ekran) ?? { odslony: null, furia: 0, martwy: 0 }
    if (czyLiczba(w.odslony_ekranu) && w.odslony_ekranu >= 0) {
      grupa.odslony =
        grupa.odslony === null ? w.odslony_ekranu : Math.max(grupa.odslony, w.odslony_ekranu)
    }
    if (w.rodzaj === RODZAJ_FURII) grupa.furia += liczebnosc(w.ile)
    else grupa.martwy += liczebnosc(w.ile)
    grupy.set(ekran, grupa)
  }
  const wartosc = (ile: number, odslony: number | null): WartoscSygnalu => ({
    ile,
    na1000: naTysiac(ile, odslony),
  })
  return [...grupy.entries()]
    .map(([ekran, g]) => ({
      ekran,
      odslony: g.odslony,
      furia: wartosc(g.furia, g.odslony),
      martwy: wartosc(g.martwy, g.odslony),
      razem: wartosc(g.furia + g.martwy, g.odslony),
    }))
    .sort(
      (a, b) =>
        (b.razem.na1000 ?? -1) - (a.razem.na1000 ?? -1) ||
        (b.odslony ?? 0) - (a.odslony ?? 0) ||
        a.ekran.localeCompare(b.ekran, 'pl'),
    )
}
