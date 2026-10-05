// Spójność wewnętrzna kontraktu klienta. Parytet z serwerem (api/_zdarzenie-kontrakt.js) pilnuje
// osobny test w api/. Uruchom: node --test "src/pomiar/*.test.ts"
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as kontrakt from './kontrakt.ts'

const listy = {
  TYPY: kontrakt.TYPY,
  URZADZENIA: kontrakt.URZADZENIA,
  NAZWY_PRODUKTOWE: kontrakt.NAZWY_PRODUKTOWE,
  RODZAJE_WYSZUKANIA: kontrakt.RODZAJE_WYSZUKANIA,
  METRYKI_WITAL: kontrakt.METRYKI_WITAL,
  KANALY_UDOSTEPNIENIA: kontrakt.KANALY_UDOSTEPNIENIA,
  CLICK_ID: kontrakt.CLICK_ID,
  RODZAJE_KLIKU: kontrakt.RODZAJE_KLIKU,
} as const

describe('kontrakt klienta', () => {
  it('listy są niepuste i bez duplikatów', () => {
    for (const [nazwa, lista] of Object.entries(listy)) {
      assert.ok(lista.length > 0, nazwa)
      assert.equal(new Set(lista).size, lista.length, `duplikat w ${nazwa}`)
    }
  })

  it('wartości kontraktu (zamknięte listy z endpoint-zdarzenie.md)', () => {
    assert.deepEqual(
      [...kontrakt.TYPY],
      ['odslona', 'wyjscie', 'klik', 'udostepnienie', 'produktowe', 'wital', 'blad'],
    )
    assert.deepEqual([...kontrakt.URZADZENIA], ['mobile', 'tablet', 'desktop', 'inne'])
    assert.deepEqual([...kontrakt.METRYKI_WITAL], ['lcp', 'inp', 'cls', 'fcp', 'ttfb'])
    assert.deepEqual([...kontrakt.CLICK_ID], ['gclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id'])
    assert.deepEqual(
      [...kontrakt.KANALY_UDOSTEPNIENIA],
      ['link', 'kopia', 'natywne', 'anulowano', 'blad'],
    )
    assert.deepEqual(
      [...kontrakt.RODZAJE_KLIKU],
      ['przycisk', 'link-wewn', 'link-zewn', 'zakladka', 'martwy', 'furia'],
    )
    assert.deepEqual(
      [...kontrakt.NAZWY_PRODUKTOWE],
      [
        'wyszukanie',
        'wyszukanie_bez_wyniku',
        'karta_adresu',
        'porownanie_dodaj',
        'warstwa_mapy',
        'tryb_biznes',
        'tryb_miasto',
        'udostepnij',
        'pomiar_wylaczony',
      ],
    )
  })

  it('każda nazwa produktowa ma wpis we właściwościach i odwrotnie', () => {
    assert.deepEqual(
      Object.keys(kontrakt.WLASCIWOSCI_PRODUKTOWE).sort(),
      [...kontrakt.NAZWY_PRODUKTOWE].sort(),
    )
  })

  it('właściwości: wskazane klucze z kontraktu, reszta pusta', () => {
    const w = kontrakt.WLASCIWOSCI_PRODUKTOWE
    assert.deepEqual([...w.wyszukanie], ['wynikow', 'rodzaj'])
    assert.deepEqual([...w.wyszukanie_bez_wyniku], ['fraza', 'odrzucono'])
    assert.deepEqual([...w.warstwa_mapy], ['warstwa'])
    assert.deepEqual([...w.udostepnij], ['element', 'kanal'])
    for (const nazwa of [
      'karta_adresu',
      'porownanie_dodaj',
      'tryb_biznes',
      'tryb_miasto',
      'pomiar_wylaczony',
    ] as const) {
      assert.deepEqual([...w[nazwa]], [], nazwa)
    }
    for (const klucze of Object.values(w)) {
      assert.ok(klucze.length <= kontrakt.MAX_WLASCIWOSCI)
      for (const klucz of klucze) assert.match(klucz, /^[a-z][a-z0-9_]*$/)
    }
  })

  it('limity z zadania: paczka 10, ciało 16 KB, 24 sekcje, 12 CTA, 30 min', () => {
    assert.equal(kontrakt.MAX_PACZKA, 10)
    assert.equal(kontrakt.LIMIT_CIALA, 16_384)
    assert.equal(kontrakt.MAX_SEKCJI, 24)
    assert.equal(kontrakt.MAX_CTA, 12)
    assert.equal(kontrakt.MAX_CZAS_MS, 1_800_000)
  })

  it('LIMITY zawiera dokładnie te same wartości co pojedyncze eksporty', () => {
    for (const [nazwa, wartosc] of Object.entries(kontrakt.LIMITY)) {
      assert.equal((kontrakt as Record<string, unknown>)[nazwa], wartosc, nazwa)
    }
    assert.ok(Object.keys(kontrakt.LIMITY).length >= 20)
  })

  it('wzorce: klucz sekcji, ekran, warstwa', () => {
    assert.ok(kontrakt.WZORZEC_SEKCJI.test('co-by-to-zmienilo'))
    assert.ok(kontrakt.WZORZEC_SEKCJI.test('a'.repeat(48)))
    assert.ok(!kontrakt.WZORZEC_SEKCJI.test('a'.repeat(49)))
    assert.ok(!kontrakt.WZORZEC_SEKCJI.test('Wielkie'))
    assert.ok(!kontrakt.WZORZEC_SEKCJI.test('ze§separatorem'))
    assert.ok(kontrakt.WZORZEC_EKRANU.test('okolica'))
    assert.ok(!kontrakt.WZORZEC_EKRANU.test('Okolica'))
    assert.ok(kontrakt.WZORZEC_WARSTWY.test('halas_ldwn'))
    assert.ok(!kontrakt.WZORZEC_WARSTWY.test('1halas'))
    assert.equal(kontrakt.SEPARATOR, '§')
  })
})
