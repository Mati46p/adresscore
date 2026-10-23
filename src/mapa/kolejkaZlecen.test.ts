// Kolejka zleceń workera geometrii. Uruchom: node --test src/mapa/kolejkaZlecen.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { KolejkaZlecen } from './kolejkaZlecen.ts'

describe('KolejkaZlecen', () => {
  it('wydaje wg priorytetu, przy remisie najstarsze', () => {
    const k = new KolejkaZlecen<string>()
    k.ustaw('tlo-r8', 4, 'a')
    k.ustaw('heksy-r8', 2, 'b')
    k.ustaw('heksy-r10', 0, 'c')
    k.ustaw('heksy-r9', 2, 'd')
    const kolej: string[] = []
    for (let n = k.nastepne(); n; n = k.nastepne()) kolej.push(n.klucz)
    assert.deepEqual(kolej, ['heksy-r10', 'heksy-r8', 'heksy-r9', 'tlo-r8'])
  })

  it('nowsze zlecenie tego samego klucza wyrzuca starsze, zanim worker je zacznie', () => {
    const k = new KolejkaZlecen<number>()
    k.ustaw('tlo-r9', 3, 1)
    k.ustaw('tlo-r9', 3, 2)
    assert.equal(k.rozmiar, 1)
    assert.equal(k.nastepne()?.zlecenie, 2)
    assert.equal(k.nastepne(), undefined)
  })
})
