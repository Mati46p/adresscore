import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { wczytajAdresy } from './lib/wspolne.mjs'
import {
  grupa,
  KOMISARIATY,
  komisariatDzielnicy,
  powiatAdresu,
  ROK,
  wartoscBdl,
} from './przestepstwa.mjs'
import { PRZENIESIONE } from './uprosc-kryteria.mjs'

const wczytaj = (sciezka) => JSON.parse(readFileSync(new URL(sciezka, import.meta.url), 'utf8'))
const REJONY = `../public/dane/przestepstwa_rejony_${ROK}.json`
// id warstwy → pole w pliku rejonów, z którego warstwa bierze wartość adresu
const POLE = {
  [`przestepstwa_1000_powiat_${ROK}`]: 'na1000',
  [`wykrywalnosc_powiat_${ROK}`]: 'wykrywalnosc',
}
const zaokr = (v) => (v === null ? null : Math.round(v * 100) / 100)
// Pauza (U+2014) w polskim tekście jest zakazana; budujemy ją z kodu, żeby sama nie trafiła do pliku.
const PAUZA = String.fromCharCode(0x2014)

test('każda z 18 dzielnic ma dokładnie jeden komisariat', () => {
  const wszystkie = KOMISARIATY.flatMap((k) => k.dzielnice)
  assert.equal(wszystkie.length, 18)
  assert.equal(new Set(wszystkie).size, 18)
})

test('dzielnica z adresów → komisariat', () => {
  assert.equal(komisariatDzielnicy('XIII Podgórze'), 'KP V')
  assert.equal(komisariatDzielnicy('IV Prądnik Biały'), 'KP III')
  assert.equal(komisariatDzielnicy('IX Łagiewniki-Borek Fałęcki'), 'KP V')
  assert.equal(komisariatDzielnicy('XVIII Nowa Huta'), 'KP VIII')
  assert.equal(komisariatDzielnicy(null), null)
  assert.equal(komisariatDzielnicy('Bez numeru'), null)
})

test('powiat adresu z TERYT', () => {
  assert.equal(powiatAdresu('1261011'), '1261')
  assert.equal(powiatAdresu('1214012'), '1214')
  assert.equal(powiatAdresu('1201011'), null)
  assert.throws(() => powiatAdresu('126'))
})

test('wartość BDL: rok, brak = null, kontrola nazwy', () => {
  const odp = {
    results: [
      { id: 'A', name: 'Powiat m. Kraków', values: [{ year: '2025', val: 22.95 }] },
      { id: 'B', name: 'Powiat krakowski', values: [] },
    ],
  }
  assert.equal(wartoscBdl(odp, 'A', 'Powiat m. Kraków', 2025), 22.95)
  assert.equal(wartoscBdl(odp, 'B', 'Powiat krakowski', 2025), null)
  assert.equal(wartoscBdl(odp, 'C', 'x', 2025), null)
  assert.throws(() => wartoscBdl(odp, 'A', 'Powiat wielicki', 2025))
})

test('wskaźniki przestępstw mają grupę z PRZENIESIONE i domyślnie nie wpływają na wynik', () => {
  for (const id of ['przestepstwa_1000_powiat_2025', 'wykrywalnosc_powiat_2025']) {
    const w = wczytaj(`../public/dane/wskazniki/${id}.json`)
    const m = w.meta ?? w
    // Od #171 grupę i kierunek nadaje PRZENIESIONE (etl/uprosc-kryteria.mjs), z wagą startową 0.
    assert.deepEqual([m.kategoria, m.kierunek], PRZENIESIONE[id], id)
    assert.equal(m.domyslnaWaga, 0, id)
  }
})

test('ETL bierze grupę z PRZENIESIONE, więc ponowny bieg nie cofa integracji (#171)', () => {
  for (const id of Object.keys(POLE)) {
    const [kategoria, kierunek] = PRZENIESIONE[id]
    assert.deepEqual(grupa(id), { kategoria, kierunek })
  }
  assert.throws(() => grupa('nieznana_warstwa'), /PRZENIESIONE/)
})

test('wartość każdego adresu to wartość jego powiatu – bez dziur i bez zer', () => {
  const { wersja, adresy } = wczytajAdresy()
  assert.ok(adresy.length > 100_000, 'sprawdzamy pełny zbiór adresów, a nie pusty')
  const rejony = wczytaj(REJONY)
  assert.equal(rejony.wersjaAdresow, wersja)
  const powiaty = new Map(rejony.powiaty.map((p) => [p.teryt, p]))
  for (const [id, pole] of Object.entries(POLE)) {
    const w = wczytaj(`../public/dane/wskazniki/${id}.json`)
    assert.equal(w.wersjaAdresow, wersja, id)
    assert.equal(w.wartosci.length, adresy.length, id)
    let rozne = 0
    let bezWartosci = 0
    let zera = 0
    for (const a of adresy) {
      const oczekiwana = zaokr(powiaty.get(powiatAdresu(a.teryt))?.[pole] ?? null)
      const v = w.wartosci[a.i]
      if (v !== oczekiwana) rozne++
      if (v === null) bezWartosci++
      if (v === 0) zera++
    }
    assert.equal(rozne, 0, `${id}: wartość adresu różni się od wartości jego powiatu`)
    assert.equal(bezWartosci, 0, `${id}: cztery powiaty z BDL pokrywają wszystkie adresy`)
    assert.equal(zera, 0, `${id}: zero znaczyłoby „zmierzone zero”, a nie brak danych`)
  }
})

test('adresy przypisane do powiatów i do komisariatów Krakowa sumują się do całości', () => {
  const { adresy } = wczytajAdresy()
  const rejony = wczytaj(REJONY)
  const suma = (lista) => lista.reduce((s, x) => s + x.adresow, 0)

  const wPowiecie = {}
  const wKomisariacie = {}
  for (const a of adresy) {
    const t = powiatAdresu(a.teryt)
    wPowiecie[t] = (wPowiecie[t] ?? 0) + 1
    if (a.teryt === '1261011') {
      const kp = komisariatDzielnicy(a.dzielnica)
      wKomisariacie[kp] = (wKomisariacie[kp] ?? 0) + 1
    }
  }
  assert.equal(suma(rejony.powiaty), adresy.length)
  for (const p of rejony.powiaty) assert.equal(p.adresow, wPowiecie[p.teryt], p.nazwa)

  const krakow = rejony.powiaty.find((p) => p.teryt === '1261')
  const rejonyKp = rejony.komisariatyKrakow.rejony
  assert.equal(rejonyKp.length, KOMISARIATY.length)
  assert.equal(suma(rejonyKp), krakow.adresow)
  assert.equal(wKomisariacie.null, undefined, 'każdy adres Krakowa ma komisariat')
  for (const k of rejonyKp) assert.equal(k.adresow, wKomisariacie[k.id], k.id)
})

test('brak liczb per komisariat to null – nigdy zero ani wartość zmyślona', () => {
  const rejony = wczytaj(REJONY)
  for (const k of rejony.komisariatyKrakow.rejony) {
    for (const pole of ['przestepstwa', 'na1000'])
      assert.ok(k[pole] === null || (Number.isFinite(k[pole]) && k[pole] > 0), `${k.id}.${pole}`)
    // Liczba i wskaźnik wchodzą razem: jedno bez drugiego to niedokończone uzupełnienie z dokumentu.
    assert.equal(k.przestepstwa === null, k.na1000 === null, `${k.id}: liczba i wskaźnik razem`)
  }
  for (const p of rejony.powiaty) {
    for (const pole of ['liczba', 'na1000', 'wykrywalnosc'])
      assert.ok(p[pole] === null || p[pole] > 0, `${p.nazwa}.${pole}`)
    assert.ok(p.wykrywalnosc === null || p.wykrywalnosc <= 100, p.nazwa)
  }
})

test('metadane: rok i źródło BDL, zasięg powiatu w opisie, półpauza zamiast pauzy', () => {
  for (const id of Object.keys(POLE)) {
    const m = wczytaj(`../public/dane/wskazniki/${id}.json`).meta
    assert.equal(m.zadanie, 68, id)
    assert.equal(m.rozdzielczosc, 'rejon', id)
    assert.equal(m.zrodla.length, 1, id)
    for (const z of m.zrodla) {
      assert.equal(z.dataDanych, String(ROK), id)
      assert.match(z.url, /^https:\/\/bdl\.stat\.gov\.pl\/api\/v1\/data\/by-variable\/\d+\?/, id)
      assert.match(z.pobrano, /^\d{4}-\d{2}-\d{2}$/, id)
      assert.ok(z.licencja, id)
    }
    // Zastrzeżenie, że liczba dotyczy powiatu, a nie ulicy, ma zostać przy warstwie.
    assert.match(m.opis, /całego powiatu/, id)
    assert.match(m.opis, /nie opisuje ulicy ani osiedla/, id)
    assert.ok(!JSON.stringify(m).includes(PAUZA), `${id}: pauza zamiast półpauzy`)
  }
})
