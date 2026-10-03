// Uruchom: node --test etl/wypadki.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { cellToParent, latLngToCell } from 'h3-js'
import { wczytajAdresy } from './lib/wspolne.mjs'
import {
  agreguj,
  czytajZdarzenia,
  etykietaHeksu,
  LATA,
  LICZBA_LAT,
  odczyty,
  odlegloscKm,
  odmiana,
  opisWarstwy,
  RES,
  ustalPunkt,
  WAGI,
  wagaZdarzenia,
  warstwaAdresow,
  zdarzenie,
} from './wypadki.mjs'

// ── Fixture w kształcie prawdziwego zrzutu SEWIK (sewik:SEWIK_EXP_XML_02) ─────────────────

const gus = (lon, lat) =>
  `<GPS_X_GUS>${String(lon).replace('.', ',')}</GPS_X_GUS><GPS_Y_GUS>${String(lat).replace('.', ',')}</GPS_Y_GUS>`
const pojazd = (id, rodzaj) =>
  `<POJAZD DataUtworzenia="2021-01-21" DataMod="2021-01-21"><ID>${id}</ID><ZSZD_ID>1</ZSZD_ID><NR_POJAZDU>1</NR_POJAZDU><RODZAJ_POJAZDU>${rodzaj}</RODZAJ_POJAZDU></POJAZD>`
const osoba = (ssru, { poj, stuc } = {}) =>
  `<OSOBA DataUtworzenia="2021-01-21" DataMod="2021-01-21"><ID>9${Math.floor(Math.random() * 1e6)}</ID><ZSZD_ID>1</ZSZD_ID>${poj ? `<ZSPO_ID>${poj}</ZSPO_ID>` : ''}<SSRU_KOD>${ssru}</SSRU_KOD><SSRU_TABK_TYPE>SSRU</SSRU_TABK_TYPE><PLEC>M</PLEC>${stuc ? `<STUC_KOD>${stuc}</STUC_KOD><STUC_TABK_TYPE>STUC</STUC_TABK_TYPE>` : ''}</OSOBA>`
function zd({
  id,
  data = '2021-05-04',
  x,
  y,
  gusLonLat,
  pojazdy = [],
  osoby = [],
  powiat = 'POWIAT KRAKÓW',
  teryt = '1261011',
}) {
  const [glon, glat] = gusLonLat ?? [19.9850418790872, 50.0531460184769]
  return `<ZDARZENIE DataUtworzenia="${data}" DataMod="${data}" SzkicZdarzenia="N"><ID>${id}</ID><JEDNOSTKA_MIEJSCA>KK KMP Kraków</JEDNOSTKA_MIEJSCA><KOD_GUS>${teryt}</KOD_GUS>${gusLonLat === null ? '' : gus(glon, glat)}<WOJ>WOJ. MAŁOPOLSKIE</WOJ><GMINA>KRAKÓW - OBSZAR MIEJSKI</GMINA><POWIAT>${powiat}</POWIAT><MIEJSCOWOSC>KRAKÓW</MIEJSCOWOSC><ULICA_ADRES>MOGILSKA</ULICA_ADRES><DATA_ZDARZENIA>${data}T17:00:00</DATA_ZDARZENIA><DATA_ZDARZ>${data}</DATA_ZDARZ>${x === undefined ? '' : `<WSP_GPS_X>${x}</WSP_GPS_X>`}${y === undefined ? '' : `<WSP_GPS_Y>${y}</WSP_GPS_Y>`}<SZOS_KOD>01</SZOS_KOD><INFO_O_DRODZE><NAWIERZCHNIA><NADR_KOD><ZSZD_ID>${id}</ZSZD_ID><NADR_KOD>01</NADR_KOD></NADR_KOD></NAWIERZCHNIA></INFO_O_DRODZE><POJAZDY>${pojazdy.join('')}</POJAZDY><UCZESTNICY>${osoby.join('')}</UCZESTNICY></ZDARZENIE>`
}

// Rondo Mogilskie z zrzutu: 19*57'313 / 50*04'003 = 19°57'31,3" E, 50°04'00,3" N (DMS, ok. 200 m od ronda)
const RONDO = {
  x: "19*57'313",
  y: "50*04'003",
  lon: 19 + 57 / 60 + 31.3 / 3600,
  lat: 50 + 4 / 60 + 0.3 / 3600,
}

test('odczyty: DMS, dziesiętny „gwiazdkowy”, zwykła liczba, literówki', () => {
  const o = odczyty("19*56'462")
  assert.ok(Math.abs(o.dms - (19 + 56 / 60 + 46.2 / 3600)) < 1e-12)
  assert.equal(o.dec, 19.56462)
  // minuty ≥ 60 albo sekundy ≥ 60 = stopnie dziesiętne zapisane w kształcie DMS
  assert.deepEqual(odczyty("19*97'792"), { dms: null, dec: 19.97792 })
  assert.deepEqual(odczyty("19*57'713"), { dms: null, dec: 19.57713 })
  // minuty bez zera wiodącego: 50°7'29,3", odczyt dziesiętny 50,07293
  const jedna = odczyty("50*7'293")
  assert.ok(Math.abs(jedna.dms - (50 + 7 / 60 + 29.3 / 3600)) < 1e-12)
  assert.equal(jedna.dec, 50.07293)
  // sekundy bez dziesiątych
  assert.ok(Math.abs(odczyty("19*57'31").dms - (19 + 57 / 60 + 31 / 3600)) < 1e-12)
  assert.deepEqual(odczyty('19.9565'), { dms: null, dec: 19.9565 })
  assert.deepEqual(odczyty('50,0614'), { dms: null, dec: 50.0614 })
  for (const zle of ["50*2''332", "4**55'099", '200815059', '', undefined, null])
    assert.deepEqual(odczyty(zle), { dms: null, dec: null })
})

test('ustalPunkt: DMS jest domyślny, także gdy odczyt dziesiętny leży bliżej punktu GUS (środka miasta)', () => {
  const srodekKrakowa = { lat: 50.0531, lon: 19.985 }
  const p = ustalPunkt(RONDO.x, RONDO.y, srodekKrakowa)
  assert.equal(p.tryb, 'DMS')
  assert.ok(Math.abs(p.lon - RONDO.lon) < 1e-9 && Math.abs(p.lat - RONDO.lat) < 1e-9)
  // 29 Listopada: lat 50*05'406 = 50,0917 (DMS); odczyt dziesiętny 50,05406 leży 0,1 km od środka miasta,
  // a mimo to wygrywa DMS, bo punkt GUS Krakowa nie rozróżnia odczytów w obrębie miasta
  const naPolnocy = ustalPunkt("19*57'404", "50*05'406", srodekKrakowa)
  assert.equal(naPolnocy.tryb, 'DMS')
  assert.ok(Math.abs(naPolnocy.lat - (50 + 5 / 60 + 40.6 / 3600)) < 1e-9)
})

test('ustalPunkt: minuty albo sekundy ≥ 60 = stopnie dziesiętne, także bez punktu GUS', () => {
  const balice = ustalPunkt("19*78'947", "50*08'374", { lat: 50.119, lon: 19.763 })
  assert.equal(balice.tryb, 'dziesietne')
  assert.ok(Math.abs(balice.lon - 19.78947) < 1e-9 && Math.abs(balice.lat - 50.08374) < 1e-9)
  assert.equal(ustalPunkt("19*78'947", "50*08'374").tryb, 'dziesietne')
  // sekundy 71,3 nie istnieją; oś Y jest poprawnym DMS, ale para musi mieć jeden odczyt
  assert.equal(ustalPunkt("19*57'713", "50*04'003").tryb, 'dziesietne')
})

test('ustalPunkt: DMS ma pierwszeństwo, dziesiętny zastępuje go tylko, gdy DMS leży poza promieniem od GUS', () => {
  // Luborzyca: GUS 20,115 / 50,152; zapis dziesiętny 20,12169 / 50,14265 czyta się też jako DMS (12 km dalej).
  // Ten przypadek zostaje przy DMS – to znany błąd ok. 0,2–1% zdarzeń (etl/wypadki.md)
  const luborzyca = ustalPunkt("20*12'169", "50*14'265", { lat: 50.152, lon: 20.115 })
  assert.equal(luborzyca.tryb, 'DMS')
  // DMS 19,9944 leży 28,6 km od GUS (19,594), odczyt dziesiętny 19,594 dokładnie w miejscowości
  const daleki = ustalPunkt("19*59'400", "50*03'000", { lat: 50.03, lon: 19.594 })
  assert.equal(daleki.tryb, 'dziesietne')
  assert.ok(odlegloscKm(daleki.lat, daleki.lon, 50.03, 19.594) < 0.1)
})

test('ustalPunkt: zwykła liczba dziesiętna i odrzucanie punktów dalekich od GUS oraz poza województwem', () => {
  const zwykly = ustalPunkt('19,9565', '50.0614', { lat: 50.0531, lon: 19.985 })
  assert.equal(zwykly.tryb, 'dziesietne')
  assert.equal(zwykly.lon, 19.9565)
  // literówka: szerokość 20° zamiast 50° – punkt setki kilometrów od miejscowości
  assert.equal(ustalPunkt("19*56'462", "20*01'237", { lat: 50.0531, lon: 19.985 }), null)
  // punkt 85 km od miejscowości (Zakopane zamiast Krakowa)
  assert.equal(ustalPunkt(RONDO.x, RONDO.y, { lat: 49.29, lon: 19.95 }), null)
  // bez punktu GUS obwiednia województwa: długość 5° to Niemcy
  assert.equal(ustalPunkt('5.0', '50.0'), null)
  assert.equal(ustalPunkt(undefined, undefined, { lat: 50, lon: 20 }), null)
  assert.equal(ustalPunkt("50*2''332", "19*56'462"), null)
})

test('zdarzenie: ofiary, pieszy, rower, wagi i punkt w kształcie prawdziwego zrzutu', () => {
  const xml = zd({
    id: 777,
    x: RONDO.x,
    y: RONDO.y,
    pojazdy: [pojazd(11, 'IS121')],
    osoby: [
      osoba('K', { poj: 11 }),
      osoba('P', { poj: 11, stuc: 'RL' }),
      osoba('I', { stuc: 'RC' }),
      osoba('I', { stuc: 'ZM' }),
      osoba('I'),
    ],
  })
  const z = zdarzenie(xml)
  assert.equal(z.id, '777')
  assert.equal(z.rok, 2021)
  assert.equal(z.tryb, 'DMS')
  assert.ok(Math.abs(z.lat - RONDO.lat) < 1e-9)
  assert.deepEqual(z.ofiary, { zabity: 1, ciezko: 1, lekko: 1 })
  assert.deepEqual(z.ofiaryNiechronieni, { zabity: 1, ciezko: 1, lekko: 0 })
  assert.equal(z.pieszy, true)
  assert.equal(z.rower, false)
  assert.equal(z.niechronieni, true)
  assert.equal(z.waga, WAGI.zdarzenie + WAGI.zabity + WAGI.ciezko + WAGI.lekko)
  assert.equal(z.wagaNiechronieni, WAGI.zdarzenie + WAGI.zabity + WAGI.ciezko)
  assert.equal(z.powiat, 'POWIAT KRAKÓW')
  assert.equal(z.teryt, '1261011')
})

test('zdarzenie: rowerzysta (IS101 i IS201), pasażer roweru, zabity w ciągu 30 dni, kolizja bez ofiar', () => {
  for (const kod of ['IS101', 'IS201']) {
    const z = zdarzenie(
      zd({
        id: 1,
        x: RONDO.x,
        y: RONDO.y,
        pojazdy: [pojazd(21, kod), pojazd(22, 'IS121')],
        osoby: [
          osoba('K', { poj: 21, stuc: 'ZC' }),
          osoba('P', { poj: 21, stuc: 'RL' }),
          osoba('K', { poj: 22, stuc: 'RC' }),
        ],
      }),
    )
    assert.equal(z.rower, true, kod)
    assert.equal(z.pieszy, false, kod)
    assert.deepEqual(z.ofiary, { zabity: 1, ciezko: 1, lekko: 1 }, kod)
    // ranny kierowca samochodu nie wchodzi do ofiar niechronionych, pasażer roweru tak
    assert.deepEqual(z.ofiaryNiechronieni, { zabity: 1, ciezko: 0, lekko: 1 }, kod)
  }
  const kolizja = zdarzenie(
    zd({
      id: 2,
      x: RONDO.x,
      y: RONDO.y,
      pojazdy: [pojazd(1, 'IS121'), pojazd(2, 'IS221')],
      osoby: [osoba('K', { poj: 1 }), osoba('K', { poj: 2 })],
    }),
  )
  assert.equal(kolizja.waga, WAGI.zdarzenie)
  assert.equal(kolizja.niechronieni, false)
  assert.equal(kolizja.wagaNiechronieni, 0)
  // hulajnoga elektryczna (IS240) i osoba „O” nie są rowerem ani pieszym
  const hulajnoga = zdarzenie(
    zd({
      id: 3,
      x: RONDO.x,
      y: RONDO.y,
      pojazdy: [pojazd(5, 'IS240')],
      osoby: [osoba('K', { poj: 5, stuc: 'RL' }), osoba('O', { stuc: 'RL' })],
    }),
  )
  assert.equal(hulajnoga.niechronieni, false)
  assert.deepEqual(hulajnoga.ofiary, { zabity: 0, ciezko: 0, lekko: 2 })
})

test('zdarzenie: brak współrzędnych, literówka i rok z DATA_ZDARZENIA', () => {
  assert.equal(zdarzenie(zd({ id: 1 })).lat, null)
  assert.equal(zdarzenie(zd({ id: 1, x: "50*2''332", y: "50*2''332" })).lat, null)
  assert.equal(zdarzenie(zd({ id: 1, data: '2019-12-31', x: RONDO.x, y: RONDO.y })).rok, 2019)
})

const dzienne = [
  zd({ id: 1, x: RONDO.x, y: RONDO.y, osoby: [osoba('I', { stuc: 'RC' })] }),
  zd({
    id: 2,
    data: '2018-01-01',
    x: '19.9566',
    y: '50.0668',
    pojazdy: [pojazd(1, 'IS101')],
    osoby: [osoba('K', { poj: 1, stuc: 'ZM' })],
  }),
  zd({
    id: 3,
    data: '2019-01-01',
    pojazdy: [pojazd(1, 'IS121')],
    osoby: [osoba('K', { poj: 1, stuc: 'RL' })],
  }),
  zd({ id: 4, data: '2025-02-02', x: RONDO.x, y: RONDO.y }),
  zd({ id: 5, data: '2017-02-02', x: RONDO.x, y: RONDO.y }),
  zd({ id: 6, data: '2024-07-07', x: "19*57'400", y: "50*04'100" }),
  // Zakopane: w Małopolsce, ale poza obszarem adresów
  zd({
    id: 7,
    data: '2020-02-02',
    x: "19*57'000",
    y: "49*17'000",
    gusLonLat: [19.95, 49.29],
    teryt: '1217011',
    powiat: 'POWIAT TATRZAŃSKI',
  }),
  // ten sam id drugi raz (poprawiony plik obok oryginału)
  zd({ id: 1, x: RONDO.x, y: RONDO.y, osoby: [osoba('I', { stuc: 'RC' })] }),
]
const XML = `<?xml version="1.0" encoding="UTF-8"?><sewik:SEWIK_EXP_XML_02 xmlns:sewik="http://www.policja.gov.pl/sewik" DataOd="2018-01-01" DataDo="2024-12-31" LiczbaZdarzen="8"><ZDARZENIA>\n${dzienne.join('\n')}\n</ZDARZENIA></sewik:SEWIK_EXP_XML_02>`

async function* kawalki(t, n) {
  for (let i = 0; i < t.length; i += n) yield t.slice(i, i + n)
}

test('czytajZdarzenia: strumieniowo, niezależnie od podziału na kawałki, tylko lata 2018–2024', async () => {
  for (const n of [7, 100, 1000, 100000]) {
    const lista = []
    for await (const z of czytajZdarzenia(kawalki(XML, n))) lista.push(z)
    assert.deepEqual(
      lista.map((z) => z.id),
      ['1', '2', '3', '6', '7', '1'],
      `kawałek ${n}`,
    ) // 2025 i 2017 poza zakresem
  }
})

test('agreguj: obszar, duplikaty, brak punktu, ofiary i sumy domykają się do liczby zdarzeń', async () => {
  const hRondo = latLngToCell(RONDO.lat, RONDO.lon, RES)
  const lista = []
  for await (const z of czytajZdarzenia(kawalki(XML, 333))) lista.push(z)
  // obszar = heksy wszystkich zdarzeń krakowskich (są przy samym rondzie, ale mogą leżeć w sąsiednim heksie)
  const obszar = new Set(
    lista.filter((z) => z.lat !== null && z.lat > 49.9).map((z) => latLngToCell(z.lat, z.lon, RES)),
  )
  assert.ok(obszar.has(hRondo))
  const { wszystkie, niechronieni, stat } = agreguj(lista, obszar, new Set(['126101']))
  assert.equal(stat.razem, 5) // id 1, 2, 3, 6, 7; drugi id 1 to duplikat
  assert.equal(stat.duplikaty, 1)
  assert.equal(stat.bezPunktu, 1) // id 3
  assert.equal(stat.pozaObszarem, 1) // Zakopane
  assert.equal(stat.wObszarze, 3) // id 1 (pieszy), 2 (rower, zwykła liczba), 6 (kolizja)
  assert.equal(stat.wObszarzeNiechronieni, 2)
  // według KOD_GUS: cztery krakowskie zdarzenia (jedno bez punktu), Zakopane to inna gmina
  assert.equal(stat.wGminach, 4)
  assert.equal(stat.bezPunktuWGminach, 1)
  // inwariant: każde zdarzenie jest w dokładnie jednej z grup
  assert.equal(stat.bezPunktu + stat.pozaObszarem + stat.wObszarze, stat.razem)
  const sumaZdarzen = [...wszystkie.values()].reduce((a, k) => a + k.zdarzenia, 0)
  assert.equal(sumaZdarzen, stat.wObszarze)
  const sumaWag = [...wszystkie.values()].reduce((a, k) => a + k.waga, 0)
  const wagiZdarzen = lista
    .filter((z) => z.lat !== null && wszystkie.has(latLngToCell(z.lat, z.lon, RES)))
    .filter((z, i, t) => t.findIndex((q) => q.id === z.id) === i)
    .reduce((a, z) => a + z.waga, 0)
  assert.equal(sumaWag, wagiZdarzen)
  assert.ok(niechronieni.get(hRondo).zdarzenia >= 1)
})

test('agreguj: zdarzenia z udziałem pieszych i rowerzystów liczą tylko ich ofiary', () => {
  const hRondo = latLngToCell(RONDO.lat, RONDO.lon, RES)
  const z = zdarzenie(
    zd({
      id: 10,
      x: RONDO.x,
      y: RONDO.y,
      pojazdy: [pojazd(1, 'IS201'), pojazd(2, 'IS221')],
      osoby: [osoba('K', { poj: 1, stuc: 'RC' }), osoba('K', { poj: 2, stuc: 'ZM' })],
    }),
  )
  const { wszystkie, niechronieni } = agreguj([z], new Set([hRondo]))
  assert.equal(wszystkie.get(hRondo).waga, WAGI.zdarzenie + WAGI.zabity + WAGI.ciezko)
  assert.equal(niechronieni.get(hRondo).waga, WAGI.zdarzenie + WAGI.ciezko)
  assert.deepEqual(
    { z: niechronieni.get(hRondo).zabity, c: niechronieni.get(hRondo).ciezko },
    { z: 0, c: 1 },
  )
})

test('odmiana i etykieta: liczba mnoga po polsku', () => {
  const o = (n) => odmiana(n, 'zdarzenie', 'zdarzenia', 'zdarzeń')
  assert.deepEqual([1, 2, 4, 5, 12, 14, 21, 22, 25, 112, 0].map(o), [
    'zdarzenie',
    'zdarzenia',
    'zdarzenia',
    'zdarzeń',
    'zdarzeń',
    'zdarzeń',
    'zdarzeń',
    'zdarzenia',
    'zdarzeń',
    'zdarzeń',
    'zdarzeń',
  ])
  const k = { zdarzenia: 1, zabity: 0, ciezko: 1, lekko: 2, waga: 6 }
  assert.equal(
    etykietaHeksu(k, 'wszystkie'),
    `1 zdarzenie w latach ${LATA[0]}–${LATA[1]} (zabici: 0, ciężko ranni: 1, lekko ranni: 2)`,
  )
  assert.match(etykietaHeksu(undefined, 'wszystkie'), /^brak zdarzeń w latach/)
  assert.match(etykietaHeksu(undefined, 'niechronieni'), /brak zdarzeń z pieszymi lub rowerzystami/)
  assert.match(etykietaHeksu({ ...k, zdarzenia: 3 }, 'niechronieni'), /^3 zdarzenia z pieszymi/)
  const bez = { zdarzenia: 6, zabity: 0, ciezko: 0, lekko: 0, waga: 6 }
  assert.equal(
    etykietaHeksu(bez, 'wszystkie'),
    `6 zdarzeń w latach ${LATA[0]}–${LATA[1]} (bez ofiar)`,
  )
  assert.match(etykietaHeksu(bez, 'niechronieni'), /\(bez poszkodowanych pieszych i rowerzystów\)$/)
})

test('warstwaAdresow: średnia roczna waga heksu, zero zamiast braku, słownik etykiet', () => {
  const h10a = latLngToCell(50.0667, 19.9552, 10)
  const h10b = latLngToCell(50.0674, 19.9559, 10) // ten sam heks r8
  const h10c = latLngToCell(50.2, 20.3, 10) // inny heks r8, bez zdarzeń
  assert.equal(cellToParent(h10a, RES), cellToParent(h10b, RES))
  const adresy = [{ h3: h10a }, { h3: h10b }, { h3: h10c }]
  const komorki = new Map([
    [cellToParent(h10a, RES), { zdarzenia: 70, zabity: 1, ciezko: 2, lekko: 3, waga: 70 }],
  ])
  const w = warstwaAdresow(adresy, komorki, 'wszystkie')
  assert.deepEqual(w.wartosci, [70 / LICZBA_LAT, 70 / LICZBA_LAT, 0])
  assert.equal(w.etykiety[0], w.etykiety[1])
  assert.notEqual(w.etykiety[0], w.etykiety[2])
  assert.match(w.slownikEtykiet[w.etykiety[0]], /^70 zdarzeń w latach/)
  assert.match(w.slownikEtykiet[w.etykiety[2]], /^brak zdarzeń/)
  assert.ok(w.wartosci.every((v) => v !== null))
})

test('wagaZdarzenia i opis warstwy', () => {
  assert.equal(wagaZdarzenia({ zabity: 0, ciezko: 0, lekko: 0 }), 1)
  assert.equal(wagaZdarzenia({ zabity: 2, ciezko: 1, lekko: 3 }), 1 + 20 + 4 + 3)
  const stat = { razem: 100, bezPunktu: 2 }
  assert.match(opisWarstwy('wszystkie', stat), /2 z 100/)
  assert.match(opisWarstwy('niechronieni', stat), /pieszego albo rowerzysty/)
  const wGminach = { ...stat, wGminach: 91388, bezPunktuWGminach: 463 }
  assert.match(opisWarstwy('wszystkie', wGminach), /463 z 91\s388 zdarzeń \(0,5%\)/)
  for (const r of ['wszystkie', 'niechronieni']) {
    assert.ok(!opisWarstwy(r, stat).includes('—'))
    assert.ok(!opisWarstwy(r, wGminach).includes('—'))
  }
})

// ── Gotowe warstwy w public/dane/wskazniki ───────────────────────────────────────────────

const WARSTWY = ['wypadki_heks', 'wypadki_piesi_rowerzysci_heks']
const wczytaj = (id) =>
  JSON.parse(readFileSync(new URL(`../public/dane/wskazniki/${id}.json`, import.meta.url), 'utf8'))

test('dane: warstwy zgodne z adresami, bez braków, z atrybucją ITS i źródłem SEWIK', () => {
  const { wersja, adresy } = wczytajAdresy()
  for (const id of WARSTWY) {
    const p = wczytaj(id)
    assert.equal(
      p.wersjaAdresow,
      wersja,
      `${id}: przelicz po zmianie adresów (node etl/wypadki.mjs)`,
    )
    assert.equal(p.wartosci.length, adresy.length)
    assert.ok(
      p.wartosci.every((v) => Number.isFinite(v) && v >= 0),
      `${id}: tylko liczby ≥ 0`,
    )
    assert.equal(p.meta.id, id)
    assert.equal(p.meta.kategoria, 'bezpieczenstwo')
    assert.equal(p.meta.kierunek, 'mniej-lepiej')
    assert.equal(p.meta.rozdzielczosc, 'heks')
    assert.match(p.meta.rozmiar, /H3 r8/)
    assert.equal(p.meta.zadanie, 69)
    const nazwy = p.meta.zrodla.map((z) => z.nazwa).join(' | ')
    assert.match(nazwy, /System Ewidencji Wypadków i Kolizji/)
    assert.match(nazwy, /Polskie Obserwatorium Bezpieczeństwa Ruchu Drogowego/)
    for (const z of p.meta.zrodla) assert.equal(z.dataDanych, '2018–2024')
  }
})

test('dane: etykieta i wartość heksu się domykają, a piesi i rowerzyści nie przekraczają wszystkich', () => {
  const { adresy } = wczytajAdresy()
  const wszystkie = wczytaj(WARSTWY[0])
  const niechronieni = wczytaj(WARSTWY[1])
  const heksy = new Set()
  adresy.forEach((a, i) => {
    heksy.add(cellToParent(a.h3, RES))
    assert.ok(niechronieni.wartosci[i] <= wszystkie.wartosci[i] + 1e-9, `adres ${i}`)
  })
  for (const p of [wszystkie, niechronieni]) {
    assert.equal(Object.keys(p.slownikEtykiet).length, heksy.size)
    const widziane = new Set()
    adresy.forEach((a, i) => {
      const klucz = p.etykiety[i]
      assert.ok(klucz in p.slownikEtykiet, `adres ${i}: klucz etykiety poza słownikiem`)
      if (widziane.has(klucz)) return
      widziane.add(klucz)
      const t = p.slownikEtykiet[klucz]
      const liczby =
        /^(\d+) zdarz\S+ .*zabici: (\d+), ciężko ranni: (\d+), lekko ranni: (\d+)\)$/.exec(t)
      const bezOfiar =
        /^(\d+) zdarz\S+ .*\(bez (?:ofiar|poszkodowanych pieszych i rowerzystów)\)$/.exec(t)
      const oczekiwana = liczby
        ? Number(liczby[1]) + 10 * Number(liczby[2]) + 4 * Number(liczby[3]) + Number(liczby[4])
        : bezOfiar
          ? Number(bezOfiar[1])
          : 0
      assert.ok(
        liczby || bezOfiar || /^brak zdarzeń/.test(t),
        `adres ${i}: etykieta „${t}” nie pasuje do wzorca`,
      )
      // waga heksu = zdarzenia + 10 · zabici + 4 · ciężko + lekko, wartość = waga / 7 lat (zaokrąglona do 0,01)
      assert.ok(
        Math.abs(p.wartosci[i] * LICZBA_LAT - oczekiwana) <= 0.04 * LICZBA_LAT,
        `adres ${i}: wartość ${p.wartosci[i]} nie zgadza się z etykietą „${t}”`,
      )
    })
    assert.equal(widziane.size, heksy.size)
  }
})
