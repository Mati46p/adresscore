import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { crc32 } from 'node:zlib'
import { zlibSync } from 'fflate'
import {
  doEpsg3035,
  KROK,
  kafle,
  kodWPikselu,
  najwyzszePasmoEea,
  odczytajKlasy,
  PASMA,
  pasmoEea,
  sprawdzKlasy,
  TERYT_KRAKOWA,
  wymien,
  zlozWskaznik,
} from './halas-obwarzanek.mjs'
import { dekodujPngSzary } from './lib/png.mjs'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'

// ── pasma i wybór najwyższego ────────────────────────────────────────────────────────────────

test('kody rastra EEA 1–5 dają pasma 5 dB, a liczba jest reprezentantem pasma', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((k) => pasmoEea(k).wartosc),
    [57.5, 62.5, 67.5, 72.5, 77.5],
  )
  assert.equal(pasmoEea(1).etykieta, '55–59,9 dB Lden (pasmo mapy EEA)')
  assert.equal(pasmoEea(5).etykieta, 'powyżej 75 dB Lden (pasmo mapy EEA)')
})

test('brak konturu i kody spoza 1–5 nie są zamieniane na zero ani na pasmo', () => {
  for (const kod of [0, 6, -1, 2.5, null, undefined, Number.NaN, '3'])
    assert.equal(pasmoEea(kod), null, String(kod))
  assert.equal(najwyzszePasmoEea([]), null)
  assert.equal(
    najwyzszePasmoEea([
      { rodzaj: 'drogowy', kod: 0 },
      { rodzaj: 'kolejowy', kod: null },
    ]),
    null,
  )
})

test('wybierane jest najwyższe pasmo, a etykieta nazywa jego źródło', () => {
  const p = najwyzszePasmoEea([
    { rodzaj: 'drogowy', kod: 3 },
    { rodzaj: 'kolejowy', kod: 4 },
    { rodzaj: 'przemysłowy', kod: null },
  ])
  assert.equal(p.wartosc, 72.5)
  assert.equal(p.etykieta, '70–74,9 dB Lden (pasmo mapy EEA); hałas kolejowy')
  assert.deepEqual(p.rodzaje, ['kolejowy'])
})

test('przy remisie etykieta wymienia wszystkie źródła z najwyższym pasmem', () => {
  const p = najwyzszePasmoEea([
    { rodzaj: 'drogowy', kod: 2 },
    { rodzaj: 'kolejowy', kod: 2 },
    { rodzaj: 'lotniczy', kod: 1 },
  ])
  assert.equal(p.etykieta, '60–64,9 dB Lden (pasmo mapy EEA); hałas drogowy i kolejowy')
  assert.equal(wymien([]), '')
  assert.equal(wymien(['a']), 'a')
  assert.equal(wymien(['a', 'b', 'c']), 'a, b i c')
})

// ── współrzędne, kafle i odczyt pikseli ──────────────────────────────────────────────────────

test('EPSG:3035: początek układu (10°E, 52°N) to fałszywe wschód i północ z definicji', () => {
  assert.deepEqual(doEpsg3035(10, 52), [4321000, 3210000])
  const [x, y] = doEpsg3035(19.890876, 50.047798) // ul. Księcia Józefa 101 w Krakowie
  assert.ok(Math.abs(x - 5027037.22) < 0.01 && Math.abs(y - 3040524.01) < 0.01, `${x}, ${y}`)
})

const kotwica = { x: 6.0197, y: 2.6956 }

test('kafle są wyrównane do siatki rastra, ciągłe i obejmują punkty z marginesem piksela', () => {
  const punkty = [
    [5010530.5, 3021970.2],
    [5060240.1, 3065190.9],
    [5035000, 3040000],
  ]
  const k = kafle(punkty, kotwica, 1500)
  assert.ok(k.length > 1)
  const calkowita = (v) => Math.abs(v - Math.round(v)) < 1e-6
  for (const t of k) {
    assert.ok(calkowita((t.x0 - kotwica.x) / KROK), 'x0 na siatce')
    assert.ok(calkowita((t.y0 - kotwica.y) / KROK), 'y0 na siatce')
    assert.equal(Math.round((t.x1 - t.x0) / KROK), t.szer)
    assert.equal(Math.round((t.y1 - t.y0) / KROK), t.wys)
    assert.ok(t.wys <= 1500)
  }
  for (let n = 1; n < k.length; n++) assert.equal(k[n].y1, k[n - 1].y0)
  assert.ok(k[0].x0 <= 5010530.5 - KROK && k[0].x1 >= 5060240.1 + KROK)
  assert.ok(k[0].y1 >= 3065190.9 + KROK && k[k.length - 1].y0 <= 3021970.2 - KROK)
  const rastry = k.map((t) => new Uint8Array(t.szer * t.wys))
  assert.equal(odczytajKlasy(punkty, k, rastry).size, 0)
})

test('kafle odrzucają puste dane i złe parametry', () => {
  assert.throws(() => kafle([], kotwica), /Brak punktów/)
  assert.throws(() => kafle([[1, 1]], kotwica, 0), /Wysokość kafla/)
  assert.throws(
    () =>
      kafle(
        [
          [0, 0],
          [200000, 0],
        ],
        kotwica,
      ),
    /szerszy niż/,
  )
})

test('piksel to komórka zawierająca punkt, wiersz 0 leży na północy kafla', () => {
  // Siatka w wielokrotnościach 10 m: kafle(…, 4) daje kafle 10 × 4 i 10 × 2 (y: 50…10 i 10…-10).
  const punkty = [
    [25, 35],
    [95, 5],
  ]
  const k = kafle(punkty, { x: 0, y: 0 }, 4)
  assert.deepEqual(
    k.map((t) => [t.x0, t.y0, t.x1, t.y1, t.szer, t.wys]),
    [
      [10, 10, 110, 50, 10, 4],
      [10, -10, 110, 10, 10, 2],
    ],
  )
  const rastry = k.map((t) => new Uint8Array(t.szer * t.wys))
  rastry[0][1 * 10 + 1] = 3 // kolumna (25-10)/10 = 1, wiersz (50-35)/10 = 1
  rastry[1][0 * 10 + 8] = 5 // kolumna (95-10)/10 = 8, wiersz (10-5)/10 = 0 w drugim kaflu
  const klasy = odczytajKlasy(punkty, k, rastry)
  assert.deepEqual(
    [...klasy],
    [
      [0, 3],
      [1, 5],
    ],
  )
  assert.equal(kodWPikselu(k[0], rastry[0], 25, 35), 3)
  assert.equal(kodWPikselu(k[0], rastry[0], 95, 5), null) // poza pierwszym kaflem
  assert.equal(kodWPikselu(k[0], rastry[0], 25, 30), 0) // brak konturu to 0, nie null
})

test('punkt poza wszystkimi kaflami przerywa odczyt zamiast dać brak konturu', () => {
  const k = kafle([[25, 35]], { x: 0, y: 0 })
  assert.throws(
    () => odczytajKlasy([[5000, 5000]], k, [new Uint8Array(k[0].szer * k[0].wys)]),
    /poza kaflami/,
  )
})

test('raster ma zawierać tylko 0 (NoData) i klasy 1–5', () => {
  assert.equal(sprawdzKlasy(Uint8Array.of(0, 0, 3, 5, 1)), 3)
  assert.throws(() => sprawdzKlasy(Uint8Array.of(0, 253)), /spoza 0–5/)
})

// ── dekoder PNG ──────────────────────────────────────────────────────────────────────────────

const SYGNATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(typ, dane) {
  const b = Buffer.alloc(12 + dane.length)
  b.writeUInt32BE(dane.length, 0)
  b.write(typ, 4, 'latin1')
  Buffer.from(dane).copy(b, 8)
  b.writeUInt32BE(crc32(b.subarray(4, 8 + dane.length)), 8 + dane.length)
  return b
}

const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Koduje PNG 8-bitowy (skala szarości) z filtrem wybieranym per wiersz – odwrotność dekodera. */
function zakodujPng(szer, wys, dane, filtrWiersza, opcje = {}) {
  const surowe = Buffer.alloc((szer + 1) * wys)
  for (let y = 0; y < wys; y++) {
    const f = filtrWiersza(y)
    surowe[y * (szer + 1)] = f
    for (let x = 0; x < szer; x++) {
      const v = dane[y * szer + x]
      const a = x > 0 ? dane[y * szer + x - 1] : 0
      const b = y > 0 ? dane[(y - 1) * szer + x] : 0
      const c = x > 0 && y > 0 ? dane[(y - 1) * szer + x - 1] : 0
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]
      surowe[y * (szer + 1) + 1 + x] = (v - pred) & 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(szer, 0)
  ihdr.writeUInt32BE(wys, 4)
  ihdr[8] = opcje.glebia ?? 8
  ihdr[9] = opcje.typ ?? 0
  ihdr[12] = opcje.przeplot ?? 0
  return Buffer.concat([
    SYGNATURA,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(surowe)),
    chunk('IEND', []),
  ])
}

const obraz = (szer, wys) =>
  Uint8Array.from(
    { length: szer * wys },
    (_, i) => ((i % szer) * 7 + Math.floor(i / szer) * 13) % 6,
  )

test('dekoder PNG odtwarza obraz dla każdego filtra PNG i dla filtrów mieszanych', () => {
  const dane = obraz(17, 9)
  for (const f of [0, 1, 2, 3, 4]) {
    const png = dekodujPngSzary(zakodujPng(17, 9, dane, () => f))
    assert.equal(png.szer, 17)
    assert.equal(png.wys, 9)
    assert.deepEqual([...png.dane], [...dane], `filtr ${f}`)
  }
  const mieszane = dekodujPngSzary(zakodujPng(17, 9, dane, (y) => y % 5))
  assert.deepEqual([...mieszane.dane], [...dane])
})

test('dekoder PNG odczytuje prawdziwy kafel z exportImage EEA (40×40, surowe klasy)', () => {
  // exportImage ImageServera NoiseContours_ind_lden, bbox ±200 m wokół punktu w Krakowie.
  const fixture =
    'iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAAAAACpleexAAAAAnRSTlMAAHaTzTgAAAC9SURBVDiNlVQBDsQgCGu5/7+Zy7KbilDHNVmmWEALSihwDj1OjzyYjLj5KGLKRMnjL+cFVxFvXoB1835aRPRtXqSuz8fScn3+TF3rdRt9LPpLZZidq4ArsuDHQi2gJHuIKHsOcY1NHbn8pjQPanl8abFMrCrgg89KheHikxHbjKL2SEckuG8OrInNiJC3zzZ7Six1VExDk8lXGzWxlMLEltJmTK50u2eHviTbXHV/sncOc0rdfB//ihgeHhBfxe4bXnRTcOgAAAAASUVORK5CYII='
  const png = dekodujPngSzary(Buffer.from(fixture, 'base64'))
  assert.equal(png.szer, 40)
  assert.equal(png.wys, 40)
  const licznik = [0, 0, 0, 0, 0, 0]
  for (const v of png.dane) licznik[v]++
  assert.deepEqual(licznik, [757, 538, 305, 0, 0, 0])
})

test('dekoder PNG odrzuca obrazy, których nie umie czytać, zamiast je zgadywać', () => {
  const dane = obraz(4, 4)
  assert.throws(() => dekodujPngSzary(Buffer.from('to nie jest png')), /To nie jest PNG/)
  assert.throws(
    () => dekodujPngSzary(zakodujPng(4, 4, dane, () => 0, { glebia: 16 })),
    /Nieobsługiwany PNG/,
  )
  assert.throws(
    () => dekodujPngSzary(zakodujPng(4, 4, dane, () => 0, { typ: 6 })),
    /Nieobsługiwany PNG/,
  )
  assert.throws(
    () => dekodujPngSzary(zakodujPng(4, 4, dane, () => 0, { przeplot: 1 })),
    /Nieobsługiwany PNG/,
  )
  const pelny = zakodujPng(4, 4, dane, () => 0)
  const bezDanych = Buffer.concat([SYGNATURA, pelny.subarray(8, 8 + 25), chunk('IEND', [])])
  assert.throws(() => dekodujPngSzary(bezDanych), /nieoczekiwana długość|zlib|invalid|unexpected/i)
})

// ── składanie wskaźnika ──────────────────────────────────────────────────────────────────────

test('Kraków i adresy bez konturu dostają null, nigdy 0', () => {
  const adresy = [
    { i: 0, teryt: TERYT_KRAKOWA },
    { i: 1, teryt: '1219053' },
    { i: 2, teryt: '1219053' },
    { i: 3, teryt: '1219053' },
    { i: 4, teryt: '1219053' },
  ]
  const probki = [
    new Map([
      [0, 5], // Kraków ma kontur w EEA, ale ma halas_ldwn – tu null
      [1, 3],
      [2, 1],
      [4, 2],
    ]),
    new Map([
      [1, 2],
      [4, 2],
    ]),
    new Map(),
    new Map(),
  ]
  const { wartosci, etykiety, rozklad } = zlozWskaznik(adresy, probki)
  assert.deepEqual(wartosci, [null, 67.5, 57.5, null, 62.5])
  assert.equal(etykiety[0], null)
  assert.equal(etykiety[1], '65–69,9 dB Lden (pasmo mapy EEA); hałas drogowy')
  assert.equal(etykiety[3], null)
  assert.equal(etykiety[4], '60–64,9 dB Lden (pasmo mapy EEA); hałas drogowy i kolejowy')
  assert.deepEqual(rozklad, [0, 1, 1, 1, 0, 0])
  assert.ok(!wartosci.includes(0))
})

// ── opublikowany wskaźnik ────────────────────────────────────────────────────────────────────

test('opublikowany wskaźnik: wersja adresów, Kraków pusty, pasma i etykiety spójne', () => {
  const { wersja, adresy } = wczytajAdresy()
  const tekst = readFileSync(join(DANE, 'wskazniki', 'halas_obwarzanek_lden.json'), 'utf8')
  const w = JSON.parse(tekst)
  assert.equal(w.wersjaAdresow, wersja, 'po zmianie adresów uruchom node etl/halas-obwarzanek.mjs')
  assert.equal(w.meta.id, 'halas_obwarzanek_lden')
  assert.equal(w.meta.zadanie, 114)
  assert.equal(w.wartosci.length, adresy.length)
  assert.equal(w.etykiety.length, adresy.length)
  const pauza = String.fromCharCode(0x2014) // kod znaku, żeby w pliku nie było samego znaku
  assert.ok(!tekst.includes(pauza), 'w polskim tekście półpauza, nie pauza')
  const dozwolone = new Map(PASMA.filter(Boolean).map((p) => [p.wartosc, p.etykieta]))
  let zWartoscia = 0
  let poza = 0
  for (const a of adresy) {
    const v = w.wartosci[a.i]
    const e = w.etykiety[a.i]
    if (a.teryt === TERYT_KRAKOWA) {
      assert.equal(v, null)
      assert.equal(e, null)
      continue
    }
    poza++
    if (v === null) {
      assert.equal(e, null)
      continue
    }
    zWartoscia++
    assert.ok(dozwolone.has(v), `wartość ${v}`)
    assert.ok(e.startsWith(`${dozwolone.get(v)}; hałas `), e)
  }
  // Odczyt, który nic nie zmierzył, albo taki, który zalał obwarzanek, to błąd.
  assert.ok(zWartoscia > 5000, `adresów z wartością: ${zWartoscia}`)
  assert.ok(zWartoscia / poza < 0.3, `udział: ${zWartoscia / poza}`)
})

test('opublikowany wskaźnik: znane miejsca przy drogach głównych i brak konturu na cichej wsi', () => {
  const { adresy } = wczytajAdresy()
  const w = JSON.parse(readFileSync(join(DANE, 'wskazniki', 'halas_obwarzanek_lden.json'), 'utf8'))
  const wartosc = (gmina, ulica, nr) => {
    const a = adresy.find((x) => x.gmina === gmina && x.ulica === ulica && x.nr === nr)
    assert.ok(a, `brak adresu ${gmina} ${ulica} ${nr}`)
    return w.wartosci[a.i]
  }
  assert.equal(wartosc('Zielonki', 'Krakowskie Przedmieście', '214'), 67.5) // DK94
  assert.equal(wartosc('Zabierzów', 'Krakowska', '59'), 72.5) // DK79
  assert.equal(wartosc('Wielka Wieś', 'Olkuska', '79'), 72.5) // DK94
  assert.equal(wartosc('Świątniki Górne', 'Bliska', '10'), null) // poza konturami
})
