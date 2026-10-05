// Sprzeciw i GPC: jakie klucze padają w magazynie, odporność na tryb prywatny, subskrypcja.
// Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

// Moduł trzyma stan w zmiennych (pamięć wyboru, subskrybenci), więc każdy test ładuje go na nowo:
// różny parametr w adresie to dla ESM osobna instancja.
let licznik = 0
async function swiezy(): Promise<typeof import('./zgoda.ts')> {
  return await import(`./zgoda.ts?proba=${++licznik}`)
}

interface Atrapa {
  dane: Map<string, string>
  zapisy: string[]
  usuniete: string[]
  magazyn: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

function atrapaMagazynu(opcje: { rzucaOdczyt?: boolean; rzucaZapis?: boolean } = {}): Atrapa {
  const dane = new Map<string, string>()
  const zapisy: string[] = []
  const usuniete: string[] = []
  return {
    dane,
    zapisy,
    usuniete,
    magazyn: {
      getItem(klucz) {
        if (opcje.rzucaOdczyt) throw new Error('SecurityError')
        return dane.get(klucz) ?? null
      },
      setItem(klucz, wartosc) {
        if (opcje.rzucaZapis) throw new Error('QuotaExceededError')
        zapisy.push(klucz)
        dane.set(klucz, wartosc)
      },
      removeItem(klucz) {
        if (opcje.rzucaZapis) throw new Error('QuotaExceededError')
        usuniete.push(klucz)
        dane.delete(klucz)
      },
    },
  }
}

const oryginalyGlobali = new Map<string, PropertyDescriptor | undefined>()

function podmien(nazwa: string, wartosc: unknown) {
  if (!oryginalyGlobali.has(nazwa)) {
    oryginalyGlobali.set(nazwa, Object.getOwnPropertyDescriptor(globalThis, nazwa))
  }
  Object.defineProperty(globalThis, nazwa, { value: wartosc, configurable: true, writable: true })
}

afterEach(() => {
  for (const [nazwa, opis] of oryginalyGlobali) {
    if (opis) Object.defineProperty(globalThis, nazwa, opis)
    else delete (globalThis as Record<string, unknown>)[nazwa]
  }
  oryginalyGlobali.clear()
})

describe('pomiarWylaczony / ustawPomiar', () => {
  it('domyślnie pomiar jest włączony i nic nie ląduje w magazynie', async () => {
    const a = atrapaMagazynu()
    podmien('localStorage', a.magazyn)
    podmien('navigator', {})
    const zgoda = await swiezy()
    assert.equal(zgoda.pomiarWylaczony(), false)
    assert.deepEqual(a.zapisy, [])
    assert.deepEqual([...a.dane.keys()], [])
  })

  it('wyłączenie zapisuje dokładnie jeden klucz: pomiar-wylaczony', async () => {
    const a = atrapaMagazynu()
    podmien('localStorage', a.magazyn)
    podmien('navigator', {})
    const zgoda = await swiezy()
    zgoda.ustawPomiar(false)
    assert.equal(zgoda.pomiarWylaczony(), true)
    assert.deepEqual(a.zapisy, ['pomiar-wylaczony'])
    assert.deepEqual([...a.dane.entries()], [['pomiar-wylaczony', '1']])
  })

  it('włączenie USUWA klucz i niczego nie zapisuje', async () => {
    const a = atrapaMagazynu()
    podmien('localStorage', a.magazyn)
    podmien('navigator', {})
    const zgoda = await swiezy()
    zgoda.ustawPomiar(false)
    a.zapisy.length = 0
    zgoda.ustawPomiar(true)
    assert.equal(zgoda.pomiarWylaczony(), false)
    assert.deepEqual(a.zapisy, [])
    assert.deepEqual(a.usuniete, ['pomiar-wylaczony'])
    assert.equal(a.dane.size, 0)
  })

  it('wybór przetrwa przeładowanie strony (nowa instancja modułu, ten sam magazyn)', async () => {
    const a = atrapaMagazynu()
    podmien('localStorage', a.magazyn)
    podmien('navigator', {})
    const przed = await swiezy()
    przed.ustawPomiar(false)
    const po = await swiezy()
    assert.equal(po.pomiarWylaczony(), true)
  })

  it('sygnał Global Privacy Control wyłącza pomiar bez żadnego zapisu', async () => {
    const a = atrapaMagazynu()
    podmien('localStorage', a.magazyn)
    podmien('navigator', { globalPrivacyControl: true })
    const zgoda = await swiezy()
    assert.equal(zgoda.pomiarWylaczony(), true)
    assert.equal(zgoda.wylaczonyPrzezGpc(), true)
    zgoda.ustawPomiar(true)
    assert.equal(zgoda.pomiarWylaczony(), true, 'przełącznik nie przebija sygnału przeglądarki')
    assert.deepEqual(a.zapisy, [])
  })

  it('GPC równe false albo nieobecne nie wyłącza pomiaru', async () => {
    podmien('localStorage', atrapaMagazynu().magazyn)
    podmien('navigator', { globalPrivacyControl: false })
    assert.equal((await swiezy()).pomiarWylaczony(), false)
    podmien('navigator', { globalPrivacyControl: 'true' })
    assert.equal((await swiezy()).pomiarWylaczony(), false, 'tylko prawdziwe true')
  })
})

describe('zgoda: tryb prywatny i brak magazynu', () => {
  it('odczyt rzuca wyjątek: pomiar włączony, wyjątek nie wychodzi', async () => {
    podmien('localStorage', atrapaMagazynu({ rzucaOdczyt: true }).magazyn)
    podmien('navigator', {})
    const zgoda = await swiezy()
    assert.equal(zgoda.pomiarWylaczony(), false)
  })

  it('zapis rzuca wyjątek: sprzeciw działa do końca życia strony', async () => {
    podmien('localStorage', atrapaMagazynu({ rzucaZapis: true }).magazyn)
    podmien('navigator', {})
    const zgoda = await swiezy()
    assert.doesNotThrow(() => zgoda.ustawPomiar(false))
    assert.equal(zgoda.pomiarWylaczony(), true)
    assert.doesNotThrow(() => zgoda.ustawPomiar(true))
    assert.equal(zgoda.pomiarWylaczony(), false)
  })

  it('brak localStorage w ogóle (inne środowisko): bez wyjątków', async () => {
    podmien('localStorage', undefined)
    podmien('navigator', undefined)
    const zgoda = await swiezy()
    assert.equal(zgoda.pomiarWylaczony(), false)
    assert.doesNotThrow(() => zgoda.ustawPomiar(false))
    assert.equal(zgoda.pomiarWylaczony(), true)
  })

  it('po udanym zapisie magazyn znów jest źródłem prawdy (zmiana z innej karty)', async () => {
    const a = atrapaMagazynu()
    podmien('localStorage', a.magazyn)
    podmien('navigator', {})
    const zgoda = await swiezy()
    zgoda.ustawPomiar(false)
    a.dane.delete('pomiar-wylaczony') // inna karta włączyła pomiar
    assert.equal(zgoda.pomiarWylaczony(), false)
  })
})

describe('subskrybujZgode', () => {
  it('powiadamia o zmianie wyboru i przestaje po odsubskrybowaniu', async () => {
    podmien('localStorage', atrapaMagazynu().magazyn)
    podmien('navigator', {})
    const zgoda = await swiezy()
    let wywolania = 0
    const koniec = zgoda.subskrybujZgode(() => {
      wywolania++
    })
    zgoda.ustawPomiar(false)
    zgoda.ustawPomiar(true)
    assert.equal(wywolania, 2)
    koniec()
    zgoda.ustawPomiar(false)
    assert.equal(wywolania, 2)
  })

  it('snapshot jest stabilnym prymitywem (gotowy do useSyncExternalStore)', async () => {
    podmien('localStorage', atrapaMagazynu().magazyn)
    podmien('navigator', {})
    const zgoda = await swiezy()
    assert.equal(zgoda.pomiarWylaczony(), zgoda.pomiarWylaczony())
    assert.equal(typeof zgoda.pomiarWylaczony(), 'boolean')
  })
})
