import { useEffect, useState } from 'react'
import { bazaDanych } from '@/kontrakty'
import { useMiasto } from '@/wynik/miastoDanych'
import { MAKS_MIAST_W_PAMIECI } from '@/wynik/pamiecDanych'
import { utworzPamiecPlikow } from '@/wynik/pamiecPlikow'
import { sciezkaSzkol } from '@/wynik/sciezkiDanych'

interface SzczegolyE8 {
  wersjaAdresow: string
  szkoly: { rspo: string; nazwa: string; wynik: number }[]
  najblizsza: (number | null)[]
  odleglosciM: (number | null)[]
}

// Szczegóły (1,4 MB w Krakowie, 0,2–1 MB w miastach) są potrzebne tylko po otwarciu karty adresu z
// wynikiem E8. Plik jest w każdym mieście (#223) pod tą samą nazwą, więc pamięć kluczuje pełna
// ścieżka z katalogiem miasta: zmiana miasta nie poda szkół Krakowa pod adresem z innego miasta
// (a `wersjaAdresow` niżej i tak odrzuci plik z innego zbioru adresów).
const pamiec = utworzPamiecPlikow<SzczegolyE8>(MAKS_MIAST_W_PAMIECI)
function wczytajSzczegoly(baza: string): Promise<SzczegolyE8> {
  const sciezka = sciezkaSzkol(baza)
  return pamiec.pobierz(sciezka, () =>
    fetch(sciezka).then((r) => {
      if (!r.ok) throw new Error(`Szczegóły szkół: ${r.status}`)
      return r.json() as Promise<SzczegolyE8>
    }),
  )
}

export function SzczegolySzkoly({ indeks, wersja }: { indeks: number; wersja: string }) {
  const baza = bazaDanych(useMiasto().slug)
  const [dane, ustawDane] = useState<SzczegolyE8 | null>(null)
  useEffect(() => {
    let aktywny = true
    void wczytajSzczegoly(baza).then(
      (wynik) => {
        if (aktywny) ustawDane(wynik)
      },
      () => {},
    )
    return () => {
      aktywny = false
    }
  }, [baza])

  if (!dane || dane.wersjaAdresow !== wersja) return null
  const szkolnyIndeks = dane.najblizsza[indeks]
  const metry = dane.odleglosciM[indeks]
  if (
    typeof szkolnyIndeks !== 'number' ||
    !Number.isInteger(szkolnyIndeks) ||
    typeof metry !== 'number'
  )
    return null
  const szkola = dane.szkoly[szkolnyIndeks]
  return szkola ? (
    <span>
      {' '}
      – {szkola.nazwa}, {metry.toLocaleString('pl-PL')} m w linii prostej
    </span>
  ) : null
}
