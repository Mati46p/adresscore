// Uruchom: node --test etl/biznes-popyt.test.mjs
// Część na danych syntetycznych sprawdza algorytm (bilans ludności, oczko liczone raz, utajnienia,
// błędy wejścia). Część na prawdziwych plikach sprawdza, że popyt.json obejmuje WSZYSTKIE adresy
// z adresy.json (Kraków i obwarzanek), że suma ludności w heksach równa się sumie ludności oczek
// siatki 1 km z adresami i że plik odpowiada wejściom. Bez plików wejściowych część druga jest pomijana.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { latLngToCell } from 'h3-js'
import {
  bezPauzy,
  oczkoSiatki,
  wczytajWejscie,
  zbudujPlikPopytu,
  zbudujPopyt,
} from './biznes-popyt.mjs'
import { DANE } from './lib/wspolne.mjs'

const PAUZA = String.fromCodePoint(0x2014)
const POLPAUZA = String.fromCodePoint(0x2013)
const suma = (tablica) => tablica.reduce((a, b) => a + b, 0)

// ── Dane syntetyczne ──────────────────────────────────────────────────────────────────────

/** Deterministyczny generator liczb z [0, 1), żeby test dawał ten sam wynik przy każdym biegu. */
function generator(ziarno) {
  let a = ziarno
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const zrodlo = (nazwa) => ({ nazwa, url: 'https://example.pl' })

/** Wejście z gotowych kolumn adresów i wartości wskaźników (oba wskaźniki w wersji adresów). */
function wejscie(kolumny, ludnosc, kursy) {
  return {
    adresy: {
      wersja: 'wersja-testowa',
      zrodla: [zrodlo(`MSIP ${PAUZA} punkty adresowe`)],
      kolumny,
    },
    ludnosc: {
      wersjaAdresow: 'wersja-testowa',
      meta: { zrodla: [zrodlo('GUS NSP 2021')] },
      wartosci: ludnosc,
    },
    kursy: {
      wersjaAdresow: 'wersja-testowa',
      meta: { zrodla: [zrodlo('GTFS')] },
      wartosci: kursy,
    },
  }
}

/**
 * `n` adresów w oknie ok. 5 km x 7 km (kilkadziesiąt oczek 1 km, kilkaset heksów r10). Ludność ma
 * oczko, nie adres: każdy adres dostaje wartość swojego oczka (losową, w tym możliwe 0), a oczko
 * pierwszego adresu jest utajnione (null). Kursy losowe, co piąty adres bez wartości.
 */
function wejscieSyntetyczne(n, ziarno = 7) {
  const los = generator(ziarno)
  const kolumny = { id: [], gmina: [], teryt: [], lon: [], lat: [], h3: [] }
  for (let i = 0; i < n; i++) {
    const lon = Math.round((19.9 + los() * 0.07) * 1e5) / 1e5
    const lat = Math.round((50.03 + los() * 0.06) * 1e5) / 1e5
    kolumny.id.push(`a${i}`)
    kolumny.gmina.push(i % 3 === 0 ? 'Wieliczka' : 'Kraków')
    kolumny.teryt.push(i % 3 === 0 ? '1219053' : '1261011')
    kolumny.lon.push(lon)
    kolumny.lat.push(lat)
    kolumny.h3.push(latLngToCell(lat, lon, 10))
  }
  const oczka = kolumny.lon.map((lon, i) => oczkoSiatki(lon, kolumny.lat[i]))
  const popOczka = new Map()
  for (const id of oczka)
    if (!popOczka.has(id)) popOczka.set(id, id === oczka[0] ? null : Math.floor(los() * 6000))
  const kursy = kolumny.id.map((_, i) => (i % 5 === 0 ? null : Math.floor(los() * 30)))
  return {
    ...wejscie(
      kolumny,
      oczka.map((id) => popOczka.get(id)),
      kursy,
    ),
    oczka,
    popOczka,
  }
}

test('suma ludności w heksach = suma ludności oczek 1 km z adresami (oczko liczone raz)', () => {
  const w = wejscieSyntetyczne(2500)
  const { komorki, bilans } = zbudujPopyt(w)
  // Oczekiwanie liczone osobno: każde oczko z wartością raz, niezależnie od liczby adresów w nim.
  const oczekiwana = suma([...w.popOczka.values()].filter((p) => p !== null))
  assert.ok(w.popOczka.size > 20 && komorki.length > 300, 'dane testowe są dość zróżnicowane')
  assert.ok(oczekiwana > 0)
  assert.equal(bilans.ludnoscOczek, oczekiwana)
  // Każdy heks zaokrągla do 0,01 osoby, więc błąd sumy to najwyżej połowa setnej na heks. Gdyby
  // oczko liczono raz na adres, suma rozjechałaby się o tysiące osób, nie o ułamki.
  const sumaHeksow = suma(komorki.map((c) => c[4]))
  assert.ok(
    Math.abs(sumaHeksow - oczekiwana) <= 0.005 * komorki.length,
    `heksy ${sumaHeksow}, oczka ${oczekiwana}`,
  )
  assert.ok(Math.abs(bilans.ludnoscHeksow - sumaHeksow) < 0.01)
})

test('każdy adres jest w dokładnie jednym heksie, a adresy gmin sumują się do wszystkich', () => {
  const w = wejscieSyntetyczne(2500)
  const { komorki, gminy, bilans } = zbudujPopyt(w)
  assert.equal(suma(komorki.map((c) => c[3])), 2500)
  assert.equal(bilans.adresy, 2500)
  assert.equal(bilans.heksy, komorki.length)
  assert.deepEqual(new Set(komorki.map((c) => c[0])), new Set(w.adresy.kolumny.h3))
  assert.equal(new Set(komorki.map((c) => c[0])).size, komorki.length, 'heksy się nie powtarzają')
  assert.equal(suma(gminy.map((g) => g.adresy)), 2500)
  assert.deepEqual(gminy.map((g) => g.teryt).sort(), ['1219053', '1261011'])
  // Ludność przypisana gminom sumuje się do ludności oczek (każdy adres należy do jednej gminy).
  const przypisana = suma(gminy.map((g) => g.ludnoscPrzypisana))
  assert.ok(Math.abs(przypisana - bilans.ludnoscOczek) <= gminy.length)
})

test('ludność heksu to udziały jego adresów: ludność oczka / liczba adresów w oczku', () => {
  const w = wejscieSyntetyczne(2500)
  const { komorki } = zbudujPopyt(w)
  const liczba = new Map()
  for (const id of w.oczka) liczba.set(id, (liczba.get(id) ?? 0) + 1)
  const oczekiwane = new Map()
  w.adresy.kolumny.h3.forEach((h3, i) => {
    const pop = w.ludnosc.wartosci[i]
    const udzial = pop === null ? 0 : pop / liczba.get(w.oczka[i])
    oczekiwane.set(h3, (oczekiwane.get(h3) ?? 0) + udzial)
  })
  let zWieleAdresow = 0
  for (const [h3, , , adresy, ludnosc] of komorki) {
    assert.ok(Math.abs(ludnosc - oczekiwane.get(h3)) <= 0.005 + 1e-9, h3)
    if (adresy > 1) zWieleAdresow++
  }
  assert.ok(zWieleAdresow > 50, 'są heksy z wieloma adresami, więc podział jest sprawdzony')
})

test('oczko z utajnioną ludnością: adresy liczą się, ludności nie przybywa', () => {
  const w = wejscieSyntetyczne(2500)
  const utajnione = w.oczka[0]
  const { komorki } = zbudujPopyt(w)
  const adresyHeksu = new Map()
  w.adresy.kolumny.h3.forEach((h3, i) => {
    const e = adresyHeksu.get(h3) ?? { wszystkie: 0, wUtajnionym: 0 }
    e.wszystkie++
    if (w.oczka[i] === utajnione) e.wUtajnionym++
    adresyHeksu.set(h3, e)
  })
  const wCalosciUtajnione = komorki.filter((c) => {
    const e = adresyHeksu.get(c[0])
    return e.wUtajnionym === e.wszystkie
  })
  assert.ok(wCalosciUtajnione.length > 0, 'są heksy w całości w utajnionym oczku')
  for (const c of wCalosciUtajnione) {
    assert.ok(c[3] > 0, c[0])
    assert.equal(c[4], 0, c[0])
  }
})

test('kursy: średnia z adresów heksu, które mają wartość; bez żadnej wartości 0', () => {
  const w = wejscieSyntetyczne(1200)
  const { komorki } = zbudujPopyt(w)
  const zbior = new Map()
  w.adresy.kolumny.h3.forEach((h3, i) => {
    const kurs = w.kursy.wartosci[i]
    if (kurs === null) return
    const e = zbior.get(h3) ?? { suma: 0, n: 0 }
    e.suma += kurs
    e.n++
    zbior.set(h3, e)
  })
  for (const c of komorki) {
    const e = zbior.get(c[0])
    assert.equal(c[5], e ? Math.round((e.suma / e.n) * 100) / 100 : 0, c[0])
  }
})

test('wejścia, które do siebie nie pasują, kończą się błędem zamiast po cichu złym popytem', () => {
  // Dwa adresy w tym samym miejscu, czyli w jednym oczku, w jednym heksie.
  const dwa = {
    id: ['a', 'b'],
    gmina: ['Kraków', 'Kraków'],
    teryt: ['1261011', '1261011'],
    lon: [19.94, 19.94],
    lat: [50.06, 50.06],
    h3: [latLngToCell(50.06, 19.94, 10), latLngToCell(50.06, 19.94, 10)],
  }
  const zgodne = zbudujPopyt(wejscie(dwa, [1000, 1000], [3, 5]))
  assert.deepEqual(zgodne.komorki[0].slice(3), [2, 1000, 4], 'oczko liczone raz, nie dwa razy')
  assert.throws(() => zbudujPopyt(wejscie(dwa, [100, 200], [3, 5])), /Niespójna ludność w oczku/)
  assert.throws(() => zbudujPopyt(wejscie(dwa, [100, null], [3, 5])), /tylko przy części adresów/)
  const inna = { ...wejscie(dwa, [1, 1], [1, 1]) }
  assert.throws(
    () => zbudujPopyt({ ...inna, ludnosc: { ...inna.ludnosc, wersjaAdresow: 'inna' } }),
    /Niezgodna wersja/,
  )
  assert.throws(
    () => zbudujPopyt({ ...inna, kursy: { ...inna.kursy, wersjaAdresow: 'inna' } }),
    /Niezgodna wersja/,
  )
  assert.throws(
    () => zbudujPopyt({ ...inna, kursy: { ...inna.kursy, wartosci: [1] } }),
    /inną długość/,
  )
})

test('opisy źródeł w pliku popytu mają półpauzę, nie pauzę', () => {
  const plik = zbudujPlikPopytu(wejscieSyntetyczne(300), '2026-10-04')
  assert.ok(!JSON.stringify(plik).includes(PAUZA), 'w pliku nie ma pauzy')
  assert.equal(plik.zrodla[0].nazwa, `MSIP ${POLPAUZA} punkty adresowe`)
  assert.equal(plik.meta.wygenerowano, '2026-10-04')
  assert.deepEqual(plik.meta.kolumny, ['h3', 'lon', 'lat', 'adresy', 'ludnosc', 'kursy'])
  assert.equal(bezPauzy({ a: [`x ${PAUZA} y`] }).a[0], `x ${POLPAUZA} y`)
  // Kontrakt czytnika: komórki to krotki [h3, lon, lat, adresy, ludnosc, kursy].
  for (const c of plik.komorki) assert.equal(c.length, 6)
})

// ── Prawdziwe pliki ───────────────────────────────────────────────────────────────────────

const POTRZEBNE = [
  'adresy.json',
  'wskazniki/ludnosc_1km.json',
  'wskazniki/kursy_szczyt_h.json',
  'biznes/popyt.json',
]
const maDane = POTRZEBNE.every((p) => existsSync(join(DANE, p)))
const opcje = { skip: maDane ? false : `brak plików w public/dane: ${POTRZEBNE.join(', ')}` }

let wczytane = null
/** Wejścia, plik z dysku i wynik świeżego przeliczenia: raz na bieg testów (parsowanie i proj4 ok. 5 s). */
function dane() {
  if (!wczytane) {
    const wejscieZDysku = wczytajWejscie()
    const plik = JSON.parse(readFileSync(join(DANE, 'biznes/popyt.json'), 'utf8'))
    wczytane = {
      wejscie: wejscieZDysku,
      plik,
      swiezy: zbudujPlikPopytu(wejscieZDysku, plik.meta?.wygenerowano),
    }
  }
  return wczytane
}

test('popyt.json obejmuje WSZYSTKIE adresy z adresy.json, nie tylko Kraków', opcje, () => {
  const { wejscie: w, plik } = dane()
  const k = w.adresy.kolumny
  assert.equal(plik.wersjaAdresow, w.adresy.wersja, 'popyt policzono na bieżących adresach')
  assert.equal(suma(plik.komorki.map((c) => c[3])), k.id.length)
  const heksy = new Set(plik.komorki.map((c) => c[0]))
  assert.equal(heksy.size, plik.komorki.length, 'heksy się nie powtarzają')
  assert.deepEqual(heksy, new Set(k.h3), 'każdy adres ma swój heks, a heks ma adres')
  // Gminy: te z adresów, z liczbą adresów; obok Krakowa są gminy obwarzanka.
  const poGminach = new Map()
  for (const teryt of k.teryt) poGminach.set(teryt, (poGminach.get(teryt) ?? 0) + 1)
  assert.ok(poGminach.size > 1 && poGminach.has('1261011'), 'adresy.json ma Kraków i inne gminy')
  assert.deepEqual(
    plik.meta.obszar.gminy.map((g) => [g.teryt, g.adresy]).sort(),
    [...poGminach].sort(),
  )
  const obwarzanek = plik.meta.obszar.gminy.filter((g) => g.teryt !== '1261011')
  assert.ok(obwarzanek.length > 1, 'popyt ma gminy poza Krakowem')
  for (const g of obwarzanek) assert.ok(g.adresy > 0 && g.heksy > 0, g.nazwa)
})

test('każda gmina z katalogu usług ma heksy popytu', opcje, () => {
  const sciezka = join(DANE, 'uslugi/katalog.json')
  if (!existsSync(sciezka)) return
  const katalog = JSON.parse(readFileSync(sciezka, 'utf8'))
  const maPopyt = new Set(dane().plik.meta.obszar.gminy.map((g) => g.teryt))
  for (const { nazwa, terc } of katalog.obszar.gminy)
    assert.ok(maPopyt.has(terc), `gmina ${nazwa} (${terc}) z katalogu usług nie ma popytu`)
})

test('bilans: suma ludności w heksach = suma ludności oczek siatki 1 km z adresami', opcje, () => {
  const { wejscie: w, plik } = dane()
  const k = w.adresy.kolumny
  // Niezależnie od ETL: oczko po oczku, z wartości wskaźnika ludnosc_1km (taka sama przy każdym
  // adresie oczka, więc oczko liczymy raz).
  const popOczka = new Map()
  for (let i = 0; i < k.id.length; i++) {
    const pop = w.ludnosc.wartosci[i]
    if (Number.isFinite(pop)) popOczka.set(oczkoSiatki(k.lon[i], k.lat[i]), pop)
  }
  const oczekiwana = suma([...popOczka.values()])
  const sumaHeksow = suma(plik.komorki.map((c) => c[4]))
  assert.ok(popOczka.size > 1000, `oczek z adresami: ${popOczka.size}`)
  assert.ok(
    Math.abs(sumaHeksow - oczekiwana) <= 0.005 * plik.komorki.length,
    `heksy ${sumaHeksow}, oczka ${oczekiwana}`,
  )
  assert.equal(plik.meta.bilans.ludnoscOczek, oczekiwana)
  assert.equal(plik.meta.bilans.oczka, popOczka.size)
  assert.ok(Math.abs(plik.meta.bilans.ludnoscHeksow - sumaHeksow) < 0.01)
  // Ludność przypisana gminom domyka się do tej samej sumy (do zaokrągleń do osoby).
  const gminy = plik.meta.obszar.gminy
  assert.ok(Math.abs(suma(gminy.map((g) => g.ludnoscPrzypisana)) - oczekiwana) <= gminy.length)
})

test('komórki popytu zgodne z kontraktem czytnika (src/wynik/biznes.ts)', opcje, () => {
  const { plik } = dane()
  const { minLat, maxLat, minLon, maxLon } = plik.meta.obszar.bbox
  assert.ok(plik.komorki.length > 30000)
  for (const [h3, lon, lat, adresy, ludnosc, kursy] of plik.komorki) {
    assert.match(h3, /^8a[0-9a-f]{13}$/, 'indeks H3 r10')
    assert.ok(Number.isInteger(adresy) && adresy >= 1, h3)
    assert.ok(Number.isFinite(ludnosc) && ludnosc >= 0, h3)
    assert.ok(Number.isFinite(kursy) && kursy >= 0, h3)
    // Środek heksu leży najwyżej o jego promień (ok. 70 m) poza obwiednią adresów.
    assert.ok(lon > minLon - 0.002 && lon < maxLon + 0.002, h3)
    assert.ok(lat > minLat - 0.002 && lat < maxLat + 0.002, h3)
  }
})

test('meta i źródła popytu: bez pauzy, ze wszystkimi rodzajami źródeł', opcje, () => {
  const { plik } = dane()
  assert.ok(!readFileSync(join(DANE, 'biznes/popyt.json'), 'utf8').includes(PAUZA))
  assert.match(plik.meta.wygenerowano, /^\d{4}-\d{2}-\d{2}$/)
  const nazwy = plik.zrodla.map((z) => z.nazwa).join('\n')
  for (const fraza of [/MSIP/, /GUGiK/, /GUS/, /GTFS/]) assert.match(nazwy, fraza)
  for (const z of plik.zrodla) assert.ok(z.url?.startsWith('https://'), z.nazwa)
  assert.equal(plik.meta.bilans.heksy, plik.komorki.length)
  assert.equal(plik.meta.bilans.adresy, suma(plik.komorki.map((c) => c[3])))
})

test('popyt.json = wynik node etl/biznes-popyt.mjs na bieżących wejściach', opcje, () => {
  const { plik, swiezy } = dane()
  assert.deepEqual(
    plik,
    swiezy,
    'popyt.json różni się od przeliczenia z adresy.json, ludnosc_1km i kursy_szczyt_h: uruchom node etl/biznes-popyt.mjs',
  )
})
