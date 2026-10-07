// Teksty i decyzje zależne od bieżącego miasta (#223, F6). Uruchom: node --test src/karta/miastoTeksty.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { MIASTA, MIASTO_DOMYSLNE, miasto, type SlugMiasta } from '../kontrakty/miasta.ts'
import { czytajHash, type Ekran } from '../wynik/url.ts'
import {
  biernikMiasta,
  decyzjaKamery,
  linkWskazujeMiejsce,
  naglowekSzukaj,
  ogloszenieZmianyMiasta,
  ostrzezenieOPrzelaczeniu,
  sciezkaKanoniczna,
  tytulEkranu,
  ZOOM_ZMIANY_MIASTA,
} from './miastoTeksty.ts'

const EKRANY: readonly Ekran[] = [
  'szukaj',
  'okolica',
  'porownanie',
  'metoda',
  'katalog',
  'biznes',
  'miasto',
]
const krakow = miasto('krakow')
const innych = MIASTA.filter((m) => m.slug !== MIASTO_DOMYSLNE)

describe('nagłówek Szukaj', () => {
  it('Kraków: dotychczasowe brzmienie', () => {
    assert.equal(naglowekSzukaj(krakow), 'Znajdź okolicę w Krakowie')
  })

  it('każde miasto mówi o sobie we własnej formie, bez śladu Krakowa (poza Krakowem)', () => {
    assert.equal(naglowekSzukaj(miasto('wroclaw')), 'Znajdź okolicę we Wrocławiu')
    assert.equal(naglowekSzukaj(miasto('bialystok')), 'Znajdź okolicę w Białymstoku')
    for (const m of innych) {
      assert.equal(naglowekSzukaj(m), `Znajdź okolicę ${m.wMiescie}`)
      assert.ok(!/Krak/.test(naglowekSzukaj(m)), m.slug)
    }
  })
})

describe('biernik nazwy miasta', () => {
  // Jawna tabela oczekiwań: dodanie miasta do rejestru bez wpisu tutaj ma dać czerwony test.
  const OCZEKIWANE: Record<SlugMiasta, string> = {
    krakow: 'Kraków',
    warszawa: 'Warszawę',
    wroclaw: 'Wrocław',
    lodz: 'Łódź',
    poznan: 'Poznań',
    gdansk: 'Gdańsk',
    szczecin: 'Szczecin',
    lublin: 'Lublin',
    bydgoszcz: 'Bydgoszcz',
    bialystok: 'Białystok',
  }

  it('każde miasto z rejestru ma oczekiwany biernik', () => {
    for (const m of MIASTA) {
      assert.ok(OCZEKIWANE[m.slug] !== undefined, `brak oczekiwanego biernika dla ${m.slug}`)
      assert.equal(biernikMiasta(m.nazwa), OCZEKIWANE[m.slug], m.slug)
    }
  })

  it('tabela oczekiwań nie ma miast spoza rejestru', () => {
    assert.deepEqual(Object.keys(OCZEKIWANE).sort(), MIASTA.map((m) => m.slug).sort())
  })
})

describe('tytuł karty przeglądarki', () => {
  it('Kraków, ekran Szukaj: ten sam tytuł co w index.html (SEO)', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    const tytul = /<title>([^<]*)<\/title>/.exec(html)?.[1]
    assert.equal(`${tytulEkranu('szukaj', krakow, '')} – adresscore`, tytul)
  })

  it('Kraków: dotychczasowe tytuły pozostałych ekranów', () => {
    assert.equal(tytulEkranu('katalog', krakow, ''), 'Katalog adresów Krakowa')
    assert.equal(
      tytulEkranu('okolica', krakow, 'ul. Długa 1, Kraków'),
      'ul. Długa 1, Kraków: okolica w liczbach',
    )
    assert.equal(tytulEkranu('porownanie', krakow, ''), 'Porównanie')
    assert.equal(
      tytulEkranu('metoda', krakow, ''),
      'Metoda i źródła danych – jak liczymy wynik adresu',
    )
    assert.equal(tytulEkranu('biznes', krakow, ''), 'Miejsce na biznes')
    assert.equal(
      tytulEkranu('miasto', krakow, ''),
      'Dla miasta: luki w usługach i symulator inwestycji',
    )
  })

  it('inne miasto: Szukaj i katalog niosą jego nazwę, żaden tytuł nie mówi o Krakowie', () => {
    for (const m of innych) {
      assert.equal(
        tytulEkranu('szukaj', m, ''),
        `Jakość życia pod każdym adresem ${m.wMiescie}`,
        m.slug,
      )
      assert.equal(tytulEkranu('katalog', m, ''), `Katalog adresów: ${m.nazwa}`, m.slug)
      for (const ekran of EKRANY) {
        assert.ok(!/Krak/.test(tytulEkranu(ekran, m, m.nazwa)), `${m.slug}/${ekran}`)
      }
    }
  })
})

describe('adres kanoniczny', () => {
  const baza = { sciezkaAdresu: '/adres/ul-dluga-1-krakow-0123456789abcdef', pathname: '/' }

  it('Kraków: karta adresu, katalog i ulica mają własne ścieżki SEO', () => {
    assert.equal(
      sciezkaKanoniczna({ ...baza, ekran: 'okolica', miasto: 'krakow' }),
      baza.sciezkaAdresu,
    )
    assert.equal(sciezkaKanoniczna({ ...baza, ekran: 'katalog', miasto: 'krakow' }), '/katalog')
    assert.equal(
      sciezkaKanoniczna({
        ...baza,
        ekran: 'katalog',
        miasto: 'krakow',
        pathname: '/katalog/dluga-1',
      }),
      '/katalog/dluga-1',
    )
    assert.equal(sciezkaKanoniczna({ ...baza, ekran: 'szukaj', miasto: 'krakow' }), '/')
    assert.equal(sciezkaKanoniczna({ ...baza, ekran: 'metoda', miasto: 'krakow' }), '/metoda')
  })

  it('inne miasto: adres z nieistniejącej strony SEO nie trafia do canonical (FR-015)', () => {
    for (const m of innych) {
      // Wołający podaje `sciezkaAdresu` tylko dla Krakowa; test sprawdza, że nawet podana nie wygra.
      assert.equal(sciezkaKanoniczna({ ...baza, ekran: 'okolica', miasto: m.slug }), '/', m.slug)
      assert.equal(sciezkaKanoniczna({ ...baza, ekran: 'katalog', miasto: m.slug }), '/', m.slug)
      assert.equal(
        sciezkaKanoniczna({ ...baza, ekran: 'katalog', miasto: m.slug, pathname: '/katalog/x' }),
        '/',
        m.slug,
      )
      assert.equal(sciezkaKanoniczna({ ...baza, ekran: 'szukaj', miasto: m.slug }), '/', m.slug)
    }
  })

  it('metoda jest wspólna dla wszystkich miast', () => {
    for (const m of MIASTA) {
      assert.equal(
        sciezkaKanoniczna({ ...baza, ekran: 'metoda', miasto: m.slug }),
        '/metoda',
        m.slug,
      )
    }
  })
})

describe('link wskazujący miejsce (kadr startowy, FR-012)', () => {
  const wskazuje = (hash: string, pathname = '/') => linkWskazujeMiejsce(czytajHash(hash), pathname)

  it('bez linku, z samym profilem albo ekranem bez miejsca: widok wszystkich miast', () => {
    for (const hash of [
      '',
      '#/',
      '#/?p=senior',
      '#/porownanie',
      '#/katalog',
      '#/metoda',
      '#/miasto',
    ]) {
      assert.equal(wskazuje(hash), false, hash)
    }
  })

  it('miasto w linku albo adres: start przy tym miejscu', () => {
    assert.equal(wskazuje('#/?mst=gdansk'), true)
    assert.equal(wskazuje('#/adres/abc'), true)
    assert.equal(wskazuje('#/adres/abc?mst=lodz'), true)
    assert.equal(wskazuje('#/', '/adres/ul-dluga-1-krakow-0123456789abcdef'), true)
  })

  it('nieznane miasto to też link z miejscem (otwieramy Kraków, nie widok kraju)', () => {
    assert.equal(wskazuje('#/?mst=atlantyda'), true)
  })

  it('jawne mst=krakow znaczy to samo co brak parametru', () => {
    assert.equal(wskazuje('#/?mst=krakow'), false)
  })
})

describe('kamera nad innym miastem (D5, FR-006c)', () => {
  const baza = {
    zoom: ZOOM_ZMIANY_MIASTA,
    podSrodkiem: 'gdansk',
    biezace: 'krakow',
    maWybor: false,
  } as const

  it('przybliżenie uliczne i nic do stracenia: miasto zmienia się samo', () => {
    assert.deepEqual(decyzjaKamery(baza), { akcja: 'przelacz', miasto: 'gdansk' })
    assert.deepEqual(decyzjaKamery({ ...baza, zoom: 15 }), { akcja: 'przelacz', miasto: 'gdansk' })
  })

  it('wybrany adres albo porównanie: tylko propozycja, miasto się nie zmienia', () => {
    assert.deepEqual(decyzjaKamery({ ...baza, maWybor: true }), {
      akcja: 'zaproponuj',
      miasto: 'gdansk',
    })
  })

  it('widok kraju (zoom poniżej progu) niczego nie zmienia', () => {
    assert.deepEqual(decyzjaKamery({ ...baza, zoom: ZOOM_ZMIANY_MIASTA - 0.01 }), { akcja: 'nic' })
    assert.deepEqual(decyzjaKamery({ ...baza, zoom: 6 }), { akcja: 'nic' })
    assert.deepEqual(decyzjaKamery({ ...baza, zoom: Number.NaN }), { akcja: 'nic' })
  })

  it('kamera nad bieżącym miastem albo poza miastami: nic', () => {
    assert.deepEqual(decyzjaKamery({ ...baza, podSrodkiem: 'krakow' }), { akcja: 'nic' })
    assert.deepEqual(decyzjaKamery({ ...baza, podSrodkiem: null }), { akcja: 'nic' })
    assert.deepEqual(decyzjaKamery({ ...baza, podSrodkiem: null, maWybor: true }), { akcja: 'nic' })
  })
})

describe('ogłoszenia o zmianie miasta (FR-007)', () => {
  it('mówią, co zostało wyczyszczone, a gdy nic – tylko o mieście', () => {
    assert.equal(
      ogloszenieZmianyMiasta('Łódź', { adres: false, porownanie: false }),
      'Bieżące miasto: Łódź.',
    )
    assert.equal(
      ogloszenieZmianyMiasta('Łódź', { adres: true, porownanie: false }),
      'Bieżące miasto: Łódź. Wyczyszczono wybrany adres.',
    )
    assert.equal(
      ogloszenieZmianyMiasta('Łódź', { adres: false, porownanie: true }),
      'Bieżące miasto: Łódź. Wyczyszczono porównanie.',
    )
    assert.equal(
      ogloszenieZmianyMiasta('Łódź', { adres: true, porownanie: true }),
      'Bieżące miasto: Łódź. Wyczyszczono wybrany adres i porównanie.',
    )
  })

  it('ostrzeżenie przed przełączeniem wymienia to samo', () => {
    assert.equal(
      ostrzezenieOPrzelaczeniu({ adres: false, porownanie: true }),
      'Przełączenie wyczyści porównanie.',
    )
    assert.equal(
      ostrzezenieOPrzelaczeniu({ adres: true, porownanie: true }),
      'Przełączenie wyczyści wybrany adres i porównanie.',
    )
  })

  it('żaden tekst nie zawiera pauzy (em-dash)', () => {
    const teksty = [
      ogloszenieZmianyMiasta('Łódź', { adres: true, porownanie: true }),
      ostrzezenieOPrzelaczeniu({ adres: true, porownanie: true }),
      ...MIASTA.map((m) => tytulEkranu('szukaj', m, '')),
      ...MIASTA.map((m) => naglowekSzukaj(m)),
    ]
    const pauza = String.fromCharCode(0x2014)
    for (const t of teksty) assert.ok(!t.includes(pauza), t)
  })
})
