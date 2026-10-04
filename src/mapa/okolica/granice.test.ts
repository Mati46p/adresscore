// Okolica wybrana w wyszukiwarce na mapie (#185). Uruchom: node --test src/mapa/okolica/
// Część testów jedzie na prawdziwych plikach z public/dane (okolice.json, okolice-granice.geojson,
// adresy.json) – bez nich jest pomijana.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { PlikAdresow } from '../../kontrakty/index.ts'
import type { PlikOkolic } from '../../kontrakty/okolice.ts'
import { plikOkolic } from '../../wynik/okoliceTestowe.ts'
import {
  graniceWielokata,
  type JednostkaGeoJson,
  okolicaNaMapie,
  type PlikGranic,
  znajdzJednostke,
} from './granice.ts'

const jednostka = (
  id: string,
  numer: string,
  pierscien: number[][],
  dziury: number[][][] = [],
): JednostkaGeoJson => ({
  type: 'Feature',
  properties: { id, numer, nazwa: id, dzielnica: 'VIII Dębniki', powierzchniaKm2: 1 },
  geometry: { type: 'Polygon', coordinates: [pierscien, ...dziury] },
})

// Kwadrat 0,02° × 0,01° wokół Ruczaju.
const KWADRAT = [
  [19.89, 50.01],
  [19.91, 50.01],
  [19.91, 50.02],
  [19.89, 50.02],
  [19.89, 50.01],
]
const GRANICE_TESTOWE: PlikGranic = {
  type: 'FeatureCollection',
  features: [jednostka('sim-805', 'VIII.5', KWADRAT), jednostka('sim-101', 'I.1', KWADRAT)],
}

describe('graniceWielokata', () => {
  it('prostokąt obejmujący pierścień: [[zachód, południe], [wschód, północ]]', () => {
    assert.deepEqual(graniceWielokata([KWADRAT]), [
      [19.89, 50.01],
      [19.91, 50.02],
    ])
  })

  it('dziury nie rozszerzają ramki (leżą wewnątrz), a nietypowy pierścień jest liczony cały', () => {
    const dziura = [
      [19.895, 50.012],
      [19.9, 50.012],
      [19.9, 50.016],
      [19.895, 50.012],
    ]
    assert.deepEqual(graniceWielokata([KWADRAT, dziura]), [
      [19.89, 50.01],
      [19.91, 50.02],
    ])
    assert.deepEqual(
      graniceWielokata([
        [
          [1, 5],
          [-2, 3],
          [4, -1],
          [1, 5],
        ],
      ]),
      [
        [-2, -1],
        [4, 5],
      ],
    )
  })

  it('pusty wielokąt i punkty bez skończonych współrzędnych dają null', () => {
    assert.equal(graniceWielokata([]), null)
    assert.equal(graniceWielokata([[]]), null)
    assert.equal(
      graniceWielokata([
        [
          [Number.NaN, 1],
          [2, Number.POSITIVE_INFINITY],
        ],
      ]),
      null,
    )
  })
})

describe('znajdzJednostke', () => {
  it('po id; z numerem tylko ta sama jednostka co w okolice.json', () => {
    assert.equal(znajdzJednostke(GRANICE_TESTOWE, 'sim-805')?.properties.numer, 'VIII.5')
    assert.equal(znajdzJednostke(GRANICE_TESTOWE, 'sim-805', 'VIII.5')?.properties.id, 'sim-805')
    assert.equal(znajdzJednostke(GRANICE_TESTOWE, 'sim-805', 'VIII.6'), null)
  })

  it('nieznane id, brak pliku i geometria inna niż wielokąt dają null', () => {
    assert.equal(znajdzJednostke(GRANICE_TESTOWE, 'sim-999'), null)
    assert.equal(znajdzJednostke(null, 'sim-805'), null)
    assert.equal(znajdzJednostke(undefined, 'sim-805'), null)
    const punkt = {
      ...jednostka('sim-1', 'I.1', KWADRAT),
      geometry: { type: 'Point', coordinates: [19.9, 50] },
    } as unknown as JednostkaGeoJson
    assert.equal(znajdzJednostke({ features: [punkt] }, 'sim-1'), null)
  })
})

describe('okolicaNaMapie', () => {
  // Adresy: 0 i 1 w Ruczaju (sim-805), 2 w Liszkach, 3 w Liszkach, 4 bez okolicy.
  const KOLUMNA = ['sim-805', 'sim-805', 'm-1206063-liszki', 'm-1206063-liszki', null]
  const WPISY: PlikOkolic['okolice'] = {
    'sim-805': {
      nazwa: 'Ruczaj',
      numer: 'VIII.5',
      rodzaj: 'sim',
      dzielnica: 'VIII Dębniki',
      gmina: 'Kraków',
      powierzchniaKm2: 1,
      liczbaAdresow: 2,
      potoczne: [],
    },
    'm-1206063-liszki': {
      nazwa: 'Liszki',
      rodzaj: 'miejscowosc',
      dzielnica: null,
      gmina: 'Liszki',
      liczbaAdresow: 2,
    },
  }
  const okolice = plikOkolic(KOLUMNA, 'test', WPISY)
  const adres = (dzielnica: string | null, gmina: string, lon: number, lat: number) => ({
    dzielnica,
    gmina,
    lon,
    lat,
  })
  const adresy = [
    adres('VIII Dębniki', 'Kraków', 19.9, 50.015),
    adres('VIII Dębniki', 'Kraków', 19.905, 50.018),
    adres(null, 'Liszki', 19.8, 50.08),
    adres(null, 'Liszki', 19.81, 50.09),
    adres('VIII Dębniki', 'Kraków', 19.95, 50.05),
  ]

  it('jednostka SIM: ramka i obrys z pliku granic, nie z adresów', () => {
    const o = okolicaNaMapie('sim-805', GRANICE_TESTOWE, adresy, okolice)
    assert.equal(o?.id, 'sim-805')
    assert.deepEqual(o?.granice, [
      [19.89, 50.01],
      [19.91, 50.02],
    ])
    assert.equal(o?.obrys?.properties.id, 'sim-805')
  })

  it('miejscowość: ramka adresów okolicy, bez obrysu (poza Krakowem nie ma granic w pliku)', () => {
    const o = okolicaNaMapie('m-1206063-liszki', GRANICE_TESTOWE, adresy, okolice)
    assert.equal(o?.obrys, null)
    assert.deepEqual(o?.granice, [
      [19.8, 50.08],
      [19.81, 50.09],
    ])
  })

  it('jednostka bez pliku granic albo bez wpisu w nim: ramka adresów, bez obrysu', () => {
    for (const plik of [null, undefined, { features: [] }]) {
      const o = okolicaNaMapie('sim-805', plik, adresy, okolice)
      assert.equal(o?.obrys, null)
      assert.ok(o)
      // Adresy 0 i 1 mają 0,005° × 0,003°: ramka je obejmuje.
      assert.ok(o.granice[0][0] <= 19.9 && o.granice[1][0] >= 19.905)
      assert.ok(o.granice[0][1] <= 50.015 && o.granice[1][1] >= 50.018)
    }
  })

  it('jednostka o innym numerze w pliku granic niż w okolice.json: bez obrysu zamiast cudzego obrysu', () => {
    const inne: PlikGranic = {
      type: 'FeatureCollection',
      features: [jednostka('sim-805', 'VIII.9', KWADRAT)],
    }
    const o = okolicaNaMapie('sim-805', inne, adresy, okolice)
    assert.equal(o?.obrys, null)
    assert.ok(o?.granice)
  })

  it('nieznane id i okolica bez żadnego adresu z położeniem dają null', () => {
    assert.equal(okolicaNaMapie('sim-999', GRANICE_TESTOWE, adresy, okolice), null)
    assert.equal(okolicaNaMapie('dzielnica:VIII Dębniki', GRANICE_TESTOWE, adresy, okolice), null)
    assert.equal(okolicaNaMapie('m-1206063-liszki', null, [], okolice), null)
    const bezPolozenia = [adres(null, 'Liszki', 0, 0), adres(null, 'Liszki', 0, 0)]
    assert.equal(okolicaNaMapie('m-1206063-liszki', null, bezPolozenia, okolice), null)
  })

  it('każde wywołanie daje nowy obiekt: nowy wybór leci też do tej samej okolicy', () => {
    const a = okolicaNaMapie('sim-805', GRANICE_TESTOWE, adresy, okolice)
    const b = okolicaNaMapie('sim-805', GRANICE_TESTOWE, adresy, okolice)
    assert.notEqual(a, b)
    assert.deepEqual(a, b)
  })
})

// ── Prawdziwe dane ───────────────────────────────────────────────────────────────────────

const DANE = new URL('../../../public/dane/', import.meta.url)
const PLIKI = ['adresy.json', 'okolice.json', 'okolice-granice.geojson']
const MA_PLIKI = PLIKI.every((p) => existsSync(new URL(p, DANE)))

describe('okolicaNaMapie na prawdziwych danych', {
  skip: MA_PLIKI ? false : 'brak plików danych',
}, () => {
  const czytaj = <T>(plik: string): T => JSON.parse(readFileSync(new URL(plik, DANE), 'utf8'))
  const adresyPlik = czytaj<PlikAdresow>('adresy.json')
  const okolice = czytaj<PlikOkolic>('okolice.json')
  const granice = czytaj<PlikGranic>('okolice-granice.geojson')
  const k = adresyPlik.kolumny
  const adresy = k.id.map((_, i) => ({
    dzielnica: k.dzielnica[i] ?? null,
    gmina: k.gmina[i] ?? '',
    lon: k.lon[i] ?? 0,
    lat: k.lat[i] ?? 0,
  }))
  const zgodne = okolice.wersjaAdresow === adresyPlik.wersja
  const jednostki = okolice.idOkolic.filter((id) => okolice.okolice[id]?.rodzaj === 'sim')

  it('plik granic ma 123 wielokąty zgodne z jednostkami z okolice.json (id, numer, nazwa)', () => {
    assert.equal(granice.features.length, 123)
    assert.equal(jednostki.length, 123)
    for (const id of jednostki) {
      const wpis = okolice.okolice[id]
      const j = znajdzJednostke(granice, id)
      assert.ok(j, `${id} bez granic`)
      assert.equal(
        wpis?.rodzaj === 'sim' && j.properties.numer,
        wpis?.rodzaj === 'sim' && wpis.numer,
      )
      assert.equal(j.properties.nazwa, wpis?.nazwa, id)
      // Pierścień zamknięty i mieszczący się w obwarzanku Krakowa.
      const pierscien = j.geometry.coordinates[0] ?? []
      assert.ok(pierscien.length >= 4, id)
      assert.deepEqual(
        pierscien[0],
        pierscien[pierscien.length - 1],
        `${id}: pierścień niezamknięty`,
      )
      const r = graniceWielokata(j.geometry.coordinates)
      assert.ok(r && r[0][0] > 19.7 && r[1][0] < 20.3 && r[0][1] > 49.9 && r[1][1] < 50.2, id)
    }
  })

  it('ramka każdej jednostki obejmuje wszystkie jej adresy (okolice.json i granice to ten sam podział)', () => {
    if (!zgodne) return
    const kolumna = okolice.kolumny.okolica
    const poOkolicy = new Map<string, number[]>()
    for (const [i, p] of kolumna.entries()) {
      if (p === null) continue
      const id = okolice.idOkolic[p] as string
      const lista = poOkolicy.get(id)
      if (lista) lista.push(i)
      else poOkolicy.set(id, [i])
    }
    const eps = 1e-5
    for (const id of jednostki) {
      const o = okolicaNaMapie(id, granice, adresy, okolice)
      assert.ok(o?.obrys, `${id}: brak obrysu`)
      const [[w, s], [e, n]] = o.granice
      const wsrod = poOkolicy.get(id) ?? []
      assert.ok(wsrod.length > 0, id)
      for (const i of wsrod) {
        const a = adresy[i] as (typeof adresy)[number]
        assert.ok(
          a.lon >= w - eps && a.lon <= e + eps && a.lat >= s - eps && a.lat <= n + eps,
          `${id}: adres ${i} (${a.lon}, ${a.lat}) poza ramką ${[w, s, e, n]}`,
        )
      }
    }
  })

  it('Ruczaj: ramka w okolicach Ruczaju, obrys ma id jednostki', () => {
    const o = okolicaNaMapie('sim-805', granice, adresy, okolice)
    assert.equal(o?.obrys?.properties.nazwa, 'Ruczaj')
    assert.ok(o)
    const srodekLon = (o.granice[0][0] + o.granice[1][0]) / 2
    const srodekLat = (o.granice[0][1] + o.granice[1][1]) / 2
    assert.ok(Math.abs(srodekLon - 19.9) < 0.03, `lon ${srodekLon}`)
    assert.ok(Math.abs(srodekLat - 50.02) < 0.03, `lat ${srodekLat}`)
  })

  it('miejscowość ma ramkę adresów i nie ma obrysu (co ósma z 234, każda liczy się ok. 8 ms)', () => {
    if (!zgodne) return
    const miejscowosci = okolice.idOkolic.filter(
      (id) => okolice.okolice[id]?.rodzaj === 'miejscowosc',
    )
    assert.equal(miejscowosci.length, 234)
    for (const id of miejscowosci.filter((_, p) => p % 8 === 0)) {
      const o = okolicaNaMapie(id, granice, adresy, okolice)
      assert.ok(o, id)
      assert.equal(o.obrys, null, id)
      assert.ok(o.granice[0][0] < o.granice[1][0] && o.granice[0][1] < o.granice[1][1], id)
    }
  })

  it('wszystkie 123 obrysy liczą się w ułamku sekundy', () => {
    const t = performance.now()
    for (const id of jednostki) okolicaNaMapie(id, granice, adresy, okolice)
    const ms = performance.now() - t
    console.log(`okolicaNaMapie: ${ms.toFixed(1)} ms dla 123 jednostek`)
    assert.ok(ms < 1000, `${ms} ms`)
  })
})
