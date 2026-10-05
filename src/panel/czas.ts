// Doby i godziny panelu. Wszystkie doby w panelu to doby Europe/Warsaw (jak w bazie), niezależnie
// od strefy komputera admina: „dziś” w Krakowie o 00:30 to już nowy dzień, nawet gdy zegar
// przeglądarki stoi w UTC. Czyste funkcje bez DOM, żeby dało się je objąć testem w Node.
import { BRAK_DANYCH } from './arytmetyka.ts'

export const STREFA_PANELU = 'Europe/Warsaw'

const formatCzesci = new Intl.DateTimeFormat('en-GB', {
  timeZone: STREFA_PANELU,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23', // 00–23; „h24” dałoby „24:05” o północy w części silników
})

interface CzesciDaty {
  rok: string
  miesiac: string
  dzien: string
  godzina: string
  minuta: string
}

function czesci(chwila: Date | string | number): CzesciDaty | null {
  const data = chwila instanceof Date ? chwila : new Date(chwila)
  if (Number.isNaN(data.getTime())) return null
  const pola: Record<string, string> = {}
  for (const c of formatCzesci.formatToParts(data)) pola[c.type] = c.value
  const { year, month, day, hour, minute } = pola
  if (!year || !month || !day || !hour || !minute) return null
  return { rok: year, miesiac: month, dzien: day, godzina: hour, minuta: minute }
}

/** Doba warszawska chwili jako `YYYY-MM-DD`; `null` dla niepoprawnej daty. */
export function dzienWarszawy(chwila: Date | string | number): string | null {
  const c = czesci(chwila)
  return c ? `${c.rok}-${c.miesiac}-${c.dzien}` : null
}

/** Dzisiejsza doba warszawska (`teraz` do testów). */
export function dzisWarszawy(teraz: Date | number = Date.now()): string {
  return dzienWarszawy(teraz) ?? ''
}

/** Godzina 0–23 w Warszawie; `null` dla niepoprawnej daty. */
export function godzinaWarszawy(chwila: Date | string | number): number | null {
  const c = czesci(chwila)
  return c ? Number(c.godzina) : null
}

/** `HH:MM` w Warszawie (znacznik „Dane z godz. …”). Niepoprawna data → „brak danych”. */
export function formatGodziny(chwila: Date | string | number | null | undefined): string {
  if (chwila === null || chwila === undefined) return BRAK_DANYCH
  const c = czesci(chwila)
  return c ? `${c.godzina}:${c.minuta}` : BRAK_DANYCH
}

const WZORZEC_DNIA = /^(\d{4})-(\d{2})-(\d{2})$/

/** `2026-10-05` → `05.10` (oś wykresów). Tekst, który nie jest datą, wraca bez zmian. */
export function etykietaDnia(dzien: string): string {
  const m = WZORZEC_DNIA.exec(dzien)
  return m ? `${m[3]}.${m[2]}` : dzien
}

/** Skrót dnia tygodnia („pon.”) dla doby `YYYY-MM-DD`; pusty napis dla niepoprawnej. */
export function dzienTygodnia(dzien: string): string {
  if (!WZORZEC_DNIA.test(dzien)) return ''
  const data = new Date(`${dzien}T12:00:00Z`)
  if (Number.isNaN(data.getTime())) return ''
  return data.toLocaleDateString('pl-PL', { weekday: 'short', timeZone: 'UTC' })
}

/** `2026-10-05` → `pon. 05.10.2026` (nagłówek podpowiedzi wykresu, podpis szczytu). */
export function pelnaDataDnia(dzien: string): string {
  const m = WZORZEC_DNIA.exec(dzien)
  if (!m) return dzien
  return `${dzienTygodnia(dzien)} ${m[3]}.${m[2]}.${m[1]}`
}

/**
 * Podpis godziny jako ZAKRES, żeby nie sugerować punktu w czasie: `pon. 05.10, 14:00–14:59`.
 * Przyjmuje początek godziny (ISO z bazy).
 */
export function opisGodziny(poczatekGodziny: string): string {
  const c = czesci(poczatekGodziny)
  if (!c) return poczatekGodziny
  const dzien = `${c.rok}-${c.miesiac}-${c.dzien}`
  return `${dzienTygodnia(dzien)} ${c.dzien}.${c.miesiac}, ${c.godzina}:00–${c.godzina}:59`
}

/** Dzień o `delta` dni od `dzien` (`YYYY-MM-DD`), liczony na datach kalendarzowych (bez DST). */
export function przesunDzien(dzien: string, delta: number): string {
  const m = WZORZEC_DNIA.exec(dzien)
  if (!m) return dzien
  const data = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta))
  return data.toISOString().slice(0, 10)
}

/**
 * `ile` kolejnych dób kończących się na `koniec` (włącznie), rosnąco. Do uzupełniania serii
 * dziennej: doba bez wiersza z bazy ma w wykresie `null` (brak danych), nie 0.
 */
export function ciagDni(koniec: string, ile: number): string[] {
  if (!WZORZEC_DNIA.test(koniec) || !(ile > 0)) return []
  return Array.from({ length: Math.floor(ile) }, (_, i) =>
    przesunDzien(koniec, i - Math.floor(ile) + 1),
  )
}
