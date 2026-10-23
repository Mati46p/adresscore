import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { cellToParent, latLngToCell } from 'h3-js'
import { wynikiHeksow } from '../src/wynik/heksy.ts'
import {
  listaHeksow,
  niezgodnoscKompaktu,
  odczytajKafel,
  rozpakuj,
  sekcja,
} from '../src/wynik/kompakt.ts'
import { MAKS_KAFEL, zbudujKompakt } from './kompakt.mjs'
import { maStalyNaglowek } from './lib/gzip.mjs'

const komorki = [latLngToCell(50.061, 19.937, 10), latLngToCell(50.062, 19.939, 10)]
const adresy = {
  wersja: 'test-1',
  zrodla: [],
  kolumny: {
    id: ['msip-10', 'msip-11', 'msip-12'],
    miejscowosc: ['Kraków', 'Kraków', 'Kraków'],
    ulica: ['Grodzka', 'Grodzka', 'Floriańska'],
    nr: ['1', '2', '3'],
    kod: ['31-001', '31-001', '31-002'],
    dzielnica: ['I', 'I', 'I'],
    gmina: ['Kraków', 'Kraków', 'Kraków'],
    teryt: ['1261011', '1261011', '1261011'],
    lon: [19.937, 19.937, 19.939],
    lat: [50.061, 50.061, 50.062],
    h3: [komorki[0], komorki[0], komorki[1]],
  },
}
const meta = (id) => ({
  id,
  kategoria: 'transport',
  nazwa: id,
  opis: '',
  jednostka: '',
  kierunek: 'wiecej-lepiej',
  rozdzielczosc: 'adres',
  zakres: [0, 100],
  zadanie: 34,
  zrodla: [],
})
const warstwy = [
  { meta: meta('pelna'), wersjaAdresow: adresy.wersja, wartosci: [10, 20, 30] },
  { meta: meta('luka'), wersjaAdresow: adresy.wersja, wartosci: [null, null, 90] },
]

test('kompakt zachowuje heksy i wyłącza obszar, gdzie warstwy z danymi niosą < połowy wagi', async () => {
  const { indeks, pliki } = zbudujKompakt(adresy, warstwy)
  const manifest = {
    wygenerowano: 'test',
    wskazniki: warstwy.map((w) => ({ ...w.meta, wersjaAdresow: w.wersjaAdresow })),
  }
  assert.equal(niezgodnoscKompaktu(indeks, manifest), null)
  assert.match(
    niezgodnoscKompaktu(indeks, { ...manifest, wskazniki: [manifest.wskazniki[0]] }),
    /nadmiarowa/,
  )

  const heksy = await rozpakuj(pliki.get(indeks.heksy.plik))
  const ids = listaHeksow(heksy, 'r10')
  assert.deepEqual(ids, [...new Set(adresy.kolumny.h3)].sort())
  assert.equal(
    sekcja(heksy, 'liczba10').reduce((a, b) => a + b, 0),
    3,
  )
  const kafel = await odczytajKafel(pliki.get(indeks.kafle[0].plik))
  assert.equal(kafel.n, indeks.kafle[0].n)
  assert.equal(kafel.kolumny.id.length, kafel.n)

  const odczytaj = async (id) => {
    const bufor = pliki.get(indeks.wskazniki[id].heksy.plik)
    const r = await rozpakuj(bufor)
    return {
      ocena: { 10: sekcja(r, 'ocena10') },
      udzial: { 10: sekcja(r, 'udzial10') },
    }
  }
  const pelna = await odczytaj('pelna')
  const luka = await odczytaj('luka')
  const podstawa = {
    skalaOceny: heksy.naglowek.skalaOceny,
    skalaUdzialu: heksy.naglowek.skalaUdzialu,
    poziomy: { 10: { heksy: ids, liczba: sekcja(heksy, 'liczba10') } },
  }
  const policz = (wagaLuki) =>
    wynikiHeksow(
      podstawa,
      10,
      [
        { id: 'pelna', kierunek: 'wiecej-lepiej', waga: 1 },
        { id: 'luka', kierunek: 'wiecej-lepiej', waga: wagaLuki },
      ],
      (id) => ({ pelna, luka })[id] ?? null,
    )
  // Warstwa z luką niesie 3/4 wagi, a w heksie 0 nie ma danych → pokrycie 25% < 50% → wyłączony.
  const wynik = policz(3)
  assert.ok(Number.isNaN(wynik.wartosc[ids.indexOf(komorki[0])]))
  assert.ok(Number.isFinite(wynik.wartosc[ids.indexOf(komorki[1])]))
  // Równe wagi: połowa wagi ma dane (np. warstwa tylko-Kraków poza Krakowem) → heks zostaje (#148).
  assert.ok(Number.isFinite(policz(1).wartosc[ids.indexOf(komorki[0])]))
})

test('kafel niesie kolumnę i zgodną z kolejnością adresy.json', async () => {
  const { indeks, pliki, kolejnosc } = zbudujKompakt(adresy, warstwy)
  assert.deepEqual(indeks.rozszerzenia, ['i', 'r8', 'okolice'])
  const zebrane = []
  for (const wpis of indeks.kafle) {
    const kafel = await odczytajKafel(pliki.get(wpis.plik))
    assert.equal(wpis.res, 7)
    assert.equal(kafel.kolumny.i.length, kafel.n)
    kafel.kolumny.i.forEach((pozycja, j) => {
      assert.equal(kafel.kolumny.id[j], adresy.kolumny.id[pozycja])
      assert.equal(kafel.wartosci.pelna[j], warstwy[0].wartosci[pozycja])
      zebrane[wpis.od + j] = pozycja
    })
  }
  assert.deepEqual(zebrane, kolejnosc)
})

test('gęsty kafel r7 dzieli się na dzieci r8 o ciągłych zakresach', async () => {
  const r7 = cellToParent(komorki[0], 7)
  const punkty = []
  for (let a = -30; a <= 30; a++)
    for (let b = -30; b <= 30; b++) {
      const lat = 50.061 + a * 0.0006
      const lon = 19.937 + b * 0.0009
      if (cellToParent(latLngToCell(lat, lon, 10), 7) === r7) punkty.push([lon, lat])
    }
  const n = MAKS_KAFEL + 200
  const wiele = Array.from({ length: n }, (_, i) => punkty[i % punkty.length])
  const kolumny = {
    id: wiele.map((_, i) => `msip-${i + 1}`),
    miejscowosc: wiele.map(() => 'Kraków'),
    ulica: wiele.map((_, i) => `U${i % 7}`),
    nr: wiele.map((_, i) => String(i)),
    kod: wiele.map(() => '31-001'),
    dzielnica: wiele.map(() => 'I'),
    gmina: wiele.map(() => 'Kraków'),
    teryt: wiele.map(() => '1261011'),
    lon: wiele.map((p) => p[0]),
    lat: wiele.map((p) => p[1]),
    h3: wiele.map((p) => latLngToCell(p[1], p[0], 10)),
  }
  const gesty = { wersja: 'gesty-1', zrodla: [], kolumny }
  const { indeks, pliki } = zbudujKompakt(gesty, [])
  assert.ok(indeks.kafle.length > 1)
  assert.ok(indeks.kafle.every((x) => x.res === 8 && x.n <= n))
  let oczekiwany = 0
  const pozycje = new Set()
  for (const wpis of indeks.kafle) {
    assert.equal(wpis.od, oczekiwany)
    oczekiwany += wpis.n
    const kafel = await odczytajKafel(pliki.get(wpis.plik))
    assert.equal(kafel.n, wpis.n)
    for (const h of kafel.kolumny.h3) assert.equal(cellToParent(h, 8), wpis.h3)
    for (const i of kafel.kolumny.i) pozycje.add(i)
  }
  assert.equal(oczekiwany, n)
  assert.equal(pozycje.size, n)
})

test('okolice: prostokąt i liczba adresów z adresów okolicy', () => {
  const okolice = {
    wersjaAdresow: adresy.wersja,
    idOkolic: ['sim-1', 'sim-2'],
    kolumny: { okolica: [0, 0, 1] },
  }
  const { indeks, pliki } = zbudujKompakt(adresy, warstwy, okolice)
  const plik = JSON.parse(pliki.get(indeks.okolice.plik).toString('utf8'))
  assert.deepEqual(plik.okolice['sim-1'], {
    prostokat: [
      [19.937, 50.061],
      [19.937, 50.061],
    ],
    n: 2,
  })
  assert.deepEqual(plik.okolice['sim-2'].prostokat, [
    [19.939, 50.062],
    [19.939, 50.062],
  ])
  assert.equal(zbudujKompakt(adresy, warstwy).indeks.okolice, undefined)
})

test('każdy plik gzip kompaktu ma nagłówek niezależny od systemu (#179)', () => {
  const { pliki } = zbudujKompakt(adresy, warstwy)
  const gzipy = [...pliki].filter(([sciezka]) => /\.(bin|json\.gz)$/.test(sciezka))
  // heksy, szukaj, id, 2 warstwy, 2 filtry i kafle: żaden nie może pominąć wspólnej funkcji
  assert.ok(gzipy.length >= 8, `plików gzip: ${gzipy.length}`)
  for (const [sciezka, bufor] of gzipy) assert.ok(maStalyNaglowek(bufor), sciezka)
})

const katalog = new URL('../public/dane/kompakt/', import.meta.url)
test('dostarczone pliki gzip kompaktu mają nagłówek niezależny od systemu (#179)', {
  skip: !existsSync(katalog),
}, () => {
  const indeks = JSON.parse(readFileSync(new URL('indeks.json', katalog), 'utf8'))
  const wskazniki = Object.values(indeks.wskazniki)
  const pliki = [indeks.heksy, indeks.szukaj, indeks.id, ...indeks.kafle]
    .concat(wskazniki.flatMap((w) => [w.heksy, w.filtr]))
    .map((x) => x.plik)
  assert.ok(pliki.length > 2 * wskazniki.length, `plików gzip: ${pliki.length}`)
  for (const plik of pliki) assert.ok(maStalyNaglowek(readFileSync(new URL(plik, katalog))), plik)
})

test('dostarczony kompakt odpowiada bieżącym plikom wskaźników', {
  skip: !existsSync(katalog),
}, async () => {
  const indeks = JSON.parse(readFileSync(new URL('indeks.json', katalog), 'utf8'))
  const wskazniki = readdirSync(new URL('../wskazniki/', katalog))
    .filter((p) => p.endsWith('.json'))
    .map((p) => {
      const { meta, wersjaAdresow } = JSON.parse(
        readFileSync(new URL(`../wskazniki/${p}`, katalog), 'utf8'),
      )
      return { ...meta, wersjaAdresow }
    })
  assert.equal(niezgodnoscKompaktu(indeks, { wygenerowano: 'test', wskazniki }), null)
  assert.ok(!wskazniki.some((w) => w.id === 'upal_narazenie'))
  const heksy = await rozpakuj(readFileSync(new URL(indeks.heksy.plik, katalog)))
  assert.equal(listaHeksow(heksy, 'r10').length, sekcja(heksy, 'od').length)
  assert.equal(
    sekcja(heksy, 'liczba10').reduce((a, b) => a + b, 0),
    indeks.n,
  )
})
