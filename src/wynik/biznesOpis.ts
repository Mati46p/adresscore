// Teksty trybu „Biznes” jako czyste funkcje (#106, #107): zdanie o pozycji, dymek heksu, źródła.
// Osobno od silnika (`biznes.ts`), żeby ekran nie składał zdań w komponencie – tu da się je testować.
import { type BialaPlama, bezPunktu, odmiana } from './biznes.ts'
import { branzaWDopelniaczu } from './biznesBranze.ts'
import type { BranzaKatalogu, KatalogUslug, ZrodloKatalogu } from './biznesUslugi.ts'

const LICZBA = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })

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
 * `konkurencja` to dopełniacz mnogi tego, z czym porównano (domyślnie cała branża); przy filtrze
 * flagowym podaje go `konkurencjaWDopelniaczu`, np. „restauracji bez fast foodów”.
 */
export function zdaniePozycji(
  percentyl: number,
  branzaId: string,
  konkurencja: string = branzaWDopelniaczu(branzaId),
): ZdaniePozycji {
  const naDziesiec = Math.min(10, Math.max(0, Math.round(percentyl / 10)))
  const przed = 'Więcej klientów w zasięgu niż'
  const liczba = `${naDziesiec} na 10`
  const po = `istniejących ${konkurencja}`
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

/**
 * Strona praw OpenStreetMap. ODbL wymaga atrybucji „© OpenStreetMap contributors” z odnośnikiem
 * do niej, więc wpis OSM prowadzi tutaj, a nie do strony ekstraktu Geofabrik.
 */
export const URL_PRAW_OSM = 'https://www.openstreetmap.org/copyright'

/**
 * Wpis jednego źródła z `katalog.json` (`zrodla.<klucz>`): nazwa to gotowa atrybucja ze źródła
 * („© OpenStreetMap contributors, ODbL”, „Centrum e-Zdrowia, RPWDL (CC BY 4.0)”), a w opisie
 * licencja i data danych. Źródło, którego katalog nie opisuje, i tak trafia na listę (z kluczem
 * zamiast nazwy): cicho zgubiona atrybucja byłaby gorsza niż brzydki wpis.
 */
export function wpisZrodlaKatalogu(klucz: string, zrodlo: ZrodloKatalogu | undefined): WpisZrodla {
  if (!zrodlo) return { nazwa: klucz, url: null, opis: 'brak opisu źródła w katalogu' }
  return {
    nazwa: bezPauzy(zrodlo.atrybucja),
    url: klucz === 'osm' ? URL_PRAW_OSM : zrodlo.url,
    opis: bezPauzy(
      [zrodlo.licencja, zrodlo.dataDanych ? `dane z ${zrodlo.dataDanych}` : undefined]
        .filter(Boolean)
        .join('; '),
    ),
  }
}

/**
 * Klucze źródeł z `katalog.zrodla`, z których pochodzą punkty branży i jej flagi, w kolejności
 * OSM, Overture, rejestr, dalej flagi z osobnych źródeł (NFZ). Bit `rejestr` znaczy rejestr
 * właściwy dla branży (`mapowanie.rejestr`: Rejestr Aptek albo RPWDL). Tylko te, które branża ma:
 * apteka nie pokazuje RPWDL, sklep nie pokazuje rejestrów.
 */
export function kluczeZrodelBranzy(
  branza: Pick<BranzaKatalogu, 'zrodlaWPliku' | 'mapowanie'>,
): string[] {
  const klucze: string[] = []
  const dodaj = (klucz: string | null | undefined) => {
    if (klucz && !klucze.includes(klucz)) klucze.push(klucz)
  }
  for (const bit of branza.zrodlaWPliku) dodaj(bit === 'rejestr' ? branza.mapowanie.rejestr : bit)
  for (const flaga of Object.values(branza.mapowanie.flagi)) dodaj(flaga.zrodlo)
  return klucze
}

/** Atrybucja punktów wybranej branży: licencje i daty tylko jej źródeł, bez popytu (ten ma osobne wpisy). */
export function wpisyZrodelBranzy(
  katalog: Pick<KatalogUslug, 'zrodla'>,
  branza: Pick<BranzaKatalogu, 'zrodlaWPliku' | 'mapowanie'>,
): WpisZrodla[] {
  return kluczeZrodelBranzy(branza).map((klucz) => wpisZrodlaKatalogu(klucz, katalog.zrodla[klucz]))
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
