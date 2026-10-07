// Pamięć plików pobocznych miasta (#223): jedno wczytanie na pełną ścieżkę, wypieranie najdawniej
// użytej, ponowienie po błędzie. Uruchom: node --test src/wynik/pamiecPlikow.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { utworzPamiecPlikow } from './pamiecPlikow.ts'

/** Wczytanie z licznikiem wywołań; każde zwraca kolejny, rozróżnialny obiekt. */
function zrodlo(nazwa: string) {
  let wywolania = 0
  return {
    get wywolania() {
      return wywolania
    },
    wczytaj: async () => ({ nazwa, nr: ++wywolania }),
  }
}

const KRAKOW = '/dane/dojazd/graf.json'
const LUBLIN = '/dane/miasta/lublin/dojazd/graf.json'
const LODZ = '/dane/miasta/lodz/dojazd/graf.json'

describe('jedno wczytanie na ścieżkę', () => {
  it('kolejne wywołania tej samej ścieżki dostają ten sam wynik bez nowego pobrania', async () => {
    const pamiec = utworzPamiecPlikow<{ nazwa: string; nr: number }>(2)
    const z = zrodlo('krakow')
    const a = await pamiec.pobierz(KRAKOW, z.wczytaj)
    const b = await pamiec.pobierz(KRAKOW, z.wczytaj)
    assert.equal(z.wywolania, 1)
    assert.equal(a, b)
  })

  it('wywołania w trakcie ładowania dzielą jedną obietnicę', async () => {
    const pamiec = utworzPamiecPlikow<{ nazwa: string; nr: number }>(2)
    const z = zrodlo('krakow')
    const [a, b] = await Promise.all([
      pamiec.pobierz(KRAKOW, z.wczytaj),
      pamiec.pobierz(KRAKOW, z.wczytaj),
    ])
    assert.equal(z.wywolania, 1)
    assert.equal(a, b)
  })

  it('inna ścieżka to inny wpis: zmiana miasta nie oddaje pliku Krakowa', async () => {
    const pamiec = utworzPamiecPlikow<{ nazwa: string; nr: number }>(2)
    const krakow = zrodlo('krakow')
    const lublin = zrodlo('lublin')
    const k = await pamiec.pobierz(KRAKOW, krakow.wczytaj)
    const l = await pamiec.pobierz(LUBLIN, lublin.wczytaj)
    assert.equal(k.nazwa, 'krakow')
    assert.equal(l.nazwa, 'lublin')
    assert.equal(krakow.wywolania, 1)
    assert.equal(lublin.wywolania, 1)
    assert.equal(pamiec.rozmiar, 2)
  })
})

describe('wypieranie', () => {
  it('trzecia ścieżka wypiera tę, której użyto najdawniej', async () => {
    const pamiec = utworzPamiecPlikow<{ nazwa: string; nr: number }>(2)
    const k = zrodlo('krakow')
    const l = zrodlo('lublin')
    const ld = zrodlo('lodz')
    await pamiec.pobierz(KRAKOW, k.wczytaj)
    await pamiec.pobierz(LUBLIN, l.wczytaj)
    await pamiec.pobierz(LODZ, ld.wczytaj)
    assert.equal(pamiec.rozmiar, 2)
    assert.equal(pamiec.ma(KRAKOW), false, 'Kraków był najdawniej')
    assert.equal(pamiec.ma(LUBLIN), true)
    assert.equal(pamiec.ma(LODZ), true)
    // Powrót do wypartego miasta pobiera plik od nowa.
    await pamiec.pobierz(KRAKOW, k.wczytaj)
    assert.equal(k.wywolania, 2)
  })

  it('użycie wpisu odsuwa jego wypchnięcie', async () => {
    const pamiec = utworzPamiecPlikow<{ nazwa: string; nr: number }>(2)
    const k = zrodlo('krakow')
    const l = zrodlo('lublin')
    const ld = zrodlo('lodz')
    await pamiec.pobierz(KRAKOW, k.wczytaj)
    await pamiec.pobierz(LUBLIN, l.wczytaj)
    await pamiec.pobierz(KRAKOW, k.wczytaj) // Kraków znów świeży, najdawniej stoi Lublin
    await pamiec.pobierz(LODZ, ld.wczytaj)
    assert.equal(pamiec.ma(KRAKOW), true)
    assert.equal(pamiec.ma(LUBLIN), false)
    assert.equal(k.wywolania, 1)
  })

  it('maks = 1 trzyma tylko ostatnią ścieżkę', async () => {
    const pamiec = utworzPamiecPlikow<{ nazwa: string; nr: number }>(1)
    await pamiec.pobierz(KRAKOW, zrodlo('krakow').wczytaj)
    await pamiec.pobierz(LUBLIN, zrodlo('lublin').wczytaj)
    assert.equal(pamiec.rozmiar, 1)
    assert.equal(pamiec.ma(LUBLIN), true)
  })

  it('wyczysc oddaje wszystko', async () => {
    const pamiec = utworzPamiecPlikow<{ nazwa: string; nr: number }>(2)
    const k = zrodlo('krakow')
    await pamiec.pobierz(KRAKOW, k.wczytaj)
    pamiec.wyczysc()
    assert.equal(pamiec.rozmiar, 0)
    await pamiec.pobierz(KRAKOW, k.wczytaj)
    assert.equal(k.wywolania, 2)
  })

  it('odrzuca nieprawidłowy limit', () => {
    assert.throws(() => utworzPamiecPlikow(0))
    assert.throws(() => utworzPamiecPlikow(1.5))
  })
})

describe('błąd pobrania', () => {
  it('nie zostaje w pamięci: następne wywołanie ponawia pobranie', async () => {
    const pamiec = utworzPamiecPlikow<string>(2)
    let proby = 0
    const wczytaj = async () => {
      proby++
      if (proby === 1) throw new Error('HTTP 503')
      return 'plik'
    }
    await assert.rejects(pamiec.pobierz(KRAKOW, wczytaj), /503/)
    // Obsługa błędu w pamięci biegnie jako mikrozadanie po odrzuceniu.
    await Promise.resolve()
    assert.equal(pamiec.ma(KRAKOW), false)
    assert.equal(await pamiec.pobierz(KRAKOW, wczytaj), 'plik')
    assert.equal(proby, 2)
  })

  it('porażka wypartego wpisu nie usuwa nowszego wczytania tej samej ścieżki', async () => {
    const pamiec = utworzPamiecPlikow<string>(1)
    let odrzuc: (e: Error) => void = () => {}
    const wolne = new Promise<string>((_, nie) => {
      odrzuc = nie
    })
    // Pierwsze wczytanie Krakowa wisi; Lublin je wypiera; Kraków wraca z nowym wczytaniem.
    const stare = pamiec.pobierz(KRAKOW, () => wolne)
    await pamiec.pobierz(LUBLIN, async () => 'lublin')
    const nowe = pamiec.pobierz(KRAKOW, async () => 'krakow-2')
    odrzuc(new Error('stare padło'))
    await assert.rejects(stare, /stare padło/)
    await Promise.resolve()
    assert.equal(pamiec.ma(KRAKOW), true, 'nowe wczytanie zostaje')
    assert.equal(await nowe, 'krakow-2')
  })
})
