import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  ELEKCJA,
  ID,
  nazwaGminyKbw,
  pobierzZdykty,
  procent,
  sumujProtokoly,
  walidujWierszZdykty,
  zbudujFrekwencje,
} from './frekwencja.mjs'
import { DANE } from './lib/wspolne.mjs'
import { PRZENIESIONE } from './uprosc-kryteria.mjs'

/** Pauza (U+2014): w polskim tekście wolno tylko półpauzę ze spacjami. Zapis kodem, nie znakiem. */
const PAUZA = '\u2014'

// ---------- Arytmetyka ----------

test('procent: dwa miejsca jak w z-dykty, brak uprawnionych to brak danych, nie 0', () => {
  assert.equal(procent(16353, 33695), 48.53)
  assert.equal(procent(24971, 47941), 52.09)
  assert.equal(procent(0, 100), 0, 'zmierzone zero to zero')
  assert.equal(procent(100, 100), 100)
  assert.equal(procent(5, 0), null)
  assert.equal(procent(5, -3), null, 'ujemny mianownik nie odwraca wyniku')
  assert.equal(procent(5, Number.NaN), null)
})

// ---------- z-dykty ----------

const wiersz = (teryt, uprawnieni, glosy, pct) => ({
  gmina_teryt: teryt,
  uprawnieni,
  glosy_oddane: glosy,
  frekwencja_pct: pct ?? procent(glosy, uprawnieni),
})

test('walidujWierszZdykty: poprawny wiersz i odrzucenie niespójnych liczb', () => {
  assert.deepEqual(walidujWierszZdykty(wiersz('1219053', 47941, 24971, 52.09)), {
    teryt: '1219053',
    uprawnieni: 47941,
    wazne: 24971,
  })
  assert.throws(() => walidujWierszZdykty(wiersz('121905', 10, 5)), /TERYT/)
  assert.throws(() => walidujWierszZdykty(wiersz('1219053', 0, 0, 0)), /uprawnieni/)
  assert.throws(() => walidujWierszZdykty(wiersz('1219053', 10.5, 5)), /uprawnieni/)
  assert.throws(() => walidujWierszZdykty(wiersz('1219053', 10, 11, 110)), /glosy_oddane/)
  assert.throws(() => walidujWierszZdykty(wiersz('1219053', 10, -1, -10)), /glosy_oddane/)
  assert.throws(() => walidujWierszZdykty(wiersz('1219053', 10, 5, 52)), /frekwencja_pct/)
  // `wiersz(..., null)` podstawia wyliczony odsetek, więc brak odsetka budujemy ręcznie
  const bezOdsetka = { ...wiersz('1219053', 10, 5), frekwencja_pct: null }
  assert.throws(() => walidujWierszZdykty(bezOdsetka), /frekwencja_pct/)
})

/** Atrapa fetch: serwuje `wszystkie` stronami wg limit/offset z adresu, jak PostgREST. */
function atrapaPostgrest(wszystkie, { razem = wszystkie.length, status = 200 } = {}) {
  const wywolania = []
  const fetchFn = async (url, opcje) => {
    wywolania.push({ url, opcje })
    const u = new URL(url)
    const limit = Number(u.searchParams.get('limit'))
    const offset = Number(u.searchParams.get('offset'))
    const porcja = wszystkie.slice(offset, offset + limit)
    return {
      ok: status === 200,
      status,
      json: async () => porcja,
      headers: { get: (n) => (n.toLowerCase() === 'content-range' ? `0-0/${razem}` : null) },
    }
  }
  return { fetchFn, wywolania }
}

const KLUCZ = 'tajny-klucz-anon-do-testu'
const baza = 'https://example.test'

test('pobierzZdykty: stronicuje limit/offset, klucz tylko w nagłówku, sumę kontroluje', async () => {
  const wszystkie = Array.from({ length: 5 }, (_, i) => wiersz(`120000${i}`, 100, 50))
  const { fetchFn, wywolania } = atrapaPostgrest(wszystkie)
  const wynik = await pobierzZdykty({ baza, klucz: KLUCZ, fetchFn, rozmiar: 2 })
  assert.deepEqual(wynik, wszystkie)
  assert.equal(wywolania.length, 3, 'strony po 2, 2, 1')
  for (const { url, opcje } of wywolania) {
    assert.ok(!url.includes(KLUCZ), 'klucz nie wchodzi do adresu')
    assert.equal(opcje.headers.apikey, KLUCZ)
    assert.ok(url.includes(`elekcja_id=eq.${ELEKCJA}`))
    assert.ok(url.includes('order=gmina_teryt.asc'), 'stabilna kolejność – warunek stronicowania')
  }
  // liczba wierszy będąca wielokrotnością strony kończy się pustą stroną
  const parzyste = atrapaPostgrest(wszystkie.slice(0, 4))
  assert.equal(
    (await pobierzZdykty({ baza, klucz: KLUCZ, fetchFn: parzyste.fetchFn, rozmiar: 2 })).length,
    4,
  )
  assert.equal(parzyste.wywolania.length, 3)
})

test('pobierzZdykty: serwer tnący strony poniżej limitu nie daje po cichu niepełnych danych', async () => {
  const wszystkie = Array.from({ length: 5 }, (_, i) => wiersz(`120000${i}`, 100, 50))
  const { fetchFn } = atrapaPostgrest(wszystkie, { razem: 9 })
  await assert.rejects(
    pobierzZdykty({ baza, klucz: KLUCZ, fetchFn, rozmiar: 2 }),
    /pobrano 5 z 9 wierszy/,
  )
})

test('pobierzZdykty: błąd HTTP nie ujawnia klucza i przerywa', async () => {
  const { fetchFn } = atrapaPostgrest([], { status: 401 })
  await assert.rejects(pobierzZdykty({ baza, klucz: KLUCZ, fetchFn }), (e) => {
    assert.match(e.message, /HTTP 401/)
    assert.ok(!e.message.includes(KLUCZ))
    return true
  })
})

// ---------- KBW ----------

const NAGLOWEK = [
  'Nr komisji',
  'Gmina',
  'Teryt Gminy',
  'Liczba wyborców uprawnionych do głosowania',
  'Liczba kart ważnych',
]

test('nazwaGminyKbw: zdejmuje przedrostek rodzaju gminy', () => {
  assert.equal(nazwaGminyKbw('gm. Skawina'), 'Skawina')
  assert.equal(nazwaGminyKbw('m. Kraków'), 'Kraków')
  assert.equal(nazwaGminyKbw('m. st. Warszawa'), 'Warszawa')
  assert.equal(nazwaGminyKbw('Kraków'), 'Kraków')
})

test('sumujProtokoly: suma po obwodach, tylko potrzebne gminy, zero z przodu odtworzone', () => {
  const wiersze = [
    NAGLOWEK,
    ['1', 'm. Kraków', '126101', '1000', '500'],
    ['2', 'm. Kraków', '126101', '2000', '1100'],
    ['1', 'gm. Skawina', '120611', '300', '100'],
    // KBW zapisuje kod liczbowo: województwa 02, 04, 06, 08 tracą zero z przodu
    ['1', 'm. Wrocław', '26401', '700', '300'],
  ]
  const wynik = sumujProtokoly(wiersze, new Set(['126101', '026401']))
  assert.deepEqual([...wynik.keys()].sort(), ['026401', '126101'])
  assert.deepEqual(wynik.get('126101'), {
    teryt: '126101',
    nazwa: 'Kraków',
    uprawnieni: 3000,
    wazne: 1600,
    obwodow: 2,
  })
  assert.equal(wynik.get('026401').uprawnieni, 700)
  assert.ok(!wynik.has('120611'), 'gmina spoza adresów jest pomijana')
})

test('sumujProtokoly: zmieniony schemat albo puste pole to błąd, nie zaniżona frekwencja', () => {
  const potrzebne = new Set(['126101'])
  assert.throws(
    () =>
      sumujProtokoly(
        [
          ['Gmina', 'Teryt Gminy'],
          ['m. Kraków', '126101'],
        ],
        potrzebne,
      ),
    /brak kolumny/,
  )
  assert.throws(
    () => sumujProtokoly([NAGLOWEK, ['1', 'm. Kraków', '126101', '1000', '']], potrzebne),
    /karty ważne/,
  )
  assert.throws(
    () => sumujProtokoly([NAGLOWEK, ['1', 'm. Kraków', '126101', 'brak', '5']], potrzebne),
    /uprawnieni/,
  )
  // pusty wiersz innej gminy nie przeszkadza
  assert.doesNotThrow(() =>
    sumujProtokoly([NAGLOWEK, ['1', 'gm. Skawina', '120611', '', '']], potrzebne),
  )
})

// ---------- Składanie wskaźnika ----------

const adresy = [
  { teryt: '1261011', gmina: 'Kraków' },
  { teryt: '1219053', gmina: 'Wieliczka' },
  { teryt: '1261011', gmina: 'Kraków' },
  { teryt: '1206113', gmina: 'Skawina' },
]
const zd = (teryt, uprawnieni, wazne) => ({ teryt, uprawnieni, wazne })
const kb = (teryt6, nazwa, uprawnieni, wazne) => [
  teryt6,
  { teryt: teryt6, nazwa, uprawnieni, wazne },
]

test('zbudujFrekwencje: z-dykty, uzupełnienie z KBW, zgodność obu źródeł i etykiety', () => {
  const w = zbudujFrekwencje({
    adresy,
    zdykty: [zd('1219053', 47941, 24971), zd('1206113', 33695, 16353)],
    kbw: new Map([kb('126101', 'Kraków', 578919, 299870), kb('121905', 'Wieliczka', 47941, 24971)]),
  })
  assert.deepEqual(w.wartosci, [51.8, 52.09, 51.8, 48.53])
  assert.equal(w.zgodnych, 1, 'tylko Wieliczka jest w obu źródłach')
  assert.deepEqual(
    w.gminy.map((g) => [g.nazwa, g.zrodlo]),
    [
      ['Skawina', 'z-dykty'],
      ['Wieliczka', 'z-dykty'],
      ['Kraków', 'kbw'],
    ],
  )
  // etykieta wskazuje wpis słownika, wspólny dla wszystkich adresów gminy
  assert.equal(w.etykiety[0], w.etykiety[2])
  assert.notEqual(w.etykiety[0], w.etykiety[1])
  assert.deepEqual(Object.keys(w.slownikEtykiet).sort(), ['0', '1', '2'])
  const krakow = w.slownikEtykiet[w.etykiety[0]]
  assert.match(krakow, /^Kraków \(TERYT 1261011\)/)
  assert.match(krakow, /KBW/, 'etykieta mówi, że liczba pochodzi z innego źródła niż z-dykty')
  assert.ok(!w.slownikEtykiet[w.etykiety[1]].includes('KBW'))
  assert.ok(!JSON.stringify(w).includes(PAUZA), 'półpauza ze spacjami, nigdy pauza')
})

test('zbudujFrekwencje: źródła liczą inaczej albo nazwa gminy się nie zgadza – błąd', () => {
  const baza = { adresy: [{ teryt: '1219053', gmina: 'Wieliczka' }] }
  assert.throws(
    () =>
      zbudujFrekwencje({
        ...baza,
        zdykty: [zd('1219053', 47941, 24971)],
        kbw: new Map([kb('121905', 'Wieliczka', 47954, 24986)]),
      }),
    /źródła liczą inaczej/,
  )
  assert.throws(
    () =>
      zbudujFrekwencje({
        ...baza,
        zdykty: [],
        kbw: new Map([kb('121905', 'Inna gmina', 100, 50)]),
      }),
    /KBW „Inna gmina”/,
  )
  assert.throws(
    () =>
      zbudujFrekwencje({ adresy: [{ teryt: '12190', gmina: 'X' }], zdykty: [], kbw: new Map() }),
    /TERYT adresu/,
  )
})

test('zbudujFrekwencje: gmina bez danych w obu źródłach to null i brak etykiety, nie 0', () => {
  const w = zbudujFrekwencje({
    adresy: [
      { teryt: '1219053', gmina: 'Wieliczka' },
      { teryt: '1206113', gmina: 'Skawina' },
    ],
    zdykty: [zd('1206113', 33695, 16353)],
    kbw: new Map(),
  })
  assert.deepEqual(w.wartosci, [null, 48.53])
  assert.deepEqual(w.etykiety, [null, w.etykiety[1]])
  assert.notEqual(w.etykiety[1], null)
  assert.equal(Object.keys(w.slownikEtykiet).length, 1)
  assert.equal(w.gminy[1].zrodlo, null)
})

// ---------- Wygenerowany plik (po `node etl/frekwencja.mjs`) ----------

test('plik wskaźnika frekwencja_samorzad_2024: kontrakt, pokrycie, jedna liczba na gminę', () => {
  const adr = JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8'))
  const k = adr.kolumny
  const sciezka = join(DANE, 'wskazniki', `${ID}.json`)
  const p = JSON.parse(readFileSync(sciezka, 'utf8'))
  assert.equal(p.wersjaAdresow, adr.wersja, 'plik policzony na bieżących adresach')
  assert.equal(p.wartosci.length, k.id.length)
  assert.equal(p.etykiety.length, k.id.length)
  assert.ok(statSync(sciezka).size < 2 * 1024 * 1024, 'plik wskaźnika poniżej 2 MB')

  const m = p.meta
  assert.equal(m.id, ID)
  assert.equal(m.zadanie, 142)
  // Od #171 grupę i kierunek nadaje PRZENIESIONE; waga startowa 0 = bez wpływu na wynik domyślnie.
  assert.deepEqual([m.kategoria, m.kierunek], PRZENIESIONE[ID])
  assert.equal(m.domyslnaWaga, 0, 'bez wpływu na wynik, póki użytkownik nie ustawi wagi')
  assert.equal(m.rozdzielczosc, 'gmina')
  assert.equal(m.jednostka, '%')
  assert.deepEqual(m.zakres, [0, 100])
  assert.ok(!m.atrapa)
  assert.ok(m.zrodla.length >= 1)
  for (const z of m.zrodla)
    for (const pole of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano'])
      assert.ok(z[pole], `zrodla[].${pole}`)
  assert.ok(
    m.zrodla.some(
      (z) => z.nazwa.includes('przetworzone przez z-dykty.pl') && z.licencja.includes('CC BY 4.0'),
    ),
    'atrybucja: pierwotna instytucja i opracowanie z-dykty.pl',
  )
  assert.ok(!JSON.stringify(p).includes(PAUZA), 'półpauza ze spacjami, nigdy pauza')

  // jedna wartość i jedna etykieta na gminę, wszystkie z zakresu 0–100, żaden adres bez danych
  const poGminie = new Map()
  for (let i = 0; i < k.id.length; i++) {
    const v = p.wartosci[i]
    assert.ok(Number.isFinite(v) && v > 0 && v <= 100, `adres ${i}: ${v}`)
    const wpis = poGminie.get(k.teryt[i]) ?? {
      wartosci: new Set(),
      etykiety: new Set(),
      adresow: 0,
    }
    wpis.wartosci.add(v)
    wpis.etykiety.add(p.etykiety[i])
    wpis.adresow++
    poGminie.set(k.teryt[i], wpis)
  }
  assert.equal(poGminie.size, 14, 'Kraków i 13 gmin obwarzanka')
  for (const [teryt, w] of poGminie) {
    assert.equal(w.wartosci.size, 1, `${teryt}: jedna liczba na gminę`)
    assert.equal(w.etykiety.size, 1, `${teryt}: jedna etykieta na gminę`)
    const opis = p.slownikEtykiet[[...w.etykiety][0]]
    assert.ok(opis?.includes(`TERYT ${teryt}`), `${teryt}: etykieta opisuje tę gminę`)
  }
  assert.equal(
    Object.keys(p.slownikEtykiet).length,
    poGminie.size,
    'słownik bez nadmiarowych wpisów',
  )

  // wartości z-dykty (13 gmin) i obliczona z KBW (Kraków, 40% adresów) – ta sama metoda
  const wartoscGminy = (teryt) => [...poGminie.get(teryt).wartosci][0]
  assert.equal(wartoscGminy('1219053'), 52.09, 'Wieliczka')
  assert.equal(wartoscGminy('1206113'), 48.53, 'Skawina')
  assert.equal(wartoscGminy('1261011'), 51.8, 'Kraków')
  assert.equal(poGminie.get('1261011').adresow, 70217)
  assert.ok(p.slownikEtykiet[[...poGminie.get('1261011').etykiety][0]].includes('KBW'))
})
