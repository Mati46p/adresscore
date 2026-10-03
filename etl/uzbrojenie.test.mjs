import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import {
  BOK_PX,
  flagiKafla,
  jestWPromieniu,
  KAFEL_M,
  maskaPng,
  pikselWKaflu,
  urlGetMap,
  wybierzZakres,
  ZAPAS_M,
} from './uzbrojenie.mjs'

function fragment(typ, dane) {
  const b = Buffer.alloc(12 + dane.length)
  b.writeUInt32BE(dane.length, 0)
  b.write(typ, 4, 'latin1')
  dane.copy(b, 8)
  return b // CRC pomijamy – dekoder go nie sprawdza
}

/** PNG z paletą o zadanej głębi; indeksy: tablica wierszy; filtr 0 albo 1 (Sub, tylko 8 bit). */
function png(indeksy, glebia, paleta, trns, filtr = 0) {
  const wys = indeksy.length
  const szer = indeksy[0].length
  const linia = Math.ceil((szer * glebia) / 8)
  const surowe = Buffer.alloc((linia + 1) * wys)
  for (let y = 0; y < wys; y++) {
    surowe[y * (linia + 1)] = filtr
    const bajty = Buffer.alloc(linia)
    for (let x = 0; x < szer; x++) {
      const bit = x * glebia
      bajty[bit >> 3] |= indeksy[y][x] << (8 - glebia - (bit & 7))
    }
    for (let x = 0; x < linia; x++)
      surowe[y * (linia + 1) + 1 + x] =
        filtr === 1 ? (bajty[x] - (x > 0 ? bajty[x - 1] : 0)) & 255 : bajty[x]
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(szer, 0)
  ihdr.writeUInt32BE(wys, 4)
  ihdr[8] = glebia
  ihdr[9] = 3
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    fragment('IHDR', ihdr),
    fragment('PLTE', Buffer.alloc(paleta * 3)),
    ...(trns ? [fragment('tRNS', Buffer.from(trns))] : []),
    fragment('IDAT', deflateSync(surowe)),
    fragment('IEND', Buffer.alloc(0)),
  ])
}

test('maskaPng: pusty kafel KIUT (1 bit, jeden przezroczysty wpis) → pusta maska', () => {
  const m = maskaPng(
    png(
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
      1,
      1,
      [0],
    ),
  )
  assert.equal(m.szer, 3)
  assert.equal(m.wys, 2)
  assert.deepEqual([...m.maska], [0, 0, 0, 0, 0, 0])
})

test('maskaPng: 8 bit z filtrem Sub, krycie z tRNS, wygładzanie odrzucone', () => {
  // 0 – tło, 1 – krawędź wygładzona (krycie 3), 2 – linia (255), 3 – brak w tRNS (kryjący)
  const m = maskaPng(png([[0, 1, 2, 3]], 8, 4, [0, 3, 255], 1))
  assert.deepEqual([...m.maska], [0, 0, 1, 1])
})

test('maskaPng: odrzuca PNG, które nie jest paletowe', () => {
  const b = png([[0]], 8, 1, null)
  b[8 + 8 + 9] = 6 // typ koloru w IHDR → RGBA
  assert.throws(() => maskaPng(b), /Nieobsługiwany/)
  assert.throws(() => maskaPng(Buffer.from('<html>302</html>')), /To nie PNG/)
})

test('jestWPromieniu: koło, nie kwadrat', () => {
  const szer = 11
  const maska = new Uint8Array(szer * szer)
  maska[0] = 1 // róg (0,0), środek (5,5): odległość ≈ 7,07 px
  const m = { szer, wys: szer, maska }
  assert.equal(jestWPromieniu(m, 5, 5, 7), false)
  assert.equal(jestWPromieniu(m, 5, 5, 8), true)
})

test('kafel: zapas 50 m, oś północ-wschód w BBOX, piksel liczony od północy', () => {
  assert.equal(BOK_PX, 1050)
  const u = new URL(urlGetMap('przewod_gazowy', 283, 124))
  const [ymin, xmin, ymax, xmax] = u.searchParams.get('BBOX').split(',').map(Number)
  assert.deepEqual([xmin, ymin], [283 * KAFEL_M - ZAPAS_M, 124 * KAFEL_M - ZAPAS_M])
  assert.equal(xmax - xmin, KAFEL_M + 2 * ZAPAS_M)
  assert.equal(ymax - ymin, KAFEL_M + 2 * ZAPAS_M)
  assert.deepEqual(pikselWKaflu(283 * KAFEL_M, 125 * KAFEL_M, 283, 124), [25, 25])
})

test('flagiKafla: 1 w 50 m, 0 dalej, null gdy kafel nie ma żadnej sieci', () => {
  const pusta = () => ({ szer: BOK_PX, wys: BOK_PX, maska: new Uint8Array(BOK_PX * BOK_PX) })
  const gaz = pusta()
  const woda = pusta()
  // przewód gazowy w pikselu (100, 100) kafla 0_0
  gaz.maska[100 * BOK_PX + 100] = 1
  const x0 = -ZAPAS_M + 100 * 2 + 1
  const y0 = KAFEL_M + ZAPAS_M - 100 * 2 - 1
  const punkty = [
    [x0 + 40, y0], // 40 m – w zasięgu
    [x0 + 70, y0], // 70 m – poza
  ]
  assert.deepEqual(flagiKafla({ gaz, woda }, punkty, 0, 0), { gaz: [1, 0], woda: [0, 0] })
  assert.deepEqual(flagiKafla({ gaz: pusta(), woda: pusta() }, punkty, 0, 0), {
    gaz: [null, null],
    woda: [null, null],
  })
})

test('wybierzZakres: obwarzanek cały, z Krakowa tylko obrzeża do 1,5 km', () => {
  const adresy = [
    { i: 0, gmina: 'Zielonki' },
    { i: 1, gmina: 'Kraków' },
    { i: 2, gmina: 'Kraków' },
  ]
  const xy = [
    [0, 0],
    [1000, 0],
    [5000, 0],
  ]
  assert.deepEqual(wybierzZakres(adresy, xy), [0, 1])
})

test('flagiKafla: adres bez żadnej sieci w 250 m → null, nie 0', () => {
  const m = () => ({ szer: BOK_PX, wys: BOK_PX, maska: new Uint8Array(BOK_PX * BOK_PX) })
  const gaz = m()
  gaz.maska[10 * BOK_PX + 10] = 1 // róg kafla
  const daleko = [[KAFEL_M / 2, KAFEL_M / 2]] // ok. 1 km od jedynego piksela
  assert.deepEqual(flagiKafla({ gaz, woda: m() }, daleko, 0, 0), { gaz: [null], woda: [null] })
})
