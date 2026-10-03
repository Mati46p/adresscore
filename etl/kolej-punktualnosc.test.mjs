import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  agregujRok,
  daneDostepu,
  liczWarstwe,
  MIN_ZATRZYMAN,
  PROMIEN_M,
  pobierzTabele,
  punktualnosc,
  ROCZNIKI_UTK,
  stacjeDoWarstwy,
  wybierzRok,
  zbudujMeta,
  zmianaOpoznien,
} from './kolej-punktualnosc.mjs'

const w = (rok, stacja, zatrzymania, opoznione, przewoznik = '', miesiac = 0) => ({
  rok,
  miesiac,
  stacja,
  przewoznik,
  zatrzymania,
  opoznione,
})
const stacja = (nazwa, lon = 19.94, lat = 50.06, metoda = 'gtfs') => ({ nazwa, metoda, lat, lon })
const pelny = (zatrzymania, opoznione) => ({ zatrzymania, opoznione, pelne: true })

test('rocznik z samym licznikiem (jak UTK 2025) nie jest wybierany', () => {
  const wiersze = [
    w(2024, 'A', 1000, 100),
    w(2024, 'B', 2000, 50),
    w(2025, 'A', null, 120),
    w(2025, 'B', null, 60),
  ]
  assert.equal(wybierzRok(wiersze), 2024)
  assert.throws(() => wybierzRok([w(2025, 'A', null, 1)]), /mianownik/)
  // wiersz miesięczny nie jest rocznikiem
  assert.throws(() => wybierzRok([w(2026, 'A', 10, 1, '', 3)]), /mianownik/)
  assert.throws(() => wybierzRok([]), /mianownik/)
})

test('agregacja sumuje przewoźników stacji, a niepełny wiersz oznacza całą stację', () => {
  const wiersze = [
    w(2024, 'Kraków Główny', 100_000, 9_000, 'POLREGIO'),
    w(2024, 'Kraków Główny', 61_704, 6_568, 'PKP IC'),
    w(2023, 'Kraków Główny', 5, 5), // inny rocznik
    w(2024, 'Kraków Główny', 10, 1, 'X', 6), // wiersz miesięczny nie wchodzi do rocznego
    w(2024, 'Mała', 2000, 100, 'A'),
    w(2024, 'Mała', null, 30, 'B'), // brak mianownika jednego przewoźnika
    w(2024, 'Ujemna', 2000, -1, 'A'),
  ]
  const a = agregujRok(wiersze, 2024)
  assert.deepEqual(a.get('Kraków Główny'), { zatrzymania: 161_704, opoznione: 15_568, pelne: true })
  assert.equal(a.get('Mała').pelne, false)
  assert.equal(a.get('Ujemna').pelne, false)
})

test('punktualność: procent z jednym miejscem, a zero i sto to zmierzone wartości', () => {
  assert.equal(punktualnosc(15_568, 161_704), 90.4)
  assert.equal(punktualnosc(207, 23_445), 99.1)
  assert.equal(punktualnosc(0, 5000), 100)
  assert.equal(punktualnosc(5000, 5000), 0)
})

test('stacje: tylko dopasowania 1:1, w Polsce, z pełnym pomiarem i ruchem od progu', () => {
  const stacje = [
    stacja('dobra'),
    stacja('na progu'),
    stacja('mały ruch'),
    stacja('niepełna'),
    stacja('niespójna'),
    stacja('bez pomiaru'),
    stacja('prefiks', 19.94, 50.06, 'gtfs-prefiks'),
    stacja('bez położenia', null, null, 'brak'),
    stacja('zero zero', 0, 0),
  ]
  const agregat = new Map([
    ['dobra', pelny(5000, 500)],
    ['na progu', pelny(MIN_ZATRZYMAN, 0)],
    ['mały ruch', pelny(MIN_ZATRZYMAN - 1, 1)],
    ['niepełna', { zatrzymania: 5000, opoznione: 1, pelne: false }],
    ['niespójna', pelny(5000, 5001)],
    ['prefiks', pelny(5000, 5)],
    ['bez położenia', pelny(5000, 5)],
    ['zero zero', pelny(5000, 5)],
  ])
  const { stacje: przyjete, odrzucone } = stacjeDoWarstwy(stacje, agregat)
  assert.deepEqual(
    przyjete.map((s) => [s.nazwa, s.punktualne]),
    [
      ['dobra', 90],
      ['na progu', 100],
    ],
  )
  assert.deepEqual(odrzucone, {
    metoda: 2,
    polozenie: 1,
    bezPomiaru: 1,
    niepelne: 1,
    niespojne: 1,
    malyRuch: 1,
  })
})

test('najbliższa stacja w promieniu: mała stacja jest pomijana, dalej niż promień brak danych', () => {
  // 0,01° długości na szerokości Krakowa to ok. 714 m.
  const stacje = [stacja('bliska, ale mała', 19.94), stacja('dalsza, duża', 19.95)]
  const agregat = new Map([
    ['bliska, ale mała', pelny(500, 0)],
    ['dalsza, duża', pelny(20_000, 2000)],
  ])
  const { stacje: przyjete } = stacjeDoWarstwy(stacje, agregat)
  assert.deepEqual(
    przyjete.map((s) => s.nazwa),
    ['dalsza, duża'],
  )
  const adresy = [
    { lat: 50.06, lon: 19.9401 }, // 11 m od małej stacji, ok. 700 m od dużej
    { lat: 50.06, lon: 19.99 }, // ok. 2,9 km od dużej
    { lat: 50.06, lon: 19.995 }, // ok. 3,2 km od dużej
    { lat: 49.0, lon: 19.0 }, // daleko
  ]
  const { wartosci, trafienia } = liczWarstwe(adresy, przyjete, PROMIEN_M)
  assert.deepEqual(wartosci, [90, 90, null, null])
  assert.ok(trafienia[0].metry > 600 && trafienia[0].metry < 800)
  assert.equal(trafienia[2], null)
})

test('bez żadnej stacji wszystkie adresy mają brak danych', () => {
  const { wartosci } = liczWarstwe([{ lat: 50.06, lon: 19.94 }], [])
  assert.deepEqual(wartosci, [null])
})

test('zmiana opóźnień: stosunek lat tylko dla stacji z obiema wartościami i niezerową bazą', () => {
  const wiersze = [
    w(2024, 'A', 1, 10, 'x'),
    w(2024, 'A', 1, 10, 'y'),
    w(2025, 'A', null, 30, 'x'),
    w(2025, 'A', null, 30, 'y'),
    w(2024, 'B', 1, 0),
    w(2025, 'B', null, 5),
    w(2024, 'C', 1, 4),
  ]
  const z = zmianaOpoznien(wiersze, 2024, 2025)
  assert.equal(z.get('A'), 3)
  assert.equal(z.has('B'), false) // zero w roku bazowym
  assert.equal(z.has('C'), false) // brak późniejszego roku
})

// --- Dostęp do z-dykty -----------------------------------------------------------------------------

const dostep = { url: 'https://projekt.example', klucz: 'tajny-klucz-anon' }
const odpowiedz = (dane, od, razem, status = 206) =>
  new Response(JSON.stringify(dane), {
    status,
    headers: { 'content-range': `${od}-${od + dane.length - 1}/${razem}` },
  })

test('tabela jest czytana stronami z nagłówkiem Range i zgodnie z deklarowaną liczbą wierszy', async () => {
  const dane = [1, 2, 3, 4, 5].map((id) => ({ id }))
  const zapytania = []
  const fetchFn = async (url, opcje) => {
    const [od, doo] = opcje.headers.Range.split('-').map(Number)
    zapytania.push({ url, od, klucz: opcje.headers.apikey })
    return odpowiedz(dane.slice(od, doo + 1), od, dane.length)
  }
  const wynik = await pobierzTabele(dostep, 'tabela', 'select=id&order=id.asc', {
    fetchFn,
    strona: 2,
    pauzaMs: 0,
  })
  assert.deepEqual(wynik, dane)
  assert.deepEqual(
    zapytania.map((z) => z.od),
    [0, 2, 4],
  )
  assert.equal(zapytania[0].url, 'https://projekt.example/rest/v1/tabela?select=id&order=id.asc')
  assert.ok(zapytania.every((z) => z.klucz === dostep.klucz))
})

test('pusta tabela daje pustą tablicę, a pusta strona przed końcem jest błędem', async () => {
  const pusta = async () => new Response('[]', { status: 200, headers: { 'content-range': '*/0' } })
  assert.deepEqual(await pobierzTabele(dostep, 't', 'select=a', { fetchFn: pusta }), [])

  let strony = 0
  const urwana = async (_url, opcje) => {
    const od = Number(opcje.headers.Range.split('-')[0])
    return strony++ === 0 ? odpowiedz([{ id: 1 }, { id: 2 }], od, 5) : odpowiedz([], od, 5)
  }
  await assert.rejects(
    pobierzTabele(dostep, 't', 'select=id', { fetchFn: urwana, strona: 2, pauzaMs: 0 }),
    /pusta strona po 2 z 5/,
  )
})

test('odmowa dostępu nie jest ponawiana, a komunikat nie zawiera klucza', async () => {
  let wywolania = 0
  const fetchFn = async () => {
    wywolania++
    return new Response('{"message":"Unauthorized"}', { status: 401 })
  }
  await assert.rejects(
    pobierzTabele(dostep, 'kolej_stacje', 'select=nazwa', { fetchFn, pauzaMs: 0 }),
    (blad) => {
      assert.match(blad.message, /kolej_stacje: HTTP 401/)
      assert.ok(!blad.message.includes(dostep.klucz))
      return true
    },
  )
  assert.equal(wywolania, 1)
})

test('błąd serwera i limit tempa są ponawiane, potem pobranie się udaje', async () => {
  const odpowiedzi = [
    new Response('', { status: 503 }),
    new Response('', { status: 429 }),
    odpowiedz([{ id: 1 }], 0, 1, 200),
  ]
  let i = 0
  const wynik = await pobierzTabele(dostep, 't', 'select=id', {
    fetchFn: async () => odpowiedzi[i++],
    pauzaMs: 0,
  })
  assert.deepEqual(wynik, [{ id: 1 }])
  assert.equal(i, 3)
  await assert.rejects(
    pobierzTabele(dostep, 't', 'select=id', {
      fetchFn: async () => new Response('', { status: 500 }),
      proby: 2,
      pauzaMs: 0,
    }),
    /nie udało się pobrać strony od 0: HTTP 500/,
  )
})

test('adres i klucz z-dykty: środowisko ma pierwszeństwo przed .env.local, brak wartości to błąd', () => {
  const katalog = mkdtempSync(join(tmpdir(), 'kolej-punktualnosc-'))
  try {
    const plik = join(katalog, '.env.local')
    writeFileSync(
      plik,
      'ZDYKTY_SUPABASE_URL=https://z-pliku.example/\nZDYKTY_ANON_KEY="klucz-z-pliku"\n',
    )
    assert.deepEqual(daneDostepu({}, plik), {
      url: 'https://z-pliku.example',
      klucz: 'klucz-z-pliku',
    })
    assert.deepEqual(
      daneDostepu({ ZDYKTY_SUPABASE_URL: 'https://z-env.example', ZDYKTY_ANON_KEY: 'k' }, plik),
      { url: 'https://z-env.example', klucz: 'k' },
    )
    assert.throws(() => daneDostepu({}, join(katalog, 'brak.env')), /Brak ZDYKTY_SUPABASE_URL/)
    assert.throws(
      () =>
        daneDostepu(
          { ZDYKTY_SUPABASE_URL: 'http://niebezpieczny.example', ZDYKTY_ANON_KEY: 'k' },
          plik,
        ),
      /https/,
    )
  } finally {
    rmSync(katalog, { recursive: true, force: true })
  }
})

// --- Metadane --------------------------------------------------------------------------------------

test('metadane spełniają kontrakt: źródła z licencją i datami, atrybucja z-dykty, bez pauzy', () => {
  const rok = Number(Object.keys(ROCZNIKI_UTK)[0])
  const meta = zbudujMeta({
    rok,
    dataStacji: '2026-09-07',
    odcisk: 'abcdef0123456789',
    pobrano: '2026-10-03',
  })
  assert.match(meta.id, /^[a-z0-9_]+$/)
  assert.equal(meta.kategoria, 'transport')
  assert.equal(meta.rozdzielczosc, 'adres')
  assert.equal(meta.kierunek, 'wiecej-lepiej')
  assert.equal(meta.jednostka, '%')
  assert.equal(meta.zadanie, 139)
  assert.ok(meta.zakres[0] < meta.zakres[1])
  assert.equal(meta.zrodla.length, 2)
  for (const z of meta.zrodla)
    for (const pole of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano'])
      assert.ok(z[pole], `zrodla[].${pole}`)
  const [utk, polozenie] = meta.zrodla
  assert.match(utk.nazwa, /Urząd Transportu Kolejowego/)
  assert.match(utk.nazwa, /przetworzone przez z-dykty\.pl \(CC BY 4\.0\)/)
  assert.match(utk.nazwa, /abcdef012345\b/)
  assert.equal(utk.dataDanych, String(rok))
  assert.match(utk.licencja, /CC0 1\.0/)
  assert.equal(polozenie.dataDanych, '2026-09-07')
  // opis podaje te same stałe, których używa rachunek
  assert.match(meta.opis, new RegExp(`do ${PROMIEN_M / 1000} km`))
  assert.match(meta.opis, new RegExp(`co najmniej ${MIN_ZATRZYMAN} zatrzymań`))
  assert.match(meta.opis, /brak danych, nie zero/)
  // polska typografia: półpauza ze spacjami, nigdy pauza
  assert.ok(!JSON.stringify(meta).includes(String.fromCodePoint(0x2014)), 'pauza (U+2014)')
  assert.throws(() => zbudujMeta({ rok: 1999, dataStacji: 'x', odcisk: 'x', pobrano: 'x' }), /1999/)
})
