// Uruchom: node --test etl/slonce.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  etykietaFasady,
  godzinySlonca,
  metryNaStopien,
  naMetry,
  obliczAdres,
  polozenieSlonca,
  probkiSlonca,
  stronaSwiata,
  udostepnijScene,
  wysokoscEfektywna,
  wysokoscOkna,
  zasloniete,
  zaslonieteBezSiatki,
  zbudujScene,
  znajdzFasade,
} from './lib/slonce.mjs'

// Rynek Główny w Krakowie.
const LAT = 50.0617
const LON = 19.9373
const MIN = 60_000

const kwadrat = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
]

/** Czy punkt leży wewnątrz bryły (reguła parzystości po wszystkich pierścieniach). */
function wBryle(budynek, x, y) {
  let wewnatrz = false
  for (const p of budynek.pierscienie)
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i]
      const [bx, by] = p[i + 1]
      if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) wewnatrz = !wewnatrz
    }
  return wewnatrz
}

/** Powtarzalny generator liczb losowych (mulberry32). */
function los(ziarno) {
  let a = ziarno
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------------------------
// Słońce

test('słońce 21.12 nad Krakowem: górowanie 16,5° na południu o 11:38 czasu środkowoeuropejskiego', () => {
  // 90° − 50,0617° − 23,436° = 16,50°; górowanie wg USNO: 11:38 CET = 10:38 UTC.
  const p = polozenieSlonca(Date.UTC(2026, 11, 21, 10, 38, 20), LAT, LON)
  assert.ok(Math.abs(p.wysokosc - 16.5) < 0.05, `wysokość ${p.wysokosc}`)
  assert.ok(Math.abs(p.azymut - 180) < 0.5, `azymut ${p.azymut}`)
  // maksimum dnia nie jest wyższe niż w południe
  let maks = -90
  for (let m = 0; m < 1440; m += 5)
    maks = Math.max(maks, polozenieSlonca(Date.UTC(2026, 11, 21) + m * MIN, LAT, LON).wysokosc)
  assert.ok(Math.abs(maks - 16.5) < 0.05, `maks ${maks}`)
})

test('słońce w innych porach roku: przesilenie letnie i równonoc', () => {
  const maksDnia = (rok, m, d) => {
    let maks = -90
    for (let min = 0; min < 1440; min += 5)
      maks = Math.max(maks, polozenieSlonca(Date.UTC(rok, m - 1, d) + min * MIN, LAT, LON).wysokosc)
    return maks
  }
  // 90° − 50,0617° + 23,44° = 63,38°
  assert.ok(Math.abs(maksDnia(2026, 6, 21) - 63.38) < 0.05, `${maksDnia(2026, 6, 21)}`)
  // równonoc: 90° − 50,0617° = 39,94° (deklinacja ±0,2° w dniu równonocy)
  assert.ok(Math.abs(maksDnia(2026, 3, 20) - 39.94) < 0.3, `${maksDnia(2026, 3, 20)}`)
})

test('azymut: rano ze wschodu, po południu z zachodu', () => {
  const rano = polozenieSlonca(Date.UTC(2026, 11, 21, 8), LAT, LON) // 9:00 CET
  const popo = polozenieSlonca(Date.UTC(2026, 11, 21, 13), LAT, LON) // 14:00 CET
  assert.ok(rano.azymut > 130 && rano.azymut < 160, `${rano.azymut}`)
  assert.ok(popo.azymut > 200 && popo.azymut < 230, `${popo.azymut}`)
  assert.ok(rano.wysokosc > 5 && popo.wysokosc > 5)
})

test('wschód i zachód 21.12 zgadzają się z tablicami USNO (07:36 i 15:40 CET)', () => {
  // Źródło: aa.usno.navy.mil/api/rstt/oneday?date=2026-12-21&coords=50.0617,19.9373&tz=1:
  // wschód 07:36, górowanie 11:38, zachód 15:40. (Przybliżone „7:32” i „15:30” z opisu zadania
  // odbiegają od tablic o 4–10 minut.) Tablice podają minuty, więc tolerancja 1,5 min.
  const s = probkiSlonca({ lat: LAT, lon: LON })
  const minutaCET = (ms) => {
    const d = new Date(ms + 60 * MIN)
    return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60
  }
  assert.ok(Math.abs(minutaCET(s.wschodMs) - (7 * 60 + 36)) < 1.5, `${minutaCET(s.wschodMs)}`)
  assert.ok(Math.abs(minutaCET(s.zachodMs) - (15 * 60 + 40)) < 1.5, `${minutaCET(s.zachodMs)}`)
  // dzień trwa 8 h 4 min
  assert.ok(Math.abs(s.dlugoscH - (8 + 4 / 60)) < 0.03, `${s.dlugoscH}`)
})

test('próbki słońca: równo w czasie, wagi sumują się do długości dnia, azymut rośnie', () => {
  const s = probkiSlonca({ lat: LAT, lon: LON, krokMin: 2 })
  assert.equal(s.n, Math.round((s.dlugoscH * 60) / 2))
  assert.ok(Math.abs(s.wagaH * s.n - s.dlugoscH) < 1e-12)
  for (let k = 1; k < s.n; k++) assert.ok(s.az[k] > s.az[k - 1])
  // słońce wschodzi na południowym wschodzie, a zachodzi na południowym zachodzie
  assert.ok(s.az[0] > 120 && s.az[0] < 130, `${s.az[0]}`)
  assert.ok(s.az[s.n - 1] > 230 && s.az[s.n - 1] < 240, `${s.az[s.n - 1]}`)
  for (let k = 0; k < s.n; k++) {
    assert.ok(s.tg[k] > 0 && s.tg[k] < Math.tan((17 * Math.PI) / 180))
    assert.ok(Math.abs(s.sinAz[k] ** 2 + s.cosAz[k] ** 2 - 1) < 1e-12)
  }
})

test('wysokość efektywna: refrakcja i tarcza dają 0 przy wysokości geometrycznej −0,9°', () => {
  assert.ok(Math.abs(wysokoscEfektywna(-0.9)) < 0.05)
  // wyżej poprawka maleje (ok. 0,16° refrakcji + 0,27° tarczy przy 5°)
  assert.ok(Math.abs(wysokoscEfektywna(5) - 5.43) < 0.02)
  // poniżej −1,5° (i przy biegunie wzoru −5,11°) zawsze ujemna – bez fałszywych wschodów
  for (let h = -20; h <= -1.5; h += 0.01) assert.ok(wysokoscEfektywna(h) < 0, `h=${h}`)
})

// ---------------------------------------------------------------------------------------------
// Układ lokalny

/** Odległość geodezyjna na elipsoidzie WGS84 (wzór odwrotny Vincentyego) w metrach. */
function vincenty(lon1, lat1, lon2, lat2) {
  const r = Math.PI / 180
  const a = 6378137
  const f = 1 / 298.257223563
  const b = (1 - f) * a
  const dl = (lon2 - lon1) * r
  const u1 = Math.atan((1 - f) * Math.tan(lat1 * r))
  const u2 = Math.atan((1 - f) * Math.tan(lat2 * r))
  const [s1, c1, s2, c2] = [Math.sin(u1), Math.cos(u1), Math.sin(u2), Math.cos(u2)]
  let lambda = dl
  let poprzednia
  let [sinSigma, cosSigma, sigma, cosSqAlpha, cos2SigmaM] = [0, 0, 0, 0, 0]
  for (let i = 0; i < 100; i++) {
    const [sl, cl] = [Math.sin(lambda), Math.cos(lambda)]
    sinSigma = Math.hypot(c2 * sl, c1 * s2 - s1 * c2 * cl)
    if (sinSigma === 0) return 0
    cosSigma = s1 * s2 + c1 * c2 * cl
    sigma = Math.atan2(sinSigma, cosSigma)
    const sinAlpha = (c1 * c2 * sl) / sinSigma
    cosSqAlpha = 1 - sinAlpha ** 2
    cos2SigmaM = cosSqAlpha !== 0 ? cosSigma - (2 * s1 * s2) / cosSqAlpha : 0
    const c = (f / 16) * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha))
    poprzednia = lambda
    lambda =
      dl +
      (1 - c) *
        f *
        sinAlpha *
        (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM ** 2)))
    if (Math.abs(lambda - poprzednia) < 1e-12) break
  }
  const uSq = (cosSqAlpha * (a * a - b * b)) / (b * b)
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)))
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)))
  const dSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
          (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)))
  return b * A * (sigma - dSigma)
}

test('układ lokalny zachowuje odległości w obrębie Krakowa (błąd < 0,25% względem elipsoidy)', () => {
  // najpierw sama referencja: długości stopnia na równiku z tablic geodezyjnych
  assert.ok(Math.abs(vincenty(0, 0, 0, 1) - 110574.4) < 0.5)
  assert.ok(Math.abs(vincenty(0, 0, 1, 0) - 111319.5) < 0.5)
  const punkty = [
    [19.9373, 50.0617], // Rynek Główny
    [20.0369, 50.0724], // Nowa Huta
    [19.7968, 49.9707], // skraj południowo-zachodni
    [20.2091, 50.1251], // skraj północno-wschodni
    [19.8, 50.12],
    [20.2, 49.98],
  ]
  let najwiekszy = 0
  for (const a of punkty)
    for (const b of punkty) {
      if (a === b) continue
      const [ax, ay] = naMetry(...a)
      const [bx, by] = naMetry(...b)
      const lokalnie = Math.hypot(ax - bx, ay - by)
      const wzor = vincenty(...a, ...b)
      najwiekszy = Math.max(najwiekszy, Math.abs(lokalnie / wzor - 1))
      assert.ok(Math.abs(lokalnie / wzor - 1) < 0.0025, `${a} → ${b}: ${lokalnie} vs ${wzor}`)
    }
  // test coś mierzy: błąd jest niezerowy, ale mały (poniżej 0,2% na całym mieście)
  assert.ok(najwiekszy > 1e-4 && najwiekszy < 0.002, `${najwiekszy}`)
  const m = metryNaStopien(50)
  assert.ok(Math.abs(m.lat - 111229) < 5 && Math.abs(m.lon - 71698) < 5, JSON.stringify(m))
  assert.deepEqual(naMetry(19.94, 50.06), [0, 0])
})

// ---------------------------------------------------------------------------------------------
// Scena i promień

test('scena: orientacja krawędzi – prawa strona zawsze na zewnątrz bryły, także przy otworach', () => {
  const zOtworem = {
    h: 15,
    // zewnętrzny zgodnie z ruchem wskazówek zegara, otwór przeciwnie – odwrotnie niż docelowo
    pierscienie: [kwadrat(0, 0, 40, 40).reverse(), kwadrat(10, 10, 30, 30)],
  }
  const S = zbudujScene([zOtworem], { komorka: 10 })
  assert.equal(S.liczbaKrawedzi, 8)
  for (let e = 0; e < S.liczbaKrawedzi; e++) {
    const ax = S.kraw[4 * e]
    const ay = S.kraw[4 * e + 1]
    const ex = S.kraw[4 * e + 2]
    const ey = S.kraw[4 * e + 3]
    const dl = Math.hypot(ex, ey)
    const srodekX = ax + ex / 2
    const srodekY = ay + ey / 2
    const na_zewnatrz = [srodekX + (0.1 * ey) / dl, srodekY - (0.1 * ex) / dl]
    const do_srodka = [srodekX - (0.1 * ey) / dl, srodekY + (0.1 * ex) / dl]
    assert.equal(wBryle(zOtworem, ...na_zewnatrz), false, `krawędź ${e}: prawa strona w bryle`)
    assert.equal(wBryle(zOtworem, ...do_srodka), true, `krawędź ${e}: lewa strona poza bryłą`)
  }
})

test('scena na SharedArrayBuffer ma te same dane', () => {
  const S = zbudujScene([{ h: 10, pierscienie: [kwadrat(0, 0, 10, 10)] }])
  const W = udostepnijScene(S)
  assert.ok(W.kraw.buffer instanceof SharedArrayBuffer)
  assert.ok(W.start.buffer instanceof SharedArrayBuffer)
  assert.deepEqual(Array.from(W.kraw), Array.from(S.kraw))
  assert.equal(W.hMax, S.hMax)
  assert.equal(W.nx, S.nx)
})

test('promień z siatką daje to samo co sprawdzenie wszystkich krawędzi (losowe miasto)', () => {
  const r = los(2026)
  const budynki = []
  for (let i = 0; i < 500; i++) {
    const x = (r() - 0.5) * 1600
    const y = (r() - 0.5) * 1600
    const w = 6 + r() * 40
    const d = 6 + r() * 40
    const h = 3 + r() * 40
    if (i % 7 === 0) {
      // trójkąt
      budynki.push({
        h,
        pierscienie: [
          [
            [x, y],
            [x + w, y],
            [x + w / 2, y + d],
            [x, y],
          ],
        ],
      })
    } else if (i % 11 === 0) {
      // z otworem
      budynki.push({
        h,
        pierscienie: [kwadrat(x, y, x + w, y + d), kwadrat(x + 2, y + 2, x + w - 2, y + d - 2)],
      })
    } else {
      budynki.push({ h, pierscienie: [kwadrat(x, y, x + w, y + d)] })
    }
  }
  // jeden długi budynek, żeby krawędzie obejmowały wiele komórek
  budynki.push({ h: 30, pierscienie: [kwadrat(-700, 300, 600, 306)] })
  const S = zbudujScene(budynki, { komorka: 25 })
  let zasloniete_ = 0
  let wolne = 0
  // punkty startu leżą wewnątrz siatki (poza nią „brak danych”, a nie „czysto”)
  const xMin = S.gx0 + S.kom
  const yMin = S.gy0 + S.kom
  const szer = (S.nx - 2) * S.kom
  const wys = (S.ny - 2) * S.kom
  for (let i = 0; i < 6000; i++) {
    // część promieni zaczyna dokładnie na liniach siatki, część jest osiowa
    const px = i % 5 === 0 ? xMin + S.kom * Math.floor(r() * (S.nx - 2)) : xMin + r() * szer
    const py = i % 7 === 0 ? yMin + S.kom * Math.floor(r() * (S.ny - 2)) : yMin + r() * wys
    const az = i % 13 === 0 ? [0, 90, 180, 270][i % 4] : r() * 360
    const ux = Math.sin((az * Math.PI) / 180)
    const uy = Math.cos((az * Math.PI) / 180)
    const tg = 0.003 + r() * 0.35
    const z0 = i % 2 ? 6 : 1.5
    const dMax = i % 3 ? 1000 : 300
    const a = zasloniete(S, px, py, z0, ux, uy, tg, dMax)
    const b = zaslonieteBezSiatki(S, px, py, z0, ux, uy, tg, dMax)
    assert.equal(a, b, `promień ${i}: (${px}, ${py}) az ${az} tg ${tg}`)
    if (b) zasloniete_++
    else wolne++
  }
  // test nic nie znaczy, jeśli wszystkie promienie wypadają tak samo
  assert.ok(zasloniete_ > 600 && wolne > 600, `zasłoniętych ${zasloniete_}, wolnych ${wolne}`)
})

// ---------------------------------------------------------------------------------------------
// Fasada

const dom = { h: 12, pierscienie: [kwadrat(0, 0, 10, 10)] }

test('fasada: najbliższa krawędź, normalna na zewnątrz, punkt 1 m od ściany', () => {
  const S = zbudujScene([dom])
  const bliski = (a, b) => Math.abs(a - b) < 1e-9
  // w środku przy ścianie południowej
  const poludnie = znajdzFasade(S, 5, 0.5)
  assert.ok(bliski(poludnie.nx, 0) && bliski(poludnie.ny, -1))
  assert.ok(bliski(poludnie.px, 5) && bliski(poludnie.py, -1))
  // na zewnątrz przy ścianie wschodniej
  const wschod = znajdzFasade(S, 13, 5)
  assert.ok(bliski(wschod.nx, 1) && bliski(wschod.ny, 0))
  assert.ok(bliski(wschod.px, 11) && bliski(wschod.py, 5))
  assert.ok(bliski(wschod.odleglosc, 3))
})

test('fasada: adres w strefie wierzchołka dostaje ścianę, do której jest zwrócony, bez względu na kolejność', () => {
  // Adres przy zewnętrznym narożniku (10, 0) jest tak samo daleko od obu ścian. Normalna ma być
  // ta, która „patrzy" na adres, niezależnie od tego, od którego wierzchołka zaczyna się obrys.
  const obrys = kwadrat(0, 0, 10, 10).slice(0, 4)
  for (let obrot = 0; obrot < 4; obrot++) {
    const ring = [...obrys.slice(obrot), ...obrys.slice(0, obrot)]
    const S = zbudujScene([{ h: 12, pierscienie: [[...ring, ring[0]]] }])
    const poludnie = znajdzFasade(S, 11, -3) // wektor od narożnika (1, −3): bliżej ściany południowej
    assert.ok(Math.abs(poludnie.nx) < 1e-9 && Math.abs(poludnie.ny + 1) < 1e-9, `obrót ${obrot}`)
    const wschod = znajdzFasade(S, 13, -1) // wektor (3, −1): bliżej ściany wschodniej
    assert.ok(Math.abs(wschod.nx - 1) < 1e-9 && Math.abs(wschod.ny) < 1e-9, `obrót ${obrot}`)
  }
})

test('fasada: obrys zapisany w odwrotnej kolejności daje to samo', () => {
  const rewers = { h: 12, pierscienie: [kwadrat(0, 0, 10, 10).reverse()] }
  const a = znajdzFasade(zbudujScene([dom]), 5, 0.5)
  const b = znajdzFasade(zbudujScene([rewers]), 5, 0.5)
  assert.deepEqual([b.nx, b.ny, b.px, b.py], [a.nx, a.ny, a.px, a.py])
})

test('fasada: brak budynku bliżej niż maxOdl albo poza siatką = null', () => {
  const duzy = { h: 12, pierscienie: [kwadrat(0, 0, 60, 60)] }
  const S = zbudujScene([duzy])
  assert.equal(znajdzFasade(S, 30, 30), null) // środek hali, 30 m od ścian
  assert.ok(znajdzFasade(S, 30, 30, { maxOdl: 40 })) // z większą tolerancją fasada się znajduje
  assert.equal(znajdzFasade(S, 30, 70), null) // 10 m od ściany, a domyślnie szukamy do 6 m
  assert.ok(znajdzFasade(S, 30, 62)) // 2 m od ściany
  assert.equal(znajdzFasade(S, 500, 500), null) // poza siatką
})

test('fasada: punkt wypadający w sąsiednim budynku jest odrzucany, bierze następną ścianę', () => {
  // dwa domy rozdzielone szczeliną 0,6 m: punkt 1 m przed północną ścianą A leży w B
  const A = { h: 12, pierscienie: [kwadrat(0, 0, 10, 10)] }
  const B = { h: 12, pierscienie: [kwadrat(0, 10.6, 10, 20)] }
  const S = zbudujScene([A, B])
  const f = znajdzFasade(S, 5, 9.8)
  assert.ok(f, 'powinna się znaleźć jakaś fasada')
  assert.ok(!wBryle(B, f.px, f.py) && !wBryle(A, f.px, f.py), `punkt (${f.px}, ${f.py}) w bryle`)
  assert.equal(Math.abs(f.nx), 1, 'zamiast ściany północnej bierze wschodnią albo zachodnią')
})

test('wysokość okna: 6 m z zadania, niżej przy niskich budynkach', () => {
  assert.equal(wysokoscOkna(12), 6)
  assert.equal(wysokoscOkna(8), 6)
  assert.equal(wysokoscOkna(7), 5)
  assert.ok(Math.abs(wysokoscOkna(4.82) - 2.82) < 1e-12)
  assert.equal(wysokoscOkna(2.5), 1.5)
})

test('strony świata fasady', () => {
  assert.equal(stronaSwiata(0, 1), 'N')
  assert.equal(stronaSwiata(1, 0), 'E')
  assert.equal(stronaSwiata(0, -1), 'S')
  assert.equal(stronaSwiata(-1, 0), 'W')
  assert.equal(stronaSwiata(Math.SQRT1_2, -Math.SQRT1_2), 'SE')
  assert.equal(stronaSwiata(-Math.SQRT1_2, -Math.SQRT1_2), 'SW')
  assert.equal(etykietaFasady(4), 'płd.')
  assert.equal(etykietaFasady(0), 'płn.')
  assert.equal(etykietaFasady(3), 'płd.-wsch.')
})

// ---------------------------------------------------------------------------------------------
// Godziny słońca

const slonce = probkiSlonca({ lat: LAT, lon: LON })
const fasadaPld = { px: 5, py: -1, nx: 0, ny: -1 }

test('godziny: otwarta fasada południowa dostaje całe światło dnia, północna nic', () => {
  const S = zbudujScene([dom])
  const poludniowa = godzinySlonca(S, fasadaPld, slonce, { z: 6 })
  assert.ok(Math.abs(poludniowa - slonce.dlugoscH) < 1e-9, `${poludniowa} vs ${slonce.dlugoscH}`)
  const polnocna = godzinySlonca(S, { px: 5, py: 11, nx: 0, ny: 1 }, slonce, { z: 6 })
  assert.equal(polnocna, 0)
})

test('godziny: fasada wschodnia świeci do południa słonecznego, zachodnia od niego', () => {
  const S = zbudujScene([dom])
  const doPoludnia = slonce.az.filter((a) => a < 180).length * slonce.wagaH
  const odPoludnia = slonce.az.filter((a) => a > 180).length * slonce.wagaH
  const wschodnia = godzinySlonca(S, { px: 11, py: 5, nx: 1, ny: 0 }, slonce, { z: 6 })
  const zachodnia = godzinySlonca(S, { px: -1, py: 5, nx: -1, ny: 0 }, slonce, { z: 6 })
  assert.ok(Math.abs(wschodnia - doPoludnia) < 1e-9)
  assert.ok(Math.abs(zachodnia - odPoludnia) < 1e-9)
  assert.ok(Math.abs(wschodnia + zachodnia - slonce.dlugoscH) < 1e-9)
  // wschód 7:36, górowanie 11:38: przed południem słońce świeci ok. 4 h
  assert.ok(Math.abs(wschodnia - 4.03) < 0.05, `${wschodnia}`)
})

test('godziny: wysoki mur tuż przed fasadą zasłania słońce przez cały dzień', () => {
  // mur 20 m wysokości w odległości 20 m: potrzebne 14 m wzniesienia na 20 m, czyli 35° > 16,5°
  const mur = { h: 20, pierscienie: [kwadrat(-1000, -22, 1000, -21)] }
  const S = zbudujScene([dom, mur])
  assert.equal(godzinySlonca(S, fasadaPld, slonce, { z: 6 }), 0)
})

test('godziny: niski mur zasłania tylko niskie słońce (wynik zgodny z rachunkiem niezależnym)', () => {
  // mur 9 m wysokości, 30 m na południe od punktu (5, −1): zasłania, gdy 6 + d·tg < 9,
  // gdzie d = 30 / |cos(azymut)| to odległość do ściany mierzona wzdłuż promienia
  const mur = { h: 9, pierscienie: [kwadrat(-1000, -32, 1000, -31)] }
  const S = zbudujScene([dom, mur])
  let oczekiwane = 0
  for (let k = 0; k < slonce.n; k++) {
    const d = 30 / Math.abs(slonce.cosAz[k])
    if (6 + d * slonce.tg[k] >= 9) oczekiwane += slonce.wagaH
  }
  const wynik = godzinySlonca(S, fasadaPld, slonce, { z: 6 })
  assert.ok(Math.abs(wynik - oczekiwane) < 1e-9, `${wynik} vs ${oczekiwane}`)
  // mur jest wyraźnie widoczny w wyniku: część dnia, nie 0 i nie całość
  assert.ok(wynik > 5 && wynik < slonce.dlugoscH - 0.5, `${wynik}`)
})

test('godziny: zasłona po stronie północnej fasady południowej nic nie zmienia', () => {
  const polnoc = { h: 40, pierscienie: [kwadrat(-1000, 40, 1000, 41)] }
  const S = zbudujScene([dom, polnoc])
  const wynik = godzinySlonca(S, fasadaPld, slonce, { z: 6 })
  assert.ok(Math.abs(wynik - slonce.dlugoscH) < 1e-9)
})

test('godziny: budynek niższy od punktu obserwacji niczego nie zasłania', () => {
  const niski = { h: 5.9, pierscienie: [kwadrat(-1000, -22, 1000, -21)] }
  const S = zbudujScene([dom, niski])
  const wynik = godzinySlonca(S, fasadaPld, slonce, { z: 6 })
  assert.ok(Math.abs(wynik - slonce.dlugoscH) < 1e-9)
})

test('adres od początku do końca: fasada, godziny, etykieta; poza budynkiem null', () => {
  const S = zbudujScene([dom])
  const w = obliczAdres(S, slonce, 5, 0.4)
  assert.equal(etykietaFasady(w.numerStrony), 'płd.')
  assert.equal(w.z, 6)
  assert.ok(Math.abs(w.godziny - slonce.dlugoscH) < 1e-9)
  assert.ok(Math.abs(w.odleglosc - 0.4) < 1e-9)
  assert.equal(obliczAdres(S, slonce, 50, 50), null)
})
