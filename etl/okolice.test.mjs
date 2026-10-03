import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { do2180 } from './lib/geo.mjs'
import { naMetry } from './lib/msip.mjs'
import { wczytajAdresy } from './lib/wspolne.mjs'
import {
  bezNumeru,
  geometriaGeojson,
  idOkolicySim,
  idSimZNumeru,
  jednostkiPunktu,
  jednostkiSim,
  liczbaRzymska,
  miejscaZOverpass,
  mnoga,
  najblizszaJednostka,
  obrysDoTekstu,
  obrysZTekstu,
  okolicaMiejscowosc,
  PLIK_GRANIC,
  PLIK_OSM,
  PLIK_WYNIKU,
  slowa,
  slug,
  srodekPierscienia,
  zawieraFraze,
  zlozGranice,
  zlozOkolice,
} from './okolice.mjs'

const PAUZA = String.fromCharCode(0x2014)
const brakPauzy = (obiekt) => assert.ok(!JSON.stringify(obiekt).includes(PAUZA), 'pauza w danych')

// ── Dane syntetyczne: siatka 3 × 2 prostokątów w okolicy Krakowa (lon/lat) ──────────────────

const prostokat = (lon0, lat0, lon1, lat1) => [
  [lon0, lat0],
  [lon1, lat0],
  [lon1, lat1],
  [lon0, lat1],
  [lon0, lat0],
]
const jednostka = (id, numer, nazwa, dzielnica, powierzchniaKm2, kw) => ({
  type: 'Feature',
  properties: { id, numer, nazwa, dzielnica, powierzchniaKm2 },
  geometry: { type: 'Polygon', coordinates: [kw] },
})
// Alfa i Alfa Północ (dzielnica I Alfa), Beta i Gamma (II Beta), Alfa Wschód (III Delta).
const GRANICE = {
  type: 'FeatureCollection',
  metadane: {
    katalog: 'https://example.test/sim',
    licencja: 'test',
    dataDanych: '2026-09-26',
    pobrano: '2026-10-03',
    kontrola: { jednostek: 5 },
  },
  features: [
    jednostka('sim-101', 'I.1', 'Alfa', 'I Alfa', 1, prostokat(19.9, 50.0, 19.92, 50.02)),
    jednostka('sim-102', 'I.2', 'Alfa Północ', 'I Alfa', 3, prostokat(19.9, 50.02, 19.92, 50.04)),
    jednostka('sim-201', 'II.1', 'Beta', 'II Beta', 2, prostokat(19.92, 50.0, 19.94, 50.02)),
    jednostka('sim-202', 'II.2', 'Gamma', 'II Beta', 2, prostokat(19.92, 50.02, 19.94, 50.04)),
    jednostka(
      'sim-301',
      'III.1',
      'Alfa Wschód',
      'III Delta',
      2,
      prostokat(19.94, 50.0, 19.96, 50.02),
    ),
  ],
}
const wezel = (id, nazwa, place, lon, lat) => ({
  osm: `node/${id}`,
  nazwa,
  place,
  lon,
  lat,
})
const OSM = {
  url: 'https://example.test/overpass',
  licencja: 'ODbL',
  znacznik: '2026-10-03T21:43:21Z',
  pobrano: '2026-10-03',
  miejsca: [
    wezel(1, 'Alfa', 'quarter', 19.91, 50.01),
    wezel(2, 'Osiedle Zielone', 'neighbourhood', 19.93, 50.01),
    wezel(3, 'Gamma', 'quarter', 19.93, 50.03),
    wezel(4, 'Beta', 'neighbourhood', 19.93, 50.035),
    wezel(5, 'Gaj', 'neighbourhood', 19.905, 50.005),
    wezel(6, 'Gaj', 'neighbourhood', 19.935, 50.005),
    wezel(7, 'Poza miastem', 'quarter', 20.5, 50.5),
    {
      osm: 'way/10',
      nazwa: 'Osiedle Graniczne',
      place: 'neighbourhood',
      lon: 19.93,
      lat: 50.018,
      obrys: obrysDoTekstu(prostokat(19.925, 50.012, 19.935, 50.024)),
    },
  ],
}
const adres = (gmina, miejscowosc, dzielnica, lon, lat, teryt = '1261011') => ({
  gmina,
  miejscowosc,
  dzielnica,
  lon,
  lat,
  teryt,
})
const ADRESY = [
  adres('Kraków', 'Kraków', 'I Alfa', 19.91, 50.01),
  adres('Kraków', 'Kraków', 'II Beta', 19.93, 50.022),
  adres('Kraków', 'Kraków', 'II Beta', 19.93, 50.017),
  adres('Kraków', 'Kraków', 'I Alfa', 19.8999, 50.01),
  adres('Kraków', 'Kraków', 'I Alfa', 20.5, 50.5),
  adres('Wieliczka', 'Grabówki', null, 20.05, 49.98, '1219064'),
  adres('Wieliczka', 'Grabówki', null, 20.06, 49.98, '1219064'),
  adres('Skawina', null, null, 19.8, 49.9, '1262031'),
]

// ── Teksty i numery ─────────────────────────────────────────────────────────────────────────

test('teksty: numer dzielnicy, slug, słowa, fraza, forma liczby mnogiej', () => {
  assert.equal(bezNumeru('XVIII Nowa Huta'), 'Nowa Huta')
  assert.equal(slug('Łagiewniki-Borek Fałęcki'), 'lagiewniki-borek-falecki')
  assert.deepEqual(slowa('Osiedle „Kurdwanów Nowy”'), ['osiedle', 'kurdwanow', 'nowy'])
  assert.ok(zawieraFraze(slowa('Stare Bronowice Małe'), slowa('Bronowice')))
  assert.ok(zawieraFraze(slowa('Prądnik Biały Zachód'), slowa('Prądnik Biały')))
  assert.ok(!zawieraFraze(slowa('Prądnik Czerwony'), slowa('Prądnik Biały')))
  assert.ok(!zawieraFraze(slowa('Kliny'), []))
  assert.deepEqual(
    [1, 2, 4, 5, 12, 13, 21, 22, 25].map((n) => mnoga(n, 'jednostkę', 'jednostki', 'jednostek')),
    [
      'jednostkę',
      'jednostki',
      'jednostki',
      'jednostek',
      'jednostek',
      'jednostek',
      'jednostek',
      'jednostki',
      'jednostek',
    ],
  )
})

test('id jednostki SIM: numer dzielnicy × 100 + numer jednostki, jak id_sim w MSIP', () => {
  assert.equal(liczbaRzymska('XVIII'), 18)
  assert.equal(liczbaRzymska('IX'), 9)
  assert.equal(idSimZNumeru('I.1'), 101)
  assert.equal(idSimZNumeru('VIII.3'), 803)
  assert.equal(idSimZNumeru('XIII.1'), 1301)
  assert.equal(idSimZNumeru('IV.10'), 410)
  assert.equal(idSimZNumeru('XVIII.13'), 1813)
  assert.equal(idOkolicySim('X.9'), 'sim-1009')
  assert.throws(() => idSimZNumeru('XVII.6\n'), /nie ma postaci/)
  assert.throws(() => idSimZNumeru('8.3'), /nie ma postaci/)
})

// ── Granice SIM z MSIP ──────────────────────────────────────────────────────────────────────

/** Kwadrat 100 m w EPSG:2178 zgodnie z ruchem wskazówek zegara (tak MSIP zapisuje pierścień zewnętrzny). */
function kwadratEsri(dx = 0, dy = 0, bok = 100) {
  const [x, y] = naMetry(19.94, 50.06)
  const [x0, y0] = [x + dx, y + dy]
  return [
    [x0, y0],
    [x0, y0 + bok],
    [x0 + bok, y0 + bok],
    [x0 + bok, y0],
    [x0, y0],
  ]
}
const poleLonLat = (p) => {
  let s = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    s += p[j][0] * p[i][1] - p[i][0] * p[j][1]
  return s / 2
}

test('geometriaGeojson: zewnętrzny przeciwnie do ruchu wskazówek, otwór zgodnie, WGS84', () => {
  const otwor = kwadratEsri(20, 20, 60).reverse() // otwór esri: przeciwnie do ruchu wskazówek
  const g = geometriaGeojson([kwadratEsri(), otwor])
  assert.equal(g.type, 'Polygon')
  assert.equal(g.coordinates.length, 2)
  assert.ok(poleLonLat(g.coordinates[0]) > 0, 'zewnętrzny przeciwnie do ruchu wskazówek')
  assert.ok(poleLonLat(g.coordinates[1]) < 0, 'otwór zgodnie z ruchem wskazówek')
  for (const r of g.coordinates) {
    assert.deepEqual(r[0], r.at(-1))
    for (const [lon, lat] of r) {
      assert.ok(Math.abs(lon - 19.94) < 0.01 && Math.abs(lat - 50.06) < 0.01)
      assert.equal(lon, Math.round(lon * 1e6) / 1e6)
    }
  }
  const dwa = geometriaGeojson([kwadratEsri(), kwadratEsri(500, 0)])
  assert.equal(dwa.type, 'MultiPolygon')
  assert.equal(dwa.coordinates.length, 2)
  assert.throws(() => geometriaGeojson([kwadratEsri().reverse()]), /bez pierścienia zewnętrznego/)
})

const obiektEsri = (numer, nazwa, id, pole = 0.01) => ({
  attributes: {
    nr_jed_sim: numer,
    nazwa_sim: nazwa,
    dziel: 'Dzielnica XVII Wzgórza Krzesławickie',
    pow: pole,
    data_importu: '26/09/2026',
  },
  geometry: { rings: [kwadratEsri()] },
  kontrolny: {
    attributes: {
      nr_jed_sim: numer.trim(),
      nazwa_sim: nazwa.trim(),
      nazwa_dziel: 'Dzielnica XVII Wzgórza Krzesławickie',
      id_sim: id,
      'st_area(shape)': 10_000,
    },
    geometry: { rings: [kwadratEsri()] },
  },
})

test('zlozGranice: czyści teksty, łączy z kopią kontrolną, zatrzymuje się przy rozbieżności', () => {
  const o = obiektEsri('XVII.6\n', ' Lubocza', 1706)
  const { features, kontrola } = zlozGranice([o], [o.kontrolny], 1)
  assert.deepEqual(features[0].properties, {
    id: 'sim-1706',
    numer: 'XVII.6',
    nazwa: 'Lubocza',
    dzielnica: 'XVII Wzgórza Krzesławickie',
    powierzchniaKm2: 0.01,
  })
  assert.equal(kontrola.jednostek, 1)
  assert.equal(kontrola.dataImportuWarstwy, '2026-09-26')
  assert.equal(kontrola.zgodnoscZKopiaKontrolna.najwiekszaRoznicaPolaProc, 0)

  const zlyId = obiektEsri('XVII.6', 'Lubocza', 1707)
  assert.throws(() => zlozGranice([zlyId], [zlyId.kontrolny], 1), /id_sim 1707/)
  assert.throws(() => zlozGranice([o], [o.kontrolny], 123), /oczekiwano 123/)
  const innaNazwa = obiektEsri('XVII.6', 'Lubocza', 1706)
  innaNazwa.kontrolny.attributes.nazwa_sim = 'Inna'
  assert.throws(() => zlozGranice([innaNazwa], [innaNazwa.kontrolny], 1), /kontrolna „Inna”/)
  assert.throws(() => zlozGranice([o], [], 1), /brak w warstwie kontrolnej/)
  const zlePole = obiektEsri('XVII.6', 'Lubocza', 1706, 0.5)
  assert.throws(() => zlozGranice([zlePole], [zlePole.kontrolny], 1), /pole z geometrii/)
})

test('jednostki SIM: punkt w wielokącie, brak trafienia, najbliższa w promieniu', () => {
  const j = jednostkiSim(GRANICE)
  assert.equal(j.length, 5)
  const [x, y] = do2180(19.91, 50.01)
  assert.deepEqual(
    jednostkiPunktu(j, x, y).map((u) => u.id),
    ['sim-101'],
  )
  const [xp, yp] = do2180(19.8999, 50.01)
  assert.equal(jednostkiPunktu(j, xp, yp).length, 0)
  assert.equal(najblizszaJednostka(j, xp, yp, 30)?.jednostka.id, 'sim-101')
  assert.equal(najblizszaJednostka(j, xp, yp, 2), null)
  assert.throws(() => jednostkiSim({ features: [{ properties: { id: 'sim-1' } }] }), /bez pola/)
})

// ── Miejsca z OSM ───────────────────────────────────────────────────────────────────────────

test('obrys jako tekst i środek pierścienia', () => {
  const p = prostokat(19.9, 50.0, 19.92, 50.02)
  assert.deepEqual(obrysZTekstu(obrysDoTekstu(p)), p)
  const [lon, lat] = srodekPierscienia(p)
  assert.ok(Math.abs(lon - 19.91) < 1e-9 && Math.abs(lat - 50.01) < 1e-9)
  assert.throws(() => obrysZTekstu('19.9 abc'), /zły punkt/)
})

test('miejscaZOverpass: węzeł, obrys z way i relacji, reszta pominięta, wynik posortowany', () => {
  const geometria = (kw) => kw.map(([lon, lat]) => ({ lon, lat }))
  const odpowiedz = {
    elements: [
      {
        type: 'relation',
        id: 5,
        tags: { name: 'Relacja z obrysem', place: 'neighbourhood' },
        members: [
          { type: 'way', role: 'outer', geometry: geometria(prostokat(19.9, 50, 19.91, 50.01)) },
        ],
      },
      {
        type: 'relation',
        id: 6,
        tags: { name: 'Relacja bez prostego obrysu', place: 'quarter' },
        members: [
          { type: 'way', role: 'outer', geometry: geometria(prostokat(19.9, 50, 19.91, 50.01)) },
          { type: 'way', role: 'outer', geometry: geometria(prostokat(19.95, 50, 19.96, 50.01)) },
        ],
      },
      {
        type: 'way',
        id: 4,
        tags: { name: 'Droga otwarta', place: 'neighbourhood' },
        geometry: geometria([
          [19.9, 50],
          [19.92, 50],
          [19.92, 50.02],
        ]),
      },
      {
        type: 'way',
        id: 3,
        tags: { name: 'Zamknięty', place: 'neighbourhood' },
        geometry: geometria(prostokat(19.9, 50, 19.92, 50.02)),
      },
      {
        type: 'node',
        id: 9,
        lat: 50.01,
        lon: 19.91,
        tags: { name: ' Stradom ', place: 'quarter' },
      },
      { type: 'node', id: 2, lat: 50.01, lon: 19.91, tags: { place: 'neighbourhood' } },
      { type: 'node', id: 1, lat: 50.01, lon: 19.91, tags: { name: 'Dzielnica', place: 'suburb' } },
      { type: 'node', id: 7, lat: 50.01, lon: 19.91, tags: { name: 'Pole', place: 'locality' } },
    ],
  }
  const m = miejscaZOverpass(odpowiedz)
  assert.deepEqual(
    m.map((x) => x.osm),
    ['node/9', 'way/3', 'way/4', 'relation/5', 'relation/6'],
  )
  assert.equal(m[0].nazwa, 'Stradom')
  assert.equal(m[0].obrys, undefined)
  assert.equal(obrysZTekstu(m[1].obrys).length, 5)
  assert.ok(Math.abs(m[1].lon - 19.91) < 1e-6 && Math.abs(m[1].lat - 50.01) < 1e-6)
  assert.equal(m[2].obrys, undefined, 'otwarta linia to punkt, nie obrys')
  assert.equal(obrysZTekstu(m[3].obrys).length, 5)
  assert.equal(m[4].obrys, undefined, 'dwa obrysy zewnętrzne: tylko punkt')
  assert.ok(m[4].lon > 19.9 && m[4].lon < 19.96)
})

// ── Okolice z danych syntetycznych ──────────────────────────────────────────────────────────

test('okolicaMiejscowosc: miejscowość w gminie, Kraków i brak miejscowości to null', () => {
  const w = okolicaMiejscowosc(adres('Wieliczka', 'Grabówki', null, 20, 50, '1219064'))
  assert.deepEqual(w, {
    id: 'm-1219064-grabowki',
    nazwa: 'Grabówki',
    rodzaj: 'miejscowosc',
    dzielnica: null,
    gmina: 'Wieliczka',
  })
  assert.equal(okolicaMiejscowosc(adres('Kraków', 'Kraków', 'I Alfa', 19.9, 50)), null)
  assert.equal(okolicaMiejscowosc(adres('Skawina', null, null, 19.8, 49.9)), null)
})

const zloz = () =>
  zlozOkolice({
    adresy: ADRESY,
    wersja: 'abc',
    granice: GRANICE,
    osm: OSM,
    zrodlaAdresow: [
      {
        url: 'https://example.test/adresy',
        licencja: 'test',
        dataDanych: '2026-09-21',
        pobrano: '2026-10-03',
      },
    ],
  })

test('zlozOkolice: kolumna, liczniki, najbliższa jednostka, null, kolejność id', () => {
  const p = zloz()
  assert.equal(p.wersjaAdresow, 'abc')
  assert.deepEqual(p.idOkolic, [
    'sim-101',
    'sim-102',
    'sim-201',
    'sim-202',
    'sim-301',
    'm-1219064-grabowki',
  ])
  const id = (i) => (p.kolumny.okolica[i] === null ? null : p.idOkolic[p.kolumny.okolica[i]])
  assert.deepEqual(
    ADRESY.map((_, i) => id(i)),
    [
      'sim-101',
      'sim-202',
      'sim-201',
      'sim-101', // 7 m za granicą: najbliższa jednostka w promieniu 30 m
      null, // Kraków, ale poza jednostkami
      'm-1219064-grabowki',
      'm-1219064-grabowki',
      null, // gmina bez miejscowości
    ],
  )
  assert.equal(p.okolice['sim-101'].liczbaAdresow, 2)
  assert.equal(p.okolice['sim-102'].liczbaAdresow, 0, 'jednostka bez adresów zostaje w słowniku')
  assert.equal(p.okolice['m-1219064-grabowki'].liczbaAdresow, 2)
  assert.equal(p.okolice['m-1219064-grabowki'].rodzaj, 'miejscowosc')
  const k = p.kontrola
  assert.equal(k.adresyKrakow, 5)
  assert.equal(k.adresyWJednostce, 3)
  assert.equal(k.adresyPrzypisaneDoNajblizszej, 1)
  assert.equal(k.adresyBezJednostki, 1)
  assert.equal(k.adresyZDzielnicaInnaNizJednostka, 0)
  assert.equal(k.adresyPozaKrakowemBezMiejscowosci, 1)
  assert.equal(k.jednostekBezAdresow, 2)
  assert.equal(p.zrodla.length, 3)
  for (const z of p.zrodla)
    for (const pole of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano'])
      assert.ok(z[pole], pole)
  brakPauzy(p)
})

test('słownik i rozjazdy: każdy rodzaj rozjazdu wykryty na danych syntetycznych', () => {
  const p = zloz()
  const rodzaj = (r) => p.rozjazdy.filter((x) => x.rodzaj === r)

  // Osiedle z obrysem OSM rozcięte granicą jednostek: 2/3 w Beta, 1/3 w Gamma, po adresie w każdej.
  const [rozciete] = rodzaj('osiedle-w-kilku-jednostkach')
  assert.equal(rozciete.nazwa, 'Osiedle Graniczne')
  assert.deepEqual(rozciete.jednostki, ['sim-201', 'sim-202'], 'malejąco po udziale')
  assert.deepEqual(rozciete.udzialyProc, { 'sim-201': 67, 'sim-202': 33 })
  assert.deepEqual(rozciete.adresy, { 'sim-201': 1, 'sim-202': 1 })
  assert.equal(p.kontrola.osm.obrysowRozcietychGranicaJednostek, 1)

  // Ta sama nazwa w dwóch jednostkach.
  assert.deepEqual(
    rodzaj('nazwa-w-kilku-jednostkach').map((x) => [x.nazwa, x.jednostki]),
    [['Gaj', ['sim-101', 'sim-201']]],
  )

  // „Beta” z OSM leży w Gamma, a jednostka o tej nazwie to Beta.
  assert.deepEqual(
    rodzaj('nazwa-poza-jednostka-o-tej-nazwie').map((x) => [x.nazwa, x.jednostki]),
    [['Beta', ['sim-202', 'sim-201']]],
  )

  // „Alfa” jest częścią nazw trzech jednostek.
  const [szersza] = rodzaj('nazwa-szersza-niz-jednostka')
  assert.equal(szersza.nazwa, 'Alfa')
  assert.deepEqual(szersza.jednostki, ['sim-101', 'sim-102', 'sim-301'])

  // Jednostki bez miejsca OSM w środku: Alfa Północ i Alfa Wschód.
  assert.deepEqual(
    rodzaj('jednostka-bez-miejsc-osm').flatMap((x) => x.jednostki),
    ['sim-102', 'sim-301'],
  )

  // Nazwa jednostki jak dzielnica: Alfa (25% dzielnicy I Alfa), Alfa Północ (75%), Beta (50%).
  const jakDzielnica = Object.fromEntries(
    rodzaj('nazwa-jednostki-jak-dzielnica').map((x) => [
      x.jednostki[0],
      x.udzialPowierzchniDzielnicyProc,
    ]),
  )
  assert.deepEqual(jakDzielnica, { 'sim-101': 25, 'sim-102': 75, 'sim-201': 50 })
  assert.match(rodzaj('nazwa-jednostki-jak-dzielnica')[0].opis, /dzielnica ma 2 jednostki SIM/)

  // Jednostka „Alfa Wschód” leży w dzielnicy III Delta, a nazwa zawiera nazwę dzielnicy I Alfa.
  const [innaDzielnica] = rodzaj('nazwa-jednostki-z-innej-dzielnicy')
  assert.deepEqual(innaDzielnica.jednostki, ['sim-301'])
  assert.equal(innaDzielnica.dzielnica, 'I Alfa')

  assert.equal(rodzaj('okolica-poza-krakowem').length, 1)
  assert.match(rodzaj('okolica-poza-krakowem')[0].opis, /1 miejscowości, 2 adresów/)
  for (const r of p.rozjazdy) {
    assert.ok(r.rodzaj && r.opis)
    assert.ok(!r.opis.includes(PAUZA))
  }

  // Słownik: wpis powtarzający nazwę jednostki („Gamma”) pomijamy; poza miastem nic nie wchodzi.
  const nazwy = p.slownikNazw.map((x) => x.nazwa)
  assert.ok(!nazwy.includes('Gamma'))
  assert.ok(!nazwy.includes('Poza miastem'))
  const alfa = p.slownikNazw.find((x) => x.nazwa === 'Alfa')
  assert.deepEqual(alfa.jednostki, ['sim-101', 'sim-102', 'sim-301'])
  assert.deepEqual(alfa.osm, ['node/1'])
  assert.equal(alfa.place, 'quarter')
  assert.deepEqual(p.okolice['sim-201'].potoczne, ['Gaj', 'Osiedle Graniczne', 'Osiedle Zielone'])
  assert.deepEqual(p.okolice['sim-101'].potoczne, ['Gaj'], 'nazwa jednostki nie jest „potoczną”')
  assert.deepEqual(p.okolice['sim-202'].potoczne, ['Beta'])
  assert.equal(p.kontrola.osm.miejscWKrakowie, 7)
  assert.equal(p.kontrola.osm.miejscPozaKrakowem, 1)
  assert.equal(p.kontrola.osm.miejscZObrysem, 1)
})

// ── Pliki w repo ────────────────────────────────────────────────────────────────────────────

let adresyCache
const dane = () => {
  adresyCache ??= wczytajAdresy()
  return adresyCache
}

test('okolice-granice.geojson: 123 jednostki z źródłem, id zgodne z numerem, pierścienie poprawne', (t) => {
  if (!existsSync(PLIK_GRANIC)) return t.skip('brak pliku – uruchom node etl/okolice.mjs --pobierz')
  const g = JSON.parse(readFileSync(PLIK_GRANIC, 'utf8'))
  assert.equal(g.features.length, 123)
  for (const pole of ['zrodlo', 'katalog', 'wydawca', 'licencja', 'dataDanych', 'pobrano'])
    assert.ok(g.metadane[pole], `metadane.${pole}`)
  assert.equal(g.metadane.kontrola.zgodnoscZKopiaKontrolna.zgodnychJednostek, 123)
  const id = new Set()
  const nazwy = new Set()
  let km2 = 0
  for (const f of g.features) {
    const p = f.properties
    assert.equal(p.id, idOkolicySim(p.numer), `id ${p.numer}`)
    assert.ok(!id.has(p.id) && !nazwy.has(p.nazwa), `powtórka ${p.id} ${p.nazwa}`)
    id.add(p.id)
    nazwy.add(p.nazwa)
    assert.equal(p.nazwa, p.nazwa.trim())
    assert.equal(p.numer, p.numer.trim())
    assert.match(p.dzielnica, /^[IVXL]+ \S/)
    km2 += p.powierzchniaKm2
    const wielokaty =
      f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    for (const w of wielokaty)
      for (const r of w) {
        assert.ok(r.length >= 4)
        assert.deepEqual(r[0], r.at(-1))
        for (const [lon, lat] of r) assert.ok(lon > 19.7 && lon < 20.3 && lat > 49.9 && lat < 50.2)
      }
  }
  // Powierzchnia Krakowa w granicach administracyjnych: 326,85 km².
  assert.ok(Math.abs(km2 - 326.85) < 0.5, `suma powierzchni ${km2}`)
  brakPauzy(g.metadane)
})

test('okolice-granice.geojson: każdy adres Krakowa leży w dokładnie jednej jednostce SIM', (t) => {
  if (!existsSync(PLIK_GRANIC)) return t.skip('brak pliku')
  const jednostki = jednostkiSim(JSON.parse(readFileSync(PLIK_GRANIC, 'utf8')))
  const { adresy } = dane()
  let krakow = 0
  let niezgodnaDzielnica = 0
  for (const a of adresy) {
    if (a.gmina !== 'Kraków') continue
    krakow++
    const [x, y] = do2180(a.lon, a.lat)
    const j = jednostkiPunktu(jednostki, x, y)
    assert.equal(j.length, 1, `${a.ulica} ${a.nr}: ${j.length} jednostek`)
    if (j[0].dzielnica !== a.dzielnica) niezgodnaDzielnica++
  }
  assert.ok(krakow > 70_000, 'zmierzono adresy Krakowa')
  assert.ok(
    niezgodnaDzielnica / krakow < 0.001,
    `dzielnica adresu ≠ jednostki: ${niezgodnaDzielnica}`,
  )
})

test('okolice.json: id okolicy każdego adresu, zgodny z adresami, słownikiem i granicami', (t) => {
  if (!existsSync(PLIK_WYNIKU) || !existsSync(PLIK_GRANIC)) return t.skip('brak pliku')
  const d = JSON.parse(readFileSync(PLIK_WYNIKU, 'utf8'))
  const granice = JSON.parse(readFileSync(PLIK_GRANIC, 'utf8'))
  const { wersja, adresy } = dane()
  assert.equal(d.wersjaAdresow, wersja, 'przelicz: node etl/okolice.mjs')
  assert.equal(d.metoda, 'sim-msip')
  assert.equal(d.kolumny.okolica.length, adresy.length)

  const idSim = granice.features.map((f) => f.properties.id)
  assert.deepEqual(
    d.idOkolic.filter((id) => id.startsWith('sim-')),
    idSim,
    '123 jednostki SIM, po numerze',
  )
  assert.deepEqual(d.idOkolic, Object.keys(d.okolice))

  const liczniki = new Map(d.idOkolic.map((id) => [id, 0]))
  let bez = 0
  adresy.forEach((a, i) => {
    const n = d.kolumny.okolica[i]
    if (n === null) {
      bez++
      assert.ok(a.gmina !== 'Kraków' && !a.miejscowosc, `adres bez okolicy: ${a.id}`)
      return
    }
    const id = d.idOkolic[n]
    const o = d.okolice[id]
    assert.ok(o, `okolica ${n}`)
    liczniki.set(id, liczniki.get(id) + 1)
    if (a.gmina === 'Kraków') {
      assert.equal(o.rodzaj, 'sim')
      assert.equal(o.dzielnica, a.dzielnica)
    } else {
      assert.equal(o.rodzaj, 'miejscowosc')
      assert.equal(o.gmina, a.gmina)
      assert.equal(o.nazwa, a.miejscowosc)
    }
  })
  for (const [id, n] of liczniki) assert.equal(d.okolice[id].liczbaAdresow, n, id)
  assert.equal(bez, d.kontrola.adresyPozaKrakowemBezMiejscowosci + d.kontrola.adresyBezJednostki)
  assert.equal(
    d.kontrola.adresyWJednostce,
    d.kontrola.adresyKrakow,
    'cały Kraków w jednostkach SIM',
  )

  for (const z of d.zrodla)
    for (const pole of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano'])
      assert.ok(z[pole], pole)
  for (const w of d.slownikNazw) {
    assert.ok(w.nazwa && w.osm.length && w.jednostki.length)
    for (const id of w.jednostki)
      assert.ok(id.startsWith('sim-') && d.okolice[id], `${w.nazwa}: ${id}`)
  }
  for (const o of Object.values(d.okolice).filter((x) => x.rodzaj === 'sim'))
    for (const n of o.potoczne) assert.equal(typeof n, 'string')
  const rodzaje = new Set(d.rozjazdy.map((r) => r.rodzaj))
  for (const r of [
    'nazwa-szersza-niz-jednostka',
    'nazwa-jednostki-jak-dzielnica',
    'okolica-poza-krakowem',
  ])
    assert.ok(rodzaje.has(r), `brak rozjazdów „${r}”`)
  for (const r of d.rozjazdy) {
    assert.ok(r.rodzaj && r.opis)
    for (const id of r.jednostki ?? []) assert.ok(d.okolice[id], `rozjazd ${r.rodzaj}: ${id}`)
  }
  brakPauzy(d)
})

test('okolice-osm.json: migawka OSM ze źródłem, datą stanu i miejscami w Krakowie', (t) => {
  if (!existsSync(PLIK_OSM)) return t.skip('brak pliku – uruchom node etl/okolice.mjs --pobierz')
  const o = JSON.parse(readFileSync(PLIK_OSM, 'utf8'))
  for (const pole of ['zrodlo', 'url', 'licencja', 'znacznik', 'pobrano', 'zapytanie'])
    assert.ok(o[pole], pole)
  assert.match(o.licencja, /ODbL/)
  assert.ok(o.miejsca.length > 300)
  const osm = new Set()
  for (const m of o.miejsca) {
    assert.ok(!osm.has(m.osm), `powtórka ${m.osm}`)
    osm.add(m.osm)
    assert.ok(['neighbourhood', 'quarter'].includes(m.place))
    assert.ok(m.nazwa === m.nazwa.trim() && m.nazwa)
    assert.ok(Number.isFinite(m.lon) && Number.isFinite(m.lat))
  }
  assert.ok(
    o.miejsca.some((m) => m.obrys),
    'są obrysy osiedli',
  )
})
