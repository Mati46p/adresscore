// Wykres dzienny: odsłony, unikalni i odsłony botów na dobę (doba warszawska). Przyjmuje GOTOWE
// wiersze – uzupełnienie dób bez wiersza (`null` przed pierwszym pomiarem) robi zakładka, np.
// przez `ciagDni` z `czas.ts`; wykres nie woła bazy.
//
// Unikalni z różnych dób nie sumują się do osób (odcisk rotuje o północy), dlatego pod wykresem
// stoi o tym uwaga, gdy seria unikalnych jest na wykresie.
import { etykietaDnia, pelnaDataDnia } from '@/panel/czas'
import { type KluczSerii, type OsCzasu, type PunktSerii, WykresSerii } from './WykresSerii'

export interface PunktDzienny {
  /** Doba warszawska `YYYY-MM-DD`. */
  dzien: string
  /** Odsłony ludzi. `null` = brak danych (przerwa w linii), 0 = faktycznie zero. */
  odslony: number | null
  /** Różne odciski ludzi w dobie. */
  unikalni: number | null
  /** Odsłony botów. */
  boty: number | null
}

const OS_DZIENNA: OsCzasu = {
  podpis: 'Doba (czas warszawski)',
  etykietaTicka: etykietaDnia,
  naglowekDymku: pelnaDataDnia,
  naglowekKolumnyTabeli: 'Doba',
}

const SERIE_DOMYSLNE: readonly KluczSerii[] = ['odslony', 'boty']

interface WykresDziennyProps {
  dane: readonly PunktDzienny[]
  /** Które serie narysować; domyślnie odsłony ludzi i odsłony botów. */
  serie?: readonly KluczSerii[]
  /** Nazwa wykresu; domyślnie „Ruch na dobę”. */
  tytul?: string
}

// Domyślne wartości propsów są w ciele funkcji: React Compiler 1.0 z Babelem 8 nie kompiluje
// komponentu z wartościami domyślnymi w destrukturyzacji parametrów.
export function WykresDzienny(props: WykresDziennyProps) {
  const { dane } = props
  const serie = props.serie ?? SERIE_DOMYSLNE
  const tytul = props.tytul ?? 'Ruch na dobę'
  const punkty: PunktSerii[] = dane.map((p) => ({
    x: p.dzien,
    odslony: p.odslony,
    unikalni: p.unikalni,
    boty: p.boty,
  }))
  const pierwszy = dane[0]?.dzien
  const ostatni = dane[dane.length - 1]?.dzien
  return (
    <WykresSerii
      dane={punkty}
      serie={serie}
      tytul={tytul}
      opis={
        pierwszy && ostatni
          ? `${tytul}: ${dane.length} dób, od ${pelnaDataDnia(pierwszy)} do ${pelnaDataDnia(ostatni)}.`
          : `${tytul}: brak danych.`
      }
      os={OS_DZIENNA}
      uwaga={
        serie.includes('unikalni')
          ? 'Unikalni to odciski dobowe: nie sumuj ich między dobami, bo ta sama osoba kolejnego dnia liczy się od nowa.'
          : undefined
      }
    />
  )
}
