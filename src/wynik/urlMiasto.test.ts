// Trasa #/miasto i przełącznik trybów (#92, #108): tryb Miasto (luki w usługach i symulator
// inwestycji) ma adres #/miasto z parametrami obiektów (`a=`, `b=`) i warstwy luk (`w=`), stary
// #/symulator dalej działa, a nagłówek zna dokładnie dwa tryby.
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
    assert.equal(s.ekran, 'miasto')
    assert.deepEqual(s.symulacja, { a: A, b: B })
  })

  it('stary adres #/symulator dalej działa, także z obiektami', () => {
    const s = czytajHash(`#/symulator?a=${A}&b=${B}`)
    assert.equal(s.ekran, 'miasto')
    assert.deepEqual(s.symulacja, { a: A, b: B })
    assert.equal(czytajHash('#/symulator').ekran, 'miasto')
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

describe('warstwa luk w linku (#92: #/miasto?w=<warstwa>)', () => {
  it('link do konkretnej luki: warstwa z parametru w, przeżywa parsuj → serializuj → parsuj', () => {
    const s = czytajHash('#/miasto?w=przystanek_odleglosc')
    assert.equal(s.ekran, 'miasto')
    assert.equal(s.warstwaLuk, 'przystanek_odleglosc')
    const zapis = zapiszHash(s)
    assert.ok(zapis.includes('w=przystanek_odleglosc'), zapis)
    assert.deepEqual(czytajHash(zapis), s)
  })

  it('warstwa idzie razem z obiektami symulatora, a brak parametru = domyślna warstwa', () => {
    const s = czytajHash(`#/miasto?a=${A}&w=halas_ldwn`)
    assert.equal(s.warstwaLuk, 'halas_ldwn')
    assert.deepEqual(s.symulacja, { a: A, b: '' })
    assert.equal(czytajHash('#/miasto').warstwaLuk, null)
    assert.ok(!/[?&]w=/.test(zapiszHash(czytajHash('#/miasto'))))
  })

  it('id spoza dozwolonego zapisu odpada, zamiast trafić do stanu', () => {
    for (const zle of ['../x', 'A', '1abc', 'a b', '', 'x'.repeat(80), 'a;b']) {
      assert.equal(czytajHash(`#/miasto?w=${encodeURIComponent(zle)}`).warstwaLuk, null, zle)
    }
    // Nieznane, ale poprawnie zapisane id przechodzi (panel sam wraca do pierwszej warstwy).
    assert.equal(czytajHash('#/miasto?w=nie_ma_takiej').warstwaLuk, 'nie_ma_takiej')
  })

  it('parametr w poza ekranem Miasto nic nie znaczy i nie jest zapisywany', () => {
    assert.equal(czytajHash('#/?w=przystanek_odleglosc').warstwaLuk, undefined)
    assert.equal(czytajHash('#/biznes?w=przystanek_odleglosc').warstwaLuk, undefined)
    const zMiasta = czytajHash('#/miasto?w=przystanek_odleglosc')
    assert.ok(!/[?&]w=/.test(zapiszHash({ ...zMiasta, ekran: 'szukaj' })))
    assert.ok(!/[?&]w=/.test(zapiszHash({ ...zMiasta, ekran: 'biznes' })))
  })
})

describe('przełącznik trybów w nagłówku', () => {
  it('są dokładnie dwa tryby: Miasto i Biznes, każdy z własnym ekranem i napisem', () => {
    assert.deepEqual(
      TRYBY_APLIKACJI.map((t) => [t.id, t.ekran]),
      [
        ['miasto', 'miasto'],
        ['biznes', 'biznes'],
      ],
    )
    for (const t of TRYBY_APLIKACJI) assert.ok(t.etykieta.length > 0)
    assert.equal(new Set(TRYBY_APLIKACJI.map((t) => t.etykieta)).size, TRYBY_APLIKACJI.length)
  })

  it('tryb ekranu: tylko Miasto i Biznes są trybami, reszta to zwykła praca mieszkańca', () => {
    const inne: Ekran[] = ['szukaj', 'okolica', 'porownanie', 'metoda', 'katalog']
    for (const e of inne) assert.equal(trybEkranu(e), null, e)
    assert.equal(trybEkranu('miasto'), 'miasto')
    assert.equal(trybEkranu('biznes'), 'biznes')
    // W nagłówku wybrany jest co najwyżej jeden tryb (akcent ma jeden element).
    for (const e of [...inne, 'miasto', 'biznes'] as Ekran[]) {
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
