import assert from 'node:assert/strict'
import test from 'node:test'
import { pierscien } from './geo.mjs'
import {
  GRANICA_DUZEGO_OBIEKTU_M2,
  IndeksPokrycia,
  klasaWpisu,
  MAX_PX,
  odlegloscDoObiektu,
  oknoZapytania,
  parsujGfi,
  parsujSvg,
  pierscienieZSciezki,
  planujSondy,
  poleFigury,
  przypiszId,
  rozbierzId,
  urlGetFeatureInfo,
  urlGetMap,
  wewnatrzObiektu,
} from './nid-wms.mjs'

// ── Pomocnicze ───────────────────────────────────────────────────────────────────────────────

const kwadrat = (i, x0, y0, x1, y1) => {
  const p = pierscien([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ])
  return {
    i,
    rodzaj: 'wielokat',
    pierscienie: [p],
    bbox: [x0, y0, x1, y1],
    pole: (x1 - x0) * (y1 - y0),
  }
}
const linia = (i, punkty) => ({
  i,
  rodzaj: 'linia',
  pierscienie: [Float64Array.from(punkty.flat())],
  bbox: [
    Math.min(...punkty.map((p) => p[0])),
    Math.min(...punkty.map((p) => p[1])),
    Math.max(...punkty.map((p) => p[0])),
    Math.max(...punkty.map((p) => p[1])),
  ],
  pole: 0,
})
const punkt = (i, x, y) => ({
  i,
  rodzaj: 'punkt',
  pierscienie: [Float64Array.of(x, y)],
  bbox: [x, y, x, y],
  pole: 0,
})

/** SVG w układzie usługi: lewy brzeg x0, górny y1, rozdz metrów na piksel. */
const svg = ({ x0, y1, rozdz }, jednostka = 'm') => `<?xml version="1.0" encoding="UTF-8"?>
<svg xml:space="preserve" id="gwmroot" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:gmwmsvg="http://www.intergraph.com/GeoMedia/wmsvg">
<defs id="gwmdefs">
<path id="_GWMSquarePoint" d="M-.5-.5l1 0 0 1-1 0z"/>
<path id="Xbb" d="M10 10l20 0 0 20-20 0"/>
<path id="Xbb_0" d="M10 10l20 0"/>
<path id="Xbd" d="M50 50l10 10"/>
<path id="Xbe" d="M70 70l10 0 0 10-10 0zM73 73l2 0 0 2-2 0z"/>
<path id="Xbf" d="M90 90l1 1"/>
</defs>
<style type="text/css" id="gwmstyles"><![CDATA[
.GWMLine
{
stroke:#000000;
fill:none;
opacity:0;
}
.Xc
{
fill:#000000;
stroke:none;
pointer-events:visible}
.Xc-H-
{
fill:#00ffff;
stroke:none;
}
.Xb
{
stroke:#000000;
fill:none;
stroke-width:1px;
pointer-events:visiblePainted}
.Xa
{
fill:#808080;
stroke:none;
pointer-events:visible}
]]></style>
<g id="_GWMAll" gmwmsvg:typ="a" mask="url(#gwmmask)">
<metadata><gmwmsvg:metadata id="_GWMMetadata" gmwmsvg:storageoffsetx="${x0}" gmwmsvg:storageoffsety="${y1}" gmwmsvg:storagetoreadoutscale="1.000000000000000" gmwmsvg:readoutoffsetx="0.000000000000000" gmwmsvg:readoutoffsety="0.000000000000000" gmwmsvg:readoutunit="${jednostka}" gmwmsvg:storagetodistancescale="1.000000000000000" gmwmsvg:distanceunit="m" gmwmsvg:displaytostoragescale="${1 / rozdz}" gmwmsvg:rotationangle="0.000000000000000" gmwmsvg:version="2.0"/></metadata>
<rect id="gwmbg" x="-8000" y="-8000" width="16800" height="16800" style="fill:#ffffff;stroke:none;opacity:1.000000000000000;"/>
<g id="1" gmwmsvg:typ="l">
<use xlink:href="#Xbb" id="Xbb.0" class="Xa"/>
<use xlink:href="#Xbb_0" id="Xbb.1" class="Xb"/>
<use xlink:href="#_GWMSquarePoint" transform="translate(40.00,20.00),scale(3.33),rotate(.50)" id="Xbc.0" class="Xc"/>
<use xlink:href="#_GWMSquarePoint" transform="translate(40.00,20.00),scale(2.80),rotate(.50)" id="Xbc.1" class="Xa"/>
<use xlink:href="#Xbd" id="Xbd.0" class="Xb"/>
<use xlink:href="#Xbe" id="Xbe.0" class="Xa"/>
<use xlink:href="#Xbe" id="Xbe.1" class="Xb"/>
<use xlink:href="#Xbf" id="Xbf.0" class="Xa"/>
<use xlink:href="#Xbf" id="Xbf.1" class="Xb"/>
</g>
</g>
</svg>`

const OKNO = { x0: 1000, y0: 1000, x1: 1200, y1: 2000, szer: 100, wys: 500, rozdz: 2 }

// ── Okno i adresy zapytań ────────────────────────────────────────────────────────────────────

test('oknoZapytania: margines, piksel dokładnie rozdz metrów, okno nie przekracza limitu', () => {
  const punkty = [
    [550_000.4, 240_000.2],
    [598_000.9, 265_000.7],
  ]
  const o = oknoZapytania(punkty, { margines: 500 })
  assert.equal(o.x0, 549_500)
  assert.equal(o.y0, 239_500)
  assert.ok(o.szer <= MAX_PX && o.wys <= MAX_PX)
  assert.ok(o.rozdz >= 1)
  // okno jest wielokrotnością piksela i obejmuje punkty z marginesem
  assert.ok(Math.abs(o.x1 - (o.x0 + o.szer * o.rozdz)) < 1e-9)
  assert.ok(Math.abs(o.y1 - (o.y0 + o.wys * o.rozdz)) < 1e-9)
  assert.ok(o.x1 >= 598_000.9 + 500 && o.y1 >= 265_000.7 + 500)
  // małe okno: rozdzielczość nie spada poniżej minimum
  const male = oknoZapytania(
    [
      [1000, 1000],
      [2000, 1500],
    ],
    { margines: 0 },
  )
  assert.equal(male.rozdz, 1)
  assert.equal(male.szer, 1000)
  assert.throws(() => oknoZapytania([]), /Brak punktów/)
})

test('urlGetMap i urlGetFeatureInfo: EPSG:2180, BBOX od północy, piksel 10 cm w sondzie', () => {
  const u = new URL(urlGetMap(OKNO))
  assert.equal(u.searchParams.get('crs'), 'EPSG:2180')
  assert.equal(u.searchParams.get('version'), '1.3.0')
  assert.equal(u.searchParams.get('format'), 'image/svg+xml')
  assert.equal(u.searchParams.get('layers'), 'Immovable_Monuments')
  // WMS 1.3.0 dla EPSG:2180: północ, wschód, północ, wschód
  assert.equal(u.searchParams.get('bbox'), '1000,1000,2000,1200')
  assert.equal(u.searchParams.get('width'), '100')
  assert.equal(u.searchParams.get('height'), '500')

  const g = new URL(urlGetFeatureInfo(567_000, 244_000))
  assert.equal(g.searchParams.get('request'), 'GetFeatureInfo')
  assert.equal(g.searchParams.get('bbox'), '243997,566997,244003,567003')
  assert.equal(g.searchParams.get('width'), '61')
  assert.equal(g.searchParams.get('i'), '30')
  assert.equal(g.searchParams.get('j'), '30')
  assert.equal(g.searchParams.get('query_layers'), 'Immovable_Monuments')
  assert.match(g.searchParams.get('info_format') ?? '', /gml/)
})

// ── Ścieżki SVG ──────────────────────────────────────────────────────────────────────────────

test('pierscienieZSciezki: polecenia względne i bezwzględne, liczby sklejone znakiem minus, podścieżki', () => {
  assert.deepEqual(pierscienieZSciezki('M10 10l20 0 0 20-20 0'), [
    [
      [10, 10],
      [30, 10],
      [30, 30],
      [10, 30],
    ],
  ])
  // liczby bez spacji: „5-.5” to 5 i -0.5; „1.5.25” to 1.5 i 0.25
  assert.deepEqual(pierscienieZSciezki('M0 0l5-.5 1.5.25'), [
    [
      [0, 0],
      [5, -0.5],
      [6.5, -0.25],
    ],
  ])
  assert.deepEqual(pierscienieZSciezki('M1 1L5 1V4H1Z'), [
    [
      [1, 1],
      [5, 1],
      [5, 4],
      [1, 4],
    ],
  ])
  const dwa = pierscienieZSciezki('M70 70l10 0 0 10-10 0zM73 73l2 0 0 2-2 0z')
  assert.equal(dwa.length, 2)
  assert.deepEqual(dwa[1]?.[0], [73, 73])
  // małe m po zamknięciu liczy się od ostatniego bieżącego punktu
  assert.deepEqual(pierscienieZSciezki('M0 0l1 0 1 1zm5 5l1 0'), [
    [
      [0, 0],
      [1, 0],
      [2, 1],
    ],
    [
      [7, 6],
      [8, 6],
    ],
  ])
  assert.throws(() => pierscienieZSciezki('M0 0C1 1 2 2 3 3'), /nieobsługiwane polecenie C/)
  assert.throws(() => pierscienieZSciezki('l1 1'), /bez początku/)
})

// ── Parser SVG ───────────────────────────────────────────────────────────────────────────────

test('parsujSvg: wielokąt, punkt, linia, wielokąt z otworem w kolejności bazy, współrzędne w metrach', () => {
  const { obiekty } = parsujSvg(svg({ x0: 1000, y1: 2000, rozdz: 2 }), OKNO)
  assert.deepEqual(
    obiekty.map((o) => o.rodzaj),
    ['wielokat', 'punkt', 'linia', 'wielokat', 'linia'],
    'ostatnia ścieżka ma dwa punkty, więc nie jest wielokątem',
  )
  assert.deepEqual(
    obiekty.map((o) => o.i),
    [0, 1, 2, 3, 4],
  )
  // piksel (10,10) → x = 1000 + 2·10, y = 2000 − 2·10
  const [w, p, l, o] = obiekty
  assert.deepEqual(
    [...(w?.pierscienie[0] ?? [])],
    [1020, 1980, 1060, 1980, 1060, 1940, 1020, 1940, 1020, 1980],
  )
  assert.equal(w?.pole, 1600)
  assert.deepEqual(w?.bbox, [1020, 1940, 1060, 1980])
  assert.deepEqual([...(p?.pierscienie[0] ?? [])], [1080, 1960])
  assert.deepEqual([...(l?.pierscienie[0] ?? [])], [1100, 1900, 1120, 1880])
  assert.equal(o?.pierscienie.length, 2)
  assert.equal(o?.pole, 20 * 20 - 4 * 4, 'otwór odejmuje pole')
  assert.equal(wewnatrzObiektu(1150, 1850, o ?? kwadrat(0, 0, 0, 0, 0)), true)
  assert.equal(wewnatrzObiektu(1148, 1852, o ?? kwadrat(0, 0, 0, 0, 0)), false, 'punkt w otworze')
})

test('parsujSvg: zakres inny niż w zapytaniu, jednostki i obce odpowiedzi zatrzymują eksport', () => {
  assert.throws(() => parsujSvg(svg({ x0: 1010, y1: 2000, rozdz: 2 }), OKNO), /inny zakres/)
  assert.throws(() => parsujSvg(svg({ x0: 1000, y1: 2000, rozdz: 4 }), OKNO), /inny zakres/)
  assert.throws(() => parsujSvg(svg({ x0: 1000, y1: 2000, rozdz: 2 }, 'deg'), OKNO), /jednostki/)
  assert.throws(
    () =>
      parsujSvg(
        '<?xml version="1.0"?><ServiceExceptionReport><ServiceException>błąd</ServiceException></ServiceExceptionReport>',
        OKNO,
      ),
    /nie jest SVG/,
  )
  assert.throws(
    () =>
      parsujSvg(
        svg({ x0: 1000, y1: 2000, rozdz: 2 }).replaceAll('stroke:none', 'stroke:red'),
        OKNO,
      ),
    /klas wypełnienia/,
    'wypełnienie to klasa ze stroke:none i kolorem; brak takiej klasy to zmiana stylu usługi',
  )
  // bez okna parser tylko przelicza (przydatne w narzędziach roboczych)
  assert.equal(parsujSvg(svg({ x0: 5, y1: 7, rozdz: 1 })).obiekty.length, 5)
})

// ── Geometria ────────────────────────────────────────────────────────────────────────────────

test('poleFigury: otwór odejmuje, część osobna dodaje, brak ujemnego pola', () => {
  const zewn = pierscien([
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ])
  const dziura = pierscien([
    [2, 2],
    [4, 2],
    [4, 4],
    [2, 4],
  ])
  const osobny = pierscien([
    [20, 0],
    [25, 0],
    [25, 5],
    [20, 5],
  ])
  assert.equal(poleFigury([zewn]), 100)
  assert.equal(poleFigury([zewn, dziura]), 96)
  assert.equal(poleFigury([zewn, dziura, osobny]), 121)
  // wyspa w otworze dodaje się z powrotem
  const wyspa = pierscien([
    [2.5, 2.5],
    [3.5, 2.5],
    [3.5, 3.5],
    [2.5, 3.5],
  ])
  assert.equal(poleFigury([zewn, dziura, wyspa]), 97)
})

test('odlegloscDoObiektu: wnętrze 0, brzeg, linia, punkt i punkt w otworze', () => {
  const w = kwadrat(0, 0, 0, 10, 10)
  assert.equal(odlegloscDoObiektu(5, 5, w), 0)
  assert.equal(odlegloscDoObiektu(13, 14, w), 5)
  assert.equal(odlegloscDoObiektu(-3, 5, w), 3)
  const l = linia(1, [
    [0, 0],
    [10, 0],
    [10, 10],
  ])
  assert.equal(odlegloscDoObiektu(5, 3, l), 3)
  assert.equal(odlegloscDoObiektu(13, 10, l), 3)
  assert.equal(odlegloscDoObiektu(5, 3, punkt(2, 8, 7)), 5)
  const zOtworem = {
    ...w,
    pierscienie: [
      ...w.pierscienie,
      pierscien([
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
      ]),
    ],
  }
  assert.equal(
    odlegloscDoObiektu(5, 5, zOtworem),
    1,
    'w otworze liczy się odległość do jego brzegu',
  )
  assert.equal(wewnatrzObiektu(5, 5, l), false, 'linia nie ma wnętrza')
})

// ── GetFeatureInfo ───────────────────────────────────────────────────────────────────────────

const gfi = (...pozycje) =>
  `<?xml version="1.0" encoding="utf-8"?><FeatureCollection xmlns="http://www.intergraph.com/geomedia/gml" xmlns:gml="http://www.opengis.net/gml">${pozycje
    .map(
      ([id, nazwa]) =>
        `<gml:featureMember><Layer Name="Immovable_Monuments"><Attribute Name="INSPIREID">${id}</Attribute><Attribute Name="LEGALFOUNDATIONDATE">02/02/1973</Attribute><Attribute Name="SITENAME">${nazwa}</Attribute></Layer></gml:featureMember>`,
    )
    .join('')}</FeatureCollection>`

test('parsujGfi: identyfikatory, nazwy i typ w kolejności serwera; błąd usługi to wyjątek', () => {
  const wynik = parsujGfi(
    gfi(
      ['PL.1.9.ZIPOZ.NID_N_12_BK.198432', 'Sukiennice'],
      ['PL.1.9.ZIPOZ.NID_N_12_UU.22719', 'Śródmieście'],
    ),
  )
  assert.deepEqual(wynik, [
    { id: 'PL.1.9.ZIPOZ.NID_N_12_BK.198432', nazwa: 'Sukiennice', typ: 'BK' },
    { id: 'PL.1.9.ZIPOZ.NID_N_12_UU.22719', nazwa: 'Śródmieście', typ: 'UU' },
  ])
  assert.deepEqual(parsujGfi(gfi()), [], 'pusta kolekcja to zero obiektów w punkcie')
  assert.throws(
    () =>
      parsujGfi(
        '<ServiceExceptionReport><ServiceException>x</ServiceException></ServiceExceptionReport>',
      ),
    /bez FeatureCollection/,
  )
  assert.throws(
    () =>
      parsujGfi(
        '<FeatureCollection><gml:featureMember><Layer Name="x"><Attribute Name="SITENAME">a</Attribute></Layer></gml:featureMember></FeatureCollection>',
      ),
    /bez INSPIREID/,
  )
  assert.equal(parsujGfi(gfi(['inny-format', 'x']))[0]?.typ, null)
})

test('rozbierzId: województwo, typ i numer wpisu', () => {
  assert.deepEqual(rozbierzId('PL.1.9.ZIPOZ.NID_N_12_BK.198432'), {
    wojewodztwo: '12',
    typ: 'BK',
    numer: 198432,
  })
  assert.equal(rozbierzId('PL.1.9.ZIPOZ.NID_E_12_BK.198432'), null)
  assert.equal(rozbierzId(undefined), null)
})

// ── Sondy ────────────────────────────────────────────────────────────────────────────────────

/** Układ jak w centrum miasta: duży obszar A, w nim budynki B i C, obok osobny D; linia L i punkt P. */
const scena = () => [
  kwadrat(0, 0, 0, 200, 200),
  kwadrat(1, 50, 50, 70, 70),
  kwadrat(2, 120, 120, 130, 130),
  kwadrat(3, 500, 0, 510, 10),
  linia(4, [
    [300, 300],
    [320, 300],
  ]),
  punkt(5, 400, 400),
]

test('IndeksPokrycia.trafione: wielokąty pokrywające punkt oraz linie i punkty w tolerancji, rosnąco', () => {
  const ind = new IndeksPokrycia(scena())
  assert.deepEqual(ind.trafione(125, 125), [0, 2])
  assert.deepEqual(ind.trafione(60, 60), [0, 1])
  assert.deepEqual(ind.trafione(300, 150), [])
  assert.deepEqual(ind.trafione(310, 300.2), [4])
  assert.deepEqual(ind.trafione(310, 301), [], 'linia 1 m obok nie jest trafiona')
  assert.deepEqual(ind.trafione(400, 400), [5])
  assert.equal(ind.odlegloscDoKrawedzi(125, 125), 5)
  assert.equal(ind.odlegloscDoKrawedzi(300, 150), Number.POSITIVE_INFINITY, 'poza zasięgiem 8 m')
  assert.equal(ind.odlegloscDoKrawedzi(300, 150, 120), 100)
})

test('planujSondy: zagnieżdżone obiekty w jednej sondzie, sonda w głębi obiektu, kolejne próby w innym miejscu', () => {
  const o = scena()
  const ind = new IndeksPokrycia(o)
  const plan = planujSondy(o, ind)
  assert.deepEqual(plan.bezPunktu, [])
  // od najmniejszego: C (i=2, pokrywa też A), D, B (pokrywa A), potem linia i punkt
  assert.deepEqual(
    plan.sondy.map((s) => s.pokrywane),
    [[0, 2], [3], [0, 1], [4], [5]],
  )
  const c = plan.sondy[0]
  assert.ok(c && Math.abs(c.x - 125) < 1 && Math.abs(c.y - 125) < 1, 'środek budynku')
  assert.ok((c?.glebokosc ?? 0) >= 4)
  // każdy obiekt jest pokryty przez co najmniej jedną sondę
  const pokryte = new Set(plan.sondy.flatMap((s) => s.pokrywane))
  assert.deepEqual([...pokryte].sort(), [0, 1, 2, 3, 4, 5])

  // rozwiązane obiekty pomijamy; A leży pod B i C, więc zostaje jedna sonda dla B
  const reszta = planujSondy(o, ind, { rozwiazane: new Set([0, 2, 3, 4, 5]) })
  assert.deepEqual(
    reszta.sondy.map((s) => s.pokrywane),
    [[0, 1]],
  )

  // kolejna próba bierze inny punkt (co najmniej 1,5 m od pierwszego)
  const druga = planujSondy(o, ind, { proba: 1 })
  const pierwszy = plan.sondy[0]
  const inny = druga.sondy[0]
  assert.ok(pierwszy && inny)
  assert.ok(Math.hypot(pierwszy.x - inny.x, pierwszy.y - inny.y) >= 1.5)
  assert.deepEqual(druga.bezPunktu, [5], 'punkt nie ma drugiego kandydata, a linia ma drugi koniec')
  const linijka = druga.sondy.find((s) => s.pokrywane.includes(4))
  assert.deepEqual(
    [linijka?.x, linijka?.y],
    [320, 300],
    'druga próba dla linii to jej drugi koniec',
  )
})

test('przypiszId: i-ty identyfikator należy do i-tego obiektu, niespójne sondy są odrzucane, powtórzony id to nie sprzeczność', () => {
  const sondy = [
    { pokrywane: [0, 2], obiekty: [{ id: 'A' }, { id: 'C' }] },
    { pokrywane: [0, 1], obiekty: [{ id: 'A' }, { id: 'B' }] },
    { pokrywane: [3], obiekty: [{ id: 'A' }] }, // ten sam wpis w kilku częściach (obiekty 0 i 3)
    { pokrywane: [4, 5], obiekty: [{ id: 'X' }] }, // za mało obiektów: sonda odrzucona
    { pokrywane: [6], obiekty: null }, // nieudane zapytanie
  ]
  const w = przypiszId(sondy)
  assert.equal(w.sondyOk, 3)
  assert.equal(w.niezgodne, 2)
  assert.deepEqual(
    [...w.przypisania].map(([i, p]) => [i, p.id]).sort((a, b) => a[0] - b[0]),
    [
      [0, 'A'],
      [1, 'B'],
      [2, 'C'],
      [3, 'A'],
    ],
  )
  assert.deepEqual(w.sprzeczne, [])
  // dwa różne identyfikatory dla jednego obiektu to sprzeczność (zła kolejność w usłudze)
  const zle = przypiszId([
    { pokrywane: [0, 1], obiekty: [{ id: 'A' }, { id: 'B' }] },
    { pokrywane: [0, 1], obiekty: [{ id: 'B' }, { id: 'A' }] },
    { pokrywane: [0, 1], obiekty: [{ id: 'A' }, { id: 'B' }] },
  ])
  assert.deepEqual(zle.sprzeczne.sort(), [0, 1])
  assert.equal(zle.przypisania.get(0)?.id, 'A', 'większość głosów wygrywa')
})

// ── Klasy wpisów ─────────────────────────────────────────────────────────────────────────────

test('klasaWpisu: typ rozstrzyga, pole tylko dla nieznanego typu i dla olbrzymich budowli', () => {
  assert.equal(klasaWpisu('OT', 100), 'otoczenie')
  assert.equal(klasaWpisu('BK', 300), 'obiekt')
  assert.equal(klasaWpisu('MA', 0), 'obiekt')
  assert.equal(klasaWpisu('BL', 77_000), 'obiekt', 'fort')
  assert.equal(klasaWpisu('BL', 2_353_000), 'obszar', 'kopalnia soli pod miastem')
  assert.equal(klasaWpisu('BK', GRANICA_DUZEGO_OBIEKTU_M2 + 1), 'obszar')
  assert.equal(klasaWpisu('UU', 50), 'obszar')
  assert.equal(klasaWpisu('ZZ', 20), 'obszar')
  assert.equal(klasaWpisu('CM', 10), 'obszar')
  // brak typu: parki i układy są duże, budynki małe
  assert.equal(klasaWpisu(null, 450), 'obiekt')
  assert.equal(klasaWpisu(null, 50_000), 'obszar')
  assert.equal(klasaWpisu('ZZ ', 450), 'obiekt', 'nowy kod NID traktujemy jak nieznany')
})
