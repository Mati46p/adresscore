// Pasek okolicy wybranej w wyszukiwarce (#185). Uruchom: node --test src/karta/okolicaWybrana.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { JednostkaGeoJson } from '../mapa/okolica/granice.ts'
import type { MiejsceAdresu } from '../wynik/miejsceAdresu.ts'
import { type WybranaOkolica, zdanieBezObrysu, zdanieOSM } from './okolicaWybrana.ts'

const OBRYS: JednostkaGeoJson = {
  type: 'Feature',
  properties: {
    id: 'sim-703',
    numer: 'VII.3',
    nazwa: 'Zwierzyniec',
    dzielnica: 'VII',
    powierzchniaKm2: 1,
  },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [19.9, 50],
        [19.91, 50],
        [19.91, 50.01],
        [19.9, 50],
      ],
    ],
  },
}

const miejsce = (rodzaj: 'sim' | 'miejscowosc'): MiejsceAdresu => ({
  rodzaj,
  id: 'x',
  nazwa: 'X',
  podpis: null,
  opis: null,
  liczbaAdresow: 1,
  potoczne: [],
  uwagi: [],
})

const okolica = (
  rodzaj: 'sim' | 'miejscowosc',
  obrys: JednostkaGeoJson | null,
): WybranaOkolica => ({
  naMapie: {
    id: 'x',
    granice: [
      [19.9, 50],
      [19.91, 50.01],
    ],
    obrys,
  },
  miejsce: miejsce(rodzaj),
  nazwaOsm: null,
})

describe('zdanieOSM', () => {
  it('bez nazwy z OSM nie ma zdania (okolicę wybrano po jej własnej nazwie)', () => {
    assert.equal(zdanieOSM(null), null)
  })

  it('nazwa z OSM: punkt w jednostce, nie granice osiedla – mapa pokazuje całą jednostkę', () => {
    const zdanie = zdanieOSM('Salwator') ?? ''
    assert.match(zdanie, /„Salwator”/)
    assert.match(zdanie, /punkt z OpenStreetMap/)
    assert.match(zdanie, /nie granice osiedla/)
    assert.match(zdanie, /całą jednostkę/)
  })
})

describe('zdanieBezObrysu', () => {
  it('okolica z obrysem nie ma zdania', () => {
    assert.equal(zdanieBezObrysu(okolica('sim', OBRYS)), null)
  })

  it('miejscowość poza Krakowem: nie ma granic w danych, mapa pokazuje obszar adresów', () => {
    const zdanie = zdanieBezObrysu(okolica('miejscowosc', null)) ?? ''
    assert.match(zdanie, /granic miejscowości poza Krakowem/)
    assert.match(zdanie, /obszar jej adresów/)
  })

  it('jednostka SIM bez wpisu w pliku granic: mówi o braku granic, nie o Krakowie', () => {
    const zdanie = zdanieBezObrysu(okolica('sim', null)) ?? ''
    assert.match(zdanie, /Nie mamy granic tej jednostki/)
    assert.doesNotMatch(zdanie, /poza Krakowem/)
  })

  it('żaden tekst nie ma pauzy – w polskim tekście stoi półpauza', () => {
    for (const t of [
      zdanieOSM('Salwator'),
      zdanieBezObrysu(okolica('sim', null)),
      zdanieBezObrysu(okolica('miejscowosc', null)),
    ]) {
      assert.doesNotMatch(t ?? '', /—/)
    }
  })
})
