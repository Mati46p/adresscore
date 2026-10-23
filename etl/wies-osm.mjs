// Wskaźniki odległościowe dla gminy wiejskiej z OpenStreetMap (Refs #246): policja, sport, liceum, woda.
// Odpowiedniki krakowskich policja_odleglosc / sport_odleglosc (MSIP, ZIS) i liceum_odleglosc /
// woda_odleglosc (Metropolia Krakowska), których źródła kończą się na granicy Metropolii.
// Nazwa wskaźnika i kontrakt (docs/etapy/kontrakt-danych.md) bez zmian; zmienia się tylko źródło.
// Uruchom: ADRESCORE_MIASTO=redziny node etl/wies-osm.mjs [--sprawdz]
//   --sprawdz = liczy i drukuje pokrycie, ale nie zapisuje plików.
//
// Pominięte celowo (dane na wsi byłyby mylące albo już są pod inną nazwą):
//   droga_rowerowa_odleglosc – krakowska wersja to „główne trasy Metropolii" (Velo Metropolis, WTR);
//     poza Metropolią takiej listy nie ma, a pełna sieć OSM jest już w rower_infrastruktura_odleglosc;
//   stojaki_300m – ewidencja ZTP tylko dla Krakowa; w OSM stojaków na wsi jest garstka, więc zero
//     w promieniu 300 m znaczyłoby brak mapowania, nie brak stojaków;
//   drzewa_100m – rejestr drzew Krakowa; drzewa w OSM na wsi są mapowane punktowo prawie wcale,
//     a udział zieleni pokazuje już zielen_worldcover_100m.
import { pathToFileURL } from 'node:url'
import { DuckDBInstance } from '@duckdb/node-api'
import { bboxMiasta, MIASTO_INFO, pbfRegionu, WOJEWODZTWO } from './lib/miasto.mjs'
import { budujNajblizszy, punktyBrzegu, scalDuplikaty, srodekLinii } from './lib/osm-uslugi.mjs'
import { dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ZADANIE = 246
const MAX_M = 30_000
const LICENCJA_OSM =
  'ODbL 1.0 – © współtwórcy OpenStreetMap: https://www.openstreetmap.org/copyright'
const URL_OSM = 'https://download.openstreetmap.fr/extracts/europe/poland/'
const KLUCZE = ['amenity', 'leisure', 'natural', 'waterway', 'name', 'access', 'indoor', 'tunnel']
const sq = (s) => s.replaceAll("'", "''")

const NIE_LICEUM = /dla dorosłych|wieczorow|zaoczn|specjaln|policealn/i
const prywatny = (t) => ['private', 'no', 'customers', 'permit'].includes(t.access)

/** Grupy: `tagi` [klucz, wartość], `akceptuj` filtr, `brzeg` = liczymy do obrysu / osi, nie do środka. */
export const GRUPY_WIES = [
  {
    id: 'policja',
    tagi: [['amenity', 'police']],
    akceptuj: (t) => !prywatny(t),
  },
  {
    id: 'sport',
    tagi: [
      ['leisure', 'pitch'],
      ['leisure', 'sports_centre'],
      ['leisure', 'stadium'],
      ['leisure', 'swimming_pool'],
      ['leisure', 'track'],
    ],
    akceptuj: (t) => !prywatny(t),
  },
  {
    id: 'liceum',
    tagi: [['amenity', 'school']],
    akceptuj: (t) => /liceum/i.test(t.name ?? '') && !NIE_LICEUM.test(t.name ?? ''),
  },
  {
    id: 'woda',
    tagi: [
      ['natural', 'water'],
      ['waterway', 'river'],
      ['waterway', 'stream'],
      ['waterway', 'canal'],
    ],
    // Odcinki pod ziemią (tunnel=culvert itp.) to nie woda powierzchniowa.
    akceptuj: (t) => !t.tunnel || t.tunnel === 'no',
    brzeg: true,
  },
]

export const klasyfikujWies = (tagi) =>
  GRUPY_WIES.filter(
    (g) => g.tagi.some(([k, v]) => tagi[k] === v) && (!g.akceptuj || g.akceptuj(tagi)),
  ).map((g) => g.id)

function warunekSql() {
  const poKluczu = new Map()
  for (const g of GRUPY_WIES)
    for (const [k, v] of g.tagi) poKluczu.set(k, [...(poKluczu.get(k) ?? []), v])
  return [...poKluczu]
    .map(([k, w]) => `map_extract_value(tags, '${k}') in (${w.map((v) => `'${v}'`).join(', ')})`)
    .join(' or ')
}

const wiersze = async (c, sql) => (await c.runAndReadAll(sql)).getRowObjectsJson()

async function obiektyZPbf(pbf, bbox) {
  const db = await DuckDBInstance.create(':memory:')
  const c = await db.connect()
  try {
    await c.run('INSTALL spatial')
  } catch {}
  await c.run('LOAD spatial')
  const osm = `ST_ReadOSM('${sq(pbf.replaceAll('\\', '/'))}')`
  const kolumny = KLUCZE.map((k) => `map_extract_value(tags, '${k}') as "${k}"`).join(', ')
  const wBbox = (p) =>
    `${p}lat between ${bbox.minLat} and ${bbox.maxLat} and ${p}lon between ${bbox.minLon} and ${bbox.maxLon}`
  // Węzły filtrujemy prostokątem, linie bierzemy wszystkie (nie mają współrzędnych) i odsiewamy
  // te bez żadnego węzła w prostokącie.
  await c.run(
    `create table obiekty as
     select kind, id, refs, lat, lon, ${kolumny} from ${osm}
     where kind in ('node', 'way') and cardinality(tags) > 0 and (${warunekSql()})
       and (kind = 'way' or (${wBbox('')}))
     order by kind, id`,
  )
  await c.run(
    `create table potrzebne as select distinct unnest(refs) as id from obiekty where kind = 'way'`,
  )
  await c.run(
    `create table wezly as select n.id, n.lat, n.lon from ${osm} n
     semi join potrzebne p on p.id = n.id where n.kind = 'node' and ${wBbox('n.')}`,
  )
  const obiekty = await wiersze(c, 'select * from obiekty')
  const wezly = await wiersze(c, 'select id, lat, lon from wezly')
  c.closeSync()
  return { obiekty, wezly }
}

export function zbudujGrupy({ obiekty, wezly }) {
  const wsp = new Map(wezly.map((w) => [w.id, [Number(w.lat), Number(w.lon)]]))
  const grupy = Object.fromEntries(GRUPY_WIES.map((g) => [g.id, []]))
  const brzegowa = new Set(GRUPY_WIES.filter((g) => g.brzeg).map((g) => g.id))
  for (const o of obiekty) {
    const tagi = Object.fromEntries(KLUCZE.filter((k) => o[k] != null).map((k) => [k, o[k]]))
    const ids = klasyfikujWies(tagi)
    if (!ids.length) continue
    const nazwa = tagi.name ?? null
    if (o.kind === 'node') {
      for (const id of ids) grupy[id].push({ lat: Number(o.lat), lon: Number(o.lon), nazwa })
      continue
    }
    const znane = o.refs.map((r) => wsp.get(r)).filter(Boolean)
    if (!znane.length) continue
    const lats = znane.map((p) => p[0])
    const lons = znane.map((p) => p[1])
    for (const id of ids) {
      if (brzegowa.has(id)) {
        // Linia częściowo poza prostokątem: znane odcinki wystarczą, reszta jest dalej niż MAX_M.
        for (const [lat, lon] of punktyBrzegu(lats, lons, 25)) grupy[id].push({ lat, lon, nazwa })
      } else if (znane.length >= 0.8 * o.refs.length) {
        const [lat, lon] = srodekLinii(lats, lons)
        grupy[id].push({ lat, lon, nazwa })
      }
    }
  }
  for (const g of GRUPY_WIES) if (!g.brzeg) grupy[g.id] = scalDuplikaty(grupy[g.id])
  return grupy
}

const OPISY = {
  policja: {
    id: 'policja_odleglosc',
    kategoria: 'bezpieczenstwo',
    kierunek: 'mniej-lepiej',
    nazwa: 'Najbliższa jednostka policji',
    zakres: [0, 8500],
    tagi: 'amenity=police',
    opis: (n) =>
      `Dostępność policji, nie przestępczość: odległość w linii prostej od adresu do najbliższej jednostki policji (komisariat, posterunek, komenda) z OpenStreetMap; w zbiorze ${n} obiektów w okolicy gminy, także poza jej granicą. Wskaźnik nie mówi nic o bezpieczeństwie, czasie reakcji patroli ani godzinach otwarcia. Na wsi najbliższa jednostka jest zwykle w sąsiedniej gminie, więc odległości są duże; to cecha danych, nie błąd.`,
  },
  sport: {
    id: 'sport_odleglosc',
    kategoria: 'codziennosc',
    kierunek: 'mniej-lepiej',
    nazwa: 'Najbliższy obiekt sportowy',
    zakres: [0, 2000],
    tagi: 'leisure=pitch, sports_centre, stadium, swimming_pool, track',
    opis: (n) =>
      `Odległość w linii prostej (nie trasa) od adresu do najbliższego boiska, hali lub centrum sportowego, stadionu, basenu albo bieżni z OpenStreetMap; w zbiorze ${n} obiektów w okolicy gminy. Pomijamy obiekty prywatne i na zezwolenie. Mapa OSM nie jest pełnym spisem obiektów, nie podaje godzin ani warunków wstępu, a obiekty szkolne bywają niedostępne po lekcjach.`,
  },
  liceum: {
    id: 'liceum_odleglosc',
    kategoria: 'codziennosc',
    kierunek: 'neutralny',
    nazwa: 'Najbliższe liceum ogólnokształcące',
    zakres: [0, 10000],
    tagi: 'amenity=school z „liceum" w nazwie',
    opis: (n) =>
      `Odległość w linii prostej od adresu do najbliższego liceum ogólnokształcącego z OpenStreetMap (szkoła z „liceum" w nazwie; ${n} w okolicy gminy). Pominięto licea dla dorosłych, wieczorowe, zaoczne, specjalne i policealne. Rozpoznanie po nazwie może pominąć szkołę wpisaną jako „Zespół Szkół" bez słowa „liceum". To nie jest trasa ani czas dojazdu, a na wsi liceum leży zwykle w mieście powiatowym.`,
  },
  woda: {
    id: 'woda_odleglosc',
    kategoria: 'kontekst',
    kierunek: 'neutralny',
    nazwa: 'Najbliższa woda powierzchniowa',
    zakres: [0, 1500],
    tagi: 'natural=water; waterway=river, stream, canal',
    opis: () =>
      'Odległość w linii prostej od adresu do najbliższej wody powierzchniowej z OpenStreetMap: osi rzeki, potoku lub kanału (bez odcinków pod ziemią) albo brzegu zbiornika, także małego stawu. Duże jeziora zapisane jako relacje w OSM nie są liczone, a odległość mierzymy do punktów co 25 m wzdłuż linii. To kontekst, nie ocena: bliskość wody nie mówi o zagrożeniu powodziowym, to pokazują osobne warstwy.',
  },
}

export async function licz({ zapisz = true } = {}) {
  if (!MIASTO_INFO?.wiejska) throw new Error('Skrypt dla gmin wiejskich: ADRESCORE_MIASTO=<slug>')
  const t0 = Date.now()
  const { adresy } = wczytajAdresy()
  const { plik, stan } = await pbfRegionu()
  const bbox = bboxMiasta(0.3, 0.5)
  console.log(`Adresy: ${adresy.length}; PBF ${plik} (stan ${stan})`)
  const grupy = zbudujGrupy(await obiektyZPbf(plik, bbox))
  const wyniki = {}
  for (const g of GRUPY_WIES) {
    const def = OPISY[g.id]
    const punkty = grupy[g.id]
    const najblizszy = budujNajblizszy(punkty, MAX_M)
    const trafienia = adresy.map((a) => najblizszy(a.lat, a.lon))
    const wartosci = trafienia.map((w) => (w ? Math.round(w.metry) : null))
    const etykiety = trafienia.map((w) => w?.punkt.nazwa ?? null)
    const z = wartosci.filter((v) => v !== null).sort((a, b) => a - b)
    console.log(
      `${def.id}: obiektów ${punkty.length}, z wartością ${z.length}/${adresy.length}, mediana ${z[Math.floor(z.length / 2)]} m, max ${z.at(-1)} m`,
    )
    if (punkty.length < 1 || z.length === 0) {
      console.log(`  POMINIĘTY ${def.id}: brak obiektów w promieniu ${MAX_M} m`)
      continue
    }
    wyniki[g.id] = z.length
    if (!zapisz) continue
    zapiszWskaznik(
      {
        id: def.id,
        kategoria: def.kategoria,
        nazwa: def.nazwa,
        opis: def.opis(punkty.length),
        jednostka: 'm',
        kierunek: def.kierunek,
        rozdzielczosc: 'adres',
        zakres: def.zakres,
        zadanie: ZADANIE,
        zrodla: [
          {
            nazwa: `OpenStreetMap, ekstrakt województwa ${WOJEWODZTWO} (lustro download.openstreetmap.fr; ${def.tagi})`,
            url: URL_OSM,
            licencja: LICENCJA_OSM,
            dataDanych: stan,
            pobrano: dzis(),
          },
        ],
      },
      wartosci,
      g.id === 'woda' ? undefined : etykiety,
    )
  }
  console.log(`Czas: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  return wyniki
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await licz({ zapisz: !process.argv.includes('--sprawdz') })
