// Uruchom: node --test src/mapa/sasiedzi/*.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { odlegloscGeodezyjnaM } from '../../wynik/sasiedzi.ts'
import {
  czyWidoczne,
  graniceOkregu,
  type KandydatNaMapie,
  kluczZnacznikow,
  okragWokol,
  punktWOdleglosci,
  znacznikiSasiadow,
} from './model.ts'

const RYNEK = { lon: 19.9373, lat: 50.0614 }

const kandydat = (
  adres: number,
  litera: KandydatNaMapie['litera'] = 'B',
  etykieta = `Długa ${adres}, Kraków`,
): KandydatNaMapie => ({
  adres,
  lon: RYNEK.lon + adres * 0.001,
  lat: RYNEK.lat,
  litera,
  etykieta,
})

/** Pole wielokąta ze wzoru Gaussa w stopniach – znak mówi o kierunku pierścienia. */
function poleZeZnakiem(pierscien: [number, number][]): number {
  let s = 0
  for (let k = 0; k < pierscien.length - 1; k++) {
    const [x1, y1] = pierscien[k] as [number, number]
    const [x2, y2] = pierscien[k + 1] as [number, number]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

describe('punktWOdleglosci', () => {
  it('500 m na północ i na wschód leży 500 m od środka', () => {
    for (const azymut of [0, 90, 180, 270, 33]) {
      const [lon, lat] = punktWOdleglosci(RYNEK.lon, RYNEK.lat, 500, azymut)
      assert.ok(Math.abs(odlegloscGeodezyjnaM(RYNEK.lon, RYNEK.lat, lon, lat) - 500) < 0.01)
    }
    const [lonN, latN] = punktWOdleglosci(RYNEK.lon, RYNEK.lat, 500, 0)
    assert.ok(Math.abs(lonN - RYNEK.lon) < 1e-9)
    assert.ok(latN > RYNEK.lat)
    const [lonE, latE] = punktWOdleglosci(RYNEK.lon, RYNEK.lat, 500, 90)
    assert.ok(lonE > RYNEK.lon)
    assert.ok(Math.abs(latE - RYNEK.lat) < 1e-5)
  })
})

describe('okragWokol', () => {
  it('daje zamknięty pierścień, każdy wierzchołek 500 m od środka', () => {
    const okrag = okragWokol(RYNEK.lon, RYNEK.lat, 500, 64)
    assert.equal(okrag.type, 'Feature')
    assert.equal(okrag.geometry.type, 'Polygon')
    const [pierscien] = okrag.geometry.coordinates
    assert.ok(pierscien)
    assert.equal(pierscien.length, 65)
    assert.deepEqual(pierscien[0], pierscien[64])
    for (const [lon, lat] of pierscien) {
      const d = odlegloscGeodezyjnaM(RYNEK.lon, RYNEK.lat, lon, lat)
      assert.ok(Math.abs(d - 500) < 0.01, `wierzchołek ${d} m od środka`)
    }
  })

  it('pierścień idzie przeciwnie do wskazówek zegara (RFC 7946)', () => {
    const [pierscien] = okragWokol(RYNEK.lon, RYNEK.lat, 500).geometry.coordinates
    assert.ok(poleZeZnakiem(pierscien as [number, number][]) > 0)
  })

  it('za mało kroków podnosi do 8 wierzchołków', () => {
    const [pierscien] = okragWokol(RYNEK.lon, RYNEK.lat, 500, 3).geometry.coordinates
    assert.equal(pierscien?.length, 9)
  })
})

describe('graniceOkregu', () => {
  it('prostokąt obejmuje każdy wierzchołek okręgu z zapasem poniżej metra', () => {
    const [[w, s], [e, n]] = graniceOkregu(RYNEK.lon, RYNEK.lat, 500)
    assert.ok(w < RYNEK.lon && RYNEK.lon < e)
    assert.ok(s < RYNEK.lat && RYNEK.lat < n)
    const [pierscien] = okragWokol(RYNEK.lon, RYNEK.lat, 500).geometry.coordinates
    const tol = 1e-5
    for (const [lon, lat] of pierscien ?? []) {
      assert.ok(lon >= w - tol && lon <= e + tol && lat >= s - tol && lat <= n + tol)
    }
    assert.ok(Math.abs(odlegloscGeodezyjnaM(RYNEK.lon, s, RYNEK.lon, n) - 1000) < 0.1)
  })
})

describe('czyWidoczne', () => {
  it('brak propsów, brak środka albo pusta lista = nic do narysowania', () => {
    assert.equal(czyWidoczne(undefined), false)
    assert.equal(czyWidoczne({ kandydaci: [kandydat(1)], srodek: null }), false)
    assert.equal(czyWidoczne({ kandydaci: [], srodek: RYNEK }), false)
    assert.equal(czyWidoczne({ kandydaci: [kandydat(1)], srodek: RYNEK }), true)
  })
})

describe('znacznikiSasiadow', () => {
  it('zamknięta sekcja (srodek null) nie daje znaczników', () => {
    assert.deepEqual(znacznikiSasiadow({ kandydaci: [kandydat(1)], srodek: null, wybrany: 1 }), [])
    assert.deepEqual(znacznikiSasiadow({ kandydaci: [], srodek: RYNEK, wybrany: null }), [])
  })

  it('mapuje literę na kolor wypełnienia i tekst z kontrastem, nie na kolor tekstu', () => {
    const [a, g] = znacznikiSasiadow({
      kandydaci: [kandydat(1, 'A'), kandydat(2, 'G')],
      srodek: RYNEK,
      wybrany: null,
    })
    assert.equal(a?.litera, 'A')
    assert.equal(a?.tlo, '#0B6B3A')
    assert.equal(a?.tekst, '#FFFFFF')
    assert.equal(g?.litera, 'G')
    assert.equal(g?.tlo, '#B3261E')
    assert.notEqual(g?.tekst, g?.tlo)
  })

  it('litera spoza A–G dostaje szare tło, nie kolor z palety', () => {
    // Litera spoza kontraktu (np. dane z innego źródła) – rzutowanie tylko w teście.
    const zla = { ...kandydat(1), litera: ' ' as KandydatNaMapie['litera'] }
    const [z] = znacznikiSasiadow({ kandydaci: [zla], srodek: RYNEK, wybrany: null })
    assert.equal(z?.litera, '?')
    assert.equal(z?.tlo, '#8A9097')
  })

  it('opis i dymek mówią adres i literę, wybrany to pozycja na liście (jak w #94)', () => {
    const z = znacznikiSasiadow({
      kandydaci: [kandydat(1, 'B', 'Długa 1, Kraków'), kandydat(7, 'C', 'Krótka 2, Kraków')],
      srodek: RYNEK,
      wybrany: 1,
    })
    assert.equal(z[0]?.dymek, 'Długa 1, Kraków – litera B')
    assert.equal(z[0]?.opis, 'Lepszy sąsiad: Długa 1, Kraków, litera B. Otwórz kartę adresu')
    assert.deepEqual(
      z.map((x) => [x.k, x.adres, x.wybrany]),
      [
        [0, 1, false],
        [1, 7, true],
      ],
    )
  })

  it('pomija kandydata bez współrzędnych i powtórzony adres, pozycja zostaje z listy', () => {
    const z = znacznikiSasiadow({
      kandydaci: [
        kandydat(3),
        { ...kandydat(4), lon: Number.NaN },
        kandydat(1),
        { ...kandydat(3), litera: 'A' },
      ],
      srodek: RYNEK,
      wybrany: null,
    })
    assert.deepEqual(
      z.map((x) => [x.k, x.adres]),
      [
        [0, 3],
        [2, 1],
      ],
    )
  })
})

describe('kluczZnacznikow', () => {
  it('zmiana wyboru nie zmienia klucza, zmiana kandydatów – tak', () => {
    const p = { kandydaci: [kandydat(1), kandydat(2)], srodek: RYNEK }
    const k1 = kluczZnacznikow(znacznikiSasiadow({ ...p, wybrany: null }))
    const k2 = kluczZnacznikow(znacznikiSasiadow({ ...p, wybrany: 1 }))
    const k3 = kluczZnacznikow(
      znacznikiSasiadow({ ...p, kandydaci: [kandydat(1), kandydat(5)], wybrany: null }),
    )
    assert.equal(k1, k2)
    assert.notEqual(k1, k3)
  })
})
