// Rejestr czasu w sekcjach (czysta część sekcje.ts). Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MAX_SEKCJI } from './kontrakt.ts'
import { utworzRejestrSekcji } from './sekcje.ts'

function swiat(maks?: number) {
  let t = 0
  const rejestr = utworzRejestrSekcji(() => t, maks)
  return { rejestr, tyk: (ms: number) => void (t += ms) }
}

describe('rejestr sekcji: czas widoczny', () => {
  it('liczy odcinek między wejściem a wyjściem', () => {
    const s = swiat()
    s.rejestr.pozycje(new Map([['etykieta', 0]]))
    s.rejestr.wejscie('etykieta')
    s.tyk(1200)
    s.rejestr.wyjscie('etykieta')
    s.tyk(5000)
    assert.deepEqual(s.rejestr.zbierz(), [['etykieta', 1200, 0]])
  })

  it('karta w tle nie nalicza czasu, po powrocie liczy dalej', () => {
    const s = swiat()
    s.rejestr.wejscie('mapa')
    s.tyk(1000)
    s.rejestr.wstrzymaj()
    s.tyk(60_000)
    s.rejestr.wznow()
    s.tyk(500)
    assert.deepEqual(s.rejestr.zbierz()?.[0]?.slice(0, 2), ['mapa', 1500])
  })

  it('sekcja, która stała się widoczna w tle, zaczyna liczyć dopiero po powrocie', () => {
    const s = swiat()
    s.rejestr.wstrzymaj()
    s.rejestr.wejscie('zrodla')
    s.tyk(10_000)
    s.rejestr.wznow()
    s.tyk(300)
    assert.deepEqual(s.rejestr.zbierz()?.[0]?.slice(0, 2), ['zrodla', 300])
  })

  it('dwa egzemplarze jednego klucza liczą się jednym stoperem (bez podwajania)', () => {
    const s = swiat()
    s.rejestr.wejscie('karta')
    s.tyk(1000)
    s.rejestr.wejscie('karta') // drugi egzemplarz dochodzi, pierwszy nadal widoczny
    s.tyk(1000)
    s.rejestr.wyjscie('karta')
    s.tyk(1000) // został drugi egzemplarz
    s.rejestr.wyjscie('karta')
    s.tyk(1000) // nikt nie jest widoczny
    assert.deepEqual(s.rejestr.zbierz()?.[0]?.slice(0, 2), ['karta', 3000])
  })

  it('wyjście bez wejścia niczego nie psuje', () => {
    const s = swiat()
    s.rejestr.wyjscie('nieistniejaca')
    s.rejestr.wejscie('a')
    s.rejestr.wyjscie('a')
    s.rejestr.wyjscie('a')
    s.rejestr.wejscie('a')
    s.tyk(100)
    assert.deepEqual(s.rejestr.zbierz()?.[0]?.slice(0, 2), ['a', 100])
  })
})

describe('rejestr sekcji: zbieranie', () => {
  it('oddaje wartości od otwarcia odsłony i niczego nie zeruje (odczyt, nie przyrost)', () => {
    const s = swiat()
    s.rejestr.wejscie('a')
    s.tyk(1000)
    s.rejestr.wyjscie('a')
    assert.deepEqual(s.rejestr.zbierz(), [['a', 1000, 0]])
    assert.deepEqual(s.rejestr.zbierz(), [['a', 1000, 0]], 'drugi odczyt daje to samo')
    s.rejestr.wejscie('a')
    s.tyk(400)
    assert.deepEqual(s.rejestr.zbierz()?.[0]?.slice(0, 2), ['a', 1400], 'kumulacja, nie przyrost')
  })

  it('sekcja widoczna w chwili zebrania nie traci czasu (odczyt nie zatrzymuje stopera)', () => {
    const s = swiat()
    s.rejestr.wejscie('a')
    s.tyk(1000)
    assert.deepEqual(s.rejestr.zbierz()?.[0]?.slice(0, 2), ['a', 1000])
    s.tyk(250)
    assert.deepEqual(s.rejestr.zbierz()?.[0]?.slice(0, 2), ['a', 1250])
  })

  it('sekcja osiągnięta na 0 ms jest zgłoszona z zerem', () => {
    const s = swiat()
    s.rejestr.wejscie('a')
    s.rejestr.wyjscie('a')
    assert.deepEqual(s.rejestr.zbierz(), [['a', 0, 0]])
  })

  it('sekcja nieosiągnięta w ogóle nie trafia do wyniku', () => {
    const s = swiat()
    s.rejestr.pozycje(
      new Map([
        ['a', 0],
        ['b', 1],
      ]),
    )
    s.rejestr.wejscie('a')
    s.tyk(100)
    assert.deepEqual(
      s.rejestr.zbierz()?.map((x) => x[0]),
      ['a'],
    )
  })

  it('wynik w kolejności dokumentu (poz), niezależnie od kolejności wejść', () => {
    const s = swiat()
    s.rejestr.pozycje(
      new Map([
        ['gora', 0],
        ['srodek', 1],
        ['dol', 2],
      ]),
    )
    s.rejestr.wejscie('dol')
    s.tyk(10)
    s.rejestr.wejscie('gora')
    s.tyk(10)
    s.rejestr.wejscie('srodek')
    s.tyk(10)
    assert.deepEqual(
      s.rejestr.zbierz()?.map((x) => [x[0], x[2]]),
      [
        ['gora', 0],
        ['srodek', 1],
        ['dol', 2],
      ],
    )
  })

  it('przy nadmiarze zostają sekcje o największym czasie, nadal w kolejności dokumentu', () => {
    const s = swiat(3)
    const poz = new Map<string, number>()
    for (let i = 0; i < 6; i++) poz.set(`s${i}`, i)
    s.rejestr.pozycje(poz)
    const czasy = [10, 500, 20, 400, 5, 300]
    czasy.forEach((ms, i) => {
      s.rejestr.wejscie(`s${i}`)
      s.tyk(ms)
      s.rejestr.wyjscie(`s${i}`)
    })
    assert.deepEqual(
      s.rejestr.zbierz()?.map((x) => x[0]),
      ['s1', 's3', 's5'],
    )
  })

  it('domyślny limit to MAX_SEKCJI z kontraktu', () => {
    const s = swiat()
    for (let i = 0; i < MAX_SEKCJI + 10; i++) {
      s.rejestr.wejscie(`s${i}`)
      s.tyk(1)
      s.rejestr.wyjscie(`s${i}`)
    }
    assert.equal(s.rejestr.zbierz()?.length, MAX_SEKCJI)
  })

  it('reset zapomina wszystko', () => {
    const s = swiat()
    s.rejestr.wejscie('a')
    s.tyk(100)
    s.rejestr.reset()
    assert.equal(s.rejestr.zbierz(), null)
  })

  it('bezpiecznik: ponad 48 kluczy w jednej odsłonie jest ignorowane', () => {
    const s = swiat()
    for (let i = 0; i < 80; i++) {
      s.rejestr.wejscie(`k${i}`)
      s.tyk(1)
      s.rejestr.wyjscie(`k${i}`)
    }
    const wynik = s.rejestr.zbierz() ?? []
    assert.ok(wynik.length <= 48)
  })
})
