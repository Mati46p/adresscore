// Słownik liczb i lista zakładek panelu: kompletność względem spec (FR-030–FR-037) i spójność tekstów.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { haslo, KLUCZE_HASEL, SLOWNIK_PANELU } from './slownik.ts'
import { jestZakladka, WSTEPY, ZAKLADKA_DOMYSLNA, ZAKLADKI } from './zakladki.ts'

/** Liczby ze spec, przy których MUSI stać podpowiedź (FR-030–FR-036), pogrupowane wg zakładki. */
const WYMAGANE: Record<string, string[]> = {
  // FR-030
  przeglad: [
    'przeglad.unikalniDzis',
    'przeglad.unikalniWczoraj',
    'przeglad.unikalni7d',
    'przeglad.unikalniSrednia7d',
    'przeglad.odslony24h',
    'przeglad.odslony7d',
    'przeglad.odslony30d',
    'przeglad.szczytGodzina',
    'przeglad.szczytDzien',
    'przeglad.teraz5min',
    'przeglad.ludzieBoty',
    'przeglad.crawleryAi',
    'przeglad.wykresDzienny',
    'przeglad.wykresGodzinowy',
  ],
  // FR-031
  akwizycja: [
    'akwizycja.wizyty',
    'akwizycja.kanaly',
    'akwizycja.zrodla',
    'akwizycja.kampanie',
    'akwizycja.kraje',
    'akwizycja.urzadzenia',
  ],
  // FR-032
  sesje: [
    'sesje.sesje',
    'sesje.stronNaSesje',
    'sesje.czasWizyty',
    'sesje.zaangazowane',
    'sesje.jednostronicowe',
    'sesje.przejscia',
    'sesje.udostepnienia',
  ],
  // FR-033
  zaangazowanie: [
    'zaangazowanie.sciezki',
    'zaangazowanie.sekcjaCzas',
    'zaangazowanie.sekcjaZasieg',
    'zaangazowanie.punktUrwania',
  ],
  // FR-034
  cta: ['cta.klikalnosc', 'cta.martwe', 'cta.furia', 'cta.martwyKlik'],
  // FR-035
  tresc: ['tresc.topEkrany', 'tresc.topAdresy', 'tresc.bezWyniku', 'tresc.lejek'],
  // FR-036
  jakosc: [
    'jakosc.ostatnieZdarzenie',
    'jakosc.zdarzenia24h',
    'jakosc.ostatniBieg',
    'jakosc.dniWZestawieniu',
    'jakosc.witaleP75',
    'jakosc.lcp',
    'jakosc.inp',
    'jakosc.cls',
    'jakosc.fcp',
    'jakosc.ttfb',
    'jakosc.probki',
    'jakosc.bledy',
  ],
}

describe('słownik liczb panelu', () => {
  it('ma hasło dla każdej liczby wymienionej w spec (FR-030–FR-036)', () => {
    for (const [zakladka, klucze] of Object.entries(WYMAGANE)) {
      for (const klucz of klucze) {
        assert.ok(klucz in SLOWNIK_PANELU, `${zakladka}: brak hasła ${klucz}`)
      }
    }
  })

  it('każde hasło ma nazwę i opis „co liczy”; klucz zaczyna się od zakładki, do której należy', () => {
    const zakladki = new Set(ZAKLADKI.map((z) => z.id as string))
    for (const klucz of KLUCZE_HASEL) {
      const h = haslo(klucz)
      assert.ok(h.nazwa.trim().length >= 3, `${klucz}: nazwa`)
      assert.ok(h.liczy.trim().length >= 25, `${klucz}: opis zbyt krótki`)
      assert.ok(zakladki.has(klucz.split('.')[0] ?? ''), `${klucz}: nieznana zakładka w kluczu`)
      // Brak pustych pól opcjonalnych (puste pole to usterka, nie „brak pułapki”).
      for (const pole of ['okno', 'pulapka', 'kierunek'] as const) {
        const wartosc = h[pole]
        assert.ok(wartosc === undefined || wartosc.trim().length > 0, `${klucz}: puste ${pole}`)
      }
    }
  })

  it('liczby, które łatwo wziąć za coś innego, mają pułapkę wypisaną wprost', () => {
    const zPulapka = [
      'przeglad.unikalniDzis',
      'przeglad.unikalni7d',
      'przeglad.unikalniSrednia7d',
      'przeglad.ludzieBoty',
      'przeglad.crawleryAi',
      'akwizycja.kanaly',
      'akwizycja.kraje',
      'sesje.sesje',
      'sesje.czasWizyty',
      'sesje.jednostronicowe',
      'cta.klikalnosc',
      'tresc.lejek',
      'jakosc.bezOdcisku',
      'jakosc.witaleP75',
    ] as const
    for (const klucz of zPulapka) {
      assert.ok((haslo(klucz).pulapka ?? '').length > 30, `${klucz}: brak pułapki`)
    }
  })

  it('pułapki z zadania są w tekście: suma dobowych odcisków, czasy jako podłoga, sesja zaangażowana, lejek na sesjach', () => {
    assert.match(haslo('przeglad.unikalni7d').pulapka ?? '', /NIE JEST LICZBA OSÓB/)
    assert.match(haslo('przeglad.unikalni7d').liczy, /Suma dobowych/)
    assert.match(haslo('sesje.czasWizyty').pulapka ?? '', /PODŁOGA/)
    assert.match(
      haslo('sesje.zaangazowane').liczy,
      /co najmniej 2 odsłony albo co najmniej 30 sekund/,
    )
    assert.match(haslo('tresc.lejek').liczy, /sesjach NIEZALEŻNIE/)
    assert.match(haslo('przeglad.teraz5min').liczy, /5 minutach/)
    assert.match(haslo('przeglad.teraz5min').pulapka ?? '', /Bez botów/)
  })

  it('metryki, w których kierunek skali nie jest oczywisty, podpisują go (FR-038)', () => {
    for (const klucz of [
      'jakosc.witaleP75',
      'jakosc.lcp',
      'jakosc.inp',
      'jakosc.cls',
      'jakosc.fcp',
      'jakosc.ttfb',
      'sesje.zaangazowane',
      'cta.klikalnosc',
    ] as const) {
      assert.match(haslo(klucz).kierunek ?? '', /(Więcej|Mniej) znaczy lepiej/, klucz)
    }
  })

  it('progi Web Vitals w tekście zgadzają się z progami w arytmetyce', async () => {
    const { PROGI_WITALI } = await import('./arytmetyka.ts')
    const format = (n: number) =>
      n.toLocaleString('pl-PL', { useGrouping: 'always' }).replaceAll(/\s/g, ' ')
    const kierunek = (klucz: 'jakosc.lcp' | 'jakosc.inp' | 'jakosc.fcp' | 'jakosc.ttfb') =>
      (haslo(klucz).kierunek ?? '').replaceAll(/\s/g, ' ')
    const sprawdz = (
      klucz: 'jakosc.lcp' | 'jakosc.inp' | 'jakosc.fcp' | 'jakosc.ttfb',
      m: 'lcp' | 'inp' | 'fcp' | 'ttfb',
    ) => {
      assert.ok(kierunek(klucz).includes(`do ${format(PROGI_WITALI[m].dobra)} ms`), klucz)
      assert.ok(kierunek(klucz).includes(`powyżej ${format(PROGI_WITALI[m].slaba)} ms`), klucz)
    }
    sprawdz('jakosc.lcp', 'lcp')
    sprawdz('jakosc.inp', 'inp')
    sprawdz('jakosc.fcp', 'fcp')
    sprawdz('jakosc.ttfb', 'ttfb')
    assert.match(haslo('jakosc.cls').kierunek ?? '', /do 0,1, słaba powyżej 0,25/)
  })
})

/**
 * Hasła, które wykonawcy zakładek obeszli lokalnymi podpisami, bo słownik ich nie miał. Teraz
 * definicja żyje w słowniku, a zakładki tylko do niej odsyłają (`klucz=` albo `<Podpowiedz>`).
 */
const UZUPELNIAJACE = [
  'akwizycja.odslonyGlebokosc',
  'akwizycja.wewnetrzne',
  'sesje.odsetekDokonczen',
  'sesje.sygnalWyjscia',
  'przeglad.pozostaleRoboty',
] as const

describe('hasła uzupełniające (definicje wyniesione z lokalnych podpisów zakładek)', () => {
  it('istnieją, mają pułapkę wypisaną wprost i spełniają konwencję pól', () => {
    for (const klucz of UZUPELNIAJACE) {
      assert.ok(klucz in SLOWNIK_PANELU, `brak hasła ${klucz}`)
      const h = haslo(klucz)
      assert.ok((h.pulapka ?? '').length > 30, `${klucz}: brak pułapki`)
      assert.ok(h.liczy.trim().length >= 25, `${klucz}: opis zbyt krótki`)
    }
  })

  it('odsłony i głębokość wizyt: odsłona człowieka, wszystkie odsłony wizyt kanału, głębsze nie znaczy lepsze', () => {
    const h = haslo('akwizycja.odslonyGlebokosc')
    assert.match(h.liczy, /bez botów/)
    assert.match(h.liczy, /WSZYSTKIE jej odsłony, nie tylko pierwsza/)
    assert.match(h.liczy, /odsłony ÷ wizyty/)
    assert.match(h.liczy, /Strony na sesję/) // ta sama głębokość w zakładce Sesje
    // Kierunek skali wypisany: więcej odsłon na wizytę to głębiej, nie lepiej (FR-038).
    assert.match(h.kierunek ?? '', /niekoniecznie lepsze/)
  })

  it('„wewnętrzne” nie jest wejściem: nazwa kanału zgadza się z nazwami w panelu, wizyta liczy się jako bezpośrednia', async () => {
    const { NAZWA_KANALU } = await import('./nazwy.ts')
    const h = haslo('akwizycja.wewnetrzne')
    assert.ok(h.nazwa.includes(NAZWA_KANALU.wewnetrzne), 'nazwa hasła wymienia kanał tak jak panel')
    assert.match(h.liczy, /nie jest kanałem wejścia/)
    assert.match(h.liczy, /liczy się jako bezpośrednia/)
    assert.match(h.liczy, /30 minut/)
    assert.match(h.liczy, /nie dziedziczy referera ani znaczników UTM/)
  })

  it('odsetek dokończeń: tekst wymienia dokładnie te sposoby, które logika zakładki liczy jako dokończone', async () => {
    const { SPOSOBY_DOKONCZONE } = await import('./zakladki/sesje-dane.ts')
    const { NAZWA_SPOSOBU_UDOSTEPNIENIA } = await import('./nazwy.ts')
    const h = haslo('sesje.odsetekDokonczen')
    // Zdanie „Dokończone to A, B albo C;” (do średnika) jest listą sposobów dokończonych.
    const lista = (/Dokończone to ([^;]+);/.exec(h.liczy)?.[1] ?? '').toLowerCase()
    assert.ok(lista.length > 0, 'hasło ma zdanie „Dokończone to …;”')
    for (const [sposob, nazwa] of Object.entries(NAZWA_SPOSOBU_UDOSTEPNIENIA)) {
      const dokonczony = SPOSOBY_DOKONCZONE.includes(sposob)
      assert.equal(
        lista.includes(nazwa.toLowerCase()),
        dokonczony,
        `${sposob} („${nazwa}”): ${dokonczony ? 'brakuje na liście dokończonych' : 'jest na liście, a logika go nie liczy'}`,
      )
    }
    assert.match(h.liczy, /WSZYSTKIE próby/)
    assert.match(h.kierunek ?? '', /Więcej znaczy lepiej/)
  })

  it('sygnał wyjścia: wysyłany RAZ przy ukryciu karty albo opuszczeniu odsłony, czasy i sekcje to podłoga', () => {
    const h = haslo('sesje.sygnalWyjscia')
    assert.match(h.liczy, /RAZ/)
    assert.match(h.liczy, /pierwszym ukryciu karty/)
    assert.match(h.liczy, /opuszczeniu odsłony/)
    assert.match(h.pulapka ?? '', /PODŁOG/)
    assert.match(h.nazwa, /podłoga/)
  })

  it('pozostałe roboty: wymienia klasy robotów z nazw w panelu poza crawlerami AI', async () => {
    const { NAZWA_KLASY_BOTA } = await import('./nazwy.ts')
    const h = haslo('przeglad.pozostaleRoboty')
    const liczy = h.liczy.toLowerCase()
    for (const [klasa, nazwa] of Object.entries(NAZWA_KLASY_BOTA)) {
      if (klasa === 'ai') continue // crawlery AI mają własną tabelę (przeglad.crawleryAi)
      assert.ok(liczy.includes(nazwa.toLowerCase()), `klasa ${klasa} („${nazwa}”) poza hasłem`)
    }
    assert.match(h.pulapka ?? '', /WSZYSTKIE roboty/) // pasek „Ludzie i boty” liczy je razem
    assert.equal(h.okno, '30 dni')
  })
})

describe('zakładki panelu', () => {
  it('jest siedem zakładek w ustalonej kolejności, bez Gmin, Czytelników, Redakcji i Reklam', () => {
    assert.deepEqual(
      ZAKLADKI.map((z) => z.id),
      ['przeglad', 'akwizycja', 'sesje', 'zaangazowanie', 'cta', 'tresc', 'jakosc'],
    )
    assert.deepEqual(
      ZAKLADKI.map((z) => z.etykieta),
      ['Przegląd', 'Akwizycja', 'Sesje', 'Zaangażowanie', 'CTA', 'Treść', 'Jakość'],
    )
  })

  it('każda zakładka ma tytuł i JEDNOZDANIOWY wstęp (FR-037); domyślna to Przegląd', () => {
    for (const z of ZAKLADKI) {
      assert.ok(z.tytul.length > 10, z.id)
      const wstep = WSTEPY[z.id]
      assert.ok(wstep.length > 60, `${z.id}: wstęp zbyt krótki`)
      // Jedno zdanie: żadna kropka (ani ? !) nie jest po niej następowana wielką literą.
      assert.equal(
        wstep.split(/[.?!]\s+[A-ZĄĆĘŁŃÓŚŹŻ]/).length,
        1,
        `${z.id}: więcej niż jedno zdanie`,
      )
      assert.ok(wstep.endsWith('.'), `${z.id}: wstęp nie kończy się kropką`)
    }
    assert.equal(Object.keys(WSTEPY).length, ZAKLADKI.length)
    assert.equal(ZAKLADKA_DOMYSLNA, 'przeglad')
  })

  it('jestZakladka rozpoznaje wyłącznie istniejące identyfikatory', () => {
    assert.equal(jestZakladka('cta'), true)
    assert.equal(jestZakladka('gminy'), false)
    assert.equal(jestZakladka(''), false)
  })
})
