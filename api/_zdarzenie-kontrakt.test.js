// Uruchom: node --test api/
// T017: parytet kontraktu zdarzeń. Źródło prawdy serwera to api/_zdarzenie-kontrakt.js, klient ma
// lustro w src/pomiar/kontrakt.ts (`as const`, bo kompilator potrzebuje typów, a funkcje
// hostingu nie czytają TS – research.md R6). Test importuje OBA pliki (Node 24 zdejmuje typy
// z .ts) i porównuje zbiory, żeby nowa nazwa produktowa dopisana po jednej stronie nie była
// po cichu odrzucana przez drugą.
//
// Część parytetowa pomija się (skip z komunikatem) WYŁĄCZNIE wtedy, gdy src/pomiar/kontrakt.ts
// nie istnieje. Gdy plik jest, ale się nie importuje albo brakuje w nim eksportu, test pada
// głośno – cichy skip przy zepsutym pliku byłby dokładnie tym rozjazdem, którego pilnujemy.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { before, describe, it } from 'node:test'
import { HOSTY_PUBLICZNE } from './_ruch.js'
import * as serwer from './_zdarzenie-kontrakt.js'

const PLIK_KLIENTA = new URL('../src/pomiar/kontrakt.ts', import.meta.url)
// Sprawdzamy PRZED importem: dynamiczny import nieistniejącego pliku to błąd, nie skip.
const KLIENT_ISTNIEJE = existsSync(PLIK_KLIENTA)
const PLIK_ZRODLA = new URL('../src/pomiar/zrodlo.ts', import.meta.url)
const ZRODLO_ISTNIEJE = existsSync(PLIK_ZRODLA)

/** Listy, które muszą być identyczne po obu stronach (kolejność nie ma znaczenia). */
const LISTY = [
  'TYPY',
  'URZADZENIA',
  'NAZWY_PRODUKTOWE',
  'METRYKI_WITAL',
  'KANALY_UDOSTEPNIENIA',
  'CLICK_ID',
  'RODZAJE_KLIKU',
]
/** Limity wymagane od klienta (jako osobne stałe albo klucze `LIMITY`). */
const LIMITY_WYMAGANE = ['MAX_PACZKA', 'LIMIT_CIALA', 'MAX_SEKCJI', 'MAX_CTA', 'MAX_CZAS_MS']

const posortowane = (lista) => [...lista].sort()

describe('kontrakt serwera – spójność wewnętrzna', () => {
  it('listy z kontraktu mają zapisane wartości i są bez powtórzeń', () => {
    const oczekiwane = {
      TYPY: ['odslona', 'wyjscie', 'klik', 'udostepnienie', 'produktowe', 'wital', 'blad'],
      URZADZENIA: ['mobile', 'tablet', 'desktop', 'inne'],
      NAZWY_PRODUKTOWE: [
        'wyszukanie',
        'wyszukanie_bez_wyniku',
        'karta_adresu',
        'porownanie_dodaj',
        'warstwa_mapy',
        'tryb_biznes',
        'tryb_miasto',
        'udostepnij',
        'pomiar_wylaczony',
      ],
      METRYKI_WITAL: ['lcp', 'inp', 'cls', 'fcp', 'ttfb'],
      KANALY_UDOSTEPNIENIA: ['link', 'kopia', 'natywne', 'anulowano', 'blad'],
      CLICK_ID: ['gclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id'],
      RODZAJE_KLIKU: ['przycisk', 'link-wewn', 'link-zewn', 'zakladka', 'martwy', 'furia'],
      RODZAJE_WYSZUKANIA: ['adres', 'ulica', 'okolica'],
      KANALY: [
        'bezposrednie',
        'wyszukiwarka',
        'social',
        'ai',
        'kampania',
        'odeslanie',
        'wewnetrzne',
      ],
      KLASY_BOTOW: ['ai', 'wyszukiwarka', 'podglad', 'narzedzie', 'monitoring', 'inny'],
    }
    for (const [nazwa, wartosci] of Object.entries(oczekiwane)) {
      assert.deepEqual(posortowane(serwer[nazwa]), posortowane(wartosci), nazwa)
      assert.equal(new Set(serwer[nazwa]).size, serwer[nazwa].length, `${nazwa}: powtórzenia`)
    }
  })

  it('limity z kontraktu: 10 zdarzeń, 16 384 bajtów, 24 sekcje, 12 CTA, 30 minut', () => {
    assert.equal(serwer.MAX_PACZKA, 10)
    assert.equal(serwer.LIMIT_CIALA, 16_384)
    assert.equal(serwer.MAX_SEKCJI, 24)
    assert.equal(serwer.MAX_CTA, 12)
    assert.equal(serwer.MAX_CZAS_MS, 1_800_000)
    assert.equal(serwer.MAX_WLASCIWOSCI, 12)
    assert.equal(serwer.MAX_ETYKIETA, 120)
    assert.equal(serwer.MAX_KOMUNIKAT, 200)
    assert.equal(serwer.MAX_SCIEZKA, 512)
  })

  it('LIMITY zbiera te same wartości co osobne stałe', () => {
    for (const [nazwa, wartosc] of Object.entries(serwer.LIMITY)) {
      assert.equal(serwer[nazwa], wartosc, nazwa)
    }
    for (const nazwa of LIMITY_WYMAGANE) assert.ok(nazwa in serwer.LIMITY, nazwa)
  })

  it('WLASCIWOSCI_PRODUKTOWE ma wpis dla każdej nazwy produktowej i tylko dla nich', () => {
    assert.deepEqual(
      posortowane(Object.keys(serwer.WLASCIWOSCI_PRODUKTOWE)),
      posortowane(serwer.NAZWY_PRODUKTOWE),
    )
    for (const klucze of Object.values(serwer.WLASCIWOSCI_PRODUKTOWE)) {
      assert.ok(klucze.length <= serwer.MAX_WLASCIWOSCI)
    }
  })

  it('kolumny wiersza to dokładnie 26 kolumn tabeli `zdarzenia` bez id i czasu', () => {
    assert.equal(serwer.KOLUMNY_WIERSZA.length, 26)
    assert.equal(new Set(serwer.KOLUMNY_WIERSZA).size, 26)
    assert.equal(serwer.KOLUMNY_WIERSZA.includes('id'), false)
    assert.equal(serwer.KOLUMNY_WIERSZA.includes('czas'), false)
  })

  it('stałe są zamrożone: nikt nie dopisze elementu w trakcie działania', () => {
    for (const nazwa of [...LISTY, 'KANALY', 'KLASY_BOTOW', 'KOLUMNY_WIERSZA']) {
      assert.ok(Object.isFrozen(serwer[nazwa]), nazwa)
    }
    assert.ok(Object.isFrozen(serwer.WLASCIWOSCI_PRODUKTOWE))
    assert.ok(Object.isFrozen(serwer.LIMITY))
  })

  it('wzorce nie mają flagi `g` (wspólny lastIndex psułby wyniki)', () => {
    for (const nazwa of ['WZORZEC_EKRANU', 'WZORZEC_SEKCJI', 'WZORZEC_WARSTWY']) {
      assert.equal(serwer[nazwa].global, false, nazwa)
      assert.equal(serwer[nazwa].sticky, false, nazwa)
    }
  })
})

describe('parytet z src/pomiar/kontrakt.ts', {
  skip: KLIENT_ISTNIEJE
    ? false
    : 'brak src/pomiar/kontrakt.ts – parytet włącza się sam, gdy faza pomiaru w kliencie go doda',
}, () => {
  let klient

  before(async () => {
    klient = await import(PLIK_KLIENTA.href)
  })

  /** Limit z osobnej stałej albo z obiektu `LIMITY` klienta (kontrakt dopuszcza obie postaci). */
  const limitKlienta = (nazwa) => klient[nazwa] ?? klient.LIMITY?.[nazwa]

  for (const nazwa of LISTY) {
    it(`${nazwa}: te same wartości po obu stronach`, () => {
      assert.ok(Array.isArray(klient[nazwa]), `klient nie eksportuje listy ${nazwa}`)
      assert.equal(
        new Set(klient[nazwa]).size,
        klient[nazwa].length,
        'powtórzenia po stronie klienta',
      )
      assert.deepEqual(posortowane(klient[nazwa]), posortowane(serwer[nazwa]))
    })
  }

  it('WLASCIWOSCI_PRODUKTOWE: te same nazwy i te same dozwolone klucze', () => {
    assert.ok(klient.WLASCIWOSCI_PRODUKTOWE, 'klient nie eksportuje WLASCIWOSCI_PRODUKTOWE')
    // Klient może zapisać klucze jako tablicę albo jako obiekt klucz → typ; porównujemy klucze.
    const klucze = (wartosc) => posortowane(Array.isArray(wartosc) ? wartosc : Object.keys(wartosc))
    const normalizuj = (mapa) =>
      Object.fromEntries(
        Object.entries(mapa)
          .map(([nazwa, wartosc]) => [nazwa, klucze(wartosc)])
          .sort(([a], [b]) => a.localeCompare(b)),
      )
    assert.deepEqual(
      normalizuj(klient.WLASCIWOSCI_PRODUKTOWE),
      normalizuj(serwer.WLASCIWOSCI_PRODUKTOWE),
    )
  })

  for (const nazwa of LIMITY_WYMAGANE) {
    it(`limit ${nazwa}: ta sama wartość po obu stronach`, () => {
      const wartosc = limitKlienta(nazwa)
      assert.notEqual(
        wartosc,
        undefined,
        `klient nie eksportuje ${nazwa} (ani osobno, ani w LIMITY)`,
      )
      assert.equal(wartosc, serwer[nazwa])
    })
  }

  it('pozostałe limity i długości pól, które klient eksportuje, zgadzają się z serwerem', () => {
    const rozjazdy = []
    let porownane = 0
    for (const [nazwa, wartosc] of Object.entries(serwer.LIMITY)) {
      if (LIMITY_WYMAGANE.includes(nazwa)) continue
      const wKlienta = limitKlienta(nazwa)
      if (wKlienta === undefined) continue
      porownane += 1
      if (wKlienta !== wartosc) rozjazdy.push(`${nazwa}: serwer ${wartosc}, klient ${wKlienta}`)
    }
    assert.deepEqual(rozjazdy, [])
    // Test zerowy nic nie dowodzi: jeśli klient wyeksportował limity, to coś porównaliśmy.
    if (klient.LIMITY) assert.ok(porownane > 0, 'klient ma LIMITY, ale nic nie zostało porównane')
  })

  it('opcjonalne wspólne stałe (rodzaje wyszukania, separator, wzorce), jeśli klient je ma', () => {
    if (klient.RODZAJE_WYSZUKANIA) {
      assert.deepEqual(
        posortowane(klient.RODZAJE_WYSZUKANIA),
        posortowane(serwer.RODZAJE_WYSZUKANIA),
      )
    }
    if (klient.SEPARATOR !== undefined) assert.equal(klient.SEPARATOR, serwer.SEPARATOR)
    for (const nazwa of ['WZORZEC_EKRANU', 'WZORZEC_SEKCJI', 'WZORZEC_WARSTWY']) {
      if (!klient[nazwa]) continue
      assert.equal(klient[nazwa].source, serwer[nazwa].source, `${nazwa}: źródło wzorca`)
      assert.equal(klient[nazwa].flags, serwer[nazwa].flags, `${nazwa}: flagi wzorca`)
    }
  })

  it('test porównuje coś realnego: klient eksportuje wszystkie wymagane nazwy', () => {
    const brakuje = [...LISTY, 'WLASCIWOSCI_PRODUKTOWE'].filter(
      (nazwa) => klient[nazwa] === undefined,
    )
    assert.deepEqual(brakuje, [])
    const bezLimitu = LIMITY_WYMAGANE.filter((nazwa) => limitKlienta(nazwa) === undefined)
    assert.deepEqual(bezLimitu, [])
  })
})

// Druga lista, która żyje w dwóch kopiach: hosty, dla których zachowujemy ścieżkę referera.
// Klient przycina ją u siebie (src/pomiar/zrodlo.ts), serwer po raz drugi (api/_ruch.js).
// Rozjazd znaczy albo „klient wysyła ścieżkę, którą serwer wyrzuca”, albo odwrotnie – a gorzej:
// serwer przepuszcza ścieżkę hosta, którego klient już uznał za prywatny. Klient nie eksportuje
// tej listy, więc czytamy literał z kodu; zmiana zapisu listy ma zatrzymać ten test głośno.
describe('parytet listy hostów publicznych z src/pomiar/zrodlo.ts', {
  skip: ZRODLO_ISTNIEJE ? false : 'brak src/pomiar/zrodlo.ts – parytet włączy się razem z plikiem',
}, () => {
  it('klient i serwer zachowują ścieżkę referera dla tych samych hostów', () => {
    const tekst = readFileSync(PLIK_ZRODLA, 'utf8')
    const dopasowanie = /HOSTY_PUBLICZNE\s*=\s*\[([\s\S]*?)\]/.exec(tekst)
    assert.ok(
      dopasowanie,
      'w src/pomiar/zrodlo.ts nie ma literału HOSTY_PUBLICZNE = [...] – dopasuj ten test do nowego zapisu listy',
    )
    const hosty = [...(dopasowanie[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '')
    assert.ok(hosty.length > 0, 'lista hostów publicznych w kliencie jest pusta')
    assert.deepEqual(posortowane(hosty), posortowane(HOSTY_PUBLICZNE))
  })
})

// Filtr danych osobowych i normalizacja frazy żyją w dwóch kopiach: w kliencie (fraza.ts)
// i na serwerze (_zdarzenie.js, bo endpoint jest publiczny i nie ufa klientowi). Serwer ma dać
// TO SAMO, co klient, na surowym wejściu (inaczej ta sama fraza trafiałaby do listy braków
// pod dwiema postaciami) i nigdy łagodniej: co klient uznaje za dane osobowe, serwer też.
const PLIK_FRAZY = new URL('../src/pomiar/fraza.ts', import.meta.url)
const MALPA_PELNOSZEROKA = String.fromCharCode(0xff20)
const FRAZY = [
  'Marszałkowska 100',
  '  ul.   Słoneczna \t  5  ',
  'ŁÓDŹ piotrkowska 12/14',
  'Zażółć gęślą jaźń',
  'Zażółć gęślą jaźń'.normalize('NFD'),
  'ul. słoneczna 5\nm. 3',
  'a'.repeat(200),
  'ul. dluga '.repeat(15),
  'ul. długa 123/45, 31-001',
  'plac 1000-lecia 3',
  '00-001 warszawa',
  '12345678',
  'Straße',
  'İSTANBUL',
  'ＡＢＣ pełnoszerokie',
  '',
  '   ',
  'jan.kowalski@example.com',
  '@jan',
  `jan${MALPA_PELNOSZEROKA}example.com`,
  '123456789',
  '600123456',
  '600 123 456',
  '600-123-456',
  '600.123.456',
  '600 - 123 - 456',
  '+48 (12) 345 67 89',
  '12 345 67 89',
  '123-456-78-90',
  '44051401359',
]

describe('parytet filtra frazy z src/pomiar/fraza.ts', {
  skip: existsSync(PLIK_FRAZY) ? false : 'brak src/pomiar/fraza.ts',
}, () => {
  let fraza
  let zwalidujZdarzenie

  before(async () => {
    fraza = await import(PLIK_FRAZY.href)
    ;({ zwalidujZdarzenie } = await import('./_zdarzenie.js'))
  })

  const zSerwera = (surowa) =>
    zwalidujZdarzenie({
      t: 'produktowe',
      e: 'szukaj',
      s: '/',
      u: 'desktop',
      n: 'wyszukanie_bez_wyniku',
      w: { fraza: surowa },
    }).wlasciwosci

  it('znacznik odrzuconej frazy jest ten sam po obu stronach', () => {
    assert.equal(fraza.ZNACZNIK_ODRZUCONO, serwer.ZNACZNIK_ODRZUCONO)
    assert.ok(serwer.ZNACZNIK_ODRZUCONO.length <= serwer.MAX_FRAZA)
  })

  for (const surowa of FRAZY) {
    it(`ta sama fraza po obu stronach: ${JSON.stringify(surowa).slice(0, 50)}`, () => {
      const klient = fraza.normalizujFraze(surowa)
      const oczekiwana = klient.odrzucono
        ? { fraza: serwer.ZNACZNIK_ODRZUCONO, odrzucono: true }
        : { fraza: klient.fraza }
      assert.deepEqual(zSerwera(surowa), oczekiwana)
    })
  }

  it('serwer odrzuca wszystko, co odrzuca klient (może więcej, nigdy mniej)', async () => {
    const { zawieraDaneOsobowe } = await import('./_zdarzenie.js')
    for (const surowa of FRAZY) {
      if (fraza.zawieraDaneOsobowe(surowa)) assert.equal(zawieraDaneOsobowe(surowa), true, surowa)
    }
  })

  it('wyszukane frazy zwykłych adresów nie są odrzucane po żadnej ze stron', () => {
    for (const surowa of ['Marszałkowska 100', 'ul. długa 123/45, 31-001', 'plac 1000-lecia 3']) {
      assert.equal(fraza.normalizujFraze(surowa).odrzucono, undefined, surowa)
      assert.equal(zSerwera(surowa).odrzucono, undefined, surowa)
    }
  })
})
