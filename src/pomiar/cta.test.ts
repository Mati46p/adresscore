// Furia, nazwy celów i rejestr CTA (czysta część cta.ts). Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CEL_BRAK,
  czyFuria,
  FURIA_OKNO_MS,
  FURIA_POCZATEK,
  FURIA_PROMIEN_PX,
  kluczCta,
  nazwaCelu,
  type StanFurii,
  utworzRejestrCta,
  wzorzecLinku,
} from './cta.ts'
import { MAX_CEL, MAX_CTA, MAX_LICZNIK_CTA } from './kontrakt.ts'

/** Odtwarza serię kliknięć i zwraca, które z nich zgłosiły furię. */
function seria(kliki: { x: number; y: number; t: number }[]): boolean[] {
  let stan: StanFurii = FURIA_POCZATEK
  return kliki.map((k) => {
    const wynik = czyFuria(stan, k)
    stan = wynik.stan
    return wynik.furia
  })
}

describe('czyFuria', () => {
  it('trzy szybkie kliknięcia w jednym miejscu: furia na trzecim', () => {
    assert.deepEqual(
      seria([
        { x: 100, y: 100, t: 0 },
        { x: 102, y: 101, t: 200 },
        { x: 99, y: 100, t: 400 },
      ]),
      [false, false, true],
    )
  })

  it('dwa kliknięcia to jeszcze nie furia', () => {
    assert.deepEqual(
      seria([
        { x: 10, y: 10, t: 0 },
        { x: 10, y: 10, t: 100 },
      ]),
      [false, false],
    )
  })

  it('kliknięcia za daleko od siebie (> 30 px) nie składają się w furię', () => {
    assert.deepEqual(
      seria([
        { x: 0, y: 0, t: 0 },
        { x: 100, y: 0, t: 100 },
        { x: 200, y: 0, t: 200 },
      ]),
      [false, false, false],
    )
  })

  it('granica promienia: dokładnie 30 px liczy się, 31 px nie', () => {
    assert.equal(FURIA_PROMIEN_PX, 30)
    // Odległość liczona od NAJNOWSZEGO kliknięcia do każdego z poprzednich.
    assert.deepEqual(
      seria([
        { x: 0, y: 0, t: 0 },
        { x: 15, y: 0, t: 100 },
        { x: 30, y: 0, t: 200 },
      ]).at(-1),
      true,
    )
    assert.deepEqual(
      seria([
        { x: 0, y: 0, t: 0 },
        { x: 15, y: 0, t: 100 },
        { x: 31, y: 0, t: 200 },
      ]).at(-1),
      false,
    )
    // Promień, nie kwadrat: przekątna 22 + 22 px to ~31 px.
    assert.deepEqual(
      seria([
        { x: 0, y: 0, t: 0 },
        { x: 11, y: 11, t: 100 },
        { x: 22, y: 22, t: 200 },
      ]).at(-1),
      false,
    )
  })

  it('kliknięcia rozciągnięte ponad 800 ms nie składają się w furię', () => {
    assert.equal(FURIA_OKNO_MS, 800)
    assert.deepEqual(
      seria([
        { x: 5, y: 5, t: 0 },
        { x: 5, y: 5, t: 500 },
        { x: 5, y: 5, t: 1000 },
      ]),
      [false, false, false],
      'trzy kliknięcia w 1000 ms',
    )
  })

  it('granica czasu: trzy kliknięcia w dokładnie 800 ms to furia', () => {
    assert.deepEqual(
      seria([
        { x: 5, y: 5, t: 0 },
        { x: 5, y: 5, t: 400 },
        { x: 5, y: 5, t: 800 },
      ]).at(-1),
      true,
    )
  })

  it('okno przesuwa się: kliknięcia 0, 500, 900, 1300 – furia na czwartym (500–1300 mieszczą się w 800)', () => {
    assert.deepEqual(
      seria([
        { x: 1, y: 1, t: 0 },
        { x: 1, y: 1, t: 500 },
        { x: 1, y: 1, t: 900 },
        { x: 1, y: 1, t: 1300 },
      ]),
      [false, false, false, true],
    )
  })

  it('seria jest zgłaszana dokładnie raz, nawet przy siedmiu kliknięciach', () => {
    const kliki = Array.from({ length: 7 }, (_, i) => ({ x: 50, y: 50, t: i * 100 }))
    const wynik = seria(kliki)
    assert.equal(wynik.filter(Boolean).length, 1)
    assert.equal(wynik[2], true)
  })

  it('po przerwie dłuższej niż okno zaczyna się nowa seria, którą też można zgłosić', () => {
    const wynik = seria([
      { x: 50, y: 50, t: 0 },
      { x: 50, y: 50, t: 100 },
      { x: 50, y: 50, t: 200 },
      { x: 50, y: 50, t: 5000 },
      { x: 50, y: 50, t: 5100 },
      { x: 50, y: 50, t: 5200 },
    ])
    assert.deepEqual(wynik, [false, false, true, false, false, true])
  })

  it('stan nie jest mutowany (funkcja czysta)', () => {
    const przed = FURIA_POCZATEK
    czyFuria(przed, { x: 1, y: 1, t: 0 })
    assert.deepEqual(przed, { historia: [], zgloszona: false })
  })
})

describe('nazwaCelu', () => {
  it('data-cel wygrywa ze wszystkim i zachowuje cyfry', () => {
    assert.equal(
      nazwaCelu({ dataCel: 'Krok-2', ariaLabel: 'Inny napis', tekst: 'Jeszcze inny' }),
      'krok-2',
    )
  })

  it('aria-label ma pierwszeństwo przed tekstem', () => {
    assert.equal(nazwaCelu({ ariaLabel: 'Zamknij okno', tekst: 'X' }), 'zamknij-okno')
  })

  it('tekst: małe litery, bez diakrytyków (także ł), myślniki zamiast spacji', () => {
    assert.equal(nazwaCelu({ tekst: 'Porównaj okolice' }), 'porownaj-okolice')
    assert.equal(nazwaCelu({ tekst: 'Łódź, Żółć' }), 'lodz-zolc')
  })

  it('cyfry w nazwie z tekstu znikają, więc warianty jednego przycisku się łączą', () => {
    assert.equal(nazwaCelu({ tekst: 'Pokaż rok 2019' }), 'pokaz-rok')
    assert.equal(nazwaCelu({ tekst: 'Pokaż rok 2020' }), 'pokaz-rok')
    assert.equal(nazwaCelu({ tekst: 'Dodaj do porównania (2/5)' }), 'dodaj-do-porownania')
  })

  it('przycina do 40 znaków i nie zostawia myślnika na końcu', () => {
    const nazwa = nazwaCelu({
      tekst: 'to jest bardzo długi napis na przycisku który nie mieści się w limicie',
    })
    assert.ok(nazwa.length <= MAX_CEL)
    assert.ok(!nazwa.endsWith('-'))
    assert.equal(nazwaCelu({ dataCel: 'a'.repeat(100) }).length, MAX_CEL)
  })

  it('brak czegokolwiek: bez-nazwy', () => {
    assert.equal(nazwaCelu({}), CEL_BRAK)
    assert.equal(nazwaCelu({ tekst: '   ', ariaLabel: '' }), CEL_BRAK)
    assert.equal(nazwaCelu({ tekst: '12345 !!!' }), CEL_BRAK)
  })

  it('dane osobowe w tekście i aria-label nie trafiają do nazwy', () => {
    assert.equal(nazwaCelu({ tekst: 'Napisz do jan.kowalski@example.com' }), CEL_BRAK)
    assert.equal(nazwaCelu({ ariaLabel: 'Zadzwoń 600 700 800' }), CEL_BRAK)
  })

  it('wynik nigdy nie zawiera separatora klucza ani znaków poza [a-z0-9-]', () => {
    for (const tekst of ['sekcja§cel', 'a/b?c=d', 'Zażółć gęślą jaźń', '<b>tag</b>', '😀 emoji']) {
      const nazwa = nazwaCelu({ tekst })
      assert.match(nazwa, /^[a-z0-9-]+$/, `${tekst} → ${nazwa}`)
    }
    assert.match(nazwaCelu({ dataCel: 'A§B C' }), /^[a-z0-9-]+$/)
  })

  it('link do strony o dynamicznym adresie dostaje wzorzec, nie adres ani tekst', () => {
    const baza = 'https://adresscore.pl/#/'
    assert.equal(
      nazwaCelu({ href: '/adres/ul-dluga-5-krakow', tekst: 'ul. Długa 5' }, baza),
      'adres',
    )
    assert.equal(nazwaCelu({ href: '#/adres/abc123', tekst: 'Okolica' }, baza), 'adres')
    assert.equal(nazwaCelu({ href: '/katalog/ulica-dluga', tekst: 'Długa' }, baza), 'katalog-ulica')
    assert.equal(nazwaCelu({ href: '/adres/x', dataCel: 'zobacz-okolice' }, baza), 'zobacz-okolice')
  })
})

describe('wzorzecLinku', () => {
  const baza = 'https://adresscore.pl/'
  it('własne trasy dynamiczne', () => {
    assert.equal(wzorzecLinku('/adres/a', baza), 'adres')
    assert.equal(wzorzecLinku('https://adresscore.pl/adres/a?x=1', baza), 'adres')
    assert.equal(wzorzecLinku('/katalog/x', baza), 'katalog-ulica')
  })

  it('trasy statyczne i obce hosty: null', () => {
    assert.equal(wzorzecLinku('/katalog', baza), null)
    assert.equal(wzorzecLinku('/metoda', baza), null)
    assert.equal(wzorzecLinku('/adres/', baza), null)
    assert.equal(wzorzecLinku('https://inny.pl/adres/a', baza), null)
    assert.equal(wzorzecLinku('javascript:alert(1)', baza), null)
    assert.equal(wzorzecLinku(null, baza), null)
    assert.equal(wzorzecLinku('', baza), null)
  })
})

describe('rejestr CTA', () => {
  const klucz = (cel: string) => kluczCta('karta', cel)

  it('klucz to sekcja§cel', () => {
    assert.equal(kluczCta('karta', 'porownaj'), 'karta§porownaj')
  })

  it('liczy ekspozycje i kliki per klucz', () => {
    const r = utworzRejestrCta()
    r.ekspozycja(klucz('a'), false)
    r.ekspozycja(klucz('a'), false)
    r.klik(klucz('a'), false)
    r.ekspozycja(klucz('b'), false)
    assert.deepEqual(r.zbierz(), [
      ['karta§a', 2, 1],
      ['karta§b', 1, 0],
    ])
  })

  it('zbieranie niczego nie zeruje: to odczyt stanu od otwarcia odsłony, nie przyrost', () => {
    const r = utworzRejestrCta()
    r.ekspozycja(klucz('a'), false)
    assert.deepEqual(r.zbierz(), [['karta§a', 1, 0]])
    assert.deepEqual(r.zbierz(), [['karta§a', 1, 0]], 'drugi odczyt daje to samo')
    r.klik(klucz('a'), false)
    assert.deepEqual(r.zbierz(), [['karta§a', 1, 1]], 'kumulacja, nie przyrost')
  })

  it('przycisk widziany, a nieklikany, jest w wyniku z zerem kliknięć (dane do „martwych”)', () => {
    const r = utworzRejestrCta()
    r.ekspozycja(klucz('martwy'), false)
    assert.deepEqual(r.zbierz(), [['karta§martwy', 1, 0]])
  })

  it('limit MAX_CTA: najpierw klikane, potem jawne, potem najczęściej widziane', () => {
    const r = utworzRejestrCta()
    for (let i = 0; i < 20; i++) r.ekspozycja(klucz(`auto${i}`), false)
    r.ekspozycja(klucz('auto-czesto'), false)
    r.ekspozycja(klucz('auto-czesto'), false)
    r.ekspozycja(klucz('jawny'), true)
    r.klik(klucz('klikany'), false)
    const wynik = r.zbierz() ?? []
    assert.equal(wynik.length, MAX_CTA)
    assert.equal(wynik[0]?.[0], 'karta§klikany')
    assert.equal(wynik[1]?.[0], 'karta§jawny')
    assert.equal(wynik[2]?.[0], 'karta§auto-czesto')
  })

  it('licznik ma kaptur', () => {
    const r = utworzRejestrCta()
    for (let i = 0; i < MAX_LICZNIK_CTA + 50; i++) r.ekspozycja(klucz('a'), false)
    assert.equal(r.zbierz()?.[0]?.[1], MAX_LICZNIK_CTA)
  })

  it('bezpiecznik na liczbę kluczy w odsłonie', () => {
    const r = utworzRejestrCta(1000)
    for (let i = 0; i < 200; i++) r.ekspozycja(klucz(`k${i}`), false)
    assert.ok((r.zbierz() ?? []).length <= 60)
  })

  it('reset zapomina wszystko', () => {
    const r = utworzRejestrCta()
    r.klik(klucz('a'), false)
    r.reset()
    assert.equal(r.zbierz(), null)
  })
})
