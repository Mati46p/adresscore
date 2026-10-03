import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  KROK_M,
  najblizsze,
  opisWskaznika,
  sprawdzWykaz,
  wczytajWykaz,
  zaokraglij,
} from './kapieliska.mjs'
import { odlegloscMetry } from './lib/codziennosc-geo.mjs'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'

// Pauza (U+2014) jest zakazana w polskich tekstach projektu; zapis przez kod znaku, żeby sam
// plik testu jej nie zawierał.
const PAUZA = String.fromCharCode(0x2014)

const punkt = (id, lat, lon, reszta = {}) => ({
  id,
  etykieta: `K ${id}`,
  nazwa: `Kąpielisko ${id}`,
  gmina: 'Wieliczka',
  powiat: 'wielicki',
  adres: 'ul. Testowa',
  status2026: 'czynne',
  lat,
  lon,
  wykaz: { nazwa: 'Serwis', url: `https://sk.gis.gov.pl/kapielisko/${id.length}` },
  polozenie: {
    zrodlo: 'OSM',
    url: 'https://www.openstreetmap.org/way/1',
    pobrano: '2026-10-03',
    dokladnosc: 'ok. 250 m',
  },
  ...reszta,
})
const wykazZ = (...kapieliska) => ({ sezon: 2026, kapieliska })

test('wykaz z repozytorium przechodzi walidację i zawiera czynne kąpieliska Krakowa z PDF wykazu', () => {
  const { wykaz, kapieliska } = wczytajWykaz()
  assert.equal(wykaz.sezon, 2026)
  const krakow = kapieliska.filter((k) => k.gmina === 'Kraków').map((k) => k.etykieta)
  assert.deepEqual(krakow.sort(), [
    'Plaża Bagry',
    'Plaża Bagry Wschód',
    'Przylasek Rusiecki',
    'Zakrzówek',
  ])
  // Przystań Brzegi jest w uchwale, ale w 2026 r. nieczynna: nie ma jej w wykazie.
  assert.ok(!kapieliska.some((k) => /brzegi/i.test(k.nazwa)))
  // Każdy punkt ma własną stronę w Serwisie Kąpieliskowym i własne źródło położenia.
  assert.equal(new Set(kapieliska.map((k) => k.wykaz.url)).size, kapieliska.length)
  for (const k of kapieliska) assert.match(k.polozenie.pobrano, /^\d{4}-\d{2}-\d{2}$/)
})

test('walidacja wykazu odrzuca brak źródła, nieczynne kąpielisko i błędne współrzędne', () => {
  const dobry = punkt('a', 50.05, 19.95)
  assert.equal(sprawdzWykaz(wykazZ(dobry)).length, 1)
  assert.throws(() => sprawdzWykaz(wykazZ()), /brak pozycji/)
  assert.throws(() => sprawdzWykaz({ sezon: 2025, kapieliska: [dobry] }), /sezon/)
  assert.throws(() => sprawdzWykaz(wykazZ(dobry, dobry)), /powtórzone id/)
  assert.throws(
    () => sprawdzWykaz(wykazZ(punkt('b', 50.05, 19.95, { status2026: 'nieczynne' }))),
    /tylko kąpieliska czynne/,
  )
  assert.throws(() => sprawdzWykaz(wykazZ(punkt('c', 19.95, 50.05))), /poza Małopolską/)
  assert.throws(
    () =>
      sprawdzWykaz(
        wykazZ(punkt('d', 50.05, 19.95, { wykaz: { nazwa: 'x', url: 'https://x.pl' } })),
      ),
    /Serwisie Kąpieliskowym/,
  )
  assert.throws(
    () => sprawdzWykaz(wykazZ(punkt('e', 50.05, 19.95, { polozenie: { zrodlo: 'z' } }))),
    /polozenie wymaga/,
  )
  assert.throws(
    () => sprawdzWykaz(wykazZ(punkt('f', 50.05, 19.95, { gmina: 'Kraków' }))),
    /uchwala/,
  )
  assert.equal(
    sprawdzWykaz(
      wykazZ(
        punkt('g', 50.05, 19.95, {
          gmina: 'Kraków',
          uchwala: { url: 'https://www.bip.krakow.pl/?dok_id=247780' },
        }),
      ),
    ).length,
    1,
  )
})

test('najbliższe kąpielisko: odległość geodezyjna, remis wygrywa pierwsze, brak współrzędnych to null', () => {
  const bliski = punkt('bliski', 50.06, 19.94)
  const daleki = punkt('daleki', 50.06, 20.04)
  const wynik = najblizsze({ lat: 50.0601, lon: 19.94 }, [daleki, bliski])
  assert.equal(wynik.kapielisko.id, 'bliski')
  assert.ok(wynik.metry > 10 && wynik.metry < 12)
  const naMiejscu = punkt('namiejscu', 50.06, 19.99)
  assert.equal(
    najblizsze({ lat: 50.06, lon: 19.99 }, [bliski, naMiejscu]).kapielisko.id,
    'namiejscu',
  )
  const remis = [punkt('p1', 50.07, 19.99), punkt('p2', 50.07, 19.99)]
  assert.equal(najblizsze({ lat: 50.06, lon: 19.99 }, remis).kapielisko.id, 'p1')
  assert.equal(najblizsze({ lat: Number.NaN, lon: 19.9 }, [bliski]), null)
})

test('zaokrąglenie do 50 m: pół kroku w górę, wartości są wielokrotnością kroku', () => {
  assert.equal(KROK_M, 50)
  assert.equal(zaokraglij(0), 0)
  assert.equal(zaokraglij(24.9), 0)
  assert.equal(zaokraglij(25), 50)
  assert.equal(zaokraglij(3551), 3550)
  assert.equal(zaokraglij(17876), 17900)
  assert.equal(zaokraglij(123, 100), 100)
})

test('opis wskaźnika wymienia kąpieliska, mówi że to nie trasa i nie zawiera pauzy', () => {
  const { kapieliska } = wczytajWykaz()
  const opis = opisWskaznika(kapieliska)
  for (const k of kapieliska) assert.ok(opis.includes(k.etykieta), k.etykieta)
  assert.match(opis, /nie jest trasa ani czas dojazdu/)
  assert.match(opis, /OpenStreetMap/)
  assert.ok(!opis.includes(PAUZA))
})

test('plik wskaźnika: jedna wartość na adres, odległość do najbliższego punktu z wykazu', (t) => {
  const sciezka = join(DANE, 'wskazniki', 'kapielisko_odleglosc.json')
  if (!existsSync(sciezka)) return t.skip('brak wygenerowanego pliku (node etl/kapieliska.mjs)')
  const plik = JSON.parse(readFileSync(sciezka, 'utf8'))
  const { wersja, adresy } = wczytajAdresy()
  const { kapieliska } = wczytajWykaz()
  assert.equal(plik.wersjaAdresow, wersja)
  assert.equal(plik.wartosci.length, adresy.length)
  assert.equal(plik.etykiety.length, adresy.length)
  assert.equal(plik.meta.kategoria, 'kontekst')
  assert.equal(plik.meta.kierunek, 'neutralny')
  assert.equal(plik.meta.zadanie, 125)
  assert.ok(plik.meta.zrodla.every((z) => z.url && z.licencja && z.dataDanych && z.pobrano))
  const nazwy = new Set(kapieliska.map((k) => k.etykieta))
  const maks = plik.wartosci.reduce((m, w) => Math.max(m, w), 0)
  assert.ok(maks <= plik.meta.zakres[1], `maks ${maks} poza zakresem ${plik.meta.zakres}`)
  // Co 997. adres liczymy od nowa brutalnie: wynik musi się zgadzać z plikiem.
  for (let i = 0; i < adresy.length; i += 997) {
    const a = adresy[i]
    const wzor = kapieliska
      .map((k) => ({ k, m: odlegloscMetry(a.lat, a.lon, k.lat, k.lon) }))
      .sort((x, y) => x.m - y.m)[0]
    assert.equal(plik.wartosci[i], zaokraglij(wzor.m), `adres ${a.id}`)
    assert.equal(plik.etykiety[i], wzor.k.etykieta, `adres ${a.id}`)
    assert.ok(nazwy.has(plik.etykiety[i]))
  }
  assert.ok(plik.wartosci.every((w) => Number.isInteger(w) && w % KROK_M === 0 && w >= 0))
})
