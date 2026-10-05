// Przełącznik „Pomiar ruchu”: kolejność działań przy wyłączeniu i włączeniu (T064).
// Uruchom: node --test src/strony/
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { utworzKolejke } from '../pomiar/kolejka.ts'
import type { Paczka } from '../pomiar/kontrakt.ts'
import { utworzRdzen } from '../pomiar/rdzen.ts'
import { przelaczPomiar } from './przelacznikPomiaru.ts'

describe('przelaczPomiar: kolejność działań (atrapy)', () => {
  function atrapy() {
    const log: string[] = []
    return {
      log,
      akcje: {
        produktowe: (nazwa: string) => void log.push(`zdarzenie:${nazwa}`),
        ustawPomiar: (wlaczony: boolean) => void log.push(`zapis:${wlaczony}`),
      },
    }
  }

  it('wyłączenie: najpierw zdarzenie, potem zapis wyboru', () => {
    const a = atrapy()
    przelaczPomiar(false, false, a.akcje)
    assert.deepEqual(a.log, ['zdarzenie:pomiar_wylaczony', 'zapis:false'])
  })

  it('włączenie: tylko zapis wyboru, bez żadnego zdarzenia', () => {
    const a = atrapy()
    przelaczPomiar(true, false, a.akcje)
    assert.deepEqual(a.log, ['zapis:true'])
  })

  it('sygnał Global Privacy Control: przełącznik niczego nie zmienia, w żadnym stanie', () => {
    for (const wylaczony of [true, false]) {
      const a = atrapy()
      przelaczPomiar(wylaczony, true, a.akcje)
      assert.deepEqual(a.log, [])
    }
  })
})

describe('przelaczPomiar: z prawdziwą zgodą, kolejką i rdzeniem pomiaru', () => {
  // Moduł zgody trzyma stan w zmiennych, więc każdy test ładuje go na nowo (inny parametr adresu).
  let licznik = 0
  async function swiezaZgoda(): Promise<typeof import('../pomiar/zgoda.ts')> {
    return await import(`../pomiar/zgoda.ts?proba=${++licznik}`)
  }

  const oryginaly = new Map<string, PropertyDescriptor | undefined>()
  function podmien(nazwa: string, wartosc: unknown) {
    if (!oryginaly.has(nazwa)) {
      oryginaly.set(nazwa, Object.getOwnPropertyDescriptor(globalThis, nazwa))
    }
    Object.defineProperty(globalThis, nazwa, { value: wartosc, configurable: true, writable: true })
  }
  afterEach(() => {
    for (const [nazwa, opis] of oryginaly) {
      if (opis) Object.defineProperty(globalThis, nazwa, opis)
      else delete (globalThis as Record<string, unknown>)[nazwa]
    }
    oryginaly.clear()
  })

  /** Pomiar na atrapie magazynu i transportu, ze wspólnym dziennikiem zdarzeń „wysłano” i „zapis”. */
  async function swiat(opcje: { gpc?: boolean } = {}) {
    const dane = new Map<string, string>()
    const log: string[] = []
    podmien('localStorage', {
      getItem: (klucz: string) => dane.get(klucz) ?? null,
      setItem: (klucz: string, wartosc: string) => {
        log.push(`zapis:${klucz}`)
        dane.set(klucz, wartosc)
      },
      removeItem: (klucz: string) => void dane.delete(klucz),
    })
    podmien('navigator', opcje.gpc ? { globalPrivacyControl: true } : {})
    const zgoda = await swiezaZgoda()
    const paczki: Paczka[] = []
    const kolejka = utworzKolejke({
      wyslij: (cialo) => {
        log.push('wysłano')
        paczki.push(JSON.parse(cialo) as Paczka)
      },
      wylaczony: zgoda.pomiarWylaczony,
      // Zegar bezczynności nigdy nie wybija: wysyłka musi dojść bez czekania na 5 sekund.
      zegar: { ustaw: () => 0, wyczysc: () => {} },
    })
    let t = 0
    const rdzen = utworzRdzen({
      kolejka,
      teraz: () => (t += 1000),
      widoczna: () => true,
      okno: () => ({ dno: 800, wysokoscDokumentu: 800, wysokoscOkna: 800 }),
      dno: () => 800,
      wylaczony: zgoda.pomiarWylaczony,
      urzadzenie: 'desktop',
      wejscie: {},
      wlasnyHost: 'adresscore.pl',
    })
    const przelacz = () =>
      przelaczPomiar(zgoda.pomiarWylaczony(), zgoda.wylaczonyPrzezGpc(), {
        produktowe: (nazwa) => rdzen.produktowe(nazwa),
        ustawPomiar: (wlaczony) => zgoda.ustawPomiar(wlaczony),
      })
    return { dane, log, paczki, kolejka, rdzen, zgoda, przelacz }
  }

  it('wyłączenie: zdarzenie wychodzi od razu, PRZED zapisem wyboru, razem z buforem', async () => {
    const s = await swiat()
    s.rdzen.odslona('metoda', '/metoda')
    assert.equal(s.paczki.length, 0, 'odsłona czeka w buforze na bezczynność')

    s.przelacz()

    assert.deepEqual(s.log, ['wysłano', 'zapis:pomiar-wylaczony'])
    assert.equal(s.paczki.length, 1)
    const zdarzenia = s.paczki[0]?.z ?? []
    assert.deepEqual(
      zdarzenia.map((z) => z.t),
      ['odslona', 'produktowe'],
    )
    const ostatnie = zdarzenia[1]
    assert.ok(ostatnie?.t === 'produktowe' && ostatnie.n === 'pomiar_wylaczony')
    assert.equal(s.zgoda.pomiarWylaczony(), true)
    assert.equal(s.dane.get('pomiar-wylaczony'), '1')
  })

  it('po wyłączeniu nic więcej nie wychodzi, a włączenie niczego nie wysyła', async () => {
    const s = await swiat()
    s.rdzen.odslona('metoda', '/metoda')
    s.przelacz()
    assert.equal(s.paczki.length, 1)

    s.rdzen.produktowe('karta_adresu')
    s.rdzen.udostepnienie('karta-adresu', 'kopia')
    s.rdzen.ukryj()
    assert.equal(s.paczki.length, 1, 'po sprzeciwie nic nie wychodzi')
    assert.equal(s.kolejka.rozmiar(), 0)

    s.przelacz() // włączenie
    assert.equal(s.zgoda.pomiarWylaczony(), false)
    assert.equal(s.dane.has('pomiar-wylaczony'), false, 'włączenie usuwa klucz z magazynu')
    assert.equal(s.paczki.length, 1, 'włączenie niczego nie wysyła')
  })

  it('Global Privacy Control: przełącznik nie wysyła ani nie zapisuje niczego', async () => {
    const s = await swiat({ gpc: true })
    s.rdzen.odslona('metoda', '/metoda')
    assert.equal(s.zgoda.pomiarWylaczony(), true)
    s.przelacz()
    assert.deepEqual(s.log, [])
    assert.equal(s.paczki.length, 0)
    assert.equal(s.dane.size, 0)
  })
})
