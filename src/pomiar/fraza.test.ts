// Normalizacja frazy i filtr danych osobowych. Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizujFraze, ZNACZNIK_ODRZUCONO, zawieraDaneOsobowe } from './fraza.ts'
import { MAX_FRAZA } from './kontrakt.ts'

const fraza = (tekst: string) => {
  const w = normalizujFraze(tekst)
  return 'fraza' in w ? w.fraza : null
}

describe('normalizujFraze: kształt frazy', () => {
  it('małe litery, zbite spacje i trim', () => {
    assert.deepEqual(normalizujFraze('  Ul.   Długa \t 5\n Kraków  '), {
      fraza: 'ul. długa 5 kraków',
    })
  })

  it('polskie litery: wielkie diakrytyki schodzą do małych', () => {
    assert.equal(fraza('ŁÓDŹ ŚWIĘTOKRZYSKA ŻÓŁĆ'), 'łódź świętokrzyska żółć')
    assert.equal(fraza('Ćwiklińskiej'), 'ćwiklińskiej')
  })

  it('NFC: rozłożone znaki diakrytyczne składają się w jeden znak', () => {
    const rozlozone = 'Kraków'
    const wynik = fraza(rozlozone)
    assert.equal(wynik, 'kraków')
    assert.equal(wynik, fraza('Kraków'))
  })

  it('przycina do 80 znaków i nie zostawia spacji na końcu', () => {
    const dluga = `${'a'.repeat(79)} bbb`
    const wynik = fraza(dluga)
    assert.ok(wynik !== null && wynik.length <= MAX_FRAZA)
    assert.equal(wynik, 'a'.repeat(79))
    assert.equal(fraza('x'.repeat(200))?.length, MAX_FRAZA)
  })

  it('nie rozcina pary zastępczej na granicy limitu', () => {
    const wynik = fraza(`${'a'.repeat(79)}😀`)
    assert.equal(wynik, 'a'.repeat(79))
  })

  it('fraza pusta albo z samych białych znaków jest odrzucona', () => {
    assert.deepEqual(normalizujFraze(''), { odrzucono: true })
    assert.deepEqual(normalizujFraze(' \n\t '), { odrzucono: true })
  })

  it('znacznik odrzucenia mieści się w limicie frazy', () => {
    assert.ok(ZNACZNIK_ODRZUCONO.length <= MAX_FRAZA)
  })
})

describe('normalizujFraze: dane osobowe', () => {
  const odrzucane = [
    'jan.kowalski@gmail.com',
    'mój mail to jan@example.pl ul. Długa',
    'ktos＠poczta.pl',
    '@',
    'a@b',
    '123456789',
    '44051401359',
    '123 456 789',
    '123-456-789',
    '123.456.789',
    '+48 123 456 789',
    '+48 (12) 345 67 89',
    '12 345 67 89',
    '123-456-78-90',
    '4111 1111 1111 1111',
    'tel. 600 700 800 Kraków',
    '123 - 456 - 789',
  ]
  for (const tekst of odrzucane) {
    it(`odrzuca „${tekst}”`, () => {
      assert.deepEqual(normalizujFraze(tekst), { odrzucono: true })
    })
  }

  it('numer ukryty za 80. znakiem też odrzuca całą frazę', () => {
    const tekst = `${'a'.repeat(85)} 600 700 800`
    assert.deepEqual(normalizujFraze(tekst), { odrzucono: true })
  })

  const przepuszczane = [
    'ul. Długa 123/45, 31-001 Kraków',
    'Floriańska 12, 31-021 Kraków',
    'al. 3 Maja 12/14',
    'Kraków 30-001',
    'os. Oświecenia 32',
    'ul. Długa 12 30-001 Kraków',
    'rondo Mogilskie 1',
  ]
  for (const tekst of przepuszczane) {
    it(`przepuszcza adres „${tekst}”`, () => {
      const w = normalizujFraze(tekst)
      assert.ok('fraza' in w, `fraza „${tekst}” została odrzucona`)
    })
  }
})

describe('zawieraDaneOsobowe', () => {
  it('8 cyfr to jeszcze nie telefon', () => {
    assert.equal(zawieraDaneOsobowe('12345678'), false)
    assert.equal(zawieraDaneOsobowe('123456789'), true)
  })

  it('cyfry rozdzielone literami są osobnymi ciągami', () => {
    assert.equal(zawieraDaneOsobowe('123 abc 456 def 789'), false)
  })
})
