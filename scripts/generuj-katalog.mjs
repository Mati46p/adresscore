import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { hashAdresu, kluczUlicy, slugAdresu, slugUlicy } from '../src/wynik/slug.ts'

const DOMENA = 'https://adresscore.pl'
const zrodlo = JSON.parse(
  readFileSync(new URL('../public/dane/adresy.json', import.meta.url), 'utf8'),
)
const c = zrodlo.kolumny
mkdirSync(new URL('../public/katalog/', import.meta.url), { recursive: true })
writeFileSync(
  new URL('../public/katalog/wersja.json', import.meta.url),
  `{ "wersjaAdresow": ${JSON.stringify(zrodlo.wersja)} }\n`,
)
const adresy = []
const ulice = new Map()
const hashe = new Set()
const slugiUlic = new Set()

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
  // [hash, slug, id, tytuł, miejscowość, gmina, ulica, numer, kod, slug ulicy]
  adresy.push([hash, slug, a.id, tytul, a.miejscowosc, a.gmina, a.ulica, a.nr, a.kod, slugGrupy])
  if (!ulice.has(klucz)) {
    if (slugiUlic.has(slugGrupy)) throw new Error(`Kolizja sluga ulicy: ${klucz}`)
    slugiUlic.add(slugGrupy)
    // [slug, ulica lub miejscowość, miejscowość, gmina, liczba adresów]
    ulice.set(klucz, [slugGrupy, a.ulica ?? a.miejscowosc, a.miejscowosc, a.gmina, 0])
  }
  ulice.get(klucz)[4]++
}

const meta = { wersjaAdresow: zrodlo.wersja, adresy, ulice: [...ulice.values()] }
const skompresowane = gzipSync(JSON.stringify(meta), { level: 9 })
writeFileSync(new URL('../api/_seo-index.json.gz', import.meta.url), skompresowane)

const url = (sciezka) => `<url><loc>${DOMENA}${sciezka}</loc></url>`
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
const uliceXml = xml([url('/katalog'), ...meta.ulice.map((u) => url(`/katalog/${u[0]}`))].join(''))
writeFileSync(new URL('../public/sitemap-katalog.xml', import.meta.url), uliceXml)
pliki.push('sitemap-katalog.xml')
writeFileSync(
  new URL('../public/sitemap.xml', import.meta.url),
  `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pliki.map((p) => `<sitemap><loc>${DOMENA}/${p}</loc></sitemap>`).join('')}</sitemapindex>\n`,
)
console.log(
  `Katalog: ${adresy.length} adresów, ${ulice.size} ulic; indeks ${(skompresowane.length / 1024 / 1024).toFixed(1)} MiB, ${pliki.length} map witryny`,
)
