// Wyniki mapy na heksach r10 bieżącego miasta wprost z kompaktu (#247, paczka B4): odpowiednik
// `policzWyniki` z `useWyniki.ts` bez adresów. Czysty plik (bez Reacta i `@/`), więc idzie na gołym
// `node --test`; hook: `useWynikiMapy.ts`.
//
// Różnice wobec ścieżki pełnych danych (dopuszczalne, patrz kontrakt-b.md): średnia heksu liczy się z
// macierzy ETL, a nie z adresów, a heks wykluczony filtrem nie traci wyniku (mapa rysuje go szrafurą
// z `wykluczoneHeksy`). Brak danych to `null`, nigdy 0.

import type { TwardyFiltr } from './filtry.ts'
import { liczoneWarstwy, wykluczeniaHeksow, wynikiHeksow } from './heksy.ts'
import type { DaneHeksowGotowe } from './kompaktBiezaceLogika.ts'
import type { Kierunki } from './silnik.ts'

export interface WynikiMapy {
  /** Wynik 0–100 per heks r10 (dla każdego heksu miasta); null = brak danych albo za mało wagi z danymi. */
  heksy: ReadonlyMap<string, number | null>
  /** Heksy, w których wszystkie adresy na pewno naruszają aktywny filtr. */
  wykluczoneHeksy: ReadonlySet<string>
  liczbaWykluczonych: number
  liczbaNiewiadomych: number
  liczbaAdresow: number
  /** Podpis legendy: nazwa wskaźnika albo „Wynik tej okolicy". */
  podpis: string
  /** Wybranej warstwy nie ma w danych miasta (jak `Wyniki.brakWarstwy`). */
  brakWarstwy: boolean
  /**
   * Czy filtry z `filtry` mają już swoje pliki i skale. Jeśli nie, część heksów mogła zostać na mapie,
   * choć powinna zniknąć: ekran może pokazać to jako „liczę filtry".
   */
  filtryGotowe: boolean
}

const BRAK_WYKLUCZONYCH: ReadonlySet<string> = new Set()

let ostatni: {
  dane: DaneHeksowGotowe
  wagi: object
  kierunki: Kierunki
  warstwa: string
  filtry: readonly TwardyFiltr[]
  wynik: WynikiMapy
} | null = null

/**
 * Wyniki mapy dla r10. `null`, gdy któraś liczona warstwa nie ma jeszcze pliku (ani błędu): lepiej
 * poczekać chwilę niż pokazać mapę policzoną z części warstw. Ten sam obiekt (`===`) dla tych samych
 * wejść, bo mapa porównuje referencje.
 */
export function policzWynikiMapy(
  dane: DaneHeksowGotowe,
  wagi: Readonly<Record<string, number>>,
  kierunki: Kierunki,
  warstwa: string,
  filtry: readonly TwardyFiltr[] = [],
): WynikiMapy | null {
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
  const { manifest, indeks, podstawa } = dane
  const liczone = liczoneWarstwy(manifest.wskazniki, wagi, kierunki, warstwa)
  // Warstwa z meta, ale bez pliku w kompakcie, liczy się jak brak danych (jak w przeglądzie).
  const czeka = liczone.some(
    ({ id }) => indeks.wskazniki[id] && !dane.warstwy.has(id) && !dane.nieudane.has(id),
  )
  if (czeka) return null

  const { wartosc } = wynikiHeksow(podstawa, 10, liczone, (id) => dane.warstwy.get(id) ?? null)
  const idHeksow = podstawa.poziomy[10].heksy
  const heksy = new Map<string, number | null>()
  for (let h = 0; h < idHeksow.length; h++) {
    const v = wartosc[h] as number
    heksy.set(idHeksow[h] as string, Number.isNaN(v) ? null : v)
  }

  // Filtr warstwy, której miasto nie ma, nie wyklucza nikogo (jak `policzWykluczenia`), więc nie czekamy na niego.
  const aktywne = filtry.filter((f) => indeks.wskazniki[f.id])
  const dostepne = new Map<
    string,
    {
      filtr: NonNullable<ReturnType<typeof dane.filtr>>
      skala: NonNullable<ReturnType<typeof dane.skala>>
    }
  >()
  for (const f of aktywne) {
    const filtr = dane.filtr(f.id)
    const skala = dane.skala(f.id)
    if (filtr && skala) dostepne.set(f.id, { filtr, skala })
  }
  const filtryGotowe = dostepne.size === new Set(aktywne.map((f) => f.id)).size

  let wykluczone = BRAK_WYKLUCZONYCH
  let liczbaWykluczonych = 0
  let liczbaNiewiadomych = 0
  let liczbaAdresow = 0
  if (aktywne.length > 0) {
    const w = wykluczeniaHeksow(
      podstawa.poziomy[10].liczba,
      podstawa.skalaUdzialu,
      aktywne,
      (id) => dostepne.get(id) ?? null,
    )
    liczbaWykluczonych = w.liczbaWykluczonych
    liczbaNiewiadomych = w.liczbaNiewiadomych
    liczbaAdresow = w.liczbaAdresow
    if (w.liczbaWykluczonych > 0) {
      const zbior = new Set<string>()
      for (let h = 0; h < idHeksow.length; h++)
        if (w.wykluczony[h]) zbior.add(idHeksow[h] as string)
      wykluczone = zbior
    }
  } else {
    const liczba = podstawa.poziomy[10].liczba
    for (let h = 0; h < liczba.length; h++) liczbaAdresow += liczba[h] as number
  }

  const meta = warstwa === 'wynik' ? null : manifest.wskazniki.find((m) => m.id === warstwa)
  const wynik: WynikiMapy = {
    heksy,
    wykluczoneHeksy: wykluczone,
    liczbaWykluczonych,
    liczbaNiewiadomych,
    liczbaAdresow,
    // Jak w `useWyniki`: nazwa tylko dla warstwy, którą miasto zna; inaczej legendę nazywa przegląd.
    podpis: meta ? meta.nazwa : 'Wynik tej okolicy',
    brakWarstwy: warstwa !== 'wynik' && !meta,
    filtryGotowe,
  }
  ostatni = { dane, wagi, kierunki, warstwa, filtry, wynik }
  return wynik
}
