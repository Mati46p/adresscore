// Ranking ulic na ekranie Szukaj: jeden wiersz na ulicę, ocena ulicy to średnia ocen jej adresów z danymi.
// Czyste funkcje bez DOM i bez Reacta (testy na gołym `node --test`).
//
// Okolica ulicy (#185) to jednostka SIM (Kraków) z `okolice.json`, a bez pliku dzielnica albo gmina – te same
// nazwy co na karcie adresu (`miejsceAdresu`). Ulica potrafi leżeć w kilku okolicach, więc podpis wylicza je
// od największej (po liczbie adresów, które weszły do oceny ulicy), a nadmiar zamienia na liczbę.
import type { Adres, PlikOkolic } from '../kontrakty/index.ts'
import { okolicaAdresu } from './luki.ts'
import { miejsceAdresu } from './miejsceAdresu.ts'
import { kluczUlicy, slugUlicy } from './slug.ts'

export interface PozycjaUlicy {
  slug: string
  nazwa: string
  miejscowosc: string
  /**
   * Okolica ulicy do podpisu: „Kazimierz”, „Kazimierz, Stare Miasto i jeszcze 2 okolice”, a bez pliku okolic
   * „Dzielnica I Stare Miasto” albo „Gmina Liszki”. null, gdy nie ma co dopisać: miejscowość poza Krakowem
   * nazywa się tak samo jak miejscowość przy ulicy.
   */
  okolica: string | null
  liczbaAdresow: number
  wynik: number
  /** Indeks pierwszego adresu z danymi, który spełnia bieżące filtry. */
  adresDoPorownania: number
}

/** Ile nazw okolic stoi w podpisie ulicy; reszta idzie liczbą (przy jednej ponad limit pokazujemy ją całą). */
export const MAKS_OKOLIC_W_PODPISIE = 2

/** „okolica”, „okolice”, „okolic” po liczebniku: 1 okolica, 2 okolice, 5 okolic, 12 okolic, 22 okolice. */
function odmianaOkolic(n: number): 'okolica' | 'okolice' | 'okolic' {
  if (n === 1) return 'okolica'
  const j = n % 10
  const d = n % 100
  return j >= 2 && j <= 4 && (d < 12 || d > 14) ? 'okolice' : 'okolic'
}

/**
 * Podpis okolicy ulicy z indeksów jej adresów (tych, które weszły do oceny). Okolice od największej, remis
 * po nazwie. Nazwa miejscowości poza Krakowem, taka sama jak przy ulicy, wypada, bo nic by nie dodała.
 */
export function okolicaUlicy(
  indeksy: readonly number[],
  adresy: readonly Pick<Adres, 'dzielnica' | 'gmina'>[],
  okolice: PlikOkolic | null | undefined,
  miejscowosc: string,
): string | null {
  const liczniki = new Map<string, { n: number; i: number }>()
  for (const i of indeksy) {
    const adres = adresy[i]
    if (!adres) continue
    const id = okolicaAdresu(adres, i, okolice).id
    const jest = liczniki.get(id)
    if (jest) jest.n++
    else liczniki.set(id, { n: 1, i })
  }
  const nazwy: { nazwa: string; n: number }[] = []
  for (const { n, i } of liczniki.values()) {
    const adres = adresy[i]
    if (!adres) continue
    const miejsce = miejsceAdresu(adres, i, okolice)
    if (miejsce.rodzaj === 'miejscowosc' && miejsce.nazwa === miejscowosc) continue
    if (!nazwy.some((x) => x.nazwa === miejsce.nazwa)) nazwy.push({ nazwa: miejsce.nazwa, n })
  }
  if (nazwy.length === 0) return null
  nazwy.sort((a, b) => b.n - a.n || a.nazwa.localeCompare(b.nazwa, 'pl'))
  const widoczne =
    nazwy.length <= MAKS_OKOLIC_W_PODPISIE + 1 ? nazwy : nazwy.slice(0, MAKS_OKOLIC_W_PODPISIE)
  const reszta = nazwy.length - widoczne.length
  const ogon = reszta > 0 ? ` i jeszcze ${reszta} ${odmianaOkolic(reszta)}` : ''
  return `${widoczne.map((x) => x.nazwa).join(', ')}${ogon}`
}

interface Grupa {
  slug: string
  nazwa: string
  miejscowosc: string
  liczbaAdresow: number
  suma: number
  adresDoPorownania: number
  /** Indeksy adresów, które weszły do oceny ulicy – z nich liczy się okolica ulicy. */
  indeksy: number[]
}

/**
 * Jeden wiersz na ulicę; ocena ulicy jest średnią ocen jej adresów z danymi. `okolice` (z `useDane`, #185)
 * to jednostki SIM i miejscowości; bez nich okolicą jest dzielnica albo gmina (`miejsceAdresu`).
 */
export function rankingUlic(
  adresy: readonly Adres[],
  wyniki: ArrayLike<number>,
  wykluczone: ArrayLike<number>,
  heksy: ReadonlyMap<string, number | null>,
  ile = 5,
  okolice: PlikOkolic | null = null,
): PozycjaUlicy[] {
  const grupy = new Map<string, Grupa>()
  for (let i = 0; i < Math.min(adresy.length, wyniki.length); i++) {
    const adres = adresy[i]
    const wynik = wyniki[i]
    if (!adres || wynik === undefined || !Number.isFinite(wynik) || wykluczone[i]) continue
    if (!adres.h3 || heksy.get(adres.h3) === null || !heksy.has(adres.h3)) continue
    const klucz = kluczUlicy(adres)
    const grupa = grupy.get(klucz)
    if (grupa) {
      grupa.suma += wynik
      grupa.liczbaAdresow++
      grupa.indeksy.push(i)
    } else {
      grupy.set(klucz, {
        slug: slugUlicy(adres),
        nazwa: adres.ulica ?? adres.miejscowosc,
        miejscowosc: adres.miejscowosc,
        liczbaAdresow: 1,
        suma: wynik,
        adresDoPorownania: i,
        indeksy: [i],
      })
    }
  }
  return [...grupy.values()]
    .map((g) => ({ g, wynik: g.suma / g.liczbaAdresow }))
    .sort((a, b) => b.wynik - a.wynik || a.g.slug.localeCompare(b.g.slug, 'pl'))
    .slice(0, ile)
    .map(({ g, wynik }) => ({
      slug: g.slug,
      nazwa: g.nazwa,
      miejscowosc: g.miejscowosc,
      okolica: okolicaUlicy(g.indeksy, adresy, okolice, g.miejscowosc),
      liczbaAdresow: g.liczbaAdresow,
      wynik,
      adresDoPorownania: g.adresDoPorownania,
    }))
}
