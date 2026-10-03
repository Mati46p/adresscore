import assert from 'node:assert/strict'
import test from 'node:test'
import { parsujOdpowiedz, parsujWkt, srodekIPole } from './uldk.mjs'

test('odpowiedź ULDK: wynik, brak działki i błąd usługi', () => {
  const ok = parsujOdpowiedz(
    '0\n121905_5.0016.290/22|SRID=2180;POLYGON((0 0,10 0,10 10,0 10,0 0))\n',
  )
  assert.equal(ok.wkt, 'POLYGON((0 0,10 0,10 10,0 10,0 0))')
  assert.deepEqual(parsujOdpowiedz('-1 brak wyników\nbłędny format odpowiedzi XML'), { brak: true })
  // awaria serwera powiatu udaje „brak wyników", ale nie wolno jej zapisać jako braku działki
  const awaria = parsujOdpowiedz(
    '-1 brak wyników\nusługa nie zwróciła odpowiedzi https://wms.powiat.krakow.pl:1518/iip/ows',
  )
  assert.equal(awaria.brak, undefined)
  assert.ok(awaria.blad)
  assert.match(parsujOdpowiedz('-1 Serwer katalogowy nie odpowiada\n').blad, /Serwer katalogowy/)
  assert.ok(parsujOdpowiedz('0\n').blad)
  assert.ok(parsujOdpowiedz('0\nid-bez-geometrii\n').blad)
  assert.equal(parsujOdpowiedz('').blad, 'pusta odpowiedź')
})

test('WKT: wielokąt z otworem i multipoligon', () => {
  const [p] = parsujWkt('POLYGON((0 0,10 0,10 10,0 10,0 0),(4 4,6 4,6 6,4 6,4 4))')
  assert.equal(p.length, 2)
  assert.deepEqual(p[0][2], [10, 10])
  const m = parsujWkt(
    'MULTIPOLYGON(((0 0,1 0,1 1,0 0)),((5 5,6 5,6 6,5 5),(5.1 5.1,5.2 5.1,5.2 5.2,5.1 5.1)))',
  )
  assert.equal(m.length, 2)
  assert.equal(m[1]?.length, 2)
  assert.throws(() => parsujWkt('POINT(1 2)'), /Nieobsługiwany WKT/)
  assert.throws(() => parsujWkt('POLYGON((0 0,a b,1 1,0 0))'), /Zła współrzędna/)
})

test('środek ciężkości i pole: orientacja pierścienia nie ma znaczenia, otwór odejmuje', () => {
  const ccw = srodekIPole(parsujWkt('POLYGON((0 0,10 0,10 10,0 10,0 0))'))
  const cw = srodekIPole(parsujWkt('POLYGON((0 0,0 10,10 10,10 0,0 0))'))
  for (const s of [ccw, cw]) {
    assert.equal(s?.pole, 100)
    assert.equal(s?.x, 5)
    assert.equal(s?.y, 5)
  }
  const zOtworem = srodekIPole(
    parsujWkt('POLYGON((0 0,10 0,10 10,0 10,0 0),(4 4,6 4,6 6,4 6,4 4))'),
  )
  assert.equal(zOtworem?.pole, 96)
  assert.ok(Math.abs((zOtworem?.x ?? 0) - 5) < 1e-9)
})

test('środek ciężkości sumy wielokątów jest ważony polem', () => {
  // kwadrat 10×10 w (0,0) i kwadrat 20×20 w (100,0): pole 100 + 400,
  // środek x = (100·5 + 400·110) / 500 = 89, y = (100·5 + 400·10) / 500 = 9
  const s = srodekIPole(
    parsujWkt('MULTIPOLYGON(((0 0,10 0,10 10,0 10,0 0)),((100 0,120 0,120 20,100 20,100 0)))'),
  )
  assert.equal(s?.pole, 500)
  assert.ok(Math.abs((s?.x ?? 0) - 89) < 1e-9)
  assert.ok(Math.abs((s?.y ?? 0) - 9) < 1e-9)
  assert.equal(srodekIPole(parsujWkt('POLYGON((0 0,5 0,10 0,0 0))')), null)
})
