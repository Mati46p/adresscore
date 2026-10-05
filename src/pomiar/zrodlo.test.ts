// Przycinanie źródła wejścia: nic poza dozwolonym nie wychodzi z przeglądarki.
// Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_HOST, MAX_SCIEZKA_REFERERA, MAX_UTM } from './kontrakt.ts'
import { hostWewnetrzny, zrodloWejscia } from './zrodlo.ts'

const WLASNY = 'adresscore.pl'
const zrodlo = (href: string, referrer = '') => zrodloWejscia(href, referrer, WLASNY)

describe('zrodloWejscia: referer', () => {
  it('wejście bezpośrednie: nic', () => {
    assert.deepEqual(zrodlo('https://adresscore.pl/'), {})
  })

  it('wyszukiwarka: sam host, bez ścieżki i bez zapytania', () => {
    assert.deepEqual(
      zrodlo('https://adresscore.pl/', 'https://www.google.com/search?q=moj+sekretny+adres'),
      {
        rh: 'google.com',
      },
    )
    assert.deepEqual(zrodlo('https://adresscore.pl/', 'https://www.bing.com/search?q=x'), {
      rh: 'bing.com',
    })
  })

  it('host publiczny: ścieżka zostaje, query i fragment znikają', () => {
    const w = zrodlo(
      'https://adresscore.pl/',
      'https://www.reddit.com/r/krakow/comments/abc123/ciekawe_narzedzie/?utm_source=share&token=tajne#komentarz',
    )
    assert.deepEqual(w, { rh: 'reddit.com', rs: '/r/krakow/comments/abc123/ciekawe_narzedzie/' })
    assert.ok(!JSON.stringify(w).includes('tajne'))
    assert.ok(!JSON.stringify(w).includes('komentarz'))
  })

  it('subdomena hosta publicznego też zachowuje ścieżkę', () => {
    const w = zrodlo(
      'https://adresscore.pl/',
      'https://l.facebook.com/l.php?u=https%3A%2F%2Fadresscore.pl',
    )
    assert.deepEqual(w, { rh: 'l.facebook.com', rs: '/l.php' })
  })

  it('host spoza listy: ścieżka NIGDY nie wychodzi (intranet, webmail, czat AI)', () => {
    for (const ref of [
      'https://intranet.firma.pl/tajne/dokument-42?token=abc',
      'https://poczta.onet.pl/wiadomosc/ID_SESJI_123/odczyt',
      'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555',
    ]) {
      const w = zrodlo('https://adresscore.pl/', ref)
      assert.equal(w.rs, undefined, ref)
      assert.ok(w.rh && !w.rh.includes('/'), ref)
    }
  })

  it('podobna nazwa nie jest hostem publicznym (nietiktok.com ≠ tiktok.com)', () => {
    const w = zrodlo('https://adresscore.pl/', 'https://nietiktok.com/@ktos/video/1')
    assert.deepEqual(w, { rh: 'nietiktok.com' })
  })

  it('referer z własnego hosta: zostaje sam host (serwer ocenia go jako wewnętrzny)', () => {
    assert.deepEqual(
      zrodlo('https://adresscore.pl/', 'https://www.adresscore.pl/katalog/ul-dluga?x=1#a'),
      {
        rh: 'adresscore.pl',
      },
    )
    assert.deepEqual(zrodlo('https://adresscore.pl/', 'https://adresscore.pl/adres/ul-dluga-5'), {
      rh: 'adresscore.pl',
    })
  })

  it('własny host z portem (dev) porównywany razem z portem', () => {
    assert.deepEqual(
      zrodloWejscia(
        'http://localhost:5180/',
        'http://localhost:5180/#/porownanie',
        'localhost:5180',
      ),
      { rh: 'localhost:5180' },
    )
  })

  it('aplikacja Google na Androidzie: host to nazwa pakietu', () => {
    const w = zrodlo(
      'https://adresscore.pl/',
      'android-app://com.google.android.googlequicksearchbox/',
    )
    assert.deepEqual(w, { rh: 'com.google.android.googlequicksearchbox' })
  })

  it('referer nie do sparsowania albo z obcym protokołem: pominięty', () => {
    for (const ref of [
      'nie url',
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///c:/x',
      'ftp://x.pl/a',
    ]) {
      assert.deepEqual(zrodlo('https://adresscore.pl/', ref), {}, ref)
    }
  })

  it('host: małe litery, bez www., bez końcowej kropki, limit długości', () => {
    assert.equal(zrodlo('https://adresscore.pl/', 'https://WWW.Przyklad.PL./a').rh, 'przyklad.pl')
    const dlugi = `https://${'a'.repeat(300)}.pl/`
    assert.ok((zrodlo('https://adresscore.pl/', dlugi).rh ?? '').length <= MAX_HOST)
  })

  it('ścieżka referera ma limit długości', () => {
    const w = zrodlo('https://adresscore.pl/', `https://x.com/${'a'.repeat(500)}`)
    assert.equal(w.rs?.length, MAX_SCIEZKA_REFERERA)
  })
})

describe('zrodloWejscia: UTM', () => {
  it('przepisuje tylko utm_source, utm_medium i utm_campaign, małymi literami', () => {
    const w = zrodlo(
      'https://adresscore.pl/?utm_source=Facebook&utm_medium=CPC&utm_campaign=Jesien_2026&utm_content=banerA&utm_term=mieszkanie',
    )
    assert.deepEqual(w, { us: 'facebook', um: 'cpc', uc: 'jesien_2026' })
  })

  it('UTM wewnątrz hasha (router) też działa, a znacznik przed hashem ma pierwszeństwo', () => {
    assert.deepEqual(zrodlo('https://adresscore.pl/#/adres/abc?utm_source=newsletter'), {
      us: 'newsletter',
    })
    assert.deepEqual(zrodlo('https://adresscore.pl/?utm_source=a#/adres/abc?utm_source=b'), {
      us: 'a',
    })
  })

  it('przycina do 60 znaków, zbija spacje, usuwa znaki sterujące', () => {
    const w = zrodlo(
      `https://adresscore.pl/?utm_campaign=${'x'.repeat(100)}&utm_source=%20%20a%09b%0Ac%20`,
    )
    assert.equal(w.uc?.length, MAX_UTM)
    assert.equal(w.us, 'a b c')
  })

  it('pusty znacznik jest pomijany', () => {
    assert.deepEqual(zrodlo('https://adresscore.pl/?utm_source=&utm_medium=%20'), {})
  })

  it('adres e-mail w znaczniku (link z mailingu) nie wychodzi', () => {
    const w = zrodlo('https://adresscore.pl/?utm_source=jan.kowalski%40example.pl&utm_medium=email')
    assert.deepEqual(w, { um: 'email' })
  })
})

describe('zrodloWejscia: identyfikator kliknięcia', () => {
  it('wychodzi tylko NAZWA parametru, nigdy wartość', () => {
    const w = zrodlo('https://adresscore.pl/?gclid=Cj0KCQiA_SEKRET_WARTOSC_123&inny=1')
    assert.deepEqual(w, { ci: 'gclid' })
    assert.ok(!JSON.stringify(w).includes('SEKRET'))
  })

  it('rozpoznaje całą listę: gclid, fbclid, msclkid, ttclid, li_fat_id', () => {
    for (const nazwa of ['gclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id']) {
      assert.equal(zrodlo(`https://adresscore.pl/?${nazwa}=wartosc-${nazwa}`).ci, nazwa)
    }
  })

  it('kilka identyfikatorów: wygrywa pierwszy z listy kontraktu', () => {
    assert.equal(zrodlo('https://adresscore.pl/?ttclid=1&fbclid=2').ci, 'fbclid')
  })

  it('nazwa podobna do identyfikatora nie przechodzi', () => {
    assert.deepEqual(zrodlo('https://adresscore.pl/?xgclid=1&gclid2=2&fbclid_=3'), {})
  })

  it('identyfikator w hashu routera też liczy się jako nazwa', () => {
    assert.equal(zrodlo('https://adresscore.pl/#/szukaj?msclkid=abc').ci, 'msclkid')
  })
})

describe('zrodloWejscia: nic innego nie przechodzi', () => {
  it('żaden inny parametr, token ani wartość nie trafia do wyniku', () => {
    const wartosciTajne = ['tajny@token.pl', 'SESJA-12345-XYZ', '600700800', 'Jan Kowalski']
    const href =
      'https://adresscore.pl/?email=tajny%40token.pl&sid=SESJA-12345-XYZ&tel=600700800&imie=Jan+Kowalski&q=sekret#fragment-z-danymi'
    const w = zrodlo(href, 'https://www.google.com/search?q=SESJA-12345-XYZ')
    const json = JSON.stringify(w)
    for (const tajne of wartosciTajne) assert.ok(!json.includes(tajne), `wyciekło: ${tajne}`)
    assert.ok(!json.includes('fragment-z-danymi'))
    assert.deepEqual(w, { rh: 'google.com' })
  })

  it('wynik zawiera wyłącznie znane klucze', () => {
    const w = zrodlo(
      'https://adresscore.pl/?utm_source=a&utm_medium=b&utm_campaign=c&gclid=1&inny=2',
      'https://x.com/ktos/status/1',
    )
    assert.deepEqual(Object.keys(w).sort(), ['ci', 'rh', 'rs', 'uc', 'um', 'us'])
  })

  it('adres nie do sparsowania: sam referer', () => {
    assert.deepEqual(zrodlo('to nie jest adres', 'https://x.com/a/status/1'), {
      rh: 'x.com',
      rs: '/a/status/1',
    })
  })
})

describe('hostWewnetrzny', () => {
  it('normalizuje tak samo jak host referera', () => {
    assert.equal(hostWewnetrzny('WWW.AdressCore.pl'), 'adresscore.pl')
    assert.equal(hostWewnetrzny('localhost:5180'), 'localhost:5180')
  })
})
