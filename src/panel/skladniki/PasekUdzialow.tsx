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
//
// JEDNOSTKA W PODPISIE MA ODMIANĘ. „100% = 22 odsłon” to błąd, który wraca przy każdej nowej
// kopii podpisu, więc `jednostka` przyjmuje trzy formy rzeczownika (`JEDNOSTKI` z `arytmetyka.ts`:
// 1 odsłona, 2 odsłony, 5 odsłon) i wybiera właściwą dla podstawy. Sam napis działa jak dawniej
// (wstawiany bez zmian), ale po liczebniku bywa błędny, więc nowy kod podaje formy.
//
// LICZBY W LEGENDZIE MOŻNA UKRYĆ (`bezLiczb`). Gdy jedna z części paska stoi w tym samym kadrze jako
// osobna liczba (kafel „Odsłony (24 h)” obok paska ludzie i boty), legenda z jej wartością
// pokazałaby tę samą liczbę dwa razy. Wtedy legenda niesie nazwę i procent, a liczbę całości (której
// nie ma nigdzie indziej, bo jest sumą części) podaje podpis pod paskiem.
import {
  czyLiczba,
  type FormyLiczebnika,
  formatLiczby,
  formatProcent,
  liczbaZRzeczownikiem,
  udzialy,
} from '@/panel/arytmetyka'
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

/** Liczba z jednostką w poprawnej formie; sam napis (dopełniacz l. mnogiej) idzie bez odmiany. */
function liczbaZJednostka(liczba: number, jednostka: string | FormyLiczebnika): string {
  return typeof jednostka === 'string'
    ? `${formatLiczby(liczba)} ${jednostka}`
    : liczbaZRzeczownikiem(liczba, jednostka)
}

export function PasekUdzialow({
  segmenty,
  jednostka,
  opis,
  bezLiczb,
}: {
  segmenty: readonly SegmentUdzialu[]
  /**
   * Czego dotyczą liczby; trafia do podpisu podstawy. Najlepiej trzy formy z `JEDNOSTKI`
   * (`arytmetyka.ts`): podpis odmienia je przez liczbę („1 wizyta”, „22 wizyty”, „25 wizyt”). Sam
   * napis w dopełniaczu liczby mnogiej („wizyt”) jest wstawiany bez zmian i dla 2–4 jest błędny.
   */
  jednostka: string | FormyLiczebnika
  /** Nazwa całego paska dla czytników ekranu, np. „Kanały wejścia, 7 dni”. */
  opis: string
  /**
   * Legenda bez liczb bezwzględnych (zostają nazwa i procent), a podpis pod paskiem podaje podstawę
   * i wymienia sumowane pozycje. Dla paska, którego część już stoi w kadrze jako osobna liczba.
   */
  bezLiczb?: boolean
}) {
  const procenty = udzialy(segmenty, 'wartosc')
  const podstawa = segmenty.reduce<number>(
    (s, x) => s + (czyLiczba(x.wartosc) && x.wartosc >= 0 ? x.wartosc : 0),
    0,
  )
  if (!(podstawa > 0)) {
    return <BrakDanych wariant="blok" opis={`${opis}: w tym okresie nie było ruchu do podziału.`} />
  }

  const razem = liczbaZJednostka(podstawa, jednostka)
  const opisPaska = `${opis}. ${segmenty
    .map((x, i) => `${x.etykieta} ${formatProcent(procenty[i] ?? null)}`)
    .join(', ')}. Razem ${razem}.`
  const sumowane = bezLiczb ? `suma: ${segmenty.map((x) => x.etykieta).join(' + ')}` : null

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
              // Najechanie podaje wartość także przy `bezLiczb`: to dymek myszy, nie stały napis w kadrze.
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
            {bezLiczb ? null : (
              <span className="panel-legenda-liczba">{formatLiczby(x.wartosc)}</span>
            )}
            <span className="panel-legenda-procent">{formatProcent(procenty[i] ?? null)}</span>
          </li>
        ))}
      </ul>
      <p className="panel-udzialy-podstawa">
        100% = {razem} łącznie ({sumowane ?? 'suma wszystkich pozycji'}).
      </p>
    </div>
  )
}
