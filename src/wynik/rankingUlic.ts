import type { Adres } from '../kontrakty/index.ts'
import { kluczUlicy, slugUlicy } from './slug.ts'

export interface PozycjaUlicy {
  slug: string
  nazwa: string
  miejscowosc: string
  dzielnica: string | null
  liczbaAdresow: number
  wynik: number
  /** Indeks pierwszego adresu z danymi, który spełnia bieżące filtry. */
  adresDoPorownania: number
}

/** Jeden wiersz na ulicę; ocena ulicy jest średnią ocen jej adresów z danymi. */
export function rankingUlic(
  adresy: readonly Adres[],
  wyniki: ArrayLike<number>,
  wykluczone: ArrayLike<number>,
  heksy: ReadonlyMap<string, number | null>,
  ile = 5,
): PozycjaUlicy[] {
  const grupy = new Map<string, PozycjaUlicy & { suma: number }>()
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
      if (grupa.dzielnica !== adres.dzielnica) grupa.dzielnica = null
    } else {
      grupy.set(klucz, {
        slug: slugUlicy(adres),
        nazwa: adres.ulica ?? adres.miejscowosc,
        miejscowosc: adres.miejscowosc,
        dzielnica: adres.dzielnica,
        liczbaAdresow: 1,
        suma: wynik,
        wynik: 0,
        adresDoPorownania: i,
      })
    }
  }
  return [...grupy.values()]
    .map(({ suma, ...g }) => ({ ...g, wynik: suma / g.liczbaAdresow }))
    .sort((a, b) => b.wynik - a.wynik || a.slug.localeCompare(b.slug, 'pl'))
    .slice(0, ile)
}
