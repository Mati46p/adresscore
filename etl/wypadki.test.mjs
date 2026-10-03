import assert from 'node:assert/strict'
import { test } from 'node:test'
import { latLngToCell } from 'h3-js'
import { agreguj, czytajZdarzenia, liczba, RES, WAGI } from './wypadki.mjs'

const XML = `<?xml version="1.0"?><ZDARZENIA>
<ZDARZENIE><ID>1</ID><POWIAT>KRAKÓW</POWIAT><DATA_ZDARZ>2021-05-04</DATA_ZDARZ>
<WSP_GPS_X>19,9370</WSP_GPS_X><WSP_GPS_Y>50,0614</WSP_GPS_Y>
<POJAZD><RODZAJ_POJAZDU>Samochód osobowy</RODZAJ_POJAZDU>
<UCZESTNIK><SRUZ_KOD>K</SRUZ_KOD><STUC_KOD>B</STUC_KOD></UCZESTNIK></POJAZD>
<UCZESTNIK><SRUZ_KOD>P</SRUZ_KOD><STUC_KOD>RC</STUC_KOD></UCZESTNIK></ZDARZENIE>
<ZDARZENIE><ID>2</ID><DATA_ZDARZ>2019-01-01</DATA_ZDARZ><WSP_GPS_X>50.0615</WSP_GPS_X><WSP_GPS_Y>19.9371</WSP_GPS_Y>
<POJAZD><RODZAJ_POJAZDU>Rower</RODZAJ_POJAZDU><UCZESTNIK><SRUZ_KOD>K</SRUZ_KOD><STUC_KOD>Z</STUC_KOD></UCZESTNIK></POJAZD></ZDARZENIE>
<ZDARZENIE><ID>3</ID><DATA_ZDARZ>2022-03-03</DATA_ZDARZ><ULICA_ADRES>Długa</ULICA_ADRES>
<UCZESTNIK><STUC_KOD>RL</STUC_KOD></UCZESTNIK></ZDARZENIE>
<ZDARZENIE><ID>4</ID><DATA_ZDARZ>2025-02-02</DATA_ZDARZ><WSP_GPS_X>19.93</WSP_GPS_X><WSP_GPS_Y>50.06</WSP_GPS_Y></ZDARZENIE>
<ZDARZENIE><ID>5</ID><DATA_ZDARZ>2020-02-02</DATA_ZDARZ><WSP_GPS_X>21.0</WSP_GPS_X><WSP_GPS_Y>52.2</WSP_GPS_Y></ZDARZENIE>
<ZDARZENIE><ID>6</ID><DATA_ZDARZ>2020-07-07</DATA_ZDARZ><WSP_GPS_X>19.9372</WSP_GPS_X><WSP_GPS_Y>50.0613</WSP_GPS_Y></ZDARZENIE>
</ZDARZENIA>`

async function* kawalki(t, n) {
  for (let i = 0; i < t.length; i += n) yield t.slice(i, i + n)
}

test('parsuje strumieniowo niezależnie od podziału na kawałki', async () => {
  for (const n of [7, 100, 100000]) {
    const lista = []
    for await (const z of czytajZdarzenia(kawalki(XML, n))) lista.push(z)
    assert.deepEqual(
      lista.map((z) => z.id),
      ['1', '2', '3', '5', '6'],
    ) // 2025 poza zakresem
  }
})

test('waga wg ciężkości, piesi i rowerzyści, zamienione osie GPS, brak GPS', async () => {
  const lista = []
  for await (const z of czytajZdarzenia(kawalki(XML, 50))) lista.push(z)
  const [z1, z2, z3] = lista
  assert.equal(z1.waga, WAGI.zdarzenie + WAGI.ciezko)
  assert.equal(z1.pieszyLubRower, true)
  assert.equal(z2.waga, WAGI.zdarzenie + WAGI.zabity)
  assert.equal(z2.pieszyLubRower, true)
  assert.ok(Math.abs(z2.lat - 50.0615) < 1e-9)
  assert.equal(z3.lat, null)
  assert.equal(z3.ulica, 'Długa')

  const h = latLngToCell(50.0614, 19.937, RES)
  const { wszystkie, piesi, stat } = agreguj(lista, new Set([h]))
  assert.deepEqual(stat, { razem: 5, bezGps: 1, pozaObszarem: 1, wObszarze: 3 })
  const lat = 7
  assert.ok(Math.abs(wszystkie.get(h) - (z1.waga + z2.waga + 1) / lat) < 1e-9)
  assert.ok(Math.abs(piesi.get(h) - (z1.waga + z2.waga) / lat) < 1e-9)
})

test('liczba: przecinek, zero i puste', () => {
  assert.equal(liczba('50,5'), 50.5)
  assert.equal(liczba('0'), null)
  assert.equal(liczba(''), null)
})
