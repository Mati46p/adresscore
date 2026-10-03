import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  ETYKIETA_PONIZEJ_PROGU,
  etykietaAdresu,
  MAX_UDZIAL_LUK,
  najwyzszePasmo,
  PROG_LDWN,
  pasmoLdwn,
  trafienieZWiersza,
  WARTOSC_PONIZEJ_PROGU,
  ZAKRES_LDWN,
} from './halas-pasma.mjs'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'

test('pasmo 5 dB ma jawną etykietę, a liczba jest reprezentantem dla silnika', () => {
  assert.deepEqual(pasmoLdwn(55, 60), {
    wartosc: 57.5,
    etykieta: '55–59,9 dB LDWN (pasmo mapy)',
  })
  assert.deepEqual(pasmoLdwn(55, 56), {
    wartosc: 55.5,
    etykieta: '55–55,9 dB LDWN (pasmo mapy)',
  })
  assert.deepEqual(pasmoLdwn(80, 999), {
    wartosc: 80,
    etykieta: '≥80 dB LDWN (pasmo mapy)',
  })
})

test('brak i nieprawidłowe pasmo nie są zamieniane na zero', () => {
  assert.equal(pasmoLdwn(null, null), null)
  assert.equal(pasmoLdwn(undefined, undefined), null)
  assert.equal(pasmoLdwn(Number.NaN, 55), null)
  assert.equal(pasmoLdwn(55, Number.NaN), null)
  assert.equal(pasmoLdwn(49, 50), null)
  assert.equal(pasmoLdwn(-24, 50), null)
  assert.equal(pasmoLdwn(55, 70), null)
  assert.equal(pasmoLdwn(60, 55), null)
  assert.equal(najwyzszePasmo([]), null)
})

test('najniższy poligon mapy to „poniżej 55 dB”, czyli cisza, a nie brak danych (#115)', () => {
  // ISOV1 najniższego poligonu to ujemne minimum obliczeń warstwy: drogi -24,14, tory -16,36,
  // przemysł -14,95; ISOV2 zawsze równa progowi mapy.
  for (const dolna of [-24.13999939, -16.36000061, -14.94999981]) {
    assert.deepEqual(pasmoLdwn(dolna, 55), {
      wartosc: 50,
      etykieta: 'poniżej 55 dB LDWN (poza pasmami mapy)',
      cisza: true,
    })
  }
  // Wartość ciszy to dolny kraniec skali (najlepsza ocena) i leży poniżej każdego pasma mapy.
  assert.equal(WARTOSC_PONIZEJ_PROGU, ZAKRES_LDWN[0])
  assert.equal(PROG_LDWN, 55)
  assert.ok(WARTOSC_PONIZEJ_PROGU < (pasmoLdwn(55, 56)?.wartosc ?? 0))
})

test('poligony o innej górnej granicy niż próg LDWN nie są ciszą', () => {
  // Najniższe poligony nocnego LN kończą się na 50 dB; to inna miara niż LDWN.
  assert.equal(pasmoLdwn(-33.57, 50), null)
  assert.equal(pasmoLdwn(12.48, 50), null)
  assert.equal(pasmoLdwn(-24.14, 56), null)
  assert.equal(pasmoLdwn(-24.14, 60), null)
})

test('na wspólnej granicy wybierane jest wyższe pasmo', () => {
  assert.deepEqual(
    najwyzszePasmo([
      { isov1: 55, isov2: 60 },
      { isov1: 60, isov2: 65 },
    ]),
    { wartosc: 62.5, etykieta: '60–64,9 dB LDWN (pasmo mapy)' },
  )
})

test('pasmo od 55 dB z dowolnej warstwy wygrywa z ciszą z pozostałych', () => {
  assert.deepEqual(
    najwyzszePasmo([
      { isov1: -24.14, isov2: 55, zrodlo: 'drogowy' },
      { isov1: 55, isov2: 56, zrodlo: 'szynowy' },
      { isov1: -14.95, isov2: 55, zrodlo: 'przemysłowy' },
    ]),
    { wartosc: 55.5, etykieta: '55–55,9 dB LDWN (pasmo mapy)', zrodlo: 'szynowy' },
  )
})

test('adres tylko w poligonach „poniżej 55 dB” jest ciszą, adres bez poligonu to luka', () => {
  const cisza = najwyzszePasmo([
    { isov1: -24.14, isov2: 55, zrodlo: 'drogowy' },
    { isov1: -16.36, isov2: 55, zrodlo: 'szynowy' },
  ])
  assert.equal(cisza?.wartosc, 50)
  assert.equal(cisza?.cisza, true)
  // Poligon nieprawidłowy (np. 55-70) nie liczy się jako pokrycie, więc zostaje luka.
  assert.equal(najwyzszePasmo([{ isov1: 55, isov2: 70 }]), null)
  assert.equal(najwyzszePasmo([]), null)
})

test('przy remisie warstw źródłem jest pierwsza z listy', () => {
  const wynik = najwyzszePasmo([
    { isov1: 60, isov2: 65, zrodlo: 'drogowy' },
    { isov1: 60, isov2: 65, zrodlo: 'szynowy' },
  ])
  assert.equal(wynik?.zrodlo, 'drogowy')
})

test('wiersz złączenia ze złą nazwą kolumny nie jest po cichu pomijany', () => {
  // REST oddaje ISOV1/ISOV2 wielkimi literami; bez aliasów w SQL rekord.isov1 był undefined,
  // a przemysł nic nie wnosił do wyniku, choć log pokazywał trafienia (pierwszy bieg #115).
  assert.throws(
    () => trafienieZWiersza({ i: 110, ISOV1: 60, ISOV2: 65 }, 'przemysłowy'),
    /przemysłowy: poligon bez isov1\/isov2 \(kolumny wiersza: i, ISOV1, ISOV2\)/,
  )
  assert.throws(() => trafienieZWiersza({ i: 1, isov1: null, isov2: 55 }, 'drogowy'), /bez isov1/)
  assert.throws(() => trafienieZWiersza({ i: 1, isov1: 'x', isov2: 55 }, 'drogowy'), /nieliczbowe/)
  // Kolumny całkowite DuckDB może oddać jako BigInt, zmiennoprzecinkowe jako Number.
  assert.deepEqual(trafienieZWiersza({ i: 110, isov1: 60n, isov2: 65n }, 'przemysłowy'), {
    isov1: 60,
    isov2: 65,
    zrodlo: 'przemysłowy',
  })
  assert.equal(
    najwyzszePasmo([trafienieZWiersza({ i: 1, isov1: 60n, isov2: 65n }, 'x')])?.wartosc,
    62.5,
  )
})

test('etykieta adresu: cisza bez źródła hałasu, pasmo ze źródłem', () => {
  const cisza = najwyzszePasmo([{ isov1: -24.14, isov2: 55, zrodlo: 'drogowy' }])
  assert.ok(cisza)
  assert.equal(etykietaAdresu(cisza), `${ETYKIETA_PONIZEJ_PROGU}; 4 m nad terenem`)
  const pasmo = najwyzszePasmo([{ isov1: 55, isov2: 60, zrodlo: 'drogowy' }])
  assert.ok(pasmo)
  assert.equal(
    etykietaAdresu(pasmo),
    '55–59,9 dB LDWN (pasmo mapy); hałas drogowy; 4 m nad terenem',
  )
})

// Opublikowany plik jest wynikiem `node etl/halas.mjs`; test pilnuje, żeby kolejny bieg ETL
// albo ręczna zmiana nie przywróciły brakujących wartości w mieście ani nie dopisały ich poza nim.
const plik = JSON.parse(readFileSync(join(DANE, 'wskazniki', 'halas_ldwn.json'), 'utf8'))

test('opublikowany wskaźnik: Kraków bez dziur, reszta null, wartości spójne z etykietami', () => {
  const { wersja, adresy } = wczytajAdresy()
  assert.equal(plik.wersjaAdresow, wersja)
  assert.equal(plik.wartosci.length, adresy.length)
  assert.equal(plik.etykiety.length, adresy.length)
  let krakow = 0
  let luki = 0
  let cisza = 0
  const zrodla = new Set()
  for (const adres of adresy) {
    const wartosc = plik.wartosci[adres.i]
    const etykieta = plik.etykiety[adres.i]
    if (adres.gmina !== 'Kraków') {
      assert.equal(wartosc, null, `poza Krakowem nie ma mapy: ${adres.id}`)
      assert.equal(etykieta, null, `poza Krakowem nie ma etykiety: ${adres.id}`)
      continue
    }
    krakow++
    if (wartosc === null) {
      luki++
      assert.equal(etykieta, null, `luka bez etykiety: ${adres.id}`)
      continue
    }
    assert.ok(
      wartosc === WARTOSC_PONIZEJ_PROGU || (wartosc >= PROG_LDWN && wartosc <= 80),
      `wartość spoza pasm mapy: ${adres.id} ${wartosc}`,
    )
    if (wartosc === WARTOSC_PONIZEJ_PROGU) {
      cisza++
      assert.equal(etykieta, `${ETYKIETA_PONIZEJ_PROGU}; 4 m nad terenem`, adres.id)
    } else {
      const zrodlo = /\(pasmo mapy\); hałas (drogowy|szynowy|przemysłowy); 4 m nad terenem$/.exec(
        etykieta,
      )?.[1]
      assert.ok(zrodlo, `etykieta pasma bez źródła: ${adres.id} ${etykieta}`)
      zrodla.add(zrodlo)
    }
  }
  // Każda z trzech warstw wygrywa choć raz; brak jednej znaczy, że po cichu wypadła z ETL.
  assert.deepEqual([...zrodla].sort(), ['drogowy', 'przemysłowy', 'szynowy'])
  assert.ok(krakow > 70_000, `adresów Krakowa: ${krakow}`)
  assert.ok(cisza > 0, 'adresy poza pasmami mapy powinny być ciszą, nie brakiem danych')
  // Pokrycie ~100%: dopuszczamy wyłącznie nieliczne faktyczne luki obliczeń mapy (próg z ETL).
  assert.ok(luki <= MAX_UDZIAL_LUK * krakow, `luki w Krakowie: ${luki} z ${krakow}`)
})

test('meta wskaźnika: półpauza, skala zgodna z ciszą, opis tłumaczy 50 dB i brak liczby', () => {
  const { meta } = plik
  const pauza = String.fromCodePoint(0x2014)
  assert.ok(!JSON.stringify(meta).includes(pauza), 'w polskim tekście meta jest półpauza „–”')
  assert.deepEqual(meta.zakres, ZAKRES_LDWN)
  assert.ok(meta.opis.includes(`poniżej ${PROG_LDWN} dB`))
  assert.ok(meta.opis.includes('poza Krakowem'))
  for (const zrodlo of meta.zrodla) assert.match(zrodlo.nazwa, /^Gmina Miejska Kraków, MSIP – /)
})
