// Filtr budżetu z cen RCN (#77). Uruchom: node --test src/wynik/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  filtrBudzetu,
  filtryZBudzetem,
  miesciSieWBudzecie,
  opisKwoty,
  WARSTWA_CENY,
} from './budzet.ts'
import { policzWykluczenia, type TwardyFiltr } from './filtry.ts'

describe('budżet z cen RCN', () => {
  const budzet = { kwota: 600_000, metraz: 50 }

  it('mediana × metraż porównana z kwotą, brak ceny to null (nigdy 0)', () => {
    assert.equal(miesciSieWBudzecie(12_000, budzet), true)
    assert.equal(miesciSieWBudzecie(12_001, budzet), false)
    assert.equal(miesciSieWBudzecie(null, budzet), null)
    assert.equal(miesciSieWBudzecie(Number.NaN, budzet), null)
  })

  it('filtr to maks. ceny m² = kwota / metraż; błędny budżet nie filtruje', () => {
    assert.deepEqual(filtrBudzetu(budzet), { id: WARSTWA_CENY, warunek: 'max', prog: 12_000 })
    assert.equal(filtrBudzetu(null), null)
    assert.equal(filtrBudzetu({ kwota: 600_000, metraz: 0 }), null)
  })

  it('wyklucza adresy poza budżetem, brak ceny zostaje jako „nie wiemy”', () => {
    const wartosci = [10_000, 15_000, null]
    const w = policzWykluczenia(
      [{ meta: { id: WARSTWA_CENY } as never, wartosci }],
      filtryZBudzetem([], budzet),
      3,
    )
    assert.deepEqual([...w.wykluczony], [0, 1, 0])
    assert.deepEqual([...w.niewiadomy], [0, 0, 1])
  })

  it('stabilna referencja dla tych samych wejść, budżet podmienia ręczny filtr ceny', () => {
    const filtry: TwardyFiltr[] = [{ id: WARSTWA_CENY, warunek: 'max', prog: 5000 }]
    const a = filtryZBudzetem(filtry, budzet)
    assert.equal(filtryZBudzetem(filtry, budzet), a)
    assert.deepEqual(a, [{ id: WARSTWA_CENY, warunek: 'max', prog: 12_000 }])
    assert.equal(filtryZBudzetem(filtry, null), filtry)
  })

  it('opis kwoty po polsku', () => {
    assert.equal(opisKwoty(700_000), '700 tys. zł')
    assert.equal(opisKwoty(1_250_000), '1,25 mln zł')
  })
})
