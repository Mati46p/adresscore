// Ranking „Gdzie miasto ma luki” (#91). Uruchom: node --test src/wynik/
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { Adres, PlikAdresow, PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import { type LukaOkolicy, PROGI_LUK, policzLuki, type WynikLuk } from './luki.ts'
import {
  kierunekRankingu,
  odmianaAdresow,
  pasekLuki,
  podstawaUdzialu,
  posortujOkolice,
  procentUdzialu,
  rankingLuk,
  rozdzielczoscWarstwy,
  type SortowanieLuk,
  sumaWLuce,
  zrodlaWarstwy,
} from './rankingLuk.ts'
import { grupujHeksy } from './silnik.ts'

type AdresLuki = Pick<Adres, 'dzielnica' | 'gmina' | 'h3'>
const SORTOWANIA: SortowanieLuk[] = ['liczba', 'udzial']

function meta(id: string, dodatki: Partial<WskaznikMeta> = {}): WskaznikMeta {
  return {
    id,
    kategoria: 'transport',
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

function okolica(nazwa: string, wLuce: number, bezLuki: number, brakDanych: number): LukaOkolicy {
  const wszystkie = wLuce + bezLuki + brakDanych
  return {
    id: `dzielnica:${nazwa}`,
    nazwa,
    typ: 'dzielnica',
    wszystkie,
    wLuce,
    bezLuki,
    brakDanych,
    udzial: wLuce + bezLuki > 0 ? wLuce / wszystkie : null,
  }
}

/** Warunek „gotowe” z #91: suma kolumny „w luce” = liczba w nagłówku panelu. */
function sprawdzSumeNaglowka(w: WynikLuk) {
  for (const s of SORTOWANIA) {
    const r = rankingLuk(w, s)
    assert.equal(sumaWLuce(r.wiersze), r.naglowek.wLuce, `sortowanie ${s}`)
    assert.equal(r.wiersze.length, w.okolice.length, `sortowanie ${s}: żadna okolica nie znika`)
    assert.equal(
      r.wiersze.reduce((x, o) => x + o.wszystkie, 0),
      r.naglowek.wszystkie,
      `sortowanie ${s}: podstawa`,
    )
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
const przystanek = {
  meta: meta('przystanek_odleglosc'),
  wartosci: [100, 600, 700, 2000, null, 1200, 900, null],
}

describe('rankingLuk – suma i nagłówek', () => {
  const w = policzLuki(przystanek, adresy) as WynikLuk

  it('suma kolumny „w luce” = liczba w nagłówku panelu (oba sortowania)', () => {
    sprawdzSumeNaglowka(w)
    assert.equal(rankingLuk(w, 'liczba').naglowek.wLuce, 5)
  })

  it('nagłówek: liczba z odmianą, kierunek słowami, podstawa „z N adresów”', () => {
    const r = rankingLuk(w, 'liczba')
    assert.equal(r.naglowek.podpis, 'adresów bez przystanku w 500 m')
    assert.equal(r.naglowek.podstawa, 'z 8 adresów')
    assert.equal(r.kierunek, 'Od góry: najwięcej adresów bez przystanku w 500 m')
    assert.equal(
      rankingLuk(w, 'udzial').kierunek,
      'Od góry: największy udział adresów bez przystanku w 500 m',
    )
  })

  it('wiersze niosą id okolicy dla mapy (#90)', () => {
    const ids = rankingLuk(w, 'liczba').wiersze.map((o) => o.id)
    assert.ok(ids.includes('dzielnica:I Stare Miasto'))
    assert.ok(ids.includes('gmina:Liszki'))
  })

  it('bez myślnika-pauzy w tekstach', () => {
    const r = rankingLuk(w, 'udzial')
    assert.doesNotMatch(`${r.kierunek} ${r.naglowek.podpis} ${r.naglowek.podstawa}`, /—/)
  })
})

describe('sortowanie', () => {
  const okolice = [
    okolica('Duża', 300, 2700, 0), // 10%
    okolica('Mała', 50, 50, 0), // 50%
    okolica('Szara', 0, 0, 40), // brak danych
    okolica('Pełna', 0, 500, 0), // 0%
    okolica('Remis', 50, 150, 0), // 25%
  ]

  it('domyślnie po liczbie adresów w luce, szare na końcu', () => {
    assert.deepEqual(
      posortujOkolice(okolice, 'liczba').map((o) => o.nazwa),
      ['Duża', 'Mała', 'Remis', 'Pełna', 'Szara'],
    )
  })

  it('po udziale, szare na końcu, nie jako zero', () => {
    assert.deepEqual(
      posortujOkolice(okolice, 'udzial').map((o) => o.nazwa),
      ['Mała', 'Remis', 'Duża', 'Pełna', 'Szara'],
    )
  })

  it('nie zmienia tablicy wejściowej', () => {
    const kopia = okolice.map((o) => o.nazwa)
    posortujOkolice(okolice, 'udzial')
    assert.deepEqual(
      okolice.map((o) => o.nazwa),
      kopia,
    )
  })
})

describe('pasek i liczby', () => {
  it('pasek skalowany do 100% jednostki, nie do największej pozycji', () => {
    assert.deepEqual(pasekLuki(okolica('A', 25, 75, 0)), { wLuce: 25, brakDanych: 0 })
    // Mała okolica z połową w luce ma pasek dłuższy niż duża z większą liczbą.
    assert.equal(pasekLuki(okolica('Mała', 50, 50, 0)).wLuce, 50)
    assert.equal(pasekLuki(okolica('Duża', 300, 2700, 0)).wLuce, 10)
    assert.deepEqual(pasekLuki(okolica('B', 10, 70, 20)), { wLuce: 10, brakDanych: 20 })
    assert.deepEqual(pasekLuki({ wLuce: 0, brakDanych: 0, wszystkie: 0 }), {
      wLuce: 0,
      brakDanych: 0,
    })
  })

  it('procent nie kłamie przy zaokrągleniu, brak danych = null', () => {
    assert.equal(procentUdzialu(null), null)
    assert.equal(procentUdzialu(0), '0%')
    assert.equal(procentUdzialu(0.001), '<1%')
    assert.equal(procentUdzialu(0.999), '>99%')
    assert.equal(procentUdzialu(1), '100%')
    assert.equal(procentUdzialu(0.174), '17%')
  })

  it('odmiana i podstawa', () => {
    assert.equal(odmianaAdresow(1), 'adres')
    assert.equal(odmianaAdresow(3), 'adresy')
    assert.equal(odmianaAdresow(5), 'adresów')
    assert.equal(odmianaAdresow(12), 'adresów')
    assert.equal(odmianaAdresow(22), 'adresy')
    assert.equal(odmianaAdresow(0), 'adresów')
    assert.equal(podstawaUdzialu(1), 'z 1 adresu')
    assert.match(podstawaUdzialu(70217), /^z 70\s217 adresów$/)
  })

  it('źródło i rozdzielczość warstwy', () => {
    assert.equal(rozdzielczoscWarstwy({ rozdzielczosc: 'adres' }), 'adres')
    assert.equal(rozdzielczoscWarstwy({ rozdzielczosc: 'gmina', rozmiar: 'gmina' }), 'gmina')
    assert.equal(rozdzielczoscWarstwy({ rozdzielczosc: 'heks', rozmiar: '1 km' }), 'heks 1 km')
    assert.equal(zrodlaWarstwy({ zrodla: [] }), 'brak opisu źródła')
    assert.equal(
      zrodlaWarstwy({
        zrodla: [{ nazwa: 'GTFS', url: '', licencja: '', dataDanych: '2026-09-30', pobrano: '' }],
      }),
      'GTFS (stan 2026-09-30)',
    )
  })

  it('kierunek dla każdego progu zaczyna się od „Od góry:” i nie powtarza „adresy”', () => {
    for (const p of Object.values(PROGI_LUK)) {
      for (const s of SORTOWANIA) {
        const k = kierunekRankingu(p, s)
        assert.match(k, /^Od góry: /)
        assert.doesNotMatch(k, /adresów adresy/)
      }
    }
  })
})

describe('rankingLuk na prawdziwych danych', () => {
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

  for (const id of Object.keys(PROGI_LUK)) {
    it(`${id}: suma „w luce” = liczba w nagłówku`, () => {
      const plik = czytaj<PlikWskaznika>(`wskazniki/${id}.json`)
      const w = policzLuki(plik, prawdziwe, grupy)
      if (plik.meta.atrapa) {
        assert.equal(w, null)
        return
      }
      assert.ok(w)
      sprawdzSumeNaglowka(w)
    })
  }
})
