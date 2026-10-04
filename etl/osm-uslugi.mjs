// Warstwy „usługi z OSM i InPost" (#124): odległość w linii prostej od adresu do najbliższego
//   – bankomatu lub poczty, miejsca kultury, placu zabaw, punktu recyklingu, toalety lub wody pitnej,
//     defibrylatora AED, weterynarza, ogrodu działkowego i akademika (OpenStreetMap, ekstrakt
//     Geofabrik – małopolskie, ODbL),
//   – paczkomatu InPost (publiczne API punktów operatora).
// Uruchom: node etl/osm-uslugi.mjs. Jedno wspólne wyciągnięcie dla wszystkich grup z pliku PBF
// (DuckDB spatial, ST_ReadOSM: odczyt obiektów z tagami, potem węzłów ich linii); surowe dane
// trafiają do etl/.cache, drugi bieg ich nie pobiera. Metoda i kontrola: etl/osm-uslugi.md.
// Publikujemy wyłącznie odległości, nie punkty: ODbL pozwala na wskaźniki pochodne, a InPost to dane
// operatora prywatnego bez licencji otwartej (podobnie jak w #80: bez pozycji paczkomatów).
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { DuckDBInstance } from '@duckdb/node-api'
import { odlegloscMetry } from './lib/codziennosc-geo.mjs'
import {
  budujNajblizszy,
  GRUPY,
  KLUCZE_TAGOW,
  klasyfikuj,
  liczbaPL,
  licznikNa1000,
  obiektyWGminach,
  odleglosci,
  paczkomaty,
  punktyBrzegu,
  scalDuplikaty,
  srodekLinii,
  warunekSql,
} from './lib/osm-uslugi.mjs'
import { MIASTO_INFO, pbfRegionu, WOJEWODZTWO } from './lib/miasto.mjs'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ZADANIE = 124
const MAX_M = 30_000 // dalej niż 30 km od jakiegokolwiek obiektu = brak danych (null)
const MAX_DO_GMINY_M = 1_000 // obiekt liczy się do gminy najbliższego adresu, jeśli ten jest bliżej
const TERYT_KRAKOWA = '1261011'
const UA = 'adresscore-etl/1.0 (https://github.com/Mati46p/adresscore)'

const GEOFABRIK = 'https://download.geofabrik.de/europe/poland/malopolskie-latest.osm.pbf'
const STRONA_GEOFABRIK = 'https://download.geofabrik.de/europe/poland/malopolskie.html'
const LICENCJA_OSM =
  'ODbL 1.0 – © współtwórcy OpenStreetMap: https://www.openstreetmap.org/copyright'
const INPOST_API = 'https://api-shipx-pl.easypack24.net/v1/points'
const BDL = 'https://bdl.stat.gov.pl/api/v1/data/by-unit'
const BDL_ZMIENNA = 72305 // „ludność ogółem"
const BDL_ROK = 2024

// TERYT gminy → [identyfikator jednostki w BDL, nazwa]. Nazwę sprawdzamy przy pobraniu i w adresach.
const GMINY_BDL = {
  1261011: ['011212161011', 'Kraków'],
  1206052: ['011212006052', 'Kocmyrzów-Luborzyca'],
  1206082: ['011212006082', 'Michałowice'],
  1206072: ['011212006072', 'Liszki'],
  1206162: ['011212006162', 'Zabierzów'],
  1206152: ['011212006152', 'Wielka Wieś'],
  1219053: ['011212019053', 'Wieliczka'],
  1219043: ['011212019043', 'Niepołomice'],
  1206113: ['011212006113', 'Skawina'],
  1206172: ['011212006172', 'Zielonki'],
  1206143: ['011212006143', 'Świątniki Górne'],
  1214012: ['011212014012', 'Koniusza'],
  1206092: ['011212006092', 'Mogilany'],
  1206022: ['011212006022', 'Igołomia-Wawrzeńczyce'],
}

const sq = (s) => s.replaceAll("'", "''")

// --- Ekstrakt OSM ---------------------------------------------------------------------------

/**
 * Plik PBF z cache. Używamy najnowszego malopolskie-YYMMDD.osm.pbf, jaki leży w etl/.cache
 * (też z #45), albo pliku malopolskie.osm.pbf z #8; dopiero bez nich pobieramy ekstrakt.
 * Odświeżenie danych = usunięcie pliku z cache.
 */
async function ustalPbf() {
  if (MIASTO_INFO) {
    const r = await pbfRegionu()
    return { plik: r.plik, stan: r.stan }
  }
  mkdirSync(CACHE, { recursive: true })
  const zData = readdirSync(CACHE)
    .map((n) => /^malopolskie-(\d{2})(\d{2})(\d{2})\.osm\.pbf$/.exec(n))
    .filter(Boolean)
    .map((m) => ({ plik: join(CACHE, m[0]), stan: `20${m[1]}-${m[2]}-${m[3]}` }))
    .sort((a, b) => b.stan.localeCompare(a.stan))
  if (zData.length) return zData[0]

  const odp = await fetch(GEOFABRIK, {
    method: 'HEAD',
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30_000),
  })
  const m = /malopolskie-(\d{2})(\d{2})(\d{2})\.osm\.pbf/.exec(odp.url)
  const rozmiar = Number(odp.headers.get('content-length'))
  if (!odp.ok || !m || !Number.isFinite(rozmiar))
    throw new Error('Geofabrik: brak daty lub rozmiaru')
  const stan = `20${m[1]}-${m[2]}-${m[3]}`
  const stary = join(CACHE, 'malopolskie.osm.pbf')
  if (existsSync(stary)) return { plik: stary, stan }

  const cel = join(CACHE, `malopolskie-${m[1]}${m[2]}${m[3]}.osm.pbf`)
  console.log(`Pobieram ekstrakt Geofabrik ${stan} (${(rozmiar / 1e6).toFixed(0)} MB)…`)
  const plik = await fetch(odp.url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(1_800_000),
  })
  if (!plik.ok || !plik.body) throw new Error(`Geofabrik: HTTP ${plik.status}`)
  const tymczasowy = `${cel}.tmp`
  await pipeline(Readable.fromWeb(plik.body), createWriteStream(tymczasowy))
  if (statSync(tymczasowy).size !== rozmiar) throw new Error('Geofabrik: niepełny plik PBF')
  renameSync(tymczasowy, cel)
  return { plik: cel, stan }
}

const wiersze = async (c, sql) => (await c.runAndReadAll(sql)).getRowObjectsJson()

/** Dwa przebiegi po PBF: otagowane węzły i linie, potem współrzędne węzłów potrzebnych liniom. */
async function obiektyZPbf(pbf) {
  const db = await DuckDBInstance.create(':memory:')
  const c = await db.connect()
  try {
    await c.run('INSTALL spatial')
  } catch {} // bez sieci zostaje rozszerzenie z poprzedniej instalacji
  await c.run('LOAD spatial')
  const osm = `ST_ReadOSM('${sq(pbf.replaceAll('\\', '/'))}')`
  const kolumny = KLUCZE_TAGOW.map((k) => `map_extract_value(tags, '${k}') as "${k}"`).join(', ')
  await c.run(
    `create table obiekty as
     select kind, id, refs, lat, lon, ${kolumny} from ${osm}
     where kind in ('node', 'way') and cardinality(tags) > 0 and (${warunekSql()})
     order by kind, id`,
  )
  await c.run(
    `create table potrzebne as select distinct unnest(refs) as id from obiekty where kind = 'way'`,
  )
  await c.run(
    `create table wezly as select n.id, n.lat, n.lon from ${osm} n
     semi join potrzebne p on p.id = n.id where n.kind = 'node'`,
  )
  const obiekty = await wiersze(c, 'select * from obiekty')
  const wezly = await wiersze(c, 'select id, lat, lon from wezly')
  c.closeSync()
  return { obiekty, wezly }
}

/** Odcisk definicji grup i geometrii: zmiana tagów albo filtrów unieważnia cache wyciągu. */
function odciskDefinicji() {
  const tekst = JSON.stringify([
    GRUPY.map((g) => [g.id, g.tagi, String(g.akceptuj), Boolean(g.brzeg)]),
    String(srodekLinii),
    String(punktyBrzegu),
    String(scalDuplikaty),
  ])
  return createHash('sha256').update(tekst).digest('hex').slice(0, 8)
}

/** Obiekty z PBF rozdzielone na grupy. Zwraca { id: { obiekty: [{lat,lon,nazwa}], brzeg: [...] | null } }. */
function zbudujGrupy({ obiekty, wezly }) {
  const wsp = new Map(wezly.map((w) => [w.id, [Number(w.lat), Number(w.lon)]]))
  const grupy = Object.fromEntries(
    GRUPY.map((g) => [g.id, { obiekty: [], brzeg: g.brzeg ? [] : null }]),
  )
  let bezWezlow = 0
  for (const o of obiekty) {
    const tagi = Object.fromEntries(KLUCZE_TAGOW.filter((k) => o[k] != null).map((k) => [k, o[k]]))
    const ids = klasyfikuj(tagi)
    if (!ids.length) continue
    let lat
    let lon
    let lats = null
    let lons = null
    if (o.kind === 'node') {
      lat = Number(o.lat)
      lon = Number(o.lon)
    } else {
      const znane = o.refs.map((r) => wsp.get(r)).filter(Boolean)
      // Linia przy granicy ekstraktu może mieć niepełną listę węzłów – wtedy jej środek byłby fałszywy.
      if (znane.length < 2 || znane.length < 0.8 * o.refs.length) {
        bezWezlow++
        continue
      }
      lats = znane.map((p) => p[0])
      lons = znane.map((p) => p[1])
      ;[lat, lon] = srodekLinii(lats, lons)
    }
    for (const id of ids) {
      const g = grupy[id]
      const nazwa = tagi.name ?? null
      g.obiekty.push({ lat, lon, nazwa })
      if (g.brzeg)
        for (const [bLat, bLon] of lats ? punktyBrzegu(lats, lons) : [[lat, lon]])
          g.brzeg.push({ lat: bLat, lon: bLon, nazwa })
    }
  }
  for (const g of GRUPY) {
    // Ten sam obiekt bywa w OSM i węzłem, i budynkiem – dla obszarów (obrys) nie scalamy.
    if (!g.brzeg) grupy[g.id].obiekty = scalDuplikaty(grupy[g.id].obiekty)
  }
  return { grupy, bezWezlow }
}

/** Grupy punktów z cache albo z PBF. Cache w formie tablic [lat, lon, nazwa] – jest mały i stabilny. */
async function grupyOsm(pbf, stan) {
  const cel = join(
    CACHE,
    `osm-uslugi-${stan}-${odciskDefinicji()}${MIASTO_INFO ? `-${MIASTO_INFO.pbf}` : ''}.json`,
  )
  const rozwin = (t) => (t ? t.map(([lat, lon, nazwa]) => ({ lat, lon, nazwa })) : null)
  if (existsSync(cel)) {
    const j = JSON.parse(readFileSync(cel, 'utf8'))
    return {
      grupy: Object.fromEntries(
        Object.entries(j.grupy).map(([id, g]) => [
          id,
          { obiekty: rozwin(g.obiekty), brzeg: rozwin(g.brzeg) },
        ]),
      ),
      bezWezlow: j.bezWezlow,
    }
  }
  const t0 = Date.now()
  const { grupy, bezWezlow } = zbudujGrupy(await obiektyZPbf(pbf))
  console.log(`Przebieg po PBF: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  const zwin = (t) => (t ? t.map((p) => [p.lat, p.lon, p.nazwa]) : null)
  writeFileSync(
    cel,
    JSON.stringify({
      grupy: Object.fromEntries(
        Object.entries(grupy).map(([id, g]) => [
          id,
          { obiekty: zwin(g.obiekty), brzeg: zwin(g.brzeg) },
        ]),
      ),
      bezWezlow,
    }),
  )
  return { grupy, bezWezlow }
}

// --- InPost ---------------------------------------------------------------------------------

async function pobierzJson(url, naglowki = {}, proby = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', ...naglowki },
        signal: AbortSignal.timeout(60_000),
      })
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
      return await r.json()
    } catch (e) {
      if (i >= proby) throw e
      await new Promise((ok) => setTimeout(ok, 1500 * i))
    }
  }
}

/** Wszystkie punkty InPost województwa (strony po 500), bez tokenu. Wynik z dnia pobrania w cache. */
async function punktyInPost() {
  const cel = join(CACHE, `inpost-punkty${MIASTO_INFO ? `-${MIASTO_INFO.pbf}` : ''}-${dzis()}.json`)
  if (existsSync(cel)) return JSON.parse(readFileSync(cel, 'utf8'))
  const items = []
  let zgloszone = 0
  for (let strona = 1, stron = 1; strona <= stron; strona++) {
    const url = `${INPOST_API}?province=${encodeURIComponent(WOJEWODZTWO)}&per_page=500&page=${strona}&fields=name,type,status,location`
    const j = await pobierzJson(url)
    stron = j.total_pages
    zgloszone = j.count
    items.push(...j.items)
  }
  if (items.length !== zgloszone || items.length < (MIASTO_INFO ? 300 : 2_000))
    throw new Error(`InPost: ${items.length} punktów, API zgłasza ${zgloszone}`)
  const wynik = { pobrano: dzis(), items }
  writeFileSync(cel, JSON.stringify(wynik))
  return wynik
}

// --- Ludność gmin (do licznika porównawczego) ---------------------------------------------

/** Ludność ogółem 31.12.2024 z BDL GUS dla 14 gmin obszaru. Map teryt → mieszkańcy. */
async function ludnoscGmin(adresy) {
  // Tryb miasta: licznik „na 1000 mieszkańców" porównuje Kraków z obwarzankiem, więc go pomijamy.
  if (MIASTO_INFO) return null
  const cel = join(CACHE, `bdl-ludnosc-${BDL_ROK}.json`)
  let dane
  if (existsSync(cel)) dane = JSON.parse(readFileSync(cel, 'utf8'))
  else {
    dane = {}
    for (const [teryt, [id, nazwa]] of Object.entries(GMINY_BDL)) {
      const j = await pobierzJson(`${BDL}/${id}?var-id=${BDL_ZMIENNA}&year=${BDL_ROK}&format=json`)
      const wartosc = j.results?.[0]?.values?.find((v) => v.year === String(BDL_ROK))?.val
      if (j.unitName !== nazwa || !Number.isFinite(wartosc))
        throw new Error(`BDL ${teryt}: oczekiwano „${nazwa}", jest „${j.unitName}", ${wartosc}`)
      dane[teryt] = wartosc
    }
    writeFileSync(cel, JSON.stringify(dane))
  }
  // Adresy i tabela muszą opisywać te same gminy – inaczej licznik byłby policzony dla innego obszaru.
  const wAdresach = new Map(adresy.map((a) => [a.teryt, a.gmina]))
  for (const [teryt, [, nazwa]] of Object.entries(GMINY_BDL))
    if (wAdresach.get(teryt) !== nazwa)
      throw new Error(
        `Gmina ${teryt}: w adresach „${wAdresach.get(teryt)}", w tabeli BDL „${nazwa}"`,
      )
  if (wAdresach.size !== Object.keys(GMINY_BDL).length)
    throw new Error(
      `Adresy obejmują ${wAdresach.size} gmin, tabela BDL ${Object.keys(GMINY_BDL).length}`,
    )
  return new Map(Object.entries(dane))
}

// --- Warstwy --------------------------------------------------------------------------------

const NEUTRALNA = 'Nie wpływa na wynik, dopóki sam nie wybierzesz kierunku.'

/**
 * Definicje wskaźników. `grupa` = id z GRUPY albo 'inpost'.
 * `zakres`: górna granica skali (ocena 0 od tej odległości) to 90. percentyl odległości w Krakowie,
 * zaokrąglony w górę do 500 m (stan z 2026-10-03, rozkład w etl/osm-uslugi.md). Warstwy liczone
 * do wyniku (`mniej-lepiej`) to te z oczywistym „bliżej lepiej" i pełną mapą (bankomat, poczta,
 * kultura, plac zabaw, paczkomat). Reszta jest neutralna: zależy od stylu życia (weterynarz,
 * akademik, ROD) albo ma niepełne dane w OSM poza miastem (recykling, toalety, AED).
 */
const WARSTWY = [
  {
    id: 'bankomat_poczta_odleglosc',
    grupa: 'bankomat_poczta',
    nazwa: 'Najbliższy bankomat lub poczta',
    tagi: 'amenity=atm, amenity=post_office',
    opis: 'Odległość w linii prostej do najbliższego bankomatu albo placówki pocztowej z OpenStreetMap. Punkty InPost, DPD i innych firm kurierskich wpisane w OSM jako poczta nie są liczone.',
    zakres: [0, 2000],
    kategoria: 'codziennosc',
    kierunek: 'mniej-lepiej',
  },
  {
    id: 'kultura_odleglosc',
    grupa: 'kultura',
    nazwa: 'Najbliższe miejsce kultury',
    tagi: 'amenity=theatre, cinema, arts_centre, library, community_centre; tourism=museum, gallery',
    opis: 'Odległość w linii prostej do najbliższego teatru, kina, biblioteki, domu lub centrum kultury, muzeum albo galerii z OpenStreetMap. Dom kultury rozpoznajemy po tagu lub nazwie; świetlic wiejskich i domów parafialnych nie liczymy. Repertuaru i godzin otwarcia w danych nie ma.',
    zakres: [0, 2000],
    kategoria: 'codziennosc',
    kierunek: 'mniej-lepiej',
  },
  {
    id: 'plac_zabaw_odleglosc',
    grupa: 'plac_zabaw',
    nazwa: 'Najbliższy plac zabaw',
    tagi: 'leisure=playground',
    opis: 'Odległość w linii prostej do najbliższego publicznego placu zabaw z OpenStreetMap. Pomijamy place prywatne, przy lokalach dla klientów, na zezwolenie oraz płatne sale zabaw, trampoliny i parki linowe. Plac to powierzchnia, więc liczymy do jego środka.',
    zakres: [0, 1000],
    kategoria: 'codziennosc',
    kierunek: 'mniej-lepiej',
  },
  {
    id: 'recykling_odleglosc',
    grupa: 'recykling',
    nazwa: 'Najbliższy punkt recyklingu',
    tagi: 'amenity=recycling',
    opis: `Odległość w linii prostej do najbliższego kontenera lub punktu selektywnej zbiórki odpadów z OpenStreetMap. Gdy odpady odbiera się sprzed domu, kontener bywa zbędny. ${NEUTRALNA}`,
    zakres: [0, 1500],
    kategoria: 'codziennosc',
    kierunek: 'neutralny',
  },
  {
    id: 'toaleta_woda_odleglosc',
    grupa: 'toaleta_woda',
    nazwa: 'Najbliższa toaleta publiczna lub woda pitna',
    tagi: 'amenity=toilets, amenity=drinking_water',
    opis: `Odległość w linii prostej do najbliższej toalety publicznej albo punktu wody pitnej z OpenStreetMap. Toalety dla klientów, prywatne i na zezwolenie są pominięte; godzin otwarcia i opłat w danych nie ma. ${NEUTRALNA}`,
    zakres: [0, 2000],
    kategoria: 'codziennosc',
    kierunek: 'neutralny',
  },
  {
    id: 'weterynarz_odleglosc',
    grupa: 'weterynarz',
    nazwa: 'Najbliższy weterynarz',
    tagi: 'amenity=veterinary',
    opis: `Odległość w linii prostej do najbliższej lecznicy lub gabinetu weterynaryjnego z OpenStreetMap. Dotyczy osób ze zwierzętami. ${NEUTRALNA}`,
    zakres: [0, 3000],
    kategoria: 'codziennosc',
    kierunek: 'neutralny',
  },
  {
    id: 'rod_odleglosc',
    grupa: 'rod',
    nazwa: 'Najbliższy ogród działkowy',
    tagi: 'landuse=allotments',
    opis: `Odległość w linii prostej do najbliższego ogrodu działkowego (ROD) z OpenStreetMap, liczona do najbliższego punktu jego granicy. Nie mówi nic o wolnych działkach. ${NEUTRALNA}`,
    zakres: [0, 2500],
    kategoria: 'codziennosc',
    kierunek: 'neutralny',
  },
  {
    id: 'akademik_odleglosc',
    grupa: 'akademik',
    nazwa: 'Najbliższy akademik',
    tagi: 'building=dormitory, amenity=student_accommodation',
    opis: `Odległość w linii prostej do najbliższego domu studenckiego z OpenStreetMap. Internaty szkolne i bursy odrzucamy po nazwie, a budynek bez nazwy liczymy. Dotyczy głównie studentów. ${NEUTRALNA}`,
    zakres: [0, 6500],
    kategoria: 'codziennosc',
    kierunek: 'neutralny',
  },
  {
    id: 'defibrylator_odleglosc',
    grupa: 'defibrylator',
    nazwa: 'Najbliższy defibrylator AED',
    tagi: 'emergency=defibrillator',
    opis: `Odległość w linii prostej do najbliższego ogólnodostępnego defibrylatora z OpenStreetMap. Pomijamy urządzenia dla klientów, prywatne, na zezwolenie i te w budynkach bez wskazanego dostępu. OSM nie zna godzin dostępu ani stanu urządzenia, a rejestr AED w OSM jest niepełny. ${NEUTRALNA}`,
    zakres: [0, 2500],
    kategoria: 'bezpieczenstwo',
    kierunek: 'neutralny',
  },
]

const zrodloOsm = (tagi, stan) => ({
  nazwa: MIASTO_INFO
    ? `OpenStreetMap, ekstrakt województwa ${WOJEWODZTWO} (lustro download.openstreetmap.fr; ${tagi})`
    : `OpenStreetMap, ekstrakt Geofabrik – małopolskie (${tagi})`,
  url: MIASTO_INFO ? 'https://download.openstreetmap.fr/extracts/europe/poland/' : STRONA_GEOFABRIK,
  licencja: LICENCJA_OSM,
  dataDanych: stan,
  pobrano: dzis(),
})

const zrodloBdl = {
  nazwa: `GUS, Bank Danych Lokalnych – ludność ogółem 31.12.${BDL_ROK} (mianownik licznika na 1000 mieszkańców)`,
  url: 'https://bdl.stat.gov.pl/bdl/start',
  licencja: 'Dane publiczne GUS; wskazanie źródła, warunki u wydawcy',
  dataDanych: `${BDL_ROK}-12-31`,
  pobrano: dzis(),
}

const zdanieLicznika = (l, jak) =>
  !l
    ? ''
    : `${jak} na 1000 mieszkańców: ${liczbaPL(l.krakow.na1000)} w Krakowie, ${liczbaPL(l.obwarzanek.na1000)} w 13 gminach obwarzanka.`

/** Percentyl z posortowanej tablicy. */
const pct = (t, p) => (t.length ? t[Math.min(t.length - 1, Math.floor(p * (t.length - 1)))] : null)

function rozklad(adresy, wartosci) {
  const wg = (czyKrakow) =>
    wartosci
      .filter(
        (v, i) =>
          v !== null && (MIASTO_INFO ? czyKrakow : (adresy[i].teryt === TERYT_KRAKOWA) === czyKrakow),
      )
      .sort((a, b) => a - b)
  return Object.fromEntries(
    [
      ['Kraków', true],
      ['obwarzanek', false],
    ].map(([nazwa, k]) => {
      const t = wg(k)
      return [
        nazwa,
        {
          n: t.length,
          p10: pct(t, 0.1),
          p50: pct(t, 0.5),
          p90: pct(t, 0.9),
          p99: pct(t, 0.99),
          max: pct(t, 1),
        },
      ]
    }),
  )
}

/** Porównanie indeksu siatkowego z pełnym przeglądem na losowych adresach (stałe ziarno). */
function kontrolaIndeksu(adresy, punkty, wartosci, nazwa) {
  let ziarno = 42
  const los = () => {
    ziarno = (ziarno * 1_103_515_245 + 12_345) % 2_147_483_648
    return ziarno / 2_147_483_648
  }
  for (let i = 0; i < 150; i++) {
    const a = adresy[Math.floor(los() * adresy.length)]
    const pelny = Math.min(...punkty.map((p) => odlegloscMetry(a.lat, a.lon, p.lat, p.lon)))
    const wynik = wartosci[a.i]
    if (pelny > MAX_M) {
      if (wynik !== null)
        throw new Error(`${nazwa}: adres ${a.i} dalej niż ${MAX_M} m, a wartość ${wynik}`)
      continue
    }
    // Indeks wybiera kandydata po płaskich współrzędnych (błąd do 0,1%), a mierzy haversine'em,
    // więc dla dwóch niemal równo odległych punktów może wskazać drugi: dopuszczamy 1 m + 0,2%.
    const roznica = Math.abs(Math.round(pelny) - wynik)
    if (!(roznica <= 1 + 0.002 * pelny))
      throw new Error(
        `${nazwa}: indeks różni się od pełnego przeglądu o ${roznica} m (${wynik} vs ${pelny})`,
      )
  }
}

const KONTROLA_MIEJSC = MIASTO_INFO
  ? []
  : [
  ['Kraków', 'Rynek Główny', '10', 'Rynek Główny 10 (Stare Miasto)'],
  ['Kraków', 'Powstańców Wielkopolskich', '1', 'Powstańców Wielkopolskich 1 (Kraków, Dębniki)'],
  ['Wieliczka', 'Rynek Górny', '7', 'Wieliczka, Rynek Górny 7'],
  ['Skawina', 'Rynek', '2', 'Skawina, Rynek 2'],
  ['Niepołomice', 'Rynek', '19', 'Niepołomice, Rynek 19'],
  ['Koniusza', '', '70', 'Koniusza 70 (wieś)'],
]

export async function licz() {
  const t0 = Date.now()
  const { adresy } = wczytajAdresy()
  const { plik: pbf, stan } = await ustalPbf()
  console.log(`Adresy: ${adresy.length}; ekstrakt OSM ${stan} (${pbf})`)
  const { grupy, bezWezlow } = await grupyOsm(pbf, stan)
  const inpost = await punktyInPost()
  const lockers = paczkomaty(inpost.items)
  const ludnosc = await ludnoscGmin(adresy)
  console.log(
    `Linii bez węzłów w ekstrakcie (pominięte): ${bezWezlow}; paczkomatów InPost: ${lockers.length} z ${inpost.items.length} punktów`,
  )
  const najblizszyAdres = budujNajblizszy(adresy, MAX_DO_GMINY_M)

  const wszystkie = [
    ...WARSTWY.map((w) => ({ ...w, g: grupy[w.grupa] })),
    {
      id: 'paczkomat_odleglosc',
      grupa: 'inpost',
      nazwa: 'Najbliższy paczkomat InPost',
      opis: `Odległość w linii prostej do najbliższego paczkomatu InPost z publicznego API operatora (${lockers.length} automatów w ${MIASTO_INFO ? `województwie ${WOJEWODZTWO}` : 'Małopolsce'}; punkty obsługi w sklepach i paczkomaty innych firm nie są liczone). To dane operatora prywatnego, bez licencji otwartej, więc publikujemy wyłącznie odległość.`,
      zakres: [0, 1000],
      kategoria: 'codziennosc',
      kierunek: 'mniej-lepiej',
      g: { obiekty: lockers, brzeg: null },
      inpost: true,
    },
  ]

  const raport = []
  const warstwy = []
  for (const w of wszystkie) {
    const punkty = w.g.brzeg ?? w.g.obiekty
    const wartosci = odleglosci(adresy, punkty, MAX_M)
    kontrolaIndeksu(adresy, punkty, wartosci, w.id)
    const licznik = ludnosc
      ? licznikNa1000(obiektyWGminach(w.g.obiekty, najblizszyAdres), ludnosc, TERYT_KRAKOWA)
      : null
    const opis = w.inpost
      ? `${w.opis} ${zdanieLicznika(licznik, 'Paczkomatów')}`
      : `${w.opis} Kompletność mapy OSM jest nierówna. ${zdanieLicznika(licznik, 'Obiektów tej grupy')}`
    zapiszWskaznik(
      {
        id: w.id,
        kategoria: w.kategoria,
        nazwa: w.nazwa,
        opis,
        jednostka: 'm',
        kierunek: w.kierunek,
        rozdzielczosc: 'adres',
        zakres: w.zakres,
        zadanie: ZADANIE,
        zrodla: [
          w.inpost
            ? {
                nazwa:
                  MIASTO_INFO
                  ? `InPost – publiczne API punktów (ShipX), paczkomaty województwa ${WOJEWODZTWO}, migawka z dnia pobrania`
                  : 'InPost – publiczne API punktów (ShipX), paczkomaty województwa małopolskiego, migawka z dnia pobrania',
                url: INPOST_API,
                licencja:
                  'Dane operatora prywatnego bez licencji otwartej; publikujemy wyłącznie odległość, bez listy punktów',
                dataDanych: inpost.pobrano,
                pobrano: inpost.pobrano,
              }
            : zrodloOsm(w.tagi, stan),
          ...(ludnosc ? [zrodloBdl] : []),
        ],
      },
      wartosci,
    )
    warstwy.push({ w, punkty, wartosci })
    raport.push({
      id: w.id,
      obiektow: w.g.obiekty.length,
      licznik,
      rozklad: rozklad(adresy, wartosci),
    })
  }

  console.log(
    '\nRozkład odległości [m] (p10 / p50 / p90 / p99 / max) i obiekty na 1000 mieszkańców:',
  )
  for (const r of raport) {
    const f = (x) => [x.p10, x.p50, x.p90, x.p99, x.max].join(' / ')
    console.log(
      r.licznik
        ? `${r.id.padEnd(28)} w Małopolsce ${String(r.obiektow).padStart(5)} | Kraków ${f(r.rozklad.Kraków)} (${liczbaPL(r.licznik.krakow.na1000)}/1000) | obwarzanek ${f(r.rozklad.obwarzanek)} (${liczbaPL(r.licznik.obwarzanek.na1000)}/1000)`
        : `${r.id.padEnd(28)} w województwie ${String(r.obiektow).padStart(5)} | miasto ${f(r.rozklad.Kraków)}`,
    )
  }

  console.log('\nKontrola na znanych adresach (odległość w m, najbliższy obiekt):')
  for (const [miejscowosc, ulica, nr, opis] of KONTROLA_MIEJSC) {
    const a = adresy.find(
      (x) => x.miejscowosc === miejscowosc && (x.ulica ?? '') === ulica && x.nr === nr,
    )
    if (!a) {
      console.log(`  ${opis}: brak takiego adresu w adresy.json`)
      continue
    }
    const wiersz = warstwy.map(({ w, punkty, wartosci }) => {
      const najblizszy = budujNajblizszy(punkty, MAX_M)(a.lat, a.lon)
      return `${w.id.replace('_odleglosc', '')} ${wartosci[a.i]}${najblizszy?.punkt.nazwa ? ` (${najblizszy.punkt.nazwa})` : ''}`
    })
    console.log(`  ${opis}:\n    ${wiersz.join('\n    ')}`)
  }
  console.log(`\nCzas: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await licz()
