// Teksty trybu „Biznes” jako czyste funkcje (#106, #107): zdanie o pozycji, dymek heksu, źródła.
// Osobno od silnika (`biznes.ts`), żeby ekran nie składał zdań w komponencie – tu da się je testować.
import { type BialaPlama, bezPunktu } from './biznes.ts'

const LICZBA = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })

/** Odmiana po liczebniku: 1 adres, 2 adresy, 5 adresów, 22 adresy, 112 adresów. */
export function odmiana(n: number, jeden: string, kilka: string, wiele: string): string {
  if (n === 1) return jeden
  const j = n % 10
  const d = n % 100
  return j >= 2 && j <= 4 && (d < 12 || d > 14) ? kilka : wiele
}

/**
 * Nazwa branży w dopełniaczu liczby mnogiej („istniejących aptek”). Katalog zna tylko mianownik
 * („Apteka”), więc odmiana jest tutaj; nowa branża bez wpisu dostaje bezpieczne „punktów tej
 * branży”, a test pilnuje, żeby żadna branża z katalogu nie spadła na ten zapas.
 */
const BRANZE_W_DOPELNIACZU: Readonly<Record<string, string>> = {
  sklep: 'sklepów spożywczych',
  apteka: 'aptek',
  fryzjer: 'fryzjerów lub barberów',
  piekarnia: 'piekarni',
  kawiarnia: 'kawiarni',
  przychodnia: 'przychodni lub gabinetów',
  paczkomat: 'automatów paczkowych',
}

export function branzaWDopelniaczu(id: string): string {
  return BRANZE_W_DOPELNIACZU[id] ?? 'punktów tej branży'
}

export interface ZdaniePozycji {
  przed: string
  /** Fragment do wyróżnienia na karcie: „7 na 10”. */
  liczba: string
  po: string
  pelny: string
}

/**
 * Główna liczba karty miejsca: pozycja wśród istniejących punktów branży, z kierunkiem
 * wypisanym słowami („więcej … niż”). Percentyl bez znaku %, bo procent myli się z udziałem.
 */
export function zdaniePozycji(percentyl: number, branzaId: string): ZdaniePozycji {
  const naDziesiec = Math.min(10, Math.max(0, Math.round(percentyl / 10)))
  const przed = 'Więcej klientów w zasięgu niż'
  const liczba = `${naDziesiec} na 10`
  const po = `istniejących ${branzaWDopelniaczu(branzaId)}`
  return { przed, liczba, po, pelny: `${przed} ${liczba} ${po}` }
}

const heksow = (n: number) => (n === 1 ? 'heksu' : 'heksów')

/**
 * Dymek heksu białych plam. `plamy` = heksy r10 pod kursorem: jeden przy r10, dzieci przy r8/r9.
 * Przy większych heksach liczba to ŚREDNIA adresów na punkt po dzieciach, nie indeks 0–100 z
 * koloru – ten ma swoją skalę i nie jest jednostką, którą ktoś by rozumiał.
 */
export function opisHeksuBiznesu(
  plamy: readonly BialaPlama[],
  res: 8 | 9 | 10,
  zasiegM: number,
): string {
  const pierwsza = plamy[0]
  if (!pierwsza) return 'Brak danych'
  if (res === 10) {
    if (bezPunktu(pierwsza))
      return (
        `Brak punktu w zasięgu ${zasiegM} m · ` +
        `${LICZBA.format(pierwsza.adresyWZasiegu)} ${odmiana(Math.round(pierwsza.adresyWZasiegu), 'adres', 'adresy', 'adresów')} w zasięgu`
      )
    const naPunkt = Math.round(pierwsza.adresyNaPunkt ?? 0)
    return (
      `${LICZBA.format(naPunkt)} ${odmiana(naPunkt, 'adres', 'adresy', 'adresów')} na punkt · ` +
      `${pierwsza.konkurenci} ${odmiana(pierwsza.konkurenci, 'punkt', 'punkty', 'punktów')} w zasięgu · ` +
      `najbliżej: ${pierwsza.najblizszyKonkurent ?? 'punkt bez nazwy'}`
    )
  }
  const zPunktami = plamy.filter((p) => !bezPunktu(p))
  if (zPunktami.length === 0)
    return `Okolica: brak punktu w zasięgu ${zasiegM} m w żadnym z ${plamy.length} ${heksow(plamy.length)}`
  const suma = zPunktami.reduce((s, p) => s + (p.adresyNaPunkt ?? 0), 0)
  const srednia = Math.round(suma / zPunktami.length)
  const bez = plamy.length - zPunktami.length
  return (
    `Okolica: średnio ${LICZBA.format(srednia)} ${odmiana(srednia, 'adres', 'adresy', 'adresów')} na punkt` +
    (bez > 0 ? ` · bez punktu w zasięgu: ${bez} z ${plamy.length} ${heksow(plamy.length)}` : '')
  )
}

// ── Źródła i atrybucja ───────────────────────────────────────────────────────────────────

export interface ZrodloDanych {
  nazwa: string
  url?: string
  licencja?: string
  dataDanych?: string
}

export interface WpisZrodla {
  nazwa: string
  url: string | null
  /** Licencja i data danych jednym wierszem. */
  opis: string
}

// Znaki zapisane kodem punktowym, żeby w źródle nie było pauzy (U+2014), której w polskim UI nie ma.
const PAUZA = String.fromCodePoint(0x2014)
const POLPAUZA = String.fromCodePoint(0x2013)

/** Pauza z nazw źródeł z ETL (np. „MSIP … punkty adresowe”) wraca jako półpauza. */
export const bezPauzy = (tekst: string): string => tekst.replaceAll(PAUZA, POLPAUZA)

export interface MetaPunktow {
  zrodlo?: string
  licencja?: string
  dataDanych?: string
}

/**
 * Atrybucja punktów usług: OpenStreetMap wymaga nazwy źródła z odnośnikiem do strony o prawach
 * (ODbL). Działa też przed wczytaniem pliku branży (`meta` = null): wtedy bez daty wyciągu.
 */
export function wpisZrodlaPunktow(meta: MetaPunktow | null): WpisZrodla {
  return {
    nazwa: bezPauzy(meta?.zrodlo ?? '© OpenStreetMap contributors'),
    url: 'https://www.openstreetmap.org/copyright',
    opis: bezPauzy(
      [`licencja ${meta?.licencja ?? 'ODbL 1.0'}`, meta?.dataDanych && `dane z ${meta.dataDanych}`]
        .filter(Boolean)
        .join('; '),
    ),
  }
}

/** Wszystkie źródła popytu z `popyt.json.zrodla`, gotowe do wypisania pod mapą. */
export function wpisyZrodel(zrodla: readonly ZrodloDanych[]): WpisZrodla[] {
  return zrodla.map((z) => ({
    nazwa: bezPauzy(z.nazwa),
    url: z.url ?? null,
    opis: bezPauzy(
      [z.licencja, z.dataDanych ? `dane z ${z.dataDanych}` : undefined].filter(Boolean).join('; '),
    ),
  }))
}
