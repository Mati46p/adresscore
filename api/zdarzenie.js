// POST /api/zdarzenie – zapis zdarzeń pomiaru ruchu (panel admina, #/panel). To CIENKI adapter:
// czyta ciało i nagłówki, woła `obsluz` z `_zdarzenie.js` i zapisuje status. Cała decyzja
// (origin, rozmiar, walidacja, odcisk, bot, kraj, kanał, zapis do bazy) siedzi w `obsluz`,
// który testujemy bez sieci. Kontrakt: specs/001-panel-analityka/contracts/endpoint-zdarzenie.md.
//
// PRZENOŚNOŚĆ (FR-010). `handler(req, res, opcje)` używa wyłącznie wspólnego podzbioru
// Vercel Node i `node:http`: `req.method`, `req.headers`, `req.body` (opcjonalnie), strumienia
// `req`, `req.socket`, `res.statusCode`, `res.setHeader` i `res.end`. Na Vercelu plik jest
// funkcją sam z siebie. Na serwerze własnym (Coolify) wystarczy:
//   http.createServer((req, res) => handler(req, res)).listen(port)
// pod ścieżką /api/zdarzenie. Za proxy musi dochodzić prawdziwy adres klienta w pierwszym
// wpisie `x-forwarded-for` (albo w `x-real-ip`); inaczej wszyscy ludzie z jednym proxy
// zleją się w jeden odcisk, a pierwszy wpis dopisany przez samego klienta bywa fałszywy.
//
// ZMIENNE ŚRODOWISKOWE (serwerowe, nigdy VITE_*; w repo wyłącznie nazwy):
//   SUPABASE_URL                – adres projektu Supabase,
//   SUPABASE_SERVICE_ROLE_KEY   – klucz serwisowy (wolno mu wywołać `zdarzenie_zapisz`),
//   ADRESSCORE_HOSTY            – hosty serwisu po przecinku, np. adresscore.pl,www.adresscore.pl.
// Bez pierwszych dwóch zdarzenia są przyjmowane, ale nie zapisywane (204 i ostrzeżenie w logu).
// Bez trzeciej każdy Origin poza deweloperskim localhost:5180 dostaje 403.
//
// ODPOWIEDŹ: zawsze `Cache-Control: no-store`, nigdy ciała. Awaria bazy to 204 – analityka
// nie psuje nawigacji. W logu ląduje wyłącznie stały tekst z przyczyną zapisu; adres IP
// i User-Agent nie opuszczają tego pliku (idą tylko do `obsluz`, który zostawia z nich skrót).
import { CIALO_ZA_DUZE, obsluz } from './_zdarzenie.js'
import { LIMIT_CIALA } from './_zdarzenie-kontrakt.js'

/**
 * Czyta strumień żądania z limitem. Po przekroczeniu przestaje czytać i oddaje `CIALO_ZA_DUZE`.
 * Pętla jest ręczna (`next()`), bo `for await … break` wywołuje `return()`, a to niszczy
 * strumień, czyli w węźle HTTP także gniazdo: odpowiedź 413 nie doszłaby do klienta.
 * Reszta ciała zostaje nieprzeczytana, a odpowiedź niesie `Connection: close`.
 */
async function czytajStrumien(req) {
  const kawalki = []
  let bajty = 0
  const iterator = req[Symbol.asyncIterator]()
  for (;;) {
    const { done, value } = await iterator.next()
    if (done) break
    const kawalek = Buffer.isBuffer(value) ? value : Buffer.from(value)
    bajty += kawalek.length
    if (bajty > LIMIT_CIALA) return CIALO_ZA_DUZE
    kawalki.push(kawalek)
  }
  return Buffer.concat(kawalki)
}

/**
 * Ciało żądania w jednej z postaci, które rozumie `obsluz`: tekst, bajty, sparsowany obiekt,
 * `CIALO_ZA_DUZE` albo null (nieczytelne). Vercel parsuje `req.body` sam (tekst dla
 * text/plain, czyli beacona; obiekt dla JSON; bajty dla reszty), węzeł HTTP go nie ma i czytamy
 * strumień. Deklarowaną długość sprawdzamy PRZED dotknięciem `req.body`, bo samo odczytanie
 * go uruchamia parser hostingu.
 */
async function czytajCialo(req) {
  const deklarowana = Number.parseInt(String(req.headers?.['content-length'] ?? ''), 10)
  if (Number.isFinite(deklarowana) && deklarowana > LIMIT_CIALA) return CIALO_ZA_DUZE
  try {
    // Getter Vercela rzuca przy zepsutym JSON-ie (ApiError 400) i przy ciele ponad jego limit (413).
    if (req.body !== undefined) return req.body
  } catch (blad) {
    return blad?.statusCode === 413 ? CIALO_ZA_DUZE : null
  }
  try {
    return await czytajStrumien(req)
  } catch {
    return null
  }
}

/** Adres klienta jak w `api/jev.js`. Wolno go przekazać wyłącznie do `obsluz` (skrót odcisku). */
function ip(req) {
  const xff = req.headers?.['x-forwarded-for']
  const pierwszy = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim()
  return pierwszy || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'nieznany'
}

export default async function handler(
  req,
  res,
  { env = process.env, fetch: fetchImpl = globalThis.fetch, timeoutMs } = {},
) {
  let wynik
  try {
    wynik = await obsluz({
      metoda: req.method,
      cialo: req.method === 'POST' ? await czytajCialo(req) : null,
      naglowki: req.headers,
      ip: ip(req),
      env,
      fetch: fetchImpl,
      timeoutMs,
    })
  } catch {
    // `obsluz` nie rzuca, więc tu trafia tylko błąd odczytu żądania.
    wynik = { status: 400 }
  }
  // Powód nieudanego zapisu to stały tekst (`timeout`, `http-401`, `brak-konfiguracji`…) –
  // bez danych z żądania. Bez tej linii zepsuty klucz serwisowy wyglądałby jak cisza w ruchu.
  if (wynik.zapis && wynik.zapis !== 'ok') {
    console.warn(`zdarzenie: zapis nieudany (${wynik.zapis})`)
  }
  res.statusCode = wynik.status
  res.setHeader('Cache-Control', 'no-store')
  for (const [nazwa, wartosc] of Object.entries(wynik.naglowki ?? {})) res.setHeader(nazwa, wartosc)
  res.end()
}
