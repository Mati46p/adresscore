import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { naMetry } from './lib/msip.mjs'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import {
  csv,
  dekodujNid,
  gminaNid,
  indeksPunktowNid,
  indeksyMsip,
  lokalizujNid,
  najnowszaData,
  norm,
  opisWskaznika,
  PROMIEN_M,
  punktyMsip,
  rekordyNid,
  scalMsip,
  TERYT_KRAKOW,
  wartoscAdresu,
  wybierzCsvNid,
} from './zabytki.mjs'

// Pauza (U+2014) jest zakazana w polskich tekstach projektu; zapis przez kod znaku, żeby sam
// plik testu jej nie zawierał.
const PAUZA = String.fromCharCode(0x2014)

// ── Pomocnicze ───────────────────────────────────────────────────────────────────────────────

const CP1250 = { ą: 0xb9, ć: 0xe6, ę: 0xea, ł: 0xb3, ń: 0xf1, ó: 0xf3, ś: 0x9c, ź: 0x9f, ż: 0xbf }
/** Koduje tekst do windows-1250 (tylko znaki użyte w testach), jak plik z dane.gov.pl. */
const wCp1250 = (tekst) =>
  Buffer.from([...tekst].map((z) => (z.charCodeAt(0) < 128 ? z.charCodeAt(0) : CP1250[z])))

const NAGLOWEK_NID =
  '"INSPIRE_ID";"FORMA_OCHRONY";"DOKLADNOSC_POLOZENIA";"NAZWA";"CHRONOLOGIA";"FUNKCJA";"MATERIAL_BUDOWY";"WYKAZ_DOKUMENTOW";"DATA_WPISU";"WOJEWODZTWO";"POWIAT";"GMINA";"MIEJSCOWOSC";"ULICA";"NR_ADRESOWY";"LINK"'
const wierszNid = (id, nazwa, gmina, miejscowosc, ulica, nr, wojewodztwo = 'małopolskie') =>
  `"${id}";"ewidencja zabytków";"dokładny";"${nazwa.replaceAll('"', '""')}";"XIX w.";"";"";"";"1990-01-01";"${wojewodztwo}";"wielicki";"${gmina}";"${miejscowosc}";"${ulica}";"${nr}";"https://zabytek.pl/${id}"`
const rekord = (id, gmina, miejscowosc, ulica, nr, wojewodztwo = 'małopolskie') => ({
  INSPIRE_ID: id,
  NAZWA: `obiekt ${id}`,
  WOJEWODZTWO: wojewodztwo,
  POWIAT: 'wielicki',
  GMINA: gmina,
  MIEJSCOWOSC: miejscowosc,
  ULICA: ulica,
  NR_ADRESOWY: nr,
})
const adres = (id, gmina, miejscowosc, ulica, nr, lon, lat, teryt = '1219053') => ({
  id,
  gmina,
  miejscowosc,
  ulica,
  nr,
  lon,
  lat,
  teryt,
})
const cechaMsip = (adresTxt, lon, lat, uwaga = null) => ({
  type: 'Feature',
  properties: { user_adres: adresTxt, user_nie_istnieje: uwaga },
  geometry: lon === null ? null : { type: 'Point', coordinates: [lon, lat] },
})
const zbiorMsip = (...features) => ({ type: 'FeatureCollection', features })

/** Przesunięcie punktu o metry na północ i wschód (do testów promienia). */
const przesun = (lat, lon, polnocM, wschodM) => [
  lat + polnocM / 111_194.9,
  lon + wschodM / (111_194.9 * Math.cos((lat * Math.PI) / 180)),
]

// ── CSV i rekordy NID ────────────────────────────────────────────────────────────────────────

test('csv: średnik, cudzysłowy z podwojeniem, CRLF i nowa linia w polu', () => {
  const wiersze = csv('"a";"b ""c""";"d;e"\r\n"1";"x\ny";""\r\n')
  assert.deepEqual(wiersze, [
    ['a', 'b "c"', 'd;e'],
    ['1', 'x\ny', ''],
  ])
  assert.deepEqual(csv('a,b\n1,2', ','), [
    ['a', 'b'],
    ['1', '2'],
  ])
  assert.throws(() => csv('"a";"niezamknięty'), /niedomknięty/)
})

test('rekordyNid: plik windows-1250 zachowuje polskie litery, a zły schemat albo kodowanie zatrzymuje eksport', () => {
  const tekst = `${NAGLOWEK_NID}\r\n${wierszNid('PL.1', 'dwór "Pod Lipami"', 'Wieliczka - miasto', 'Wieliczka', 'Rynek Górny', '11')}\r\n`
  const rekordy = rekordyNid(dekodujNid(wCp1250(tekst)))
  assert.equal(rekordy.length, 1)
  assert.equal(rekordy[0].NAZWA, 'dwór "Pod Lipami"')
  assert.equal(rekordy[0].WOJEWODZTWO, 'małopolskie')
  assert.equal(rekordy[0].ULICA, 'Rynek Górny')
  // Ten sam plik odczytany jako UTF-8 daje krzaki, więc nie ma województwa „małopolskie".
  assert.throws(() => rekordyNid(Buffer.from(wCp1250(tekst)).toString('utf8')), /kodowania/)
  assert.throws(() => rekordyNid('"A";"B"\n"1";"2"\n'), /brak kolumn/)
  assert.throws(() => rekordyNid(`${NAGLOWEK_NID}\n"PL.1";"x"\n`), /niespójna liczba kolumn/)
  assert.throws(() => rekordyNid(''), /Pusty/)
})

test('gminaNid i wybierzCsvNid', () => {
  assert.equal(gminaNid('Wieliczka - miasto'), 'Wieliczka')
  assert.equal(gminaNid('Niepołomice - obszar wiejski'), 'Niepołomice')
  assert.equal(gminaNid('Bolesławiec (gm. miejska)'), 'Bolesławiec')
  assert.equal(gminaNid('Zabierzów'), 'Zabierzów')
  assert.equal(gminaNid(undefined), '')

  const zasoby = [
    { attributes: { format: 'html', download_url: '', data_date: '2026-10-01' } },
    { attributes: { format: 'csv', download_url: 'https://x/stary.csv', data_date: '2026-06-30' } },
    { attributes: { format: 'csv', download_url: 'https://x/nowy.csv', data_date: '2026-09-30' } },
  ]
  assert.deepEqual(wybierzCsvNid(zasoby), { url: 'https://x/nowy.csv', dataDanych: '2026-09-30' })
  assert.throws(() => wybierzCsvNid([{ attributes: { format: 'xml' } }]), /nie ma zasobu CSV/)
  assert.throws(
    () => wybierzCsvNid([{ attributes: { format: 'csv', download_url: 'u', data_date: null } }]),
    /daty danych/,
  )
})

test('norm: wielkość liter, diakrytyki, ł i interpunkcja', () => {
  assert.equal(norm('Św. Jana  Kantego'), 'sw jana kantego')
  assert.equal(norm('Łąkowa'), 'lakowa')
  assert.equal(norm('1 Maja'), '1 maja')
  assert.equal(norm(null), '')
})

// ── Lokalizacja NID po adresie ───────────────────────────────────────────────────────────────

test('lokalizujNid: dokładna zgodność adresu, wieś bez ulic, odrzucanie reszty', () => {
  const adresy = [
    adres('p1', 'Wieliczka', 'Wieliczka', 'Rynek Górny', '11', 20.0647, 49.9871),
    adres('p2', 'Zabierzów', 'Rudawa', null, '12', 19.78, 50.1),
    adres('p3', 'Liszki', 'Kaszów', 'Śląska', '105', 19.72, 50.04),
    adres('k1', 'Kraków', 'Kraków', 'Rynek Główny', '1', 19.9373, 50.0617, TERYT_KRAKOW),
    // dwa punkty tego samego adresu blisko siebie: średnia
    adres('d1', 'Skawina', 'Skawina', 'Kolejowa', '3', 19.8, 49.97, '1206113'),
    adres('d2', 'Skawina', 'Skawina', 'Kolejowa', '3', 19.8002, 49.97, '1206113'),
    // dwa punkty tego samego adresu daleko od siebie: niejednoznaczne
    adres('n1', 'Skawina', 'Radziszów', 'Długa', '1', 19.7, 49.95, '1206113'),
    adres('n2', 'Skawina', 'Radziszów', 'Długa', '1', 19.71, 49.95, '1206113'),
  ]
  const rekordy = [
    rekord('R1', 'Wieliczka - miasto', 'Wieliczka', 'rynek górny', '11'), // wielkość liter
    rekord('R2', 'Zabierzów', 'Rudawa', '', '12'), // wieś bez ulic w PRG
    rekord('R3', 'Liszki', 'Kaszów', '', '105'), // PRG ma tam ulice: brak zgodnego adresu
    rekord('R4', 'Wieliczka - miasto', 'Wieliczka', 'Rynek Górny', ''), // bez numeru
    rekord('R5', 'Kraków', 'Kraków', 'Rynek Główny', '1'), // Kraków liczy MSIP
    rekord('R6', 'Wieliczka', 'Wieliczka', 'Rynek Górny', '11', 'mazowieckie'), // inne województwo
    rekord('R7', 'Gdów', 'Gdów', 'Rynek', '1'), // gmina spoza adresy.json
    rekord('R8', 'Skawina - miasto', 'Skawina', 'Kolejowa', '3'),
    rekord('R9', 'Skawina - obszar wiejski', 'Radziszów', 'Długa', '1'),
    rekord('R10', 'Wieliczka', 'Wieliczka', 'Rynek Górny', '99'), // brak numeru w PRG
  ]
  const wynik = lokalizujNid(rekordy, adresy)
  assert.deepEqual(
    wynik.punkty.map((p) => p.id),
    ['R1', 'R2', 'R8'],
  )
  assert.deepEqual([wynik.punkty[0].lon, wynik.punkty[0].lat], [20.0647, 49.9871])
  assert.ok(Math.abs(wynik.punkty[2].lon - 19.8001) < 1e-9, 'średnia dwóch punktów adresu')
  assert.equal(wynik.rekordy, 7, 'rekordy z gmin adresscore spoza Krakowa w Małopolsce')
  assert.equal(wynik.bezNumeru, 1)
  assert.equal(wynik.bezUlicy, 2)
  assert.equal(wynik.niejednoznaczne, 1)
  assert.equal(wynik.bezAdresuPrg, 2)
  assert.equal(wynik.zlokalizowane, 3)
  assert.equal(
    wynik.rekordy,
    wynik.zlokalizowane + wynik.bezNumeru + wynik.bezAdresuPrg + wynik.niejednoznaczne,
    'każdy rekord ma dokładnie jeden los',
  )
})

// ── Wykazy MSIP ──────────────────────────────────────────────────────────────────────────────

test('najnowszaData: najpóźniejsza data z adnotacji, daty bez dnia pomijamy', () => {
  assert.equal(
    najnowszaData([
      'wyłączony z ewidencji 17.05.2017, przywrócony do ewidencji 31.05.2019',
      'budynek ul. Fredry 4b wyłączony z ewidencji 16.06.2026',
      'włączony do ewidencji 2015',
      'włączony do ewidencji 1.10.2019 r.',
      null,
    ]),
    '2026-06-16',
  )
  assert.equal(najnowszaData(['włączony do ewidencji 2015', null]), null)
  assert.equal(najnowszaData(['stodoła wyłączona 7.1.2024']), '2024-01-07')
})

test('punktyMsip: odrzuca tylko „nie istnieje" i rekordy bez geometrii', () => {
  const wynik = punktyMsip(
    zbiorMsip(
      cechaMsip('Rynek Główny 1', 19.9373, 50.0617),
      cechaMsip('Dajwór 4', 19.95, 50.05, 'BUDYNEK NIE ISTNIEJE'),
      cechaMsip('Blich mur nasypu', 19.96, 50.04, 'nie istnieje'),
      cechaMsip('Fredry 4', 19.97, 50.03, 'budynek ul. Fredry 4b wyłączony z ewidencji 16.06.2026'),
      cechaMsip(
        'Dworcowa',
        19.98,
        50.02,
        'budynek gospodarczy wyłączony z ewidencji 17.12.2018 (nie istnieje)',
      ),
      cechaMsip('Wawel', null, null),
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
    ),
    'ewidencja',
  )
  assert.deepEqual(
    wynik.punkty.map((p) => p.adres),
    ['rynek glowny 1', 'fredry 4', 'dworcowa'],
  )
  assert.equal(wynik.nieIstnieje, 2)
  assert.equal(wynik.bezGeometrii, 2)
  assert.equal(wynik.liczbaWszystkich, 7)
  assert.equal(wynik.najnowszaAdnotacja, '2026-06-16')
  assert.ok(wynik.punkty.every((p) => p.rodzaj === 'ewidencja'))
  assert.throws(() => punktyMsip({ type: 'Feature' }, 'rejestr'), /FeatureCollection/)
  assert.throws(
    () =>
      punktyMsip({ ...zbiorMsip(cechaMsip('x', 1, 1)), exceededTransferLimit: true }, 'rejestr'),
    /ucięta/,
  )
})

test('scalMsip: ta sama pozycja w rejestrze i ewidencji liczy się raz', () => {
  const rejestr = punktyMsip(zbiorMsip(cechaMsip('Bosacka dz. 179/21', 19.95, 50.04)), 'rejestr')
  const ewidencja = punktyMsip(
    zbiorMsip(
      cechaMsip('Bosacka dz. 179/21', 19.95, 50.04), // duplikat
      cechaMsip('Bosacka 2', 19.95, 50.04), // ten sam punkt, inny adres: zostaje
      cechaMsip('Bosacka dz. 179/21', 19.96, 50.04), // ten sam adres, inne miejsce: zostaje
    ),
    'ewidencja',
  )
  const scalone = scalMsip(rejestr.punkty, ewidencja.punkty)
  assert.equal(scalone.duplikaty, 1)
  assert.equal(scalone.punkty.length, 3)
  assert.equal(scalone.punkty.filter((p) => p.rodzaj === 'rejestr').length, 1)
})

// ── Promień 300 m ────────────────────────────────────────────────────────────────────────────

test('promień 300 m: granica na północ, wschód i po przekątnej oraz zgodność z liczeniem brutalnym', () => {
  assert.equal(PROMIEN_M, 300)
  const [lat0, lon0] = [50.06, 19.94]
  const krakow = (lat, lon) => ({ teryt: TERYT_KRAKOW, lat, lon })
  const bezNid = indeksPunktowNid([])
  const punkt = (rodzaj, n, e, id) => {
    const [lat, lon] = przesun(lat0, lon0, n, e)
    return { lat, lon, rodzaj, id }
  }
  const granica = [
    [299, 0],
    [301, 0],
    [0, 299],
    [0, 301],
    [-200, -200], // 283 m po przekątnej
    [-220, 220], // 311 m po przekątnej
  ].map(([n, e], i) => punkt('rejestr', n, e, i))
  assert.deepEqual(wartoscAdresu(krakow(lat0, lon0), indeksyMsip(granica), bezNid), {
    wartosc: 3,
    etykieta: '3 w rejestrze, 0 w ewidencji',
  })

  // Deterministyczny „losowy" rozrzut 400 punktów w kwadracie 2 × 2 km (na zmianę rejestr
  // i ewidencja); wynik ma być taki sam jak przy liczeniu brutalnym, bez indeksu, w tych samych
  // metrach EPSG:2178. Haversine na kuli dałby inną wartość przy samej granicy: na tej szerokości
  // kula zaniża odległość w kierunku wschód-zachód o ok. 0,3% (1 m na 300 m).
  let ziarno = 12345
  const los = () => {
    ziarno = (ziarno * 1103515245 + 12345) % 2147483648
    return ziarno / 2147483648
  }
  const rozrzut = Array.from({ length: 400 }, (_, id) =>
    punkt(id % 2 ? 'ewidencja' : 'rejestr', (los() - 0.5) * 2000, (los() - 0.5) * 2000, id),
  )
  const indeks = indeksyMsip(rozrzut)
  for (const [n, e] of [
    [0, 0],
    [400, -300],
    [-800, 700],
    [950, 950],
  ]) {
    const [lat, lon] = przesun(lat0, lon0, n, e)
    const [x, y] = naMetry(lon, lat)
    const wzor = rozrzut.filter((p) => {
      const [px, py] = naMetry(p.lon, p.lat)
      return Math.hypot(x - px, y - py) <= 300
    })
    const rejestr = wzor.filter((p) => p.rodzaj === 'rejestr').length
    assert.deepEqual(
      wartoscAdresu(krakow(lat, lon), indeks, bezNid),
      {
        wartosc: wzor.length,
        etykieta: wzor.length
          ? `${rejestr} w rejestrze, ${wzor.length - rejestr} w ewidencji`
          : null,
      },
      `punkt ${n},${e}`,
    )
  }
})

test('wartoscAdresu: Kraków liczy z podziałem na rejestr i ewidencję, poza Krakowem brak trafienia to null', () => {
  const [lat0, lon0] = [50.06, 19.94]
  const wokol = (rodzaj, n, e) => {
    const [lat, lon] = przesun(lat0, lon0, n, e)
    return { lat, lon, rodzaj }
  }
  const msip = indeksyMsip([
    wokol('rejestr', 10, 0),
    wokol('rejestr', 0, -100),
    wokol('ewidencja', 250, 0),
    wokol('ewidencja', 400, 0),
  ])
  const nid = indeksPunktowNid([wokol('nid', 50, 50)])
  const krakow = { teryt: TERYT_KRAKOW, lat: lat0, lon: lon0 }
  assert.deepEqual(wartoscAdresu(krakow, msip, nid), {
    wartosc: 3,
    etykieta: '2 w rejestrze, 1 w ewidencji',
  })
  // Kraków bez pozycji w wykazach: zmierzone zero, bez etykiety.
  const pustyKrakow = { teryt: TERYT_KRAKOW, lat: 50.1, lon: 19.8 }
  assert.deepEqual(wartoscAdresu(pustyKrakow, msip, nid), { wartosc: 0, etykieta: null })
  // Poza Krakowem liczy tylko NID (MSIP pomijamy), a brak trafienia to null, nigdy 0.
  const wieliczka = { teryt: '1219053', lat: lat0, lon: lon0 }
  assert.deepEqual(wartoscAdresu(wieliczka, msip, nid), {
    wartosc: 1,
    etykieta: 'co najmniej (niepełna ewidencja NID)',
  })
  assert.deepEqual(wartoscAdresu({ ...wieliczka, lat: 50.1, lon: 19.8 }, msip, nid), {
    wartosc: null,
    etykieta: null,
  })
})

test('opis wskaźnika: liczby z danych, zastrzeżenia, bez pauzy', () => {
  const opis = opisWskaznika({
    nidKrakow: 1863,
    msipWszystkich: 6455,
    nidGminy: 1026,
    nidZlokalizowane: 386,
  })
  assert.match(opis, /386 z 1026 w gminach obwarzanka, 38%/)
  assert.match(opis, /1863 pozycji wobec 6455 w MSIP \(29%\)/)
  assert.match(opis, /dolnym oszacowaniem/)
  assert.match(opis, /brak danych, nie zero/)
  assert.match(opis, /nie przesądzają o ochronie konserwatorskiej/)
  assert.match(opis, /Nie wpływa na wynik/)
  assert.ok(!opis.includes(PAUZA))
})

// ── Wygenerowany plik wskaźnika ──────────────────────────────────────────────────────────────

test('plik wskaźnika: Kraków zawsze ma liczbę, poza Krakowem tylko dolne oszacowanie albo null', (t) => {
  const sciezka = join(DANE, 'wskazniki', 'zabytki_300m.json')
  if (!existsSync(sciezka)) return t.skip('brak wygenerowanego pliku (node etl/zabytki.mjs)')
  const plik = JSON.parse(readFileSync(sciezka, 'utf8'))
  const { wersja, adresy } = wczytajAdresy()
  assert.equal(plik.wersjaAdresow, wersja)
  assert.equal(plik.wartosci.length, adresy.length)
  assert.equal(plik.etykiety.length, adresy.length)
  assert.equal(plik.meta.kategoria, 'kontekst')
  assert.equal(plik.meta.kierunek, 'neutralny')
  assert.equal(plik.meta.rozdzielczosc, 'adres')
  assert.equal(plik.meta.zadanie, 125)
  assert.ok(!JSON.stringify(plik.meta).includes(PAUZA))
  assert.ok(plik.meta.zrodla.every((z) => z.url && z.licencja && z.dataDanych && z.pobrano))
  assert.ok(
    plik.meta.zrodla.some((z) => z.licencja === 'CC BY 4.0' && /NID|Narodowy/.test(z.nazwa)),
  )
  assert.ok(
    plik.meta.zrodla
      .filter((z) => /MSIP/.test(z.nazwa))
      .every((z) =>
        z.nazwa.startsWith(
          'Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl)',
        ),
      ),
  )

  const wRejestrze = /^(\d+) w rejestrze, (\d+) w ewidencji$/
  let krakowZero = 0
  let krakowN = 0
  let pozaZWartoscia = 0
  for (let i = 0; i < adresy.length; i++) {
    const w = plik.wartosci[i]
    const e = plik.etykiety[i]
    if (adresy[i].teryt === TERYT_KRAKOW) {
      assert.ok(Number.isInteger(w) && w >= 0, `Kraków ma liczbę: ${adresy[i].id}`)
      krakowN++
      if (w === 0) {
        krakowZero++
        assert.equal(e, null)
      } else {
        const m = wRejestrze.exec(e)
        assert.ok(m, `etykieta Krakowa: ${e}`)
        assert.equal(Number(m[1]) + Number(m[2]), w)
      }
    } else if (w === null) assert.equal(e, null)
    else {
      pozaZWartoscia++
      assert.ok(Number.isInteger(w) && w >= 1, 'poza Krakowem nigdy 0')
      assert.equal(e, 'co najmniej (niepełna ewidencja NID)')
    }
  }
  assert.ok(
    krakowZero > 0.2 * krakowN && krakowZero < 0.6 * krakowN,
    `zer w Krakowie: ${krakowZero}`,
  )
  assert.ok(pozaZWartoscia > 5_000 && pozaZWartoscia < 40_000, `poza Krakowem: ${pozaZWartoscia}`)

  // Znane miejsca: Stare Miasto i Kazimierz gęsto, a rejestr dominuje wokół Rynku.
  const wartosciUlicy = (ulica) =>
    adresy.flatMap((a, i) => (a.gmina === 'Kraków' && a.ulica === ulica ? [i] : []))
  for (const ulica of ['Rynek Główny', 'Floriańska', 'Szeroka']) {
    const idx = wartosciUlicy(ulica)
    assert.ok(idx.length > 0, ulica)
    for (const i of idx) assert.ok(plik.wartosci[i] >= 100, `${ulica}: ${plik.wartosci[i]}`)
  }
  for (const i of wartosciUlicy('Rynek Główny')) {
    const m = wRejestrze.exec(plik.etykiety[i])
    assert.ok(Number(m[1]) > Number(m[2]), 'wokół Rynku więcej pozycji z rejestru niż z ewidencji')
  }
})
