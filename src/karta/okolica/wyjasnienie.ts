// Czysta logika karty okolicy: mocne i słabe strony oraz zdania z surowych wartości.
// Importy tylko typowe, żeby testy szły na gołym `node --test` (patrz src/wynik/silnik.ts).
import type { Rozdzielczosc } from '../../kontrakty/index.ts'
import type { RozbicieKategorii, RozbicieWarstwy, WynikAdresu } from '../../wynik/silnik.ts'

const FORMAT = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })

export function liczbaPL(v: number): string {
  return FORMAT.format(v)
}

/** „240 m – Rondo Mogilskie"; sama liczba z jednostką, gdy warstwa nie ma etykiety. */
export function opisWartosci(w: Pick<RozbicieWarstwy, 'wartosc' | 'etykieta' | 'meta'>): string {
  if (w.wartosc === null) return 'brak danych'
  if (w.meta.jednostka === 'status') {
    if (w.etykieta) return w.etykieta
    if (w.wartosc === 1) return 'Tak'
    if (w.wartosc === 0) return 'Nie'
    return `Status: ${liczbaPL(w.wartosc)}`
  }
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
  powiat: 'powiat',
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

/** Powód braku oceny warstwy; żaden z powodów nie jest zerem. null = warstwa ma ocenę. */
export function powodPominiecia(
  w: Pick<RozbicieWarstwy, 'ocena' | 'wartosc' | 'kierunek' | 'niedostepny'>,
): string | null {
  if (w.ocena !== null) return null
  if (w.niedostepny) return 'plik warstwy się nie wczytał'
  if (w.wartosc === null) return 'brak danych'
  if (w.kierunek === null) return 'bez kierunku, nie liczona'
  return 'nie liczona'
}

export interface WarstwaSkladu {
  warstwa: RozbicieWarstwy
  /** Udział wagi w wyniku, 0–100 (podstawa = suma wag warstw z danymi). */
  udzial: number
  ocena: number
  /** Punkty wyniku wniesione przez warstwę. */
  wklad: number
}

export interface KategoriaSkladu {
  kategoria: RozbicieKategorii['kategoria']
  udzial: number
  ocena: number
  wklad: number
  warstwy: WarstwaSkladu[]
}

export interface PominietaWarstwa {
  warstwa: RozbicieWarstwy
  powod: string
}

export interface SkladWyniku {
  wynik: number | null
  kategorie: KategoriaSkladu[]
  pominiete: PominietaWarstwa[]
  /** Punkty do 100, których wynik nie ma; 0, gdy wyniku nie ma. */
  brakDo100: number
  /** Kompletność danych, 0–100. */
  kompletnosc: number
}

/**
 * Rachunek wyniku od góry do dołu na podstawie gotowego rozbicia z silnika, bez liczenia od nowa.
 * Udziały liczone względem SUMY wag warstw z danymi (nie największej), więc domykają się do 100.
 * Warstwa bez danych trafia do `pominiete`, nigdy do składu jako zero.
 */
export function skladWyniku(wynik: WynikAdresu): SkladWyniku {
  const warstwy = wynik.warstwy.filter((w) => w.kategoria !== 'kontekst')
  const pominiete = warstwy
    .filter((w) => w.wagaUzytkownika > 0 && w.ocena === null)
    .map((w) => ({ warstwa: w, powod: powodPominiecia(w) ?? 'nie liczona' }))
  const kompletnosc = Math.round(wynik.pewnosc * 100)
  if (wynik.wynik === null) {
    return { wynik: null, kategorie: [], pominiete, brakDo100: 0, kompletnosc }
  }

  const liczone = (k: RozbicieKategorii) =>
    k.warstwy.filter((w) => w.ocena !== null && w.wklad !== null && w.waga > 0)
  const suma = wynik.kategorie.reduce((s, k) => s + liczone(k).reduce((a, w) => a + w.waga, 0), 0)
  const kategorie: KategoriaSkladu[] = []
  if (suma > 0) {
    for (const k of wynik.kategorie) {
      if (k.kategoria === 'kontekst') continue
      const w = liczone(k)
      if (w.length === 0) continue
      const wagaKat = w.reduce((a, x) => a + x.waga, 0)
      kategorie.push({
        kategoria: k.kategoria,
        udzial: (wagaKat / suma) * 100,
        ocena: k.ocena ?? 0,
        wklad: w.reduce((a, x) => a + (x.wklad ?? 0), 0),
        warstwy: w
          .map((x) => ({
            warstwa: x,
            udzial: (x.waga / suma) * 100,
            ocena: x.ocena ?? 0,
            wklad: x.wklad ?? 0,
          }))
          .sort((a, b) => b.wklad - a.wklad),
      })
    }
  }
  kategorie.sort((a, b) => b.wklad - a.wklad)
  return {
    wynik: wynik.wynik,
    kategorie,
    pominiete,
    brakDo100: Math.max(0, 100 - wynik.wynik),
    kompletnosc,
  }
}
