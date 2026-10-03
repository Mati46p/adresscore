import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import KDBush from 'kdbush'
import {
  agregujPylDnia,
  agregujWilgotnoscDnia,
  dniRoku,
  GRUPY,
  godzinWRoku,
  godzinyPylu,
  godzinyWilgotnosci,
  indeksGodziny,
  mediana,
  medianyGodzinowe,
  minOdczytowDlaCzujnika,
  modelPrzyPunkcie,
  ocenCzujniki,
  pearson,
  podsumuj,
  pozycjaCzujnika,
  REGULY,
  sredniaRoczna,
  statystykiZgodnosci,
  tylkoSuche,
  usunNiespojne,
  usunOdstajace,
  zdaniaWyniku,
} from './lib/sensor-community.mjs'
import {
  kandydaci,
  lokalizacjeZRekordow,
  polaczLokalizacje,
} from './lib/sensor-community-lista.mjs'
import { opisMetody } from './sensor-community.mjs'

const NAGLOWEK_SDS =
  'sensor_id;sensor_type;location;lat;lon;timestamp;P1;durP1;ratioP1;P2;durP2;ratioP2'
const wierszSds = (znacznik, p1, p2) => `1;SDS011;10;50.06;19.94;${znacznik};${p1};;;${p2};;`

test('indeksGodziny: numer godziny od 1 stycznia UTC, -1 poza rokiem, rok przestępny', () => {
  assert.equal(indeksGodziny('2025-01-01T00:00:00', 2025), 0)
  assert.equal(indeksGodziny('2025-01-01T05:30:12', 2025), 5)
  assert.equal(indeksGodziny('2025-12-31T23:59:59', 2025), 8759)
  assert.equal(indeksGodziny('2024-12-31T23:00:00', 2025), -1)
  assert.equal(indeksGodziny('2024-12-31T23:00:00', 2024), 8783)
  assert.equal(indeksGodziny('to nie data', 2025), -1)
  assert.equal(godzinWRoku(2024), 8784)
  assert.equal(godzinWRoku(2025), 8760)
})

test('dniRoku: 365 i 366 dób od 1 stycznia do 31 grudnia', () => {
  const d = dniRoku(2025)
  assert.equal(d.length, 365)
  assert.equal(d[0], '2025-01-01')
  assert.equal(d.at(-1), '2025-12-31')
  assert.equal(dniRoku(2024).length, 366)
})

test('agregujPylDnia: średnia godzinowa, odczyty poza zakresem i pojedyncze skoki odpadają', () => {
  const wiersze = [
    NAGLOWEK_SDS,
    // godzina 0: cztery zwykłe odczyty, jeden skok (PM2,5 = 400), jeden poza zakresem (999,9)
    ...[10, 11, 9, 10].map((v, i) => wierszSds(`2025-03-01T00:0${i}:00`, v * 2, v)),
    wierszSds('2025-03-01T00:05:00', 800, 400),
    wierszSds('2025-03-01T00:06:00', 999.9, 999.9),
    // godzina 1: dwa odczyty, wszystkie zero (czujnik wyłączony) odpada
    wierszSds('2025-03-01T01:00:00', 0, 0),
    wierszSds('2025-03-01T01:01:00', 20, 12),
    '',
  ].join('\n')
  const w = agregujPylDnia(wiersze, 2025)
  assert.equal(w.poZakresie, 2)
  const godz0 = indeksGodziny('2025-03-01T00:00:00', 2025)
  const [h, n, p1, p2, min2, max2, skoki] = w.godziny[0]
  assert.equal(h, godz0)
  assert.equal(n, 4, 'skok usunięty, zostają cztery odczyty')
  assert.equal(skoki, 1)
  assert.equal(p2, 10)
  assert.equal(p1, 20)
  assert.equal(min2, 9)
  assert.equal(max2, 11)
  assert.equal(w.godziny[1][1], 1, 'godzina 1: jeden ważny odczyt (zerowy odpadł)')
  assert.equal(w.lokalizacje[0].location, 10)
})

test('agregujPylDnia: SPS30 bierze tylko pełne wiersze (kolumna P4), krótkie to inny czujnik', () => {
  const naglowek =
    'sensor_id;sensor_type;location;lat;lon;timestamp;P1;P4;P2;P0;N10;N4;N25;N1;N05;TS'
  const krotki = (z) => `7;SPS30;3;50.08;20.00;${z};9.6;;5.4;;;;;;;`
  const pelny = (z) => `7;SPS30;3;50.08;20.00;${z};4.0;3.9;3.8;3.5;29;29;29;29;24;0.5`
  const tekst = [
    naglowek,
    ...[0, 1, 2].flatMap((m) => [
      krotki(`2025-06-15T00:0${m}:00`),
      pelny(`2025-06-15T00:0${m}:00`),
    ]),
  ].join('\n')
  const w = agregujPylDnia(tekst, 2025)
  assert.equal(w.wiersze, 3)
  assert.equal(w.godziny[0][1], 3)
  assert.equal(w.godziny[0][3], 3.8)
})

test('agregujPylDnia: plik bez kolumn P1/P2 daje pusty wynik, nie wyjątek', () => {
  const w = agregujPylDnia('a;b;c\n1;2;3\n', 2025)
  assert.deepEqual(w.godziny, [])
})

test('agregujWilgotnoscDnia: średnie godzinowe; odczyty spoza (0, 100] pomijane', () => {
  const naglowek = 'sensor_id;sensor_type;location;lat;lon;timestamp;temperature;humidity'
  const w = (z, h) => `2;BME280;10;50.06;19.94;${z};10;${h}`
  const tekst = [
    naglowek,
    w('2025-03-01T00:00:00', 60),
    w('2025-03-01T00:10:00', 70),
    w('2025-03-01T00:20:00', 0),
    w('2025-03-01T00:30:00', 120),
    w('2025-03-01T01:00:00', 40),
  ].join('\n')
  const wynik = agregujWilgotnoscDnia(tekst, 2025)
  assert.equal(wynik.zawieszona, false)
  assert.deepEqual(
    wynik.godziny.map(([, n, v]) => [n, v]),
    [
      [2, 65],
      [1, 40],
    ],
  )
})

test('agregujWilgotnoscDnia: czujnik zapisujący całą dobę 84,9% jest zawieszony i nie daje godzin', () => {
  const naglowek = 'sensor_id;sensor_type;location;lat;lon;timestamp;temperature;humidity'
  const wiersze = Array.from(
    { length: 60 },
    (_, i) =>
      `3;DHT22;10;50.06;19.94;2025-06-15T${String(Math.floor(i / 3)).padStart(2, '0')}:${String((i % 3) * 20).padStart(2, '0')}:00;13.9;84.90`,
  )
  const wynik = agregujWilgotnoscDnia([naglowek, ...wiersze].join('\n'), 2025)
  assert.equal(wynik.zawieszona, true)
  assert.deepEqual(wynik.godziny, [])
})

const rocznikZ = (
  rok,
  f,
  lokalizacje = [{ location: 1, lat: 50.06, lon: 19.94, wiersze: 1000 }],
) => {
  const godziny = []
  for (let h = 0; h < godzinWRoku(rok); h++) {
    const w = f(h)
    if (w) godziny.push([h, 20, w[0], w[1], w[1] - 1, w[1] + 1, 0])
  }
  return { rok, godziny, lokalizacje }
}
const wilgZ = (rok, f) => ({
  rok,
  godziny: Array.from({ length: godzinWRoku(rok) }, (_, h) => [h, 20, f(h)]),
})

test('godzinyPylu: za krótkie godziny i zawieszone czujniki to NaN', () => {
  const r = {
    rok: 2025,
    lokalizacje: [],
    godziny: [
      [0, 2, 10, 5, 4, 6, 0], // za krótka
      [1, 10, 10, 5, 5, 5, 0], // zawieszona: 10 odczytów po 5,0
      [2, 10, 10, 5, 4, 6, 1], // dobra, jeden skok
    ],
  }
  const g = godzinyPylu(r)
  assert.ok(Number.isNaN(g.p2[0]) && Number.isNaN(g.p2[1]))
  assert.equal(g.p2[2], 5)
  assert.equal(g.zaKrotkie, 1)
  assert.equal(g.zawieszone, 1)
  assert.equal(g.skoki, 1)
})

test('minimum odczytów w godzinie dostosowane do czujnika: raz na godzinę wystarcza, przy 24 odczytach trzeba 3', () => {
  assert.equal(minOdczytowDlaCzujnika(24, 3), 3)
  assert.equal(minOdczytowDlaCzujnika(4, 3), 2)
  assert.equal(minOdczytowDlaCzujnika(1, 3), 1)
  assert.equal(minOdczytowDlaCzujnika(1, 2), 1)
  assert.equal(minOdczytowDlaCzujnika(Number.NaN, 3), 3)
  const godzinowy = {
    rok: 2025,
    lokalizacje: [],
    godziny: [0, 1, 2].map((h) => [h, 1, 10, 5, 5, 5, 0]),
  }
  const g = godzinyPylu(godzinowy)
  assert.equal(g.p2[1], 5, 'jeden odczyt na godzinę to już średnia godzinowa tego czujnika')
  assert.equal(g.zaKrotkie, 0)
  const rzadkaWilgotnosc = {
    godziny: [
      [0, 1, 60],
      [1, 1, 70],
    ],
  }
  assert.equal(godzinyWilgotnosci([rzadkaWilgotnosc], 2025)[1], 70)
})

test('usunNiespojne: PM2,5 większe od PM10 ponad tolerancję usuwa obie wartości godziny', () => {
  const p1 = Float64Array.from([20, 20, 20, 1])
  const p2 = Float64Array.from([18, 22.5, 40, 4])
  const n = usunNiespojne(p1, p2)
  assert.equal(n, 2, '40 > 20 + 3 i 4 > 1 + 2')
  assert.ok(Number.isNaN(p1[2]) && Number.isNaN(p2[2]) && Number.isNaN(p1[3]))
  assert.equal(p2[1], 22.5, '22,5 mieści się w tolerancji 20 + max(2, 3)')
})

test('medianyGodzinowe i usunOdstajace: skok ponad 4× mediana + 30 i dno przy wysokiej medianie', () => {
  const sensor = (v) => Float64Array.from([v])
  const wszystkie = [sensor(20), sensor(22), sensor(18), sensor(21), sensor(19), sensor(200)]
  const med = medianyGodzinowe(wszystkie)
  assert.equal(med[0], mediana([20, 22, 18, 21, 19, 200]))
  assert.equal(usunOdstajace(wszystkie[5], med), 1)
  assert.ok(Number.isNaN(wszystkie[5][0]))
  const zbyt = sensor(2)
  assert.equal(usunOdstajace(zbyt, Float64Array.from([30])), 1, 'poniżej 1/5 mediany 30')
  const normalny = sensor(25)
  assert.equal(usunOdstajace(normalny, med), 0)
  assert.ok(
    Number.isNaN(medianyGodzinowe([sensor(1), sensor(2)])[0]),
    'mniej niż 5 czujników = brak mediany',
  )
})

test('tylkoSuche: godziny wilgotne i bez pomiaru wilgotności odpadają', () => {
  const p = Float64Array.from([10, 20, 30, 40])
  const w = Float64Array.from([50, 80, 81, Number.NaN])
  const s = tylkoSuche(p, w)
  assert.equal(s[0], 10)
  assert.equal(s[1], 20, 'dokładnie 80% jeszcze wchodzi')
  assert.ok(Number.isNaN(s[2]) && Number.isNaN(s[3]))
})

test('sredniaRoczna: średnia ze średnich miesięcznych, miesiące z małą liczbą godzin odpadają', () => {
  const rok = 2025
  const t = new Float64Array(godzinWRoku(rok)).fill(Number.NaN)
  // styczeń: 720 godzin po 10, luty: 10 godzin po 100 (za mało przy progu 200 – nie liczy się)
  for (let h = 0; h < 720; h++) t[h] = 10
  for (let h = 744; h < 754; h++) t[h] = 100
  assert.equal(sredniaRoczna(t, rok, { minGodzin: 200, minMiesiecy: 1 }).srednia, 10)
  assert.equal(sredniaRoczna(t, rok, { minGodzin: 5, minMiesiecy: 1 }).srednia, 55)
  assert.equal(sredniaRoczna(t, rok, { minGodzin: 200, minMiesiecy: 2 }).srednia, null)
  const ciagla = new Float64Array(godzinWRoku(rok)).fill(7)
  const w = sredniaRoczna(ciagla, rok, { minGodzin: 200 })
  assert.equal(w.srednia, 7)
  assert.equal(w.miesiace, 12)
})

test('pozycjaCzujnika: stała pozycja albo przeniesienie o ponad 250 m w ≥ 10% odczytów', () => {
  const stala = pozycjaCzujnika([
    { location: 1, lat: 50.06, lon: 19.94, wiersze: 980 },
    { location: 1, lat: 50.0601, lon: 19.94, wiersze: 20 },
  ])
  assert.equal(stala.stala, true)
  const przeniesiony = pozycjaCzujnika([
    { location: 1, lat: 50.06, lon: 19.94, wiersze: 600 },
    { location: 2, lat: 50.1, lon: 19.94, wiersze: 400 },
  ])
  assert.equal(przeniesiony.stala, false)
  assert.equal(pozycjaCzujnika([]).pozycja, null)
})

test('ocenCzujniki: średnia „suche” bez wilgotnych godzin, odrzucenia z powodem', () => {
  const rok = 2025
  const zwykly = (id, p2 = 20) => ({
    id,
    typ: 'SDS011',
    location: id,
    pyl: rocznikZ(rok, () => [p2 * 1.7, p2]),
    wilgotnosc: [wilgZ(rok, () => 50)],
  })
  const wilgotny = {
    id: 100,
    typ: 'SDS011',
    location: 100,
    // parzyste godziny: wilgotność 90% i odczyt zawyżony 40, nieparzyste: 50% i 20
    pyl: rocznikZ(rok, (h) => (h % 2 === 0 ? [68, 40] : [34, 20])),
    wilgotnosc: [wilgZ(rok, (h) => (h % 2 === 0 ? 90 : 50))],
  }
  const bezWilgotnosci = { ...zwykly(101), wilgotnosc: [] }
  const polRoku = {
    id: 102,
    typ: 'SDS011',
    location: 102,
    pyl: rocznikZ(rok, (h) => (h < 4000 ? [34, 20] : null)),
    wilgotnosc: [wilgZ(rok, () => 50)],
  }
  const przeniesiony = {
    ...zwykly(103),
    pyl: rocznikZ(rok, () => [34, 20], [
      { location: 103, lat: 50.06, lon: 19.94, wiersze: 600 },
      { location: 104, lat: 50.2, lon: 19.94, wiersze: 400 },
    ]),
  }
  // 15% godzin z ogromnym skokiem względem pozostałych czujników
  const skoczek = {
    id: 105,
    typ: 'SDS011',
    location: 105,
    pyl: rocznikZ(rok, (h) => (h % 7 === 0 ? [400, 300] : [34, 20])),
    wilgotnosc: [wilgZ(rok, () => 50)],
  }
  const wyniki = ocenCzujniki(
    [zwykly(1), zwykly(2), zwykly(3), wilgotny, bezWilgotnosci, polRoku, przeniesiony, skoczek],
    rok,
  )
  const po = (id) => wyniki.find((w) => w.id === id)
  assert.equal(po(1).przyjety, true)
  assert.equal(po(1).pm25.wszystkie, 20)
  assert.equal(po(1).pm25.suche, 20)
  assert.equal(po(100).przyjety, true)
  assert.equal(po(100).pm25.wszystkie, 30, 'połowa godzin 40, połowa 20')
  assert.equal(po(100).pm25.suche, 20, 'tylko godziny o wilgotności do 80%')
  assert.equal(po(100).wilgotnosc.godzinWilgotnych, 4380)
  assert.equal(po(100).wilgotnosc.srednia, 70, 'połowa godzin 90%, połowa 50%')
  assert.equal(po(1).wilgotnosc.srednia, 50)
  assert.equal(po(101).przyjety, true)
  assert.equal(po(101).pm25.suche, null, 'bez czujnika wilgotności nie ma średniej suchej')
  assert.equal(po(101).wilgotnosc, null)
  assert.equal(po(102).przyjety, false)
  assert.match(po(102).powody.join(';'), /pokrycie/)
  assert.equal(po(103).przyjety, false)
  assert.match(po(103).powody.join(';'), /lokalizacj/)
  assert.equal(po(105).przyjety, false)
  assert.match(po(105).powody.join(';'), /odstające/)
})

test('pearson i statystykiZgodnosci: znane wartości', () => {
  assert.equal(pearson([1, 2, 3], [1, 2, 3]), null, 'poniżej 5 par korelacji nie liczymy')
  assert.ok(Math.abs(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) - 1) < 1e-12)
  assert.ok(Math.abs(pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]) + 1) < 1e-12)
  assert.equal(pearson([1, 1, 1, 1, 1], [1, 2, 3, 4, 5]), null)
  const s = statystykiZgodnosci([
    { model: 22, czujnik: 20 },
    { model: 18, czujnik: 20 },
    { model: 30, czujnik: 20 },
    { model: 12, czujnik: 20 },
    { model: 40, czujnik: 20 },
  ])
  assert.equal(s.n, 5)
  assert.equal(s.sredniaRoznica, 4.4, 'średnia z 2, −2, 10, −8, 20')
  assert.equal(s.medianaRoznicy, 2)
  assert.equal(s.mae, 8.4)
  assert.equal(s.medianaStosunku, 0.91, 'czujnik/model: 0,91, 1,11, 0,67, 1,67, 0,5 → mediana 0,91')
  assert.deepEqual(s.zakresCzujnikow, [20, 20])
  assert.equal(s.udzialW25, 0.4, 'różnice względne 10%, 10%, 50%, 40%, 100%: dwie z pięciu do 25%')
  assert.equal(s.udzialW50, 0.8, 'cztery z pięciu do 50%')
  assert.deepEqual(statystykiZgodnosci([]), { n: 0 })
})

test('podsumuj: grupy, miary i warianty modelu liczone osobno; brak średniej suchej pomija czujnik', () => {
  const wiersz = (grupa, model, oczko, suche, wszystkie) => ({
    grupa,
    pm25: { model, modelOczko: oczko, czujnik: { suche, wszystkie } },
    pm10: { model, modelOczko: oczko, czujnik: { suche, wszystkie } },
  })
  const p = podsumuj([
    wiersz('Kraków', 20, 19, 18, 22),
    wiersz('Kraków', 25, 26, null, 24),
    wiersz('obwarzanek', 15, 15, 16, 17),
  ])
  assert.equal(p['PM2.5'].Kraków.czujnikow, 2)
  assert.equal(p['PM2.5'].Kraków.suche.adres.n, 1, 'drugi czujnik bez średniej suchej')
  assert.equal(p['PM2.5'].Kraków.wszystkie.adres.n, 2)
  assert.equal(p['PM2.5'].Kraków.suche.oczko.sredniaModelu, 19)
  assert.equal(p['PM2.5'].obwarzanek.suche.adres.sredniaRoznica, -1)
  assert.equal(p['PM10'].razem.czujnikow, 3)
})

test('zdaniaWyniku: liczby z podsumowania z przecinkiem dziesiętnym, wilgotność rozstrzelona, bez pauzy', () => {
  const wiersz = (id, model, suche, wszystkie, wilg) => ({
    id,
    grupa: 'Kraków',
    pm25: { model, modelOczko: model, czujnik: { suche, wszystkie } },
    pm10: { model: model + 10, modelOczko: model + 10, czujnik: { suche, wszystkie } },
    wilgotnosc: wilg,
  })
  const wiersze = [
    wiersz(1, 20, 10, 15, { srednia: 40, godzinWilgotnych: 0, godzinSuchych: 100 }),
    wiersz(2, 20, 12, 16, { srednia: 70, godzinWilgotnych: 40, godzinSuchych: 60 }),
    wiersz(3, 20, null, 17, null),
  ]
  const zdania = zdaniaWyniku(podsumuj(wiersze), wiersze)
  const tekst = zdania.join('\n')
  assert.match(tekst, /PM2,5, Kraków, średnie z wszystkich godzin, 3 czujników: model 20,0 µg\/m³/)
  assert.match(tekst, /średnia czujników 16,0 µg\/m³ \(pojedyncze czujniki od 15,0 do 17,0\)/)
  assert.match(tekst, /średnie z godzin o wilgotności do 80%, 2 czujników/)
  assert.match(tekst, /korelacja model–czujnik nieliczona \(poniżej 5 czujników\)/)
  assert.match(
    tekst,
    /Wilgotność zmierzona przy czujnikach pyłu \(2 stanowisk\): średnia roczna od 40% do 70%, udział godzin powyżej 80% od 0% do 40%/,
  )
  assert.ok(!tekst.includes('—'))
})

test('modelPrzyPunkcie: średnia adresów w 100 m, a gdy brak – w 250 m; puste = null', () => {
  const xy = [
    [0, 0],
    [50, 0],
    [200, 0],
    [1000, 0],
  ]
  const idx = new KDBush(xy.length)
  for (const [x, y] of xy) idx.add(x, y)
  idx.finish()
  const wartosci = [10, 20, 40, null]
  const m = modelPrzyPunkcie(10, 0, xy, idx, wartosci)
  assert.equal(m.wartosc, 15)
  assert.equal(m.adresow, 2)
  assert.equal(m.promien, 100)
  assert.equal(m.najblizszy, 0)
  const dalej = modelPrzyPunkcie(350, 0, xy, idx, wartosci)
  assert.equal(dalej.wartosc, 40)
  assert.equal(dalej.promien, 250)
  assert.equal(
    modelPrzyPunkcie(1000, 0, xy, idx, wartosci),
    null,
    'adres bez wartości nie liczy się',
  )
})

const rekord = (location, lat, lon, sensorId, typ, indoor = 0) => ({
  location: {
    id: location,
    latitude: String(lat),
    longitude: String(lon),
    indoor,
    exact_location: 0,
  },
  sensor: { id: sensorId, sensor_type: { name: typ } },
})
const GRANICE = { lat: [49.8, 50.3], lon: [19.6, 20.4] }

test('lokalizacjeZRekordow i kandydaci: pył zewnętrzny z partnerem wilgotności, bez wnętrz i spoza prostokąta', () => {
  const lok = lokalizacjeZRekordow(
    [
      rekord(1, 50.05, 19.9, 11, 'SDS011'),
      rekord(1, 50.05, 19.9, 11, 'SDS011'),
      rekord(1, 50.05, 19.9, 12, 'DHT22'),
      rekord(1, 50.05, 19.9, 13, 'BME280'),
      rekord(2, 50.06, 19.95, 21, 'SDS011', 1),
      rekord(3, 52.0, 21.0, 31, 'SDS011'),
      rekord(4, 50.07, 19.96, 41, 'BME280'),
    ],
    GRANICE,
  )
  assert.equal(lok.length, 3, 'lokalizacja 3 poza prostokątem')
  const k = kandydaci(lok)
  assert.equal(k.length, 1, 'lokalizacja 2 wewnątrz, 4 bez pyłu')
  assert.deepEqual(k[0].pyl, [{ id: 11, typ: 'SDS011' }])
  assert.deepEqual(
    k[0].wilgotnosc.map((s) => s.typ),
    ['BME280', 'DHT22'],
    'BME280 przed DHT22',
  )
})

test('polaczLokalizacje: czujnik z archiwum dopisany do lokalizacji z żywego API, współrzędne żywe wygrywają', () => {
  const zywe = lokalizacjeZRekordow([rekord(1, 50.05, 19.9, 11, 'SDS011')], GRANICE)
  const dzien = {
    wPolsce: [
      { typ: 'sds011', id: 11, location: 1, lat: 50.06, lon: 19.91 },
      { typ: 'sds011', id: 15, location: 1, lat: 50.06, lon: 19.91 },
      { typ: 'sds011', id: 77, location: 7, lat: 50.2, lon: 20.0 },
      { typ: 'sds011', id: 88, location: 8, lat: 54.0, lon: 18.0 },
    ],
  }
  const wynik = polaczLokalizacje(zywe, [dzien], GRANICE)
  assert.equal(wynik.length, 2, 'lokalizacja 8 poza prostokątem')
  const l1 = wynik.find((l) => l.location === 1)
  assert.equal(l1.lat, 50.05)
  assert.deepEqual(l1.sensory.map((s) => s.id).sort(), [11, 15])
  assert.deepEqual(l1.zrodlo, ['zywe', 'archiwum'])
  assert.deepEqual(wynik.find((l) => l.location === 7).zrodlo, ['archiwum'])
})

test('godzinyWilgotnosci: średnia z czujników, które mają godzinę', () => {
  const a = { godziny: [[0, 10, 60]] }
  const b = {
    godziny: [
      [0, 10, 80],
      [1, 1, 50],
    ],
  }
  const w = godzinyWilgotnosci([a, b], 2025)
  assert.equal(w[0], 70)
  assert.ok(Number.isNaN(w[1]), 'godzina z jednym odczytem jest za krótka')
})

test('opisMetody: liczby w opisie pochodzą z reguł kodu, bez pauzy', () => {
  const opis = opisMetody(2025).join('\n')
  assert.ok(opis.includes(`${REGULY.progWilgotnosci}%`))
  assert.ok(opis.includes(`${Math.round(100 * REGULY.minPokrycie)}%`))
  assert.ok(opis.includes('2025-02-12'))
  assert.ok(!opis.includes('—'), 'w polskim tekście półpauza, nie pauza')
})

// Plik wyniku powstaje z `node etl/sensor-community.mjs`; test pilnuje spójności z adresami i kontraktu.
const PLIK_WYNIKU = new URL(
  '../public/dane/powietrze_kontrola_sensor_community.json',
  import.meta.url,
)

test('plik wyniku: wersja adresów, atrybucja, domknięte sumy i brak pauzy', {
  skip: !existsSync(PLIK_WYNIKU),
}, () => {
  const tekst = readFileSync(PLIK_WYNIKU, 'utf8')
  const wynik = JSON.parse(tekst)
  const adresy = JSON.parse(
    readFileSync(new URL('../public/dane/adresy.json', import.meta.url), 'utf8'),
  )
  assert.equal(
    wynik.meta.wersjaAdresow,
    adresy.wersja,
    'po zmianie adresów przelicz node etl/sensor-community.mjs',
  )
  assert.ok(Number.isInteger(wynik.meta.rok))
  assert.ok(
    wynik.meta.atrybucja.includes('Sensor.Community') && wynik.meta.atrybucja.includes('ODbL'),
  )
  for (const z of wynik.meta.zrodla)
    for (const k of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano'])
      assert.ok(z[k], `źródło: ${k}`)
  assert.ok(!tekst.includes('—'), 'w polskim tekście półpauza, nie pauza')
  assert.ok(tekst.length < 2_000_000, 'plik poniżej 2 MB')

  const ids = wynik.czujniki.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length, 'jeden wiersz na czujnik')
  assert.equal(wynik.meta.liczby.czujnikowWTabeli, wynik.czujniki.length)
  assert.equal(wynik.meta.liczby.czujnikowOdrzuconych, wynik.odrzucone.length)
  for (const c of wynik.czujniki) {
    assert.ok(GRUPY.includes(c.grupa))
    assert.ok(Math.abs(c.lat * 1000 - Math.round(c.lat * 1000)) < 1e-6, 'pozycja do 3 miejsc')
    assert.ok(Math.abs(c.lon * 1000 - Math.round(c.lon * 1000)) < 1e-6)
    assert.ok(c.jakosc.pokrycie >= REGULY.minPokrycie - 0.005, 'do tabeli tylko z pokryciem')
    for (const p of ['pm25', 'pm10']) {
      const b = c[p]
      assert.ok(Number.isFinite(b.model) && b.model > 0)
      for (const miara of ['suche', 'wszystkie']) {
        const cz = b.czujnik[miara]
        if (cz === null) {
          assert.equal(b.roznica[miara], null)
          continue
        }
        assert.ok(Number.isFinite(cz) && cz >= 0 && cz < 500, `${c.id} ${p} ${miara}: wartość`)
        assert.ok(Math.abs(b.roznica[miara] - (b.model - cz)) < 0.011, 'różnica = model − czujnik')
      }
    }
  }
  for (const [wskaznik, grupy] of Object.entries(wynik.podsumowanie)) {
    assert.equal(
      grupy.Kraków.czujnikow + grupy.obwarzanek.czujnikow,
      grupy.razem.czujnikow,
      `${wskaznik}: grupy sumują się do wszystkich czujników`,
    )
    assert.equal(grupy.razem.czujnikow, wynik.czujniki.length)
    for (const miara of ['suche', 'wszystkie'])
      assert.equal(
        grupy.Kraków[miara].adres.n + grupy.obwarzanek[miara].adres.n,
        grupy.razem[miara].adres.n,
        `${wskaznik} ${miara}: liczności grup sumują się`,
      )
  }
})
