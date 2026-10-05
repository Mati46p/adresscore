// Kafel statystyki: etykieta (z opcjonalną podpowiedzią), duża liczba i podpis.
//
// `wartosc` bywa liczbą (formatowaną tu jako PEŁNA liczba pl-PL) albo gotowym napisem (odsetek
// „42,9%”, czas „3 min 5 s”, data), którego nie ruszamy: napis niesie jednostkę i decyzję o
// zaokrągleniu, którą podjął wołający. Brak wartości (`null`, `undefined`, NaN) to szary stan
// „brak danych”, nigdy 0: zero oznacza „zmierzono i było zero”.
//
// Kafel nie ma wariantu „akcent”: akcent w panelu należy wyłącznie do stanu wybranego (zakładka,
// przełącznik). Wyróżnienie kafla kolorem czytałoby się jak „tu jesteś”.
import type { ReactNode } from 'react'
import { czyLiczba, formatLiczby } from '@/panel/arytmetyka'
import type { KluczHasla } from '@/panel/slownik'
import { BrakDanych } from './BrakDanych'
import { Podpowiedz } from './Podpowiedz'

interface KartaStatProps {
  etykieta: string
  /** Liczba (formatowana pełna), gotowy napis albo brak pomiaru. */
  wartosc: number | string | null | undefined
  /** Cyfry po przecinku dla wartości liczbowej (np. średnia 2,4 strony → 1). Domyślnie 0. */
  miejsca?: number
  /** Jedna linia pod liczbą: okno, podstawa procentu, skąd wynik. Nie powtarza liczby z kafla. */
  podpis?: ReactNode
  /**
   * Hasło ze słownika – dokłada znaczek z definicją i pułapką. Opcjonalne celowo: kafel, którego
   * liczba jest oczywista z nazwy, nie dostaje znaczka „dla równości”.
   */
  klucz?: KluczHasla
}

export function KartaStat({ etykieta, wartosc, miejsca, podpis, klucz }: KartaStatProps) {
  const brak = typeof wartosc === 'string' ? wartosc.trim() === '' : !czyLiczba(wartosc)
  return (
    <div className="panel-stat">
      {/* `div`, nie `p`: dymek podpowiedzi niesie własne elementy blokowe. */}
      <div className="panel-stat-etykieta">
        {etykieta}
        {klucz ? <Podpowiedz klucz={klucz} /> : null}
      </div>
      <div className="panel-stat-wartosc" data-brak={brak ? '' : undefined}>
        {brak ? (
          <BrakDanych />
        ) : typeof wartosc === 'number' ? (
          formatLiczby(wartosc, miejsca)
        ) : (
          wartosc
        )}
      </div>
      {podpis ? <div className="panel-stat-podpis">{podpis}</div> : null}
    </div>
  )
}
