// Sekcja zakładki: nagłówek (z opcjonalną podpowiedzią i akcją) plus JEDEN z czterech stanów:
// ładowanie, błąd, pusto albo dane. Zakładka nie pisze tych rozgałęzień sama, więc każda sekcja
// zachowuje się tak samo i dostaje poprawne komunikaty.
//
// Użycie z hookiem danych (dane przychodzą do `children` już bez `null`):
//   const kanaly = useWidok('kanaly', { p_dni: okres })
//   <Sekcja tytul="Kanały wejścia" opis="…" stan={kanaly} pusto={(w) => w.length === 0}
//           pusteInfo="W tym okresie nie było wizyt.">
//     {(wiersze) => <PasekUdzialow … />}
//   </Sekcja>
// Sekcja zależna od dwóch widoków: `stan={polaczStany(a, b)}`, w `children` krotka `[a, b]`.
//
// Zasady stanów:
//  - Pierwsze ładowanie: szkielet o stałej minimalnej wysokości (bez skoku układu).
//  - Odświeżanie: poprzednia treść zostaje bez zmian (bez szkieletu, bez migotania i bez
//    przygaszania, które psułoby kontrast tekstu), a przy tytule pojawia się napis „Odświeżam…”.
//  - Błąd bez danych: komunikat po polsku; odmowa bramki (42501) ma osobny tekst.
//  - Nieudane odświeżenie z danymi: dane zostają, nad nimi ostrzeżenie, że są sprzed błędu.
//  - Puste: szary „brak danych” z wyjaśnieniem DLACZEGO (inaczej wygląda jak awaria).
import { type ReactNode, useId } from 'react'
import type { BladWidoku, StanWidoku } from '@/panel/magazyn'
import type { KluczHasla } from '@/panel/slownik'
import { BrakDanych } from './BrakDanych'
import { Podpowiedz } from './Podpowiedz'

function komunikatBledu(blad: BladWidoku): string {
  return blad.rodzaj === 'brak_dostepu'
    ? 'Brak dostępu do tych danych. Zaloguj się kontem administratora.'
    : blad.komunikat
}

export function Sekcja<T>({
  tytul,
  klucz,
  opis,
  akcja,
  stan,
  pusto,
  pusteInfo,
  szkielet,
  children,
}: {
  tytul: string
  /** Hasło ze słownika przy tytule. */
  klucz?: KluczHasla
  /** Jedno–dwa zdania: co sekcja mierzy i jak ją czytać. */
  opis?: ReactNode
  /** Element po prawej stronie nagłówka (np. przełącznik miary). */
  akcja?: ReactNode
  stan: Pick<StanWidoku<T>, 'dane' | 'blad' | 'ladowanie'>
  /** Czy dane są puste (np. `(w) => w.length === 0`). Puste dane to „brak danych”, nie zero. */
  pusto?: (dane: T) => boolean
  /** Dlaczego jest pusto i co z tym zrobić. */
  pusteInfo?: ReactNode
  /** Własny szkielet (domyślnie blok o wysokości 120 px). */
  szkielet?: ReactNode
  children: (dane: T) => ReactNode
}) {
  const idTytulu = useId()
  const { dane, blad, ladowanie } = stan

  let tresc: ReactNode
  if (dane === null) {
    tresc = blad ? (
      <p className="panel-blad" role="alert">
        {komunikatBledu(blad)}
      </p>
    ) : (
      (szkielet ?? <div className="panel-szkielet" aria-hidden="true" />)
    )
  } else if (pusto?.(dane)) {
    tresc = <BrakDanych wariant="blok" opis={pusteInfo} />
  } else {
    tresc = (
      <>
        {blad ? (
          <p className="panel-blad" role="status">
            {komunikatBledu(blad)} Poniżej ostatnio pobrane dane.
          </p>
        ) : null}
        <div className="panel-sekcja-tresc" data-odswiezanie={ladowanie ? '' : undefined}>
          {children(dane)}
        </div>
      </>
    )
  }

  return (
    <section className="panel-sekcja" aria-labelledby={idTytulu} aria-busy={ladowanie}>
      <div className="panel-sekcja-glowa">
        <h2 className="panel-sekcja-tytul" id={idTytulu}>
          {tytul}
          {klucz ? <Podpowiedz klucz={klucz} /> : null}
        </h2>
        {dane !== null && ladowanie ? (
          <span className="panel-odswiezanie" role="status">
            Odświeżam…
          </span>
        ) : null}
        {akcja}
      </div>
      {opis ? <p className="panel-sekcja-opis">{opis}</p> : null}
      {tresc}
    </section>
  )
}
