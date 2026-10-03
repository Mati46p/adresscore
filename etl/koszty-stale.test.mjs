// Uruchom: node --test etl/koszty-stale.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  etykieta,
  ID,
  MAKS_ODPADY_NA_OSOBE,
  MAKS_STAWKA_ZL_M2,
  MIN_ODPADY_NA_OSOBE,
  OSOBY,
  odczytajOdpady,
  PLIK_ODPADOW,
  PLIK_STAWEK,
  POWIERZCHNIA_M2,
  rozbijGmine,
  sprawdzStawki,
  stawkaMieszkalne,
  zbudujMeta,
  zbudujWskaznik,
} from './koszty-stale.mjs'
import { DANE, KORZEN, wczytajAdresy } from './lib/wspolne.mjs'
import { PRZENIESIONE } from './uprosc-kryteria.mjs'

const wczytaj = (sciezka) => JSON.parse(readFileSync(sciezka, 'utf8'))
const PLIK_WSKAZNIKA = join(DANE, 'wskazniki', `${ID}.json`)

// Prawdziwe fragmenty uchwał z ELI (tekst PDF po pdftotext, białe znaki ściśnięte): różne myślniki,
// kolejność kwoty, numeracja punktów, nagłówek strony w środku pozycji. [TERYT, fragment, stawka]
const UCHWALY = [
  [
    '1261011',
    '2) od budynków lub ich części: a) mieszkalnych – 1,25 zł od 1 m2 powierzchni użytkowej, Dziennik Urzędowy Województwa Małopolskiego – 2 – Poz. 6495 b) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub i',
    1.25,
  ],
  [
    '1206052',
    '2) od budynków lub ich części : a) mieszkalnych - 0,84 zł od 1 m2 powierzchni użytkowej, b) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub ich części zajętych na prowadzenie działalności gospodarczej',
    0.84,
  ],
  [
    '1206082',
    '2) od budynków lub ich części: a) mieszkalnych – 1,25 zł od 1 m² powierzchni użytkowej, b) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub ich części zajętych na prowadzenie działalności gospodarczej ',
    1.25,
  ],
  [
    '1206072',
    '2. od budynków lub ich części: a) mieszkalnych −od 1 m2 powierzchni użytkowej, 1,12 zł b) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub ich części zajętych na prowadzenie działalności gospodarczej −',
    1.12,
  ],
  [
    '1206162',
    '2. od budynków lub ich części: 1) mieszkalnych – 0,82 zł od 1m² powierzchni użytkowej, 2) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub ich części zajętych na prowadzenie działalności gospodarczej –',
    0.82,
  ],
  [
    '1206152',
    '2) od budynków lub ich części; a) mieszkalnych - 1,14 zł od 1 m2 powierzchni użytkowej, b) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub ich części zajętych na prowadzenie działalności gospodarczej ',
    1.14,
  ],
  [
    '1219053',
    '2) od budynków lub ich części: a) mieszkalnych - 1,08 zł od 1 m2 powierzchni użytkowej, b) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub ich części zajętych na prowadzenie działalności gospodarczej ',
    1.08,
  ],
  [
    '1219043',
    '2) od budynków lub ich części: a) mieszkalnych - 0,89 zł od 1 m² powierzchni użytkowej, b) zajętych na prowadzenie działalności gospodarczej w zakresie obrotu kwalifikowanym materiałem siewnym – 16,64 zł od 1 m² powierzchni użytkowej, c) ',
    0.89,
  ],
  [
    '1206113',
    '2) od budynków lub ich części: a) mieszkalnych – 1,13 zł od 1 m² powierzchni użytkowej; b) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub ich części zajętych na prowadzenie działalności gospodarczej ',
    1.13,
  ],
  [
    '1206172',
    '2) od budynków lub ich części: a) mieszkalnych - 1,25 zł od 1 m2 powierzchni użytkowej, b) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub ich części zajętych na prowadzenie działalności gospodarczej ',
    1.25,
  ],
  [
    '1206143',
    '2) od budynków lub ich części: a) mieszkalnych – 0,77 zł od 1 m2 powierzchni użytkowej, b) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub ich części zajętych na prowadzenie działalności gospodarczej:',
    0.77,
  ],
  [
    '1214012',
    '2) od budynków lub ich części: a) mieszkalnych - 0,72 zł od 1 m2 powierzchni użytkowej, b) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub ich części zajętych na prowadzenie działalności gospodarczej ',
    0.72,
  ],
  [
    '1206092',
    '2) od budynków lub ich części: a) mieszkalnych – 0,95 zł od 1m² powierzchni użytkowej; b) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub ich części zajętych na prowadzenie działalności gospodarczej –',
    0.95,
  ],
  [
    '1206022',
    '2) od budynków lub ich części: a) mieszkalnych – 0,80zł od 1m2 powierzchni użytkowej, b) związanych z prowadzeniem działalności gospodarczej oraz od budynków mieszkalnych lub ich części zajętych na prowadzenie działalności gospodarczej – ',
    0.8,
  ],
]

test('parser czyta stawkę z 14 uchwał mimo różnic w zapisie', () => {
  for (const [teryt, fragment, stawka] of UCHWALY)
    assert.equal(stawkaMieszkalne(fragment).stawka, stawka, teryt)
})

test('parser nie zgaduje: brak części, pozycji, kwoty albo dwie kwoty to błąd', () => {
  assert.throws(() => stawkaMieszkalne('Uchwała w sprawie podatku'), /jednej części/)
  assert.throws(
    () => stawkaMieszkalne('2) od budynków lub ich części: a) gospodarczych – 3,00 zł'),
    /Brak pozycji/,
  )
  assert.throws(
    () => stawkaMieszkalne('2) od budynków lub ich części: a) mieszkalnych – od 1 m2 b) inne'),
    /0 kwot/,
  )
  assert.throws(
    () =>
      stawkaMieszkalne(
        '2) od budynków lub ich części: a) mieszkalnych – 1,25 zł albo 2,50 zł b) x',
      ),
    /2 kwot/,
  )
  // kwota z następnego punktu listy nie może zostać wzięta za stawkę mieszkalną
  assert.throws(
    () =>
      stawkaMieszkalne(
        '2) od budynków lub ich części: a) mieszkalnych – od 1 m2 b) inne – 9,99 zł',
      ),
    /0 kwot/,
  )
})

test('plik stawek: 14 gmin z adresów, stawka zgodna z fragmentem uchwały i w granicach ustawy', () => {
  const stawki = sprawdzStawki(wczytaj(PLIK_STAWEK))
  const { adresy } = wczytajAdresy()
  assert.deepEqual([...stawki.keys()].sort(), [...new Set(adresy.map((a) => a.teryt))].sort())
  assert.equal(stawki.size, 14)
  for (const [teryt, fragment] of UCHWALY) {
    assert.equal(stawki.get(teryt).stawkaZlM2, stawkaMieszkalne(fragment).stawka, teryt)
    assert.ok(stawki.get(teryt).stawkaZlM2 <= MAKS_STAWKA_ZL_M2, teryt)
  }
  assert.equal(UCHWALY.length, stawki.size)
})

test('plik stawek odrzuca stawkę ponad maksimum, duplikat TERYT, zły cytat i złą datę', () => {
  const dobry = () => structuredClone(wczytaj(PLIK_STAWEK))
  const zepsuj = (zmien) => {
    const p = dobry()
    zmien(p)
    return () => sprawdzStawki(p)
  }
  assert.throws(
    zepsuj((p) => {
      p.gminy[0].stawkaZlM2 = 1.3
    }),
    /poza/,
  )
  assert.throws(
    zepsuj((p) => {
      p.gminy[1].teryt = p.gminy[0].teryt
    }),
    /powtórzony TERYT/,
  )
  assert.throws(
    zepsuj((p) => {
      p.gminy[2].akt.cytat = 'mieszkalnych – 9,99 zł od 1 m2'
    }),
    /akt\.cytat/,
  )
  assert.throws(
    zepsuj((p) => {
      p.gminy[3].akt.obowiazujeOd = '1.01.2026'
    }),
    /obowiazujeOd/,
  )
  assert.throws(
    zepsuj((p) => {
      p.gminy[4].akt.obowiazujeOd = '2026-07-01'
    }),
    /po 1 stycznia/,
  )
  assert.throws(
    zepsuj((p) => {
      p.rok = 2025
    }),
    /rok/,
  )
})

const wierszeBudzetu = (teryt, wykonanie, nadpisz = {}) => ({
  gmina_teryt: teryt,
  rok: 2025,
  strona: 'D',
  dzial: '900',
  rozdzial: '90002',
  paragraf: '0490',
  plan: 0,
  wykonanie,
  zrodlo_url: 'https://dane.gov.pl/pl/dataset/872',
  ...nadpisz,
})
const wierszLudnosci = (teryt, wartosc, nadpisz = {}) => ({
  gmina_teryt: teryt,
  kod: 'ludnosc',
  rok: 2025,
  wartosc,
  jednostka: 'osoby',
  zrodlo_url: 'https://bdl.stat.gov.pl/api/v1/data/by-variable/72305?unit-level=6',
  ...nadpisz,
})

test('odczyt z-dykty: gmina bez wiersza ludności albo budżetu nie trafia do mapy', () => {
  const m = odczytajOdpady(
    [wierszeBudzetu('1261011', 415143961.45), wierszeBudzetu('1219053', 30750000)],
    [wierszLudnosci('1261011', 816614), wierszLudnosci('1206022', 7809)],
  )
  assert.deepEqual([...m.keys()], ['1261011'])
  assert.deepEqual(m.get('1261011'), { wykonanie: 415143961.45, ludnosc: 816614 })
})

test('odczyt z-dykty odrzuca zły rok, rozdział, duplikat i ujemną kwotę', () => {
  const lud = [wierszLudnosci('1261011', 816614)]
  const bud = (nadpisz) => [wierszeBudzetu('1261011', 1000, nadpisz)]
  assert.throws(() => odczytajOdpady(bud({ rok: 2024 }), lud), /nieoczekiwany wiersz/)
  assert.throws(() => odczytajOdpady(bud({ rozdzial: '60019' }), lud), /nieoczekiwany wiersz/)
  assert.throws(() => odczytajOdpady(bud({ strona: 'W' }), lud), /nieoczekiwany wiersz/)
  assert.throws(() => odczytajOdpady([...bud(), ...bud()], lud), /powtórzony TERYT/)
  assert.throws(() => odczytajOdpady(bud({ wykonanie: -1 }), lud), /zła kwota/)
  assert.throws(() => odczytajOdpady(bud(), [wierszLudnosci('1261011', 0)]), /zła wartość/)
  assert.throws(
    () => odczytajOdpady(bud(), [wierszLudnosci('1261011', 1, { kod: 'inny' })]),
    /nieoczekiwany wiersz/,
  )
})

test('rozbicie: Kraków to 3 × 508,37 zł opłaty i 60 m² × 1,25 zł podatku, suma z zaokrąglonych składników', () => {
  const r = rozbijGmine({ wykonanie: 415143961.45, ludnosc: 816614 }, { stawkaZlM2: 1.25 })
  assert.equal(OSOBY, 3)
  assert.equal(POWIERZCHNIA_M2, 60)
  assert.equal(r.smieci, 1525)
  assert.equal(r.podatek, 75)
  assert.equal(r.razem, r.smieci + r.podatek)
  assert.equal(r.razem, 1600)
  assert.equal(etykieta(r), 'odpady 1525 zł + podatek 75 zł (3 os., 60 m²)')
})

test('rozbicie: brak danych to null, nie 0, a wpływ poniżej progu związku gmin też', () => {
  const o = { wykonanie: 4_000_000, ludnosc: 10_000 }
  const s = { stawkaZlM2: 1 }
  assert.ok(rozbijGmine(o, s))
  assert.equal(rozbijGmine(undefined, s), null)
  assert.equal(rozbijGmine(o, undefined), null)
  assert.equal(rozbijGmine({ wykonanie: 0, ludnosc: 10_000 }, s), null)
  assert.equal(rozbijGmine({ wykonanie: MIN_ODPADY_NA_OSOBE * 9_999, ludnosc: 10_000 }, s), null)
  assert.throws(
    () => rozbijGmine({ wykonanie: (MAKS_ODPADY_NA_OSOBE + 1) * 10_000, ludnosc: 10_000 }, s),
    /błąd danych/,
  )
})

test('wskaźnik: adres gminy bez danych dostaje null i brak etykiety, reszta wartość i klucz słownika', () => {
  const adresy = [
    { teryt: '1000001' },
    { teryt: '1000002' },
    { teryt: '1000003' },
    { teryt: '1000001' },
  ]
  const odpady = new Map([
    ['1000001', { wykonanie: 4_000_000, ludnosc: 10_000 }],
    ['1000003', { wykonanie: 3_000_000, ludnosc: 10_000 }],
  ])
  const stawki = new Map([
    ['1000001', { stawkaZlM2: 1 }],
    ['1000002', { stawkaZlM2: 1 }],
  ])
  const w = zbudujWskaznik(adresy, odpady, stawki)
  // 1000001: 3 × 400 + 60 × 1 = 1260; 1000002 bez wpływów, 1000003 bez stawki
  assert.deepEqual(w.wartosci, [1260, null, null, 1260])
  assert.deepEqual(w.etykiety, ['0', null, null, '0'])
  assert.deepEqual(w.slownikEtykiet, { 0: 'odpady 1200 zł + podatek 60 zł (3 os., 60 m²)' })
})

test('opublikowany wskaźnik: te same liczby, etykiety i słownik co z migawki wejścia i stawek', () => {
  const p = wczytaj(PLIK_WSKAZNIKA)
  const { wersja, adresy } = wczytajAdresy()
  const migawka = wczytaj(PLIK_ODPADOW)
  const odpady = new Map(Object.entries(migawka.gminy))
  const stawki = sprawdzStawki(wczytaj(PLIK_STAWEK))
  const w = zbudujWskaznik(adresy, odpady, stawki)
  assert.equal(p.wersjaAdresow, wersja)
  assert.equal(p.wartosci.length, adresy.length)
  assert.deepEqual(p.wartosci, w.wartosci)
  assert.deepEqual(p.etykiety, w.etykiety)
  assert.deepEqual(p.slownikEtykiet, w.slownikEtykiet)
  assert.equal(migawka.rok, 2025)
})

test('opublikowany wskaźnik: wartość stała w gminie, 14 gmin bez luk, składniki dodają się do liczby', () => {
  const p = wczytaj(PLIK_WSKAZNIKA)
  const { adresy } = wczytajAdresy()
  const poGminie = new Map()
  for (const a of adresy) {
    const g = poGminie.get(a.teryt) ?? { wartosci: new Set(), klucze: new Set(), n: 0 }
    g.wartosci.add(p.wartosci[a.i])
    g.klucze.add(p.etykiety[a.i])
    g.n++
    poGminie.set(a.teryt, g)
  }
  assert.equal(poGminie.size, 14)
  for (const [teryt, g] of poGminie) {
    assert.equal(g.wartosci.size, 1, `${teryt}: różne wartości w jednej gminie`)
    assert.equal(g.klucze.size, 1, `${teryt}: różne etykiety w jednej gminie`)
    const [wartosc] = g.wartosci
    assert.ok(
      Number.isInteger(wartosc) && wartosc >= 800 && wartosc <= 2500,
      `${teryt}: ${wartosc}`,
    )
    const [odpady, podatek] = /^odpady (\d+) zł \+ podatek (\d+) zł/
      .exec(p.slownikEtykiet[[...g.klucze][0]])
      .slice(1)
      .map(Number)
    assert.equal(odpady + podatek, wartosc, `${teryt}: suma składników`)
  }
  // Kraków (70 217 adresów z MSIP) ma największą liczbę adresów w jednej wartości
  assert.equal(poGminie.get('1261011').n, 70217)
})

test('metadane: grupa z PRZENIESIONE, gmina, zł/rok, cztery źródła z licencją i atrybucją z-dykty.pl', () => {
  const { meta } = wczytaj(PLIK_WSKAZNIKA)
  assert.equal(meta.id, ID)
  // Od #171 grupę i kierunek nadaje PRZENIESIONE (etl/uprosc-kryteria.mjs), z wagą startową 0.
  assert.deepEqual([meta.kategoria, meta.kierunek], PRZENIESIONE[ID])
  assert.equal(meta.domyslnaWaga, 0)
  assert.equal(meta.rozdzielczosc, 'gmina')
  assert.equal(meta.jednostka, 'zł/rok')
  assert.equal(meta.zadanie, 140)
  assert.equal(meta.zrodla.length, 4)
  for (const z of meta.zrodla)
    for (const k of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano'])
      assert.ok(z[k], `${z.nazwa}: ${k}`)
  assert.ok(meta.zrodla.every((z) => /^\d{4}-\d{2}-\d{2}$/.test(z.pobrano)))
  assert.ok(meta.zrodla.some((z) => /przetworzone przez z-dykty\.pl \(CC BY 4\.0\)/.test(z.nazwa)))
  assert.ok(meta.zrodla.some((z) => z.url === 'https://dane.gov.pl/pl/dataset/872'))
  for (const fraza of ['3 osoby', '60 m²', 'rozdz. 90002', 'nie adresu'])
    assert.ok(meta.opis.includes(fraza), fraza)
  // metadane powstają z generatora, nie z ręcznej edycji pliku; od #171
  // etl/uprosc-kryteria.mjs nadpisuje tylko grupę i kierunek (PRZENIESIONE) i wagę startową 0
  const [kategoria, kierunek] = PRZENIESIONE[ID]
  assert.deepEqual(meta, {
    ...zbudujMeta({
      pobranoZdykty: meta.zrodla[0].pobrano,
      urlBudzet: meta.zrodla[1].url,
      urlLudnosc: meta.zrodla[2].url,
      pobranoStawek: meta.zrodla[3].pobrano,
    }),
    kategoria,
    kierunek,
    domyslnaWaga: 0,
  })
})

test('plik wskaźnika mieści się w limicie 2 MB z kontraktu', () => {
  assert.ok(readFileSync(PLIK_WSKAZNIKA).length < 2 * 1024 * 1024)
})

test('typografia: w opublikowanych plikach i dokumentacji nie ma znaku pauzy', () => {
  const PAUZA = String.fromCodePoint(0x2014)
  for (const sciezka of [
    PLIK_WSKAZNIKA,
    PLIK_STAWEK,
    PLIK_ODPADOW,
    join(KORZEN, 'etl', 'koszty-stale.md'),
    join(KORZEN, 'etl', 'koszty-stale.mjs'),
  ])
    assert.ok(!readFileSync(sciezka, 'utf8').includes(PAUZA), sciezka)
})
