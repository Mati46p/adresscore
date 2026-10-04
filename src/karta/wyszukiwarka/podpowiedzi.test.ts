// Podpowiedzi wyszukiwarki: adresy i okolice w jednej liście (#185). Uruchom: node --test src/karta/wyszukiwarka/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Adres } from '../../kontrakty/index.ts'
import type { PlikOkolic } from '../../kontrakty/okolice.ts'
import { maNumerDomu, zbudujIndeks } from './indeks.ts'
import { MAKS_OKOLIC_PRZED_ADRESAMI, podpowiedzi, type ZrodlaPodpowiedzi } from './podpowiedzi.ts'
import { zbudujIndeksOkolic } from './szukajOkolic.ts'

const adres = (i: number, ulica: string, nr: string, miejscowosc = 'Kraków'): Adres => ({
  i,
  id: `t-${i}`,
  miejscowosc,
  ulica,
  nr,
  kod: '31-001',
  dzielnica: miejscowosc === 'Kraków' ? 'I Stare Miasto' : null,
  gmina: miejscowosc,
  teryt: '1261011',
  lon: 19.9,
  lat: 50,
  h3: '',
})

const ADRESY: Adres[] = [
  ...['1', '2', '5', '52'].map((n, k) => adres(k, 'Grodzka', n)),
  ...['1', '2', '3'].map((n, k) => adres(10 + k, 'Kazimierza Wielkiego', n)),
  ...['4', '5'].map((n, k) => adres(20 + k, 'Ruczajowa', n)),
  adres(30, 'Osiedle Dywizjonu 303', '1'),
]

const sim = (
  nazwa: string,
  numer: string,
  potoczne: string[] = [],
): PlikOkolic['okolice'][string] => ({
  nazwa,
  numer,
  rodzaj: 'sim',
  dzielnica: 'I Stare Miasto',
  gmina: 'Kraków',
  powierzchniaKm2: 1,
  liczbaAdresow: 100,
  potoczne,
})

const WPISY: PlikOkolic['okolice'] = {
  'sim-108': sim('Kazimierz', 'I.8'),
  'sim-805': sim('Ruczaj', 'VIII.5'),
  'sim-1002': sim('Kliny', 'X.9', ['Osiedle Dywizjonu 303']),
  'sim-901': sim('Kazimierzowka', 'IX.1'),
  'sim-902': sim('Kazimierzowice', 'IX.2'),
  'sim-903': sim('Kazimierzowo', 'IX.3'),
  'sim-904': sim('Kazimierzowice Górne', 'IX.4'),
  'sim-905': sim('Kazimierzowice Dolne', 'IX.5'),
}

const zrodla: ZrodlaPodpowiedzi = {
  adresy: zbudujIndeks(ADRESY),
  okolice: zbudujIndeksOkolic({ okolice: WPISY, idOkolic: Object.keys(WPISY) }),
}

const klucze = (q: string, z: ZrodlaPodpowiedzi = zrodla, limit?: number) =>
  podpowiedzi(q, z, limit).map((p) => p.klucz)

describe('maNumerDomu', () => {
  it('numer to ostatni token od cyfry, ale nie pierwszy', () => {
    assert.equal(maNumerDomu('Grodzka 52'), true)
    assert.equal(maNumerDomu('grodzka 52a'), true)
    assert.equal(maNumerDomu('Grodzka 52 Kraków'), true)
    assert.equal(maNumerDomu('Grodzka 7/9'), true)
    assert.equal(maNumerDomu('Wieliczka 17'), true)
    assert.equal(maNumerDomu('3 Maja'), false)
    assert.equal(maNumerDomu('Ruczaj'), false)
    assert.equal(maNumerDomu(''), false)
  })
})

describe('podpowiedzi: pole szuka i adresów, i okolic', () => {
  it('wpis z numerem: adresy mają pierwszeństwo, okolic nie ma', () => {
    assert.deepEqual(klucze('Grodzka 52'), ['a:3'])
    const lista = podpowiedzi('Ruczajowa 4', zrodla)
    assert.deepEqual(
      lista.map((p) => p.rodzaj),
      ['adres'],
    )
  })

  it('wpis z numerem bez adresu: okolica, której nazwa ma cyfry', () => {
    // „Dywizjonu 303” wygląda jak adres (numer na końcu), ale żaden adres tej ulicy nie ma numeru 303.
    const lista = podpowiedzi('Dywizjonu 303', { adresy: zrodla.adresy, okolice: zrodla.okolice })
    assert.deepEqual(
      lista.map((p) => [p.rodzaj, p.klucz]),
      [['okolica', 'o:sim-1002']],
    )
  })

  it('wpis bez numeru: okolica pierwsza, adresy po niej', () => {
    const lista = podpowiedzi('Kazimierz', zrodla)
    assert.equal(lista[0]?.klucz, 'o:sim-108')
    assert.equal(lista[0]?.rodzaj, 'okolica')
    const adresowe = lista.filter((p) => p.rodzaj === 'adres')
    assert.ok(adresowe.length > 0, 'ulica Kazimierza Wielkiego zostaje na liście')
    assert.ok(lista.findIndex((p) => p.rodzaj === 'adres') > 0)
  })

  it('wpis bez numeru, bez okolic: sama ulica jak dawniej', () => {
    assert.deepEqual(klucze('Grodzka'), ['a:0', 'a:1', 'a:2', 'a:3'])
  })

  it('okolice zajmują przed adresami co najwyżej tyle miejsc, ile ustalono; reszta idzie na koniec', () => {
    const wiele = podpowiedzi('Kazimierz', zrodla, 8)
    const przedAdresami = wiele.findIndex((p) => p.rodzaj === 'adres')
    assert.equal(przedAdresami, MAKS_OKOLIC_PRZED_ADRESAMI)
    assert.equal(wiele.length, 8)
    assert.ok(wiele.length <= 8)
  })

  it('limit obowiązuje całą listę', () => {
    assert.equal(podpowiedzi('Kazimierz', zrodla, 3).length, 3)
    assert.equal(podpowiedzi('Kazimierz', zrodla, 1).length, 1)
  })
})

describe('podpowiedzi: pole szuka tylko okolic albo tylko adresów', () => {
  const tylkoOkolice: ZrodlaPodpowiedzi = { adresy: null, okolice: zrodla.okolice }
  const tylkoAdresy: ZrodlaPodpowiedzi = { adresy: zrodla.adresy, okolice: null }

  it('tylko okolice: wpis z numerem nie daje adresów, a nazwa daje okolicę', () => {
    assert.deepEqual(klucze('Ruczaj', tylkoOkolice), ['o:sim-805'])
    assert.deepEqual(klucze('Grodzka 52', tylkoOkolice), [])
    const [p] = podpowiedzi('Ruczaj', tylkoOkolice)
    assert.equal(p?.rodzaj, 'okolica')
    assert.equal(p?.tytul, 'Ruczaj')
    assert.match(p?.opis ?? '', /jednostka SIM VIII\.5/)
    if (p?.rodzaj === 'okolica') assert.equal(p.okolica.id, 'sim-805')
  })

  it('tylko adresy: lista jak z `szukaj` (okolice nie wchodzą)', () => {
    assert.deepEqual(klucze('Grodzka 52', tylkoAdresy), ['a:3'])
    assert.deepEqual(klucze('Ruczaj', tylkoAdresy), ['a:20', 'a:21'])
    for (const p of podpowiedzi('Ruczaj', tylkoAdresy)) assert.equal(p.rodzaj, 'adres')
  })

  it('żadnego źródła: pusta lista', () => {
    assert.deepEqual(podpowiedzi('Ruczaj', { adresy: null, okolice: null }), [])
  })

  it('klucze są unikalne i stabilne (adres i okolica nie zlewają się w jeden klucz)', () => {
    const lista = podpowiedzi('Kazimierz', zrodla, 20)
    assert.equal(new Set(lista.map((p) => p.klucz)).size, lista.length)
  })
})
