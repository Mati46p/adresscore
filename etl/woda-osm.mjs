// Odległość od adresu do najbliższej wody powierzchniowej z OpenStreetMap (tryb miasta, #241).
// Kraków ma ten wskaźnik z modelu SMK/BDOT (etl/metropolia-smk.mjs); dla pozostałych miast liczymy go
// z ekstraktu OSM województwa (ten sam PBF co sieć piesza, bez Overpass): oś cieku (river, stream, canal,
// bez odcinków pod ziemią) albo brzeg zbiornika (natural=water, także relacje multipolygon: Wisła, Odra,
// jeziora), 0 dla adresu wewnątrz zbiornika. Zbiornik, którego obrysu nie da się złożyć w zamknięty
// pierścień w ramce (relacja ucięta brzegiem ramki), liczymy po brzegu, bez wnętrza.
// Uruchom: ADRESCORE_MIASTO=<slug> node etl/woda-osm.mjs
import { fileURLToPath } from 'node:url'
import { do2180, IndeksWielokatow, pierscien, punktWPierscieniu, wielokat } from './lib/geo.mjs'
import { bboxMiasta, MIASTO_INFO, pbfRegionu } from './lib/miasto.mjs'
import { IndeksOdcinkow } from './lib/odcinki.mjs'
import { liniePbf } from './lib/pbf-warstwy.mjs'
import { dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ZADANIE = 113
/** Dalej niż tyle od jakiejkolwiek wody: brak danych (nie zgadujemy odległości). */
export const MAKS_M = 10_000
const CIEKI = ['river', 'stream', 'canal']
/** Wartości tagu water=*, które nie są wodą powierzchniową krajobrazu (ścieki, oczyszczalnie). */
const WODA_POMIJANA = ['wastewater', 'sewage']

/**
 * Składa segmenty (ways) we wspólne końce węzłów w łamane. Zamknięta łamana (pierwszy węzeł = ostatni,
 * co najmniej 4 węzły) to pierścień. Reszta to łamane otwarte.
 * @param {{ wezly: number[], punkty: number[][] }[]} segmenty
 * @returns {{ zamkniete: number[][][], otwarte: number[][][] }}
 */
export function zlozLamane(segmenty) {
  const pula = segmenty.map((s) => ({ w: [...s.wezly], p: [...s.punkty] }))
  const zamkniete = []
  const otwarte = []
  while (pula.length) {
    const l = pula.pop()
    let odwrocone = false
    for (;;) {
      if (l.w.length >= 4 && l.w[0] === l.w.at(-1)) {
        zamkniete.push(l.p)
        break
      }
      const koniec = l.w.at(-1)
      const i = pula.findIndex((s) => s.w[0] === koniec || s.w.at(-1) === koniec)
      if (i >= 0) {
        const [s] = pula.splice(i, 1)
        if (s.w[0] !== koniec) {
          s.w.reverse()
          s.p.reverse()
        }
        l.w.push(...s.w.slice(1))
        l.p.push(...s.p.slice(1))
        continue
      }
      if (!odwrocone) {
        l.w.reverse()
        l.p.reverse()
        odwrocone = true
        continue
      }
      otwarte.push(l.p)
      break
    }
  }
  return { zamkniete, otwarte }
}

const metry = (geometria) => geometria.map(([lon, lat]) => do2180(lon, lat))
const czyDomknieta = (l) => l.wezly.length >= 4 && l.wezly[0] === l.wezly.at(-1)

/**
 * Wielokąty zbiorników i łamane cieków (EPSG:2180) z linii PBF i członków relacji multipolygon.
 * @param {{ id: number, tagi: Record<string, string|null>, wezly: number[], geometria: number[][] }[]} linie
 * @param {{ rid: number, wid: number, rola: string }[]} czlonkowie
 */
export function zbudujWode(linie, czlonkowie) {
  const poId = new Map(linie.map((l) => [l.id, l]))
  const wRelacji = new Set(czlonkowie.map((c) => c.wid))
  const wielokaty = []
  const lamane = []
  const st = { zbiornikiProste: 0, zbiornikiRelacje: 0, relacjeBezPierscienia: 0, cieki: 0 }

  const poRelacji = new Map()
  for (const c of czlonkowie) {
    const l = poId.get(c.wid)
    if (!l) continue
    const g = poRelacji.get(c.rid) ?? { zew: [], wew: [] }
    const seg = { wezly: l.wezly, punkty: metry(l.geometria) }
    ;(c.rola === 'inner' ? g.wew : g.zew).push(seg)
    poRelacji.set(c.rid, g)
  }
  for (const { zew, wew } of poRelacji.values()) {
    const z = zlozLamane(zew)
    const w = zlozLamane(wew)
    for (const o of [...z.otwarte, ...w.otwarte]) lamane.push(o)
    if (!z.zamkniete.length) {
      st.relacjeBezPierscienia++
      for (const o of w.zamkniete) lamane.push(o)
      continue
    }
    const zew2 = z.zamkniete.map((p) => pierscien(p))
    const otwory = w.zamkniete.map((p) => pierscien(p))
    for (const o of zew2) {
      const swoje = otwory.filter((h) => punktWPierscieniu(h[0], h[1], o))
      wielokaty.push(wielokat([o, ...swoje]))
      st.zbiornikiRelacje++
    }
  }
  for (const l of linie) {
    if (wRelacji.has(l.id)) continue
    if (l.tagi.natural === 'water') {
      if (czyDomknieta(l)) {
        wielokaty.push(wielokat([pierscien(metry(l.geometria))]))
        st.zbiornikiProste++
      } else lamane.push(metry(l.geometria))
    } else if (CIEKI.includes(l.tagi.waterway ?? '')) {
      lamane.push(metry(l.geometria))
      st.cieki++
    }
  }
  return { wielokaty, lamane, statystyki: st }
}

/** Odległość (m) do najbliższej wody albo null. 0 tylko w obrębie zbiornika, poza nim co najmniej 1 m. */
export function odlegloscDoWody(x, y, indeksWielokatow, indeksLamanych, maks = MAKS_M) {
  const a = indeksWielokatow?.najblizszy(x, y, maks)?.odleglosc ?? Infinity
  const b = indeksLamanych.najblizszy(x, y, maks)?.metry ?? Infinity
  const d = Math.min(a, b)
  if (!Number.isFinite(d)) return null
  return d <= 0 ? 0 : Math.max(1, Math.round(d))
}

async function main() {
  if (!MIASTO_INFO)
    throw new Error(
      'woda-osm.mjs działa tylko w trybie miasta (ADRESCORE_MIASTO); Kraków ma woda_odleglosc z etl/metropolia-smk.mjs',
    )
  const { adresy } = wczytajAdresy()
  const pbf = await pbfRegionu()
  const b = bboxMiasta()
  const { linie, wszystkich, dodatkowe } = await liniePbf(pbf.plik, {
    tagi: ['natural', 'water', 'waterway', 'tunnel', 'covered'],
    ramka: [b.minLon, b.minLat, b.maxLon, b.maxLat],
    nazwaTmp: 'duckdb_woda_tmp',
    przygotuj: async (c, plik, tag) => {
      const pomijane = WODA_POMIJANA.map((w) => `'${w}'`).join(', ')
      await c.run(`
        CREATE TABLE czlonkowie AS
        SELECT rid, wid, rola FROM (
          SELECT id AS rid, unnest(refs) AS wid, unnest(ref_types) AS typ, unnest(ref_roles) AS rola
          FROM ST_ReadOSM(${plik})
          WHERE kind = 'relation' AND ${tag('natural')} = 'water' AND ${tag('type')} = 'multipolygon'
            AND coalesce(${tag('water')}, '') NOT IN (${pomijane}))
        WHERE typ = 'way'`)
      const wiersze = (
        await c.runAndReadAll('SELECT rid::DOUBLE AS rid, wid::DOUBLE AS wid, rola FROM czlonkowie')
      ).getRowObjectsJS()
      return wiersze.map((w) => ({ rid: w.rid, wid: w.wid, rola: w.rola ?? '' }))
    },
    warunek: (tag) =>
      `(${tag('natural')} = 'water' AND coalesce(${tag('water')}, '') NOT IN (${WODA_POMIJANA.map((w) => `'${w}'`).join(', ')})
          AND coalesce(${tag('covered')}, '') <> 'yes')
       OR (${tag('waterway')} IN (${CIEKI.map((w) => `'${w}'`).join(', ')})
          AND coalesce(${tag('tunnel')}, '') NOT IN ('yes', 'culvert') AND coalesce(${tag('covered')}, '') <> 'yes')
       OR id IN (SELECT wid FROM czlonkowie)`,
  })
  const { wielokaty, lamane, statystyki: st } = zbudujWode(linie, dodatkowe)
  console.log(
    `OSM ${pbf.plik} (stan ${pbf.stan}): linii wody w województwie ${wszystkich}, w ramce ${linie.length}; ` +
      `zbiorniki: ${st.zbiornikiProste} prostych + ${st.zbiornikiRelacje} z relacji (relacji bez pierścienia ${st.relacjeBezPierscienia}), cieki ${st.cieki}, łamanych ${lamane.length}`,
  )
  if (wielokaty.length + lamane.length < 20) throw new Error('OSM: podejrzanie mało wód w ramce')
  const indeksW = wielokaty.length ? new IndeksWielokatow(wielokaty, 1000) : null
  const indeksL = new IndeksOdcinkow(250)
  for (const l of lamane) indeksL.dodajLinie(l)
  const start = performance.now()
  const wartosci = adresy.map((a) => {
    const [x, y] = do2180(a.lon, a.lat)
    return odlegloscDoWody(x, y, indeksW, indeksL)
  })
  console.log(`Odległości policzone w ${((performance.now() - start) / 1000).toFixed(1)} s`)
  const znane = wartosci.filter((v) => v !== null).sort((p, q) => p - q)
  const kw = (p) => znane[Math.min(znane.length - 1, Math.floor(p * znane.length))]
  console.log(
    `${MIASTO_INFO.nazwa}: ${znane.length}/${adresy.length} adresów z wartością; w zbiorniku ${znane.filter((v) => v === 0).length}, mediana ${kw(0.5)} m, p90 ${kw(0.9)} m, p99 ${kw(0.99)} m, maks ${znane.at(-1)} m`,
  )
  const pobrano = dzis()
  zapiszWskaznik(
    {
      id: 'woda_odleglosc',
      kategoria: 'spokoj',
      nazwa: 'Najbliższa woda powierzchniowa',
      opis: `Odległość w linii prostej od adresu do najbliższej wody powierzchniowej: osi cieku (rzeka, potok lub kanał, bez odcinków pod ziemią) albo brzegu zbiornika wodnego, także małego stawu; 0 dla adresu wewnątrz zbiornika. Dane OpenStreetMap (stan z ${pbf.stan}): ${st.zbiornikiProste + st.zbiornikiRelacje} zbiorników i ${st.cieki} odcinków cieków w okolicy miasta. Cieki liczone są od osi koryta, więc przy szerokiej rzece do brzegu jest bliżej. To kontekst, nie ocena: bliskość wody nie mówi o zagrożeniu powodziowym, to pokazują osobne warstwy. Źródło inne niż w Krakowie (tam model BDOT Metropolii Krakowskiej), więc wartości między miastami są porównywalne tylko w przybliżeniu: kompletność mapowania małych cieków i stawów w OSM bywa różna. Morze (linia brzegowa) nie jest liczone jako woda. Dalej niż ${MAKS_M / 1000} km od wody: brak danych.`,
      jednostka: 'm',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 1500],
      zadanie: ZADANIE,
      zrodla: [
        {
          nazwa:
            'OpenStreetMap – wody powierzchniowe: natural=water, waterway=river|stream|canal (ekstrakt województwa, openstreetmap.fr)',
          url: pbf.url,
          licencja:
            'ODbL 1.0, © współtwórcy OpenStreetMap (https://www.openstreetmap.org/copyright); wynik to dzieło wytworzone, atrybucja wymagana',
          dataDanych: pbf.stan,
          pobrano,
        },
      ],
    },
    wartosci,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
