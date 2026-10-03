import type { KategoriaId } from '../../kontrakty/index.ts'
import type { RozbicieWarstwy } from '../../wynik/silnik.ts'

// Strukturalnie zgodne z WynikAdresu z silnika; moduł porównania nie wymaga jego uruchomienia.
export interface KategoriaPorownania {
  kategoria: KategoriaId
  ocena: number | null
  pewnosc: number
  warstwy: readonly { liczona: boolean; wagaUzytkownika: number; meta: { atrapa?: boolean } }[]
}

export interface WynikPorownania {
  wynik: number | null
  litera: string | null
  pewnosc: number
  kategorie: readonly KategoriaPorownania[]
  warstwy: readonly RozbicieWarstwy[]
}

export interface OkolicaPorownania {
  id: string
  nazwa: string
  wynik: WynikPorownania
  href?: string
  /** Stały kolor adresu także po wykluczeniu innego adresu twardym filtrem. */
  kolor?: string
}

export const OSIE: readonly KategoriaId[] = [
  'codziennosc',
  'transport',
  'spokoj',
  'przyszlosc',
  'bezpieczenstwo',
]

/** Grupy tabeli obejmują każdą warstwę, niezależnie od wagi i braków pomiaru. */
export function warstwyPorownania(
  wynik: WynikPorownania,
): readonly { kategoria: KategoriaId; warstwy: readonly RozbicieWarstwy[] }[] {
  return ([...OSIE, 'kontekst'] as readonly KategoriaId[]).map((kategoria) => ({
    kategoria,
    warstwy: wynik.warstwy.filter((w) => w.meta.kategoria === kategoria),
  }))
}

export function priorytety(okolicy: readonly OkolicaPorownania[]): Record<KategoriaId, number> {
  const pierwsza = okolicy[0]?.wynik.kategorie ?? []
  const wagi = Object.fromEntries(
    pierwsza.map((k) => [
      k.kategoria,
      k.warstwy.filter((w) => w.liczona).reduce((s, w) => s + w.wagaUzytkownika, 0),
    ]),
  ) as Record<KategoriaId, number>
  const maksimum = Math.max(0, ...OSIE.map((o) => wagi[o] ?? 0))
  return Object.fromEntries(
    OSIE.map((o) => [o, maksimum ? (wagi[o] ?? 0) / maksimum : 0]),
  ) as Record<KategoriaId, number>
}

export function ranking(okolicy: readonly OkolicaPorownania[]): OkolicaPorownania[] {
  return [...okolicy].sort((a, b) => {
    const av = a.wynik.wynik
    const bv = b.wynik.wynik
    if (av === null || !Number.isFinite(av)) return bv === null || !Number.isFinite(bv) ? 0 : 1
    if (bv === null || !Number.isFinite(bv)) return -1
    return bv - av
  })
}

export function werdykt(okolicy: readonly OkolicaPorownania[]): string {
  const [pierwsza, druga] = ranking(okolicy)
  if (!pierwsza || pierwsza.wynik.wynik === null) return 'Brak wyniku do porównania.'
  if (!druga || druga.wynik.wynik === null)
    return 'Dodaj drugi adres z wynikiem, aby zobaczyć werdykt.'
  // Ranking zachowuje dokładność, ale werdykt musi zgadzać się z liczbami widocznymi na karcie.
  const roznica = Math.round(pierwsza.wynik.wynik) - Math.round(druga.wynik.wynik)
  if (roznica < 1)
    return 'Najwyższe wyniki są bardzo zbliżone. Sprawdź kategorie i dostępność danych.'
  if (pierwsza.wynik.pewnosc < 0.5 || druga.wynik.pewnosc < 0.5)
    return 'Dane dla najwyższych wyników są niepełne. Nie wskazujemy zwycięzcy.'
  return `${pierwsza.nazwa} ma najwyższy wynik dla obecnych wag (${roznica} pkt więcej niż ${druga.nazwa}).`
}

export const RADAR_X = 300
export const RADAR_Y = 225

export function punktyRadaru(wartosci: readonly (number | null)[], promien = 140): string | null {
  if (wartosci.length < 3 || wartosci.some((v) => v === null || !Number.isFinite(v))) return null
  return wartosci
    .map((v, i) => {
      const kat = -Math.PI / 2 + (i * 2 * Math.PI) / wartosci.length
      const r = (Math.min(100, Math.max(0, v as number)) / 100) * promien
      return `${(RADAR_X + Math.cos(kat) * r).toFixed(1)},${(RADAR_Y + Math.sin(kat) * r).toFixed(1)}`
    })
    .join(' ')
}
