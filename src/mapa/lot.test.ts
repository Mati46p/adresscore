// Kadry kamery (#223): kadr wszystkich miast, kadr zapasowy miasta, odstępy. Uruchom: node --test src/mapa/lot.test.ts
// Część testów jedzie na prawdziwych kaflach adresów z public/dane (kompakt/indeks.json każdego miasta).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { cellToBoundary } from 'h3-js'
import { MIASTA } from '../kontrakty/miasta.ts'
import type { Ramka } from './geometria.ts'
import {
  GRANICE_WIDOKU,
  kadrZapasowyMiasta,
  odstepKadruStartowego,
  ramkaPunktow,
  WIDOK_MIAST,
  ZOOM_MIASTA,
} from './lot.ts'

const DANE = new URL('../../public/dane/', import.meta.url)
const czytaj = <T>(sciezka: URL): T => JSON.parse(readFileSync(sciezka, 'utf8'))

/** Ramka `wewnatrz` leży w całości w ramce `zewnatrz`. */
const mieszczaSie = (wewnatrz: Ramka, zewnatrz: Ramka) =>
  wewnatrz[0][0] >= zewnatrz[0][0] &&
  wewnatrz[0][1] >= zewnatrz[0][1] &&
  wewnatrz[1][0] <= zewnatrz[1][0] &&
  wewnatrz[1][1] <= zewnatrz[1][1]

describe('ramkaPunktow', () => {
  it('bez punktów nie ma ramki', () => {
    assert.equal(ramkaPunktow([], 1, 1), null)
  })

  it('jeden punkt: ramka tylko z zapasu, zapas osobno dla lon i lat', () => {
    assert.deepEqual(ramkaPunktow([[20, 50]], 0.5, 0.25), [
      [19.5, 49.75],
      [20.5, 50.25],
    ])
  })

  it('kilka punktów: najmniejsza ramka plus zapas', () => {
    assert.deepEqual(
      ramkaPunktow(
        [
          [14, 54],
          [23, 50],
          [18, 52],
        ],
        1,
        1,
      ),
      [
        [13, 49],
        [24, 55],
      ],
    )
  })
})

describe('WIDOK_MIAST (kadr startowy wszystkich miast)', () => {
  it('zawiera środek każdego miasta z rejestru, z zapasem', () => {
    for (const m of MIASTA) {
      const [lon, lat] = m.srodek
      assert.ok(lon > WIDOK_MIAST[0][0] && lon < WIDOK_MIAST[1][0], `${m.slug}: lon ${lon}`)
      assert.ok(lat > WIDOK_MIAST[0][1] && lat < WIDOK_MIAST[1][1], `${m.slug}: lat ${lat}`)
    }
  })

  it('obejmuje dane każdego miasta: kafle adresów z kompaktu leżą w kadrze', (t) => {
    let wierzcholki = 0
    let najciasniej = Number.POSITIVE_INFINITY
    let gdzie = ''
    for (const m of MIASTA) {
      const katalog = new URL(m.katalog ? `${m.katalog}/` : '', DANE)
      const indeks = czytaj<{ kafle: { h3: string }[] }>(new URL('kompakt/indeks.json', katalog))
      assert.ok(indeks.kafle.length > 0, `${m.slug}: kompakt bez kafli adresów`)
      for (const kafel of indeks.kafle) {
        for (const [lon, lat] of cellToBoundary(kafel.h3, true) as [number, number][]) {
          wierzcholki++
          const margines = Math.min(
            lon - WIDOK_MIAST[0][0],
            WIDOK_MIAST[1][0] - lon,
            lat - WIDOK_MIAST[0][1],
            WIDOK_MIAST[1][1] - lat,
          )
          if (margines < najciasniej) {
            najciasniej = margines
            gdzie = m.slug
          }
          assert.ok(
            margines > 0,
            `${m.slug}: kafel ${kafel.h3} wystaje poza kadr wszystkich miast (${lon}, ${lat})`,
          )
        }
      }
    }
    // Zero sprawdzonych wierzchołków znaczyłoby „nie zmierzyłem", nie „jest dobrze".
    assert.ok(wierzcholki > 5000, `zmierzono tylko ${wierzcholki} wierzchołków`)
    t.diagnostic(
      `wierzchołków: ${wierzcholki}, najciaśniejszy margines ${najciasniej.toFixed(3)}° (${gdzie})`,
    )
  })

  it('mieści się w granicach, poza które kamera nie wyjedzie', () => {
    assert.ok(mieszczaSie(WIDOK_MIAST, GRANICE_WIDOKU))
  })
})

describe('kadrZapasowyMiasta (środek bez obrysu)', () => {
  it('ramka o dodatnich bokach wokół środka miasta z rejestru, dla każdego miasta', () => {
    for (const m of MIASTA) {
      const kadr = kadrZapasowyMiasta(m.slug)
      const [lon, lat] = m.srodek
      assert.ok(kadr[0][0] < lon && lon < kadr[1][0], `${m.slug}: lon`)
      assert.ok(kadr[0][1] < lat && lat < kadr[1][1], `${m.slug}: lat`)
      // Środek leży pośrodku, a nie w rogu: kadr ma pokazać miasto, nie jego skraj.
      assert.ok(Math.abs((kadr[0][0] + kadr[1][0]) / 2 - lon) < 1e-9, `${m.slug}: środek lon`)
      assert.ok(Math.abs((kadr[0][1] + kadr[1][1]) / 2 - lat) < 1e-9, `${m.slug}: środek lat`)
      assert.ok(mieszczaSie(kadr, GRANICE_WIDOKU), `${m.slug}: poza granicami kamery`)
    }
  })

  it('kadr jest tej samej wielkości dla każdego miasta (rejestr zna punkt, nie obrys)', () => {
    const [pierwszy, ...reszta] = MIASTA.map((m) => kadrZapasowyMiasta(m.slug))
    assert.ok(pierwszy)
    const bok = (r: Ramka) => [r[1][0] - r[0][0], r[1][1] - r[0][1]]
    for (const r of reszta) {
      assert.ok(Math.abs((bok(r)[0] ?? 0) - (bok(pierwszy)[0] ?? 0)) < 1e-9)
      assert.ok(Math.abs((bok(r)[1] ?? 0) - (bok(pierwszy)[1] ?? 0)) < 1e-9)
    }
  })

  it('zoom startu przy środku miasta mieści się w zakresie mapy (minZoom 5, r8 widoczny poniżej 11)', () => {
    assert.ok(ZOOM_MIASTA >= 5 && ZOOM_MIASTA < 11)
  })
})

describe('odstepKadruStartowego', () => {
  it('góra zostawia miejsce na pasek ustawień: jego dolna krawędź plus 8 px', () => {
    // 56 px: pasek w jednym rzędzie (szeroki ekran i telefon od 360 px); 96 px: dwa rzędy.
    assert.equal(odstepKadruStartowego(56).top, 64)
    assert.equal(odstepKadruStartowego(96).top, 104)
    assert.equal(odstepKadruStartowego(55.2).top, 64, 'ułamek pikseli zaokrągla się w górę')
  })

  it('bez paska (intro Polski) zostaje zwykły odstęp od krawędzi, nigdy mniej', () => {
    assert.equal(odstepKadruStartowego(0).top, 32)
    assert.equal(odstepKadruStartowego(10).top, 32)
  })

  it('boki i dół zawsze 32 px', () => {
    for (const pasek of [0, 56, 96]) {
      const o = odstepKadruStartowego(pasek)
      assert.equal(o.left, 32)
      assert.equal(o.right, 32)
      assert.equal(o.bottom, 32)
    }
  })
})
