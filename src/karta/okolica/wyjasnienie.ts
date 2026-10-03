// Czysta logika karty okolicy: mocne i słabe strony oraz zdania z surowych wartości.
// Importy tylko typowe, żeby testy szły na gołym `node --test` (patrz src/wynik/silnik.ts).
import type { Rozdzielczosc } from '../../kontrakty/index.ts'
import type { RozbicieWarstwy } from '../../wynik/silnik.ts'

const FORMAT = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })

export function liczbaPL(v: number): string {
  return FORMAT.format(v)
}

/** „240 m – Rondo Mogilskie"; sama liczba z jednostką, gdy warstwa nie ma etykiety. */
export function opisWartosci(w: Pick<RozbicieWarstwy, 'wartosc' | 'etykieta' | 'meta'>): string {
  if (w.wartosc === null) return 'brak danych'
  const baza = `${liczbaPL(w.wartosc)} ${w.meta.jednostka}`.trim()
  return w.etykieta ? `${baza} – ${w.etykieta}` : baza
}

const NAZWY_ROZDZIELCZOSCI: Record<Rozdzielczosc, string> = {
  adres: 'adres',
  budynek: 'budynek',
  heks: 'heks',
  siatka: 'siatka',
  rejon: 'rejon',
  gmina: 'gmina',
}

/** „adres", „heks 1 km", „siatka 100 m": czego naprawdę dotyczy liczba. */
export function opisRozdzielczosci(
  meta: Pick<RozbicieWarstwy['meta'], 'rozdzielczosc' | 'rozmiar'>,
) {
  const nazwa = NAZWY_ROZDZIELCZOSCI[meta.rozdzielczosc]
  // Dla gminy rozmiar powtarzałby nazwę („gmina gmina").
  return meta.rozmiar && meta.rozmiar !== nazwa ? `${nazwa} ${meta.rozmiar}` : nazwa
}

/** Zdanie z surowej wartości i normy z metadanych – bez żadnych faktów spoza danych. */
export function zdanieWarstwy(w: RozbicieWarstwy): string {
  const wartosc = opisWartosci(w)
  const norma = w.meta.norma
  if (w.wartosc !== null && norma && w.kierunek) {
    const prog = `${liczbaPL(norma.wartosc)} ${w.meta.jednostka}`.trim()
    const zle =
      w.kierunek === 'mniej-lepiej' ? w.wartosc > norma.wartosc : w.wartosc < norma.wartosc
    const kierunek = w.kierunek === 'mniej-lepiej' ? 'powyżej' : 'poniżej'
    const polozenie = zle ? `${kierunek} progu ${prog}` : `w granicach progu ${prog}`
    return `${wartosc}, ${polozenie} (${norma.opis}).`
  }
  if (w.ocena === null) return `${wartosc}.`
  return `${wartosc}. Ocena ${Math.round(w.ocena)} na 100 w skali tej warstwy.`
}

export interface Wplyw {
  warstwa: RozbicieWarstwy
  /** Punkty wyniku ponad (+) albo pod (–) tym, co dałaby warstwa oceniona jak cały wynik. */
  punkty: number
}

/**
 * Wpływ warstwy względem średniej: waga × (ocena warstwy − wynik łączny).
 * Warstwa oceniona dokładnie na poziomie wyniku nie zmienia go ani w górę, ani w dół,
 * więc jej wpływ to 0. Suma wpływów wszystkich warstw wynosi 0, bo suma wkładów = wynik.
 * Samo „wkład" nie nadaje się do rankingu: duża waga dawałaby duży wkład także słabej warstwie.
 */
export function wplywy(warstwy: readonly RozbicieWarstwy[], wynik: number | null): Wplyw[] {
  if (wynik === null) return []
  const out: Wplyw[] = []
  for (const w of warstwy) {
    if (w.ocena === null || w.waga <= 0) continue
    out.push({ warstwa: w, punkty: w.waga * (w.ocena - wynik) })
  }
  return out
}

/** Poniżej tego progu (w punktach wyniku) różnica to szum, nie mocna ani słaba strona. */
const PROG_ISTOTNOSCI = 0.5

export function mocneISlabe(
  warstwy: readonly RozbicieWarstwy[],
  wynik: number | null,
  ile = 3,
): { mocne: Wplyw[]; slabe: Wplyw[] } {
  const wszystkie = wplywy(warstwy, wynik)
  const mocne = wszystkie
    .filter((p) => p.punkty >= PROG_ISTOTNOSCI)
    .sort((a, b) => b.punkty - a.punkty)
    .slice(0, ile)
  const slabe = wszystkie
    .filter((p) => p.punkty <= -PROG_ISTOTNOSCI)
    .sort((a, b) => a.punkty - b.punkty)
    .slice(0, ile)
  return { mocne, slabe }
}

/** „+14" albo „−7" (prawdziwy minus, jak w makiecie). */
export function znakowanePunkty(p: number): string {
  const r = Math.round(p)
  if (r === 0) return '0'
  return r > 0 ? `+${r}` : `−${Math.abs(r)}`
}

/** „Dane dla 5 z 7 warstw": ile liczonych warstw ma dane pod tym adresem. */
export function liczbyWarstw(warstwy: readonly RozbicieWarstwy[]): {
  zDanymi: number
  razem: number
} {
  const liczone = warstwy.filter((w) => w.liczona)
  return { zDanymi: liczone.filter((w) => w.ocena !== null).length, razem: liczone.length }
}
