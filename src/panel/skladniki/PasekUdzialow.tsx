// Pasek skumulowany: jeden tor, w którym segmenty sumują się do 100% CAŁOŚCI.
//
// DLACZEGO JEDEN, A NIE „LISTA PASKÓW” (lekcja z z-dykty): pasek skalowany do największej pozycji
// pokazuje udziały, które nie są udziałami, bo największa kategoria dostaje pełną długość i czyta
// się jako „to jest wszystko”. Tu podstawą jest SUMA segmentów, a procenty liczy `udzialy()`
// (metoda największej reszty), więc wypisane udziały domykają się do 100,0 i zgadzają z liczbą
// „z N łącznie” pod paskiem. Zła podstawa wymagałaby podania złej liczby, a nie przeoczenia w
// czwartej kopii pętli.
//
// Kolor jest TYLKO na wypełnieniu segmentu (i kropce w legendzie). Nazwa, liczba i procent stoją
// w kolorach tekstu, bo slot palety danych jest walidowany dla znaków (3:1), nie dla pisma (4,5:1).
// Legenda jest zawsze (tożsamość nie może zależeć od samego koloru) i pokazuje także segmenty o
// zerowej wartości. Segmenty rysuj w stałej kolejności slotów, żeby sąsiadowały tylko pary
// sprawdzone walidatorem palety (kolejność kanałów: `KOLEJNOSC_KANALOW` w `nazwy.ts`).
import { czyLiczba, formatLiczby, formatProcent, udzialy } from '@/panel/arytmetyka'
import { KOLOR_DANYCH, type KolorDanych } from '@/panel/kolory'
import { BrakDanych } from './BrakDanych'

export interface SegmentUdzialu {
  klucz: string
  etykieta: string
  /** Liczność segmentu. `null`/ujemna/NaN = brak pomiaru (nie wchodzi do podstawy). */
  wartosc: number | null
  /** Slot koloru przypisany BYTOWI (np. kanałowi), nie pozycji w rankingu. */
  kolor: KolorDanych
}

export function PasekUdzialow({
  segmenty,
  jednostka,
  opis,
}: {
  segmenty: readonly SegmentUdzialu[]
  /** Czego dotyczą liczby, w dopełniaczu liczby mnogiej: „wizyt”, „odsłon”. Trafia do podpisu podstawy. */
  jednostka: string
  /** Nazwa całego paska dla czytników ekranu, np. „Kanały wejścia, 7 dni”. */
  opis: string
}) {
  const procenty = udzialy(segmenty, 'wartosc')
  const podstawa = segmenty.reduce<number>(
    (s, x) => s + (czyLiczba(x.wartosc) && x.wartosc >= 0 ? x.wartosc : 0),
    0,
  )
  if (!(podstawa > 0)) {
    return <BrakDanych wariant="blok" opis={`${opis}: w tym okresie nie było ruchu do podziału.`} />
  }

  const opisPaska = `${opis}. ${segmenty
    .map((x, i) => `${x.etykieta} ${formatProcent(procenty[i] ?? null)}`)
    .join(', ')}. Razem ${formatLiczby(podstawa)} ${jednostka}.`

  return (
    <div className="panel-udzialy">
      <div className="panel-udzialy-tor" role="img" aria-label={opisPaska}>
        {segmenty.map((x, i) =>
          czyLiczba(x.wartosc) && x.wartosc > 0 ? (
            <span
              key={x.klucz}
              className="panel-udzialy-segment"
              // Szerokość wprost proporcjonalna do wartości (flex-grow), niezależnie od odstępów 2 px.
              style={{ flexGrow: x.wartosc, flexBasis: 0, background: KOLOR_DANYCH[x.kolor] }}
              title={`${x.etykieta}: ${formatLiczby(x.wartosc)} (${formatProcent(procenty[i] ?? null)})`}
              aria-hidden="true"
            />
          ) : null,
        )}
      </div>
      <ul className="panel-legenda">
        {segmenty.map((x, i) => (
          <li key={x.klucz}>
            <span
              className="panel-kropka"
              style={{ background: KOLOR_DANYCH[x.kolor] }}
              aria-hidden="true"
            />
            <span className="panel-legenda-nazwa" title={x.etykieta}>
              {x.etykieta}
            </span>
            <span className="panel-legenda-liczba">{formatLiczby(x.wartosc)}</span>
            <span className="panel-legenda-procent">{formatProcent(procenty[i] ?? null)}</span>
          </li>
        ))}
      </ul>
      <p className="panel-udzialy-podstawa">
        100% = {formatLiczby(podstawa)} {jednostka} łącznie (suma wszystkich pozycji).
      </p>
    </div>
  )
}
