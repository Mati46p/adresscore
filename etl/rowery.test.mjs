import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { IndeksOdcinkow, odlegloscDoOdcinka } from './lib/odcinki.mjs'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import {
  dataImportu,
  dataPbf,
  indeksStojakow,
  liczbaStojakow,
  linieMsip,
  MAX_ODLEGLOSC,
  najblizszaLiniaLiniowo,
  najblizszyPunkt,
  parkingiPrMsip,
  rodzajMsip,
  rodzajOsm,
  stojakiMsip,
  stojakiWPromieniu,
  zlozLinieOsm,
} from './rowery.mjs'

// Współrzędne w metrach EPSG:2178 z okolic Krakowa – tak samo duże liczby jak w prawdziwych danych.
const X0 = 7_420_000
const Y0 = 5_545_000

function losowy(ziarno) {
  let a = ziarno
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('odległość punktu od odcinka: rzut prostopadły, końce i odcinek zerowy', () => {
  assert.equal(odlegloscDoOdcinka(5, 3, 0, 0, 10, 0), 3)
  assert.equal(odlegloscDoOdcinka(-4, 3, 0, 0, 10, 0), 5)
  assert.equal(odlegloscDoOdcinka(14, 3, 0, 0, 10, 0), 5)
  assert.equal(odlegloscDoOdcinka(3, 4, 0, 0, 0, 0), 5)
  // Punkt leży na odcinku: odległość 0 (a nie przypadkowa dodatnia z błędu zaokrągleń).
  assert.ok(odlegloscDoOdcinka(0, 0, -1, 1, 1, -1) < 1e-12)
})

test('indeks odcinków zgadza się z przeszukaniem liniowym, także dla długich odcinków', () => {
  const los = losowy(119)
  const linie = []
  for (let n = 0; n < 150; n++) {
    let x = X0 + los() * 6000
    let y = Y0 + los() * 6000
    const punkty = [[x, y]]
    for (let k = 0, ile = 2 + Math.floor(los() * 6); k < ile; k++) {
      // Kroki do 900 m: część odcinków jest dłuższa niż komórka 250 m i musi zostać podzielona.
      x += (los() - 0.5) * 1800
      y += (los() - 0.5) * 1800
      punkty.push([x, y])
    }
    linie.push({ rodzaj: n % 3, punkty })
  }
  const indeks = new IndeksOdcinkow(250)
  for (const l of linie) indeks.dodajLinie(l.punkty, l.rodzaj)
  assert.equal(indeks.liczbaLinii, 150)
  for (let q = 0; q < 600; q++) {
    // Punkty także daleko poza zajętym obszarem (do 4 km od niego).
    const x = X0 - 4000 + los() * 14000
    const y = Y0 - 4000 + los() * 14000
    const wzorzec = najblizszaLiniaLiniowo(linie, x, y)
    const wynik = indeks.najblizszy(x, y)
    assert.ok(Math.abs(wynik.metry - wzorzec) < 1e-6, `zapytanie ${q}: ${wynik.metry} ≠ ${wzorzec}`)
    const ograniczony = indeks.najblizszy(x, y, 500)
    if (wzorzec <= 500) assert.ok(Math.abs(ograniczony.metry - wzorzec) < 1e-6)
    else assert.equal(ograniczony, null)
  }
})

test('indeks odcinków: znacznik trafienia, pusty indeks i niepoprawne dane', () => {
  const indeks = new IndeksOdcinkow()
  assert.equal(indeks.najblizszy(X0, Y0), null)
  assert.equal(indeks.dodajLinie([[X0, Y0]], 'jeden punkt'), false)
  assert.equal(
    indeks.dodajLinie(
      [
        [X0, Y0],
        [X0 + 100, Y0],
      ],
      'droga',
    ),
    true,
  )
  assert.equal(
    indeks.dodajLinie(
      [
        [X0, Y0 + 500],
        [X0 + 100, Y0 + 500],
      ],
      'pas',
    ),
    true,
  )
  assert.equal(
    indeks.dodajLinie(
      [
        [X0, Number.NaN],
        [X0 + 1, Y0],
      ],
      'zepsuta',
    ),
    false,
  )
  assert.equal(indeks.najblizszy(Number.NaN, Y0), null)
  const blisko = indeks.najblizszy(X0 + 50, Y0 + 30)
  assert.equal(blisko.znacznik, 'droga')
  assert.equal(blisko.metry, 30)
  assert.equal(indeks.najblizszy(X0 + 50, Y0 + 400).znacznik, 'pas')
  assert.equal(indeks.dlugosc, 200)
  assert.throws(() => new IndeksOdcinkow(1), /10 m/)
})

test('rodzaje ZTP: infrastruktura wydzielona wchodzi, pozwolenia znakowe i chodniki nie', () => {
  for (const r of ['droga rowerowa', 'ciąg pieszo-rowerowy', 'pas rowerowy', 'kontrapas'])
    assert.ok(rodzajMsip(r), r)
  assert.ok(rodzajMsip('inny') && rodzajMsip('przejazd'))
  assert.equal(rodzajMsip(' Droga rowerowa '), 'droga')
  for (const r of ['kontraruch', 'B-1 T22', 'chodnik dopuszczony do ruchu rowerowego', null, ''])
    assert.equal(rodzajMsip(r), null, String(r))
})

test('linie ZTP: odsiewa rodzaje, brak geometrii i punkty poza Krakowem, zrzuca wysokość', () => {
  const ok = (rodzaj, paths) => ({ attributes: { rodzaj }, geometry: { paths } })
  const wynik = linieMsip([
    ok('droga rowerowa', [
      [
        [X0, Y0, 210],
        [X0 + 10, Y0 + 5, 211],
      ],
      [
        [X0 + 100, Y0],
        [X0 + 120, Y0],
      ],
    ]),
    ok('kontraruch', [
      [
        [X0, Y0],
        [X0 + 1, Y0],
      ],
    ]),
    { attributes: { rodzaj: 'pas rowerowy' }, geometry: null },
    ok('pas rowerowy', [
      [
        [X0, Y0],
        [9_000_000, Y0],
      ],
    ]),
  ])
  assert.equal(wynik.linie.length, 2)
  assert.deepEqual(wynik.linie[0].punkty, [
    [X0, Y0],
    [X0 + 10, Y0 + 5],
  ])
  assert.equal(wynik.pominiete.get('kontraruch'), 1)
  assert.equal(wynik.bezGeometrii, 1)
  assert.equal(wynik.poZasiegu, 1)
})

test('stojaki ZTP: tylko rowerowe, brak liczby to 1, promień 300 m liczony w metrach', () => {
  const stojak = (typ, liczba, dx, dy = 0) => ({
    attributes: { typ, liczba },
    geometry: { x: X0 + dx, y: Y0 + dy },
  })
  const { punkty, pominiete, bezLiczby } = stojakiMsip([
    stojak('stojak rowerowy', 4, 100),
    stojak('stojak rowerowy listwa', 2, 0, 299),
    stojak('stojak rowerowy', null, 0, -250),
    stojak('stojak rowerowy', 10, 301),
    stojak('stojak na hulajnogi', 7, 10),
    stojak('uzupełnienie uszkodzonego stojaka', 1, 10),
  ])
  assert.equal(punkty.length, 4)
  assert.equal(bezLiczby, 1)
  assert.equal(pominiete.get('stojak na hulajnogi'), 1)
  assert.equal(liczbaStojakow(0), 1)
  assert.equal(liczbaStojakow(undefined), 1)
  assert.equal(liczbaStojakow(3), 3)
  const indeks = indeksStojakow(punkty)
  // 4 + 2 + 1 (brak liczby) w promieniu; stojak o 301 m i hulajnogi poza sumą.
  assert.equal(stojakiWPromieniu(indeks, X0, Y0), 7)
  assert.equal(stojakiWPromieniu(indeks, X0 + 2000, Y0), 0)
})

test('Park and Ride: parsowanie i najbliższy punkt', () => {
  const parkingi = parkingiPrMsip([
    {
      attributes: { objectid: 1, nazwa: 'P+R A', m_ogolem: 100, m_elektryczne: 2 },
      geometry: { x: X0, y: Y0 },
    },
    { attributes: { objectid: 2, nazwa: ' ', m_ogolem: null }, geometry: { x: X0 + 3000, y: Y0 } },
    { attributes: { objectid: 3, nazwa: 'poza' }, geometry: { x: 1, y: 1 } },
    { attributes: { objectid: 4, nazwa: 'bez geometrii' }, geometry: null },
  ])
  assert.deepEqual(
    parkingi.map((p) => p.nazwa),
    ['P+R A', 'P+R 2'],
  )
  const n = najblizszyPunkt(parkingi, X0 + 2000, Y0 + 0)
  assert.equal(n.punkt.nazwa, 'P+R 2')
  assert.equal(n.metry, 1000)
  assert.equal(najblizszyPunkt([], X0, Y0), null)
})

test('rodzaje OSM: cykleway, ścieżki wspólne i pasy; bez shared_lane i obiektów nieaktywnych', () => {
  assert.equal(rodzajOsm({ highway: 'cycleway' }), 'droga')
  assert.equal(rodzajOsm({ highway: 'cycleway', bicycle: 'no' }), null)
  assert.equal(rodzajOsm({ highway: 'cycleway', access: 'private' }), null)
  assert.equal(
    rodzajOsm({ highway: 'cycleway', access: 'private', bicycle: 'designated' }),
    'droga',
  )
  assert.equal(rodzajOsm({ highway: 'construction', cycleway: 'lane' }), null)
  for (const h of ['path', 'footway', 'pedestrian'])
    assert.equal(rodzajOsm({ highway: h, bicycle: 'designated' }), 'ciag', h)
  assert.equal(rodzajOsm({ highway: 'path' }), null)
  assert.equal(rodzajOsm({ highway: 'track', bicycle: 'designated' }), null)
  assert.equal(rodzajOsm({ highway: 'residential', cycleway: 'lane' }), 'pas')
  assert.equal(rodzajOsm({ highway: 'tertiary', cycleway_right: 'track' }), 'pas')
  assert.equal(rodzajOsm({ highway: 'tertiary', cycleway_left: 'opposite_lane' }), 'pas')
  assert.equal(rodzajOsm({ highway: 'tertiary', cycleway_both: 'lane' }), 'pas')
  for (const v of ['shared_lane', 'shoulder', 'sidewalk', 'opposite', 'separate', 'no', 'crossing'])
    assert.equal(rodzajOsm({ highway: 'residential', cycleway: v }), null, v)
  assert.equal(rodzajOsm({}), null)
})

test('składanie linii OSM: odrzuca drogi bez rodzaju, poza ramką i bez węzłów', () => {
  const wezly = new Map([
    [1, [10, 10]],
    [2, [20, 10]],
    [3, [5000, 5000]],
    [4, [5100, 5000]],
    [5, [30, 30]],
  ])
  const bezZmian = (p) => p
  const wynik = zlozLinieOsm(
    [
      { id: 100, highway: 'cycleway', refs: [1, 2] },
      { id: 101, highway: 'cycleway', refs: [3, 4] },
      { id: 102, highway: 'residential', refs: [1, 2] },
      { id: 103, highway: 'cycleway', refs: [5, 999] },
      { id: 104, highway: 'path', bicycle: 'designated', refs: [2, 1, 5] },
    ],
    wezly,
    [0, 0, 100, 100],
    bezZmian,
  )
  assert.deepEqual(
    wynik.linie.map((l) => [l.id, l.rodzaj, l.punkty.length]),
    [
      [100, 'droga', 2],
      [104, 'ciag', 3],
    ],
  )
  assert.deepEqual(wynik.statystyka, {
    drogi: 5,
    bezRodzaju: 1,
    poRamce: 1,
    krotkie: 1,
    brakWezlow: 1,
  })
})

test('daty źródeł: import ZTP i stan ekstraktu OSM', () => {
  assert.equal(
    dataImportu([
      { attributes: { data_importu: '26/09/2026' } },
      { attributes: { data_importu: '01/10/2026' } },
      { attributes: { data_importu: 'x' } },
    ]),
    '2026-10-01',
  )
  assert.throws(() => dataImportu([{ attributes: {} }]), /data_importu/)
  assert.equal(dataPbf('/tmp/malopolskie-261002.osm.pbf'), '2026-10-02')
})

function wczytajPlik(id) {
  return JSON.parse(readFileSync(join(DANE, 'wskazniki', `${id}.json`), 'utf8'))
}

test('opublikowane wskaźniki: wersja adresów, zasięg i brak zer w miejscu braku danych', () => {
  const { wersja, adresy } = wczytajAdresy()
  const wKrakowie = adresy.map((a) => a.teryt === '1261011')
  const infra = wczytajPlik('rower_infrastruktura_odleglosc')
  const stojaki = wczytajPlik('stojaki_300m')
  const pr = wczytajPlik('pr_odleglosc')
  for (const p of [infra, stojaki, pr]) {
    assert.equal(p.wersjaAdresow, wersja)
    assert.equal(p.meta.zadanie, 119)
    assert.equal(p.meta.kategoria, 'transport')
    assert.equal(p.wartosci.length, adresy.length)
    assert.ok(p.wartosci.every((v) => v === null || (Number.isInteger(v) && v >= 0)))
  }
  // Infrastruktura: Kraków z ZTP, obwarzanek z OSM – każdy adres ma wartość w granicach zasięgu.
  assert.ok(infra.wartosci.every((v) => v !== null && v <= MAX_ODLEGLOSC))
  assert.ok(infra.meta.zrodla.some((z) => z.nazwa.includes('Portal MSIP Obserwatorium')))
  assert.ok(infra.meta.zrodla.some((z) => z.licencja.includes('ODbL')))
  // Stojaki i P+R: tylko Kraków (ewidencja ZTP); poza miastem null, nigdy 0.
  for (const p of [stojaki, pr])
    adresy.forEach((_, i) => assert.equal(p.wartosci[i] === null, !wKrakowie[i], `adres ${i}`))
  assert.equal(pr.meta.kierunek, 'neutralny')
  assert.equal(stojaki.meta.kierunek, 'wiecej-lepiej')
  assert.equal(infra.meta.kierunek, 'mniej-lepiej')
})
