// Uruchom: node --test etl/czyste-powietrze.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  dataPl,
  etykieta,
  ID,
  jakWRaporcie,
  KOLUMNY,
  LICENCJA,
  liczba,
  liczbyWiersza,
  naSto,
  odczytajRanking,
  odczytajRaport,
  odczytajWierszGminy,
  odczytajWierszRankingu,
  odmiana,
  okresRankingu,
  PLIK_DANYCH,
  podzielLiczby,
  sprawdzMigawke,
  sprawdzNaglowek,
  stanRaportu,
  wczytajMigawke,
  zbudujMeta,
  zbudujWskaznik,
} from './czyste-powietrze.mjs'
import { DANE, KORZEN, wczytajAdresy } from './lib/wspolne.mjs'

const PLIK_WSKAZNIKA = join(DANE, 'wskazniki', `${ID}.json`)
const wczytaj = (sciezka) => JSON.parse(readFileSync(sciezka, 'utf8'))
const nazwyGmin = (adresy) => new Map(adresy.map((a) => [a.teryt, a.gmina]))

// Nagłówek pierwszej strony raportu dosłownie z `pdftotext -raw` (linie tak, jak je zwraca narzędzie).
const NAGLOWEK = [
  'Dane wg stanu na 12.12.2025 r.',
  'WFOŚiGW',
  'powiat',
  'gmina',
  'Liczba wniosków o',
  'dofinansowanie',
  'ogółem',
  'Podłączenie do sieci',
  'ciepłowniczej',
  'Pompa ciepła powietrze/woda',
  'Pompa ciepła powietrze/woda',
  'o podwyższonej klasie',
  'efektywności energetycznej',
  'Pompa ciepła',
  'powietrze/powietrze (o klasie',
  'efektywności min. A+)',
  'Pompa ciepła powietrze/',
  'powietrze (o klasie',
  'efektywności energetycznej',
  'min. A++)',
  'Gruntowa pompa ciepła o',
  'podwyższonej klasie',
  'efektywności energetycznej',
  'Kocioł zgazowujący drewno o',
  'podwyższonym standardzie',
  'Kocioł na pellet drzewny o',
  'podwyższonym standardzie',
  'Ogrzewanie elektryczne',
  'Liczba wniosków obejmujących',
  'termomodernizację budynku',
  'Liczba wniosków obejmujących wymianę źródła ciepła na:',
]

// Miniaturowy raport o tym samym układzie co prawdziwy: dwa fundusze, trzy powiaty, wiersze
// z separatorem tysięcy (powiat „Alfa” ma 1 004 wnioski, „Łącznie” 1 025), dwie strony.
const MINI = [
  ...NAGLOWEK,
  'WFOŚiGW w Testowie 1 010 2 0 0 0 0 0 0 0 0 1 005',
  'Alfa 1 004 2 0 0 0 0 0 0 0 0 1 002',
  'Jeden | gmina miejska 600 2 0 0 0 0 0 0 0 0 598',
  'Dwa | gmina wiejska 404 0 0 0 0 0 0 0 0 0 404',
  'Beta 6 0 0 0 0 0 0 0 0 0 3',
  'Trzy | gmina miejsko-wiejska 6 0 0 0 0 0 0 0 0 0 3',
  '1',
  '\f',
  ...NAGLOWEK,
  'WFOŚiGW we Wrocławiu 15 0 1 0 0 0 0 0 5 0 9',
  'Wrocław 15 0 1 0 0 0 0 0 5 0 9',
  'Wrocław | gmina miejska 15 0 1 0 0 0 0 0 5 0 9',
  'Łącznie 1 025 2 1 0 0 0 0 0 5 0 1 014',
  '2',
  '\f',
].join('\n')
const BEZ_LICZENIA = null

test('kolumny raportu: 11 unikalnych kluczy, pierwszy to wnioski ogółem', () => {
  assert.equal(KOLUMNY.length, 11)
  assert.equal(new Set(KOLUMNY.map(([k]) => k)).size, 11)
  assert.equal(KOLUMNY[0][0], 'wnioski')
  assert.equal(KOLUMNY.at(-1)[0], 'termo')
})

test('wiersz gminy z raportu: nazwa, rodzaj i jedenaście liczb, także z łącznikiem w nazwie', () => {
  const g = odczytajWierszGminy('Augustów | gmina wiejska 42 2 0 3 0 0 1 4 26 0 19')
  assert.equal(g.nazwa, 'Augustów')
  assert.equal(g.rodzaj, 'gmina wiejska')
  assert.deepEqual(Object.values(g.wartosci), [42, 2, 0, 3, 0, 0, 1, 4, 26, 0, 19])
  assert.deepEqual(
    Object.keys(g.wartosci),
    KOLUMNY.map(([k]) => k),
  )
  const k = odczytajWierszGminy('Kocmyrzów-Luborzyca | gmina wiejska 31 0 0 2 0 0 0 1 7 0 26')
  assert.equal(k.nazwa, 'Kocmyrzów-Luborzyca')
  assert.equal(k.wartosci.wnioski, 31)
  assert.equal(k.wartosci.kociolPellet, 7)
  assert.equal(k.wartosci.termo, 26)
  const m = odczytajWierszGminy('Skawina | gmina miejsko-wiejska 59 0 0 1 0 0 0 2 11 0 52')
  assert.equal(m.rodzaj, 'gmina miejsko-wiejska')
})

test('wiersz gminy: inna liczba kolumn, separator tysięcy albo obcy format to błąd, nie zgadywanie', () => {
  assert.throws(
    () => odczytajWierszGminy('Skawina | gmina miejsko-wiejska 59 0 0 1'),
    /liczbę kolumn/,
  )
  assert.throws(
    () => odczytajWierszGminy('Duże | gmina miejska 1 059 0 0 1 0 0 0 2 11 0 52'),
    /liczbę kolumn/,
  )
  assert.throws(
    () => odczytajWierszGminy('Skawina 59 0 0 1 0 0 0 2 11 0 52'),
    /nie jest wiersz gminy/,
  )
  assert.equal(liczbyWiersza('1 2 3'), null)
  assert.equal(liczbyWiersza('1 2 3 4 5 6 7 8 9 10 1000'), null)
})

test('liczby: separator tysięcy raportu i etykiety, odmiana, data, wartość na 100 domów', () => {
  assert.equal(jakWRaporcie(1484), '1 484')
  assert.equal(jakWRaporcie(46521), '46 521')
  assert.equal(jakWRaporcie(999), '999')
  assert.equal(liczba(8531), '8531')
  assert.equal(liczba(17021), '17 021')
  assert.equal(liczba(1234567), '1 234 567')
  const slowa = (n) => odmiana(n, 'wniosek', 'wnioski', 'wniosków')
  assert.deepEqual([0, 1, 2, 4, 5, 12, 14, 21, 22, 32, 100, 112, 139].map(slowa), [
    'wniosków',
    'wniosek',
    'wnioski',
    'wnioski',
    'wniosków',
    'wniosków',
    'wniosków',
    'wniosków',
    'wnioski',
    'wnioski',
    'wniosków',
    'wniosków',
    'wniosków',
  ])
  assert.equal(dataPl('2025-12-12'), '12.12.2025')
  assert.throws(() => dataPl('12.12.2025'), /RRRR-MM-DD/)
  assert.equal(naSto(59, 8531), 0.69)
  assert.equal(naSto(139, 41172), 0.34)
  assert.equal(naSto(0, 100), 0)
})

test('wartość na 100 domów: brak licznika albo mianownika to null, zmierzone zero zostaje zerem', () => {
  assert.equal(naSto(undefined, 100), null)
  assert.equal(naSto(5, undefined), null)
  assert.equal(naSto(5, 0), null)
  assert.equal(naSto(5, -1), null)
  assert.equal(naSto(-1, 100), null)
  assert.equal(naSto(Number.NaN, 100), null)
  assert.equal(naSto(0, 2514), 0)
})

test('nagłówek raportu: kolejność kolumn z PDF przechodzi, zamiana albo brak kolumny zatrzymuje', () => {
  sprawdzNaglowek(NAGLOWEK.join('\n'))
  const zamiana = [...NAGLOWEK]
  const i = zamiana.indexOf('Ogrzewanie elektryczne')
  zamiana[i] = 'Kocioł na pellet drzewny o'
  zamiana[i - 2] = 'Ogrzewanie elektryczne'
  assert.throws(() => sprawdzNaglowek(zamiana.join('\n')), /nagłówka/)
  const bez = NAGLOWEK.filter((l) => l !== 'Ogrzewanie elektryczne')
  assert.throws(() => sprawdzNaglowek(bez.join('\n')), /Ogrzewanie elektryczne/)
})

test('stan raportu: jedna data z nagłówków stron, dwie różne albo brak to błąd', () => {
  assert.equal(stanRaportu(MINI), '2025-12-12')
  assert.throws(
    () => stanRaportu('Dane wg stanu na 12.12.2025 r.\nDane wg stanu na 15.12.2025 r.'),
    /jednej daty/,
  )
  assert.throws(() => stanRaportu('bez daty'), /jednej daty/)
})

test('raport: drzewo fundusz → powiat → gmina z numerem strony, sumy zgodne także przy tysiącach', () => {
  const r = odczytajRaport(MINI, BEZ_LICZENIA)
  assert.equal(r.stan, '2025-12-12')
  assert.deepEqual(r.kontrola, { fundusze: 2, powiaty: 3, gminy: 4 })
  assert.deepEqual(
    r.fundusze.map((f) => f.nazwa),
    ['WFOŚiGW w Testowie', 'WFOŚiGW we Wrocławiu'],
  )
  const [alfa, beta] = r.fundusze[0].powiaty
  assert.equal(alfa.nazwa, 'Alfa')
  assert.equal(alfa.liczby, '1 004 2 0 0 0 0 0 0 0 0 1 002')
  assert.equal(alfa.wartosci.wnioski, 1004)
  assert.deepEqual(
    alfa.gminy.map((g) => [g.nazwa, g.rodzaj, g.strona]),
    [
      ['Jeden', 'gmina miejska', 1],
      ['Dwa', 'gmina wiejska', 1],
    ],
  )
  assert.equal(beta.gminy[0].rodzaj, 'gmina miejsko-wiejska')
  assert.equal(r.fundusze[1].strona, 2)
  assert.equal(r.fundusze[0].wartosci.wnioski, 1010)
  assert.equal(r.lacznie.liczby, '1 025 2 1 0 0 0 0 0 5 0 1 014')
})

test('raport: pomylona liczba w gminie, zgubiony wiersz albo zły „Łącznie” zatrzymują odczyt', () => {
  const zmien = (stare, nowe) => MINI.replace(stare, nowe)
  assert.throws(
    () => odczytajRaport(zmien('Dwa | gmina wiejska 404', 'Dwa | gmina wiejska 405'), BEZ_LICZENIA),
    /gminy powiatu Alfa/,
  )
  assert.throws(
    () =>
      odczytajRaport(zmien('Dwa | gmina wiejska 404 0 0 0 0 0 0 0 0 0 404\n', ''), BEZ_LICZENIA),
    /gminy powiatu Alfa/,
  )
  assert.throws(
    () => odczytajRaport(zmien('Łącznie 1 025', 'Łącznie 1 026'), BEZ_LICZENIA),
    /„Łącznie”/,
  )
  assert.throws(
    () =>
      odczytajRaport(zmien('WFOŚiGW w Testowie 1 010', 'WFOŚiGW w Testowie 1 011'), BEZ_LICZENIA),
    /powiaty WFOŚiGW w Testowie/,
  )
  assert.throws(
    () => odczytajRaport(zmien('Łącznie 1 025 2 1 0 0 0 0 0 5 0 1 014\n', ''), BEZ_LICZENIA),
    /brak wiersza „Łącznie”/,
  )
  // prawdziwy raport ma 16 funduszy, 380 powiatów i 2477 gmin
  assert.throws(() => odczytajRaport(MINI), /oczekiwano 16, 380, 2477/)
})

test('ranking: liczby z separatorem tysięcy dzielimy tak, żeby zgadzał się wskaźnik z wiersza', () => {
  assert.deepEqual(podzielLiczby('2 137 265', 12.4), [{ budynki: 2137, wnioski: 265 }])
  assert.deepEqual(podzielLiczby('41 172 1 019', 2.47), [{ budynki: 41172, wnioski: 1019 }])
  assert.deepEqual(podzielLiczby('17 021 620', 3.64), [{ budynki: 17021, wnioski: 620 }])
  assert.deepEqual(podzielLiczby('775 75', 9.68), [{ budynki: 775, wnioski: 75 }])
  // wskaźnik niezgodny z żadnym podziałem: brak wyniku, nie zgadywanie
  assert.deepEqual(podzielLiczby('2 137 265', 12.41), [])
  assert.deepEqual(podzielLiczby('2 137 265', 99), [])
})

test('ranking: wiersze obszaru z PDF (kod, nazwa, rodzaj, powiat, budynki, wnioski, wskaźnik)', () => {
  const w = odczytajWierszRankingu(
    '22. małopolskie 1206022 Igołomia-Wawrzeńczyce (2) wiejska krakowski 2 137 265 12,40%',
  )
  assert.deepEqual(w, {
    lp: 22,
    wojewodztwo: 'małopolskie',
    teryt: '1206022',
    nazwa: 'Igołomia-Wawrzeńczyce',
    rodzaj: 'gmina wiejska',
    powiat: 'krakowski',
    budynki: 2137,
    wnioski: 265,
    wskaznik: 12.4,
  })
  const k = odczytajWierszRankingu(
    '2052. małopolskie 1261011 Kraków (1) miejska Kraków 41 172 1 019 2,47%',
  )
  assert.equal(k.powiat, 'Kraków')
  assert.equal(k.budynki, 41172)
  assert.equal(k.wnioski, 1019)
  const nawias = odczytajWierszRankingu(
    '2160. zachodniopomorskie 3211012 Dobra (Szczecińska) (2) wiejska policki 6 838 62 0,91%',
  )
  assert.equal(nawias.nazwa, 'Dobra (Szczecińska)')
  assert.equal(nawias.powiat, 'policki')
  // 22 gminy miejsko-wiejskie mają w PDF przy nazwie „(2)”: rodzaj liczy się ze słowa i kodu TERYT
  const m = odczytajWierszRankingu(
    '47. świętokrzyskie 2604083 Łopuszno (2) miejsko-wiejska kielecki 2 356 268 11,38%',
  )
  assert.equal(m.rodzaj, 'gmina miejsko-wiejska')
})

test('ranking: literówki, zły wskaźnik i rodzaj niezgodny z TERYT to błąd', () => {
  assert.throws(
    () =>
      odczytajWierszRankingu(
        '122. kujawsko-pomorskie 040822 Bobrowniki (2) wiejska lipnowski 775 75 9,68%',
      ),
    /nie jest wiersz rankingu/,
  )
  assert.throws(
    () =>
      odczytajWierszRankingu('1485. lubelskie 0609022 Borzechów wiejska lubelski 1 101 49 4,45%'),
    /nie jest wiersz rankingu/,
  )
  assert.throws(
    () =>
      odczytajWierszRankingu(
        '22. małopolskie 1206022 Igołomia-Wawrzeńczyce (2) wiejska krakowski 2 137 265 12,41%',
      ),
    /0 sposobów/,
  )
  assert.throws(
    () =>
      odczytajWierszRankingu(
        '22. małopolskie 1206023 Igołomia-Wawrzeńczyce (2) wiejska krakowski 2 137 265 12,40%',
      ),
    /rodzaj gminy niezgodny/,
  )
})

test('ranking: odczyt wielu wierszy pomija literówki i pilnuje kolejności oraz unikalności kodów', () => {
  const ok = [
    'Lp. Nazwa województwa Kod gminy Nazwa gminy Rodzaj gminy Nazwa powiatu',
    '1. podkarpackie 1814022 Adamówka (2) wiejska przeworski 1 022 165 16,14%',
    '2. kujawsko-pomorskie 040822 Bobrowniki (2) wiejska lipnowski 775 75 9,68%',
    '3. małopolskie 1214012 Koniusza (2) wiejska proszowicki 2 514 365 14,52%',
    '4. małopolskie 1261011 Kraków (1) miejska Kraków 41 172 1 019 2,47%',
  ]
  const r = odczytajRanking(ok.join('\n'))
  assert.deepEqual([...r.wiersze.keys()], ['1814022', '1214012', '1261011'])
  assert.equal(r.pominiete.length, 1)
  assert.match(r.pominiete[0], /Bobrowniki/)
  assert.equal(r.wiersze.get('1214012').strona, 1)
  const strony = odczytajRanking(`${ok[1]}\n\f${ok[4]}`)
  assert.equal(strony.wiersze.get('1261011').strona, 2)
  assert.throws(() => odczytajRanking([ok[4], ok[1]].join('\n')), /kolejność/)
  assert.throws(
    () =>
      odczytajRanking(
        [
          ok[1],
          '2. małopolskie 1214012 Koniusza (2) wiejska proszowicki 2 514 365 14,52%',
          '3. małopolskie 1214012 Koniusza (2) wiejska proszowicki 2 514 365 14,52%',
        ].join('\n'),
      ),
    /powtórzony kod/,
  )
})

test('ranking: okres i stan z nagłówka PDF', () => {
  const naglowek = [
    'Lp. Nazwa województwa Kod gminy Nazwa gminy Rodzaj gminy Nazwa powiatu',
    'Liczba złożonych',
    'wniosków o',
    'dofinansowanie z',
    'terenu gminy za',
    'okres 01.04.2022 -',
    '31.12.2023',
    'Zestawienie gmin, które na dzień 31.12.2023 r. miały zawarte obowiązujące porozumienie',
  ].join('\n')
  assert.deepEqual(okresRankingu(naglowek), {
    od: '2022-04-01',
    do: '2023-12-31',
    stan: '2023-12-31',
  })
  assert.throws(() => okresRankingu('bez okresu'), /brak okresu/)
})

test('migawka: 14 gmin obszaru, 4 powiaty z wszystkimi gminami, każda gmina z jednym wierszem raportu', () => {
  const migawka = wczytajMigawke()
  const { adresy } = wczytajAdresy()
  const dane = sprawdzMigawke(migawka, nazwyGmin(adresy))
  assert.equal(dane.size, 14)
  assert.deepEqual([...dane.keys()].sort(), [...new Set(adresy.map((a) => a.teryt))].sort())
  assert.deepEqual(migawka.powiaty.map((p) => p.nazwa).sort(), [
    'Kraków',
    'krakowski',
    'proszowicki',
    'wielicki',
  ])
  // gminy powiatów: krakowski 17, wielicki 5, proszowicki 6, Kraków 1
  assert.deepEqual(Object.fromEntries(migawka.powiaty.map((p) => [p.nazwa, p.gminy.length])), {
    krakowski: 17,
    wielicki: 5,
    proszowicki: 6,
    Kraków: 1,
  })
  for (const p of migawka.powiaty) {
    assert.ok(Number.isInteger(p.strona) && p.strona > 0, p.nazwa)
    for (const g of p.gminy) assert.ok(Number.isInteger(g.strona) && g.strona > 0, g.wiersz)
  }
  for (const g of migawka.gminy) assert.ok(Number.isInteger(g.ranking.strona), g.gmina)
  assert.equal(migawka.raport.stan, '2025-12-12')
  assert.equal(migawka.ranking.stan, '2023-12-31')
  assert.equal(migawka.raport.kontrola.gminy, 2477)
  assert.equal(migawka.raport.lacznie, '46 521 63 52 6 372 18 100 565 3 892 21 496 104 31 933')
  assert.match(migawka.raport.sha256, /^[0-9a-f]{64}$/)
  assert.match(migawka.ranking.sha256, /^[0-9a-f]{64}$/)
})

test('migawka: liczby wybranych gmin z raportu i rankingu, wskaźnik 2022–2023 zgodny z podziałem', () => {
  const { adresy } = wczytajAdresy()
  const dane = sprawdzMigawke(wczytajMigawke(), nazwyGmin(adresy))
  // [TERYT, wnioski 2025, budynki jednorodzinne]
  const oczekiwane = [
    ['1206022', 32, 2137],
    ['1206052', 31, 5318],
    ['1206072', 29, 5651],
    ['1206082', 15, 3983],
    ['1206092', 17, 4801],
    ['1206113', 59, 8531],
    ['1206143', 14, 3173],
    ['1206152', 18, 4930],
    ['1206162', 37, 8842],
    ['1206172', 39, 8042],
    ['1214012', 26, 2514],
    ['1219043', 39, 8866],
    ['1219053', 47, 17021],
    ['1261011', 139, 41172],
  ]
  for (const [teryt, wnioski, budynki] of oczekiwane) {
    const g = dane.get(teryt)
    assert.equal(g.wnioski, wnioski, `${g.gmina}: wnioski`)
    assert.equal(g.budynki, budynki, `${g.gmina}: budynki`)
    assert.equal(g.wskaznik2022, naSto(g.wnioski2022, g.budynki), `${g.gmina}: wskaźnik rankingu`)
    // 2477 z 2477 gmin w raporcie: suma rodzajów źródeł ciepła nie przekracza liczby wniosków
    const zrodla = Object.entries(g.kolumny)
      .filter(([k]) => k !== 'wnioski' && k !== 'termo')
      .reduce((s, [, n]) => s + n, 0)
    assert.ok(zrodla <= g.wnioski, `${g.gmina}: źródła ciepła ${zrodla} > wnioski ${g.wnioski}`)
    assert.ok(g.kolumny.termo <= g.wnioski, `${g.gmina}: termomodernizacja`)
  }
  // powiaty z raportu: gmina w powiecie grodzkim i ziemskim, rodzaj zgodny z TERYT
  assert.equal(dane.get('1261011').powiat, 'Kraków')
  assert.equal(dane.get('1261011').rodzaj, 'gmina miejska')
  assert.equal(dane.get('1206113').powiat, 'krakowski')
  assert.equal(dane.get('1206113').rodzaj, 'gmina miejsko-wiejska')
  assert.equal(dane.get('1214012').powiat, 'proszowicki')
  assert.equal(dane.get('1219053').powiat, 'wielicki')
})

test('migawka: błąd w wierszu gminy, brak gminy, zła nazwa albo powtórzony TERYT zatrzymują odczyt', () => {
  const { adresy } = wczytajAdresy()
  const nazwy = nazwyGmin(adresy)
  const zepsuj = (zmien) => {
    const m = structuredClone(wczytajMigawke())
    zmien(m)
    return () => sprawdzMigawke(m, nazwy)
  }
  const wPowiecie = (m, powiat) => m.powiaty.find((p) => p.nazwa === powiat)
  // suma gmin powiatu nie zgadza się z jego wierszem
  assert.throws(
    zepsuj((m) => {
      const g = wPowiecie(m, 'krakowski').gminy[0]
      g.wiersz = g.wiersz.replace(' 62 ', ' 63 ')
    }),
    /gminy dają/,
  )
  // usunięta gmina obszaru
  assert.throws(
    zepsuj((m) => {
      const p = wPowiecie(m, 'krakowski')
      p.gminy = p.gminy.filter((g) => !g.wiersz.startsWith('Skawina'))
    }),
    /0 wierszy dla powiatu krakowski/,
  )
  // wiersz rankingu innej gminy pod tym samym TERYT
  assert.throws(
    zepsuj((m) => {
      m.gminy[0].ranking = structuredClone(m.gminy[1].ranking)
    }),
    /wiersz rankingu opisuje/,
  )
  assert.throws(
    zepsuj((m) => {
      m.gminy[0].gmina = 'Inna'
    }),
    /w adresach/,
  )
  assert.throws(
    zepsuj((m) => {
      m.gminy[1].teryt = m.gminy[0].teryt
    }),
    /powtórzony TERYT/,
  )
  assert.throws(
    zepsuj((m) => {
      m.gminy.pop()
    }),
    /brak w migawce/,
  )
  // wiersz rankingu z literówką we wskaźniku
  assert.throws(
    zepsuj((m) => {
      m.gminy[2].ranking.wiersz = m.gminy[2].ranking.wiersz.replace(/\d+,\d{2}%$/, '9,99%')
    }),
    /0 sposobów/,
  )
})

test('etykieta: liczby gminy, źródła ciepła od największego, odmiana „wniosek” i brak źródeł', () => {
  const kolumny = (nadpisz) => ({
    wnioski: 59,
    siec: 0,
    pcPowWoda: 0,
    pcPowWodaPodw: 1,
    pcPowPowA1: 0,
    pcPowPowA2: 0,
    pcGrunt: 0,
    kociolDrewno: 2,
    kociolPellet: 11,
    elektryczne: 0,
    termo: 52,
    ...nadpisz,
  })
  const skawina = { gmina: 'Skawina', wnioski: 59, budynki: 8531, kolumny: kolumny({}) }
  assert.equal(
    etykieta(skawina, '2025-12-12'),
    'Skawina: 59 wniosków o dofinansowanie z programu Czyste Powietrze (od 31.03.2025 do 12.12.2025) na 8531 budynków jednorodzinnych w gminie, czyli 0,69 na 100 domów. Wymiana źródła ciepła we wnioskach: kocioł na pellet 11, kocioł na drewno 2, pompa ciepła 1. Termomodernizacja we wnioskach: 52. Wynik całej gminy, nie okolicy adresu.',
  )
  const pompy = {
    gmina: 'Pompowo',
    wnioski: 22,
    budynki: 12000,
    kolumny: kolumny({
      wnioski: 22,
      pcPowWoda: 3,
      pcPowWodaPodw: 4,
      pcPowPowA2: 1,
      pcGrunt: 2,
      kociolPellet: 0,
      kociolDrewno: 0,
    }),
  }
  const e = etykieta(pompy, '2025-12-12')
  assert.match(e, /^Pompowo: 22 wnioski o dofinansowanie/)
  assert.match(e, /na 12 000 budynków/)
  assert.match(e, /czyli 0,18 na 100 domów/)
  assert.match(e, /źródła ciepła we wnioskach: pompa ciepła 10\./)
  const jeden = {
    gmina: 'Jedna',
    wnioski: 1,
    budynki: 400,
    kolumny: kolumny({ wnioski: 1, pcPowWodaPodw: 0, kociolDrewno: 0, kociolPellet: 0, termo: 0 }),
  }
  const j = etykieta(jeden, '2025-12-12')
  assert.match(j, /^Jedna: 1 wniosek o dofinansowanie/)
  assert.match(j, /brak wniosków z wymianą źródła ciepła\. Termomodernizacja we wnioskach: 0\./)
})

test('wskaźnik: adres gminy bez danych dostaje null i brak etykiety, reszta wartość i klucz słownika', () => {
  const adresy = [
    { teryt: '1000001' },
    { teryt: '1000002' },
    { teryt: '1000003' },
    { teryt: '1000004' },
    { teryt: '1000001' },
  ]
  const kol = {
    wnioski: 10,
    siec: 0,
    pcPowWoda: 0,
    pcPowWodaPodw: 0,
    pcPowPowA1: 0,
    pcPowPowA2: 0,
    pcGrunt: 0,
    kociolDrewno: 0,
    kociolPellet: 2,
    elektryczne: 0,
    termo: 4,
  }
  const dane = new Map([
    ['1000001', { gmina: 'Jeden', wnioski: 10, budynki: 500, kolumny: kol }],
    // brak mianownika: null, nie 0 i nie dzielenie przez zero
    ['1000003', { gmina: 'Trzy', wnioski: 10, budynki: 0, kolumny: kol }],
    [
      '1000004',
      {
        gmina: 'Cztery',
        wnioski: 0,
        budynki: 400,
        kolumny: { ...kol, wnioski: 0, kociolPellet: 0, termo: 0 },
      },
    ],
  ])
  const w = zbudujWskaznik(adresy, dane, '2025-12-12')
  // 1000002 nie ma wiersza, 1000003 nie ma mianownika, 1000004 ma zmierzone zero
  assert.deepEqual(w.wartosci, [2, null, null, 0, 2])
  assert.deepEqual(w.etykiety, ['0', null, null, '1', '0'])
  assert.deepEqual(Object.keys(w.slownikEtykiet), ['0', '1'])
  assert.match(w.slownikEtykiet[0], /^Jeden: 10 wniosków/)
  assert.match(w.slownikEtykiet[1], /^Cztery: 0 wniosków/)
})

test('opublikowany wskaźnik: te same liczby, etykiety i słownik co z migawki wejścia', () => {
  const p = wczytaj(PLIK_WSKAZNIKA)
  const { wersja, adresy } = wczytajAdresy()
  const migawka = wczytajMigawke()
  const dane = sprawdzMigawke(migawka, nazwyGmin(adresy))
  const w = zbudujWskaznik(adresy, dane, migawka.raport.stan)
  assert.equal(p.wersjaAdresow, wersja)
  assert.equal(p.wartosci.length, adresy.length)
  assert.deepEqual(p.wartosci, w.wartosci)
  assert.deepEqual(p.etykiety, w.etykiety)
  assert.deepEqual(p.slownikEtykiet, w.slownikEtykiet)
})

test('opublikowany wskaźnik: wartość stała w gminie, 14 gmin bez luk, etykieta zgodna z liczbą', () => {
  const p = wczytaj(PLIK_WSKAZNIKA)
  const { adresy } = wczytajAdresy()
  const dane = sprawdzMigawke(wczytajMigawke(), nazwyGmin(adresy))
  const poGminie = new Map()
  for (const a of adresy) {
    const g = poGminie.get(a.teryt) ?? { wartosci: new Set(), klucze: new Set(), n: 0 }
    g.wartosci.add(p.wartosci[a.i])
    g.klucze.add(p.etykiety[a.i])
    g.n++
    poGminie.set(a.teryt, g)
  }
  assert.equal(poGminie.size, 14)
  assert.equal(Object.keys(p.slownikEtykiet).length, 14)
  for (const [teryt, g] of poGminie) {
    assert.equal(g.wartosci.size, 1, `${teryt}: różne wartości w jednej gminie`)
    assert.equal(g.klucze.size, 1, `${teryt}: różne etykiety w jednej gminie`)
    const [wartosc] = g.wartosci
    const d = dane.get(teryt)
    assert.ok(wartosc !== null && wartosc > 0 && wartosc < 5, `${teryt}: ${wartosc}`)
    assert.equal(wartosc, naSto(d.wnioski, d.budynki), `${teryt}: wartość`)
    // liczby w etykiecie to te same liczby, z których policzono wartość
    const [klucz] = g.klucze
    const opis = p.slownikEtykiet[klucz]
    assert.ok(opis.startsWith(`${d.gmina}: ${d.wnioski} `), opis)
    assert.ok(opis.includes(` na ${liczba(d.budynki)} budynków jednorodzinnych`), opis)
    assert.ok(opis.includes(`czyli ${wartosc.toFixed(2).replace('.', ',')} na 100 domów`), opis)
  }
  // Kraków (70 217 adresów z MSIP) ma największą liczbę adresów w jednej wartości
  assert.equal(poGminie.get('1261011').n, 70217)
  assert.equal(poGminie.get('1261011').wartosci.has(0.34), true)
  assert.equal(poGminie.get('1206022').wartosci.has(1.5), true)
})

test('metadane: przyszłość, więcej = lepiej, gmina, dwa źródła NFOŚiGW z datą stanu i licencją', () => {
  const { meta } = wczytaj(PLIK_WSKAZNIKA)
  assert.equal(meta.id, ID)
  assert.equal(meta.kategoria, 'przyszlosc')
  assert.equal(meta.kierunek, 'wiecej-lepiej')
  assert.equal(meta.rozdzielczosc, 'gmina')
  assert.equal(meta.jednostka, 'wniosków/100 domów')
  assert.equal(meta.zadanie, 141)
  assert.equal(meta.atrapa, undefined)
  assert.equal(meta.zrodla.length, 2)
  for (const z of meta.zrodla) {
    for (const k of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano'])
      assert.ok(z[k], `${z.nazwa}: ${k}`)
    assert.equal(z.licencja, LICENCJA)
    assert.match(z.nazwa, /NFOŚiGW/)
    assert.match(z.pobrano, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(z.url, /^https:\/\/czystepowietrze\.gov\.pl\/.+\.pdf$/)
  }
  // data stanu raportu i rankingu, nie data pobrania
  assert.equal(meta.zrodla[0].dataDanych, '2025-12-12')
  assert.equal(meta.zrodla[1].dataDanych, '2023-12-31')
  assert.match(LICENCJA, /brak jawnej licencji otwartej/)
  for (const fraza of [
    '100 budynków jednorodzinnych',
    'nie umowy ani wypłaty',
    'nie adresu',
    '31.03.2025',
    '12.12.2025',
  ])
    assert.ok(meta.opis.includes(fraza), fraza)
  // metadane powstają z generatora i migawki, nie z ręcznej edycji pliku
  assert.deepEqual(meta, zbudujMeta(wczytajMigawke()))
})

test('plik wskaźnika mieści się w limicie 2 MB z kontraktu', () => {
  assert.ok(readFileSync(PLIK_WSKAZNIKA).length < 2 * 1024 * 1024)
})

test('typografia: w wynikach, migawce, kodzie i dokumentacji nie ma znaku pauzy', () => {
  const PAUZA = String.fromCodePoint(0x2014)
  for (const sciezka of [
    PLIK_WSKAZNIKA,
    PLIK_DANYCH,
    join(KORZEN, 'etl', 'czyste-powietrze.md'),
    join(KORZEN, 'etl', 'czyste-powietrze.mjs'),
    join(KORZEN, 'etl', 'czyste-powietrze.test.mjs'),
  ])
    assert.ok(!readFileSync(sciezka, 'utf8').includes(PAUZA), sciezka)
})
