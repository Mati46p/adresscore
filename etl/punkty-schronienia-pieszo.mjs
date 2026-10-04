// Czas dojścia pieszo do najbliższego Punktu Schronienia KG PSP po sieci pieszej OSM (#65, kontynuacja #25).
// Uruchom: node etl/punkty-schronienia-pieszo.mjs (po node etl/punkty-schronienia.mjs).
// Sieć: drogi i ścieżki dostępne pieszo z OpenStreetMap (Overpass, kafle buforowane w etl/.cache/).
// Algorytm: wielozródłowy Dijkstra od wszystkich punktów naraz; dojście z adresu i do punktu to
// odcinek prosty do najbliższego węzła głównej spójnej składowej sieci (≤ DOJSCIE_MAX m).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import KDBush from 'kdbush'
import { do2180 } from './lib/geo.mjs'
import { CACHE, DANE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const OVERPASS = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
export const PREDKOSC_KMH = 4.5
const M_NA_MIN = (PREDKOSC_KMH * 1000) / 60
export const DOJSCIE_MAX = 300 // m – dalej od sieci nie zgadujemy trasy
const ZAGESZCZENIE = 25 // m – długie krawędzie dzielimy, żeby najbliższy węzeł był blisko
const OBSZAR = { lat: [49.955, 50.145], lon: [19.77, 20.24] }
const KAFLE = 8
// Bez autostrad, dróg ekspresowych (trunk) i dróg z zakazem ruchu pieszego.
const HIGHWAY =
  'footway|path|pedestrian|steps|living_street|residential|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|track|cycleway|corridor|trunk_link|road|bridleway|crossing'

function zapytanie([s, w, n, e]) {
  return `[out:json][timeout:180];way["highway"~"^(${HIGHWAY})$"]["access"!~"^(private|no)$"]["foot"!~"^(no|private)$"]["area"!="yes"](${s},${w},${n},${e});out geom qt;`
}

async function pobierzKafel(bbox, plik) {
  if (existsSync(plik)) return JSON.parse(readFileSync(plik, 'utf8'))
  for (let proba = 1; proba <= 5; proba++) {
    try {
      const r = await fetch(OVERPASS, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'adresscore-etl/1.0 (https://github.com/Mati46p/adresscore)',
        },
        body: new URLSearchParams({ data: zapytanie(bbox) }),
        signal: AbortSignal.timeout(400_000),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const dane = await r.json()
      if (!dane.osm3s?.timestamp_osm_base || !Array.isArray(dane.elements))
        throw new Error('niekompletna odpowiedź')
      if (dane.remark) throw new Error(dane.remark)
      writeFileSync(plik, JSON.stringify(dane))
      return dane
    } catch (blad) {
      console.warn(`Overpass kafel ${bbox} próba ${proba}: ${blad.message}`)
      await new Promise((ok) => setTimeout(ok, 5_000 * proba))
    }
  }
  throw new Error(`Overpass: nie pobrano kafla ${bbox}`)
}

async function pobierzSiec() {
  const katalog = join(CACHE, 'siec-piesza')
  mkdirSync(katalog, { recursive: true })
  const drogi = new Map()
  let dataDanych = null
  const dLat = (OBSZAR.lat[1] - OBSZAR.lat[0]) / KAFLE
  const dLon = (OBSZAR.lon[1] - OBSZAR.lon[0]) / KAFLE
  for (let a = 0; a < KAFLE; a++)
    for (let b = 0; b < KAFLE; b++) {
      const bbox = [
        OBSZAR.lat[0] + a * dLat,
        OBSZAR.lon[0] + b * dLon,
        OBSZAR.lat[0] + (a + 1) * dLat,
        OBSZAR.lon[0] + (b + 1) * dLon,
      ].map((v) => Number(v.toFixed(5)))
      const dane = await pobierzKafel(bbox, join(katalog, `kafel-${a}-${b}.json`))
      const d = dane.osm3s.timestamp_osm_base.slice(0, 10)
      if (!dataDanych || d < dataDanych) dataDanych = d
      for (const el of dane.elements)
        if (el.type === 'way' && el.nodes?.length === el.geometry?.length) drogi.set(el.id, el)
    }
  if (drogi.size < 50_000) throw new Error(`OSM: podejrzanie mało dróg (${drogi.size})`)
  return { drogi: [...drogi.values()], dataDanych }
}

/**
 * Graf nieskierowany z łamanych w metrach: [{ wezly: [id…], punkty: [[x, y]…] }].
 * Węzły o tym samym id OSM są wspólne (skrzyżowania); długie krawędzie dzielimy węzłami pośrednimi.
 */
export function zbudujGraf(linie, zageszczenie = ZAGESZCZENIE) {
  const xs = []
  const ys = []
  const numer = new Map()
  const krawedzie = [] // płasko: a, b, długość
  const wezel = (id, x, y) => {
    let n = numer.get(id)
    if (n === undefined) {
      n = xs.length
      numer.set(id, n)
      xs.push(x)
      ys.push(y)
    }
    return n
  }
  for (const { wezly, punkty } of linie)
    for (let i = 1; i < punkty.length; i++) {
      const [x1, y1] = punkty[i - 1]
      const [x2, y2] = punkty[i]
      const a = wezel(wezly[i - 1], x1, y1)
      const b = wezel(wezly[i], x2, y2)
      const dl = Math.hypot(x2 - x1, y2 - y1)
      const czesci = Math.max(1, Math.ceil(dl / zageszczenie))
      let poprzedni = a
      for (let c = 1; c <= czesci; c++) {
        let biezacy = b
        if (c < czesci) {
          biezacy = xs.length
          xs.push(x1 + ((x2 - x1) * c) / czesci)
          ys.push(y1 + ((y2 - y1) * c) / czesci)
        }
        krawedzie.push(poprzedni, biezacy, dl / czesci)
        poprzedni = biezacy
      }
    }
  const n = xs.length
  const stopien = new Int32Array(n + 1)
  for (let k = 0; k < krawedzie.length; k += 3) {
    stopien[krawedzie[k] + 1]++
    stopien[krawedzie[k + 1] + 1]++
  }
  for (let i = 0; i < n; i++) stopien[i + 1] += stopien[i]
  const sasiad = new Int32Array(stopien[n])
  const waga = new Float64Array(stopien[n])
  const poz = stopien.slice(0, n)
  for (let k = 0; k < krawedzie.length; k += 3) {
    const [a, b, w] = [krawedzie[k], krawedzie[k + 1], krawedzie[k + 2]]
    sasiad[poz[a]] = b
    waga[poz[a]++] = w
    sasiad[poz[b]] = a
    waga[poz[b]++] = w
  }
  const graf = {
    n,
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    start: stopien,
    sasiad,
    waga,
  }
  graf.skladowa = skladowe(graf)
  return graf
}

function skladowe(g) {
  const etykieta = new Int32Array(g.n).fill(-1)
  const rozmiary = []
  const stos = new Int32Array(g.n)
  for (let s = 0; s < g.n; s++) {
    if (etykieta[s] >= 0) continue
    const nr = rozmiary.length
    let wierzch = 0
    let rozmiar = 0
    stos[wierzch++] = s
    etykieta[s] = nr
    while (wierzch) {
      const v = stos[--wierzch]
      rozmiar++
      for (let k = g.start[v]; k < g.start[v + 1]; k++)
        if (etykieta[g.sasiad[k]] < 0) {
          etykieta[g.sasiad[k]] = nr
          stos[wierzch++] = g.sasiad[k]
        }
    }
    rozmiary.push(rozmiar)
  }
  const glowna = rozmiary.indexOf(Math.max(...rozmiary))
  return { etykieta, glowna }
}

/** Indeks węzłów głównej składowej (izolowane kawałki sieci nie dają fałszywego „braku trasy”). */
export function indeksWezlow(g) {
  const wezly = []
  for (let i = 0; i < g.n; i++) if (g.skladowa.etykieta[i] === g.skladowa.glowna) wezly.push(i)
  const indeks = new KDBush(wezly.length)
  for (const i of wezly) indeks.add(g.x[i], g.y[i])
  indeks.finish()
  return { indeks, wezly }
}

/** Najbliższy węzeł sieci w promieniu `max` m: { wezel, metry } albo null. */
export function dowiaz(g, { indeks, wezly }, x, y, max = DOJSCIE_MAX) {
  let najlepszy = null
  let minimum = Infinity
  for (const k of indeks.range(x - max, y - max, x + max, y + max)) {
    const i = wezly[k]
    const d = Math.hypot(g.x[i] - x, g.y[i] - y)
    if (d < minimum) {
      minimum = d
      najlepszy = i
    }
  }
  return minimum <= max ? { wezel: najlepszy, metry: minimum } : null
}

/** Wielozródłowy Dijkstra. zrodla: [{ wezel, metry, nr }]. Zwraca odległość i numer źródła. */
export function dijkstra(g, zrodla) {
  const odl = new Float64Array(g.n).fill(Infinity)
  const skad = new Int32Array(g.n).fill(-1)
  // Kopiec binarny z leniwym usuwaniem.
  let kw = new Float64Array(1024)
  let kv = new Int32Array(1024)
  let rozmiar = 0
  const wloz = (w, v) => {
    if (rozmiar === kw.length) {
      const nw = new Float64Array(rozmiar * 2)
      nw.set(kw)
      kw = nw
      const nv = new Int32Array(rozmiar * 2)
      nv.set(kv)
      kv = nv
    }
    let i = rozmiar++
    while (i > 0) {
      const p = (i - 1) >> 1
      if (kw[p] <= w) break
      kw[i] = kw[p]
      kv[i] = kv[p]
      i = p
    }
    kw[i] = w
    kv[i] = v
  }
  const zdejmij = () => {
    const v = kv[0]
    const w = kw[--rozmiar]
    const u = kv[rozmiar]
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= rozmiar) break
      if (c + 1 < rozmiar && kw[c + 1] < kw[c]) c++
      if (kw[c] >= w) break
      kw[i] = kw[c]
      kv[i] = kv[c]
      i = c
    }
    kw[i] = w
    kv[i] = u
    return v
  }
  for (const z of zrodla)
    if (z.metry < odl[z.wezel]) {
      odl[z.wezel] = z.metry
      skad[z.wezel] = z.nr
      wloz(z.metry, z.wezel)
    }
  while (rozmiar) {
    const d = kw[0]
    const v = zdejmij()
    if (d > odl[v]) continue
    for (let k = g.start[v]; k < g.start[v + 1]; k++) {
      const u = g.sasiad[k]
      const nd = d + g.waga[k]
      if (nd < odl[u]) {
        odl[u] = nd
        skad[u] = skad[v]
        wloz(nd, u)
      }
    }
  }
  return { odl, skad }
}

/** Trasa adresu: { metry, minuty, zrodlo } albo null (poza siecią lub bez połączenia). */
export function trasa(g, indeks, wynik, x, y) {
  const d = dowiaz(g, indeks, x, y)
  if (!d || !Number.isFinite(wynik.odl[d.wezel])) return null
  const metry = wynik.odl[d.wezel] + d.metry
  return { metry, minuty: metry / M_NA_MIN, zrodlo: wynik.skad[d.wezel] }
}

async function main() {
  const punkty = JSON.parse(readFileSync(join(DANE, 'punkty_schronienia.geojson'), 'utf8'))
  const { drogi, dataDanych } = await pobierzSiec()
  const linie = drogi.map((w) => ({
    wezly: w.nodes,
    punkty: w.geometry.map((p) => do2180(p.lon, p.lat)),
  }))
  const g = zbudujGraf(linie)
  const indeks = indeksWezlow(g)
  console.log(
    `Sieć piesza: ${drogi.length} dróg, ${g.n} węzłów, główna składowa ${indeks.wezly.length}`,
  )
  const zrodla = []
  punkty.features.forEach((f, nr) => {
    const [x, y] = do2180(...f.geometry.coordinates)
    const d = dowiaz(g, indeks, x, y)
    if (d) zrodla.push({ ...d, nr })
  })
  console.log(`Punkty dowiązane do sieci: ${zrodla.length}/${punkty.features.length}`)
  const wynik = dijkstra(g, zrodla)
  const { adresy } = wczytajAdresy()
  const trasy = adresy.map((a) =>
    a.gmina === 'Kraków' && Number.isFinite(a.lat)
      ? trasa(g, indeks, wynik, ...do2180(a.lon, a.lat))
      : null,
  )
  const maks = trasy.reduce((m, t) => Math.max(m, t?.minuty ?? 0), 0)
  if (maks > 150) throw new Error(`Czas ${maks} min wykracza poza deklarowany zakres`)
  const slownik = {}
  const etykiety = trasy.map((t) => {
    if (!t) return null
    const f = punkty.features[t.zrodlo]
    const klucz = t.zrodlo.toString(36) // krótki klucz, żeby plik zmieścił się w 2 MB
    slownik[klucz] ??=
      `${f.properties.nazwa || 'Punkt Schronienia'} – ${f.properties.rodzajZrodla || 'typ niepodany'} (${f.id})`
    return klucz
  })
  const psp = punkty.metadane
  zapiszWskaznik(
    {
      id: 'punkt_schronienia_pieszo_min',
      kategoria: 'bezpieczenstwo',
      nazwa: 'Punkt Schronienia KG PSP – dojście pieszo',
      opis: `Czas dojścia pieszo z adresu w gminie Kraków do najbliższego (po sieci) Punktu Schronienia KG PSP, przy stałej prędkości ${PREDKOSC_KMH} km/h. Trasa po sieci pieszej OpenStreetMap (bez autostrad i dróg ekspresowych, bez dróg z zakazem ruchu pieszego), więc rzeka, tory i duże drogi wydłużają dojście do najbliższego mostu, przejścia lub kładki. Dojście z adresu i do punktu: odcinek prosty do najbliższego węzła sieci (do ${DOJSCIE_MAX} m); współrzędne punktu traktujemy jako wejście, bo katalog nie podaje wejść. Nie uwzględnia schodów, wind, świateł, przeszkód czasowych ani zamkniętych bram. Punkty to kategoria informacyjna, nie potwierdzone schrony, ukrycia ani MDS. Poza gminą Kraków i bez trasy: brak danych.`,
      jednostka: 'min',
      kierunek: 'mniej-lepiej',
      domyslnaWaga: 0, // jak punkt_schronienia_odleglosc po etl/uprosc-kryteria.mjs
      rozdzielczosc: 'adres',
      zakres: [0, 150],
      zadanie: 65,
      predkoscKmH: PREDKOSC_KMH,
      zrodla: [
        {
          nazwa: 'Komenda Główna Państwowej Straży Pożarnej – Punkty Schronienia',
          url: psp.zrodlo,
          licencja: `CC BY 4.0 (${psp.katalog}); przetworzono: filtr gminy, trasa pieszo`,
          dataDanych: psp.dataDanych,
          pobrano: psp.pobrano,
        },
        {
          nazwa: 'OpenStreetMap – sieć dróg i ścieżek pieszych (Overpass API)',
          url: OVERPASS,
          licencja: '© współtwórcy OpenStreetMap, ODbL 1.0',
          dataDanych,
          pobrano: dzis(),
        },
      ],
    },
    trasy.map((t) => t?.minuty ?? null),
    etykiety,
    slownik,
  )
  // Przykłady z barierą: największy stosunek trasy do odległości prostej.
  const kandydaci = []
  adresy.forEach((a, i) => {
    const t = trasy[i]
    if (!t) return
    const [px, py] = do2180(...punkty.features[t.zrodlo].geometry.coordinates)
    const [ax, ay] = do2180(a.lon, a.lat)
    const prosto = Math.hypot(px - ax, py - ay)
    kandydaci.push({ a, t, prosto, f: punkty.features[t.zrodlo] })
  })
  writeFileSync(
    join(CACHE, 'siec-piesza', 'przyklady.json'),
    JSON.stringify(
      kandydaci
        .filter((k) => k.prosto > 150)
        .sort((p, q) => q.t.metry / q.prosto - p.t.metry / p.prosto)
        .slice(0, 300)
        .map(({ a, t, prosto, f }) => ({
          adres: `${a.ulica ?? a.miejscowosc} ${a.nr}`,
          dzielnica: a.dzielnica,
          lat: a.lat,
          lon: a.lon,
          punkt: f.id,
          punktNazwa: f.properties.nazwa,
          punktLatLon: [f.geometry.coordinates[1], f.geometry.coordinates[0]],
          trasaM: Math.round(t.metry),
          prostoM: Math.round(prosto),
          minuty: Number(t.minuty.toFixed(1)),
          minutyProsto: Number((prosto / M_NA_MIN).toFixed(1)),
        })),
      null,
      1,
    ),
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
