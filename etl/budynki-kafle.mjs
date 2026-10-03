// Kafle budynków dla sekcji „Okolica w 3D” (#20) z wyniku #9 (public/dane/budynki-3d.geojson).
// Dlaczego kafle: karta pokazuje 500 m wokół adresu, a cały plik ma 33 MB. Kafel = komórka
// H3 r7 (~5 km²), budynek trafia do komórki środka obrysu; front bierze komórkę adresu
// z sąsiadami. Format: KafelBudynkow w src/miasto3d/kontrakt.ts.
// Uruchom: node etl/budynki-kafle.mjs (po node etl/budynki.mjs).
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { latLngToCell } from 'h3-js'
import { DANE } from './lib/wspolne.mjs'

const ROZDZIELCZOSC = 7
const KATALOG = join(DANE, 'budynki')

export function kafluj(geojson, meta) {
  const zrodla = [
    {
      nazwa: 'GUGiK – modele budynków LoD1 (BDOT10k + wysokość ze skanowania lotniczego)',
      url: meta.dokumentacja,
      licencja: meta.licencja,
      dataDanych: `${meta.rocznikModelu} (ALS ${Object.keys(meta.rocznikiALS).join(', ')})`,
      pobrano: meta.pobrano,
    },
  ]
  const kafle = new Map()
  for (const f of geojson.features) {
    // Tylko pierścień zewnętrzny: otwory (278 na 91 tys.) nie zmieniają obrazu w skali okolicy.
    const ring = f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0] : null
    if (!ring || ring.length < 4) continue
    const punkty = ring.slice(0, -1)
    let lon = 0
    let lat = 0
    for (const [x, y] of punkty) {
      lon += x
      lat += y
    }
    const h3 = latLngToCell(lat / punkty.length, lon / punkty.length, ROZDZIELCZOSC)
    let k = kafle.get(h3)
    if (!k) {
      k = {
        wersja: `lod1-${meta.rocznikModelu}`,
        zrodla,
        h3,
        budynki: { id: [], wysokosc: [], zrodloWysokosci: [], obrys: [] },
      }
      kafle.set(h3, k)
    }
    const h = f.properties?.height_m
    const ok = Number.isFinite(h) && h > 0
    k.budynki.id.push(String(f.id))
    k.budynki.wysokosc.push(ok ? h : null)
    k.budynki.zrodloWysokosci.push(ok ? 'lod1' : null)
    k.budynki.obrys.push(punkty.flat())
  }
  return kafle
}

if (import.meta.main) {
  const geojson = JSON.parse(readFileSync(join(DANE, 'budynki-3d.geojson'), 'utf8'))
  const meta = JSON.parse(readFileSync(join(DANE, 'budynki-3d.meta.json'), 'utf8'))
  const kafle = kafluj(geojson, meta)
  rmSync(KATALOG, { recursive: true, force: true })
  mkdirSync(KATALOG, { recursive: true })
  let razem = 0
  for (const [h3, k] of kafle) {
    writeFileSync(join(KATALOG, `${h3}.json`), JSON.stringify(k))
    razem += k.budynki.id.length
  }
  if (razem !== meta.liczbaBudynkow) {
    throw new Error(`W kaflach ${razem} budynków, w meta ${meta.liczbaBudynkow}`)
  }
  console.log(`${razem} budynków w ${readdirSync(KATALOG).length} kaflach H3 r${ROZDZIELCZOSC}`)
}
