// Inwarianty „Lepszego sąsiada” (#93). Uruchom: node --test src/wynik/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { latLngToCell } from 'h3-js'
import type { KategoriaId, PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import type { TwardyFiltr } from './filtry.ts'
import {
  type AdresSasiada,
  lepsiSasiedzi,
  odlegloscGeodezyjnaM,
  PODPIS_BRAKU_CEN,
} from './sasiedzi.ts'
import { przygotujWskaznik, type Wagi } from './silnik.ts'

// Rynek Główny. Przesunięcia w metrach przeliczamy na stopnie w lokalnym rzucie.
const LON = 19.937
const LAT = 50.0617
const M_LAT = 1 / 111_195
const M_LON = 1 / (111_195 * Math.cos(LAT * (Math.PI / 180)))

interface Punkt {
  /** Metry na wschód i na północ od Rynku. */
  dx: number
  dy: number
  /** Warstwy z najwyżej 5 wartościami – skala liniowa 0–100, więc ocena = wartość. */
  cisza: number | null
  dojazd: number | null
  cena?: number | null
  halas?: number | null
  ulica?: string
  nr?: string
}

function meta(id: string, kategoria: KategoriaId, m: Partial<WskaznikMeta> = {}): WskaznikMeta {
  return {
    id,
    kategoria,
    nazwa: id,
    opis: '',
    jednostka: '',
    kierunek: 'wiecej-lepiej',
    rozdzielczosc: 'adres',
    zrodla: [],
    zadanie: 0,
    zakres: [0, 100],
    ...m,
  }
}

function wsk(m: WskaznikMeta, wartosci: (number | null)[]) {
  const plik: PlikWskaznika = { meta: m, wersjaAdresow: 'x', wartosci }
  return przygotujWskaznik(plik)
}

const WAGI: Wagi = { cisza: 2, dojazd: 2 }

/** Indeks 0 = adres wyjściowy na Rynku. */
function scena(punkty: Punkt[], opcjeCeny: Partial<WskaznikMeta> = {}) {
  const adresy: AdresSasiada[] = punkty.map((p, i) => {
    const lon = LON + p.dx * M_LON
    const lat = LAT + p.dy * M_LAT
    return {
      lon,
      lat,
      h3: latLngToCell(lat, lon, 10),
      miejscowosc: 'Kraków',
      ulica: p.ulica ?? `Ulica ${i}`,
      nr: p.nr ?? '1',
    }
  })
  const wskazniki = [
    wsk(
      meta('cisza', 'spokoj'),
      punkty.map((p) => p.cisza),
    ),
    wsk(
      meta('dojazd', 'transport'),
      punkty.map((p) => p.dojazd),
    ),
    wsk(
      meta('cena_m2_mediana', 'kontekst', {
        kierunek: 'neutralny',
        rozdzielczosc: 'heks',
        zakres: [2000, 60000],
        ...opcjeCeny,
      }),
      punkty.map((p) => p.cena ?? null),
    ),
    wsk(
      meta('halas', 'spokoj', { kierunek: 'mniej-lepiej', jednostka: 'dB' }),
      punkty.map((p) => p.halas ?? null),
    ),
  ]
  return { adresy, wskazniki }
}

const indeksy = (r: ReturnType<typeof lepsiSasiedzi>) => r.kandydaci.map((k) => k.i)

describe('odlegloscGeodezyjnaM', () => {
  it('0,01° szerokości to ok. 1112 m', () => {
    const d = odlegloscGeodezyjnaM(LON, LAT, LON, LAT + 0.01)
    assert.ok(Math.abs(d - 1112) < 2, String(d))
  })
})

describe('lepsiSasiedzi – brak kandydatów', () => {
  it('nikt w promieniu nie ma lepszej litery', () => {
    const { adresy, wskazniki } = scena([
      { dx: 0, dy: 0, cisza: 80, dojazd: 80 }, // 80 → B
      { dx: 100, dy: 0, cisza: 80, dojazd: 80 }, // ta sama litera
      { dx: 0, dy: 200, cisza: 50, dojazd: 50 }, // gorsza
    ])
    const r = lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI })
    assert.equal(r.wyjsciowy.litera, 'B')
    assert.deepEqual(r.kandydaci, [])
  })

  it('lepszy adres dalej niż 500 m się nie liczy', () => {
    const { adresy, wskazniki } = scena([
      { dx: 0, dy: 0, cisza: 20, dojazd: 20 },
      { dx: 0, dy: 520, cisza: 100, dojazd: 100 },
      { dx: 480, dy: 0, cisza: 100, dojazd: 100 },
    ])
    assert.deepEqual(indeksy(lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI })), [2])
  })

  it('adres bez wyniku (szara kategoria) nie ma kandydatów, a nie wynik 0', () => {
    const { adresy, wskazniki } = scena([
      { dx: 0, dy: 0, cisza: null, dojazd: null },
      { dx: 50, dy: 0, cisza: 100, dojazd: 100 },
    ])
    const r = lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI })
    assert.equal(r.wyjsciowy.wynik, null)
    assert.equal(r.wyjsciowy.litera, null)
    assert.deepEqual(r.kandydaci, [])
  })

  it('kandydat bez danych nie jest „lepszy”', () => {
    const { adresy, wskazniki } = scena([
      { dx: 0, dy: 0, cisza: 20, dojazd: 20 },
      { dx: 50, dy: 0, cisza: null, dojazd: null },
    ])
    assert.deepEqual(lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI }).kandydaci, [])
  })
})

describe('lepsiSasiedzi – dealbreakery', () => {
  const { adresy, wskazniki } = scena([
    { dx: 0, dy: 0, cisza: 20, dojazd: 20, halas: 50 },
    { dx: 50, dy: 0, cisza: 100, dojazd: 100, halas: 70 }, // narusza max 55
    { dx: 100, dy: 0, cisza: 100, dojazd: 100, halas: null }, // nie wiemy – zostaje
    { dx: 150, dy: 0, cisza: 100, dojazd: 100, halas: 40 },
  ])
  const max55: TwardyFiltr = { id: 'halas', warunek: 'max', prog: 55 }

  it('adres wykluczony filtrem nie jest kandydatem, brak danych nie wyklucza', () => {
    const r = lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI, filtry: [max55] })
    assert.deepEqual(indeksy(r), [2, 3])
  })

  it('bez filtra ten sam adres wraca', () => {
    assert.deepEqual(indeksy(lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI })), [1, 2, 3])
  })

  it('filtr nieznanej warstwy nic nie wyklucza', () => {
    const r = lepsiSasiedzi(0, adresy, wskazniki, {
      wagi: WAGI,
      filtry: [{ id: 'nie_ma', warunek: 'max', prog: 0 }],
    })
    assert.deepEqual(indeksy(r), [1, 2, 3])
  })

  it('wagi i kierunki użytkownika zmieniają literę', () => {
    // Odwrócony kierunek ciszy: kandydaci z ciszą 100 spadają, adres wyjściowy rośnie.
    const r = lepsiSasiedzi(0, adresy, wskazniki, {
      wagi: { cisza: 4 },
      kierunki: { cisza: 'mniej-lepiej' },
    })
    assert.equal(r.wyjsciowy.litera, 'B')
    assert.deepEqual(r.kandydaci, [])
  })
})

describe('lepsiSasiedzi – warunek ceny', () => {
  const punkty: Punkt[] = [
    { dx: 0, dy: 0, cisza: 20, dojazd: 20, cena: 10_000 },
    { dx: 50, dy: 0, cisza: 100, dojazd: 100, cena: 11_500 }, // +15% – na granicy, zostaje
    { dx: 100, dy: 0, cisza: 100, dojazd: 100, cena: 11_600 }, // +16% – odpada
    { dx: 150, dy: 0, cisza: 100, dojazd: 100, cena: 8_500 }, // −15% – zostaje
    { dx: 200, dy: 0, cisza: 100, dojazd: 100, cena: null }, // brak ceny – zostaje z podpisem
    { dx: 250, dy: 0, cisza: 100, dojazd: 100, cena: 5_000 }, // −50% – odpada
  ]

  it('±15% zostaje, poza odpada, brak ceny zostaje z podpisem', () => {
    const { adresy, wskazniki } = scena(punkty)
    const r = lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI }, { limit: 10 })
    assert.equal(r.wyjsciowy.cenaM2, 10_000)
    assert.deepEqual(indeksy(r), [1, 3, 4])
    const [a, b, c] = r.kandydaci
    assert.equal(a?.cena.stan, 'podobna')
    assert.ok(a?.cena.stan === 'podobna' && Math.abs(a.cena.roznica - 0.15) < 1e-9)
    assert.ok(b?.cena.stan === 'podobna' && b.cena.cenaM2 === 8_500)
    assert.deepEqual(c?.cena, { stan: 'brak', podpis: PODPIS_BRAKU_CEN })
  })

  it('brak ceny adresu wyjściowego: wszyscy zostają z podpisem', () => {
    const { adresy, wskazniki } = scena([
      { ...(punkty[0] as Punkt), cena: null },
      ...punkty.slice(1),
    ])
    const r = lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI }, { limit: 10 })
    assert.deepEqual(indeksy(r), [1, 2, 3, 4, 5])
    for (const k of r.kandydaci) assert.equal(k.cena.stan, 'brak')
  })

  it('cena-atrapa to brak cen, nie warunek', () => {
    const { adresy, wskazniki } = scena(punkty, { atrapa: true })
    const r = lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI }, { limit: 10 })
    assert.equal(r.wyjsciowy.cenaM2, null)
    assert.equal(r.kandydaci.length, 5)
  })
})

describe('lepsiSasiedzi – kolejność', () => {
  it('remis: stała kolejność po indeksie, niezależnie od wywołania', () => {
    // 1 i 2 w tym samym punkcie (narożnik dwóch ulic), z tą samą literą i wynikiem.
    const { adresy, wskazniki } = scena([
      { dx: 0, dy: 0, cisza: 20, dojazd: 20 },
      { dx: 120, dy: 0, cisza: 80, dojazd: 80, ulica: 'Wschodnia' },
      { dx: 120, dy: 0, cisza: 80, dojazd: 80, ulica: 'Północna' },
    ])
    const r = lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI })
    const [a, b] = r.kandydaci
    assert.equal(a?.odlegloscM, b?.odlegloscM)
    assert.equal(a?.wynik, b?.wynik)
    assert.deepEqual(indeksy(r), [1, 2])
    assert.deepEqual(r, lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI }))
  })

  it('lepsza litera przed bliższym, potem odległość, potem wynik', () => {
    const { adresy, wskazniki } = scena([
      { dx: 0, dy: 0, cisza: 20, dojazd: 20 }, // F
      { dx: 50, dy: 0, cisza: 50, dojazd: 50 }, // D, najbliżej
      { dx: 400, dy: 0, cisza: 100, dojazd: 100 }, // A, daleko
      { dx: 0, dy: 200, cisza: 50, dojazd: 50 }, // D, dalej niż 1
      { dx: 0, dy: -50, cisza: 50, dojazd: 80 }, // C (65), tak blisko jak 1
    ])
    const r = lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI }, { limit: 10 })
    assert.deepEqual(indeksy(r), [2, 4, 1, 3])
  })

  it('najwyżej 3 kandydatów', () => {
    const punkty: Punkt[] = [{ dx: 0, dy: 0, cisza: 20, dojazd: 20 }]
    for (let k = 1; k <= 6; k++) punkty.push({ dx: k * 60, dy: 0, cisza: 100, dojazd: 100 })
    const { adresy, wskazniki } = scena(punkty)
    assert.deepEqual(indeksy(lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI })), [1, 2, 3])
  })
})

describe('lepsiSasiedzi – budynki, pewność, wyróżniki', () => {
  it('jeden wpis na budynek; budynek adresu wyjściowego pominięty', () => {
    const { adresy, wskazniki } = scena([
      { dx: 0, dy: 0, cisza: 20, dojazd: 20, ulica: 'Długa', nr: '5' },
      { dx: 8, dy: 0, cisza: 100, dojazd: 100, ulica: 'Długa', nr: '5A' }, // ten sam budynek co 0
      { dx: 100, dy: 0, cisza: 100, dojazd: 100, ulica: 'Krótka', nr: '2' },
      { dx: 110, dy: 0, cisza: 100, dojazd: 100, ulica: 'Krótka', nr: '2B' }, // ten sam co 2
      { dx: 300, dy: 0, cisza: 100, dojazd: 100, ulica: 'Krótka', nr: '7' },
    ])
    const r = lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI })
    assert.deepEqual(indeksy(r), [2, 4])
  })

  it('klucz budynku z zewnątrz (obrysy) ma pierwszeństwo', () => {
    const { adresy, wskazniki } = scena([
      { dx: 0, dy: 0, cisza: 20, dojazd: 20 },
      { dx: 60, dy: 0, cisza: 100, dojazd: 100 },
      { dx: 90, dy: 0, cisza: 100, dojazd: 100 },
      { dx: 200, dy: 0, cisza: 100, dojazd: 100 },
    ])
    const budynek = ['a', 'b', 'b', 'c']
    const r = lepsiSasiedzi(
      0,
      adresy,
      wskazniki,
      { wagi: WAGI },
      {
        budynekAdresu: (i) => budynek[i] ?? null,
      },
    )
    assert.deepEqual(indeksy(r), [1, 3])
  })

  it('kandydat z niższą pewnością jest oznaczony', () => {
    const { adresy, wskazniki } = scena([
      { dx: 0, dy: 0, cisza: 20, dojazd: 20 },
      { dx: 50, dy: 0, cisza: 100, dojazd: null }, // pewność 0,5
      { dx: 100, dy: 0, cisza: 100, dojazd: 100 },
    ])
    const r = lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI })
    assert.equal(r.wyjsciowy.pewnosc, 1)
    const [a, b] = r.kandydaci
    assert.equal(a?.i, 1)
    assert.equal(a?.pewnosc, 0.5)
    assert.equal(a?.nizszaPewnosc, true)
    assert.equal(b?.nizszaPewnosc, false)
  })

  it('„co go wyróżnia”: 2 kategorie z największą przewagą, słowami', () => {
    const { adresy, wskazniki } = scena([
      { dx: 0, dy: 0, cisza: 20, dojazd: 20 }, // wkład 10 + 10
      { dx: 50, dy: 0, cisza: 100, dojazd: 30 }, // wkład 50 + 15
    ])
    const [k] = lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI }).kandydaci
    assert.deepEqual(
      k?.wyroznia.map((w) => [w.kategoria, w.opis]),
      [
        ['spokoj', 'znacznie ciszej i zdrowiej'],
        ['transport', 'wyraźnie lepszy dojazd komunikacją'],
      ],
    )
    for (const w of k?.wyroznia ?? []) assert.doesNotMatch(w.opis, /\d/)
  })

  it('kategoria gorsza albo szara nie wyróżnia', () => {
    const { adresy, wskazniki } = scena([
      { dx: 0, dy: 0, cisza: 20, dojazd: null },
      { dx: 50, dy: 0, cisza: 100, dojazd: 50 },
    ])
    const [k] = lepsiSasiedzi(0, adresy, wskazniki, { wagi: WAGI }).kandydaci
    assert.deepEqual(
      k?.wyroznia.map((w) => w.kategoria),
      ['spokoj'],
    )
  })
})
