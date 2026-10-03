import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { cellToLatLng, latLngToCell } from 'h3-js'
import {
  dniSlownie,
  ID_WSKAZNIKA,
  MECZE_DOMOWE_W_SEZONIE,
  metaWskaznika,
  OKNO,
  obiektyWZasiegu,
  opisHeksu,
  PLIK_MIGAWKI,
  PROMIEN_M,
  policzWarstwe,
  przygotujObiekty,
  sprawdzMigawke,
  TERYT_KRAKOW,
} from './imprezy-obiekty.mjs'
import {
  czyOdwolane,
  dniDoMiesiecy,
  dniExpo,
  dniICE,
  dniTauron,
  dniZMiesiecy,
  dodajDni,
  dzienISO,
  dzienWarszawski,
  meczeDomoweCSV,
  meczeDomoweLiga,
  obrysDoWkt,
  obrysZElementu,
  obrysZWkt,
  parsujDateICE,
  tekstZHtml,
  wpisyICE,
  zakresDni,
  zakresZDatyEXPO,
} from './lib/imprezy-zrodla.mjs'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'

const okno = { od: '2025-07-01', do: '2026-06-30' }
const migawka = JSON.parse(readFileSync(PLIK_MIGAWKI, 'utf8'))

// ── Daty ─────────────────────────────────────────────────────────────────────────────────

test('daty: nieistniejący dzień to null, zakres jest włącznie, odwrócony i zbyt długi to błąd', () => {
  assert.equal(dzienISO(2026, 2, 29), null)
  assert.equal(dzienISO(2028, 2, 29), '2028-02-29')
  assert.equal(dodajDni('2025-12-31', 1), '2026-01-01')
  assert.deepEqual(zakresDni('2026-02-27', '2026-03-01'), [
    '2026-02-27',
    '2026-02-28',
    '2026-03-01',
  ])
  assert.throws(() => zakresDni('2026-03-02', '2026-03-01'), /od końca/)
  assert.throws(() => zakresDni('2026-01-01', '2026-03-01'), /dłuższy niż 7 dni/)
})

test('dzień warszawski: noc po północy w lecie to już następny dzień', () => {
  assert.equal(dzienWarszawski('2025-08-16T22:30:00.000000Z'), '2025-08-17')
  assert.equal(dzienWarszawski('2025-12-16T22:30:00.000000Z'), '2025-12-16')
})

test('tekstZHtml: znaczniki, encje liczbowe i nazwane', () => {
  assert.equal(
    tekstZHtml('<p>Koncert &#8211; &quot;Gwiazda&quot; &amp; goście&nbsp;!</p>'),
    'Koncert – "Gwiazda" & goście !',
  )
})

test('odwołanie: tylko formy „odwołany”, nie „w razie odwołania”', () => {
  assert.ok(czyOdwolane('WYDARZENIE ODWOŁANE'))
  assert.ok(czyOdwolane('Koncert', 'Wydarzenie zostało odwołane. Pieniądze zostaną zwrócone'))
  assert.ok(czyOdwolane('Koncert', 'Informujemy, że trasa została odwołana.'))
  assert.ok(czyOdwolane('Koncert', 'KONCERT ODWOŁANY - szczegóły w Aktualnościach'))
  assert.ok(!czyOdwolane('Koncert', 'W razie odwołania koncertu bilety zostaną zwrócone.'))
  assert.ok(!czyOdwolane('Koncert', `${'x'.repeat(250)} odwołany`)) // dalej niż początek opisu
})

// ── TAURON Arena ─────────────────────────────────────────────────────────────────────────

test('TAURON: dni, wpisy wielodniowe, przycięcie do okna i odwołane', () => {
  const wpisy = [
    {
      title: 'Koncert &#8211; Gwiazda',
      description: '<p>Opis</p>',
      start_date: '2025-07-03 20:30:00',
      end_date: '2025-07-03 20:30:00',
    },
    {
      title: 'Drugi koncert tego dnia',
      start_date: '2025-07-03 15:00:00',
      end_date: '2025-07-03 15:00:00',
    },
    {
      title: 'Występ',
      description: '<p>Wydarzenie zostało odwołane.</p>',
      start_date: '2025-09-20 18:00:00',
      end_date: '2025-09-20 18:00:00',
    },
    {
      title: 'Majówka',
      description: '',
      start_date: '2026-05-01 11:00:00',
      end_date: '2026-05-03 23:00:00',
    },
    { title: 'Przed oknem', start_date: '2025-06-30 18:00:00', end_date: '2025-06-30 20:00:00' },
    { title: 'Po oknie', start_date: '2026-07-01 18:00:00', end_date: '2026-07-01 20:00:00' },
    { title: 'Na styku', start_date: '2026-06-29 10:00:00', end_date: '2026-07-02 12:00:00' },
    {
      title: 'Z regulaminem',
      description: 'W razie odwołania koncertu zwrot biletów.',
      start_date: '2025-08-05 19:00:00',
      end_date: '2025-08-05 19:00:00',
    },
  ]
  const wynik = dniTauron(wpisy, okno)
  assert.deepEqual(wynik.dni, [
    '2025-07-03',
    '2025-08-05',
    '2026-05-01',
    '2026-05-02',
    '2026-05-03',
    '2026-06-29',
    '2026-06-30',
  ])
  assert.equal(wynik.wpisow, 5)
  assert.deepEqual(wynik.odrzucone, [
    { data: '2025-09-20', tytul: 'Występ', powod: 'wpis oznaczony jako odwołany' },
  ])
})

// ── EXPO Kraków ──────────────────────────────────────────────────────────────────────────

test('EXPO: daty wyświetlane na stronie w trzech formach', () => {
  assert.deepEqual(zakresZDatyEXPO('15-16.02', '2025'), { od: '2025-02-15', do: '2025-02-16' })
  assert.deepEqual(zakresZDatyEXPO('11.10', '2025'), { od: '2025-10-11', do: '2025-10-11' })
  assert.deepEqual(zakresZDatyEXPO('30.06-01.07', '2025'), { od: '2025-06-30', do: '2025-07-01' })
  assert.deepEqual(zakresZDatyEXPO('30.12-02.01', '2025'), { od: '2025-12-30', do: '2026-01-02' })
  assert.equal(zakresZDatyEXPO('jutro', '2025'), null)
})

test('EXPO: strefa czasowa, przycięcie do okna, inne miejsce i niezgodność z datą na stronie', () => {
  const wpisy = [
    {
      title: 'Targi A',
      place: 'EXPO Kraków',
      start_date: '2025-10-04T11:40:00.000000Z',
      end_date: '2025-10-05T11:40:00.000000Z',
      processed_date: { day_and_month: '04-05.10', year: '2025' },
    },
    {
      title: 'Kongres B',
      place: 'Muzeum Manggha, Kraków',
      start_date: '2026-04-17T09:19:00.000000Z',
      end_date: '2026-04-18T09:19:00.000000Z',
      processed_date: { day_and_month: '17-18.04', year: '2026' },
    },
    {
      title: 'Zjazd C',
      place: 'EXPO Kraków',
      start_date: '2025-06-30T06:00:00.000000Z',
      end_date: '2025-07-01T21:55:55.000000Z',
      processed_date: { day_and_month: '30.06-01.07', year: '2025' },
    },
    {
      title: 'Noc D',
      place: 'EXPO Kraków',
      start_date: '2025-08-16T22:30:00.000000Z',
      end_date: '2025-08-16T22:30:00.000000Z',
    },
  ]
  const wynik = dniExpo(wpisy, okno)
  assert.deepEqual(wynik.dni, ['2025-07-01', '2025-08-17', '2025-10-04', '2025-10-05'])
  assert.equal(wynik.wpisow, 3)
  assert.deepEqual(wynik.odrzucone, [
    { data: '2026-04-17', tytul: 'Kongres B', powod: 'inne miejsce: Muzeum Manggha, Kraków' },
  ])
  const zle = [{ ...wpisy[0], processed_date: { day_and_month: '05.10', year: '2025' } }]
  assert.throws(() => dniExpo(zle, okno), /strona pokazuje/)
})

// ── ICE Kraków ───────────────────────────────────────────────────────────────────────────

test('ICE: formy dat z kalendarium, także błędne', () => {
  const dzien = (d) => ({ od: d, do: d })
  assert.deepEqual(parsujDateICE('sobota, 26 lipca 2025 19:00'), dzien('2025-07-26'))
  assert.deepEqual(parsujDateICE('sobota, 26 lipca 2025 15:00 i 18:30'), dzien('2025-07-26'))
  assert.deepEqual(parsujDateICE('niedziela, 15 Marzec 2026 15:00'), dzien('2026-03-15'))
  assert.deepEqual(parsujDateICE('17 - 19 czerwca 2025 12:00'), {
    od: '2025-06-17',
    do: '2025-06-19',
  })
  assert.deepEqual(parsujDateICE('27 - 28 Marzec 2026 18:00'), {
    od: '2026-03-27',
    do: '2026-03-28',
  })
  assert.deepEqual(parsujDateICE('19 - 19 maja 2026 10:00'), dzien('2026-05-19'))
  assert.deepEqual(parsujDateICE('30 maja - 1 czerwca 2025 10:00'), {
    od: '2025-05-30',
    do: '2025-06-01',
  })
  assert.deepEqual(parsujDateICE('31 grudnia 2025 - 2 stycznia 2026 10:00'), {
    od: '2025-12-31',
    do: '2026-01-02',
  })
  // zakres od końca, zapis liczbowy, nieznany miesiąc, nieistniejący dzień: do odrzuconych
  assert.equal(parsujDateICE('21.02.2026 - 29.05.2025 17:00'), null)
  assert.equal(parsujDateICE('12.12 - 08.11 2025 17:00 i 19:30'), null)
  assert.equal(parsujDateICE('5 lipcowego 2025 19:00'), null)
  assert.equal(parsujDateICE('31 lutego 2026 19:00'), null)
  assert.equal(parsujDateICE('20 - 18 maja 2026 10:00'), null)
})

const SZABLON_ICE = `
<div class="list-featured"><div class="event featured modal-entity" data-address-slug="dzien-dobry">
  <header><span class="date">niedziela, 31 maja 2026 09:00 </span><span class="cat">Społeczne</span></header>
  <h4>Dzień Dobry ICE &amp; Kraków</h4><div class="paragraph-text">Rodzinne święto.</div>
  <a href="/o-ice-krakow" class="upperline">cały obiekt</a></div></div>
<div class="entities-box">
  <div class="event modal-entity" data-address-slug="a"><header>
    <span class="date">sobota, 26 lipca 2025 19:00 </span><span class="cat">Kulturalne</span></header>
    <h4>Jazz</h4><div class="paragraph-text">Koncert.</div><a class="upperline" href="#">Sala Audytoryjna | S1</a></div>
  <div class="event modal-entity" data-address-slug="b"><header>
    <span class="date">17 - 19 czerwca 2026 12:00 </span></header>
    <h4>Kongres</h4><div class="paragraph-text">Trzy dni.</div></div>
  <div class="event modal-entity" data-address-slug="c"><header>
    <span class="date">wtorek, 2 września 2025 20:00 </span></header>
    <h4>Koncert - Gwiazda</h4><div class="paragraph-text"><strong>KONCERT ODWOŁANY - szczegóły</strong></div></div>
  <div class="event modal-entity" data-address-slug="d"><header>
    <span class="date">12.12 - 08.11 2025 17:00 i 19:30 </span></header>
    <h4>Komedia</h4><div class="paragraph-text">Błędna data.</div></div>
  <div class="event modal-entity" data-address-slug="e"><header>
    <span class="date">sobota, 8 lutego 2025 18:00 </span></header>
    <h4>Przed oknem</h4><div class="paragraph-text">Gala.</div></div>
</div>`

test('ICE: wpisy z HTML i dni w oknie; odwołane i niejednoznaczne trafiają do odrzuconych', () => {
  const wpisy = wpisyICE(`<div class="events-list fp">${SZABLON_ICE}`)
  assert.equal(wpisy.length, 6)
  assert.equal(wpisy[0]?.tytul, 'Dzień Dobry ICE & Kraków')
  assert.equal(wpisy[1]?.miejsce, 'Sala Audytoryjna | S1')
  const wynik = dniICE(wpisy, okno)
  assert.deepEqual(wynik.dni, [
    '2025-07-26',
    '2026-05-31',
    '2026-06-17',
    '2026-06-18',
    '2026-06-19',
  ])
  assert.equal(wynik.wpisow, 3)
  assert.deepEqual(
    wynik.odrzucone.map((o) => o.powod),
    ['wpis oznaczony jako odwołany', 'niejednoznaczna data w kalendarzu'],
  )
})

// ── Mecze domowe ─────────────────────────────────────────────────────────────────────────

test('CSV football-data: tylko mecze domowe drużyny w danym sezonie', () => {
  const csv = [
    '﻿Country,League,Season,Date,Time,Home,Away,HG,AG,Res',
    'Poland,Ekstraklasa,2025/2026,18/07/2025,20:30,Lech Poznan,Cracovia,1,4,A',
    'Poland,Ekstraklasa,2025/2026,25/07/2025,17:00,Cracovia,Termalica B-B.,2,0,H',
    'Poland,Ekstraklasa,2024/2025,10/08/2024,17:00,Cracovia,Legia,0,1,A',
    'Poland,Ekstraklasa,2025/2026,03/08/2025,13:45,Cracovia,Lechia Gdansk,2,2,D',
  ].join('\n')
  assert.deepEqual(meczeDomoweCSV(csv, { druzyna: 'Cracovia', sezon: '2025/2026' }), [
    '2025-07-25',
    '2025-08-03',
  ])
  assert.throws(
    () => meczeDomoweCSV('Season,Date\nx', { druzyna: 'a', sezon: 'b' }),
    /brak kolumny Home/,
  )
})

const mecz = (stan, gospodarz, gosc, data) => `
<div class="single-match-wrapper"><div class="single-match-display-list ">
 <div class="buttons-section"><div class="match-state"> ${stan} </div></div>
 <div class="teams-section">
  <div class="team-name home-team-name grayedout"> ${gospodarz} </div>
  <div class="match-info-wrapper"><div class="round-info"> 1. Kolejka </div>
   <div class="round-date-info"> ${data} </div></div>
  <div class="team-name away-team-name "> ${gosc} </div>
 </div></div></div>`

test('1liga.org: domowe mecze rozegrane, z datą rzeczywistą', () => {
  const html = [
    mecz('Finished', 'FKS Stal Mielec', 'Wisła Kraków', 'Sun. 20.07.2025'),
    mecz('Finished', 'Wisła Kraków', 'ŁKS Łódź', 'Sat. 26.07.2025'),
    mecz('Upcoming', 'Wisła Kraków', 'Odra Opole', 'Sat. 13.09.2026'),
    mecz('Finished', 'Wisła Kraków', 'Znicz Pruszków', 'Mon. 04.08.2025'),
  ].join('')
  assert.deepEqual(meczeDomoweLiga(html, 'Wisła Kraków'), ['2025-07-26', '2025-08-04'])
  assert.throws(
    () => meczeDomoweLiga('<div class="single-match-wrapper">brak</div>', 'x'),
    /budowa strony/,
  )
})

// ── Obrysy i zapis migawki ───────────────────────────────────────────────────────────────

test('obrys z OSM: zamknięta linia i relacja z jednym obrysem zewnętrznym', () => {
  const p = [
    { lat: 50.0, lon: 19.9 },
    { lat: 50.0, lon: 19.91 },
    { lat: 50.01, lon: 19.91 },
    { lat: 50.0, lon: 19.9 },
  ]
  assert.equal(obrysZElementu({ type: 'way', id: 1, geometry: p }).length, 4)
  const rel = {
    type: 'relation',
    id: 2,
    members: [
      { role: 'outer', geometry: p },
      { role: 'inner', geometry: p },
    ],
  }
  assert.equal(obrysZElementu(rel).length, 4)
  assert.throws(
    () => obrysZElementu({ type: 'way', id: 3, geometry: p.slice(0, 3) }),
    /nie jest zamknięty/,
  )
  assert.throws(
    () =>
      obrysZElementu({
        type: 'relation',
        id: 4,
        members: [
          { role: 'outer', geometry: p },
          { role: 'outer', geometry: p },
        ],
      }),
    /obrysów zewnętrznych/,
  )
})

test('zapis w migawce: WKT i dni po miesiącach wracają bez zmian', () => {
  const p = [
    [19.9, 50.0],
    [19.91, 50.0],
    [19.91, 50.01],
    [19.9, 50.0],
  ]
  assert.deepEqual(obrysZWkt(obrysDoWkt(p)), p)
  const dni = ['2025-07-03', '2025-07-04', '2025-12-31', '2026-01-06']
  assert.deepEqual(dniDoMiesiecy(dni), { '2025-07': '03 04', '2025-12': '31', '2026-01': '06' })
  assert.deepEqual(dniZMiesiecy(dniDoMiesiecy(dni)), dni)
  assert.throws(() => dniZMiesiecy({ '2025-02': '30' }), /zły dzień/)
})

// ── Migawka z repozytorium ───────────────────────────────────────────────────────────────

test('migawka: pięć obiektów, dni w oknie, pełne sezony ligowe', () => {
  const obiekty = sprawdzMigawke(migawka)
  assert.deepEqual(
    obiekty.map((o) => o.id),
    ['tauron-arena', 'expo-krakow', 'ice-krakow', 'stadion-cracovii', 'stadion-wisly'],
  )
  for (const o of obiekty) {
    assert.ok(o.dni.size > 0, `${o.id}: brak dni`)
    assert.ok(o.obrys.length >= 4)
  }
  for (const id of ['stadion-cracovii', 'stadion-wisly'])
    assert.equal(obiekty.find((o) => o.id === id)?.dni.size, MECZE_DOMOWE_W_SEZONIE)
  // kalendarze obiektów nie mogą wyjść „pustawe”: to znak zmienionej budowy strony, nie braku imprez
  for (const id of ['tauron-arena', 'expo-krakow', 'ice-krakow'])
    assert.ok((obiekty.find((o) => o.id === id)?.dni.size ?? 0) >= 40, `${id}: za mało dni`)
  for (const o of migawka.obiekty) assert.ok(o.odrzucone.length <= 10, `${o.id}: dużo odrzuconych`)
})

test('migawka: zepsuty plik zatrzymuje skrypt', () => {
  const kopia = structuredClone(migawka)
  kopia.obiekty[0].dni['2024-01'] = '01'
  assert.throws(() => sprawdzMigawke(kopia), /poza oknem|liczbaDni/)
  const inneOkno = { ...structuredClone(migawka), okno: { od: '2024-07-01', do: '2025-06-30' } }
  assert.throws(() => sprawdzMigawke(inneOkno), /okno/)
  const zlyObrys = structuredClone(migawka)
  zlyObrys.obiekty[1].obrys = 'POLYGON((10.0 10.0, 10.1 10.0, 10.1 10.1, 10.0 10.0))'
  assert.throws(() => sprawdzMigawke(zlyObrys), /poza Krakowem/)
})

// ── Zasięg i liczenie dni ────────────────────────────────────────────────────────────────

const obiekty = przygotujObiekty(migawka)
const obiekt = (id) => {
  const o = obiekty.find((x) => x.id === id)
  assert.ok(o)
  return o
}

/** Środek obrysu jako średnia wierzchołków [lon, lat]. */
function srodekObrysu(obrys) {
  const lon = obrys.reduce((s, p) => s + p[0], 0) / obrys.length
  const lat = obrys.reduce((s, p) => s + p[1], 0) / obrys.length
  return { lon, lat }
}

/** Niezależne liczenie w lokalnym układzie płaskim (nie EPSG:2180): odległość od punktu do obrysu. */
function odlegloscNiezalezna(lat, lon, obrys) {
  const { lon: lon0, lat: lat0 } = srodekObrysu(obrys)
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 110_574
  const px = (lon - lon0) * kx
  const py = (lat - lat0) * ky
  const w = obrys.map(([x, y]) => [(x - lon0) * kx, (y - lat0) * ky])
  let wewnatrz = false
  let najmniej = Number.POSITIVE_INFINITY
  for (let i = 0, j = w.length - 1; i < w.length; j = i++) {
    const [xi, yi] = w[i]
    const [xj, yj] = w[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) wewnatrz = !wewnatrz
    const dx = xj - xi
    const dy = yj - yi
    const t = Math.max(0, Math.min(1, ((px - xi) * dx + (py - yi) * dy) / (dx * dx + dy * dy || 1)))
    najmniej = Math.min(najmniej, Math.hypot(px - (xi + t * dx), py - (yi + t * dy)))
  }
  return wewnatrz ? 0 : najmniej
}

test('zasięg 500 m od obrysu zgadza się z niezależnym liczeniem dla wszystkich obiektów', () => {
  let sprawdzono = 0
  let wZasiegu = 0
  for (const o of obiekty) {
    const { lon: lon0, lat: lat0 } = srodekObrysu(o.obrys)
    for (let kat = 0; kat < 360; kat += 15) {
      for (let r = 0; r <= 900; r += 50) {
        const lat = lat0 + (r * Math.cos((kat * Math.PI) / 180)) / 110_574
        const lon =
          lon0 +
          (r * Math.sin((kat * Math.PI) / 180)) / (111_320 * Math.cos((lat0 * Math.PI) / 180))
        const d = odlegloscNiezalezna(lat, lon, o.obrys)
        if (Math.abs(d - PROMIEN_M) < 3) continue // na samej granicy układy mogą się różnić o metry
        sprawdzono++
        const jest = obiektyWZasiegu(lat, lon, [o]).length === 1
        assert.equal(
          jest,
          d <= PROMIEN_M,
          `${o.id}: kąt ${kat}, ${r} m, odległość ${d.toFixed(1)} m`,
        )
        if (jest) wZasiegu++
      }
    }
  }
  assert.ok(sprawdzono > 1500, `sprawdzono tylko ${sprawdzono} punktów`)
  assert.ok(wZasiegu > 300 && wZasiegu < sprawdzono, 'test nie rozróżnia wnętrza i zewnętrza')
})

test('wartość heksu to różne dni: wspólny dzień dwóch obiektów liczy się raz', () => {
  const a = { nazwa: 'A', dni: new Set(['2025-07-01', '2025-07-02']) }
  const b = { nazwa: 'B', dni: new Set(['2025-07-02', '2025-07-03', '2025-07-04']) }
  assert.deepEqual(opisHeksu([a, b]), { wartosc: 4, tekst: 'B (3 dni), A (2 dni)' })
  // jeden obiekt: sama nazwa, bo karta pokazuje „wartość – etykieta” i liczba nie może się powtórzyć
  assert.deepEqual(opisHeksu([a]), { wartosc: 2, tekst: 'A' })
  assert.deepEqual(opisHeksu([]), { wartosc: 0, tekst: '' })
  assert.equal(dniSlownie(1), '1 dzień')
  assert.equal(dniSlownie(17), '17 dni')
})

test('heks przy TAURON Arenie, stadionie Cracovii i na Rynku', () => {
  const tauron = obiekt('tauron-arena')
  const [lonT, latT] = tauron.obrys[0] ?? [0, 0]
  const przyArenie = opisHeksu(obiektyWZasiegu(latT, lonT, obiekty))
  assert.equal(przyArenie.wartosc, tauron.dni.size)
  assert.equal(przyArenie.tekst, 'TAURON Arena Kraków')

  const cracovia = obiekt('stadion-cracovii')
  const [lonC, latC] = cracovia.obrys[10] ?? [0, 0]
  const przyStadionie = opisHeksu(obiektyWZasiegu(latC, lonC, obiekty))
  assert.ok(przyStadionie.tekst.startsWith('Stadion Cracovii'))
  assert.ok(przyStadionie.wartosc >= 17)

  // Rynek Główny leży ponad kilometr od każdego z pięciu obiektów: zero, nie brak danych
  assert.deepEqual(opisHeksu(obiektyWZasiegu(50.0614956, 19.9371133, obiekty)), {
    wartosc: 0,
    tekst: '',
  })
})

test('adresy: ten sam heks daje tę samą wartość, poza Krakowem null, zero to nie brak danych', () => {
  const [lonT, latT] = obiekt('tauron-arena').obrys[0] ?? [0, 0]
  const h3Arena = latLngToCell(latT, lonT, 10)
  const h3Rynek = latLngToCell(50.0614956, 19.9371133, 10)
  const wynik = policzWarstwe(
    [
      { h3: h3Arena, teryt: TERYT_KRAKOW },
      { h3: h3Arena, teryt: TERYT_KRAKOW },
      { h3: h3Rynek, teryt: TERYT_KRAKOW },
      { h3: h3Arena, teryt: '1206042' },
    ],
    obiekty,
  )
  assert.equal(wynik.wartosci[0], wynik.wartosci[1])
  assert.ok((wynik.wartosci[0] ?? 0) > 0)
  assert.equal(wynik.wartosci[2], 0)
  assert.equal(wynik.etykiety[2], null)
  assert.equal(wynik.wartosci[3], null)
  assert.equal(wynik.etykiety[3], null)
  assert.equal(wynik.liczbaHeksow, 2)
  const kod = wynik.etykiety[0]
  assert.ok(kod)
  assert.equal(wynik.slownikEtykiet[kod], 'TAURON Arena Kraków')
})

// ── Plik wskaźnika w repozytorium ────────────────────────────────────────────────────────

test('plik wskaźnika odpowiada migawce i adresom, a metadane spełniają kontrakt', () => {
  const plik = JSON.parse(readFileSync(join(DANE, 'wskazniki', `${ID_WSKAZNIKA}.json`), 'utf8'))
  const { adresy, wersja } = wczytajAdresy()
  assert.equal(plik.wersjaAdresow, wersja)
  assert.equal(plik.wartosci.length, adresy.length)
  assert.deepEqual(plik.meta, metaWskaznika(migawka))
  assert.equal(plik.meta.kategoria, 'kontekst')
  assert.equal(plik.meta.kierunek, 'neutralny')
  assert.equal(plik.meta.zadanie, 71)
  const pauza = String.fromCharCode(0x2014) // w tekście PL ma być półpauza
  assert.ok(!JSON.stringify(plik.meta).includes(pauza), 'pauza w tekście PL')

  const przeliczone = policzWarstwe(adresy, obiekty)
  assert.deepEqual(plik.wartosci, przeliczone.wartosci)
  assert.deepEqual(plik.etykiety, przeliczone.etykiety)
  assert.deepEqual(plik.slownikEtykiet, przeliczone.slownikEtykiet)

  let zWartoscia = 0
  const najwiekszaSuma = obiekty.reduce((s, o) => s + o.dni.size, 0)
  adresy.forEach((a, i) => {
    const v = plik.wartosci[i]
    if (a.teryt !== TERYT_KRAKOW) {
      assert.equal(v, null, `adres ${i} poza Krakowem musi mieć null`)
      return
    }
    zWartoscia++
    assert.ok(Number.isInteger(v) && v >= 0 && v <= najwiekszaSuma, `adres ${i}: ${v}`)
    assert.equal(
      plik.etykiety[i] === null,
      v === 0,
      `adres ${i}: etykieta tylko przy dodatniej wartości`,
    )
  })
  assert.ok(zWartoscia > 50_000, 'Kraków powinien mieć pomiar dla wszystkich swoich adresów')
  // każdy obiekt i para stadionów (suma 34 dni, nie 17) są w słowniku
  const etykietyWPliku = Object.values(plik.slownikEtykiet)
  for (const o of obiekty) assert.ok(etykietyWPliku.includes(o.nazwa), `brak etykiety ${o.nazwa}`)
  assert.ok(etykietyWPliku.includes('Stadion Cracovii (17 dni), Stadion Wisły Kraków (17 dni)'))
  // karta składa „wartość jednostka – etykieta”: liczba z wartości nie może wracać w etykiecie
  adresy.forEach((_, i) => {
    const kod = plik.etykiety[i]
    if (kod === null) return
    const liczba = new RegExp(`(^|\\D)${plik.wartosci[i]}(\\D|$)`)
    assert.ok(
      !liczba.test(plik.slownikEtykiet[kod]),
      `adres ${i}: liczba ${plik.wartosci[i]} powtórzona`,
    )
  })
  // środek każdego heksu z dodatnią wartością leży w zasięgu któregoś obiektu
  for (let i = 0; i < adresy.length; i += 97) {
    const a = adresy[i]
    if (!a || a.teryt !== TERYT_KRAKOW) continue
    const [lat, lon] = cellToLatLng(a.h3)
    assert.equal(obiektyWZasiegu(lat, lon, obiekty).length > 0, (plik.wartosci[i] ?? 0) > 0)
  }
})

test('okno migawki to cały sezon 2025/26', () => {
  assert.equal(OKNO.od, '2025-07-01')
  assert.equal(OKNO.do, '2026-06-30')
  assert.equal(migawka.okno.od, OKNO.od)
  assert.equal(migawka.okno.do, OKNO.do)
})
