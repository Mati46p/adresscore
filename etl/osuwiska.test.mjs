import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DANE } from './lib/wspolne.mjs'
import {
  AKTYWNOSCI,
  aktywnoscStrefyPig,
  aktywnoscZTekstu,
  autorzyZasiegow,
  IndeksWielokatow,
  klasyfikuj,
  naMetry,
  poleZPodpisem,
  Wielokat,
  zaokraglOdleglosc,
  zlozOsuwiska,
  zlozZagrozone,
} from './osuwiska.mjs'

/** Pierścień zewnętrzny jak w ESRI: zgodnie z ruchem wskazówek zegara, zamknięty. */
const kwadrat = (x0, y0, x1, y1) => Float64Array.from([x0, y0, x0, y1, x1, y1, x1, y0, x0, y0])
/** Otwór: przeciwnie do ruchu wskazówek zegara. */
const otwor = (x0, y0, x1, y1) => Float64Array.from([x0, y0, x1, y0, x1, y1, x0, y1, x0, y0])
const bliskie = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`)

test('aktywność z opisu PIG: udziały, półpauza, przecinek, remis, nazwy z MSIP', () => {
  assert.equal(aktywnoscZTekstu('aktywne ciągle (A) - 100%'), 'ciagle')
  assert.equal(aktywnoscZTekstu('nieaktywne (N) - 100.0%'), 'nieaktywne')
  assert.equal(aktywnoscZTekstu('aktywne okresowo (O) – 100,0%'), 'okresowe')
  assert.equal(aktywnoscZTekstu('aktywne ciągle (A) - 71%, nieaktywne (N) - 29%'), 'ciagle')
  assert.equal(aktywnoscZTekstu('aktywne okresowo (O) - 44%, nieaktywne (N) - 56%'), 'nieaktywne')
  assert.equal(
    aktywnoscZTekstu(
      'aktywne ciągle (A) - 6.3%, aktywne okresowo (O) - 54.7%, nieaktywne (N) - 39.0%',
    ),
    'okresowe',
  )
  // remis: poważniejsza klasa
  assert.equal(aktywnoscZTekstu('aktywne ciągle (A) - 50%, nieaktywne (N) - 50%'), 'ciagle')
  // MSIP podaje samą nazwę klasy
  assert.equal(aktywnoscZTekstu('aktywne ciągle'), 'ciagle')
  assert.equal(aktywnoscZTekstu('aktywne okresowo'), 'okresowe')
  assert.equal(aktywnoscZTekstu('nieaktywne'), 'nieaktywne')
  // „nieaktywne” zawiera „aktywne”, ale nie jest klasą aktywną
  assert.equal(aktywnoscZTekstu('nieaktywne (N) - 29%, aktywne okresowo (O) - 71%'), 'okresowe')
  for (const brak of [null, undefined, '', '   ', 'brak danych', 42])
    assert.equal(aktywnoscZTekstu(brak), null)
  assert.equal(aktywnoscStrefyPig('ciagle'), 'ciagle')
  assert.equal(aktywnoscStrefyPig('okresowe'), 'okresowe')
  assert.equal(aktywnoscStrefyPig('nieaktywne'), 'nieaktywne')
  assert.equal(aktywnoscStrefyPig('inne'), null)
  assert.equal(aktywnoscStrefyPig(null), null)
})

test('wielokąt z otworem: wnętrze, otwór, pole i odległość', () => {
  const w = new Wielokat([kwadrat(0, 0, 100, 100), otwor(40, 40, 60, 60)])
  assert.ok(poleZPodpisem(kwadrat(0, 0, 100, 100)) < 0, 'zewnętrzny pierścień ESRI ma pole ujemne')
  bliskie(w.pole, 100 * 100 - 20 * 20)
  assert.equal(w.zawiera(10, 10), true)
  assert.equal(w.zawiera(50, 50), false, 'punkt w otworze jest poza wielokątem')
  assert.equal(w.zawiera(150, 50), false)
  assert.equal(w.zawiera(-0.001, 50), false)
  assert.equal(w.odleglosc(10, 10), 0)
  bliskie(w.odleglosc(150, 50), 50)
  bliskie(w.odleglosc(50, 50), 10, 1e-9) // w otworze: do brzegu otworu
  bliskie(w.odleglosc(110, 110), Math.hypot(10, 10))
  bliskie(w.odleglosc(50, -7), 7)
})

test('wielokąt bez zamknięcia pierścienia jest domykany', () => {
  const otwarty = Float64Array.from([0, 0, 0, 10, 10, 10, 10, 0]) // bez powrotu do (0,0)
  const w = new Wielokat([otwarty])
  assert.equal(w.zawiera(5, 5), true)
  bliskie(w.odleglosc(-3, 5), 3)
  bliskie(w.pole, 100)
})

test('kubełki krawędzi dają ten sam wynik co geometria analityczna (duży wielokąt)', () => {
  const n = 900
  const R = 1000
  const kolo = new Float64Array((n + 1) * 2)
  for (let i = 0; i <= n; i++) {
    const kat = -((2 * Math.PI * (i % n)) / n) // zgodnie z ruchem wskazówek zegara
    kolo[i * 2] = 5000 + R * Math.cos(kat)
    kolo[i * 2 + 1] = 7000 + R * Math.sin(kat)
  }
  const w = new Wielokat([kolo])
  assert.ok(w.kubelki, 'powyżej 400 wierzchołków budujemy kubełki')
  let ziarno = 7
  const los = () => {
    ziarno = (ziarno * 1664525 + 1013904223) % 4294967296
    return ziarno / 4294967296
  }
  for (let i = 0; i < 3000; i++) {
    const x = 5000 + (los() * 2 - 1) * 1300
    const y = 7000 + (los() * 2 - 1) * 1300
    const r = Math.hypot(x - 5000, y - 7000)
    if (Math.abs(r - R) < 2) continue // tuż przy brzegu wielokąt wpisany różni się od okręgu
    assert.equal(w.zawiera(x, y), r < R, `punkt ${x},${y} r=${r}`)
  }
  assert.equal(w.zawiera(5000, 7000), true)
  bliskie(w.odleglosc(5000 + R + 100, 7000), 100, 0.05)
})

test('indeks: najbliższy wielokąt i odległość zgodne z przeglądem zupełnym', () => {
  let ziarno = 11
  const los = () => {
    ziarno = (ziarno * 1664525 + 1013904223) % 4294967296
    return ziarno / 4294967296
  }
  const wielokaty = []
  for (let i = 0; i < 60; i++) {
    const x = los() * 20000
    const y = los() * 20000
    const w = 20 + los() * 300
    const h = 20 + los() * 300
    wielokaty.push(
      new Wielokat([kwadrat(x, y, x + w, y + h)], { id: i }),
      new Wielokat([Float64Array.from([x, y, x + w / 2, y + h, x + w, y, x, y])], { id: 1000 + i }),
    )
  }
  const indeks = new IndeksWielokatow(wielokaty)
  let wewnatrz = 0
  for (let i = 0; i < 400; i++) {
    const x = los() * 22000 - 1000
    const y = los() * 22000 - 1000
    const zaw = wielokaty.filter((w) => w.zawiera(x, y))
    const wynik = indeks.najblizszy(x, y)
    if (zaw.length) {
      wewnatrz++
      assert.equal(wynik.odleglosc, 0)
      assert.deepEqual(
        new Set(wynik.zawierajace.map((w) => w.atrybuty.id)),
        new Set(zaw.map((w) => w.atrybuty.id)),
      )
      continue
    }
    const oczekiwana = Math.min(...wielokaty.map((w) => w.odleglosc(x, y)))
    bliskie(wynik.odleglosc, oczekiwana, 1e-7)
    // zwrócony wielokąt faktycznie leży w tej odległości
    bliskie(wynik.wielokat.odleglosc(x, y), oczekiwana, 1e-7)
  }
  assert.ok(wewnatrz > 0, 'próbka obejmuje też punkty wewnątrz')
  assert.equal(new IndeksWielokatow([]).najblizszy(0, 0), null)
})

test('indeks: punkt dokładnie w narożniku najbliższego wielokąta nie gubi wielokąta', () => {
  // Najbliższy wierzchołek = najbliższy punkt wielokąta; błąd zaokrąglenia nie może dać null.
  const w = new Wielokat([kwadrat(0, 0, 10, 10)], { id: 1 })
  const indeks = new IndeksWielokatow([w])
  const wynik = indeks.najblizszy(13, 14)
  assert.equal(wynik.wielokat, w)
  bliskie(wynik.odleglosc, 5)
})

const stref = (n, a) => ({ OSUW_ID: n, d_AKTYW_ID: a })

test('składanie osuwisk: MSIP ma pierwszeństwo, PIG uzupełnia, strefy albo cały wielokąt', () => {
  const rzut = (lon, lat) => [lon, lat] // w teście współrzędne są już „metrami”
  const pierscien = (x0, y0, x1, y1) => [
    [
      [x0, y0],
      [x0, y1],
      [x1, y1],
      [x1, y0],
      [x0, y0],
    ],
  ]
  const msip8 = [
    { atrybuty: stref(1, 'aktywne ciągle'), pierscienie: pierscien(0, 0, 10, 10) },
    { atrybuty: stref(1, 'nieaktywne'), pierscienie: pierscien(10, 0, 20, 10) },
  ]
  const pig14 = [
    // ten sam numer co w MSIP – pomijany
    {
      atrybuty: { NUMER_IDENTYFIKACYJNY: 1, STOPIEN_AKTYWNOSCI: 'nieaktywne (N) - 100%' },
      pierscienie: pierscien(0, 0, 20, 10),
    },
    // strefy PIG pokrywają osuwisko (suma pól = 200)
    {
      atrybuty: {
        NUMER_IDENTYFIKACYJNY: 2,
        STOPIEN_AKTYWNOSCI: 'aktywne ciągle (A) - 50%, nieaktywne (N) - 50%',
      },
      pierscienie: pierscien(100, 0, 120, 10),
    },
    // strefy PIG nie pokrywają osuwiska (100 z 200) – bierzemy cały wielokąt z opisu
    {
      atrybuty: { NUMER_IDENTYFIKACYJNY: 3, STOPIEN_AKTYWNOSCI: 'aktywne okresowo (O) - 100%' },
      pierscienie: pierscien(200, 0, 220, 10),
    },
  ]
  const pig13 = [
    {
      atrybuty: { OSUWISKO_NUMER_IDENTYFIKACYJNY: 2, TYP_AKTYWNOSCI_DOM: 'ciagle' },
      pierscienie: pierscien(100, 0, 110, 10),
    },
    {
      atrybuty: { OSUWISKO_NUMER_IDENTYFIKACYJNY: 2, TYP_AKTYWNOSCI_DOM: 'nieaktywne' },
      pierscienie: pierscien(110, 0, 120, 10),
    },
    {
      atrybuty: { OSUWISKO_NUMER_IDENTYFIKACYJNY: 3, TYP_AKTYWNOSCI_DOM: 'okresowe' },
      pierscienie: pierscien(200, 0, 210, 10),
    },
  ]
  const { wielokaty, stat } = zlozOsuwiska({ msip8, pig14, pig13 }, rzut)
  assert.deepEqual(stat, { msip: 2, pigStrefy: 2, pigCale: 1, osuwiskMsip: 1, osuwiskPig: 2 })
  assert.equal(wielokaty.length, 5)
  const wg = (id, zrodlo) =>
    wielokaty.filter((w) => w.atrybuty.id === id && w.atrybuty.zrodlo === zrodlo)
  assert.equal(wg(1, 'msip').length, 2)
  assert.equal(wg(1, 'pig').length, 0, 'numer z MSIP nie jest dublowany z PIG')
  assert.deepEqual(
    wg(2, 'pig')
      .map((w) => w.atrybuty.aktywnosc)
      .sort(),
    ['ciagle', 'nieaktywne'],
  )
  const caly = wg(3, 'pig')
  assert.equal(caly.length, 1)
  assert.equal(caly[0].atrybuty.aktywnosc, 'okresowe')
  bliskie(caly[0].pole, 200)

  const { wielokaty: zagr, stat: s2 } = zlozZagrozone(
    {
      msip9: [{ atrybuty: { KRTZ_ID: 7 }, pierscienie: pierscien(0, 0, 5, 5) }],
      pig12: [
        { atrybuty: { NUMER_IDENTYFIKACYJNY: 7 }, pierscienie: pierscien(0, 0, 5, 5) },
        { atrybuty: { NUMER_IDENTYFIKACYJNY: 8 }, pierscienie: pierscien(50, 50, 60, 60) },
      ],
    },
    rzut,
  )
  assert.equal(zagr.length, 2)
  assert.deepEqual(s2, { msip: 1, pig: 1 })
  assert.deepEqual(
    zagr.map((w) => [w.atrybuty.id, w.atrybuty.zrodlo]),
    [
      [7, 'msip'],
      [8, 'pig'],
    ],
  )
})

test('naMetry przelicza pierścienie przez podaną projekcję', () => {
  const [p] = naMetry(
    [
      [
        [1, 2],
        [3, 4],
        [1, 2],
      ],
    ],
    (lon, lat) => [lon * 10, lat * 100],
  )
  assert.deepEqual([...p], [10, 200, 30, 400, 10, 200])
})

test('klasyfikacja adresu: na osuwisku, w terenie zagrożonym, blisko, daleko, poza zasięgiem', () => {
  const osuw = new IndeksWielokatow([
    new Wielokat([kwadrat(0, 0, 100, 100)], { id: 785, aktywnosc: 'ciagle' }),
    new Wielokat([kwadrat(0, 0, 50, 100)], { id: 785, aktywnosc: 'nieaktywne' }), // nakładająca się strefa
    new Wielokat([kwadrat(1000, 0, 1100, 100)], { id: 12, aktywnosc: 'okresowe' }),
  ])
  const zagr = new IndeksWielokatow([new Wielokat([kwadrat(300, 0, 400, 100)], { id: 5 })])
  const ctx = { osuwiska: osuw, zagrozone: zagr }

  const na = klasyfikuj(25, 50, ctx)
  assert.equal(na.odleglosc, 0)
  assert.equal(na.teren, 1)
  assert.equal(
    na.etykietaTeren,
    'osuwisko aktywne ciągle, nr 785',
    'przy nakładaniu bierzemy poważniejszą klasę',
  )
  assert.equal(na.etykietaOdleglosc, 'aktywne ciągle, nr 785')

  const zagrozony = klasyfikuj(350, 50, ctx)
  assert.equal(zagrozony.teren, 1)
  assert.equal(zagrozony.etykietaTeren, 'teren zagrożony ruchami masowymi')
  assert.equal(zagrozony.odleglosc, 250) // od x = 350 do prawej krawędzi osuwiska przy x = 100
  assert.equal(zagrozony.etykietaOdleglosc, null, 'dalej niż próg etykiety')

  const blisko = klasyfikuj(130, 50, ctx)
  assert.equal(blisko.teren, 0)
  assert.equal(blisko.etykietaTeren, null)
  bliskie(blisko.odleglosc, 30)
  assert.equal(blisko.etykietaOdleglosc, 'aktywne ciągle, nr 785')

  // Próg etykiety dotyczy odległości zaokrąglonej, tej samej, którą widzi karta.
  assert.equal(klasyfikuj(200.3, 50, ctx).etykietaOdleglosc, 'aktywne ciągle, nr 785')
  assert.equal(klasyfikuj(200.7, 50, ctx).etykietaOdleglosc, null)

  const dalej = klasyfikuj(700, 50, ctx)
  assert.equal(dalej.teren, 0)
  bliskie(dalej.odleglosc, 300)
  assert.equal(dalej.etykietaOdleglosc, null)

  assert.equal(
    klasyfikuj(25, 50, ctx, false),
    null,
    'poza zasięgiem opracowania: brak danych, nie zero',
  )
  assert.ok(Object.keys(AKTYWNOSCI).every((k) => AKTYWNOSCI[k].nazwa && AKTYWNOSCI[k].waga))
})

test('odległość: zero tylko dla adresu na osuwisku, ułamki metra nie dają zera', () => {
  assert.equal(zaokraglOdleglosc(0), 0)
  assert.equal(zaokraglOdleglosc(0.2), 1)
  assert.equal(zaokraglOdleglosc(0.49), 1)
  assert.equal(zaokraglOdleglosc(1.5), 2)
  assert.equal(zaokraglOdleglosc(1234.4), 1234)
  assert.equal(zaokraglOdleglosc(null), null)
})

test('autorzy opracowań SOPO: nazwa zasięgu, rok, sortowanie', () => {
  const tekst = autorzyZasiegow([
    { GMINA: 'Wieliczka', POWIAT: 'wielicki', ROK_ZAKONCZENIA: '2011', AUTOR: 'Antoni Wójcik' },
    {
      GMINA: 'n.d.',
      POWIAT: 'm. Kraków',
      ROK_ZAKONCZENIA: '2018',
      AUTOR: 'S. Kamieniarz, M. Wódka',
    },
    // PIG zostawia w polu autorów podwójne spacje
    {
      GMINA: 'n.d.',
      POWIAT: 'krakowski',
      ROK_ZAKONCZENIA: '2023',
      AUTOR: 'P. Marciniec,  Z. Zimnal ',
    },
    { GMINA: 'Świątniki Górne ', POWIAT: 'krakowski', ROK_ZAKONCZENIA: '2014', AUTOR: null },
  ])
  assert.equal(
    tekst,
    'gmina Świątniki Górne (2014): brak danych; gmina Wieliczka (2011): Antoni Wójcik; m. Kraków (2018): S. Kamieniarz, M. Wódka; powiat krakowski (2023): P. Marciniec, Z. Zimnal',
  )
})

// ---------- Wygenerowane pliki (po `node etl/osuwiska.mjs`) ----------
const czytaj = (sciezka) => JSON.parse(readFileSync(join(DANE, sciezka), 'utf8'))

test('pliki wskaźników: spójność z adresami, zasięgiem SOPO i kontraktem', () => {
  const adresy = czytaj('adresy.json')
  const k = adresy.kolumny
  const odl = czytaj('wskazniki/osuwisko_odleglosc.json')
  const teren = czytaj('wskazniki/teren_osuwiskowy.json')
  const n = k.id.length

  for (const p of [odl, teren]) {
    assert.equal(p.wersjaAdresow, adresy.wersja)
    assert.equal(p.wartosci.length, n)
    assert.equal(p.etykiety.length, n)
    assert.equal(p.meta.zadanie, 117)
    assert.equal(p.meta.kategoria, 'bezpieczenstwo')
    assert.equal(p.meta.rozdzielczosc, 'adres')
    assert.equal(p.meta.atrapa, undefined)
    assert.equal(p.meta.zrodla.length, 3)
    for (const z of p.meta.zrodla)
      for (const pole of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano'])
        assert.ok(z[pole], `źródło bez pola ${pole}`)
    assert.match(
      p.meta.zrodla[0].nazwa,
      /Gmina Miejska Kraków, Portal MSIP Obserwatorium \(https:\/\/msip\.krakow\.pl\)/,
    )
    assert.match(p.meta.zrodla[2].licencja, /Autorzy opracowań SOPO/)
    assert.match(p.meta.zrodla[2].licencja, /m\. Kraków/)
    assert.ok(
      !JSON.stringify(p).includes(String.fromCharCode(0x2014)),
      'w polskim tekście półpauza, nigdy pauza',
    )
  }
  assert.equal(odl.meta.kierunek, 'wiecej-lepiej')
  assert.equal(odl.meta.jednostka, 'm')
  assert.deepEqual(odl.meta.zakres, [0, 500])
  assert.equal(teren.meta.kierunek, 'mniej-lepiej')
  assert.deepEqual(teren.meta.zakres, [0, 1])
  for (const id of ['osuwisko_odleglosc', 'teren_osuwiskowy'])
    assert.ok(
      statSync(join(DANE, `wskazniki/${id}.json`)).size < 2 * 1024 * 1024,
      `${id}: plik ponad 2 MB`,
    )

  const stan = '(aktywne ciągle|aktywne okresowo|nieaktywne|aktywność nieustalona), nr \\d+'
  const etykietaStanu = new RegExp(`^${stan}$`)
  const osuwisko = `osuwisko ${stan}`
  const zagrozony = 'teren zagrożony ruchami masowymi'
  const etykietaTerenu = new RegExp(`^(${osuwisko}|${zagrozony}|${osuwisko}; ${zagrozony})$`)
  let naKrakowie = 0
  let razemKrakow = 0
  const poGminie = new Map()
  for (let i = 0; i < n; i++) {
    const d = odl.wartosci[i]
    const t = teren.wartosci[i]
    assert.equal(
      d === null,
      t === null,
      `adres ${i}: braki danych obu wskaźników muszą się pokrywać`,
    )
    const wKrakowie = k.teryt[i] === '1261011'
    if (k.teryt[i] === '1214012') assert.equal(d, null, 'Koniusza nie ma opracowania SOPO')
    if (wKrakowie) {
      assert.notEqual(d, null, 'cały Kraków leży w zasięgu opracowania')
      razemKrakow++
    }
    if (d === null) {
      assert.equal(odl.etykiety[i], null)
      assert.equal(teren.etykiety[i], null)
      continue
    }
    assert.ok(Number.isInteger(d) && d >= 0, `odległość ${d}`)
    assert.ok(t === 0 || t === 1)
    if (d === 0) assert.equal(t, 1, 'adres na osuwisku jest terenem osuwiskowym')
    if (d === 0 && wKrakowie) naKrakowie++
    // etykieta odległości: dokładnie dla adresów do 100 m
    if (d <= 100) assert.match(odl.etykiety[i] ?? '', etykietaStanu)
    else assert.equal(odl.etykiety[i], null)
    // etykieta terenu: dokładnie dla adresów z wartością 1
    if (t === 1) assert.match(teren.etykiety[i] ?? '', etykietaTerenu)
    else assert.equal(teren.etykiety[i], null)
    const g = poGminie.get(k.gmina[i]) ?? { n: 0, teren: 0 }
    g.n++
    g.teren += t
    poGminie.set(k.gmina[i], g)
  }
  assert.ok(razemKrakow > 70000)
  assert.ok(naKrakowie > 100 && naKrakowie < 5000, `na osuwisku w Krakowie: ${naKrakowie}`)
  // Pogórze (Mogilany, Świątniki Górne) jest osuwiskowe, równinne Niepołomice nie.
  const udzial = (g) => poGminie.get(g).teren / poGminie.get(g).n
  assert.ok(udzial('Mogilany') > 0.05, 'Mogilany')
  assert.ok(udzial('Świątniki Górne') > 0.05, 'Świątniki Górne')
  assert.ok(udzial('Niepołomice') < 0.01, 'Niepołomice')
  assert.equal(poGminie.has('Koniusza'), false)

  // Znane miejsce: Rynek Główny 1 (płaska terasa Wisły) – daleko od osuwisk i poza terenem zagrożonym.
  const rynek = k.id.findIndex(
    (_, i) => k.ulica[i] === 'Rynek Główny' && k.nr[i] === '1' && k.gmina[i] === 'Kraków',
  )
  assert.ok(rynek >= 0)
  assert.equal(teren.wartosci[rynek], 0)
  assert.ok(odl.wartosci[rynek] > 500, `Rynek Główny 1: ${odl.wartosci[rynek]} m`)
})
