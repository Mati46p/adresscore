// Uruchom: node --test api/
// Endpoint POST /api/zdarzenie bez sieci i bez bazy: fetch wstrzykiwany, żądanie i odpowiedź
// to atrapy. Ten sam test kontraktowy przechodzi na pięciu kształtach żądania (SC-008):
// Vercel z `req.body` jako tekstem, obiektem i bajtami oraz node:http ze strumieniem (w całości
// i w kawałkach przecinających znaki wielobajtowe).
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { beforeEach, describe, it } from 'node:test'
import { policzOdcisk, resetujCacheSoli } from './_odcisk.js'
import { CIALO_ZA_DUZE, obsluz, zbudujWiersz, zwalidujZdarzenie } from './_zdarzenie.js'
import {
  CLICK_ID,
  KANALY_UDOSTEPNIENIA,
  LIMIT_CIALA,
  MAX_CEL,
  MAX_CTA,
  MAX_CZAS_MS,
  MAX_ELEMENT,
  MAX_FRAZA,
  MAX_KOMUNIKAT,
  MAX_PACZKA,
  MAX_SEKCJI,
  MAX_UTM,
  METRYKI_WITAL,
  NAZWY_PRODUKTOWE,
  RODZAJE_KLIKU,
  WLASCIWOSCI_PRODUKTOWE,
} from './_zdarzenie-kontrakt.js'
import handler from './zdarzenie.js'

/* -------------------------------------------------------------------------- */
/* Dane i atrapy                                                               */
/* -------------------------------------------------------------------------- */

const SOL = 'c0ffee'.repeat(10) + 'abcd'
const KLUCZ = 'klucz-serwisowy-testowy'
const ENV = {
  SUPABASE_URL: 'https://baza.test',
  SUPABASE_SERVICE_ROLE_KEY: KLUCZ,
  ADRESSCORE_HOSTY: 'adresscore.pl,www.adresscore.pl',
  NODE_ENV: 'production',
}
const ORIGIN = 'https://adresscore.pl'
const HOST = 'adresscore.pl'
const IP = '203.0.113.77'
const IP_PROXY = '70.41.3.18'
const IP_GNIAZDO = '192.0.2.200'
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ZnacznikUA-7f3a91'
const UA_GPTBOT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot'

/** Kolumny tabeli `zdarzenia` bez `id` i `czas` – przepisane z data-model.md, nie z kodu. */
const KOLUMNY = [
  'typ',
  'ekran',
  'sciezka',
  'odcisk',
  'kraj',
  'urzadzenie',
  'czy_bot',
  'bot_rodzina',
  'bot_klasa',
  'kanal',
  'referer_host',
  'referer_sciezka',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'click_id',
  'czas_ms',
  'scroll_pc',
  'sekcje',
  'cta',
  'etykieta',
  'kanal_udostepnienia',
  'nazwa',
  'wlasciwosci',
  'wartosc',
  'komunikat',
]

const WIERSZ_PUSTY = Object.fromEntries(KOLUMNY.map((k) => [k, null]))
const wiersz = (nad = {}) => ({ ...WIERSZ_PUSTY, czy_bot: false, ...nad })

const odslona = (nad = {}) => ({
  t: 'odslona',
  e: 'okolica',
  s: '/adres/ul-sloneczna-5',
  u: 'mobile',
  ...nad,
})
const wyjscie = (nad = {}) => ({
  t: 'wyjscie',
  e: 'okolica',
  s: '/adres/ul-sloneczna-5',
  u: 'mobile',
  ms: 12000,
  sc: 60,
  ...nad,
})
const klik = (nad = {}) => ({
  t: 'klik',
  e: 'okolica',
  s: '/adres/ul-sloneczna-5',
  u: 'desktop',
  et: 'karta§przycisk§Porównaj adresy',
  ...nad,
})
const udostepnienie = (nad = {}) => ({
  t: 'udostepnienie',
  e: 'okolica',
  s: '/adres/ul-sloneczna-5',
  u: 'desktop',
  et: 'karta',
  ku: 'link',
  ...nad,
})
const produktowe = (n, w, nad = {}) => ({
  t: 'produktowe',
  e: 'szukaj',
  s: '/',
  u: 'desktop',
  n,
  ...(w === undefined ? {} : { w }),
  ...nad,
})
const wital = (nad = {}) => ({
  t: 'wital',
  e: 'okolica',
  s: '/adres/ul-sloneczna-5',
  u: 'mobile',
  n: 'lcp',
  v: 1830.4,
  ...nad,
})
const blad = (nad = {}) => ({
  t: 'blad',
  e: 'okolica',
  s: '/adres/ul-sloneczna-5',
  u: 'mobile',
  k: 'TypeError: x is undefined',
  ...nad,
})

/** Atrapa fetch: sól i zapis rozpoznaje po adresie RPC; wszystkie wywołania się zapisują. */
function zbudujFetch({
  rzucaNaSoli = false,
  solStatus = 200,
  solWisi = false,
  rzucaNaZapisie = false,
  zapisStatus = 200,
  zapisWisi = false,
} = {}) {
  const wywolania = []
  const wisi = (init) =>
    new Promise((_ok, odrzuc) => {
      init.signal.addEventListener('abort', () => odrzuc(new DOMException('Aborted', 'AbortError')))
    })
  const fetchImpl = async (url, init) => {
    wywolania.push({ url: String(url), init })
    if (String(url).endsWith('/rpc/analityka_sol_dzis')) {
      if (solWisi) return wisi(init)
      if (rzucaNaSoli) throw new TypeError('fetch failed')
      return { ok: solStatus < 400, status: solStatus, json: async () => SOL }
    }
    if (zapisWisi) return wisi(init)
    if (rzucaNaZapisie) throw new TypeError('fetch failed')
    return { ok: zapisStatus < 400, status: zapisStatus, json: async () => 1 }
  }
  const zapisy = () => wywolania.filter((w) => w.url.endsWith('/rpc/zdarzenie_zapisz'))
  return {
    fetchImpl,
    wywolania,
    zapisy,
    wiersze: () => zapisy().flatMap((w) => JSON.parse(w.init.body).p_paczka),
  }
}

function atrapaRes() {
  const res = { statusCode: 0, naglowki: {}, zakonczona: false, argsEnd: undefined }
  res.setHeader = (nazwa, wartosc) => {
    res.naglowki[nazwa.toLowerCase()] = wartosc
  }
  res.end = (...args) => {
    res.zakonczona = true
    res.argsEnd = args
  }
  return res
}

/** Przechwytuje console.*: test sprawdza, co i czy cokolwiek poszło do logu (i nie śmieci w wyniku). */
async function zKonsola(praca) {
  const wpisy = []
  const metody = ['log', 'info', 'warn', 'error', 'debug']
  const oryginaly = Object.fromEntries(metody.map((m) => [m, console[m]]))
  for (const m of metody)
    console[m] = (...args) => wpisy.push(`${m}: ${args.map(String).join(' ')}`)
  try {
    return { wynik: await praca(), konsola: wpisy }
  } finally {
    Object.assign(console, oryginaly)
  }
}

const NAGLOWKI = {
  origin: ORIGIN,
  'user-agent': UA,
  'content-type': 'text/plain;charset=UTF-8',
  'x-forwarded-for': `${IP}, ${IP_PROXY}`,
  'cf-ipcountry': 'PL',
}

const bezPustych = (obiekt) =>
  Object.fromEntries(Object.entries(obiekt).filter(([, wartosc]) => wartosc !== undefined))
const jakoTekst = (tresc) => (typeof tresc === 'string' ? tresc : JSON.stringify(tresc))

function zStrumienia(bajty, naglowki, rozmiarKawalka) {
  const kawalki = []
  const krok = rozmiarKawalka ?? Math.max(bajty.length, 1)
  for (let i = 0; i < bajty.length; i += krok) kawalki.push(bajty.subarray(i, i + krok))
  const req = Readable.from(kawalki)
  req.method = 'POST'
  req.headers = naglowki
  req.socket = { remoteAddress: IP_GNIAZDO }
  return req
}

/**
 * Kształty żądania, jakie widzi adapter. `tresc` to obiekt (serializowany wg kształtu) albo
 * tekst, który ma dotrzeć bez zmian (zły JSON, ciało ponad limit).
 */
const KSZTALTY = [
  {
    nazwa: 'Vercel: req.body jako tekst (beacon text/plain)',
    zbuduj: (tresc, naglowki) => ({
      method: 'POST',
      headers: naglowki,
      body: jakoTekst(tresc),
      socket: { remoteAddress: IP_GNIAZDO },
    }),
  },
  {
    nazwa: 'Vercel: req.body jako obiekt (application/json)',
    zbuduj: (tresc, naglowki) => ({
      method: 'POST',
      headers: naglowki,
      body: typeof tresc === 'string' ? tresc : JSON.parse(JSON.stringify(tresc)),
      socket: { remoteAddress: IP_GNIAZDO },
    }),
  },
  {
    nazwa: 'Vercel: req.body jako bajty',
    zbuduj: (tresc, naglowki) => ({
      method: 'POST',
      headers: naglowki,
      body: Buffer.from(jakoTekst(tresc), 'utf8'),
      socket: { remoteAddress: IP_GNIAZDO },
    }),
  },
  {
    nazwa: 'node:http: strumień w jednym kawałku',
    zbuduj: (tresc, naglowki) => zStrumienia(Buffer.from(jakoTekst(tresc), 'utf8'), naglowki),
  },
  {
    nazwa: 'node:http: strumień w kawałkach po 7 bajtów',
    zbuduj: (tresc, naglowki) => zStrumienia(Buffer.from(jakoTekst(tresc), 'utf8'), naglowki, 7),
  },
]

/** Woła `handler` na atrapach. Zwraca odpowiedź, atrapę fetch i wszystko, co poszło do konsoli. */
async function uruchom(
  ksztalt,
  tresc,
  { naglowki = {}, env = ENV, fetchOpcje, timeoutMs, metoda = 'POST' } = {},
) {
  const f = zbudujFetch(fetchOpcje)
  const req = ksztalt.zbuduj(tresc, bezPustych({ ...NAGLOWKI, ...naglowki }))
  req.method = metoda
  const res = atrapaRes()
  const { konsola } = await zKonsola(() =>
    handler(req, res, { env, fetch: f.fetchImpl, timeoutMs }),
  )
  return { res, f, konsola }
}

/** To samo, co `uruchom`, ale na rdzeniu: zwraca wynik `obsluz` i atrapę fetch. */
async function zapisz(
  zdarzenia,
  { naglowki = {}, env = ENV, fetchOpcje, ip = IP, ...reszta } = {},
) {
  const f = zbudujFetch(fetchOpcje)
  const wynik = await obsluz({
    metoda: 'POST',
    cialo: JSON.stringify({ z: zdarzenia }),
    naglowki: bezPustych({ ...NAGLOWKI, ...naglowki }),
    ip,
    env,
    fetch: f.fetchImpl,
    ...reszta,
  })
  return { wynik, f }
}

beforeEach(() => resetujCacheSoli())

/* -------------------------------------------------------------------------- */
/* Kontrakt endpointu – ten sam zestaw na każdym kształcie żądania             */
/* -------------------------------------------------------------------------- */

for (const ksztalt of KSZTALTY) {
  describe(`endpoint – ${ksztalt.nazwa}`, () => {
    it('poprawna odsłona → 204 bez ciała, no-store, jeden zapis w kształcie kolumn', async () => {
      const { res, f, konsola } = await uruchom(ksztalt, { z: [odslona({ rh: 'www.google.com' })] })
      assert.equal(res.statusCode, 204)
      assert.equal(res.naglowki['cache-control'], 'no-store')
      assert.equal(res.zakonczona, true)
      assert.deepEqual(res.argsEnd, [])
      assert.deepEqual(konsola, [])
      // Dwa wywołania bazy: sól dnia i zapis.
      assert.equal(f.wywolania.length, 2)
      assert.deepEqual(f.wiersze(), [
        wiersz({
          typ: 'odslona',
          ekran: 'okolica',
          sciezka: '/adres/ul-sloneczna-5',
          odcisk: policzOdcisk(SOL, IP, UA, HOST),
          kraj: 'PL',
          urzadzenie: 'mobile',
          kanal: 'wyszukiwarka',
          referer_host: 'google.com',
        }),
      ])
    })

    it('żądanie do bazy: adres RPC, klucz service_role, ciało { p_paczka }, sygnał przerwania', async () => {
      const { f } = await uruchom(ksztalt, { z: [odslona()] })
      const zapis = f.zapisy()[0]
      assert.ok(zapis)
      assert.equal(zapis.url, 'https://baza.test/rest/v1/rpc/zdarzenie_zapisz')
      assert.equal(zapis.init.method, 'POST')
      assert.equal(zapis.init.headers.apikey, KLUCZ)
      assert.equal(zapis.init.headers.authorization, `Bearer ${KLUCZ}`)
      assert.equal(zapis.init.headers['content-type'], 'application/json')
      assert.deepEqual(Object.keys(JSON.parse(zapis.init.body)), ['p_paczka'])
      assert.ok(zapis.init.signal instanceof AbortSignal)
      const sol = f.wywolania[0]
      assert.equal(sol.url, 'https://baza.test/rest/v1/rpc/analityka_sol_dzis')
    })

    it('każdy wiersz ma dokładnie kolumny tabeli i ten sam zestaw kluczy', async () => {
      const { f } = await uruchom(ksztalt, {
        z: [
          odslona(),
          wyjscie(),
          klik(),
          udostepnienie(),
          produktowe('karta_adresu'),
          wital(),
          blad(),
        ],
      })
      const wiersze = f.wiersze()
      assert.equal(wiersze.length, 7)
      for (const w of wiersze) assert.deepEqual(Object.keys(w).sort(), [...KOLUMNY].sort())
    })

    it('405 dla metod innych niż POST: bez ciała, z Allow, bez wywołania bazy', async () => {
      for (const metoda of ['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
        const { res, f } = await uruchom(ksztalt, { z: [odslona()] }, { metoda })
        assert.equal(res.statusCode, 405, metoda)
        assert.equal(res.naglowki.allow, 'POST')
        assert.equal(res.naglowki['cache-control'], 'no-store')
        assert.deepEqual(res.argsEnd, [])
        assert.equal(f.wywolania.length, 0)
      }
    })

    it('403 przy braku albo obcym Originie, bez wywołania bazy', async () => {
      for (const origin of [
        undefined,
        '',
        'null',
        'https://evil.com',
        'https://adresscore.pl.evil.com',
        'https://evil.com/adresscore.pl',
        'https://adresscore.pl@evil.com',
        'https://adresscore.pl:8443',
        'adresscore.pl',
        'chrome-extension://abcdef',
        'file://',
        'javascript:alert(1)',
      ]) {
        const { res, f } = await uruchom(ksztalt, { z: [odslona()] }, { naglowki: { origin } })
        assert.equal(res.statusCode, 403, String(origin))
        assert.equal(res.naglowki['cache-control'], 'no-store')
        assert.deepEqual(res.argsEnd, [])
        assert.equal(f.wywolania.length, 0)
      }
    })

    it('Origin z www, wielkimi literami, http i jawnym portem 443 jest przyjmowany', async () => {
      for (const origin of [
        'https://www.adresscore.pl',
        'https://ADRESSCORE.PL',
        'http://adresscore.pl',
        'https://adresscore.pl:443',
      ]) {
        const { res } = await uruchom(ksztalt, { z: [odslona()] }, { naglowki: { origin } })
        assert.equal(res.statusCode, 204, origin)
      }
    })

    it('413 dla ciała ponad 16 384 bajtów, także gdy znaków jest mniej niż bajtów', async () => {
      const duzo = { z: [odslona({ smiec: 'x'.repeat(LIMIT_CIALA) })] }
      // 8200 znaków „ą” to 16 400 bajtów UTF-8, a liczba znaków mieści się w limicie.
      const wielobajtowe = { z: [odslona({ smiec: 'ą'.repeat(8200) })] }
      assert.ok(JSON.stringify(wielobajtowe).length < LIMIT_CIALA)
      for (const tresc of [duzo, wielobajtowe]) {
        const { res, f } = await uruchom(ksztalt, tresc)
        assert.equal(res.statusCode, 413)
        assert.equal(res.naglowki['cache-control'], 'no-store')
        assert.deepEqual(res.argsEnd, [])
        assert.equal(f.wywolania.length, 0)
      }
    })

    it('400 dla złego ciała: zły JSON, zły kształt, pusta i za duża paczka', async () => {
      const zle = [
        '',
        '{z:',
        '42',
        'null',
        '[]',
        '{}',
        '{"z":"x"}',
        '{"z":{}}',
        '{"z":[]}',
        '{"z":[1,"a",null,[]]}',
        { z: [{ ...odslona(), t: 'cos' }] },
        { z: Array.from({ length: MAX_PACZKA + 1 }, () => odslona()) },
      ]
      for (const tresc of zle) {
        const { res, f } = await uruchom(ksztalt, tresc)
        assert.equal(res.statusCode, 400, JSON.stringify(tresc).slice(0, 60))
        assert.equal(res.naglowki['cache-control'], 'no-store')
        assert.deepEqual(res.argsEnd, [])
        assert.equal(f.wywolania.length, 0)
      }
    })

    it('paczka dokładnie MAX_PACZKA zdarzeń jest przyjmowana w całości', async () => {
      const z = Array.from({ length: MAX_PACZKA }, (_, i) => odslona({ s: `/adres/a${i}` }))
      const { res, f } = await uruchom(ksztalt, { z })
      assert.equal(res.statusCode, 204)
      assert.deepEqual(
        f.wiersze().map((w) => w.sciezka),
        z.map((e) => e.s),
      )
    })

    it('paczka z poprawnymi i złymi zdarzeniami zapisuje tylko poprawne', async () => {
      const { res, f } = await uruchom(ksztalt, {
        z: [
          odslona(),
          { t: 'zly' },
          klik({ et: 'zla etykieta' }),
          null,
          'tekst',
          wyjscie({ ms: 'dużo' }),
          wital({ n: 'nieznana' }),
          wyjscie(),
          udostepnienie({ ku: 'telepatia' }),
        ],
      })
      assert.equal(res.statusCode, 204)
      assert.deepEqual(
        f.wiersze().map((w) => w.typ),
        ['odslona', 'wyjscie'],
      )
    })

    it('ciało z wielobajtowymi znakami (ąęśćżź) dochodzi w całości, także z kawałków', async () => {
      const { f } = await uruchom(ksztalt, {
        z: [klik({ et: 'karta§przycisk§Zażółć gęślą jaźń' })],
      })
      assert.equal(f.wiersze()[0].etykieta, 'karta§przycisk§Zażółć gęślą jaźń')
    })

    it('awaria fetch przy zapisie → 204', async () => {
      const { res, f, konsola } = await uruchom(
        ksztalt,
        { z: [odslona()] },
        { fetchOpcje: { rzucaNaZapisie: true } },
      )
      assert.equal(res.statusCode, 204)
      assert.equal(res.naglowki['cache-control'], 'no-store')
      assert.equal(f.zapisy().length, 1)
      assert.deepEqual(konsola, ['warn: zdarzenie: zapis nieudany (siec)'])
    })

    it('odpowiedź bazy z błędem HTTP → 204', async () => {
      const { res, konsola } = await uruchom(
        ksztalt,
        { z: [odslona()] },
        { fetchOpcje: { zapisStatus: 500 } },
      )
      assert.equal(res.statusCode, 204)
      assert.deepEqual(konsola, ['warn: zdarzenie: zapis nieudany (http-500)'])
    })

    it('timeout zapisu → 204, bez zawieszania żądania', async () => {
      const start = Date.now()
      const { res, konsola } = await uruchom(
        ksztalt,
        { z: [odslona()] },
        { fetchOpcje: { zapisWisi: true }, timeoutMs: 30 },
      )
      assert.equal(res.statusCode, 204)
      assert.ok(Date.now() - start < 1000)
      assert.deepEqual(konsola, ['warn: zdarzenie: zapis nieudany (timeout)'])
    })

    it('awaria soli (błąd sieci, HTTP 500, timeout): zapis idzie dalej z odciskiem null', async () => {
      for (const fetchOpcje of [{ rzucaNaSoli: true }, { solStatus: 500 }, { solWisi: true }]) {
        resetujCacheSoli()
        const { res, f } = await uruchom(ksztalt, { z: [odslona()] }, { fetchOpcje, timeoutMs: 30 })
        assert.equal(res.statusCode, 204, JSON.stringify(fetchOpcje))
        assert.equal(f.zapisy().length, 1)
        assert.equal(f.wiersze()[0].odcisk, null)
      }
    })

    it('brak zmiennych SUPABASE_* → 204 bez żadnego wywołania fetch', async () => {
      for (const env of [
        { ...ENV, SUPABASE_URL: undefined },
        { ...ENV, SUPABASE_SERVICE_ROLE_KEY: undefined },
        { ADRESSCORE_HOSTY: ENV.ADRESSCORE_HOSTY, NODE_ENV: 'production' },
      ]) {
        const { res, f, konsola } = await uruchom(ksztalt, { z: [odslona()] }, { env })
        assert.equal(res.statusCode, 204)
        assert.equal(f.wywolania.length, 0)
        assert.deepEqual(konsola, ['warn: zdarzenie: zapis nieudany (brak-konfiguracji)'])
      }
    })

    it('walidacja ma pierwszeństwo przed konfiguracją: zły kształt → 400 także bez SUPABASE_*', async () => {
      const { res } = await uruchom(ksztalt, '{}', { env: { ADRESSCORE_HOSTY: HOST } })
      assert.equal(res.statusCode, 400)
    })

    it('PRYWATNOŚĆ: IP i UA z żądania nie występują w wywołaniach bazy, w odpowiedzi ani w logu', async () => {
      const znaczniki = {
        'x-forwarded-for': `198.51.100.23, ${IP_PROXY}`,
        'x-real-ip': '192.0.2.55',
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) ZnacznikUA-9c1d42 Chrome/120.0.0.0 Safari/537.36',
      }
      const { res, f, konsola } = await uruchom(
        ksztalt,
        {
          z: [odslona(), wyjscie(), klik(), blad({ k: 'cos poszło nie tak' }), wital()],
        },
        { naglowki: znaczniki },
      )
      assert.equal(res.statusCode, 204)
      const wszystko = JSON.stringify([f.wywolania, res, konsola])
      for (const znacznik of [
        '198.51.100.23',
        IP_PROXY,
        '192.0.2.55',
        IP_GNIAZDO,
        znaczniki['user-agent'],
        'ZnacznikUA',
        'X11',
      ]) {
        assert.equal(wszystko.includes(znacznik), false, `wyciek: ${znacznik}`)
      }
      // Z IP i UA zostaje wyłącznie skrót.
      for (const w of f.wiersze()) assert.match(w.odcisk, /^[0-9a-f]{16}$/)
    })

    it('PRYWATNOŚĆ: UA bota nie trafia do bazy, tylko nazwa rodziny', async () => {
      const { f } = await uruchom(
        ksztalt,
        { z: [odslona()] },
        { naglowki: { 'user-agent': UA_GPTBOT } },
      )
      const wszystko = JSON.stringify(f.wywolania)
      assert.equal(wszystko.includes(UA_GPTBOT), false)
      assert.equal(wszystko.includes('openai.com'), false)
      assert.deepEqual(f.wiersze()[0].bot_rodzina, 'gptbot')
    })

    it('boty: UA crawlera AI → czy_bot, rodzina i klasa; człowiek → null; brak UA → narzędzie', async () => {
      const bot = await uruchom(
        ksztalt,
        { z: [odslona()] },
        { naglowki: { 'user-agent': UA_GPTBOT } },
      )
      assert.equal(bot.f.wiersze()[0].czy_bot, true)
      assert.equal(bot.f.wiersze()[0].bot_rodzina, 'gptbot')
      assert.equal(bot.f.wiersze()[0].bot_klasa, 'ai')

      const czlowiek = await uruchom(ksztalt, { z: [odslona()] })
      assert.equal(czlowiek.f.wiersze()[0].czy_bot, false)
      assert.equal(czlowiek.f.wiersze()[0].bot_rodzina, null)
      assert.equal(czlowiek.f.wiersze()[0].bot_klasa, null)

      const bezUa = await uruchom(
        ksztalt,
        { z: [odslona()] },
        { naglowki: { 'user-agent': undefined } },
      )
      assert.equal(bezUa.f.wiersze()[0].czy_bot, true)
      assert.equal(bezUa.f.wiersze()[0].bot_rodzina, 'brak-ua')
      assert.equal(bezUa.f.wiersze()[0].bot_klasa, 'narzedzie')
    })

    it('ruch bota jest zapisywany (z oznaczeniem), nie odrzucany', async () => {
      const { res, f } = await uruchom(
        ksztalt,
        { z: [odslona(), wyjscie()] },
        { naglowki: { 'user-agent': UA_GPTBOT } },
      )
      assert.equal(res.statusCode, 204)
      assert.equal(f.wiersze().length, 2)
      assert.ok(f.wiersze().every((w) => w.czy_bot === true))
    })

    it('kraj: cf-ipcountry, potem x-vercel-ip-country, XX i nieznany → null', async () => {
      const przypadki = [
        [{ 'cf-ipcountry': 'DE' }, 'DE'],
        [{ 'cf-ipcountry': undefined, 'x-vercel-ip-country': 'FR' }, 'FR'],
        [{ 'cf-ipcountry': 'XX' }, null],
        [{ 'cf-ipcountry': undefined }, null],
        [{ 'cf-ipcountry': 'T1' }, null],
      ]
      for (const [naglowki, oczekiwany] of przypadki) {
        const { f } = await uruchom(ksztalt, { z: [odslona()] }, { naglowki })
        assert.equal(f.wiersze()[0].kraj, oczekiwany, JSON.stringify(naglowki))
      }
    })

    it('odcisk jest wspólny dla paczki i nie zależy od wariantu Origin (host kanoniczny z konfiguracji)', async () => {
      const apex = await uruchom(ksztalt, { z: [odslona(), wyjscie()] })
      const www = await uruchom(
        ksztalt,
        { z: [odslona()] },
        { naglowki: { origin: 'https://www.adresscore.pl' } },
      )
      const odciski = apex.f.wiersze().map((w) => w.odcisk)
      assert.equal(odciski[0], odciski[1])
      assert.equal(odciski[0], policzOdcisk(SOL, IP, UA, HOST))
      assert.equal(www.f.wiersze()[0].odcisk, odciski[0])
    })

    it('odcisk zależy od UA i od IP (inny człowiek → inny odcisk)', async () => {
      const a = await uruchom(ksztalt, { z: [odslona()] })
      const innyUa = await uruchom(
        ksztalt,
        { z: [odslona()] },
        { naglowki: { 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1' } },
      )
      const innyIp = await uruchom(
        ksztalt,
        { z: [odslona()] },
        { naglowki: { 'x-forwarded-for': '203.0.113.78' } },
      )
      const odcisk = (u) => u.f.wiersze()[0].odcisk
      assert.notEqual(odcisk(a), odcisk(innyUa))
      assert.notEqual(odcisk(a), odcisk(innyIp))
    })
  })
}

/* -------------------------------------------------------------------------- */
/* Adapter: czytanie ciała, adres klienta, nagłówki odpowiedzi                  */
/* -------------------------------------------------------------------------- */

describe('adapter – czytanie ciała', () => {
  const treść = { z: [odslona()] }

  it('getter req.body rzuca przy złym JSON-ie (ApiError Vercela) → 400', async () => {
    const req = {
      method: 'POST',
      headers: NAGLOWKI,
      socket: {},
      get body() {
        throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 })
      },
    }
    const res = atrapaRes()
    const f = zbudujFetch()
    await zKonsola(() => handler(req, res, { env: ENV, fetch: f.fetchImpl }))
    assert.equal(res.statusCode, 400)
    assert.equal(f.wywolania.length, 0)
  })

  it('getter req.body rzuca 413 (ciało ponad limit parsera hostingu) → 413', async () => {
    const req = {
      method: 'POST',
      headers: NAGLOWKI,
      socket: {},
      get body() {
        throw Object.assign(new Error('Body exceeded 1mb limit'), { statusCode: 413 })
      },
    }
    const res = atrapaRes()
    await zKonsola(() => handler(req, res, { env: ENV, fetch: zbudujFetch().fetchImpl }))
    assert.equal(res.statusCode, 413)
  })

  it('deklarowany Content-Length ponad limit → 413, zanim ktokolwiek dotknie ciała', async () => {
    let odczytano = false
    const req = {
      method: 'POST',
      headers: { ...NAGLOWKI, 'content-length': String(LIMIT_CIALA + 1) },
      socket: {},
      get body() {
        odczytano = true
        return JSON.stringify(treść)
      },
    }
    const res = atrapaRes()
    await zKonsola(() => handler(req, res, { env: ENV, fetch: zbudujFetch().fetchImpl }))
    assert.equal(res.statusCode, 413)
    assert.equal(odczytano, false)
  })

  it('Content-Length ponad limit na strumieniu → 413 bez pobrania ani jednego kawałka', async () => {
    let pobrano = 0
    const req = Readable.from(
      (async function* () {
        pobrano += 1
        yield Buffer.from(JSON.stringify(treść))
      })(),
    )
    req.method = 'POST'
    req.headers = { ...NAGLOWKI, 'content-length': '99999' }
    req.socket = {}
    const res = atrapaRes()
    await zKonsola(() => handler(req, res, { env: ENV, fetch: zbudujFetch().fetchImpl }))
    assert.equal(res.statusCode, 413)
    assert.equal(pobrano, 0)
    req.destroy()
  })

  it('strumień bez deklarowanej długości: po przekroczeniu limitu 413 i koniec czytania', async () => {
    let pobrano = 0
    const req = Readable.from(
      (async function* () {
        for (let i = 0; i < 200; i += 1) {
          pobrano += 1
          yield Buffer.alloc(1024, 'x')
        }
      })(),
    )
    req.method = 'POST'
    req.headers = NAGLOWKI
    req.socket = {}
    const res = atrapaRes()
    const f = zbudujFetch()
    await zKonsola(() => handler(req, res, { env: ENV, fetch: f.fetchImpl }))
    assert.equal(res.statusCode, 413)
    // Połączenie zamykamy, bo reszta ciała zostaje nieprzeczytana.
    assert.equal(res.naglowki.connection, 'close')
    assert.equal(res.naglowki['cache-control'], 'no-store')
    assert.deepEqual(res.argsEnd, [])
    assert.equal(f.wywolania.length, 0)
    // Przeczytano ułamek ciała (limit to 16 kawałków po 1 KiB plus bufor strumienia), nie całość.
    assert.ok(pobrano < 100, `pobrano ${pobrano} z 200 kawałków`)
    req.destroy()
  })

  it('zły Origin ma pierwszeństwo przed rozmiarem: 403, nie 413', async () => {
    const req = Readable.from([Buffer.alloc(LIMIT_CIALA + 10, 'x')])
    req.method = 'POST'
    req.headers = { ...NAGLOWKI, origin: 'https://evil.com' }
    req.socket = {}
    const res = atrapaRes()
    await zKonsola(() => handler(req, res, { env: ENV, fetch: zbudujFetch().fetchImpl }))
    assert.equal(res.statusCode, 403)
    req.destroy()
  })

  it('błąd strumienia w trakcie czytania (zerwane połączenie) → 400, bez wyjątku', async () => {
    const req = new Readable({
      read() {
        this.destroy(new Error('aborted'))
      },
    })
    req.method = 'POST'
    req.headers = NAGLOWKI
    req.socket = {}
    const res = atrapaRes()
    await zKonsola(() => handler(req, res, { env: ENV, fetch: zbudujFetch().fetchImpl }))
    assert.equal(res.statusCode, 400)
  })

  it('minimalna atrapa tylko z asyncIterator (jak w _jev.test.js) też działa', async () => {
    const req = {
      method: 'POST',
      headers: NAGLOWKI,
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify(treść)
      },
    }
    const res = atrapaRes()
    const f = zbudujFetch()
    await zKonsola(() => handler(req, res, { env: ENV, fetch: f.fetchImpl }))
    assert.equal(res.statusCode, 204)
    assert.equal(f.wiersze().length, 1)
  })

  it('ciało dokładnie na granicy limitu (16 384 bajtów) przechodzi, o bajt więcej → 413', async () => {
    const baza = JSON.stringify(treść)
    const na = (bajty) => baza + ' '.repeat(bajty - Buffer.byteLength(baza))
    for (const ksztalt of [KSZTALTY[0], KSZTALTY[3]]) {
      const ok = await uruchom(ksztalt, na(LIMIT_CIALA))
      assert.equal(ok.res.statusCode, 204, ksztalt.nazwa)
      assert.equal(ok.f.wiersze().length, 1)
      const za = await uruchom(ksztalt, na(LIMIT_CIALA + 1))
      assert.equal(za.res.statusCode, 413, ksztalt.nazwa)
    }
  })

  it('handler bez trzeciego argumentu (domyślne env i fetch) odpowiada 405 na GET', async () => {
    const res = atrapaRes()
    await handler({ method: 'GET', headers: {} }, res)
    assert.equal(res.statusCode, 405)
    assert.equal(res.naglowki.allow, 'POST')
    assert.equal(res.naglowki['cache-control'], 'no-store')
  })

  it('PRZENOŚNOŚĆ: dotyka tylko wspólnego podzbioru Vercel Node i node:http (contracts/endpoint-zdarzenie.md)', async () => {
    // Proxy rzuca przy każdym polu spoza listy: `req.url`, `res.status()`, `res.json()`,
    // `res.writeHead()` itp. istnieją na Vercelu albo w node:http, ale nie w obu naraz.
    const scisle = (obiekt, dozwolone, nazwa) =>
      new Proxy(obiekt, {
        get(cel, klucz) {
          if (!dozwolone.includes(klucz))
            throw new Error(`${nazwa}: pole spoza podzbioru: ${String(klucz)}`)
          return Reflect.get(cel, klucz)
        },
        set(cel, klucz, wartosc) {
          if (!dozwolone.includes(klucz))
            throw new Error(`${nazwa}: zapis spoza podzbioru: ${String(klucz)}`)
          return Reflect.set(cel, klucz, wartosc)
        },
      })
    const POLA_REQ = ['method', 'headers', 'body', 'socket', Symbol.asyncIterator]
    const POLA_RES = ['statusCode', 'setHeader', 'end']
    const przypadki = [
      [{ method: 'POST', headers: NAGLOWKI, body: JSON.stringify(treść), socket: {} }, 204],
      [{ method: 'POST', headers: NAGLOWKI, body: treść, socket: {} }, 204],
      [
        {
          method: 'POST',
          headers: NAGLOWKI,
          async *[Symbol.asyncIterator]() {
            yield JSON.stringify(treść)
          },
        },
        204,
      ],
      [{ method: 'POST', headers: { ...NAGLOWKI, origin: 'https://evil.com' }, body: '{}' }, 403],
      [{ method: 'POST', headers: NAGLOWKI, body: '{zły json' }, 400],
      [{ method: 'POST', headers: { ...NAGLOWKI, 'content-length': '99999' }, body: '{}' }, 413],
      [{ method: 'GET', headers: {} }, 405],
    ]
    for (const [req, status] of przypadki) {
      const res = atrapaRes()
      const f = zbudujFetch()
      await zKonsola(() =>
        handler(scisle(req, POLA_REQ, 'req'), scisle(res, POLA_RES, 'res'), {
          env: ENV,
          fetch: f.fetchImpl,
        }),
      )
      assert.equal(res.statusCode, status)
      assert.equal(res.naglowki['cache-control'], 'no-store')
      assert.equal(res.zakonczona, true)
    }
  })
})

describe('adapter – adres klienta trafia wyłącznie do skrótu', () => {
  // Odcisk zależy od adresu IP, więc równość odcisków mówi, który adres adapter wybrał.
  async function odciskDla(req) {
    const res = atrapaRes()
    const f = zbudujFetch()
    await zKonsola(() => handler(req, res, { env: ENV, fetch: f.fetchImpl }))
    return f.wiersze()[0]?.odcisk
  }
  const cialo = JSON.stringify({ z: [odslona()] })
  const zadanie = (naglowki, socket) => ({
    method: 'POST',
    headers: bezPustych({ origin: ORIGIN, 'user-agent': UA, ...naglowki }),
    body: cialo,
    socket,
  })
  const dlaAdresu = (ip) => policzOdcisk(SOL, ip, UA, HOST)

  it('pierwszy wpis x-forwarded-for wygrywa nad resztą łańcucha', async () => {
    const odcisk = await odciskDla(zadanie({ 'x-forwarded-for': `${IP}, ${IP_PROXY}` }, {}))
    assert.equal(odcisk, dlaAdresu(IP))
  })

  it('x-forwarded-for podany jako tablica → pierwsza wartość', async () => {
    const odcisk = await odciskDla(
      zadanie({ 'x-forwarded-for': [`${IP}, 1.1.1.1`, '2.2.2.2'] }, {}),
    )
    assert.equal(odcisk, dlaAdresu(IP))
  })

  it('bez x-forwarded-for: x-real-ip', async () => {
    const odcisk = await odciskDla(
      zadanie({ 'x-real-ip': '192.0.2.55' }, { remoteAddress: IP_GNIAZDO }),
    )
    assert.equal(odcisk, dlaAdresu('192.0.2.55'))
  })

  it('bez obu nagłówków: adres gniazda', async () => {
    const odcisk = await odciskDla(zadanie({}, { remoteAddress: IP_GNIAZDO }))
    assert.equal(odcisk, dlaAdresu(IP_GNIAZDO))
  })

  it('bez niczego: stała „nieznany” (odcisk nadal powstaje)', async () => {
    assert.equal(await odciskDla(zadanie({}, undefined)), dlaAdresu('nieznany'))
  })

  it('pusty x-forwarded-for nie blokuje reszty', async () => {
    const odcisk = await odciskDla(
      zadanie({ 'x-forwarded-for': ' , ', 'x-real-ip': '192.0.2.55' }, {}),
    )
    assert.equal(odcisk, dlaAdresu('192.0.2.55'))
  })
})

describe('adapter – log', () => {
  it('udany zapis nie loguje niczego', async () => {
    const { konsola } = await uruchom(KSZTALTY[0], { z: [odslona()] })
    assert.deepEqual(konsola, [])
  })

  it('odrzucone żądania (400, 403, 405, 413) nie logują niczego', async () => {
    const wszystkie = [
      await uruchom(KSZTALTY[0], '{}'),
      await uruchom(KSZTALTY[0], { z: [odslona()] }, { naglowki: { origin: 'https://evil.com' } }),
      await uruchom(KSZTALTY[0], { z: [odslona()] }, { metoda: 'GET' }),
      await uruchom(KSZTALTY[0], 'x'.repeat(LIMIT_CIALA + 1)),
    ]
    for (const { konsola } of wszystkie) assert.deepEqual(konsola, [])
  })

  it('nieudany zapis loguje jedną linię ze stałym tekstem, bez danych z żądania', async () => {
    const { konsola } = await uruchom(
      KSZTALTY[0],
      { z: [odslona({ rh: 'tajny-host.example' })] },
      { fetchOpcje: { zapisStatus: 401 }, naglowki: { 'x-forwarded-for': '198.51.100.99' } },
    )
    assert.deepEqual(konsola, ['warn: zdarzenie: zapis nieudany (http-401)'])
  })
})

/* -------------------------------------------------------------------------- */
/* Rdzeń: Origin, hosty z konfiguracji, statusy                                 */
/* -------------------------------------------------------------------------- */

describe('obsluz – Origin i ADRESSCORE_HOSTY', () => {
  const status = async (origin, env) => {
    const { wynik } = await zapisz([odslona()], { naglowki: { origin }, env })
    return wynik.status
  }
  const DEV = { ...ENV, NODE_ENV: 'development' }
  delete DEV.ADRESSCORE_HOSTY

  it('localhost:5180 i 127.0.0.1:5180 poza produkcją są przyjmowane', async () => {
    assert.equal(await status('http://localhost:5180', DEV), 204)
    assert.equal(await status('http://127.0.0.1:5180', DEV), 204)
    assert.equal(await status('http://localhost:5180', { ...DEV, NODE_ENV: undefined }), 204)
    assert.equal(await status('http://localhost:5180', { ...DEV, VERCEL_ENV: 'development' }), 204)
  })

  it('tylko te dwa hosty deweloperskie: inny port albo host → 403', async () => {
    assert.equal(await status('http://localhost:5173', DEV), 403)
    assert.equal(await status('http://localhost', DEV), 403)
    assert.equal(await status('http://localhost:51800', DEV), 403)
    assert.equal(await status('http://evil.localhost:5180', DEV), 403)
    assert.equal(await status('http://192.168.0.5:5180', DEV), 403)
  })

  it('w produkcji localhost jest zakazany (NODE_ENV albo VERCEL_ENV)', async () => {
    assert.equal(await status('http://localhost:5180', { ...DEV, NODE_ENV: 'production' }), 403)
    assert.equal(await status('http://127.0.0.1:5180', { ...DEV, VERCEL_ENV: 'production' }), 403)
    // Na preview Vercela NODE_ENV też jest „production”.
    assert.equal(
      await status('http://localhost:5180', {
        ...DEV,
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
      }),
      403,
    )
    assert.equal(await status('http://localhost:5180', ENV), 403)
  })

  it('lokalny Origin nie wyłącza hostów z konfiguracji', async () => {
    const env = { ...DEV, ADRESSCORE_HOSTY: 'adresscore.pl' }
    assert.equal(await status('https://adresscore.pl', env), 204)
    assert.equal(await status('http://localhost:5180', env), 204)
    assert.equal(await status('https://evil.com', env), 403)
  })

  it('bez ADRESSCORE_HOSTY w produkcji każdy Origin dostaje 403', async () => {
    const env = { ...ENV, ADRESSCORE_HOSTY: undefined }
    assert.equal(await status(ORIGIN, env), 403)
    assert.equal(await status('http://localhost:5180', env), 403)
    assert.equal(await status(ORIGIN, { ...ENV, ADRESSCORE_HOSTY: '' }), 403)
    assert.equal(await status(ORIGIN, { ...ENV, ADRESSCORE_HOSTY: ' , ,' }), 403)
  })

  it('lista hostów: spacje, wielkie litery, puste wpisy, schemat i ścieżka są tolerowane', async () => {
    const env = {
      ...ENV,
      ADRESSCORE_HOSTY: ' AdresScore.PL , ,https://stary.example.pl/ ,www.trzeci.pl',
    }
    assert.equal(await status('https://adresscore.pl', env), 204)
    assert.equal(await status('https://www.adresscore.pl', env), 204)
    assert.equal(await status('https://stary.example.pl', env), 204)
    assert.equal(await status('https://trzeci.pl', env), 204)
    assert.equal(await status('https://czwarty.pl', env), 403)
  })

  it('odcisk liczy się z PIERWSZEGO hosta listy, niezależnie od Origin', async () => {
    const env = { ...ENV, ADRESSCORE_HOSTY: 'www.pierwszy.pl,drugi.pl' }
    const a = await zapisz([odslona()], { env, naglowki: { origin: 'https://drugi.pl' } })
    const b = await zapisz([odslona()], { env, naglowki: { origin: 'https://pierwszy.pl' } })
    const oczekiwany = policzOdcisk(SOL, IP, UA, 'pierwszy.pl')
    assert.equal(a.f.wiersze()[0].odcisk, oczekiwany)
    assert.equal(b.f.wiersze()[0].odcisk, oczekiwany)
  })

  it('referer z własnego hosta (dowolnego z listy) daje kanał „wewnetrzne”', async () => {
    const env = { ...ENV, ADRESSCORE_HOSTY: 'adresscore.pl,adresscore.vercel.app' }
    const { f } = await zapisz(
      [odslona({ rh: 'adresscore.vercel.app' }), odslona({ rh: 'www.adresscore.pl' })],
      { env },
    )
    assert.deepEqual(
      f.wiersze().map((w) => w.kanal),
      ['wewnetrzne', 'wewnetrzne'],
    )
  })

  it('Origin jest wymagany nawet dla poprawnej paczki; metoda sprawdzana przed Originem', async () => {
    const f = zbudujFetch()
    const bezOriginu = await obsluz({
      metoda: 'POST',
      cialo: JSON.stringify({ z: [odslona()] }),
      naglowki: {},
      ip: IP,
      env: ENV,
      fetch: f.fetchImpl,
    })
    assert.equal(bezOriginu.status, 403)
    const zlaMetodaIZlyOrigin = await obsluz({
      metoda: 'GET',
      cialo: null,
      naglowki: { origin: 'https://evil.com' },
      env: ENV,
      fetch: f.fetchImpl,
    })
    assert.equal(zlaMetodaIZlyOrigin.status, 405)
    assert.equal(f.wywolania.length, 0)
  })

  it('obsługuje nagłówki w postaci Headers (Fetch API)', async () => {
    const f = zbudujFetch()
    const wynik = await obsluz({
      metoda: 'POST',
      cialo: JSON.stringify({ z: [odslona()] }),
      naglowki: new Headers({ Origin: ORIGIN, 'User-Agent': UA, 'CF-IPCountry': 'SE' }),
      ip: IP,
      env: ENV,
      fetch: f.fetchImpl,
    })
    assert.equal(wynik.status, 204)
    assert.equal(f.wiersze()[0].kraj, 'SE')
  })
})

describe('obsluz – rozmiar i postać ciała', () => {
  const naglowki = { origin: ORIGIN, 'user-agent': UA }
  const wolaj = (cialo, dodatkowe = {}) =>
    obsluz({
      metoda: 'POST',
      cialo,
      naglowki: { ...naglowki, ...dodatkowe },
      ip: IP,
      env: ENV,
      fetch: zbudujFetch().fetchImpl,
    })

  it('CIALO_ZA_DUZE → 413 z Connection: close', async () => {
    const wynik = await wolaj(CIALO_ZA_DUZE)
    assert.deepEqual(wynik, { status: 413, naglowki: { Connection: 'close' } })
  })

  it('Content-Length ponad limit → 413 niezależnie od treści', async () => {
    const wynik = await wolaj(JSON.stringify({ z: [odslona()] }), {
      'content-length': String(LIMIT_CIALA + 1),
    })
    assert.equal(wynik.status, 413)
  })

  it('kłamliwy Content-Length (mniejszy niż ciało) nie przepuszcza dużego ciała', async () => {
    const wynik = await wolaj('x'.repeat(LIMIT_CIALA + 1), { 'content-length': '10' })
    assert.equal(wynik.status, 413)
  })

  it('nieczytelne ciało (undefined, null, liczba, funkcja) → 400', async () => {
    for (const cialo of [undefined, null, 42, () => {}, Symbol('x')]) {
      assert.equal((await wolaj(cialo)).status, 400)
    }
  })

  it('obiekt z cyklem (nie da się zmierzyć) → 400, bez wyjątku', async () => {
    const cykl = { z: [] }
    cykl.z.push(cykl)
    assert.equal((await wolaj(cykl)).status, 400)
  })

  it('obsługuje tekst, bajty i gotowy obiekt', async () => {
    const paczka = { z: [odslona()] }
    for (const cialo of [
      JSON.stringify(paczka),
      Buffer.from(JSON.stringify(paczka)),
      new Uint8Array(Buffer.from(JSON.stringify(paczka))),
      paczka,
    ]) {
      assert.equal((await wolaj(cialo)).status, 204)
    }
  })

  it('BOM na początku tekstu w bajtach jest tolerowany (TextDecoder go zdejmuje)', async () => {
    const bajty = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(JSON.stringify({ z: [odslona()] })),
    ])
    assert.equal((await wolaj(bajty)).status, 204)
  })

  it('klucze __proto__ i constructor w ciele nie zatruwają prototypów', async () => {
    const tekst =
      '{"z":[{"t":"odslona","e":"okolica","s":"/","u":"mobile","__proto__":{"zatrute":true},"constructor":{"prototype":{"zatrute":true}}}],"__proto__":{"zatrute":true}}'
    const f = zbudujFetch()
    const wynik = await obsluz({
      metoda: 'POST',
      cialo: tekst,
      naglowki,
      ip: IP,
      env: ENV,
      fetch: f.fetchImpl,
    })
    assert.equal(wynik.status, 204)
    assert.equal({}.zatrute, undefined)
    assert.equal(Object.hasOwn(f.wiersze()[0], 'zatrute'), false)
  })
})

describe('obsluz – wynik i pole „zapis”', () => {
  it('udany zapis: 204, zapis „ok”, liczba przyjętych zdarzeń', async () => {
    const { wynik } = await zapisz([odslona(), { t: 'zly' }, wyjscie()])
    assert.deepEqual(wynik, { status: 204, zapis: 'ok', przyjete: 2 })
  })

  it('powody nieudanego zapisu to stałe teksty', async () => {
    const przypadki = [
      [{ rzucaNaZapisie: true }, 'siec'],
      [{ zapisStatus: 500 }, 'http-500'],
      [{ zapisStatus: 401 }, 'http-401'],
      [{ zapisWisi: true }, 'timeout'],
    ]
    for (const [fetchOpcje, powod] of przypadki) {
      resetujCacheSoli()
      const { wynik } = await zapisz([odslona()], { fetchOpcje, timeoutMs: 30 })
      assert.equal(wynik.status, 204)
      assert.equal(wynik.zapis, powod)
    }
  })

  it('brak konfiguracji i brak fetch', async () => {
    const bez = await zapisz([odslona()], { env: { ADRESSCORE_HOSTY: HOST } })
    assert.equal(bez.wynik.zapis, 'brak-konfiguracji')
    assert.equal(bez.f.wywolania.length, 0)
    const wynik = await obsluz({
      metoda: 'POST',
      cialo: JSON.stringify({ z: [odslona()] }),
      naglowki: NAGLOWKI,
      ip: IP,
      env: ENV,
      fetch: undefined,
    })
    assert.deepEqual(wynik, { status: 204, zapis: 'brak-fetch', przyjete: 1 })
  })

  it('wyjątek z fetch wstrzykniętego nie wycieka (nigdy nie rzuca)', async () => {
    const wynik = await obsluz({
      metoda: 'POST',
      cialo: JSON.stringify({ z: [odslona()] }),
      naglowki: NAGLOWKI,
      ip: IP,
      env: ENV,
      fetch: () => {
        throw new Error('boom')
      },
    })
    assert.equal(wynik.status, 204)
  })

  it('wywołany bez żadnych argumentów nie rzuca (405)', async () => {
    assert.equal((await obsluz()).status, 405)
  })

  it('ip nietekstowe albo brakujące nie przewraca zapisu', async () => {
    for (const ip of [undefined, null, 42, {}]) {
      resetujCacheSoli()
      const { wynik } = await zapisz([odslona()], { ip })
      assert.equal(wynik.status, 204)
    }
  })

  it('sól jest pobierana raz na dobę: drugie żądanie nie woła analityka_sol_dzis', async () => {
    const f = zbudujFetch()
    const wolaj = () =>
      obsluz({
        metoda: 'POST',
        cialo: JSON.stringify({ z: [odslona()] }),
        naglowki: NAGLOWKI,
        ip: IP,
        env: ENV,
        fetch: f.fetchImpl,
        teraz: new Date('2026-10-05T10:00:00Z'),
      })
    await wolaj()
    await wolaj()
    assert.equal(f.wywolania.filter((w) => w.url.endsWith('analityka_sol_dzis')).length, 1)
    assert.equal(f.zapisy().length, 2)
  })
})

/* -------------------------------------------------------------------------- */
/* Walidacja zdarzeń                                                           */
/* -------------------------------------------------------------------------- */

describe('zwalidujZdarzenie – pola wspólne', () => {
  it('poprawne zdarzenie przechodzi z polami wspólnymi', () => {
    const z = zwalidujZdarzenie(odslona())
    assert.equal(z.typ, 'odslona')
    assert.equal(z.ekran, 'okolica')
    assert.equal(z.sciezka, '/adres/ul-sloneczna-5')
    assert.equal(z.urzadzenie, 'mobile')
  })

  it('nie-obiekty są pomijane', () => {
    for (const x of [null, undefined, 'x', 42, true, [], [odslona()]]) {
      assert.equal(zwalidujZdarzenie(x), null)
    }
  })

  it('typ spoza listy albo nie-tekst → pominięte', () => {
    for (const t of [
      'cos',
      '',
      'ODSLONA',
      'odslona ',
      1,
      null,
      undefined,
      'constructor',
      '__proto__',
    ]) {
      assert.equal(zwalidujZdarzenie({ ...odslona(), t }), null, String(t))
    }
  })

  it('ekran: ^[a-z_]{1,24}$', () => {
    for (const e of ['okolica', 'szukaj', 'a', 'a_b', 'x'.repeat(24), 'nowy_ekran_kiedys']) {
      assert.ok(zwalidujZdarzenie({ ...odslona(), e }), e)
    }
    for (const e of [
      '',
      'Okolica',
      'ok olica',
      'okolica1',
      'ok-olica',
      'x'.repeat(25),
      'ekran/',
      1,
      null,
    ]) {
      assert.equal(zwalidujZdarzenie({ ...odslona(), e }), null, String(e))
    }
    // Brak pola.
    const { e: _pominiete, ...bezEkranu } = odslona()
    assert.equal(zwalidujZdarzenie(bezEkranu), null)
  })

  it('urządzenie: tylko z listy i wymagane', () => {
    for (const u of ['mobile', 'tablet', 'desktop', 'inne'])
      assert.ok(zwalidujZdarzenie({ ...odslona(), u }))
    for (const u of ['phone', '', 'MOBILE', 1, null])
      assert.equal(zwalidujZdarzenie({ ...odslona(), u }), null)
    const { u: _pominiete, ...bezUrzadzenia } = odslona()
    assert.equal(zwalidujZdarzenie(bezUrzadzenia), null)
  })

  it('ścieżka: tekst 1..512 zaczynający się od „/”', () => {
    assert.equal(zwalidujZdarzenie({ ...odslona(), s: '/' }).sciezka, '/')
    assert.equal(zwalidujZdarzenie({ ...odslona(), s: `/${'a'.repeat(511)}` }).sciezka.length, 512)
    for (const s of [
      '',
      'okolica',
      'http://evil.com/',
      `/${'a'.repeat(512)}`,
      1,
      null,
      undefined,
      {},
      '?x=1',
    ]) {
      assert.equal(zwalidujZdarzenie({ ...odslona(), s }), null, String(s).slice(0, 30))
    }
  })

  it('ścieżka: wszystko od „?” i „#” jest odcinane (obrona w głąb)', () => {
    const przypadki = [
      ['/adres/abc?utm_source=x', '/adres/abc'],
      ['/adres/abc#sekcja', '/adres/abc'],
      ['/adres/abc?a=1#b', '/adres/abc'],
      ['/adres/abc#b?a=1', '/adres/abc'],
      ['/?token=sekret', '/'],
      ['/#/okolica/1', '/'],
      ['/porownanie?email=jan@example.com', '/porownanie'],
    ]
    for (const [wejscie, oczekiwana] of przypadki) {
      assert.equal(zwalidujZdarzenie({ ...odslona(), s: wejscie }).sciezka, oczekiwana, wejscie)
    }
  })

  it('ścieżka: znaki sterujące i osierocone połówki par zastępczych → pominięte', () => {
    for (const s of ['/a\u0000b', '/a\nb', '/a\tb', '/a\u007fb', '/a\ud800b']) {
      assert.equal(zwalidujZdarzenie({ ...odslona(), s }), null, JSON.stringify(s))
    }
  })

  it('ścieżka: polskie litery i procenty przechodzą bez zmian', () => {
    assert.equal(
      zwalidujZdarzenie({ ...odslona(), s: '/adres/zażółć-gęślą%20jaźń' }).sciezka,
      '/adres/zażółć-gęślą%20jaźń',
    )
  })
})

describe('zwalidujZdarzenie – odsłona', () => {
  it('minimalna odsłona: kanał bezpośredni, reszta null', () => {
    assert.deepEqual(zwalidujZdarzenie(odslona()), {
      typ: 'odslona',
      ekran: 'okolica',
      sciezka: '/adres/ul-sloneczna-5',
      urzadzenie: 'mobile',
      kanal: 'bezposrednie',
      referer_host: null,
      referer_sciezka: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      click_id: null,
    })
  })

  it('host referera: małe litery, bez www.; kanał z hosta', () => {
    const z = zwalidujZdarzenie(odslona({ rh: 'WWW.Google.COM' }))
    assert.equal(z.referer_host, 'google.com')
    assert.equal(z.kanal, 'wyszukiwarka')
  })

  it('host referera o złym kształcie → null (wejście bezpośrednie)', () => {
    for (const rh of [
      'http://evil.com/path',
      'evil.com/path',
      'zły host',
      'host?x=1',
      '',
      'x'.repeat(256),
      '-zly.pl',
      'zly-.pl',
      5,
      {},
      null,
    ]) {
      const z = zwalidujZdarzenie(odslona({ rh }))
      assert.equal(z.referer_host, null, String(rh).slice(0, 30))
      assert.equal(z.kanal, 'bezposrednie')
    }
  })

  it('host z portem i punycode przechodzą', () => {
    assert.equal(
      zwalidujZdarzenie(odslona({ rh: 'localhost:3000' })).referer_host,
      'localhost:3000',
    )
    assert.equal(
      zwalidujZdarzenie(odslona({ rh: 'xn--80ak6aa92e.com' })).referer_host,
      'xn--80ak6aa92e.com',
    )
  })

  it('ścieżka referera zostaje TYLKO dla hostów publicznych i bez query', () => {
    assert.equal(
      zwalidujZdarzenie(odslona({ rh: 't.co', rs: '/AbC123' })).referer_sciezka,
      '/AbC123',
    )
    assert.equal(
      zwalidujZdarzenie(odslona({ rh: 'old.reddit.com', rs: '/r/polska/comments/x?utm=1#y' }))
        .referer_sciezka,
      '/r/polska/comments/x',
    )
    // Host spoza listy: ścieżka mogłaby być intranetem albo tokenem w webmailu.
    assert.equal(
      zwalidujZdarzenie(odslona({ rh: 'intranet.firma.pl', rs: '/tajne' })).referer_sciezka,
      null,
    )
    // Czat AI: prywatna rozmowa.
    const czat = zwalidujZdarzenie(odslona({ rh: 'chatgpt.com', rs: '/c/9b2f-uuid' }))
    assert.equal(czat.referer_sciezka, null)
    assert.equal(czat.kanal, 'ai')
    // Bez hosta nie ma czego zachować.
    assert.equal(zwalidujZdarzenie(odslona({ rs: '/x' })).referer_sciezka, null)
  })

  it('ścieżka referera: sam „/”, brak „/” na początku, znaki sterujące, nie-tekst → null; długa jest ucinana', () => {
    for (const rs of ['/', 'abc', '', '/a\nb', 5, null]) {
      assert.equal(zwalidujZdarzenie(odslona({ rh: 't.co', rs })).referer_sciezka, null, String(rs))
    }
    const dluga = zwalidujZdarzenie(odslona({ rh: 't.co', rs: `/${'a'.repeat(300)}` }))
    assert.equal(dluga.referer_sciezka.length, 200)
  })

  it('UTM: małe litery, brzegi przycięte, ≤ 60 znaków, nie-tekst → null', () => {
    const z = zwalidujZdarzenie(odslona({ us: '  Facebook ', um: 'CPC', uc: 'Wiosna_2026' }))
    assert.equal(z.utm_source, 'facebook')
    assert.equal(z.utm_medium, 'cpc')
    assert.equal(z.utm_campaign, 'wiosna_2026')
    assert.equal(zwalidujZdarzenie(odslona({ us: 'a'.repeat(100) })).utm_source.length, MAX_UTM)
    for (const us of [5, {}, [], null, '', '   ']) {
      assert.equal(zwalidujZdarzenie(odslona({ us })).utm_source, null, JSON.stringify(us))
    }
  })

  it('UTM: wielkie litery o dłuższym zapisie małym (İ) nie przekraczają 60 znaków', () => {
    const z = zwalidujZdarzenie(odslona({ us: 'İ'.repeat(60) }))
    assert.ok(z.utm_source.length <= MAX_UTM)
  })

  it('UTM: znaki sterujące zamieniane na spacje, NUL nie przechodzi', () => {
    const z = zwalidujZdarzenie(odslona({ uc: 'wiosna\u0000\n2026\t!' }))
    assert.equal(z.utm_campaign, 'wiosna 2026 !')
    assert.equal(JSON.stringify(z).includes('\\u0000'), false)
  })

  it('click-id: przechodzi sama nazwa z listy, nigdy wartość', () => {
    for (const ci of CLICK_ID) assert.equal(zwalidujZdarzenie(odslona({ ci })).click_id, ci)
    for (const ci of [
      'gclid=EAIaIQobChMI',
      'EAIaIQobChMIxyz',
      'GCLID',
      'gclid ',
      '',
      5,
      null,
      {},
      ['gclid'],
    ]) {
      assert.equal(zwalidujZdarzenie(odslona({ ci })).click_id, null, JSON.stringify(ci))
    }
  })

  it('click-id wpływa na kanał, a wartość click-id nie trafia do wiersza', () => {
    const z = zwalidujZdarzenie(odslona({ ci: 'gclid=EAIaIQobChMI' }))
    assert.equal(z.kanal, 'bezposrednie')
    assert.equal(JSON.stringify(z).includes('EAIaIQ'), false)
    assert.equal(zwalidujZdarzenie(odslona({ ci: 'gclid' })).kanal, 'kampania')
    assert.equal(zwalidujZdarzenie(odslona({ ci: 'fbclid' })).kanal, 'social')
  })

  it('kanał liczy serwer: pola kanału z klienta są ignorowane', () => {
    const z = zwalidujZdarzenie(odslona({ kanal: 'ai', k: 'ai', rh: 'adresscore.pl' }), {
      wlasneHosty: ['adresscore.pl'],
    })
    assert.equal(z.kanal, 'wewnetrzne')
  })

  it('pola innych typów w odsłonie są ignorowane', () => {
    const z = zwalidujZdarzenie(odslona({ ms: 5000, sc: 50, et: 'a§przycisk§b', n: 'lcp', v: 3 }))
    assert.equal(Object.hasOwn(z, 'czas_ms'), false)
    assert.equal(Object.hasOwn(z, 'etykieta'), false)
    assert.equal(Object.hasOwn(z, 'nazwa'), false)
  })
})

describe('zwalidujZdarzenie – wyjście, sekcje i CTA', () => {
  it('czas i przewinięcie: zaokrąglone i przycięte do zakresu', () => {
    const z = (nad) => zwalidujZdarzenie(wyjscie(nad))
    assert.equal(z({ ms: 1234.6 }).czas_ms, 1235)
    assert.equal(z({ ms: MAX_CZAS_MS + 1 }).czas_ms, MAX_CZAS_MS)
    assert.equal(z({ ms: 2 ** 40 }).czas_ms, MAX_CZAS_MS)
    assert.equal(z({ ms: -5 }).czas_ms, 0)
    assert.equal(z({ ms: 0 }).czas_ms, 0)
    assert.equal(z({ sc: 150 }).scroll_pc, 100)
    assert.equal(z({ sc: -1 }).scroll_pc, 0)
    assert.equal(z({ sc: 55.5 }).scroll_pc, 56)
  })

  it('ms i sc są wymagane i muszą być skończonymi liczbami', () => {
    for (const zle of [
      '5000',
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      {},
      [],
      true,
    ]) {
      assert.equal(zwalidujZdarzenie(wyjscie({ ms: zle })), null, `ms ${String(zle)}`)
      assert.equal(zwalidujZdarzenie(wyjscie({ sc: zle })), null, `sc ${String(zle)}`)
    }
    const { ms: _ms, ...bezMs } = wyjscie()
    assert.equal(zwalidujZdarzenie(bezMs), null)
  })

  it('bez sekcji i CTA pola są null', () => {
    const z = zwalidujZdarzenie(wyjscie())
    assert.equal(z.sekcje, null)
    assert.equal(z.cta, null)
  })

  it('sekcje: trójki [klucz, ms, poz] → [{ k, ms, p }]', () => {
    const z = zwalidujZdarzenie(
      wyjscie({
        sk: [
          ['etykieta', 3000, 0],
          ['kategorie', 8000.4, 1],
        ],
      }),
    )
    assert.deepEqual(z.sekcje, [
      { k: 'etykieta', ms: 3000, p: 0 },
      { k: 'kategorie', ms: 8000, p: 1 },
    ])
  })

  it('sekcje: zepsuty wpis ginie, wyjście zostaje; nie-tablica → null', () => {
    const z = zwalidujZdarzenie(
      wyjscie({
        sk: [
          ['Etykieta', 1, 0], // wielka litera
          ['a b', 1, 0], // spacja
          ['', 1, 0],
          ['x'.repeat(49), 1, 0],
          ['dobra', '1', 0], // ms nie jest liczbą
          ['dobra', 1, Number.NaN],
          ['dobra', 1],
          'napis',
          null,
          { k: 'obiekt' },
          ['ok_sekcja-1', 5, 2],
        ],
      }),
    )
    assert.deepEqual(z.sekcje, [{ k: 'ok_sekcja-1', ms: 5, p: 2 }])
    assert.equal(z.czas_ms, 12000)
    for (const sk of ['x', {}, 5, null])
      assert.equal(zwalidujZdarzenie(wyjscie({ sk })).sekcje, null)
  })

  it('sekcje: czas przycięty do kapturu, powtórzony klucz liczony raz, najwyżej 24', () => {
    const z = zwalidujZdarzenie(
      wyjscie({
        sk: [
          ['a', MAX_CZAS_MS * 3, 0],
          ['a', 100, 1],
        ],
      }),
    )
    assert.deepEqual(z.sekcje, [{ k: 'a', ms: MAX_CZAS_MS, p: 0 }])
    const duzo = Array.from({ length: 40 }, (_, i) => [`s${i}`, 1, i])
    assert.equal(zwalidujZdarzenie(wyjscie({ sk: duzo })).sekcje.length, MAX_SEKCJI)
  })

  it('CTA: trójki [sekcja§cel, ekspozycje, kliki] → [{ k, e, n }]', () => {
    const z = zwalidujZdarzenie(
      wyjscie({
        ct: [
          ['etykieta§Porównaj adresy', 10, 2],
          ['mapa§warstwy', 4, 0],
        ],
      }),
    )
    assert.deepEqual(z.cta, [
      { k: 'etykieta§Porównaj adresy', e: 10, n: 2 },
      { k: 'mapa§warstwy', e: 4, n: 0 },
    ])
  })

  it('CTA: zepsute klucze i liczby giną, wpis 0/0 jest pomijany, licznik przycięty do 1000', () => {
    const z = zwalidujZdarzenie(
      wyjscie({
        ct: [
          ['bez-separatora', 1, 0],
          ['a§b§c', 1, 0], // trzy człony: to etykieta kliknięcia, nie klucz CTA
          ['Zla Sekcja§cel', 1, 0],
          ['§cel', 1, 0],
          ['a§cel', 'x', 0],
          ['a§cel', 1, Number.POSITIVE_INFINITY],
          ['a§cel', 0, 0],
          [5, 1, 1],
          ['dobra§cel', 5000, -3],
        ],
      }),
    )
    assert.deepEqual(z.cta, [{ k: 'dobra§cel', e: 1000, n: 0 }])
  })

  it('CTA: pusty cel → „bez-nazwy”, długi cel ucięty do 40, białe znaki zbite, powtórka liczona raz', () => {
    const z = zwalidujZdarzenie(
      wyjscie({
        ct: [
          ['a§', 3, 0],
          [`b§${'x'.repeat(100)}`, 1, 1],
          ['c§  dużo   spacji \n tu  ', 1, 0],
          ['a§', 9, 9],
        ],
      }),
    )
    assert.deepEqual(z.cta, [
      { k: 'a§bez-nazwy', e: 3, n: 0 },
      { k: `b§${'x'.repeat(MAX_CEL)}`, e: 1, n: 1 },
      { k: 'c§dużo spacji tu', e: 1, n: 0 },
    ])
  })

  it('CTA: najwyżej 12 wpisów', () => {
    const duzo = Array.from({ length: 30 }, (_, i) => [`s§c${i}`, 1, 0])
    assert.equal(zwalidujZdarzenie(wyjscie({ ct: duzo })).cta.length, MAX_CTA)
  })
})

describe('zwalidujZdarzenie – klik i udostępnienie', () => {
  it('klik: etykieta sekcja§rodzaj§cel przechodzi', () => {
    assert.equal(zwalidujZdarzenie(klik()).etykieta, 'karta§przycisk§Porównaj adresy')
  })

  it('klik: każdy rodzaj z kontraktu jest przyjmowany', () => {
    for (const rodzaj of RODZAJE_KLIKU) {
      assert.equal(
        zwalidujZdarzenie(klik({ et: `mapa§${rodzaj}§cel` })).etykieta,
        `mapa§${rodzaj}§cel`,
      )
    }
  })

  it('klik: zła sekcja, zły rodzaj, zła liczba członów, nie-tekst → pominięty', () => {
    for (const et of [
      'Karta§przycisk§cel', // wielka litera w sekcji
      'ka rta§przycisk§cel',
      '§przycisk§cel',
      `${'x'.repeat(49)}§przycisk§cel`,
      'karta§link§cel', // rodzaj spoza listy
      'karta§PRZYCISK§cel',
      'karta§§cel',
      'karta§przycisk', // dwa człony
      'karta§przycisk§cel§nadmiar', // cztery człony
      'karta',
      '',
      `karta§przycisk§${'x'.repeat(300)}`,
      5,
      null,
      {},
    ]) {
      assert.equal(zwalidujZdarzenie(klik({ et })), null, JSON.stringify(et)?.slice(0, 50))
    }
    const { et: _et, ...bezEtykiety } = klik()
    assert.equal(zwalidujZdarzenie(bezEtykiety), null)
  })

  it('klik: cel pusty → „bez-nazwy”, cel dłuższy niż 40 ucięty, znaki sterujące zamienione', () => {
    assert.equal(
      zwalidujZdarzenie(klik({ et: 'karta§martwy§' })).etykieta,
      'karta§martwy§bez-nazwy',
    )
    assert.equal(
      zwalidujZdarzenie(klik({ et: 'karta§martwy§   ' })).etykieta,
      'karta§martwy§bez-nazwy',
    )
    const dluga = zwalidujZdarzenie(klik({ et: `karta§przycisk§${'ż'.repeat(100)}` })).etykieta
    assert.equal(dluga, `karta§przycisk§${'ż'.repeat(MAX_CEL)}`)
    assert.equal(
      zwalidujZdarzenie(klik({ et: 'karta§przycisk§raz\ndwa\u0000trzy' })).etykieta,
      'karta§przycisk§raz dwa trzy',
    )
  })

  it('klik: całość etykiety mieści się w 120 znakach nawet przy najdłuższych członach', () => {
    const najdluzsza = `${'a'.repeat(48)}§link-wewn§${'b'.repeat(100)}`
    assert.ok(zwalidujZdarzenie(klik({ et: najdluzsza })).etykieta.length <= 120)
  })

  it('udostępnienie: element i kanał z listy', () => {
    for (const ku of KANALY_UDOSTEPNIENIA) {
      const z = zwalidujZdarzenie(udostepnienie({ ku }))
      assert.equal(z.etykieta, 'karta')
      assert.equal(z.kanal_udostepnienia, ku)
    }
  })

  it('udostępnienie: zły kanał albo pusty element → pominięte; długi element ucięty do 60', () => {
    for (const ku of ['telepatia', '', 'LINK', 5, null]) {
      assert.equal(zwalidujZdarzenie(udostepnienie({ ku })), null, String(ku))
    }
    for (const et of ['', '   ', 5, null, undefined]) {
      assert.equal(zwalidujZdarzenie(udostepnienie({ et })), null, String(et))
    }
    assert.equal(
      zwalidujZdarzenie(udostepnienie({ et: 'x'.repeat(100) })).etykieta.length,
      MAX_ELEMENT,
    )
  })
})

describe('zwalidujZdarzenie – zdarzenia produktowe', () => {
  it('każda nazwa z listy bez właściwości: przyjęta, właściwości null', () => {
    for (const n of NAZWY_PRODUKTOWE) {
      const z = zwalidujZdarzenie(produktowe(n))
      assert.equal(z.nazwa, n)
      assert.equal(z.wlasciwosci, null)
    }
  })

  it('nazwa spoza listy albo nie-tekst → pominięte', () => {
    for (const n of ['cos', '', 'WYSZUKANIE', 'wyszukanie ', 5, null, undefined, 'constructor']) {
      assert.equal(zwalidujZdarzenie(produktowe(n)), null, String(n))
    }
  })

  it('właściwości: nie-obiekt albo ponad 12 kluczy łamie kształt → zdarzenie pominięte', () => {
    for (const w of ['x', 5, true, ['a'], [{ wynikow: 1 }]]) {
      assert.equal(zwalidujZdarzenie(produktowe('wyszukanie', w)), null, JSON.stringify(w))
    }
    const trzynascie = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, i]))
    assert.equal(zwalidujZdarzenie(produktowe('wyszukanie', trzynascie)), null)
    const dwanascie = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i]))
    assert.equal(zwalidujZdarzenie(produktowe('wyszukanie', dwanascie)).wlasciwosci, null)
    // null i brak to „bez właściwości”.
    assert.equal(zwalidujZdarzenie(produktowe('wyszukanie', null)).wlasciwosci, null)
  })

  it('wyszukanie: wynikow (liczba całkowita ≥ 0) i rodzaj z listy; obce klucze giną', () => {
    const z = zwalidujZdarzenie(
      produktowe('wyszukanie', { wynikow: 12, rodzaj: 'ulica', obcy: 'x', fraza: 'ul. x' }),
    )
    assert.deepEqual(z.wlasciwosci, { wynikow: 12, rodzaj: 'ulica' })
    assert.deepEqual(zwalidujZdarzenie(produktowe('wyszukanie', { wynikow: 0 })).wlasciwosci, {
      wynikow: 0,
    })
    assert.deepEqual(zwalidujZdarzenie(produktowe('wyszukanie', { wynikow: 3.6 })).wlasciwosci, {
      wynikow: 4,
    })
  })

  it('wyszukanie: zła wartość ginie razem z kluczem, zdarzenie zostaje', () => {
    for (const w of [
      { wynikow: -1 },
      { wynikow: '12' },
      { wynikow: Number.POSITIVE_INFINITY },
      { wynikow: 1e9 },
      { rodzaj: 'miasto' },
      { rodzaj: 5 },
      { wynikow: null, rodzaj: null },
    ]) {
      const z = zwalidujZdarzenie(produktowe('wyszukanie', w))
      assert.ok(z, JSON.stringify(w))
      assert.equal(z.wlasciwosci, null, JSON.stringify(w))
    }
    assert.deepEqual(
      zwalidujZdarzenie(produktowe('wyszukanie', { wynikow: 'dużo', rodzaj: 'adres' })).wlasciwosci,
      { rodzaj: 'adres' },
    )
  })

  it('wyszukanie_bez_wyniku: fraza znormalizowana (małe litery, zbite spacje, ≤ 80 znaków)', () => {
    const z = zwalidujZdarzenie(
      produktowe('wyszukanie_bez_wyniku', { fraza: '  UL.   Nieistniejąca \n 5 ' }),
    )
    assert.deepEqual(z.wlasciwosci, { fraza: 'ul. nieistniejąca 5' })
    const dluga = zwalidujZdarzenie(
      produktowe('wyszukanie_bez_wyniku', { fraza: 'a '.repeat(100) }),
    )
    assert.ok(dluga.wlasciwosci.fraza.length <= MAX_FRAZA)
    assert.equal(dluga.wlasciwosci.fraza, dluga.wlasciwosci.fraza.trim())
  })

  it('wyszukanie_bez_wyniku: dane osobowe (e-mail, @, 9+ cyfr, także rozdzielonych) → znacznik „[odrzucono]”', () => {
    // Znaki, których nie wypisujemy w źródle (pełnoszerokie, pauza), składamy z kodów.
    const malpaPelnoszeroka = String.fromCharCode(0xff20)
    const pauza = String.fromCharCode(0x2014)
    const osobowe = [
      'jan.kowalski@example.com',
      'napisz do mnie @jan',
      'ul. x 5 jan@x',
      `jan${malpaPelnoszeroka}example.com`,
      '600123456',
      '600 123 456',
      '600-123-456',
      '600.123.456',
      '600 - 123 - 456',
      `600${pauza}123${pauza}456`,
      '+48 600 123 456',
      '+48 (12) 345 67 89',
      '44051401359',
      '123-456-78-90',
      '１２３４５６７８９', // cyfry pełnoszerokie
      `${'ul. dluga '.repeat(10)} kontakt: a@b.pl`, // adres poza pierwszymi 80 znakami
    ]
    for (const fraza of osobowe) {
      const z = zwalidujZdarzenie(produktowe('wyszukanie_bez_wyniku', { fraza }))
      assert.deepEqual(z.wlasciwosci, { fraza: '[odrzucono]', odrzucono: true }, fraza)
      assert.equal(JSON.stringify(z).includes('600'), false)
      assert.equal(JSON.stringify(z).includes('@'), false)
    }
  })

  it('wyszukanie_bez_wyniku: zwykłe adresy z numerami (poniżej 9 cyfr) nie są odrzucane', () => {
    for (const fraza of [
      '00-001 warszawa',
      'marszałkowska 100/102',
      'ul. słoneczna 5 m. 12',
      'plac 1000-lecia 3',
    ]) {
      const z = zwalidujZdarzenie(produktowe('wyszukanie_bez_wyniku', { fraza }))
      assert.deepEqual(z.wlasciwosci, { fraza: fraza.toLowerCase() }, fraza)
    }
  })

  it('wyszukanie_bez_wyniku: fraza odrzucona już przez klienta ma jedną postać znacznika', () => {
    const znacznik = { fraza: '[odrzucono]', odrzucono: true }
    // Tak wysyła klient (src/pomiar/rdzen.ts): fraza-znacznik i flaga razem.
    const odKlienta = zwalidujZdarzenie(produktowe('wyszukanie_bez_wyniku', znacznik))
    assert.deepEqual(odKlienta.wlasciwosci, znacznik)
    // Sama flaga (postać z contracts/pomiar-klient.md) daje to samo, więc lista braków grupuje
    // wszystkie odrzucone wyszukania w jednej pozycji.
    const tylkoFlaga = zwalidujZdarzenie(produktowe('wyszukanie_bez_wyniku', { odrzucono: true }))
    assert.deepEqual(tylkoFlaga.wlasciwosci, znacznik)
    // Fraza razem z flagą: fraza nie przechodzi, nawet gdy nie wygląda na dane osobowe.
    const oba = zwalidujZdarzenie(
      produktowe('wyszukanie_bez_wyniku', { odrzucono: true, fraza: 'ul. x' }),
    )
    assert.deepEqual(oba.wlasciwosci, znacznik)
    // „odrzucono: false” albo inny typ to nie znacznik.
    for (const odrzucono of [false, 'true', 1, null]) {
      assert.equal(
        zwalidujZdarzenie(produktowe('wyszukanie_bez_wyniku', { odrzucono })).wlasciwosci,
        null,
      )
    }
  })

  it('wyszukanie_bez_wyniku: brak pola fraza → zdarzenie zostaje (licznik braków), właściwości null', () => {
    for (const w of [undefined, {}, { fraza: 5 }, { fraza: null }, { fraza: ['x'] }]) {
      const z = zwalidujZdarzenie(produktowe('wyszukanie_bez_wyniku', w))
      assert.ok(z)
      assert.equal(z.wlasciwosci, null, JSON.stringify(w))
    }
  })

  it('wyszukanie_bez_wyniku: fraza pusta (jak u klienta) to znacznik „[odrzucono]”, nie brak', () => {
    for (const fraza of ['', '   ', '\n\t', '\u0000']) {
      const z = zwalidujZdarzenie(produktowe('wyszukanie_bez_wyniku', { fraza }))
      assert.deepEqual(
        z.wlasciwosci,
        { fraza: '[odrzucono]', odrzucono: true },
        JSON.stringify(fraza),
      )
    }
  })

  it('wyszukanie_bez_wyniku: fraza w postaci NFD jest sprowadzana do NFC (jedna pozycja listy)', () => {
    const rozlozona = 'Zażółć'.normalize('NFD')
    assert.notEqual(rozlozona, 'Zażółć')
    const z = zwalidujZdarzenie(produktowe('wyszukanie_bez_wyniku', { fraza: rozlozona }))
    assert.deepEqual(z.wlasciwosci, { fraza: 'zażółć' })
  })

  it('warstwa_mapy: warstwa to identyfikator ^[a-z][a-z0-9_]{0,63}$', () => {
    assert.deepEqual(
      zwalidujZdarzenie(produktowe('warstwa_mapy', { warstwa: 'halas_komunikacyjny' })).wlasciwosci,
      { warstwa: 'halas_komunikacyjny' },
    )
    for (const warstwa of [
      'Halas',
      '1warstwa',
      'ha las',
      'ha-las',
      '',
      'a'.repeat(65),
      5,
      null,
      '<script>',
    ]) {
      const z = zwalidujZdarzenie(produktowe('warstwa_mapy', { warstwa }))
      assert.ok(z, String(warstwa))
      assert.equal(z.wlasciwosci, null, String(warstwa))
    }
    assert.ok(
      zwalidujZdarzenie(produktowe('warstwa_mapy', { warstwa: 'a'.repeat(64) })).wlasciwosci,
    )
  })

  it('udostepnij: element ≤ 60 znaków i kanał z listy', () => {
    const z = zwalidujZdarzenie(produktowe('udostepnij', { element: 'karta', kanal: 'kopia' }))
    assert.deepEqual(z.wlasciwosci, { element: 'karta', kanal: 'kopia' })
    const dluga = zwalidujZdarzenie(
      produktowe('udostepnij', { element: 'x'.repeat(100), kanal: 'telepatia' }),
    )
    assert.deepEqual(dluga.wlasciwosci, { element: 'x'.repeat(MAX_ELEMENT) })
  })

  it('nazwy bez właściwości w kontrakcie gubią każdy klucz', () => {
    for (const n of [
      'karta_adresu',
      'porownanie_dodaj',
      'tryb_biznes',
      'tryb_miasto',
      'pomiar_wylaczony',
    ]) {
      const z = zwalidujZdarzenie(produktowe(n, { cokolwiek: 1, fraza: 'x', warstwa: 'a' }))
      assert.ok(z, n)
      assert.equal(z.wlasciwosci, null, n)
    }
  })

  it('klucze właściwości zgadzają się z deklaracją kontraktu (WLASCIWOSCI_PRODUKTOWE)', () => {
    // Najbogatszy poprawny zestaw dla każdej nazwy; wynik ma mieć dokładnie zadeklarowane klucze.
    const MAKS = {
      wyszukanie: [{ wynikow: 12, rodzaj: 'adres' }],
      // Fraza ALBO znacznik – razem dają zadeklarowane dwa klucze.
      wyszukanie_bez_wyniku: [{ fraza: 'ul. x' }, { odrzucono: true }],
      warstwa_mapy: [{ warstwa: 'halas' }],
      udostepnij: [{ element: 'karta', kanal: 'link' }],
    }
    for (const n of NAZWY_PRODUKTOWE) {
      const wyjscie = new Set()
      for (const w of MAKS[n] ?? [{ cokolwiek: 1 }]) {
        const z = zwalidujZdarzenie(produktowe(n, w))
        for (const klucz of Object.keys(z.wlasciwosci ?? {})) wyjscie.add(klucz)
      }
      assert.deepEqual([...wyjscie].sort(), [...WLASCIWOSCI_PRODUKTOWE[n]].sort(), n)
    }
  })
})

describe('zwalidujZdarzenie – Web Vitals', () => {
  it('każda metryka z kontraktu jest przyjmowana; wartość zaokrąglona do trzech miejsc', () => {
    for (const n of METRYKI_WITAL) {
      const z = zwalidujZdarzenie(wital({ n, v: 1.23456 }))
      assert.equal(z.nazwa, n)
      assert.equal(z.wartosc, 1.235)
    }
    assert.equal(zwalidujZdarzenie(wital({ n: 'cls', v: 0.0123 })).wartosc, 0.012)
    assert.equal(zwalidujZdarzenie(wital({ v: 0 })).wartosc, 0)
  })

  it('nazwa spoza listy albo brak wartości → pominięte', () => {
    for (const n of ['fid', 'LCP', '', 5, null])
      assert.equal(zwalidujZdarzenie(wital({ n })), null, String(n))
    for (const v of [-1, '1500', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      assert.equal(zwalidujZdarzenie(wital({ v })), null, String(v))
    }
  })

  it('zakres: CLS ≤ 10, pozostałe ≤ 600 000 ms; poza zakresem odrzucone (nie przycinane)', () => {
    assert.ok(zwalidujZdarzenie(wital({ n: 'cls', v: 10 })))
    assert.equal(zwalidujZdarzenie(wital({ n: 'cls', v: 10.01 })), null)
    assert.equal(zwalidujZdarzenie(wital({ n: 'cls', v: 5000 })), null)
    assert.ok(zwalidujZdarzenie(wital({ n: 'lcp', v: 600_000 })))
    assert.equal(zwalidujZdarzenie(wital({ n: 'lcp', v: 600_001 })), null)
  })
})

describe('zwalidujZdarzenie – błąd klienta', () => {
  it('komunikat przechodzi, białe znaki zbite, znaki sterujące zamienione na spacje', () => {
    assert.equal(
      zwalidujZdarzenie(blad({ k: '  TypeError:\n   x   is\tundefined\u0000 ' })).komunikat,
      'TypeError: x is undefined',
    )
  })

  it('komunikat ucięty do 200 znaków', () => {
    assert.equal(zwalidujZdarzenie(blad({ k: 'x'.repeat(500) })).komunikat.length, MAX_KOMUNIKAT)
    assert.equal(
      zwalidujZdarzenie(blad({ k: `${'ą'.repeat(199)}😀` })).komunikat.includes('�'),
      false,
    )
  })

  it('liczby od 7 cyfr (telefon, PESEL) zamieniane na „#”, krótsze zostają', () => {
    assert.equal(
      zwalidujZdarzenie(blad({ k: 'user 600123456 pesel 44051401359 kod 12345 rok 2026' }))
        .komunikat,
      'user # pesel # kod 12345 rok 2026',
    )
  })

  it('adresy bez query i fragmentu', () => {
    const z = zwalidujZdarzenie(
      blad({
        k: 'Failed to fetch https://adresscore.pl/api/x?token=sekret&email=a@b.pl#frag oraz http://x.pl/a',
      }),
    )
    assert.equal(z.komunikat, 'Failed to fetch https://adresscore.pl/api/x oraz http://x.pl/a')
  })

  it('e-maile w komunikacie są wycinane', () => {
    const z = zwalidujZdarzenie(
      blad({ k: 'Cannot read properties of undefined (reading jan.kowalski@example.com)' }),
    )
    assert.equal(z.komunikat.includes('@'), false)
    assert.equal(z.komunikat.includes('kowalski'), false)
  })

  it('pusty, nie-tekst albo brak komunikatu → pominięte', () => {
    for (const k of ['', '   ', '\u0000\n', 5, null, undefined, {}, ['x']]) {
      assert.equal(zwalidujZdarzenie(blad({ k })), null, JSON.stringify(k))
    }
  })

  it('osierocona połówka pary zastępczej nie trafia do jsonb', () => {
    const z = zwalidujZdarzenie(blad({ k: 'zły znak \ud800 w środku' }))
    assert.equal(z.komunikat.isWellFormed(), true)
  })
})

describe('zbudujWiersz', () => {
  const bot = { czyBot: false, rodzina: null, klasa: null }

  it('wszystkie typy dają wiersze z identycznym zestawem kluczy (kolumny tabeli)', () => {
    const zdarzenia = [
      odslona(),
      wyjscie({ sk: [['a', 1, 0]], ct: [['a§b', 1, 1]] }),
      klik(),
      udostepnienie(),
      produktowe('wyszukanie', { wynikow: 3 }),
      wital(),
      blad(),
    ]
    for (const surowe of zdarzenia) {
      const w = zbudujWiersz(zwalidujZdarzenie(surowe), { odcisk: null, kraj: null, bot })
      assert.deepEqual(Object.keys(w).sort(), [...KOLUMNY].sort(), surowe.t)
      for (const wartosc of Object.values(w)) assert.notEqual(wartosc, undefined)
    }
  })

  it('kontekst żądania (odcisk, kraj, bot) wchodzi do każdego wiersza; brak → null', () => {
    const czesc = zwalidujZdarzenie(odslona())
    const w = zbudujWiersz(czesc, {
      odcisk: '0123456789abcdef',
      kraj: 'PL',
      bot: { czyBot: true, rodzina: 'gptbot', klasa: 'ai' },
    })
    assert.equal(w.odcisk, '0123456789abcdef')
    assert.equal(w.kraj, 'PL')
    assert.equal(w.czy_bot, true)
    assert.equal(w.bot_rodzina, 'gptbot')
    assert.equal(w.bot_klasa, 'ai')
    const pusty = zbudujWiersz(czesc, { bot })
    assert.equal(pusty.odcisk, null)
    assert.equal(pusty.kraj, null)
    assert.equal(pusty.czy_bot, false)
  })

  it('kanał jest tylko w odsłonie, a kolumny cudzych typów są puste', () => {
    const wyj = zbudujWiersz(zwalidujZdarzenie(wyjscie()), { bot })
    assert.equal(wyj.kanal, null)
    assert.equal(wyj.nazwa, null)
    assert.equal(wyj.komunikat, null)
    assert.equal(wyj.czas_ms, 12000)
    assert.equal(wyj.scroll_pc, 60)
    const odsl = zbudujWiersz(zwalidujZdarzenie(odslona()), { bot })
    assert.equal(odsl.czas_ms, null)
    assert.equal(odsl.scroll_pc, null)
  })
})
