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

const MS_GODZINY = 3_600_000

/** Godzina ścienna z datą (`2026-10-25T02`): to, co pokazuje zegar, bez rozróżnienia CEST i CET. */
function kluczScienny(ms: number): string | null {
  const c = czesci(ms)
  return c ? `${c.rok}-${c.miesiac}-${c.dzien}T${c.godzina}` : null
}

/**
 * Skrót strefy warszawskiej w chwili `ms`: CEST (UTC+2, czas letni) albo CET (UTC+1, czas zimowy).
 * Różnicę liczymy z zegara ściennego i chwili bezwzględnej, a nie z nazwy strefy z `Intl`: nazwy
 * zależą od wersji ICU i locale, a przesunięcie jest jednoznaczne.
 */
function skrotStrefy(ms: number): string | null {
  const c = czesci(ms)
  if (!c) return null
  const scienna = Date.UTC(
    Number(c.rok),
    Number(c.miesiac) - 1,
    Number(c.dzien),
    Number(c.godzina),
    Number(c.minuta),
  )
  // Sekundy chwili obcinamy do minuty, bo zegar ścienny ich tu nie niesie.
  const przesuniecieMin = Math.round((scienna - Math.floor(ms / 60_000) * 60_000) / 60_000)
  if (przesuniecieMin === 120) return 'CEST'
  if (przesuniecieMin === 60) return 'CET'
  return `UTC${przesuniecieMin < 0 ? '-' : '+'}${Math.abs(przesuniecieMin) / 60}`
}

/**
 * Podpis godziny jako ZAKRES, żeby nie sugerować punktu w czasie: `pon. 05.10, 14:00–14:59`.
 * Przyjmuje początek godziny (ISO z bazy).
 *
 * W dobie cofnięcia zegara (ostatnia niedziela października, 25 godzin) godzina 02:00–02:59 zdarza
 * się dwa razy: najpierw w czasie letnim, potem w zimowym. Dwa wiersze o identycznym podpisie
 * wyglądałyby jak błąd danych, więc TYLKO godzina, której zegarowy odpowiednik ma sąsiada w tej samej
 * dobie, dostaje skrót strefy: `nd. 25.10, 02:00–02:59 CEST` i `… CET`. Doba skracana (marzec, 23
 * godziny) nie ma powtórzeń, więc wszystkie jej podpisy zostają takie jak zawsze.
 */
export function opisGodziny(poczatekGodziny: string): string {
  const c = czesci(poczatekGodziny)
  if (!c) return poczatekGodziny
  const dzien = `${c.rok}-${c.miesiac}-${c.dzien}`
  const zakres = `${dzienTygodnia(dzien)} ${c.dzien}.${c.miesiac}, ${c.godzina}:00–${c.godzina}:59`
  const ms = Date.parse(poczatekGodziny)
  const klucz = kluczScienny(ms)
  const powtorzona =
    klucz !== null &&
    (kluczScienny(ms - MS_GODZINY) === klucz || kluczScienny(ms + MS_GODZINY) === klucz)
  const strefa = powtorzona ? skrotStrefy(ms) : null
  return strefa === null ? zakres : `${zakres} ${strefa}`
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
