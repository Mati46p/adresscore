// Przegląd wszystkich miast (#223, faza F3): `usePrzeglad()` daje mapie tło z kolorami miast innych niż
// bieżące, r10 bieżącego miasta przed pełnymi danymi i miasto pod punktem. Dane to kompakty wszystkich
// miast (kilkaset kB na start, warstwy dociągane po pierwszym kolorze), liczone tym samym silnikiem i
// tymi samymi wagami co bieżące miasto. Pełne dane (adresy, wszystkie warstwy) ma wyłącznie bieżące
// miasto (`dane.ts`, FR-005).
//
// Ten plik to klej: prawdziwa sieć (`fetch`), rejestr miast, stan aplikacji i React. Logika siedzi w
// plikach bez `import.meta.env`, żeby `node --test` mógł ją sprawdzić:
//   przegladMenedzer.ts – ładowanie i kolejność pobrań (bieżące miasto pierwsze, tło po 3 naraz),
//   przegladSklad.ts    – złożenie `Przeglad` z danych i ustawień widoku, stabilne referencje,
//   przegladLiczenie.ts – arytmetyka: kolory, tło, granice, miasto pod punktem.
// Kontrakt: specs/002-wszystkie-miasta/contracts/przeglad.md.
import { useEffect, useSyncExternalStore } from 'react'
import { bazaDanych, MIASTA, wczytajManifest } from '@/kontrakty'
import { useDane } from './dane.ts'
import { utworzMenedzerPrzegladu } from './przegladMenedzer.ts'
import { type Przeglad, utworzSkladacz } from './przegladSklad.ts'
import { dodajMetaMiasta, useStan } from './stan.ts'

export type { Przeglad, StanPrzegladuMiasta } from './przegladSklad.ts'

async function pobierz(url: string): Promise<Response> {
  const odp = await fetch(url)
  if (!odp.ok) throw new Error(`${url}: HTTP ${odp.status}`)
  return odp
}

/**
 * Tabela do SC-002 (dodatkowy transfer przeglądu ≤ 2,5 MB): dla każdego miasta liczba heksów na trzech
 * poziomach, liczba wczytanych warstw i bajty plików przeglądu (manifest, indeks, heksy, warstwy)
 * z Resource Timing. W dev Vite nie kompresuje JSON-ów, więc liczba jest górną granicą; pomiar
 * z kompresją to build + `pnpm preview` albo produkcja (T060).
 */
function podsumowanie() {
  const zasoby = new Map<string, number>()
  for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    zasoby.set(e.name, e.encodedBodySize || e.transferSize)
  }
  const wpisy = menedzer.migawka().wpisy
  const wiersze = MIASTA.map((m) => {
    const wpis = wpisy.get(m.slug)
    const baza = new URL(`${bazaDanych(m.slug)}/`, location.href).href
    let bajty = 0
    let pliki = 0
    for (const [adres, rozmiar] of zasoby) {
      if (
        adres === `${baza}manifest.json` ||
        adres === `${baza}kompakt/indeks.json` ||
        adres.startsWith(`${baza}kompakt/heksy.`) ||
        adres.startsWith(`${baza}kompakt/warstwy/`)
      ) {
        bajty += rozmiar
        pliki++
      }
    }
    const poziomy = wpis?.stan === 'gotowe' ? wpis.podstawa.poziomy : null
    return {
      miasto: m.nazwa,
      stan: wpis?.stan ?? 'ładuje się',
      r8: poziomy?.[8].heksy.length ?? null,
      r9: poziomy?.[9].heksy.length ?? null,
      r10: poziomy?.[10].heksy.length ?? null,
      warstw: wpis?.stan === 'gotowe' ? wpis.warstwy.size : null,
      plikow: pliki,
      kB: Math.round(bajty / 1024),
    }
  })
  const bezBiezacego = wiersze.slice(1)
  return {
    wiersze,
    // Bez Krakowa, bo SC-002 mierzy to, co przybywa ponad dotychczasowy start Krakowa.
    razemPozaKrakowemKB: bezBiezacego.reduce((suma, w) => suma + w.kB, 0),
  }
}

function zalogujPodsumowanie() {
  const { wiersze, razemPozaKrakowemKB } = podsumowanie()
  console.info(
    `[przegląd] wszystkie miasta gotowe. Pliki przeglądu poza Krakowem: ${razemPozaKrakowemKB} kB (SC-002: do 2560 kB po kompresji)`,
  )
  console.table(wiersze)
}

const menedzer = utworzMenedzerPrzegladu({
  miasta: MIASTA.map((m) => m.slug),
  baza: bazaDanych,
  manifest: (baza) => wczytajManifest(baza),
  json: async <T>(url: string) => (await (await pobierz(url)).json()) as T,
  bajty: async (url) => (await pobierz(url)).arrayBuffer(),
  dodajMetaMiasta,
  ostrzez: (komunikat, powod) => console.warn(komunikat, powod),
  poUstabilizowaniu: import.meta.env.DEV ? zalogujPodsumowanie : undefined,
})

if (import.meta.env.DEV) {
  // Domyślny bufor Resource Timing (250 wpisów) mieści mniej plików, niż przegląd pobiera.
  performance.setResourceTimingBufferSize(2000)
  Object.assign(globalThis, {
    przegladPodsumowanie: () => {
      const p = podsumowanie()
      console.table(p.wiersze)
      return p
    },
  })
}

const zloz = utworzSkladacz()

/**
 * Przegląd wszystkich miast. Pierwsze użycie uruchamia ładowanie: bieżące miasto pierwsze, reszta po jego
 * pierwszym kolorze. Wynik jest ten sam (`===`), dopóki nie zmieni się jego zawartość.
 */
export function usePrzeglad(): Przeglad {
  const migawka = useSyncExternalStore(menedzer.subskrybuj, menedzer.migawka, menedzer.migawka)
  const biezace = useStan((s) => s.miasto)
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const warstwa = useStan((s) => s.warstwa)
  // r10 bieżącego miasta z kompaktu jest potrzebne tylko do czasu, aż mapa dostanie wynik z pełnych
  // danych (`useWyniki`); potem liczenie 35 tys. heksów przy każdej zmianie profilu byłoby zbędne.
  const r10 = useDane().stan !== 'gotowe'
  const { przeglad, potrzeby } = zloz(migawka, { biezace, wagi, kierunki, warstwa, r10 })
  useEffect(() => {
    menedzer.zazadaj(biezace, potrzeby)
  }, [biezace, potrzeby])
  return przeglad
}
