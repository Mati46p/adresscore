// Klasa urządzenia z user-agenta. Liczona LOKALNIE: do sieci wychodzi klasa (4 wartości),
// nigdy sam UA – serwer zna UA tylko z nagłówka żądania i używa go wyłącznie w pamięci
// (odcisk dobowy, rodzina bota), więc w bazie nie ma nigdzie pełnego UA (SC-006).
//
// Rozpoznanie jest grube i zachowawcze: chodzi o podział „telefon / tablet / komputer”,
// a nie o fingerprinting. Nie czytamy wersji, modelu ani rozdzielczości ekranu.

import type { Urzadzenie } from './kontrakt.ts'

/** Telewizory, konsole i dekodery: przeglądarka jest, ale to ani telefon, ani komputer. */
const INNE_URZADZENIA =
  /SMART-TV|SmartTV|HbbTV|Tizen|Web0S|WebOS|NetCast|PlayStation|Xbox|Nintendo|AppleTV|CrKey|BRAVIA/i

/** Tablety rozpoznawalne po nazwie (Android bez „Mobile” łapie osobna reguła). */
const TABLETY = /iPad|Tablet|PlayBook|Kindle|Silk\/|Nexus (?:7|9|10)\b/i

const TELEFONY = /iPhone|iPod|Mobi|Windows Phone|IEMobile|BlackBerry|Opera Mini|webOS/i

const KOMPUTERY = /Windows NT|Macintosh|X11|Linux|CrOS|FreeBSD|OpenBSD|NetBSD/i

/** Przeglądarka przedstawiająca się w standardowy sposób (w odróżnieniu od curl, python-requests…). */
const PRZEGLADARKA = /^(?:Mozilla|Opera)\//

/**
 * Klasa urządzenia z UA.
 * - `punktyDotyku` (`navigator.maxTouchPoints`): iPadOS 13+ podaje w UA „Macintosh”, tabletem
 *   zdradza go tylko ekran dotykowy; komputer z macOS ma 0.
 * - `szerokosc` (szerokość okna w px): używana wyłącznie, gdy UA wygląda na przeglądarkę, ale nie
 *   zdradza systemu – wtedy lepsza jest zgrubna klasa po szerokości niż „inne”.
 * Brak UA albo klient niebędący przeglądarką (skrypt) to „inne”.
 */
export function klasaUrzadzeniaZUa(
  ua: string | null | undefined,
  szerokosc?: number,
  punktyDotyku?: number,
): Urzadzenie {
  if (!ua) return 'inne'
  if (INNE_URZADZENIA.test(ua)) return 'inne'
  if (TABLETY.test(ua)) return 'tablet'
  if (/Macintosh/.test(ua) && (punktyDotyku ?? 0) > 1) return 'tablet'
  // Android bez „Mobile” w UA to tablet (telefony Chrome’a zawsze dopisują „Mobile”).
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'mobile' : 'tablet'
  if (TELEFONY.test(ua)) return 'mobile'
  if (KOMPUTERY.test(ua)) return 'desktop'
  if (PRZEGLADARKA.test(ua) && szerokosc !== undefined && Number.isFinite(szerokosc)) {
    if (szerokosc < 600) return 'mobile'
    if (szerokosc < 1024) return 'tablet'
    return 'desktop'
  }
  return 'inne'
}
