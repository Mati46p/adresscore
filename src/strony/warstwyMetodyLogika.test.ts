// Uruchom: node --test src/strony/warstwyMetodyLogika.test.ts
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { IndeksKompaktu } from '../wynik/kompakt.ts'
import { warstwyZKompaktu, warstwyZPelnych } from './warstwyMetodyLogika.ts'

const meta = (id: string) => ({ id, nazwa: id }) as never

describe('warstwyZKompaktu', () => {
  const indeks = {
    wskazniki: { a: { pokrycie: { zDanymi: 3, wszystkich: 10 } } },
  } as unknown as IndeksKompaktu
  it('pokrycie z indeksu; warstwa pominięta jest niedostępna, bez zera', () => {
    const w = warstwyZKompaktu([meta('a'), meta('b')], indeks)
    assert.deepEqual(w[0]?.pokrycie, { zDanymi: 3, wszystkich: 10 })
    assert.equal(w[0]?.niedostepny, false)
    assert.equal(w[1]?.niedostepny, true)
    assert.equal(w[1]?.pokrycie.wszystkich, 0)
  })
  it('pełne dane: NaN to brak', () => {
    const [w] = warstwyZPelnych([
      {
        meta: meta('a'),
        wartosci: Float64Array.from([1, Number.NaN, Number.NaN, 0]),
        niedostepny: undefined,
      },
    ])
    assert.deepEqual(w?.pokrycie, { zDanymi: 2, wszystkich: 4 })
  })
})

const plik = new URL('../../public/dane/kompakt/indeks.json', import.meta.url)
describe('pokrycie z kompaktu == z pełnych danych (Kraków)', { skip: !existsSync(plik) }, () => {
  it('każda warstwa indeksu ma pokrycie zgodne z wartościami z wskazniki/<id>.json', () => {
    const ix = JSON.parse(readFileSync(plik, 'utf8')) as IndeksKompaktu
    for (const [id, w] of Object.entries(ix.wskazniki)) {
      const sciezka = new URL(`../../public/dane/wskazniki/${id}.json`, import.meta.url)
      if (!existsSync(sciezka)) continue
      const wartosci = (
        JSON.parse(readFileSync(sciezka, 'utf8')) as { wartosci: (number | null)[] }
      ).wartosci
      const [p] = warstwyZPelnych([
        {
          meta: meta(id),
          wartosci: Float64Array.from(wartosci, (v) => v ?? Number.NaN),
          niedostepny: undefined,
        },
      ])
      assert.deepEqual(w.pokrycie, p?.pokrycie, id)
    }
  })
})
