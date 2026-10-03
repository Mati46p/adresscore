// Inwarianty silnika. Uruchom: node --test src/wynik/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import {
  grupujHeksy,
  literaZWyniku,
  mapaHeksow,
  ocenWartosc,
  PROGI_LITER,
  przygotujWskaznik,
  srednieHeksow,
  wskaznikNiedostepny,
  wynikAdresu,
  wynikiWszystkich,
  zbudujSkale,
} from './silnik.ts'

function meta(m: Partial<WskaznikMeta> & Pick<WskaznikMeta, 'id'>): WskaznikMeta {
  return {
    kategoria: 'spokoj',
    nazwa: m.id,
    opis: '',
    jednostka: '',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zrodla: [],
    zadanie: 0,
    zakres: [0, 100],
    ...m,
  }
}

function wsk(m: Partial<WskaznikMeta> & Pick<WskaznikMeta, 'id'>, wartosci: (number | null)[]) {
  const plik: PlikWskaznika = { meta: meta(m), wersjaAdresow: 'x', wartosci }
  return przygotujWskaznik(plik)
}

const halas = wsk(
  {
    id: 'halas',
    kategoria: 'spokoj',
    zakres: [40, 80],
    norma: { wartosc: 64, opis: '', zrodlo: '' },
  },
  [40, 64, 80, null],
)
const zielen = wsk({ id: 'zielen', kategoria: 'spokoj', kierunek: 'wiecej-lepiej' }, [
  100,
  50,
  null,
  null,
])
const sklep = wsk({ id: 'sklep', kategoria: 'codziennosc', zakres: [0, 2000] }, [
  0,
  1000,
  2000,
  null,
])
const cena = wsk({ id: 'cena', kategoria: 'kontekst', kierunek: 'neutralny' }, [1, 2, 3, 4])
const budowy = wsk(
  { id: 'budowy', kategoria: 'przyszlosc', kierunek: 'neutralny' },
  [0, 50, 100, 0],
)
const wszystkie = [halas, zielen, sklep, cena, budowy]
const wagi = { halas: 2, zielen: 1, sklep: 1, cena: 4, budowy: 3 }

describe('dobrowolne punktowanie kontekstu i stref 0/1', () => {
  it('ludność NSP liczy się z kierunkiem biznesowym, ale przy wadze 0 nie zmienia mieszkania', () => {
    const ludnosc = wsk(
      { id: 'ludnosc_1km', kategoria: 'kontekst', kierunek: 'neutralny', zakres: [0, 1000] },
      [0, 1000],
    )
    const baza = wsk({ id: 'baza', zakres: [0, 100] }, [50, 50])
    const kierunki = { ludnosc_1km: 'wiecej-lepiej' as const }
    assert.equal(wynikAdresu(1, [baza, ludnosc], { baza: 2, ludnosc_1km: 0 }, kierunki).wynik, 50)
    const biznes = wynikAdresu(1, [ludnosc], { ludnosc_1km: 4 }, kierunki)
    assert.equal(biznes.wynik, 100)
    assert.equal(biznes.warstwy[0]?.kategoria, 'codziennosc')
    assert.equal(wynikAdresu(0, [ludnosc], { ludnosc_1km: 4 }, kierunki).wynik, 0)
  })

  it('strefa ocenia 1 i 0 zgodnie z wyborem, bez kierunku pozostaje neutralna', () => {
    const strefa = wsk(
      { id: 'sct_w_strefie', kategoria: 'transport', kierunek: 'neutralny', zakres: [0, 1] },
      [0, 1],
    )
    const w = { sct_w_strefie: 2 }
    assert.equal(wynikAdresu(0, [strefa], w).wynik, null)
    assert.equal(wynikAdresu(1, [strefa], w, { sct_w_strefie: 'wiecej-lepiej' }).wynik, 100)
    assert.equal(wynikAdresu(0, [strefa], w, { sct_w_strefie: 'mniej-lepiej' }).wynik, 100)
    assert.equal(wynikiWszystkich([strefa], w, { sct_w_strefie: 'mniej-lepiej' }, 2)[1], 0)
  })

  it('drzewa są kontekstem do chwili świadomego nadania wagi', () => {
    const drzewa = wsk(
      {
        id: 'drzewa_100m',
        kategoria: 'kontekst',
        kierunek: 'wiecej-lepiej',
        zakres: [0, 100],
      },
      [0, 100],
    )
    const baza = wsk({ id: 'baza', zakres: [0, 100] }, [50, 50])
    const bez = wynikAdresu(1, [baza, drzewa], { baza: 2, drzewa_100m: 0 })
    const z = wynikAdresu(1, [baza, drzewa], { baza: 2, drzewa_100m: 2 })
    assert.equal(bez.wynik, 50)
    assert.equal(bez.warstwy[1]?.ocena, null)
    assert.equal(z.wynik, 75)
    assert.equal(z.warstwy[1]?.kategoria, 'codziennosc')
    assert.equal(z.kategorie.find((k) => k.kategoria === 'codziennosc')?.ocena, 100)
    assert.equal(
      wynikAdresu(0, [drzewa], { drzewa_100m: 2 }, { drzewa_100m: 'mniej-lepiej' }).wynik,
      100,
    )
    assert.deepEqual(
      Array.from(wynikiWszystkich([drzewa], { drzewa_100m: 0 }, {}, 2)).map(Number.isNaN),
      [true, true],
    )
  })

  it('atrapa ceny jest zablokowana; realna cena działa dopiero po opt-in', () => {
    const m = {
      id: 'cena_m2_mediana',
      kategoria: 'kontekst' as const,
      kierunek: 'neutralny' as const,
      zakres: [5000, 15000] as [number, number],
    }
    const atrapa = wsk({ ...m, atrapa: true }, [5000, 15000])
    const realna = wsk({ ...m, atrapa: false }, [5000, 15000])
    const ustawienia = { cena_m2_mediana: 'mniej-lepiej' as const }
    assert.equal(wynikAdresu(0, [atrapa], { cena_m2_mediana: 4 }, ustawienia).wynik, null)
    assert.equal(wynikAdresu(0, [realna], { cena_m2_mediana: 0 }, ustawienia).wynik, null)
    assert.equal(wynikAdresu(0, [realna], { cena_m2_mediana: 2 }, ustawienia).wynik, 100)
    assert.equal(
      wynikAdresu(1, [realna], { cena_m2_mediana: 2 }, { cena_m2_mediana: 'wiecej-lepiej' }).wynik,
      100,
    )
    assert.equal(
      wynikAdresu(0, [realna], { cena_m2_mediana: 2 }, ustawienia).warstwy[0]?.kategoria,
      'spolecznosc',
    )
  })
})

describe('ocena wskaźnika', () => {
  it('brak danych to null, nigdy 0', () => {
    assert.equal(ocenWartosc(null, halas.skala, 'mniej-lepiej'), null)
    assert.equal(ocenWartosc(undefined, halas.skala, 'mniej-lepiej'), null)
    assert.equal(ocenWartosc(Number.NaN, halas.skala, 'mniej-lepiej'), null)
  })

  it('norma wewnątrz zakresu to punkt 50', () => {
    assert.equal(ocenWartosc(64, halas.skala, 'mniej-lepiej'), 50)
    assert.equal(ocenWartosc(40, halas.skala, 'mniej-lepiej'), 100)
    assert.equal(ocenWartosc(80, halas.skala, 'mniej-lepiej'), 0)
    assert.equal(ocenWartosc(52, halas.skala, 'mniej-lepiej'), 75)
  })

  it('przycina wartości poza zakresem', () => {
    assert.equal(ocenWartosc(20, halas.skala, 'mniej-lepiej'), 100)
    assert.equal(ocenWartosc(95, halas.skala, 'mniej-lepiej'), 0)
  })

  it('norma na brzegu zakresu nie zmienia skali liniowej', () => {
    const s = zbudujSkale(
      meta({ id: 'pm', zakres: [5, 30], norma: { wartosc: 5, opis: '', zrodlo: '' } }),
      [],
    )
    assert.equal(s.norma, null)
    assert.equal(ocenWartosc(17.5, s, 'mniej-lepiej'), 50)
  })

  it('warstwa z normą bez zakresu używa 5. i 95. percentyla', () => {
    const wartosci = Array.from({ length: 101 }, (_, i) => i)
    const s = zbudujSkale(
      meta({ id: 'p', zakres: undefined, norma: { wartosc: 50, opis: '', zrodlo: '' } }),
      wartosci,
    )
    assert.equal(s.zrodlo, 'percentyle')
    assert.equal(s.od, 5)
    assert.equal(s.do, 95)
  })

  it('skośny rozkład bez normy ocenia medianę blisko 50 i kierunki są lustrzane', () => {
    const wartosci = [...Array.from({ length: 101 }, (_, i) => i / 20), 80, null]
    const s = zbudujSkale(meta({ id: 'kursy', zakres: [0, 80] }), wartosci)
    assert.equal(s.zrodlo, 'rangi')
    const mediana = ocenWartosc(2.5, s, 'wiecej-lepiej') as number
    assert.ok(mediana > 45 && mediana < 55, `${mediana}`)
    assert.ok((ocenWartosc(2.5, s, 'mniej-lepiej') as number) > 45)
    for (const wartosc of [0, 1.2, 2.5, 5, 80]) {
      const wiecej = ocenWartosc(wartosc, s, 'wiecej-lepiej') as number
      const mniej = ocenWartosc(wartosc, s, 'mniej-lepiej') as number
      assert.ok(Math.abs(wiecej + mniej - 100) < 1e-9)
    }
    assert.equal(ocenWartosc(null, s, 'mniej-lepiej'), null)
  })

  it('remisy mają jedną rangę, a stały pomiar nie staje się brakiem danych', () => {
    const s = zbudujSkale(meta({ id: 'remisy', zakres: undefined }), [0, 0, 0, 1, 2, 3, 4, 5, 6])
    assert.equal(s.zrodlo, 'rangi')
    assert.equal(ocenWartosc(0, s, 'wiecej-lepiej'), 12.5)
    const staly = zbudujSkale(meta({ id: 'staly', zakres: undefined }), [7, 7, 7, null])
    assert.equal(staly.zrodlo, 'rangi')
    assert.equal(ocenWartosc(7, staly, 'wiecej-lepiej'), 50)
    assert.equal(ocenWartosc(null, staly, 'wiecej-lepiej'), null)
    const bez = zbudujSkale(meta({ id: 'bez', zakres: undefined }), [null, null])
    assert.equal(ocenWartosc(7, bez, 'wiecej-lepiej'), null)
  })
})

describe('litera', () => {
  it('wynika z progów', () => {
    for (const [litera, prog] of PROGI_LITER) {
      assert.equal(literaZWyniku(prog), litera)
      assert.notEqual(literaZWyniku(prog - 0.01), litera)
    }
    assert.equal(literaZWyniku(0), 'G')
    assert.equal(literaZWyniku(100), 'A')
    assert.equal(literaZWyniku(null), null)
  })
})

describe('wynik adresu', () => {
  it('wagi warstw z danymi sumują się do 1', () => {
    for (let i = 0; i < 3; i++) {
      const w = wynikAdresu(i, wszystkie, wagi)
      const suma = w.warstwy.reduce((s, x) => s + x.waga, 0)
      assert.ok(Math.abs(suma - 1) < 1e-9, `adres ${i}: suma wag ${suma}`)
    }
  })

  it('suma wkładów to wynik', () => {
    const w = wynikAdresu(1, wszystkie, wagi)
    const suma = w.warstwy.reduce((s, x) => s + (x.wklad ?? 0), 0)
    assert.ok(w.wynik !== null && Math.abs(suma - w.wynik) < 1e-9)
  })

  it('brak danych we wszystkich warstwach = null i szare kategorie', () => {
    const w = wynikAdresu(3, [halas, zielen, sklep], wagi)
    assert.equal(w.wynik, null)
    assert.equal(w.litera, null)
    assert.equal(w.pewnosc, 0)
    for (const k of w.kategorie) assert.equal(k.ocena, null)
  })

  it('brakująca warstwa nie zaniża wyniku', () => {
    // Adres 2: zieleń bez danych. Wynik to średnia z hałasu (0) i sklepu (0), a nie z zerem za zieleń.
    const z = wynikAdresu(2, [halas, zielen, sklep], { halas: 1, zielen: 1, sklep: 1 })
    assert.equal(z.wynik, 0)
    const bez = wynikAdresu(1, [halas, zielen, sklep], { halas: 1, zielen: 1, sklep: 1 })
    const tylkoDwie = wynikAdresu(1, [halas, sklep], { halas: 1, sklep: 1 })
    assert.notEqual(bez.wynik, tylkoDwie.wynik)
    const pol = wsk({ id: 'pol', kierunek: 'wiecej-lepiej' }, [null, null, null, null])
    const zBrakiem = wynikAdresu(1, [halas, sklep, pol], { halas: 1, sklep: 1, pol: 4 })
    assert.equal(zBrakiem.wynik, tylkoDwie.wynik)
  })

  it('pewność = udział wagi warstw z danymi', () => {
    // Adres 2: halas (2) i sklep (1) mają dane, zielen (1) nie → 3/4.
    const w = wynikAdresu(2, [halas, zielen, sklep], wagi)
    assert.equal(w.pewnosc, 3 / 4)
  })

  it('warstwa, która się nie wczytała, obniża pewność, nie wynik', () => {
    const zgubiona = wskaznikNiedostepny(
      meta({ id: 'zgubiona', kategoria: 'transport' }),
      4,
      'HTTP 404',
    )
    const w = { ...wagi, zgubiona: 2 }
    for (let i = 0; i < 4; i++) {
      const bez = wynikAdresu(i, [halas, zielen, sklep], w)
      const z = wynikAdresu(i, [halas, zielen, sklep, zgubiona], w)
      assert.equal(z.wynik, bez.wynik, `adres ${i}: wynik`)
      // Mianownik pewności rośnie o wagę zgubionej warstwy, licznik bez zmian.
      const wszystkie = 2 + 1 + 1
      assert.ok(
        Math.abs(z.pewnosc - (bez.pewnosc * wszystkie) / (wszystkie + 2)) < 1e-12,
        `adres ${i}: pewność ${z.pewnosc} przy ${bez.pewnosc}`,
      )
      const r = z.warstwy.find((x) => x.id === 'zgubiona')
      assert.equal(r?.ocena, null)
      assert.equal(r?.niedostepny, 'HTTP 404')
      const transport = z.kategorie.find((k) => k.kategoria === 'transport')
      assert.equal(transport?.ocena, null)
      assert.equal(transport?.pewnosc, 0)
    }
    const tablica = wynikiWszystkich([halas, zielen, sklep, zgubiona], w, undefined, 4)
    const bezTablica = wynikiWszystkich([halas, zielen, sklep], w, undefined, 4)
    assert.deepEqual([...tablica], [...bezTablica])
  })

  it('kontekst nie wpływa na wynik', () => {
    const bez = wynikAdresu(1, [halas, zielen, sklep], wagi)
    const z = wynikAdresu(1, [halas, zielen, sklep, cena], wagi)
    const zInnaWaga = wynikAdresu(1, [halas, zielen, sklep, cena], { ...wagi, cena: 0 })
    assert.equal(z.wynik, bez.wynik)
    assert.equal(z.pewnosc, bez.pewnosc)
    assert.equal(zInnaWaga.wynik, bez.wynik)
    const k = z.warstwy.find((x) => x.id === 'cena')
    assert.equal(k?.ocena, null)
    assert.equal(k?.waga, 0)
    // Nawet z kierunkiem od użytkownika.
    const zKier = wynikAdresu(1, [halas, zielen, sklep, cena], wagi, { cena: 'mniej-lepiej' })
    assert.equal(zKier.wynik, bez.wynik)
  })

  it('neutralny liczy się dopiero z kierunkiem użytkownika', () => {
    const bez = wynikAdresu(1, [halas, budowy], wagi)
    assert.equal(bez.warstwy.find((x) => x.id === 'budowy')?.ocena, null)
    const z = wynikAdresu(1, [halas, budowy], wagi, { budowy: 'wiecej-lepiej' })
    assert.equal(z.warstwy.find((x) => x.id === 'budowy')?.ocena, 50)
  })

  it('waga 0 wszędzie = brak wyniku, nie 0', () => {
    const w = wynikAdresu(0, wszystkie, {})
    assert.equal(w.wynik, null)
    assert.equal(w.litera, null)
  })

  it('kategorie: średnia ważona i pewność per kategoria', () => {
    const w = wynikAdresu(2, [halas, zielen, sklep], wagi)
    const spokoj = w.kategorie.find((k) => k.kategoria === 'spokoj')
    assert.equal(spokoj?.ocena, 0)
    assert.equal(spokoj?.pewnosc, 2 / 3)
  })
})

describe('szybka ścieżka dla mapy', () => {
  it('zgadza się z wynikAdresu, braki to NaN', () => {
    const tablica = wynikiWszystkich(wszystkie, wagi, { budowy: 'mniej-lepiej' }, 4)
    for (let i = 0; i < 4; i++) {
      const w = wynikAdresu(i, wszystkie, wagi, { budowy: 'mniej-lepiej' }).wynik
      const t = tablica[i] as number
      if (w === null) assert.ok(Number.isNaN(t))
      else assert.ok(Math.abs(t - w) < 1e-3, `adres ${i}: ${t} vs ${w}`)
    }
  })

  it('heks bez danych = null, nie 0; średnia z adresów z danymi', () => {
    const wyniki = Float32Array.from([10, 30, Number.NaN, Number.NaN])
    const grupy = grupujHeksy(['a', 'a', 'b', 'a'])
    const srednie = srednieHeksow(wyniki, grupy)
    const mapa = mapaHeksow(srednie, grupy)
    assert.equal(mapa.get('a'), 20)
    assert.equal(mapa.get('b'), null)
  })

  it('70 tys. adresów i 8 warstw w < 50 ms', () => {
    const n = 70_217
    const warstwy = Array.from({ length: 8 }, (_, j) =>
      wsk(
        { id: `w${j}`, kierunek: j % 2 ? 'wiecej-lepiej' : 'mniej-lepiej' },
        Array.from({ length: n }, (_, i) => (i % 13 === j ? null : (i * 7 + j) % 100)),
      ),
    )
    const w = Object.fromEntries(warstwy.map((x, j) => [x.meta.id, (j % 4) + 1]))
    const grupy = grupujHeksy(Array.from({ length: n }, (_, i) => `h${i >> 3}`))
    wynikiWszystkich(warstwy, w, undefined, n) // rozgrzewka: oceny trafiają do pamięci
    const t0 = performance.now()
    const wyniki = wynikiWszystkich(warstwy, { ...w, w0: 3 }, undefined, n)
    mapaHeksow(srednieHeksow(wyniki, grupy), grupy)
    const ms = performance.now() - t0
    assert.ok(ms < 50, `${ms.toFixed(1)} ms`)
  })
})
