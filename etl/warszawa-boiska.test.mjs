import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DANE } from './lib/wspolne.mjs'
import {
  geokoduj,
  geokodujBoiska,
  indeksAdresow,
  kluczUlicy,
  numeryDoSprawdzenia,
  rozbijAdres,
  slowaPasuja,
  srodkiPoDzielnicach,
} from './warszawa-boiska.mjs'

const adresy = [
  { ulica: 'ulica Elbląska', nr: '51', lon: 20.95, lat: 52.28, kod: '01-737' },
  { ulica: 'Aleja Jana Pawła II', nr: '26A', lon: 21.0, lat: 52.24, kod: '00-133' },
  { ulica: 'Aleja Jana Pawła II', nr: '26', lon: 21.0, lat: 52.241, kod: '00-133' },
  { ulica: 'ulica Chłodna', nr: '36/46', lon: 20.99, lat: 52.23, kod: '00-872' },
  { ulica: 'ulica Chłodna', nr: '48', lon: 20.991, lat: 52.231, kod: '00-872' },
  { ulica: 'ulica Bolesława Limanowskiego', nr: '9', lon: 21.02, lat: 52.2, kod: '02-943' },
  { ulica: 'ulica Polna', nr: '5', lon: 21.02, lat: 52.22, kod: '00-622' },
  { ulica: 'ulica Polna', nr: '5', lon: 21.4, lat: 52.3, kod: '05-077' },
  { ulica: 'ulica Trakt Brzeski', nr: '18', lon: 21.2, lat: 52.24, kod: '05-077' },
]
const indeks = indeksAdresow(adresy)

test('klucz ulicy: przedrostki, wielkość liter, polskie znaki, myślniki', () => {
  assert.equal(kluczUlicy('ul. Elbląska'), 'elblaska')
  assert.equal(kluczUlicy('ulica Elbląska'), 'elblaska')
  assert.equal(kluczUlicy('UL. ŁÓDZKA'), 'lodzka')
  assert.equal(kluczUlicy('al. Jana Pawła II'), 'jana pawla ii')
  assert.equal(kluczUlicy('Aleje Jerozolimskie'), 'jerozolimskie')
  assert.equal(kluczUlicy('Plac Wojska Polskiego'), 'wojska polskiego')
  assert.equal(kluczUlicy('ul. Karaszewicza - Tokarzewskiego'), 'karaszewicza-tokarzewskiego')
})

test('rozbicie adresu: zakresy, litery, kod, nawiasy, lokal, opis po myślniku, cudzysłowy', () => {
  assert.deepEqual(rozbijAdres('ul. Chłodna 36/46'), {
    ulica: 'ul. Chłodna',
    numer: '36/46',
    kod: null,
  })
  assert.equal(rozbijAdres('Aleja Jana Pawła II 26 a').numer, '26A')
  assert.deepEqual(rozbijAdres('ul. B. Limanowskiego 9, 02-943 Warszawa'), {
    ulica: 'ul. B. Limanowskiego',
    numer: '9',
    kod: '02-943',
  })
  assert.equal(rozbijAdres('Trakt Brzeski (Wesoła) 18').ulica, 'Trakt Brzeski')
  assert.equal(rozbijAdres('Namysłowska 1 - filia szkoły').numer, '1')
  assert.equal(rozbijAdres('ul. Złota 5 lok. 3').numer, '5')
  assert.equal(rozbijAdres('Aleja 3 Maja 5').ulica, 'Aleja 3 Maja')
  assert.equal(
    rozbijAdres('ul. gen. Ziemskiego "Wachnowskiego" 22').ulica,
    'ul. gen. Ziemskiego Wachnowskiego',
  )
  assert.equal(rozbijAdres('ul. Bez Numeru').numer, null)
})

test('numery do sprawdzenia: pełny, człony, bez litery', () => {
  assert.deepEqual(numeryDoSprawdzenia('36/46'), ['36/46', '36', '46'])
  assert.deepEqual(numeryDoSprawdzenia('12A'), ['12A', '12'])
  assert.deepEqual(numeryDoSprawdzenia(null), [])
})

test('słowa pasują: inicjał i pominięte imię, bez powtórnego użycia słowa', () => {
  assert.equal(slowaPasuja(['b', 'limanowskiego'], ['boleslawa', 'limanowskiego']), true)
  assert.equal(slowaPasuja(['reymonta'], ['wladyslawa', 'reymonta']), true)
  assert.equal(slowaPasuja(['a', 'a'], ['adama']), false)
})

test('geokodowanie: dokładne, zakres, litera, skrócona ulica, brak', () => {
  assert.equal(geokoduj('ul. Elbląska 51', indeks).lon, 20.95)
  assert.equal(geokoduj('ul. Chłodna 36/46', indeks).lat, 52.23)
  assert.equal(geokoduj('ul. Chłodna 48/50', indeks).lat, 52.231) // pełnego numeru brak, pierwszy człon jest
  assert.equal(geokoduj('Aleja Jana Pawła II 26A', indeks).lat, 52.24)
  assert.equal(geokoduj('Aleja Jana Pawła II 26B', indeks).lat, 52.241) // bez litery
  assert.match(geokoduj('ul. B. Limanowskiego 9, 02-943 Warszawa', indeks).metoda, /skrocona/)
  assert.equal(geokoduj('ul. Nieistniejąca 1', indeks).powod.startsWith('brak adresu'), true)
  assert.equal(geokoduj('ul. Elbląska', indeks).powod, 'brak numeru budynku')
})

test('ta sama ulica i numer w dwóch miejscach: kandydaci, nie zgadywanie', () => {
  const g = geokoduj('ul. Polna 5', indeks)
  assert.equal(g.powod, 'adres w kilku odległych punktach')
  assert.equal(g.kandydaci.length, 2)
  assert.equal(geokoduj('ul. Polna 5, 00-622 Warszawa', indeks).lat, 52.22) // kod rozstrzyga
})

test('boiska: unikalne adresy, rozstrzyganie po dzielnicy, niedopasowane na liście', () => {
  const rek = (adres, dzielnica = 'Wola') => ({
    'Adres obiektu': adres,
    Dzielnica: dzielnica,
    'Typ obiektu': 'x',
  })
  const g = geokodujBoiska(
    [
      rek('ul. Chłodna 36/46'),
      rek('ul. Chłodna 36/46'),
      rek('ul. Elbląska 51'),
      rek('ul. Polna 5'),
      rek('ul. Nigdzie 1'),
    ],
    adresy,
  )
  assert.equal(g.adresy.unikalne, 4)
  assert.equal(g.rekordy.wszystkie, 5)
  assert.equal(g.rekordy.dopasowane, 4)
  assert.deepEqual(
    g.niedopasowane.map((n) => n.adres),
    ['ul. Nigdzie 1'],
  )
  assert.equal(g.adresy.dopasowane, g.punkty.length)
  // Polna 5 ma dwa skupiska; środek dzielnicy Wola (Chłodna, Elbląska) jest wyraźnie bliżej pierwszego.
  assert.equal(g.punkty.find((p) => p.atr.adres === 'ul. Polna 5')?.lat, 52.22)
})

test('środki dzielnic: mediana, punkty bez dzielnicy pomijane', () => {
  const c = srodkiPoDzielnicach([
    { dzielnica: 'A', lon: 1, lat: 10 },
    { dzielnica: 'A', lon: 3, lat: 30 },
    { dzielnica: 'A', lon: 2, lat: 20 },
    { dzielnica: null, lon: 9, lat: 9 },
  ])
  assert.deepEqual(c.get('A'), { lon: 2, lat: 20 })
  assert.equal(c.size, 1)
})

const plik = join(DANE, 'wskazniki', 'boisko_otwarte_odleglosc.json')
test('wygenerowany plik: kontrakt', { skip: !existsSync(plik) }, () => {
  const w = JSON.parse(readFileSync(plik, 'utf8'))
  assert.equal(w.meta.kategoria, 'codziennosc')
  assert.equal(w.meta.kierunek, 'mniej-lepiej')
  assert.ok(w.wartosci.every((v) => v === null || v >= 0))
})
