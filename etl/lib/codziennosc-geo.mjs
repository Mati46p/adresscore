// Pomocnicze funkcje warstwy „codzienność pieszo" (#8): indeks siatkowy do szukania
// najbliższego punktu oraz geokodowanie adresów rejestrów usługą GUGiK UUG.
// UUG (Usługa Usług Geokodowania): https://services.gugik.gov.pl/uug/ – bezpłatna, dane PRG/EMUiA.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import proj4 from 'proj4'
import { MIASTO_INFO } from './miasto.mjs'
import { CACHE } from './wspolne.mjs'

const RAD = Math.PI / 180
const PROMIEN_ZIEMI = 6_371_000
const M_NA_STOPIEN = (PROMIEN_ZIEMI * Math.PI) / 180
const LAT0 = MIASTO_INFO ? MIASTO_INFO.centrum.lat : 50.06
const LON0 = MIASTO_INFO ? MIASTO_INFO.centrum.lon : 19.9
const COS0 = Math.cos(LAT0 * RAD)

/** Odległość w linii prostej (wzór haversine), w metrach. */
export function odlegloscMetry(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * RAD
  const dLon = (bLon - aLon) * RAD
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * PROMIEN_ZIEMI * Math.asin(Math.min(1, Math.sqrt(s)))
}

// Płaskie metry wokół Krakowa wystarczają do wyboru kandydatów (błąd poniżej 0,1% na 30 km).
const plaskiX = (lon) => (lon - LON0) * COS0 * M_NA_STOPIEN
const plaskiY = (lat) => (lat - LAT0) * M_NA_STOPIEN

/**
 * Indeks siatkowy punktów { lat, lon, ... }. Komórka 500 m.
 * Zwraca funkcję najblizszy(lat, lon, maxM) → { punkt, metry } albo null.
 */
export function indeksPunktow(punkty, komorka = 500) {
  const siatka = new Map()
  const klucz = (cx, cy) => cx * 100_003 + cy
  for (const p of punkty) {
    p.x = plaskiX(p.lon)
    p.y = plaskiY(p.lat)
    const k = klucz(Math.floor(p.x / komorka), Math.floor(p.y / komorka))
    const lista = siatka.get(k)
    if (lista) lista.push(p)
    else siatka.set(k, [p])
  }

  return function najblizszy(lat, lon, maxM = 15_000) {
    const x = plaskiX(lon)
    const y = plaskiY(lat)
    const cx = Math.floor(x / komorka)
    const cy = Math.floor(y / komorka)
    const maxPierscien = Math.ceil(maxM / komorka) + 1
    let najlepszy = null
    let najlepszyD2 = Number.POSITIVE_INFINITY
    for (let r = 0; r <= maxPierscien; r++) {
      // Po przejrzeniu pierścienia r każdy punkt z dalszych pierścieni jest co najmniej (r) komórek dalej.
      if (najlepszy && Math.sqrt(najlepszyD2) <= (r - 1) * komorka) break
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const lista = siatka.get(klucz(cx + dx, cy + dy))
          if (!lista) continue
          for (const p of lista) {
            const d2 = (p.x - x) ** 2 + (p.y - y) ** 2
            if (d2 < najlepszyD2) {
              najlepszyD2 = d2
              najlepszy = p
            }
          }
        }
      }
    }
    if (!najlepszy) return null
    const metry = odlegloscMetry(lat, lon, najlepszy.lat, najlepszy.lon)
    return metry <= maxM ? { punkt: najlepszy, metry } : null
  }
}

/** Liczba punktów w promieniu (m) – do warstwy „usługi w 15 minut". */
export function czyWPromieniu(najblizszy, lat, lon, promien) {
  const wynik = najblizszy(lat, lon, promien)
  return wynik !== null && wynik.metry <= promien
}

const MALE_SLOWA = new Set(['w', 'we', 'z', 'ze', 'i', 'im.', 'od', 'na', 'do', 'przy', 'nr'])

/**
 * Rejestry (SIO, RPWDL) podają nazwy WIELKIMI LITERAMI. Zamieniamy je na zwykłą pisownię,
 * a nazwy już w normalnej pisowni zostawiamy bez zmian. Długie nazwy skracamy do 60 znaków.
 */
export function czytelnaNazwa(nazwa, max = 60) {
  let n = (nazwa ?? '').replace(/\s+/g, ' ').trim()
  if (n && n === n.toLocaleUpperCase('pl') && /\p{L}/u.test(n)) {
    n = n
      .toLocaleLowerCase('pl')
      .split(' ')
      .map((s, i) => {
        if (/\d/.test(s) || /^[ivxlc]+$/.test(s)) return s.toLocaleUpperCase('pl')
        if (i > 0 && MALE_SLOWA.has(s)) return s
        return s.charAt(0).toLocaleUpperCase('pl') + s.slice(1)
      })
      .join(' ')
  }
  return n.length > max ? `${n.slice(0, max - 1).trimEnd()}…` : n
}

// --- Geokodowanie UUG ---------------------------------------------------------------------

const UUG = 'https://services.gugik.gov.pl/uug/'
const PL1992 =
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs'
const PLIK_CACHE = join(CACHE, 'uug-cache-v2.json')
const MIN_DOKLADNOSC = 0.7

const PREFIKSY = [
  [/^ul\.\s*/i, ''],
  [/^al\.\s*/i, 'Aleja '],
  [/^os\.\s*/i, 'Osiedle '],
  [/^pl\.\s*/i, 'Plac '],
  [/^rondo\s+/i, 'Rondo '],
]

/** „ul. Stawowa", „al. Aleja Jana Pawła II" → nazwa ulicy w formie z PRG. */
export function normalizujUlice(ulica) {
  let u = (ulica ?? '').trim()
  if (!u) return ''
  for (const [wzor, zamiennik] of PREFIKSY) {
    if (wzor.test(u)) {
      u = u.replace(wzor, '')
      if (!u.toLowerCase().startsWith(zamiennik.trim().toLowerCase()) || !zamiennik)
        u = zamiennik + u
      break
    }
  }
  return u.replace(/\s+/g, ' ').trim()
}

/** „Kraków-Krowodrza, delegatura" → „Kraków". Inne miejscowości zostają bez zmian. */
export function normalizujMiejscowosc(miejscowosc) {
  const m = (miejscowosc ?? '').trim()
  if (/^Kraków\b/i.test(m)) return 'Kraków'
  if (MIASTO_INFO && m.split(/[-,]/)[0].trim().toLocaleLowerCase('pl') === MIASTO_INFO.nazwa.toLocaleLowerCase('pl'))
    return MIASTO_INFO.nazwa
  return m
}

/** „5-7", „3/LU1", „14bud.C" → „5", „3", „14"; „29A-B" → „29A". PRG zna tylko pojedynczy numer. */
export function normalizujNumer(nr) {
  const m = /^\d+(?:[A-Za-z](?![A-Za-z0-9]))?/.exec(String(nr ?? '').replace(/\s+/g, ''))
  return m ? m[0] : ''
}

/** Zapytanie do UUG: „Kraków, Stawowa 61" albo, dla wsi bez ulic, „Dobranowice 121". */
export function zapytanieAdresowe({ miejscowosc, ulica, nr }) {
  const m = normalizujMiejscowosc(miejscowosc)
  const u = normalizujUlice(ulica)
  const numer = normalizujNumer(nr)
  if (!m || !numer) return null
  return u ? `${m}, ${u} ${numer}` : `${m} ${numer}`
}

function wczytajCache() {
  if (!existsSync(PLIK_CACHE)) return {}
  try {
    return JSON.parse(readFileSync(PLIK_CACHE, 'utf8'))
  } catch {
    return {}
  }
}

function zapiszCache(cache) {
  mkdirSync(CACHE, { recursive: true })
  const tmp = `${PLIK_CACHE}.tmp`
  writeFileSync(tmp, JSON.stringify(cache))
  renameSync(tmp, PLIK_CACHE)
}

async function zapytajUug(zapytanie, kod, proby = 4) {
  const url = `${UUG}?request=GetAddress&address=${encodeURIComponent(zapytanie)}`
  for (let i = 0; i < proby; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!r.ok) throw new Error(`UUG ${r.status}`)
      const tekst = await r.text()
      // Na nietypowe zapytania UUG odpowiada zwykłym tekstem „Blad zapytania." – to brak wyniku, nie awaria.
      if (!tekst.startsWith('{')) return null
      const j = JSON.parse(tekst)
      const wyniki = Object.values(j.results ?? {})
      const numer = zapytanie.split(' ').at(-1).toLowerCase()
      // Przy kilku wsiach o tej samej nazwie wygrywa ta z zgodnym kodem pocztowym, potem trafność.
      const dobre = wyniki
        .filter(
          (w) => Number(w.accuracy) >= MIN_DOKLADNOSC && String(w.number).toLowerCase() === numer,
        )
        .sort(
          (a, b) =>
            Number(kod && b.code === kod) - Number(kod && a.code === kod) ||
            Number(b.accuracy) - Number(a.accuracy),
        )
      const w = dobre[0]
      if (!w) return null
      const [lon, lat] = proj4(PL1992, 'EPSG:4326', [Number(w.x), Number(w.y)])
      return { lon: Math.round(lon * 1e6) / 1e6, lat: Math.round(lat * 1e6) / 1e6 }
    } catch (e) {
      if (i === proby - 1) throw e
      await new Promise((ok) => setTimeout(ok, 500 * (i + 1)))
    }
  }
  return null
}

/**
 * Geokoduje listę adresów { miejscowosc, ulica, nr }. Zwraca tablicę {lon, lat} | null w tej samej
 * kolejności. Wyniki (też puste) trafiają do etl/.cache/uug-cache.json, więc drugi bieg nie pyta UUG.
 */
export async function geokoduj(adresy, { wspolbieznosc = 6 } = {}) {
  const cache = wczytajCache()
  const zapytania = adresy.map((a) => {
    const z = zapytanieAdresowe(a)
    return z ? { z, kod: a.kod || null, klucz: `${z}|${a.kod || ''}` } : null
  })
  const unikalne = new Map()
  for (const q of zapytania) if (q && !(q.klucz in cache)) unikalne.set(q.klucz, q)
  const doZrobienia = [...unikalne.values()]
  let zrobione = 0
  const kolejka = [...doZrobienia]
  const robotnik = async () => {
    while (kolejka.length) {
      const q = kolejka.pop()
      cache[q.klucz] = await zapytajUug(q.z, q.kod)
      zrobione++
      if (zrobione % 500 === 0) {
        zapiszCache(cache)
        console.log(`  geokodowanie UUG: ${zrobione}/${doZrobienia.length}`)
      }
    }
  }
  await Promise.all(Array.from({ length: wspolbieznosc }, robotnik))
  if (doZrobienia.length) zapiszCache(cache)
  return zapytania.map((q) => (q ? (cache[q.klucz] ?? null) : null))
}
