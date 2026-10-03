// Odczyt publicznych usług ArcGIS REST MSIP Kraków (MapServer, tylko zapytania o dane).
// Zasada: jedno pobranie do etl/.cache/msip/, drugi bieg czyta z dysku – bez pętli odpytującej
// (regulamin MSIP zakazuje ciągłego pośredniczenia w usługach miasta, więc liczymy pliki statyczne).
// Certyfikat hosta MSIP bywa odrzucany przez Node (brak pośredniego certyfikatu w łańcuchu):
// dopiero po takim błędzie ponawiamy żądanie z wyłączoną weryfikacją, i to wyłącznie dla tego hosta.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:https'
import { dirname, join } from 'node:path'
import { CACHE } from './wspolne.mjs'

export const MSIP = 'https://msip.um.krakow.pl/arcgis/rest/services'
const HOSTY_BEZ_WERYFIKACJI = ['msip.um.krakow.pl']
const STRONA = 1000 // maxRecordCount usług MSIP
const BLEDY_CERTYFIKATU = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ISSUER/

function pobierzBezWeryfikacji(url) {
  return new Promise((resolve, reject) => {
    const zadanie = request(url, { rejectUnauthorized: false }, (odp) => {
      const kawalki = []
      odp.on('data', (k) => kawalki.push(k))
      odp.on('end', () => {
        if (odp.statusCode !== 200) reject(new Error(`${url} → ${odp.statusCode}`))
        else resolve(Buffer.concat(kawalki).toString('utf8'))
      })
    })
    zadanie.on('error', reject)
    zadanie.end()
  })
}

/** Tekst z adresu URL. Parametr `hosty` istnieje dla testu ręcznego z hostem z samopodpisanym certyfikatem. */
export async function pobierzTekst(url, hosty = HOSTY_BEZ_WERYFIKACJI) {
  try {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`${url} → ${r.status}`)
    return await r.text()
  } catch (blad) {
    const kod = String(blad.cause?.code ?? blad.code ?? '')
    if (!hosty.includes(new URL(url).hostname) || !BLEDY_CERTYFIKATU.test(kod)) throw blad
    return await pobierzBezWeryfikacji(url)
  }
}

/** JSON z usługi MSIP; plik w etl/.cache/msip/<plik> powstaje raz. Błąd usługi nie trafia do cache. */
export async function pobierzJsonMsip(url, plik) {
  const cel = join(CACHE, 'msip', plik)
  if (!existsSync(cel)) {
    const dane = JSON.parse(await pobierzTekst(url))
    if (dane.error) throw new Error(`${url}: ${JSON.stringify(dane.error)}`)
    mkdirSync(dirname(cel), { recursive: true })
    writeFileSync(cel, JSON.stringify(dane))
  }
  return JSON.parse(readFileSync(cel, 'utf8'))
}

/**
 * Wszystkie obiekty warstwy (stronicowanie resultOffset), geometria w EPSG:2180 (układ usług SMK).
 * Zwraca { features, liczba, pola } i sprawdza, czy liczba obiektów zgadza się z returnCountOnly.
 */
export async function pobierzWarstweMsip(urlWarstwy, prefiks, opcje = {}) {
  const { where = '1=1', outFields = '*', outSR = 2180 } = opcje
  const info = await pobierzJsonMsip(`${urlWarstwy}?f=json`, `${prefiks}_info.json`)
  const oid = info.fields.find((p) => p.type === 'esriFieldTypeOID')?.name
  if (!oid) throw new Error(`${urlWarstwy}: brak pola OID`)
  const w = encodeURIComponent(where)
  const { count } = await pobierzJsonMsip(
    `${urlWarstwy}/query?where=${w}&returnCountOnly=true&f=json`,
    `${prefiks}_liczba.json`,
  )
  const features = []
  for (let od = 0; od < count; od += STRONA) {
    const strona = await pobierzJsonMsip(
      `${urlWarstwy}/query?where=${w}&outFields=${encodeURIComponent(outFields)}&orderByFields=${oid}&resultOffset=${od}&resultRecordCount=${STRONA}&returnGeometry=true&outSR=${outSR}&f=json`,
      `${prefiks}_${od}.json`,
    )
    features.push(...strona.features)
  }
  if (features.length !== count)
    throw new Error(`${urlWarstwy}: pobrano ${features.length} obiektów, usługa zgłasza ${count}`)
  return { features, liczba: count, pola: info.fields, geometria: info.geometryType }
}
