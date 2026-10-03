import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { BialaPlama } from './biznes.ts'
import {
  bezPauzy,
  branzaWDopelniaczu,
  odmiana,
  opisHeksuBiznesu,
  wpisyZrodel,
  wpisZrodlaPunktow,
  zdaniePozycji,
} from './biznesOpis.ts'

const sciezka = (plik: string) =>
  fileURLToPath(new URL(`../../public/dane/biznes/${plik}`, import.meta.url))
const PAUZA = String.fromCodePoint(0x2014)

const plama = (czesc: Partial<BialaPlama>): BialaPlama => ({
  h3: 'h',
  adresyNaPunkt: 300,
  adresyWZasiegu: 300,
  konkurenci: 1,
  najblizszyKonkurent: 'Apteka Zdrowie',
  skala: 50,
  ...czesc,
})

test('główna liczba karty ma kierunek słowami i nie używa znaku %', () => {
  assert.equal(
    zdaniePozycji(70, 'apteka').pelny,
    'Więcej klientów w zasięgu niż 7 na 10 istniejących aptek',
  )
  assert.equal(zdaniePozycji(70, 'apteka').liczba, '7 na 10')
  assert.equal(zdaniePozycji(0, 'sklep').liczba, '0 na 10')
  assert.equal(zdaniePozycji(100, 'sklep').liczba, '10 na 10')
  assert.equal(zdaniePozycji(87, 'kawiarnia').liczba, '9 na 10')
  assert.equal(zdaniePozycji(54, 'paczkomat').liczba, '5 na 10')
  for (const p of [0, 4, 5, 33, 50, 99, 100]) {
    const z = zdaniePozycji(p, 'fryzjer')
    assert.ok(!z.pelny.includes('%'), z.pelny)
    assert.ok(z.pelny.startsWith('Więcej klientów w zasięgu niż '), z.pelny)
    assert.equal(z.pelny, `${z.przed} ${z.liczba} ${z.po}`)
  }
})

test('branża spoza słownika dostaje bezpieczne „punktów tej branży”', () => {
  assert.equal(branzaWDopelniaczu('nieznana'), 'punktów tej branży')
  assert.equal(zdaniePozycji(60, 'nieznana').po, 'istniejących punktów tej branży')
})

test('każda branża z katalogu ma własną odmianę (żadna nie spada na zapasowe słowa)', (t) => {
  const plik = sciezka('katalog.json')
  if (!existsSync(plik)) return t.skip('brak public/dane/biznes/katalog.json')
  const katalog = JSON.parse(readFileSync(plik, 'utf8')) as { id: string; nazwa: string }[]
  assert.ok(katalog.length >= 7)
  for (const { id, nazwa } of katalog)
    assert.notEqual(
      branzaWDopelniaczu(id),
      'punktów tej branży',
      `brak odmiany dla ${nazwa} (${id})`,
    )
})

test('odmiana liczebników: 1 adres, 2 adresy, 5 adresów, 22 adresy, 112 adresów', () => {
  const o = (n: number) => odmiana(n, 'adres', 'adresy', 'adresów')
  assert.deepEqual([1, 2, 4, 5, 12, 14, 22, 112, 0].map(o), [
    'adres',
    'adresy',
    'adresy',
    'adresów',
    'adresów',
    'adresów',
    'adresy',
    'adresów',
    'adresów',
  ])
})

test('dymek heksu: brak punktu to inna kategoria niż jeden punkt', () => {
  const bez = opisHeksuBiznesu(
    [plama({ adresyNaPunkt: null, konkurenci: 0, najblizszyKonkurent: null })],
    10,
    800,
  )
  const jeden = opisHeksuBiznesu([plama({})], 10, 800)
  assert.notEqual(bez, jeden)
  assert.match(bez, /^Brak punktu w zasięgu 800 m/)
  assert.ok(!bez.includes('na punkt'), bez)
  assert.equal(jeden, '300 adresów na punkt · 1 punkt w zasięgu · najbliżej: Apteka Zdrowie')
})

test('dymek heksu: liczby i odmiana', () => {
  // pl-PL grupuje tysiące dopiero od pięciu cyfr ("1234", ale "12 346" z twardą spacją).
  assert.equal(
    opisHeksuBiznesu(
      [plama({ adresyNaPunkt: 1234.4, konkurenci: 5, najblizszyKonkurent: null })],
      10,
      800,
    ),
    '1234 adresy na punkt · 5 punktów w zasięgu · najbliżej: punkt bez nazwy',
  )
  assert.match(
    opisHeksuBiznesu([plama({ adresyNaPunkt: 12345.6, konkurenci: 11 })], 10, 800),
    /^12\s346 adresów na punkt · 11 punktów w zasięgu/,
  )
  assert.match(
    opisHeksuBiznesu([plama({ adresyNaPunkt: 2, konkurenci: 2 })], 10, 800),
    /^2 adresy na punkt · 2 punkty/,
  )
  assert.match(
    opisHeksuBiznesu([plama({ adresyNaPunkt: null, konkurenci: 0, adresyWZasiegu: 1 })], 10, 800),
    /· 1 adres w zasięgu$/,
  )
  assert.equal(opisHeksuBiznesu([], 10, 800), 'Brak danych')
})

test('dymek większego heksu podaje średnią w adresach na punkt, nie indeks 0–100', () => {
  const dzieci = [
    plama({ adresyNaPunkt: 100 }),
    plama({ adresyNaPunkt: 300 }),
    plama({ adresyNaPunkt: null, konkurenci: 0 }),
  ]
  const tekst = opisHeksuBiznesu(dzieci, 9, 800)
  assert.equal(tekst, 'Okolica: średnio 200 adresów na punkt · bez punktu w zasięgu: 1 z 3 heksów')
  assert.ok(!/indeks|\/100/i.test(tekst), tekst)
  assert.equal(
    opisHeksuBiznesu([plama({ adresyNaPunkt: 50 }), plama({ adresyNaPunkt: 50 })], 8, 800),
    'Okolica: średnio 50 adresów na punkt',
  )
  assert.equal(
    opisHeksuBiznesu(
      [
        plama({ adresyNaPunkt: null, konkurenci: 0 }),
        plama({ adresyNaPunkt: null, konkurenci: 0 }),
      ],
      9,
      1000,
    ),
    'Okolica: brak punktu w zasięgu 1000 m w żadnym z 2 heksów',
  )
  // Przy r9 z jednym dzieckiem to nadal okolica, nie opis pojedynczego heksu.
  assert.match(opisHeksuBiznesu([plama({})], 9, 800), /^Okolica: /)
})

test('pauza z nazw źródeł wraca jako półpauza', () => {
  assert.equal(bezPauzy(`MSIP ${PAUZA} punkty adresowe`), 'MSIP – punkty adresowe')
  const wpisy = wpisyZrodel([
    {
      nazwa: `Portal MSIP ${PAUZA} punkty`,
      url: 'https://x.pl',
      licencja: `Regulamin ${PAUZA} MSIP`,
      dataDanych: '2026-09-21',
    },
    { nazwa: 'Bez licencji' },
  ])
  assert.equal(wpisy[0]?.nazwa, 'Portal MSIP – punkty')
  assert.equal(wpisy[0]?.opis, 'Regulamin – MSIP; dane z 2026-09-21')
  assert.equal(wpisy[0]?.url, 'https://x.pl')
  assert.equal(wpisy[1]?.url, null)
  assert.equal(wpisy[1]?.opis, '')
  for (const w of wpisy) assert.ok(!`${w.nazwa}${w.opis}`.includes(PAUZA))
})

test('atrybucja punktów: OpenStreetMap z odnośnikiem do praw i licencją ODbL', () => {
  const z = wpisZrodlaPunktow({
    zrodlo: '© OpenStreetMap contributors, wyciąg Geofabrik Małopolskie',
    licencja: 'ODbL 1.0',
    dataDanych: '2026-10-02',
  })
  assert.match(z.nazwa, /OpenStreetMap contributors/)
  assert.equal(z.url, 'https://www.openstreetmap.org/copyright')
  assert.equal(z.opis, 'licencja ODbL 1.0; dane z 2026-10-02')
  // Przed wczytaniem pliku branży atrybucja już jest, tylko bez daty.
  const przed = wpisZrodlaPunktow(null)
  assert.match(przed.nazwa, /OpenStreetMap contributors/)
  assert.equal(przed.opis, 'licencja ODbL 1.0')
  assert.ok(!przed.opis.includes('undefined'))
})

test('wszystkie źródła popytu z popyt.json trafiają na listę, bez pauzy', (t) => {
  const plik = sciezka('popyt.json')
  if (!existsSync(plik)) return t.skip('brak public/dane/biznes/popyt.json')
  const { zrodla } = JSON.parse(readFileSync(plik, 'utf8')) as {
    zrodla: { nazwa: string; url?: string; licencja?: string; dataDanych?: string }[]
  }
  assert.ok(zrodla.length >= 4, 'plik popytu opisuje swoje źródła')
  const wpisy = wpisyZrodel(zrodla)
  assert.equal(wpisy.length, zrodla.length)
  const razem = wpisy.map((w) => `${w.nazwa} ${w.opis}`).join('\n')
  assert.ok(!razem.includes(PAUZA), 'w UI nie ma pauzy')
  for (const w of wpisy) {
    assert.ok(w.nazwa.length > 5)
    assert.ok(w.url?.startsWith('https://'), w.nazwa)
  }
  // Rejestry, z których składa się popyt, są wymienione z nazwy.
  for (const fraza of [/MSIP/, /GUGiK/, /GUS/, /GTFS/]) assert.match(razem, fraza)
})
