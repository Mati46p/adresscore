// Tabela panelu: jedna konstrukcja dla wszystkich zakładek (listy źródeł, kampanii, sekcji, błędów,
// tabele-bliźniaki wykresów). Zamiast kopiować `<table>` do każdej zakładki, kolumny opisuje się
// danymi: nagłówek, opcjonalna podpowiedź, wyrównanie liczb i funkcja komórki.
//
// - Nagłówkiem wiersza (`th scope="row"`) jest pierwsza kolumna albo ta z `naglowekWiersza`, więc
//   czytnik ekranu podaje etykietę wiersza przy każdej liczbie.
// - Komórka, która zwróci `null`/`undefined`, pokazuje szary „brak danych”, nigdy zero.
// - Kolumna posortowana ma `aria-sort` i strzałkę: kierunek sortowania jest wypisany, nie
//   zakładany (reguła „kierunek skali”).
// - Opakowanie przewija się poziomo i jest dostępne z klawiatury; podpowiedzi w nagłówkach idą do
//   warstwy górnej, więc przewijany kontener ich nie przycina.
import type { ReactNode } from 'react'
import { BRAK_DANYCH } from '@/panel/arytmetyka'
import type { KluczHasla } from '@/panel/slownik'
import { BrakDanych } from './BrakDanych'
import { Podpowiedz } from './Podpowiedz'

export interface KolumnaTabeli<T> {
  id: string
  naglowek: string
  /** Hasło ze słownika: znaczek „i” przy nagłówku. */
  klucz?: KluczHasla
  /** Liczba: wyrównanie do prawej, cyfry tabelaryczne. */
  liczbowa?: boolean
  /**
   * Ta kolumna jest nagłówkiem wiersza (`th scope="row"`) i dostaje całą wolną szerokość, a długa
   * treść jest skracana wielokropkiem. Domyślnie nagłówkiem wiersza jest pierwsza kolumna.
   */
  naglowekWiersza?: boolean
  /** Wiersze przyszły posortowane wg tej kolumny; dopisuje `aria-sort` i strzałkę. */
  sortowana?: 'malejaco' | 'rosnaco'
  /** Zawartość komórki. `null`/`undefined` = brak danych. */
  komorka: (wiersz: T, indeks: number) => ReactNode
}

export function Tabela<T>({
  kolumny,
  wiersze,
  kluczWiersza,
  podpis,
  pusto,
  przewijana,
}: {
  kolumny: readonly KolumnaTabeli<T>[]
  wiersze: readonly T[]
  kluczWiersza: (wiersz: T, indeks: number) => string
  /** Nazwa tabeli: widoczny podpis i etykieta regionu dla czytników ekranu. */
  podpis?: string
  /** Co pokazać przy braku wierszy (domyślnie szary blok „brak danych”). */
  pusto?: ReactNode
  /** Długa tabela (np. bliźniak wykresu): ogranicza wysokość i przewija pionowo. Domyślnie nie. */
  przewijana?: boolean
}) {
  if (wiersze.length === 0) return <>{pusto ?? <BrakDanych wariant="blok" />}</>
  const jawnyNaglowek = kolumny.some((k) => k.naglowekWiersza)
  return (
    <div
      className="panel-tabela"
      data-przewijana={przewijana ? '' : undefined}
      role={podpis ? 'region' : undefined}
      aria-label={podpis}
      // Przewijany kontener musi dać się przewinąć klawiaturą.
      tabIndex={0}
    >
      <table>
        {podpis ? <caption>{podpis}</caption> : null}
        <thead>
          <tr>
            {kolumny.map((k) => (
              <th
                key={k.id}
                scope="col"
                data-liczba={k.liczbowa ? '' : undefined}
                aria-sort={
                  k.sortowana === 'malejaco'
                    ? 'descending'
                    : k.sortowana === 'rosnaco'
                      ? 'ascending'
                      : undefined
                }
              >
                {k.naglowek}
                {k.sortowana ? (
                  <span className="panel-sortowanie" aria-hidden="true">
                    {k.sortowana === 'malejaco' ? '▼' : '▲'}
                  </span>
                ) : null}
                {k.klucz ? <Podpowiedz klucz={k.klucz} /> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {wiersze.map((wiersz, i) => (
            <tr key={kluczWiersza(wiersz, i)}>
              {kolumny.map((k, j) => {
                const tresc = k.komorka(wiersz, i)
                const brak = tresc === null || tresc === undefined
                const wartosc = brak ? <span data-brak-komorki="">{BRAK_DANYCH}</span> : tresc
                const naglowekWiersza = jawnyNaglowek ? k.naglowekWiersza === true : j === 0
                return naglowekWiersza ? (
                  <th
                    key={k.id}
                    scope="row"
                    data-liczba={k.liczbowa ? '' : undefined}
                    data-etykieta={k.naglowekWiersza ? '' : undefined}
                  >
                    {wartosc}
                  </th>
                ) : (
                  <td key={k.id} data-liczba={k.liczbowa ? '' : undefined}>
                    {wartosc}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
