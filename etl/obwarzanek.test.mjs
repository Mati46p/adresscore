import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import { dopasujGminy, MIARY, parsujRanking } from './obwarzanek.mjs'

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
    const p = JSON.parse(readFileSync(join(DANE, 'wskazniki', `${m.id}.json`), 'utf8'))
    assert.equal(p.wersjaAdresow, wersja)
    assert.equal(p.meta.kategoria, 'kontekst')
    assert.equal(p.meta.kierunek, 'neutralny')
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
