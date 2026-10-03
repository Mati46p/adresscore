// Inwarianty symulatora inwestycji (#96, #98). Uruchom: node --test src/wynik/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Adres, WskaznikMeta } from '../kontrakty/index.ts'
import { policzLuki, progLuki, stanLuki } from './luki.ts'
import {
  grupujHeksy,
  literaZWyniku,
  przygotujWskaznik,
  sumyWyniku,
  type Wagi,
  type WskaznikPrzygotowany,
} from './silnik.ts'
import {
  type BazaSymulacji,
  definicjaObiektu,
  type Obiekt,
  przygotujBaze,
  symuluj,
  TYPY_OBIEKTOW,
  type WynikSymulacji,
} from './symulacja.ts'

type AdresSym = Pick<Adres, 'lon' | 'lat' | 'dzielnica' | 'gmina' | 'h3'>

function meta(id: string, dodatki: Partial<WskaznikMeta> = {}): WskaznikMeta {
  return {
    id,
    kategoria: 'codziennosc',
    nazwa: id,
    opis: '',
    jednostka: 'm',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zrodla: [],
    zadanie: 0,
    ...dodatki,
  }
}

const RYNEK = { lon: 19.9372, lat: 50.0614 }
const M_LAT = 1 / 111_320
const M_LON = 1 / (111_320 * Math.cos((RYNEK.lat * Math.PI) / 180))

function odleglosc(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** Generator liczb pseudolosowych z ziarnem – testy powtarzalne. */
function losowe(ziarno: number) {
  let s = ziarno >>> 0
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0
    return s / 2 ** 32
  }
}

interface Miasto {
  adresy: AdresSym[]
  wskazniki: WskaznikPrzygotowany[]
  wagi: Wagi
}

/**
 * Siatka `bok × bok` adresów co `krok` m wokół Rynku, trzy dzielnice pasami. Istniejące
 * przystanki, przedszkola i punkty schronienia w kilku miejscach; odległości policzone naprawdę,
 * część adresów bez danych.
 */
function miasto(bok: number, krok: number, ziarno = 7): Miasto {
  const los = losowe(ziarno)
  const adresy: AdresSym[] = []
  for (let y = 0; y < bok; y++) {
    for (let x = 0; x < bok; x++) {
      const dx = (x - bok / 2) * krok
      const dy = (y - bok / 2) * krok
      adresy.push({
        lon: RYNEK.lon + dx * M_LON,
        lat: RYNEK.lat + dy * M_LAT,
        dzielnica: x < bok / 3 ? 'VI Bronowice' : x < (2 * bok) / 3 ? 'I Stare Miasto' : null,
        gmina: x < (2 * bok) / 3 ? 'Kraków' : 'Wieliczka',
        h3: `h${Math.floor(x / 3)}_${Math.floor(y / 3)}`,
      })
    }
  }
  const punkty = (liczba: number) =>
    Array.from({ length: liczba }, () => ({
      lon: RYNEK.lon + (los() - 0.5) * bok * krok * M_LON,
      lat: RYNEK.lat + (los() - 0.5) * bok * krok * M_LAT,
    }))
  const najblizszy = (ps: { lon: number; lat: number }[], a: AdresSym) =>
    Math.min(...ps.map((p) => odleglosc(p.lon, p.lat, a.lon, a.lat)))
  const przystanki = punkty(6)
  const przedszkola = punkty(4)
  const schrony = punkty(2)
  const pliki = [
    {
      meta: meta('przystanek_odleglosc', { kategoria: 'transport', zakres: [0, 1500] }),
      wartosci: adresy.map((a, i) => (i % 97 === 0 ? null : najblizszy(przystanki, a))),
    },
    {
      meta: meta('przedszkole_odleglosc', { zakres: [0, 1500] }),
      wartosci: adresy.map((a) => najblizszy(przedszkola, a)),
    },
    {
      meta: meta('przychodnia_odleglosc', { zakres: [0, 3000] }),
      wartosci: adresy.map(() => 200 + los() * 2500),
    },
    {
      meta: meta('punkt_schronienia_odleglosc', {
        kategoria: 'kontekst',
        kierunek: 'neutralny',
        zakres: [0, 6000],
      }),
      // Gmina bez danych KG PSP – szara, nie zero.
      wartosci: adresy.map((a) => (a.dzielnica ? najblizszy(schrony, a) : null)),
    },
    {
      meta: meta('zielen', { kierunek: 'wiecej-lepiej', jednostka: '%' }),
      wartosci: adresy.map(() => Math.round(los() * 100)),
    },
  ]
  return {
    adresy,
    wskazniki: pliki.map((p) => przygotujWskaznik({ ...p, wersjaAdresow: 'test' })),
    wagi: {
      przystanek_odleglosc: 4,
      przedszkole_odleglosc: 3,
      przychodnia_odleglosc: 2,
      zielen: 2,
    },
  }
}

function baza(m: Miasto): BazaSymulacji {
  return przygotujBaze({
    adresy: m.adresy,
    grupy: grupujHeksy(m.adresy.map((a) => a.h3)),
    wskazniki: m.wskazniki,
    wagi: m.wagi,
  })
}

/** Pełne przeliczenie: każda warstwa od nowa ze starą skalą – wzorzec dla przyrostu. */
function pelnePrzeliczenie(m: Miasto, obiekty: readonly Obiekt[]) {
  const nowe = m.wskazniki.map((w): WskaznikPrzygotowany => {
    const moje = obiekty.filter((o) => definicjaObiektu(o.typ).warstwa === w.meta.id)
    if (moje.length === 0) return w
    const wartosci = w.wartosci.map((v, i) => {
      if (v === null) return null
      const a = m.adresy[i] as AdresSym
      return Math.min(v, ...moje.map((o) => odleglosc(o.lon, o.lat, a.lon, a.lat)))
    })
    return { ...w, wartosci }
  })
  const n = m.adresy.length
  const przed = sumyWyniku(m.wskazniki, m.wagi, undefined, n)
  const po = sumyWyniku(nowe, m.wagi, undefined, n)
  const litera = (s: { suma: Float64Array; sumaWag: Float64Array }, i: number) =>
    literaZWyniku(
      (s.sumaWag[i] as number) > 0 ? (s.suma[i] as number) / (s.sumaWag[i] as number) : null,
    )
  return { nowe, przed, po, litera }
}

const KOLEJNOSC = 'ABCDEFG'

describe('symulacja – przyrost zgodny z pełnym przeliczeniem (#96)', () => {
  const m = miasto(60, 40)
  const b = baza(m)
  const obiekty: Obiekt[] = [
    { typ: 'przystanek', lon: RYNEK.lon + 300 * M_LON, lat: RYNEK.lat - 200 * M_LAT },
    { typ: 'przystanek', lon: RYNEK.lon - 600 * M_LON, lat: RYNEK.lat + 500 * M_LAT },
    { typ: 'przedszkole', lon: RYNEK.lon - 900 * M_LON, lat: RYNEK.lat - 900 * M_LAT },
    { typ: 'schron', lon: RYNEK.lon - 500 * M_LON, lat: RYNEK.lat },
  ]
  const wynik = symuluj(b, obiekty)
  const pelne = pelnePrzeliczenie(m, obiekty)

  it('awans i spadek liter jak w pełnym przeliczeniu', () => {
    let awans = 0
    let spadek = 0
    for (let i = 0; i < m.adresy.length; i++) {
      const p = pelne.litera(pelne.przed, i)
      const q = pelne.litera(pelne.po, i)
      if (p === null || q === null) continue
      const r = KOLEJNOSC.indexOf(p) - KOLEJNOSC.indexOf(q)
      if (r > 0) awans++
      if (r < 0) spadek++
    }
    assert.ok(awans > 0, 'scenariusz musi coś zmieniać')
    assert.equal(wynik.awans, awans)
    assert.equal(wynik.spadek, spadek)
  })

  it('wyjście z luki jak w pełnym przeliczeniu', () => {
    for (const l of wynik.luki) {
      const stara = m.wskazniki.find((w) => w.meta.id === l.warstwa) as WskaznikPrzygotowany
      const nowa = pelne.nowe.find((w) => w.meta.id === l.warstwa) as WskaznikPrzygotowany
      let wychodzi = 0
      for (let i = 0; i < m.adresy.length; i++) {
        if (
          stanLuki(stara.wartosci[i], l.prog) === 'w-luce' &&
          stanLuki(nowa.wartosci[i], l.prog) === 'bez-luki'
        )
          wychodzi++
      }
      assert.equal(l.wychodzi, wychodzi, l.warstwa)
      assert.equal(l.przed, policzLuki(stara, m.adresy)?.razem.wLuce)
    }
    assert.deepEqual(wynik.luki.map((l) => l.warstwa).sort(), [
      'przedszkole_odleglosc',
      'przystanek_odleglosc',
      'punkt_schronienia_odleglosc',
    ])
  })

  it('heksy: luki i średni wynik jak w pełnym przeliczeniu', () => {
    for (const id of ['przystanek_odleglosc', 'przedszkole_odleglosc']) {
      const nowa = pelne.nowe.find((w) => w.meta.id === id) as WskaznikPrzygotowany
      const wzor = policzLuki(nowa, m.adresy)
      assert.ok(wzor)
      for (const [h3, h] of wynik.heksy) assert.deepEqual(h.luki[id], wzor.heksy.get(h3), h3)
    }
    const grupy = grupujHeksy(m.adresy.map((a) => a.h3))
    for (const [h3, h] of wynik.heksy) {
      let suma = 0
      let liczba = 0
      for (let i = 0; i < m.adresy.length; i++) {
        if (grupy.heksy[grupy.indeksHeksu[i] as number] !== h3) continue
        const sw = pelne.po.sumaWag[i] as number
        if (sw > 0) {
          suma += (pelne.po.suma[i] as number) / sw
          liczba++
        }
      }
      assert.ok(h.wynik !== null && Math.abs(h.wynik - suma / liczba) < 1e-9, h3)
    }
  })

  it('adres poza zasięgiem: nietknięty, jego heks bez zmian', () => {
    // Zmiana pomiaru z pełnego przeliczenia = dokładnie adresy, które silnik dotknął.
    const zmienioneAdresy = new Set<number>()
    for (const w of pelne.nowe) {
      const stara = m.wskazniki.find((x) => x.meta.id === w.meta.id) as WskaznikPrzygotowany
      for (let i = 0; i < m.adresy.length; i++) {
        const a = stara.wartosci[i]
        const n = w.wartosci[i]
        if (a === null || n === null || a === n) continue
        // Poza zasięgiem warstwy zmiana pomiaru niczego nie rusza (próg i koniec skali niżej).
        const ws = b.warstwy[w.meta.id]
        if (ws && (n as number) <= ws.zasiegM) zmienioneAdresy.add(i)
      }
    }
    assert.equal(wynik.zasieg, zmienioneAdresy.size)
    const heksyZmian = new Set([...zmienioneAdresy].map((i) => (m.adresy[i] as AdresSym).h3))
    assert.deepEqual(new Set(wynik.heksy.keys()), heksyZmian)
  })

  it('adres z brakiem danych zostaje bez danych', () => {
    const przystanek = m.wskazniki[0] as WskaznikPrzygotowany
    const zNullem = m.adresy.findIndex((_, i) => przystanek.wartosci[i] === null)
    assert.ok(zNullem >= 0)
    const a = m.adresy[zNullem] as AdresSym
    const tuz = symuluj(b, [{ typ: 'przystanek', lon: a.lon, lat: a.lat }])
    const nowa = pelnePrzeliczenie(m, [{ typ: 'przystanek', lon: a.lon, lat: a.lat }]).nowe[0]
    assert.equal(nowa?.wartosci[zNullem], null)
    // Brak danych liczy się w szarej grupie heksu, nie w „bez luki”.
    const h = tuz.heksy.get(a.h3)
    assert.ok(h)
    assert.ok((h.luki.przystanek_odleglosc?.brakDanych ?? 0) >= 1)
  })
})

describe('symulacja – obiekt nie pogarsza (#96)', () => {
  const m = miasto(40, 50, 11)
  const b = baza(m)
  it('przy domyślnych kierunkach nikt nie spada, adres przy obiekcie nie traci', () => {
    for (const def of TYPY_OBIEKTOW) {
      for (const [dx, dy] of [
        [0, 0],
        [400, -300],
        [-700, 650],
      ] as const) {
        const o = { typ: def.typ, lon: RYNEK.lon + dx * M_LON, lat: RYNEK.lat + dy * M_LAT }
        const w = symuluj(b, [o])
        assert.equal(w.spadek, 0, `${def.typ} ${dx},${dy}`)
      }
    }
  })
  it('pusta lista obiektów = stan bazowy', () => {
    const w = symuluj(b, [])
    assert.equal(w.zasieg, 0)
    assert.equal(w.awans, 0)
    assert.equal(w.heksy.size, 0)
  })
})

describe('bilans domyka się (#98)', () => {
  const m = miasto(50, 45, 3)
  const b = baza(m)
  const scenariusze: Obiekt[][] = [
    [{ typ: 'przystanek', lon: RYNEK.lon, lat: RYNEK.lat }],
    [
      { typ: 'przedszkole', lon: RYNEK.lon - 800 * M_LON, lat: RYNEK.lat + 100 * M_LAT },
      { typ: 'przedszkole', lon: RYNEK.lon + 800 * M_LON, lat: RYNEK.lat - 100 * M_LAT },
      { typ: 'przystanek', lon: RYNEK.lon + 200 * M_LON, lat: RYNEK.lat + 900 * M_LAT },
      { typ: 'schron', lon: RYNEK.lon - 300 * M_LON, lat: RYNEK.lat - 300 * M_LAT },
    ],
  ]
  const sprawdz = (w: WynikSymulacji) => {
    assert.equal(
      w.okolice.reduce((s, o) => s + o.awans, 0),
      w.awans,
      'suma awansów po okolicach',
    )
    assert.equal(
      w.okolice.reduce((s, o) => s + o.spadek, 0),
      w.spadek,
    )
    for (const l of w.luki) {
      assert.equal(
        w.okolice.reduce((s, o) => s + (o.wychodzi[l.warstwa] ?? 0), 0),
        l.wychodzi,
        `wyjście z luki ${l.warstwa}`,
      )
    }
    for (const h of w.heksy.values()) {
      for (const l of Object.values(h.luki)) {
        assert.equal(l.wLuce + l.bezLuki + l.brakDanych, l.wszystkie)
      }
    }
  }
  for (const [n, s] of scenariusze.entries()) {
    it(`scenariusz ${n + 1}: suma okolic = nagłówek`, () => sprawdz(symuluj(b, s)))
  }
  it('okolice poza Krakowem liczą się jako gmina', () => {
    const w = symuluj(b, scenariusze[1] as Obiekt[])
    assert.ok(w.okolice.every((o) => o.id === `${o.typ}:${o.nazwa}`))
  })
})

describe('warstwy niedostępne', () => {
  it('typ obiektu z warstwą-atrapą albo bez pliku jest wyłączony z powodem', () => {
    const m = miasto(10, 50)
    const bez = m.wskazniki.filter((w) => w.meta.id !== 'przedszkole_odleglosc')
    const atrapa = bez.map((w) =>
      w.meta.id === 'przystanek_odleglosc' ? { ...w, meta: { ...w.meta, atrapa: true } } : w,
    )
    const b = przygotujBaze({
      adresy: m.adresy,
      grupy: grupujHeksy(m.adresy.map((a) => a.h3)),
      wskazniki: atrapa,
      wagi: m.wagi,
    })
    assert.match(b.wylaczone.przedszkole ?? '', /brak warstwy/)
    assert.match(b.wylaczone.przystanek ?? '', /atrapa/)
    assert.equal(symuluj(b, [{ typ: 'przedszkole', lon: RYNEK.lon, lat: RYNEK.lat }]).zasieg, 0)
  })
  it('punkt zdrowia nie ma progu luki – tylko litery', () => {
    assert.equal(progLuki(meta('przychodnia_odleglosc')), null)
  })
})

describe('wydajność (#96: < 200 ms dla obiektu w centrum)', () => {
  it('176 tys. adresów, przystanek na Rynku', () => {
    // ~420 × 420 adresów co 25 m ≈ gęstość śródmieścia, 176 tys. jak w adresy.json.
    const m = miasto(420, 25, 5)
    const b = baza(m)
    const obiekty: Obiekt[] = [{ typ: 'przystanek', lon: RYNEK.lon, lat: RYNEK.lat }]
    symuluj(b, obiekty) // rozgrzewka JIT
    const t0 = performance.now()
    const w = symuluj(b, obiekty)
    const ms = performance.now() - t0
    assert.ok(w.zasieg > 1000)
    assert.ok(ms < 200, `${ms.toFixed(1)} ms`)
  })
})
