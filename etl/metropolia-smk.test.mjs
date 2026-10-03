import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { IndeksOdcinkow, IndeksWielokatow } from './lib/odleglosc-ksztalty.mjs'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import {
  czyCiekNaPowierzchni,
  czyLiceumDlaMlodziezy,
  dataStanu,
  kwantyle,
  odleglosciDoIndeksu,
  punktyGeometrii,
  punktyLiceow,
  terytyGmin,
  zgodnoscAdresowZGranicami,
} from './metropolia-smk.mjs'

test('liceum dla młodzieży: filtr nazw, także z zepsutym kodowaniem gmin', () => {
  for (const nazwa of [
    'XIV LICEUM OGÓLNOKSZTAŁCĄCE IM. MIKOŁAJA KOPERNIKA W KRAKOWIE',
    'NIEPUBLICZNE LICEUM OGÓLNOKSZTAŁCĄCE "WOLNA SZKOŁA"',
    'LICEUM_OGĂ“LNOKSZTAĹCÄ„CE_W_ĹšWIÄ„TNIKACH_GĂ“RNYCH',
    'LICEUM_OGOLNOKSZATALCACE_SMS',
  ])
    assert.equal(czyLiceumDlaMlodziezy(nazwa, 170), true, nazwa)
  for (const nazwa of [
    'XI LICEUM OGÓLNOKSZTAŁCĄCE SPECJALNE DLA DOROSŁYCH W KRAKOWIE',
    'LICEUM_OGĂ“LNOKSZTAĹCÄ„CE_DLA_DOROSĹYCH',
    'ZAOCZNE LICEUM OGÓLNOKSZTAŁCĄCE DLA DOROSŁYCH "COSINUS PLUS" W KRAKOWIE',
    'II_ZAOCZNE_LICEUM_OGĂ“LNOKSZTAĹCÄ„CE_CENTRUM_KSZTAĹCENIA_SUPLEMENT',
    'LIC.OG.._PO_GIM.ZAOCZNE',
    'TECHNIKUM_W_WIELICZCE',
    'NIEPUBLICZNE_GIMNAZJUM_SPECJALNE_W_RADWANOWICACH',
    'LICEUM WIECZOROWE',
    'SZKOŁA PODSTAWOWA NR 1',
  ])
    assert.equal(czyLiceumDlaMlodziezy(nazwa, 100), false, nazwa)
  // 0 uczniów w danych = szkoła nieczynna; brak informacji o uczniach (Kraków) nie wyklucza
  assert.equal(czyLiceumDlaMlodziezy('LICEUM_OGĂ“LNOKSZTAĹCÄ„CE', 0), false)
  assert.equal(czyLiceumDlaMlodziezy('LICEUM OGÓLNOKSZTAŁCĄCE', null), true)
  assert.equal(czyLiceumDlaMlodziezy(undefined, 10), false)
})

test('cieki pod ziemią nie są wodą na powierzchni', () => {
  assert.equal(czyCiekNaPowierzchni({ polozenie: 0 }), true)
  assert.equal(czyCiekNaPowierzchni({ polozenie: -1 }), false)
})

test('geometria Esri: punkt, wielopunkt, brak geometrii', () => {
  assert.deepEqual(punktyGeometrii({ x: 1, y: 2 }), [[1, 2]])
  assert.deepEqual(
    punktyGeometrii({
      points: [
        [1, 2],
        [3, 4],
      ],
    }),
    [
      [1, 2],
      [3, 4],
    ],
  )
  assert.deepEqual(punktyGeometrii(null), [])
  assert.deepEqual(punktyGeometrii({}), [])
})

test('punkty liceów: Kraków po NZ_PL, gminy po NAZWA_SZK i liczbie uczniów', () => {
  const krakow = [
    { attributes: { NZ_PL: 'I LICEUM OGÓLNOKSZTAŁCĄCE' }, geometry: { points: [[1, 1]] } },
    { attributes: { NZ_PL: 'VI LICEUM DLA DOROSŁYCH' }, geometry: { points: [[2, 2]] } },
  ]
  const gminy = [
    {
      attributes: { NAZWA_SZK: 'LICEUM_OGOLNOKSZTALCACE', L_UCZNIOW: 30 },
      geometry: { x: 3, y: 3 },
    },
    {
      attributes: { NAZWA_SZK: 'LICEUM_OGOLNOKSZTALCACE', L_UCZNIOW: 0 },
      geometry: { x: 4, y: 4 },
    },
    { attributes: { NAZWA_SZK: 'TECHNIKUM', L_UCZNIOW: 300 }, geometry: { x: 5, y: 5 } },
  ]
  const r = punktyLiceow(krakow, gminy)
  assert.deepEqual(r.punkty, [
    [1, 1],
    [3, 3],
  ])
  assert.equal(r.krakow, 1)
  assert.equal(r.gminy, 1)
})

test('TERYT gmin modelu i data stanu warstwy', () => {
  assert.deepEqual(
    [
      ...terytyGmin([
        { attributes: { idTerytTer: 1261011 } },
        { attributes: { idTerytTer: 1206152 } },
      ]),
    ],
    ['1261011', '1206152'],
  )
  const dzien = (iso) => ({ attributes: { data_utworzenia: Date.parse(iso) } })
  assert.equal(dataStanu([dzien('2021-12-16'), dzien('2021-12-16')]), '2021-12-16')
  assert.equal(dataStanu([dzien('2022-01-05'), dzien('2021-12-16')]), '2021-12-16/2022-01-05')
  assert.throws(() => dataStanu([]), /Brak obiektów/)
})

test('odległości: null dla adresu bez danych, 0 w zbiorniku, zaokrąglenie, limit zasięgu', () => {
  const indeks = new IndeksOdcinkow(100)
  indeks.dodajLamana([
    [0, 0],
    [1000, 0],
  ])
  const zbiorniki = new IndeksWielokatow(100)
  zbiorniki.dodaj([
    [
      [0, 500],
      [100, 500],
      [100, 600],
      [0, 600],
      [0, 500],
    ],
  ])
  const punkty = [null, [500, 12.4], [500, 12.6], [50, 550], [5000, 5000]]
  assert.deepEqual(odleglosciDoIndeksu(punkty, indeks, 3000, zbiorniki), [null, 12, 13, 0, null])
})

test('kwantyle pomijają braki danych', () => {
  const k = kwantyle([null, 10, 20, 30, 40, null, 50, 60, 70, 80, 90, 100])
  assert.equal(k.n, 10)
  assert.equal(k.max, 100)
  assert.equal(k.p50, 60)
})

test('zgodność adresów z granicami gmin: adres w cudzej gminie i gmina bez wielokąta', () => {
  const gminy = [
    {
      attributes: { idTerytTer: 1 },
      geometry: {
        rings: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      },
    },
  ]
  const adresy = [
    { teryt: '1', lon: 5, lat: 5 },
    { teryt: '1', lon: 15, lat: 5 },
    { teryt: '2', lon: 5, lat: 5 },
  ]
  const tozsamosc = { forward: (p) => p }
  const z = zgodnoscAdresowZGranicami(adresy, tozsamosc, gminy, 1)
  assert.deepEqual(z, { ocenione: 2, wGminie: 1, udzial: 0.5 })
})

const WSKAZNIKI = {
  liceum_odleglosc: { kategoria: 'codziennosc', zrodel: 2 },
  droga_rowerowa_odleglosc: { kategoria: 'transport', zrodel: 1 },
  woda_odleglosc: { kategoria: 'kontekst', zrodel: 2 },
}
const wczytaj = (id) => JSON.parse(readFileSync(join(DANE, 'wskazniki', `${id}.json`), 'utf8'))

test('opublikowane wskaźniki: wersja, kontrakt, atrybucja MSIP i data stanu', () => {
  const { wersja, adresy } = wczytajAdresy()
  for (const [id, oczekiwane] of Object.entries(WSKAZNIKI)) {
    const p = wczytaj(id)
    assert.equal(p.wersjaAdresow, wersja, id)
    assert.equal(p.wartosci.length, adresy.length, id)
    assert.equal(p.meta.id, id)
    assert.equal(p.meta.zadanie, 113)
    assert.equal(p.meta.kategoria, oczekiwane.kategoria)
    // neutralny: dane z 2021 r. i niepełne pokrycie – bez kierunku nie liczą się do wyniku
    assert.equal(p.meta.kierunek, 'neutralny')
    assert.equal(p.meta.rozdzielczosc, 'adres')
    assert.equal(p.meta.jednostka, 'm')
    assert.equal(p.meta.atrapa, undefined)
    assert.equal(p.etykiety, undefined)
    assert.equal(p.meta.zrodla.length, oczekiwane.zrodel)
    for (const z of p.meta.zrodla) {
      assert.match(
        z.nazwa,
        /Gmina Miejska Kraków, Portal MSIP Obserwatorium \(https:\/\/msip\.krakow\.pl\)/,
      )
      assert.match(
        z.url,
        /^https:\/\/msip\.um\.krakow\.pl\/arcgis\/rest\/services\/Metropolia_Krakowska\//,
      )
      assert.match(z.licencja, /Regulamin MSIP/)
      assert.match(z.dataDanych, /^\d{4}-\d{2}-\d{2}$/)
      assert.match(z.pobrano, /^\d{4}-\d{2}-\d{2}$/)
      // opis podaje stan danych, więc nie może się rozjechać z datą w źródle
      assert.ok(p.meta.opis.includes(z.dataDanych), `${id}: opis bez daty ${z.dataDanych}`)
    }
    assert.equal(
      JSON.stringify(p.meta).includes(String.fromCharCode(0x2014)),
      false,
      'pauza zamiast półpauzy',
    )
  }
})

test('opublikowane wskaźniki: null tylko poza obszarem SMK (Koniusza), reszta to metry', () => {
  const { adresy } = wczytajAdresy()
  const poza = adresy.map((a) => a.teryt === '1214012')
  assert.equal(poza.filter(Boolean).length, 2945)
  for (const id of Object.keys(WSKAZNIKI)) {
    const { wartosci } = wczytaj(id)
    for (let i = 0; i < adresy.length; i++) {
      if (poza[i]) assert.equal(wartosci[i], null, `${id}[${i}] poza SMK`)
      else {
        assert.ok(Number.isInteger(wartosci[i]) && wartosci[i] >= 0, `${id}[${i}] = ${wartosci[i]}`)
        assert.ok(wartosci[i] < 20000, `${id}[${i}] = ${wartosci[i]} m`)
      }
    }
  }
})

test('kontrola na znanych adresach: szkoły, Rynek Główny, rynki gmin', () => {
  const { adresy } = wczytajAdresy()
  const w = Object.fromEntries(Object.keys(WSKAZNIKI).map((id) => [id, wczytaj(id).wartosci]))
  const adres = (gmina, ulica, nr) => {
    const a = adresy.find((x) => x.gmina === gmina && x.ulica === ulica && x.nr === nr)
    assert.ok(a, `brak adresu ${gmina} ${ulica} ${nr}`)
    return a.i
  }
  // pod adresem liceum jest liceum (współrzędne szkoły to punkt adresowy EMUiA w tym samym układzie)
  for (const [ulica, nr] of [
    ['Studencka', '12'],
    ['Grzegórzecka', '24'],
    ['Krupnicza', '44'],
    ['Jana Sobieskiego', '9'],
    ['Zawiła', '4'],
  ])
    assert.ok(w.liceum_odleglosc[adres('Kraków', ulica, nr)] <= 5, `${ulica} ${nr}`)

  const rynek = adres('Kraków', 'Rynek Główny', '1')
  // Stare Miasto: kilka liceów w promieniu 300 m, główna trasa rowerowa przy Rynku,
  // Wisła ok. 880 m od osi koryta, a najbliższy zbiornik to staw przy Plantach
  assert.ok(w.liceum_odleglosc[rynek] > 50 && w.liceum_odleglosc[rynek] < 500)
  assert.ok(w.droga_rowerowa_odleglosc[rynek] < 150)
  assert.ok(w.woda_odleglosc[rynek] > 300 && w.woda_odleglosc[rynek] <= 881)

  // Rynki miast obwarzanka mają liceum w zasięgu spaceru, a Radziszów (wieś) nie
  assert.ok(w.liceum_odleglosc[adres('Skawina', 'Rynek', '1')] < 500)
  assert.ok(w.liceum_odleglosc[adres('Niepołomice', 'Rynek', '1')] < 1000)
  assert.ok(w.liceum_odleglosc[adres('Wieliczka', 'Rynek Górny', '1')] < 1500)
  const radziszow = adresy.find((a) => a.miejscowosc === 'Radziszów' && a.ulica === 'Rynek')
  assert.ok(w.liceum_odleglosc[radziszow.i] > 2000)
})
