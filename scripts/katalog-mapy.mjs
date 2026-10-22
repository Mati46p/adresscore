// Mapy witryny i llms.txt z indeksu SEO (meta z api/_seo-index.json.gz). Wspólne dla builda z danymi
// (generuj-katalog.mjs) i builda bez danych (obraz Dockera: public/dane leży poza repo, #237).
import { writeFileSync } from 'node:fs'

const DOMENA = 'https://adresscore.pl'

export function zapiszMapyILlms(meta) {
  const { adresy, gminy, wskazniki, stanDanych, kategorie: KATEGORIE } = meta
  const ulice = { size: meta.ulice.length }
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
  return pliki.length
}
