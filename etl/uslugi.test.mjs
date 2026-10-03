import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { odlegloscMetry } from './lib/codziennosc-geo.mjs'
import { kluczZPliku, planujStrony, punktyZRekordow, zredukujFirme } from './lib/uslugi-ceidg.mjs'
import { podobneNazwy, polaczPunkty, tenSamLokal } from './lib/uslugi-dedup.mjs'
import {
  BITY_ZRODEL,
  BRANZE,
  BRANZE_PO_ID,
  klasyfikujOsm,
  klasyfikujOverture,
  nazwaPozPodobna,
  OPISY_ZRODEL,
  pkdDoParametru,
  rozbierzRegule,
} from './lib/uslugi-katalog.mjs'
import { wygladaNaOsobe } from './lib/uslugi-nazwy.mjs'
import {
  nazwaPubliczna,
  sprawdzWyjscie,
  zbudujPlikBranzy,
  zlozWyjscie,
} from './lib/uslugi-wyjscie.mjs'

const BBOX = { minLat: 49.84, maxLat: 50.3, minLon: 19.58, maxLon: 20.46 }
const LAT0 = 50.06
const LON0 = 19.94

/** Punkt przesunięty o (wschód, północ) metrów względem Rynku. */
const pkt = (zrodlo, branza, nazwa, wschodM = 0, polnocM = 0, flagi = []) => ({
  zrodlo,
  branza,
  nazwa,
  lat: LAT0 + polnocM / 111_195,
  lon: LON0 + wschodM / (111_195 * Math.cos((LAT0 * Math.PI) / 180)),
  flagi,
})

// --- Katalog ---------------------------------------------------------------------------------

test('katalog: branże v1 bez paczkomatu, spójne identyfikatory i mapowania', () => {
  assert.deepEqual(
    BRANZE.map((b) => b.id),
    ['sklep_spozywczy', 'apteka', 'fryzjer', 'piekarnia', 'kawiarnia', 'poz'],
  )
  assert.equal(new Set(BRANZE.map((b) => b.id)).size, BRANZE.length)
  for (const b of BRANZE) {
    assert.ok(b.zasiegPieszyM >= 300 && b.zasiegPieszyM <= 2000, `${b.id}: zasięg`)
    assert.ok(b.minPunktow > 0, `${b.id}: strażnik`)
    assert.ok(b.osm.length && b.overture.length, `${b.id}: OSM i Overture`)
    for (const pkd of b.pkd) assert.match(pkd, /^\d\d\.\d\d\.Z$/)
    if (b.zrodloPrawdy) assert.ok(b.rejestr && OPISY_ZRODEL[b.rejestr], `${b.id}: rejestr`)
    if (b.rejestr) assert.ok(OPISY_ZRODEL[b.rejestr], `${b.id}: opis rejestru`)
  }
  assert.equal(BRANZE_PO_ID.paczkomat, undefined)
})

test('katalog: bity źródeł to różne potęgi dwójki, każde źródło ma opis licencji', () => {
  const bity = Object.values(BITY_ZRODEL)
  assert.equal(new Set(bity).size, bity.length)
  for (const b of bity) assert.equal(b & (b - 1), 0)
  for (const id of ['osm', 'overture', 'rejestr_aptek', 'rpwdl', 'ceidg'])
    assert.ok(OPISY_ZRODEL[id].licencja && OPISY_ZRODEL[id].atrybucja, id)
  assert.match(OPISY_ZRODEL.osm.atrybucja, /OpenStreetMap contributors, ODbL/)
  assert.match(OPISY_ZRODEL.overture.licencja, /CDLA-Permissive-2\.0/)
})

test('katalog: reguły napisowe i PKD', () => {
  assert.deepEqual(rozbierzRegule('amenity=doctors?poz'), {
    klucz: 'amenity',
    wartosc: 'doctors',
    filtr: 'poz',
  })
  assert.deepEqual(rozbierzRegule('bakery'), { klucz: null, wartosc: 'bakery', filtr: null })
  assert.equal(pkdDoParametru('96.21.Z'), '9621Z')
})

test('mapowanie OSM: sklep, apteka, fryzjer z flagą barber, piekarnia z kawiarnią', () => {
  const ids = (t) => klasyfikujOsm(t).map((x) => x.branza)
  assert.deepEqual(ids({ shop: 'convenience' }), ['sklep_spozywczy'])
  assert.deepEqual(ids({ shop: 'supermarket' }), ['sklep_spozywczy'])
  assert.deepEqual(ids({ shop: 'greengrocer' }), ['sklep_spozywczy'])
  assert.deepEqual(ids({ shop: 'butcher' }), [])
  assert.deepEqual(ids({ amenity: 'pharmacy' }), ['apteka'])
  assert.deepEqual(ids({ amenity: 'pharmacy', dispensing: 'no' }), [])
  const barber = klasyfikujOsm({ shop: 'hairdresser', hairdresser: 'barber' })
  assert.deepEqual(barber, [{ branza: 'fryzjer', flagi: ['barber'] }])
  assert.deepEqual(klasyfikujOsm({ shop: 'hairdresser' }), [{ branza: 'fryzjer', flagi: [] }])
  assert.deepEqual(ids({ shop: 'bakery', amenity: 'cafe' }).sort(), ['kawiarnia', 'piekarnia'])
  assert.deepEqual(ids({ shop: 'pastry' }), ['piekarnia'])
  assert.deepEqual(ids({ shop: 'confectionery' }), [])
})

test('mapowanie OSM: obiekty nieczynne (disused:, abandoned:) odpadają', () => {
  assert.deepEqual(klasyfikujOsm({ shop: 'supermarket', 'disused:shop': 'supermarket' }), [])
  assert.deepEqual(klasyfikujOsm({ amenity: 'cafe', 'abandoned:amenity': 'cafe' }), [])
})

test('mapowanie OSM: POZ po specjalizacji i po nazwie, specjaliści odpadają', () => {
  const poz = (t) => klasyfikujOsm(t).some((x) => x.branza === 'poz')
  assert.ok(poz({ amenity: 'doctors', 'healthcare:speciality': 'general', name: 'NZOZ Tyniec' }))
  assert.ok(poz({ amenity: 'doctors', name: 'Przychodnia Rejonowa nr 14 - SPZOZ Nowa Huta' }))
  assert.ok(poz({ amenity: 'clinic', name: 'Ośrodek Zdrowia w Skale' }))
  assert.ok(!poz({ amenity: 'doctors', 'healthcare:speciality': 'dermatology', name: 'Derma' }))
  assert.ok(!poz({ amenity: 'doctors', name: 'Centrum Medyczne Evita' }))
  assert.ok(!poz({ amenity: 'doctors' }))
  assert.ok(!poz({ amenity: 'clinic', healthcare: 'emergency_ward', name: 'SOR' }))
  // Nazwa zdradzająca izbę przyjęć wyklucza także przy specjalizacji „general".
  assert.ok(
    !poz({
      amenity: 'doctors',
      'healthcare:speciality': 'general',
      name: 'Szpitalna Izba przyjęć',
    }),
  )
  assert.ok(!poz({ amenity: 'doctors', name: 'Specjalistyczna Praktyka Lekarska dr Kowalski' }))
})

test('mapowanie Overture: kategorie branż, flaga barber, filtr POZ po nazwie', () => {
  const ids = (m) => klasyfikujOverture(m).map((x) => x.branza)
  assert.deepEqual(ids({ kat: 'convenience_store', nazwa: 'Żabka' }), ['sklep_spozywczy'])
  assert.deepEqual(ids({ kat: 'grocery_store', nazwa: 'Lidl' }), ['sklep_spozywczy'])
  assert.deepEqual(ids({ kat: 'pharmacy', nazwa: 'Apteka' }), ['apteka'])
  assert.deepEqual(ids({ kat: 'drugstore', nazwa: 'Rossmann' }), [])
  assert.deepEqual(klasyfikujOverture({ kat: 'barber', nazwa: 'X' }), [
    { branza: 'fryzjer', flagi: ['barber'] },
  ])
  assert.deepEqual(klasyfikujOverture({ kat: 'hair_salon', nazwa: 'X' }), [
    { branza: 'fryzjer', flagi: [] },
  ])
  assert.deepEqual(ids({ kat: 'coffee_shop', nazwa: 'Costa' }), ['kawiarnia'])
  assert.deepEqual(ids({ kat: 'cafe', nazwa: 'Cafe' }), ['kawiarnia'])
  assert.deepEqual(ids({ kat: 'internet_cafe', nazwa: 'Net' }), [])
  assert.deepEqual(ids({ kat: 'bakery', nazwa: 'Piekarnia' }), ['piekarnia'])
  assert.deepEqual(ids({ kat: 'family_practice', nazwa: 'Luxmed' }), ['poz'])
  assert.deepEqual(ids({ kat: 'doctors_office', nazwa: 'Przychodnia Salwatorska' }), ['poz'])
  assert.deepEqual(ids({ kat: 'doctors_office', nazwa: 'Juniordent - stomatologia' }), [])
  assert.deepEqual(ids({ kat: 'doctors_office', nazwa: 'Klinika Vesuna' }), [])
  assert.ok(nazwaPozPodobna('NZOZ Krakow Poludnie'))
  assert.ok(!nazwaPozPodobna('Przychodnia Stomatologiczna'))
})

// --- Deduplikacja ------------------------------------------------------------------------------

test('nazwy: podobieństwo ignoruje słowa ogólne, wielkość liter i ogonki', () => {
  assert.equal(podobneNazwy('Żabka', 'ŻABKA'), true)
  assert.equal(podobneNazwy('Salon Fryzjerski Ela', 'Fryzjer Ela'), true)
  assert.equal(podobneNazwy('Lewiatan', 'Lewiatan Żory'), true)
  assert.equal(podobneNazwy('Dbam o Zdrowie', 'DOZ Apteka Dbam o Zdrowie'), true)
  assert.equal(podobneNazwy('Matt Haircut - Fryzjerstwo Męskie', 'Matt Haircurt'), true)
  assert.equal(podobneNazwy('Żabka', 'Lewiatan'), false)
  assert.equal(podobneNazwy('Apteka nr 5', 'Apteka nr 7'), false)
  assert.equal(podobneNazwy('Spar', 'Sparrow'), false)
  // Nazwa nieznana albo składająca się ze słów ogólnych: decyduje sama odległość.
  assert.equal(podobneNazwy('Sklep spożywczy', 'Żabka'), null)
  assert.equal(podobneNazwy(null, 'Żabka'), null)
  assert.equal(podobneNazwy('Apteka', 'Apteka'), null)
})

test('dedup: ta sama nazwa do 30 m łączy źródła, dalej nie; różne nazwy nigdy', () => {
  const k = polaczPunkty([
    pkt('osm', 'sklep_spozywczy', 'Żabka', 0, 0),
    pkt('overture', 'sklep_spozywczy', 'Żabka', 20, 10),
    pkt('overture', 'sklep_spozywczy', 'Żabka', 200, 0),
    pkt('osm', 'sklep_spozywczy', 'Lewiatan', 5, 0),
  ])
  assert.equal(k.length, 3)
  const wspolny = k.find((x) => x.zrodla.size === 2)
  assert.deepEqual([...wspolny.zrodla].sort(), ['osm', 'overture'])
  assert.equal(k.filter((x) => x.nazwy.some((n) => n.nazwa === 'Lewiatan')).length, 1)
})

test('dedup: próg 30 m z nazwą i 15 m bez nazwy, granice nie są włączone', () => {
  const sasiad = (m, nazwa) => [
    pkt('osm', 'x', nazwa === null ? 'Sklep spożywczy' : 'Delikatesy Centrum', 0, 0),
    pkt('overture', 'x', nazwa, m, 0),
  ]
  assert.equal(polaczPunkty(sasiad(29, 'Delikatesy Centrum')).length, 1)
  assert.equal(polaczPunkty(sasiad(33, 'Delikatesy Centrum')).length, 2)
  assert.equal(polaczPunkty(sasiad(14, null)).length, 1)
  assert.equal(polaczPunkty(sasiad(17, null)).length, 2)
  // CEIDG nie ma nazwy: dołącza się do punktu z nazwą tylko w promieniu 15 m.
  const z = (m) => [pkt('osm', 'x', 'Salon Ela', 0, 0), { ...pkt('ceidg', 'x', null, m, 0) }]
  assert.equal(polaczPunkty(z(10)).length, 1)
  assert.equal(polaczPunkty(z(22)).length, 2)
  assert.equal(tenSamLokal(z(10)[0], z(10)[1]), true)
})

test('dedup: wynik nie zależy od kolejności wejścia, położenie bierze źródło OSM', () => {
  const wejscie = [
    pkt('overture', 'x', 'Piekarnia Pod Wawelem', 12, 0),
    pkt('ceidg', 'x', null, 3, 0),
    pkt('osm', 'x', 'Piekarnia Pod Wawelem', 0, 0),
    pkt('osm', 'x', 'Inna Piekarnia', 100, 100),
    pkt('rejestr', 'x', 'Inna Piekarnia', 105, 100),
  ]
  const a = polaczPunkty(wejscie)
  const b = polaczPunkty([...wejscie].reverse())
  const opis = (ks) =>
    ks
      .map((k) => `${k.lat.toFixed(6)},${k.lon.toFixed(6)}:${[...k.zrodla].sort().join('+')}`)
      .sort()
  assert.deepEqual(opis(a), opis(b))
  assert.equal(a.length, 2)
  const wawel = a.find((k) => k.nazwy.some((n) => n.nazwa === 'Piekarnia Pod Wawelem'))
  assert.deepEqual([...wawel.zrodla].sort(), ['ceidg', 'osm', 'overture'])
  assert.ok(
    odlegloscMetry(
      wawel.lat,
      wawel.lon,
      pkt('osm', 'x', '', 0, 0).lat,
      pkt('osm', 'x', '', 0, 0).lon,
    ) < 0.01,
  )
})

test('dedup: łańcuch punktów nie skleja się w jeden – liczy się odległość od punktu klastra', () => {
  const k = polaczPunkty([
    pkt('osm', 'x', 'Żabka', 0, 0),
    pkt('overture', 'x', 'Żabka', 25, 0),
    pkt('ceidg', 'x', null, 50, 0),
  ])
  assert.equal(k.length, 2)
})

test('dedup: flagi łączą się w sumę', () => {
  const [k] = polaczPunkty([
    pkt('osm', 'fryzjer', 'Barber Shop', 0, 0, ['barber']),
    pkt('overture', 'fryzjer', 'Barber Shop', 5, 0, []),
  ])
  assert.ok(k.flagi.has('barber'))
})

// --- Nazwy i dane osobowe ----------------------------------------------------------------------

test('nazwy osobowe: tytuł z nazwiskiem, imię z nazwiskiem, indywidualna praktyka', () => {
  for (const n of [
    'Lek. Maciej Haberka - Gabinet Locus Studiorum',
    'RehaPoint mgr Andrzej Likus',
    'Dr Grzesiak',
    'Barbara Żurek',
    'Anna Tyrka Hair Stylist',
    'Salon Fryzjerski Lucyna Szymaszek',
    'Więcek Rafał. Indywidualna praktyka lekarska',
    'Piotr Bąk',
  ])
    assert.equal(wygladaNaOsobe(n), true, n)
  for (const n of [
    'Żabka',
    'Apteka Dr. Max',
    'Apteka Dr.Max',
    'Salon Fryzjerski Ela',
    'Daria Fryzjerstwo i Kosmetyka',
    'Studio Efekt',
    'Gabinet lekarski',
    'NZOZ Tyniec',
    'Marta Cafe',
    'Dr Zdrowie',
    'Apteka Św. Barbara',
    'DOZ Apteka Dbam o Zdrowie',
  ])
    assert.equal(wygladaNaOsobe(n), false, n)
})

test('nazwa publiczna: osobowe znikają, rejestrowe WIELKIE LITERY stają się czytelne, długie się skracają', () => {
  assert.equal(nazwaPubliczna('Barbara Żurek'), null)
  assert.equal(nazwaPubliczna('Żabka'), 'Żabka')
  assert.equal(nazwaPubliczna('DOZ'), 'DOZ')
  assert.equal(nazwaPubliczna('APTEKA GEMINI', 'rejestr'), 'Apteka Gemini')
  assert.equal(nazwaPubliczna('   '), null)
  assert.ok(nazwaPubliczna('X'.repeat(100)).length <= 60)
})

test('CEIDG: z odpowiedzi API zostaje tylko adres działalności, status i rok', () => {
  const firma = {
    id: '941B0031-B408-41A7-B558-C4855871EFD9',
    nazwa: 'Jan Kowalski Zakład Fryzjerski',
    adresDzialalnosci: {
      ulica: 'ul. Krzywda',
      budynek: '1',
      lokal: '214',
      miasto: 'Kraków',
      kod: '30-710',
      gmina: 'Kraków',
      terc: '1261011',
      simc: '0950463',
    },
    wlasciciel: { imie: 'Jan', nazwisko: 'Kowalski', nip: '1234563218', regon: '123456785' },
    dataRozpoczecia: '2025-01-02',
    status: 'AKTYWNY',
    link: 'https://dane.biznes.gov.pl/api/ceidg/v3/firma/941B0031',
  }
  const r = zredukujFirme(firma)
  assert.deepEqual(Object.keys(r).sort(), [
    'budynek',
    'gmina',
    'kod',
    'miasto',
    'od',
    'status',
    'terc',
    'ulica',
  ])
  const json = JSON.stringify(r)
  for (const zakazane of ['Kowalski', 'Jan', '1234563218', '123456785', '941B0031', 'Zakład'])
    assert.ok(!json.includes(zakazane), zakazane)
  assert.equal(r.od, '2025')
})

test('CEIDG: punkty z rekordów nie mają nazwy ani pól osobowych, poza obszarem odpadają', () => {
  const rekordy = [
    {
      ulica: 'Krzywda',
      budynek: '1',
      miasto: 'Kraków',
      kod: '30-710',
      branza: 'fryzjer',
      obszar: 'krakow',
      od: '2025',
      status: 'AKTYWNY',
      gmina: 'Kraków',
      terc: '1',
      // Gdyby redukcja zawiodła, punkt i tak nie może przejąć tych pól.
      nazwa: 'Jan Kowalski Zakład',
      wlasciciel: { imie: 'Jan', nazwisko: 'Kowalski' },
      nip: '1234563218',
    },
    {
      ulica: 'Gdzieś',
      budynek: '2',
      miasto: 'Warszawa',
      kod: '00-001',
      branza: 'fryzjer',
      obszar: 'krakow',
      od: '2024',
      status: 'AKTYWNY',
      gmina: 'Warszawa',
      terc: '2',
    },
    {
      ulica: 'Brak',
      budynek: '3',
      miasto: 'Kraków',
      kod: '30-001',
      branza: 'fryzjer',
      obszar: 'krakow',
      od: '2024',
      status: 'AKTYWNY',
      gmina: 'Kraków',
      terc: '3',
    },
  ]
  const punkty = punktyZRekordow(
    rekordy,
    [{ lat: 50.05, lon: 19.95 }, { lat: 52.2, lon: 21 }, null],
    BBOX,
  )
  assert.equal(punkty.length, 1)
  assert.deepEqual(Object.keys(punkty[0]).sort(), [
    'branza',
    'flagi',
    'lat',
    'lon',
    'nazwa',
    'zrodlo',
  ])
  assert.equal(punkty[0].nazwa, null)
  assert.equal(punkty[0].zrodlo, 'ceidg')
})

test('CEIDG: token z pliku .env bez ładowania reszty, brak pliku to null', () => {
  const katalog = mkdtempSync(join(tmpdir(), 'uslugi-env-'))
  try {
    const plik = join(katalog, '.env.local')
    writeFileSync(plik, 'INNY=abc\nCEIDG_TOKEN="tajny.token.testowy"\n# komentarz\n')
    assert.equal(kluczZPliku(plik, 'CEIDG_TOKEN'), 'tajny.token.testowy')
    assert.equal(kluczZPliku(plik, 'BRAK'), null)
    assert.equal(kluczZPliku(join(katalog, 'nie-ma'), 'CEIDG_TOKEN'), null)
  } finally {
    rmSync(katalog, { recursive: true, force: true })
  }
})

test('CEIDG: plan stron – grupy po kolei, rundy w grupie, limity stron i cache za darmo', () => {
  const para = (klucz, count, priorytet, limitStron = null) => ({
    klucz,
    count,
    priorytet,
    limitStron,
    pobrane: 1,
  })
  const pary = [
    para('a', 100, 1), // 4 strony: 3 do pobrania
    para('b', 5000, 2, 6), // limit 6 stron
    para('c', 5000, 2, 6),
  ]
  const plan = planujStrony(pary, 100)
  const wg = (k) => plan.filter((p) => p.para.klucz === k).map((p) => p.strona)
  assert.deepEqual(wg('a'), [1, 2, 3])
  assert.deepEqual(wg('b'), [1, 2, 3, 4, 5])
  assert.deepEqual(wg('c'), [1, 2, 3, 4, 5])
  // Budżet 3 + 4: grupa 1 bierze 3, grupa 2 po równo 2 i 2 (rundy).
  const ciasny = planujStrony(pary, 7)
  const ile = (k) => ciasny.filter((p) => p.para.klucz === k).length
  assert.equal(ile('a'), 3)
  assert.equal(ile('b'), 2)
  assert.equal(ile('c'), 2)
  // Strony z cache nic nie kosztują.
  const zCache = planujStrony(pary, 3, (p, s) => p.klucz !== 'a' && s <= 2)
  assert.equal(zCache.filter((p) => p.para.klucz === 'a').length, 3)
  assert.deepEqual(
    zCache.filter((p) => p.para.klucz === 'b').map((p) => p.strona),
    [1, 2],
  )
})

// --- Pliki wyjściowe ---------------------------------------------------------------------------

const META = { dataGenerowania: '2026-10-03', bbox: BBOX, zrodla: {} }

test('plik branży: kolumny równej długości, współrzędne do 5 miejsc, bity źródeł i flagi', () => {
  const klastry = polaczPunkty([
    pkt('osm', 'fryzjer', 'Barber One', 0, 0, ['barber']),
    pkt('overture', 'fryzjer', 'Barber One', 6, 0, ['barber']),
    pkt('ceidg', 'fryzjer', null, 500, 500),
  ])
  const plik = zbudujPlikBranzy(BRANZE_PO_ID.fryzjer, klastry)
  assert.equal(plik.n, 2)
  for (const kolumna of Object.values(plik.kolumny)) assert.equal(kolumna.length, plik.n)
  assert.deepEqual(Object.keys(plik.kolumny), ['lon', 'lat', 'zr', 'flagi', 'nazwa'])
  for (const v of [...plik.kolumny.lon, ...plik.kolumny.lat])
    assert.equal(v, Math.round(v * 1e5) / 1e5)
  const iOsm = plik.kolumny.zr.findIndex((z) => z === (BITY_ZRODEL.osm | BITY_ZRODEL.overture))
  assert.ok(iOsm >= 0)
  assert.equal(plik.kolumny.flagi[iOsm], 1)
  assert.deepEqual(plik.bityFlag, { barber: 1 })
  const iCeidg = plik.kolumny.zr.findIndex((z) => z === BITY_ZRODEL.ceidg)
  assert.equal(plik.kolumny.nazwa[iCeidg], null)
  // Atrybucja i licencja: OSM => ODbL i share-alike, plus Overture i CEIDG.
  assert.match(plik.atrybucja, /© OpenStreetMap contributors, ODbL/)
  assert.match(plik.atrybucja, /Overture Maps Foundation/)
  assert.match(plik.licencja, /ODbL 1\.0/)
  assert.match(plik.licencja, /share-alike/)
  // Kolejność deterministyczna: rosnąco po szerokości.
  assert.deepEqual(
    plik.kolumny.lat,
    [...plik.kolumny.lat].sort((a, b) => a - b),
  )
})

test('apteka: do pliku trafiają tylko punkty z rejestru, OSM i Overture dopisują bity', () => {
  const wejscie = [
    pkt('rejestr', 'apteka', 'APTEKA GEMINI', 0, 0),
    pkt('osm', 'apteka', 'Apteka Gemini', 10, 0),
    pkt('osm', 'apteka', 'Apteka Wyśniona', 800, 0), // tylko OSM: poza plikiem
    pkt('overture', 'apteka', 'Apteka Zamknięta', 1600, 0), // tylko Overture: poza plikiem
    pkt('rejestr', 'apteka', 'APTEKA ZDROWIT', 2400, 0),
  ]
  const { pliki, katalog } = zlozWyjscie({ wejscie, meta: META })
  const apteka = pliki.apteka
  assert.equal(apteka.n, 2)
  assert.ok(apteka.kolumny.zr.every((z) => (z & BITY_ZRODEL.rejestr) !== 0))
  assert.ok(apteka.kolumny.zr.some((z) => (z & BITY_ZRODEL.osm) !== 0))
  const wpis = katalog.branze.find((b) => b.id === 'apteka')
  assert.equal(wpis.liczby.poDeduplikacji, 4)
  assert.equal(wpis.liczby.wPliku, 2)
  assert.equal(wpis.pokrycie.osm.bezRejestru, 1)
  assert.equal(wpis.pokrycie.overture.bezRejestru, 1)
  assert.equal(wpis.pokrycie.osm.wRejestrzeScisle, 1)
  assert.equal(wpis.pokrycie.rejestr.punktow, 2)
  assert.deepEqual(wpis.mapowanie.zrodloPrawdy, 'rejestr')
})

test('katalog.json: komplet pól per branża, źródła z licencjami, liczby per źródło i po dedupie', () => {
  const { katalog } = zlozWyjscie({
    wejscie: [
      pkt('osm', 'kawiarnia', 'Costa', 0, 0),
      pkt('overture', 'kawiarnia', 'Costa', 3, 0),
      pkt('ceidg', 'kawiarnia', null, 900, 0),
    ],
    meta: { ...META, zrodla: { osm: { dataDanych: '2026-10-02', pobrano: '2026-10-03' } } },
  })
  assert.equal(katalog.branze.length, BRANZE.length)
  assert.deepEqual(katalog.obszar.bbox, BBOX)
  assert.equal(katalog.obszar.gminy.length, 14)
  assert.equal(katalog.zrodla.osm.dataDanych, '2026-10-02')
  assert.match(katalog.zrodla.osm.licencja, /ODbL/)
  assert.match(katalog.zrodla.overture.licencja, /CDLA-Permissive-2\.0/)
  const k = katalog.branze.find((b) => b.id === 'kawiarnia')
  assert.deepEqual(k.liczby.surowe, { osm: 1, overture: 1, ceidg: 1 })
  assert.equal(k.liczby.poDeduplikacji, 2)
  assert.equal(k.liczby.potwierdzoneWielomaZrodlami, 1)
  assert.deepEqual(k.liczby.tylkoJednoZrodlo, { ceidg: 1 })
  assert.equal(k.liczby.bezSamegoCeidg, 1)
  assert.equal(k.plik, 'kawiarnia.json')
  assert.ok(k.mapowanie.osm.includes('amenity=cafe'))
  assert.ok(k.mapowanie.pkd.includes('56.30.Z'))
  assert.equal(k.zasiegPieszyM, BRANZE_PO_ID.kawiarnia.zasiegPieszyM)
})

test('brak pól osobowych z CEIDG w wyjściu: nazwa firmy, właściciel, NIP, REGON, id nie dotrą do plików', () => {
  // Rekord tak, jak przychodzi z API, przepuszczony przez całą ścieżkę: redukcja → punkt → plik.
  const zApi = {
    id: 'ABCDEF12-0000-4000-8000-123456789ABC',
    nazwa: 'Zakład Fryzjerski Henryk Zażółć',
    adresDzialalnosci: {
      ulica: 'Floriańska',
      budynek: '3',
      miasto: 'Kraków',
      kod: '31-021',
      gmina: 'Kraków',
      terc: '1261011',
    },
    wlasciciel: { imie: 'Henryk', nazwisko: 'Zażółć', nip: '9876543210', regon: '987654321' },
    dataRozpoczecia: '2025-05-05',
    status: 'AKTYWNY',
  }
  const rekord = { ...zredukujFirme(zApi), branza: 'fryzjer', obszar: 'krakow' }
  const punkty = punktyZRekordow([rekord], [{ lat: 50.0647, lon: 19.9393 }], BBOX)
  // W OSM stoi też salon pod własną nazwą i niedaleko od niego rekord CEIDG.
  const wejscie = [...punkty, pkt('osm', 'fryzjer', 'Salon Ela', 5000, 5000)]
  const { pliki, katalog } = zlozWyjscie({ wejscie, meta: META })
  const tekst = JSON.stringify({ pliki, katalog })
  for (const zakazane of [
    'Zażółć',
    'Henryk',
    '9876543210',
    '987654321',
    'ABCDEF12',
    'Zakład Fryzjerski',
    'Floriańska',
    '31-021',
  ])
    assert.ok(!tekst.includes(zakazane), `wyciekło: ${zakazane}`)
  // Punkt tylko z CEIDG ma samą pozycję, branżę (przez plik) i bit źródła.
  const f = pliki.fryzjer
  const i = f.kolumny.zr.findIndex((z) => z === BITY_ZRODEL.ceidg)
  assert.ok(i >= 0)
  assert.equal(f.kolumny.nazwa[i], null)
  assert.deepEqual(Object.keys(f.kolumny), ['lon', 'lat', 'zr', 'flagi', 'nazwa'])
})

test('kontrola wyniku: zła długość kolumny, punkt poza obszarem, CEIDG z nazwą i zbyt mało punktów', () => {
  const dobry = zlozWyjscie({
    wejscie: [pkt('osm', 'piekarnia', 'Piekarnia Rynek', 0, 0)],
    meta: META,
  }).pliki
  assert.deepEqual(sprawdzWyjscie({ pliki: { piekarnia: dobry.piekarnia }, bbox: BBOX }), [])

  const zly = structuredClone(dobry.piekarnia)
  zly.kolumny.lat.push(50)
  assert.match(sprawdzWyjscie({ pliki: { piekarnia: zly }, bbox: BBOX })[0], /kolumna lat/)

  const poza = structuredClone(dobry.piekarnia)
  poza.kolumny.lat[0] = 52
  assert.ok(
    sprawdzWyjscie({ pliki: { piekarnia: poza }, bbox: BBOX }).some((b) => /poza obszarem/.test(b)),
  )

  const nazwa = structuredClone(dobry.piekarnia)
  nazwa.kolumny.zr[0] = BITY_ZRODEL.ceidg
  assert.ok(
    sprawdzWyjscie({ pliki: { piekarnia: nazwa }, bbox: BBOX }).some((b) =>
      /tylko z CEIDG ma nazwę/.test(b),
    ),
  )

  assert.ok(
    sprawdzWyjscie({
      pliki: { piekarnia: dobry.piekarnia },
      bbox: BBOX,
      minima: { piekarnia: 200 },
    }).some((b) => /strażnika/.test(b)),
  )
})

test('strażnik per źródło: zerowy OSM nie ukrywa się za pozostałymi źródłami', () => {
  const wejscie = Array.from({ length: 900 }, (_, i) =>
    pkt('overture', 'sklep_spozywczy', `Sklep ${i}`, (i % 30) * 100, Math.floor(i / 30) * 100),
  )
  const { pliki, katalog } = zlozWyjscie({ wejscie, meta: META })
  // Plik ma 900 punktów (powyżej strażnika pliku), ale OSM dał zero.
  assert.equal(pliki.sklep_spozywczy.n, 900)
  const bledy = sprawdzWyjscie({
    pliki: { sklep_spozywczy: pliki.sklep_spozywczy },
    bbox: BBOX,
    minima: { sklep_spozywczy: 800 },
    katalog: { branze: katalog.branze.filter((b) => b.id === 'sklep_spozywczy') },
  })
  assert.equal(bledy.length, 1)
  assert.match(bledy[0], /źródło osm dało 0 punktów/)
})
