// Wyniki dla mapy i list: łączą dane, wagi ze stanu i silnik. Pamięć ostatniego wyniku
// jest w module, bo mapa, panel i ranking wołają ten hook naraz z tymi samymi wejściami.
import { type Dane, useDane } from './dane.ts'
import {
  maskujWykluczone,
  policzWykluczenia,
  type TwardyFiltr,
  type Wykluczenia,
  wykluczoneHeksy,
} from './filtry.ts'
import { zakryjBrakiHeksow } from './heksy.ts'
import {
  type Kierunki,
  mapaHeksow,
  ocenyWarstwy,
  srednieHeksow,
  type WynikAdresu,
  wynikAdresu,
  wynikiWszystkich,
} from './silnik.ts'
import { useStan, type WarstwaMapy } from './stan.ts'

export interface Wyniki {
  /** Wartość 0–100 aktywnej warstwy per adres (NaN = brak danych). Wykluczone adresy zachowują swój wynik. */
  naAdres: Float32Array
  /** Średnia per heks H3 r10 bez adresów wykluczonych – wprost do MapaKrakowa (`heksy`). null = brak danych. */
  heksy: ReadonlyMap<string, number | null>
  /** Heksy, w których wszystkie adresy są wykluczone filtrem – do MapaKrakowa (`wykluczone`). */
  wykluczoneHeksy: ReadonlySet<string>
  /** Które adresy wykluczono, a które „nie wiemy” (brak danych dla filtra). */
  wykluczenia: Wykluczenia
  /** Podpis legendy: „Wynik tej okolicy" albo nazwa wskaźnika. */
  podpis: string
}

const BRAK_WYKLUCZONYCH: ReadonlySet<string> = new Set()

let ostatni: {
  dane: Dane
  wagi: object
  kierunki: Kierunki
  warstwa: WarstwaMapy
  filtry: readonly TwardyFiltr[]
  wynik: Wyniki
} | null = null

export function policzWyniki(
  dane: Dane,
  wagi: Readonly<Record<string, number>>,
  kierunki: Kierunki,
  warstwa: WarstwaMapy,
  filtry: readonly TwardyFiltr[] = [],
): Wyniki {
  const o = ostatni
  if (
    o &&
    o.dane === dane &&
    o.wagi === wagi &&
    o.kierunki === kierunki &&
    o.warstwa === warstwa &&
    o.filtry === filtry
  ) {
    return o.wynik
  }
  const n = dane.plikAdresow.kolumny.id.length
  const wskaznik = warstwa === 'wynik' ? null : dane.wskazniki.find((w) => w.meta.id === warstwa)
  const naAdres =
    (wskaznik ? ocenyWarstwy(wskaznik, kierunki) : null) ??
    (wskaznik
      ? new Float32Array(n).fill(Number.NaN)
      : wynikiWszystkich(dane.wskazniki, wagi, kierunki, n))
  // Filtr tylko maskuje adresy: naAdres zostaje nietknięte, a średnie heksów liczymy bez wykluczonych.
  const wykluczenia = policzWykluczenia(dane.wskazniki, filtry, n)
  const zMaska = wykluczenia.liczbaWykluczonych > 0
  const wynik: Wyniki = {
    naAdres,
    heksy: mapaHeksow(
      zakryjBrakiHeksow(
        srednieHeksow(
          zMaska ? maskujWykluczone(naAdres, wykluczenia.wykluczony) : naAdres,
          dane.grupyHeksow,
        ),
        dane.grupyHeksow,
        dane.wskazniki,
        wagi,
        kierunki,
        warstwa,
      ),
      dane.grupyHeksow,
    ),
    wykluczoneHeksy: zMaska
      ? wykluczoneHeksy(wykluczenia.wykluczony, dane.grupyHeksow)
      : BRAK_WYKLUCZONYCH,
    wykluczenia,
    podpis: wskaznik ? wskaznik.meta.nazwa : 'Wynik tej okolicy',
  }
  ostatni = { dane, wagi, kierunki, warstwa, filtry, wynik }
  return wynik
}

/** Wyniki aktywnej warstwy; null do końca ładowania danych. */
export function useWyniki(): Wyniki | null {
  const dane = useDane()
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const warstwa = useStan((s) => s.warstwa)
  const filtry = useStan((s) => s.filtry)
  return dane.stan === 'gotowe' ? policzWyniki(dane, wagi, kierunki, warstwa, filtry) : null
}

/** Pełne rozbicie jednego adresu dla karty okolicy i porównania. */
export function useWynikAdresu(i: number | null): WynikAdresu | null {
  const dane = useDane()
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  if (dane.stan !== 'gotowe' || i === null) return null
  return wynikAdresu(i, dane.wskazniki, wagi, kierunki)
}
