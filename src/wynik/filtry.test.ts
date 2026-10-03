// Inwarianty twardych filtrów. Uruchom: node --test src/wynik/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import {
  filtryDoTekstu,
  filtryZTekstu,
  maskujWykluczone,
  ocenFiltr,
  opisFiltru,
  policzWykluczenia,
  type TwardyFiltr,
  wykluczoneHeksy,
  zPodmienionymFiltrem,
} from './filtry.ts'
import {
  grupujHeksy,
  przygotujWskaznik,
  srednieHeksow,
  wynikAdresu,
  wynikiWszystkich,
} from './silnik.ts'

function wsk(id: string, wartosci: (number | null)[], zakres: [number, number] = [0, 100]) {
  const meta: WskaznikMeta = {
    id,
    kategoria: 'spokoj',
    nazwa: id,
    opis: '',
    jednostka: 'dB',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zrodla: [],
    zadanie: 0,
    zakres,
  }
  const plik: PlikWskaznika = { meta, wersjaAdresow: 'x', wartosci }
  return przygotujWskaznik(plik)
}

const halas = wsk('halas', [40, 60, null, 55, 80])
const max55: TwardyFiltr = { id: 'halas', warunek: 'max', prog: 55 }

describe('ocenFiltr', () => {
  it('max: próg włącznie jest spełniony', () => {
    assert.equal(ocenFiltr(55, max55), 'spelnia')
    assert.equal(ocenFiltr(55.1, max55), 'narusza')
  })
  it('min i rowne-zero', () => {
    assert.equal(ocenFiltr(9, { id: 'x', warunek: 'min', prog: 10 }), 'narusza')
    assert.equal(ocenFiltr(10, { id: 'x', warunek: 'min', prog: 10 }), 'spelnia')
    assert.equal(ocenFiltr(0, { id: 'x', warunek: 'rowne-zero', prog: 0 }), 'spelnia')
    assert.equal(ocenFiltr(0.3, { id: 'x', warunek: 'rowne-zero', prog: 0 }), 'narusza')
  })
  it('brak danych nie wyklucza: nie wiemy', () => {
    for (const w of [null, undefined, Number.NaN]) {
      assert.equal(ocenFiltr(w, max55), 'nie-wiemy')
    }
  })
})

describe('policzWykluczenia', () => {
  it('wyklucza tylko adresy z naruszeniem; null daje „nie wiemy”, nie wykluczenie', () => {
    const w = policzWykluczenia([halas], [max55], 5)
    assert.deepEqual([...w.wykluczony], [0, 1, 0, 0, 1])
    assert.deepEqual([...w.niewiadomy], [0, 0, 1, 0, 0])
    assert.equal(w.liczbaWykluczonych, 2)
    assert.equal(w.liczbaNiewiadomych, 1)
  })
  it('bez filtrów nikt nie jest wykluczony', () => {
    const w = policzWykluczenia([halas], [], 5)
    assert.equal(w.liczbaWykluczonych, 0)
    assert.equal(w.liczbaNiewiadomych, 0)
  })
  it('filtr nieznanej warstwy (np. czas dojazdu przed #38) nic nie wyklucza', () => {
    const w = policzWykluczenia([halas], [{ id: 'dojazd_min', warunek: 'max', prog: 30 }], 5)
    assert.equal(w.liczbaWykluczonych, 0)
  })
  it('znane naruszenie wygrywa z brakiem danych w innym filtrze', () => {
    const inne = wsk('inne', [null, null, null, null, null])
    const w = policzWykluczenia([halas, inne], [max55, { id: 'inne', warunek: 'max', prog: 1 }], 5)
    assert.equal(w.wykluczony[1], 1)
    assert.equal(w.niewiadomy[1], 0)
    assert.equal(w.niewiadomy[0], 1)
  })
  it('działa na dowolnej warstwie po id', () => {
    const dojazd = wsk('dojazd_min', [10, 45, 31], [0, 90])
    const w = policzWykluczenia([dojazd], [{ id: 'dojazd_min', warunek: 'max', prog: 30 }], 3)
    assert.deepEqual([...w.wykluczony], [0, 1, 1])
  })
})

describe('wykluczenie nie zmienia wyniku pozostałych adresów', () => {
  const a = wsk('a', [10, 50, 90, 30, 70])
  const b = wsk('b', [20, null, 60, 80, 40])
  const wskazniki = [a, b]
  const wagi = { a: 3, b: 2 }

  it('wyniki wszystkich są takie same z filtrem i bez niego', () => {
    const przed = wynikiWszystkich(wskazniki, wagi, undefined, 5)
    // Filtr istnieje tylko w stanie; silnik wyniku go nie widzi, więc wynik się nie zmienia.
    const w = policzWykluczenia(wskazniki, [{ id: 'a', warunek: 'max', prog: 40 }], 5)
    const po = wynikiWszystkich(wskazniki, wagi, undefined, 5)
    assert.deepEqual([...po], [...przed])
    assert.ok(w.liczbaWykluczonych > 0)
    for (let i = 0; i < 5; i++) {
      assert.equal(
        wynikAdresu(i, wskazniki, wagi).wynik,
        Number.isNaN(przed[i] as number) ? null : przed[i],
      )
    }
  })

  it('maska zeruje tylko wykluczone, reszta bez zmian', () => {
    const wyniki = wynikiWszystkich(wskazniki, wagi, undefined, 5)
    const m = maskujWykluczone(wyniki, Uint8Array.from([0, 1, 0, 0, 1]))
    assert.ok(Number.isNaN(m[1] as number) && Number.isNaN(m[4] as number))
    for (const i of [0, 2, 3]) assert.equal(m[i], wyniki[i])
  })
})

describe('wykluczoneHeksy', () => {
  const grupy = grupujHeksy(['h1', 'h1', 'h2', 'h3'])
  it('heks jest wykluczony, gdy wszystkie jego adresy są wykluczone', () => {
    const s = wykluczoneHeksy(Uint8Array.from([1, 1, 1, 0]), grupy)
    assert.deepEqual([...s].sort(), ['h1', 'h2'])
  })
  it('jeden niewykluczony adres zostawia heks na mapie', () => {
    const s = wykluczoneHeksy(Uint8Array.from([1, 0, 0, 0]), grupy)
    assert.equal(s.size, 0)
  })
  it('wykluczony heks to nie brak danych: brak danych w heksie nie trafia do zbioru', () => {
    const wyniki = Float32Array.from([Number.NaN, Number.NaN, 50, 50])
    const wykl = Uint8Array.from([0, 0, 1, 0])
    const s = wykluczoneHeksy(wykl, grupy)
    assert.ok(s.has('h2') && !s.has('h1'))
    const srednie = srednieHeksow(maskujWykluczone(wyniki, wykl), grupy)
    assert.ok(Number.isNaN(srednie[0] as number)) // h1: brak danych, nie wykluczony
    assert.ok(Number.isNaN(srednie[1] as number)) // h2: wszystkie wykluczone, średnia z pustego
    assert.equal(srednie[2], 50) // h3: bez zmian
  })
})

describe('lista filtrów i URL', () => {
  it('jeden filtr na warstwę', () => {
    const l = zPodmienionymFiltrem([max55], { id: 'halas', warunek: 'min', prog: 3 })
    assert.equal(l.length, 1)
    assert.equal(l[0]?.warunek, 'min')
  })
  it('zapis i odczyt dają to samo', () => {
    const lista: TwardyFiltr[] = [
      max55,
      { id: 'powodz_1proc', warunek: 'rowne-zero', prog: 0 },
      { id: 'sklep_odleglosc', warunek: 'max', prog: 800.5 },
    ]
    const tekst = filtryDoTekstu(lista)
    assert.equal(tekst, 'halas:max:55,powodz_1proc:zero,sklep_odleglosc:max:800.5')
    assert.deepEqual(filtryZTekstu(tekst), lista)
  })
  it('uszkodzony wpis jest pomijany', () => {
    assert.deepEqual(filtryZTekstu('x:max:abc,Zle id:max:1,halas:max:55,:min:2,y:foo:1'), [max55])
    assert.deepEqual(filtryZTekstu(null), [])
  })
  it('opis filtra', () => {
    const meta = { nazwa: 'Hałas', jednostka: 'dB' }
    assert.equal(opisFiltru(max55, meta), 'Hałas: maks. 55 dB')
    assert.equal(
      opisFiltru({ id: 'p', warunek: 'rowne-zero', prog: 0 }, { nazwa: 'Powódź', jednostka: 'm' }),
      'Powódź: wyklucz strefę',
    )
    assert.equal(opisFiltru(max55, undefined), 'halas: maks. 55')
  })
})
