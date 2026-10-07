// Teksty i drobne decyzje ekranów zależne od bieżącego miasta (#223, F6). Czyste funkcje bez Reacta,
// DOM i `import.meta.env`, więc testy idą na gołym `node --test` (miastoTeksty.test.ts); komponenty
// tylko je wołają. Względne importy z `.ts`, bo Node nie zna aliasu `@/`.
//
// Zasada: Kraków zostaje przy dotychczasowych brzmieniach (tytuł karty i adres kanoniczny są te same
// co w HTML z serwera: index.html, api/seo.js), a każde inne miasto dostaje własną nazwę.
import { MIASTO_DOMYSLNE, type SlugMiasta } from '../kontrakty/miasta.ts'
import type { Ekran, StanUrl } from '../wynik/url.ts'

/** Z `Miasto` rejestru tekstom wystarczą te trzy pola. */
export interface MiastoTekstu {
  slug: SlugMiasta
  nazwa: string
  /** „w Krakowie", „we Wrocławiu". */
  wMiescie: string
}

/** h1 ekranu Szukaj: „Znajdź okolicę w Krakowie", „Znajdź okolicę we Wrocławiu". */
export function naglowekSzukaj(m: Pick<MiastoTekstu, 'wMiescie'>): string {
  return `Znajdź okolicę ${m.wMiescie}`
}

/**
 * Nazwa miasta w bierniku do „Przełącz na …”. Rejestr zna tylko mianownik i miejscownik, a wśród dziesięciu
 * miast zmienia się jedna nazwa (Warszawa → Warszawę): miasta na „-a” dostają „-ę”, reszta zostaje (Łódź,
 * Poznań, Bydgoszcz i Białystok mają biernik równy mianownikowi). Test przechodzi po rejestrze i
 * wymaga wpisu dla każdego miasta, więc dodanie miasta z inną końcówką zapali czerwone światło.
 */
export function biernikMiasta(nazwa: string): string {
  return nazwa.endsWith('a') ? `${nazwa.slice(0, -1)}ę` : nazwa
}

/**
 * Tytuł karty przeglądarki (przed dopiskiem „– adresscore”). Ekrany z własnym adresem w HTML z serwera
 * (strona główna, katalog, metoda) mają dla Krakowa te same tytuły co serwer – Google indeksuje tytuł po
 * wykonaniu JS, więc rozjazd podmieniłby go. Inne miasto dostaje własną nazwę.
 */
export function tytulEkranu(ekran: Ekran, m: MiastoTekstu, nazwaAdresu: string): string {
  const krakow = m.slug === MIASTO_DOMYSLNE
  switch (ekran) {
    case 'okolica':
      return `${nazwaAdresu}: okolica w liczbach`
    case 'porownanie':
      return 'Porównanie'
    case 'metoda':
      return 'Metoda i źródła danych – jak liczymy wynik adresu'
    case 'biznes':
      return 'Miejsce na biznes'
    case 'katalog':
      return krakow ? 'Katalog adresów Krakowa' : `Katalog adresów: ${m.nazwa}`
    case 'miasto':
      return 'Dla miasta: luki w usługach i symulator inwestycji'
    default:
      return krakow
        ? 'Jakość życia pod każdym adresem w Krakowie i okolicach'
        : `Jakość życia pod każdym adresem ${m.wMiescie}`
  }
}

/**
 * Ścieżka adresu kanonicznego (`<link rel="canonical">`). Strony SEO – karta adresu `/adres/<slug>` i
 * ulice `/katalog` – powstają z adresów Krakowa (FR-015): adres kanoniczny karty z innego miasta nie
 * miałby strony, a wskazanie na nieistniejącą ścieżkę to błąd w oczach wyszukiwarki. Takie ekrany żyją
 * pod `/#/…`, więc ich adresem kanonicznym jest strona główna. Metoda jest wspólna dla wszystkich miast.
 *
 * `sciezkaAdresu` to `/adres/<slug>` wybranego adresu (tylko Kraków ma taką stronę), `pathname` – ścieżka
 * otwartej strony (ulica z katalogu ma własną).
 */
export function sciezkaKanoniczna(wejscie: {
  ekran: Ekran
  miasto: SlugMiasta
  sciezkaAdresu: string | null
  pathname: string
}): string {
  const { ekran, miasto, sciezkaAdresu, pathname } = wejscie
  if (ekran === 'metoda') return '/metoda'
  if (miasto !== MIASTO_DOMYSLNE) return '/'
  if (ekran === 'okolica' && sciezkaAdresu) return sciezkaAdresu
  if (ekran === 'katalog') return pathname.startsWith('/katalog/') ? pathname : '/katalog'
  return '/'
}

/**
 * Czy link, z którym wchodzimy do aplikacji, wskazuje miejsce – miasto (`mst=`) albo adres (`#/adres/…`,
 * `/adres/<slug>`). FR-012: taki link startuje przy tym miejscu, a bez niego mapa pokazuje wszystkie
 * miasta naraz. Link z samym profilem (`p=`, `u=`) ani ekranem miejsca nie wskazuje.
 */
export function linkWskazujeMiejsce(
  url: Pick<StanUrl, 'miasto' | 'idAdresu' | 'nieznaneMiasto'>,
  pathname: string,
): boolean {
  return (
    url.miasto !== undefined ||
    url.nieznaneMiasto === true ||
    url.idAdresu !== null ||
    pathname.startsWith('/adres/')
  )
}

/** Od tego zoomu (poziom ulicy) kamera nad innym miastem zmienia bieżące miasto albo to proponuje (D5). */
export const ZOOM_ZMIANY_MIASTA = 11

export type DecyzjaKamery =
  | { akcja: 'nic' }
  | { akcja: 'przelacz'; miasto: SlugMiasta }
  | { akcja: 'zaproponuj'; miasto: SlugMiasta }

/**
 * Co zrobić po zatrzymaniu kamery (D5, FR-006c). Miasto zmienia się samo tylko wtedy, gdy kamera stoi
 * nad innym miastem przy zbliżeniu ulicznym i nie ma czego stracić; z wybranym adresem albo porównaniem
 * zmiana wyczyściłaby pracę użytkownika, więc proponujemy ją przyciskiem „Przełącz na …”.
 * `podSrodkiem` to miasto pod środkiem kadru (`przeglad.miastoPunktu`), `null` = poza miastami.
 */
export function decyzjaKamery(wejscie: {
  zoom: number
  podSrodkiem: SlugMiasta | null
  biezace: SlugMiasta
  maWybor: boolean
}): DecyzjaKamery {
  const { zoom, podSrodkiem, biezace, maWybor } = wejscie
  // `!(… >= …)`, żeby NaN (mapa bez wymiarów) nie przełączał miasta.
  if (!(zoom >= ZOOM_ZMIANY_MIASTA)) return { akcja: 'nic' }
  if (podSrodkiem === null || podSrodkiem === biezace) return { akcja: 'nic' }
  return { akcja: maWybor ? 'zaproponuj' : 'przelacz', miasto: podSrodkiem }
}

/** Co zmiana miasta usuwa ze stanu: wybrany adres i porównanie (FR-007). */
export interface CoSieCzysci {
  adres: boolean
  porownanie: boolean
}

function wyliczCzyszczone({ adres, porownanie }: CoSieCzysci): string {
  if (adres && porownanie) return 'wybrany adres i porównanie'
  return adres ? 'wybrany adres' : 'porównanie'
}

/** Ogłoszenie dla czytnika ekranu po zmianie miasta (FR-007): „Bieżące miasto: Łódź. Wyczyszczono porównanie.” */
export function ogloszenieZmianyMiasta(nazwa: string, wyczyszczono: CoSieCzysci): string {
  const baza = `Bieżące miasto: ${nazwa}.`
  return wyczyszczono.adres || wyczyszczono.porownanie
    ? `${baza} Wyczyszczono ${wyliczCzyszczone(wyczyszczono)}.`
    : baza
}

/** Ostrzeżenie przy propozycji „Przełącz na …”: czego zmiana miasta nie oszczędzi. */
export function ostrzezenieOPrzelaczeniu(czyscimy: CoSieCzysci): string {
  return `Przełączenie wyczyści ${wyliczCzyszczone(czyscimy)}.`
}
