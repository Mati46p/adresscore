// Adapter katalogu usług dla trybu „Biznes” (E10, #105–#107): konwersja kolumn na punkty silnika,
// filtry konkurencji i zgodność z prawdziwymi plikami `public/dane/uslugi` (bez nich testy
// na danych są pomijane, a testy na danych syntetycznych chodzą zawsze).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  BEZ_FILTROW,
  czytajKatalog,
  type FiltryUslug,
  type KatalogUslug,
  liczbaZrodel,
  metaBranzy,
  type PlikUslug,
  punktyBranzy,
  WERSJA_FORMATU,
} from './biznesUslugi.ts'

const OSM = 1
const OVERTURE = 2
const REJESTR = 4
const CEIDG = 8

/** Plik branży z sześcioma punktami: różne maski źródeł i flag, punkt bez nazwy, sam CEIDG. */
function plikTestowy(czesc: Partial<PlikUslug> = {}): PlikUslug {
  return {
    wersja: 1,
    branza: 'testowa',
    nazwa: 'Branża testowa',
    zasiegPieszyM: 700,
    n: 6,
    bityZrodel: { osm: OSM, overture: OVERTURE, rejestr: REJESTR, ceidg: CEIDG },
    bityFlag: { barber: 1, nfz: 2 },
    licencja: 'ODbL',
    atrybucja: '© OpenStreetMap contributors',
    kolumny: {
      lon: [19.9, 19.91, 19.92, 19.93, 19.94, 19.95],
      lat: [50.01, 50.02, 50.03, 50.04, 50.05, 50.06],
      //     osm   ov     osm+ov rej+osm ceidg  osm+ceidg
      zr: [OSM, OVERTURE, OSM | OVERTURE, REJESTR | OSM, CEIDG, OSM | CEIDG],
      //       barber nfz    brak  obie  barber brak
      flagi: [1, 2, 0, 3, 1, 0],
      nazwa: ['A', 'B', null, 'D', 'E', 'F'],
    },
    ...czesc,
  }
}

test('liczba źródeł punktu to liczba ustawionych bitów maski', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 7, 8, 9, 15].map(liczbaZrodel),
    [0, 1, 1, 2, 1, 2, 3, 1, 2, 4],
  )
})

test('kolumny zamieniają się w krotki silnika, a brak nazwy w pusty napis', () => {
  const wynik = punktyBranzy(plikTestowy())
  // Punkt z samym CEIDG (indeks 4) odpada, reszta zostaje w kolejności pliku.
  assert.deepEqual(wynik.punkty, [
    [19.9, 50.01, 'A'],
    [19.91, 50.02, 'B'],
    [19.92, 50.03, ''],
    [19.93, 50.04, 'D'],
    [19.95, 50.06, 'F'],
  ])
  assert.equal(wynik.wPliku, 5)
  assert.equal(wynik.id, 'testowa')
  assert.equal(wynik.nazwa, 'Branża testowa')
  assert.equal(wynik.zasiegM, 700)
  for (const [lon, lat, nazwa] of wynik.punkty) {
    assert.equal(typeof lon, 'number')
    assert.equal(typeof lat, 'number')
    assert.equal(typeof nazwa, 'string')
  }
})

test('punkt tylko z CEIDG nie jest konkurentem, niezależnie od filtrów, ale z innym źródłem zostaje', () => {
  const bez = punktyBranzy(plikTestowy())
  assert.ok(!bez.punkty.some(([lon]) => lon === 19.94))
  assert.ok(bez.punkty.some(([lon]) => lon === 19.95))
  // Plik bez bitu ceidg w słowniku źródeł niczego nie pomija (bit czytamy z pliku).
  const bezBitu = punktyBranzy(
    plikTestowy({ bityZrodel: { osm: OSM, overture: OVERTURE, rejestr: REJESTR } }),
  )
  assert.equal(bezBitu.punkty.length, 6)
})

test('filtr „co najmniej 2 źródła” zostawia tylko punkty z kilkoma bitami', () => {
  const wynik = punktyBranzy(plikTestowy(), { ...BEZ_FILTROW, min2Zrodla: true })
  assert.deepEqual(
    wynik.punkty.map((p) => p[2]),
    ['', 'D', 'F'],
  )
  // „z N” liczy się od punktów pliku bez samego CEIDG, a nie od surowego n.
  assert.equal(wynik.wPliku, 5)
  const filtry = { ...BEZ_FILTROW, min2Zrodla: true }
  assert.deepEqual(metaBranzy(wynik, filtry), {
    id: 'testowa',
    nazwa: 'Branża testowa',
    zasiegM: 700,
    wPliku: 5,
    poFiltrach: 3,
    filtry,
  })
  assert.deepEqual(metaBranzy(wynik).filtry, BEZ_FILTROW)
})

test('filtry flagowe: „tylko” wymaga flagi, „bez” jej zabrania, wiele flag to koniunkcja', () => {
  const nazwy = (f: FiltryUslug) => punktyBranzy(plikTestowy(), f).punkty.map((p) => p[2])
  // Flaga barber (bit 1): punkty A, D (CEIDG-owy E odpada wcześniej).
  assert.deepEqual(nazwy({ min2Zrodla: false, flagi: { barber: 'tylko' } }), ['A', 'D'])
  assert.deepEqual(nazwy({ min2Zrodla: false, flagi: { barber: 'bez' } }), ['B', '', 'F'])
  // Obie flagi „tylko”: tylko D ma oba bity.
  assert.deepEqual(nazwy({ min2Zrodla: false, flagi: { barber: 'tylko', nfz: 'tylko' } }), ['D'])
  // „tylko nfz” i „bez barber”: B (nfz, bez barbera).
  assert.deepEqual(nazwy({ min2Zrodla: false, flagi: { nfz: 'tylko', barber: 'bez' } }), ['B'])
  // Filtry składają się z „co najmniej 2 źródła”.
  assert.deepEqual(nazwy({ min2Zrodla: true, flagi: { barber: 'tylko' } }), ['D'])
})

test('filtr nieznanej flagi albo pliku bez flag nic nie wyklucza', () => {
  const wszystkie = punktyBranzy(plikTestowy()).punkty
  assert.deepEqual(
    punktyBranzy(plikTestowy(), { min2Zrodla: false, flagi: { fast_food: 'tylko' } }).punkty,
    wszystkie,
  )
  const bezFlag = plikTestowy({ bityFlag: undefined })
  bezFlag.kolumny = { ...bezFlag.kolumny, flagi: undefined }
  assert.equal(
    punktyBranzy(bezFlag, { min2Zrodla: false, flagi: { barber: 'tylko' } }).punkty.length,
    5,
  )
})

test('filtr, który wycina wszystko, daje pustą listę, a nie błąd', () => {
  const wynik = punktyBranzy(plikTestowy(), {
    min2Zrodla: true,
    flagi: { barber: 'tylko', nfz: 'bez' },
  })
  // Co najmniej 2 źródła i barber: D; ale D ma też nfz, więc „bez nfz” wycina je.
  assert.deepEqual(wynik.punkty, [])
  assert.equal(wynik.wPliku, 5)
})

test('plik o złym formacie jest odrzucany z komunikatem', () => {
  assert.throws(() => punktyBranzy(plikTestowy({ wersja: 2 })), /wersję 2/)
  assert.throws(() => punktyBranzy(plikTestowy({ zasiegPieszyM: 0 })), /zasięgu/)
  const krotkaKolumna = plikTestowy()
  krotkaKolumna.kolumny = { ...krotkaKolumna.kolumny, lat: [50.01] }
  assert.throws(() => punktyBranzy(krotkaKolumna), /długości/)
  const krotkieFlagi = plikTestowy()
  krotkieFlagi.kolumny = { ...krotkieFlagi.kolumny, flagi: [1] }
  assert.throws(() => punktyBranzy(krotkieFlagi), /długości/)
})

test('katalog o złym formacie jest odrzucany, poprawny przechodzi', () => {
  const dobry = { wersja: WERSJA_FORMATU, wygenerowano: '2026-10-04', zrodla: {}, branze: [{}] }
  assert.ok(dobry.branze.length > 0)
  assert.equal(czytajKatalog(dobry), dobry)
  assert.throws(() => czytajKatalog(null), /nieprawidłowy format/)
  assert.throws(() => czytajKatalog({ ...dobry, wersja: 9 }), /wersję 9/)
  assert.throws(() => czytajKatalog({ ...dobry, branze: [] }), /nie zawiera/)
  assert.throws(() => czytajKatalog({ ...dobry, zrodla: undefined }), /nie zawiera/)
})

// ── Prawdziwe pliki ──────────────────────────────────────────────────────────────────────

const sciezka = (plik: string) =>
  fileURLToPath(new URL(`../../public/dane/uslugi/${plik}`, import.meta.url))
const maDane = existsSync(sciezka('katalog.json'))
const opcje = { skip: maDane ? false : 'brak public/dane/uslugi/katalog.json' }

function katalog(): KatalogUslug {
  return czytajKatalog(JSON.parse(readFileSync(sciezka('katalog.json'), 'utf8')))
}
function plik(id: string): PlikUslug {
  return JSON.parse(readFileSync(sciezka(`${id}.json`), 'utf8')) as PlikUslug
}

test('katalog ma 26 branż, a każda ma plik zgodny z katalogiem', opcje, () => {
  const k = katalog()
  assert.equal(k.branze.length, 26)
  const ids = new Set<string>()
  for (const b of k.branze) {
    assert.ok(!ids.has(b.id), `id ${b.id} występuje dwa razy`)
    ids.add(b.id)
    const p = plik(b.id)
    assert.equal(b.plik, `${b.id}.json`)
    assert.equal(p.branza, b.id)
    assert.equal(p.nazwa, b.nazwa, b.id)
    assert.equal(p.zasiegPieszyM, b.zasiegPieszyM, `zasięg ${b.id}`)
    assert.ok(b.zasiegPieszyM >= 300 && b.zasiegPieszyM <= 3000, `zasięg ${b.id}`)
    assert.equal(p.n, b.n, `n ${b.id}`)
    assert.equal(p.kolumny.lon.length, b.n, `kolumny ${b.id}`)
  }
})

test(
  'adapter na prawdziwych plikach: wszystkie punkty, każdy z nazwą tekstową i położeniem w obszarze',
  opcje,
  () => {
    const k = katalog()
    const { bbox } = k.obszar
    let razem = 0
    for (const b of k.branze) {
      const wynik = punktyBranzy(plik(b.id))
      // Pliki są bez CEIDG, więc żaden punkt nie odpada i „z N” to całe n z katalogu.
      assert.equal(wynik.punkty.length, b.n, b.id)
      assert.equal(wynik.wPliku, b.n, b.id)
      assert.equal(wynik.zasiegM, b.zasiegPieszyM, b.id)
      for (const [lon, lat, nazwa] of wynik.punkty) {
        assert.ok(Number.isFinite(lon) && Number.isFinite(lat), b.id)
        assert.ok(lon >= bbox.minLon && lon <= bbox.maxLon, `${b.id}: lon ${lon}`)
        assert.ok(lat >= bbox.minLat && lat <= bbox.maxLat, `${b.id}: lat ${lat}`)
        assert.equal(typeof nazwa, 'string', b.id)
      }
      razem += wynik.punkty.length
    }
    assert.ok(razem > 15000, `łącznie ${razem} punktów w 26 branżach`)
  },
)

test(
  'maski źródeł w plikach używają tylko bitów ze słownika i zgadzają się z katalogiem',
  opcje,
  () => {
    for (const b of katalog().branze) {
      const p = plik(b.id)
      const dozwolone = Object.values(p.bityZrodel).reduce((a, v) => a | v, 0)
      let wieleZrodel = 0
      for (const zr of p.kolumny.zr) {
        assert.ok(zr > 0, `${b.id}: punkt bez źródła`)
        assert.equal(zr & ~dozwolone, 0, `${b.id}: bit spoza słownika (${zr})`)
        if (liczbaZrodel(zr) >= 2) wieleZrodel++
      }
      // Filtr „co najmniej 2 źródła” zostawia dokładnie tyle punktów, ile podaje katalog.
      assert.equal(wieleZrodel, b.liczby.potwierdzoneWielomaZrodlami, b.id)
      const wynik = punktyBranzy(p, { ...BEZ_FILTROW, min2Zrodla: true })
      assert.equal(wynik.punkty.length, b.liczby.potwierdzoneWielomaZrodlami, b.id)
      assert.ok(wynik.punkty.length < b.n, `${b.id}: filtr nic nie zawęża`)
      assert.ok(wynik.punkty.length > 0, `${b.id}: filtr wycina wszystko`)
    }
  },
)

test('flagi: filtr „tylko” zostawia tyle punktów, ile ma katalog, a „bez” resztę', opcje, () => {
  let sprawdzone = 0
  for (const b of katalog().branze) {
    const p = plik(b.id)
    const flagi = Object.keys(p.bityFlag ?? {})
    // Plik ma kolumnę flag wtedy i tylko wtedy, gdy branża ma flagi.
    assert.equal(Boolean(p.kolumny.flagi), flagi.length > 0, b.id)
    assert.deepEqual(flagi.sort(), Object.keys(b.mapowanie.flagi).sort(), b.id)
    for (const flaga of flagi) {
      const tylko = punktyBranzy(p, { min2Zrodla: false, flagi: { [flaga]: 'tylko' } })
      const bez = punktyBranzy(p, { min2Zrodla: false, flagi: { [flaga]: 'bez' } })
      assert.equal(tylko.punkty.length, b.liczby.zFlaga[flaga], `${b.id}/${flaga}`)
      assert.equal(tylko.punkty.length + bez.punkty.length, b.n, `${b.id}/${flaga}`)
      assert.ok(tylko.punkty.length > 0 && bez.punkty.length > 0, `${b.id}/${flaga}`)
      sprawdzone++
    }
  }
  // Dentysta (nfz), restauracja (fast_food) i fryzjer (barber).
  assert.equal(sprawdzone, 3)
})
