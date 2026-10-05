// Czyszczenie komunikatów błędów: bez stosu, adresów z query, danych osobowych.
// Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { czyscKomunikat, komunikatZBledu } from './bledy.ts'
import { MAX_KOMUNIKAT } from './kontrakt.ts'

describe('czyscKomunikat', () => {
  it('Error → „Nazwa: komunikat”', () => {
    assert.equal(
      czyscKomunikat(new TypeError("Cannot read properties of undefined (reading 'x')")),
      "TypeError: Cannot read properties of undefined (reading 'x')",
    )
  })

  it('zwykły tekst przechodzi bez zmian', () => {
    assert.equal(czyscKomunikat('Nie udało się wczytać danych'), 'Nie udało się wczytać danych')
  })

  it('bez stosu: zostaje tylko pierwsza linia', () => {
    const blad = new Error('boom')
    blad.stack =
      'Error: boom\n    at funkcja (https://adresscore.pl/assets/index-abc.js:1:2345)\n    at x'
    assert.equal(czyscKomunikat(blad), 'Error: boom')
    assert.equal(czyscKomunikat('pierwsza\ndruga\ntrzecia'), 'pierwsza')
    assert.equal(czyscKomunikat('pierwsza\r\ndruga'), 'pierwsza')
  })

  it('adresy tracą query i fragment, ścieżka zostaje', () => {
    const wynik = czyscKomunikat(
      'Failed to load https://adresscore.pl/assets/chunk-9f.js?token=tajny123&u=jan#sekcja oraz http://x.pl/a/b?c=d',
    )
    assert.equal(
      wynik,
      'Failed to load https://adresscore.pl/assets/chunk-9f.js oraz http://x.pl/a/b',
    )
    assert.ok(!wynik?.includes('tajny'))
    assert.ok(!wynik?.includes('?'))
    assert.ok(!wynik?.includes('#sekcja'))
  })

  it('login i hasło w adresie znikają', () => {
    assert.equal(
      czyscKomunikat('Błąd połączenia z https://jan:haslo123@baza.example.pl/db?x=1'),
      'Błąd połączenia z https://baza.example.pl/db',
    )
  })

  it('adresy e-mail są zastępowane', () => {
    assert.equal(
      czyscKomunikat('Nie można wysłać do jan.kowalski@example.com'),
      'Nie można wysłać do [email]',
    )
  })

  it('ścieżki plików z katalogami użytkownika znikają', () => {
    assert.equal(czyscKomunikat('ENOENT C:\\Users\\jan\\AppData\\x.json'), 'ENOENT [sciezka]')
    assert.equal(czyscKomunikat('open /home/jan/projekt/plik.txt failed'), 'open [sciezka] failed')
    assert.equal(czyscKomunikat('open /Users/jan/plik failed'), 'open [sciezka] failed')
  })

  it('długie liczby (7+ cyfr) zamieniane na #, krótkie zostają', () => {
    assert.equal(czyscKomunikat('id 1234567 i 123456'), 'id # i 123456')
    assert.equal(czyscKomunikat('pesel 44051401359'), 'pesel #')
  })

  it('przycina do 200 znaków', () => {
    const wynik = czyscKomunikat('x'.repeat(500))
    assert.equal(wynik?.length, MAX_KOMUNIKAT)
  })

  it('znaki sterujące i białe znaki zbijane', () => {
    assert.equal(czyscKomunikat('  a\t\tb   c \u0007 d '), 'a b c d')
  })

  it('szum bez wartości diagnostycznej: null', () => {
    assert.equal(czyscKomunikat('Script error.'), null)
    assert.equal(czyscKomunikat('script error'), null)
    assert.equal(
      czyscKomunikat('ResizeObserver loop completed with undelivered notifications.'),
      null,
    )
    assert.equal(czyscKomunikat(''), null)
    assert.equal(czyscKomunikat('   '), null)
  })

  it('wartości nie-tekstowe: bez wyjątku, bez zawartości obiektu', () => {
    assert.equal(czyscKomunikat(undefined), 'bez komunikatu (undefined)')
    assert.equal(czyscKomunikat(null), 'bez komunikatu (object)')
    assert.equal(czyscKomunikat(42), 'bez komunikatu (number)')
    assert.equal(czyscKomunikat({ haslo: 'sekret' }), 'bez komunikatu (object)')
  })

  it('obiekt z polem message (np. odpowiedź sieciowa) używa tylko message', () => {
    assert.equal(czyscKomunikat({ message: 'Network down', token: 'abc' }), 'Network down')
  })
})

describe('komunikatZBledu', () => {
  it('błąd z okna: sam komunikat', () => {
    assert.equal(komunikatZBledu({ powod: new RangeError('za duzo') }), 'RangeError: za duzo')
  })

  it('odrzucona obietnica dostaje prefiks, nadal w limicie 200 znaków', () => {
    assert.equal(
      komunikatZBledu({ powod: new Error('nie wyszlo'), obietnica: true }),
      'odrzucona obietnica: Error: nie wyszlo',
    )
    const dlugi = komunikatZBledu({ powod: 'x'.repeat(500), obietnica: true })
    assert.equal(dlugi?.length, MAX_KOMUNIKAT)
  })

  it('skrypty rozszerzeń przeglądarki są pomijane', () => {
    for (const plik of [
      'chrome-extension://abc/content.js',
      'moz-extension://abc/x.js',
      'safari-web-extension://abc/x.js',
      'webkit-masked-url://hidden/',
    ]) {
      assert.equal(komunikatZBledu({ powod: 'Cos poszlo nie tak', plik }), null, plik)
    }
    assert.equal(
      komunikatZBledu({ powod: 'Cos poszlo nie tak', plik: 'https://adresscore.pl/assets/a.js' }),
      'Cos poszlo nie tak',
    )
  })

  it('szum i puste: null', () => {
    assert.equal(komunikatZBledu({ powod: 'Script error.' }), null)
    assert.equal(komunikatZBledu({ powod: '' }), null)
  })
})
