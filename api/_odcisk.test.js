// Uruchom: node --test api/
// Odcisk dobowy bez sieci: doba warszawska, skrót, sól z cache'em, wywołanie RPC (fetch wstrzykiwany).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { beforeEach, describe, it } from 'node:test'
import { dzienWarszawy, policzOdcisk, resetujCacheSoli, solDnia, wolajRpc } from './_odcisk.js'

const SOL = 'ab'.repeat(32)
const ENV = {
  SUPABASE_URL: 'https://baza.test/',
  SUPABASE_SERVICE_ROLE_KEY: 'klucz-serwisowy-testowy',
}

/** Atrapa fetch: zapisuje wywołania, odpowiada wg `odpowiedz` (funkcja albo stała). */
function zbudujFetch(odpowiedz = () => ({ ok: true, status: 200, json: async () => SOL })) {
  const wywolania = []
  const fetchImpl = async (url, init) => {
    wywolania.push({ url: String(url), init })
    return typeof odpowiedz === 'function' ? odpowiedz(wywolania.length) : odpowiedz
  }
  return { fetchImpl, wywolania }
}

/** Fetch, który kończy się tylko przez AbortSignal – jak baza, która nie odpowiada. */
const fetchWiszacy = (_url, init) =>
  new Promise((_ok, blad) => {
    init.signal.addEventListener('abort', () => blad(new DOMException('Aborted', 'AbortError')))
  })

/** Fetch, który ignoruje AbortSignal i nie kończy się nigdy – wyścig z timerem musi to uciąć. */
const fetchGluchy = () => new Promise(() => {})

describe('dzienWarszawy', () => {
  const PRZYPADKI = [
    // Granica doby w czasie letnim (CEST = UTC+2): północ w Warszawie to 22:00 UTC dnia poprzedniego.
    ['2026-10-04T21:59:59Z', '2026-10-04'],
    ['2026-10-04T22:00:00Z', '2026-10-05'],
    // Granica doby w czasie zimowym (CET = UTC+1): północ to 23:00 UTC.
    ['2026-12-31T22:59:59Z', '2026-12-31'],
    ['2026-12-31T23:00:00Z', '2027-01-01'],
    // Jesienna zmiana czasu 2026-10-25 (doba 25-godzinna: 00:00 CEST do 24:00 CET).
    ['2026-10-24T21:59:59Z', '2026-10-24'],
    ['2026-10-24T22:00:00Z', '2026-10-25'],
    ['2026-10-25T00:30:00Z', '2026-10-25'], // 02:30 CEST (pierwsze 02:30)
    ['2026-10-25T01:30:00Z', '2026-10-25'], // 02:30 CET (drugie 02:30)
    ['2026-10-25T22:59:59Z', '2026-10-25'], // 23:59:59 CET
    ['2026-10-25T23:00:00Z', '2026-10-26'],
    // Wiosenna zmiana czasu 2026-03-29 (doba 23-godzinna).
    ['2026-03-28T22:59:59Z', '2026-03-28'],
    ['2026-03-28T23:00:00Z', '2026-03-29'],
    ['2026-03-29T21:59:59Z', '2026-03-29'], // 23:59:59 CEST
    ['2026-03-29T22:00:00Z', '2026-03-30'],
  ]
  for (const [chwila, oczekiwany] of PRZYPADKI) {
    it(`${chwila} → ${oczekiwany}`, () => {
      assert.equal(dzienWarszawy(new Date(chwila)), oczekiwany)
    })
  }

  it('przyjmuje też znacznik czasu w ms i tekst ISO', () => {
    assert.equal(dzienWarszawy(Date.parse('2026-10-04T22:00:00Z')), '2026-10-05')
    assert.equal(dzienWarszawy('2026-10-04T22:00:00Z'), '2026-10-05')
  })

  it('bez argumentu: dzisiejsza doba w formacie YYYY-MM-DD', () => {
    assert.match(dzienWarszawy(), /^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('policzOdcisk', () => {
  it('to 16 znaków hex', () => {
    assert.match(policzOdcisk(SOL, '203.0.113.9', 'UA', 'adresscore.pl'), /^[0-9a-f]{16}$/)
  })

  it('jest deterministyczny', () => {
    const a = policzOdcisk(SOL, '203.0.113.9', 'UA', 'adresscore.pl')
    const b = policzOdcisk(SOL, '203.0.113.9', 'UA', 'adresscore.pl')
    assert.equal(a, b)
  })

  it('zmiana soli zmienia odcisk (rotacja dobowa nie łączy wizyt)', () => {
    const a = policzOdcisk('sol-dzis', '203.0.113.9', 'UA', 'adresscore.pl')
    const b = policzOdcisk('sol-jutro', '203.0.113.9', 'UA', 'adresscore.pl')
    assert.notEqual(a, b)
  })

  it('zmiana każdego z pozostałych trzech wejść zmienia odcisk', () => {
    const baza = policzOdcisk(SOL, '203.0.113.9', 'UA', 'adresscore.pl')
    assert.notEqual(baza, policzOdcisk(SOL, '203.0.113.10', 'UA', 'adresscore.pl'))
    assert.notEqual(baza, policzOdcisk(SOL, '203.0.113.9', 'UA2', 'adresscore.pl'))
    assert.notEqual(baza, policzOdcisk(SOL, '203.0.113.9', 'UA', 'inna.pl'))
  })

  it('separator pól: ("ab","c") i ("a","bc") to różne odciski', () => {
    assert.notEqual(policzOdcisk(SOL, 'ab', 'c', 'h'), policzOdcisk(SOL, 'a', 'bc', 'h'))
    // Granica sól/IP: obie pary sklejone dałyby ten sam tekst „12.3xh”.
    assert.notEqual(policzOdcisk('1', '2.3', 'x', 'h'), policzOdcisk('12', '.3', 'x', 'h'))
    assert.equal(policzOdcisk('1', '2.3', 'x', 'h'), 'fce52b9a89a31fd7')
    assert.equal(policzOdcisk('12', '.3', 'x', 'h'), '93588316f4f9a2c8')
  })

  it('wektor testowy: sha256(sól NUL ip NUL ua NUL host), pierwsze 16 znaków', () => {
    const wejscie = [
      'sol-testowa-2026-10-05',
      '203.0.113.9',
      'Mozilla/5.0 UA-testowy/1.0',
      'adresscore.pl',
    ]
    const niezaleznie = createHash('sha256')
      .update(wejscie.join('\u0000'))
      .digest('hex')
      .slice(0, 16)
    assert.equal(policzOdcisk(...wejscie), niezaleznie)
    // Literał policzony osobno, żeby przypadkowa zmiana algorytmu nie przeszła bez śladu.
    assert.equal(niezaleznie, '19f190e82be22449')
  })

  it('wejścia puste albo nietekstowe nie rzucają', () => {
    assert.match(policzOdcisk(SOL, undefined, null, ''), /^[0-9a-f]{16}$/)
    assert.equal(policzOdcisk(SOL, undefined, undefined, 'h'), policzOdcisk(SOL, '', '', 'h'))
  })

  it('wynik nie zawiera wejść (to skrót, nie zakodowany IP ani UA)', () => {
    const odcisk = policzOdcisk(SOL, '203.0.113.9', 'ZnacznikUA-7f3a', 'adresscore.pl')
    assert.equal(odcisk.includes('203'), false)
    assert.equal(odcisk.includes('Znacznik'), false)
  })
})

describe('wolajRpc', () => {
  it('POST na /rest/v1/rpc/<nazwa> z kluczem service_role i ciałem JSON', async () => {
    const { fetchImpl, wywolania } = zbudujFetch()
    const w = await wolajRpc({
      env: ENV,
      fetch: fetchImpl,
      nazwa: 'jakas_funkcja',
      cialo: { a: 1 },
    })
    assert.deepEqual(w, { ok: true })
    assert.equal(wywolania.length, 1)
    const { url, init } = wywolania[0]
    // Końcowy ukośnik w SUPABASE_URL nie robi podwójnego „//”.
    assert.equal(url, 'https://baza.test/rest/v1/rpc/jakas_funkcja')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY)
    assert.equal(init.headers.authorization, `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`)
    assert.equal(init.headers['content-type'], 'application/json')
    assert.equal(init.body, '{"a":1}')
    assert.ok(init.signal instanceof AbortSignal)
  })

  it('odczyt: true oddaje sparsowane ciało odpowiedzi', async () => {
    const { fetchImpl } = zbudujFetch({ ok: true, status: 200, json: async () => 'wynik' })
    const w = await wolajRpc({ env: ENV, fetch: fetchImpl, nazwa: 'f', cialo: {}, odczyt: true })
    assert.deepEqual(w, { ok: true, dane: 'wynik' })
  })

  it('odpowiedź HTTP z błędem → powód „http-<kod>”', async () => {
    const { fetchImpl } = zbudujFetch({ ok: false, status: 503, json: async () => ({}) })
    const w = await wolajRpc({ env: ENV, fetch: fetchImpl, nazwa: 'f', cialo: {} })
    assert.deepEqual(w, { ok: false, powod: 'http-503' })
  })

  it('wyjątek fetch → powód „siec”, bez rzucania', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fetch failed')
    }
    const w = await wolajRpc({ env: ENV, fetch: fetchImpl, nazwa: 'f', cialo: {} })
    assert.deepEqual(w, { ok: false, powod: 'siec' })
  })

  it('zepsuty JSON w odpowiedzi przy odczycie → „siec”', async () => {
    const { fetchImpl } = zbudujFetch({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
    const w = await wolajRpc({ env: ENV, fetch: fetchImpl, nazwa: 'f', cialo: {}, odczyt: true })
    assert.equal(w.ok, false)
  })

  it('timeout (fetch honoruje sygnał) → powód „timeout”', async () => {
    const start = Date.now()
    const w = await wolajRpc({
      env: ENV,
      fetch: fetchWiszacy,
      nazwa: 'f',
      cialo: {},
      timeoutMs: 20,
    })
    assert.deepEqual(w, { ok: false, powod: 'timeout' })
    assert.ok(Date.now() - start < 1000)
  })

  it('timeout także wtedy, gdy fetch ignoruje sygnał', async () => {
    const w = await wolajRpc({ env: ENV, fetch: fetchGluchy, nazwa: 'f', cialo: {}, timeoutMs: 20 })
    assert.deepEqual(w, { ok: false, powod: 'timeout' })
  })

  it('domyślny budżet to 2 sekundy', async () => {
    const start = Date.now()
    const w = await wolajRpc({ env: ENV, fetch: fetchWiszacy, nazwa: 'f', cialo: {} })
    const czas = Date.now() - start
    assert.equal(w.powod, 'timeout')
    assert.ok(czas >= 1900 && czas < 6000, `czas ${czas} ms`)
  })

  it('brak SUPABASE_URL albo klucza → bez wywołania fetch', async () => {
    for (const env of [
      {},
      { SUPABASE_URL: ENV.SUPABASE_URL },
      { SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY },
      { SUPABASE_URL: '  ', SUPABASE_SERVICE_ROLE_KEY: 'k' },
      { SUPABASE_URL: 'https://x.test', SUPABASE_SERVICE_ROLE_KEY: '' },
      undefined,
    ]) {
      const { fetchImpl, wywolania } = zbudujFetch()
      const w = await wolajRpc({ env, fetch: fetchImpl, nazwa: 'f', cialo: {} })
      assert.deepEqual(w, { ok: false, powod: 'brak-konfiguracji' })
      assert.equal(wywolania.length, 0)
    }
  })

  it('fetch nie jest funkcją → „brak-fetch”', async () => {
    const w = await wolajRpc({ env: ENV, fetch: undefined, nazwa: 'f', cialo: {} })
    assert.deepEqual(w, { ok: false, powod: 'brak-fetch' })
  })
})

describe('solDnia', () => {
  beforeEach(() => resetujCacheSoli())

  const DZIEN_1 = new Date('2026-10-05T10:00:00Z')
  const DZIEN_2 = new Date('2026-10-06T10:00:00Z')

  it('woła RPC analityka_sol_dzis kluczem service_role i oddaje sól', async () => {
    const { fetchImpl, wywolania } = zbudujFetch()
    const sol = await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 })
    assert.equal(sol, SOL)
    assert.equal(wywolania.length, 1)
    const { url, init } = wywolania[0]
    assert.equal(url, 'https://baza.test/rest/v1/rpc/analityka_sol_dzis')
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY)
    assert.equal(init.headers.authorization, `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`)
    assert.equal(init.body, '{}')
  })

  it('cache na dobę: drugie wywołanie nie odpytuje bazy', async () => {
    const { fetchImpl, wywolania } = zbudujFetch()
    await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 })
    const druga = await solDnia({
      env: ENV,
      fetch: fetchImpl,
      teraz: new Date('2026-10-05T18:00:00Z'),
    })
    assert.equal(druga, SOL)
    assert.equal(wywolania.length, 1)
  })

  it('równoległe żądania ciepłej instancji dzielą jedno zapytanie (cache obietnicy)', async () => {
    const { fetchImpl, wywolania } = zbudujFetch()
    const wyniki = await Promise.all(
      Array.from({ length: 8 }, () => solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 })),
    )
    assert.deepEqual(new Set(wyniki), new Set([SOL]))
    assert.equal(wywolania.length, 1)
  })

  it('nowa doba warszawska → nowe zapytanie (granica o północy czasu lokalnego, nie UTC)', async () => {
    const { fetchImpl, wywolania } = zbudujFetch()
    // 21:59:59 UTC to jeszcze 4 października w Warszawie (CEST), 22:00:00 UTC to już 5.
    await solDnia({ env: ENV, fetch: fetchImpl, teraz: new Date('2026-10-04T21:59:59Z') })
    await solDnia({ env: ENV, fetch: fetchImpl, teraz: new Date('2026-10-04T21:59:59.500Z') })
    assert.equal(wywolania.length, 1)
    await solDnia({ env: ENV, fetch: fetchImpl, teraz: new Date('2026-10-04T22:00:00Z') })
    assert.equal(wywolania.length, 2)
  })

  it('sól z poprzedniej doby jest wyrzucana z cache (mapa nie rośnie)', async () => {
    const { fetchImpl, wywolania } = zbudujFetch()
    await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 })
    await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_2 })
    await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 })
    assert.equal(wywolania.length, 3)
  })

  it('błąd sieci → null i NIE jest cache’owany: następne żądanie ponawia', async () => {
    let numer = 0
    const fetchImpl = async () => {
      numer += 1
      if (numer === 1) throw new TypeError('fetch failed')
      return { ok: true, status: 200, json: async () => SOL }
    }
    assert.equal(await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 }), null)
    assert.equal(await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 }), SOL)
    // Udane zapytanie już zostaje w cache.
    assert.equal(await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 }), SOL)
    assert.equal(numer, 2)
  })

  it('odpowiedź HTTP 500 → null, ponawiane przy kolejnym żądaniu', async () => {
    const { fetchImpl, wywolania } = zbudujFetch({ ok: false, status: 500, json: async () => ({}) })
    assert.equal(await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 }), null)
    assert.equal(await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 }), null)
    assert.equal(wywolania.length, 2)
  })

  it('równoległe żądania podczas awarii wszystkie dostają null, a po awarii cache jest czysty', async () => {
    const { fetchImpl, wywolania } = zbudujFetch({ ok: false, status: 500, json: async () => ({}) })
    const wyniki = await Promise.all(
      Array.from({ length: 4 }, () => solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 })),
    )
    assert.deepEqual(wyniki, [null, null, null, null])
    assert.equal(wywolania.length, 1)
    await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 })
    assert.equal(wywolania.length, 2)
  })

  it('sól o złym kształcie (nie tekst, pusta, zbyt krótka, zbyt długa) → null', async () => {
    for (const zla of [123, null, {}, ['x'], '', 'abc', 'x'.repeat(300)]) {
      resetujCacheSoli()
      const { fetchImpl } = zbudujFetch({ ok: true, status: 200, json: async () => zla })
      assert.equal(await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 }), null, String(zla))
    }
  })

  it('brak zmiennych SUPABASE_* → null bez wywołania fetch', async () => {
    const { fetchImpl, wywolania } = zbudujFetch()
    assert.equal(await solDnia({ env: {}, fetch: fetchImpl, teraz: DZIEN_1 }), null)
    assert.equal(await solDnia({ env: undefined, fetch: fetchImpl, teraz: DZIEN_1 }), null)
    assert.equal(await solDnia({ fetch: fetchImpl, teraz: DZIEN_1 }), null)
    assert.equal(wywolania.length, 0)
  })

  it('timeout → null szybko, bez zawieszania żądania', async () => {
    const start = Date.now()
    const sol = await solDnia({ env: ENV, fetch: fetchWiszacy, teraz: DZIEN_1, timeoutMs: 20 })
    assert.equal(sol, null)
    assert.ok(Date.now() - start < 1000)
    // Po timeoucie następne żądanie próbuje od nowa.
    const { fetchImpl } = zbudujFetch()
    assert.equal(await solDnia({ env: ENV, fetch: fetchImpl, teraz: DZIEN_1 }), SOL)
  })

  it('bez argumentów nie rzuca (null)', async () => {
    assert.equal(await solDnia(), null)
  })

  it('niepoprawny zegar nie rzuca (null)', async () => {
    const { fetchImpl } = zbudujFetch()
    assert.equal(await solDnia({ env: ENV, fetch: fetchImpl, teraz: new Date('nie data') }), null)
  })
})
