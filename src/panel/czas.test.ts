// Doby warszawskie panelu: granica doby, zmiana czasu (DST) i uzupełnianie serii.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BRAK_DANYCH } from './arytmetyka.ts'
import {
  ciagDni,
  dzienTygodnia,
  dzienWarszawy,
  dzisWarszawy,
  etykietaDnia,
  formatGodziny,
  godzinaWarszawy,
  opisGodziny,
  pelnaDataDnia,
  przesunDzien,
} from './czas.ts'

describe('doba warszawska', () => {
  it('granica doby: 23:59:59 w Warszawie to jeszcze wczoraj, 00:00:00 to już dziś', () => {
    // Lato (CEST, UTC+2): północ w Warszawie to 22:00 UTC dnia poprzedniego.
    assert.equal(dzienWarszawy('2026-07-14T21:59:59Z'), '2026-07-14')
    assert.equal(dzienWarszawy('2026-07-14T22:00:00Z'), '2026-07-15')
    // Zima (CET, UTC+1): północ to 23:00 UTC.
    assert.equal(dzienWarszawy('2026-01-14T22:59:59Z'), '2026-01-14')
    assert.equal(dzienWarszawy('2026-01-14T23:00:00Z'), '2026-01-15')
  })

  it('dzień zmiany czasu 2026-10-25 (cofnięcie zegara): doba nie gubi ani nie dubluje godzin', () => {
    // 2026-10-24 22:00 UTC = 00:00 CEST 25.10; 2026-10-25 01:00 UTC = 02:00 CET (po cofnięciu).
    assert.equal(dzienWarszawy('2026-10-24T21:59:59Z'), '2026-10-24')
    assert.equal(dzienWarszawy('2026-10-24T22:00:00Z'), '2026-10-25')
    assert.equal(godzinaWarszawy('2026-10-25T00:30:00Z'), 2) // 02:30 CEST (pierwsze „2”)
    assert.equal(godzinaWarszawy('2026-10-25T01:30:00Z'), 2) // 02:30 CET (drugie „2”)
    // Doba 25-godzinna kończy się o 23:00 UTC 25.10 (północ CET), nie o 22:00.
    assert.equal(dzienWarszawy('2026-10-25T22:59:59Z'), '2026-10-25')
    assert.equal(dzienWarszawy('2026-10-25T23:00:00Z'), '2026-10-26')
  })

  it('godzina 0–23, północ to 0 (nie 24)', () => {
    assert.equal(godzinaWarszawy('2026-07-14T22:00:00Z'), 0)
    assert.equal(godzinaWarszawy('2026-07-14T21:00:00Z'), 23)
  })

  it('dzisWarszawy bierze strefę Warszawy, nie komputera', () => {
    assert.equal(dzisWarszawy(Date.parse('2026-07-14T22:30:00Z')), '2026-07-15')
    assert.equal(dzisWarszawy(new Date('2026-07-14T21:30:00Z')), '2026-07-14')
  })

  it('niepoprawna data → null / „brak danych”, nigdy wyjątek', () => {
    assert.equal(dzienWarszawy('to nie data'), null)
    assert.equal(godzinaWarszawy(Number.NaN), null)
    assert.equal(formatGodziny('x'), BRAK_DANYCH)
    assert.equal(formatGodziny(null), BRAK_DANYCH)
    assert.equal(formatGodziny(undefined), BRAK_DANYCH)
  })

  it('formatGodziny: HH:MM w Warszawie', () => {
    assert.equal(formatGodziny('2026-07-14T12:05:00Z'), '14:05')
    assert.equal(formatGodziny(Date.parse('2026-01-14T08:09:00Z')), '09:09')
  })
})

describe('podpisy dób i godzin', () => {
  it('etykietaDnia: DD.MM; tekst niebędący datą wraca bez zmian', () => {
    assert.equal(etykietaDnia('2026-10-05'), '05.10')
    assert.equal(etykietaDnia('2026-10-05T10'), '2026-10-05T10')
    assert.equal(etykietaDnia('(nieznany)'), '(nieznany)')
  })

  it('dzienTygodnia i pelnaDataDnia', () => {
    assert.equal(dzienTygodnia('2026-10-05'), 'pon.')
    assert.equal(pelnaDataDnia('2026-10-05'), 'pon. 05.10.2026')
    assert.equal(dzienTygodnia('nie data'), '')
    assert.equal(pelnaDataDnia('nie data'), 'nie data')
  })

  it('opisGodziny podaje zakres godziny, a nie punkt', () => {
    assert.equal(opisGodziny('2026-10-05T12:00:00Z'), 'pon. 05.10, 14:00–14:59')
  })
})

describe('opisGodziny w dobach zmiany czasu', () => {
  /** `ile` kolejnych godzin bezwzględnych od `start` (jak `generate_series` w bazie), ISO UTC. */
  const godziny = (start: string, ile: number) =>
    Array.from({ length: ile }, (_, i) => new Date(Date.parse(start) + i * 3_600_000).toISOString())

  it('doba 25-godzinna (2026-10-25): dwie godziny 02:00–02:59 mają różne podpisy', () => {
    // 22:00Z 24.10 = 00:00 CEST 25.10; doba kończy się o 23:00Z 25.10 (północ CET): 25 godzin.
    const doba = godziny('2026-10-24T22:00:00Z', 25)
    const podpisy = doba.map(opisGodziny)
    assert.equal(podpisy.length, 25)
    assert.equal(new Set(podpisy).size, 25, 'każda godzina doby ma inny podpis')
    assert.equal(opisGodziny('2026-10-25T00:00:00Z'), 'niedz. 25.10, 02:00–02:59 CEST')
    assert.equal(opisGodziny('2026-10-25T01:00:00Z'), 'niedz. 25.10, 02:00–02:59 CET')
  })

  it('doba 25-godzinna: dopisek strefy mają WYŁĄCZNIE dwie godziny, które by się powtórzyły', () => {
    const doba = godziny('2026-10-24T22:00:00Z', 25).map(opisGodziny)
    const zDopiskiem = doba.filter((p) => /\b(CEST|CET)$/.test(p))
    assert.deepEqual(zDopiskiem, [
      'niedz. 25.10, 02:00–02:59 CEST',
      'niedz. 25.10, 02:00–02:59 CET',
    ])
    // Godziny sąsiednie i pozostałe są takie jak zawsze: zakres bez skrótu strefy.
    assert.equal(opisGodziny('2026-10-24T22:00:00Z'), 'niedz. 25.10, 00:00–00:59')
    assert.equal(opisGodziny('2026-10-24T23:00:00Z'), 'niedz. 25.10, 01:00–01:59')
    assert.equal(opisGodziny('2026-10-25T02:00:00Z'), 'niedz. 25.10, 03:00–03:59')
    assert.equal(opisGodziny('2026-10-25T22:00:00Z'), 'niedz. 25.10, 23:00–23:59')
  })

  it('doba 23-godzinna (2026-03-29): godziny nie mają powtórzeń, więc żadna nie dostaje dopisku', () => {
    // 23:00Z 28.03 = 00:00 CET 29.03; doba kończy się o 22:00Z 29.03 (północ CEST): 23 godziny.
    const doba = godziny('2026-03-28T23:00:00Z', 23)
    const podpisy = doba.map(opisGodziny)
    assert.equal(new Set(podpisy).size, 23)
    assert.ok(
      podpisy.every((p) => !/\b(CEST|CET)$/.test(p)),
      'w dobie skróconej nie ma dopisków strefy',
    )
    // Godzina 02:00 nie istnieje: po 01:00–01:59 jest od razu 03:00–03:59.
    assert.equal(opisGodziny('2026-03-29T00:00:00Z'), 'niedz. 29.03, 01:00–01:59')
    assert.equal(opisGodziny('2026-03-29T01:00:00Z'), 'niedz. 29.03, 03:00–03:59')
    assert.ok(podpisy.every((p) => !p.includes('02:00')))
  })

  it('zwykła doba: 24 różne podpisy, zero dopisków (także lato i zima)', () => {
    for (const start of ['2026-07-14T22:00:00Z', '2026-01-14T23:00:00Z']) {
      const podpisy = godziny(start, 24).map(opisGodziny)
      assert.equal(new Set(podpisy).size, 24, start)
      assert.ok(
        podpisy.every((p) => !/\b(CEST|CET)$/.test(p)),
        start,
      )
    }
  })

  it('niepoprawna data wraca bez zmian', () => {
    assert.equal(opisGodziny('to nie data'), 'to nie data')
  })
})

describe('ciągi dób', () => {
  it('przesunDzien przechodzi przez miesiąc, rok i luty przestępny', () => {
    assert.equal(przesunDzien('2026-10-01', -1), '2026-09-30')
    assert.equal(przesunDzien('2026-01-01', -1), '2025-12-31')
    assert.equal(przesunDzien('2028-03-01', -1), '2028-02-29')
    assert.equal(przesunDzien('2026-10-25', 1), '2026-10-26')
  })

  it('ciagDni: ile kolejnych dób kończących się na koniec, rosnąco, także przez zmianę czasu', () => {
    assert.deepEqual(ciagDni('2026-10-26', 4), [
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ])
    assert.deepEqual(ciagDni('2026-10-05', 1), ['2026-10-05'])
    assert.equal(ciagDni('2026-10-05', 30).length, 30)
    assert.equal(ciagDni('2026-10-05', 30)[0], '2026-09-06')
  })

  it('ciagDni dla niepoprawnych argumentów daje pustą listę', () => {
    assert.deepEqual(ciagDni('nie data', 5), [])
    assert.deepEqual(ciagDni('2026-10-05', 0), [])
    assert.deepEqual(ciagDni('2026-10-05', -3), [])
  })
})
