import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import {
  ETYKIETA,
  opisWskaznika,
  podobszary,
  wartoscAdresu,
  znajdzPodobszar,
} from './rewitalizacja.mjs'
import { PRZENIESIONE } from './uprosc-kryteria.mjs'

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
/** Kwadrat przesunięty o dx, dy stopni względem punktu odniesienia w Krakowie (19,9 E, 50,0 N). */
const LON0 = 19.9
const LAT0 = 50.0
const kw = (x0, y0, x1, y1) => kwadrat(LON0 + x0, LAT0 + y0, LON0 + x1, LAT0 + y1)
const cecha = (nazwa, geometria, uchwala = UCHWALA) => ({
  type: 'Feature',
  properties: { nazwa_gpr: nazwa, uchwała: uchwala },
  geometry: geometria,
})
const zbior = (...features) => ({ type: 'FeatureCollection', features })

test('znajdzPodobszar: Polygon z otworem, MultiPolygon i punkt w obwiedni poza częściami', () => {
  const lista = podobszary(
    zbior(
      cecha('Podobszar rewitalizacji A', {
        type: 'Polygon',
        coordinates: [kw(0, 0, 0.1, 0.1), kw(0.04, 0.04, 0.06, 0.06)],
      }),
      cecha('Podobszar rewitalizacji B', {
        type: 'MultiPolygon',
        coordinates: [[kw(0.2, 0.2, 0.3, 0.3)], [kw(0.5, 0.5, 0.6, 0.6)]],
      }),
    ),
  )
  assert.equal(lista.length, 2)
  const gdzie = (dx, dy) => znajdzPodobszar(LON0 + dx, LAT0 + dy, lista)
  assert.equal(gdzie(0.02, 0.02).nazwa, 'Podobszar rewitalizacji A')
  assert.equal(gdzie(0.05, 0.05), null, 'w otworze')
  assert.equal(gdzie(0.25, 0.25).nazwa, 'Podobszar rewitalizacji B', 'pierwsza część')
  assert.equal(gdzie(0.55, 0.55).nazwa, 'Podobszar rewitalizacji B', 'druga część')
  assert.equal(gdzie(0.4, 0.4), null, 'w obwiedni B, ale poza jego częściami')
  assert.equal(gdzie(0.9, 0.9), null, 'poza wszystkimi')
})

test('podobszary: zła uchwała, geometria albo ucięta warstwa zatrzymują eksport', () => {
  const dobry = { type: 'Polygon', coordinates: [kw(0, 0, 0.1, 0.1)] }
  assert.equal(podobszary(zbior(cecha('X', dobry))).length, 1)
  assert.throws(() => podobszary(zbior(cecha('X', dobry, 'Uchwała XX/1/30'))), /poza uchwałą/)
  assert.throws(() => podobszary(zbior(cecha('', dobry))), /bez nazwy/)
  assert.throws(
    () => podobszary(zbior(cecha('X', { type: 'Point', coordinates: [19.9, 50] }))),
    /wielokąta/,
  )
  assert.throws(() => podobszary(zbior()), /pusta/)
  assert.throws(() => podobszary({ type: 'Feature' }), /FeatureCollection/)
  assert.throws(
    () => podobszary({ ...zbior(cecha('X', dobry)), exceededTransferLimit: true }),
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
        coordinates: [kw(0, 0, 0.1, 0.1)],
      }),
      cecha('Podobszar rewitalizacji Kazimierz-Stradom', {
        type: 'Polygon',
        coordinates: [kw(0.2, 0.2, 0.3, 0.3)],
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
  // Od #171 grupę i kierunek nadaje PRZENIESIONE (etl/uprosc-kryteria.mjs), z wagą startową 0.
  assert.deepEqual([plik.meta.kategoria, plik.meta.kierunek], PRZENIESIONE.obszar_rewitalizacji)
  assert.equal(plik.meta.domyslnaWaga, 0)
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
