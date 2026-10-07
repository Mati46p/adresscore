// Układ plików pobocznych zbioru danych (#223): ścieżki liczone od katalogu danych miasta, czyli od
// `bazaDanych(slug)` (`src/kontrakty`) albo `bazaBiezaca()` (`miastoDanych.ts`). Jedno miejsce zamiast
// składania adresów w każdym pliku z osobna; tabela plików: specs/002-wszystkie-miasta/contracts/miasta.md.
//
// Czysty moduł bez `import.meta.env`, stanu i Reacta: korzystają z niego komponenty, workery i test.
// Worker nie zna bieżącego miasta (ma własną kopię modułów stanu, więc widzi zawsze Kraków) – dostaje
// katalog danych w wiadomości od wątku głównego, sprawdza go tu (`czyKatalogDanych`) i składa z niego
// ścieżki. Test `sciezkiDanych.test.ts` porównuje ten układ z plikami w `public/dane`: miasto bez pliku,
// który kod zakłada, i plik krakowski, który pojawił się w mieście, dają czerwony test.
import { MIASTA } from '../kontrakty/miasta.ts'

const SEGMENT_KATALOGU = '[A-Za-z0-9_-]+'
const KATALOG_DANYCH = new RegExp(`^(?:/${SEGMENT_KATALOGU})+$`)

/**
 * Czy `baza` wygląda jak katalog danych zbioru (`/dane`, `/dane/miasta/lublin`): ścieżka od korzenia
 * serwisu z samych bezpiecznych segmentów, bez `..`, `//`, zapytania, fragmentu i końcowego ukośnika.
 * Wiadomość do workera przechodzi przez to sprawdzenie, zanim ścieżka trafi do `fetch`.
 */
export function czyKatalogDanych(baza: unknown): baza is string {
  return typeof baza === 'string' && KATALOG_DANYCH.test(baza)
}

const GRAF = 'dojazd/graf.json'

/** Graf rozkładu jazdy miasta (`etl/dojazd-gtfs-graf.mjs`); jest w każdym zbiorze. */
export const sciezkaGrafu = (baza: string) => `${baza}/${GRAF}`

/** Czy `sciezka` to graf dojazdu jakiegoś zbioru (worker nie pobiera niczego innego). */
export function czySciezkaGrafu(sciezka: unknown): sciezka is string {
  return (
    typeof sciezka === 'string' &&
    sciezka.endsWith(`/${GRAF}`) &&
    czyKatalogDanych(sciezka.slice(0, -(GRAF.length + 1)))
  )
}

/** Katalog branż trybu Biznes (`etl/uslugi.mjs`); jest w każdym zbiorze. */
export const sciezkaKataloguUslug = (baza: string) => `${baza}/uslugi/katalog.json`

/** Punkty jednej branży; `id` musi pochodzić z katalogu (małe litery i podkreślenia), nie z linku. */
export const sciezkaBranzy = (baza: string, id: string) => `${baza}/uslugi/${id}.json`

/** Popyt trybu Biznes (`etl/biznes-popyt.md`); tylko Kraków z obwarzankiem, patrz `popytDostepny`. */
export const sciezkaPopytu = (baza: string) => `${baza}/biznes/popyt.json`

/** Szczegóły szkół z wynikiem E8 (nazwa i odległość najbliższej szkoły); jest w każdym zbiorze. */
export const sciezkaSzkol = (baza: string) => `${baza}/szkoly_e8_szczegoly.json`

/** Kafel budynków 3D (komórka H3 r7); jest w każdym zbiorze. */
export const sciezkaKafla = (baza: string, h3: string) => `${baza}/budynki/${h3}.json`

/**
 * Czy zbiór pod katalogiem `baza` ma popyt trybu Biznes (D8). Tylko Kraków: katalogi miast
 * (`miasta/<slug>` z rejestru) go nie mają, więc tryb Biznes tam nie pobiera niczego i mówi to wprost.
 * Katalog miasta poznajemy po rejestrze miast, a nie po liście zapisanej drugi raz; gdyby ETL dołożył
 * popyt jakiemuś miastu, test porównujący to z plikami zgłosi, że warunek trzeba zdjąć.
 */
export function popytDostepny(baza: string): boolean {
  return !MIASTA.some((m) => m.katalog !== '' && baza.endsWith(`/${m.katalog}`))
}
