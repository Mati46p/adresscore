// Podpis źródeł rozkładu w panelu dojazdu (#223, F6). Uruchom: node --test src/karta/panel/zrodlaRozkladu.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { MIASTA } from '../../kontrakty/miasta.ts'
import { nazwaZrodlaRozkladu, opisZrodelRozkladu } from './zrodlaRozkladu.ts'

describe('nazwa źródła rozkładu', () => {
  it('zdejmuje nawiasy z wydawcą i wersją oraz końcówkę „– rozkład GTFS”', () => {
    assert.equal(
      nazwaZrodlaRozkladu(
        'ZTP Kraków GTFS A (Miejskie Przedsiębiorstwo Komunikacyjne S.A. w Krakowie; 20260930_20261005)',
      ),
      'ZTP Kraków GTFS A',
    )
    assert.equal(
      nazwaZrodlaRozkladu(
        'ZTM Gdańsk – rozkład GTFS (otwarty portal ckan.multimediagdansk.pl) (Zarząd Transportu Miejskiego w Gdańsku; bez wersji)',
      ),
      'ZTM Gdańsk',
    )
    assert.equal(
      nazwaZrodlaRozkladu(
        'ZTM Warszawa (rozkład GTFS przetworzony przez M. Kuranowskiego, mkuran.pl) (Mikołaj Kuranowski; 2026-10-04 00:15:58)',
      ),
      'ZTM Warszawa',
    )
  })

  it('nazwa bez nawiasów zostaje cała', () => {
    assert.equal(nazwaZrodlaRozkladu('MPK Wrocław'), 'MPK Wrocław')
  })

  it('powtórzone źródła podajemy raz', () => {
    assert.equal(
      opisZrodelRozkladu([
        { nazwa: 'ZTM X – rozkład GTFS (a)' },
        { nazwa: 'ZTM X – rozkład GTFS (b)' },
      ]),
      'ZTM X',
    )
  })
})

describe('źródła rozkładu w prawdziwych grafach miast', () => {
  const korzen = new URL('../../../public/dane/', import.meta.url)
  for (const m of MIASTA) {
    it(`${m.nazwa}: podpis jest niepusty, bez nawiasów i mówi o przewoźniku z grafu`, () => {
      const sciezka = new URL(
        m.katalog ? `${m.katalog}/dojazd/graf.json` : 'dojazd/graf.json',
        korzen,
      )
      const graf = JSON.parse(readFileSync(sciezka, 'utf8')) as { zrodla: { nazwa: string }[] }
      assert.ok(graf.zrodla.length > 0, 'graf ma źródła')
      const opis = opisZrodelRozkladu(graf.zrodla)
      assert.ok(opis.length > 0, 'podpis niepusty')
      assert.ok(!opis.includes('('), opis)
      assert.ok(!opis.includes('rozkład GTFS'), opis)
      // Każda krótka nazwa jest początkiem którejś pełnej nazwy z grafu (nic nie zostało wymyślone).
      for (const krotka of opis.split(', ')) {
        assert.ok(
          graf.zrodla.some((z) => z.nazwa.startsWith(krotka)),
          krotka,
        )
      }
    })
  }

  it('Kraków nadal nazywa swoich przewoźników, a inne miasta nie podają ich nazw', () => {
    const graf = (katalog: string) =>
      JSON.parse(readFileSync(new URL(`${katalog}dojazd/graf.json`, korzen), 'utf8')) as {
        zrodla: { nazwa: string }[]
      }
    assert.match(opisZrodelRozkladu(graf('').zrodla), /ZTP Kraków/)
    assert.ok(!/Krak/.test(opisZrodelRozkladu(graf('miasta/gdansk/').zrodla)))
    assert.match(opisZrodelRozkladu(graf('miasta/gdansk/').zrodla), /ZTM Gdańsk/)
  })
})
