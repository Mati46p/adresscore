import assert from 'node:assert/strict'
import test from 'node:test'
import {
  kluczGminy,
  kluczGminyDzialki,
  kolejnoscOsi,
  liczbaBudynkow,
  parsujGml,
} from './azbest.mjs'
import { LicznikWielokatow, odlegloscDoWielokata } from './lib/geo.mjs'

// Fragment prawdziwej odpowiedzi WFS Bazy Azbestowej (GML 3.2, EPSG:2180, oś: północ wschód).
const GML = `<?xml version="1.0" encoding="UTF-8"?><wfs:FeatureCollection xmlns:Q1="wfs" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:gml="http://www.opengis.net/gml/3.2" numberMatched="2" numberReturned="2" timeStamp="2026-10-03T13:42:31.510Z">
  <wfs:member>
    <Q1:budynki_z_azbestem gml:id="budynki_z_azbestem.2475277">
      <Q1:nr_dzialki>120805_5.0028.404</Q1:nr_dzialki>
      <Q1:geom_obiektu>
        <gml:Polygon srsName="urn:ogc:def:crs:EPSG::2180" srsDimension="2" gml:id="budynki_z_azbestem.2475277.geom_obiektu">
          <gml:exterior>
            <gml:LinearRing>
              <gml:posList>270742.4360134 573006.76725752 270756.66803669 573007.60446803 270755.79111769 573014.50069456 270741.95784541 573013.90284573 270742.4360134 573006.76725752</gml:posList>
            </gml:LinearRing>
          </gml:exterior>
        </gml:Polygon>
      </Q1:geom_obiektu>
    </Q1:budynki_z_azbestem>
  </wfs:member>
  <wfs:member>
    <Q1:budynki_z_azbestem gml:id="budynki_z_azbestem.99">
      <Q1:nr_dzialki>126103_9.0008.3/9</Q1:nr_dzialki>
      <Q1:geom_obiektu>
        <gml:Polygon srsName="urn:ogc:def:crs:EPSG::2180" srsDimension="2" gml:id="budynki_z_azbestem.99.geom_obiektu">
          <gml:exterior>
            <gml:LinearRing>
              <gml:posList>1000 2000 1000 2100 1100 2100 1100 2000 1000 2000</gml:posList>
            </gml:LinearRing>
          </gml:exterior>
          <gml:interior>
            <gml:LinearRing>
              <gml:posList>1040 2040 1040 2060 1060 2060 1060 2040 1040 2040</gml:posList>
            </gml:LinearRing>
          </gml:interior>
        </gml:Polygon>
      </Q1:geom_obiektu>
    </Q1:budynki_z_azbestem>
  </wfs:member>
</wfs:FeatureCollection>`

test('parsujGml: odwraca oś północ/wschód z urn na x = wschód, y = północ', () => {
  const obiekty = parsujGml(GML)
  assert.equal(obiekty.length, 2)
  assert.equal(obiekty[0].id, 'budynki_z_azbestem.2475277')
  assert.equal(obiekty[0].nrDzialki, '120805_5.0028.404')
  const [xmin, ymin, xmax, ymax] = obiekty[0].wielokat.bbox
  assert.ok(Math.abs(xmin - 573006.767) < 0.001 && Math.abs(xmax - 573014.5) < 0.001)
  assert.ok(Math.abs(ymin - 270741.958) < 0.001 && Math.abs(ymax - 270756.668) < 0.001)
})

test('parsujGml: otwór w obrysie zostaje otworem, a geometria inna niż Polygon to błąd', () => {
  const [, z] = parsujGml(GML)
  assert.equal(z.wielokat.pierscienie.length, 2)
  // oś urn: pierwsza liczba to północ, więc x = 2000..2100, y = 1000..1100
  assert.equal(odlegloscDoWielokata(2050, 1050, z.wielokat), 10) // środek otworu, 10 m do jego brzegu
  assert.equal(odlegloscDoWielokata(2010, 1010, z.wielokat), 0)
  assert.throws(
    () => parsujGml('<wfs:member><Q1:x gml:id="x.1"><gml:MultiSurface/></Q1:x></wfs:member>'),
    /brak gml:Polygon/,
  )
  assert.throws(
    () =>
      parsujGml(
        '<wfs:member><Q1:x gml:id="x.1"><gml:Polygon srsName="EPSG:2180"><gml:exterior><gml:LinearRing><gml:posList>1 2 3</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></Q1:x></wfs:member>',
      ),
    /Zła lista współrzędnych/,
  )
})

test('kolejnoscOsi: urn podaje północ i wschód, krótkie EPSG:2180 wschód i północ', () => {
  assert.equal(kolejnoscOsi('urn:ogc:def:crs:EPSG::2180'), 'NE')
  assert.equal(kolejnoscOsi('EPSG:2180'), 'EN')
  assert.equal(kolejnoscOsi(undefined), 'EN')
})

test('klucz gminy: cztery jednostki ewidencyjne Krakowa to jedna gmina, reszta po 6 cyfrach TERYT', () => {
  assert.equal(kluczGminy('1261011'), '1261')
  assert.equal(kluczGminyDzialki('126103_9.0008.3/9'), '1261')
  assert.equal(kluczGminyDzialki('126101_9.0001.1'), '1261')
  assert.equal(kluczGminy('1219043'), '121904') // Niepołomice (adres)
  assert.equal(kluczGminyDzialki('121904_5.0003.12'), '121904') // Niepołomice (działka, obszar wiejski)
  assert.equal(kluczGminyDzialki('bez-numeru'), null)
  assert.equal(kluczGminyDzialki(null), null)
})

test('liczbaBudynkow: gmina bez wpisów daje null, nie 0; w gminie raportującej brak obrysu daje 0', () => {
  const [a, b] = parsujGml(GML)
  const licznik = new LicznikWielokatow([a.wielokat, b.wielokat])
  // punkt 70 m od obrysu b (x do 2100, y 1000..1100) – w promieniu 100 m
  assert.equal(liczbaBudynkow(licznik, 2170, 1050, true), 1)
  assert.equal(liczbaBudynkow(licznik, 2201, 1050, true), 0)
  assert.equal(liczbaBudynkow(licznik, 2170, 1050, false), null)
  // adres w budynku liczy ten budynek
  assert.equal(liczbaBudynkow(licznik, 2010, 1010, true), 1)
})
