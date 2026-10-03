// Uruchom: node --test src/ai/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ADRES_POSREDNIKA,
  type OdpowiedzJev,
  ocena,
  takNie,
  wybor,
  type ZapytanieJev,
  zapytajJev,
  zJevem,
} from './jev.ts'

const ZAPYTANIE: ZapytanieJev = {
  stan: 'Szukam cichego mieszkania dla rodziny',
  pytania: {
    profil: wybor('Kto szuka?', { rodzina: 'Rodzina z dziećmi', senior: 'Senior' }),
    dzieci: takNie('Czy osoba ma dzieci?'),
    cisza: ocena('Jak ważna jest cisza?', ['Nieważna', 'Ważna', 'Bardzo ważna']),
  },
}

function zbudujFetch(status: number, json: unknown) {
  const wywolania: { url: string; init: RequestInit | undefined }[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    wywolania.push({ url: String(url), init })
    return { ok: status >= 200 && status < 300, status, json: async () => json } as Response
  }) as typeof fetch
  return { fetchImpl, wywolania }
}

const fetchWiszacy = (async (_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_ok, blad) => {
    init?.signal?.addEventListener('abort', () => blad(new DOMException('Aborted', 'AbortError')))
  })) as typeof fetch

const ODPOWIEDZI: Record<string, OdpowiedzJev | null> = {
  profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 0.9 },
  dzieci: { typ: 'noul', noul: 0.93 },
  cisza: null,
}

describe('zapytajJev – prawdopodobieństwa opcji (#154)', () => {
  it('rozkład z pośrednika dochodzi do wołającego bez zmian', async () => {
    const zRozkladem: Record<string, OdpowiedzJev | null> = {
      profil: {
        typ: 'choice',
        wybor: 'rodzina',
        pewnosc: 0.9,
        prawdopodobienstwa: { rodzina: 0.9, senior: 0.1 },
      },
      dzieci: { typ: 'noul', noul: 0.93 },
      cisza: { typ: 'score', ocena: 1.1, pewnosc: 0.8, prawdopodobienstwa: { 1: 0.9, 2: 0.1 } },
    }
    const { fetchImpl } = zbudujFetch(200, { odpowiedzi: zRozkladem, powod: null })
    const w = await zapytajJev(ZAPYTANIE, { fetch: fetchImpl })
    assert.deepEqual(w, { odpowiedzi: zRozkladem, powod: null })
  })

  it('bez rozkładu pole jest nieobecne, a zachowanie to samo', async () => {
    const { fetchImpl } = zbudujFetch(200, { odpowiedzi: ODPOWIEDZI, powod: null })
    const w = await zapytajJev(ZAPYTANIE, { fetch: fetchImpl })
    const profil = w.odpowiedzi?.profil
    assert.ok(profil && profil.typ === 'choice')
    assert.equal(Object.hasOwn(profil, 'prawdopodobienstwa'), false)
    assert.equal(profil.wybor, 'rodzina')
  })
})

describe('zapytajJev', () => {
  it('POST na pośrednika z kontraktem, bez żadnego klucza w żądaniu', async () => {
    const { fetchImpl, wywolania } = zbudujFetch(200, { odpowiedzi: ODPOWIEDZI, powod: null })
    const w = await zapytajJev(ZAPYTANIE, { fetch: fetchImpl })
    assert.deepEqual(w, { odpowiedzi: ODPOWIEDZI, powod: null })
    const [wyw] = wywolania
    assert.equal(wyw?.url, ADRES_POSREDNIKA)
    assert.equal(wyw?.init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(wyw?.init?.body)), ZAPYTANIE)
    assert.doesNotMatch(JSON.stringify(wyw?.init?.headers), /authorization/i)
  })

  it('brak klucza na serwerze → odpowiedzi null z powodem', async () => {
    const { fetchImpl } = zbudujFetch(200, { odpowiedzi: null, powod: 'brak-klucza' })
    assert.deepEqual(await zapytajJev(ZAPYTANIE, { fetch: fetchImpl }), {
      odpowiedzi: null,
      powod: 'brak-klucza',
    })
  })

  it('429 → limit, 404 (vite dev bez api/) i 500 → blad', async () => {
    assert.equal(
      (await zapytajJev(ZAPYTANIE, { fetch: zbudujFetch(429, {}).fetchImpl })).powod,
      'limit',
    )
    for (const s of [404, 500]) {
      const w = await zapytajJev(ZAPYTANIE, { fetch: zbudujFetch(s, {}).fetchImpl })
      assert.deepEqual(w, { odpowiedzi: null, powod: 'blad' })
    }
  })

  it('timeout → null, bez wyjątku', async () => {
    const w = await zapytajJev(ZAPYTANIE, { fetch: fetchWiszacy, timeoutMs: 20 })
    assert.deepEqual(w, { odpowiedzi: null, powod: 'blad' })
  })
})

describe('zJevem – reguła zapasowa', () => {
  const przetworz = (o: Record<string, OdpowiedzJev | null>) => {
    const p = o.profil
    return p?.typ === 'choice' && (p.pewnosc ?? 0) >= 0.6 ? p.wybor : null
  }
  const zapas = () => 'rodzina-z-reguly'

  it('dobra odpowiedź → wynik z JEV', async () => {
    const { fetchImpl } = zbudujFetch(200, { odpowiedzi: ODPOWIEDZI, powod: null })
    const w = await zJevem(ZAPYTANIE, przetworz, zapas, { fetch: fetchImpl })
    assert.deepEqual(w, { wynik: 'rodzina', zrodlo: 'jev', powod: null })
  })

  it('brak klucza → zapas', async () => {
    const { fetchImpl } = zbudujFetch(200, { odpowiedzi: null, powod: 'brak-klucza' })
    const w = await zJevem(ZAPYTANIE, przetworz, zapas, { fetch: fetchImpl })
    assert.deepEqual(w, { wynik: 'rodzina-z-reguly', zrodlo: 'zapas', powod: 'brak-klucza' })
  })

  it('odmowa bramy → zapas z powodem odmowa', async () => {
    const { fetchImpl } = zbudujFetch(200, { odpowiedzi: null, powod: 'odmowa', kod: 402 })
    const w = await zJevem(ZAPYTANIE, przetworz, zapas, { fetch: fetchImpl })
    assert.equal(w.zrodlo, 'zapas')
    assert.equal(w.powod, 'odmowa')
  })

  it('niska pewność albo wyjątek w przetworz → zapas „nieczytelne”', async () => {
    const niska = { ...ODPOWIEDZI, profil: { typ: 'choice', wybor: 'senior', pewnosc: 0.3 } }
    const { fetchImpl } = zbudujFetch(200, { odpowiedzi: niska, powod: null })
    const w = await zJevem(ZAPYTANIE, przetworz, zapas, { fetch: fetchImpl })
    assert.deepEqual(w, { wynik: 'rodzina-z-reguly', zrodlo: 'zapas', powod: 'nieczytelne' })
    const rzuca = () => {
      throw new Error('zły kształt')
    }
    const w2 = await zJevem(ZAPYTANIE, rzuca, zapas, { fetch: fetchImpl })
    assert.equal(w2.zrodlo, 'zapas')
  })

  it('timeout → zapas', async () => {
    const w = await zJevem(ZAPYTANIE, przetworz, zapas, { fetch: fetchWiszacy, timeoutMs: 20 })
    assert.equal(w.wynik, 'rodzina-z-reguly')
  })
})
