// Warstwy „OSM – uzupełnienie" (#159), uzupełnienie #124 o grupy spoza jego zakresu:
//   – odległość w linii prostej od adresu do najbliższej ładowarki samochodów elektrycznych,
//     targowiska, wybiegu dla psów, siłowni plenerowej oraz urzędu gminy, miasta lub dzielnicy,
//   – liczba barów, pubów i klubów nocnych w promieniu 300 m (OpenStreetMap, ekstrakt Geofabrik –
//     małopolskie, ODbL).
// Uruchom: node etl/osm-uzupelnienie.mjs. Jedno wyciągnięcie dla wszystkich grup z pliku PBF
// (DuckDB spatial, ST_ReadOSM: obiekty z tagami, zewnętrzne linie relacji wielokątów, potem węzły
// tych linii); surowy ekstrakt leży w etl/.cache (ten sam plik co w #124, #45 i #104), drugi bieg
// niczego nie pobiera.
// Metoda, filtry i kontrola wyniku: etl/osm-uzupelnienie.md. Publikujemy wyłącznie odległości
// i liczby, nie punkty: ODbL pozwala na wskaźniki pochodne.
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
  liczbaPL,
  licznikNa1000,
  obiektyWGminach,
  odleglosci,
  punktyBrzegu,
  srodekLinii,
} from './lib/osm-uslugi.mjs'
import {
  GRUPY,
  klasyfikuj,
  kluczeTagow,
  policzWPromieniu,
  scalPunkty,
  warunekSql,
  zaokraglijWGore,
  zewnetrzneLinie,
} from './lib/osm-uzupelnienie.mjs'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ZADANIE = 159
const MAX_M = 30_000 // dalej niż 30 km od jakiegokolwiek obiektu = brak danych (null)
const MAX_DO_GMINY_M = 1_000 // obiekt liczy się do gminy najbliższego adresu, jeśli ten jest bliżej
const PROMIEN_NOCNE_M = 300
const KROK_OBRYSU_M = 25 // punkty wzdłuż obrysu targowiska i wybiegu
const MIN_OBIEKTOW = 20 // grupa z mniejszą liczbą miejsc w obszarze 14 gmin odpada
const TERYT_KRAKOWA = '1261011'
const UA = 'adresscore-etl/1.0 (https://github.com/Mati46p/adresscore)'

const GEOFABRIK = 'https://download.geofabrik.de/europe/poland/malopolskie-latest.osm.pbf'
const STRONA_GEOFABRIK = 'https://download.geofabrik.de/europe/poland/malopolskie.html'
const LICENCJA_OSM =
  'ODbL 1.0 – © współtwórcy OpenStreetMap: https://www.openstreetmap.org/copyright'
const BDL = 'https://bdl.stat.gov.pl/api/v1/data/by-unit'
const BDL_ZMIENNA = 72305 // „ludność ogółem"
const BDL_ROK = 2024

// TERYT gminy → [identyfikator jednostki w BDL, nazwa]. Nazwę sprawdzamy przy pobraniu i w adresach.
// Ta sama lista co w etl/osm-uslugi.mjs (#124); rozjazd z adresami wywala skrypt (ludnoscGmin).
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
 * Plik PBF z cache: najnowszy malopolskie-YYMMDD.osm.pbf albo malopolskie.osm.pbf z towarzyszącym
 * plikiem .stan (data ekstraktu); dopiero bez nich pobieramy ekstrakt. Odświeżenie danych =
 * usunięcie pliku z cache.
 */
async function ustalPbf() {
  mkdirSync(CACHE, { recursive: true })
  const zData = readdirSync(CACHE)
    .map((n) => /^malopolskie-(\d{2})(\d{2})(\d{2})\.osm\.pbf$/.exec(n))
    .filter(Boolean)
    .map((m) => ({ plik: join(CACHE, m[0]), stan: `20${m[1]}-${m[2]}-${m[3]}` }))
    .sort((a, b) => b.stan.localeCompare(a.stan))
  if (zData.length) return zData[0]
  const bezDaty = join(CACHE, 'malopolskie.osm.pbf')
  if (existsSync(bezDaty) && existsSync(`${bezDaty}.stan`))
    return { plik: bezDaty, stan: readFileSync(`${bezDaty}.stan`, 'utf8').trim() }

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

/** Tagi obiektu z wiersza zapytania: tylko klucze z listy i tylko te, które obiekt ma. */
const tagiObiektu = (o, klucze) =>
  Object.fromEntries(klucze.filter((k) => o[k] != null).map((k) => [k, o[k]]))

/**
 * Trzy przebiegi po PBF: otagowane węzły, linie i relacje wielokątów; linie zewnętrznych obrysów
 * tych relacji (same nie mają tagów); współrzędne węzłów potrzebnych liniom.
 */
async function obiektyZPbf(pbf, klucze) {
  const db = await DuckDBInstance.create(':memory:')
  const c = await db.connect()
  try {
    await c.run('INSTALL spatial')
  } catch {} // bez sieci zostaje rozszerzenie z poprzedniej instalacji
  await c.run('LOAD spatial')
  const osm = `ST_ReadOSM('${sq(pbf.replaceAll('\\', '/'))}')`
  const kolumny = klucze.map((k) => `map_extract_value(tags, '${k}') as "${k}"`).join(', ')
  // Relacje bierzemy tylko typu multipolygon (Plac Nowy, Plac Na Stawach): inne, np. site, to nie obrys.
  await c.run(
    `create table obiekty as
     select kind, id, refs, ref_types, ref_roles, lat, lon, ${kolumny} from ${osm}
     where kind in ('node', 'way', 'relation') and cardinality(tags) > 0 and (${warunekSql()})
       and (kind <> 'relation' or map_extract_value(tags, 'type') = 'multipolygon')
     order by kind, id`,
  )
  const obiekty = await wiersze(c, 'select * from obiekty')

  const idCzlonkow = new Set()
  for (const o of obiekty) {
    if (o.kind !== 'relation' || !klasyfikuj(tagiObiektu(o, klucze)).length) continue
    for (const id of zewnetrzneLinie(o.refs, o.ref_types, o.ref_roles)) idCzlonkow.add(id)
  }
  if (![...idCzlonkow].every((id) => /^\d+$/.test(String(id))))
    throw new Error('Relacja z nienumerycznym identyfikatorem członka')
  await c.run(
    `create table czlonkowie as select id, refs from ${osm}
     where kind = 'way' and id in (${idCzlonkow.size ? [...idCzlonkow].join(', ') : '0'})`,
  )
  await c.run(
    `create table potrzebne as
     select distinct id from (
       select unnest(refs) as id from obiekty where kind = 'way'
       union all select unnest(refs) as id from czlonkowie)`,
  )
  await c.run(
    `create table wezly as select n.id, n.lat, n.lon from ${osm} n
     semi join potrzebne p on p.id = n.id where n.kind = 'node'`,
  )
  const czlonkowie = await wiersze(c, 'select id, refs from czlonkowie')
  const wezly = await wiersze(c, 'select id, lat, lon from wezly')
  c.closeSync()
  return { obiekty, czlonkowie, wezly }
}

/**
 * Obiekty z PBF rozdzielone na grupy. Zwraca { id: { surowe, obiekty: [{lat,lon,nazwa}], brzeg: [...] | null,
 * miejsca: [...] } }: `surowe` to liczba obiektów z tagiem grupy przed filtrami, `obiekty` to
 * przyjęte wpisy (do odległości), `miejsca` te same po scaleniu duplikatów (do liczników
 * i do liczenia w promieniu). Węzeł to punkt, linia to jeden obrys, a relacja wielokąta to jeden
 * obrys na każdą zewnętrzną linię.
 */
function zbudujGrupy({ obiekty, czlonkowie, wezly }, klucze) {
  const wsp = new Map(wezly.map((w) => [w.id, [Number(w.lat), Number(w.lon)]]))
  const liniePoId = new Map(czlonkowie.map((w) => [w.id, w.refs]))
  const grupy = Object.fromEntries(
    GRUPY.map((g) => [g.id, { surowe: 0, obiekty: [], brzeg: g.brzeg ? [] : null, miejsca: [] }]),
  )
  let bezWezlow = 0
  for (const o of obiekty) {
    const tagi = tagiObiektu(o, klucze)
    for (const g of GRUPY) if (g.tagi.some(([k, v]) => tagi[k] === v)) grupy[g.id].surowe++
    const ids = klasyfikuj(tagi)
    if (!ids.length) continue
    const ksztalty = []
    if (o.kind === 'node') {
      ksztalty.push({ lat: Number(o.lat), lon: Number(o.lon), lats: null, lons: null })
    } else {
      const linie =
        o.kind === 'way'
          ? [o.refs]
          : zewnetrzneLinie(o.refs, o.ref_types, o.ref_roles).map((id) => liniePoId.get(id) ?? null)
      for (const refs of linie) {
        const znane = (refs ?? []).map((r) => wsp.get(r)).filter(Boolean)
        // Linia przy granicy ekstraktu może mieć niepełną listę węzłów – wtedy jej środek byłby fałszywy.
        if (!refs || znane.length < 2 || znane.length < 0.8 * refs.length) {
          bezWezlow++
          continue
        }
        const lats = znane.map((p) => p[0])
        const lons = znane.map((p) => p[1])
        const [lat, lon] = srodekLinii(lats, lons)
        ksztalty.push({ lat, lon, lats, lons })
      }
    }
    for (const { lat, lon, lats, lons } of ksztalty)
      for (const id of ids) {
        const g = grupy[id]
        const nazwa = tagi.name ?? null
        g.obiekty.push({ lat, lon, nazwa })
        if (g.brzeg)
          for (const [bLat, bLon] of lats ? punktyBrzegu(lats, lons, KROK_OBRYSU_M) : [[lat, lon]])
            g.brzeg.push({ lat: bLat, lon: bLon, nazwa })
      }
  }
  for (const g of GRUPY) {
    const grupa = grupy[g.id]
    grupa.miejsca = scalPunkty(grupa.obiekty, g.scalM, Boolean(g.scalWgNazwy))
  }
  return { grupy, bezWezlow }
}

// --- Ludność gmin (do licznika porównawczego) ---------------------------------------------

async function pobierzJson(url, proby = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
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

/** Ludność ogółem 31.12.2024 z BDL GUS dla 14 gmin obszaru. Map teryt → mieszkańcy. */
async function ludnoscGmin(adresy) {
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
 * Definicje wskaźników. `grupa` = id z GRUPY, `typ`: 'odleglosc' (najbliższy obiekt, m) albo
 * 'liczba' (obiekty w promieniu PROMIEN_NOCNE_M). `zakres` odległości: górna granica skali (ocena 0
 * od tej odległości) to 90. percentyl odległości w Krakowie zaokrąglony w górę do 500 m, jak w #124
 * (stan z 2026-10-03, rozkład w etl/osm-uzupelnienie.md); skrypt ostrzega, gdy świeże dane dają
 * inną wartość. Zakres liczby: 99. percentyl liczby w Krakowie, zaokrąglony w górę do 5.
 * Kierunek: bliżej lepiej tylko dla ładowarki (przyszłość), targowiska i siłowni, jak w zleceniu;
 * reszta zależy od stylu życia i jest neutralna.
 */
const WARSTWY = [
  {
    id: 'ladowarka_ev_odleglosc',
    grupa: 'ladowarka_ev',
    typ: 'odleglosc',
    nazwa: 'Najbliższa ładowarka samochodów elektrycznych',
    tagi: 'amenity=charging_station',
    rzeczownik: 'Lokalizacji ładowarek',
    opis: 'Odległość w linii prostej do najbliższej ogólnodostępnej ładowarki samochodów elektrycznych z OpenStreetMap. Pomijamy stacje prywatne i tylko dla klientów lub pracowników, ładowarki autobusów MPK oraz punkty ładowania rowerów i hulajnóg. OSM nie zna mocy, liczby wolnych gniazd, cennika ani sprawności urządzenia, a część stacji nie jest w nim wpisana. Mierzymy do pozycji stacji, nie do wjazdu na parking.',
    zakres: [0, 3000],
    kategoria: 'przyszlosc',
    kierunek: 'mniej-lepiej',
  },
  {
    id: 'zycie_nocne_300m',
    grupa: 'zycie_nocne',
    typ: 'liczba',
    nazwa: 'Bary, puby i kluby w 300 m',
    tagi: 'amenity=bar, amenity=pub, amenity=nightclub',
    rzeczownik: 'Lokali',
    opis: `Liczba barów, pubów i klubów nocnych z OpenStreetMap w promieniu ${PROMIEN_NOCNE_M} m w linii prostej od adresu. Dla jednych to usługi i życie okolicy po zmroku, dla innych źródło hałasu i tłumów, więc kierunku nie oceniamy. Wpisy o tej samej nazwie w odległości do 25 m (ten sam lokal zapisany jako punkt i jako budynek) liczymy raz, a różne lokale w jednej kamienicy osobno. To liczba lokali, nie poziom hałasu ani godziny otwarcia. Zero oznacza brak wpisu w OSM, nie potwierdzenie ciszy. ${NEUTRALNA}`,
    jednostka: 'szt.',
    zakres: [0, 40],
    kategoria: 'spokoj',
    kierunek: 'neutralny',
  },
  {
    id: 'targowisko_odleglosc',
    grupa: 'targowisko',
    typ: 'odleglosc',
    nazwa: 'Najbliższe targowisko',
    tagi: 'amenity=marketplace',
    rzeczownik: 'Targowisk',
    opis: 'Odległość w linii prostej do najbliższego targowiska, placu targowego lub bazaru z OpenStreetMap, liczona do najbliższego punktu jego obrysu, więc adres przy targowisku ma małą odległość, ale nie zero. Pomijamy wpisy nieczynne i zamknięte dla ogółu. OSM nie odróżnia targowiska z żywnością od bazaru z odzieżą i nie zna dni handlu; wśród wpisów są też pawilony i centra handlowe o charakterze bazaru.',
    zakres: [0, 4000],
    kategoria: 'codziennosc',
    kierunek: 'mniej-lepiej',
  },
  {
    id: 'wybieg_psy_odleglosc',
    grupa: 'wybieg_psy',
    typ: 'odleglosc',
    nazwa: 'Najbliższy wybieg dla psów',
    tagi: 'leisure=dog_park',
    rzeczownik: 'Wybiegów dla psów',
    opis: `Odległość w linii prostej do najbliższego ogólnodostępnego wybiegu dla psów z OpenStreetMap, liczona do najbliższego punktu jego obrysu. Pomijamy wybiegi prywatne, dla klientów, na zezwolenie lub płatne oraz place szkoleniowe. Dotyczy osób ze zwierzętami. ${NEUTRALNA}`,
    zakres: [0, 4000],
    kategoria: 'codziennosc',
    kierunek: 'neutralny',
  },
  {
    id: 'silownia_plenerowa_odleglosc',
    grupa: 'silownia_plenerowa',
    typ: 'odleglosc',
    nazwa: 'Najbliższa siłownia plenerowa',
    tagi: 'leisure=fitness_station',
    rzeczownik: 'Siłowni plenerowych',
    opis: 'Odległość w linii prostej do najbliższego przyrządu siłowni plenerowej z OpenStreetMap. Pomijamy siłownie prywatne, dla pracowników, wojskowe i płatne. Przyrządy tej samej siłowni są w OSM osobnymi punktami, więc odległość liczymy do najbliższego z nich, a w liczniku przyrządy oddalone o najwyżej 50 m to jedno miejsce.',
    zakres: [0, 2000],
    kategoria: 'codziennosc',
    kierunek: 'mniej-lepiej',
  },
  {
    id: 'urzad_odleglosc',
    grupa: 'urzad',
    typ: 'odleglosc',
    nazwa: 'Najbliższy urząd gminy, miasta lub dzielnicy',
    tagi: 'amenity=townhall, office=government (nazwa urzędu gminy, miasta, dzielnicy lub ratusza)',
    rzeczownik: 'Urzędów',
    opis: `Odległość w linii prostej do najbliższego urzędu gminy, miasta lub dzielnicy, ratusza albo siedziby rady dzielnicy Krakowa z OpenStreetMap. Starostwa, urzędy skarbowe, ZUS, inspektoraty i inne instytucje wpisane w OSM jako urząd nie są liczone. Urząd Miasta Krakowa ma wiele siedzib, a w OSM jest tylko część z nich; OSM nie zna godzin przyjęć ani spraw załatwianych w danym punkcie. ${NEUTRALNA}`,
    zakres: [0, 4500],
    kategoria: 'codziennosc',
    kierunek: 'neutralny',
  },
]

const zrodloOsm = (tagi, stan) => ({
  nazwa: `OpenStreetMap, ekstrakt Geofabrik – małopolskie (${tagi})`,
  url: STRONA_GEOFABRIK,
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

const zdanieLicznika = (l, rzeczownik) =>
  `${rzeczownik} na 1000 mieszkańców: ${liczbaPL(l.krakow.na1000)} w Krakowie, ${liczbaPL(l.obwarzanek.na1000)} w 13 gminach obwarzanka.`

/**
 * Gdy Kraków ma na mieszkańca ponad 4 razy więcej wpisów niż gminy obwarzanka, różnica to raczej
 * dziura w mapie niż w mieście: tam brak obiektu w pobliżu częściej znaczy „nie wpisano".
 */
const zdanieLuki = (l) =>
  l.obwarzanek.na1000 === 0 || l.krakow.na1000 > 4 * l.obwarzanek.na1000
    ? ' Poza Krakowem OSM zna wielokrotnie mniej takich miejsc na mieszkańca, więc tam brak obiektu w pobliżu częściej oznacza brak wpisu niż brak miejsca.'
    : ''

/** Percentyl z posortowanej tablicy. */
const pct = (t, p) => (t.length ? t[Math.min(t.length - 1, Math.floor(p * (t.length - 1)))] : null)

function rozklad(adresy, wartosci) {
  const wg = (czyKrakow) =>
    wartosci
      .filter((v, i) => v !== null && (adresy[i].teryt === TERYT_KRAKOWA) === czyKrakow)
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

/** Generator liczb pseudolosowych ze stałym ziarnem – kontrole są powtarzalne. */
function losowy(ziarno = 42) {
  let z = ziarno
  return () => {
    z = (z * 1_103_515_245 + 12_345) % 2_147_483_648
    return z / 2_147_483_648
  }
}

/** Porównanie indeksu siatkowego z pełnym przeglądem na losowych adresach (stałe ziarno). */
function kontrolaIndeksu(adresy, punkty, wartosci, nazwa) {
  const los = losowy()
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

/**
 * Porównanie liczenia w promieniu (układ 1992, elipsoida GRS80) z pełnym przeglądem haversine'em
 * (kula) na losowych adresach plus adresach o największych liczbach. Obie miary różnią się
 * systematycznie: na tej szerokości haversine jest krótszy o 0,3% wzdłuż równoleżnika, a układ 1992
 * o 0,06% krótszy od terenu. Punkt w pasie R ± 0,5% może więc wpaść po jednej albo drugiej stronie
 * i wynik musi mieścić się między liczbą punktów w 0,995 R a liczbą w 1,005 R.
 */
function kontrolaLiczenia(adresy, punkty, wartosci, promien, nazwa) {
  const los = losowy(7)
  const wybrane = new Set()
  for (let i = 0; i < 300; i++) wybrane.add(Math.floor(los() * adresy.length))
  // adresy z największą liczbą wpisów to ścisłe centrum: tam błąd byłby najbardziej widoczny
  const najwieksze = adresy
    .map((a) => a.i)
    .sort((x, y) => wartosci[y] - wartosci[x])
    .slice(0, 50)
  for (const i of najwieksze) wybrane.add(i)
  for (const i of wybrane) {
    const a = adresy[i]
    const odl = punkty.map((p) => odlegloscMetry(a.lat, a.lon, p.lat, p.lon))
    const dolna = odl.filter((d) => d <= promien * 0.995).length
    const gorna = odl.filter((d) => d <= promien * 1.005).length
    if (wartosci[i] < dolna || wartosci[i] > gorna)
      throw new Error(
        `${nazwa}: adres ${i}: ${wartosci[i]} wpisów, pełny przegląd daje ${dolna}–${gorna}`,
      )
  }
}

const KONTROLA_MIEJSC = [
  ['Kraków', 'Rynek Główny', '10', 'Kraków, Rynek Główny 10 (Stare Miasto)'],
  [
    'Kraków',
    'Plac Wszystkich Świętych',
    '3',
    'Kraków, Plac Wszystkich Świętych 3 (przy Urzędzie Miasta)',
  ],
  ['Kraków', 'Rynek Kleparski', '10', 'Kraków, Rynek Kleparski 10 (Stary Kleparz)'],
  ['Kraków', 'Plac Nowowiejski', '2', 'Kraków, Plac Nowowiejski 2 (targ)'],
  ['Kraków', 'Plac Nowy', '3', 'Kraków, Plac Nowy 3 (Kazimierz, targowisko z relacji OSM)'],
  ['Kraków', 'Powstańców Wielkopolskich', '1', 'Kraków, Powstańców Wielkopolskich 1 (Dębniki)'],
  ['Zabierzów', 'Rynek', '1', 'Zabierzów, Rynek 1 (Urząd Gminy)'],
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
  const klucze = kluczeTagow()
  const { grupy, bezWezlow } = zbudujGrupy(await obiektyZPbf(pbf, klucze), klucze)
  const ludnosc = await ludnoscGmin(adresy)
  console.log(`Linii bez węzłów w ekstrakcie (pominięte): ${bezWezlow}`)
  const najblizszyAdres = budujNajblizszy(adresy, MAX_DO_GMINY_M)

  const raport = []
  const warstwy = []
  const odpadly = []
  for (const w of WARSTWY) {
    const g = grupy[w.grupa]
    const wGminach = obiektyWGminach(g.miejsca, najblizszyAdres)
    const wObszarze = [...wGminach.values()].reduce((s, n) => s + n, 0)
    if (wObszarze < MIN_OBIEKTOW) {
      odpadly.push(`${w.id}: ${wObszarze} miejsc w obszarze 14 gmin (próg ${MIN_OBIEKTOW})`)
      continue
    }
    const licznik = licznikNa1000(wGminach, ludnosc, TERYT_KRAKOWA)

    let wartosci
    let punkty
    if (w.typ === 'liczba') {
      punkty = g.miejsca
      wartosci = policzWPromieniu(adresy, punkty, PROMIEN_NOCNE_M)
      kontrolaLiczenia(adresy, punkty, wartosci, PROMIEN_NOCNE_M, w.id)
    } else {
      punkty = g.brzeg ?? g.obiekty
      wartosci = odleglosci(adresy, punkty, MAX_M)
      kontrolaIndeksu(adresy, punkty, wartosci, w.id)
    }
    const r = rozklad(adresy, wartosci)
    if (w.typ === 'odleglosc') {
      const p90 = r.Kraków.p90
      const proponowany = zaokraglijWGore(p90, 500)
      if (proponowany !== w.zakres[1])
        console.log(
          `UWAGA ${w.id}: p90 w Krakowie ${p90} m daje skalę 0–${proponowany}, w definicji jest ${w.zakres[1]}`,
        )
    } else {
      console.log(
        `Skala ${w.id}: p90 ${r.Kraków.p90}, p99 ${r.Kraków.p99}, max ${r.Kraków.max} w Krakowie; w definicji 0–${w.zakres[1]}`,
      )
    }

    zapiszWskaznik(
      {
        id: w.id,
        kategoria: w.kategoria,
        nazwa: w.nazwa,
        opis: `${w.opis} Kompletność mapy OSM jest nierówna. ${zdanieLicznika(licznik, w.rzeczownik)}${zdanieLuki(licznik)}`,
        jednostka: w.jednostka ?? 'm',
        kierunek: w.kierunek,
        rozdzielczosc: 'adres',
        zakres: w.zakres,
        zadanie: ZADANIE,
        zrodla: [zrodloOsm(w.tagi, stan), zrodloBdl],
      },
      wartosci,
    )
    warstwy.push({ w, punkty, wartosci })
    raport.push({
      id: w.id,
      surowe: g.surowe,
      wpisow: g.obiekty.length,
      miejsc: g.miejsca.length,
      wObszarze,
      licznik,
      rozklad: r,
    })
  }

  console.log('\nGrupy, które odpadły (poniżej progu):', odpadly.length ? '' : 'brak')
  for (const o of odpadly) console.log(`  ${o}`)

  console.log(
    '\nRozkład [m dla odległości, szt. dla liczby] (p10 / p50 / p90 / p99 / max) i miejsca na 1000 mieszkańców:',
  )
  for (const r of raport) {
    const f = (x) => [x.p10, x.p50, x.p90, x.p99, x.max].join(' / ')
    console.log(
      `${r.id.padEnd(30)} z tagiem ${String(r.surowe).padStart(4)}, wpisów ${String(r.wpisow).padStart(4)}, miejsc ${String(r.miejsc).padStart(4)}, w 14 gminach ${String(r.wObszarze).padStart(4)} | Kraków ${f(r.rozklad.Kraków)} (${r.licznik.krakow.obiekty} miejsc, ${liczbaPL(r.licznik.krakow.na1000)}/1000) | obwarzanek ${f(r.rozklad.obwarzanek)} (${r.licznik.obwarzanek.obiekty} miejsc, ${liczbaPL(r.licznik.obwarzanek.na1000)}/1000)`,
    )
  }

  console.log('\nKontrola na znanych adresach (wartość; najbliższy obiekt z nazwą):')
  for (const [miejscowosc, ulica, nr, opis] of KONTROLA_MIEJSC) {
    const a = adresy.find(
      (x) => x.miejscowosc === miejscowosc && (x.ulica ?? '') === ulica && x.nr === nr,
    )
    if (!a) {
      console.log(`  ${opis}: brak takiego adresu w adresy.json`)
      continue
    }
    const wiersz = warstwy.map(({ w, punkty, wartosci }) => {
      if (w.typ === 'liczba') {
        const nazwy = punkty
          .filter((p) => odlegloscMetry(a.lat, a.lon, p.lat, p.lon) <= PROMIEN_NOCNE_M)
          .map((p) => p.nazwa ?? '(bez nazwy)')
        const probka = nazwy.slice(0, 6).join(', ')
        return `${w.id} ${wartosci[a.i]}${nazwy.length ? ` (${probka}${nazwy.length > 6 ? ', …' : ''})` : ''}`
      }
      const najblizszy = budujNajblizszy(punkty, MAX_M)(a.lat, a.lon)
      return `${w.id.replace('_odleglosc', '')} ${wartosci[a.i]}${najblizszy?.punkt.nazwa ? ` (${najblizszy.punkt.nazwa})` : ''}`
    })
    console.log(`  ${opis}:\n    ${wiersz.join('\n    ')}`)
  }
  console.log(`\nCzas: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await licz()
