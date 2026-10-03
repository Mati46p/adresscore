import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  czytelnaNazwa,
  geokodujWiersz,
  indeksAdresow,
  kluczUlicy,
  najblizszy,
  najnowszaData,
  numerBudynku,
  numeryDoSprawdzenia,
  odczytajPunkty,
  odlegloscMetry,
  pobierzHttps,
  punktyCAS,
  rzutPL2000,
  TERYT_KRAKOWA,
} from './lib/uslugi-krakowa.mjs'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import { KONTROLE, policzOdleglosci } from './uslugi-krakowa.mjs'

const IDY = ['sport_odleglosc', 'cas_odleglosc', 'pitnik_odleglosc', 'policja_odleglosc']

test('odległość: stopień szerokości to ok. 111,2 km, stopień długości na 50° N ok. 71,5 km', () => {
  assert.ok(Math.abs(odlegloscMetry(50, 20, 50.01, 20) - 1111.9) < 2)
  assert.ok(Math.abs(odlegloscMetry(50, 20, 50, 20.01) - 715.5) < 2)
  assert.equal(odlegloscMetry(50.06, 19.94, 50.06, 19.94), 0)
})

test('najbliższy punkt: wybiera bliższy, zwraca metry, pusta lista daje null', () => {
  const punkty = [
    { x: 3, y: 4, etykieta: 'blisko' },
    { x: 5000, y: 0, etykieta: 'daleko' },
  ]
  const t = najblizszy(0, 0, punkty)
  assert.equal(t?.punkt.etykieta, 'blisko')
  assert.equal(t?.metry, 5)
  assert.equal(najblizszy(0, 0, []), null)
})

test('rzut PL-2000: odległość euklidesowa zgadza się z geodezyjną (Vincenty, GRS80) w Krakowie', () => {
  // Wartości odniesienia policzone osobno wzorem Vincentego na elipsoidzie GRS80.
  const odleglosc = ([lon1, lat1], [lon2, lat2]) => {
    const [x1, y1] = rzutPL2000(lon1, lat1)
    const [x2, y2] = rzutPL2000(lon2, lat2)
    return Math.hypot(x2 - x1, y2 - y1)
  }
  assert.ok(Math.abs(odleglosc([19.8, 49.99], [19.865, 49.99]) - 4661.2) < 0.5)
  assert.ok(Math.abs(odleglosc([20.0, 50.08], [20.11, 50.08]) - 7873.4) < 0.5)
  assert.ok(Math.abs(odleglosc([19.95, 50.0], [19.95, 50.072]) - 8008.5) < 0.5)
  // Sfera myliłaby się tu o ok. 0,3%, czyli kilkanaście metrów.
  assert.ok(Math.abs(odlegloscMetry(49.99, 19.8, 49.99, 19.865) - 4661.2) > 10)
})

test('policzOdleglosci: tylko Kraków dostaje liczbę (zaokrągloną) i etykietę, reszta null', () => {
  const adresy = [
    { i: 0, teryt: TERYT_KRAKOWA, lat: 50.0601, lon: 19.94 },
    { i: 1, teryt: '1219053', lat: 50.0601, lon: 19.94 },
  ]
  const { wartosci, etykiety } = policzOdleglosci(adresy, [
    { lon: 19.94, lat: 50.06, etykieta: 'Kino Mikro' },
  ])
  assert.ok(Number.isInteger(wartosci[0]) && wartosci[0] > 10 && wartosci[0] < 12)
  assert.equal(etykiety[0], 'Kino Mikro')
  assert.deepEqual([wartosci[1], etykiety[1]], [null, null])
})

test('odczyt ArcGIS: punkt i wielopunkt, pomija brak geometrii i punkty spoza Krakowa', () => {
  const { punkty, pominiete } = odczytajPunkty({
    features: [
      { attributes: { n: 'punkt' }, geometry: { x: 19.94, y: 50.06 } },
      { attributes: { n: 'wielopunkt' }, geometry: { points: [[19.95, 50.07]] } },
      { attributes: { n: 'bez geometrii' } },
      { attributes: { n: 'poza Krakowem' }, geometry: { x: 21.0, y: 52.2 } },
      { attributes: { n: 'zero' }, geometry: { x: 0, y: 0 } },
    ],
  })
  assert.deepEqual(
    punkty.map((p) => p.atr.n),
    ['punkt', 'wielopunkt'],
  )
  assert.equal(pominiete, 3)
})

test('odczyt ArcGIS: błąd w treści i ucięta odpowiedź zatrzymują ETL', () => {
  assert.throws(() => odczytajPunkty({ error: { code: 400 } }), /ArcGIS/)
  assert.throws(() => odczytajPunkty({}), /brak listy/)
  assert.throws(() => odczytajPunkty({ features: [], exceededTransferLimit: true }), /ucięta/)
})

test('awaryjne pobranie bez weryfikacji certyfikatu działa tylko dla hostów miejskich', () => {
  assert.throws(() => pobierzHttps('https://example.com/'), /tylko dla hostów miejskich/)
})

test('najnowsza data z pola w milisekundach', () => {
  assert.equal(
    najnowszaData([{ d: Date.UTC(2021, 0, 1) }, { d: Date.UTC(2024, 6, 8) }, { d: null }], 'd'),
    '2024-07-08',
  )
  assert.equal(najnowszaData([{ d: null }], 'd'), null)
})

test('czytelna nazwa: wielkie litery na zwykłą pisownię, spacje twarde, skracanie', () => {
  assert.equal(czytelnaNazwa('PARK JORDANA'), 'Park Jordana')
  assert.equal(czytelnaNazwa('ZAMEK KRÓLEWSKI NA WAWELU'), 'Zamek Królewski na Wawelu')
  assert.equal(czytelnaNazwa('PARK CZYŻYNY 2'), 'Park Czyżyny 2')
  // Spacja twarda (U+00A0) jak w nazwach CAS z API otwartych danych, zapisana jawnie z kodu.
  const twarda = String.fromCodePoint(0xa0)
  assert.equal(czytelnaNazwa(`CAS Senior w${twarda}Centrum`), 'CAS Senior w Centrum')
  assert.equal(czytelnaNazwa('Kino  Pod   Baranami'), 'Kino Pod Baranami')
  assert.equal(czytelnaNazwa('Teatr KTO'), 'Teatr KTO')
  assert.equal(czytelnaNazwa('PSI WYBIEG UL. BANDTKIEGO'), 'Psi Wybieg ul. Bandtkiego')
  // Rejestr ZIS gubi myślnik: samotny znak zapytania wraca jako półpauza.
  assert.equal(
    czytelnaNazwa('Park Zakrzówek ? akwen z kąpieliskiem'),
    'Park Zakrzówek – akwen z kąpieliskiem',
  )
  const dluga = czytelnaNazwa('a'.repeat(100), 20)
  assert.equal(dluga.length, 20)
  assert.ok(dluga.endsWith('…'))
  // Skracanie na granicy słowa, bez wiszącego słowa uciętego w połowie.
  assert.equal(
    czytelnaNazwa('Obiekty sportowe Osiedlowe Stowarzyszenie Kultury Fizycznej', 40),
    'Obiekty sportowe Osiedlowe…',
  )
})

test('klucz ulicy: skróty, sklejone osiedle, myślnik, ogonki', () => {
  assert.equal(kluczUlicy('OsiedleTysiąclecia '), 'osiedle tysiaclecia')
  assert.equal(kluczUlicy('ul. Długa'), 'dluga')
  assert.equal(kluczUlicy('os. Zgody'), 'osiedle zgody')
  assert.equal(
    kluczUlicy('gen. M. Karaszewicza- Tokarzewskiego'),
    'gen. m. karaszewicza-tokarzewskiego',
  )
  assert.equal(kluczUlicy('Łokietka'), 'lokietka')
})

test('numer budynku wiersza CAS: pole osobne, końcówka adresu, złożony i bez litery', () => {
  const wiersz = (pola) => ({ 'Numer budynku': null, Adres: '', ...pola })
  assert.equal(numerBudynku(wiersz({ 'Numer budynku': '28', Adres: 'Berka Joselewicza 28' })), '28')
  assert.equal(numerBudynku(wiersz({ Adres: 'Rzeźnicza 2a' })), '2a')
  assert.equal(numerBudynku(wiersz({ Adres: 'Kasprowicza 9a/1' })), '9a')
  assert.equal(numerBudynku(wiersz({ Adres: '28 lipca 1943 17a' })), '17a')
  assert.equal(numerBudynku(wiersz({ Adres: 'Osiedle Wolica' })), null)
  assert.deepEqual(
    numeryDoSprawdzenia(wiersz({ 'Numer budynku': '9', Adres: 'Kalwaryjska 9-15' })),
    ['9', '9/15'],
  )
  assert.deepEqual(numeryDoSprawdzenia(wiersz({ Adres: 'Cechowa 144A' })), ['144A', '144'])
  assert.deepEqual(numeryDoSprawdzenia(wiersz({ Adres: 'Osiedle Wolica' })), [])
})

const ADRESY = [
  ['Stefana Batorego', '3', '31-135', 19.94, 50.06],
  ['Stefana Batorego', '5', '31-135', 19.9402, 50.0601],
  ['Berka Joselewicza', '28', '31-031', 19.945, 50.051],
  ['Kalwaryjska', '9/15', '30-504', 19.947, 50.042],
  ['Cechowa', '144', '30-685', 19.98, 50.01],
  ['Osiedle Tysiąclecia', '42', '31-610', 20.002, 50.093],
  ['gen. Michała Karaszewicza-Tokarzewskiego', '29', '31-985', 20.05, 50.07],
  ['Jana Kowalskiego', '7', '30-001', 19.9, 50.0],
  ['Adama Kowalskiego', '7', '30-002', 19.95, 50.02],
  ['Rozrzucona', '1', '30-003', 19.9, 50.0],
  ['Rozrzucona', '1', '30-003', 19.99, 50.0],
  ['Kodowa', '2', '30-004', 19.9, 50.0],
  ['Kodowa', '2', '30-005', 20.0, 50.1],
].map(([ulica, nr, kod, lon, lat]) => ({ ulica, nr, kod, lon, lat, dzielnica: 'I Stare Miasto' }))

const wierszCAS = (pola) => ({
  Nazwa: 'CAS Test',
  Dzielnica: 'I',
  'Numer budynku': null,
  'Kod pocztowy': '',
  Adres: '',
  ...pola,
})

test('geokodowanie CAS: dokładna ulica, skrócona nazwa, numer złożony i zastępczy', () => {
  const indeks = indeksAdresow(ADRESY)
  const g = (pola) => geokodujWiersz(wierszCAS(pola), indeks)

  const dokladna = g({ Ulica: 'Berka Joselewicza ', 'Numer budynku': '28' })
  assert.deepEqual([dokladna.lon, dokladna.lat], [19.945, 50.051])
  assert.equal(dokladna.metoda, 'dokladna ulica')

  const skrocona = g({ Ulica: 'Batorego ', 'Numer budynku': '3', Adres: 'Batorego 3/5' })
  assert.deepEqual([skrocona.lon, skrocona.lat], [19.94, 50.06])
  assert.match(skrocona.metoda, /^skrocona nazwa ulicy \(stefana batorego\)/)

  const zlozony = g({ Ulica: 'Kalwaryjska ', 'Numer budynku': '9', Adres: 'Kalwaryjska 9-15' })
  assert.deepEqual([zlozony.lon, zlozony.lat], [19.947, 50.042])
  assert.match(zlozony.metoda, /numer 9\/15 zamiast 9/)

  const bezLitery = g({ Ulica: 'Cechowa ', Adres: 'Cechowa 144A' })
  assert.deepEqual([bezLitery.lon, bezLitery.lat], [19.98, 50.01])
  assert.match(bezLitery.metoda, /numer 144 zamiast 144A/)

  assert.equal(g({ Ulica: 'OsiedleTysiąclecia ', 'Numer budynku': '42' }).lon, 20.002)
  const myslnik = g({ Ulica: 'gen. M. Karaszewicza- Tokarzewskiego', 'Numer budynku': '29' })
  assert.equal(myslnik.lon, 20.05)
})

test('geokodowanie CAS: niejednoznaczne, rozrzucone i brakujące adresy nie dostają współrzędnych', () => {
  const indeks = indeksAdresow(ADRESY)
  const g = (pola) => geokodujWiersz(wierszCAS(pola), indeks)
  assert.match(
    g({ Ulica: 'Kowalskiego', 'Numer budynku': '7' }).powod,
    /niejednoznaczna ulica \(2\)/,
  )
  assert.match(g({ Ulica: 'Rozrzucona', 'Numer budynku': '1' }).powod, /kilku odległych/)
  assert.match(g({ Ulica: 'Nieistniejąca', 'Numer budynku': '1' }).powod, /brak adresu/)
  assert.match(g({ Ulica: 'Drożyska', Adres: 'Osiedle Wolica' }).powod, /brak numeru/)
  assert.match(g({ Ulica: '', 'Numer budynku': '1' }).powod, /brak ulicy/)
})

test('geokodowanie CAS: kod pocztowy rozstrzyga kilka punktów pod jednym numerem', () => {
  const indeks = indeksAdresow(ADRESY)
  const g = geokodujWiersz(
    wierszCAS({ Ulica: 'Kodowa', 'Numer budynku': '2', 'Kod pocztowy': '30-005 ' }),
    indeks,
  )
  assert.deepEqual([g.lon, g.lat], [20.0, 50.1])
})

test('punkty CAS: powtórzony wiersz tego samego miejsca łączy się w jeden punkt', () => {
  const wiersze = [
    wierszCAS({
      Nazwa: 'CAS Zabłocie',
      Dzielnica: 'XIII',
      Ulica: 'Berka Joselewicza ',
      'Numer budynku': '28',
    }),
    wierszCAS({
      Nazwa: 'CAS Zabłocie',
      Dzielnica: 'II',
      Ulica: 'Berka Joselewicza ',
      'Numer budynku': '28',
    }),
    wierszCAS({ Nazwa: 'CAS Nigdzie', Ulica: 'Nieistniejąca', 'Numer budynku': '1' }),
  ]
  const { punkty, odrzucone } = punktyCAS(wiersze, ADRESY)
  assert.equal(punkty.length, 1)
  assert.equal(punkty[0].etykieta, 'CAS Zabłocie')
  assert.deepEqual(
    odrzucone.map((o) => o.nazwa),
    ['CAS Nigdzie'],
  )
})

test('opublikowane wskaźniki: wersja adresów, null poza Krakowem, liczba i etykieta w Krakowie', () => {
  const { wersja, adresy } = wczytajAdresy()
  for (const id of IDY) {
    const p = JSON.parse(readFileSync(join(DANE, 'wskazniki', `${id}.json`), 'utf8'))
    assert.equal(p.meta.id, id)
    assert.equal(p.wersjaAdresow, wersja, `${id}: przelicz po zmianie adresów`)
    assert.equal(p.wartosci.length, adresy.length)
    assert.equal(p.etykiety.length, adresy.length)
    assert.equal(p.meta.zadanie, 120)
    assert.equal(p.meta.rozdzielczosc, 'adres')
    assert.equal(p.meta.kierunek, 'mniej-lepiej')
    assert.equal(p.meta.jednostka, 'm')
    assert.ok(!p.meta.atrapa)
    assert.ok(p.meta.zrodla.length >= 1)
    for (const z of p.meta.zrodla) {
      assert.match(z.url, /^https:\/\//)
      assert.ok(z.licencja && z.dataDanych && z.pobrano)
    }
    // Typografia PL: w opisach półpauza, nigdy pauza (znak złożony z kodu, żeby plik go nie zawierał).
    assert.ok(!JSON.stringify(p.meta).includes(String.fromCodePoint(0x2014)))
    const wartosci = []
    for (const a of adresy) {
      const v = p.wartosci[a.i]
      const e = p.etykiety[a.i]
      if (a.teryt === TERYT_KRAKOWA) {
        assert.ok(Number.isInteger(v) && v >= 0 && v < 20_000, `${id}: ${a.id} = ${v}`)
        assert.ok(typeof e === 'string' && e.length > 0 && e.length <= 100, `${id}: ${a.id}`)
        wartosci.push(v)
      } else {
        assert.equal(v, null, `${id}: poza Krakowem musi być null`)
        assert.equal(e, null)
      }
    }
    // Zakres skali obejmuje większość miasta (90. percentyl), więc skala nie jest ucięta.
    wartosci.sort((x, y) => x - y)
    const p90 = wartosci[Math.floor(0.9 * wartosci.length)]
    assert.ok(p90 <= p.meta.zakres[1], `${id}: 90. percentyl ${p90} m poza zakresem`)
  }
})

test('opublikowane wskaźniki: adresy, pod którymi stoi obiekt, mają jego odległość i nazwę', () => {
  const { adresy } = wczytajAdresy()
  const krakow = adresy.filter((a) => a.teryt === TERYT_KRAKOWA)
  const pliki = new Map(
    IDY.map((id) => [id, JSON.parse(readFileSync(join(DANE, 'wskazniki', `${id}.json`), 'utf8'))]),
  )
  for (const k of KONTROLE) {
    const a = krakow.find((x) => x.ulica === k.ulica && x.nr === k.nr)
    assert.ok(a, `brak adresu ${k.ulica} ${k.nr}`)
    const p = pliki.get(k.wskaznik)
    assert.ok(p.wartosci[a.i] <= k.maks, `${k.ulica} ${k.nr}: ${p.wartosci[a.i]} m`)
    assert.match(p.etykiety[a.i], k.etykieta)
  }
})
