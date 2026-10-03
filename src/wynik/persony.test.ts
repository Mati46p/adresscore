// Uruchom: node --test src/wynik/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PERSONY, ustawieniaPersony } from './persony.ts'
import { czytajHash, zapiszHash } from './url.ts'

const manifest = [
  { id: 'halas_ldwn', kategoria: 'spokoj' },
  { id: 'inwestycje_500m', kategoria: 'przyszlosc' },
  { id: 'cena_m2_mediana', kategoria: 'kontekst' },
  { id: 'nowa_warstwa', kategoria: 'transport' },
] as const

describe('persony', () => {
  it('wagi w zakresie 0–4 dla każdej persony i trybu', () => {
    for (const p of PERSONY) {
      for (const tryb of ['kupuje', 'wynajmuje'] as const) {
        const { wagi } = ustawieniaPersony(p.id, tryb, manifest)
        for (const w of Object.values(wagi)) assert.ok(w >= 0 && w <= 4)
      }
    }
  })

  it('nieznane id z persony pomija, nowa warstwa dostaje wagę domyślną', () => {
    const { wagi } = ustawieniaPersony('rodzina', 'kupuje', manifest)
    assert.deepEqual(Object.keys(wagi).sort(), manifest.map((m) => m.id).sort())
    assert.equal(wagi.nowa_warstwa, 2)
  })

  it('kontekst zawsze 0, od zera wszędzie 0', () => {
    for (const p of PERSONY)
      assert.equal(ustawieniaPersony(p.id, 'kupuje', manifest).wagi.cena_m2_mediana, 0)
    const { wagi } = ustawieniaPersony('od-zera', 'wynajmuje', manifest)
    for (const w of Object.values(wagi)) assert.equal(w, 0)
  })

  it('tryb zmienia wagi przyszłości', () => {
    const k = ustawieniaPersony('inwestor', 'kupuje', manifest).wagi.inwestycje_500m ?? 0
    const w = ustawieniaPersony('inwestor', 'wynajmuje', manifest).wagi.inwestycje_500m ?? 0
    assert.ok(k > w)
  })

  it('persona podaje kierunek warstwy neutralnej', () => {
    assert.equal(
      ustawieniaPersony('inwestor', 'kupuje', manifest).kierunki.inwestycje_500m,
      'wiecej-lepiej',
    )
  })
})

describe('hash URL', () => {
  it('zapis i odczyt są odwracalne', () => {
    const s = {
      ekran: 'okolica' as const,
      idAdresu: 'PL.1/2 a',
      persona: 'senior' as const,
      tryb: 'wynajmuje' as const,
      porownanie: ['a', 'b'],
      ustawienia: null,
    }
    assert.deepEqual(czytajHash(zapiszHash(s)), s)
  })

  it('pusty i nieznany hash to Szukaj', () => {
    assert.equal(czytajHash('').ekran, 'szukaj')
    assert.equal(czytajHash('#/cos').ekran, 'szukaj')
    assert.equal(czytajHash('#/adres/').ekran, 'szukaj')
    assert.equal(czytajHash('#/?p=hacker').persona, null)
  })

  it('uszkodzony hash to Szukaj, nie wyjątek', () => {
    for (const h of ['#/adres/%', '#/adres/%E0%A4%A', '#/adres/%zz?p=senior']) {
      const s = czytajHash(h)
      assert.equal(s.ekran, 'szukaj', h)
      assert.equal(s.idAdresu, null, h)
    }
    assert.equal(czytajHash('#/adres/%zz?p=senior').persona, 'senior')
  })

  it('porównanie najwyżej 5', () => {
    assert.equal(czytajHash('#/porownanie?cmp=1,2,3,4,5,6,7').porownanie.length, 5)
  })

  it('zapisuje własne wagi i kierunki do linku', () => {
    const s = {
      ekran: 'porownanie' as const,
      idAdresu: null,
      persona: null,
      tryb: 'kupuje' as const,
      porownanie: ['a', 'b'],
      ustawienia: {
        wagi: { halas_ldwn: 4, zielen_udzial: 0 },
        kierunki: { halas_ldwn: 'mniej-lepiej' as const },
      },
    }
    assert.deepEqual(czytajHash(zapiszHash(s)), s)
  })

  it('odrzuca niepoprawne własne ustawienia', () => {
    for (const u of [
      '{',
      JSON.stringify({ v: 2, w: {}, k: {} }),
      JSON.stringify({ v: 1, w: { halas_ldwn: 9 }, k: {} }),
      JSON.stringify({ v: 1, w: {}, k: { halas_ldwn: 'nieznany' } }),
    ]) {
      assert.equal(czytajHash(`#/porownanie?u=${encodeURIComponent(u)}`).ustawienia, null)
    }
  })
})
