// Wspólne dla etl/powietrze.mjs i etl/powietrze-kontrola.mjs: mapy stężeń GIOŚ (ArcGIS MapServer).
// Usługa: https://wody.gios.gov.pl/arcgis/rest/services/PJP2_MapServices/ModelowanieNaPotrzebyOcen/MapServer
// Warstwa = jeden rok i jeden wskaźnik, wielokąty oczek siatki w EPSG:2180 (PUWG 1992).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import proj4 from 'proj4'
import { CACHE } from './wspolne.mjs'

export const USLUGA =
  'https://wody.gios.gov.pl/arcgis/rest/services/PJP2_MapServices/ModelowanieNaPotrzebyOcen/MapServer'

proj4.defs(
  'EPSG:2180',
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs',
)
/** [lon, lat] → [x, y] w EPSG:2180. */
export const doPuwg = (lon, lat) => proj4('EPSG:4326', 'EPSG:2180', [lon, lat])

/** Wskaźniki roczne ochrony zdrowia: nazwa w warstwie → pole atrybutu i id wskaźnika. */
export const WSKAZNIKI = {
  'PM2.5': { pole: 'o_pm25_a', id: 'pm25_srednia' },
  PM10: { pole: 'o_pm10_a', id: 'pm10_srednia' },
  NO2: { pole: 'o_no2_a', id: 'no2_srednia' },
  BaP: { pole: 'o_bap_a', id: 'bap_srednia' },
}

const czekaj = (ms) => new Promise((r) => setTimeout(r, ms))

async function zapytaj(url, parametry, proby = 5) {
  for (let p = 1; ; p++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ f: 'json', ...parametry }),
        signal: AbortSignal.timeout(90_000),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      const j = await r.json()
      if (j.error) throw new Error(j.error.message)
      return j
    } catch (e) {
      if (p >= proby) throw new Error(`${url}: ${e.message}`)
      await czekaj(2000 * p)
    }
  }
}

export function jsonZCache(plik, pobierz) {
  mkdirSync(CACHE, { recursive: true })
  const cel = join(CACHE, plik)
  if (existsSync(cel)) return JSON.parse(readFileSync(cel, 'utf8'))
  return Promise.resolve(pobierz()).then((dane) => {
    writeFileSync(cel, JSON.stringify(dane))
    return dane
  })
}

/** Najnowszy rok, dla którego usługa ma wszystkie cztery wskaźniki. Zwraca { rok, warstwy: {wskaznik: idWarstwy} }. */
export async function znajdzRok() {
  const opis = await jsonZCache('gios_model_uslugi.json', () => zapytaj(USLUGA, {}))
  const wg = {}
  for (const l of opis.layers) {
    const m = /^(\d{4}) Ochrona zdrowia (PM10|PM2\.5|BaP|NO2) \(śr\. roczna\)$/.exec(l.name)
    if (m) (wg[m[1]] ??= {})[m[2]] = l.id
  }
  const rok = Object.keys(wg)
    .filter((r) => Object.keys(WSKAZNIKI).every((w) => wg[r][w] !== undefined))
    .sort()
    .at(-1)
  if (!rok) throw new Error('Brak roku z kompletem wskaźników w usłudze GIOŚ')
  return { rok, warstwy: wg[rok] }
}

/**
 * Pobiera wszystkie oczka warstwy w prostokącie [xmin,ymin,xmax,ymax] (EPSG:2180).
 * Usługa nie ma stronicowania (limit 1000 obiektów), więc dzielimy prostokąt na kafle
 * i dzielimy dalej, gdy kafel przekracza limit. Wynik w cache.
 * Oczko: { fid, id, zone, v, x0, y0, x1, y1, ring: [x,y,...] }.
 */
export async function pobierzOczka(rok, wskaznik, idWarstwy, bbox) {
  const { pole } = WSKAZNIKI[wskaznik]
  const nazwa = `gios_model_${rok}_${wskaznik.replace('.', '')}_${bbox.map(Math.round).join('_')}.json`
  return jsonZCache(nazwa, async () => {
    const oczka = new Map()
    async function kafel(b, glebokosc = 0) {
      const j = await zapytaj(`${USLUGA}/${idWarstwy}/query`, {
        where: '1=1',
        geometry: b.join(','),
        geometryType: 'esriGeometryEnvelope',
        inSR: '2180',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: `FID,ID,ZONE,${pole}`,
        returnGeometry: 'true',
      })
      if (j.exceededTransferLimit && glebokosc < 6) {
        const mx = (b[0] + b[2]) / 2
        const my = (b[1] + b[3]) / 2
        for (const s of [
          [b[0], b[1], mx, my],
          [mx, b[1], b[2], my],
          [b[0], my, mx, b[3]],
          [mx, my, b[2], b[3]],
        ])
          await kafel(s, glebokosc + 1)
        return
      }
      for (const f of j.features) {
        const ring = f.geometry?.rings?.[0]
        if (!ring) continue
        const xs = ring.map((p) => p[0])
        const ys = ring.map((p) => p[1])
        const v = f.attributes[pole]
        oczka.set(f.attributes.FID, {
          fid: f.attributes.FID,
          id: f.attributes.ID,
          zone: f.attributes.ZONE,
          v: typeof v === 'number' && v >= 0 ? v : null,
          x0: Math.min(...xs),
          y0: Math.min(...ys),
          x1: Math.max(...xs),
          y1: Math.max(...ys),
          ring: ring.flat(),
        })
      }
    }
    const KAFEL = 8000
    for (let x = bbox[0]; x < bbox[2]; x += KAFEL)
      for (let y = bbox[1]; y < bbox[3]; y += KAFEL)
        await kafel([x, y, Math.min(x + KAFEL, bbox[2]), Math.min(y + KAFEL, bbox[3])])
    return [...oczka.values()]
  })
}

/** Indeks przestrzenny oczek: siatka kubełków 1 km + test punkt-w-wielokącie. */
export function indeksOczek(oczka) {
  const K = 1000
  const kubelki = new Map()
  for (const o of oczka)
    for (let i = Math.floor(o.x0 / K); i <= Math.floor(o.x1 / K); i++)
      for (let j = Math.floor(o.y0 / K); j <= Math.floor(o.y1 / K); j++) {
        const k = `${i}:${j}`
        const l = kubelki.get(k)
        if (l) l.push(o)
        else kubelki.set(k, [o])
      }
  const wWielokacie = (x, y, r) => {
    let w = false
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if (
        r[i + 1] > y !== r[j + 1] > y &&
        x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]
      )
        w = !w
    }
    return w
  }
  // Siatki nakładają się (w strefie PL1203 gruba siatka leży pod drobną), więc wygrywa
  // najmniejsze oczko z ważną wartością.
  return (x, y) => {
    let wynik = null
    let pole = Infinity
    for (const o of kubelki.get(`${Math.floor(x / K)}:${Math.floor(y / K)}`) ?? []) {
      const p = (o.x1 - o.x0) * (o.y1 - o.y0)
      if (o.v === null || p >= pole) continue
      if (x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1 && wWielokacie(x, y, o.ring)) {
        wynik = o
        pole = p
      }
    }
    return wynik
  }
}

/** Prostokąt adresów + margines (stopnie) w EPSG:2180. */
export function bboxAdresow(adresy, margines = 0.03) {
  let a = Infinity
  let b = Infinity
  let c = -Infinity
  let d = -Infinity
  for (const p of adresy) {
    a = Math.min(a, p.lon)
    b = Math.min(b, p.lat)
    c = Math.max(c, p.lon)
    d = Math.max(d, p.lat)
  }
  const naroza = [
    doPuwg(a - margines, b - margines),
    doPuwg(c + margines, b - margines),
    doPuwg(a - margines, d + margines),
    doPuwg(c + margines, d + margines),
  ]
  const xs = naroza.map((p) => p[0])
  const ys = naroza.map((p) => p[1])
  // Zaokrąglenie do 1 km: ten sam klucz cache dla drobnych zmian zbioru adresów.
  const k = (v, f) => f(v / 1000) * 1000
  return [
    k(Math.min(...xs), Math.floor),
    k(Math.min(...ys), Math.floor),
    k(Math.max(...xs), Math.ceil),
    k(Math.max(...ys), Math.ceil),
  ]
}
