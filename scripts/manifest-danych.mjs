// Manifest wskaźników składany z plików katalogu `wskazniki/`. Wspólny dla wtyczki Vite
// (vite.config.ts: dev) i skryptu wysyłki danych (scripts/dane-wyslij.mjs), bo na produkcji dane
// leżą poza repo i obrazem (#237): manifesty powstają tam, gdzie są dane, i jadą razem z nimi.
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
} from 'node:fs'
import { join } from 'node:path'

// Bufor na fragment pliku wskaźnika; wspólny, bo odczyt jest synchroniczny.
const FRAGMENT_PLIKU = Buffer.alloc(65536)

/** Tekst z `dlugosc` bajtów pliku od `pozycja` (nie więcej niż bufor). */
function fragmentPliku(fd, pozycja, dlugosc) {
  return FRAGMENT_PLIKU.toString('utf8', 0, readSync(fd, FRAGMENT_PLIKU, 0, dlugosc, pozycja))
}

/**
 * `meta` i `wersjaAdresow` pliku wskaźnika bez parsowania tablic wartości. Plik ma 0,3–2 MB, prawie
 * cały to `wartosci`, a manifest czyta ich setki (739 w 10 zbiorach, 806 MB): pełny `JSON.parse`
 * trwał ok. 22 s w buildzie i blokował serwer dev przy każdym żądaniu manifestu miasta, a sam
 * początek pliku to ok. 0,5 s. ETL zapisuje `meta` i `wersjaAdresow` przed `wartosci` (wszystkie
 * pliki z 2026-10-07 mają tę kolejność), więc wystarcza prefiks do klucza `wartosci`. Inna kolejność
 * kluczy, za długie `meta` albo plik nieskończony na `}` (przerwany zapis) = pełny odczyt: ten sam
 * wynik, a przy uciętym JSON-ie błąd składni jak przed #223, tylko wolniej.
 */
export function metaWskaznika(plik) {
  const fd = openSync(plik, 'r')
  try {
    const poczatek = fragmentPliku(fd, 0, FRAGMENT_PLIKU.length)
    const koniec = poczatek.indexOf(',"wartosci":')
    const ogon = fragmentPliku(fd, Math.max(0, fstatSync(fd).size - 16), 16)
    if (koniec > 0 && ogon.trimEnd().endsWith('}')) {
      try {
        const wynik = JSON.parse(`${poczatek.slice(0, koniec)}}`)
        if (wynik.meta && typeof wynik.wersjaAdresow === 'string') return wynik
      } catch {
        // Prefiks nie jest kompletnym obiektem: czytamy cały plik.
      }
    }
  } finally {
    closeSync(fd)
  }
  return JSON.parse(readFileSync(plik, 'utf8'))
}

/** JSON manifestu dla katalogu `wskazniki/` (pusty katalog = pusta lista). */
export function zbudujManifest(katalog) {
  const pliki = existsSync(katalog) ? readdirSync(katalog).filter((p) => p.endsWith('.json')) : []
  const wskazniki = pliki.sort().map((p) => {
    const { meta, wersjaAdresow } = metaWskaznika(join(katalog, p))
    return { ...meta, wersjaAdresow }
  })
  return JSON.stringify({ wygenerowano: new Date().toISOString(), wskazniki })
}

/** Slugi miast, które mają katalog wskaźników w `<korzen>/miasta`. */
export function slugiMiast(korzenDanych) {
  const katalogMiast = join(korzenDanych, 'miasta')
  return existsSync(katalogMiast)
    ? readdirSync(katalogMiast, { withFileTypes: true })
        .filter((w) => w.isDirectory() && existsSync(join(katalogMiast, w.name, 'wskazniki')))
        .map((w) => w.name)
        .sort()
    : []
}
