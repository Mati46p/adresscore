// Podpowiedzi wyszukiwarki (#185): adresy z `indeks.ts` i okolice z `szukajOkolic.ts` w jednej liście.
// Czysta logika bez DOM i bez Reacta (testy na gołym `node --test`).
//
// Zasady:
// - Wpis z numerem domu („Grodzka 52”) to adres: adresy mają pierwszeństwo, a okolice pojawiają się
//   dopiero wtedy, gdy adresów nie ma wcale („Osiedle Dywizjonu 303” ma cyfry, a jest nazwą).
// - Wpis bez numeru („Ruczaj”, „Kazimierz”) to najczęściej nazwa okolicy: okolice idą pierwsze, ale nie
//   zajmują całej listy – ulica o podobnej nazwie („Kazimierza Wielkiego”) zostaje w zasięgu wzroku.
// - Wyszukiwarka może szukać tylko okolic (bez adresów) albo tylko adresów: źródło, którego nie ma,
//   nie buduje indeksu (indeks 177 tys. adresów to ok. sekundy pracy przy pierwszym zapytaniu).
import { type Indeks, maNumerDomu, szukaj, type Wynik } from './indeks.ts'
import { type IndeksOkolic, szukajOkolic, type WynikOkolicy } from './szukajOkolic.ts'

export type Podpowiedz =
  | { rodzaj: 'adres'; klucz: string; tytul: string; opis: string; i: number }
  | { rodzaj: 'okolica'; klucz: string; tytul: string; opis: string; okolica: WynikOkolicy }

export interface ZrodlaPodpowiedzi {
  /** Indeks adresów (`indeksDla`); null = pole nie szuka adresów. */
  adresy: Indeks | null
  /** Indeks okolic (`indeksOkolicDla`); null = pole nie szuka okolic. */
  okolice: IndeksOkolic | null
}

/** Ile okolic może stać przed adresami, gdy zapytanie nie ma numeru. */
export const MAKS_OKOLIC_PRZED_ADRESAMI = 4

const jakoAdres = (w: Wynik): Podpowiedz => ({
  rodzaj: 'adres',
  klucz: `a:${w.i}`,
  tytul: w.tytul,
  opis: w.opis,
  i: w.i,
})

const jakoOkolica = (w: WynikOkolicy): Podpowiedz => ({
  rodzaj: 'okolica',
  klucz: `o:${w.id}`,
  tytul: w.tytul,
  opis: w.opis,
  okolica: w,
})

export function podpowiedzi(zapytanie: string, zrodla: ZrodlaPodpowiedzi, limit = 8): Podpowiedz[] {
  const adresy =
    zrodla.adresy && maNumerDomu(zapytanie) ? szukaj(zrodla.adresy, zapytanie, limit) : null
  if (adresy && adresy.length > 0) return adresy.map(jakoAdres)

  const okolice = zrodla.okolice ? szukajOkolic(zrodla.okolice, zapytanie, limit) : []
  if (!zrodla.adresy) return okolice.map(jakoOkolica)

  // Zapytanie bez numeru (albo z numerem, którego żaden adres nie ma): okolice, potem adresy.
  const reszta = adresy ?? szukaj(zrodla.adresy, zapytanie, limit)
  const przed = okolice.slice(0, MAKS_OKOLIC_PRZED_ADRESAMI)
  const lista = [...przed.map(jakoOkolica), ...reszta.map(jakoAdres)]
  // Okolice, które nie zmieściły się przed adresami, wypełniają wolne miejsce na końcu.
  for (const w of okolice.slice(MAKS_OKOLIC_PRZED_ADRESAMI)) {
    if (lista.length >= limit) break
    lista.push(jakoOkolica(w))
  }
  return lista.slice(0, limit)
}
