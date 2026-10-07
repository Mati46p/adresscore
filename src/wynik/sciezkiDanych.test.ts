// Układ plików pobocznych miasta (#223) kontra dane w public/dane: ścieżki, które kod składa dla
// każdego miasta, muszą wskazywać istniejące pliki, a pliki tylko krakowskie (D8) – nie istnieć w
// miastach. Uruchom: node --test src/wynik/sciezkiDanych.test.ts
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { MIASTA } from '../kontrakty/miasta.ts'
import {
  czyKatalogDanych,
  czySciezkaGrafu,
  popytDostepny,
  sciezkaBranzy,
  sciezkaGrafu,
  sciezkaKafla,
  sciezkaKataloguUslug,
  sciezkaPopytu,
  sciezkaSzkol,
} from './sciezkiDanych.ts'

const PUBLIC = new URL('../../public/', import.meta.url)

/** Katalog danych zbioru tak, jak daje go `bazaDanych` przy `BASE_URL` = `/`. */
const bazaZbioru = (katalog: string) => (katalog ? `/dane/${katalog}` : '/dane')

/** Plik pod ścieżką serwisu (`/dane/…`) na dysku. */
const naDysku = (sciezka: string) => new URL(sciezka.slice(1), PUBLIC)

const KRAKOW = bazaZbioru('')
const LUBLIN = bazaZbioru('miasta/lublin')

describe('składanie ścieżek', () => {
  it('Kraków: katalog główny, miasto: miasta/<slug>', () => {
    assert.equal(sciezkaGrafu(KRAKOW), '/dane/dojazd/graf.json')
    assert.equal(sciezkaGrafu(LUBLIN), '/dane/miasta/lublin/dojazd/graf.json')
    assert.equal(sciezkaKataloguUslug(KRAKOW), '/dane/uslugi/katalog.json')
    assert.equal(sciezkaBranzy(LUBLIN, 'apteka'), '/dane/miasta/lublin/uslugi/apteka.json')
    assert.equal(sciezkaPopytu(KRAKOW), '/dane/biznes/popyt.json')
    assert.equal(sciezkaSzkol(LUBLIN), '/dane/miasta/lublin/szkoly_e8_szczegoly.json')
    assert.equal(
      sciezkaKafla(LUBLIN, '871e2d080ffffff'),
      '/dane/miasta/lublin/budynki/871e2d080ffffff.json',
    )
  })

  it('ścieżki różnych miast nigdy się nie pokrywają (klucz pamięci plików)', () => {
    const grafy = MIASTA.map((m) => sciezkaGrafu(bazaZbioru(m.katalog)))
    assert.equal(new Set(grafy).size, MIASTA.length)
  })
})

describe('pliki, które kod zakłada w każdym zbiorze, istnieją we wszystkich', () => {
  for (const m of MIASTA) {
    const baza = bazaZbioru(m.katalog)

    it(`${m.slug}: graf dojazdu, katalog branż, szczegóły szkół`, () => {
      for (const sciezka of [sciezkaGrafu(baza), sciezkaKataloguUslug(baza), sciezkaSzkol(baza)]) {
        assert.ok(existsSync(naDysku(sciezka)), `brak pliku ${sciezka}`)
      }
    })

    it(`${m.slug}: plik każdej branży z katalogu`, () => {
      const katalog = JSON.parse(readFileSync(naDysku(sciezkaKataloguUslug(baza)), 'utf8')) as {
        branze: { id: string }[]
      }
      assert.ok(katalog.branze.length > 0, 'pusty katalog branż')
      for (const b of katalog.branze) {
        const sciezka = sciezkaBranzy(baza, b.id)
        assert.ok(existsSync(naDysku(sciezka)), `brak pliku ${sciezka}`)
      }
    })

    it(`${m.slug}: kafle budynków (nazwa kafla = komórka H3 r7)`, () => {
      const kafle = readdirSync(naDysku(`${baza}/budynki/`)).filter((p) => p.endsWith('.json'))
      assert.ok(kafle.length > 0, 'brak kafli budynków')
      for (const plik of kafle) {
        const h3 = plik.slice(0, -'.json'.length)
        assert.ok(existsSync(naDysku(sciezkaKafla(baza, h3))), plik)
        assert.match(h3, /^87[0-9a-f]{13}$/, `${plik}: to nie komórka H3 r7`)
      }
    })
  }
})

describe('pliki tylko krakowskie (D8) – bramki „Na razie tylko w Krakowie” mają pokrycie w danych', () => {
  // Funkcja → plik względem katalogu danych. Pojawienie się pliku w mieście to sygnał, że bramka danej
  // funkcji (`tylkoKrakow()` w komponencie) jest już zbędna; zniknięcie z Krakowa – że funkcja przestała działać.
  const TYLKO_KRAKOW = {
    'wyszukiwarka okolic (okolice.json)': 'okolice.json',
    'granice jednostek SIM': 'okolice-granice.geojson',
    'tryb Biznes (popyt)': 'biznes/popyt.json',
    'plan miejscowy (katalog)': 'mpzp_adresy.json',
    'plan miejscowy (sąsiedztwo)': 'mpzp_sasiedztwo.json',
    'pozwolenia na budowę': 'pozwolenia.geojson',
  } as const

  const poza = MIASTA.filter((m) => m.katalog !== '')

  it('Kraków ma wszystkie te pliki', () => {
    for (const [funkcja, plik] of Object.entries(TYLKO_KRAKOW)) {
      assert.ok(existsSync(naDysku(`${KRAKOW}/${plik}`)), `${funkcja}: brak ${plik} w Krakowie`)
    }
  })

  it('żadne miasto ich nie ma (inaczej zdejmij bramkę tej funkcji)', () => {
    assert.ok(poza.length > 0)
    for (const m of poza) {
      for (const [funkcja, plik] of Object.entries(TYLKO_KRAKOW)) {
        assert.equal(
          existsSync(naDysku(`${bazaZbioru(m.katalog)}/${plik}`)),
          false,
          `${funkcja}: ${m.slug} ma już ${plik} – bramka „tylko Kraków” jest zbędna`,
        )
      }
    }
  })

  it('popytDostepny zgadza się z plikiem popytu w każdym zbiorze', () => {
    for (const m of MIASTA) {
      const baza = bazaZbioru(m.katalog)
      assert.equal(popytDostepny(baza), existsSync(naDysku(sciezkaPopytu(baza))), m.slug)
    }
  })

  it('popytDostepny rozpoznaje miasto także przy prefiksie ścieżki serwisu', () => {
    assert.equal(popytDostepny('/dane'), true)
    assert.equal(popytDostepny('/aplikacja/dane'), true)
    assert.equal(popytDostepny('/dane/miasta/lodz'), false)
    assert.equal(popytDostepny('/aplikacja/dane/miasta/lodz'), false)
  })
})

describe('katalog danych z wiadomości do workera', () => {
  it('przyjmuje katalogi zbiorów', () => {
    for (const m of MIASTA) assert.equal(czyKatalogDanych(bazaZbioru(m.katalog)), true, m.slug)
    assert.equal(czyKatalogDanych('/aplikacja/dane/miasta/lodz'), true)
  })

  it('odrzuca wszystko, co nie jest ścieżką od korzenia z bezpiecznych segmentów', () => {
    for (const zle of [
      '',
      '/',
      'dane',
      'dane/miasta/lodz',
      '/dane/',
      '/dane//miasta',
      '/dane/../sekret',
      '/dane/./miasta',
      '/dane?x=1',
      '/dane#czesc',
      '/dane/miasta/łódź',
      'https://obcy.example/dane',
      '//obcy.example/dane',
      '/dane miasta',
      '/dane\\miasta',
      null,
      undefined,
      42,
      { toString: () => '/dane' },
    ]) {
      assert.equal(czyKatalogDanych(zle), false, JSON.stringify(zle))
    }
  })

  it('czySciezkaGrafu: tylko graf dojazdu w katalogu danych', () => {
    for (const m of MIASTA) {
      assert.equal(czySciezkaGrafu(sciezkaGrafu(bazaZbioru(m.katalog))), true, m.slug)
    }
    for (const zle of [
      '/dane/adresy.json',
      '/dane/dojazd/graf.json.bak',
      '/dane/../dojazd/graf.json',
      '/dojazd/graf.json',
      '/dane/miasta/lodz/kompakt/dojazd/graf.json?x=1',
      'https://obcy.example/dane/dojazd/graf.json',
      null,
      undefined,
    ]) {
      assert.equal(czySciezkaGrafu(zle), false, JSON.stringify(zle))
    }
  })
})
