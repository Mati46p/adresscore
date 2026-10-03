import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  czytelnaNazwa,
  indeksPunktow,
  normalizujMiejscowosc,
  normalizujNumer,
  normalizujUlice,
  odlegloscMetry,
  zapytanieAdresowe,
} from './lib/codziennosc-geo.mjs'

test('ulice z rejestrów: skróty zamieniają się na formę z PRG', () => {
  assert.equal(normalizujUlice('ul. Stawowa'), 'Stawowa')
  assert.equal(normalizujUlice('al. Aleja Jana Pawła II'), 'Aleja Jana Pawła II')
  assert.equal(normalizujUlice('al. Jana Pawła II'), 'Aleja Jana Pawła II')
  assert.equal(normalizujUlice('os. Kombatantów'), 'Osiedle Kombatantów')
  assert.equal(normalizujUlice('pl. Wszystkich Świętych'), 'Plac Wszystkich Świętych')
  assert.equal(normalizujUlice(null), '')
})

test('dzielnica Krakowa zamienia się na Kraków, inne miejscowości zostają', () => {
  assert.equal(normalizujMiejscowosc('Kraków-Nowa Huta, delegatura'), 'Kraków')
  assert.equal(normalizujMiejscowosc('Wieliczka'), 'Wieliczka')
})

test('zapytanie adresowe: wieś bez ulicy używa nazwy miejscowości, brak numeru daje null', () => {
  assert.equal(zapytanieAdresowe({ miejscowosc: 'Rudawa', ulica: '', nr: '100' }), 'Rudawa 100')
  assert.equal(
    zapytanieAdresowe({ miejscowosc: 'Kraków-Podgórze', ulica: 'ul. Rydygiera', nr: '18' }),
    'Kraków, Rydygiera 18',
  )
  assert.equal(zapytanieAdresowe({ miejscowosc: 'Kraków', ulica: 'Długa', nr: '' }), null)
})

test('najbliższy punkt: wybiera właściwy, mierzy w metrach, respektuje promień', () => {
  const punkty = [
    { nazwa: 'bliski', lat: 50.001, lon: 20 },
    { nazwa: 'daleki', lat: 50.05, lon: 20.05 },
    { nazwa: 'bardzo daleki', lat: 50.2, lon: 19.7 },
  ]
  const najblizszy = indeksPunktow(punkty)
  const w = najblizszy(50, 20, 15_000)
  assert.equal(w.punkt.nazwa, 'bliski')
  assert.ok(Math.abs(w.metry - odlegloscMetry(50, 20, 50.001, 20)) < 1e-6)
  assert.ok(Math.abs(w.metry - 111.19) < 0.2)
  assert.equal(najblizszy(50, 20, 50), null)
  // Punkt w odległej komórce siatki też jest znajdowany.
  assert.equal(najblizszy(50.2, 19.71, 15_000).punkt.nazwa, 'bardzo daleki')
})

test('najbliższy punkt: zgadza się z pełnym przeglądem na losowych danych', () => {
  let ziarno = 7
  const los = () => {
    ziarno = (ziarno * 1_103_515_245 + 12_345) % 2_147_483_648
    return ziarno / 2_147_483_648
  }
  const punkty = Array.from({ length: 400 }, (_, i) => ({
    nazwa: `p${i}`,
    lat: 49.95 + los() * 0.2,
    lon: 19.75 + los() * 0.4,
  }))
  const najblizszy = indeksPunktow(punkty)
  for (let i = 0; i < 200; i++) {
    const lat = 49.95 + los() * 0.2
    const lon = 19.75 + los() * 0.4
    const oczekiwane = Math.min(...punkty.map((p) => odlegloscMetry(lat, lon, p.lat, p.lon)))
    const w = najblizszy(lat, lon, 50_000)
    assert.ok(Math.abs(w.metry - oczekiwane) < 1, `${w.metry} vs ${oczekiwane}`)
  }
})

test('numer budynku: bierze pierwszy numer, zachowuje literę', () => {
  assert.equal(normalizujNumer('5-7'), '5')
  assert.equal(normalizujNumer('3/LU1'), '3')
  assert.equal(normalizujNumer('14bud.C'), '14')
  assert.equal(normalizujNumer('29A-B'), '29A')
  assert.equal(normalizujNumer('15 a'), '15a')
  assert.equal(normalizujNumer('brak'), '')
})

test('nazwy wielkimi literami stają się czytelne, zwykłe zostają', () => {
  assert.equal(
    czytelnaNazwa('SZKOŁA PODSTAWOWA NR 35 IM. JANA III SOBIESKIEGO W KRAKOWIE'),
    'Szkoła Podstawowa nr 35 im. Jana III Sobieskiego w Krakowie',
  )
  assert.equal(czytelnaNazwa('Żabka'), 'Żabka')
  assert.equal(czytelnaNazwa('PRZEDSZKOLE NR 15'), 'Przedszkole nr 15')
  assert.equal(czytelnaNazwa(null), '')
  assert.ok(czytelnaNazwa('A'.repeat(100)).length <= 60)
})
