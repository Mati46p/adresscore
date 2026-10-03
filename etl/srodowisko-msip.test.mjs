import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  czyAntenaStacji,
  dataZPolskiej,
  formaLiczby,
  klasaPrzewietrzania,
  klasaWPunkcie,
  lokalizacjeStacji,
  odcinkiZLinii,
  sprawdzLegende,
  zbudujSiatkeKlas,
} from './srodowisko-msip.mjs'

test('klasa przewietrzania wg legendy: granice należą do niższej klasy', () => {
  assert.equal(klasaPrzewietrzania(0.077), 1)
  assert.equal(klasaPrzewietrzania(1), 1)
  assert.equal(klasaPrzewietrzania(1.0001), 2)
  assert.equal(klasaPrzewietrzania(2), 2)
  assert.equal(klasaPrzewietrzania(2.809), 3)
  assert.equal(klasaPrzewietrzania(3), 3)
  assert.equal(klasaPrzewietrzania(3.0001), 4)
  assert.equal(klasaPrzewietrzania(4.257), 4)
})

test('klasa przewietrzania: brak liczby to null, nie klasa', () => {
  for (const v of [null, undefined, Number.NaN, '3', Number.POSITIVE_INFINITY])
    assert.equal(klasaPrzewietrzania(v), null)
})

test('odmiana rzeczownika po liczebniku: 1, 2–4, 5+, wyjątek 12–14', () => {
  const f = (n) => formaLiczby(n, 'palenisko', 'paleniska', 'palenisk')
  assert.equal(f(1), 'palenisko')
  for (const n of [2, 3, 4, 22, 23, 24, 64, 102, 862]) assert.equal(f(n), 'paleniska', String(n))
  for (const n of [0, 5, 11, 12, 13, 14, 15, 21, 25, 112, 114, 860, 45018])
    assert.equal(f(n), 'palenisk', String(n))
})

test('data z pola tekstowego ewidencji palenisk', () => {
  assert.equal(dataZPolskiej('28.02.2025'), '2025-02-28')
  assert.throws(() => dataZPolskiej('2025-02-28'), /format daty/)
})

test('radiolinie i anteny satelitarne nie są stacjami bazowymi, także z literówkami', () => {
  for (const typ of [
    'radiolinia',
    'Radiolinia ',
    'radilonia',
    'radolinia',
    'radiolina',
    'antena satelitarna',
  ])
    assert.equal(czyAntenaStacji(typ), false, typ)
  for (const typ of ['antena sektorowa', 'Antena sektorowa', 'System anten wewnętrznych', null])
    assert.equal(czyAntenaStacji(typ), true, String(typ))
})

test('lokalizacje stacji: sklejanie anten, radiolinie pominięte, punkty spoza okolic odrzucone', () => {
  const rekord = (typ, x, y) => ({
    attributes: { typ_emit: typ },
    geometry: { points: [[x, y]] },
  })
  const wynik = lokalizacjeStacji([
    rekord('antena sektorowa', 7_420_000, 5_545_000),
    rekord('antena sektorowa', 7_420_010, 5_545_000), // ten sam maszt
    rekord('radiolinia', 7_420_015, 5_545_000), // nie liczy się, nie łączy
    rekord('antena sektorowa', 7_420_500, 5_545_000), // inna lokalizacja
    rekord('radiolinia', 7_422_000, 5_545_000), // sama radiolinia – brak stacji
    rekord('antena sektorowa', 1, 1), // błędne współrzędne
  ])
  assert.equal(wynik.anten, 3)
  assert.equal(wynik.zlych, 1)
  assert.equal(wynik.lokalizacje.length, 2)
  const x = wynik.lokalizacje.map((l) => l[0]).sort((a, b) => a - b)
  assert.deepEqual(x, [7_420_005, 7_420_500])
})

test('odcinki z linii: kolejne pary wierzchołków każdej ścieżki', () => {
  const odcinki = odcinkiZLinii([
    {
      geometry: {
        paths: [
          [
            [0, 0],
            [3, 4],
            [3, 10],
          ],
          [
            [100, 100],
            [110, 100],
          ],
        ],
      },
    },
    { geometry: null },
  ])
  assert.deepEqual(odcinki, [
    [0, 0, 3, 4],
    [3, 4, 3, 10],
    [100, 100, 110, 100],
  ])
})

const zasieg = { xmin: 1000, ymin: 2000, xmax: 1300, ymax: 2200 }
const komorki = (wartosci) =>
  wartosci.flatMap((rzad, j) =>
    rzad.map((v, i) => ({ x_index: i + 1, y_index: j + 1, wentyl_v4m: v })),
  )

test('siatka klas: komórka z indeksów, brzegi i punkty poza siatką', () => {
  const siatka = zbudujSiatkeKlas(
    komorki([
      [0.5, 1.5, 2.5], // y_index 1 (południe)
      [3.5, 2.9, 0.9], // y_index 2
    ]),
    zasieg,
  )
  assert.equal(klasaWPunkcie(siatka, 1050, 2050), 1)
  assert.equal(klasaWPunkcie(siatka, 1150, 2050), 2)
  assert.equal(klasaWPunkcie(siatka, 1250, 2050), 3)
  assert.equal(klasaWPunkcie(siatka, 1050, 2150), 4)
  assert.equal(klasaWPunkcie(siatka, 1150, 2150), 3)
  assert.equal(klasaWPunkcie(siatka, 1250, 2150), 1)
  // lewy dolny róg należy do komórki 1|1, a krawędź prawa i górna – już poza siatką
  assert.equal(klasaWPunkcie(siatka, 1000, 2000), 1)
  assert.equal(klasaWPunkcie(siatka, 1300, 2050), null)
  assert.equal(klasaWPunkcie(siatka, 1050, 2200), null)
  assert.equal(klasaWPunkcie(siatka, 999.9, 2050), null)
})

test('siatka klas odrzuca dziurę, duplikat, zły bok i brak wartości', () => {
  const pelna = komorki([
    [0.5, 1.5, 2.5],
    [3.5, 2.9, 0.9],
  ])
  assert.throws(() => zbudujSiatkeKlas(pelna.slice(1), zasieg), /niekompletna/)
  assert.throws(
    () => zbudujSiatkeKlas([...pelna.slice(1), { ...pelna[1], wentyl_v4m: 1 }], zasieg),
    /duplikat/,
  )
  assert.throws(() => zbudujSiatkeKlas(pelna, { ...zasieg, xmax: 1330 }), /bok/)
  assert.throws(
    () =>
      zbudujSiatkeKlas(
        pelna.map((r, i) => (i === 0 ? { ...r, wentyl_v4m: null } : r)),
        zasieg,
      ),
    /brak wartości/,
  )
})

test('legenda warstwy anemologicznej: zmiana klas zatrzymuje liczenie', () => {
  const legenda = (pole, granice) => ({
    drawingInfo: {
      renderer: {
        type: 'classBreaks',
        field: pole,
        classBreakInfos: granice.map((classMaxValue) => ({ classMaxValue })),
      },
    },
  })
  assert.doesNotThrow(() => sprawdzLegende(legenda('wentyl_v4m', [1, 2, 3, 5])))
  assert.throws(() => sprawdzLegende(legenda('wentyl_v4m', [1, 2, 4, 5])), /Legenda/)
  assert.throws(() => sprawdzLegende(legenda('wentyl_v4m', [1, 2, 3])), /Legenda/)
  assert.throws(() => sprawdzLegende(legenda('inne_pole', [1, 2, 3, 5])), /Legenda/)
  assert.throws(() => sprawdzLegende({}), /Legenda/)
})
