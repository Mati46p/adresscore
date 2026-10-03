import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { gunzipSync } from 'node:zlib'
import handler from '../api/seo.js'
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

test('serwer zwraca unikalny HTML i kanoniczny URL bez ustawień', () => {
  for (const a of [indeks.adresy[0], indeks.adresy[50000], indeks.adresy.at(-1)]) {
    const res = odpowiedz(`/api/seo?view=adres&slug=${a[1]}`)
    assert.equal(res.statusCode, 200)
    assert.ok(res.body.includes(`<title>${a[3]} – adresscore</title>`))
    assert.ok(res.body.includes(`rel="canonical" href="https://adresscore.pl/adres/${a[1]}"`))
    assert.ok(res.body.includes('<h1>'))
    assert.ok(!res.body.includes('u=%7B'))
  }
  const brak = odpowiedz('/api/seo?view=adres&slug=nieznany')
  assert.equal(brak.statusCode, 404)
  assert.ok(brak.body.includes('noindex'))
  const brakUlicy = odpowiedz('/api/seo?view=ulica&slug=nieznana')
  assert.equal(brakUlicy.statusCode, 404)
  const katalog = odpowiedz('/api/seo?view=katalog')
  assert.equal(katalog.statusCode, 200)
  assert.ok(katalog.body.includes('rel="canonical" href="https://adresscore.pl/katalog"'))
})

test('stary link hash nadal rozpoznaje adres i ustawienia', () => {
  const id = indeks.adresy[0][2]
  const url = czytajHash(`#/adres/${encodeURIComponent(id)}?p=senior&t=kupuje`)
  assert.equal(url.ekran, 'okolica')
  assert.equal(url.idAdresu, id)
  assert.equal(url.tryb, 'kupuje')
})
