// Adres panelu wokół logowania Google: adres powrotu, sprzątanie śladów i komunikaty błędów.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { czytajHash } from '../wynik/url.ts'
import {
  ADRES_PANELU,
  adresPoSprzataniu,
  adresPowrotu,
  analizujPowrot,
  komunikatLogowania,
} from './adresLogowania.ts'

describe('adres powrotu z logowania', () => {
  it('to strona główna z ?panel i fragmentem #/panel, z originem bieżącej strony', () => {
    assert.equal(adresPowrotu('https://adresscore.pl'), 'https://adresscore.pl/?panel#/panel')
    assert.equal(adresPowrotu('http://localhost:5180'), 'http://localhost:5180/?panel#/panel')
  })

  it('router czyta adres powrotu jako ekran panelu także po obcięciu fragmentu', () => {
    const url = new URL(adresPowrotu('https://adresscore.pl'))
    assert.equal(czytajHash(url.hash, url.search).ekran, 'panel')
    assert.equal(czytajHash('', url.search).ekran, 'panel')
  })
})

describe('sprzątanie adresu po logowaniu', () => {
  it('ślady logowania w query prowadzą do czystego /#/panel (hash zostaje)', () => {
    for (const search of [
      '?code=abc',
      '?panel',
      '?panel=',
      '?code=abc&panel=',
      '?error=access_denied&error_description=Denied',
      '?error_code=500',
      '?sb_flow_id=x',
    ]) {
      assert.equal(adresPoSprzataniu(search), ADRES_PANELU, search)
    }
    assert.equal(ADRES_PANELU, '/#/panel')
  })

  it('bez śladów logowania adres zostaje nietknięty (null)', () => {
    for (const search of ['', '?', '?pokaz=1', '?q=panel']) {
      assert.equal(adresPoSprzataniu(search), null, search)
    }
  })

  it('wynik sprzątania nadal otwiera panel w routerze', () => {
    assert.equal(czytajHash('#/panel').ekran, 'panel')
  })
})

describe('powrót z logowania i komunikaty', () => {
  it('rozpoznaje kod i brak błędu', () => {
    assert.deepEqual(analizujPowrot('?code=abc&panel=', '#/panel'), { bylKod: true, blad: null })
    assert.deepEqual(analizujPowrot('', '#/panel'), { bylKod: false, blad: null })
  })

  it('anulowanie u dostawcy to osobny, krótki komunikat', () => {
    assert.equal(
      analizujPowrot('?error=access_denied&error_description=User+denied', '#/panel').blad,
      'Logowanie zostało anulowane.',
    )
  })

  it('inny błąd dostawcy niesie jego opis (przycięty), także z fragmentu', () => {
    assert.equal(
      analizujPowrot('?error=server_error&error_description=Unable+to+exchange+code', '').blad,
      'Logowanie nie powiodło się: Unable to exchange code',
    )
    assert.equal(
      analizujPowrot('', '#error=server_error&error_description=Zly+kod').blad,
      'Logowanie nie powiodło się: Zly kod',
    )
    const dlugi = analizujPowrot(`?error=x&error_description=${'a'.repeat(500)}`, '').blad ?? ''
    assert.ok(dlugi.length < 260)
  })

  it('sam error bez opisu to ogólny komunikat', () => {
    assert.equal(analizujPowrot('?error=server_error', '').blad, 'Logowanie nie powiodło się.')
  })

  it('komunikat: błąd dostawcy wygrywa, kod bez sesji znaczy nieudaną wymianę, reszta cisza', () => {
    assert.equal(
      komunikatLogowania({ bylKod: true, blad: 'Logowanie zostało anulowane.' }, false),
      'Logowanie zostało anulowane.',
    )
    assert.match(
      komunikatLogowania({ bylKod: true, blad: null }, false) ?? '',
      /Nie udało się dokończyć/,
    )
    assert.equal(komunikatLogowania({ bylKod: true, blad: null }, true), null)
    assert.equal(komunikatLogowania({ bylKod: false, blad: null }, false), null)
  })
})
