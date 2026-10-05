// Ekran `panel` (#/panel) i bezpiecznik logowania Google (specs/001-panel-analityka, R9).
//
// Logowanie idzie przez PKCE: dostawca odsyła na `/?panel#/panel`, a serwer autoryzacji dopisuje do
// query `code`. Router na hashu musi wtedy zostać na ekranie panelu (nawet gdy dostawca obetnie
// fragment), a synchronizacja stanu z paskiem adresu nie może skasować `?code=…` zanim klient
// Supabase wymieni kod na sesję.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { czytajHash, maZnacznikPanelu, zapiszHash } from './url.ts'

describe('ekran panel w hashu', () => {
  it('#/panel otwiera panel i nie niesie adresu karty', () => {
    const s = czytajHash('#/panel')
    assert.equal(s.ekran, 'panel')
    assert.equal(s.idAdresu, null)
  })

  it('zapis ekranu panel to gołe #/panel i przeżywa parsuj → serializuj → parsuj', () => {
    const s = czytajHash('#/panel')
    assert.equal(zapiszHash(s), '#/panel')
    assert.deepEqual(czytajHash(zapiszHash(s)), s)
  })

  it('panel nie ma parametrów w linku: persona, tryb i filtry zwiedzającego nie trafiają do hasha', () => {
    const zeStanuZwiedzajacego = czytajHash('#/porownanie?p=senior&t=wynajmuje&cmp=a,b')
    assert.equal(zeStanuZwiedzajacego.ekran, 'porownanie')
    assert.equal(zapiszHash({ ...zeStanuZwiedzajacego, ekran: 'panel' }), '#/panel')
  })

  it('wywołanie z jednym argumentem zachowuje się jak dotąd (zapisy preferencji czytają sam hash)', () => {
    assert.equal(czytajHash('#/').ekran, 'szukaj')
    assert.equal(czytajHash('#/metoda').ekran, 'metoda')
    assert.equal(czytajHash('#/adres/abc').ekran, 'okolica')
    assert.equal(czytajHash('#/adres/abc').idAdresu, 'abc')
    assert.equal(czytajHash('').ekran, 'szukaj')
  })

  it('inne ekrany nie przechodzą w panel przez przypadkowe podobieństwo ścieżki', () => {
    for (const hash of ['#/panele', '#/metoda/panel', '#/okolica/panel', '#/?panel=1']) {
      assert.notEqual(czytajHash(hash).ekran, 'panel', hash)
    }
  })
})

describe('bezpiecznik ?panel w query (powrót z logowania OAuth)', () => {
  it('obecność parametru panel otwiera panel niezależnie od hasha', () => {
    assert.equal(czytajHash('', '?panel').ekran, 'panel')
    assert.equal(czytajHash('#/panel', '?panel').ekran, 'panel')
    assert.equal(czytajHash('#/porownanie', '?panel').ekran, 'panel')
  })

  it('serwer autoryzacji przepisuje query: ?code=…&panel= (pusta wartość) też liczy się jako znacznik', () => {
    assert.equal(czytajHash('', '?code=abc123&panel=').ekran, 'panel')
    assert.equal(czytajHash('#/panel', '?panel=&code=abc123').ekran, 'panel')
  })

  it('dostawca obciął fragment: po powrocie zostaje tylko /?code=…&panel=', () => {
    const s = czytajHash('', '?code=xyz&panel=')
    assert.equal(s.ekran, 'panel')
    assert.equal(zapiszHash(s), '#/panel')
  })

  it('znacznik w query wygrywa z kartą adresu z hasha i zeruje jej id', () => {
    const s = czytajHash('#/adres/abc', '?panel')
    assert.equal(s.ekran, 'panel')
    assert.equal(s.idAdresu, null)
  })

  it('sam parametr o podobnej nazwie albo wartość „panel” nie otwiera panelu', () => {
    for (const search of ['', '?', '?panele=1', '?xpanel', '?q=panel', '?code=abc', '?pokaz=1']) {
      assert.equal(maZnacznikPanelu(search), false, search)
      assert.notEqual(czytajHash('#/', search).ekran, 'panel', search)
    }
  })

  it('maZnacznikPanelu rozpoznaje parametr z początkowym znakiem zapytania i bez niego', () => {
    assert.equal(maZnacznikPanelu('?panel'), true)
    assert.equal(maZnacznikPanelu('panel'), true)
    assert.equal(maZnacznikPanelu('?a=1&panel=&b=2'), true)
  })
})

describe('stan aplikacji nie dotyka adresu panelu', () => {
  it('na ekranie panel zapis stanu nie woła history, a po wyjściu z panelu znów działa', async () => {
    // Stan to moduł z `window`/`location`/`history` czytanymi przy imporcie, więc atrapy muszą
    // istnieć PRZED importem (dlatego dynamiczny import, a nie statyczny na górze pliku).
    const wywolania: string[] = []
    const globalne = globalThis as Record<string, unknown>
    globalne.window = { addEventListener() {} }
    globalne.location = { hash: '', search: '?code=abc&panel=', pathname: '/' }
    globalne.history = {
      replaceState: (_s: unknown, _t: string, adres: string) => wywolania.push(`replace ${adres}`),
      pushState: (_s: unknown, _t: string, adres: string) => wywolania.push(`push ${adres}`),
    }

    const stan = await import('./stan.ts')
    // Start z linku `/?code=abc&panel=` bez fragmentu: ekran wyznacza sam bezpiecznik.
    assert.equal(stan.pobierzStan().ekran, 'panel')

    // Po wczytaniu słownika adresów `zapiszDoUrl` jest „uzbrojony” (bez słownika wychodzi wcześniej).
    stan.podlaczDane(['id-a', 'id-b'], [{ id: 'halas_ldwn', kategoria: 'spokoj' }], [])
    stan.ustawWarstwe('halas_ldwn')
    stan.wybierzAdres(1)
    assert.equal(stan.pobierzStan().ekran, 'panel')
    assert.deepEqual(wywolania, [], 'adres panelu (z ?code=…) nie może być nadpisany przez stan')

    // Kontrola atrapy: przejście na zwykły ekran zapisuje adres, więc brak wywołań wyżej nie jest
    // artefaktem testu.
    stan.przejdz('metoda')
    assert.equal(wywolania.length, 1)
    assert.match(wywolania[0] ?? '', /^push \/#\/metoda/)
  })

  it('zmiana hasha na #/panel w trakcie pracy przełącza ekran stanu', async () => {
    const stan = await import('./stan.ts')
    stan.zastosujZmianeUrl(czytajHash('#/porownanie'))
    assert.equal(stan.pobierzStan().ekran, 'porownanie')
    stan.zastosujZmianeUrl(czytajHash('#/panel'))
    assert.equal(stan.pobierzStan().ekran, 'panel')
  })
})
