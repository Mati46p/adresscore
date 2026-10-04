import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { type BialaPlama, odmiana } from './biznes.ts'
import { branzaWDopelniaczu } from './biznesBranze.ts'
import {
  bezPauzy,
  kluczeZrodelBranzy,
  opisHeksuBiznesu,
  URL_PRAW_OSM,
  wpisyZrodel,
  wpisyZrodelBranzy,
  wpisZrodlaKatalogu,
  zdaniePozycji,
} from './biznesOpis.ts'
import {
  type BranzaKatalogu,
  czytajKatalog,
  type KatalogUslug,
  type ZrodloKatalogu,
} from './biznesUslugi.ts'

// Popyt leży w `public/dane/biznes`, katalog punktów usług w `public/dane/uslugi`.
const sciezka = (plik: string) =>
  fileURLToPath(new URL(`../../public/dane/biznes/${plik}`, import.meta.url))
const sciezkaUslug = (plik: string) =>
  fileURLToPath(new URL(`../../public/dane/uslugi/${plik}`, import.meta.url))
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

test('zdanie karty odmienia branże z katalogu usług, także po starym id z linku', () => {
  assert.equal(zdaniePozycji(70, 'sklep_spozywczy').po, 'istniejących sklepów spożywczych')
  assert.equal(zdaniePozycji(70, 'sklep').po, 'istniejących sklepów spożywczych')
  assert.equal(zdaniePozycji(30, 'poz').po, 'istniejących przychodni POZ')
  assert.equal(zdaniePozycji(30, 'przychodnia').po, 'istniejących przychodni POZ')
  assert.equal(zdaniePozycji(80, 'dentysta').po, 'istniejących gabinetów stomatologicznych')
  assert.equal(zdaniePozycji(50, 'restauracja').liczba, '5 na 10')
})

test('zdanie karty może nazwać zawężoną konkurencję zamiast całej branży', () => {
  const z = zdaniePozycji(70, 'restauracja', 'restauracji bez fast foodów')
  assert.equal(
    z.pelny,
    'Więcej klientów w zasięgu niż 7 na 10 istniejących restauracji bez fast foodów',
  )
  assert.equal(z.po, 'istniejących restauracji bez fast foodów')
  assert.ok(!z.pelny.includes('%'))
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

// ── Atrybucja źródeł punktów (katalog usług) ─────────────────────────────────────────────

const zrodloTestowe = (atrybucja: string, licencja: string, url: string): ZrodloKatalogu => ({
  nazwa: atrybucja,
  url,
  licencja,
  atrybucja,
  dataDanych: '2026-10-02',
})

const branzaTestowa = (
  id: string,
  zrodlaWPliku: string[],
  rejestr: string | null,
  flagi: Record<string, { zrodlo?: string }>,
): BranzaKatalogu => ({
  id,
  nazwa: id,
  zasiegPieszyM: 500,
  plik: `${id}.json`,
  n: 10,
  zrodlaWPliku,
  mapowanie: { rejestr, flagi },
  liczby: { potwierdzoneWielomaZrodlami: 1, zFlaga: {} },
})

/** Katalog z pięcioma źródłami i czterema branżami: sklep, apteka (rejestr), dentysta (RPWDL i NFZ), fryzjer. */
function katalogTestowy(): KatalogUslug {
  return {
    wersja: 1,
    wygenerowano: '2026-10-04',
    obszar: { bbox: { minLat: 49.8, maxLat: 50.3, minLon: 19.5, maxLon: 20.5 } },
    zrodla: {
      osm: zrodloTestowe(
        '© OpenStreetMap contributors, ODbL',
        'Open Database License (ODbL) 1.0',
        'https://download.geofabrik.de/',
      ),
      overture: zrodloTestowe(
        'Overture Maps Foundation, Places (CDLA-Permissive-2.0)',
        'CDLA-Permissive-2.0',
        'https://docs.overturemaps.org/',
      ),
      rejestr_aptek: zrodloTestowe(
        'Centrum e-Zdrowia, Rejestr Aptek',
        'Dane publiczne rejestru',
        'https://rejestry.ezdrowie.gov.pl/',
      ),
      rpwdl: zrodloTestowe(
        'Centrum e-Zdrowia, RPWDL (CC BY 4.0)',
        'CC BY 4.0',
        'https://dane.gov.pl/rpwdl',
      ),
      nfz: zrodloTestowe(
        'Narodowy Fundusz Zdrowia, Informator o Terminach Leczenia (https://api.nfz.gov.pl/)',
        'CC BY 4.0',
        'https://api.nfz.gov.pl/',
      ),
    },
    branze: [
      branzaTestowa('sklep', ['osm', 'overture'], null, {}),
      branzaTestowa('apteka', ['osm', 'overture', 'rejestr'], 'rejestr_aptek', {}),
      branzaTestowa('dentysta', ['osm', 'overture', 'rejestr'], 'rpwdl', {
        nfz: { zrodlo: 'nfz' },
      }),
      branzaTestowa('fryzjer', ['osm', 'overture'], null, { barber: {} }),
    ],
  }
}

const branzaZ = (k: KatalogUslug, id: string): BranzaKatalogu => {
  const b = k.branze.find((x) => x.id === id)
  assert.ok(b, `brak branży ${id} w katalogu testowym`)
  return b
}

test('źródła branży to tylko te, które ona ma: sklep bez rejestrów, apteka z rejestrem aptek', () => {
  const k = katalogTestowy()
  assert.deepEqual(kluczeZrodelBranzy(branzaZ(k, 'sklep')), ['osm', 'overture'])
  assert.deepEqual(kluczeZrodelBranzy(branzaZ(k, 'apteka')), ['osm', 'overture', 'rejestr_aptek'])
  // Dentysta: rejestr to RPWDL (nie Rejestr Aptek), a NFZ dochodzi z flagi z osobnego źródła.
  assert.deepEqual(kluczeZrodelBranzy(branzaZ(k, 'dentysta')), ['osm', 'overture', 'rpwdl', 'nfz'])
  // Flaga bez osobnego źródła (barber z tagów) nie dokłada wpisu.
  assert.deepEqual(kluczeZrodelBranzy(branzaZ(k, 'fryzjer')), ['osm', 'overture'])
})

test('wpis źródła: gotowa atrybucja, link do praw OSM i licencja z datą w opisie', () => {
  const k = katalogTestowy()
  const osm = wpisZrodlaKatalogu('osm', k.zrodla.osm)
  assert.equal(osm.nazwa, '© OpenStreetMap contributors, ODbL')
  assert.equal(osm.url, URL_PRAW_OSM)
  assert.equal(osm.url, 'https://www.openstreetmap.org/copyright')
  assert.equal(osm.opis, 'Open Database License (ODbL) 1.0; dane z 2026-10-02')
  const nfz = wpisZrodlaKatalogu('nfz', k.zrodla.nfz)
  assert.match(nfz.nazwa, /Informator o Terminach Leczenia \(https:\/\/api\.nfz\.gov\.pl\/\)/)
  assert.equal(nfz.url, 'https://api.nfz.gov.pl/')
  // Źródło, którego katalog nie opisuje, nie ginie: lista ma je wskazać, a nie po cichu pominąć.
  const brak = wpisZrodlaKatalogu('nowe', undefined)
  assert.equal(brak.nazwa, 'nowe')
  assert.equal(brak.url, null)
  assert.match(brak.opis, /brak opisu/)
})

test('atrybucja wybranej branży: dentysta ma cztery wpisy, sklep dwa, bez cudzych źródeł', () => {
  const k = katalogTestowy()
  const wpisy = (id: string) => wpisyZrodelBranzy(k, branzaZ(k, id)).map((w) => w.nazwa)
  assert.equal(wpisy('sklep').length, 2)
  assert.ok(wpisy('sklep').every((n) => !/e-Zdrowia|Fundusz/.test(n)))
  const dentysta = wpisy('dentysta')
  assert.equal(dentysta.length, 4)
  assert.ok(dentysta.some((n) => /OpenStreetMap contributors/.test(n)))
  assert.ok(dentysta.some((n) => /Overture Maps Foundation/.test(n)))
  assert.ok(dentysta.some((n) => /RPWDL/.test(n)))
  assert.ok(dentysta.some((n) => /Narodowy Fundusz Zdrowia/.test(n)))
  assert.ok(!dentysta.some((n) => /Rejestr Aptek/.test(n)))
  assert.ok(wpisy('apteka').some((n) => /Rejestr Aptek/.test(n)))
  assert.ok(!wpisy('apteka').some((n) => /RPWDL/.test(n)))
})

test('atrybucja z prawdziwego katalogu: każda z 26 branż ma OSM i Overture, a rejestry i NFZ tylko tam, gdzie trzeba', (t) => {
  const plik = sciezkaUslug('katalog.json')
  if (!existsSync(plik)) return t.skip('brak public/dane/uslugi/katalog.json')
  const k = czytajKatalog(JSON.parse(readFileSync(plik, 'utf8')))
  assert.equal(k.branze.length, 26)
  const zRpwdl = new Set(['poz', 'dentysta', 'fizjoterapia', 'laboratorium'])
  for (const b of k.branze) {
    const wpisy = wpisyZrodelBranzy(k, b)
    const razem = wpisy.map((w) => `${w.nazwa} ${w.opis}`).join('\n')
    assert.match(razem, /OpenStreetMap contributors/, b.id)
    assert.match(razem, /ODbL/, b.id)
    assert.match(razem, /Overture Maps Foundation/, b.id)
    assert.match(razem, /CDLA-Permissive-2\.0/, b.id)
    assert.equal(/RPWDL/.test(razem), zRpwdl.has(b.id), `RPWDL w ${b.id}`)
    assert.equal(/Rejestr Aptek/.test(razem), b.id === 'apteka', `Rejestr Aptek w ${b.id}`)
    assert.equal(/Narodowy Fundusz Zdrowia/.test(razem), b.id === 'dentysta', `NFZ w ${b.id}`)
    assert.ok(!/CEIDG/.test(razem), `CEIDG w ${b.id}: pliki są bez CEIDG`)
    const oczekiwane = 2 + (b.mapowanie.rejestr ? 1 : 0) + (b.id === 'dentysta' ? 1 : 0)
    assert.equal(wpisy.length, oczekiwane, b.id)
    for (const w of wpisy) {
      assert.ok(w.nazwa.length > 8, b.id)
      assert.ok(w.url?.startsWith('https://'), `${b.id}: ${w.nazwa}`)
      assert.match(w.opis, /dane z 20\d\d-\d\d-\d\d/, `${b.id}: data danych w ${w.nazwa}`)
      assert.ok(!`${w.nazwa}${w.opis}`.includes(PAUZA), b.id)
    }
    // OSM prowadzi do strony praw, jak wymaga ODbL.
    assert.equal(wpisy[0]?.url, URL_PRAW_OSM, b.id)
  }
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
