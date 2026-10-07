// Serwer produkcyjny na Hetznerze (Coolify): ten sam kontrakt co Vercel, bez Vercela.
// Podaje `dist/` (SPA + dane), odtwarza rewrites z `vercel.json` i woła funkcje `api/*`.
// Reguły routingu trzymaj zgodne z `vercel.json` – to tymczasowa kopia, dopóki Vercel żyje obok.
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import jev from '../api/jev.js'
import seo from '../api/seo.js'
import zdarzenie from '../api/zdarzenie.js'

const KORZEN = resolve(process.env.DIST_DIR ?? 'dist')
const PORT = Number(process.env.PORT ?? 3000)

const TYPY = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pmtiles': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}

const API = { '/api/seo': seo, '/api/jev': jev, '/api/zdarzenie': zdarzenie }

/** Rewrites z vercel.json: [wzorzec ścieżki, widok SEO]. Kolejność ma znaczenie. */
function przepisz(sciezka) {
  const adres = /^\/adres\/([^/]+)$/.exec(sciezka)
  if (adres) return `/api/seo?view=adres&slug=${adres[1]}`
  if (sciezka === '/katalog/ulice' || sciezka === '/katalog') return '/api/seo?view=katalog'
  const ulica = /^\/katalog\/([^/]+)$/.exec(sciezka)
  if (ulica) return `/api/seo?view=ulica&slug=${ulica[1]}`
  if (sciezka === '/metoda') return '/api/seo?view=metoda'
  if (
    sciezka.length > 1 &&
    !/^\/(assets\/|api\/|dane\/|mapa\/|sitemap|robots\.txt|llms\.txt|sw\.js|seo-boot\.js)/.test(
      sciezka,
    )
  ) {
    return '/api/seo?view=404'
  }
  return null
}

function naglowkiPliku(sciezka) {
  const naglowki = { 'X-Content-Type-Options': 'nosniff' }
  if (sciezka === '/sw.js') naglowki['Cache-Control'] = 'no-cache'
  else if (sciezka.startsWith('/assets/'))
    naglowki['Cache-Control'] = 'public, max-age=31536000, immutable'
  else naglowki['Cache-Control'] = 'public, max-age=300'
  return naglowki
}

async function plik(req, res, sciezka) {
  const wzgledna = normalize(sciezka === '/' ? '/index.html' : sciezka)
  const pelna = join(KORZEN, wzgledna)
  if (pelna !== KORZEN && !pelna.startsWith(KORZEN + sep)) return false
  let info
  try {
    info = await stat(pelna)
  } catch {
    return false
  }
  if (!info.isFile()) return false

  const naglowki = {
    ...naglowkiPliku(sciezka),
    'Content-Type': TYPY[extname(pelna)] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Last-Modified': info.mtime.toUTCString(),
  }
  if (sciezka === '/llms.txt') naglowki['Content-Type'] = 'text/plain; charset=utf-8'

  // PMTiles czyta mapę zakresami bajtów – bez Range mapa nie ruszy.
  const zakres = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (zakres && (zakres[1] || zakres[2])) {
    let od = zakres[1] ? Number(zakres[1]) : Math.max(info.size - Number(zakres[2]), 0)
    let doKonca = zakres[1] && zakres[2] ? Number(zakres[2]) : info.size - 1
    if (od >= info.size || od > doKonca) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` })
      res.end()
      return true
    }
    doKonca = Math.min(doKonca, info.size - 1)
    od = Math.max(od, 0)
    res.writeHead(206, {
      ...naglowki,
      'Content-Range': `bytes ${od}-${doKonca}/${info.size}`,
      'Content-Length': doKonca - od + 1,
    })
    if (req.method === 'HEAD') return res.end(), true
    createReadStream(pelna, { start: od, end: doKonca }).pipe(res)
    return true
  }

  res.writeHead(200, { ...naglowki, 'Content-Length': info.size })
  if (req.method === 'HEAD') return res.end(), true
  createReadStream(pelna).pipe(res)
  return true
}

async function obsluz(req, res) {
  const adres = new URL(req.url ?? '/', 'http://x')
  let sciezka
  try {
    sciezka = decodeURIComponent(adres.pathname)
  } catch {
    res.statusCode = 400
    return res.end()
  }

  if (sciezka === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    return res.end('ok')
  }

  const funkcja = API[sciezka]
  if (funkcja) return funkcja(req, res)

  if ((req.method === 'GET' || req.method === 'HEAD') && (await plik(req, res, sciezka))) return

  const cel = przepisz(adres.pathname)
  if (cel) {
    req.url = cel
    return seo(req, res)
  }

  res.statusCode = 404
  res.end('Not found')
}

createServer((req, res) => {
  obsluz(req, res).catch((blad) => {
    console.error('[serwer] nieobsłużony błąd:', blad?.message ?? blad)
    if (!res.headersSent) res.statusCode = 500
    res.end()
  })
}).listen(PORT, '0.0.0.0', () => console.log(`[serwer] słucha na :${PORT}, dist=${KORZEN}`))
