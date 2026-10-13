// Klient API otwartych danych m.st. Warszawy (dane.um.warszawa.pl, CKAN action API).
// Klucz: WARSZAWA_API_KEY ze zmiennej środowiska albo z pliku .env (korzeń repo, a dla worktree
// także katalog główny repozytorium). Klucza nigdy nie logujemy ani nie zapisujemy do cache.
// Pobranie jest jednorazowe: surowa odpowiedź leży w etl/.cache/warszawa-api/<action>.json,
// aby odświeżyć dane, usuń plik.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE, KORZEN } from './wspolne.mjs'

export const API = 'https://dane.um.warszawa.pl/api/action'
export const PORTAL = 'https://api.um.warszawa.pl'
export const PODKATALOG = 'warszawa-api'

/** Wartość klucza z tekstu pliku .env (bez cudzysłowów), albo null. */
export function kluczZEnv(tekst) {
  const m = /^\s*WARSZAWA_API_KEY\s*=\s*(.*?)\s*$/m.exec(tekst)
  const v = m?.[1]?.replace(/^(["'])(.*)\1$/, '$2')
  return v || null
}

export function wczytajKlucz() {
  if (process.env.WARSZAWA_API_KEY) return process.env.WARSZAWA_API_KEY
  // .env leży w repo głównym; worktree ma tylko kod, więc szukamy też w katalogu integracyjnym.
  const kandydaci = [join(KORZEN, '.env')]
  try {
    const wspolny = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: KORZEN,
        encoding: 'utf8',
      },
    ).trim()
    kandydaci.push(join(wspolny, '..', '.env'))
  } catch {}
  for (const p of kandydaci) {
    if (!existsSync(p)) continue
    const k = kluczZEnv(readFileSync(p, 'utf8'))
    if (k) return k
  }
  throw new Error('Brak WARSZAWA_API_KEY (zmienna środowiska albo plik .env)')
}

/**
 * Odpowiedź API → dane albo błąd. API zwraca HTTP 200 także przy {result:false,error:...}.
 * Poprawna odpowiedź to goła tablica (GeoJSON features, rekordy) albo obiekt z polem result.
 */
export function wyciagnijWynik(odp, action) {
  if (!odp || typeof odp !== 'object') throw new Error(`${action}: pusta odpowiedź`)
  if (Array.isArray(odp)) return odp
  if (odp.result === false || odp.error) {
    const e = odp.error
    throw new Error(`${action}: ${typeof e === 'string' ? e : JSON.stringify(e ?? odp)}`)
  }
  return odp.result ?? odp
}

async function jednoZapytanie(action, klucz, limitMs) {
  const r = await fetch(`${API}/${action}`, {
    method: 'POST',
    headers: { Authorization: klucz, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(limitMs),
  })
  if (!r.ok) throw new Error(`${action}: HTTP ${r.status}`)
  return wyciagnijWynik(await r.json(), action)
}

/** POST na action z jednym ponowieniem. Zwraca dane (tablicę albo pole result). */
export async function wywolaj(action, { limitMs = 120_000 } = {}) {
  const klucz = wczytajKlucz()
  try {
    return await jednoZapytanie(action, klucz, limitMs)
  } catch (pierwszy) {
    console.warn(
      `  ${action}: próba 1 nieudana (${pierwszy.cause?.code ?? pierwszy.message}), ponawiam`,
    )
    return await jednoZapytanie(action, klucz, limitMs)
  }
}

/** Surowy wynik action z cache (pobiera raz). Zwraca { result, pobrano }. */
export async function pobierzAction(action) {
  const dir = join(CACHE, PODKATALOG)
  mkdirSync(dir, { recursive: true })
  const plik = join(dir, `${action}.json`)
  if (!existsSync(plik)) {
    const result = await wywolaj(action)
    writeFileSync(plik, JSON.stringify({ pobrano: new Date().toISOString().slice(0, 10), result }))
  }
  return JSON.parse(readFileSync(plik, 'utf8'))
}

// ---------------------------------------------------------------------------------------------
// Wspólne dla warstw „odległość do najbliższego obiektu" (Warszawa)
// ---------------------------------------------------------------------------------------------

export const PORTAL_DANYCH = 'https://dane.um.warszawa.pl'
export const LICENCJA =
  'Dane otwarte m.st. Warszawy udostępniane na portalu dane.um.warszawa.pl; ponowne wykorzystanie na warunkach portalu, z podaniem źródła'

/** Skrypty Warszawy liczą adresy wskazane przez ADRESCORE_MIASTO; inne miasto = błąd, nie pusty plik. */
export function wymagajWarszawy(miasto) {
  if (miasto !== 'warszawa')
    throw new Error('Ustaw ADRESCORE_MIASTO=warszawa (ten skrypt liczy wyłącznie adresy Warszawy)')
}

/** Punkty z GeoJSON Feature (Point; współrzędne [lon, lat] albo [[lon, lat]]) → { lon, lat, atr }. */
export function punktyZFeatures(features) {
  const punkty = []
  for (const f of features) {
    let c = f?.geometry?.coordinates
    if (Array.isArray(c) && Array.isArray(c[0])) c = c[0]
    if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue
    punkty.push({ lon: c[0], lat: c[1], atr: f.properties ?? {} })
  }
  return punkty
}

/** Mediana liczb (null pomijane); brak liczb to null. */
export function mediana(wartosci) {
  const s = wartosci.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b)
  if (!s.length) return null
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Granice Warszawy z danych adresowych (lon/lat) powiększone o margines: odsiewa błędne punkty. */
export function ramkaAdresow(adresy, marginesStopni = 0.05) {
  let lon0 = Infinity
  let lon1 = -Infinity
  let lat0 = Infinity
  let lat1 = -Infinity
  for (const a of adresy) {
    lon0 = Math.min(lon0, a.lon)
    lon1 = Math.max(lon1, a.lon)
    lat0 = Math.min(lat0, a.lat)
    lat1 = Math.max(lat1, a.lat)
  }
  return {
    lon: [lon0 - marginesStopni, lon1 + marginesStopni],
    lat: [lat0 - marginesStopni, lat1 + marginesStopni],
  }
}

export const wRamce = (p, r) =>
  p.lon >= r.lon[0] && p.lon <= r.lon[1] && p.lat >= r.lat[0] && p.lat <= r.lat[1]
