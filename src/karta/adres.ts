import type { Adres } from '@/kontrakty'

/** „ul. Długa 12, Kraków" – ulica bywa null na wsiach, wtedy sama miejscowość z numerem. */
export function opisAdresu(a: Adres): string {
  const ulica = a.ulica ? `${a.ulica} ${a.nr}` : `${a.miejscowosc} ${a.nr}`
  return a.ulica ? `${ulica}, ${a.miejscowosc}` : ulica
}

/** Liczba do wyświetlenia: zaokrąglona albo kreska dla braku danych. */
export function liczba(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? '–' : String(Math.round(v))
}
