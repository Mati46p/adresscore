// Komponent bez UI, montowany raz w `src/App.tsx` (faza integracji): uruchamia pomiar i zamienia
// przejścia stanu aplikacji na zdarzenia (contracts/pomiar-klient.md, tabela przejść).
//
// UWAGA NA IMPORT: obok tego pliku leży `pomiar.ts` (API modułu). Systemy plików Windows i macOS
// nie rozróżniają wielkości liter, więc `import … from '@/pomiar/Pomiar'` rozwiązuje się tam do
// `pomiar.ts` (TS2305 + TS1261, a w `pnpm dev` błąd modułu). Importuj z rozszerzeniem:
//   import { Pomiar } from '@/pomiar/Pomiar.tsx'
// (`allowImportingTsExtensions` jest włączone). Z tego samego powodu importy w tym katalogu
// mają jawne rozszerzenia.
//
// Subskrybuje magazyn stanu bezpośrednio (`subskrybuj`), a nie przez `useStan`: pomiar niczego
// nie renderuje, więc nie ma po co przerysowywać go przy każdej zmianie suwaka. Reguły „co jest
// nową odsłoną, co jest krokiem lejka” są w `przejscia.ts` (czysta funkcja pod testem);
// tu jest tylko wykonanie akcji.
//
// ŚCIEŻKA ODSŁONY: `zapiszDoUrl` w stanie aktualizuje adres PRZED powiadomieniem subskrybentów,
// więc w subskrybencie `location` jest już nowy. Ścieżkę składa `sciezkaStrony` (pathname albo
// część hasha przed „?”) – nigdy query ani fragment z parametrami.

import { useEffect } from 'react'
import { pobierzStan, subskrybuj } from '@/wynik/stan'
import type { Ekran } from '@/wynik/url'
import { odslona, produktowe, startPomiaru } from './pomiar.ts'
import { type Migawka, migawka, przejscia } from './przejscia.ts'
import { sciezkaStrony } from './sciezka.ts'

export function Pomiar(): null {
  useEffect(() => {
    const zatrzymaj = startPomiaru()
    let poprzednia: Migawka | null = null

    const zastosuj = () => {
      const nastepna = migawka(pobierzStan())
      for (const akcja of przejscia(poprzednia, nastepna)) {
        if (akcja.rodzaj === 'odslona') {
          odslona(akcja.ekran as Ekran, sciezkaStrony(location.pathname, location.hash))
        } else {
          produktowe(akcja.nazwa, akcja.wlasciwosci)
        }
      }
      poprzednia = nastepna
    }

    zastosuj()
    const odsubskrybuj = subskrybuj(zastosuj)
    return () => {
      odsubskrybuj()
      zatrzymaj()
    }
  }, [])

  return null
}
