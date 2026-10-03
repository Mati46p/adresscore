import assert from 'node:assert/strict'
import test from 'node:test'
import { dlugoscWKole, odlegloscDoOdcinka, SiecOdcinkow } from './siec-drog.mjs'

// Współrzędne w metrach EPSG:2180 z okolic Krakowa – tak samo duże liczby jak w prawdziwych danych.
const X0 = 568_000
const Y0 = 243_000

function losowy(ziarno) {
  let a = ziarno
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const blisko = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`)

test('odległość punktu od odcinka: rzut, końce i odcinek zerowy', () => {
  assert.equal(odlegloscDoOdcinka(5, 3, 0, 0, 10, 0), 3)
  assert.equal(odlegloscDoOdcinka(-4, 3, 0, 0, 10, 0), 5)
  assert.equal(odlegloscDoOdcinka(14, 3, 0, 0, 10, 0), 5)
  assert.equal(odlegloscDoOdcinka(3, 4, 0, 0, 0, 0), 5)
})

test('długość odcinka w kole: w środku, poza kołem, cięciwa, koniec w kole, styczna', () => {
  // cały odcinek w kole
  blisko(dlugoscWKole(-3, 0, 3, 0, 0, 0, 10), 6)
  // cały poza kołem
  assert.equal(dlugoscWKole(20, 0, 30, 0, 0, 0, 10), 0)
  // przez środek: średnica
  blisko(dlugoscWKole(-50, 0, 50, 0, 0, 0, 10), 20)
  // cięciwa w odległości 6 od środka, promień 10: 2·√(100 − 36) = 16
  blisko(dlugoscWKole(-50, 6, 50, 6, 0, 0, 10), 16)
  // jeden koniec w kole: od (0,0) do punktu na brzegu = r
  blisko(dlugoscWKole(0, 0, 50, 0, 0, 0, 10), 10)
  // styczna do koła i odcinek zerowy
  assert.equal(dlugoscWKole(-50, 10, 50, 10, 0, 0, 10), 0)
  assert.equal(dlugoscWKole(1, 1, 1, 1, 0, 0, 10), 0)
  // odcinek kończy się przed kołem, choć jego prosta przecina koło
  assert.equal(dlugoscWKole(-50, 0, -20, 0, 0, 0, 10), 0)
})

test('długość odcinka w kole zgadza się z całkowaniem numerycznym', () => {
  const los = losowy(73)
  for (let n = 0; n < 100; n++) {
    const [ax, ay, bx, by] = [0, 0, 0, 0].map(() => (los() - 0.5) * 100)
    const dl = Math.hypot(bx - ax, by - ay)
    const kroki = 20_000
    let wKole = 0
    for (let k = 0; k < kroki; k++) {
      const t = (k + 0.5) / kroki
      if (Math.hypot(ax + t * (bx - ax), ay + t * (by - ay)) <= 30) wKole += dl / kroki
    }
    blisko(dlugoscWKole(ax, ay, bx, by, 0, 0, 30), wKole, (2 * dl) / kroki)
  }
})

function losoweLinie(los, ile) {
  const linie = []
  for (let n = 0; n < ile; n++) {
    let x = X0 + los() * 4000
    let y = Y0 + los() * 4000
    const punkty = [[x, y]]
    for (let k = 0, ilePunktow = 2 + Math.floor(los() * 5); k < ilePunktow; k++) {
      // Kroki do 500 m: część odcinków jest dłuższa niż maxOdcinek i musi zostać podzielona.
      x += (los() - 0.5) * 1000
      y += (los() - 0.5) * 1000
      punkty.push([x, y])
    }
    linie.push({ punkty, klasa: 1 + (n % 2), detal: n % 7, zrodlo: n % 3, wlasciciel: n })
  }
  return linie
}

function zbuduj(linie, opcje) {
  const siec = new SiecOdcinkow(opcje)
  for (const l of linie) siec.dodajLinie(l.punkty, l)
  return siec.zbuduj()
}

test('podział długich odcinków zachowuje sumaryczną długość i atrybuty', () => {
  const linie = losoweLinie(losowy(1), 40)
  const siec = zbuduj(linie, { komorka: 100, maxOdcinek: 30 })
  let oczekiwana = 0
  for (const l of linie)
    for (let i = 1; i < l.punkty.length; i++)
      oczekiwana += Math.hypot(
        l.punkty[i][0] - l.punkty[i - 1][0],
        l.punkty[i][1] - l.punkty[i - 1][1],
      )
  let suma = 0
  for (let i = 0; i < siec.liczba; i++) {
    suma += siec.dlugosc[i]
    assert.ok(siec.dlugosc[i] <= 30 + 1e-9)
    const l = linie[siec.wlasciciel[i]]
    assert.equal(siec.klasa[i], l.klasa)
    assert.equal(siec.detal[i], l.detal)
    assert.equal(siec.zrodlo[i], l.zrodlo)
  }
  blisko(suma, oczekiwana, 1e-6)
})

test('najbliższy odcinek zgadza się z przeszukaniem liniowym', () => {
  const los = losowy(2)
  const siec = zbuduj(losoweLinie(los, 120))
  let trafienia = 0
  for (let n = 0; n < 400; n++) {
    const x = X0 + los() * 4000
    const y = Y0 + los() * 4000
    const maxM = 20 + los() * 180
    let wzorzec = Infinity
    for (let i = 0; i < siec.liczba; i++)
      wzorzec = Math.min(
        wzorzec,
        odlegloscDoOdcinka(x, y, siec.ax[i], siec.ay[i], siec.bx[i], siec.by[i]),
      )
    const id = siec.najblizszy(x, y, maxM)
    if (wzorzec <= maxM) {
      trafienia++
      assert.ok(id >= 0, 'powinien znaleźć odcinek')
      blisko(siec.odleglosc, wzorzec)
    } else {
      assert.equal(id, -1)
      assert.equal(siec.odleglosc, Infinity)
    }
  }
  assert.ok(trafienia > 50, `za mało trafień w teście: ${trafienia}`)
})

test('najbliższy odcinek równoległy pomija prostopadłe i zgadza się z przeszukaniem liniowym', () => {
  // Pozioma droga (y = 0) i prostopadła (x = 50): punkt (50, 3) jest bliżej obu, ale pytamy o poziomą.
  const siec = zbuduj([
    {
      punkty: [
        [X0, Y0],
        [X0 + 100, Y0],
      ],
      klasa: 1,
    },
    {
      punkty: [
        [X0 + 50, Y0 - 100],
        [X0 + 50, Y0 + 100],
      ],
      klasa: 2,
    },
  ])
  const poziomo = siec.najblizszy(X0 + 50, Y0 + 3, 20, [1, 0, 0.9])
  assert.equal(siec.klasa[poziomo], 1)
  blisko(siec.odleglosc, 3)
  const pionowo = siec.najblizszy(X0 + 52, Y0 + 3, 20, [0, 1, 0.9])
  assert.equal(siec.klasa[pionowo], 2)
  blisko(siec.odleglosc, 2)
  // Odcinek nachylony o 45° nie spełnia progu 0,9 względem pionu ani poziomu.
  const ukos = zbuduj([
    {
      punkty: [
        [X0, Y0],
        [X0 + 100, Y0 + 100],
      ],
      klasa: 1,
    },
  ])
  assert.equal(ukos.najblizszy(X0 + 50, Y0 + 52, 20, [1, 0, 0.9]), -1)
  assert.ok(ukos.najblizszy(X0 + 50, Y0 + 52, 20, [Math.SQRT1_2, Math.SQRT1_2, 0.9]) >= 0)

  const los = losowy(3)
  const wiele = zbuduj(losoweLinie(los, 120))
  for (let n = 0; n < 300; n++) {
    const x = X0 + los() * 4000
    const y = Y0 + los() * 4000
    const kat = los() * Math.PI
    const kierunek = [Math.cos(kat), Math.sin(kat), 0.9]
    let wzorzec = Infinity
    for (let i = 0; i < wiele.liczba; i++) {
      if (Math.abs(wiele.kx[i] * kierunek[0] + wiele.ky[i] * kierunek[1]) < 0.9) continue
      wzorzec = Math.min(
        wzorzec,
        odlegloscDoOdcinka(x, y, wiele.ax[i], wiele.ay[i], wiele.bx[i], wiele.by[i]),
      )
    }
    const id = wiele.najblizszy(x, y, 150, kierunek)
    if (wzorzec <= 150) blisko(wiele.odleglosc, wzorzec)
    else assert.equal(id, -1)
  }
})

test('długość dróg w kole wg klasy zgadza się z przeszukaniem liniowym', () => {
  const los = losowy(4)
  const siec = zbuduj(losoweLinie(los, 150), { komorka: 100, maxOdcinek: 30 })
  let niezerowe = 0
  for (let n = 0; n < 150; n++) {
    const x = X0 + los() * 4000
    const y = Y0 + los() * 4000
    const promien = 300
    const wzorzec = new Float64Array(4)
    for (let i = 0; i < siec.liczba; i++)
      wzorzec[siec.klasa[i]] += dlugoscWKole(
        siec.ax[i],
        siec.ay[i],
        siec.bx[i],
        siec.by[i],
        x,
        y,
        promien,
      )
    const wynik = siec.dlugosciWKole(x, y, promien, new Float64Array(4))
    for (let k = 0; k < 4; k++) blisko(wynik[k], wzorzec[k], 1e-6)
    if (wzorzec[1] + wzorzec[2] > 0) niezerowe++
  }
  assert.ok(niezerowe > 30, `za mało niepustych kół w teście: ${niezerowe}`)
})

test('prosta sieć: długość w kole 300 m dla drogi biegnącej przez środek i obok', () => {
  const siec = zbuduj([
    {
      punkty: [
        [X0 - 1000, Y0],
        [X0 + 1000, Y0],
      ],
      klasa: 1,
    },
    {
      punkty: [
        [X0 - 1000, Y0 + 150],
        [X0 + 1000, Y0 + 150],
      ],
      klasa: 2,
    },
    {
      punkty: [
        [X0 - 1000, Y0 + 400],
        [X0 + 1000, Y0 + 400],
      ],
      klasa: 2,
    },
  ])
  const w = siec.dlugosciWKole(X0, Y0, 300, new Float64Array(4))
  blisko(w[1], 600, 1e-6)
  blisko(w[2], 2 * Math.sqrt(300 * 300 - 150 * 150), 1e-6) // trzecia droga leży poza kołem
  assert.equal(w[0], 0)
})

test('pusta sieć nie zawodzi', () => {
  const siec = new SiecOdcinkow().zbuduj()
  assert.equal(siec.najblizszy(X0, Y0, 100), -1)
  assert.deepEqual([...siec.dlugosciWKole(X0, Y0, 300, new Float64Array(4))], [0, 0, 0, 0])
})
