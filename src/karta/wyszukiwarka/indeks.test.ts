// Testy: node --test src/karta/wyszukiwarka/*.test.ts
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Adres, PlikAdresow } from '../../kontrakty/index.ts'
import { indeksDla, normalizuj, normalizujNr, szukaj, zbudujIndeks } from './indeks.ts'

function adres(
  i: number,
  ulica: string | null,
  nr: string,
  miejscowosc = 'Kraków',
  gmina = miejscowosc,
): Adres {
  return {
    i,
    id: `t-${i}`,
    miejscowosc,
    ulica,
    nr,
    kod: miejscowosc === 'Kraków' ? '31-001' : '32-020',
    dzielnica: miejscowosc === 'Kraków' ? 'I Stare Miasto' : null,
    gmina,
    teryt: miejscowosc === 'Kraków' ? '1261011' : '1206000',
    lon: 19.9,
    lat: 50.0,
    h3: '',
  }
}

const DANE: Adres[] = [
  ...['1', '2', '5', '5a', '50', '52', '52a', '7/9'].map((n, k) => adres(k, 'Grodzka', n)),
  ...['1', '2', '3'].map((n, k) => adres(10 + k, 'Kościuszki', n, 'Wieliczka', 'Wieliczka')),
  ...['1', '3'].map((n, k) => adres(20 + k, 'Kościuszki', n)),
  ...['10', '12'].map((n, k) => adres(30 + k, 'Floriańska', n)),
  ...['1', '2'].map((n, k) => adres(40 + k, 'Józefa Dietla', n)),
  ...['4', '5'].map((n, k) => adres(50 + k, 'Krakowska', n)),
  ...['1', '2'].map((n, k) => adres(60 + k, '3 Maja', n)),
  adres(70, null, '17', 'Wieliczka', 'Wieliczka'),
]

const ind = zbudujIndeks(DANE)
const tytuly = (q: string, limit?: number) => szukaj(ind, q, limit).map((w) => w.tytul)

test('normalizacja', () => {
  assert.equal(normalizuj('Ul. Kościuszki, Łódź'), 'ul kosciuszki lodz')
  assert.equal(normalizujNr(' 12 A '), '12a')
  assert.equal(normalizujNr('5 / 7'), '5/7')
})

test('pełne dopasowanie ulicy i numeru jest pierwsze', () => {
  assert.equal(tytuly('grodzka 52')[0], 'Grodzka 52')
  assert.equal(tytuly('Grodzka 5')[0], 'Grodzka 5')
})

test('pełny numer: dokładny pierwszy, reszta numerycznie', () => {
  const nry = ['104', '10', '1a', '2', '1', '12', '100']
  const wi = zbudujIndeks(nry.map((n, k) => adres(k, 'Karmelicka', n)))
  assert.deepEqual(
    szukaj(wi, 'Karmelicka 1').map((w) => w.tytul),
    [
      'Karmelicka 1',
      'Karmelicka 1a',
      'Karmelicka 10',
      'Karmelicka 12',
      'Karmelicka 100',
      'Karmelicka 104',
    ],
  )
})

test('odmiana ulicy', () => {
  assert.equal(tytuly('Grodzkiej 52')[0], 'Grodzka 52')
  assert.equal(tytuly('Floriańskiej 10')[0], 'Floriańska 10')
})

test('literówka', () => {
  assert.equal(tytuly('grdzka 52')[0], 'Grodzka 52')
  assert.equal(tytuly('grodkza 52')[0], 'Grodzka 52')
})

test('skróty i miasto w zapytaniu', () => {
  assert.equal(tytuly('ul. Grodzka 52 Kraków')[0], 'Grodzka 52')
  assert.equal(tytuly('Grodzka 52, w Krakowie')[0], 'Grodzka 52')
})

test('miejscowość zawęża wynik', () => {
  const w = szukaj(ind, 'Wieliczka Kościuszki 3')
  assert.equal(w[0]?.i, 12)
  assert.equal(w.length, 1)
  assert.equal(szukaj(ind, 'Kościuszki 3', 8).length, 2)
})

test('numer z literą i ukośnikiem', () => {
  assert.equal(tytuly('grodzka 52a')[0], 'Grodzka 52a')
  assert.equal(tytuly('grodzka 52 a')[0], 'Grodzka 52a')
  assert.equal(tytuly('grodzka 7/9')[0], 'Grodzka 7/9')
})

test('prefiks numeru: dokładny numer przed dłuższymi', () => {
  const t = tytuly('grodzka 5')
  assert.deepEqual(t.slice(0, 3), ['Grodzka 5', 'Grodzka 5a', 'Grodzka 50'])
})

test('prefiks ulicy w trakcie pisania', () => {
  assert.equal(tytuly('grod 2')[0], 'Grodzka 2')
})

test('sama ulica daje kilka numerów tej ulicy', () => {
  const t = tytuly('Grodzka')
  assert.equal(t.length, 8)
  assert.deepEqual(t.slice(0, 3), ['Grodzka 1', 'Grodzka 2', 'Grodzka 5'])
})

test('ulica rozpoczynająca się od cyfry i ulica podobna do miasta', () => {
  assert.equal(tytuly('3 maja 2')[0], '3 Maja 2')
  assert.equal(tytuly('Krakowska 5')[0], 'Krakowska 5')
})

test('adres bez ulicy po miejscowości', () => {
  assert.equal(tytuly('Wieliczka 17')[0], 'Wieliczka 17')
})

test('wielowyrazowa nazwa w dowolnej kolejności', () => {
  assert.equal(tytuly('dietla jozefa 2')[0], 'Józefa Dietla 2')
})

test('brak trafień i puste zapytania', () => {
  assert.deepEqual(szukaj(ind, 'zzzzzz 5'), [])
  assert.deepEqual(szukaj(ind, ''), [])
  assert.deepEqual(szukaj(ind, 'ul.'), [])
  assert.deepEqual(szukaj(ind, '52'), [])
  assert.deepEqual(szukaj(zbudujIndeks([]), 'grodzka'), [])
})

test('opis: dzielnica albo gmina, potem kod', () => {
  assert.equal(szukaj(ind, 'grodzka 1')[0]?.opis, 'I Stare Miasto, 31-001')
  assert.equal(szukaj(ind, 'Wieliczka 17')[0]?.opis, 'Wieliczka, 32-020')
})

test('indeksDla buduje raz na tablicę', () => {
  assert.equal(indeksDla(DANE), indeksDla(DANE))
})

function syntetyczne(n: number): Adres[] {
  const sylaby = [
    'gro',
    'dzk',
    'kos',
    'ciu',
    'szk',
    'flo',
    'ria',
    'nsk',
    'mog',
    'ils',
    'wie',
    'lic',
    'ka',
  ]
  let ziarno = 7
  const los = (m: number) => {
    ziarno = (ziarno * 1103515245 + 12345) % 2147483648
    return ziarno % m
  }
  const ulice = Array.from({ length: 2000 }, () => {
    const s = `${sylaby[los(13)]}${sylaby[los(13)]}${sylaby[los(13)]}${['a', 'i', 'ego'][los(3)]}`
    return s[0]?.toUpperCase() + s.slice(1)
  })
  return Array.from({ length: n }, (_, i) =>
    adres(i, ulice[i % 2000] ?? 'X', `${1 + Math.floor(i / 2000)}${['', 'a', ''][i % 3]}`),
  )
}

test('wydajność na 70 tys. adresów (progi luźne, żeby CI nie migotało)', () => {
  const dane = syntetyczne(70_000)
  let t = performance.now()
  const wi = zbudujIndeks(dane)
  const budowa = performance.now() - t
  const zapytania = ['grodzka 5', 'kosciuszki 12a', 'grdzka 3', 'flor', 'ul. mogilska 10 Kraków']
  t = performance.now()
  for (let k = 0; k < 50; k++) for (const q of zapytania) szukaj(wi, q)
  const zapytanie = (performance.now() - t) / (50 * zapytania.length)
  console.log(`budowa ${budowa.toFixed(0)} ms, zapytanie ${zapytanie.toFixed(2)} ms`)
  assert.ok(budowa < 1500, `budowa ${budowa} ms`)
  assert.ok(zapytanie < 50, `zapytanie ${zapytanie} ms`)
})

const PLIK = new URL('../../../public/dane/adresy.json', import.meta.url)
test('prawdziwy plik adresy.json', { skip: !existsSync(PLIK) }, () => {
  const p = JSON.parse(readFileSync(PLIK, 'utf8')) as PlikAdresow
  const k = p.kolumny
  const adresy: Adres[] = k.id.map((id, i) => ({
    i,
    id,
    miejscowosc: k.miejscowosc[i] ?? '',
    ulica: k.ulica[i] ?? null,
    nr: k.nr[i] ?? '',
    kod: k.kod[i] ?? null,
    dzielnica: k.dzielnica[i] ?? null,
    gmina: k.gmina[i] ?? '',
    teryt: k.teryt[i] ?? '',
    lon: k.lon[i] ?? 0,
    lat: k.lat[i] ?? 0,
    h3: k.h3[i] ?? '',
  }))
  const wi = zbudujIndeks(adresy)
  for (const i of [0, 1, 2, Math.floor(adresy.length / 2)]) {
    const a = adresy[i] as Adres
    if (!a.ulica) continue
    const w = szukaj(wi, `${a.ulica} ${a.nr}`)
    assert.ok(
      w.some((x) => x.tytul === `${a.ulica} ${a.nr}`), // numer może się powtarzać na ulicy (dedupe po tytule)
      `brak ${a.ulica} ${a.nr} w wynikach`,
    )
  }
})
