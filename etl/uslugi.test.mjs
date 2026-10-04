import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { indeksPunktow, odlegloscMetry } from './lib/codziennosc-geo.mjs'
import { kluczZPliku, planujStrony, punktyZRekordow, zredukujFirme } from './lib/uslugi-ceidg.mjs'
import { podobneNazwy, polaczPunkty, tenSamLokal } from './lib/uslugi-dedup.mjs'
import {
  BITY_ZRODEL,
  BRANZE,
  BRANZE_PO_ID,
  kategorieOverture,
  klasyfikujOsm,
  klasyfikujOverture,
  nazwaCukierniPodobna,
  nazwaDrogeriaPodobna,
  nazwaLabPodobna,
  nazwaMozeBycMyjnia,
  nazwaPozPodobna,
  nazwaTylkoCukierni,
  OPISY_ZRODEL,
  pasujeKategoriaOverture,
  pkdDoParametru,
  rozbierzRegule,
  selektoryOsm,
  zakonczeniaKategoriiOverture,
} from './lib/uslugi-katalog.mjs'
import { wygladaNaOsobe } from './lib/uslugi-nazwy.mjs'
import {
  kontrolaPolozenia,
  miejscaNfz,
  miejscaZWpisow,
  NFZ_LIMIT_STRONY,
  oznaczNfz,
  pobierzWpisySwiadczenia,
  rozbijAdres,
  ustalPolozenie,
  zredukujWpis,
} from './lib/uslugi-nfz.mjs'
import { branzePoKodzieRpwdl, punktyRpwdlBranz, wierszeKomorek } from './lib/uslugi-rpwdl.mjs'
import {
  nazwaPubliczna,
  sprawdzWyjscie,
  zbudujPlikBranzy,
  zlozWyjscie,
} from './lib/uslugi-wyjscie.mjs'
import { podzialWgObszaru } from './uslugi-podzial.mjs'

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

test('katalog: branże v1, #160 i druga partia #160 (26 z paczkomatem), spójne identyfikatory i mapowania', () => {
  assert.deepEqual(
    BRANZE.map((b) => b.id),
    [
      'sklep_spozywczy',
      'apteka',
      'fryzjer',
      'piekarnia',
      'kawiarnia',
      'poz',
      'dentysta',
      'fizjoterapia',
      'laboratorium',
      'silownia',
      'weterynarz',
      'restauracja',
      'warsztat',
      'myjnia',
      'salon_kosmetyczny',
      'kwiaciarnia',
      'optyk',
      'drogeria',
      'cukiernia',
      'sklep_miesny',
      'warzywniak',
      'pralnia',
      'sklep_zoologiczny',
      'bar',
      'lodziarnia',
      'paczkomat',
    ],
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
  // Warzywniak zostaje w sklepie spożywczym i ma też własną branżę (decyzja z drugiej partii #160).
  assert.deepEqual(ids({ shop: 'greengrocer' }), ['sklep_spozywczy', 'warzywniak'])
  assert.deepEqual(ids({ shop: 'butcher' }), ['sklep_miesny'])
  assert.deepEqual(ids({ amenity: 'pharmacy' }), ['apteka'])
  assert.deepEqual(ids({ amenity: 'pharmacy', dispensing: 'no' }), [])
  const barber = klasyfikujOsm({ shop: 'hairdresser', hairdresser: 'barber' })
  assert.deepEqual(barber, [{ branza: 'fryzjer', flagi: ['barber'] }])
  assert.deepEqual(klasyfikujOsm({ shop: 'hairdresser' }), [{ branza: 'fryzjer', flagi: [] }])
  assert.deepEqual(ids({ shop: 'bakery', amenity: 'cafe' }).sort(), ['kawiarnia', 'piekarnia'])
  // Piekarnia to sam shop=bakery; shop=pastry i confectionery przeszły do cukierni.
  assert.deepEqual(ids({ shop: 'pastry' }), ['cukiernia'])
  assert.deepEqual(ids({ shop: 'confectionery' }), ['cukiernia'])
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
  // `drugstore` to w Overture w większości apteki, więc drogerią jest dopiero nazwa drogeryjna (filtr `drogeria`).
  assert.deepEqual(ids({ kat: 'drugstore', nazwa: 'Rossmann' }), ['drogeria'])
  assert.deepEqual(ids({ kat: 'drugstore', nazwa: 'Apteka Galen' }), [])
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

// --- Branże z #160: katalog i mapowanie ----------------------------------------------------------

test('katalog #160: zasięgi z zadania, kody RPWDL bez powtórzeń, CEIDG wyłączony (puste pkd), flagi', () => {
  const zasiegi = {
    dentysta: 1000,
    fizjoterapia: 1000,
    laboratorium: 1500,
    silownia: 1000,
    weterynarz: 1500,
    restauracja: 500,
    warsztat: 1500,
    myjnia: 2000,
    salon_kosmetyczny: 800,
    kwiaciarnia: 800,
    optyk: 800,
  }
  for (const [id, metry] of Object.entries(zasiegi)) {
    assert.equal(BRANZE_PO_ID[id].zasiegPieszyM, metry, id)
    assert.deepEqual(BRANZE_PO_ID[id].pkd, [], `${id}: CEIDG zostaje wyłączony`)
    assert.ok(BRANZE_PO_ID[id].minPunktow > 1, `${id}: strażnik ustawiony na pomiar`)
  }
  assert.deepEqual(BRANZE_PO_ID.dentysta.kodyRpwdl, ['1800', '1801', '1820', '1830', '1840'])
  assert.deepEqual(BRANZE_PO_ID.fizjoterapia.kodyRpwdl, ['1300', '1310', '1320'])
  assert.deepEqual(BRANZE_PO_ID.laboratorium.kodyRpwdl, ['7100', '7110'])
  for (const id of ['dentysta', 'fizjoterapia', 'laboratorium'])
    assert.equal(BRANZE_PO_ID[id].rejestr, 'rpwdl', id)
  // Plik dentysty jest pełny (OSM, Overture, rejestr), a rejestr służy do kontroli pokrycia, nie do filtra.
  assert.equal(BRANZE_PO_ID.dentysta.zrodloPrawdy, undefined)
  assert.equal(BRANZE_PO_ID.dentysta.kontrolaPokrycia, 'rejestr')
  // Flagi: kolejność kluczy to kolejność bitów (bit 1 = pierwsza flaga).
  assert.deepEqual(Object.keys(BRANZE_PO_ID.dentysta.flagi), ['nfz'])
  assert.equal(BRANZE_PO_ID.dentysta.flagi.nfz.zrodlo, 'nfz')
  assert.ok(BRANZE_PO_ID.dentysta.minFlag.nfz > 0)
  assert.deepEqual(Object.keys(BRANZE_PO_ID.restauracja.flagi), ['fast_food'])
  assert.ok(OPISY_ZRODEL.nfz.licencja && OPISY_ZRODEL.nfz.atrybucja.includes('api.nfz.gov.pl'))
})

test('mapowanie OSM #160: dentysta, fizjoterapia, laboratorium, siłownia i weterynarz', () => {
  const ids = (t) => klasyfikujOsm(t).map((x) => x.branza)
  assert.deepEqual(klasyfikujOsm({ amenity: 'dentist' }), [{ branza: 'dentysta', flagi: [] }])
  assert.deepEqual(ids({ healthcare: 'dentist' }), ['dentysta'])
  // Klinika z healthcare=dentist to dentysta, nie POZ (filtr POZ odrzuca stomatologię).
  assert.deepEqual(
    ids({ amenity: 'clinic', healthcare: 'dentist', name: 'Przychodnia Stomatologiczna' }),
    ['dentysta'],
  )
  assert.deepEqual(ids({ healthcare: 'physiotherapist' }), ['fizjoterapia'])
  assert.deepEqual(ids({ amenity: 'clinic', healthcare: 'rehabilitation' }), ['fizjoterapia'])
  assert.deepEqual(ids({ shop: 'massage' }), [])
  assert.deepEqual(ids({ healthcare: 'laboratory' }), ['laboratorium'])
  assert.deepEqual(ids({ healthcare: 'sample_collection' }), ['laboratorium'])
  assert.deepEqual(ids({ healthcare: 'blood_donation' }), [])
  assert.deepEqual(ids({ leisure: 'fitness_centre' }), ['silownia'])
  assert.deepEqual(ids({ leisure: 'fitness_station' }), [], 'siłownie plenerowe to #159')
  assert.deepEqual(ids({ amenity: 'veterinary' }), ['weterynarz'])
  assert.deepEqual(ids({ amenity: 'dentist', 'disused:amenity': 'dentist' }), [])
})

test('mapowanie OSM #160: restauracja z flagą fast_food, warsztat, myjnia, salon, kwiaciarnia, optyk', () => {
  assert.deepEqual(klasyfikujOsm({ amenity: 'restaurant' }), [{ branza: 'restauracja', flagi: [] }])
  assert.deepEqual(klasyfikujOsm({ amenity: 'fast_food' }), [
    { branza: 'restauracja', flagi: ['fast_food'] },
  ])
  // Puby i bary od drugiej partii #160 mają własną branżę `bar`, restauracja ich nie bierze.
  assert.deepEqual(klasyfikujOsm({ amenity: 'pub' }), [{ branza: 'bar', flagi: [] }])
  assert.deepEqual(klasyfikujOsm({ amenity: 'cafe' }), [{ branza: 'kawiarnia', flagi: [] }])
  const ids = (t) => klasyfikujOsm(t).map((x) => x.branza)
  assert.deepEqual(ids({ shop: 'car_repair' }), ['warsztat'])
  assert.deepEqual(ids({ shop: 'tyres' }), [], 'wulkanizacje są poza branżą')
  assert.deepEqual(ids({ amenity: 'car_wash' }), ['myjnia'])
  assert.deepEqual(ids({ shop: 'beauty' }), ['salon_kosmetyczny'])
  assert.deepEqual(ids({ shop: 'hairdresser' }), ['fryzjer'])
  assert.deepEqual(ids({ shop: 'florist' }), ['kwiaciarnia'])
  assert.deepEqual(ids({ shop: 'optician' }), ['optyk'])
})

test('mapowanie Overture #160: kategorie branż, odrzucone sąsiednie kategorie', () => {
  const ids = (kat, nazwa = 'X') => klasyfikujOverture({ kat, nazwa }).map((x) => x.branza)
  for (const kat of [
    'dental_clinic',
    'general_dentistry',
    'pediatric_dentistry',
    'orthodontics',
    'cosmetic_dentistry',
  ])
    assert.deepEqual(ids(kat), ['dentysta'], kat)
  assert.deepEqual(ids('b2b_dental_lab'), [], 'technik dentystyczny to nie gabinet')
  assert.deepEqual(ids('physical_therapy'), ['fizjoterapia'])
  assert.deepEqual(ids('massage_therapy'), [])
  assert.deepEqual(ids('gym'), ['silownia'])
  assert.deepEqual(ids('fitness_trainer'), [])
  assert.deepEqual(ids('veterinarian'), ['weterynarz'])
  assert.deepEqual(ids('pet_groomer'), [])
  assert.deepEqual(ids('automotive_repair'), ['warsztat'])
  assert.deepEqual(ids('auto_body_shop'), ['warsztat'])
  assert.deepEqual(ids('tire_dealer_and_repair'), [])
  for (const kat of ['beauty_salon', 'nail_salon', 'skin_care_and_makeup'])
    assert.deepEqual(ids(kat), ['salon_kosmetyczny'], kat)
  assert.deepEqual(ids('spa'), [], 'spa miesza salony fryzjerskie')
  assert.deepEqual(ids('flowers_and_gifts_store'), ['kwiaciarnia'])
  assert.deepEqual(ids('florist'), ['kwiaciarnia'])
  assert.deepEqual(ids('eyewear_store'), ['optyk'])
  assert.deepEqual(ids('optometry'), [])
})

test('mapowanie Overture #160: restauracje po gwiazdce *_restaurant, flaga fast_food', () => {
  const kl = (kat) => klasyfikujOverture({ kat, nazwa: 'X' })
  assert.deepEqual(kl('restaurant'), [{ branza: 'restauracja', flagi: [] }])
  assert.deepEqual(kl('pizza_restaurant'), [{ branza: 'restauracja', flagi: [] }])
  assert.deepEqual(kl('polish_restaurant'), [{ branza: 'restauracja', flagi: [] }])
  // Kuchnia, której dziś nie ma w danych, też wchodzi: o to chodzi w gwiazdce.
  assert.deepEqual(kl('peruvian_restaurant'), [{ branza: 'restauracja', flagi: [] }])
  for (const kat of ['steakhouse', 'diner', 'bistro'])
    assert.deepEqual(kl(kat), [{ branza: 'restauracja', flagi: [] }], kat)
  for (const kat of [
    'fast_food_restaurant',
    'burger_restaurant',
    'doner_kebab_restaurant',
    'hot_dog_restaurant',
    'sandwich_shop',
  ])
    assert.deepEqual(kl(kat), [{ branza: 'restauracja', flagi: ['fast_food'] }], kat)
  assert.deepEqual(kl('restaurant_equipment_and_supply'), [])
  assert.deepEqual(kl('restaurant_wholesale'), [])
  assert.deepEqual(kl('food_court'), [])
})

test('reguła Overture z gwiazdką: dopasowanie po zakończeniu i lista do wstępnego filtra SQL', () => {
  assert.equal(pasujeKategoriaOverture('*_restaurant', 'thai_restaurant'), true)
  assert.equal(pasujeKategoriaOverture('*_restaurant', 'restaurant'), false)
  assert.equal(pasujeKategoriaOverture('restaurant', 'restaurant'), true)
  assert.equal(pasujeKategoriaOverture('restaurant', 'pizza_restaurant'), false)
  assert.ok(zakonczeniaKategoriiOverture().includes('_restaurant'))
  assert.ok(kategorieOverture().includes('restaurant'))
  assert.ok(!kategorieOverture().some((k) => k.includes('*')))
  assert.ok(kategorieOverture().includes('veterinarian'))
})

test('filtry lab i myjnia: szum z Overture odpada (paczkomaty, laboratoria budowlane)', () => {
  assert.equal(nazwaLabPodobna('Diagnostyka. Laboratoria Medyczne.'), true)
  assert.equal(nazwaLabPodobna('Punkt Pobrań ALAB laboratoria'), true)
  assert.equal(nazwaLabPodobna('Oncogene Badania Genetyczne'), true)
  assert.equal(nazwaLabPodobna('Małopolskie Laboratorium Budownictwa Energooszczędnego'), false)
  assert.equal(nazwaLabPodobna('ORLEN Paczka'), false)
  assert.equal(nazwaLabPodobna(null), false)
  assert.equal(nazwaMozeBycMyjnia('ORLEN Paczka'), false)
  assert.equal(nazwaMozeBycMyjnia('Stacja Paliw ORLEN'), false)
  assert.equal(nazwaMozeBycMyjnia('Myjnia ORLEN'), true)
  assert.equal(nazwaMozeBycMyjnia(null), true)
  const kl = (kat, nazwa) => klasyfikujOverture({ kat, nazwa })
  assert.deepEqual(kl('car_wash', 'ORLEN Paczka'), [])
  assert.deepEqual(kl('car_wash', 'Auto Spa Detailing'), [{ branza: 'myjnia', flagi: [] }])
  assert.deepEqual(kl('b2b_clinical_lab', 'Diagnostyka. Laboratoria Medyczne.'), [
    { branza: 'laboratorium', flagi: [] },
  ])
  assert.deepEqual(kl('laboratory_testing', 'P.H.U. Mega'), [])
})

// --- Branże z #160: RPWDL ------------------------------------------------------------------------

/** Katalog tymczasowy z minimalnymi komorki.csv i zaklady.csv (kolumny, do których sięga zapytanie). */
function katalogRpwdl() {
  const katalog = mkdtempSync(join(tmpdir(), 'uslugi-rpwdl-'))
  const csv = (naglowek, wiersze) =>
    [naglowek, ...wiersze]
      .map((w) => w.map((p) => (p === null ? 'NULL' : `"${p}"`)).join(';'))
      .join('\n')
  const naglowek = [
    'ID ZOZ',
    'kodResortVIII',
    'Nazwa komórki',
    'Teryt',
    'Ulica',
    'Budynek',
    'Kod pocztowy',
    'Miejscowość',
    'Data rozpoczęcia działalności komórki',
    'Data zakończenia działalności komórki',
    'Początek okresu zawieszenia',
    'Koniec okresu zawieszenia',
  ]
  const K = '1261011'
  // ZOZ, kod VIII, nazwa komórki, TERYT, ulica, budynek, kod pocztowy, miejscowość, start, koniec, zaw. od, zaw. do
  const komorki = [
    [
      '1',
      '1800',
      'Poradnia stomatologiczna',
      K,
      'Floriańska',
      '1',
      '31-021',
      'Kraków',
      '2001-01-01',
      null,
      null,
      null,
    ],
    [
      '1',
      '1801',
      'Poradnia stomatologiczna dla dzieci',
      K,
      'Floriańska',
      '1',
      '31-021',
      'Kraków',
      '2001-01-01',
      null,
      null,
      null,
    ],
    [
      '2',
      '1800',
      'Zakończona',
      K,
      'Długa',
      '3',
      '31-147',
      'Kraków',
      '2001-01-01',
      '2020-05-05',
      null,
      null,
    ],
    [
      '3',
      '1800',
      'Inne województwo',
      '0262011',
      'Batalionu Parasol',
      '9',
      '59-220',
      'Legnica',
      '2001-01-01',
      null,
      null,
      null,
    ],
    [
      '4',
      '1800',
      'Bez budynku',
      K,
      'Długa',
      null,
      '31-147',
      'Kraków',
      '2001-01-01',
      null,
      null,
      null,
    ],
    [
      '5',
      '1310',
      'Pracownia fizjoterapii',
      K,
      'Długa',
      '2',
      '31-147',
      'Kraków',
      '2001-01-01',
      null,
      null,
      null,
    ],
    [
      '6',
      '7110',
      'Punkt pobrań',
      K,
      'Szeroka',
      '3',
      '31-053',
      'Kraków',
      '2001-01-01',
      null,
      null,
      null,
    ],
    [
      '7',
      '1800',
      'Zawieszona teraz',
      K,
      'Dietla',
      '4',
      '31-070',
      'Kraków',
      '2001-01-01',
      null,
      '2026-09-01',
      null,
    ],
    [
      '8',
      '1800',
      'Zawieszenie minęło',
      K,
      'Nieznana',
      '5',
      '31-070',
      'Kraków',
      '2001-01-01',
      null,
      '2025-01-01',
      '2025-02-01',
    ],
    [
      '9',
      '1800',
      'Jeszcze nie ruszyła',
      K,
      'Dietla',
      '6',
      '31-070',
      'Kraków',
      '2027-01-01',
      null,
      null,
      null,
    ],
    [
      '10',
      '0010',
      'Poradnia POZ',
      K,
      'Dietla',
      '7',
      '31-070',
      'Kraków',
      '2001-01-01',
      null,
      null,
      null,
    ],
    [
      '11',
      '1800',
      'Zakopane',
      '1217011',
      'Krupówki',
      '1',
      '34-500',
      'Zakopane',
      '2001-01-01',
      null,
      null,
      null,
    ],
    [
      '99',
      '1800',
      'Gabinet bez zakładu',
      K,
      'Rynek Główny',
      '5',
      '31-042',
      'Kraków',
      '2001-01-01',
      null,
      null,
      null,
    ],
  ]
  writeFileSync(join(katalog, 'komorki.csv'), csv(naglowek, komorki))
  const zaklady = [
    ['1', 'DENT-MED SPÓŁKA Z O.O.'],
    ['5', 'REHAB-PLUS SPÓŁKA Z O.O.'],
    ['6', 'LABORATORIA MEDYCZNE SA'],
  ]
  writeFileSync(join(katalog, 'zaklady.csv'), csv(['ID ZOZ', 'Nazwa'], zaklady))
  writeFileSync(
    join(katalog, 'Info.txt'),
    'Raport wygenerowany na podstawie danych w systemie RPWDL z dnia 2026-10-02 00:00:00',
  )
  return katalog
}

test('RPWDL #160: kod resortowy wskazuje branżę, powtórzony kod to błąd katalogu', () => {
  const poKodzie = branzePoKodzieRpwdl()
  for (const kod of ['1800', '1801', '1820', '1830', '1840'])
    assert.equal(poKodzie.get(kod), 'dentysta', kod)
  for (const kod of ['1300', '1310', '1320']) assert.equal(poKodzie.get(kod), 'fizjoterapia', kod)
  for (const kod of ['7100', '7110']) assert.equal(poKodzie.get(kod), 'laboratorium', kod)
  assert.equal(poKodzie.get('0010'), undefined, 'POZ ma własną ścieżkę z #8')
  assert.equal(poKodzie.get('1810'), undefined, 'periodontologia jest poza zakresem zadania')
  assert.equal(poKodzie.get('8100'), undefined, 'pracownie protetyki (technicy) odpadają')
  assert.equal(poKodzie.size, 10)
  assert.throws(
    () =>
      branzePoKodzieRpwdl([
        { id: 'a', kodyRpwdl: ['1800'] },
        { id: 'b', kodyRpwdl: ['1800'] },
      ]),
    /dwóch branżach/,
  )
})

test('RPWDL #160: czynne komórki Małopolski z kodem i numerem budynku, zawieszone i przyszłe odpadają', async () => {
  const katalog = katalogRpwdl()
  try {
    const dzien = '2026-10-03'
    const w = await wierszeKomorek(['1800', '1801'], { dzien, katalog })
    const opis = w.map((x) => `${x.kod8} ${x.ulica} ${x.nr}`).sort()
    assert.deepEqual(opis, [
      '1800 Floriańska 1',
      '1800 Krupówki 1',
      '1800 Nieznana 5',
      '1800 Rynek Główny 5',
      '1801 Floriańska 1',
    ])
    // Nazwa to nazwa zakładu, a bez zakładu – nazwa komórki.
    const dentMed = w.find((x) => x.ulica === 'Floriańska' && x.kod8 === '1800')
    assert.equal(dentMed.nazwa, 'DENT-MED SPÓŁKA Z O.O.')
    assert.equal(w.find((x) => x.ulica === 'Rynek Główny').nazwa, 'Gabinet bez zakładu')
    // Kod spoza listy nie wchodzi.
    const fizjo = await wierszeKomorek(['1310'], { dzien, katalog })
    assert.deepEqual(
      fizjo.map((x) => x.ulica),
      ['Długa'],
    )
    // Po dacie startu komórka wchodzi, a zawieszenie bez końca trwa nadal.
    const pozniej = await wierszeKomorek(['1800'], { dzien: '2027-02-01', katalog })
    assert.ok(pozniej.some((x) => x.ulica === 'Dietla' && x.nr === '6'))
    assert.ok(!pozniej.some((x) => x.ulica === 'Dietla' && x.nr === '4'))
  } finally {
    rmSync(katalog, { recursive: true, force: true })
  }
})

test('RPWDL #160: punkty z geokodowaniem – branża po kodzie, bit rejestru, odrzut spoza obszaru i bez adresu', async () => {
  const katalog = katalogRpwdl()
  try {
    const geokoder = async (adresy) =>
      adresy.map((a) => {
        if (a.ulica === 'Nieznana') return null
        if (a.miejscowosc === 'Zakopane') return { lat: 49.29, lon: 19.95 }
        return { lat: 50.06, lon: 19.94 }
      })
    const r = await punktyRpwdlBranz({ dzien: '2026-10-03', katalog, geokoduj: geokoder })
    assert.equal(r.stan, '2026-10-02')
    assert.equal(r.razem, 7)
    assert.equal(r.trafione, 6)
    assert.deepEqual(r.wgBranz, {
      dentysta: { komorek: 5, trafione: 4, wObszarze: 3 },
      fizjoterapia: { komorek: 1, trafione: 1, wObszarze: 1 },
      laboratorium: { komorek: 1, trafione: 1, wObszarze: 1 },
    })
    assert.equal(r.punkty.length, 5)
    assert.ok(r.punkty.every((p) => p.zrodlo === 'rejestr' && Array.isArray(p.flagi)))
    assert.deepEqual(r.punkty.map((p) => p.branza).sort(), [
      'dentysta',
      'dentysta',
      'dentysta',
      'fizjoterapia',
      'laboratorium',
    ])
  } finally {
    rmSync(katalog, { recursive: true, force: true })
  }
})

test('RPWDL #160: brak plików rejestru to czytelny błąd, nie pusta warstwa', async () => {
  const pusty = mkdtempSync(join(tmpdir(), 'uslugi-rpwdl-pusty-'))
  try {
    await assert.rejects(
      wierszeKomorek(['1800'], { dzien: '2026-10-03', katalog: pusty }),
      /przychodniePoz/,
    )
  } finally {
    rmSync(pusty, { recursive: true, force: true })
  }
})

// --- Branże z #160: flaga NFZ --------------------------------------------------------------------

/** Wpis kolejki tak, jak zwraca go API Terminy Leczenia (pola jak w odpowiedzi z 2026-10-03). */
const wpisNfz = (nadpisania = {}) => ({
  type: 'queue',
  id: '5ce936ff-a97f-48de-e063-b4200a0a429f',
  attributes: {
    case: 1,
    benefit: 'PORADNIA STOMATOLOGICZNA',
    provider: 'LEKARZE DENTYSCI SAWCZAK I SZCZEBAK SPÓŁKA PARTNERSKA',
    'provider-code': '065/200142',
    'regon-provider': '121374617',
    'nip-provider': '9930632934',
    'teryt-provider': '1263011',
    place: 'PORADNIA STOMATOLOGICZNA OTFINÓW',
    address: 'OTFINÓW 237',
    locality: 'OTFINÓW',
    phone: '+48 14 645 22 51',
    'teryt-place': '1216155',
    'registry-number': '000000025431-W-12',
    'id-resort-part-VII': '001',
    'id-resort-part-VIII': '1800',
    latitude: 50.0647,
    longitude: 19.9393,
    statistics: {
      'provider-data': { awaiting: 0, removed: 0, 'average-period': 0, update: '2026-08' },
    },
    ...nadpisania,
  },
})

test('NFZ: z wpisu zostaje samo położenie, bez świadczeniodawcy, NIP, REGON, telefonu i numeru księgi', () => {
  const r = zredukujWpis(wpisNfz())
  assert.deepEqual(Object.keys(r).sort(), [
    'adres',
    'kod8',
    'lat',
    'lon',
    'miejscowosc',
    'okres',
    'teryt',
  ])
  assert.equal(r.miejscowosc, 'OTFINÓW')
  assert.equal(r.adres, 'OTFINÓW 237')
  assert.equal(r.kod8, '1800')
  assert.equal(r.okres, '2026-08')
  assert.equal(r.lat, 50.0647)
  const json = JSON.stringify(r)
  for (const zakazane of ['SAWCZAK', '9930632934', '121374617', '645 22 51', '25431', '065/200142'])
    assert.ok(!json.includes(zakazane), zakazane)
})

test('NFZ: brak albo błędne współrzędne to null, nie zero ani wartość spoza Polski', () => {
  const bez = zredukujWpis(wpisNfz({ latitude: null, longitude: null }))
  assert.equal(bez.lat, null)
  assert.equal(bez.lon, null)
  assert.equal(zredukujWpis(wpisNfz({ latitude: 0, longitude: 0 })).lat, null)
  assert.equal(zredukujWpis(wpisNfz({ latitude: 150, longitude: 19.9 })).lat, null)
  assert.equal(zredukujWpis(wpisNfz({ latitude: 'x', longitude: 19.9 })).lon, null)
  // Szerokość bez długości nie jest położeniem.
  assert.equal(zredukujWpis(wpisNfz({ latitude: 50.06, longitude: null })).lat, null)
})

test('NFZ: to samo miejsce z kilku wpisów to jedno miejsce, kody się sumują, kolejność jest stała', () => {
  const w = (adres, kod8, okres, lat = null, lon = null) =>
    zredukujWpis(
      wpisNfz({
        address: adres,
        'id-resort-part-VIII': kod8,
        latitude: lat,
        longitude: lon,
        statistics: { 'provider-data': { update: okres } },
      }),
    )
  const wpisy = [
    w('UL. DŁUGA 1', '1800', '2026-08', 50.07, 19.95),
    w('UL. DŁUGA 1', '1830', '2026-09', 50.07, 19.95),
    w('UL. ALFA 2', '1800', '2026-07'),
    w('UL. DŁUGA 1', '1800', '2026-08', 50.07, 19.95),
  ]
  const miejsca = miejscaZWpisow(wpisy)
  assert.equal(miejsca.length, 2)
  const dluga = miejsca.find((m) => m.adres === 'UL. DŁUGA 1')
  assert.deepEqual(dluga.kody8, ['1800', '1830'])
  assert.equal(dluga.okres, '2026-09')
  assert.deepEqual(miejscaZWpisow([...wpisy].reverse()), miejsca)
})

test('NFZ: adres → ulica i numer dla geokodera (UL. zdejmowane, wielkie litery na zwykłą pisownię, wieś bez ulicy)', () => {
  assert.deepEqual(rozbijAdres('UL. STEFANA ŻEROMSKIEGO 2', 'MYŚLENICE'), {
    ulica: 'Stefana Żeromskiego',
    nr: '2',
  })
  assert.deepEqual(rozbijAdres('OTFINÓW 237', 'OTFINÓW'), { ulica: '', nr: '237' })
  assert.deepEqual(rozbijAdres('UL. UL. 1 - GO MAJA 59', 'WOLBROM'), { ulica: '1 Maja', nr: '59' })
  assert.deepEqual(rozbijAdres('UL. OS. DYWIZJONU 303 19C', 'KRAKÓW'), {
    ulica: 'Os. Dywizjonu 303',
    nr: '19C',
  })
  // Osiedle i aleja zostają jako przedrostek, który geokoder zamieni na pełne słowo.
  assert.deepEqual(rozbijAdres('UL. OS. KOLOROWE 21', 'KRAKÓW'), {
    ulica: 'Os. Kolorowe',
    nr: '21',
  })
  assert.deepEqual(rozbijAdres('AL. 29 LISTOPADA 155 C', 'KRAKÓW').nr, '155C')
  assert.equal(rozbijAdres('GOŁCZA 80 C-D', 'GOŁCZA').nr, '80C')
  assert.equal(rozbijAdres('UL. GRZEGÓRZECKA 38/219', 'KRAKÓW').nr, '38')
  // Adres bez numeru nie wskazuje budynku.
  assert.deepEqual(rozbijAdres('UL. DŁUGA', 'KRAKÓW'), { ulica: '', nr: '' })
})

/** Odpowiedź API: jedna strona z podanymi wpisami; `nastepna` ustawia link do kolejnej strony. */
const stronaNfz = (data, { count, nastepna = null } = {}) => ({
  meta: { count: count ?? data.length, 'date-modified': '2026-10-03T21:59:55+02:00' },
  links: { next: nastepna },
  data,
})

test('NFZ: pobranie stronicowane (case=1, województwo 06, limit 25), liczba wpisów sprawdzana z meta.count', async () => {
  const adresy = []
  const kolejne = [
    stronaNfz([wpisNfz(), wpisNfz()], { count: 3, nastepna: '/app-itl-api/queues?page=2' }),
    stronaNfz([wpisNfz()], { count: 3 }),
  ]
  const pobierz = async (url) => {
    adresy.push(url)
    return kolejne.shift()
  }
  const r = await pobierzWpisySwiadczenia('stomatolog', { pobierz })
  assert.equal(r.wpisy.length, 3)
  assert.equal(r.dataModyfikacji, '2026-10-03')
  assert.equal(adresy.length, 2)
  const q = new URL(adresy[0]).searchParams
  assert.equal(q.get('province'), '06')
  assert.equal(q.get('case'), '1')
  assert.equal(q.get('benefit'), 'stomatolog')
  assert.equal(q.get('limit'), String(NFZ_LIMIT_STRONY))
  assert.equal(q.get('format'), 'json')
  assert.equal(new URL(adresy[1]).searchParams.get('page'), '2')
  // Uciętą listę trzeba zauważyć, nie zapisać.
  await assert.rejects(
    pobierzWpisySwiadczenia('stomatolog', {
      pobierz: async () => stronaNfz([wpisNfz()], { count: 5 }),
    }),
    /ucięta/,
  )
})

test('NFZ: cache miejsc – pierwsze wywołanie pyta API, drugie czyta plik, w pliku nie ma świadczeniodawców', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'uslugi-nfz-'))
  try {
    let zapytan = 0
    const pobierz = async (url) => {
      zapytan++
      const benefit = new URL(url).searchParams.get('benefit')
      if (benefit === 'stomatolog')
        return stronaNfz([
          wpisNfz(),
          wpisNfz({ address: 'UL. DŁUGA 1', locality: 'KRAKÓW', latitude: null, longitude: null }),
        ])
      return stronaNfz([
        wpisNfz({ 'id-resort-part-VIII': '1820', address: 'UL. ORTO 3', locality: 'KRAKÓW' }),
      ])
    }
    const a = await miejscaNfz({ cache, pobierz })
    assert.equal(zapytan, 2)
    assert.equal(a.miejsca.length, 3)
    assert.equal(a.meta.wpisow, 3)
    assert.equal(a.meta.dataDanych, '2026-10-03')
    assert.deepEqual(a.meta.swiadczenia, ['stomatolog', 'ortodon'])
    assert.equal(a.meta.okresDo, '2026-08')
    const b = await miejscaNfz({
      cache,
      pobierz: async () => {
        throw new Error('drugi bieg nie pyta API')
      },
    })
    assert.deepEqual(b, a)
    const zapisany = readFileSync(join(cache, 'nfz-itl-stomatologia-06.json'), 'utf8')
    for (const zakazane of ['SAWCZAK', '9930632934', '121374617', '645 22 51', '25431'])
      assert.ok(!zapisany.includes(zakazane), zakazane)
  } finally {
    rmSync(cache, { recursive: true, force: true })
  }
})

test('NFZ: położenie – współrzędne NFZ i adres geokodowany to dwie pozycje, rozbieżność jest mierzona', async () => {
  const wolane = []
  const geokoder = async (adresy) => {
    wolane.push(...adresy)
    return [
      { lat: 50.0648, lon: 19.9394 }, // zgodny z NFZ
      { lat: 50.01, lon: 19.9 }, // miejsce bez własnych współrzędnych
      null, // adresu nie zna
    ]
  }
  const miejsca = [
    { miejscowosc: 'KRAKÓW', adres: 'UL. FLORIAŃSKA 1', lat: 50.0647, lon: 19.9393 },
    { miejscowosc: 'KRAKÓW', adres: 'UL. DŁUGA 2', lat: null, lon: null },
    { miejscowosc: 'WIEŚ', adres: 'WIEŚ 5', lat: null, lon: null },
  ]
  const r = await ustalPolozenie(miejsca, { geokoduj: geokoder })
  assert.deepEqual(wolane[0], { miejscowosc: 'Kraków', ulica: 'Floriańska', nr: '1', kod: null })
  assert.deepEqual(wolane[2], { miejscowosc: 'Wieś', ulica: '', nr: '5', kod: null })
  assert.deepEqual(
    r[0].pozycje.map((p) => p.zrodlo),
    ['nfz', 'adres'],
  )
  assert.ok(r[0].rozbieznoscM >= 5 && r[0].rozbieznoscM <= 20)
  assert.deepEqual(
    r[1].pozycje.map((p) => p.zrodlo),
    ['adres'],
  )
  assert.equal(r[1].rozbieznoscM, null)
  assert.deepEqual(r[2].pozycje, [])
  assert.deepEqual(
    kontrolaPolozenia([{ rozbieznoscM: 5 }, { rozbieznoscM: 10 }, { rozbieznoscM: 80 }, {}]),
    {
      zObiemaPozycjami: 3,
      zgodnychWPromieniu: 2,
      medianaM: 10,
    },
  )
})

/** Miejsce NFZ w punkcie przesuniętym o (wschód, północ) metrów od Rynku; `adres` dodaje drugą pozycję. */
const miejsceNfz = (wschodM, polnocM, adres = null) => {
  const p = pkt('nfz', 'dentysta', null, wschodM, polnocM)
  const pozycje = [{ lat: p.lat, lon: p.lon, zrodlo: 'nfz' }]
  if (adres) {
    const a = pkt('nfz', 'dentysta', null, adres[0], adres[1])
    pozycje.push({ lat: a.lat, lon: a.lon, zrodlo: 'adres' })
  }
  return { miejscowosc: 'KRAKÓW', adres: 'UL. X 1', pozycje }
}

test('NFZ: flaga trafia na punkt rejestru w 50 m, nawet gdy punkt OSM leży bliżej; wejście nie jest zmieniane', () => {
  const wejscie = [
    pkt('osm', 'dentysta', 'Dentysta Smile', 5, 0),
    pkt('rejestr', 'dentysta', 'NZOZ SMILE', 20, 0),
    pkt('rejestr', 'dentysta', 'Poradnia Daleka', 400, 0),
  ]
  const migawka = JSON.stringify(wejscie)
  const { punkty, statystyki, dopasowania } = oznaczNfz(wejscie, [miejsceNfz(0, 0)])
  assert.deepEqual(
    punkty.map((p) => p.flagi),
    [[], ['nfz'], []],
  )
  assert.deepEqual(statystyki, {
    miejsc: 1,
    zPolozeniem: 1,
    dopasowanych: 1,
    wybranychZRejestru: 1,
    bezPunktuWPoblizu: 0,
  })
  assert.equal(dopasowania[0].punkt, 1)
  assert.equal(JSON.stringify(wejscie), migawka)
})

test('NFZ: jedno miejsce flaguje jeden punkt (najbliższy z rejestru), sąsiedni gabinet w budynku zostaje bez flagi', () => {
  const wejscie = [
    pkt('rejestr', 'dentysta', 'Gabinet A', 10, 0),
    pkt('rejestr', 'dentysta', 'Gabinet B', 25, 0),
  ]
  const { punkty } = oznaczNfz(wejscie, [miejsceNfz(0, 0)])
  assert.deepEqual(
    punkty.map((p) => p.flagi),
    [['nfz'], []],
  )
})

test('NFZ: bez punktu w promieniu miejsce zostaje bez dopasowania, a punkt OSM bez rejestru też bywa flagowany', () => {
  const dalej = oznaczNfz([pkt('rejestr', 'dentysta', 'Daleko', 60, 0)], [miejsceNfz(0, 0)])
  assert.equal(dalej.statystyki.bezPunktuWPoblizu, 1)
  assert.deepEqual(dalej.punkty[0].flagi, [])
  // Promień jest parametrem: 60 m mieści się w promieniu 75 m.
  const szerzej = oznaczNfz([pkt('rejestr', 'dentysta', 'Daleko', 60, 0)], [miejsceNfz(0, 0)], {
    promienM: 75,
  })
  assert.deepEqual(szerzej.punkty[0].flagi, ['nfz'])
  const tylkoOsm = oznaczNfz([pkt('osm', 'dentysta', 'Dentysta', 15, 0)], [miejsceNfz(0, 0)])
  assert.deepEqual(tylkoOsm.punkty[0].flagi, ['nfz'])
  assert.equal(tylkoOsm.statystyki.wybranychZRejestru, 0)
})

test('NFZ: złe współrzędne NFZ ratuje druga pozycja (adres geokodowany), miejsce bez pozycji jest pomijane', () => {
  const punkt = pkt('rejestr', 'dentysta', 'NZOZ Centrum', 0, 0)
  // Własne współrzędne NFZ 5 km dalej, adres geokodowany w punkcie rejestru.
  const r = oznaczNfz([punkt], [miejsceNfz(5000, 0, [3, 0])])
  assert.deepEqual(r.punkty[0].flagi, ['nfz'])
  const bez = oznaczNfz([punkt], [{ miejscowosc: 'X', adres: 'X 1', pozycje: [] }])
  assert.equal(bez.statystyki.zPolozeniem, 0)
  assert.deepEqual(bez.punkty[0].flagi, [])
})

test('NFZ: flaga przechodzi na klaster po deduplikacji i trafia do pliku dentysty razem z atrybucją źródła', () => {
  const wejscie = [
    pkt('osm', 'dentysta', 'Smile Dental', 0, 0),
    pkt('rejestr', 'dentysta', 'SMILE DENTAL', 8, 0),
    pkt('osm', 'dentysta', 'Dentysta Bez Umowy', 900, 0),
  ]
  const { punkty } = oznaczNfz(wejscie, [miejsceNfz(8, 0)])
  const klastry = polaczPunkty(punkty)
  assert.equal(klastry.length, 2)
  const plik = zbudujPlikBranzy(BRANZE_PO_ID.dentysta, klastry)
  assert.deepEqual(plik.bityFlag, { nfz: 1 })
  assert.equal(plik.kolumny.flagi.filter((f) => f & 1).length, 1)
  // Klaster z flagą ma OSM i rejestr: flaga z punktu rejestru obejmuje też punkt OSM tego gabinetu.
  const i = plik.kolumny.flagi.findIndex((f) => f & 1)
  assert.equal(plik.kolumny.zr[i], BITY_ZRODEL.osm | BITY_ZRODEL.rejestr)
  assert.match(plik.atrybucja, /Narodowy Fundusz Zdrowia, Informator o Terminach Leczenia/)
  assert.match(plik.atrybucja, /https:\/\/api\.nfz\.gov\.pl\//)
  assert.match(plik.licencja, /Flaga z innego źródła/)
  // Bez żadnej flagi w pliku NFZ nie jest źródłem, więc nie trafia do atrybucji.
  const bezFlagi = zbudujPlikBranzy(BRANZE_PO_ID.dentysta, polaczPunkty(wejscie))
  assert.ok(!/nfz\.gov\.pl/.test(bezFlagi.atrybucja))
  assert.ok(!/Flaga z innego źródła/.test(bezFlagi.licencja))
})

// --- Branże z #160: pliki wyjściowe --------------------------------------------------------------

test('dentysta: plik pełny (nie tylko rejestr), pokrycie względem rejestru, liczba punktów z flagą w katalogu', () => {
  const wejscie = [
    pkt('rejestr', 'dentysta', 'NZOZ Dental Max', 0, 0, ['nfz']),
    pkt('osm', 'dentysta', 'Dental Max', 8, 0),
    pkt('osm', 'dentysta', 'Gabinet Hortensja', 900, 0), // tylko OSM: zostaje w pliku (inaczej niż apteka)
    pkt('overture', 'dentysta', 'Stomatologia Róża', 1800, 0),
    pkt('rejestr', 'dentysta', 'Poradnia Rejestrowa', 2700, 0),
  ]
  const { pliki, katalog } = zlozWyjscie({ wejscie, meta: META })
  assert.equal(pliki.dentysta.n, 4)
  const wpis = katalog.branze.find((b) => b.id === 'dentysta')
  assert.equal(wpis.liczby.zFlaga.nfz, 1)
  assert.equal(wpis.mapowanie.zrodloPrawdy, null)
  assert.deepEqual(wpis.mapowanie.kodyRpwdl, ['1800', '1801', '1820', '1830', '1840'])
  assert.equal(wpis.pokrycie.rejestr.rekordow, 2)
  assert.equal(wpis.pokrycie.osm.wRejestrzeScisle, 1)
  assert.equal(wpis.pokrycie.osm.bezRejestru, 1)
  assert.equal(wpis.pokrycie.overture.bezRejestru, 1)
  // Branża bez rejestru nie ma pokrycia, apteka (prawda w rejestrze) – ma.
  assert.equal(katalog.branze.find((b) => b.id === 'optyk').pokrycie, undefined)
  assert.ok(katalog.branze.find((b) => b.id === 'apteka').pokrycie)
  // Źródło NFZ ma opis licencji w katalogu, ale nie jest bitem w plikach.
  assert.match(katalog.zrodla.nfz.licencja, /CC BY 4\.0/)
  assert.equal(BITY_ZRODEL.nfz, undefined)
})

test('restauracja: flaga fast_food w pliku i w liczbach katalogu, bity flag branży', () => {
  const wejscie = [
    pkt('osm', 'restauracja', 'Kebab Ali', 0, 0, ['fast_food']),
    pkt('overture', 'restauracja', 'Kebab Ali', 5, 0, []),
    pkt('osm', 'restauracja', 'Trattoria Roma', 500, 0, []),
  ]
  const { pliki, katalog } = zlozWyjscie({ wejscie, meta: META })
  const plik = pliki.restauracja
  assert.equal(plik.n, 2)
  assert.deepEqual(plik.bityFlag, { fast_food: 1 })
  assert.equal(plik.kolumny.flagi.filter((f) => f & 1).length, 1)
  assert.equal(katalog.branze.find((b) => b.id === 'restauracja').liczby.zFlaga.fast_food, 1)
  // Brak flagi NFZ w restauracjach: atrybucja bez NFZ.
  assert.ok(!/nfz/i.test(plik.atrybucja))
})

test('strażnik flagi: za mało punktów z nfz to błąd kontroli, tak samo jak za mało punktów branży', () => {
  const wejscie = [
    pkt('osm', 'dentysta', 'Dental Max', 0, 0),
    pkt('rejestr', 'dentysta', 'Poradnia Rejestrowa', 900, 0),
  ]
  const { pliki, katalog } = zlozWyjscie({ wejscie, meta: META })
  const bledy = sprawdzWyjscie({
    pliki: { dentysta: pliki.dentysta },
    bbox: BBOX,
    katalog: { branze: katalog.branze.filter((b) => b.id === 'dentysta') },
  })
  assert.ok(bledy.some((b) => /dentysta: flaga nfz ma 0 punktów, poniżej strażnika 75/.test(b)))
})

test('pliki w public/dane/uslugi: każda branża z katalogu ma plik, strażnika, spójne kolumny i flagi', () => {
  const dir = fileURLToPath(new URL('../public/dane/uslugi/', import.meta.url))
  const katalog = JSON.parse(readFileSync(join(dir, 'katalog.json'), 'utf8'))
  assert.deepEqual(
    katalog.branze.map((b) => b.id),
    BRANZE.map((b) => b.id),
  )
  for (const b of BRANZE) {
    const plik = JSON.parse(readFileSync(join(dir, `${b.id}.json`), 'utf8'))
    assert.equal(plik.branza, b.id)
    assert.ok(plik.n >= b.minPunktow, `${b.id}: ${plik.n} punktów, strażnik ${b.minPunktow}`)
    for (const kolumna of Object.values(plik.kolumny)) assert.equal(kolumna.length, plik.n, b.id)
    assert.deepEqual(Object.keys(plik.bityFlag ?? {}), Object.keys(b.flagi ?? {}), b.id)
    for (const [flaga, min] of Object.entries(b.minFlag ?? {})) {
      const z = plik.kolumny.flagi.filter((x) => x & plik.bityFlag[flaga]).length
      assert.ok(z >= min, `${b.id}: flaga ${flaga} ma ${z} punktów, strażnik ${min}`)
    }
    const wpis = katalog.branze.find((x) => x.id === b.id)
    assert.equal(wpis.n, plik.n, b.id)
    for (const [zrodlo, min] of Object.entries(b.minZrodel ?? {}))
      assert.ok((wpis.liczby.surowe[zrodlo] ?? 0) >= min, `${b.id}: źródło ${zrodlo}`)
  }
  // Z NFZ w pliku dentysty jest wyłącznie bit flagi i źródło w atrybucji: żadnych dodatkowych kolumn.
  const dentysta = JSON.parse(readFileSync(join(dir, 'dentysta.json'), 'utf8'))
  assert.deepEqual(Object.keys(dentysta.kolumny), ['lon', 'lat', 'zr', 'flagi', 'nazwa'])
  assert.match(dentysta.atrybucja, /api\.nfz\.gov\.pl/)
  // Katalog opisuje źródło NFZ i pokrycie rejestru dla dentysty, fizjoterapii i laboratorium.
  assert.ok(katalog.zrodla.nfz.dopasowanych > 0)
  for (const id of ['dentysta', 'fizjoterapia', 'laboratorium'])
    assert.ok(katalog.branze.find((b) => b.id === id).pokrycie.osm, id)
})

// --- Druga partia #160: drogeria, cukiernia, sklep mięsny, warzywniak, pralnia, sklep zoologiczny, bar,
// lodziarnia i paczkomat ---------------------------------------------------------------------------

const NOWE_BRANZE = {
  drogeria: 800,
  cukiernia: 800,
  sklep_miesny: 800,
  warzywniak: 500,
  pralnia: 1000,
  sklep_zoologiczny: 1000,
  bar: 800,
  lodziarnia: 500,
  paczkomat: 500,
}

test('katalog, druga partia #160: zasięgi 500–1500 m, CEIDG wyłączony, bez rejestru i flag, strażnik ustawiony na pomiar', () => {
  for (const [id, metry] of Object.entries(NOWE_BRANZE)) {
    const b = BRANZE_PO_ID[id]
    assert.equal(b.zasiegPieszyM, metry, id)
    assert.ok(b.zasiegPieszyM >= 500 && b.zasiegPieszyM <= 1500, `${id}: zasięg z zakresu zadania`)
    assert.deepEqual(b.pkd, [], `${id}: CEIDG zostaje wyłączony`)
    assert.equal(b.rejestr, undefined, `${id}: bez rejestru`)
    assert.equal(b.flagi, undefined, `${id}: bez flag`)
    assert.ok(b.minPunktow > 1, `${id}: strażnik pliku ustawiony na pomiar`)
    assert.ok(b.minZrodel.osm > 1 && b.minZrodel.overture > 1, `${id}: strażnik per źródło`)
  }
  // Paczkomaty bierzemy z OSM i Overture; API InPost nie jest źródłem (brak licencji na punkty).
  assert.deepEqual(
    Object.keys(OPISY_ZRODEL).filter((z) => /inpost/i.test(z)),
    [],
  )
  assert.deepEqual(BRANZE_PO_ID.paczkomat.osm, ['amenity=parcel_locker'])
  assert.deepEqual(BRANZE_PO_ID.paczkomat.overture, ['package_locker'])
})

test('mapowanie OSM, druga partia #160: drogeria, sklep mięsny, pralnia, zoologiczny, bar, lodziarnia, paczkomat', () => {
  const ids = (t) => klasyfikujOsm(t).map((x) => x.branza)
  assert.deepEqual(ids({ shop: 'chemist' }), ['drogeria'])
  assert.deepEqual(ids({ shop: 'cosmetics' }), [], 'sklepy z kosmetykami to nie drogerie')
  assert.deepEqual(ids({ shop: 'butcher' }), ['sklep_miesny'])
  assert.deepEqual(ids({ shop: 'laundry' }), ['pralnia'])
  assert.deepEqual(ids({ shop: 'dry_cleaning' }), ['pralnia'])
  assert.deepEqual(ids({ shop: 'pet' }), ['sklep_zoologiczny'])
  assert.deepEqual(ids({ shop: 'pet_grooming' }), [], 'groomerzy są poza branżą')
  assert.deepEqual(ids({ amenity: 'bar' }), ['bar'])
  assert.deepEqual(ids({ amenity: 'pub' }), ['bar'])
  assert.deepEqual(ids({ amenity: 'biergarten' }), [], 'ogródki piwne są poza branżą')
  assert.deepEqual(ids({ amenity: 'ice_cream' }), ['lodziarnia'])
  assert.deepEqual(ids({ shop: 'ice_cream' }), ['lodziarnia'])
  assert.deepEqual(ids({ amenity: 'parcel_locker' }), ['paczkomat'])
  assert.deepEqual(ids({ amenity: 'post_office' }), [], 'poczta to nie automat paczkowy')
  // Nieczynne odpadają tak samo jak w starszych branżach.
  assert.deepEqual(ids({ amenity: 'parcel_locker', 'disused:amenity': 'parcel_locker' }), [])
  assert.deepEqual(ids({ shop: 'chemist', 'was:shop': 'chemist' }), [])
})

test('mapowanie Overture, druga partia #160: kategorie branż i odrzucone sąsiednie kategorie', () => {
  const ids = (kat, nazwa = 'X') => klasyfikujOverture({ kat, nazwa }).map((x) => x.branza)
  assert.deepEqual(ids('butcher_shop'), ['sklep_miesny'])
  assert.deepEqual(ids('meat_wholesaler'), [], 'hurtownia mięsa to nie sklep')
  assert.deepEqual(ids('produce_store'), ['warzywniak'])
  assert.deepEqual(ids('produce_wholesaler'), [])
  for (const kat of ['laundry_service', 'dry_cleaning', 'laundromat'])
    assert.deepEqual(ids(kat), ['pralnia'], kat)
  assert.deepEqual(ids('carpet_cleaning'), [], 'pranie dywanów to inna usługa')
  for (const kat of ['pet_store', 'aquatic_pet_store'])
    assert.deepEqual(ids(kat), ['sklep_zoologiczny'], kat)
  assert.deepEqual(ids('pet_groomer'), [])
  assert.deepEqual(ids('pet_boarding'), [])
  for (const kat of [
    'bar',
    'pub',
    'cocktail_bar',
    'wine_bar',
    'beer_bar',
    'sports_bar',
    'irish_pub',
    'gastropub',
    'dive_bar',
    'gay_bar',
    'tapas_bar',
    'hotel_bar',
    'whiskey_bar',
  ])
    assert.deepEqual(ids(kat), ['bar'], kat)
  // Gwiazdka `*_bar` wciągnęłaby te kategorie, więc lista jest jawna.
  for (const kat of ['milk_bar', 'salad_bar', 'smoothie_juice_bar', 'hookah_bar', 'beer_garden'])
    assert.deepEqual(ids(kat), [], kat)
  assert.deepEqual(ids('bar_and_grill_restaurant'), ['restauracja'], 'to restauracja, nie bar')
  for (const kat of ['ice_cream_shop', 'frozen_yogurt_shop'])
    assert.deepEqual(ids(kat), ['lodziarnia'], kat)
  assert.deepEqual(ids('package_locker'), ['paczkomat'])
  for (const kat of ['post_office', 'courier_and_delivery_service', 'shipping_center'])
    assert.deepEqual(ids(kat), [], kat)
})

test('filtr drogeria: Rossmann, Hebe i Super-Pharm z różnych kategorii Overture tak, apteki spod drugstore nie', () => {
  const ids = (kat, nazwa) => klasyfikujOverture({ kat, nazwa }).map((x) => x.branza)
  for (const kat of [
    'drugstore',
    'beauty_supply_store',
    'cosmetics_and_fragrance_store',
    'beauty_product_supplier',
    'hair_supply_store',
    'shopping',
  ])
    assert.deepEqual(ids(kat, 'Rossmann Polska'), ['drogeria'], kat)
  assert.deepEqual(ids('beauty_supply_store', 'Hebe'), ['drogeria'])
  assert.deepEqual(ids('beauty_product_supplier', 'Super-Pharm Drogeria'), ['drogeria'])
  assert.deepEqual(ids('shopping', 'Drogeria Kosmyk'), ['drogeria'])
  // Perfumerie i sklepy sieciowe z tej samej kategorii nie są drogeriami.
  assert.deepEqual(ids('beauty_supply_store', 'Sephora'), [])
  assert.deepEqual(ids('cosmetics_and_fragrance_store', 'Douglas'), [])
  assert.deepEqual(ids('shopping', 'Lewiatan'), [])
  // 12 z 14 miejsc `drugstore` w obszarze to apteki: bez nazwy drogeryjnej odpadają.
  assert.deepEqual(ids('drugstore', 'Apteka Galen'), [])
  assert.deepEqual(ids('drugstore', 'Eurolek sp.j'), [])
  // Apteka z kategorii `pharmacy` zostaje apteką; drogeria w tej kategorii jest też drogerią.
  assert.deepEqual(ids('pharmacy', 'Apteka Dbam o Zdrowie'), ['apteka'])
  assert.deepEqual(ids('pharmacy', 'Super-Pharm'), ['apteka', 'drogeria'])
  assert.equal(nazwaDrogeriaPodobna('Drogeria Rossmann'), true)
  assert.equal(nazwaDrogeriaPodobna('dm-drogerie markt Polska'), true)
  assert.equal(
    nazwaDrogeriaPodobna('Adwokat Paulina Chebel'),
    false,
    'hebe tylko jako osobne słowo',
  )
  assert.equal(nazwaDrogeriaPodobna(null), false)
})

test('piekarnia i cukiernia: OSM rozdziela shop=bakery od pastry i confectionery, Overture bakery dzieli się po nazwie', () => {
  const ids = (kat, nazwa) => klasyfikujOverture({ kat, nazwa }).map((x) => x.branza)
  // OSM: żaden obiekt nie trafia do obu branż.
  for (const [tagi, branza] of [
    [{ shop: 'bakery' }, 'piekarnia'],
    [{ shop: 'pastry' }, 'cukiernia'],
    [{ shop: 'confectionery' }, 'cukiernia'],
  ])
    assert.deepEqual(
      klasyfikujOsm(tagi).map((x) => x.branza),
      [branza],
      JSON.stringify(tagi),
    )
  // Overture `bakery`: zwykła piekarnia albo bez nazwy zostaje w piekarni, czysto cukiernicza idzie do cukierni.
  assert.deepEqual(ids('bakery', 'Piekarnia Czajczyk'), ['piekarnia'])
  assert.deepEqual(ids('bakery', 'Żabka'), ['piekarnia'])
  assert.deepEqual(ids('bakery', null), ['piekarnia'])
  for (const nazwa of [
    'Cukiernia Zając',
    'Pracownia Cukiernicza KWIATEK',
    'Ciastkarnia IZA',
    'Fit Cake',
    'Torty z Pomysłem',
  ])
    assert.deepEqual(ids('bakery', nazwa), ['cukiernia'], nazwa)
  // „Piekarnia i Cukiernia" to jedno i drugie.
  for (const nazwa of [
    'Piekarnia i Cukiernia Buczek',
    'Pieczywo Buczek Cukiernia, Piekarnia, Kawiarnia',
    'Piekarnia Cukiernia Awiteks',
  ])
    assert.deepEqual(ids('bakery', nazwa), ['piekarnia', 'cukiernia'], nazwa)
  // Kategorie słodyczy i deserów to cukiernia niezależnie od nazwy.
  for (const kat of [
    'dessert_shop',
    'patisserie_cake_shop',
    'cupcake_shop',
    'candy_store',
    'chocolatier',
  ])
    assert.deepEqual(ids(kat, 'X'), ['cukiernia'], kat)
  assert.equal(nazwaCukierniPodobna('Cukiernia Sowa'), true)
  assert.equal(nazwaCukierniPodobna('Piekarnia Wawel'), false)
  assert.equal(nazwaTylkoCukierni('Cukiernia Sowa'), true)
  assert.equal(nazwaTylkoCukierni('Piekarnia i Cukiernia Buczek'), false)
  assert.equal(nazwaTylkoCukierni('Piekarnia Wawel'), false)
  assert.equal(nazwaTylkoCukierni(null), false)
  // PKD 10.71.Z zostaje przy piekarni: kod nie rozdziela piekarni od cukierni.
  assert.deepEqual(BRANZE_PO_ID.piekarnia.pkd, ['10.71.Z'])
  assert.deepEqual(BRANZE_PO_ID.cukiernia.pkd, [])
})

test('wstępne filtry źródeł obejmują nowe branże: selektory OSM i kategorie Overture', () => {
  const osm = selektoryOsm()
  for (const v of [
    'chemist',
    'confectionery',
    'pastry',
    'bakery',
    'butcher',
    'greengrocer',
    'laundry',
    'dry_cleaning',
    'pet',
    'ice_cream',
  ])
    assert.ok(osm.get('shop').has(v), `shop=${v}`)
  for (const v of ['bar', 'pub', 'ice_cream', 'parcel_locker'])
    assert.ok(osm.get('amenity').has(v), `amenity=${v}`)
  const kategorie = kategorieOverture()
  for (const k of [
    'drugstore',
    'shopping',
    'bakery',
    'dessert_shop',
    'butcher_shop',
    'produce_store',
    'laundromat',
    'aquatic_pet_store',
    'cocktail_bar',
    'ice_cream_shop',
    'package_locker',
  ])
    assert.ok(kategorie.includes(k), k)
})

test('druga partia #160 w plikach: kolumny bez flag, licencja OSM i Overture, ten sam lokal z dwóch źródeł to jeden punkt', () => {
  const nazwy = {
    drogeria: 'Rossmann',
    cukiernia: 'Cukiernia Sowa',
    sklep_miesny: 'Masarnia Kowalski',
    warzywniak: 'Warzywniak Bananek',
    pralnia: 'Pralnia Speed Queen',
    sklep_zoologiczny: 'Maxi Zoo',
    bar: 'Pub Terapia Grupowa',
    lodziarnia: 'Grycan',
    paczkomat: 'Paczkomat InPost',
  }
  const wejscie = Object.entries(nazwy).flatMap(([id, nazwa]) => [
    pkt('osm', id, nazwa, 0, 0),
    pkt('overture', id, nazwa, 9, 0),
    pkt('osm', id, 'Inny lokal', 700, 0),
  ])
  const { pliki, katalog } = zlozWyjscie({ wejscie, meta: META })
  for (const id of Object.keys(nazwy)) {
    const plik = pliki[id]
    assert.equal(plik.n, 2, id)
    assert.deepEqual(Object.keys(plik.kolumny), ['lon', 'lat', 'zr', 'nazwa'], id)
    assert.equal(plik.bityFlag, undefined, id)
    assert.equal(plik.zasiegPieszyM, NOWE_BRANZE[id], id)
    assert.ok(
      plik.kolumny.zr.includes(BITY_ZRODEL.osm | BITY_ZRODEL.overture),
      `${id}: punkt z OSM i Overture`,
    )
    assert.match(plik.atrybucja, /© OpenStreetMap contributors, ODbL/, id)
    assert.match(plik.atrybucja, /Overture Maps Foundation/, id)
    assert.match(plik.licencja, /ODbL 1\.0/, id)
    const wpis = katalog.branze.find((b) => b.id === id)
    assert.equal(wpis.liczby.potwierdzoneWielomaZrodlami, 1, id)
    assert.equal(wpis.pokrycie, undefined, `${id}: bez rejestru nie ma pokrycia`)
    assert.deepEqual(sprawdzWyjscie({ pliki: { [id]: plik }, bbox: BBOX }), [], id)
  }
})

test('dokumentacja: tabela mapowania w uslugi.md ma wiersz i zasięg każdej branży z katalogu', () => {
  const md = readFileSync(fileURLToPath(new URL('./uslugi.md', import.meta.url)), 'utf8')
  const wiersze = md.split('\n')
  for (const b of BRANZE) {
    const wiersz = wiersze.find((l) => l.startsWith(`| \`${b.id}\``) && l.includes(' m |'))
    assert.ok(wiersz, `${b.id}: brak wiersza w tabeli mapowania`)
    assert.ok(wiersz.includes(`| ${b.zasiegPieszyM} m |`), `${b.id}: zasięg ${b.zasiegPieszyM} m`)
  }
})

// --- Podział wg obszaru ---------------------------------------------------------------------------

test('podział wg obszaru: najbliższy adres do 400 m wskazuje Kraków albo gminę obwarzanka, reszta to margines', () => {
  const adres = (wschodM, polnocM, gmina) => ({ ...pkt('x', 'x', null, wschodM, polnocM), gmina })
  const najblizszy = indeksPunktow([adres(0, 0, 'Kraków'), adres(10_000, 0, 'Wieliczka')])
  const punkty = [
    pkt('osm', 'x', 'A', 100, 0), // 100 m od adresu w Krakowie
    pkt('osm', 'x', 'B', 5000, 0), // w polu, bez adresu w promieniu
    pkt('osm', 'x', 'C', 10_100, 0), // przy adresie w Wieliczce
    pkt('osm', 'x', 'D', 450, 0), // 450 m od adresu: poza promieniem
  ]
  const plik = {
    n: punkty.length,
    kolumny: {
      lat: punkty.map((p) => p.lat),
      lon: punkty.map((p) => p.lon),
      zr: [
        BITY_ZRODEL.osm | BITY_ZRODEL.overture,
        BITY_ZRODEL.osm,
        BITY_ZRODEL.rejestr,
        BITY_ZRODEL.osm,
      ],
    },
  }
  assert.deepEqual(podzialWgObszaru(plik, najblizszy), {
    n: 4,
    krakow: 1,
    obwarzanek: 1,
    margines: 2,
    wielZrodelWKrakowie: 1,
  })
})
