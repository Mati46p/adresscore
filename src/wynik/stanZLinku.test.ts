// Czysta logika „co stan bierze z linku” (#108): pola Biznesu i podmiana parametrów ekranu.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BEZ_FILTROW } from './biznesUslugi.ts'
import { PARAMETRY_EKRANU, polaBiznesuZLinku, zPodmienionymiParametrami } from './stanZLinku.ts'
import { czytajHash } from './url.ts'

const A = '19.940000,50.060000'
const C = '19.950000,50.070000'

describe('polaBiznesuZLinku', () => {
  it('link Biznesu daje branżę, punkty i filtry', () => {
    const pola = polaBiznesuZLinku(
      czytajHash(`#/biznes?b=restauracja&a=${A}&c=${C}&k=2z,-fast_food`),
    )
    assert.deepEqual(pola, {
      branza: 'restauracja',
      miejsca: [{ lon: 19.94, lat: 50.06 }, { lon: 19.95, lat: 50.07 }, null, null, null],
      filtryBiznesu: { min2Zrodla: true, flagi: { fast_food: 'bez' } },
    })
  })

  it('zapis m= i stare a=/c= dają miejsca A–E; gołe #/biznes to link do Biznesu z pustymi miejscami', () => {
    const zM = polaBiznesuZLinku(czytajHash(`#/biznes?b=apteka&m=${A};;${C}`))
    assert.deepEqual(zM?.miejsca, [
      { lon: 19.94, lat: 50.06 },
      null,
      { lon: 19.95, lat: 50.07 },
      null,
      null,
    ])
    assert.deepEqual(polaBiznesuZLinku(czytajHash('#/biznes')), {
      branza: 'sklep',
      miejsca: [null, null, null, null, null],
      filtryBiznesu: BEZ_FILTROW,
    })
  })

  it('inne ekrany nic nie mówią o Biznesie, więc nie kasują wyboru', () => {
    for (const hash of ['#/', '#/porownanie', '#/metoda', '#/katalog', '#/miasto', '#/symulator']) {
      assert.equal(polaBiznesuZLinku(czytajHash(hash)), null, hash)
    }
    // Parametry b/a/c/m na innym ekranie to nie branża i miejsca (np. wariant B symulatora).
    assert.equal(polaBiznesuZLinku(czytajHash(`#/porownanie?b=apteka&a=${A}&m=${A}`)), null)
  })
})

describe('zPodmienionymiParametrami', () => {
  const klucze = PARAMETRY_EKRANU.biznes ?? []

  it('podmienia tylko parametry ekranu, reszta zostaje bajt w bajt', () => {
    const obecny = `#/biznes?p=senior&u=%7B%22v%22%3A1%7D&b=apteka&a=${A}&cmp=x1,x2`
    const stan = `#/biznes?p=rodzina&b=kawiarnia&c=${C}&k=2z`
    assert.equal(
      zPodmienionymiParametrami(obecny, stan, klucze),
      `#/biznes?p=senior&u=%7B%22v%22%3A1%7D&cmp=x1,x2&b=kawiarnia&c=${C}&k=2z`,
    )
  })

  it('parametr, którego stan nie ma, znika z linku (usunięty punkt, wyłączony filtr)', () => {
    const obecny = `#/biznes?b=apteka&a=${A}&c=${C}&k=2z`
    assert.equal(
      zPodmienionymiParametrami(obecny, '#/biznes?b=apteka', klucze),
      '#/biznes?b=apteka',
    )
  })

  it('ścieżka zostaje z bieżącego linku, także stara #/symulator', () => {
    assert.equal(
      zPodmienionymiParametrami(
        '#/symulator?a=p:19.9,50.0',
        '#/miasto?a=p:19.9,50.1&b=s:19.8,50.1',
        ['a', 'b'],
      ),
      '#/symulator?a=p:19.9,50.1&b=s:19.8,50.1',
    )
  })

  it('bez zapytania po obu stronach nic się nie zmienia', () => {
    assert.equal(zPodmienionymiParametrami('#/biznes', '#/biznes', klucze), '#/biznes')
    assert.equal(zPodmienionymiParametrami('#/', '#/biznes?b=apteka', klucze), '#/?b=apteka')
  })

  it('parametr o podobnej nazwie nie jest podmieniany (cmp ≠ c)', () => {
    assert.equal(
      zPodmienionymiParametrami('#/biznes?cmp=x1&c=1,2', '#/biznes?c=3,4', klucze),
      '#/biznes?cmp=x1&c=3,4',
    )
  })

  it('własne parametry mają tylko ekrany, które ich potrzebują', () => {
    assert.deepEqual(Object.keys(PARAMETRY_EKRANU).sort(), ['biznes', 'symulator'])
    assert.deepEqual(PARAMETRY_EKRANU.symulator, ['a', 'b'])
  })
})
