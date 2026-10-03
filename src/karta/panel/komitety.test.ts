import assert from 'node:assert/strict'
import test from 'node:test'
import { krotkaNazwaKomitetu } from './komitety.ts'

test('siedem komitetów PKW ma różne czytelne podpisy, pełna nazwa pozostaje w metadanych', () => {
  const oficjalne = [
    'KOMITET WYBORCZY BEZPARTYJNI SAMORZĄDOWCY',
    'KOALICYJNY KOMITET WYBORCZY TRZECIA DROGA POLSKA 2050 SZYMONA HOŁOWNI - POLSKIE STRONNICTWO LUDOWE',
    'KOMITET WYBORCZY NOWA LEWICA',
    'KOMITET WYBORCZY PRAWO I SPRAWIEDLIWOŚĆ',
    'KOMITET WYBORCZY KONFEDERACJA WOLNOŚĆ I NIEPODLEGŁOŚĆ',
    'KOALICYJNY KOMITET WYBORCZY KOALICJA OBYWATELSKA PO .N IPL ZIELONI',
    'KOMITET WYBORCZY POLSKA JEST JEDNA',
  ]
  const podpisy = oficjalne.map((n) => krotkaNazwaKomitetu(`Sejm 2023 · ${n}`))
  assert.deepEqual(podpisy, [
    'Bezpartyjni Samorządowcy',
    'Trzecia Droga',
    'Nowa Lewica',
    'Prawo i Sprawiedliwość',
    'Konfederacja',
    'Koalicja Obywatelska',
    'Polska Jest Jedna',
  ])
  assert.equal(new Set(podpisy).size, 7)
  assert.equal(krotkaNazwaKomitetu('Sejm 2023 · NOWY KOMITET'), 'NOWY KOMITET')
})
