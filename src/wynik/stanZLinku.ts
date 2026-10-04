// Czysta logika „co stan bierze z linku i kiedy” (#108). Wydzielona ze `stan.ts`, żeby dało się ją
// testować na gołym `node --test` bez `window`, `location` i historii przeglądarki.
//
// Zasada: link jest źródłem prawdy w DWÓCH momentach – przy starcie i przy zmianie hasha
// (hashchange, Wstecz/Dalej) – a nie po wczytaniu adresów. Pola, które NIE potrzebują słownika
// adresów (branża, miejsca A–E i filtry Biznesu, obiekty symulatora), stan dostaje od razu, więc ekran
// startuje od wyboru z linku, a zmiana użytkownika w trakcie ładowania (2–12 s) nie jest cofana
// w chwili, gdy adresy się wczytają. Dopiero id adresu i lista porównania czekają na słownik.
import { BEZ_FILTROW, type FiltryUslug } from './biznesUslugi.ts'
import { type Ekran, ID_MIEJSC, type StanUrl } from './url.ts'

export interface PunktLinku {
  lon: number
  lat: number
}

/** Pola trybu „Biznes” w stanie aplikacji. */
export interface PolaBiznesu {
  branza: string
  /** Miejsca A–E, zawsze `ID_MIEJSC.length` pozycji (`null` = puste miejsce). */
  miejsca: readonly (PunktLinku | null)[]
  filtryBiznesu: FiltryUslug
}

/**
 * Wybór trybu „Biznes” z linku. Link mówi o branży, miejscach i filtrach tylko na ekranie Biznes;
 * na innych ekranach (np. `#/porownanie`) `null` znaczy „nic nie wiem o Biznesie”, więc stan zostaje
 * taki, jaki jest – tak samo jak obiekty symulatora. Wcześniej każdy hash bez tych parametrów
 * kasował branżę i punkty, więc powrót do Biznesu zaczynał od domyślnej branży.
 * Gołe `#/biznes` jest linkiem do Biznesu: domyślna branża, puste miejsca, filtry wyłączone.
 */
export function polaBiznesuZLinku(url: StanUrl): PolaBiznesu | null {
  if (url.ekran !== 'biznes') return null
  return {
    branza: url.branza ?? 'sklep',
    // `czytajHash` zawsze daje komplet pozycji; zapas tylko dla StanUrl złożonego ręcznie.
    miejsca: url.miejsca ?? ID_MIEJSC.map(() => null),
    filtryBiznesu: url.filtryBiznesu ?? BEZ_FILTROW,
  }
}

/**
 * Parametry linku, które należą do ekranu i nie zależą od słownika adresów (Biznes: `b`, `m` i stare
 * `a`, `c` sprzed miejsc A–E, żeby podmiana usunęła stary zapis; Miasto: `a`, `b`, `w`). Przed wczytaniem adresów
 * `zapiszDoUrl` nie składa hasha od zera (zgubiłby `u=`, `cmp=`, `p=`, które stan dostaje dopiero po
 * adresach), ale te klucze wolno podmienić w bieżącym linku: odświeżenie strony zaraz po zmianie
 * nie cofa wyboru.
 */
export const PARAMETRY_EKRANU: Readonly<Partial<Record<Ekran, readonly string[]>>> = {
  biznes: ['b', 'm', 'a', 'c', 'k'],
  miasto: ['a', 'b', 'w'],
}

function kluczSegmentu(segment: string): string {
  const i = segment.indexOf('=')
  return i < 0 ? segment : segment.slice(0, i)
}

function zapytanieHasha(hash: string): { sciezka: string; segmenty: string[] } {
  const i = hash.indexOf('?')
  const sciezka = i < 0 ? hash : hash.slice(0, i)
  const zapytanie = i < 0 ? '' : hash.slice(i + 1)
  return { sciezka, segmenty: zapytanie.split('&').filter(Boolean) }
}

/**
 * Bieżący hash z podmienionymi wyłącznie parametrami `klucze` (wartości z `hashStanu`, brak w stanie
 * = usunięcie). Reszta parametrów zostaje bajt w bajt, ścieżka też. Segmenty nie są dekodowane ani
 * składane od nowa, więc `u={…}` i inne zapisy nie zmieniają kodowania.
 */
export function zPodmienionymiParametrami(
  hashObecny: string,
  hashStanu: string,
  klucze: readonly string[],
): string {
  const obecny = zapytanieHasha(hashObecny)
  const stanu = zapytanieHasha(hashStanu)
  const zostaja = obecny.segmenty.filter((s) => !klucze.includes(kluczSegmentu(s)))
  const nowe = stanu.segmenty.filter((s) => klucze.includes(kluczSegmentu(s)))
  const zapytanie = [...zostaja, ...nowe].join('&')
  return zapytanie ? `${obecny.sciezka}?${zapytanie}` : obecny.sciezka
}
