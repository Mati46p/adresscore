import assert from 'node:assert/strict'
import test from 'node:test'
import { gunzipSync, gzipSync } from 'node:zlib'
import { GZIP_BAJT_SYSTEMU, gzipDeterministyczny, maStalyNaglowek } from './gzip.mjs'

const dane = Buffer.from(
  JSON.stringify({
    adresy: Array.from({ length: 800 }, (_, i) => [i, `ulica ${i % 17}`, `${(i * 7) % 90}`]),
  }),
)

test('dwie kompresje tego samego bufora dają identyczne bajty', () => {
  const a = gzipDeterministyczny(dane)
  const b = gzipDeterministyczny(Buffer.from(dane))
  assert.equal(Buffer.compare(a, b), 0)
})

test('nagłówek: MTIME 0, bajt systemu 255 na offsecie 9, reszta jak w zlib poziomu 9', () => {
  const gz = gzipDeterministyczny(dane)
  assert.equal(GZIP_BAJT_SYSTEMU, 255)
  assert.deepEqual([...gz.subarray(0, 4)], [0x1f, 0x8b, 8, 0]) // magia, deflate, bez pól opcjonalnych
  assert.deepEqual([...gz.subarray(4, 8)], [0, 0, 0, 0]) // MTIME
  assert.equal(gz[8], 2) // XFL: najwolniejsza kompresja = poziom 9
  assert.equal(gz[9], 255)
})

test('strumień deflate bez zmian: ten sam poziom 9, inny jest tylko nagłówek', () => {
  const zlib = gzipSync(dane, { level: 9 })
  const gz = gzipDeterministyczny(dane)
  assert.equal(gz.length, zlib.length)
  assert.equal(Buffer.compare(gz.subarray(10), zlib.subarray(10)), 0)
})

test('plik rozpakowuje się zwykłym gunzip i DecompressionStream z przeglądarki', async () => {
  const gz = gzipDeterministyczny(dane)
  assert.equal(Buffer.compare(gunzipSync(gz), dane), 0)
  const strumien = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))
  const wynik = Buffer.from(await new Response(strumien).arrayBuffer())
  assert.equal(Buffer.compare(wynik, dane), 0)
})

test('przyjmuje tekst jak gzipSync, a pusty bufor też daje poprawny gzip', () => {
  const gz = gzipDeterministyczny('adresscore – Kraków')
  assert.equal(gunzipSync(gz).toString('utf8'), 'adresscore – Kraków')
  assert.equal(gunzipSync(gzipDeterministyczny(Buffer.alloc(0))).length, 0)
})

test('maStalyNaglowek rozróżnia nasz nagłówek od nagłówka dowolnego systemu i czasu', () => {
  assert.ok(maStalyNaglowek(gzipDeterministyczny(dane)))
  for (const system of [3, 10, 19]) {
    const obcy = gzipSync(dane, { level: 9 })
    obcy[9] = system // tak zapisują zlib Linuksa, Windowsa i macOS
    assert.ok(!maStalyNaglowek(obcy), `bajt systemu ${system}`)
  }
  const zCzasem = gzipDeterministyczny(dane)
  zCzasem.writeUInt32LE(1_700_000_000, 4)
  assert.ok(!maStalyNaglowek(zCzasem))
  assert.ok(!maStalyNaglowek(Buffer.alloc(4)))
})
