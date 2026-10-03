// POST /api/jev – pośrednik JEV (TypeSafe) z regułą zapasową (#15). Klucz `JEV_API_KEY` żyje
// wyłącznie w zmiennych Vercela; przeglądarka widzi tylko ten adres. Kontrakt i limity: `_jev.js`,
// klient z regułą zapasową: `src/ai/jev.ts`.
import { obsluz, utworzLimiter } from './_jev.js'

const MAKS_CIALO = 32_000
// Licznik żyje tyle, co ciepła instancja funkcji.
const limiter = utworzLimiter()

async function czytajCialo(req) {
  // Runtime Node Vercela parsuje JSON sam (getter rzuca przy złym JSON-ie).
  try {
    if (req.body !== undefined)
      return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return null
  }
  let tekst = ''
  for await (const kawalek of req) {
    tekst += kawalek
    if (tekst.length > MAKS_CIALO) return null
  }
  try {
    return JSON.parse(tekst)
  } catch {
    return null
  }
}

function ip(req) {
  const xff = req.headers?.['x-forwarded-for']
  const pierwszy = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim()
  return pierwszy || req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'nieznany'
}

export default async function handler(req, res, { fetch: fetchImpl, env = process.env } = {}) {
  const wynik = await obsluz({
    metoda: req.method,
    cialo: req.method === 'POST' ? await czytajCialo(req) : null,
    ip: ip(req),
    env,
    fetch: fetchImpl,
    limiter,
  })
  res.statusCode = wynik.status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  for (const [k, v] of Object.entries(wynik.naglowki ?? {})) res.setHeader(k, v)
  res.end(JSON.stringify(wynik.json))
}
