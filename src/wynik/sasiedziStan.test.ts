// Wspólny stan „Lepszego sąsiada” (#94). Uruchom: node --test src/wynik/
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { latLngToCell } from 'h3-js'
import type { KategoriaId, PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import type { AdresSasiada } from './sasiedzi.ts'
import {
  etykietaAdresu,
  otworzKarteSasiada,
  otworzSasiadow,
  pobierzStanSasiadow,
  policzSasiadow,
  porownajZSasiadem,
  propsSasiadowMapy,
  przelaczSasiadow,
  sasiedziOtwartej,
  subskrybujSasiadow,
  type WejscieSasiadow,
  wybierzSasiada,
  wybranyKandydat,
  zamknijSasiadow,
} from './sasiedziStan.ts'
import { przygotujWskaznik } from './silnik.ts'
import { dodajDoPorownania, pobierzStan, przejdz, wyczyscPorownanie } from './stan.ts'

const LON = 19.937
const LAT = 50.0617
const M_LAT = 1 / 111_195
const M_LON = 1 / (111_195 * Math.cos(LAT * (Math.PI / 180)))

function meta(id: string, kategoria: KategoriaId): WskaznikMeta {
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
  }
}

/** [dx, dy, cisza] – metry od Rynku; adres 0 jest wyjściowy. */
function scena(punkty: [number, number, number | null][]): WejscieSasiadow {
  const adresy: AdresSasiada[] = punkty.map(([dx, dy], i) => {
    const lon = LON + dx * M_LON
    const lat = LAT + dy * M_LAT
    return {
      lon,
      lat,
      h3: latLngToCell(lat, lon, 10),
      miejscowosc: 'Kraków',
      ulica: `Ulica ${i}`,
      nr: '1',
    }
  })
  const plik: PlikWskaznika = {
    meta: meta('cisza', 'spokoj'),
    wersjaAdresow: 'x',
    wartosci: punkty.map((p) => p[2]),
  }
  return {
    adresy,
    wskazniki: [przygotujWskaznik(plik)],
    wagi: { cisza: 2 },
    kierunki: {},
    filtry: [],
  }
}

// 0: wynik 50 (D); 1: 90 (A) 100 m; 2: 75 (B) 200 m; 3: 95 (A) 800 m – za daleko.
const SCENA = scena([
  [0, 0, 50],
  [100, 0, 90],
  [0, 200, 75],
  [800, 0, 95],
])

beforeEach(() => {
  zamknijSasiadow()
  wyczyscPorownanie()
})

describe('stan sekcji', () => {
  it('otwiera, podświetla i zamyka; zamknięcie czyści podświetlenie', () => {
    let powiadomienia = 0
    const odpisz = subskrybujSasiadow(() => powiadomienia++)
    otworzSasiadow(0)
    wybierzSasiada(1)
    assert.deepEqual(pobierzStanSasiadow(), { zrodlo: 0, wybrany: 1 })
    zamknijSasiadow()
    assert.deepEqual(pobierzStanSasiadow(), { zrodlo: null, wybrany: null })
    assert.equal(powiadomienia, 3)
    zamknijSasiadow()
    assert.equal(powiadomienia, 3, 'brak zmiany = brak powiadomienia')
    odpisz()
  })

  it('przełącznik otwiera i zamyka sekcję dla tego samego adresu', () => {
    przelaczSasiadow(0)
    assert.equal(pobierzStanSasiadow().zrodlo, 0)
    przelaczSasiadow(0)
    assert.equal(pobierzStanSasiadow().zrodlo, null)
  })

  it('nowy adres zeruje podświetlenie', () => {
    otworzSasiadow(0)
    wybierzSasiada(2)
    otworzSasiadow(5)
    assert.deepEqual(pobierzStanSasiadow(), { zrodlo: 5, wybrany: null })
  })
})

describe('lista kandydatów', () => {
  it('zamknięta sekcja albo inny wybrany adres = brak listy', () => {
    assert.equal(sasiedziOtwartej(pobierzStanSasiadow(), 0, SCENA), null)
    otworzSasiadow(0)
    assert.equal(sasiedziOtwartej(pobierzStanSasiadow(), 1, SCENA), null)
    assert.equal(sasiedziOtwartej(pobierzStanSasiadow(), 0, null), null)
    const wynik = sasiedziOtwartej(pobierzStanSasiadow(), 0, SCENA)
    assert.deepEqual(
      wynik?.kandydaci.map((k) => k.i),
      [1, 2],
    )
  })

  it('te same wejścia dają ten sam obiekt, nowe wagi liczą od nowa', () => {
    const a = policzSasiadow(0, SCENA)
    assert.equal(policzSasiadow(0, { ...SCENA }), a)
    const b = policzSasiadow(0, { ...SCENA, wagi: { cisza: 4 } })
    assert.notEqual(b, a)
    // Waga 0 = brak liczonych warstw → adres bez wyniku → pusta lista (na żywo).
    assert.deepEqual(policzSasiadow(0, { ...SCENA, wagi: { cisza: 0 } }).kandydaci, [])
  })

  it('filtr przelicza listę na żywo', () => {
    const zFiltrem = policzSasiadow(0, {
      ...SCENA,
      filtry: [{ id: 'cisza', warunek: 'max', prog: 80 }],
    })
    assert.deepEqual(
      zFiltrem.kandydaci.map((k) => k.i),
      [2],
    )
  })

  it('podświetlenie poza skróconą listą znika', () => {
    const wynik = policzSasiadow(0, SCENA)
    assert.equal(wybranyKandydat({ zrodlo: 0, wybrany: 1 }, wynik), 1)
    assert.equal(wybranyKandydat({ zrodlo: 0, wybrany: 5 }, wynik), null)
    assert.equal(wybranyKandydat({ zrodlo: 0, wybrany: 1 }, null), null)
  })
})

describe('propsy mapy (#95)', () => {
  it('zamknięta sekcja = brak znaczników i środka', () => {
    const p = propsSasiadowMapy(pobierzStanSasiadow(), null, SCENA.adresy)
    assert.deepEqual(p.kandydaci, [])
    assert.equal(p.srodek, null)
    assert.equal(p.wybrany, null)
    assert.equal(p.promienM, 500)
  })

  it('otwarta sekcja daje kandydatów z położeniem, literą i etykietą', () => {
    otworzSasiadow(0)
    wybierzSasiada(1)
    const s = pobierzStanSasiadow()
    const wynik = sasiedziOtwartej(s, 0, SCENA)
    const p = propsSasiadowMapy(s, wynik, SCENA.adresy)
    const a0 = SCENA.adresy[0] as AdresSasiada
    const a1 = SCENA.adresy[1] as AdresSasiada
    assert.deepEqual(p.srodek, { lon: a0.lon, lat: a0.lat })
    assert.deepEqual(p.kandydaci[0], {
      adres: 1,
      lon: a1.lon,
      lat: a1.lat,
      litera: 'A',
      etykieta: 'Ulica 1 1, Kraków',
    })
    assert.equal(p.kandydaci[1]?.litera, 'B')
    assert.equal(p.wybrany, 1)
    assert.equal(propsSasiadowMapy(s, wynik, SCENA.adresy).kandydaci, p.kandydaci, 'stała lista')
  })

  it('onWybierz podświetla, onOtworz otwiera kartę kandydata i zamyka sekcję', () => {
    otworzSasiadow(0)
    const wynik = sasiedziOtwartej(pobierzStanSasiadow(), 0, SCENA)
    const p = propsSasiadowMapy(pobierzStanSasiadow(), wynik, SCENA.adresy)
    p.onWybierz(0)
    assert.equal(pobierzStanSasiadow().wybrany, 0)
    p.onOtworz(1)
    assert.deepEqual(pobierzStanSasiadow(), { zrodlo: null, wybrany: null })
    assert.equal(pobierzStan().wybrany, 2)
    assert.equal(pobierzStan().ekran, 'okolica')
  })
})

describe('akcje karty', () => {
  it('„Otwórz kartę” zamyka sekcję i pokazuje kandydata', () => {
    otworzSasiadow(0)
    otworzKarteSasiada(1)
    assert.equal(pobierzStanSasiadow().zrodlo, null)
    assert.equal(pobierzStan().wybrany, 1)
  })

  it('„Porównaj” dodaje oba adresy i przechodzi do Porównania', () => {
    przejdz('okolica')
    assert.equal(porownajZSasiadem(0, 1), 'dodano')
    assert.deepEqual(pobierzStan().porownanie, [0, 1])
    assert.equal(pobierzStan().ekran, 'porownanie')
    assert.equal(porownajZSasiadem(0, 1), 'dodano', 'bez duplikatów')
    assert.deepEqual(pobierzStan().porownanie, [0, 1])
  })

  it('pełne Porównanie nic nie zmienia', () => {
    przejdz('okolica')
    for (const i of [10, 11, 12, 13]) dodajDoPorownania(i)
    assert.equal(porownajZSasiadem(0, 1), 'pelne')
    assert.deepEqual(pobierzStan().porownanie, [10, 11, 12, 13])
    assert.equal(pobierzStan().ekran, 'okolica')
    // Adres wyjściowy już na liście → mieści się tylko kandydat.
    wyczyscPorownanie()
    for (const i of [0, 11, 12, 13]) dodajDoPorownania(i)
    assert.equal(porownajZSasiadem(0, 1), 'dodano')
    assert.deepEqual(pobierzStan().porownanie, [0, 11, 12, 13, 1])
  })

  it('etykieta adresu bez ulicy', () => {
    assert.equal(etykietaAdresu({ ulica: null, nr: '7', miejscowosc: 'Zabierzów' }), 'Zabierzów 7')
  })
})
