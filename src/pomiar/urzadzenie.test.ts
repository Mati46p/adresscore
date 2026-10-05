// Klasa urządzenia z UA. Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { klasaUrzadzeniaZUa } from './urzadzenie.ts'

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  androidTelefon:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  firefoxTablet: 'Mozilla/5.0 (Android 13; Tablet; rv:127.0) Gecko/127.0 Firefox/127.0',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadOs:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  chromeOs:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  telewizor:
    'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36',
  konsola:
    'Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15',
  curl: 'curl/8.4.0',
  python: 'python-requests/2.31.0',
}

describe('klasaUrzadzeniaZUa', () => {
  it('telefony', () => {
    assert.equal(klasaUrzadzeniaZUa(UA.iphone), 'mobile')
    assert.equal(klasaUrzadzeniaZUa(UA.androidTelefon), 'mobile')
    assert.equal(klasaUrzadzeniaZUa('Mozilla/5.0 (Windows Phone 10.0) Mobile'), 'mobile')
  })

  it('tablety: iPad, Android bez „Mobile”, Firefox Tablet', () => {
    assert.equal(klasaUrzadzeniaZUa(UA.ipad), 'tablet')
    assert.equal(klasaUrzadzeniaZUa(UA.androidTablet), 'tablet')
    assert.equal(klasaUrzadzeniaZUa(UA.firefoxTablet), 'tablet')
  })

  it('iPadOS podający się za Maca: tablet tylko z ekranem dotykowym', () => {
    assert.equal(klasaUrzadzeniaZUa(UA.ipadOs, 1024, 5), 'tablet')
    assert.equal(klasaUrzadzeniaZUa(UA.ipadOs, 1440, 0), 'desktop')
    assert.equal(klasaUrzadzeniaZUa(UA.ipadOs), 'desktop')
  })

  it('komputery', () => {
    assert.equal(klasaUrzadzeniaZUa(UA.windows), 'desktop')
    assert.equal(klasaUrzadzeniaZUa(UA.linuxFirefox), 'desktop')
    assert.equal(klasaUrzadzeniaZUa(UA.chromeOs), 'desktop')
  })

  it('telewizory i konsole to „inne”, mimo że UA zawiera „Linux”', () => {
    assert.equal(klasaUrzadzeniaZUa(UA.telewizor), 'inne')
    assert.equal(klasaUrzadzeniaZUa(UA.konsola), 'inne')
  })

  it('brak UA i klienci niebędący przeglądarkami: „inne”', () => {
    assert.equal(klasaUrzadzeniaZUa(''), 'inne')
    assert.equal(klasaUrzadzeniaZUa(null), 'inne')
    assert.equal(klasaUrzadzeniaZUa(undefined), 'inne')
    assert.equal(klasaUrzadzeniaZUa(UA.curl, 1920), 'inne')
    assert.equal(klasaUrzadzeniaZUa(UA.python, 400), 'inne')
  })

  it('szerokość okna rozstrzyga tylko, gdy UA wygląda na przeglądarkę bez znanego systemu', () => {
    const nieznany = 'Mozilla/5.0 (NieznanySystem) Gecko/1.0 Przegladarka/1.0'
    assert.equal(klasaUrzadzeniaZUa(nieznany), 'inne')
    assert.equal(klasaUrzadzeniaZUa(nieznany, 390), 'mobile')
    assert.equal(klasaUrzadzeniaZUa(nieznany, 820), 'tablet')
    assert.equal(klasaUrzadzeniaZUa(nieznany, 1440), 'desktop')
    // Znany system wygrywa z szerokością: wąskie okno desktopu to wciąż komputer.
    assert.equal(klasaUrzadzeniaZUa(UA.windows, 380), 'desktop')
  })

  it('wynik zawsze jest jedną z czterech klas kontraktu', () => {
    const dozwolone = new Set(['mobile', 'tablet', 'desktop', 'inne'])
    for (const ua of Object.values(UA)) assert.ok(dozwolone.has(klasaUrzadzeniaZUa(ua, 800, 0)))
  })
})
