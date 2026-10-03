import { czytajHash, type StanUrl, zapiszHash } from './url.ts'

const KLUCZ = 'adresscore:preferencje:v1'
type Rodzaj = 'mieszkanie' | 'biznes'

function kluczTrybu(rodzaj: Rodzaj): string {
  return `adresscore:preferencje:${rodzaj}:v1`
}

/** Preferencje żyją w bieżącej karcie przeglądarki, także po otwarciu czystego linku adresu. */
export function odczytajPreferencje(): StanUrl | null {
  try {
    const zapis = sessionStorage.getItem(KLUCZ)
    return zapis ? czytajHash(zapis) : null
  } catch {
    return null
  }
}

/** Ostatnie ustawienia obu zastosowań pozostają dostępne po zmianie adresu i pełnym przeładowaniu. */
export function odczytajPreferencjeTrybu(rodzaj: Rodzaj): StanUrl | null {
  try {
    const zapis = sessionStorage.getItem(kluczTrybu(rodzaj))
    return zapis ? czytajHash(zapis) : null
  } catch {
    return null
  }
}

export function zapiszPreferencje(url: StanUrl): void {
  try {
    const zapis = zapiszHash({ ...url, ekran: 'szukaj', idAdresu: null, porownanie: [] })
    sessionStorage.setItem(KLUCZ, zapis)
    sessionStorage.setItem(kluczTrybu(url.tryb === 'biznes' ? 'biznes' : 'mieszkanie'), zapis)
  } catch {
    // Aplikacja działa też przy zablokowanym sessionStorage.
  }
}

/** Parametry starego linku hash mają pierwszeństwo przed zapisem sesji. */
export function polaczPreferencje(url: StanUrl, hash: string, zapis: StanUrl | null): StanUrl {
  if (!zapis) return url
  const parametry = new URLSearchParams(hash.split('?')[1] ?? '')
  const maUstawienia = parametry.has('u')
  const maPersone = parametry.has('p')
  return {
    ...url,
    persona: maUstawienia || maPersone ? url.persona : zapis.persona,
    tryb: parametry.has('t') ? url.tryb : zapis.tryb,
    biznes: parametry.has('biz') ? url.biznes : zapis.biznes,
    ustawienia: maUstawienia ? url.ustawienia : maPersone ? null : zapis.ustawienia,
    filtry: parametry.has('f') ? url.filtry : zapis.filtry,
  }
}
