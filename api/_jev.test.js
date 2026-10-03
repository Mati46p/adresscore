// Uruchom: node --test api/
// Pośrednik JEV bez sieci – fetch wstrzykiwany, klucz testowy z obiektu env.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LIMITY,
  MODEL_JEV,
  obsluz,
  sprawdzZapytanie,
  URL_JEV,
  utworzLimiter,
  wolajJev,
} from './_jev.js'
import handler from './jev.js'

const CIALO = {
  stan: 'Mam dwoje dzieci i pracuję w centrum',
  pytania: {
    profil: {
      typ: 'choice',
      polecenie: 'Kto szuka mieszkania?',
      kryteria: { rodzina: 'Rodzina z dziećmi', singiel: 'Singiel w centrum' },
    },
    dzieci: { typ: 'noul', polecenie: 'Czy osoba ma dzieci?' },
    cisza: { typ: 'score', polecenie: 'Jak ważna jest cisza?', kryteria: ['Nieważna', 'Ważna'] },
  },
}

const ODPOWIEDZ_JEV = {
  model: 'jev-1.13.0',
  answers: {
    profil: { type: 'choice', choice: 'rodzina', confidence: 0.91 },
    dzieci: { type: 'noul', noul: 0.93 },
    cisza: { type: 'score', score: 0.4, confidence: 0.7 },
  },
}

function zbudujFetch({ status = 200, json = ODPOWIEDZ_JEV } = {}) {
  const wywolania = []
  const fetchImpl = async (url, init) => {
    wywolania.push({ url: String(url), init })
    return { ok: status >= 200 && status < 300, status, json: async () => json }
  }
  return { fetchImpl, wywolania }
}

/** Fetch, który kończy się tylko przez AbortSignal – jak JEV, który nie odpowiada. */
const fetchWiszacy = async (_url, init) =>
  new Promise((_ok, blad) => {
    init.signal.addEventListener('abort', () => blad(new DOMException('Aborted', 'AbortError')))
  })

const ENV = { JEV_API_KEY: 'klucz-testowy' }
const bezLimitu = () => ({ ok: true })

function zapytanie() {
  const z = sprawdzZapytanie(CIALO)
  assert.equal(z.blad, undefined)
  return z
}

describe('wolajJev – kształt żądania', () => {
  it('POST na systemone z modelem, stanem i pytaniami w formacie JEV', async () => {
    const { fetchImpl, wywolania } = zbudujFetch()
    await wolajJev(zapytanie(), { klucz: 'k', fetch: fetchImpl })
    assert.equal(wywolania.length, 1)
    const { url, init } = wywolania[0]
    assert.equal(url, URL_JEV)
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.authorization, 'Bearer k')
    assert.equal(init.headers['content-type'], 'application/json')
    assert.ok(init.signal instanceof AbortSignal)
    const cialo = JSON.parse(init.body)
    assert.equal(cialo.model, MODEL_JEV)
    assert.equal(cialo.state, CIALO.stan)
    assert.deepEqual(cialo.questions, {
      profil: {
        type: 'choice',
        instructions: 'Kto szuka mieszkania?',
        criteria: { rodzina: 'Rodzina z dziećmi', singiel: 'Singiel w centrum' },
      },
      dzieci: { type: 'noul', instructions: 'Czy osoba ma dzieci?' },
      cisza: {
        type: 'score',
        instructions: 'Jak ważna jest cisza?',
        criteria: ['Nieważna', 'Ważna'],
      },
    })
  })

  it('kolejność opcji choice zostaje (JEV ją widzi)', () => {
    const z = sprawdzZapytanie({
      stan: 'x',
      pytania: { w: { typ: 'choice', polecenie: 'p', kryteria: { c: 'C', a: 'A', b: 'B' } } },
    })
    assert.deepEqual(Object.keys(z.pytania.w.criteria), ['c', 'a', 'b'])
  })

  it('stan przycięty do 2000 znaków', () => {
    const z = sprawdzZapytanie({ ...CIALO, stan: 'a'.repeat(5000) })
    assert.equal(z.stan.length, 2000)
  })

  it('odpowiedź JEV → kontrakt po polsku', async () => {
    const { fetchImpl } = zbudujFetch()
    const w = await wolajJev(zapytanie(), { klucz: 'k', fetch: fetchImpl })
    assert.deepEqual(w, {
      powod: null,
      odpowiedzi: {
        profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 0.91 },
        dzieci: { typ: 'noul', noul: 0.93 },
        cisza: { typ: 'score', ocena: 0.4, pewnosc: 0.7 },
      },
    })
  })
})

describe('wolajJev – prawdopodobieństwa opcji (#154)', () => {
  it('model przypięty do jev-1.13.0 i wysłany w ciele żądania', async () => {
    assert.equal(MODEL_JEV, 'jev-1.13.0')
    const { fetchImpl, wywolania } = zbudujFetch()
    await wolajJev(zapytanie(), { klucz: 'k', fetch: fetchImpl })
    assert.equal(JSON.parse(wywolania[0].init.body).model, 'jev-1.13.0')
  })

  it('choice i score: rozkład przechodzi jako prawdopodobienstwa', async () => {
    const { fetchImpl } = zbudujFetch({
      json: {
        answers: {
          profil: {
            choice: 'rodzina',
            confidence: 0.8,
            probabilities: { rodzina: 0.9, singiel: 0.1 },
          },
          dzieci: { noul: 0.93, probabilities: { tak: 1 } },
          cisza: { score: 0.4, confidence: 0.7, probabilities: { 0: 0.6, 1: 0.4 } },
        },
      },
    })
    const w = await wolajJev(zapytanie(), { klucz: 'k', fetch: fetchImpl })
    assert.deepEqual(w.odpowiedzi, {
      profil: {
        typ: 'choice',
        wybor: 'rodzina',
        pewnosc: 0.8,
        prawdopodobienstwa: { rodzina: 0.9, singiel: 0.1 },
      },
      dzieci: { typ: 'noul', noul: 0.93 },
      cisza: { typ: 'score', ocena: 0.4, pewnosc: 0.7, prawdopodobienstwa: { 0: 0.6, 1: 0.4 } },
    })
  })

  it('klucze spoza opcji żądania przepadają', async () => {
    const { fetchImpl } = zbudujFetch({
      json: {
        answers: {
          profil: {
            choice: 'rodzina',
            confidence: 0.8,
            probabilities: { rodzina: 0.7, singiel: 0.2, senior: 0.1, toString: 0.5 },
          },
          cisza: { score: 1, confidence: 0.9, probabilities: { 0: 0.1, 1: 0.8, 2: 0.1 } },
        },
      },
    })
    const w = await wolajJev(zapytanie(), { klucz: 'k', fetch: fetchImpl })
    assert.deepEqual(w.odpowiedzi.profil.prawdopodobienstwa, { rodzina: 0.7, singiel: 0.2 })
    assert.deepEqual(w.odpowiedzi.cisza.prawdopodobienstwa, { 0: 0.1, 1: 0.8 })
  })

  it('wartości nieskończone, spoza 0–1 i nieliczbowe przepadają', async () => {
    const { fetchImpl } = zbudujFetch({
      json: {
        answers: {
          profil: {
            choice: 'rodzina',
            confidence: 0.8,
            probabilities: { rodzina: Number.POSITIVE_INFINITY, singiel: 0.3 },
          },
          cisza: { score: 1, confidence: 0.9, probabilities: { 0: -0.1, 1: 1.2 } },
        },
      },
    })
    const w = await wolajJev(zapytanie(), { klucz: 'k', fetch: fetchImpl })
    assert.deepEqual(w.odpowiedzi.profil.prawdopodobienstwa, { singiel: 0.3 })
    // Nic nie przeszło filtra → pola nie ma wcale.
    assert.equal(Object.hasOwn(w.odpowiedzi.cisza, 'prawdopodobienstwa'), false)

    // NaN i tekst – też odrzucone (fetch wstrzykiwany może dać cokolwiek).
    const drugi = zbudujFetch({
      json: {
        answers: {
          profil: {
            choice: 'singiel',
            confidence: 0.6,
            probabilities: { rodzina: Number.NaN, singiel: '0.6' },
          },
        },
      },
    })
    const w2 = await wolajJev(zapytanie(), { klucz: 'k', fetch: drugi.fetchImpl })
    assert.deepEqual(w2.odpowiedzi.profil, { typ: 'choice', wybor: 'singiel', pewnosc: 0.6 })
  })

  it('JEV nie przysłał rozkładu (albo przysłał nie-obiekt) → pola brak', async () => {
    for (const probabilities of [undefined, null, [0.5, 0.5], 'x']) {
      const { fetchImpl } = zbudujFetch({
        json: {
          answers: {
            profil: { choice: 'rodzina', confidence: 0.91, probabilities },
            cisza: { score: 0.4, confidence: 0.7, probabilities },
          },
        },
      })
      const w = await wolajJev(zapytanie(), { klucz: 'k', fetch: fetchImpl })
      assert.equal(Object.hasOwn(w.odpowiedzi.profil, 'prawdopodobienstwa'), false)
      assert.equal(Object.hasOwn(w.odpowiedzi.cisza, 'prawdopodobienstwa'), false)
    }
  })
})

describe('wolajJev – zamknięta lista i degradacja', () => {
  it('choice spoza listy, noul poza 0–1 i score poza skalą → null dla pytania', async () => {
    const { fetchImpl } = zbudujFetch({
      json: {
        answers: {
          profil: { choice: 'Warszawa, Marszałkowska 1', confidence: 0.99 },
          dzieci: { noul: 1.7 },
          cisza: { score: 5 },
        },
      },
    })
    const w = await wolajJev(zapytanie(), { klucz: 'k', fetch: fetchImpl })
    assert.deepEqual(w.odpowiedzi, { profil: null, dzieci: null, cisza: null })
  })

  it('timeout → null, bez wyjątku', async () => {
    const start = Date.now()
    const w = await wolajJev(zapytanie(), { klucz: 'k', fetch: fetchWiszacy, timeoutMs: 30 })
    assert.deepEqual(w, { odpowiedzi: null, powod: 'blad' })
    assert.ok(Date.now() - start < 1000)
  })

  it('domyślny timeout to 800 ms', async () => {
    const start = Date.now()
    const w = await wolajJev(zapytanie(), { klucz: 'k', fetch: fetchWiszacy })
    const czas = Date.now() - start
    assert.equal(w.odpowiedzi, null)
    assert.ok(czas >= 700 && czas < 2000, `czas ${czas} ms`)
  })

  for (const status of [401, 402, 403]) {
    it(`${status} → odmowa, osobno od błędu przejściowego`, async () => {
      const { fetchImpl } = zbudujFetch({ status, json: { message: 'nope' } })
      const w = await wolajJev(zapytanie(), { klucz: 'k', fetch: fetchImpl })
      assert.deepEqual(w, { odpowiedzi: null, powod: 'odmowa', kod: status })
    })
  }

  it('5xx, błąd sieci i dziwny JSON → null z powodem „blad”', async () => {
    for (const fetchImpl of [
      zbudujFetch({ status: 503 }).fetchImpl,
      zbudujFetch({ json: { cos: 1 } }).fetchImpl,
      async () => {
        throw new TypeError('fetch failed')
      },
    ]) {
      const w = await wolajJev(zapytanie(), { klucz: 'k', fetch: fetchImpl })
      assert.deepEqual(w, { odpowiedzi: null, powod: 'blad' })
    }
  })

  it('brak klucza → null bez wołania sieci', async () => {
    const { fetchImpl, wywolania } = zbudujFetch()
    const w = await wolajJev(zapytanie(), { klucz: undefined, fetch: fetchImpl })
    assert.deepEqual(w, { odpowiedzi: null, powod: 'brak-klucza' })
    assert.equal(wywolania.length, 0)
  })
})

describe('sprawdzZapytanie', () => {
  it('odrzuca złe żądania', () => {
    const zle = [
      null,
      { pytania: CIALO.pytania },
      { stan: 'x', pytania: {} },
      { stan: 'x', pytania: { a: { typ: 'liczba', polecenie: 'Ile?' } } },
      {
        stan: 'x',
        pytania: { a: { typ: 'choice', polecenie: 'p', kryteria: { tylko: 'jedna' } } },
      },
      { stan: 'x', pytania: { a: { typ: 'score', polecenie: 'p', kryteria: ['jeden'] } } },
      { stan: 'x', pytania: { 'zle id!': { typ: 'noul', polecenie: 'p' } } },
      {
        stan: 'x',
        pytania: Object.fromEntries(
          Array.from({ length: 33 }, (_, i) => [`p${i}`, { typ: 'noul', polecenie: 'p' }]),
        ),
      },
    ]
    for (const c of zle) assert.ok(sprawdzZapytanie(c).blad, JSON.stringify(c))
  })

  it('#183: limit 32 pytań – 32 przechodzi, 33 nie (było 16)', () => {
    const n = (k) =>
      Object.fromEntries(
        Array.from({ length: k }, (_, i) => [`p${i}`, { typ: 'noul', polecenie: 'p' }]),
      )
    assert.equal(LIMITY.pytan, 32)
    assert.equal(sprawdzZapytanie({ stan: 'x', pytania: n(22) }).blad, undefined)
    assert.equal(Object.keys(sprawdzZapytanie({ stan: 'x', pytania: n(32) }).pytania).length, 32)
    assert.equal(sprawdzZapytanie({ stan: 'x', pytania: n(33) }).blad, 'Od 1 do 32 pytań')
  })
})

describe('sprawdzZapytanie – opisy strukturalne (#163)', () => {
  const choice = (opis) => ({
    stan: 'x',
    pytania: { w: { typ: 'choice', polecenie: 'p', kryteria: { a: opis, b: 'Zwykły opis' } } },
  })
  const noul = (kryteria) => ({
    stan: 'x',
    pytania: { t: { typ: 'noul', polecenie: 'Czy?', kryteria } },
  })

  it('opcja choice jako obiekt → what / not_for / examples w stałej kolejności, tekst bez zmian', () => {
    const z = sprawdzZapytanie(
      choice({ przyklady: ['Głośno?', 'Cicho?'], nie_dla: 'Przystanek', co: 'Hałas' }),
    )
    assert.equal(z.blad, undefined)
    const k = z.pytania.w.criteria
    assert.deepEqual(k.a, { what: 'Hałas', not_for: 'Przystanek', examples: ['Głośno?', 'Cicho?'] })
    assert.deepEqual(Object.keys(k.a), ['what', 'not_for', 'examples'])
    assert.equal(k.b, 'Zwykły opis')
    assert.deepEqual(Object.keys(k), ['a', 'b'])
    // Samo `co` też przechodzi.
    assert.deepEqual(sprawdzZapytanie(choice({ co: 'Hałas' })).pytania.w.criteria.a, {
      what: 'Hałas',
    })
  })

  it('noul z kryteriami prawda/fałsz → criteria.true / criteria.false (tekst albo obiekt)', () => {
    const z = sprawdzZapytanie(
      noul({ prawda: 'Pyta o dojazd', falsz: { co: 'Tylko hałas', przyklady: ['Słychać?'] } }),
    )
    assert.equal(z.blad, undefined)
    assert.deepEqual(z.pytania.t, {
      type: 'noul',
      instructions: 'Czy?',
      criteria: { true: 'Pyta o dojazd', false: { what: 'Tylko hałas', examples: ['Słychać?'] } },
    })
    assert.deepEqual(sprawdzZapytanie(noul({ falsz: 'Nie' })).pytania.t.criteria, { false: 'Nie' })
  })

  it('bez kryteriów noul wygląda dokładnie jak przed #163 (zmiana addytywna)', () => {
    assert.deepEqual(sprawdzZapytanie(CIALO).pytania.dzieci, {
      type: 'noul',
      instructions: 'Czy osoba ma dzieci?',
    })
  })

  it('odrzuca złe opisy: nieznane pole, brak co, puste, za długie, za dużo przykładów', () => {
    const dlugi = 'x'.repeat(301)
    const zleOpcje = [
      { co: 'a', what: 'b' },
      { nie_dla: 'b' },
      { co: '' },
      { co: dlugi },
      { co: 'a', nie_dla: dlugi },
      { co: 'a', nie_dla: 5 },
      { co: 'a', przyklady: [] },
      { co: 'a', przyklady: 'jeden' },
      { co: 'a', przyklady: ['1', '2', '3', '4', '5', '6'] },
      { co: 'a', przyklady: ['ok', dlugi] },
      { co: 'a', przyklady: ['ok', 3] },
      ['tablica'],
      null,
      42,
    ]
    for (const o of zleOpcje) assert.ok(sprawdzZapytanie(choice(o)).blad, JSON.stringify(o))
    const zleNoul = [
      {},
      'tekst',
      ['prawda'],
      { true: 'a' },
      { prawda: 'a', inne: 'b' },
      { prawda: '' },
      { prawda: { co: dlugi } },
      { falsz: { co: 'a', powod: 'b' } },
      null,
    ]
    for (const k of zleNoul) assert.ok(sprawdzZapytanie(noul(k)).blad, JSON.stringify(k))
  })

  it('pięć przykładów i pola po 300 znaków przechodzą (granice limitu)', () => {
    const t = 'y'.repeat(300)
    const z = sprawdzZapytanie(choice({ co: t, nie_dla: t, przyklady: [t, t, t, t, t] }))
    assert.equal(z.blad, undefined)
  })

  it('#182: limit 32 pytań – 32 przechodzi, 33 nie', () => {
    const n = (ile) => ({
      stan: 'x',
      pytania: Object.fromEntries(
        Array.from({ length: ile }, (_, i) => [`p${i}`, { typ: 'noul', polecenie: 'p' }]),
      ),
    })
    assert.equal(sprawdzZapytanie(n(32)).blad, undefined)
    assert.match(sprawdzZapytanie(n(33)).blad ?? '', /32/)
  })

  it('całe pytania ponad limit znaków → błąd, a duże zapytanie z samymi tekstami przechodzi', () => {
    const opcje = (n, dl) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${i}`, 'x'.repeat(dl)]))
    // 128 opcji po 300 znaków i 15 twierdzeń – największe zapytanie sprzed #163.
    const duze = {
      stan: 'x',
      pytania: {
        w: { typ: 'choice', polecenie: 'p', kryteria: opcje(128, 300) },
        ...Object.fromEntries(
          Array.from({ length: 15 }, (_, i) => [
            `t${i}`,
            { typ: 'noul', polecenie: 'p'.repeat(300) },
          ]),
        ),
      },
    }
    assert.equal(sprawdzZapytanie(duze).blad, undefined)
    const t = 'z'.repeat(300)
    const zaDuze = {
      stan: 'x',
      pytania: {
        w: {
          typ: 'choice',
          polecenie: 'p',
          kryteria: Object.fromEntries(
            Array.from({ length: 128 }, (_, i) => [`o${i}`, { co: t, nie_dla: t, przyklady: [t] }]),
          ),
        },
      },
    }
    assert.match(sprawdzZapytanie(zaDuze).blad ?? '', /znaków/)
  })

  it('odpowiedź choice na opcji z opisem strukturalnym: dalej tylko znane id', async () => {
    const z = sprawdzZapytanie(choice({ co: 'Hałas', nie_dla: 'Przystanek' }))
    const { fetchImpl } = zbudujFetch({
      json: {
        answers: {
          w: {
            type: 'choice',
            choice: 'a',
            confidence: 0.9,
            probabilities: { a: 0.9, b: 0.1, x: 0.5 },
          },
        },
      },
    })
    const w = await wolajJev(z, { klucz: 'k', fetch: fetchImpl })
    assert.deepEqual(w.odpowiedzi.w, {
      typ: 'choice',
      wybor: 'a',
      pewnosc: 0.9,
      prawdopodobienstwa: { a: 0.9, b: 0.1 },
    })
    const { fetchImpl: zly } = zbudujFetch({
      json: { answers: { w: { type: 'choice', choice: 'what', confidence: 0.9 } } },
    })
    assert.equal((await wolajJev(z, { klucz: 'k', fetch: zly })).odpowiedzi.w, null)
  })
})

describe('obsluz – kontrakt HTTP', () => {
  it('brak JEV_API_KEY → 200 i odpowiedzi null (klient bierze zapas), nigdy 500', async () => {
    const { fetchImpl, wywolania } = zbudujFetch()
    const w = await obsluz({
      metoda: 'POST',
      cialo: CIALO,
      ip: '1.1.1.1',
      env: {},
      fetch: fetchImpl,
      limiter: bezLimitu,
    })
    assert.equal(w.status, 200)
    assert.deepEqual(w.json, { odpowiedzi: null, powod: 'brak-klucza' })
    assert.equal(wywolania.length, 0)
  })

  it('z kluczem → 200 i odpowiedzi', async () => {
    const { fetchImpl } = zbudujFetch()
    const w = await obsluz({
      metoda: 'POST',
      cialo: CIALO,
      ip: '1.1.1.1',
      env: ENV,
      fetch: fetchImpl,
      limiter: bezLimitu,
    })
    assert.equal(w.status, 200)
    assert.equal(w.json.odpowiedzi.profil.wybor, 'rodzina')
  })

  it('GET → 405, złe ciało → 400', async () => {
    const opcje = { ip: '1.1.1.1', env: ENV, fetch: zbudujFetch().fetchImpl, limiter: bezLimitu }
    assert.equal((await obsluz({ ...opcje, metoda: 'GET', cialo: null })).status, 405)
    assert.equal((await obsluz({ ...opcje, metoda: 'POST', cialo: { stan: 1 } })).status, 400)
  })
})

describe('limit żądań', () => {
  it('limit na IP: 21. żądanie w minucie → 429, inny IP przechodzi, po minucie znowu można', () => {
    const przepusc = utworzLimiter({ oknoMs: 60_000, naIp: 20, naInstancje: 300 })
    for (let i = 0; i < 20; i++) assert.equal(przepusc('1.1.1.1', 1000 + i).ok, true)
    const odbite = przepusc('1.1.1.1', 2000)
    assert.equal(odbite.ok, false)
    assert.ok(odbite.ponowZaS >= 1 && odbite.ponowZaS <= 60)
    assert.equal(przepusc('2.2.2.2', 2000).ok, true)
    assert.equal(przepusc('1.1.1.1', 61_001).ok, true)
  })

  it('limit na instancję chroni kredyt niezależnie od IP', () => {
    const przepusc = utworzLimiter({ oknoMs: 60_000, naIp: 100, naInstancje: 3 })
    assert.equal(przepusc('a', 0).ok, true)
    assert.equal(przepusc('b', 0).ok, true)
    assert.equal(przepusc('c', 0).ok, true)
    assert.equal(przepusc('d', 0).ok, false)
  })

  it('obsluz po limicie → 429 z Retry-After i bez wołania JEV', async () => {
    const { fetchImpl, wywolania } = zbudujFetch()
    const limiter = utworzLimiter({ oknoMs: 60_000, naIp: 1, naInstancje: 10 })
    const opcje = { metoda: 'POST', cialo: CIALO, ip: '3.3.3.3', env: ENV, fetch: fetchImpl }
    assert.equal((await obsluz({ ...opcje, limiter, teraz: 0 })).status, 200)
    const w = await obsluz({ ...opcje, limiter, teraz: 10 })
    assert.equal(w.status, 429)
    assert.deepEqual(w.json, { odpowiedzi: null, powod: 'limit' })
    assert.ok(Number(w.naglowki['Retry-After']) >= 1)
    assert.equal(wywolania.length, 1)
  })
})

describe('handler – funkcja Vercela', () => {
  function atrapaRes() {
    const res = { naglowki: {}, statusCode: 0, tresc: '' }
    res.setHeader = (k, v) => {
      res.naglowki[k.toLowerCase()] = v
    }
    res.end = (t) => {
      res.tresc = t
    }
    return res
  }

  it('bez klucza w env odpowiada 200 JSON-em z odpowiedzi null i no-store', async () => {
    const res = atrapaRes()
    const req = { method: 'POST', body: CIALO, headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }
    await handler(req, res, { env: {}, fetch: zbudujFetch().fetchImpl })
    assert.equal(res.statusCode, 200)
    assert.equal(res.naglowki['cache-control'], 'no-store')
    assert.match(res.naglowki['content-type'], /application\/json/)
    assert.deepEqual(JSON.parse(res.tresc), { odpowiedzi: null, powod: 'brak-klucza' })
  })

  it('ciało jako strumień (bez req.body) też działa', async () => {
    const res = atrapaRes()
    const req = {
      method: 'POST',
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify(CIALO)
      },
    }
    await handler(req, res, { env: ENV, fetch: zbudujFetch().fetchImpl })
    assert.equal(res.statusCode, 200)
    assert.equal(JSON.parse(res.tresc).odpowiedzi.dzieci.noul, 0.93)
  })
})
