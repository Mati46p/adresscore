import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

// Strony renderowane na serwerze dla wyszukiwarek i modeli AI (większość z nich nie wykonuje JS):
// /adres/:slug, /katalog/:slug, /metoda i 404. Po wczytaniu seo-boot.js podnosi na nich aplikację.
// Indeks liczy scripts/generuj-katalog.mjs przy każdym buildzie.

const DOMENA = 'https://adresscore.pl'
const NAZWA = 'adresscore'
const OBRAZ_OG = `${DOMENA}/og.png`
const REPO = 'https://github.com/Mati46p/adresscore'
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

/** JSON-LD w <script>: `<` jako \u003c, żeby tekst z danych nie zamknął znacznika. */
function jsonLd(obiekt) {
  return `<script type="application/ld+json">${JSON.stringify(obiekt).replaceAll('<', '\\u003c')}</script>`
}

const liczba = (n) => Number(n).toLocaleString('pl-PL')

function wartoscFaktu(v, jednostka) {
  if (v === null || v === undefined) return null
  if (jednostka === '%') return `${liczba(v)}%`
  return jednostka ? `${liczba(v)} ${jednostka}` : liczba(v)
}

// Krótkie nazwy faktów do opisu strony (meta description ~160 znaków). Fakt spoza listy nie
// trafia do opisu, ale zostaje w tabeli.
const KROTKO = {
  przystanek_odleglosc: 'przystanek',
  sklep_odleglosc: 'sklep',
  zielen_worldcover_100m: 'zieleń w promieniu 100 m',
  pm25_srednia: 'PM2,5',
}

const ORGANIZACJA = {
  '@type': 'Organization',
  '@id': `${DOMENA}/#organizacja`,
  name: NAZWA,
  url: `${DOMENA}/`,
  logo: `${DOMENA}/logo-512.png`,
  sameAs: [REPO],
}

function okruszki(sciezki) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: sciezki.map(([nazwa, sciezka], i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: nazwa,
      item: `${DOMENA}${sciezka}`,
    })),
  }
}

function okruszkiHtml(sciezki) {
  return `<nav aria-label="Okruszki" class="okruszki"><ol>${sciezki
    .map(([nazwa, sciezka], i) =>
      i === sciezki.length - 1
        ? `<li aria-current="page">${html(nazwa)}</li>`
        : `<li><a href="${sciezka}">${html(nazwa)}</a></li>`,
    )
    .join('')}</ol></nav>`
}

const STYL =
  'body{font:16px/1.55 "IBM Plex Sans",system-ui,sans-serif;color:#18202b;margin:0;background:#f5f6f4}#root{max-width:1100px;margin:auto;padding:24px 16px}a{color:#1f5c46}li{margin:.35em 0}header nav{display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center}h1{line-height:1.2;margin:.6em 0 .3em}.lead{font-size:1.1em;max-width:70ch}.okruszki ol{list-style:none;display:flex;flex-wrap:wrap;gap:6px;padding:0;margin:16px 0 0;font-size:.9em}.okruszki li+li::before{content:"›";margin-right:6px;color:#5b6570}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:.95em}th,td{text-align:left;padding:8px;border-bottom:1px solid #d9dcd6;vertical-align:top}thead th{font-weight:600}.zrodlo{color:#4a545e;font-size:.85em}.tabela{overflow-x:auto}footer{margin-top:40px;padding-top:16px;border-top:1px solid #d9dcd6;color:#4a545e;font-size:.9em}'

function strona({
  title,
  description,
  canonical,
  tresc,
  robots = 'index, follow, max-image-preview:large',
  schemat = [],
  aplikacja = true,
  stanDanych,
}) {
  const pelnyTytul = `${title} – ${NAZWA}`
  const url = `${DOMENA}${canonical}`
  const ld = schemat.length
    ? jsonLd({ '@context': 'https://schema.org', '@graph': [ORGANIZACJA, ...schemat] })
    : ''
  const stopka = `<footer><p>${stanDanych ? `Stan danych: ${html(stanDanych)}. ` : ''}Dane z rejestrów publicznych i otwartych zbiorów; źródło, licencja i data każdej warstwy: <a href="/metoda">Metoda i źródła</a>. Wynik nie jest wyceną nieruchomości ani poradą.</p></footer>`
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${html(pelnyTytul)}</title><meta name="description" content="${html(description)}"><meta name="robots" content="${robots}"><link rel="canonical" href="${url}"><meta name="theme-color" content="#1F5C46"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta property="og:type" content="website"><meta property="og:site_name" content="${NAZWA}"><meta property="og:locale" content="pl_PL"><meta property="og:title" content="${html(title)}"><meta property="og:description" content="${html(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${OBRAZ_OG}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="adresscore – jakość życia pod każdym adresem"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${html(title)}"><meta name="twitter:description" content="${html(description)}"><meta name="twitter:image" content="${OBRAZ_OG}">${ld}<style>${STYL}</style></head><body><div id="root"><header><nav aria-label="Główna"><a href="/"><strong>adresscore</strong></a><a href="/katalog">Katalog adresów</a><a href="/metoda">Metoda i źródła</a></nav></header><main>${tresc}</main>${stopka}</div>${aplikacja ? '<script defer src="/seo-boot.js"></script>' : ''}</body></html>`
}

function odpowiedz(res, kod, tresc) {
  res.statusCode = kod
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // Treść zmienia się tylko z deployem (indeks w paczce funkcji), a deploy czyści cache CDN.
  res.setHeader(
    'Cache-Control',
    kod === 200
      ? 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800'
      : 'public, max-age=0, s-maxage=3600',
  )
  if (kod !== 200) res.setHeader('X-Robots-Tag', 'noindex')
  res.end(tresc)
}

function nieZnaleziono(res, d, { title, tekst }) {
  return odpowiedz(
    res,
    404,
    strona({
      title,
      description: tekst,
      canonical: '/katalog',
      robots: 'noindex, follow',
      aplikacja: false,
      stanDanych: d.stanDanych,
      tresc: `<h1>${html(title)}</h1><p class="lead">${html(tekst)}</p><ul><li><a href="/">Wyszukaj adres na mapie</a></li><li><a href="/katalog">Przeglądaj katalog adresów</a></li><li><a href="/metoda">Jak liczymy wynik i skąd są dane</a></li></ul>`,
    }),
  )
}

function stronaAdresu(res, d, slug) {
  const a = d.poAdresie.get(slug)
  if (!a)
    return nieZnaleziono(res, d, {
      title: 'Nie znaleziono adresu',
      tekst:
        'Nie ma takiego adresu w katalogu. Mógł zmienić numer albo zniknąć z rejestru adresów.',
    })
  const [, , , tytul, miejscowosc, gmina, ulica, nr, kod, slugUlicy, lon, lat, dzielnica] = a
  const wartosci = a.slice(13)
  const mediany = d.medianyGmin?.[gmina] ?? []
  const fakty = (d.fakty ?? []).map((f, i) => ({ ...f, v: wartosci[i], mediana: mediany[i] }))
  const zDanymi = fakty.filter((f) => f.v !== null && f.v !== undefined)
  const u = d.poUlicy.get(slugUlicy)
  const nazwaUlicy = u ? `${u[1]}, ${u[2]}` : miejscowosc
  const sciezki = [
    ['adresscore', '/'],
    ['Katalog adresów', '/katalog'],
    [nazwaUlicy, `/katalog/${slugUlicy}`],
    [tytul, `/adres/${slug}`],
  ]
  const polozenie = [
    kod ? `kod pocztowy ${html(kod)}` : null,
    dzielnica ? `dzielnica ${html(dzielnica)}` : null,
    `gmina ${html(gmina)}`,
  ]
    .filter(Boolean)
    .join(', ')

  const wiersze = fakty
    .map((f) => {
      const v = wartoscFaktu(f.v, f.jednostka)
      const m = wartoscFaktu(f.mediana, f.jednostka)
      return `<tr><th scope="row">${html(f.nazwa)}</th><td>${v ? html(v) : '<span class="zrodlo">brak danych</span>'}</td><td>${m ? html(m) : '–'}</td><td class="zrodlo">${f.url ? `<a href="${html(f.url)}" rel="nofollow noopener">${html(f.zrodlo)}</a>` : html(f.zrodlo)}; stan ${html(f.dataDanych)}; rozdzielczość: ${html(f.rozdzielczosc)}</td></tr>`
    })
    .join('')
  const tabela = fakty.length
    ? `<h2>Okolica w liczbach</h2><p>Pomiary z rejestrów publicznych dla punktu adresowego. Odległości w linii prostej, nie długość dojścia. Brak danych nie jest zerem.</p><div class="tabela"><table><caption class="zrodlo">Wartość pod adresem ${html(tytul)} i mediana adresów w gminie ${html(gmina)}</caption><thead><tr><th scope="col">Pomiar</th><th scope="col">Pod tym adresem</th><th scope="col">Mediana w gminie</th><th scope="col">Źródło</th></tr></thead><tbody>${wiersze}</tbody></table></div>`
    : ''

  const sasiednie = (d.adresyUlicy.get(slugUlicy) ?? []).filter((x) => x[1] !== slug).slice(0, 12)
  const tresc = `${okruszkiHtml(sciezki)}<h1>${html(tytul)}</h1><p class="lead">Adres ${html(tytul)}: ${polozenie}. Poniżej pomiary z rejestrów publicznych dla tego punktu. Wynik od 0 do 100 i litera A–G zależą od wybranego profilu, więc liczy je aplikacja – karta adresu otwiera się na tej stronie.</p>${tabela}<h2>Inne adresy na tej ulicy</h2><ul>${sasiednie.map((x) => `<li><a href="/adres/${x[1]}">${html(x[3])}</a></li>`).join('')}</ul><p><a href="/katalog/${slugUlicy}">Wszystkie adresy: ${html(nazwaUlicy)}</a></p>`

  // Opis z liczbami: unikalny dla każdej strony i cytowalny („przystanek 141 m, sklep 188 m").
  const skrot = zDanymi
    .filter((f) => KROTKO[f.id])
    .slice(0, 4)
    .map((f) => `${KROTKO[f.id]} ${wartoscFaktu(f.v, f.jednostka)}`)
    .join(', ')
  const description = skrot
    ? `${tytul}: ${skrot}. Dane z rejestrów publicznych, ze źródłem i datą.`
    : `${tytul} – karta okolicy i dane z rejestrów publicznych dla gminy ${gmina}.`

  const miejsce = {
    '@type': 'Place',
    '@id': `${DOMENA}/adres/${slug}#miejsce`,
    name: tytul,
    url: `${DOMENA}/adres/${slug}`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: ulica ? `${ulica} ${nr}` : `${miejscowosc} ${nr}`,
      addressLocality: miejscowosc,
      ...(kod ? { postalCode: kod } : {}),
      addressRegion: 'małopolskie',
      addressCountry: 'PL',
    },
    ...(typeof lat === 'number' && typeof lon === 'number'
      ? { geo: { '@type': 'GeoCoordinates', latitude: lat, longitude: lon } }
      : {}),
    containedInPlace: { '@type': 'AdministrativeArea', name: `Gmina ${gmina}` },
    additionalProperty: zDanymi.map((f) => ({
      '@type': 'PropertyValue',
      name: f.nazwa,
      value: f.v,
      ...(f.jednostka ? { unitText: f.jednostka } : {}),
    })),
  }
  return odpowiedz(
    res,
    200,
    strona({
      title: `${tytul}: okolica w liczbach`,
      description,
      canonical: `/adres/${slug}`,
      tresc,
      stanDanych: d.stanDanych,
      schemat: [
        {
          '@type': 'WebPage',
          '@id': `${DOMENA}/adres/${slug}`,
          url: `${DOMENA}/adres/${slug}`,
          name: tytul,
          inLanguage: 'pl-PL',
          ...(d.stanDanych ? { dateModified: d.stanDanych } : {}),
          about: { '@id': miejsce['@id'] },
          isPartOf: { '@id': `${DOMENA}/#witryna` },
        },
        miejsce,
        okruszki(sciezki),
      ],
    }),
  )
}

function stronaUlicy(res, d, slug) {
  const u = d.poUlicy.get(slug)
  if (!u)
    return nieZnaleziono(res, d, {
      title: 'Nie znaleziono ulicy',
      tekst: 'Nie ma takiej ulicy w katalogu.',
    })
  const adresy = d.adresyUlicy.get(slug) ?? []
  const nazwa = `${u[1]}, ${u[2]}`
  const sciezki = [
    ['adresscore', '/'],
    ['Katalog adresów', '/katalog'],
    [nazwa, `/katalog/${slug}`],
  ]
  const tresc = `${okruszkiHtml(sciezki)}<h1>${html(nazwa)}</h1><p class="lead">Gmina ${html(u[3])}. ${liczba(adresy.length)} ${adresy.length === 1 ? 'adres' : 'adresów'} w katalogu. Każdy adres ma własną stronę z pomiarami z rejestrów publicznych: odległość do przystanku, sklepu i szkoły, zieleń, hałas i powietrze.</p><ul>${adresy.map((a) => `<li><a href="/adres/${a[1]}">${html(a[3])}</a></li>`).join('')}</ul>`
  return odpowiedz(
    res,
    200,
    strona({
      title: `${nazwa} – adresy i okolica`,
      description: `${nazwa}, gmina ${u[3]}: ${liczba(adresy.length)} adresów z danymi o okolicy z rejestrów publicznych – dojazd, usługi, zieleń, hałas, powietrze.`,
      canonical: `/katalog/${slug}`,
      tresc,
      stanDanych: d.stanDanych,
      schemat: [okruszki(sciezki)],
    }),
  )
}

function stronaKatalogu(res, d) {
  const ulice = [...d.ulice].sort((a, b) =>
    `${a[2]} ${a[1]}`.localeCompare(`${b[2]} ${b[1]}`, 'pl'),
  )
  const sciezki = [
    ['adresscore', '/'],
    ['Katalog adresów', '/katalog'],
    ['Wszystkie ulice', '/katalog/ulice'],
  ]
  const tresc = `${okruszkiHtml(sciezki)}<h1>Wszystkie ulice i miejscowości w katalogu</h1><p class="lead">${liczba(d.ulice.length)} ulic i miejscowości, ${liczba(d.adresy.length)} adresów w Krakowie i sąsiednich gminach. W nawiasie liczba adresów. <a href="/katalog">Wyszukiwarka adresów</a></p><ul>${ulice.map((u) => `<li><a href="/katalog/${u[0]}">${html(u[1])}, ${html(u[2])} (${u[4]})</a></li>`).join('')}</ul>`
  return odpowiedz(
    res,
    200,
    strona({
      title: 'Wszystkie ulice Krakowa i okolic w katalogu',
      description: `Lista ${liczba(d.ulice.length)} ulic i miejscowości w Krakowie i sąsiednich gminach – każda z adresami i danymi o okolicy z rejestrów publicznych.`,
      canonical: '/katalog/ulice',
      tresc,
      stanDanych: d.stanDanych,
      // Strona z linkami do wszystkich ulic: dla robota hub, w aplikacji wystarcza wyszukiwarka.
      aplikacja: false,
      schemat: [okruszki(sciezki)],
    }),
  )
}

/**
 * Strona metody dla wyszukiwarek i modeli AI. W aplikacji tę samą treść pokazuje
 * src/strony/Metoda.tsx (ekran #/metoda) – zmiana zasad liczenia wymaga zmiany w obu miejscach.
 * Tabela źródeł i progi liter pochodzą z danych (indeks), więc same się aktualizują.
 */
function stronaMetody(res, d) {
  const progi = d.progiLiter ?? []
  const ostatniProg = progi.at(-1)?.[1]
  const wierszeProgow = [
    ...progi.map(([litera, prog], i) => {
      const wyzszy = i === 0 ? null : progi[i - 1][1]
      return `<tr><th scope="row">${litera}</th><td>${wyzszy ? `od ${prog} do poniżej ${wyzszy}` : `od ${prog}`}</td></tr>`
    }),
    `<tr><th scope="row">G</th><td>poniżej ${ostatniProg}</td></tr>`,
  ].join('')
  const gminy = d.gminy ?? []
  const wsk = d.wskazniki ?? []
  const kolejnosc = Object.keys(d.kategorie ?? {})
  const grupy = kolejnosc
    .map((k) => [k, wsk.filter((w) => w.kategoria === k)])
    .filter(([, lista]) => lista.length)
  const tabele = grupy
    .map(
      ([k, lista]) =>
        `<h3>${html(d.kategorie[k])} (${lista.length})</h3><div class="tabela"><table><thead><tr><th scope="col">Warstwa</th><th scope="col">Rozdzielczość</th><th scope="col">Adresy z danymi</th><th scope="col">Źródło, licencja, stan danych</th></tr></thead><tbody>${lista
          .map(
            (w) =>
              `<tr><th scope="row">${html(w.nazwa)}${w.jednostka ? ` <span class="zrodlo">[${html(w.jednostka)}]</span>` : ''}</th><td>${html(w.rozdzielczosc)}</td><td>${liczba(w.zDanymi)}</td><td class="zrodlo">${w.zrodla
                .map(
                  (z) =>
                    `${z.url ? `<a href="${html(z.url)}" rel="nofollow noopener">${html(z.nazwa)}</a>` : html(z.nazwa)}; ${html(z.licencja)}; stan ${html(z.dataDanych)}`,
                )
                .join('<br>')}</td></tr>`,
          )
          .join('')}</tbody></table></div>`,
    )
    .join('')

  const faq = [
    [
      'Skąd pochodzą dane adresscore?',
      `Z rejestrów publicznych i otwartych zbiorów danych: ${wsk.length} warstw, m.in. z Portalu MSIP Krakowa, Państwowego Rejestru Granic GUGiK, modeli jakości powietrza GIOŚ, rozkładów jazdy GTFS, map hałasu, ESA WorldCover i OpenStreetMap. Przy każdej warstwie podajemy źródło, licencję i datę stanu danych.`,
    ],
    [
      'Jak liczony jest wynik adresu?',
      `Każdy pomiar zamieniamy na ocenę od 0 do 100: warstwy bez normy według miejsca w rozkładzie adresów (mediana = 50), warstwy z normą liniowo, z normą w środku skali. Użytkownik nadaje warstwom wagi od 0 do ${d.wagaMax ?? 4}. Wynik to średnia ważona ocen z warstw, które mają dane pod tym adresem.`,
    ],
    [
      'Co oznacza litera od A do G?',
      `Litera zależy od wyniku: ${progi.map(([l, p]) => `${l} od ${p}`).join(', ')}, G poniżej ${ostatniProg}.`,
    ],
    [
      'Co, jeśli pod adresem brakuje danych?',
      'Brak danych to szara kategoria, nigdy zero. Warstwa bez danych nie obniża wyniku, ale obniża kompletność danych, którą pokazujemy obok wyniku.',
    ],
    [
      'Jaki obszar obejmuje adresscore?',
      `${liczba(d.adresy.length)} punktów adresowych w ${gminy.length} gminach: ${gminy.join(', ')}.`,
    ],
    [
      'Jak aktualne są dane?',
      `Stan danych: ${d.stanDanych ?? 'brak daty'}. Dane liczymy jednorazowo skryptem i serwujemy jako pliki. Datę każdej warstwy podaje tabela źródeł – część rejestrów publikuje dane raz na kilka lat (np. mapy hałasu 2022).`,
    ],
    [
      'Czy wynik to wycena nieruchomości?',
      'Nie. Wynik opisuje otoczenie adresu według wybranych wag. Nie jest wyceną, poradą inwestycyjną ani oceną mieszkańców. Nie oceniamy adresów według przestępczości.',
    ],
  ]
  const faqHtml = `<h2 id="pytania">Najczęstsze pytania</h2>${faq.map(([p, o]) => `<h3>${html(p)}</h3><p>${html(o)}</p>`).join('')}`

  const tresc = `${okruszkiHtml([
    ['adresscore', '/'],
    ['Metoda i źródła', '/metoda'],
  ])}<h1>Metoda i źródła: skąd bierze się wynik adresu</h1><p class="lead">adresscore łączy ${wsk.length} warstw z rejestrów publicznych w jedną ocenę od 0 do 100 i literę od A do G dla ${liczba(d.adresy.length)} adresów w Krakowie i ${gminy.length - 1} sąsiednich gminach. Ta strona pokazuje, jak liczymy, skąd mamy dane i czego jeszcze nie wiemy.</p>
<h2 id="jak">Jak liczymy</h2><ol>
<li><strong>Mierzymy.</strong> Każda warstwa ma surowy pomiar w swojej jednostce: decybele, metry, liczba odjazdów na godzinę. Brak pomiaru zapisujemy jako brak danych.</li>
<li><strong>Zamieniamy pomiar na ocenę 0–100.</strong> Warstwy bez normy oceniamy według miejsca pomiaru w rozkładzie adresów z danymi: mediana daje 50 punktów, wartości na krańcach 0 i 100. W warstwach z normą (np. wytyczne WHO dla pyłów) norma leży w środku skali i daje 50; przekroczenie normy zawsze daje mniej. Warstwy gminne i powiatowe są liniowe od najsłabszej do najlepszej jednostki.</li>
<li><strong>Ustawiasz wagi.</strong> Każdej warstwie nadajesz wagę od 0 do ${d.wagaMax ?? 4}; waga 0 wyłącza warstwę. Gotowe profile (np. rodzina, senior) ustawiają wagi za Ciebie.</li>
<li><strong>Liczymy średnią ważoną z warstw, które mają dane.</strong> Waga warstwy bez danych nie ciągnie wyniku w dół.</li>
<li><strong>Podajemy kompletność danych</strong> – udział wag warstw z danymi w wadze wszystkich liczonych warstw.</li>
<li><strong>Przypisujemy literę.</strong></li>
</ol>
<div class="tabela"><table><caption class="zrodlo">Progi liter</caption><thead><tr><th scope="col">Litera</th><th scope="col">Wynik</th></tr></thead><tbody>${wierszeProgow}</tbody></table></div>
<h2>Zasady bez wyjątków</h2><ul><li><strong>Brak danych to szary, nigdy zero.</strong> Adres bez danych nie dostaje kary.</li><li><strong>Kontekst nie wpływa na wynik.</strong> Kategoria „${html(d.kategorie?.kontekst ?? 'Kontekst')}" pokazuje fakty, na przykład ceny, i nie wchodzi do średniej.</li><li><strong>Bez przestępczości per adres.</strong> Takie liczby piętnują biedniejsze osiedla; statystyki przestępczości pokazujemy najwyżej na poziomie gminy albo rejonu komendy policji.</li><li><strong>Odległości to linia prosta</strong>, nie długość dojścia ulicami.</li></ul>
<p>Na mapie liczymy średnią wyników adresów w każdym heksie (komórka siatki H3 o boku około 65 m). Heks, w którym żaden adres nie ma wyniku, jest szary.</p>
<h2 id="zrodla">Źródła danych (${wsk.length} warstw)</h2><p>Tabela powstaje z manifestu danych aplikacji. Kolumna „Adresy z danymi" pokazuje, dla ilu z ${liczba(d.adresy.length)} adresów warstwa ma wartość. Dane z Portalu MSIP Krakowa wykorzystujemy na zasadach jego regulaminu; dane OpenStreetMap na licencji ODbL (© OpenStreetMap contributors).</p>${tabele}
${faqHtml}`

  const [minLat, minLon, maxLat, maxLon] = d.obszar ?? []
  const zbior = {
    '@type': 'Dataset',
    '@id': `${DOMENA}/metoda#dane`,
    name: 'adresscore – wskaźniki jakości życia dla adresów w Krakowie i okolicach',
    description: `${wsk.length} warstw danych z rejestrów publicznych przypisanych do ${liczba(d.adresy.length)} punktów adresowych w ${gminy.length} gminach (Kraków i sąsiednie gminy): dojazd i komunikacja, usługi w zasięgu pieszym, hałas, jakość powietrza, zieleń, ryzyka środowiskowe, finanse gmin. Każda warstwa ma źródło, licencję, datę stanu danych i rozdzielczość.`,
    url: `${DOMENA}/metoda`,
    inLanguage: 'pl-PL',
    keywords: [
      'jakość życia',
      'adresy',
      'Kraków',
      'dane otwarte',
      'rejestry publiczne',
      'H3',
      'hałas',
      'jakość powietrza',
      'komunikacja miejska',
    ],
    creator: { '@id': ORGANIZACJA['@id'] },
    publisher: { '@id': ORGANIZACJA['@id'] },
    isAccessibleForFree: true,
    ...(d.stanDanych ? { dateModified: d.stanDanych } : {}),
    ...(Number.isFinite(minLat)
      ? {
          spatialCoverage: {
            '@type': 'Place',
            name: `Kraków i sąsiednie gminy: ${gminy.join(', ')}`,
            geo: { '@type': 'GeoShape', box: `${minLat} ${minLon} ${maxLat} ${maxLon}` },
          },
        }
      : {}),
    variableMeasured: wsk.map((w) => w.nazwa),
    isBasedOn: [
      ...new Map(
        wsk
          .flatMap((w) => w.zrodla)
          .map((z) => [z.url, { '@type': 'CreativeWork', name: z.nazwa, url: z.url }]),
      ).values(),
    ].filter((z) => z.url),
    distribution: [
      {
        '@type': 'DataDownload',
        name: 'Manifest warstw',
        encodingFormat: 'application/json',
        contentUrl: `${DOMENA}/dane/manifest.json`,
      },
      {
        '@type': 'DataDownload',
        name: 'Punkty adresowe',
        encodingFormat: 'application/json',
        contentUrl: `${DOMENA}/dane/adresy.json`,
      },
    ],
  }
  return odpowiedz(
    res,
    200,
    strona({
      title: 'Metoda i źródła danych – jak liczymy wynik adresu',
      description: `Jak adresscore liczy wynik 0–100 i literę A–G dla ${liczba(d.adresy.length)} adresów w Krakowie i okolicach: ${wsk.length} warstw z rejestrów publicznych, źródła, licencje i daty.`,
      canonical: '/metoda',
      tresc,
      stanDanych: d.stanDanych,
      schemat: [
        zbior,
        {
          '@type': 'FAQPage',
          '@id': `${DOMENA}/metoda#pytania`,
          mainEntity: faq.map(([p, o]) => ({
            '@type': 'Question',
            name: p,
            acceptedAnswer: { '@type': 'Answer', text: o },
          })),
        },
        okruszki([
          ['adresscore', '/'],
          ['Metoda i źródła', '/metoda'],
        ]),
      ],
    }),
  )
}

export default function handler(req, res) {
  const q = new URL(req.url ?? '/', 'https://example.invalid').searchParams
  const view = q.get('view')
  const slug = q.get('slug') ?? ''
  const d = indeks()

  if (view === 'adres') return stronaAdresu(res, d, slug)
  if (view === 'ulica') return stronaUlicy(res, d, slug)
  if (view === 'katalog') return stronaKatalogu(res, d)
  if (view === 'metoda') return stronaMetody(res, d)
  return nieZnaleziono(res, d, {
    title: 'Nie ma takiej strony',
    tekst: 'Ten adres strony nie istnieje. Sprawdź link albo wyszukaj adres w katalogu.',
  })
}
