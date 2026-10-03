import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  gestoscNaHa,
  heksyZObiektow,
  opisWskaznika,
  poleWielokata,
  przypiszHeksy,
  sprawdzZbior,
  wymagajPokrycia,
  zaokraglijGestosc,
  zbudujIndeksHeksow,
  znajdzHeks,
} from './gestosc-elud.mjs'

// Współrzędne jak w usłudze MSIP (EPSG:2178, miliony metrów), żeby test łapał też utratę dokładności.
const X0 = 7_414_537.59
const Y0 = 5_548_128.93
const APOTEMA = (100 * Math.sqrt(3)) / 2
const POLE_HEKSA = ((3 * Math.sqrt(3)) / 2) * 100 ** 2
// 2024-06-30 23:50 czasu polskiego (21:50 UTC) – tak usługa zapisuje na_dzien
const NA_DZIEN = Date.UTC(2024, 5, 30, 21, 50)

/** Zamknięty sześciokąt o płaskim wierzchu, od prawego wierzchołka, zgodnie z ruchem wskazówek zegara. */
function pierscienHeksu(cx, cy, bok = 100) {
  const wysokosc = (bok * Math.sqrt(3)) / 2
  const w = [
    [cx + bok, cy],
    [cx + bok / 2, cy - wysokosc],
    [cx - bok / 2, cy - wysokosc],
    [cx - bok, cy],
    [cx - bok / 2, cy + wysokosc],
    [cx + bok / 2, cy + wysokosc],
  ]
  return [...w, w[0]]
}

function heks(id, cx, cy, zameldowani, { bok, atrybuty, pierscienie } = {}) {
  return {
    attributes: {
      objectid: 1,
      grid_id: id,
      na_dzien_txt: '2024-06-30',
      na_dzien: NA_DZIEN,
      r_ogolem: zameldowani,
      ...atrybuty,
    },
    geometry: { rings: pierscienie ?? [pierscienHeksu(cx, cy, bok)] },
  }
}

const indeks = (obiekty) => zbudujIndeksHeksow(heksyZObiektow(obiekty).heksy)

// Obiekt w takim kształcie, w jakim zwraca go usługa (współrzędne zaokrąglone do 0,01 m).
const Z_USLUGI = {
  attributes: {
    objectid: 395516,
    grid_id: 'J-47',
    na_dzien_txt: '2024-06-30',
    na_dzien: 1719784200000,
    r_ogolem: 47,
    'st_area(shape)': 25980.765,
    'st_length(shape)': 600.0000333300611,
  },
  geometry: {
    rings: [
      [
        [7414637.59, 5548128.93],
        [7414587.59, 5548042.32],
        [7414487.59, 5548042.32],
        [7414437.59, 5548128.93],
        [7414487.59, 5548215.53],
        [7414587.59, 5548215.53],
        [7414637.59, 5548128.93],
      ],
    ],
  },
}

test('pole wielokąta: kwadrat i sześciokąt o boku 100 m, niezależnie od kierunku obiegu', () => {
  const kwadrat = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ]
  assert.equal(poleWielokata(kwadrat), 100)
  assert.equal(poleWielokata([...kwadrat].reverse()), 100)
  assert.ok(Math.abs(poleWielokata(pierscienHeksu(X0, Y0)) - POLE_HEKSA) < 1e-6)
})

test('gęstość: osoby na hektar z pola heksagonu, zaokrąglenie do 0,1', () => {
  assert.equal(gestoscNaHa(50, 10_000), 50)
  assert.equal(gestoscNaHa(5, 5_000), 10)
  assert.equal(zaokraglijGestosc(gestoscNaHa(1634, POLE_HEKSA)), 628.9) // najgęstszy heksagon w zbiorze
  assert.equal(zaokraglijGestosc(gestoscNaHa(47, POLE_HEKSA)), 18.1)
  assert.equal(zaokraglijGestosc(gestoscNaHa(3, POLE_HEKSA)), 1.2) // najmniejsza liczba w zbiorze
})

test('obiekt w kształcie zwracanym przez usługę MSIP: heksagon, data, pole, gęstość', () => {
  const { heksy, daty, suma, min, max } = heksyZObiektow([Z_USLUGI])
  const [h] = heksy
  assert.equal(h.id, 'J-47')
  assert.equal(h.zameldowani, 47)
  assert.deepEqual(daty, ['2024-06-30'])
  assert.deepEqual([suma, min, max], [47, 47, 47])
  // pole z zaokrąglonych do 0,01 m współrzędnych różni się od st_area(shape) o ok. 1 m²
  assert.ok(Math.abs(h.poleM2 - 25980.765) < 2)
  assert.ok(Math.abs(h.x - 7414537.59) < 0.01 && Math.abs(h.y - 5548128.93) < 0.01)
  assert.equal(zaokraglijGestosc(gestoscNaHa(h.zameldowani, h.poleM2)), 18.1)
})

test('kilka heksagonów: suma, najmniejsza i największa liczba, jedna data', () => {
  const { heksy, suma, min, max, daty } = heksyZObiektow([
    heks('A-1', X0, Y0, 3),
    heks('A-2', X0 + 150, Y0 + APOTEMA, 1634),
    heks('A-3', X0, Y0 + 2 * APOTEMA, 44),
  ])
  assert.equal(heksy.length, 3)
  assert.deepEqual([suma, min, max], [1681, 3, 1634])
  assert.deepEqual(daty, ['2024-06-30'])
  assert.ok(heksy.every((h) => h.pierscien instanceof Float64Array && h.pierscien.length === 14))
})

test('odrzuca dane, na których nie da się oprzeć opisu wskaźnika', () => {
  const rozciagniety = pierscienHeksu(X0, Y0).map(([x, y]) => [X0 + (x - X0) * 1.2, y])
  const przypadki = [
    ['pusta warstwa', [], /pusta/],
    ['powtórzony grid_id', [heks('A-1', X0, Y0, 10), heks('A-1', X0 + 500, Y0, 10)], /powtórzony/],
    ['brak grid_id', [heks('', X0, Y0, 10)], /grid_id/],
    ['liczba ułamkowa', [heks('A-1', X0, Y0, 3.5)], /r_ogolem/],
    ['liczba ujemna', [heks('A-1', X0, Y0, -1)], /r_ogolem/],
    ['liczba jako tekst', [heks('A-1', X0, Y0, '12')], /r_ogolem/],
    ['brak liczby', [heks('A-1', X0, Y0, null)], /r_ogolem/],
    [
      'dwa pierścienie',
      [
        heks('A-1', 0, 0, 5, {
          pierscienie: [pierscienHeksu(X0, Y0), pierscienHeksu(X0 + 500, Y0)],
        }),
      ],
      /jednego pierścienia/,
    ],
    [
      'pierścień niezamknięty',
      [heks('A-1', 0, 0, 5, { pierscienie: [pierscienHeksu(X0, Y0).slice(0, 6)] })],
      /7 punktach/,
    ],
    ['bok 50 m zamiast 100 m', [heks('A-1', X0, Y0, 5, { bok: 50 })], /regularny sześciokąt/],
    [
      'sześciokąt rozciągnięty o 20%',
      [heks('A-1', 0, 0, 5, { pierscienie: [rozciagniety] })],
      /regularny sześciokąt/,
    ],
    ['brak daty stanu', [heks('A-1', X0, Y0, 5, { atrybuty: { na_dzien: null } })], /na_dzien/],
    [
      'data niezgodna z zapisem tekstowym',
      [heks('A-1', X0, Y0, 5, { atrybuty: { na_dzien_txt: '2024-07-01' } })],
      /na_dzien_txt/,
    ],
  ]
  for (const [nazwa, obiekty, wzor] of przypadki)
    assert.throws(() => heksyZObiektow(obiekty), wzor, nazwa)
})

test('zbiór: jedna data stanu i brak heksagonów bez zameldowanych', () => {
  assert.doesNotThrow(() => sprawdzZbior({ daty: ['2024-06-30'], min: 3 }))
  assert.throws(() => sprawdzZbior({ daty: ['2024-06-30', '2024-12-31'], min: 3 }), /dat stanu/)
  assert.throws(() => sprawdzZbior({ daty: [], min: 3 }), /dat stanu/)
  // zero to poprawna liczba, więc parser go przepuszcza, a zatrzymuje dopiero ta kontrola
  const { min } = heksyZObiektow([heks('A-1', X0, Y0, 0)])
  assert.equal(min, 0)
  assert.throws(() => sprawdzZbior({ daty: ['2024-06-30'], min }), /bez zameldowanych/)
  // dwie różne daty w odpowiedzi usługi widać w wyniku parsera
  const { daty } = heksyZObiektow([
    heks('A-1', X0, Y0, 5),
    heks('A-2', X0 + 500, Y0, 5, {
      atrybuty: { na_dzien_txt: '2024-12-31', na_dzien: Date.UTC(2024, 11, 31, 12) },
    }),
  ])
  assert.deepEqual(daty, ['2024-06-30', '2024-12-31'])
  assert.throws(() => sprawdzZbior({ daty, min: 5 }), /dat stanu/)
})

test('punkt w heksagonie: środek, przy wierzchołku i krawędzi, tuż za brzegiem', () => {
  const ind = indeks([heks('A-1', X0, Y0, 10)])
  const id = (x, y) => znajdzHeks(ind, x, y)?.id ?? null
  assert.equal(id(X0, Y0), 'A-1')
  assert.equal(id(X0 + 99.9, Y0), 'A-1')
  assert.equal(id(X0 - 99.9, Y0), 'A-1')
  assert.equal(id(X0 + 100.1, Y0), null)
  assert.equal(id(X0, Y0 + APOTEMA - 0.1), 'A-1')
  assert.equal(id(X0, Y0 + APOTEMA + 0.1), null)
  // 89 m od środka, czyli wewnątrz okręgu opisanego (100 m), ale za ukośną krawędzią sześciokąta
  assert.equal(id(X0 + 80, Y0 + 40), null)
})

test('punkt w brakującym heksagonie nie dostaje wartości sąsiada', () => {
  const sam = indeks([heks('A-1', X0, Y0, 10)])
  // brakujący sąsiad leży nad A-1, a punkt jest 90 m od środka A-1, czyli bliżej niego niż czegokolwiek
  assert.equal(znajdzHeks(sam, X0, Y0 + 90), null)
  const zSasiadem = indeks([heks('A-1', X0, Y0, 10), heks('A-2', X0, Y0 + 2 * APOTEMA, 99)])
  assert.equal(znajdzHeks(zSasiadem, X0, Y0 + 90)?.id, 'A-2')
})

test('remis: ten sam obszar w dwóch heksagonach daje mniejszy id, niezależnie od kolejności', () => {
  const a = heks('B-2', X0, Y0, 10)
  const b = heks('A-1', X0, Y0, 20)
  assert.equal(znajdzHeks(indeks([a, b]), X0 + 10, Y0)?.id, 'A-1')
  assert.equal(znajdzHeks(indeks([b, a]), X0 + 10, Y0)?.id, 'A-1')
})

test('pełna siatka: punkt trafia do heksagonu o najbliższym środku', () => {
  const obiekty = []
  for (let c = 0; c < 6; c++)
    for (let r = 0; r < 6; r++)
      obiekty.push(
        heks(`H-${c}-${r}`, X0 + 150 * c, Y0 + 2 * APOTEMA * r + (c % 2 ? APOTEMA : 0), 10 + c + r),
      )
  const { heksy } = heksyZObiektow(obiekty)
  const ind = zbudujIndeksHeksow(heksy)
  // deterministyczny generator liczb pseudolosowych (LCG), żeby test był powtarzalny
  let ziarno = 12345
  const los = () => {
    ziarno = (ziarno * 1664525 + 1013904223) % 2 ** 32
    return ziarno / 2 ** 32
  }
  for (let n = 0; n < 2000; n++) {
    // wnętrze siatki: każdy sąsiad najbliższego środka istnieje
    const x = X0 + 150 + los() * 450
    const y = Y0 + 2 * APOTEMA + los() * 2 * APOTEMA * 4
    let najblizszy = heksy[0]
    for (const h of heksy)
      if (Math.hypot(h.x - x, h.y - y) < Math.hypot(najblizszy.x - x, najblizszy.y - y))
        najblizszy = h
    assert.equal(znajdzHeks(ind, x, y)?.id, najblizszy.id, `punkt ${x}, ${y}`)
  }
})

test('przypisanie: adres bez współrzędnych (poza Krakowem) i adres poza heksagonami dają null', () => {
  const ind = indeks([heks('A-1', X0, Y0, 10)])
  const wynik = przypiszHeksy([null, [X0, Y0], [X0 + 5000, Y0], null], ind)
  assert.deepEqual(
    wynik.map((h) => h?.id ?? null),
    [null, 'A-1', null, null],
  )
})

test('pokrycie Krakowa: poniżej 90% to błąd, np. pomylony układ współrzędnych', () => {
  assert.doesNotThrow(() => wymagajPokrycia(70217, 66790))
  assert.doesNotThrow(() => wymagajPokrycia(100, 90))
  assert.throws(() => wymagajPokrycia(100, 89), /89 z 100/)
  assert.throws(() => wymagajPokrycia(0, 0), /0 z 0/)
})

test('opis wskaźnika: data po polsku, liczby z danych, półpauza i brak pauzy', () => {
  const liczba = new Intl.NumberFormat('pl-PL')
  const opis = opisWskaznika({
    liczbaHeksow: 5831,
    suma: 701483,
    min: 3,
    dataDanych: '2024-06-30',
  })
  assert.match(opis, /na 30\.06\.2024;/)
  assert.ok(opis.includes(liczba.format(5831)))
  assert.ok(opis.includes(liczba.format(701483)))
  assert.match(opis, /to 3 \(/)
  assert.match(opis, /obwarzanka brak danych \(null, nie zero\)/)
  assert.ok(opis.includes('–'))
  // U+2014 zapisany kodem, żeby w źródle testu nie było znaku pauzy, której opis ma nie zawierać
  for (const zly of ['—', 'undefined', 'NaN']) assert.ok(!opis.includes(zly), zly)
  assert.match(
    opisWskaznika({ liczbaHeksow: 1, suma: 1, min: 5, dataDanych: '2025-01-31' }),
    /na 31\.01\.2025;.*to 5 \(/,
  )
})
