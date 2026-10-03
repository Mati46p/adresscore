import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { naMetry } from './lib/msip.mjs'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import {
  dataImportuMsip,
  dataPl,
  etykietaLicznika,
  kluczNazwy,
  licznikiZMsip,
  najblizszyLicznik,
  odlegloscElipsoidyM,
  PROMIEN,
  parsujCsv,
  policzWskaznik,
  sredniaRoczna,
  wczytajPomiary,
  zaokraglij10,
  zlaczLiczniki,
} from './liczniki-rowerowe.mjs'

// Współrzędne w metrach EPSG:2178 z okolic Krakowa – tak samo duże liczby jak w prawdziwych danych.
const X0 = 7_420_000
const Y0 = 5_545_000

/** n kolejnych dat ISO od `od` włącznie. */
function kolejneDni(od, n) {
  const start = Date.parse(`${od}T00:00:00Z`)
  return Array.from({ length: n }, (_, i) =>
    new Date(start + i * 86_400_000).toISOString().slice(0, 10),
  )
}

test('parser CSV: cudzysłowy z przecinkami, podwojony cudzysłów, CRLF i puste wiersze', () => {
  assert.deepEqual(parsujCsv('Date,A,"B, c"\r\n2026-01-01,1,"2,5"\r\n\r\n2026-01-02,,"x ""y"""'), [
    ['Date', 'A', 'B, c'],
    ['2026-01-01', '1', '2,5'],
    ['2026-01-02', '', 'x "y"'],
  ])
  assert.deepEqual(parsujCsv(''), [])
  assert.deepEqual(parsujCsv('a,b\n'), [['a', 'b']])
  // Pole z końcem wiersza w cudzysłowie zostaje jednym polem.
  assert.deepEqual(parsujCsv('a,"b\nc"\n'), [['a', 'b\nc']])
})

/** Tabela jak z ZTP: Date, dwa liczniki, dwie kolumny pogodowe z przecinkiem dziesiętnym. */
function tabelaZtp(dni, komorka) {
  const daty = kolejneDni('2025-01-01', dni)
  const wiersze = daty.map((d, i) => {
    const [alfa, beta] = komorka(i)
    return `${d},${alfa},${beta},"3,5","0,0"`
  })
  return [
    'Date,Alfa,Beta,Maksymalna temperatura dobowa [°C],Suma dobowa opadów [mm]',
    ...wiersze,
  ].join('\n')
}

test('tabela ZTP: kolumny pogodowe odpadają, puste i niepoprawne komórki to null', () => {
  const tekst = tabelaZtp(400, (i) => [
    i === 5 ? ' ' : i === 6 ? 'n/d' : i === 7 ? -3 : 100 + i,
    50,
  ])
  const p = wczytajPomiary(tekst, { minLicznikow: 2 })
  assert.deepEqual([...p.liczniki.keys()], ['Alfa', 'Beta'])
  assert.equal(p.daty.length, 400)
  assert.equal(p.koniecTabeli, p.daty.at(-1))
  const alfa = p.liczniki.get('Alfa')
  assert.equal(alfa.length, 400)
  assert.deepEqual(alfa.slice(4, 9), [104, null, null, null, 108])
  assert.equal(p.liczniki.get('Beta')[0], 50)
  // BOM na początku pliku (eksport z Excela) nie psuje nagłówka.
  const bom = String.fromCharCode(0xfeff)
  assert.equal(wczytajPomiary(bom + tekst, { minLicznikow: 2 }).liczniki.size, 2)
})

test('tabela ZTP: zły format zatrzymuje bieg zamiast dawać przypadkowe kolumny', () => {
  assert.throws(() => wczytajPomiary('<!DOCTYPE html><html><body>Błąd 404</body></html>'), /Date/)
  assert.throws(() => wczytajPomiary(tabelaZtp(400, () => [1, 1])), /kolumn liczników/)
  assert.throws(
    () =>
      wczytajPomiary(
        tabelaZtp(100, () => [1, 1]),
        { minLicznikow: 2 },
      ),
    /tylko 100 dni/,
  )
  const zleDaty = `${tabelaZtp(400, () => [1, 1])}\n2025-02-01,1,1,"1,0","0,0"`
  assert.throws(() => wczytajPomiary(zleDaty, { minLicznikow: 2 }), /daty nie rosną/)
  const powtorzona = 'Date,Alfa, alfa \n2025-01-01,1,1'
  assert.throws(() => wczytajPomiary(powtorzona, { minLicznikow: 2, minDni: 1 }), /powtórzona/)
})

test('średnia roczna: okno 365 dni kończy się na ostatnim odczycie, granice włącznie', () => {
  const daty = kolejneDni('2025-01-01', 500)
  const odczyty = daty.map(() => 100)
  // Doba 366. od końca poza oknem, doba 365. w oknie.
  odczyty[500 - 366] = 1_000_000
  odczyty[500 - 365] = 100 + 365 * 10 // podnosi średnią dokładnie o 10
  const w = sredniaRoczna(daty, odczyty)
  assert.equal(w.dni, 365)
  assert.equal(w.do, daty[499])
  assert.equal(w.od, daty[500 - 365])
  assert.ok(Math.abs(w.srednia - 110) < 1e-9, String(w.srednia))
})

test('średnia roczna: licznik, który przestał nadawać, ma okno przed ostatnim odczytem', () => {
  const daty = kolejneDni('2025-01-01', 700)
  const odczyty = daty.map((_, i) => (i < 400 ? 200 : null))
  const w = sredniaRoczna(daty, odczyty)
  assert.equal(w.do, daty[399])
  assert.equal(w.od, daty[400 - 365])
  assert.equal(w.srednia, 200)
  // Ostatni odczyt 300 dni przed końcem tabeli mieści się w limicie, 400 dni już nie.
  assert.equal(sredniaRoczna(daty, odczyty, { maxStarosc: 300 }).srednia, 200)
  const stary = sredniaRoczna(daty, odczyty, { maxStarosc: 299 })
  assert.equal(stary.srednia, null)
  assert.match(stary.powod, /300 dni przed końcem tabeli/)
})

test('średnia roczna: zero to awaria, próg kompletności 90% i brak odczytów', () => {
  const daty = kolejneDni('2025-01-01', 400)
  const z = (ileZer) => daty.map((_, i) => (i >= 400 - ileZer ? 0 : 100))
  // 36 zer w oknie: 329 z 365 dni z odczytem, dokładnie próg; zera nie zaniżają średniej.
  const odczyty = daty.map((_, i) => (i >= 400 - 365 && i < 400 - 365 + 36 ? 0 : 100))
  const ok = sredniaRoczna(daty, odczyty)
  assert.equal(ok.dni, 329)
  assert.equal(ok.srednia, 100)
  const za = daty.map((_, i) => (i >= 400 - 365 && i < 400 - 365 + 37 ? 0 : 100))
  const odpada = sredniaRoczna(daty, za)
  assert.equal(odpada.srednia, null)
  assert.match(odpada.powod, /328 z 365 dni z odczytem \(wymagane 329\)/)
  // Same zera na końcu: okno kończy się na ostatnim dodatnim odczycie.
  assert.equal(sredniaRoczna(daty, z(5)).do, daty[394])
  assert.deepEqual(
    sredniaRoczna(
      daty,
      daty.map(() => null),
    ),
    {
      srednia: null,
      powod: 'brak odczytów',
    },
  )
  assert.equal(
    sredniaRoczna(
      daty,
      daty.map(() => 0),
    ).srednia,
    null,
  )
})

test('średnia roczna: średnie letnia i zimowa liczą tylko dni tych miesięcy', () => {
  const daty = kolejneDni('2025-09-01', 365)
  const odczyty = daty.map((d) => {
    const m = d.slice(5, 7)
    return ['06', '07', '08'].includes(m) ? 300 : ['12', '01', '02'].includes(m) ? 50 : 100
  })
  const w = sredniaRoczna(daty, odczyty)
  assert.equal(w.srednieLato, 300)
  assert.equal(w.sredniaZima, 50)
})

test('nazwy liczników łączą się mimo wielkości liter, spacji i zapisu znaków diakrytycznych', () => {
  assert.equal(kluczNazwy(' Mogilska '), kluczNazwy('mogilska'))
  assert.equal(kluczNazwy('Monte  Cassino'), kluczNazwy('monte cassino'))
  // „ń” jako jeden znak i jako „n” + akcent łączący.
  assert.equal(kluczNazwy('Smoleńsk'), kluczNazwy('Smoleńsk'))
  assert.notEqual(kluczNazwy('Smoleńsk'), kluczNazwy('Smolensk'))
  assert.equal(kluczNazwy(null), '')
})

test('liczniki z MSIP: tylko typ „licznik rowerowy”, z geometrią w ramce Krakowa, bez duplikatów', () => {
  const o = (typ, nazwa, x, y) => ({
    attributes: { typ, nazwa },
    geometry: x === null ? null : { x, y },
  })
  const { liczniki, pominiete } = licznikiZMsip([
    o('licznik rowerowy', 'Mogilska', X0, Y0),
    o(' Licznik rowerowy ', 'Kopernika', X0 + 10, Y0),
    o('licznik rowerowy', 'mogilska', X0 + 99, Y0),
    o('licznik rowerowy', 'Bez geometrii', null),
    o('licznik rowerowy', 'Poza Krakowem', 9_000_000, Y0),
    o('licznik rowerowy', '', X0, Y0),
    o('stojak', 'Stojak', X0, Y0),
  ])
  assert.deepEqual(
    liczniki.map((l) => [l.nazwa, l.x]),
    [
      ['Mogilska', X0],
      ['Kopernika', X0 + 10],
    ],
  )
  assert.deepEqual(pominiete, { inneTypy: 1, bezGeometrii: 2, poZasiegu: 1, powtorzone: 1 })
  assert.equal(
    dataImportuMsip([
      { attributes: { data_importu: '26/09/2026' } },
      { attributes: { data_importu: '01/10/2026' } },
      { attributes: { data_importu: 'x' } },
    ]),
    '2026-10-01',
  )
  assert.throws(() => dataImportuMsip([{ attributes: {} }]), /data_importu/)
})

test('łączenie położeń z tabelą: każdy licznik trafia na listę użytych albo odrzuconych z powodem', () => {
  const daty = kolejneDni('2025-01-01', 400)
  const pelny = daty.map(() => 100)
  const krotki = daty.map((_, i) => (i >= 300 ? 80 : null))
  const pomiary = {
    daty,
    koniecTabeli: daty.at(-1),
    liczniki: new Map([
      ['Alfa', pelny],
      ['Beta', krotki],
      ['Gamma', pelny],
    ]),
  }
  const pozycje = [
    { nazwa: 'alfa', klucz: 'alfa', x: X0, y: Y0 },
    { nazwa: 'Beta', klucz: 'beta', x: X0 + 1, y: Y0 },
    { nazwa: 'Delta', klucz: 'delta', x: X0 + 2, y: Y0 },
  ]
  const { uzyte, odrzucone } = zlaczLiczniki(pozycje, pomiary)
  assert.deepEqual(
    uzyte.map((l) => [l.nazwa, l.srednia, l.x]),
    [['alfa', 100, X0]],
  )
  assert.deepEqual(odrzucone, [
    { nazwa: 'Beta', powod: '100 z 365 dni z odczytem (wymagane 329)' },
    { nazwa: 'Gamma', powod: 'brak położenia w MSIP' },
    { nazwa: 'Delta', powod: 'brak w tabeli pomiarów' },
  ])
})

test('najbliższy licznik: promień włącznie, wybór bliższego, brak trafienia i złe dane', () => {
  const a = { nazwa: 'A', x: X0, y: Y0, srednia: 1000 }
  const b = { nazwa: 'B', x: X0 + 1500, y: Y0, srednia: 2000 }
  assert.equal(PROMIEN, 1000)
  // Dokładnie 1000 m jeszcze jest w zasięgu, 1000,001 m już nie.
  assert.equal(najblizszyLicznik([a], X0 + 1000, Y0)?.licznik.nazwa, 'A')
  assert.equal(najblizszyLicznik([a], X0 + 1000.001, Y0), null)
  // Z dwóch w zasięgu wygrywa bliższy (B jest o 500 m, A o 1000 m).
  assert.equal(najblizszyLicznik([a, b], X0 + 1000, Y0)?.licznik.nazwa, 'B')
  // Punkt 700 m od A i 800 m od B: bliższy jest A, choć oba są w zasięgu.
  assert.equal(najblizszyLicznik([b, a], X0 + 700, Y0)?.licznik.nazwa, 'A')
  assert.equal(najblizszyLicznik([a, b], X0 + 760, Y0)?.licznik.nazwa, 'B')
  assert.equal(najblizszyLicznik([a, b], X0 + 760, Y0)?.metry, 740)
  // Odległość liczy się w obu osiach (3-4-5).
  assert.equal(najblizszyLicznik([a], X0 + 300, Y0 + 400)?.metry, 500)
  assert.equal(najblizszyLicznik([a], X0, Y0, 0)?.metry, 0)
  assert.equal(najblizszyLicznik([], X0, Y0), null)
  assert.equal(najblizszyLicznik([a], Number.NaN, Y0), null)
})

test('wskaźnik: wartość z najbliższego licznika zaokrąglona do 10, etykieta z odległością, poza zasięgiem null', () => {
  assert.equal(zaokraglij10(774.9), 770)
  assert.equal(zaokraglij10(775), 780)
  assert.equal(etykietaLicznika('Mogilska', 623), 'licznik Mogilska, 620 m')
  assert.equal(dataPl('2026-08-31'), '31.08.2026')
  const liczniki = [
    { nazwa: 'Mogilska', x: X0, y: Y0, srednia: 2224.1 },
    { nazwa: 'Bora-Komorowskiego', x: X0 + 5000, y: Y0, srednia: 684.4 },
  ]
  const { wartosci, etykiety } = policzWskaznik(
    [
      [X0 + 600, Y0],
      [X0 + 5000, Y0 - 999],
      [X0 + 2500, Y0],
      [X0 + 1001, Y0],
    ],
    liczniki,
  )
  assert.deepEqual(wartosci, [2220, 680, null, null])
  assert.deepEqual(etykiety, [
    'licznik Mogilska, 600 m',
    'licznik Bora-Komorowskiego, 1000 m',
    null,
    null,
  ])
})

test('odległość po elipsoidzie: stopnie szerokości i długości w Krakowie, zgodność z EPSG:2178', () => {
  // 1° szerokości na 50°N to ok. 111 230 m, 1° długości ok. 71 690 m (GRS80).
  assert.ok(Math.abs(odlegloscElipsoidyM(20, 49.5, 20, 50.5) - 111_230) < 60)
  assert.ok(Math.abs(odlegloscElipsoidyM(19.5, 50, 20.5, 50) - 71_690) < 60)
  assert.equal(odlegloscElipsoidyM(19.9, 50.05, 19.9, 50.05), 0)
  // Para punktów prawie kilometr od siebie: proj4 (EPSG:2178) i elipsoida różnią się o ułamek metra.
  const [x1, y1] = naMetry(19.9373, 50.0617)
  const [x2, y2] = naMetry(19.945, 50.068)
  const plaska = Math.hypot(x2 - x1, y2 - y1)
  assert.ok(plaska > 850 && plaska < 950, String(plaska))
  assert.ok(Math.abs(plaska - odlegloscElipsoidyM(19.9373, 50.0617, 19.945, 50.068)) < 0.5)
})

function wczytajPlik(id) {
  return JSON.parse(readFileSync(join(DANE, 'wskazniki', `${id}.json`), 'utf8'))
}

test('opublikowany wskaźnik: wersja adresów, brak zer, etykiety spójne z wartościami i zasięgiem', () => {
  const { wersja, adresy } = wczytajAdresy()
  const p = wczytajPlik('rower_ruch_dobowy')
  assert.equal(p.wersjaAdresow, wersja)
  assert.equal(p.meta.zadanie, 136)
  assert.equal(p.meta.kategoria, 'transport')
  assert.equal(p.meta.kierunek, 'wiecej-lepiej')
  assert.equal(p.meta.rozdzielczosc, 'rejon')
  assert.equal(p.meta.jednostka, 'rowerów/dobę')
  assert.equal(p.wartosci.length, adresy.length)
  assert.equal(p.etykiety.length, adresy.length)

  const poLicznikach = new Map()
  let wartosciOdczytane = 0
  p.wartosci.forEach((v, i) => {
    // Brak licznika w 1 km to null (nigdy 0), a etykieta jest wtedy pusta i na odwrót.
    assert.equal(v === null, p.etykiety[i] === null, `adres ${i}`)
    if (v === null) return
    wartosciOdczytane++
    assert.ok(Number.isInteger(v) && v >= 100 && v <= 3000 && v % 10 === 0, `adres ${i}: ${v}`)
    const m = /^licznik (.+), (\d+) m$/.exec(p.etykiety[i])
    assert.ok(m, `adres ${i}: ${p.etykiety[i]}`)
    assert.ok(Number(m[2]) <= PROMIEN && Number(m[2]) % 10 === 0, `adres ${i}: ${m[2]} m`)
    const wartosciLicznika = poLicznikach.get(m[1]) ?? new Set()
    wartosciLicznika.add(v)
    poLicznikach.set(m[1], wartosciLicznika)
  })
  // Każdy licznik ma jedną wartość (jedna średnia roczna), a liczników jest tyle, ile z kompletnym rokiem.
  for (const [nazwa, wartosci] of poLicznikach) assert.equal(wartosci.size, 1, nazwa)
  assert.ok(poLicznikach.size >= 10 && poLicznikach.size <= 19, String(poLicznikach.size))
  assert.ok(p.meta.opis.includes(`${poLicznikach.size} automatycznych liczników`))

  // Liczniki stoją w Krakowie, więc obwarzanek nie ma żadnego w promieniu 1 km.
  const wKrakowie = adresy.map((a) => a.teryt === '1261011')
  adresy.forEach((_, i) => {
    if (!wKrakowie[i]) assert.equal(p.wartosci[i], null, `adres ${i} poza Krakowem`)
  })
  const udzial = wartosciOdczytane / wKrakowie.filter(Boolean).length
  assert.ok(udzial > 0.05 && udzial < 0.4, `pokrycie Krakowa ${udzial}`)
})

test('opublikowany wskaźnik: źródła z atrybucją i datami, polska półpauza zamiast pauzy', () => {
  const { meta } = wczytajPlik('rower_ruch_dobowy')
  assert.equal(meta.zrodla.length, 2)
  const [liczby, polozenie] = meta.zrodla
  assert.ok(liczby.url.startsWith('https://ztp.krakow.pl/'))
  assert.ok(liczby.licencja.includes('otwartedane.um.krakow.pl'))
  assert.ok(polozenie.nazwa.includes('Gmina Miejska Kraków, Portal MSIP Obserwatorium'))
  assert.ok(polozenie.url.includes('/ZTP_Komunikacja_Miejska_i_Rowerowa/MapServer/3'))
  for (const z of meta.zrodla) {
    assert.match(z.dataDanych, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(z.pobrano, /^\d{4}-\d{2}-\d{2}$/)
  }
  assert.ok(Array.isArray(meta.zakres) && meta.zakres[0] === 0 && meta.zakres[1] > 0)
  // Pauza (U+2014) w polskim tekście jest zakazana; półpauza (U+2013) ze spacjami jest poprawna.
  const pauza = String.fromCharCode(0x2014)
  assert.ok(!JSON.stringify(meta).includes(pauza), 'w tekstach jest pauza zamiast półpauzy')
  assert.ok(meta.opis.includes(' – '), 'opis ma mieć półpauzę ze spacjami')
})
