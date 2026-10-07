import type { Adres } from '@/kontrakty'

/** „ul. Długa 12, Kraków" – ulica bywa null na wsiach, wtedy sama miejscowość z numerem. */
export function opisAdresu(a: Adres): string {
  const ulica = a.ulica ? `${a.ulica} ${a.nr}` : `${a.miejscowosc} ${a.nr}`
  return a.ulica ? `${ulica}, ${a.miejscowosc}` : ulica
}

/**
 * Przykład do pola wyszukiwania adresu, z danych bieżącego miasta (#223): „Zofii Nałkowskiej 6C” albo, z
 * miejscowością, „Zofii Nałkowskiej 6C, Gdańsk”. Pierwszy adres z ulicą (wieś bez ulic nie da przykładu
 * z numerem domu); null, gdy żaden adres nie ma ulicy. Stały dla tych samych danych.
 */
export function przykladAdresu(adresy: readonly Adres[], zMiejscowoscia = false): string | null {
  const a = adresy.find((x) => x.ulica)
  if (!a) return null
  const baza = `${a.ulica} ${a.nr}`
  return zMiejscowoscia ? `${baza}, ${a.miejscowosc}` : baza
}

/** Liczba do wyświetlenia: zaokrąglona albo kreska dla braku danych. */
export function liczba(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? '–' : String(Math.round(v))
}
