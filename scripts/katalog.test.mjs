import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import handler from '../api/seo.js'
import { maStalyNaglowek } from '../etl/lib/gzip.mjs'
import { odczytajPreferencje, polaczPreferencje, zapiszPreferencje } from '../src/wynik/sesja.ts'
import { czytajHash } from '../src/wynik/url.ts'

const indeks = JSON.parse(
  gunzipSync(readFileSync(new URL('../api/_seo-index.json.gz', import.meta.url))),
)

function odpowiedz(url) {
  const result = { statusCode: 200, headers: {}, body: '' }
  handler(
    { url },
    {
      set statusCode(v) {
        result.statusCode = v
      },
      setHeader(k, v) {
        result.headers[k] = v
      },
      end(body) {
        result.body = body
      },
    },
  )
  return result
}

test('indeks i sitemapy obejmują wszystkie adresy bez kolizji', () => {
  assert.equal(indeks.adresy.length, 176684)
  assert.equal(new Set(indeks.adresy.map((a) => a[1])).size, indeks.adresy.length)
  const suma = [1, 2, 3, 4].reduce((n, i) => {
    const xml = readFileSync(new URL(`../public/sitemap-adresy-${i}.xml`, import.meta.url), 'utf8')
    const ile = (xml.match(/<url>/g) ?? []).length
    assert.ok(ile <= 50000)
    return n + ile
  }, 0)
  assert.equal(suma, indeks.adresy.length)
})

test('indeks SEO ma nagłówek gzip niezależny od systemu, więc build nie brudzi drzewa (#179)', () => {
  const gz = readFileSync(new URL('../api/_seo-index.json.gz', import.meta.url))
  assert.ok(maStalyNaglowek(gz))
})

test('serwer zwraca unikalny HTML i kanoniczny URL bez ustawień', () => {
  for (const a of [indeks.adresy[0], indeks.adresy[50000], indeks.adresy.at(-1)]) {
    const res = odpowiedz(`/api/seo?view=adres&slug=${a[1]}`)
    assert.equal(res.statusCode, 200)
    assert.ok(res.body.includes(`<title>${a[3]}: okolica w liczbach – adresscore</title>`))
    assert.ok(res.body.includes(`rel="canonical" href="https://adresscore.pl/adres/${a[1]}"`))
    assert.ok(res.body.includes('<h1>'))
    assert.ok(!res.body.includes('u=%7B'))
  }
  const brak = odpowiedz('/api/seo?view=adres&slug=nieznany')
  assert.equal(brak.statusCode, 404)
  assert.ok(brak.body.includes('noindex'))
  const brakUlicy = odpowiedz('/api/seo?view=ulica&slug=nieznana')
  assert.equal(brakUlicy.statusCode, 404)
})

/** Wszystkie bloki JSON-LD strony, sparsowane – błąd składni wywraca test. */
function danePlaskie(body) {
  const bloki = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  return bloki.flatMap((m) => {
    const json = JSON.parse(m[1])
    return json['@graph'] ?? [json]
  })
}

test('strona adresu: dane strukturalne Place i okruszki, pomiary z rejestrów, brak danych to nie zero', () => {
  const a = indeks.adresy[0]
  const res = odpowiedz(`/api/seo?view=adres&slug=${a[1]}`)
  const typy = danePlaskie(res.body).map((x) => x['@type'])
  for (const t of ['Organization', 'WebPage', 'Place', 'BreadcrumbList'])
    assert.ok(typy.includes(t), t)
  const miejsce = danePlaskie(res.body).find((x) => x['@type'] === 'Place')
  assert.equal(miejsce.address.addressCountry, 'PL')
  assert.equal(miejsce.geo.latitude, a[11])
  assert.ok(res.body.includes('property="og:image"'))
  // Tyle wierszy tabeli, ile faktów w indeksie; każdy z wartością albo „brak danych".
  assert.equal((res.body.match(/<tr><th scope="row">/g) ?? []).length, indeks.fakty.length)
  const bezDanych = indeks.adresy.find((x) => x.slice(13).some((v) => v === null))
  if (bezDanych) {
    const r = odpowiedz(`/api/seo?view=adres&slug=${bezDanych[1]}`)
    assert.ok(r.body.includes('brak danych'))
  }
  // `<` z danych idzie jako <, więc tekst adresu nie zamknie bloku JSON-LD przedwcześnie.
  const blok = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(res.body)[1]
  assert.ok(!blok.includes('<'))
})

test('/metoda: Dataset i FAQPage zgodne z treścią strony, wszystkie warstwy w tabeli źródeł', () => {
  const res = odpowiedz('/api/seo?view=metoda')
  assert.equal(res.statusCode, 200)
  assert.ok(res.body.includes('rel="canonical" href="https://adresscore.pl/metoda"'))
  const dane = danePlaskie(res.body)
  const zbior = dane.find((x) => x['@type'] === 'Dataset')
  assert.equal(zbior.variableMeasured.length, indeks.wskazniki.length)
  const faq = dane.find((x) => x['@type'] === 'FAQPage')
  // Google wymaga, żeby pytania z FAQPage były widoczne na stronie.
  for (const q of faq.mainEntity)
    assert.ok(res.body.includes(q.name.replaceAll("'", '&#39;')), q.name)
  // Wiersze: progi liter (A–F i G) plus jedna na każdą warstwę w tabelach źródeł.
  const wiersze = (res.body.match(/<tr><th scope="row">/g) ?? []).length
  assert.equal(wiersze, indeks.progiLiter.length + 1 + indeks.wskazniki.length)
  assert.ok(res.body.includes('src="/seo-boot.js"'))
})

test('nieznana ścieżka to prawdziwe 404 z noindex, bez podnoszenia aplikacji', () => {
  const res = odpowiedz('/api/seo?view=404')
  assert.equal(res.statusCode, 404)
  assert.equal(res.headers['X-Robots-Tag'], 'noindex')
  assert.ok(!res.body.includes('seo-boot.js'))
  const ulice = odpowiedz('/api/seo?view=katalog')
  assert.equal(ulice.statusCode, 200)
  assert.ok(ulice.body.includes('rel="canonical" href="https://adresscore.pl/katalog/ulice"'))
})

test('mapa witryny i llms.txt obejmują stronę metody i listę ulic', () => {
  const xml = readFileSync(new URL('../public/sitemap-katalog.xml', import.meta.url), 'utf8')
  for (const s of ['/metoda', '/katalog/ulice'])
    assert.ok(xml.includes(`https://adresscore.pl${s}</loc>`), s)
  const llms = readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8')
  assert.match(llms, /^# adresscore/)
  assert.ok(llms.includes(indeks.adresy.length.toLocaleString('pl-PL')))
})

test('stary link hash nadal rozpoznaje adres i ustawienia', () => {
  const id = indeks.adresy[0][2]
  const url = czytajHash(`#/adres/${encodeURIComponent(id)}?p=senior&t=kupuje`)
  assert.equal(url.ekran, 'okolica')
  assert.equal(url.idAdresu, id)
  assert.equal(url.tryb, 'kupuje')
})

test('preferencje sesji przeżywają czysty link, a parametry starego linku wygrywają', () => {
  const mapa = new Map()
  const poprzedni = globalThis.sessionStorage
  globalThis.sessionStorage = {
    getItem: (klucz) => mapa.get(klucz) ?? null,
    setItem: (klucz, wartosc) => mapa.set(klucz, wartosc),
  }
  try {
    const zapis = czytajHash(
      '#/?t=wynajmuje&u=%7B%22v%22%3A1%2C%22w%22%3A%7B%22test%22%3A4%7D%2C%22k%22%3A%7B%7D%7D',
    )
    zapiszPreferencje(zapis)
    const odczyt = odczytajPreferencje()
    assert.ok(odczyt)
    const czysty = polaczPreferencje(czytajHash(''), '', odczyt)
    assert.equal(czysty.tryb, 'wynajmuje')
    assert.equal(czysty.ustawienia.wagi.test, 4)
    const staryHash = '#/adres/1?p=senior&t=kupuje&f='
    const stary = polaczPreferencje(czytajHash(staryHash), staryHash, odczyt)
    assert.equal(stary.persona, 'senior')
    assert.equal(stary.tryb, 'kupuje')
    assert.equal(stary.ustawienia, null)
    assert.deepEqual(stary.filtry, [])
  } finally {
    globalThis.sessionStorage = poprzedni
  }
})

test('Wstecz i Dalej odtwarzają ekran i adres bez dopisywania historii', async () => {
  const poprzednie = {
    window: globalThis.window,
    location: globalThis.location,
    history: globalThis.history,
    sessionStorage: globalThis.sessionStorage,
  }
  const zdarzenia = new Map()
  const operacje = []
  globalThis.location = { pathname: '/', hash: '#/' }
  globalThis.window = { addEventListener: (typ, fn) => zdarzenia.set(typ, fn) }
  globalThis.history = {
    pushState: (_stan, _tytul, cel) => {
      operacje.push('push')
      const url = new URL(cel, 'https://adresscore.pl')
      globalThis.location.pathname = url.pathname
      globalThis.location.hash = url.hash
    },
    replaceState: (_stan, _tytul, cel) => {
      operacje.push('replace')
      const url = new URL(cel, 'https://adresscore.pl')
      globalThis.location.pathname = url.pathname
      globalThis.location.hash = url.hash
    },
  }
  globalThis.sessionStorage = { getItem: () => null, setItem: () => {} }
  try {
    const stan = await import('../src/wynik/stan.ts')
    const adres = { id: 'TEST-1', miejscowosc: 'Kraków', ulica: 'Testowa', nr: '1' }
    stan.podlaczDane([adres.id], [], [adres])
    stan.pokazOkolice(0)
    const sciezkaAdresu = globalThis.location.pathname
    assert.match(sciezkaAdresu, /^\/adres\/testowa-1-krakow-/)
    assert.equal(operacje.at(-1), 'push')
    const liczbaOperacji = operacje.length
    globalThis.location.pathname = '/'
    globalThis.location.hash = '#/'
    zdarzenia.get('popstate')()
    assert.equal(stan.pobierzStan().ekran, 'szukaj')
    globalThis.location.pathname = sciezkaAdresu
    globalThis.location.hash = ''
    zdarzenia.get('popstate')()
    assert.equal(stan.pobierzStan().ekran, 'okolica')
    assert.equal(stan.pobierzStan().wybrany, 0)
    assert.equal(operacje.length, liczbaOperacji)
  } finally {
    Object.assign(globalThis, poprzednie)
  }
})
