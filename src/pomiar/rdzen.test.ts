// Rdzeń pomiaru na atrapach (kolejka z prawdziwym kodem, transport, zegar i obserwatory sztuczne).
// Sprawdza cykl życia odsłony, czas widoczny, strażnika dubla, filtrowanie właściwości i
// niezmienniki prywatności. Uruchom: node --test "src/pomiar/*.test.ts"
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Ekran } from '@/wynik/url'
import { utworzKolejke, type Zegar } from './kolejka.ts'
import type {
  CtaPomiar,
  MetrykaWital,
  Paczka,
  SekcjaPomiar,
  Urzadzenie,
  Zdarzenie,
} from './kontrakt.ts'
import { MAX_CZAS_MS } from './kontrakt.ts'
import {
  MAX_BLEDOW_NA_ODSLONE,
  MAX_SYGNALOW_NA_ODSLONE,
  type Obserwatory,
  OKNO_POWTORKI_MS,
  type Okno,
  utworzRdzen,
} from './rdzen.ts'
import type { ZrodloWejscia } from './zrodlo.ts'

function atrapaZegara() {
  let teraz = 0
  let licznik = 0
  const zadania = new Map<number, { kiedy: number; funkcja: () => void }>()
  const zegar: Zegar = {
    ustaw(funkcja, ms) {
      const id = ++licznik
      zadania.set(id, { kiedy: teraz + ms, funkcja })
      return id
    },
    wyczysc(uchwyt) {
      zadania.delete(uchwyt as number)
    },
  }
  return {
    zegar,
    uplyw(ms: number) {
      const cel = teraz + ms
      for (;;) {
        const nastepne = [...zadania.entries()]
          .filter(([, z]) => z.kiedy <= cel)
          .sort((a, b) => a[1].kiedy - b[1].kiedy)[0]
        if (!nastepne) break
        zadania.delete(nastepne[0])
        teraz = nastepne[1].kiedy
        nastepne[1].funkcja()
      }
      teraz = cel
    },
  }
}

interface StanObserwatorow {
  sk?: SekcjaPomiar[]
  ct?: CtaPomiar[]
  witale: { n: MetrykaWital; v: number }[]
  wywolania: string[]
}

function atrapaObserwatorow() {
  const stan: StanObserwatorow = { witale: [], wywolania: [] }
  const obserwatory: Obserwatory = {
    nowyWidok: () => void stan.wywolania.push('nowyWidok'),
    wstrzymaj: () => void stan.wywolania.push('wstrzymaj'),
    wznow: () => void stan.wywolania.push('wznow'),
    zbierz() {
      stan.wywolania.push('zbierz')
      // Wartości od otwarcia odsłony, nie przyrost: odczyt niczego nie zeruje.
      return { ...(stan.sk ? { sk: stan.sk } : {}), ...(stan.ct ? { ct: stan.ct } : {}) }
    },
    witale() {
      const doWyslania = stan.witale
      stan.witale = []
      return doWyslania
    },
  }
  return { obserwatory, stan }
}

const OKNO_KROTKIE: Okno = { dno: 800, wysokoscDokumentu: 800, wysokoscOkna: 800 }

function swiat(
  opcje: {
    wejscie?: ZrodloWejscia
    urzadzenie?: Urzadzenie
    okno?: Okno
    limitKarty?: number
  } = {},
) {
  const stan = {
    t: 0,
    widoczna: true,
    wylaczony: false,
    okno: { ...(opcje.okno ?? OKNO_KROTKIE) },
  }
  const zegar = atrapaZegara()
  const zadania: Zdarzenie[][] = []
  const kolejka = utworzKolejke({
    wyslij: (cialo) => void zadania.push((JSON.parse(cialo) as Paczka).z),
    wylaczony: () => stan.wylaczony,
    czyUkryta: () => !stan.widoczna,
    zegar: zegar.zegar,
    limitNaKarte: opcje.limitKarty,
  })
  const rdzen = utworzRdzen({
    kolejka,
    teraz: () => stan.t,
    widoczna: () => stan.widoczna,
    okno: () => stan.okno,
    dno: () => stan.okno.dno,
    wylaczony: () => stan.wylaczony,
    urzadzenie: opcje.urzadzenie ?? 'desktop',
    wejscie: opcje.wejscie ?? {},
    wlasnyHost: 'adresscore.pl',
  })
  const obs = atrapaObserwatorow()
  return {
    stan,
    rdzen,
    kolejka,
    zadania,
    obserwatory: obs.obserwatory,
    stanObs: obs.stan,
    /** Wszystko, co dotąd wyszło do sieci, w kolejności wysłania. */
    wyslane: () => zadania.flat(),
    /** Czas płynie: zegar rdzenia i zegar kolejki (5 s bezczynności). */
    tyk(ms: number) {
      stan.t += ms
      zegar.uplyw(ms)
    },
    ukryjKarte() {
      stan.widoczna = false
      rdzen.ukryj()
    },
    pokazKarte() {
      stan.widoczna = true
      rdzen.pokaz()
    },
    /** Wypycha to, co leży w buforze (jak ukrycie karty). */
    splukaj() {
      kolejka.zamknij()
    },
  }
}

const typy = (z: readonly Zdarzenie[]) => z.map((x) => x.t)
const ekran = (nazwa: string) => nazwa as Ekran

function wyjscia(z: readonly Zdarzenie[]) {
  return z.filter((x): x is Extract<Zdarzenie, { t: 'wyjscie' }> => x.t === 'wyjscie')
}

describe('rdzen: odsłona', () => {
  it('pierwsza odsłona niesie ekran, ścieżkę, urządzenie i źródło wejścia na stronę', () => {
    const s = swiat({
      wejscie: { rh: 'google.com', us: 'newsletter', ci: 'gclid' },
      urzadzenie: 'mobile',
    })
    s.rdzen.odslona(ekran('okolica'), '/adres/ul-dluga-5-krakow')
    s.splukaj()
    assert.deepEqual(s.wyslane(), [
      {
        t: 'odslona',
        e: 'okolica',
        s: '/adres/ul-dluga-5-krakow',
        u: 'mobile',
        rh: 'google.com',
        us: 'newsletter',
        ci: 'gclid',
      },
    ])
  })

  it('kolejna odsłona zamyka poprzednią (wyjscie), a paczka kończy się na zmianie ekranu', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.tyk(4000)
    s.rdzen.odslona(ekran('porownanie'), '/porownanie')
    // Odsłona A i jej wyjście wyszły już w OSOBNYM żądaniu; odsłona B czeka w buforze.
    assert.equal(s.zadania.length, 1)
    assert.deepEqual(typy(s.zadania[0] ?? []), ['odslona', 'wyjscie'])
    assert.equal(s.kolejka.rozmiar(), 1)
    assert.deepEqual(wyjscia(s.wyslane())[0], {
      t: 'wyjscie',
      e: 'szukaj',
      s: '/',
      u: 'desktop',
      ms: 4000,
      sc: 100,
    })
  })

  it('odsłony po pierwszej niosą własny host zamiast źródła zewnętrznego', () => {
    const s = swiat({ wejscie: { rh: 'google.com', us: 'x', ci: 'fbclid' } })
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.rdzen.odslona(ekran('metoda'), '/metoda')
    s.splukaj()
    const odslony = s.wyslane().filter((z) => z.t === 'odslona')
    assert.equal(odslony.length, 2)
    assert.deepEqual(odslony[1], {
      t: 'odslona',
      e: 'metoda',
      s: '/metoda',
      u: 'desktop',
      rh: 'adresscore.pl',
    })
    assert.equal((odslony[0] as { rh?: string }).rh, 'google.com')
  })

  it('ta sama odsłona wołana ponownie jest ignorowana (StrictMode, dane doczytane)', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('okolica'), '/adres/ul-dluga-5')
    s.rdzen.odslona(ekran('okolica'), '/adres/ul-dluga-5')
    s.rdzen.odslona(ekran('okolica'), '/adres/ul-dluga-5')
    s.splukaj()
    assert.deepEqual(typy(s.wyslane()), ['odslona'])
  })

  it('ten sam ekran, inna ścieżka (inny adres) to nowa odsłona', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('okolica'), '/adres/a')
    s.tyk(1000)
    s.rdzen.odslona(ekran('okolica'), '/adres/b')
    s.splukaj()
    assert.deepEqual(typy(s.wyslane()), ['odslona', 'wyjscie', 'odslona'])
  })

  it('ścieżka jest czyszczona z query i fragmentu, dostaje wiodący ukośnik', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('porownanie'), '/porownanie?cmp=a,b#tajne')
    s.rdzen.odslona(ekran('metoda'), 'metoda')
    s.splukaj()
    assert.deepEqual(
      s.wyslane().map((z) => z.s),
      ['/porownanie', '/porownanie', '/metoda'],
    )
  })

  it('ekran panel nie jest mierzony: zamyka poprzednią odsłonę i nic nie otwiera', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.tyk(2000)
    s.rdzen.odslona(ekran('panel'), '/panel')
    s.rdzen.produktowe('karta_adresu')
    s.rdzen.udostepnienie('przycisk', 'link')
    s.rdzen.blad('blad z panelu')
    s.rdzen.klik('sekcja', 'martwy', 'div')
    s.tyk(3000)
    s.rdzen.ukryj()
    assert.deepEqual(typy(s.wyslane()), ['odslona', 'wyjscie'])
    assert.equal(wyjscia(s.wyslane())[0]?.ms, 2000)
  })

  it('start na panelu: nic nie wychodzi, a pierwsza zmierzona odsłona dostaje źródło wejścia', () => {
    const s = swiat({ wejscie: { rh: 'google.com' } })
    s.rdzen.odslona(ekran('panel'), '/')
    s.rdzen.ukryj()
    assert.deepEqual(s.wyslane(), [])
    s.pokazKarte()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.splukaj()
    assert.equal((s.wyslane()[0] as { rh?: string }).rh, 'google.com')
  })

  it('odsłona informuje obserwatory o nowym widoku', () => {
    const s = swiat()
    s.rdzen.ustawObserwatory(s.obserwatory)
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.rdzen.odslona(ekran('metoda'), '/metoda')
    assert.deepEqual(
      s.stanObs.wywolania.filter((w) => w === 'nowyWidok'),
      ['nowyWidok', 'nowyWidok'],
    )
  })
})

describe('rdzen: czas widoczny, ukrycie karty i jedno wyjscie na odsłonę', () => {
  it('wyjscie niesie czas widoczny odsłony', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.tyk(7300)
    s.ukryjKarte()
    assert.equal(wyjscia(s.wyslane())[0]?.ms, 7300)
  })

  it('wyjscie wychodzi NAJWYŻEJ RAZ: po ukryciu odsłona jest domknięta, powrót nie otwiera nowego odcinka', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.tyk(3000)
    s.ukryjKarte()
    s.tyk(600_000) // karta w tle: czas nie płynie
    s.pokazKarte()
    s.tyk(120_000) // długie czytanie po powrocie: poza pomiarem (podłoga)
    s.ukryjKarte()
    s.rdzen.ukryj() // pagehide
    assert.deepEqual(
      wyjscia(s.wyslane()).map((w) => w.ms),
      [3000],
    )
    assert.equal(
      typy(s.wyslane()).filter((t) => t === 'odslona').length,
      1,
      'powrót na kartę nie otwiera nowej odsłony',
    )
  })

  it('wyjscie wychodzi RAZ mimo visibilitychange + pagehide (strażnik dubla)', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.tyk(1000)
    s.stan.widoczna = false
    s.rdzen.ukryj() // visibilitychange
    s.rdzen.ukryj() // pagehide
    s.rdzen.ukryj()
    assert.equal(wyjscia(s.wyslane()).length, 1)
  })

  it('pierwsze (jedyne) wyjscie wychodzi nawet przy zerowym czasie (otwarcie i natychmiastowe wyjście)', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.ukryjKarte()
    assert.equal(wyjscia(s.wyslane())[0]?.ms, 0)
  })

  it('limit czasu widocznego to 30 minut', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.tyk(2 * 60 * 60 * 1000)
    s.ukryjKarte()
    assert.equal(wyjscia(s.wyslane())[0]?.ms, MAX_CZAS_MS)
  })

  it('odsłona otwarta na ukrytej karcie nie liczy czasu, dopóki karta nie wróci', () => {
    const s = swiat()
    s.stan.widoczna = false
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.tyk(5000)
    s.pokazKarte() // odsłona jeszcze nie była domknięta, więc to jej PIERWSZY odcinek
    s.tyk(1500)
    s.ukryjKarte()
    assert.equal(wyjscia(s.wyslane())[0]?.ms, 1500)
  })

  it('zmiana odsłony po ukryciu karty nie dubluje wyjscia (zamknięcie poprzedniej to no-op)', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.tyk(1000)
    s.ukryjKarte()
    s.pokazKarte()
    s.rdzen.odslona(ekran('metoda'), '/metoda')
    assert.equal(wyjscia(s.wyslane()).length, 1)
  })

  it('odsłona otwarta po domknięciu poprzedniej mierzy się normalnie, od własnego otwarcia', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('okolica'), '/adres/a')
    s.tyk(3000)
    s.ukryjKarte()
    s.tyk(10_000)
    s.pokazKarte()
    s.tyk(1000) // czas przed nawigacją należy do domkniętej odsłony: poza pomiarem
    s.rdzen.odslona(ekran('porownanie'), '/porownanie')
    s.tyk(4000)
    s.ukryjKarte()
    const wyj = wyjscia(s.wyslane())
    assert.deepEqual(
      wyj.map((w) => [w.e, w.ms]),
      [
        ['okolica', 3000],
        ['porownanie', 4000],
      ],
    )
    assert.deepEqual(typy(s.wyslane()).filter((t) => t === 'odslona').length, 2)
  })

  it('nawigacja domyka odsłonę wyjściem, a późniejsze ukrycie dodaje już tylko wyjscie następnej', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.tyk(2000)
    s.rdzen.odslona(ekran('metoda'), '/metoda')
    s.tyk(3000)
    s.ukryjKarte()
    s.pokazKarte()
    s.ukryjKarte()
    assert.deepEqual(
      wyjscia(s.wyslane()).map((w) => [w.e, w.ms]),
      [
        ['szukaj', 2000],
        ['metoda', 3000],
      ],
    )
  })

  it('po domknięciu odsłony zdarzenia klik, produktowe, udostępnienie i błąd nadal wychodzą', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('okolica'), '/adres/a')
    s.tyk(1000)
    s.ukryjKarte()
    s.pokazKarte()
    s.rdzen.produktowe('porownanie_dodaj')
    s.rdzen.udostepnienie('przycisk-karty', 'kopia')
    s.rdzen.klik('karta', 'martwy', 'div')
    s.rdzen.blad('błąd po domknięciu')
    s.splukaj()
    const po = s.wyslane().slice(s.wyslane().findIndex((z) => z.t === 'wyjscie') + 1)
    assert.deepEqual(
      po.map((z) => z.t),
      ['produktowe', 'udostepnienie', 'klik', 'blad'],
    )
    assert.equal(wyjscia(s.wyslane()).length, 1, 'wyjscie dalej jedno')
  })

  it('obserwatory pytane o sekcje i CTA RAZ na odsłonę (przy jedynym wyjściu)', () => {
    const s = swiat()
    s.rdzen.ustawObserwatory(s.obserwatory)
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.stanObs.wywolania.length = 0
    s.ukryjKarte()
    s.pokazKarte()
    s.ukryjKarte()
    s.rdzen.ukryj()
    assert.equal(s.stanObs.wywolania.filter((w) => w === 'zbierz').length, 1)
  })

  it('obserwatory: wstrzymanie przy ukryciu, wznowienie przy powrocie (także po domknięciu)', () => {
    const s = swiat()
    s.rdzen.ustawObserwatory(s.obserwatory)
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.stanObs.wywolania.length = 0
    s.ukryjKarte()
    s.pokazKarte()
    // Wznowienie jest potrzebne następnej odsłonie, mimo że ta jest już domknięta.
    assert.deepEqual(s.stanObs.wywolania, ['zbierz', 'wstrzymaj', 'wznow'])
  })

  it('obserwatory podłączone PO otwarciu odsłony zaczynają od niej; ukryta karta ich wstrzymuje', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.rdzen.ustawObserwatory(s.obserwatory)
    assert.deepEqual(s.stanObs.wywolania, ['nowyWidok'])
    const t = swiat()
    t.rdzen.odslona(ekran('szukaj'), '/')
    t.stan.widoczna = false
    t.rdzen.ustawObserwatory(t.obserwatory)
    assert.deepEqual(t.stanObs.wywolania, ['nowyWidok', 'wstrzymaj'])
  })
})

describe('rdzen: przewinięcie', () => {
  const dlugaStrona: Okno = { dno: 800, wysokoscDokumentu: 4000, wysokoscOkna: 800 }

  it('bez przewijania długiej strony: ułamek równy pierwszemu ekranowi', () => {
    const s = swiat({ okno: dlugaStrona })
    s.rdzen.odslona(ekran('okolica'), '/adres/a')
    s.ukryjKarte()
    assert.equal(wyjscia(s.wyslane())[0]?.sc, 20)
  })

  it('najgłębszy punkt zostaje, gdy czytelnik wraca w górę', () => {
    const s = swiat({ okno: dlugaStrona })
    s.rdzen.odslona(ekran('okolica'), '/adres/a')
    s.stan.okno.dno = 2000
    s.rdzen.scroll()
    s.stan.okno.dno = 1200
    s.rdzen.scroll()
    s.ukryjKarte()
    assert.equal(wyjscia(s.wyslane())[0]?.sc, 50)
  })

  it('dokument dociągnięty PO otwarciu odsłony liczy się wg końcowej wysokości', () => {
    const s = swiat({ okno: OKNO_KROTKIE })
    s.rdzen.odslona(ekran('okolica'), '/adres/a')
    s.stan.okno.wysokoscDokumentu = 8000
    s.ukryjKarte()
    assert.equal(wyjscia(s.wyslane())[0]?.sc, 10)
  })

  it('przewinięcie po domknięciu odsłony nie jest raportowane: wyjscie niesie głębokość do chwili domknięcia', () => {
    const s = swiat({ okno: dlugaStrona })
    s.rdzen.odslona(ekran('okolica'), '/adres/a')
    s.stan.okno.dno = 3200
    s.rdzen.scroll()
    s.tyk(2000)
    s.ukryjKarte()
    s.pokazKarte()
    s.stan.okno.dno = 4000 // czytelnik dociera do końca, ale odsłona jest już domknięta
    s.rdzen.scroll()
    s.tyk(2000)
    s.ukryjKarte()
    assert.deepEqual(
      wyjscia(s.wyslane()).map((w) => w.sc),
      [80],
    )
  })

  it('nowa odsłona zaczyna od góry, nie dziedziczy przewinięcia poprzedniej', () => {
    const s = swiat({ okno: dlugaStrona })
    s.rdzen.odslona(ekran('okolica'), '/adres/a')
    s.stan.okno.dno = 3600
    s.rdzen.scroll()
    s.stan.okno.dno = 800 // nowy ekran jest już przewinięty do góry
    s.rdzen.odslona(ekran('okolica'), '/adres/b')
    s.ukryjKarte()
    assert.deepEqual(
      wyjscia(s.wyslane()).map((w) => w.sc),
      [90, 20],
    )
  })
})

describe('rdzen: sekcje i CTA w wyjściu', () => {
  it('sekcje i CTA (od otwarcia odsłony) trafiają do wyjscia', () => {
    const s = swiat()
    s.rdzen.ustawObserwatory(s.obserwatory)
    s.rdzen.odslona(ekran('okolica'), '/adres/a')
    s.tyk(5000)
    s.stanObs.sk = [
      ['etykieta', 3000, 0],
      ['zrodla', 1500, 2],
    ]
    s.stanObs.ct = [['etykieta§porownaj', 1, 1]]
    s.ukryjKarte()
    const w = wyjscia(s.wyslane())[0]
    assert.deepEqual(w?.sk, [
      ['etykieta', 3000, 0],
      ['zrodla', 1500, 2],
    ])
    assert.deepEqual(w?.ct, [['etykieta§porownaj', 1, 1]])
  })

  it('bez sekcji i CTA pola nie występują w zdarzeniu', () => {
    const s = swiat()
    s.rdzen.ustawObserwatory(s.obserwatory)
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.ukryjKarte()
    const w = wyjscia(s.wyslane())[0]
    assert.ok(w && !('sk' in w) && !('ct' in w))
  })

  it('sekcje i CTA zebrane PO domknięciu odsłony nie wychodzą (jedno wyjscie, podłoga)', () => {
    const s = swiat()
    s.rdzen.ustawObserwatory(s.obserwatory)
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.tyk(3000)
    s.stanObs.sk = [['etykieta', 3000, 0]]
    s.ukryjKarte()
    s.pokazKarte()
    s.tyk(100)
    s.stanObs.ct = [['karta§a', 0, 1]] // klik po powrocie na kartę
    s.ukryjKarte()
    const wyj = wyjscia(s.wyslane())
    assert.equal(wyj.length, 1)
    assert.deepEqual(wyj[0]?.sk, [['etykieta', 3000, 0]])
    assert.ok(!('ct' in (wyj[0] ?? {})))
  })

  it('zmiana odsłony zbiera sekcje starej odsłony PRZED zerowaniem dla nowej', () => {
    const s = swiat()
    s.rdzen.ustawObserwatory(s.obserwatory)
    s.rdzen.odslona(ekran('okolica'), '/adres/a')
    s.tyk(1000)
    s.stanObs.sk = [['mapa', 800, 3]]
    s.rdzen.odslona(ekran('porownanie'), '/porownanie')
    const kolejnosc = s.stanObs.wywolania
    assert.ok(kolejnosc.indexOf('zbierz') < kolejnosc.lastIndexOf('nowyWidok'))
    assert.deepEqual(wyjscia(s.wyslane())[0]?.sk, [['mapa', 800, 3]])
  })
})

describe('rdzen: zdarzenia produktowe', () => {
  function otwarty() {
    const s = swiat()
    s.rdzen.odslona(ekran('okolica'), '/adres/a')
    return s
  }
  const produktowe = (s: ReturnType<typeof swiat>) => {
    s.splukaj()
    return s.wyslane().filter((z) => z.t === 'produktowe')
  }

  it('niesie ekran i ścieżkę bieżącej odsłony', () => {
    const s = otwarty()
    s.rdzen.produktowe('karta_adresu')
    assert.deepEqual(produktowe(s), [
      { t: 'produktowe', e: 'okolica', s: '/adres/a', u: 'desktop', n: 'karta_adresu' },
    ])
  })

  it('zdarzenie bez odsłony jest ignorowane', () => {
    const s = swiat()
    s.rdzen.produktowe('karta_adresu')
    s.splukaj()
    assert.deepEqual(s.wyslane(), [])
  })

  it('nieznana nazwa jest ignorowana', () => {
    const s = otwarty()
    s.rdzen.produktowe('cos_nowego' as never)
    assert.deepEqual(produktowe(s), [])
  })

  it('wyszukanie: tylko wynikow i rodzaj z poprawnymi wartościami, reszta ginie', () => {
    const s = otwarty()
    s.rdzen.produktowe('wyszukanie', {
      wynikow: 3.7,
      rodzaj: 'ulica',
      uzytkownik: 'jan',
      haslo: 'x',
    })
    assert.deepEqual((produktowe(s)[0] as { w?: unknown }).w, { wynikow: 4, rodzaj: 'ulica' })
  })

  it('wyszukanie: błędny rodzaj i niepoliczalna liczba giną, zdarzenie zostaje', () => {
    const s = otwarty()
    s.rdzen.produktowe('wyszukanie', { wynikow: Number.NaN, rodzaj: 'miasto' })
    const z = produktowe(s)[0] as { n: string; w?: unknown }
    assert.equal(z.n, 'wyszukanie')
    assert.equal(z.w, undefined)
  })

  it('nazwy bez właściwości odrzucają wszystkie przekazane', () => {
    const s = otwarty()
    s.rdzen.produktowe('karta_adresu', { adres: 'ul. Długa 5', telefon: '600700800' })
    assert.equal((produktowe(s)[0] as { w?: unknown }).w, undefined)
  })

  it('warstwa_mapy: tylko poprawny identyfikator warstwy', () => {
    const s = otwarty()
    s.rdzen.produktowe('warstwa_mapy', { warstwa: 'halas_ldwn' })
    s.tyk(OKNO_POWTORKI_MS)
    s.rdzen.produktowe('warstwa_mapy', { warstwa: 'Zła Warstwa!' })
    s.tyk(OKNO_POWTORKI_MS)
    s.rdzen.produktowe('warstwa_mapy', { warstwa: 'a'.repeat(100) })
    assert.deepEqual(
      produktowe(s).map((z) => (z as { w?: unknown }).w),
      [{ warstwa: 'halas_ldwn' }, undefined, undefined],
    )
  })

  describe('wyszukanie_bez_wyniku: fraza i dane osobowe', () => {
    const wlasciwosci = (s: ReturnType<typeof swiat>) =>
      produktowe(s).map((z) => (z as { w?: unknown }).w)

    it('fraza jest normalizowana przed wysłaniem', () => {
      const s = otwarty()
      s.rdzen.produktowe('wyszukanie_bez_wyniku', { fraza: '  UL.   Zażółć 5 ' })
      assert.deepEqual(wlasciwosci(s), [{ fraza: 'ul. zażółć 5' }])
    })

    it('wynik normalizujFraze({ odrzucono: true }) → znacznik zamiast frazy', () => {
      const s = otwarty()
      s.rdzen.produktowe('wyszukanie_bez_wyniku', { odrzucono: true })
      assert.deepEqual(wlasciwosci(s), [{ fraza: '[odrzucono]', odrzucono: true }])
    })

    it('surowa fraza z e-mailem lub telefonem NIGDY nie wychodzi, nawet gdy wołający pominął filtr', () => {
      const s = otwarty()
      s.rdzen.produktowe('wyszukanie_bez_wyniku', { fraza: 'jan.kowalski@example.com' })
      s.tyk(OKNO_POWTORKI_MS)
      s.rdzen.produktowe('wyszukanie_bez_wyniku', { fraza: 'zadzwoń 600 700 800' })
      s.splukaj()
      const json = JSON.stringify(s.wyslane())
      assert.ok(!json.includes('kowalski'))
      assert.ok(!json.includes('600 700'))
      assert.deepEqual(wlasciwosci(s), [
        { fraza: '[odrzucono]', odrzucono: true },
        { fraza: '[odrzucono]', odrzucono: true },
      ])
    })

    it('brak frazy to znacznik odrzucenia, nie puste zdarzenie', () => {
      const s = otwarty()
      s.rdzen.produktowe('wyszukanie_bez_wyniku')
      assert.deepEqual(wlasciwosci(s), [{ fraza: '[odrzucono]', odrzucono: true }])
    })
  })

  it('udostepnij: element ≤ 60 znaków i kanał z listy', () => {
    const s = otwarty()
    s.rdzen.produktowe('udostepnij', { element: 'przycisk-karty', kanal: 'kopia', cos: 1 })
    s.tyk(OKNO_POWTORKI_MS)
    s.rdzen.produktowe('udostepnij', { element: 'x'.repeat(200), kanal: 'faks' })
    const w = produktowe(s).map((z) => (z as { w?: Record<string, unknown> }).w)
    assert.deepEqual(w[0], { element: 'przycisk-karty', kanal: 'kopia' })
    assert.equal((w[1]?.element as string).length, 60)
    assert.equal(w[1]?.kanal, undefined)
  })

  it('powtórka w krótkim oknie jest pomijana (podwójne wywołanie), po oknie przechodzi', () => {
    const s = otwarty()
    s.rdzen.produktowe('tryb_biznes')
    s.rdzen.produktowe('tryb_biznes')
    s.tyk(OKNO_POWTORKI_MS - 1)
    s.rdzen.produktowe('tryb_biznes')
    s.tyk(OKNO_POWTORKI_MS)
    s.rdzen.produktowe('tryb_biznes')
    assert.equal(produktowe(s).length, 2)
  })

  it('okno powtórki liczone od ostatniego PRZYJĘTEGO zdarzenia, nie od odrzuconej powtórki', () => {
    const s = otwarty()
    s.rdzen.produktowe('porownanie_dodaj') // przyjęte w t = 0
    s.tyk(OKNO_POWTORKI_MS * 0.75)
    s.rdzen.produktowe('porownanie_dodaj') // powtórka (0,75 okna od przyjętego)
    s.tyk(OKNO_POWTORKI_MS * 0.5)
    s.rdzen.produktowe('porownanie_dodaj') // 1,25 okna od przyjętego → przyjęte
    assert.equal(produktowe(s).length, 2)
  })

  it('różne właściwości to nie powtórka', () => {
    const s = otwarty()
    s.rdzen.produktowe('warstwa_mapy', { warstwa: 'a' })
    s.rdzen.produktowe('warstwa_mapy', { warstwa: 'b' })
    assert.equal(produktowe(s).length, 2)
  })

  it('pomiar_wylaczony wychodzi OD RAZU, a po wyłączeniu nic więcej nie wychodzi', () => {
    const s = otwarty()
    s.rdzen.produktowe('pomiar_wylaczony')
    // Bez splukaj(): zdarzenie musi już być w sieci, zanim wybór zostanie zapisany.
    const wyslaneOdRazu = s.wyslane().filter((z) => z.t === 'produktowe')
    assert.equal(wyslaneOdRazu.length, 1)
    s.stan.wylaczony = true
    s.rdzen.produktowe('karta_adresu')
    s.rdzen.odslona(ekran('metoda'), '/metoda')
    s.ukryjKarte()
    assert.deepEqual(typy(s.wyslane()), ['odslona', 'produktowe'])
  })
})

describe('rdzen: udostępnienie, klik, błąd', () => {
  function otwarty() {
    const s = swiat()
    s.rdzen.odslona(ekran('okolica'), '/adres/a')
    return s
  }

  it('udostepnienie: element i kanał', () => {
    const s = otwarty()
    s.rdzen.udostepnienie('przycisk-karty', 'natywne')
    s.splukaj()
    assert.deepEqual(s.wyslane().at(-1), {
      t: 'udostepnienie',
      e: 'okolica',
      s: '/adres/a',
      u: 'desktop',
      et: 'przycisk-karty',
      ku: 'natywne',
    })
  })

  it('udostepnienie: nieznany kanał i pusty element są ignorowane, element ≤ 60 znaków', () => {
    const s = otwarty()
    s.rdzen.udostepnienie('x', 'faks' as never)
    s.rdzen.udostepnienie('   ', 'link')
    s.rdzen.udostepnienie('y'.repeat(200), 'link')
    s.splukaj()
    const u = s.wyslane().filter((z) => z.t === 'udostepnienie')
    assert.equal(u.length, 1)
    assert.equal((u[0] as { et: string }).et.length, 60)
  })

  it('klik: etykieta sekcja§rodzaj§cel', () => {
    const s = otwarty()
    s.rdzen.klik('karta', 'furia', 'porownaj')
    s.splukaj()
    assert.equal((s.wyslane().at(-1) as { et?: string }).et, 'karta§furia§porownaj')
  })

  it('klik: separator w członach nie psuje rozbicia, nieznany rodzaj odpada', () => {
    const s = otwarty()
    s.rdzen.klik('ka§rta', 'martwy', 'di§v')
    s.rdzen.klik('karta', 'nieznany' as never, 'x')
    s.splukaj()
    const k = s.wyslane().filter((z) => z.t === 'klik')
    assert.deepEqual(
      k.map((z) => (z as { et: string }).et),
      ['ka-rta§martwy§di-v'],
    )
  })

  it('klik: limit sygnałów na odsłonę, nowa odsłona zeruje licznik', () => {
    const s = otwarty()
    for (let i = 0; i < MAX_SYGNALOW_NA_ODSLONE + 5; i++) s.rdzen.klik(`s${i}`, 'martwy', 'div')
    s.rdzen.odslona(ekran('metoda'), '/metoda')
    s.rdzen.klik('nowa', 'martwy', 'div')
    s.splukaj()
    const k = s.wyslane().filter((z) => z.t === 'klik')
    assert.equal(k.length, MAX_SYGNALOW_NA_ODSLONE + 1)
  })

  it('klik: ta sama etykieta w krótkim oknie to powtórka', () => {
    const s = otwarty()
    s.rdzen.klik('karta', 'martwy', 'div')
    s.rdzen.klik('karta', 'martwy', 'div')
    s.splukaj()
    assert.equal(s.wyslane().filter((z) => z.t === 'klik').length, 1)
  })

  it('blad: najwyżej 5 na odsłonę, powtórzony komunikat nie zużywa limitu', () => {
    const s = otwarty()
    for (let i = 0; i < 20; i++) s.rdzen.blad('ten sam błąd')
    for (let i = 0; i < MAX_BLEDOW_NA_ODSLONE + 5; i++) s.rdzen.blad(`inny błąd ${i}`)
    s.splukaj()
    const bledy = s.wyslane().filter((z) => z.t === 'blad')
    assert.equal(bledy.length, MAX_BLEDOW_NA_ODSLONE)
    assert.equal(bledy.filter((z) => (z as { k: string }).k === 'ten sam błąd').length, 1)
  })

  it('blad: nowa odsłona zeruje limit, komunikat przycięty do 200 znaków', () => {
    const s = otwarty()
    for (let i = 0; i < 10; i++) s.rdzen.blad(`b${i}`)
    s.rdzen.odslona(ekran('metoda'), '/metoda')
    s.rdzen.blad('z'.repeat(500))
    s.splukaj()
    const bledy = s.wyslane().filter((z) => z.t === 'blad') as { k: string }[]
    assert.equal(bledy.length, MAX_BLEDOW_NA_ODSLONE + 1)
    assert.equal(bledy.at(-1)?.k.length, 200)
  })
})

describe('rdzen: Web Vitals', () => {
  it('przy pierwszym ukryciu karty wital jedzie TĄ SAMĄ paczką co wyjscie, w ekranie wejścia', () => {
    const s = swiat()
    s.rdzen.ustawObserwatory(s.obserwatory)
    s.rdzen.odslona(ekran('okolica'), '/adres/wejsciowy')
    s.tyk(1000)
    s.rdzen.odslona(ekran('porownanie'), '/porownanie')
    s.tyk(2000)
    s.stanObs.witale = [
      { n: 'lcp', v: 2100 },
      { n: 'cls', v: 0.0123 },
    ]
    s.ukryjKarte()
    const ostatniaPaczka = s.zadania.at(-1) ?? []
    assert.deepEqual(typy(ostatniaPaczka), ['odslona', 'wyjscie', 'wital', 'wital'])
    const witale = ostatniaPaczka.filter((z) => z.t === 'wital')
    assert.deepEqual(witale, [
      { t: 'wital', e: 'okolica', s: '/adres/wejsciowy', u: 'desktop', n: 'lcp', v: 2100 },
      { t: 'wital', e: 'okolica', s: '/adres/wejsciowy', u: 'desktop', n: 'cls', v: 0.0123 },
    ])
  })

  it('drugie ukrycie nie powtarza witali (obserwatory oddają każdą metrykę raz)', () => {
    const s = swiat()
    s.rdzen.ustawObserwatory(s.obserwatory)
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.stanObs.witale = [{ n: 'fcp', v: 900 }]
    s.tyk(2000)
    s.ukryjKarte()
    s.pokazKarte()
    s.tyk(3000)
    s.ukryjKarte()
    assert.equal(s.wyslane().filter((z) => z.t === 'wital').length, 1)
  })

  it('bez obserwatorów (jeszcze nie załadowane) ukrycie wysyła samo wyjscie', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.ukryjKarte()
    assert.deepEqual(typy(s.wyslane()), ['odslona', 'wyjscie'])
  })
})

describe('rdzen: sprzeciw (pomiar wyłączony)', () => {
  it('wyłączony od początku: żadne zdarzenie nie wychodzi', () => {
    const s = swiat()
    s.stan.wylaczony = true
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.rdzen.produktowe('karta_adresu')
    s.rdzen.udostepnienie('x', 'link')
    s.rdzen.blad('b')
    s.rdzen.klik('s', 'martwy', 'div')
    s.tyk(10_000)
    s.ukryjKarte()
    assert.deepEqual(s.wyslane(), [])
  })

  it('wyłączenie w trakcie odsłony: wyjscie i reszta już nie wychodzą, bufor czyszczony', () => {
    const s = swiat()
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.tyk(1000)
    s.stan.wylaczony = true
    s.tyk(10_000)
    s.ukryjKarte()
    assert.deepEqual(s.wyslane(), [])
    assert.equal(s.kolejka.rozmiar(), 0)
  })

  it('po ponownym włączeniu pomiar rusza od następnej odsłony', () => {
    const s = swiat()
    s.stan.wylaczony = true
    s.rdzen.odslona(ekran('szukaj'), '/')
    s.stan.wylaczony = false
    s.rdzen.produktowe('karta_adresu')
    s.rdzen.odslona(ekran('metoda'), '/metoda')
    s.splukaj()
    assert.deepEqual(typy(s.wyslane()), ['odslona'])
    assert.equal(s.wyslane()[0]?.e, 'metoda')
  })
})

describe('rdzen: niezmienniki prywatności zdarzeń', () => {
  it('żadne zdarzenie nie ma pól spoza kontraktu ani wartości z adresu/UA', () => {
    const s = swiat({ wejscie: { rh: 'google.com', us: 'a', um: 'b', uc: 'c', ci: 'gclid' } })
    s.rdzen.ustawObserwatory(s.obserwatory)
    s.rdzen.odslona(ekran('okolica'), '/adres/a?token=SEKRET#tajne')
    s.rdzen.produktowe('wyszukanie', { wynikow: 2, rodzaj: 'adres', token: 'SEKRET' })
    s.rdzen.produktowe('wyszukanie_bez_wyniku', { fraza: 'jan@example.com' })
    s.rdzen.udostepnienie('przycisk', 'link')
    s.rdzen.klik('karta', 'martwy', 'div')
    s.rdzen.blad('błąd')
    s.stanObs.witale = [{ n: 'lcp', v: 1500 }]
    s.tyk(3000)
    s.ukryjKarte()
    const json = JSON.stringify(s.wyslane())
    assert.ok(!json.includes('SEKRET'))
    assert.ok(!json.includes('tajne'))
    assert.ok(!json.includes('jan@example.com'))
    const dozwolone = new Set([
      't',
      'e',
      's',
      'u',
      'rh',
      'rs',
      'us',
      'um',
      'uc',
      'ci',
      'ms',
      'sc',
      'sk',
      'ct',
      'et',
      'ku',
      'n',
      'w',
      'v',
      'k',
    ])
    for (const z of s.wyslane()) {
      for (const klucz of Object.keys(z))
        assert.ok(dozwolone.has(klucz), `pole spoza kontraktu: ${klucz}`)
    }
  })
})
