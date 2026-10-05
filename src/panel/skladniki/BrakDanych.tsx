// Szary stan „brak danych” (FR-040). Brak pomiaru nigdy nie udaje zera: kafel, komórka tabeli albo
// wykres bez danych pokazują ten stan, a nie „0”. Szara kropka to wypełnienie (znak), a napis obok
// ma kolor tekstu --tekst-3 (6:1), bo szarość danych nie nadaje się na pismo.
//
// Wartości domyślne propsów stoją w ciele funkcji (`??`), nie w destrukturyzacji parametrów:
// babel-plugin-react-compiler 1.0 z Babelem 8 odrzuca wtedy cały komponent („Expected object
// property value to be an LVal, got: AssignmentPattern”) i zostaje on bez automatycznej memoizacji.
import type { ReactNode } from 'react'
import { BRAK_DANYCH } from '@/panel/arytmetyka'

interface BrakDanychProps {
  /** Napis stanu. Domyślnie „brak danych”; zaślepki zakładek podają „w budowie”. */
  tekst?: string
  /** Dopisek wyjaśniający, DLACZEGO nie ma danych (inaczej pusta sekcja wygląda jak awaria). */
  opis?: ReactNode
  /** `wiersz` (domyślnie): mały, w linii (kafle, komórki). `blok`: ramka z przerywaną obwódką (całe sekcje). */
  wariant?: 'wiersz' | 'blok'
}

export function BrakDanych({ tekst, opis, wariant }: BrakDanychProps) {
  return (
    <span className="panel-brak" data-blok={wariant === 'blok' ? '' : undefined}>
      <span className="panel-brak-kropka" aria-hidden="true" />
      <span>{tekst ?? BRAK_DANYCH}</span>
      {opis ? <span className="panel-brak-opis">{opis}</span> : null}
    </span>
  )
}
