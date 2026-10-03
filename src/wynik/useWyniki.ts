// Wyniki dla mapy i list: łączą dane, wagi ze stanu i silnik. Pamięć ostatniego wyniku
// jest w module, bo mapa, panel i ranking wołają ten hook naraz z tymi samymi wejściami.
import { type Dane, useDane } from './dane.ts'
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
  /** Wartość 0–100 aktywnej warstwy per adres (NaN = brak danych). */
  naAdres: Float32Array
  /** Średnia per heks H3 r10 – wprost do MapaKrakowa (`heksy`). null = brak danych. */
  heksy: ReadonlyMap<string, number | null>
  /** Podpis legendy: „Twój wynik" albo nazwa wskaźnika. */
  podpis: string
}

let ostatni: {
  dane: Dane
  wagi: object
  kierunki: Kierunki
  warstwa: WarstwaMapy
  wynik: Wyniki
} | null = null

export function policzWyniki(
  dane: Dane,
  wagi: Readonly<Record<string, number>>,
  kierunki: Kierunki,
  warstwa: WarstwaMapy,
): Wyniki {
  const o = ostatni
  if (o && o.dane === dane && o.wagi === wagi && o.kierunki === kierunki && o.warstwa === warstwa) {
    return o.wynik
  }
  const n = dane.plikAdresow.kolumny.id.length
  const wskaznik = warstwa === 'wynik' ? null : dane.wskazniki.find((w) => w.meta.id === warstwa)
  const naAdres =
    (wskaznik ? ocenyWarstwy(wskaznik, kierunki) : null) ??
    (wskaznik
      ? new Float32Array(n).fill(Number.NaN)
      : wynikiWszystkich(dane.wskazniki, wagi, kierunki, n))
  const wynik: Wyniki = {
    naAdres,
    heksy: mapaHeksow(srednieHeksow(naAdres, dane.grupyHeksow), dane.grupyHeksow),
    podpis: wskaznik ? wskaznik.meta.nazwa : 'Twój wynik',
  }
  ostatni = { dane, wagi, kierunki, warstwa, wynik }
  return wynik
}

/** Wyniki aktywnej warstwy; null do końca ładowania danych. */
export function useWyniki(): Wyniki | null {
  const dane = useDane()
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const warstwa = useStan((s) => s.warstwa)
  return dane.stan === 'gotowe' ? policzWyniki(dane, wagi, kierunki, warstwa) : null
}

/** Pełne rozbicie jednego adresu dla karty okolicy i porównania. */
export function useWynikAdresu(i: number | null): WynikAdresu | null {
  const dane = useDane()
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  if (dane.stan !== 'gotowe' || i === null) return null
  return wynikAdresu(i, dane.wskazniki, wagi, kierunki)
}
