import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { latLngToCell } from 'h3-js'
import { wynikiHeksow } from '../src/wynik/heksy.ts'
import {
  listaHeksow,
  niezgodnoscKompaktu,
  odczytajKafel,
  rozpakuj,
  sekcja,
} from '../src/wynik/kompakt.ts'
import { zbudujKompakt } from './kompakt.mjs'

const komorki = [latLngToCell(50.061, 19.937, 10), latLngToCell(50.062, 19.939, 10)]
const adresy = {
  wersja: 'test-1',
  zrodla: [],
  kolumny: {
    id: ['msip-10', 'msip-11', 'msip-12'],
    miejscowosc: ['Kraków', 'Kraków', 'Kraków'],
    ulica: ['Grodzka', 'Grodzka', 'Floriańska'],
    nr: ['1', '2', '3'],
    kod: ['31-001', '31-001', '31-002'],
    dzielnica: ['I', 'I', 'I'],
    gmina: ['Kraków', 'Kraków', 'Kraków'],
    teryt: ['1261011', '1261011', '1261011'],
    lon: [19.937, 19.937, 19.939],
    lat: [50.061, 50.061, 50.062],
    h3: [komorki[0], komorki[0], komorki[1]],
  },
}
const meta = (id) => ({
  id,
  kategoria: 'transport',
  nazwa: id,
  opis: '',
  jednostka: '',
  kierunek: 'wiecej-lepiej',
  rozdzielczosc: 'adres',
  zakres: [0, 100],
  zadanie: 34,
  zrodla: [],
})
const warstwy = [
  { meta: meta('pelna'), wersjaAdresow: adresy.wersja, wartosci: [10, 20, 30] },
  { meta: meta('luka'), wersjaAdresow: adresy.wersja, wartosci: [null, null, 90] },
]

test('kompakt zachowuje heksy i wyłącza obszar, gdzie warstwy z danymi niosą < połowy wagi', async () => {
  const { indeks, pliki } = zbudujKompakt(adresy, warstwy)
  const manifest = {
    wygenerowano: 'test',
    wskazniki: warstwy.map((w) => ({ ...w.meta, wersjaAdresow: w.wersjaAdresow })),
  }
  assert.equal(niezgodnoscKompaktu(indeks, manifest), null)
  assert.match(
    niezgodnoscKompaktu(indeks, { ...manifest, wskazniki: [manifest.wskazniki[0]] }),
    /nadmiarowa/,
  )

  const heksy = await rozpakuj(pliki.get(indeks.heksy.plik))
  const ids = listaHeksow(heksy, 'r10')
  assert.deepEqual(ids, [...new Set(adresy.kolumny.h3)].sort())
  assert.equal(
    sekcja(heksy, 'liczba10').reduce((a, b) => a + b, 0),
    3,
  )
  const kafel = await odczytajKafel(pliki.get(indeks.kafle[0].plik))
  assert.equal(kafel.n, indeks.kafle[0].n)
  assert.equal(kafel.kolumny.id.length, kafel.n)

  const odczytaj = async (id) => {
    const bufor = pliki.get(indeks.wskazniki[id].heksy.plik)
    const r = await rozpakuj(bufor)
    return {
      ocena: { 10: sekcja(r, 'ocena10') },
      udzial: { 10: sekcja(r, 'udzial10') },
    }
  }
  const pelna = await odczytaj('pelna')
  const luka = await odczytaj('luka')
  const podstawa = {
    skalaOceny: heksy.naglowek.skalaOceny,
    skalaUdzialu: heksy.naglowek.skalaUdzialu,
    poziomy: { 10: { heksy: ids, liczba: sekcja(heksy, 'liczba10') } },
  }
  const policz = (wagaLuki) =>
    wynikiHeksow(
      podstawa,
      10,
      [
        { id: 'pelna', kierunek: 'wiecej-lepiej', waga: 1 },
        { id: 'luka', kierunek: 'wiecej-lepiej', waga: wagaLuki },
      ],
      (id) => ({ pelna, luka })[id] ?? null,
    )
  // Warstwa z luką niesie 3/4 wagi, a w heksie 0 nie ma danych → pokrycie 25% < 50% → wyłączony.
  const wynik = policz(3)
  assert.ok(Number.isNaN(wynik.wartosc[ids.indexOf(komorki[0])]))
  assert.ok(Number.isFinite(wynik.wartosc[ids.indexOf(komorki[1])]))
  // Równe wagi: połowa wagi ma dane (np. warstwa tylko-Kraków poza Krakowem) → heks zostaje (#148).
  assert.ok(Number.isFinite(policz(1).wartosc[ids.indexOf(komorki[0])]))
})

const katalog = new URL('../public/dane/kompakt/', import.meta.url)
test('dostarczony kompakt odpowiada bieżącym plikom wskaźników', {
  skip: !existsSync(katalog),
}, async () => {
  const indeks = JSON.parse(readFileSync(new URL('indeks.json', katalog), 'utf8'))
  const wskazniki = readdirSync(new URL('../wskazniki/', katalog))
    .filter((p) => p.endsWith('.json'))
    .map((p) => {
      const { meta, wersjaAdresow } = JSON.parse(
        readFileSync(new URL(`../wskazniki/${p}`, katalog), 'utf8'),
      )
      return { ...meta, wersjaAdresow }
    })
  assert.equal(niezgodnoscKompaktu(indeks, { wygenerowano: 'test', wskazniki }), null)
  assert.ok(!wskazniki.some((w) => w.id === 'upal_narazenie'))
  const heksy = await rozpakuj(readFileSync(new URL(indeks.heksy.plik, katalog)))
  assert.equal(listaHeksow(heksy, 'r10').length, sekcja(heksy, 'od').length)
  assert.equal(
    sekcja(heksy, 'liczba10').reduce((a, b) => a + b, 0),
    indeks.n,
  )
})
