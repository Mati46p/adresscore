import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const DOMENA = 'https://adresscore.pl'
let dane

function indeks() {
  if (dane) return dane
  const plik = readFileSync(new URL('./_seo-index.json.gz', import.meta.url))
  const wczytane = JSON.parse(gunzipSync(plik).toString('utf8'))
  const poAdresie = new Map(wczytane.adresy.map((a) => [a[1], a]))
  const poUlicy = new Map(wczytane.ulice.map((u) => [u[0], u]))
  const adresyUlicy = new Map()
  for (const a of wczytane.adresy) {
    const grupa = adresyUlicy.get(a[9]) ?? []
    grupa.push(a)
    adresyUlicy.set(a[9], grupa)
  }
  dane = { ...wczytane, poAdresie, poUlicy, adresyUlicy }
  return dane
}

function html(tekst) {
  return String(tekst ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function strona({ title, description, canonical, tresc, robots = 'index, follow' }) {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="${robots}"><meta name="description" content="${html(description)}"><meta name="theme-color" content="#1F5C46"><link rel="canonical" href="${DOMENA}${canonical}"><title>${html(title)} – adresscore</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#18202b;margin:0;background:#f5f6f4}#root{max-width:1100px;margin:auto;padding:24px}a{color:#1f5c46}li{margin:.4em 0}nav{display:flex;gap:20px}h1{line-height:1.2}</style></head><body><div id="root"><nav><a href="/">adresscore</a><a href="/katalog">Katalog adresów</a></nav><main>${tresc}</main></div><script defer src="/seo-boot.js"></script></body></html>`
}

function odpowiedz(res, kod, tresc) {
  res.statusCode = kod
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600')
  res.end(tresc)
}

export default function handler(req, res) {
  const q = new URL(req.url ?? '/', 'https://example.invalid').searchParams
  const view = q.get('view')
  const slug = q.get('slug') ?? ''
  const d = indeks()

  if (view === 'adres') {
    const a = d.poAdresie.get(slug)
    if (!a)
      return odpowiedz(
        res,
        404,
        strona({
          title: 'Nie znaleziono adresu',
          description: 'Nie ma takiego adresu w katalogu.',
          canonical: '/katalog',
          robots: 'noindex',
          tresc:
            '<h1>Nie znaleziono adresu</h1><p><a href="/katalog">Przejdź do katalogu adresów</a></p>',
        }),
      )
    const tytul = a[3]
    const kod = a[8] ? `, ${html(a[8])}` : ''
    const sasiednie = (d.adresyUlicy.get(a[9]) ?? []).filter((x) => x[1] !== slug).slice(0, 8)
    const tresc = `<p><a href="/katalog/${a[9]}">Wszystkie adresy tej ulicy</a></p><h1>${html(tytul)}</h1><p>Adres w gminie ${html(a[5])}${kod}. Sprawdź wynik okolicy i dane z rejestrów publicznych w aplikacji adresscore.</p><h2>Inne adresy na tej ulicy</h2><ul>${sasiednie.map((x) => `<li><a href="/adres/${x[1]}">${html(x[3])}</a></li>`).join('')}</ul>`
    return odpowiedz(
      res,
      200,
      strona({
        title: tytul,
        description: `${tytul} – karta okolicy i dane publiczne dla gminy ${a[5]}.`,
        canonical: `/adres/${slug}`,
        tresc,
      }),
    )
  }

  if (view === 'ulica') {
    const u = d.poUlicy.get(slug)
    if (!u)
      return odpowiedz(
        res,
        404,
        strona({
          title: 'Nie znaleziono ulicy',
          description: 'Nie ma takiej ulicy w katalogu.',
          canonical: '/katalog',
          robots: 'noindex',
          tresc: '<h1>Nie znaleziono ulicy</h1><p><a href="/katalog">Przejdź do katalogu</a></p>',
        }),
      )
    const adresy = d.adresyUlicy.get(slug) ?? []
    const tresc = `<p><a href="/katalog">Katalog adresów</a></p><h1>${html(u[1])}, ${html(u[2])}</h1><p>Gmina ${html(u[3])}. ${adresy.length} adresów w katalogu.</p><ul>${adresy.map((a) => `<li><a href="/adres/${a[1]}">${html(a[3])}</a></li>`).join('')}</ul>`
    return odpowiedz(
      res,
      200,
      strona({
        title: `${u[1]}, ${u[2]} – adresy`,
        description: `Wszystkie adresy: ${u[1]}, ${u[2]}, gmina ${u[3]}.`,
        canonical: `/katalog/${slug}`,
        tresc,
      }),
    )
  }

  if (view === 'katalog') {
    const ulice = [...d.ulice].sort((a, b) =>
      `${a[2]} ${a[1]}`.localeCompare(`${b[2]} ${b[1]}`, 'pl'),
    )
    const tresc = `<h1>Katalog adresów</h1><p>${d.adresy.length.toLocaleString('pl-PL')} adresów w Krakowie i sąsiednich gminach. Wyszukiwarka pojawi się po załadowaniu aplikacji.</p><ul>${ulice.map((u) => `<li><a href="/katalog/${u[0]}">${html(u[1])}, ${html(u[2])} (${u[4]})</a></li>`).join('')}</ul>`
    return odpowiedz(
      res,
      200,
      strona({
        title: 'Katalog adresów Krakowa',
        description: 'Przeglądaj i wyszukuj adresy oraz ulice Krakowa i sąsiednich gmin.',
        canonical: '/katalog',
        tresc,
      }),
    )
  }

  return odpowiedz(res, 404, 'Nie znaleziono strony')
}
