import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { gzipDeterministyczny, maStalyNaglowek } from '../etl/lib/gzip.mjs'
import { PROGI_LITER, WAGA_MAX } from '../src/wynik/silnik.ts'
import { hashAdresu, kluczUlicy, slugAdresu, slugUlicy } from '../src/wynik/slug.ts'
import { zapiszMapyILlms } from './katalog-mapy.mjs'

// Build bez public/dane (obraz Dockera, dane leżą poza repo – #237): indeks SEO jest w gicie
// (api/_seo-index.json.gz), więc mapy witryny i llms.txt składamy z niego, bez przeliczania.
// Indeks odświeża się lokalnie, tam gdzie dane są (pnpm build).
const plikDanych = new URL('../public/dane/adresy.json', import.meta.url)
if (!existsSync(plikDanych)) {
  const indeks = JSON.parse(
    gunzipSync(readFileSync(new URL('../api/_seo-index.json.gz', import.meta.url))),
  )
  const liczbaMap = zapiszMapyILlms(indeks)
  console.log(
    `Katalog bez danych: indeks z gita (${indeks.adresy.length} adresów), ${liczbaMap} map witryny`,
  )
  process.exit(0)
}
const zrodlo = JSON.parse(readFileSync(plikDanych, 'utf8'))
const c = zrodlo.kolumny

// Fakty na stronie adresu (SEO i wyszukiwarki AI): surowe pomiary z rejestrów, nie wynik A–G.
// Wynik zależy od profilu i wag użytkownika, więc serwer pokazałby liczbę, której karta po
// wczytaniu może nie potwierdzić. Pomiar (metry, minuty, decybele) jest ten sam dla każdego.
// Kolejność = kolejność na stronie. Brak wartości = „brak danych", nigdy zero.
const FAKTY = [
  'przystanek_odleglosc',
  'kursy_szczyt_h',
  'rynek_czas_min',
  'sklep_odleglosc',
  'apteka_odleglosc',
  'przychodnia_odleglosc',
  'przedszkole_odleglosc',
  'szkola_podst_odleglosc',
  'zielen_worldcover_100m',
  'halas_ldwn',
  'pm25_srednia',
]
const CALKOWITE = new Set(['m', 'min', '%'])
const zaokraglij = (v, jednostka) =>
  v === null || v === undefined || Number.isNaN(v)
    ? null
    : CALKOWITE.has(jednostka)
      ? Math.round(v)
      : Math.round(v * 10) / 10

const katalogWskaznikow = new URL('../public/dane/wskazniki/', import.meta.url)
const plikiWskaznikow = existsSync(katalogWskaznikow)
  ? readdirSync(katalogWskaznikow)
      .filter((p) => p.endsWith('.json'))
      .sort()
  : []
const wskazniki = []
const fakty = new Map()
for (const p of plikiWskaznikow) {
  const plik = JSON.parse(readFileSync(new URL(p, katalogWskaznikow), 'utf8'))
  const { meta } = plik
  // Warstwa policzona dla innej wersji adresów nie pasuje indeksami – pomijamy, jak aplikacja.
  const zgodna = plik.wersjaAdresow === zrodlo.wersja && plik.wartosci?.length === c.id.length
  const zDanymi = zgodna ? plik.wartosci.filter((v) => v !== null).length : 0
  wskazniki.push({
    id: meta.id,
    nazwa: meta.nazwa,
    kategoria: meta.kategoria,
    jednostka: meta.jednostka ?? '',
    rozdzielczosc: meta.rozdzielczosc,
    zDanymi,
    zrodla: (meta.zrodla ?? []).map((z) => ({
      nazwa: z.nazwa,
      url: z.url,
      licencja: z.licencja,
      dataDanych: z.dataDanych,
      pobrano: z.pobrano,
    })),
  })
  if (zgodna && FAKTY.includes(meta.id)) {
    const wartosci = plik.wartosci.map((v) => zaokraglij(v, meta.jednostka))
    fakty.set(meta.id, {
      meta: {
        id: meta.id,
        nazwa: meta.nazwa,
        jednostka: meta.jednostka ?? '',
        rozdzielczosc: meta.rozdzielczosc,
        zrodlo: meta.zrodla?.[0]?.nazwa ?? '',
        url: meta.zrodla?.[0]?.url ?? '',
        dataDanych: meta.zrodla?.[0]?.dataDanych ?? '',
      },
      wartosci,
    })
  }
}
const faktyWKolejnosci = FAKTY.filter((id) => fakty.has(id)).map((id) => fakty.get(id))

const adresy = []
const ulice = new Map()
const hashe = new Set()
const slugiUlic = new Set()
const wspolrzedna = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : null)

for (let i = 0; i < c.id.length; i++) {
  const a = {
    id: c.id[i],
    teryt: c.teryt[i],
    miejscowosc: c.miejscowosc[i],
    ulica: c.ulica[i],
    nr: c.nr[i],
    gmina: c.gmina[i],
    kod: c.kod[i],
  }
  const hash = hashAdresu(a.id)
  if (hashe.has(hash)) throw new Error(`Kolizja hasha adresu: ${a.id}`)
  hashe.add(hash)
  const slug = slugAdresu(a)
  const tytul = a.ulica ? `${a.ulica} ${a.nr}, ${a.miejscowosc}` : `${a.miejscowosc} ${a.nr}`
  const klucz = kluczUlicy(a)
  const slugGrupy = slugUlicy(a)
  // [hash, slug, id, tytuł, miejscowość, gmina, ulica, numer, kod, slug ulicy,
  //  lon, lat, dzielnica, ...wartości faktów w kolejności `meta.fakty`]
  adresy.push([
    hash,
    slug,
    a.id,
    tytul,
    a.miejscowosc,
    a.gmina,
    a.ulica,
    a.nr,
    a.kod,
    slugGrupy,
    wspolrzedna(c.lon?.[i]),
    wspolrzedna(c.lat?.[i]),
    c.dzielnica?.[i] ?? null,
    ...faktyWKolejnosci.map((f) => f.wartosci[i]),
  ])
  if (!ulice.has(klucz)) {
    if (slugiUlic.has(slugGrupy)) throw new Error(`Kolizja sluga ulicy: ${klucz}`)
    slugiUlic.add(slugGrupy)
    // [slug, ulica lub miejscowość, miejscowość, gmina, liczba adresów]
    ulice.set(klucz, [slugGrupy, a.ulica ?? a.miejscowosc, a.miejscowosc, a.gmina, 0])
  }
  ulice.get(klucz)[4]++
}

// Data ostatniego pobrania danych – „stan danych" na stronach i `lastmod` w mapach witryny.
const daty = [
  ...(zrodlo.zrodla ?? []).map((z) => z.pobrano),
  ...wskazniki.flatMap((w) => w.zrodla.map((z) => z.pobrano)),
].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? ''))
const stanDanych = daty.sort().at(-1) ?? null
const gminy = [...new Set(c.gmina)]

// Nazwy kategorii z kontraktu. Kontrakt czyta import.meta.env (Vite), więc nie da się go
// zaimportować w Node – czytamy blok KATEGORIE z pliku. Brak nazwy którejś kategorii przerywa
// build, zamiast cicho wypisać identyfikator.
const kontrakt = readFileSync(new URL('../src/kontrakty/index.ts', import.meta.url), 'utf8')
const blokKategorii = /export const KATEGORIE = \{([\s\S]*?)\} as const/.exec(kontrakt)?.[1] ?? ''
const KATEGORIE = Object.fromEntries(
  [...blokKategorii.matchAll(/^\s*(\w+): '([^']+)',?$/gm)].map((m) => [m[1], m[2]]),
)
for (const w of wskazniki)
  if (!KATEGORIE[w.kategoria]) throw new Error(`Brak nazwy kategorii: ${w.kategoria} (${w.id})`)

// Prostokąt zasięgu [minLat, minLon, maxLat, maxLon] – spatialCoverage w danych strukturalnych.
const obszar = [Infinity, Infinity, -Infinity, -Infinity]
for (let i = 0; i < c.id.length; i++) {
  const lon = c.lon?.[i]
  const lat = c.lat?.[i]
  if (typeof lon !== 'number' || typeof lat !== 'number') continue
  obszar[0] = Math.min(obszar[0], lat)
  obszar[1] = Math.min(obszar[1], lon)
  obszar[2] = Math.max(obszar[2], lat)
  obszar[3] = Math.max(obszar[3], lon)
}
for (let i = 0; i < 4; i++) obszar[i] = Math.round(obszar[i] * 1e4) / 1e4

// Mediana każdego faktu w gminie adresu: kontekst liczby na stronie adresu („mediana w gminie").
const medianyGmin = {}
for (const g of gminy) {
  const wGminie = []
  for (let i = 0; i < c.gmina.length; i++) if (c.gmina[i] === g) wGminie.push(i)
  medianyGmin[g] = faktyWKolejnosci.map((f) => {
    const v = wGminie
      .map((i) => f.wartosci[i])
      .filter((x) => x !== null)
      .sort((a, b) => a - b)
    return v.length ? v[Math.floor(v.length / 2)] : null
  })
}

const meta = {
  wersjaAdresow: zrodlo.wersja,
  stanDanych,
  zrodlaAdresow: zrodlo.zrodla ?? [],
  kategorie: KATEGORIE,
  progiLiter: PROGI_LITER,
  wagaMax: WAGA_MAX,
  obszar,
  gminy,
  fakty: faktyWKolejnosci.map((f) => f.meta),
  medianyGmin,
  wskazniki,
  adresy,
  ulice: [...ulice.values()],
}
const tresc = JSON.stringify(meta)
const plikIndeksu = new URL('../api/_seo-index.json.gz', import.meta.url)
// Nagłówek gzip jest stały (etl/lib/gzip.mjs), więc system nie zmienia bajtów (#179). Strumień
// deflate zależy jednak od wersji zlib, dlatego przy tej samej treści i tym samym nagłówku nie
// przepisujemy pliku – inaczej każdy build brudzi drzewo i `pnpm zadanie scal` odmawia. Plik ze
// starym nagłówkiem (bajt systemu z maszyny, która go zrobiła) przepisujemy raz, mimo tej treści.
const poprzedni = existsSync(plikIndeksu) ? readFileSync(plikIndeksu) : null
const aktualny =
  poprzedni !== null && maStalyNaglowek(poprzedni) && gunzipSync(poprzedni).toString() === tresc
if (!aktualny) writeFileSync(plikIndeksu, gzipDeterministyczny(tresc))

const liczbaMap = zapiszMapyILlms(meta)

console.log(
  `Katalog: ${adresy.length} adresów, ${ulice.size} ulic, ${faktyWKolejnosci.length} faktów, ${wskazniki.length} warstw; indeks ${(statSync(plikIndeksu).size / 1024 / 1024).toFixed(1)} MiB, ${liczbaMap} map witryny`,
)
