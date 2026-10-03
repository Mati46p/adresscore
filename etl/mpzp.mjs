// MPZP Krakowa: status planu i dosłowne przeznaczenie terenu pod punktem adresowym.
// Źródło: Gmina Miejska Kraków, Portal MSIP Obserwatorium, https://msip.krakow.pl/dataset/1509
// Licencja/warunki: https://msip.krakow.pl/getPdf?dok_id=228972
// Przeznaczenie nie jest interpretacją pełnych ustaleń planu ani odpowiedzią „co wolno zbudować”.
// Uruchom: node etl/mpzp.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { unzipSync } from 'fflate'
import proj4 from 'proj4'
import { CACHE, DANE, dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ZBIOR = 'https://msip.krakow.pl/dataset/1509'
const BAZA = 'https://msip.um.krakow.pl/Dane/'
const TERYT_KRAKOW = '1261011'
const EPSG2178 =
  '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'
const DO_2178 = proj4('EPSG:4326', EPSG2178)

function wypakuj(nazwa) {
  const plik = nazwa === 'przeznaczenie' ? 'MPZP_przeznaczenie' : 'MPZP_plany_obowiazujace'
  return pobierzDoCache(`${BAZA}${plik}_JSON.zip`, `mpzp_${nazwa}.zip`).then((sciezka) => {
    const zawartosc = unzipSync(readFileSync(sciezka))
    const geo = JSON.parse(new TextDecoder().decode(zawartosc[`${plik}.geojson`]))
    const aktualnosc = new TextDecoder().decode(zawartosc['__Aktualnosc__.txt'])
    const data = aktualnosc.match(/\d{4}-\d{2}-\d{2}/)?.[0]
    if (geo.crs?.properties?.name !== 'EPSG:2178' || !data || geo.type !== 'FeatureCollection') {
      throw new Error(`Nieznany format archiwum MSIP ${plik}`)
    }
    const cel = join(CACHE, `${plik}.geojson`)
    writeFileSync(cel, JSON.stringify(geo))
    return { geo, cel, data }
  })
}

function cytuj(s) {
  return `'${s.replaceAll("'", "''")}'`
}

function tekst(s) {
  return typeof s === 'string' && s.trim() ? s.trim() : null
}

async function main() {
  mkdirSync(CACHE, { recursive: true })
  const [plany, tereny] = await Promise.all([wypakuj('obowiazujace'), wypakuj('przeznaczenie')])
  if (plany.data !== tereny.data) throw new Error('Plany i przeznaczenia mają różne daty źródła')
  console.log(
    `MSIP ${tereny.data}: ${plany.geo.features.length} planów, ${tereny.geo.features.length} terenów`,
  )
  const { wersja, adresy } = wczytajAdresy()
  const csv = join(CACHE, 'mpzp_adresy.csv')
  const wiersze = ['i,x,y']
  for (const adres of adresy) {
    if (adres.teryt !== TERYT_KRAKOW) continue
    const [x, y] = DO_2178.forward([adres.lon, adres.lat])
    wiersze.push(`${adres.i},${x},${y}`)
  }
  writeFileSync(csv, `${wiersze.join('\n')}\n`)
  const instancja = await DuckDBInstance.create(':memory:', {
    temp_directory: join(CACHE, 'duckdb_mpzp_tmp'),
    memory_limit: '4GB',
  })
  const db = await instancja.connect()
  try {
    await db.run('INSTALL spatial; LOAD spatial')
    await db.run(
      `CREATE TABLE adresy AS SELECT i::INTEGER AS i, ST_Point(x, y) AS geom FROM read_csv_auto(${cytuj(csv)})`,
    )
    const planyById = new Map(
      plany.geo.features.map((f) => [String(f.properties.objectid), f.properties]),
    )
    const terenyById = new Map(
      tereny.geo.features.map((f) => [String(f.properties.objectid), f.properties]),
    )
    const dopasuj = async (sciezka) => {
      const wynik = await db.runAndReadAll(
        `SELECT a.i, p.objectid AS id FROM adresy a JOIN ST_Read(${cytuj(sciezka)}) p ON ST_Intersects(p.geom, a.geom) ORDER BY a.i, p.objectid`,
      )
      const mapa = new Map()
      for (const w of wynik.getRowObjectsJS()) {
        const i = Number(w.i)
        const ids = mapa.get(i) ?? []
        ids.push(String(w.id))
        mapa.set(i, ids)
      }
      return mapa
    }
    const wPlanach = await dopasuj(plany.cel)
    console.log(`W granicy planów: ${wPlanach.size} adresów`)
    const wTerenach = await dopasuj(tereny.cel)
    console.log(`W poligonach przeznaczenia: ${wTerenach.size} adresów`)

    const wartosci = []
    const etykiety = []
    const szczegoly = []
    const slownik = []
    const indeks = new Map()
    const stat = { pozaKrakowem: 0, bezPlanu: 0, planBezTerenu: 0, wielePlanow: 0, wieleTerenow: 0 }
    for (const a of adresy) {
      if (a.teryt !== TERYT_KRAKOW) {
        wartosci.push(null)
        etykiety.push(null)
        szczegoly.push(null)
        stat.pozaKrakowem++
        continue
      }
      const p = wPlanach.get(a.i) ?? []
      const t = wTerenach.get(a.i) ?? []
      if (!p.length && t.length) {
        throw new Error(`Przeznaczenie poza granicą obowiązującego planu dla adresu ${a.i}`)
      }
      // Nakładanie się granic lub przeznaczeń jest możliwe. Zapisujemy wszystkie trafienia,
      // bez arbitralnego wyboru jednego planu.
      if (!p.length) stat.bezPlanu++
      if (p.length && !t.length) stat.planBezTerenu++
      if (p.length > 1) stat.wielePlanow++
      if (t.length > 1) stat.wieleTerenow++
      wartosci.push(p.length ? 1 : 0)
      if (!p.length) etykiety.push('Brak obowiązującego planu w punkcie adresu')
      else if (p.length === 1) {
        etykiety.push(
          `Plan obowiązuje: ${tekst(planyById.get(p[0])?.nazwa_planu) ?? 'nazwa niedostępna'}`,
        )
      } else etykiety.push('Nakładające się plany – sprawdź dokumenty źródłowe')
      const pozycje = []
      const dane = [
        ...p.map((id) => {
          const x = planyById.get(id)
          return x && { typ: 'plan', nazwa: tekst(x.nazwa_planu), www: tekst(x.www) }
        }),
        ...t.map((id) => {
          const x = terenyById.get(id)
          return (
            x && {
              typ: 'teren',
              plan: tekst(x.nazwa_mpzp),
              oznaczenie: tekst(x.oznaczenie),
              opis: tekst(x.opis_oznaczenia),
              www: tekst(x.www),
            }
          )
        }),
      ].filter(Boolean)
      for (const x of dane) {
        const klucz = JSON.stringify(x)
        if (!indeks.has(klucz)) {
          indeks.set(klucz, slownik.length)
          slownik.push(x)
        }
        pozycje.push(indeks.get(klucz))
      }
      szczegoly.push(pozycje.length ? pozycje : null)
    }
    console.log(stat)
    const meta = {
      id: 'mpzp_status',
      kategoria: 'kontekst',
      nazwa: 'Obowiązujący plan miejscowy w punkcie adresu',
      opis: '1 = punkt adresu leży w granicy obowiązującego MPZP, 0 = poza granicą w Krakowie, null = poza zakresem miasta. Oznaczenie terenu jest wyłącznie opisem z MSIP; pełne zasady zabudowy wynikają z uchwały, rysunku i sytuacji działki. Punkt adresu nie reprezentuje całej działki ani sąsiedztwa.',
      jednostka: 'status',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      zakres: [0, 1],
      zadanie: 22,
      zrodla: [
        {
          nazwa:
            'Gmina Miejska Kraków, Portal MSIP Obserwatorium – plany obowiązujące i przeznaczenia MPZP',
          url: ZBIOR,
          licencja: 'Regulamin MSIP: https://msip.krakow.pl/getPdf?dok_id=228972',
          dataDanych: tereny.data,
          pobrano: dzis(),
        },
      ],
    }
    zapiszWskaznik(meta, wartosci, etykiety)
    const sciezka = join(DANE, 'mpzp_adresy.json')
    writeFileSync(
      sciezka,
      JSON.stringify({
        wersjaAdresow: wersja,
        zrodlo: ZBIOR,
        dataDanych: tereny.data,
        uwaga:
          'Dane poglądowe. Symbol i opis przeznaczenia nie określają samodzielnie, co wolno zbudować na działce.',
        slownik,
        adresy: szczegoly,
      }),
    )
    console.log(`mpzp_adresy.json: ${(readFileSync(sciezka).length / 1024 / 1024).toFixed(1)} MB`)
  } finally {
    db.closeSync()
  }
}

await main()
