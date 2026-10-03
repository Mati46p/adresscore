import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { do2180 } from './lib/geo.mjs'
import { indeksPunktow, sumaWPromieniu } from './lib/przestrzen.mjs'
import { DANE } from './lib/wspolne.mjs'
import {
  czyBudynek,
  czyLiczona,
  idDzialki,
  kandydaciZastepczy,
  PROMIEN,
  pierwszyObiekt,
  punktDecyzji,
  zakresDecyzji,
  zbierzDecyzje,
} from './pozwolenia-obwarzanek.mjs'

const BUDOWA = 'budowa nowego/nowych obiektów budowlanych'
const ROZBUDOWA = 'rozbudowa istniejącego/istniejących obiektów budowlanych'
const dom = (opis, reszta = {}) => ({
  data: '2025-06-10',
  zakres: BUDOWA,
  kategoria: 'I',
  rodzaj: 'Budynek mieszkalny jednorodzinny',
  opis,
  ...reszta,
})

test('zakres: budowa, rozbudowa, nadbudowa; roboty inne tylko z opisu, reszta odpada', () => {
  assert.equal(zakresDecyzji({ zakres: BUDOWA }), 'budowa')
  assert.equal(zakresDecyzji({ zakres: ROZBUDOWA }), 'rozbudowa')
  assert.equal(
    zakresDecyzji({ zakres: 'nadbudowa istniejącego/istniejących obiektów budowlanych' }),
    'nadbudowa',
  )
  const inne = 'wykonanie robót budowlanych innych niż wymienione powyżej'
  assert.equal(zakresDecyzji({ zakres: inne, opis: 'Budowa budynku gospodarczego' }), 'budowa')
  assert.equal(
    zakresDecyzji({ zakres: inne, opis: 'ul. Balicka - Rozbudowa budynku' }),
    'rozbudowa',
  )
  assert.equal(zakresDecyzji({ zakres: inne, opis: 'Remont dachu' }), null)
  assert.equal(zakresDecyzji({ zakres: 'rozbiórka istniejącego obiektu budowlanego' }), null)
  assert.equal(
    zakresDecyzji({ zakres: 'odbudowa istniejącego/istniejących obiektów budowlanych' }),
    null,
  )
  assert.equal(zakresDecyzji({ zakres: null, opis: 'Nadbudowa budynku' }), 'nadbudowa')
})

test('pierwszy obiekt w opisie: dom z instalacjami to dom, instalacja w domu to instalacja', () => {
  const obiekt = [
    'Budowa budynku mieszkalnego jednorodzinnego wraz z wewnętrznymi instalacjami: wod.-kan.',
    'Budynek mieszkalny jednorodzinny z wewnętrznymi instalacjami: woda, c.o., gaz',
    'Budowa budynku mieszkalnego, jednorodzinnego z instalacjami wewnętrznymi',
    'Budowa garażu z instalacją elektryczną',
    'Budowa wiaty na dz. nr 447 w m. Jeziorzany',
    'Budowa boiska sportowego wielofunkcyjnego',
    'Budowa 2 boisk, budynku zaplecza socjalnego',
    'Rozbudowa Zespołu Szkolno - Przedszkolnego',
    'Budowa zespołu usługowego wraz z częścią socjalno-biurową',
    'Budowa 11 budynków mieszkalnych wielorodzinnych z infrastrukturą obejmującą: drogi',
  ]
  for (const o of obiekt) assert.equal(pierwszyObiekt(o), 'obiekt', o)
  const infrastruktura = [
    'Budowa wewnętrznej instalacji gazowej w budynku mieszkalnym jednorodzinnym',
    'Budowa muru oporowego na dz. nr 752/48',
    'Budowa ściany oporowej przy istniejącym budynku mieszkalnym',
    'Budowa drogi wewnętrznej, na dz. nr 160/8 w zabudowie mieszkalnej, jednorodzinnej',
    'Budowa oświetlenia ulicznego przy drodze gminnej',
    'Budowa instalacji fotowoltaicznej na dachu hali magazynowej',
    'Budowa przydomowej oczyszczalni ścieków dla budynku mieszkalnego',
    'Budowa sieci wodociągowej',
    'Budowa kanalizacji deszczowej dla czterech budynków mieszkalnych',
    'Budowa parkingu P&R wraz z budową budynku sanitarnego',
    'Budowa tarasu wraz ze schodami zewnętrznymi',
    'Budowa stacji bazowej telefonii komórkowej',
  ]
  for (const o of infrastruktura) assert.equal(pierwszyObiekt(o), 'infrastruktura', o)
  assert.equal(pierwszyObiekt('Zakład Produkcyjny Bell Polska Sp. z o. o.'), null)
  assert.equal(pierwszyObiekt(null), null)
})

test('bez rozstrzygnięcia w opisie decyduje rodzaj inwestycji i kategoria obiektu', () => {
  assert.equal(czyBudynek({ opis: 'Zakład Produkcyjny Bell', kategoria: 'XVIII' }), true)
  assert.equal(czyBudynek({ opis: 'Zakład Produkcyjny Bell', kategoria: 'XXVI' }), false)
  assert.equal(
    czyBudynek({
      opis: 'kan., gaz, c.o.',
      kategoria: 'VIII',
      rodzaj: 'Budynek mieszkalny jednorodzinny',
    }),
    true,
  )
  assert.equal(czyBudynek({ opis: null, kategoria: null, rodzaj: null }), false)
  // opis wygrywa z kategorią: „budynkowa" kategoria nie ratuje instalacji gazowej
  assert.equal(czyBudynek({ opis: 'Budowa instalacji gazowej w budynku', kategoria: 'I' }), false)
})

test('decyzja liczy się: okno dat, zakres, obiekt, bez zmian decyzji; winda przy rozbudowie wyklucza', () => {
  assert.equal(czyLiczona(dom('Budowa budynku mieszkalnego jednorodzinnego')), true)
  assert.equal(czyLiczona(dom('Budowa budynku', { data: '2025-01-01' })), true)
  assert.equal(czyLiczona(dom('Budowa budynku', { data: '2024-12-31' })), false)
  assert.equal(czyLiczona(dom('Budowa budynku', { data: undefined })), false)
  assert.equal(
    czyLiczona(dom('Budowa budynku', { zakres: 'rozbiórka istniejącego obiektu budowlanego' })),
    false,
  )
  assert.equal(czyLiczona(dom('Budowa wewnętrznej instalacji gazowej w budynku')), false)
  // zmiany wcześniejszych decyzji (także z literówką) to nie nowe pozwolenia
  assert.equal(
    czyLiczona(
      dom(
        'Zmiana decyzji nr AB.IV.1.1083.2022 z 16.09.2022, dla inwestycji pn.: „Budowa 21 budynków"',
      ),
    ),
    false,
  )
  assert.equal(
    czyLiczona(dom('ZMIANA ostatecznej decyzji o pozwoleniu na budowę nr AB.II-S.1.248.2021')),
    false,
  )
  assert.equal(czyLiczona(dom('Zmiana deyzji nr AB.IV.1.461.2023 z dnia 11.05.2023r.')), false)
  assert.equal(czyLiczona(dom('Zmiana sposobu użytkowania budynku na budynek usługowy')), true)
  // winda: dostawka do istniejącego budynku wyklucza, wzmianka przy nowym budynku nie
  assert.equal(
    czyLiczona(
      dom('Rozbudowa budynku o zewnętrzną windę', {
        zakres: ROZBUDOWA,
        kategoria: 'XVII',
        rodzaj: 'Inny',
      }),
    ),
    false,
  )
  assert.equal(
    czyLiczona(
      dom('Budowa budynku wielorodzinnego z windami i balkonami', {
        kategoria: 'XIII',
        rodzaj: 'Inny',
      }),
    ),
    true,
  )
})

test('rejestr bywa niespójny: opis przebudowy, rozbiórki albo windy nie jest nową zabudową', () => {
  const inne = 'wykonanie robót budowlanych innych niż wymienione powyżej'
  const rozb = (opis, reszta = {}) => dom(opis, { zakres: ROZBUDOWA, ...reszta })
  assert.equal(czyLiczona(rozb('Rozbudowa i przebudowa budynku mieszkalnego')), true)
  assert.equal(czyLiczona(rozb('Dobudowa ogrodu zimowego do budynku mieszkalnego')), true)
  assert.equal(czyLiczona(rozb('Przebudowa i remont budynku mieszkalnego wielorodzinnego')), false)
  // „budowlanych" to nie „budowa": przebudowa obiektów budowlanych nie jest rozbudową
  assert.equal(czyLiczona(rozb('Przebudowa istniejących obiektów budowlanych budynku')), false)
  assert.equal(czyLiczona(rozb('Rozbiórka budynku mieszkalno-gospodarczego murowanego')), false)
  assert.equal(
    czyLiczona(dom('Rozbiórka istniejącego budynku oraz budowa budynku garażowego')),
    true,
  )
  // winda, dźwig lub balkon jako przedmiot decyzji wykluczają także przy „budowie"
  assert.equal(
    czyLiczona(
      dom('Budowa szybu windowego i komunikacyjnego przy budynku szkoły', { zakres: inne }),
    ),
    false,
  )
  assert.equal(czyLiczona(dom('Budowa dźwigu osobowego w budynku', { zakres: inne })), false)
  assert.equal(czyLiczona(dom('Budowa budynku wielorodzinnego z windami i balkonami')), true)
})

test('identyfikator działki dla ULDK i działki zastępcze', () => {
  assert.equal(
    idDzialki({ jednostka: '121905_5', obreb: '0016', dzialka: ' 290/22' }),
    '121905_5.0016.290/22',
  )
  assert.equal(idDzialki({ jednostka: '126104_9', obreb: '0097', dzialka: '1' }), '126104_9.0097.1')
  assert.equal(idDzialki({ jednostka: '12190', obreb: '0016', dzialka: '1' }), null)
  assert.equal(idDzialki({ jednostka: '121905_5', obreb: '16', dzialka: '1' }), null)
  assert.equal(idDzialki({ jednostka: '121905_5', obreb: '0016', dzialka: '12, 13' }), null)
  assert.equal(idDzialki({ jednostka: '121905_5', obreb: '0016', dzialka: '' }), null)

  assert.deepEqual(kandydaciZastepczy('121904_5.0003.1522'), [
    '121904_5.0003.1522/1',
    '121904_5.0003.1522/2',
    '121904_5.0003.1522/3',
  ])
  assert.deepEqual(kandydaciZastepczy('120611_5.0015.943/4'), [
    '120611_5.0015.943/3',
    '120611_5.0015.943/5',
    '120611_5.0015.943/2',
    '120611_5.0015.943/6',
    '120611_5.0015.943',
  ])
  assert.deepEqual(kandydaciZastepczy('120611_5.0015.943/1'), [
    '120611_5.0015.943/2',
    '120611_5.0015.943/3',
    '120611_5.0015.943',
  ])
  assert.equal(kandydaciZastepczy('121904_5.0007.1540/4', '15')[0], '121904_5.0007.AR_15.1540/4')
  assert.deepEqual(kandydaciZastepczy('121904_5.0007.12A'), [])
})

test('decyzje: powtórzone wiersze się scalają, działki i jednostki zbierają', () => {
  const w = (dzialka, jednostka = '121905_5') => ({
    nr: 'ST-MA-WI/WNIOSEK/1/2025',
    data: '2025-02-01',
    zakres: BUDOWA,
    kategoria: 'I',
    rodzaj: null,
    opis: 'Budowa budynku',
    jednostka,
    obreb: '0001',
    dzialka,
    arkusz: null,
  })
  const d = zbierzDecyzje([w('1'), w('1'), w('2'), w('3', '121904_5'), w('???')])
  assert.equal(d.size, 1)
  const [x] = [...d.values()]
  assert.deepEqual(
    [...(x?.dzialki.keys() ?? [])],
    ['121905_5.0001.1', '121905_5.0001.2', '121904_5.0001.3'],
  )
  assert.deepEqual([...(x?.jednostki ?? [])].sort(), ['121904', '121905'])
})

test('punkt decyzji: środek działek ważony polem, działki bez geometrii pomijane', () => {
  const kw = (x, y, b) =>
    `POLYGON((${x} ${y},${x + b} ${y},${x + b} ${y + b},${x} ${y + b},${x} ${y}))`
  const geometrie = new Map([
    ['a', { wkt: kw(0, 0, 10) }],
    ['b', { wkt: kw(100, 0, 20) }],
    ['c', { brak: true }],
  ])
  const p = punktDecyzji(['a', 'b', 'c', 'd'], geometrie)
  assert.equal(p?.znalezione, 2)
  assert.ok(Math.abs((p?.x ?? 0) - 89) < 1e-9)
  assert.equal(punktDecyzji(['c', 'd'], geometrie), null)
  // działki odległe o ponad 2 km nie mają wspólnego położenia
  geometrie.set('daleko', { wkt: kw(5000, 0, 20) })
  assert.equal(punktDecyzji(['a', 'daleko'], geometrie), null)
  assert.ok(punktDecyzji(['a', 'b'], geometrie))
})

test('promień liczenia to 500 m włącznie z brzegiem, odległość płaska (wspólny indeks punktów)', () => {
  const indeks = indeksPunktow([
    [0, 0],
    [300, 400], // dokładnie 500
    [301, 400], // 500,0009
    [-499, 0],
    [0, 1000],
  ])
  assert.equal(PROMIEN, 500)
  assert.equal(sumaWPromieniu(indeks, 0, 0, PROMIEN), 3)
  assert.equal(sumaWPromieniu(indeks, 5000, 5000, PROMIEN), 0)
})

// ----- opublikowany plik wskaźnika ---------------------------------------------------------
// Czytane leniwie, żeby testy czystych funkcji działały też przed pierwszym biegiem ETL.
let zaladowane
function dane() {
  if (!zaladowane) {
    const adresy = JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8'))
    const plik = JSON.parse(
      readFileSync(join(DANE, 'wskazniki/inwestycje_500m_obwarzanek.json'), 'utf8'),
    )
    zaladowane = { adresy, plik, teryty: adresy.kolumny.teryt }
  }
  return zaladowane
}
const TERYT_KRAKOW = '1261011'

test('plik wskaźnika: wersja adresów, długość i metadane zgodne z kontraktem', () => {
  const { adresy, plik, teryty } = dane()
  assert.equal(plik.wersjaAdresow, adresy.wersja)
  assert.equal(plik.wartosci.length, teryty.length)
  const m = plik.meta
  assert.equal(m.id, 'inwestycje_500m_obwarzanek')
  assert.equal(m.zadanie, 123)
  assert.equal(m.kategoria, 'przyszlosc')
  assert.equal(m.rozdzielczosc, 'adres')
  assert.equal(m.kierunek, 'neutralny')
  assert.equal(m.jednostka, 'szt.')
  // ta sama skala co inwestycje_500m z MSIP, żeby Kraków i gminy były porównywalne
  const msip = JSON.parse(readFileSync(join(DANE, 'wskazniki/inwestycje_500m.json'), 'utf8')).meta
  assert.deepEqual(m.zakres, msip.zakres)
  assert.equal(m.jednostka, msip.jednostka)
  assert.equal(m.kategoria, msip.kategoria)
  assert.ok(m.zrodla.length >= 2)
  for (const z of m.zrodla)
    for (const k of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano']) assert.ok(z[k], k)
  assert.match(m.zrodla[0].url, /dane\.gov\.pl/)
  assert.match(m.zrodla[0].licencja, /CC0/)
  assert.match(m.opis, /500 m/)
  assert.ok(!m.opis.includes(String.fromCharCode(0x2014)), 'opis bez pauzy (używamy półpauzy)')
})

test('plik wskaźnika: Kraków to null, gminy obwarzanka to liczby całkowite, zero zmierzone', () => {
  const { plik, teryty } = dane()
  let obwarzanek = 0
  let zera = 0
  let suma = 0
  for (let i = 0; i < teryty.length; i++) {
    const v = plik.wartosci[i]
    if (teryty[i] === TERYT_KRAKOW) {
      assert.equal(v, null)
    } else {
      assert.ok(Number.isInteger(v) && v >= 0, `adres ${i}: ${v}`)
      obwarzanek++
      suma += v
      if (v === 0) zera++
    }
  }
  assert.equal(obwarzanek, teryty.filter((t) => t !== TERYT_KRAKOW).length)
  assert.ok(obwarzanek > 100_000, `adresów obwarzanka: ${obwarzanek}`)
  assert.ok(zera > 0, 'są adresy bez pozwoleń w 500 m (zmierzone zero)')
  assert.ok(zera / obwarzanek < 0.5, 'nie większość adresów bez pozwoleń')
  const srednia = suma / obwarzanek
  // MSIP w Krakowie: średnio 5,35; gminy obwarzanka mają rzadszą zabudowę, ale ten sam rząd wielkości
  assert.ok(srednia > 0.5 && srednia < 20, `średnia ${srednia}`)
})

test('znane miejsce: Podłęże, 11 decyzji z 2025-02-24 na jednej działce, to co najmniej 11 w 500 m', () => {
  const { adresy, plik, teryty } = dane()
  // ST-MA-WI/WNIOSEK/728…743/2025 (Niepołomice, obręb Podłęże, dz. 1522) – działka podzielona na 1522/1…
  // ULDK: środek 1522/1 to ok. (583434, 239885) w EPSG:2180.
  let najblizszy = { d: Infinity, i: -1 }
  for (let i = 0; i < teryty.length; i++) {
    if (teryty[i] !== '1219043') continue
    const [x, y] = do2180(adresy.kolumny.lon[i], adresy.kolumny.lat[i])
    const d = Math.hypot(x - 583434, y - 239885)
    if (d < najblizszy.d) najblizszy = { d, i }
  }
  assert.ok(najblizszy.d < 300, `najbliższy adres ${najblizszy.d} m`)
  assert.ok(plik.wartosci[najblizszy.i] >= 11, `wartość ${plik.wartosci[najblizszy.i]}`)
})
