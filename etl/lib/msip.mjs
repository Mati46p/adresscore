// Pobieranie warstw z usług ArcGIS REST portalu MSIP Obserwatorium (Gmina Miejska Kraków).
// Źródło w EPSG:2178 (CS2000 strefa 7) – zostawiamy współrzędne w metrach, bo odległości
// liczymy płasko (błąd skali układu poniżej 0,1% na kilkuset metrach).
// Licencja MSIP zabrania ciągłego pośredniczenia w usługach miasta, więc każda warstwa jest
// pobierana JEDNORAZOWO do etl/.cache/ (drugi bieg czyta z dysku), a wynik trafia do plików
// statycznych. Brak pętli odpytującej: strony idą po kolei, każda raz.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import { dirname, join } from 'node:path'
import proj4 from 'proj4'
import { CACHE } from './wspolne.mjs'

export const HOST_MSIP = 'msip.um.krakow.pl'
export const MSIP = `https://${HOST_MSIP}/arcgis/rest/services`
export const LICENCJA_MSIP = 'Regulamin MSIP: https://msip.krakow.pl/getHtml?dok_id=228972'
export const ATRYBUCJA_MSIP =
  'Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl)'

proj4.defs(
  'EPSG:2178',
  '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs',
)

/** Długość i szerokość geograficzna (WGS84) → metry w EPSG:2178 [x, y]. */
export const naMetry = (lon, lat) => proj4('EPSG:4326', 'EPSG:2178', [lon, lat])

const NAGLOWKI = { 'User-Agent': 'adresscore-etl/1.0 (HackYeah 2026; https://adresscore.pl)' }
const BLEDY_CERTYFIKATU = /CERT|SSL|SELF[_-]SIGNED|UNABLE_TO_VERIFY|ISSUER/i

// Certyfikat hosta MSIP bywa odrzucany przez Node (brakujący pośredni w łańcuchu). Wyłączamy
// weryfikację WYŁĄCZNIE dla tego jednego hosta i tylko po prawdziwym błędzie certyfikatu.
const agentMsip = new https.Agent({ rejectUnauthorized: false })

function pobierzHttpsBezWeryfikacji(url) {
  const adres = new URL(url)
  if (adres.hostname !== HOST_MSIP)
    return Promise.reject(
      new Error(`Brak weryfikacji certyfikatu dozwolony tylko dla ${HOST_MSIP}`),
    )
  return new Promise((resolve, reject) => {
    const zadanie = https.get(url, { agent: agentMsip, headers: NAGLOWKI }, (odp) => {
      const kawalki = []
      odp.on('data', (k) => kawalki.push(k))
      odp.on('end', () =>
        odp.statusCode === 200
          ? resolve(Buffer.concat(kawalki).toString('utf8'))
          : reject(new Error(`${url} → ${odp.statusCode}`)),
      )
      odp.on('error', reject)
    })
    zadanie.setTimeout(120_000, () => zadanie.destroy(new Error(`${url} → przekroczono czas`)))
    zadanie.on('error', reject)
  })
}

async function pobierzTekst(url) {
  let ostatni
  for (let proba = 1; proba <= 3; proba++) {
    try {
      const odp = await fetch(url, { headers: NAGLOWKI, signal: AbortSignal.timeout(120_000) })
      if (odp.ok) return await odp.text()
      ostatni = new Error(`${url} → ${odp.status}`)
      if (odp.status < 500) break
    } catch (blad) {
      const kod = `${blad.cause?.code ?? ''} ${blad.cause?.message ?? ''} ${blad.message}`
      if (BLEDY_CERTYFIKATU.test(kod)) return pobierzHttpsBezWeryfikacji(url)
      ostatni = blad
    }
    await new Promise((r) => setTimeout(r, 1500 * proba))
  }
  throw ostatni
}

/**
 * Pobiera JSON do etl/.cache/<plik> (raz). Odpowiedź z polem `error` NIE trafia do cache –
 * inaczej awaria usługi zostałaby zapamiętana jako dane i każdy kolejny bieg by ją powtarzał.
 */
export async function pobierzJsonDoCache(url, plik) {
  const cel = join(CACHE, plik)
  if (existsSync(cel)) return JSON.parse(readFileSync(cel, 'utf8'))
  const tekst = await pobierzTekst(url)
  const dane = JSON.parse(tekst)
  if (dane.error) throw new Error(`${url}: ${JSON.stringify(dane.error)}`)
  mkdirSync(dirname(cel), { recursive: true })
  writeFileSync(cel, tekst)
  return dane
}

const skrot = (tekst) => createHash('sha1').update(tekst).digest('hex').slice(0, 8)

/**
 * Wszystkie obiekty warstwy (MapServer/FeatureServer). Zamiast resultOffset dzielimy listę
 * identyfikatorów na zakresy OID – część warstw MSIP (np. rejestr palenisk) nie obsługuje
 * stronicowania, a zakres po OID działa na każdej i nie zależy od kolejności sortowania.
 * Strony są w cache pod nazwą ze skrótem zapytania, więc zmiana pól albo `where` nie czyta
 * starych odpowiedzi. Liczbę obiektów sprawdzamy przeciw liście identyfikatorów – ucięta
 * odpowiedź nie może po cichu dać połowy danych.
 *
 * @param {string} sciezka np. „Obserwatorium/MPEC/MapServer/2"
 * @param {{ katalog: string, pola?: string, geometria?: boolean, where?: string }} opcje
 */
export async function pobierzWarstwe(
  sciezka,
  { katalog, pola = '*', geometria = true, where = '1=1' },
) {
  const baza = `${MSIP}/${sciezka}`
  const info = await pobierzJsonDoCache(`${baza}?f=json`, `${katalog}/info.json`)
  const oid = info.fields?.find((p) => p.type === 'esriFieldTypeOID')?.name
  if (!oid) throw new Error(`${sciezka}: warstwa bez pola OID`)
  const limit = info.maxRecordCount ?? 1000
  const idQ = new URLSearchParams({ where, returnIdsOnly: 'true', f: 'json' })
  const { objectIds } = await pobierzJsonDoCache(`${baza}/query?${idQ}`, `${katalog}/id.json`)
  if (!Array.isArray(objectIds)) throw new Error(`${sciezka}: brak listy identyfikatorów`)
  const id = [...objectIds].sort((a, b) => a - b)

  const obiekty = []
  for (let od = 0; od < id.length; od += limit) {
    const dolny = id[od]
    const gorny = id[Math.min(od + limit, id.length) - 1]
    const q = new URLSearchParams({
      where: `(${where}) AND ${oid} >= ${dolny} AND ${oid} <= ${gorny}`,
      outFields: pola,
      returnGeometry: String(geometria),
      outSR: '2178',
      geometryPrecision: '2',
      f: 'json',
    }).toString()
    const strona = await pobierzJsonDoCache(
      `${baza}/query?${q}`,
      `${katalog}/s${od}-${skrot(q)}.json`,
    )
    obiekty.push(...strona.features)
  }
  if (obiekty.length !== id.length)
    throw new Error(`${sciezka}: pobrano ${obiekty.length} obiektów, usługa zgłasza ${id.length}`)
  return { obiekty, info, liczba: id.length }
}

/**
 * Data z pola esriFieldTypeDate (ms od 1970) jako RRRR-MM-DD w czasie polskim. Odświeżenie
 * warstw MSIP wypada po północy czasu lokalnego, a w UTC byłby to jeszcze poprzedni dzień.
 */
export const dataZMs = (ms) =>
  new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' })
