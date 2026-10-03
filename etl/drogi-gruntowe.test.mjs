import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  DETAL,
  dataPbf,
  dojazd,
  drogaDojazdowaBdot,
  drogaDojazdowaOsm,
  etykietaOdcinka,
  KLASA,
  lamaneZWkb,
  MAX_DOJAZD,
  MIN_DLUGOSC,
  maskaAdresow,
  nawierzchniaBdot,
  nawierzchniaOsm,
  polaczSiec,
  RANGA,
  rangaBdot,
  rangaOsm,
  udzialGruntowych,
  ZRODLO,
} from './drogi-gruntowe.mjs'
import { SiecOdcinkow } from './lib/siec-drog.mjs'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'

// Współrzędne w metrach EPSG:2180 z okolic Krakowa – tak samo duże liczby jak w prawdziwych danych.
const X0 = 568_000
const Y0 = 243_000

const blisko = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`)

test('nawierzchnia z tagów OSM: surface, tracktype i klasa drogi', () => {
  const surface = (s, h = 'residential') => nawierzchniaOsm({ highway: h, surface: s })
  for (const [s, detal] of [
    ['asphalt', DETAL.ASFALT],
    ['concrete:plates', DETAL.BETON],
    ['paving_stones', DETAL.KOSTKA],
    ['sett', DETAL.BRUK],
    ['paved', DETAL.UTWARDZONA],
  ])
    assert.deepEqual(surface(s), { klasa: KLASA.UTWARDZONA, detal, zrodlo: ZRODLO.OSM_SURFACE }, s)
  for (const [s, detal] of [
    ['gravel', DETAL.ZWIR],
    ['compacted', DETAL.ZWIR],
    ['fine_gravel', DETAL.ZWIR],
    ['ground', DETAL.GRUNT],
    ['dirt', DETAL.GRUNT],
    ['unpaved', DETAL.GRUNT],
    ['grass', DETAL.GRUNT],
  ])
    assert.deepEqual(surface(s), { klasa: KLASA.GRUNTOWA, detal, zrodlo: ZRODLO.OSM_SURFACE }, s)

  // Wartość złożona rozstrzyga tylko, gdy wszystkie składniki dają tę samą klasę.
  assert.equal(surface('asphalt;paving_stones').klasa, KLASA.UTWARDZONA)
  assert.equal(surface('gravel; dirt').klasa, KLASA.GRUNTOWA)
  assert.equal(surface('asphalt;gravel').klasa, KLASA.NIEZNANA)
  assert.equal(surface('asphlat').klasa, KLASA.NIEZNANA)
  // Niezrozumiałe surface nie jest zastępowane tracktype ani klasą drogi.
  assert.equal(
    nawierzchniaOsm({ highway: 'track', surface: 'xyz', tracktype: 'grade1' }).klasa,
    KLASA.NIEZNANA,
  )
  assert.equal(nawierzchniaOsm({ highway: 'primary', surface: 'xyz' }).klasa, KLASA.NIEZNANA)

  // Bez surface: tracktype, potem klasa drogi.
  assert.deepEqual(nawierzchniaOsm({ highway: 'track', tracktype: 'grade1' }), {
    klasa: KLASA.UTWARDZONA,
    detal: DETAL.UTWARDZONA,
    zrodlo: ZRODLO.OSM_TRACKTYPE,
  })
  assert.deepEqual(nawierzchniaOsm({ highway: 'track', tracktype: 'grade2' }), {
    klasa: KLASA.GRUNTOWA,
    detal: DETAL.ZWIR,
    zrodlo: ZRODLO.OSM_TRACKTYPE,
  })
  assert.equal(nawierzchniaOsm({ highway: 'track', tracktype: 'grade4' }).detal, DETAL.GRUNT)
  assert.deepEqual(nawierzchniaOsm({ highway: 'tertiary' }), {
    klasa: KLASA.UTWARDZONA,
    detal: DETAL.UTWARDZONA,
    zrodlo: ZRODLO.OSM_KLASA_DROGI,
  })
  assert.deepEqual(nawierzchniaOsm({ highway: 'track' }), {
    klasa: KLASA.GRUNTOWA,
    detal: DETAL.GRUNT,
    zrodlo: ZRODLO.OSM_KLASA_DROGI,
  })
  // Ulice osiedlowe bez tagu to nieznana nawierzchnia, nie zgadujemy asfaltu.
  for (const h of ['residential', 'unclassified', 'service', 'living_street'])
    assert.equal(nawierzchniaOsm({ highway: h }).klasa, KLASA.NIEZNANA, h)
})

test('nawierzchnia z materiału BDOT10k', () => {
  const utwardzone = {
    'masa bitumiczna': DETAL.ASFALT,
    beton: DETAL.BETON,
    'płyty betonowe': DETAL.BETON,
    'kostka prefabrykowana': DETAL.KOSTKA,
    'kostka kamienna': DETAL.BRUK,
    bruk: DETAL.BRUK,
  }
  for (const [m, detal] of Object.entries(utwardzone))
    assert.deepEqual(
      nawierzchniaBdot(m),
      { klasa: KLASA.UTWARDZONA, detal, zrodlo: ZRODLO.BDOT },
      m,
    )
  assert.equal(nawierzchniaBdot('grunt naturalny').klasa, KLASA.GRUNTOWA)
  assert.equal(nawierzchniaBdot('żwir').detal, DETAL.ZWIR)
  assert.equal(nawierzchniaBdot('tłuczeń').klasa, KLASA.GRUNTOWA)
  assert.equal(nawierzchniaBdot('  Masa Bitumiczna ').klasa, KLASA.UTWARDZONA)
  for (const m of ['inny', '', null, undefined, 'asfalt'])
    assert.equal(nawierzchniaBdot(m).klasa, KLASA.NIEZNANA, String(m))
})

test('które drogi OSM wchodzą do sieci', () => {
  const tak = (t) => assert.equal(drogaDojazdowaOsm(t), true, JSON.stringify(t))
  const nie = (t) => assert.equal(drogaDojazdowaOsm(t), false, JSON.stringify(t))
  for (const h of ['primary', 'tertiary', 'unclassified', 'residential', 'living_street', 'track'])
    tak({ highway: h })
  tak({ highway: 'service' })
  tak({ highway: 'service', service: 'alley' })
  tak({ highway: 'residential', access: 'private' })
  // Autostrady, ekspresówki, ścieżki, chodniki i obiekty w budowie to nie dojazd do domu.
  for (const h of ['motorway', 'trunk', 'footway', 'path', 'cycleway', 'steps', 'construction'])
    nie({ highway: h })
  nie({})
  for (const s of ['driveway', 'parking_aisle', 'drive-through', 'emergency_access'])
    nie({ highway: 'service', service: s })
  nie({ highway: 'residential', tunnel: 'yes' })
  nie({ highway: 'residential', access: 'no' })
  nie({ highway: 'track', motor_vehicle: 'no' })
  nie({ highway: 'residential', vehicle: 'no' })
  tak({ highway: 'residential', access: 'no', motor_vehicle: 'yes' })
})

test('które drogi BDOT10k wchodzą do sieci i jaką mają rangę', () => {
  const baza = { KAT_ISTNIE: 'eksploatowany', POLOZENIE: 'na powierzchni gruntu' }
  assert.equal(drogaDojazdowaBdot({ ...baza, KLASA_DROG: 'droga dojazdowa' }), true)
  assert.equal(drogaDojazdowaBdot({ ...baza, KLASA_DROG: 'droga wewnętrzna' }), true)
  assert.equal(drogaDojazdowaBdot({ ...baza, KLASA_DROG: 'autostrada' }), false)
  assert.equal(drogaDojazdowaBdot({ ...baza, KLASA_DROG: 'droga ekspresowa' }), false)
  assert.equal(drogaDojazdowaBdot({ ...baza, KAT_ISTNIE: 'w budowie' }), false)
  assert.equal(
    drogaDojazdowaBdot({ ...baza, POLOZENIE: 'ponad powierzchnią gruntu poziom 1' }),
    false,
  )
  assert.equal(drogaDojazdowaBdot({ ...baza, POLOZENIE: 'pod powierzchnią gruntu' }), false)

  for (const k of ['droga dojazdowa', 'droga lokalna', 'droga zbiorcza', 'droga główna'])
    assert.equal(rangaBdot(k), RANGA.ULICA, k)
  assert.equal(rangaBdot('droga wewnętrzna'), RANGA.WEWNETRZNA)
  assert.equal(rangaBdot(null), RANGA.WEWNETRZNA)
  for (const h of ['residential', 'unclassified', 'tertiary', 'living_street', 'primary'])
    assert.equal(rangaOsm(h), RANGA.ULICA, h)
  for (const h of ['service', 'track', undefined]) assert.equal(rangaOsm(h), RANGA.WEWNETRZNA)
})

test('etykieta odcinka podaje wynik, rodzaj drogi, nawierzchnię i źródło', () => {
  assert.equal(
    etykietaOdcinka(RANGA.ULICA, DETAL.ASFALT, ZRODLO.BDOT),
    'Dojazd utwardzony: ulica, asfalt (BDOT10k)',
  )
  assert.equal(
    etykietaOdcinka(RANGA.WEWNETRZNA, DETAL.ZWIR, ZRODLO.OSM_SURFACE),
    'Dojazd gruntowy: droga wewnętrzna lub polna, żwir lub tłuczeń (OSM, tag surface)',
  )
  assert.equal(
    etykietaOdcinka(RANGA.ULICA, DETAL.GRUNT, ZRODLO.OSM_KLASA_DROGI),
    'Dojazd gruntowy: ulica, grunt (OSM, wnioskowane z klasy drogi)',
  )
  assert.equal(
    etykietaOdcinka(RANGA.ULICA, DETAL.NIEZNANY, ZRODLO.OSM_SURFACE),
    'Dojazd o nieznanej nawierzchni: ulica, nieznana nawierzchnia (OSM, tag surface)',
  )
})

// WKB małego i dużego endiana, ręcznie złożone (ISO WKB 2D).
function wkbLinia(punkty, little = true) {
  const b = Buffer.alloc(9 + punkty.length * 16)
  b.writeUInt8(little ? 1 : 0, 0)
  const u32 = (v, o) => (little ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o))
  const f64 = (v, o) => (little ? b.writeDoubleLE(v, o) : b.writeDoubleBE(v, o))
  u32(2, 1)
  u32(punkty.length, 5)
  punkty.forEach(([x, y], i) => {
    f64(x, 9 + i * 16)
    f64(y, 17 + i * 16)
  })
  return b
}

test('geometria z WKB: LineString, MultiLineString i nieobsługiwane typy', () => {
  const a = [
    [1.5, 2.5],
    [3, 4],
  ]
  const b = [
    [10, 20],
    [30, 40],
    [50, 60],
  ]
  assert.deepEqual(lamaneZWkb(wkbLinia(a)), [a])
  assert.deepEqual(lamaneZWkb(wkbLinia(a, false)), [a])
  const multi = Buffer.concat([Buffer.alloc(9), wkbLinia(a), wkbLinia(b)])
  multi.writeUInt8(1, 0)
  multi.writeUInt32LE(5, 1)
  multi.writeUInt32LE(2, 5)
  assert.deepEqual(lamaneZWkb(multi), [a, b])
  const wielokat = Buffer.alloc(9)
  wielokat.writeUInt8(1, 0)
  wielokat.writeUInt32LE(3, 1)
  assert.throws(() => lamaneZWkb(wielokat), /nieobsługiwany typ/)
  // Fragment bufora (jak z DuckDB) – przesunięcie względem początku ArrayBuffer musi działać.
  const duzy = Buffer.concat([Buffer.alloc(7), wkbLinia(a)])
  assert.deepEqual(lamaneZWkb(duzy.subarray(7)), [a])
})

test('maska okolicy adresów: obejmuje okolicę punktów, odcina resztę', () => {
  const maska = maskaAdresow(
    [
      [X0, Y0],
      [X0 + 5000, Y0],
    ],
    { promien: 400 },
  )
  assert.equal(maska(X0, Y0), true)
  assert.equal(maska(X0 + 300, Y0 - 300), true)
  assert.equal(maska(X0 + 5000 + 380, Y0), true)
  assert.equal(maska(X0 + 2500, Y0), false)
  assert.equal(maska(X0, Y0 + 1000), false)
  assert.equal(maska(X0 - 100_000, Y0), false)
})

// Odcinek poziomy y = Y0 + dy od x = X0 do X0 + dl, ze współrzędnymi jak w prawdziwych danych.
const pozioma = (dy, dl = 200, od = 0) => [
  [X0 + od, Y0 + dy],
  [X0 + od + dl, Y0 + dy],
]
const bdotLinia = (dy, material, klasaDrogi, dl, od) => ({
  punkty: pozioma(dy, dl, od),
  ...nawierzchniaBdot(material),
  ranga: rangaBdot(klasaDrogi),
})
const osmLinia = (dy, tagi, dl, od) => ({
  punkty: pozioma(dy, dl, od),
  ...nawierzchniaOsm(tagi),
  ranga: rangaOsm(tagi.highway),
})

test('łączenie sieci: jawny tag OSM nadpisuje BDOT10k, pokryte odcinki OSM nie dublują dróg', () => {
  const { siec, statystyki: st } = polaczSiec(
    [
      bdotLinia(0, 'grunt naturalny', 'droga wewnętrzna'), // A: OSM mówi, że to asfaltowa ulica
      bdotLinia(100, 'masa bitumiczna', 'droga lokalna'), // B: OSM bez jawnego tagu, klasa drogi
      bdotLinia(300, 'żwir', 'droga dojazdowa'), // E: OSM zgadza się
    ],
    [
      osmLinia(3, { highway: 'residential', surface: 'asphalt' }), // A'
      osmLinia(101, { highway: 'tertiary' }), // D, pokrywa B, klasa wnioskowana
      osmLinia(303, { highway: 'residential', surface: 'gravel' }), // E'
      osmLinia(600, { highway: 'residential' }), // C: nic go nie pokrywa, nieznana nawierzchnia
      osmLinia(900, { highway: 'track', tracktype: 'grade3' }, 200, 0), // F: poza BDOT10k
    ],
  )
  const wg = (predykat) => {
    const wynik = []
    for (let i = 0; i < siec.liczba; i++) if (predykat(i)) wynik.push(i)
    return wynik
  }
  const wDy = (i, dy) => Math.abs(siec.ay[i] - (Y0 + dy)) < 1
  // A: klasa i źródło z OSM, ranga ulicy (OSM nazywa ją residential, BDOT10k drogą wewnętrzną)
  for (const i of wg((k) => wDy(k, 0))) {
    assert.equal(siec.klasa[i], KLASA.UTWARDZONA)
    assert.equal(siec.zrodlo[i], ZRODLO.OSM_SURFACE)
    assert.equal(siec.detal[i], DETAL.ASFALT)
    assert.equal(siec.ranga[i], RANGA.ULICA)
    assert.ok(siec.wlasciciel[i] >= 0, 'odcinek pochodzi z BDOT10k')
  }
  // B: zostaje klasa z BDOT10k, bo OSM nie ma jawnego tagu
  for (const i of wg((k) => wDy(k, 100))) {
    assert.equal(siec.klasa[i], KLASA.UTWARDZONA)
    assert.equal(siec.zrodlo[i], ZRODLO.BDOT)
  }
  // E: zgodne – klasa gruntowa, źródło wskazuje OSM (jawny tag ma pierwszeństwo)
  for (const i of wg((k) => wDy(k, 300))) {
    assert.equal(siec.klasa[i], KLASA.GRUNTOWA)
    assert.equal(siec.zrodlo[i], ZRODLO.OSM_SURFACE)
  }
  // Odcinków OSM pokrytych przez BDOT10k (A', D, E') nie ma w sieci, samodzielne C i F są.
  assert.equal(wg((k) => siec.wlasciciel[k] < 0 && wDy(k, 3)).length, 0)
  assert.equal(wg((k) => siec.wlasciciel[k] < 0 && wDy(k, 101)).length, 0)
  const c = wg((k) => siec.wlasciciel[k] < 0 && wDy(k, 600))
  assert.ok(c.length > 0)
  assert.ok(c.every((k) => siec.klasa[k] === KLASA.NIEZNANA))
  const f = wg((k) => siec.wlasciciel[k] < 0 && wDy(k, 900))
  assert.ok(f.length > 0)
  assert.ok(
    f.every((k) => siec.klasa[k] === KLASA.GRUNTOWA && siec.zrodlo[k] === ZRODLO.OSM_TRACKTYPE),
  )
  // Statystyki: pokryte 3 z 5 odcinków OSM po 200 m, jawne tagi na A' i E', sprzeczny tylko A'.
  blisko(st.osmM, 1000)
  blisko(st.osmPokrytoM, 600)
  blisko(st.jawneM, 400)
  blisko(st.zgodneM, 200)
  blisko(st.sprzeczneM, 200)
  blisko(st.nadpisanoM, 200)
  assert.deepEqual([...st.konflikty], [['asfalt (OSM) → grunt (BDOT10k)', 200]])
})

test('łączenie sieci: odcinek prostopadły i odległy nie pokrywa drogi, maska odcina okolicę', () => {
  const prostopadly = {
    punkty: [
      [X0 + 100, Y0 - 100],
      [X0 + 100, Y0 + 100],
    ],
    ...nawierzchniaOsm({ highway: 'residential', surface: 'asphalt' }),
    ranga: RANGA.ULICA,
  }
  const odlegly = osmLinia(40, { highway: 'residential', surface: 'asphalt' }) // 40 m od BDOT10k
  const { siec, statystyki: st } = polaczSiec(
    [bdotLinia(0, 'grunt naturalny', 'droga wewnętrzna')],
    [prostopadly, odlegly],
  )
  blisko(st.osmPokrytoM, 0)
  assert.ok(siec.klasa.every((k, i) => (siec.wlasciciel[i] >= 0 ? k === KLASA.GRUNTOWA : true)))
  const poza = polaczSiec(
    [bdotLinia(0, 'grunt naturalny', 'droga wewnętrzna')],
    [osmLinia(900, { highway: 'residential', surface: 'asphalt' })],
    { wZasiegu: (_, y) => y < Y0 + 500 },
  )
  assert.equal(poza.statystyki.osmM, 0)
  assert.ok(poza.siec.wlasciciel.every((w) => w >= 0))
})

function siecReczna(linie) {
  const siec = new SiecOdcinkow()
  for (const l of linie)
    siec.dodajLinie(l.punkty, {
      klasa: l.klasa,
      detal: DETAL.ASFALT,
      zrodlo: ZRODLO.BDOT,
      ranga: l.ranga,
    })
  return siec.zbuduj()
}
const P = KLASA.UTWARDZONA
const G = KLASA.GRUNTOWA

test('flaga dojazdu: ulica w 50 m ma pierwszeństwo przed bliższym podjazdem', () => {
  const ulica = RANGA.ULICA
  const wew = RANGA.WEWNETRZNA
  // Podjazd gruntowy 10 m od adresu, utwardzona ulica 40 m: dojazd utwardzony.
  let siec = siecReczna([
    { punkty: pozioma(10), klasa: G, ranga: wew },
    { punkty: pozioma(40), klasa: P, ranga: ulica },
  ])
  const przez = dojazd(siec, X0 + 100, Y0)
  assert.equal(przez.wartosc, 1)
  blisko(przez.odleglosc, 40)
  // Ulica 60 m dalej niż promień ulicy: liczy się najbliższa droga w ogóle (podjazd gruntowy).
  siec = siecReczna([
    { punkty: pozioma(10), klasa: G, ranga: wew },
    { punkty: pozioma(60), klasa: P, ranga: ulica },
  ])
  const d = dojazd(siec, X0 + 100, Y0)
  assert.equal(d.wartosc, 0)
  blisko(d.odleglosc, 10)
  // Gruntowa ulica w 30 m wygrywa z utwardzonym podjazdem w 5 m.
  siec = siecReczna([
    { punkty: pozioma(5), klasa: P, ranga: wew },
    { punkty: pozioma(30), klasa: G, ranga: ulica },
  ])
  assert.equal(dojazd(siec, X0 + 100, Y0).wartosc, 0)
  // Nieznana nawierzchnia najbliższej ulicy: null, bez zgadywania po dalszej drodze.
  siec = siecReczna([
    { punkty: pozioma(10), klasa: KLASA.NIEZNANA, ranga: ulica },
    { punkty: pozioma(20), klasa: P, ranga: wew },
  ])
  const nieznana = dojazd(siec, X0 + 100, Y0)
  assert.equal(nieznana.wartosc, null)
  assert.ok(nieznana.odcinek >= 0)
  // Brak drogi w zasięgu: null; droga tuż za granicą MAX_DOJAZD też nie liczy się.
  siec = siecReczna([{ punkty: pozioma(MAX_DOJAZD + 1), klasa: P, ranga: ulica }])
  assert.deepEqual(dojazd(siec, X0 + 100, Y0), { wartosc: null, odcinek: -1, odleglosc: null })
  siec = siecReczna([{ punkty: pozioma(MAX_DOJAZD - 1), klasa: P, ranga: wew }])
  assert.equal(dojazd(siec, X0 + 100, Y0).wartosc, 1)
})

test('udział dróg gruntowych w 300 m: długość obcięta do koła, nieznane pomijane', () => {
  const dlugie = (dy, klasa) => ({ punkty: pozioma(dy, 2000, -1000), klasa, ranga: RANGA.ULICA })
  // Utwardzona przez środek koła (600 m) i gruntowa 150 m od środka (cięciwa 2·√(300² − 150²)).
  const siec = siecReczna([
    dlugie(0, P),
    dlugie(150, G),
    dlugie(400, G),
    dlugie(-100, KLASA.NIEZNANA),
  ])
  const cieciwa = 2 * Math.sqrt(300 * 300 - 150 * 150)
  blisko(udzialGruntowych(siec, X0, Y0), (100 * cieciwa) / (600 + cieciwa))
  // Same drogi gruntowe: 100%, same utwardzone: 0%.
  blisko(udzialGruntowych(siecReczna([dlugie(0, G)]), X0, Y0), 100)
  blisko(udzialGruntowych(siecReczna([dlugie(0, P)]), X0, Y0), 0)
  // Za mało dróg o znanej nawierzchni: brak danych, nie 0.
  const krotka = siecReczna([
    {
      punkty: [
        [X0 - MIN_DLUGOSC / 4, Y0],
        [X0 + MIN_DLUGOSC / 4, Y0],
      ],
      klasa: G,
      ranga: 1,
    },
  ])
  assert.equal(udzialGruntowych(krotka, X0, Y0), null)
  assert.equal(udzialGruntowych(siecReczna([dlugie(0, KLASA.NIEZNANA)]), X0, Y0), null)
  assert.equal(udzialGruntowych(new SiecOdcinkow().zbuduj(), X0, Y0), null)
})

test('data stanu ekstraktu OSM z nazwy pliku', () => {
  assert.equal(dataPbf('/tmp/malopolskie-261002.osm.pbf'), '2026-10-02')
  assert.equal(dataPbf('C:\\x\\malopolskie-251231.osm.pbf'), '2025-12-31')
})

function wczytajPlik(id) {
  return JSON.parse(readFileSync(join(DANE, 'wskazniki', `${id}.json`), 'utf8'))
}

test('opublikowane wskaźniki: wersja adresów, zakres wartości i słownik etykiet', () => {
  const { wersja, adresy } = wczytajAdresy()
  const flaga = wczytajPlik('dojazd_utwardzony')
  const udzial = wczytajPlik('drogi_gruntowe_300m')
  for (const p of [flaga, udzial]) {
    assert.equal(p.wersjaAdresow, wersja)
    assert.equal(p.meta.zadanie, 73)
    assert.equal(p.meta.kategoria, 'transport')
    assert.equal(p.meta.rozdzielczosc, 'adres')
    assert.equal(p.wartosci.length, adresy.length)
    assert.ok(
      p.meta.zrodla.some((z) => z.nazwa.includes('BDOT10k') && z.licencja.includes('GUGiK')),
    )
    assert.ok(p.meta.zrodla.some((z) => z.licencja.includes('ODbL')))
    assert.ok(p.meta.zrodla.every((z) => z.dataDanych && z.pobrano && z.url.startsWith('https://')))
    assert.ok(!p.meta.opis.includes('—'), 'w opisie nie ma pauzy')
  }
  // Flaga: tylko 0, 1 albo null; etykieta jest dokładnie tam, gdzie jest wartość.
  assert.ok(flaga.wartosci.every((v) => v === null || v === 0 || v === 1))
  assert.equal(flaga.meta.kierunek, 'wiecej-lepiej')
  flaga.wartosci.forEach((v, i) => {
    assert.equal(flaga.etykiety[i] === null, v === null, `adres ${i}`)
    if (v !== null) assert.ok(flaga.slownikEtykiet[flaga.etykiety[i]], `adres ${i}`)
  })
  // Udział: procent 0–100, brak danych tylko jako null.
  assert.ok(udzial.wartosci.every((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 100)))
  assert.equal(udzial.meta.kierunek, 'mniej-lepiej')
  // Dla Krakowa i obwarzanka warstwa ma pokrycie, a gminy się różnią (po to jest warstwa).
  const sredni = (filtr) => {
    const w = udzial.wartosci.filter((v, i) => v !== null && filtr(adresy[i]))
    return w.reduce((s, v) => s + v, 0) / w.length
  }
  assert.ok(sredni((a) => a.teryt !== '1261011') > sredni((a) => a.teryt === '1261011') + 10)
  // Znane ulice: stare miasto i aleje Nowej Huty są utwardzone na każdym adresie; fragment ul. Rzepichy
  // to żwirowa ulica (BDOT10k: droga dojazdowa gminna, OSM: surface=gravel).
  const wartosc = (miejscowosc, ulica, nr) =>
    adresy
      .filter((a) => a.miejscowosc === miejscowosc && a.ulica === ulica && (!nr || a.nr === nr))
      .map((a) => flaga.wartosci[a.i])
  for (const ulica of ['Floriańska', 'Grodzka', 'Rynek Główny', 'Aleja Pokoju']) {
    const w = wartosc('Kraków', ulica).filter((v) => v !== null)
    assert.ok(w.length >= 40, `${ulica}: ${w.length} adresów z flagą`)
    assert.ok(
      w.every((v) => v === 1),
      ulica,
    )
  }
  assert.deepEqual(wartosc('Kraków', 'Rzepichy', '12'), [0])
  const pokrycie = flaga.wartosci.filter((v) => v !== null).length / adresy.length
  assert.ok(pokrycie > 0.95, `pokrycie flagi ${pokrycie}`)
})
