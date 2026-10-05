// Transport: beacon, awaryjny fetch, tłumienie błędów. Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ADRES_ENDPOINTU, utworzTransport } from './transport.ts'

const CIALO = '{"z":[{"t":"blad","e":"szukaj","s":"/","u":"desktop","k":"x"}]}'

describe('transport', () => {
  it('beacon: Blob text/plain pod właściwy adres, bez fetch', async () => {
    const beacony: { adres: string; dane: Blob }[] = []
    let fetche = 0
    const wyslij = utworzTransport({
      beacon: (adres, dane) => {
        beacony.push({ adres, dane })
        return true
      },
      zadanie: () => {
        fetche++
        return Promise.resolve()
      },
    })
    wyslij(CIALO)
    assert.equal(beacony.length, 1)
    assert.equal(beacony[0]?.adres, ADRES_ENDPOINTU)
    // Konstruktor Blob zapisuje typ małymi literami.
    assert.equal(beacony[0]?.dane.type, 'text/plain;charset=utf-8')
    assert.equal(await beacony[0]?.dane.text(), CIALO)
    assert.equal(fetche, 0)
  })

  it('beacon odmówił (false): fetch z keepalive, POST, bez ciasteczek', () => {
    let opcje: RequestInit | undefined
    let adres = ''
    const wyslij = utworzTransport({
      beacon: () => false,
      zadanie: (a, o) => {
        adres = a
        opcje = o
        return Promise.resolve()
      },
    })
    wyslij(CIALO)
    assert.equal(adres, ADRES_ENDPOINTU)
    assert.equal(opcje?.method, 'POST')
    assert.equal(opcje?.keepalive, true)
    assert.equal(opcje?.credentials, 'omit')
    assert.equal(opcje?.body, CIALO)
  })

  it('beacon rzuca wyjątek: fetch przejmuje', () => {
    let fetche = 0
    const wyslij = utworzTransport({
      beacon: () => {
        throw new Error('TypeError')
      },
      zadanie: () => {
        fetche++
        return Promise.resolve()
      },
    })
    assert.doesNotThrow(() => wyslij(CIALO))
    assert.equal(fetche, 1)
  })

  it('brak beacona: od razu fetch', () => {
    let fetche = 0
    const wyslij = utworzTransport({
      zadanie: () => {
        fetche++
        return Promise.resolve()
      },
    })
    wyslij(CIALO)
    assert.equal(fetche, 1)
  })

  it('fetch odrzuca obietnicę: błąd tłumiony, bez nieobsłużonego odrzucenia', async () => {
    const nieobsluzone: unknown[] = []
    const nasluch = (powod: unknown) => nieobsluzone.push(powod)
    process.on('unhandledRejection', nasluch)
    try {
      const wyslij = utworzTransport({
        zadanie: () => Promise.reject(new Error('Failed to fetch')),
      })
      wyslij(CIALO)
      await new Promise((r) => setTimeout(r, 20))
      assert.deepEqual(nieobsluzone, [])
    } finally {
      process.off('unhandledRejection', nasluch)
    }
  })

  it('fetch rzuca synchronicznie: nic nie wychodzi na zewnątrz', () => {
    const wyslij = utworzTransport({
      zadanie: () => {
        throw new Error('sync')
      },
    })
    assert.doesNotThrow(() => wyslij(CIALO))
  })

  it('ani beacona, ani fetch: cisza', () => {
    assert.doesNotThrow(() => utworzTransport({})(CIALO))
  })
})
