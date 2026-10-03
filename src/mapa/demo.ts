import { wczytajAdresy, wczytajWskaznik } from '@/kontrakty'

// Do ręcznego testu mapy bez silnika wyniku: udział zieleni wprost jako wynik 0–100,
// średnia po adresach w heksie. Brak danych adresu nie wchodzi do średniej (nigdy jako 0).
export async function heksyDemo(wskaznik = 'zielen_udzial'): Promise<Map<string, number | null>> {
  const plik = await wczytajAdresy()
  const w = await wczytajWskaznik(wskaznik, plik.wersja)
  const sumy = new Map<string, { suma: number; n: number }>()
  plik.kolumny.h3.forEach((h, i) => {
    const s = sumy.get(h) ?? { suma: 0, n: 0 }
    sumy.set(h, s)
    const v = w?.wartosci[i]
    if (v === null || v === undefined) return
    s.suma += v
    s.n++
  })
  const wynik = new Map<string, number | null>()
  for (const [h, { suma, n }] of sumy) wynik.set(h, n ? Math.min(100, Math.max(0, suma / n)) : null)
  return wynik
}
