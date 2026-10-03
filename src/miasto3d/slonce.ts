// Czas i słońce dla cienia (#21): czyste funkcje, testy na gołym `node --test`.
// Suwaki mówią czasem lokalnym Krakowa (z przejściem CET/CEST), a deck.gl `_SunLight`
// chce znacznika UTC – stąd przeliczenie przez Intl z prawdziwą strefą Europe/Warsaw.

const STREFA = 'Europe/Warsaw'
const MIN_MS = 60_000
const DZIEN_MS = 86_400_000

/** Przesunięcie Warszawy względem UTC w minutach (60 zimą, 120 latem) w danej chwili. */
export function przesuniecieWarszawy(utcMs: number): number {
  const czesci = new Intl.DateTimeFormat('en-US', {
    timeZone: STREFA,
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date(utcMs))
  const nazwa = czesci.find((c) => c.type === 'timeZoneName')?.value ?? 'GMT+1'
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(nazwa)
  if (!m) return 60
  const godziny = Number(m[1])
  return godziny * 60 + Math.sign(godziny) * Number(m[2] ?? 0)
}

export function liczbaDniRoku(rok: number): number {
  return (rok % 4 === 0 && rok % 100 !== 0) || rok % 400 === 0 ? 366 : 365
}

/** Dzień roku 1–366 dla daty kalendarzowej (miesiąc 1–12). */
export function dzienRoku(rok: number, miesiac: number, dzien: number): number {
  return Math.round((Date.UTC(rok, miesiac - 1, dzien) - Date.UTC(rok, 0, 1)) / DZIEN_MS) + 1
}

/** Czas lokalny Krakowa (dzień roku, minuta doby) → znacznik UTC w ms. */
export function znacznikCzasu(rok: number, dzien: number, minuta: number): number {
  const lokalnyJakUtc = Date.UTC(rok, 0, dzien, 0, minuta)
  // Dwa kroki: przesunięcie zależy od chwili, a chwila od przesunięcia (doba zmiany czasu).
  const proba = lokalnyJakUtc - przesuniecieWarszawy(lokalnyJakUtc) * MIN_MS
  return lokalnyJakUtc - przesuniecieWarszawy(proba) * MIN_MS
}

export interface ChwilaLokalna {
  rok: number
  dzien: number
  minuta: number
}

/** Bieżąca chwila jako czas lokalny Krakowa. */
export function chwilaLokalna(utcMs: number): ChwilaLokalna {
  const lokalny = new Date(utcMs + przesuniecieWarszawy(utcMs) * MIN_MS)
  const rok = lokalny.getUTCFullYear()
  return {
    rok,
    dzien: dzienRoku(rok, lokalny.getUTCMonth() + 1, lokalny.getUTCDate()),
    minuta: lokalny.getUTCHours() * 60 + lokalny.getUTCMinutes(),
  }
}

const MIESIACE = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
]

/** „21 grudnia”. */
export function opisDnia(rok: number, dzien: number): string {
  const d = new Date(Date.UTC(rok, 0, dzien))
  return `${d.getUTCDate()} ${MIESIACE[d.getUTCMonth()]}`
}

/** „14:05”. */
export function opisGodziny(minuta: number): string {
  const h = Math.floor(minuta / 60) % 24
  return `${h}:${String(minuta % 60).padStart(2, '0')}`
}

/**
 * Wysokość słońca nad horyzontem w stopniach (przybliżenie NOAA, błąd < 1° – wystarcza,
 * żeby wiedzieć, czy słońce w ogóle świeci). Ujemna = noc, cienia nie ma.
 */
export function wysokoscSlonca(utcMs: number, lat: number, lon: number): number {
  const rad = Math.PI / 180
  const dni = utcMs / DZIEN_MS - 10_957.5 // dni od J2000.0
  const g = (357.529 + 0.98560028 * dni) * rad
  const q = 280.459 + 0.98564736 * dni
  const l = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad
  const e = (23.439 - 0.00000036 * dni) * rad
  const deklinacja = Math.asin(Math.sin(e) * Math.sin(l))
  const rektascensja = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l))
  const gmst = (280.46061837 + 360.98564736629 * dni) * rad
  const katGodzinny = gmst + lon * rad - rektascensja
  const fi = lat * rad
  return (
    Math.asin(
      Math.sin(fi) * Math.sin(deklinacja) +
        Math.cos(fi) * Math.cos(deklinacja) * Math.cos(katGodzinny),
    ) / rad
  )
}

/**
 * Bezpiecznik cienia: mediana odstępów między klatkami (ms) z próbki podczas ruchu suwaka.
 * Powyżej ~33 ms (poniżej 30 klatek na sekundę) cień wyłączamy – bryły zostają.
 */
export function klatkiZaWolne(odstepy: readonly number[], progMs = 33): boolean {
  if (odstepy.length < 10) return false
  const posortowane = [...odstepy].sort((a, b) => a - b)
  return (posortowane[Math.floor(posortowane.length / 2)] as number) > progMs
}
