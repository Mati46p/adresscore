// Twarde filtry (dealbreakery): adres, który ich nie spełnia, jest WYKLUCZONY z mapy i rankingu.
// To nie jest kara w wyniku: wynik adresu i wyniki pozostałych adresów zostają bez zmian
// (filtr tylko maskuje adres, nie rusza wag ani ocen). Funkcje są czyste i działają na samych
// typach z silnika, więc testy idą na gołym `node --test`.
import type { GrupyHeksow, WskaznikPrzygotowany } from './silnik.ts'

/** `rowne-zero` = wartość musi wynosić 0 (np. adres poza strefą zalewową). */
export type Warunek = 'max' | 'min' | 'rowne-zero'

export interface TwardyFiltr {
  /** Id wskaźnika z manifestu. Filtr działa generycznie po id, także dla warstw, które dopiero powstaną. */
  id: string
  warunek: Warunek
  /** Próg w jednostkach warstwy. Dla `rowne-zero` zawsze 0. */
  prog: number
}

export type OcenaFiltra = 'spelnia' | 'narusza' | 'nie-wiemy'

/**
 * Wykluczenie ≠ brak danych. Brak danych (null, NaN) NIE wyklucza adresu: nie wiemy, czy filtr
 * jest spełniony, a wyrzucenie adresu z powodu luki w rejestrze ukryłoby dobre miejsca.
 * Adres zostaje na mapie i dostaje znacznik „nie wiemy".
 */
export function ocenFiltr(wartosc: number | null | undefined, filtr: TwardyFiltr): OcenaFiltra {
  if (wartosc === null || wartosc === undefined || Number.isNaN(wartosc)) return 'nie-wiemy'
  if (filtr.warunek === 'max') return wartosc > filtr.prog ? 'narusza' : 'spelnia'
  if (filtr.warunek === 'min') return wartosc < filtr.prog ? 'narusza' : 'spelnia'
  return wartosc === 0 ? 'spelnia' : 'narusza'
}

export interface Wykluczenia {
  /** 1 = adres narusza co najmniej jeden filtr. */
  wykluczony: Uint8Array
  /** 1 = adres nie jest wykluczony, ale dla co najmniej jednego filtra brak danych („nie wiemy"). */
  niewiadomy: Uint8Array
  liczbaWykluczonych: number
  liczbaNiewiadomych: number
  liczbaAdresow: number
}

/**
 * Policz wykluczenia dla wszystkich adresów. Znane naruszenie jednego filtra wyklucza adres
 * nawet wtedy, gdy drugi filtr nie ma danych. Filtr, którego warstwy nie ma w `wskazniki`,
 * jest pomijany (nie wyklucza nikogo), ale zostaje w stanie – zadziała, gdy warstwa się pojawi.
 */
export function policzWykluczenia(
  wskazniki: readonly Pick<WskaznikPrzygotowany, 'meta' | 'wartosci'>[],
  filtry: readonly TwardyFiltr[],
  liczbaAdresow: number,
): Wykluczenia {
  const wykluczony = new Uint8Array(liczbaAdresow)
  const niewiadomy = new Uint8Array(liczbaAdresow)
  for (const filtr of filtry) {
    const w = wskazniki.find((x) => x.meta.id === filtr.id)
    if (!w) continue
    for (let i = 0; i < liczbaAdresow; i++) {
      const ocena = ocenFiltr(w.wartosci[i], filtr)
      if (ocena === 'narusza') wykluczony[i] = 1
      else if (ocena === 'nie-wiemy') niewiadomy[i] = 1
    }
  }
  let liczbaWykluczonych = 0
  let liczbaNiewiadomych = 0
  for (let i = 0; i < liczbaAdresow; i++) {
    if (wykluczony[i]) {
      liczbaWykluczonych++
      niewiadomy[i] = 0
    } else if (niewiadomy[i]) liczbaNiewiadomych++
  }
  return { wykluczony, niewiadomy, liczbaWykluczonych, liczbaNiewiadomych, liczbaAdresow }
}

/** Kopia wyników z NaN pod wykluczonymi adresami – do średnich heksów. Reszta bez zmian. */
export function maskujWykluczone(wyniki: Float32Array, wykluczony: Uint8Array): Float32Array {
  const kopia = new Float32Array(wyniki)
  const n = Math.min(kopia.length, wykluczony.length)
  for (let i = 0; i < n; i++) if (wykluczony[i]) kopia[i] = Number.NaN
  return kopia
}

/** Heksy, w których wszystkie adresy są wykluczone. Heks z choć jednym adresem zostaje na mapie. */
export function wykluczoneHeksy(wykluczony: Uint8Array, grupy: GrupyHeksow): Set<string> {
  const razem = new Uint32Array(grupy.heksy.length)
  const wykl = new Uint32Array(grupy.heksy.length)
  const n = Math.min(wykluczony.length, grupy.indeksHeksu.length)
  for (let i = 0; i < n; i++) {
    const h = grupy.indeksHeksu[i] as number
    razem[h] = (razem[h] as number) + 1
    if (wykluczony[i]) wykl[h] = (wykl[h] as number) + 1
  }
  const wynik = new Set<string>()
  for (let h = 0; h < razem.length; h++) {
    if ((razem[h] as number) > 0 && razem[h] === wykl[h]) wynik.add(grupy.heksy[h] as string)
  }
  return wynik
}

/** Podmienia filtr tej samej warstwy albo dopisuje nowy. Jeden filtr na warstwę. */
export function zPodmienionymFiltrem(
  filtry: readonly TwardyFiltr[],
  filtr: TwardyFiltr,
): TwardyFiltr[] {
  const poprawiony: TwardyFiltr = filtr.warunek === 'rowne-zero' ? { ...filtr, prog: 0 } : filtr
  const jest = filtry.some((f) => f.id === filtr.id)
  return jest ? filtry.map((f) => (f.id === filtr.id ? poprawiony : f)) : [...filtry, poprawiony]
}

function liczbaPl(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',')
}

/** Opis do panelu, np. „Hałas: maks. 55 dB”, „Zagrożenie powodzią: wyklucz strefę”. */
export function opisFiltru(
  filtr: TwardyFiltr,
  meta: { nazwa: string; jednostka: string } | undefined,
): string {
  const nazwa = meta?.nazwa ?? filtr.id
  if (filtr.warunek === 'rowne-zero') return `${nazwa}: wyklucz strefę`
  const jednostka = meta?.jednostka ? ` ${meta.jednostka}` : ''
  return `${nazwa}: ${filtr.warunek === 'max' ? 'maks.' : 'min.'} ${liczbaPl(filtr.prog)}${jednostka}`
}

// ── Zapis w URL: `halas_ldwn:max:55,powodz_1proc:zero` ───────────────────────────────────

const KOD_WARUNKU: Record<Warunek, string> = { max: 'max', min: 'min', 'rowne-zero': 'zero' }
const MAKS_FILTROW = 30

export function filtryDoTekstu(filtry: readonly TwardyFiltr[]): string {
  return filtry
    .map((f) =>
      f.warunek === 'rowne-zero' ? `${f.id}:zero` : `${f.id}:${KOD_WARUNKU[f.warunek]}:${f.prog}`,
    )
    .join(',')
}

/** Uszkodzone wpisy pomija po cichu. Powtórzone id: wygrywa ostatni wpis. */
export function filtryZTekstu(tekst: string | null): TwardyFiltr[] {
  if (!tekst) return []
  let wynik: TwardyFiltr[] = []
  for (const wpis of tekst.split(',').slice(0, MAKS_FILTROW)) {
    const [id = '', kod = '', prog = ''] = wpis.split(':')
    if (!/^[a-z0-9_]{1,64}$/.test(id)) continue
    if (kod === 'zero') {
      wynik = zPodmienionymFiltrem(wynik, { id, warunek: 'rowne-zero', prog: 0 })
    } else if (kod === 'max' || kod === 'min') {
      const liczba = prog === '' ? Number.NaN : Number(prog)
      if (Number.isFinite(liczba))
        wynik = zPodmienionymFiltrem(wynik, { id, warunek: kod, prog: liczba })
    }
  }
  return wynik
}
