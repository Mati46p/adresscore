import { useEffect, useState } from 'react'

interface SzczegolyE8 {
  wersjaAdresow: string
  szkoly: { rspo: string; nazwa: string; wynik: number }[]
  najblizsza: (number | null)[]
  odleglosciM: (number | null)[]
}

// Szczegóły (1,4 MB) są potrzebne tylko po otwarciu karty adresu z wynikiem E8.
let pobieranie: Promise<SzczegolyE8> | null = null
function wczytajSzczegoly(): Promise<SzczegolyE8> {
  pobieranie ??= fetch('/dane/szkoly_e8_szczegoly.json').then((r) => {
    if (!r.ok) throw new Error(`Szczegóły szkół: ${r.status}`)
    return r.json() as Promise<SzczegolyE8>
  })
  return pobieranie
}

export function SzczegolySzkoly({ indeks, wersja }: { indeks: number; wersja: string }) {
  const [dane, ustawDane] = useState<SzczegolyE8 | null>(null)
  useEffect(() => {
    let aktywny = true
    void wczytajSzczegoly().then(
      (wynik) => {
        if (aktywny) ustawDane(wynik)
      },
      () => {},
    )
    return () => {
      aktywny = false
    }
  }, [])

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
