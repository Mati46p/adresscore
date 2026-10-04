import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hrefDla, pobierzStan, przejdz, ustawBranze, ustawPunktBiznesu } from './stan.ts'
import { czytajHash, zapiszHash } from './url.ts'

const A = '19.940000,50.060000'
const C = '19.950000,50.070000'

test('link biznesu z branżą i dwoma punktami przeżywa parsuj → serializuj → parsuj', () => {
  const hash = `#/biznes?b=apteka&a=${A}&c=${C}`
  const stan = czytajHash(hash)
  assert.equal(stan.ekran, 'biznes')
  assert.equal(stan.branza, 'apteka')
  assert.deepEqual(stan.punktA, { lon: 19.94, lat: 50.06 })
  assert.deepEqual(stan.punktB, { lon: 19.95, lat: 50.07 })

  const zapis = zapiszHash(stan)
  // Regresja P0: `q` było liczone przed dopisaniem b/a/c, więc zapis dawał gołe `#/biznes`.
  assert.notEqual(zapis, '#/biznes')
  assert.match(zapis, /^#\/biznes\?/)
  assert.ok(zapis.includes('b=apteka'), zapis)
  assert.ok(zapis.includes(`a=${A}`), zapis)
  assert.ok(zapis.includes(`c=${C}`), zapis)
  assert.deepEqual(czytajHash(zapis), stan)
})

test('zapis jest stały: drugi obieg daje ten sam hash', () => {
  const pierwszy = zapiszHash(czytajHash(`#/biznes?b=kawiarnia&a=${A}&c=${C}`))
  assert.equal(zapiszHash(czytajHash(pierwszy)), pierwszy)
})

test('sama branża, jeden punkt i domyślna branża też wracają po zapisie', () => {
  for (const hash of [
    '#/biznes?b=apteka',
    `#/biznes?b=fryzjer&a=${A}`,
    `#/biznes?b=piekarnia&c=${C}`,
    '#/biznes',
  ]) {
    const stan = czytajHash(hash)
    const zapis = zapiszHash(stan)
    assert.deepEqual(czytajHash(zapis), stan, hash)
    assert.ok(zapis.includes(`b=${stan.branza}`), zapis)
  }
  assert.equal(czytajHash('#/biznes').branza, 'sklep')
})

test('punkt poza Małopolską albo uszkodzony nie wchodzi do linku', () => {
  const stan = czytajHash('#/biznes?b=apteka&a=10,10&c=abc')
  assert.equal(stan.punktA, null)
  assert.equal(stan.punktB, null)
  const zapis = zapiszHash(stan)
  assert.ok(!/[?&](a|c)=/.test(zapis), zapis)
  assert.ok(zapis.includes('b=apteka'), zapis)
})

test('nieprawidłowa nazwa branży wraca do sklepu', () => {
  assert.equal(czytajHash('#/biznes?b=../../x').branza, 'sklep')
  assert.equal(czytajHash('#/biznes?b=Apteka').branza, 'sklep')
})

test('link biznesu zachowuje też tryb i personę', () => {
  const hash = `#/biznes?t=biznes&p=senior&b=kawiarnia&a=${A}`
  const stan = czytajHash(hash)
  const zapis = zapiszHash(stan)
  assert.deepEqual(czytajHash(zapis), stan)
  assert.ok(zapis.includes('t=biznes') && zapis.includes('p=senior'), zapis)
  assert.ok(zapis.includes('b=kawiarnia') && zapis.includes(`a=${A}`), zapis)
})

test('parametry a/b symulatora nie przeciekają do biznesu i odwrotnie', () => {
  const symulator = zapiszHash(czytajHash('#/symulator?a=xyz&b=uvw'))
  assert.ok(symulator.includes('a=xyz') && symulator.includes('b=uvw'), symulator)
  assert.ok(!symulator.includes('c='), symulator)
  const szukaj = zapiszHash({ ...czytajHash(`#/biznes?b=apteka&a=${A}`), ekran: 'szukaj' })
  assert.ok(!/[?&](a|b|c)=/.test(szukaj), szukaj)
})

test('stan aplikacji składa link biznesu z branżą i punktami (odświeżenie nie gubi wyboru)', () => {
  przejdz('biznes')
  ustawBranze('apteka')
  ustawPunktBiznesu('a', { lon: 19.94, lat: 50.06 })
  ustawPunktBiznesu('b', { lon: 19.95, lat: 50.07 })
  const s = pobierzStan()
  const href = hrefDla(s, {})
  assert.ok(href.includes('#/biznes?'), href)
  assert.ok(href.includes('b=apteka'), href)
  assert.ok(href.includes(`a=${A}`), href)
  assert.ok(href.includes(`c=${C}`), href)
  // Ten sam link czytany z powrotem (jak po F5) odtwarza branżę i punkty.
  const odczyt = czytajHash(href.slice(href.indexOf('#')))
  assert.equal(odczyt.ekran, 'biznes')
  assert.equal(odczyt.branza, 'apteka')
  assert.deepEqual(odczyt.punktA, { lon: 19.94, lat: 50.06 })
  assert.deepEqual(odczyt.punktB, { lon: 19.95, lat: 50.07 })
})
