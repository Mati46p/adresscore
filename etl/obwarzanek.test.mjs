import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import { dopasujGminy, MIARY, parsujRanking } from './obwarzanek.mjs'
import { PRZENIESIONE } from './uprosc-kryteria.mjs'

const USUNIETE_W_171 = new Set(['gmina_powodz_powierzchnia_pct'])

const csv =
  '\uFEFFpozycja;gmina;powiat;wojewodztwo;teryt;wartosc;jednostka;gmin_ogolem;rok;url\r\n1;Kraków;Kraków;małopolskie;1261011;0,00;zl;2479;2025;https://z-dykty.pl/gmina/krakow-1261011\r\n2;Wieliczka;wielicki;małopolskie;1219053;1234,56;zl;2479;2024;https://z-dykty.pl/gmina/wieliczka-1219053\r\n'

test('CSV: BOM, przecinek dziesiętny, rok i rzeczywiste zero', () => {
  const r = parsujRanking(csv, 'zl')
  assert.equal(r.get('1261011').wartosc, 0)
  assert.equal(r.get('1219053').wartosc, 1234.56)
  assert.equal(r.get('1219053').rok, 2024)
  assert.equal(r.get('1206052'), undefined)
})

test('CSV odrzuca duplikaty TERYT i pomylenie jednostek', () => {
  assert.throws(() => parsujRanking(`${csv}${csv.split('\r\n')[1]}\r\n`, 'zl'), /Powtórzony TERYT/)
  assert.throws(() => parsujRanking(csv, 'proc'), /Nieoczekiwana jednostka/)
  assert.throws(() => parsujRanking(csv.replace('1234,56', ''), 'zl'), /Pusta wartość/)
})

test('łączenie z adresami używa TERYT i sprawdza nazwę, w tym homonimy', () => {
  const adresy = [
    { teryt: '1261011', gmina: 'Kraków' },
    { teryt: '1219053', gmina: 'Wieliczka' },
  ]
  assert.equal(dopasujGminy(adresy, parsujRanking(csv, 'zl')).size, 2)
  assert.throws(
    () => dopasujGminy(adresy, new Map([['1219053', { nazwa: 'Kraków' }]])),
    /Nazwa gminy/,
  )
})

test('opublikowane wskaźniki mają zgodną wersję i wartość jednakową w obrębie TERYT', () => {
  const { wersja, adresy } = wczytajAdresy()
  const gminy = JSON.parse(readFileSync(join(DANE, 'gminy-porownanie.json'), 'utf8'))
  assert.equal(gminy.wersjaAdresow, wersja)
  assert.equal(gminy.gminy.length, 14)
  const wiersze = new Map(gminy.gminy.map((g) => [g.teryt, g]))
  for (const m of MIARY) {
    const sciezka = join(DANE, 'wskazniki', `${m.id}.json`)
    if (USUNIETE_W_171.has(m.id)) {
      // usunięte w #171 (etl/uprosc-kryteria.mjs): ani plik wskaźnika, ani miara w porównaniu gmin
      assert.ok(!existsSync(sciezka), `${m.id} nie powinien być opublikowany`)
      assert.ok(!gminy.miary.some((x) => x.id === m.id), m.id)
      assert.ok(
        gminy.gminy.every((g) => !(m.id in g.miary)),
        m.id,
      )
      continue
    }
    const p = JSON.parse(readFileSync(sciezka, 'utf8'))
    assert.equal(p.wersjaAdresow, wersja)
    // Od #171 grupę i kierunek nadaje PRZENIESIONE (etl/uprosc-kryteria.mjs), z wagą startową 0.
    assert.deepEqual([p.meta.kategoria, p.meta.kierunek], PRZENIESIONE[m.id], m.id)
    assert.equal(p.meta.domyslnaWaga, 0, m.id)
    assert.equal(p.wartosci.length, adresy.length)
    const roczniki = [...new Set(gminy.gminy.map((g) => g.miary[m.id]?.rok).filter(Boolean))].sort(
      (a, b) => a - b,
    )
    const dataDanych = `${roczniki.length === 1 ? 'rocznik' : 'roczniki'} ${roczniki.join(', ')}`
    assert.equal(p.meta.zrodla.length, 2)
    for (const zrodlo of p.meta.zrodla) assert.equal(zrodlo.dataDanych, dataDanych)
    for (let i = 0; i < adresy.length; i++) {
      const v = wiersze.get(adresy[i].teryt)?.miary[m.id]?.wartosc ?? null
      assert.equal(p.wartosci[i], v)
    }
  }
})
