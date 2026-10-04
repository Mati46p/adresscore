// Trasa #/miasto i przełącznik trybów (#92, #108): tryb Miasto (symulator inwestycji) ma adres
// #/miasto, stary #/symulator dalej działa, a nagłówek zna dokładnie dwa tryby.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { obiektyDoTekstu } from './symulacjaUrl.ts'
import { TRYBY_APLIKACJI, trybEkranu } from './trybyAplikacji.ts'
import { czytajHash, type Ekran, zapiszHash } from './url.ts'

const A = obiektyDoTekstu([{ typ: 'przystanek', lon: 19.9372, lat: 50.0614 }])
const B = obiektyDoTekstu([{ typ: 'aed', lon: 19.95, lat: 50.07 }])

describe('trasa #/miasto', () => {
  it('#/miasto otwiera tryb Miasto z obiektami z linku', () => {
    const s = czytajHash(`#/miasto?a=${A}&b=${B}`)
    assert.equal(s.ekran, 'symulator')
    assert.deepEqual(s.symulacja, { a: A, b: B })
  })

  it('stary adres #/symulator dalej działa, także z obiektami', () => {
    const s = czytajHash(`#/symulator?a=${A}&b=${B}`)
    assert.equal(s.ekran, 'symulator')
    assert.deepEqual(s.symulacja, { a: A, b: B })
    assert.equal(czytajHash('#/symulator').ekran, 'symulator')
  })

  it('stan zapisuje się pod nowym adresem, a link ze starego adresu zamienia się na nowy', () => {
    const zeStarego = czytajHash(`#/symulator?a=${A}`)
    const zapis = zapiszHash(zeStarego)
    assert.match(zapis, /^#\/miasto\?/)
    assert.ok(zapis.includes(`a=${A}`), zapis)
    assert.deepEqual(czytajHash(zapis), zeStarego)
    assert.equal(zapiszHash(czytajHash('#/miasto')), '#/miasto')
  })

  it('obiekty Miasta nie przeciekają do innych ekranów i odwrotnie', () => {
    assert.equal(czytajHash(`#/porownanie?a=${A}`).symulacja, undefined)
    assert.ok(!/[?&]a=/.test(zapiszHash({ ...czytajHash(`#/miasto?a=${A}`), ekran: 'szukaj' })))
  })
})

describe('przełącznik trybów w nagłówku', () => {
  it('są dokładnie dwa tryby: Miasto i Biznes, każdy z własnym ekranem i napisem', () => {
    assert.deepEqual(
      TRYBY_APLIKACJI.map((t) => [t.id, t.ekran]),
      [
        ['miasto', 'symulator'],
        ['biznes', 'biznes'],
      ],
    )
    for (const t of TRYBY_APLIKACJI) assert.ok(t.etykieta.length > 0)
    assert.equal(new Set(TRYBY_APLIKACJI.map((t) => t.etykieta)).size, TRYBY_APLIKACJI.length)
  })

  it('tryb ekranu: tylko Miasto i Biznes są trybami, reszta to zwykła praca mieszkańca', () => {
    const inne: Ekran[] = ['szukaj', 'okolica', 'porownanie', 'metoda', 'katalog']
    for (const e of inne) assert.equal(trybEkranu(e), null, e)
    assert.equal(trybEkranu('symulator'), 'miasto')
    assert.equal(trybEkranu('biznes'), 'biznes')
    // W nagłówku wybrany jest co najwyżej jeden tryb (akcent ma jeden element).
    for (const e of [...inne, 'symulator', 'biznes'] as Ekran[]) {
      assert.ok(TRYBY_APLIKACJI.filter((t) => t.id === trybEkranu(e)).length <= 1, e)
    }
  })

  it('adres każdego trybu prowadzi z powrotem do jego ekranu', () => {
    const bazowy = czytajHash('#/')
    const adresy: Record<string, RegExp> = { miasto: /^#\/miasto/, biznes: /^#\/biznes/ }
    for (const t of TRYBY_APLIKACJI) {
      const hash = zapiszHash({ ...bazowy, ekran: t.ekran })
      assert.match(hash, adresy[t.id] as RegExp)
      const s = czytajHash(hash)
      assert.equal(s.ekran, t.ekran)
      assert.equal(trybEkranu(s.ekran), t.id)
    }
  })
})
