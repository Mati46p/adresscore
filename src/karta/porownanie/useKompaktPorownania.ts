// Hooki porównania bez pełnych danych (#247, B7b). Pełne dane (adresy.json, wskazniki/*.json) są
// potrzebne tylko wtedy, gdy kompakt nie ma `kolejnosc` w id.bin (stary format) – wtedy bramka się otwiera.
import { useEffect, useState } from 'react'
import { type Adres, bazaDanych } from '@/kontrakty'
import { pozwolNaPelneDane } from '@/wynik/dane'
import { przypnijAdresy, wczytajKafleAdresow, wczytajMapeAdresow } from '@/wynik/kafle'
import { type IndeksKompaktu, rozpakuj } from '@/wynik/kompakt'
import type { StanDanychHeksow } from '@/wynik/kompaktBiezacy'
import { przegladMenedzer } from '@/wynik/przeglad'
import { useStan } from '@/wynik/stan'
import { useStartKompakt, wczytajSkaleKafli } from '@/wynik/startKompakt'
import { adresyZSzukaj, kolejnoscZMapy } from './zKafli'

/**
 * Kompakt bieżącego miasta dla ekranu spoza Szukaj. Wpis przeglądu (indeks, manifest, podstawa) zamawiamy
 * bez żadnych warstw – porównanie nie rysuje mapy, więc nie ściąga heksów. Dalej jak Szukaj: meta warstw
 * i słownik id do stanu, a kompakt bez rozszerzeń otwiera bramkę pełnych danych.
 */
export function useKompaktEkranu(pelne: boolean): StanDanychHeksow {
  const miasto = useStan((s) => s.miasto)
  useEffect(() => {
    przegladMenedzer.zazadaj(miasto, new Map())
  }, [miasto])
  return useStartKompakt(pelne)
}

/**
 * Trzyma w pamięci kafle adresów porównania (przypięte w LRU) i dociąga brakujące. Stary `id.bin` bez
 * `kolejnosc` nie wskaże kafla – wtedy otwieramy pełne dane (ścieżka zapasowa).
 */
export function useKafleAdresow(hk: StanDanychHeksow, adresy: readonly number[], aktywne: boolean) {
  const klucz = adresy.join(',')
  const indeks = hk.stan === 'gotowe' ? hk.indeks : null
  const miasto = hk.stan === 'gotowe' ? hk.miasto : null
  useEffect(() => {
    if (!aktywne || !indeks || !miasto) return
    przypnijAdresy(adresy)
    if (adresy.length === 0) return
    let aktualne = true
    const baza = bazaDanych(miasto)
    wczytajMapeAdresow(baza, indeks)
      .then(async (mapa) => {
        if (!aktualne) return
        if (!mapa) {
          pozwolNaPelneDane()
          return
        }
        const skale = await wczytajSkaleKafli(miasto, indeks)
        if (aktualne) await wczytajKafleAdresow(baza, indeks, adresy, skale)
      })
      .catch((e: unknown) => console.warn('Kafle adresów porównania niedostępne', e))
    return () => {
      aktualne = false
    }
    // `adresy` zmienia się razem z `klucz` (ta sama treść = ta sama lista).
  }, [aktywne, indeks, miasto, klucz])
}

const szukajObietnice = new WeakMap<IndeksKompaktu, Promise<Adres[]>>()

/** Lista adresów do wyszukiwarki z `szukaj.bin` + `kolejnosc`; jedno pobranie na indeks kompaktu. */
function wczytajAdresyWyszukiwarki(
  miasto: Parameters<typeof bazaDanych>[0],
  indeks: IndeksKompaktu,
) {
  let p = szukajObietnice.get(indeks)
  if (!p) {
    const baza = bazaDanych(miasto)
    p = (async () => {
      const [odp, mapa] = await Promise.all([
        fetch(`${baza}/kompakt/${indeks.szukaj.plik}`),
        wczytajMapeAdresow(baza, indeks),
      ])
      if (!odp.ok) throw new Error(`szukaj: HTTP ${odp.status}`)
      if (!mapa) throw new Error('Kompakt bez kolejności adresów')
      return adresyZSzukaj(await rozpakuj(await odp.arrayBuffer()), kolejnoscZMapy(mapa))
    })()
    p.catch(() => szukajObietnice.delete(indeks))
    szukajObietnice.set(indeks, p)
  }
  return p
}

/**
 * Adresy kandydatów do dodania, bez pełnych danych. Pobiera `szukaj.bin` dopiero przy fokusie w polu
 * (`aktywne`) – to kilka MB, a większość odwiedzin porównania niczego nie dodaje. null do czasu pobrania.
 */
export function useAdresyWyszukiwarki(hk: StanDanychHeksow, aktywne: boolean): Adres[] | null {
  const [wynik, ustaw] = useState<{ indeks: IndeksKompaktu; adresy: Adres[] } | null>(null)
  const indeks = hk.stan === 'gotowe' ? hk.indeks : null
  const miasto = hk.stan === 'gotowe' ? hk.miasto : null
  useEffect(() => {
    if (!aktywne || !indeks || !miasto) return
    let aktualne = true
    wczytajAdresyWyszukiwarki(miasto, indeks).then(
      (adresy) => aktualne && ustaw({ indeks, adresy }),
      (e: unknown) => {
        console.warn('Lista adresów do wyszukiwarki niedostępna', e)
        pozwolNaPelneDane()
      },
    )
    return () => {
      aktualne = false
    }
  }, [aktywne, indeks, miasto])
  return wynik && wynik.indeks === indeks ? wynik.adresy : null
}
