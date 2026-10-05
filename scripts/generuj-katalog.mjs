import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { gzipDeterministyczny, maStalyNaglowek } from '../etl/lib/gzip.mjs'
import { PROGI_LITER, WAGA_MAX } from '../src/wynik/silnik.ts'
import { hashAdresu, kluczUlicy, slugAdresu, slugUlicy } from '../src/wynik/slug.ts'

const DOMENA = 'https://adresscore.pl'
const zrodlo = JSON.parse(
  readFileSync(new URL('../public/dane/adresy.json', import.meta.url), 'utf8'),
)
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

const lastmod = stanDanych ? `<lastmod>${stanDanych}</lastmod>` : ''
const url = (sciezka) => `<url><loc>${DOMENA}${sciezka}</loc>${lastmod}</url>`
const xml = (tresc) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${tresc}</urlset>\n`
const rozmiar = 50_000
const pliki = []
for (let i = 0; i < adresy.length; i += rozmiar) {
  const nazwa = `sitemap-adresy-${Math.floor(i / rozmiar) + 1}.xml`
  const tresc = xml(
    adresy
      .slice(i, i + rozmiar)
      .map((a) => url(`/adres/${a[1]}`))
      .join(''),
  )
  writeFileSync(new URL(`../public/${nazwa}`, import.meta.url), tresc)
  pliki.push(nazwa)
}
const sciezkiStale = ['/', '/metoda', '/katalog', '/katalog/ulice']
const uliceXml = xml(
  [...sciezkiStale.map(url), ...meta.ulice.map((u) => url(`/katalog/${u[0]}`))].join(''),
)
writeFileSync(new URL('../public/sitemap-katalog.xml', import.meta.url), uliceXml)
pliki.push('sitemap-katalog.xml')
writeFileSync(
  new URL('../public/sitemap.xml', import.meta.url),
  `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pliki.map((p) => `<sitemap><loc>${DOMENA}/${p}</loc>${lastmod}</sitemap>`).join('')}</sitemapindex>\n`,
)

// llms.txt (https://llmstxt.org): streszczenie serwisu dla modeli językowych. Liczby z tych samych
// danych co strony, więc nie rozjadą się po przeliczeniu ETL. Plik generowany, poza gitem.
const liczba = (n) => n.toLocaleString('pl-PL')
const kategorie = [...new Set(wskazniki.map((w) => KATEGORIE[w.kategoria]))]
const llms = `# adresscore

> Jeden wynik jakości życia (0–100 i litera A–G) dla każdego adresu w Krakowie i ${gminy.length - 1} sąsiednich gminach, liczony z rejestrów publicznych. Każda liczba ma podane źródło, licencję i datę danych.

- Zasięg: ${liczba(adresy.length)} punktów adresowych, ${liczba(ulice.size)} ulic i miejscowości, ${gminy.length} gmin (${gminy.join(', ')}).
- Warstwy danych: ${wskazniki.length} wskaźników w kategoriach: ${kategorie.join(', ')}.
- Stan danych: ${stanDanych ?? 'brak daty'}. Dane liczone jednorazowo skryptem i serwowane jako pliki statyczne.
- Brak danych pod adresem oznacza „brak danych" (szara kategoria), nigdy wartość zero.
- Odległości to linia prosta, nie długość dojścia. Wynik nie jest wyceną nieruchomości ani poradą.

## Strony

- [Metoda i źródła](${DOMENA}/metoda): jak liczymy wynik 0–100 i literę A–G, lista wszystkich warstw ze źródłami, licencjami i datami.
- [Katalog adresów](${DOMENA}/katalog): wyszukiwarka adresów; strona każdej ulicy i każdego adresu.
- [Przykładowa strona adresu](${DOMENA}/adres/${adresy[0][1]}): pomiary z rejestrów pod jednym adresem (odległości, dojazd, zieleń, hałas, powietrze) z porównaniem do mediany w gminie.

## Dane

- [Manifest warstw (JSON)](${DOMENA}/dane/manifest.json): meta każdej warstwy – nazwa, jednostka, rozdzielczość, źródła.
- [Mapa witryny](${DOMENA}/sitemap.xml)

## Optional

- [Aplikacja](${DOMENA}/): mapa heksów H3, karta adresu, porównanie adresów, wagi według profilu.
`
writeFileSync(new URL('../public/llms.txt', import.meta.url), llms)

console.log(
  `Katalog: ${adresy.length} adresów, ${ulice.size} ulic, ${faktyWKolejnosci.length} faktów, ${wskazniki.length} warstw; indeks ${(statSync(plikIndeksu).size / 1024 / 1024).toFixed(1)} MiB, ${pliki.length} map witryny`,
)
