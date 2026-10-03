// Kontrola zgodności okolic z adresami (#185). Uruchom: node --test src/kontrakty/okolice.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { PlikAdresow } from './index.ts'
import { niezgodnoscOkolic, type PlikOkolic } from './okolice.ts'

const plik = (wersjaAdresow: string, wpisow: number) => ({
  wersjaAdresow,
  kolumny: { okolica: Array.from({ length: wpisow }, () => 0) },
})

describe('niezgodnoscOkolic', () => {
  it('ta sama wersja i długość: plik pasuje', () => {
    assert.equal(niezgodnoscOkolic(plik('abc', 5), 'abc', 5), null)
  })

  it('bez długości sprawdza samą wersję', () => {
    assert.equal(niezgodnoscOkolic(plik('abc', 5), 'abc'), null)
  })

  it('inna wersja adresów: plik nie pasuje, powód podaje obie wersje', () => {
    const powod = niezgodnoscOkolic(plik('stara', 5), 'nowa', 5)
    assert.match(powod ?? '', /stara/)
    assert.match(powod ?? '', /nowa/)
  })

  it('ta sama wersja, ale kolumna o innej długości: plik nie pasuje', () => {
    assert.match(niezgodnoscOkolic(plik('abc', 4), 'abc', 5) ?? '', /4 wpisów.*5/)
  })
})

describe('okolice.json na prawdziwych danych', () => {
  const czytaj = <T>(sciezka: string): T =>
    JSON.parse(readFileSync(new URL(`../../public/dane/${sciezka}`, import.meta.url), 'utf8'))
  const adresy = czytaj<PlikAdresow>('adresy.json')
  const okolice = czytaj<PlikOkolic>('okolice.json')

  it('pasuje do adresy.json: wersja i długość kolumny', () => {
    assert.equal(niezgodnoscOkolic(okolice, adresy.wersja, adresy.kolumny.id.length), null)
  })

  it('każdy indeks z kolumny wskazuje okolicę z pliku (null = brak danych, nie zero)', () => {
    const ostatni = okolice.idOkolic.length - 1
    for (const p of okolice.kolumny.okolica) {
      if (p === null) continue
      assert.ok(Number.isInteger(p) && p >= 0 && p <= ostatni, `indeks ${p}`)
      assert.ok(okolice.okolice[okolice.idOkolic[p] as string], `okolica pod indeksem ${p}`)
    }
  })

  it('liczba adresów w pliku zgadza się z kolumną (jednostki SIM i miejscowości)', () => {
    const licz = new Map<string, number>()
    for (const p of okolice.kolumny.okolica) {
      if (p === null) continue
      const id = okolice.idOkolic[p] as string
      licz.set(id, (licz.get(id) ?? 0) + 1)
    }
    for (const [id, o] of Object.entries(okolice.okolice)) {
      assert.equal(licz.get(id) ?? 0, o.liczbaAdresow, id)
    }
    assert.equal(Object.values(okolice.okolice).filter((o) => o.rodzaj === 'sim').length, 123)
  })
})
