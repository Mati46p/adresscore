import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import {
  ETYKIETA,
  opisWskaznika,
  podobszary,
  punktWWielokacie,
  wartoscAdresu,
  znajdzPodobszar,
} from './rewitalizacja.mjs'

// Pauza (U+2014) jest zakazana w polskich tekstach projektu; zapis przez kod znaku, żeby sam
// plik testu jej nie zawierał.
const PAUZA = String.fromCharCode(0x2014)

const UCHWALA =
  'Uchwała Nr XCVII/2644/22 Rady Miasta Krakowa z dnia 12 października 2022 r. w sprawie wyznaczenia obszaru zdegradowanego oraz obszaru rewitalizacji w Mieście Krakowie'
const kwadrat = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
]
const cecha = (nazwa, geometria, uchwala = UCHWALA) => ({
  type: 'Feature',
  properties: { nazwa_gpr: nazwa, uchwała: uchwala },
  geometry: geometria,
})
const zbior = (...features) => ({ type: 'FeatureCollection', features })

test('punkt w wielokącie: obrys, otwór i brzeg bbox', () => {
  const zOtworem = [kwadrat(0, 0, 10, 10), kwadrat(4, 4, 6, 6)]
  assert.equal(punktWWielokacie(2, 2, zOtworem), true)
  assert.equal(punktWWielokacie(5, 5, zOtworem), false, 'w otworze')
  assert.equal(punktWWielokacie(11, 5, zOtworem), false, 'poza obrysem')
  assert.equal(punktWWielokacie(5, -1, zOtworem), false)
  // Wielokąt wklęsły (litera L): punkt w wycięciu jest poza.
  const el = [
    [
      [0, 0],
      [4, 0],
      [4, 2],
      [2, 2],
      [2, 4],
      [0, 4],
      [0, 0],
    ],
  ]
  assert.equal(punktWWielokacie(1, 3, el), true)
  assert.equal(punktWWielokacie(3, 3, el), false)
})

test('podobszary: Polygon i MultiPolygon, a zła uchwała albo geometria zatrzymuje eksport', () => {
  const lista = podobszary(
    zbior(
      cecha('Podobszar rewitalizacji A', { type: 'Polygon', coordinates: [kwadrat(0, 0, 1, 1)] }),
      cecha('Podobszar rewitalizacji B', {
        type: 'MultiPolygon',
        coordinates: [[kwadrat(2, 2, 3, 3)], [kwadrat(5, 5, 6, 6)]],
      }),
    ),
  )
  assert.equal(lista.length, 2)
  assert.deepEqual(lista[1].bbox, [2, 2, 6, 6])
  assert.equal(znajdzPodobszar(0.5, 0.5, lista).nazwa, 'Podobszar rewitalizacji A')
  assert.equal(znajdzPodobszar(5.5, 5.5, lista).nazwa, 'Podobszar rewitalizacji B')
  assert.equal(znajdzPodobszar(4, 4, lista), null, 'w bbox drugiego, ale poza jego częściami')
  assert.throws(
    () =>
      podobszary(
        zbior(
          cecha('X', { type: 'Polygon', coordinates: [kwadrat(0, 0, 1, 1)] }, 'Uchwała XX/1/30'),
        ),
      ),
    /poza uchwałą/,
  )
  assert.throws(
    () => podobszary(zbior(cecha('X', { type: 'Point', coordinates: [1, 1] }))),
    /wielokąta/,
  )
  assert.throws(() => podobszary(zbior()), /pusta/)
  assert.throws(() => podobszary({ type: 'Feature' }), /FeatureCollection/)
  assert.throws(
    () =>
      podobszary({
        ...zbior(cecha('X', { type: 'Polygon', coordinates: [kwadrat(0, 0, 1, 1)] })),
        exceededTransferLimit: true,
      }),
    /ucięta/,
  )
})

test('wartość adresu: 1 z etykietą w obszarze, 0 w Krakowie poza nim, null poza Krakowem', () => {
  const lista = podobszary(
    zbior(
      cecha('Podobszar rewitalizacji Kazimierz-Stradom', {
        type: 'Polygon',
        coordinates: [kwadrat(19.93, 50.05, 19.96, 50.06)],
      }),
    ),
  )
  const krakow = { teryt: '1261011' }
  assert.deepEqual(wartoscAdresu({ ...krakow, lon: 19.94, lat: 50.055 }, lista), {
    wartosc: 1,
    etykieta: 'objęty programem rewitalizacji',
    podobszar: 'Podobszar rewitalizacji Kazimierz-Stradom',
  })
  assert.deepEqual(wartoscAdresu({ ...krakow, lon: 19.8, lat: 50.0 }, lista), {
    wartosc: 0,
    etykieta: null,
    podobszar: null,
  })
  // Ten sam punkt współrzędnych, ale gmina Wieliczka: program Krakowa go nie dotyczy.
  assert.deepEqual(wartoscAdresu({ teryt: '1219053', lon: 19.94, lat: 50.055 }, lista), {
    wartosc: null,
    etykieta: null,
    podobszar: null,
  })
})

test('etykieta i opis: tylko „objęty programem rewitalizacji", bez pauzy i bez słowa o degradacji', () => {
  const lista = podobszary(
    zbior(
      cecha('Podobszar rewitalizacji „stara” Nowa Huta', {
        type: 'Polygon',
        coordinates: [kwadrat(0, 0, 1, 1)],
      }),
      cecha('Podobszar rewitalizacji Kazimierz-Stradom', {
        type: 'Polygon',
        coordinates: [kwadrat(2, 2, 3, 3)],
      }),
    ),
  )
  const opis = opisWskaznika(lista)
  assert.equal(ETYKIETA, 'objęty programem rewitalizacji')
  assert.match(opis, /„stara” Nowa Huta, Kazimierz-Stradom/)
  assert.match(opis, /nie wpływa na wynik/)
  for (const tekst of [opis, ETYKIETA]) {
    assert.ok(!tekst.includes(PAUZA))
    assert.ok(!/zdegradowan/i.test(tekst), tekst)
  }
})

test('plik wskaźnika: tylko Kraków ma wartość, Kazimierz w obszarze, Stare Miasto poza nim', (t) => {
  const sciezka = join(DANE, 'wskazniki', 'obszar_rewitalizacji.json')
  if (!existsSync(sciezka)) return t.skip('brak wygenerowanego pliku (node etl/rewitalizacja.mjs)')
  const plik = JSON.parse(readFileSync(sciezka, 'utf8'))
  const { wersja, adresy } = wczytajAdresy()
  assert.equal(plik.wersjaAdresow, wersja)
  assert.equal(plik.wartosci.length, adresy.length)
  assert.equal(plik.etykiety.length, adresy.length)
  assert.equal(plik.meta.kategoria, 'kontekst')
  assert.equal(plik.meta.kierunek, 'neutralny')
  assert.equal(plik.meta.jednostka, 'status')
  assert.equal(plik.meta.zadanie, 125)
  assert.ok(!JSON.stringify(plik.meta).includes(PAUZA))
  assert.ok(!/zdegradowan/i.test(JSON.stringify(plik.meta)), 'meta nie mówi o degradacji')
  assert.ok(plik.meta.zrodla.every((z) => z.url && z.licencja && z.dataDanych && z.pobrano))
  assert.match(plik.meta.zrodla[0].nazwa, /Gmina Miejska Kraków, Portal MSIP Obserwatorium/)

  let wObszarze = 0
  for (let i = 0; i < adresy.length; i++) {
    const a = adresy[i]
    const w = plik.wartosci[i]
    const e = plik.etykiety[i]
    if (a.teryt !== '1261011') {
      assert.equal(w, null, `poza Krakowem null: ${a.id}`)
      assert.equal(e, null)
      continue
    }
    assert.ok(w === 0 || w === 1, `w Krakowie 0 albo 1: ${a.id}`)
    assert.equal(e, w === 1 ? ETYKIETA : null)
    if (w === 1) wObszarze++
  }
  assert.ok(wObszarze > 1500 && wObszarze < 3500, `adresów w obszarze: ${wObszarze}`)

  const wartosciUlicy = (ulica) =>
    adresy.flatMap((a, i) => (a.gmina === 'Kraków' && a.ulica === ulica ? [plik.wartosci[i]] : []))
  for (const ulica of ['Szeroka', 'Miodowa', 'Józefa', 'Stradomska', 'Osiedle Teatralne']) {
    const w = wartosciUlicy(ulica)
    assert.ok(w.length > 0, ulica)
    assert.ok(
      w.every((x) => x === 1),
      `${ulica} leży w obszarze rewitalizacji`,
    )
  }
  for (const ulica of ['Rynek Główny', 'Floriańska', 'Grodzka']) {
    const w = wartosciUlicy(ulica)
    assert.ok(w.length > 0, ulica)
    assert.ok(
      w.every((x) => x === 0),
      `${ulica} leży poza obszarem rewitalizacji`,
    )
  }
})
