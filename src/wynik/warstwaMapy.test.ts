// Inwarianty `ocenyMapy` (#223, F6). Uruchom: node --test src/wynik/warstwaMapy.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import { przygotujWskaznik } from './silnik.ts'
import { ocenyMapy } from './warstwaMapy.ts'

function wsk(m: Partial<WskaznikMeta> & Pick<WskaznikMeta, 'id'>, wartosci: (number | null)[]) {
  const meta: WskaznikMeta = {
    kategoria: 'spokoj',
    nazwa: m.id,
    opis: '',
    jednostka: '',
    kierunek: 'wiecej-lepiej',
    rozdzielczosc: 'adres',
    zrodla: [],
    zadanie: 0,
    zakres: [0, 100],
    ...m,
  }
  const plik: PlikWskaznika = { meta, wersjaAdresow: 'x', wartosci }
  return przygotujWskaznik(plik)
}

// Miasto: dwie warstwy z danymi, jedna kontekstowa (nigdy bez kierunku) i jedna neutralna, trzy adresy.
const zielen = wsk({ id: 'zielen' }, [100, 50, 0])
const sklep = wsk({ id: 'sklep', kategoria: 'codziennosc' }, [100, 100, null])
const cena = wsk({ id: 'cena', kategoria: 'kontekst', kierunek: 'neutralny' }, [1, 2, 3])
const halas = wsk({ id: 'halas', kierunek: 'neutralny' }, [10, 20, 30])
const miasto = [zielen, sklep, cena, halas]
const wagi = { zielen: 1, sklep: 1, cena: 0, halas: 0 }
const wszystkieBraki = (t: Float32Array) => Array.from(t).every((v) => Number.isNaN(v))

describe('ocenyMapy: warstwa mapy per adres', () => {
  it("'wynik' to wynik łączny z wag, a nie brak warstwy", () => {
    const { naAdres, brakWarstwy } = ocenyMapy(miasto, wagi, {}, 'wynik', 3)
    assert.equal(brakWarstwy, false)
    assert.deepEqual(Array.from(naAdres), [100, 75, 0])
  })

  it('warstwa z danymi daje jej oceny', () => {
    const { naAdres, brakWarstwy } = ocenyMapy(miasto, wagi, {}, 'zielen', 3)
    assert.equal(brakWarstwy, false)
    assert.deepEqual(Array.from(naAdres), [100, 50, 0])
  })

  it('warstwa, której miasto nie ma: same braki danych, nigdy wynik łączny (SC-005)', () => {
    const lacznie = ocenyMapy(miasto, wagi, {}, 'wynik', 3).naAdres
    assert.ok(Array.from(lacznie).every(Number.isFinite), 'dane próby dają wynik łączny wszędzie')
    const { naAdres, brakWarstwy } = ocenyMapy(miasto, wagi, {}, 'powodz_1proc', 3)
    assert.equal(brakWarstwy, true)
    assert.equal(naAdres.length, 3)
    assert.ok(
      wszystkieBraki(naAdres),
      'brak warstwy to NaN pod każdym adresem, nie zero i nie wynik',
    )
  })

  it('warstwa w meta bez kierunku (kontekst) to braki, ale warstwa JEST w mieście', () => {
    const { naAdres, brakWarstwy } = ocenyMapy(miasto, wagi, {}, 'cena', 3)
    assert.equal(brakWarstwy, false)
    assert.ok(wszystkieBraki(naAdres))
  })

  it('warstwa neutralna ma oceny dopiero po nadaniu kierunku (jak przy personie)', () => {
    assert.ok(wszystkieBraki(ocenyMapy(miasto, wagi, {}, 'halas', 3).naAdres))
    const { naAdres, brakWarstwy } = ocenyMapy(miasto, wagi, { halas: 'mniej-lepiej' }, 'halas', 3)
    assert.equal(brakWarstwy, false)
    assert.ok(Array.from(naAdres).every(Number.isFinite))
  })

  it('miasto bez żadnej warstwy: wynik łączny też jest brakiem danych', () => {
    const { naAdres, brakWarstwy } = ocenyMapy([], {}, {}, 'wynik', 4)
    assert.equal(brakWarstwy, false)
    assert.equal(naAdres.length, 4)
    assert.ok(wszystkieBraki(naAdres))
  })
})
