/** Krótki, stabilny identyfikator URL. Nie zależy od pozycji adresu w pliku ETL. */
export function hashAdresu(id: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let i = 0; i < id.length; i++) {
    const kod = id.charCodeAt(i)
    a = Math.imul(a ^ kod, 0x01000193)
    b = Math.imul(b ^ kod, 0x85ebca6b)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

export function slugTekstu(tekst: string): string {
  return tekst
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54)
    .replace(/-+$/g, '')
}

export function slugAdresu(a: {
  id: string
  ulica: string | null
  miejscowosc: string
  nr: string
}): string {
  const nazwa = a.ulica ? `${a.ulica} ${a.nr} ${a.miejscowosc}` : `${a.miejscowosc} ${a.nr}`
  return `${slugTekstu(nazwa)}-${hashAdresu(a.id)}`
}

export function hashZeSluga(slug: string): string | null {
  return slug.match(/-([0-9a-f]{16})$/)?.[1] ?? null
}

export function hrefAdresu(a: Parameters<typeof slugAdresu>[0]): string {
  return `/adres/${slugAdresu(a)}`
}

export function kluczUlicy(a: {
  teryt: string
  miejscowosc: string
  ulica: string | null
}): string {
  return `${a.teryt}|${a.miejscowosc}|${a.ulica ?? ''}`
}

export function slugUlicy(a: Parameters<typeof kluczUlicy>[0]): string {
  return `${slugTekstu(`${a.ulica ?? a.miejscowosc} ${a.miejscowosc}`)}-${hashAdresu(kluczUlicy(a))}`
}
