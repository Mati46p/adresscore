// Geometria heksów bieżącego miasta i tła mapy (#223). Uruchom: node --test src/mapa/geometria.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cellToBoundary, cellToParent, gridDisk, latLngToCell } from 'h3-js'
import {
  POZIOMY,
  POZIOMY_TLA,
  poziomyTlaDoOdswiezenia,
  rowneKlucze,
  sredniaDzieci,
  takieSameKlucze,
  takieSameKluczeTla,
  zbudujGeometrie,
  zbudujGeometrieTla,
  zbudujOtoczke,
} from './geometria.ts'

// Środki dwóch miast ze zbioru: nie dotykają się, więc ich heksy tworzą dwa osobne obszary.
const KRAKOW = { lat: 50.046, lon: 19.95 }
const GDANSK = { lat: 54.358, lon: 18.596 }
const komorka = ({ lat, lon }: { lat: number; lon: number }, res: number) =>
  latLngToCell(lat, lon, res)
/** Komórka i jej sąsiedzi do `promien` kroków: zwarty obszar heksów danego poziomu. */
const obszar = (miasto: { lat: number; lon: number }, res: number, promien: number) =>
  gridDisk(komorka(miasto, res), promien)

const mapaWartosci = (klucze: Iterable<string>, w: number | null = 50) =>
  new Map<string, number | null>([...klucze].map((h) => [h, w]))

describe('zbudujOtoczke', () => {
  it('bez heksów nie ma kadru: granice null zamiast odwróconego prostokąta', () => {
    const o = zbudujOtoczke()
    assert.equal(o.granice, null)
    assert.equal(o.obrys.features.length, 0)
    // Sama ramka świata, bez dziur: mgła przykrywa wszystko.
    assert.equal(o.mgla.geometry.coordinates.length, 1)
    assert.equal(zbudujOtoczke([], []).granice, null)
  })

  it('jeden heks: jedna dziura w mgle, kadr obejmuje jego obrys', () => {
    const h = komorka(KRAKOW, 8)
    const o = zbudujOtoczke([h])
    assert.equal(o.obrys.features.length, 1)
    assert.equal(o.mgla.geometry.coordinates.length, 2)
    const lon = cellToBoundary(h, true).map(([x]) => x as number)
    const lat = cellToBoundary(h, true).map(([, y]) => y as number)
    assert.deepEqual(o.granice, [
      [Math.min(...lon), Math.min(...lat)],
      [Math.max(...lon), Math.max(...lat)],
    ])
  })

  it('dwa odległe miasta: dwie dziury, kadr obejmuje oba', () => {
    const o = zbudujOtoczke(obszar(KRAKOW, 8, 2), obszar(GDANSK, 8, 2))
    assert.equal(o.obrys.features.length, 2)
    assert.equal(o.mgla.geometry.coordinates.length, 3)
    assert.ok(o.granice)
    const [[zachod, poludnie], [wschod, polnoc]] = o.granice
    for (const { lat, lon } of [KRAKOW, GDANSK]) {
      assert.ok(lon > zachod && lon < wschod, `lon ${lon} poza ${zachod}–${wschod}`)
      assert.ok(lat > poludnie && lat < polnoc, `lat ${lat} poza ${poludnie}–${polnoc}`)
    }
  })

  it('suma zbiorów: kolejność nie ma znaczenia, a powtórzony heks liczy się raz', () => {
    const a = obszar(KRAKOW, 8, 2)
    const b = obszar(GDANSK, 8, 2)
    const ab = zbudujOtoczke(a, b)
    const ba = zbudujOtoczke(b, a)
    assert.deepEqual(ab.granice, ba.granice)
    assert.equal(ab.obrys.features.length, ba.obrys.features.length)
    // cellsToMultiPolygon wymaga unikalnych komórek: duplikat nie może zmienić wyniku.
    assert.deepEqual(zbudujOtoczke(a, a), zbudujOtoczke(a))
    assert.deepEqual(zbudujOtoczke([...a, ...a]), zbudujOtoczke(a))
  })

  it('akceptuje dowolny iterowalny zbiór kluczy (Set, klucze mapy)', () => {
    const a = obszar(KRAKOW, 8, 1)
    assert.deepEqual(zbudujOtoczke(new Set(a)), zbudujOtoczke(a))
    assert.deepEqual(zbudujOtoczke(mapaWartosci(a).keys()), zbudujOtoczke(a))
  })
})

describe('zbudujGeometrie (heksy bieżącego miasta)', () => {
  const r10 = obszar(KRAKOW, 10, 3)
  const g = zbudujGeometrie(r10)

  it('r10 ma poligon na każdy klucz, r8 i r9 na każdego rodzica', () => {
    assert.equal(g.zrodla[10].features.length, r10.length)
    assert.equal(g.zrodla[9].features.length, g.dzieci[9].size)
    assert.equal(g.zrodla[8].features.length, g.dzieci[8].size)
    for (const res of [8, 9] as const) {
      let dzieci = 0
      for (const [rodzic, lista] of g.dzieci[res]) {
        dzieci += lista.length
        for (const h of lista) assert.equal(cellToParent(h, res), rodzic)
      }
      assert.equal(dzieci, r10.length, `każdy heks r10 ma dokładnie jednego rodzica r${res}`)
    }
  })

  it('mgła, obrys i kadr to otoczka z rodziców r8 (bez tła nic się nie zmienia)', () => {
    const o = zbudujOtoczke(g.dzieci[8].keys())
    assert.deepEqual(g.mgla, o.mgla)
    assert.deepEqual(g.obrys, o.obrys)
    assert.deepEqual(g.granice, o.granice)
  })

  it('pusty zbiór: pusta geometria bez kadru', () => {
    const pusta = zbudujGeometrie([])
    assert.equal(pusta.klucze.size, 0)
    assert.equal(pusta.granice, null)
    assert.equal(pusta.zrodla[10].features.length, 0)
  })

  it('takieSameKlucze: te same klucze w dowolnej kolejności, inaczej false', () => {
    const odwrocone = mapaWartosci([...r10].reverse())
    assert.equal(takieSameKlucze(g, odwrocone), true)
    assert.equal(takieSameKlucze(g, mapaWartosci(r10.slice(1))), false)
    assert.equal(takieSameKlucze(g, mapaWartosci([...r10, komorka(GDANSK, 10)])), false)
    assert.equal(takieSameKlucze(null, odwrocone), false)
  })
})

describe('zbudujGeometrieTla', () => {
  const r8 = obszar(KRAKOW, 8, 2)
  const r9 = obszar(GDANSK, 9, 3)

  it('kolekcje r8 i r9 – i tylko one, bez r10', () => {
    const g = zbudujGeometrieTla(r8, r9)
    assert.deepEqual(Object.keys(g.zrodla).sort(), ['8', '9'])
    assert.deepEqual(
      POZIOMY_TLA.map((p) => p.res),
      [8, 9],
    )
    assert.equal(g.zrodla[8].features.length, r8.length)
    assert.equal(g.zrodla[9].features.length, r9.length)
    assert.deepEqual([...g.klucze[8]].sort(), [...r8].sort())
    assert.deepEqual([...g.klucze[9]].sort(), [...r9].sort())
  })

  it('poligon heksu: id h3 w właściwościach, zamknięty pierścień, współrzędne [lon, lat]', () => {
    const g = zbudujGeometrieTla(r8, r9)
    for (const f of g.zrodla[8].features) {
      assert.ok(g.klucze[8].has(f.properties.h3))
      assert.equal(f.geometry.type, 'Polygon')
      const pierscien = f.geometry.coordinates[0] as [number, number][]
      assert.deepEqual(pierscien[0], pierscien[pierscien.length - 1])
      // Kraków: lon ok. 20°E, lat ok. 50°N. Odwrócona kolejność dałaby 50 i 20.
      const [lon, lat] = pierscien[0] as [number, number]
      assert.ok(lon > 19 && lon < 21 && lat > 49 && lat < 51, `[${lon}, ${lat}]`)
    }
  })

  it('pusty zbiór: puste kolekcje', () => {
    const g = zbudujGeometrieTla([], [])
    assert.equal(g.zrodla[8].features.length, 0)
    assert.equal(g.zrodla[9].features.length, 0)
  })

  it('powtórzony klucz daje jeden poligon', () => {
    const g = zbudujGeometrieTla([...r8, ...r8], [])
    assert.equal(g.zrodla[8].features.length, r8.length)
  })

  it('z poprzednią geometrią poziom o tych samych kluczach zachowuje kolekcję (ten sam obiekt)', () => {
    const pierwsza = zbudujGeometrieTla(r8, r9)
    const tylkoR9 = zbudujGeometrieTla([...r8].reverse(), obszar(GDANSK, 9, 4), pierwsza)
    assert.ok(tylkoR9.zrodla[8] === pierwsza.zrodla[8], 'r8 bez zmian: ta sama kolekcja')
    assert.ok(tylkoR9.zrodla[9] !== pierwsza.zrodla[9], 'r9 się zmienił: nowa kolekcja')
    const tylkoR8 = zbudujGeometrieTla(obszar(KRAKOW, 8, 3), r9, pierwsza)
    assert.ok(tylkoR8.zrodla[8] !== pierwsza.zrodla[8])
    assert.ok(tylkoR8.zrodla[9] === pierwsza.zrodla[9])
    // Bez poprzedniej wszystko liczy się od nowa.
    const nowa = zbudujGeometrieTla(r8, r9)
    assert.ok(nowa.zrodla[8] !== pierwsza.zrodla[8])
  })
})

describe('takieSameKluczeTla', () => {
  const r8 = obszar(KRAKOW, 8, 2)
  const r9 = obszar(GDANSK, 9, 2)
  const g = zbudujGeometrieTla(r8, r9)
  const tlo = (a: Iterable<string>, b: Iterable<string>) => ({
    8: mapaWartosci(a),
    9: mapaWartosci(b),
  })

  it('te same klucze obu poziomów w dowolnej kolejności', () => {
    assert.equal(takieSameKluczeTla(g, tlo(r8, r9)), true)
    assert.equal(takieSameKluczeTla(g, tlo([...r8].reverse(), [...r9].reverse())), true)
  })

  it('zmiana wartości nie zmienia kluczy (suwak wag nie przebudowuje wielokątów)', () => {
    const inneWartosci = { 8: mapaWartosci(r8, 10), 9: mapaWartosci(r9, null) }
    assert.equal(takieSameKluczeTla(g, inneWartosci), true)
  })

  it('inny klucz w r8 albo w r9, brak geometrii: false', () => {
    assert.equal(takieSameKluczeTla(g, tlo(r8.slice(1), r9)), false)
    assert.equal(takieSameKluczeTla(g, tlo(r8, [...r9, komorka(KRAKOW, 9)])), false)
    assert.equal(takieSameKluczeTla(null, tlo(r8, r9)), false)
  })

  it('pusta geometria i puste tło to to samo (start mapy nie buduje nic)', () => {
    assert.equal(takieSameKluczeTla(zbudujGeometrieTla([], []), tlo([], [])), true)
  })
})

describe('rowneKlucze', () => {
  it('porównuje zbiór z kluczami mapy i z drugim zbiorem', () => {
    const zbior = new Set(['a', 'b'])
    assert.equal(
      rowneKlucze(
        zbior,
        new Map([
          ['b', 1],
          ['a', 2],
        ]),
      ),
      true,
    )
    assert.equal(rowneKlucze(zbior, new Set(['b', 'a'])), true)
    assert.equal(rowneKlucze(zbior, new Set(['a', 'c'])), false)
    assert.equal(rowneKlucze(zbior, new Set(['a'])), false)
  })
})

describe('poziomyTlaDoOdswiezenia', () => {
  it('widok kraju: tylko r8; przybliżenie miejskie dokłada r9; ulica: nic', () => {
    assert.deepEqual(poziomyTlaDoOdswiezenia(5.5), [8])
    assert.deepEqual(poziomyTlaDoOdswiezenia(9.4), [8])
    assert.deepEqual(poziomyTlaDoOdswiezenia(9.5), [8, 9])
    assert.deepEqual(poziomyTlaDoOdswiezenia(11), [8, 9])
    assert.deepEqual(poziomyTlaDoOdswiezenia(12.4), [8, 9])
    assert.deepEqual(poziomyTlaDoOdswiezenia(12.5), [9])
    assert.deepEqual(poziomyTlaDoOdswiezenia(14.4), [9])
    assert.deepEqual(poziomyTlaDoOdswiezenia(14.5), [])
    assert.deepEqual(poziomyTlaDoOdswiezenia(16), [])
  })

  it('zapas nigdy nie gubi poziomu, który jest widoczny przy danym zoomie', () => {
    let sprawdzone = 0
    for (let zoom = 0; zoom <= 24; zoom += 0.125) {
      const odswiezane = poziomyTlaDoOdswiezenia(zoom)
      for (const { res, minzoom, maxzoom } of POZIOMY_TLA) {
        if (zoom < minzoom || zoom >= maxzoom) continue
        sprawdzone++
        assert.ok(odswiezane.includes(res), `r${res} widoczny przy zoomie ${zoom}, a nieodświeżany`)
      }
    }
    // Pętla musi coś zmierzyć: oba poziomy mają zakresy zoomu, więc są setki kroków.
    assert.ok(sprawdzone > 100, `zmierzono tylko ${sprawdzone} kroków`)
  })

  it('tło ma te same zakresy zoomu co heksy bieżącego miasta (r8 i r9)', () => {
    for (const p of POZIOMY_TLA) {
      const swoj = POZIOMY.find((q) => q.res === p.res)
      assert.deepEqual(p, swoj)
    }
  })
})

describe('sredniaDzieci', () => {
  const heksy = new Map<string, number | null>([
    ['a', 40],
    ['b', null],
    ['c', 60],
    ['d', 0],
  ])

  it('średnia znanych wyników, braki pomijane', () => {
    assert.equal(sredniaDzieci(['a', 'b', 'c'], heksy), 50)
  })

  it('same braki albo nieznane klucze to null, nigdy 0', () => {
    assert.equal(sredniaDzieci(['b'], heksy), null)
    assert.equal(sredniaDzieci(['x', 'y'], heksy), null)
    assert.equal(sredniaDzieci([], heksy), null)
    assert.equal(sredniaDzieci(['n'], new Map([['n', Number.NaN]])), null)
  })

  it('prawdziwe zero jest wynikiem, nie brakiem', () => {
    assert.equal(sredniaDzieci(['d'], heksy), 0)
  })
})
