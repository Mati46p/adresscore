// Inwarianty silnika luk (#89). Uruchom: node --test src/wynik/
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type {
  Adres,
  PlikAdresow,
  PlikOkolic,
  PlikWskaznika,
  WskaznikMeta,
} from '../kontrakty/index.ts'
import {
  JEDNOSTKA_LUKI,
  type LiczbyLuki,
  okolicaAdresu,
  PROGI_LUK,
  policzLuki,
  progLuki,
  stanLuki,
  type WynikLuk,
} from './luki.ts'
import { plikOkolic } from './okoliceTestowe.ts'
import { grupujHeksy, wskaznikNiedostepny } from './silnik.ts'

type AdresLuki = Pick<Adres, 'dzielnica' | 'gmina' | 'h3'>

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

const adresy: AdresLuki[] = [
  { dzielnica: 'I Stare Miasto', gmina: 'Kraków', h3: 'a' },
  { dzielnica: 'I Stare Miasto', gmina: 'Kraków', h3: 'a' },
  { dzielnica: 'I Stare Miasto', gmina: 'Kraków', h3: 'b' },
  { dzielnica: 'X Swoszowice', gmina: 'Kraków', h3: 'c' },
  { dzielnica: 'X Swoszowice', gmina: 'Kraków', h3: 'c' },
  { dzielnica: null, gmina: 'Liszki', h3: 'd' },
  { dzielnica: null, gmina: 'Liszki', h3: 'e' },
  { dzielnica: null, gmina: 'Zabierzów', h3: 'f' },
]
// 800 to próg włącznie (bez luki), 800,1 już w luce; null i NaN to brak danych.
const sklep = {
  meta: meta('sklep_odleglosc'),
  wartosci: [100, 800, 800.1, 2000, null, 1200, Number.NaN, null],
}

function sprawdzSume(l: LiczbyLuki, gdzie: string) {
  assert.equal(l.wLuce + l.bezLuki + l.brakDanych, l.wszystkie, gdzie)
}

function sprawdzWszystkieJednostki(w: WynikLuk, liczbaAdresow: number) {
  sprawdzSume(w.razem, 'razem')
  assert.equal(w.razem.wszystkie, liczbaAdresow)
  for (const o of w.okolice) sprawdzSume(o, o.id)
  for (const [h3, l] of w.heksy) sprawdzSume(l, h3)
  const suma = (lista: Iterable<LiczbyLuki>, pole: keyof Omit<LiczbyLuki, 'udzial'>) =>
    [...lista].reduce((s, l) => s + l[pole], 0)
  for (const pole of ['wszystkie', 'wLuce', 'bezLuki', 'brakDanych'] as const) {
    assert.equal(suma(w.okolice, pole), w.razem[pole], `okolice: ${pole}`)
    assert.equal(suma(w.heksy.values(), pole), w.razem[pole], `heksy: ${pole}`)
  }
}

describe('progi luk', () => {
  it('każdy próg ma źródło, opis i nagłówek z „adresy”', () => {
    for (const [id, p] of Object.entries(PROGI_LUK)) {
      assert.equal(p.id, id)
      assert.ok(Number.isFinite(p.prog) && p.prog > 0, id)
      assert.ok(p.zrodlo.length > 20, id)
      assert.ok(p.opis.length > 0, id)
      assert.match(p.naglowek, /^adresy /, id)
      assert.doesNotMatch(
        `${p.opis} ${p.naglowek} ${p.zrodlo}`,
        /—/,
        `${id}: pauza zamiast półpauzy`,
      )
    }
    assert.equal(JEDNOSTKA_LUKI, 'adresy')
  })

  it('progi z zadania: sklep 800 m, przystanek 500 m, schronienie 1 km, hałas 64 dB', () => {
    assert.equal(progLuki(meta('sklep_odleglosc'))?.prog, 800)
    assert.equal(progLuki(meta('przystanek_odleglosc'))?.prog, 500)
    assert.equal(progLuki(meta('punkt_schronienia_odleglosc'))?.prog, 1000)
    assert.equal(progLuki(meta('halas_ldwn', { jednostka: 'dB' }))?.prog, 64)
  })

  it('hałas bierze próg z meta.norma, gdy warstwa go ma', () => {
    const norma = { wartosc: 60, opis: 'Norma testowa', zrodlo: 'Przepis X' }
    const p = progLuki(meta('halas_ldwn', { jednostka: 'dB', norma }))
    assert.equal(p?.prog, 60)
    assert.match(p?.zrodlo ?? '', /Przepis X/)
    assert.match(p?.opis ?? '', /60 dB/)
  })

  it('warstwa bez progu i warstwa-atrapa nie mają progu', () => {
    assert.equal(progLuki(meta('pm25_srednia')), null)
    assert.equal(progLuki(meta('sklep_odleglosc', { atrapa: true })), null)
  })

  it('stan adresu: próg ostry, brak danych nigdy nie jest „bez luki”', () => {
    const p = PROGI_LUK.sklep_odleglosc as NonNullable<(typeof PROGI_LUK)[string]>
    assert.equal(stanLuki(800, p), 'bez-luki')
    assert.equal(stanLuki(800.1, p), 'w-luce')
    assert.equal(stanLuki(0, p), 'bez-luki')
    for (const w of [null, undefined, Number.NaN]) assert.equal(stanLuki(w, p), 'brak-danych')
  })
})

describe('okolice', () => {
  it('dzielnica Krakowa, a poza Krakowem cała gmina', () => {
    assert.deepEqual(okolicaAdresu({ dzielnica: 'VI Bronowice', gmina: 'Kraków' }), {
      id: 'dzielnica:VI Bronowice',
      nazwa: 'VI Bronowice',
      typ: 'dzielnica',
    })
    assert.deepEqual(okolicaAdresu({ dzielnica: null, gmina: 'Liszki' }), {
      id: 'gmina:Liszki',
      nazwa: 'Liszki',
      typ: 'gmina',
    })
  })
})

// Okolice z okolice.json (#185): id, nazwy i rodzaje z pliku, null = szara okolica „brak”.
describe('okolice z okolice.json', () => {
  // Adresy z `adresy` wyżej: 0–1 Stare Miasto, 2 Kazimierz, 3–4 Swoszowice, 5 Liszki, 6 Kaszów, 7 bez okolicy.
  const kolumna = [
    'sim-101',
    'sim-101',
    'sim-102',
    'sim-1002',
    'sim-1002',
    'm-1206063-liszki',
    'm-1206063-kaszow',
    null,
  ]
  const okolice = plikOkolic(kolumna)

  it('jednostka SIM: id, numer i dzielnica z pliku zamiast dzielnicy adresu', () => {
    const a = { dzielnica: 'I Stare Miasto', gmina: 'Kraków' }
    assert.deepEqual(okolicaAdresu(a, 2, okolice), {
      id: 'sim-102',
      nazwa: 'Kazimierz',
      typ: 'sim',
      numer: 'I.2',
      dzielnica: 'I Stare Miasto',
    })
  })

  it('miejscowość poza Krakowem niesie gminę (nazwy miejscowości powtarzają się między gminami)', () => {
    assert.deepEqual(okolicaAdresu({ dzielnica: null, gmina: 'Liszki' }, 5, okolice), {
      id: 'm-1206063-liszki',
      nazwa: 'Liszki',
      typ: 'miejscowosc',
      gmina: 'Liszki',
    })
  })

  it('null w kolumnie to okolica „brak” (szara), nie zero i nie zapas z dzielnicy', () => {
    const a = { dzielnica: 'I Stare Miasto', gmina: 'Kraków' }
    const brak = okolicaAdresu(a, 7, okolice)
    assert.equal(brak.id, 'brak')
    assert.equal(brak.typ, 'brak')
    // Adres poza kolumną (plik krótszy niż lista) też nie dostaje cudzej okolicy.
    assert.equal(okolicaAdresu(a, kolumna.length, okolice).id, 'brak')
  })

  it('bez pliku (null, undefined, brak indeksu) zapas: dzielnica albo gmina', () => {
    const a = { dzielnica: 'I Stare Miasto', gmina: 'Kraków' }
    for (const wynik of [
      okolicaAdresu(a, 0, null),
      okolicaAdresu(a, 0, undefined),
      okolicaAdresu(a, undefined, okolice),
    ]) {
      assert.deepEqual(wynik, {
        id: 'dzielnica:I Stare Miasto',
        nazwa: 'I Stare Miasto',
        typ: 'dzielnica',
      })
    }
  })

  it('ten sam adres daje ten sam obiekt (widoki okolic liczone raz na plik)', () => {
    const a = { dzielnica: 'I Stare Miasto', gmina: 'Kraków' }
    assert.equal(okolicaAdresu(a, 0, okolice), okolicaAdresu(a, 1, okolice))
  })
})

describe('policzLuki', () => {
  const w = policzLuki(sklep, adresy) as WynikLuk

  it('w każdej jednostce w luce + bez luki + brak danych = wszystkie adresy', () => {
    sprawdzWszystkieJednostki(w, adresy.length)
  })

  it('liczy okolice i udział od wszystkich adresów jednostki', () => {
    assert.deepEqual(w.razem, {
      wszystkie: 8,
      wLuce: 3,
      bezLuki: 2,
      brakDanych: 3,
      udzial: 3 / 8,
    })
    const okolica = (id: string) => w.okolice.find((o) => o.id === id)
    assert.deepEqual(okolica('dzielnica:I Stare Miasto'), {
      id: 'dzielnica:I Stare Miasto',
      nazwa: 'I Stare Miasto',
      typ: 'dzielnica',
      wszystkie: 3,
      wLuce: 1,
      bezLuki: 2,
      brakDanych: 0,
      udzial: 1 / 3,
    })
    // Podstawa = wszystkie adresy (2), nie adresy z danymi (1).
    assert.equal(okolica('dzielnica:X Swoszowice')?.udzial, 1 / 2)
    assert.equal(okolica('gmina:Liszki')?.udzial, 1 / 2)
  })

  it('jednostka bez żadnych danych jest szara (udział null), nie „bez luki”', () => {
    const zabierzow = w.okolice.find((o) => o.id === 'gmina:Zabierzów')
    assert.equal(zabierzow?.udzial, null)
    assert.equal(zabierzow?.bezLuki, 0)
    assert.equal(zabierzow?.brakDanych, 1)
    assert.equal(w.heksy.get('f')?.udzial, null)
  })

  it('okolice malejąco po liczbie adresów w luce', () => {
    for (let k = 1; k < w.okolice.length; k++) {
      assert.ok((w.okolice[k - 1]?.wLuce ?? 0) >= (w.okolice[k]?.wLuce ?? 0))
    }
  })

  it('z okolice.json: jednostki SIM i miejscowości, adres bez okolicy w szarej okolicy „brak”', () => {
    const okolice = plikOkolic([
      'sim-101',
      'sim-101',
      'sim-102',
      'sim-1002',
      'sim-1002',
      'm-1206063-liszki',
      'm-1206063-kaszow',
      null,
    ])
    const z = policzLuki(sklep, adresy, undefined, okolice) as WynikLuk
    sprawdzWszystkieJednostki(z, adresy.length)
    assert.deepEqual(
      z.razem,
      { wszystkie: 8, wLuce: 3, bezLuki: 2, brakDanych: 3, udzial: 3 / 8 },
      'razem nie zależy od podziału na okolice',
    )
    const okolica = (id: string) => z.okolice.find((o) => o.id === id)
    assert.deepEqual(okolica('sim-1002'), {
      id: 'sim-1002',
      nazwa: 'Swoszowice',
      typ: 'sim',
      numer: 'X.2',
      dzielnica: 'X Swoszowice',
      wszystkie: 2,
      wLuce: 1,
      bezLuki: 0,
      brakDanych: 1,
      udzial: 1 / 2,
    })
    assert.equal(okolica('sim-101')?.udzial, 0)
    assert.equal(okolica('sim-102')?.udzial, 1)
    assert.equal(okolica('m-1206063-liszki')?.typ, 'miejscowosc')
    // Same adresy bez danych w okolicy: szara (udział null), nie „bez luki”.
    assert.equal(okolica('m-1206063-kaszow')?.udzial, null)
    const brak = okolica('brak')
    assert.equal(brak?.typ, 'brak')
    assert.equal(brak?.wszystkie, 1)
    assert.equal(brak?.udzial, null)
    // Zapas dzielnica/gmina nie miesza się z id z pliku.
    assert.ok(!z.okolice.some((o) => o.id.startsWith('dzielnica:') || o.id.startsWith('gmina:')))
  })

  it('plik okolic nie zmienia heksów ani sum, tylko podział na okolice', () => {
    const okolice = plikOkolic([
      'sim-101',
      'sim-101',
      'sim-101',
      'sim-1002',
      'sim-1002',
      null,
      null,
      null,
    ])
    const z = policzLuki(sklep, adresy, undefined, okolice) as WynikLuk
    assert.deepEqual([...z.heksy], [...w.heksy])
    assert.deepEqual(z.razem, w.razem)
    assert.deepEqual(
      z.okolice.map((o) => o.wszystkie).sort((x, y) => x - y),
      [2, 3, 3],
    )
  })

  it('okolice: null i undefined dają to samo co brak pliku (zapas)', () => {
    assert.deepEqual(policzLuki(sklep, adresy, undefined, null)?.okolice, w.okolice)
    assert.deepEqual(policzLuki(sklep, adresy, undefined, undefined)?.okolice, w.okolice)
  })

  it('heksy z grupami z useDane i bez nich dają to samo', () => {
    const grupy = grupujHeksy(adresy.map((a) => a.h3))
    const zGrupami = policzLuki(sklep, adresy, grupy) as WynikLuk
    assert.deepEqual([...zGrupami.heksy], [...w.heksy])
    assert.deepEqual(w.heksy.get('a'), {
      wszystkie: 2,
      wLuce: 0,
      bezLuki: 2,
      brakDanych: 0,
      udzial: 0,
    })
  })

  it('nie zależy od kierunku ani kategorii warstwy', () => {
    const odwrocony = { ...sklep, meta: meta('sklep_odleglosc', { kierunek: 'wiecej-lepiej' }) }
    const kontekst = { ...sklep, meta: meta('sklep_odleglosc', { kategoria: 'kontekst' }) }
    assert.deepEqual(policzLuki(odwrocony, adresy)?.okolice, w.okolice)
    assert.deepEqual(policzLuki(kontekst, adresy)?.okolice, w.okolice)
  })

  it('warstwa-atrapa nie daje wyniku', () => {
    assert.equal(
      policzLuki({ ...sklep, meta: meta('sklep_odleglosc', { atrapa: true }) }, adresy),
      null,
    )
  })

  it('warstwa bez progu nie daje wyniku', () => {
    assert.equal(policzLuki({ ...sklep, meta: meta('apteka_odleglosc') }, adresy), null)
  })

  it('niedostępny plik i krótsze wartości dają brak danych, nie „bez luki”', () => {
    const niedostepny = wskaznikNiedostepny(meta('przystanek_odleglosc'), adresy.length, 'błąd 404')
    const wn = policzLuki(niedostepny, adresy) as WynikLuk
    sprawdzWszystkieJednostki(wn, adresy.length)
    assert.equal(wn.razem.brakDanych, adresy.length)
    assert.equal(wn.razem.udzial, null)
    assert.equal(wn.niedostepny, 'błąd 404')

    const krotki = policzLuki(
      { meta: meta('sklep_odleglosc'), wartosci: [900] },
      adresy,
    ) as WynikLuk
    sprawdzWszystkieJednostki(krotki, adresy.length)
    assert.equal(krotki.razem.wLuce, 1)
    assert.equal(krotki.razem.brakDanych, adresy.length - 1)
  })
})

describe('policzLuki na prawdziwych danych', () => {
  const czytaj = <T>(sciezka: string): T =>
    JSON.parse(readFileSync(new URL(`../../public/dane/${sciezka}`, import.meta.url), 'utf8'))
  const plikAdresow = czytaj<PlikAdresow>('adresy.json')
  const k = plikAdresow.kolumny
  const prawdziwe: AdresLuki[] = k.id.map((_, i) => ({
    dzielnica: k.dzielnica[i] ?? null,
    gmina: k.gmina[i] ?? '',
    h3: k.h3[i] ?? '',
  }))
  const grupy = grupujHeksy(k.h3)
  const okolice = czytaj<PlikOkolic>('okolice.json')

  for (const id of Object.keys(PROGI_LUK)) {
    it(`${id}: z okolice.json 123 jednostki SIM i miejscowości, liczba adresów jak w pliku`, () => {
      const plik = czytaj<PlikWskaznika>(`wskazniki/${id}.json`)
      const w = policzLuki(plik, prawdziwe, grupy, okolice)
      if (plik.meta.atrapa) {
        assert.equal(w, null)
        return
      }
      assert.ok(w)
      sprawdzWszystkieJednostki(w, prawdziwe.length)
      assert.equal(w.okolice.filter((o) => o.typ === 'sim').length, 123)
      assert.ok(w.okolice.some((o) => o.typ === 'miejscowosc'))
      // Każdy adres ma okolicę z pliku: ani zapasu z dzielnicy, ani szarej okolicy „brak”.
      assert.ok(w.okolice.every((o) => o.typ === 'sim' || o.typ === 'miejscowosc'))
      for (const o of w.okolice) {
        assert.equal(o.wszystkie, okolice.okolice[o.id]?.liczbaAdresow, o.id)
      }
    })

    it(`${id}: sumy się zgadzają w każdej okolicy i heksie`, () => {
      const plik = czytaj<PlikWskaznika>(`wskazniki/${id}.json`)
      assert.equal(plik.wersjaAdresow, plikAdresow.wersja)
      const w = policzLuki(plik, prawdziwe, grupy)
      if (plik.meta.atrapa) {
        assert.equal(w, null)
        return
      }
      assert.ok(w)
      sprawdzWszystkieJednostki(w, prawdziwe.length)
      assert.equal(w.heksy.size, grupy.heksy.length)
      // 18 dzielnic Krakowa + gminy obwarzanka.
      assert.equal(w.okolice.filter((o) => o.typ === 'dzielnica').length, 18)
      assert.ok(w.okolice.some((o) => o.typ === 'gmina'))
    })
  }
})
