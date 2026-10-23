// Start ekranu Szukaj bez pełnych danych (#247, paczka B7a): klej między kompaktem (heksy, kafle) a stanem
// aplikacji. Ten plik robi cztery rzeczy, żadna nie dotyka `adresy.json` ani `wskazniki/*.json`:
//   1. meta warstw z manifestu kompaktu do stanu (`podlaczMeta`): profile, wagi i kierunki działają od startu,
//   2. słownik id adresów z `id.bin` (`podlaczSlownik`) – dopiero gdy ktoś go potrzebuje (link z id adresu,
//      wybrany adres, porównanie, filtry, zmiana profilu): to 2,2 MB, więc nie ruszamy go „na zapas”,
//   3. okolice (`okolice.json`, nazwy do wyszukiwarki i podpisu adresu) oraz ramki okolic z kompaktu,
//   4. skale i słowniki etykiet kafli (`skale.json` + `slowniki.json`), z którymi powstaje każdy kafel.
// Kompakt bez rozszerzeń (stary format) albo bez wpisu przeglądu: Szukaj wraca do pełnych danych.
import { useEffect, useState } from 'react'
import {
  bazaDanych,
  type Manifest,
  MIASTO_DOMYSLNE,
  type PlikOkolic,
  type SlugMiasta,
  type WskaznikMeta,
  wczytajOkolice,
} from '@/kontrakty'
import { type JednostkaGeoJson, type OkolicaNaMapie, okolicaNaMapie } from '@/mapa/okolica/granice'
import { daneJesliGotowe, pozwolNaPelneDane } from './dane.ts'
import { type SkaleKafli, skaleKafli, wczytajKafleAdresow } from './kafle.ts'
import {
  dekodujId,
  type IndeksKompaktu,
  kolejnoscId,
  type PlikOkolicKompaktu,
  rozpakuj,
} from './kompakt.ts'
import { type StanDanychHeksow, useDaneHeksow } from './kompaktBiezacy.ts'
import type { Skala } from './silnik.ts'
import {
  linkCzekaNaSlownik,
  pobierzStan,
  podlaczMeta,
  podlaczSlownik,
  resolverZId,
  useStan,
} from './stan.ts'

// ── Meta warstw ──────────────────────────────────────────────────────────────────────────

const metaPoManifescie = new WeakMap<Manifest, WskaznikMeta[]>()

/** Meta warstw z manifestu (bez `wersjaAdresow`), stabilna referencja na manifest. */
export function metaWarstw(manifest: Manifest): WskaznikMeta[] {
  let meta = metaPoManifescie.get(manifest)
  if (!meta) {
    meta = manifest.wskazniki.map(({ wersjaAdresow: _wersja, ...reszta }) => reszta)
    metaPoManifescie.set(manifest, meta)
  }
  return meta
}

/**
 * Warstwy do paneli bez pełnych danych: z manifestu kompaktu bieżącego miasta albo null, gdy kompakt
 * jeszcze nie przyszedł. Panele czytają z nich tylko `meta`.
 */
export function useMetaWarstw(): WskaznikMeta[] | null {
  const hk = useDaneHeksow()
  return hk.stan === 'gotowe' ? metaWarstw(hk.manifest) : null
}

// ── Pliki kompaktu ładowane na żądanie ───────────────────────────────────────────────────

async function pobierz(url: string): Promise<Response> {
  const odp = await fetch(url)
  if (!odp.ok) throw new Error(`${url}: HTTP ${odp.status}`)
  return odp
}

function plikKompaktu(slug: SlugMiasta, nazwa: string): string {
  return `${bazaDanych(slug)}/kompakt/${nazwa}`
}

/** Jedno ładowanie na indeks kompaktu; nieudane odpina się z cache, żeby kolejna próba ruszyła od nowa. */
function zCache<T>(
  cache: WeakMap<IndeksKompaktu, Promise<T>>,
  indeks: IndeksKompaktu,
  wczytaj: () => Promise<T>,
): Promise<T> {
  let p = cache.get(indeks)
  if (!p) {
    p = wczytaj()
    p.catch(() => cache.delete(indeks))
    cache.set(indeks, p)
  }
  return p
}

const slownikiObietnice = new WeakMap<IndeksKompaktu, Promise<ReturnType<typeof resolverZId>>>()

/** Resolver id adresów z `id.bin` (indeks w adresy.json ↔ id). */
export function wczytajSlownikId(slug: SlugMiasta, indeks: IndeksKompaktu) {
  return zCache(slownikiObietnice, indeks, async () => {
    const r = await rozpakuj(
      await (await pobierz(plikKompaktu(slug, indeks.id.plik))).arrayBuffer(),
    )
    // Bez `kolejnosc` (kompakt sprzed rozszerzenia) resolverZId rzuca: ekran wraca do pełnych danych.
    return resolverZId(dekodujId(r), kolejnoscId(r) ?? undefined)
  })
}

const skaleObietnice = new WeakMap<IndeksKompaktu, Promise<SkaleKafli>>()

/**
 * Skale warstw i słowniki etykiet, z którymi buduje się każdy kafel. Kafle są w jednej pamięci
 * (`kafle.ts`), więc muszą powstawać zawsze z tymi samymi słownikami – inaczej etykiety adresu zależałyby
 * od tego, który ekran pobrał kafel pierwszy.
 */
export function wczytajSkaleKafli(slug: SlugMiasta, indeks: IndeksKompaktu): Promise<SkaleKafli> {
  return zCache(skaleObietnice, indeks, async () => {
    const [skale, slowniki] = await Promise.all([
      pobierz(plikKompaktu(slug, indeks.skale.plik)).then(
        (o) => o.json() as Promise<Record<string, Skala>>,
      ),
      indeks.slowniki
        ? pobierz(plikKompaktu(slug, indeks.slowniki.plik)).then(
            (o) => o.json() as Promise<NonNullable<SkaleKafli['slowniki']>>,
          )
        : Promise.resolve(undefined),
    ])
    return skaleKafli(indeks, skale, slowniki)
  })
}

/** Słowniki etykiet kafli (null do czasu pobrania); dla rankingu, który sam składa skale z `dane.skala`. */
export function useSlownikiKafli(hk: StanDanychHeksow): SkaleKafli['slowniki'] | null {
  const [wynik, ustaw] = useState<{
    indeks: IndeksKompaktu
    slowniki: SkaleKafli['slowniki']
  } | null>(null)
  const indeks = hk.stan === 'gotowe' ? hk.indeks : null
  const miasto = hk.stan === 'gotowe' ? hk.miasto : null
  useEffect(() => {
    if (!indeks || !miasto || !indeks.slowniki) return
    let aktualne = true
    wczytajSkaleKafli(miasto, indeks).then(
      (s) => aktualne && ustaw({ indeks, slowniki: s.slowniki }),
      (e: unknown) => console.warn('Słowniki etykiet niedostępne', e),
    )
    return () => {
      aktualne = false
    }
  }, [indeks, miasto])
  return wynik && wynik.indeks === indeks ? wynik.slowniki : null
}

// ── Okolice ──────────────────────────────────────────────────────────────────────────────

const okoliceObietnice = new WeakMap<IndeksKompaktu, Promise<PlikOkolic | null>>()

/** `okolice.json` (nazwy okolic i kolumna okolic adresów); tylko Kraków (D8), gdzie istnieje. */
export function wczytajOkoliceKompaktu(
  slug: SlugMiasta,
  indeks: IndeksKompaktu,
): Promise<PlikOkolic | null> {
  if (slug !== MIASTO_DOMYSLNE) return Promise.resolve(null)
  return zCache(okoliceObietnice, indeks, () =>
    wczytajOkolice(indeks.wersjaAdresow, indeks.n, bazaDanych(slug)),
  )
}

/**
 * Okolice bieżącego miasta bez pełnych danych: pobierane, gdy `aktywne` (fokus w polu wyszukiwarki,
 * wybrany adres, który ma pokazać okolicę). null do czasu pobrania, dla innych miast niż Kraków i po błędzie.
 */
export function useOkoliceKompaktu(hk: StanDanychHeksow, aktywne: boolean): PlikOkolic | null {
  const [wynik, ustaw] = useState<{ indeks: IndeksKompaktu; okolice: PlikOkolic | null } | null>(
    null,
  )
  const indeks = hk.stan === 'gotowe' ? hk.indeks : null
  const miasto = hk.stan === 'gotowe' ? hk.miasto : null
  useEffect(() => {
    if (!aktywne || !indeks || !miasto || miasto !== MIASTO_DOMYSLNE) return
    let aktualne = true
    wczytajOkoliceKompaktu(miasto, indeks).then(
      (okolice) => aktualne && ustaw({ indeks, okolice }),
      (e: unknown) => console.warn('Okolice niedostępne', e),
    )
    return () => {
      aktualne = false
    }
  }, [aktywne, indeks, miasto])
  return wynik && wynik.indeks === indeks ? wynik.okolice : null
}

const ramkiObietnice = new WeakMap<IndeksKompaktu, Promise<PlikOkolicKompaktu | null>>()

/** Najmniejszy bok ramki okolicy (stopnie), jak `MIN_BOK` w `mapa/luki/skalaLuk.ts`: jeden adres nie przybliża mapy do maksimum. */
const MIN_BOK_RAMKI = 0.003

/**
 * Okolica z wyszukiwarki do pokazania na mapie, gdy nie ma adresów w pamięci. Jednostka SIM z obrysem
 * działa jak dotąd; miejscowość (i jednostka bez obrysu) dostaje ramkę z `okolice.<skrót>.json` kompaktu.
 */
export async function okolicaNaMapieKompaktu(
  slug: SlugMiasta,
  indeks: IndeksKompaktu,
  id: string,
  granice: { features: JednostkaGeoJson[] } | null,
  okolice: PlikOkolic,
): Promise<OkolicaNaMapie | null> {
  const zObrysem = okolicaNaMapie(id, granice, [], okolice)
  if (zObrysem) return zObrysem
  if (!indeks.okolice) return null
  const plik = await zCache(ramkiObietnice, indeks, async () =>
    (await pobierz(plikKompaktu(slug, (indeks.okolice as { plik: string }).plik))).json(),
  )
  const prostokat = plik?.okolice[id]?.prostokat
  if (!prostokat) return null
  const [[zachod, poludnie], [wschod, polnoc]] = prostokat
  const dx = Math.max(0, MIN_BOK_RAMKI - (wschod - zachod)) / 2
  const dy = Math.max(0, MIN_BOK_RAMKI - (polnoc - poludnie)) / 2
  return {
    id,
    granice: [
      [zachod - dx, poludnie - dy],
      [wschod + dx, polnoc + dy],
    ],
    obrys: null,
  }
}

// ── Start ekranu ─────────────────────────────────────────────────────────────────────────

/**
 * Podpina stan aplikacji pod kompakt bieżącego miasta i zwraca jego dane heksów. Wołany przez Szukaj
 * (`pelneGotowe` = pełne dane już są, wtedy meta i słownik podłączył `dane.ts`).
 */
export function useStartKompakt(pelneGotowe: boolean): StanDanychHeksow {
  const hk = useDaneHeksow()
  const persona = useStan((s) => s.persona)
  const wybrany = useStan((s) => s.wybrany)
  const porownanie = useStan((s) => s.porownanie)
  const filtry = useStan((s) => s.filtry)
  const manifest = hk.stan === 'gotowe' ? hk.manifest : null
  const indeks = hk.stan === 'gotowe' ? hk.indeks : null
  const miasto = hk.stan === 'gotowe' ? hk.miasto : null
  // Stan z chwili podpięcia metadanych: czy link czeka na słownik i jaki był profil. Zmiana profilu
  // po tym momencie też wymaga słownika (adres w pasku przeglądarki; bez niego zmiany nie trafiają do linku).
  const [start, ustawStart] = useState<{
    manifest: Manifest
    link: boolean
    persona: string
  } | null>(null)

  useEffect(() => {
    if (!manifest || pelneGotowe) return
    const link = linkCzekaNaSlownik()
    podlaczMeta(metaWarstw(manifest))
    ustawStart({ manifest, link, persona: pobierzStan().persona })
  }, [manifest, pelneGotowe])

  const potrzebnySlownik =
    start !== null &&
    start.manifest === manifest &&
    (start.link ||
      wybrany !== null ||
      porownanie.length > 0 ||
      filtry.length > 0 ||
      persona !== start.persona)

  useEffect(() => {
    if (!potrzebnySlownik || !indeks || !miasto || pelneGotowe) return
    let aktualne = true
    wczytajSlownikId(miasto, indeks).then(
      (resolver) => {
        // Pełne dane mogły dojść w międzyczasie: ich słownik (z adresami) ma pierwszeństwo.
        if (aktualne && pobierzStan().miasto === miasto && !daneJesliGotowe()) {
          podlaczSlownik(resolver)
          // Link z `#/adres/…?cmp=…` ustawia wybrany i porównanie dopiero tu; bez ich kafli chipy
          // porównania i karta byłyby puste do pierwszego kliku w mapę.
          const { wybrany: w, porownanie: p } = pobierzStan()
          const doWczytania = w === null ? p : [w, ...p]
          if (doWczytania.length > 0)
            wczytajSkaleKafli(miasto, indeks)
              .then((skale) => wczytajKafleAdresow(bazaDanych(miasto), indeks, doWczytania, skale))
              .catch((e: unknown) => console.warn('Kafle wybranych adresów niedostępne', e))
        }
      },
      (e: unknown) => console.warn('Słownik id adresów niedostępny', e),
    )
    return () => {
      aktualne = false
    }
  }, [potrzebnySlownik, indeks, miasto, pelneGotowe])

  // Kompakt bez rozszerzeń (albo bez przeglądu miasta): nie ma czym zastąpić pełnych danych.
  const stanKompaktu = hk.stan
  useEffect(() => {
    if (stanKompaktu === 'brak') pozwolNaPelneDane()
  }, [stanKompaktu])

  return hk
}
