// Pozwolenia na budowę w Krakowie 2025–2026 → wskaźnik `inwestycje_500m` + public/dane/pozwolenia.geojson.
//
// Źródło: Gmina Miejska Kraków, Portal MSIP, zbiór „Pozwolenia budowlane" (Decyzje_PNB).
//   https://msip.krakow.pl/dataset/1427
//   archiwa: https://msip.um.krakow.pl/Dane/Decyzje_PNB_2025_JSON.zip (i …_2026_JSON.zip)
//   Plik w zipie to GeoJSON (poligony działek) w EPSG:2178. Dane z 2026-09-21 (rok 2026 do 17 września).
// Licencja: Regulamin MSIP https://msip.krakow.pl/getHtml?dok_id=228972. Dlatego robimy statyczne
//   pliki liczone skryptem, bez ciągłego pośredniczenia w usługach miasta.
//
// Co liczy:
//   Które decyzje: rodz_dec = „pozytywna" (bez umorzeń, odmów, wygaszeń), kategoria sprawy to
//   pozwolenie na budowę, przebudowę lub rozbudowę (bez remontów, rozbiórek, zgłoszeń, przeniesień
//   decyzji, reklam, sieci i infrastruktury), zakres to budowa, rozbudowa albo nadbudowa.
//   Pomijamy opisy o windach, dźwigach i balkonach przy istniejących budynkach.
//   Gdy zakr_inw jest pusty, zakres wynika z początku opisu inwestycji. Przebudowy wnętrz
//   i zmiany sposobu użytkowania nie liczymy – nie zmieniają zabudowy wokół adresu.
//   Wartość: liczba takich decyzji, których środek działki leży do 500 m od adresu (EPSG:2178,
//   odległość płaska, błąd skali poniżej 0,1%). Działka większa niż jej środek: liczy się środek.
//   `null` dla adresów spoza Krakowa (teryt ≠ 1261011): MSIP nie obejmuje gmin obwarzanka.
//   Etykieta: „12 pozwoleń, głównie domy jednorodzinne" (głównie = co najmniej połowa, inaczej
//   „najczęściej"). Dla 0 decyzji etykieta to null.
//
// Format public/dane/pozwolenia.geojson (pod „duchy budynków 2030", #31):
//   FeatureCollection punktów (WGS84, lon/lat do 6 miejsc) – środki działek z decyzją. Pola:
//   d – data decyzji (RRRR-MM-DD), r – rodzaj obiektu (grupa: dom jednorodzinny, budynek
//   wielorodzinny, budynek mieszkalno-usługowy, obiekt usługowy, obiekt publiczny, inny),
//   z – zakres (budowa | rozbudowa | nadbudowa), o – opis inwestycji (do 140 znaków),
//   p – powierzchnia działki w m² (zaokrąglona do 10).
//   Brak numerów decyzji, sygnatur i danych inwestorów. Opisy w źródle nie zawierają nazwisk;
//   skrypt dodatkowo ucina opis przy słowie „inwestor", gdyby inwestor był podany.
//
// Uruchom: node etl/pozwolenia.mjs (pobrania trafiają do etl/.cache, drugi bieg ich używa).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import KDBush from 'kdbush'
import proj4 from 'proj4'
import { DANE, dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const LATA = [2025, 2026]
const URL_ZBIORU = 'https://msip.krakow.pl/dataset/1427'
const url = (rok) => `https://msip.um.krakow.pl/Dane/Decyzje_PNB_${rok}_JSON.zip`
const PROMIEN = 500
const TERYT_KRAKOW = '1261011'
const EPSG2178 =
  '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'
const DO_WGS = proj4(EPSG2178, 'EPSG:4326')
const Z_WGS = proj4('EPSG:4326', EPSG2178)

const KATEGORIE_PROJEKTU = new Set([
  'Pozwolenia na budowę',
  'Przebudowa, rozbudowa, zmiana sposobu użytkowania',
])
const ZAKRES_NOWY = new Set(['budowa', 'rozbudowa', 'nadbudowa'])

function grupa(rodz) {
  if (!rodz) return 'inny'
  if (/jednorodzinna/i.test(rodz)) return 'dom jednorodzinny'
  if (/wielorodzinna/i.test(rodz)) return 'budynek wielorodzinny'
  if (/mieszkalno/i.test(rodz)) return 'budynek mieszkalno-usługowy'
  if (/^mieszkani/i.test(rodz) || /^zabudowa mieszkan/i.test(rodz)) return 'budynek mieszkalny'
  if (/^us[łl]ugi/i.test(rodz) || /^zabudowa us/i.test(rodz)) return 'obiekt usługowy'
  if (/^kultura|zdrowia|opieki|u[żz]yteczno|administracji|sportu/i.test(rodz))
    return 'obiekt publiczny'
  return 'inny'
}
// Rzeczownik do etykiety („głównie …").
const W_ETYKIECIE = {
  'dom jednorodzinny': 'domy jednorodzinne',
  'budynek wielorodzinny': 'budynki wielorodzinne',
  'budynek mieszkalno-usługowy': 'budynki mieszkalno-usługowe',
  'budynek mieszkalny': 'budynki mieszkalne',
  'obiekt usługowy': 'obiekty usługowe',
  'obiekt publiczny': 'obiekty publiczne',
  inny: 'inne obiekty',
}

function opis(tekst) {
  let t = tekst
    .replace(/\s+/g, ' ')
    .replace(/[?]/g, '')
    .replace(/Wniosek elektroniczny\.?/gi, '')
  const i = t.search(/inwestor/i)
  if (i >= 0) t = t.slice(0, i)
  t = t.trim().replace(/[,;:\-–\s]+$/u, '')
  if (t.length <= 140) return t
  const ciete = t.slice(0, 140)
  return `${ciete.slice(0, Math.max(ciete.lastIndexOf(' '), 100))}…`
}

function srodekIPowierzchnia(geom) {
  const poligony = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  let pole = 0
  let sx = 0
  let sy = 0
  for (const p of poligony) {
    const ring = p[0]
    let a = 0
    let cx = 0
    let cy = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i]
      const [x1, y1] = ring[i + 1]
      const w = x0 * y1 - x1 * y0
      a += w
      cx += (x0 + x1) * w
      cy += (y0 + y1) * w
    }
    if (a === 0) continue
    pole += a / 2
    // Środek ciężkości ważony polem (znak pola poprawia przypadek odwrotnej orientacji).
    sx += cx / 6
    sy += cy / 6
  }
  if (pole === 0) return null
  return { x: sx / pole, y: sy / pole, pole: Math.abs(pole) }
}

async function main() {
  const pobrano = dzis()
  const decyzje = []
  let razem = 0
  let dataDanych = '0000-00-00'
  for (const rok of LATA) {
    const zip = unzipSync(readFileSync(await pobierzDoCache(url(rok), `pnb${rok}.zip`)))
    const nazwaGeo = Object.keys(zip).find((n) => n.endsWith('.geojson'))
    const aktual = Object.keys(zip).find((n) => /Aktualnosc/i.test(n))
    const m = aktual && new TextDecoder().decode(zip[aktual]).match(/(\d{4}-\d{2}-\d{2})/)
    if (m && m[1] > dataDanych) dataDanych = m[1]
    const geo = JSON.parse(new TextDecoder().decode(zip[nazwaGeo]))
    for (const f of geo.features) {
      razem++
      const p = f.properties
      if (p.rodz_dec !== 'pozytywna') continue
      if (!KATEGORIE_PROJEKTU.has(p.kat_spr)) continue
      if (/^Infrastruktura|reklamy/i.test(p.rodz_inw ?? '')) continue
      const opisZrodlo = p.nazwa_in ?? ''
      // Windy, dźwigi i balkony przy istniejących budynkach: nie zmieniają zabudowy wokół adresu.
      if (/\b(wind[aęy]|window\w*|dźwig\w*|balkon\w*|loggi\w*)\b/i.test(opisZrodlo)) continue
      let zakres = p.zakr_inw
      if (!ZAKRES_NOWY.has(zakres)) {
        if (zakres && zakres !== 'inne' && zakres !== 'nie dotyczy') continue
        const s = opisZrodlo.match(/^[\s?"„]*(?:ul\.[^-–]*[-–]\s*)?(budowa|rozbudowa|nadbudowa)/i)
        if (!s) continue
        zakres = s[1].toLowerCase()
      }
      const s = srodekIPowierzchnia(f.geometry)
      if (!s || !p.data_dec) continue
      const [lon, lat] = DO_WGS.forward([s.x, s.y])
      decyzje.push({
        x: s.x,
        y: s.y,
        lon,
        lat,
        pole: s.pole,
        data: new Date(p.data_dec + 12 * 3600e3).toISOString().slice(0, 10),
        grupa: grupa(p.rodz_inw),
        zakres,
        opis: opis(opisZrodlo),
      })
    }
  }
  console.log(`decyzje w źródle: ${razem}, po filtrze: ${decyzje.length}`)

  // pozwolenia.geojson
  const fc = {
    type: 'FeatureCollection',
    features: decyzje.map((d) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [Math.round(d.lon * 1e6) / 1e6, Math.round(d.lat * 1e6) / 1e6],
      },
      properties: {
        d: d.data,
        r: d.grupa,
        z: d.zakres,
        o: d.opis || null,
        p: Math.round(d.pole / 10) * 10,
      },
    })),
  }
  mkdirSync(DANE, { recursive: true })
  const tekstGeo = JSON.stringify(fc)
  writeFileSync(join(DANE, 'pozwolenia.geojson'), tekstGeo)
  console.log(`pozwolenia.geojson: ${(tekstGeo.length / 1024).toFixed(0)} KB`)

  // wskaźnik
  const indeks = new KDBush(decyzje.length)
  for (const d of decyzje) indeks.add(d.x, d.y)
  indeks.finish()

  const { adresy } = wczytajAdresy()
  const wartosci = []
  const etykiety = []
  const nazwyGrup = Object.keys(W_ETYKIECIE)
  for (const a of adresy) {
    if (a.teryt !== TERYT_KRAKOW) {
      wartosci.push(null)
      etykiety.push(null)
      continue
    }
    const [x, y] = Z_WGS.forward([a.lon, a.lat])
    const sasiedzi = indeks.within(x, y, PROMIEN)
    wartosci.push(sasiedzi.length)
    if (!sasiedzi.length) {
      etykiety.push(null)
      continue
    }
    const licz = {}
    for (const i of sasiedzi) licz[decyzje[i].grupa] = (licz[decyzje[i].grupa] ?? 0) + 1
    const top = nazwyGrup.reduce((a2, g) => ((licz[g] ?? 0) > (licz[a2] ?? 0) ? g : a2))
    const n = sasiedzi.length
    const slowo =
      n === 1
        ? 'pozwolenie'
        : n % 10 >= 2 && n % 10 <= 4 && (n < 12 || n > 14)
          ? 'pozwolenia'
          : 'pozwoleń'
    const przysl = licz[top] * 2 >= n ? 'głównie' : 'najczęściej'
    etykiety.push(`${n} ${slowo}, ${przysl} ${W_ETYKIECIE[top]}`)
  }

  zapiszWskaznik(
    {
      id: 'inwestycje_500m',
      kategoria: 'przyszlosc',
      nazwa: 'Pozwolenia na budowę w 500 m (2025–2026)',
      opis: 'Liczba decyzji o pozwoleniu na budowę, rozbudowę lub nadbudowę z lat 2025–2026 (do września 2026) w promieniu 500 m od adresu, licząc od środka działki. Bez remontów, rozbiórek, sieci i reklam. Zbiór MSIP obejmuje tylko Kraków – dla gmin obwarzanka brak danych (null, nie zero).',
      jednostka: 'szt.',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      zakres: [0, 50],
      zadanie: 27,
      zrodla: [
        {
          nazwa:
            'Gmina Miejska Kraków, Portal MSIP – Pozwolenia budowlane (Decyzje_PNB 2025, 2026)',
          url: URL_ZBIORU,
          licencja: 'Regulamin MSIP: https://msip.krakow.pl/getHtml?dok_id=228972',
          dataDanych,
          pobrano,
        },
      ],
    },
    wartosci,
    etykiety,
  )
}

await main()
