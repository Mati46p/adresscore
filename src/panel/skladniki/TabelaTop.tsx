// Lista „top N”: pozycja, etykieta, PEŁNA liczba i (opcjonalnie) udział. Bez pasków tła
// skalowanych do największej pozycji: pasek, w którym największa pozycja ma pełną długość, czyta
// się jak „to jest wszystko” (dwa takie błędy w portfelu). Proporcję niesie kolumna udziału, a
// jej podstawa jest podpisana pod tabelą.
//
// Wiersze są sortowane tutaj, malejąco wg wartości (stabilnie, puste na końcu), żeby numer pozycji
// i strzałka w nagłówku mówiły prawdę niezależnie od kolejności, w jakiej przyszły dane.
//
// Podstawa udziału:
//  - bez `podstawa`: SUMA wierszy tej listy; udziały domyka do 100,0 `udzialy()` (lista kompletna),
//  - z `podstawa`: prawdziwa całość spoza listy (lista przycięta do N pozycji); udziały nie sumują
//    się wtedy do 100%, bo pokazujemy tylko część całości, i podpis mówi „z N łącznie”.
//
// Domyślne wartości propsów (`pozycje`, `jednostka`) są w ciele funkcji, nie w destrukturyzacji
// parametrów: React Compiler 1.0 z Babelem 8 nie kompiluje wtedy komponentu.
import type { ReactNode } from 'react'
import { czyLiczba, formatLiczby, formatProcent, procentOd, udzialy } from '@/panel/arytmetyka'
import type { KluczHasla } from '@/panel/slownik'
import { type KolumnaTabeli, Tabela } from './Tabela'

export interface WierszTop {
  klucz: string
  /** Etykieta pozycji; może być linkiem (np. do karty adresu). */
  etykieta: ReactNode
  /** Pełny tekst etykiety do dymka `title` (przy obciętych długich ścieżkach). */
  tytul?: string
  /** Liczność. `null` = brak pomiaru (szary „brak danych”). */
  wartosc: number | null
}

interface TabelaTopProps {
  wiersze: readonly WierszTop[]
  naglowekEtykiety: string
  naglowekWartosci: string
  /** Hasło ze słownika przy nagłówku wartości. */
  klucz?: KluczHasla
  /** Dołóż kolumnę udziału (podstawa: patrz nagłówek pliku). */
  udzial?: boolean
  /** Całość, od której liczymy udział, gdy lista jest tylko jej fragmentem. */
  podstawa?: number | null
  /** Jednostka podstawy w podpisie, np. „wizyt”. */
  jednostka?: string
  podpis?: string
  pusto?: ReactNode
  /** Numeruj pozycje (1., 2., …). Domyślnie tak. */
  pozycje?: boolean
}

export function TabelaTop({
  wiersze,
  naglowekEtykiety,
  naglowekWartosci,
  klucz,
  udzial,
  podstawa,
  jednostka,
  podpis,
  pusto,
  pozycje,
}: TabelaTopProps) {
  const posortowane = [...wiersze].sort(
    (a, b) => (czyLiczba(b.wartosc) ? b.wartosc : -1) - (czyLiczba(a.wartosc) ? a.wartosc : -1),
  )

  const zewnetrznaPodstawa = podstawa !== undefined
  const udzialyWierszy = !udzial
    ? []
    : zewnetrznaPodstawa
      ? posortowane.map((w) => procentOd(w.wartosc, podstawa))
      : udzialy(posortowane, 'wartosc')
  const sumaListy = posortowane.reduce<number>(
    (s, w) => s + (czyLiczba(w.wartosc) && w.wartosc >= 0 ? w.wartosc : 0),
    0,
  )
  const podstawaUdzialu = zewnetrznaPodstawa ? podstawa : sumaListy
  const jednostkaTekst = jednostka ? ` ${jednostka}` : ''

  const kolumny: KolumnaTabeli<WierszTop>[] = []
  if (pozycje !== false) {
    kolumny.push({ id: 'lp', naglowek: 'Poz.', komorka: (_w, i) => `${i + 1}.` })
  }
  kolumny.push(
    {
      id: 'etykieta',
      naglowek: naglowekEtykiety,
      naglowekWiersza: true,
      komorka: (w) => (
        <span className="panel-tabela-etykieta" title={w.tytul}>
          {w.etykieta}
        </span>
      ),
    },
    {
      id: 'wartosc',
      naglowek: naglowekWartosci,
      klucz,
      liczbowa: true,
      sortowana: 'malejaco',
      komorka: (w) => (czyLiczba(w.wartosc) ? formatLiczby(w.wartosc) : null),
    },
  )
  if (udzial) {
    kolumny.push({
      id: 'udzial',
      naglowek: 'Udział',
      liczbowa: true,
      komorka: (_w, i) => {
        const u = udzialyWierszy[i]
        return u === null || u === undefined ? null : formatProcent(u)
      },
    })
  }

  return (
    <div>
      <Tabela
        podpis={podpis}
        pusto={pusto}
        wiersze={posortowane}
        kluczWiersza={(w) => w.klucz}
        kolumny={kolumny}
      />
      {udzial && posortowane.length > 0 ? (
        <p className="panel-tabela-uwaga">
          {podstawaUdzialu !== null && podstawaUdzialu !== undefined && podstawaUdzialu > 0
            ? `Udział liczony od ${formatLiczby(podstawaUdzialu)}${jednostkaTekst} łącznie${
                zewnetrznaPodstawa
                  ? ' (całość okresu, lista pokazuje jej część)'
                  : ' (suma pozycji tej listy)'
              }.`
            : 'Udział: brak danych (suma równa zero).'}
        </p>
      ) : null}
    </div>
  )
}
