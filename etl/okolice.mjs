// Okolice (#75): jednostka „okolicy” dla ekranów Okolica / Porównanie i rankingu okolic.
// Wynik: public/dane/okolice.json – dla każdego adresu (ta sama kolejność co adresy.json) id
// okolicy, a w słowniku jej nazwa urzędowa i potoczna, źródło i jawna lista rozjazdów.
//
// Źródła, w kolejności pierwszeństwa:
//  1. Jednostki SIM z MSIP Kraków – granice jako GeoJSON (WGS84) w etl/.cache/okolice/sim.geojson
//     (eksport warstwy MSIP; pola id i nazwa: `id`/`ID`/`numer`, `nazwa`/`NAZWA`). Gdy pliku nie
//     ma, a MSIP jest nieosiągalny (z kontenera CI host msip.um.krakow.pl jest zablokowany), skrypt
//     przechodzi na zastępczy podział z punktu 2 i zapisuje to w polu `metoda`.
//  2. Zastępczo w Krakowie: dzielnica (z adresy.json) × potoczna nazwa osiedla z OSM; poza Krakowem:
//     miejscowość w gminie (z punktów adresowych PRG / EMUiA).
//  Potoczne nazwy: OSM (quarter / neighbourhood / residential) przez odwrotne geokodowanie Nominatim
//  w środku każdego heksu H3 r8 z adresami Krakowa; odpowiedzi w etl/.cache/okolice/nominatim/.
//  Nominatim: co najwyżej 1 zapytanie na sekundę, każde tylko raz (cache).
//
// Brak danych = null (adres bez dzielnicy i bez miejscowości nie dostaje okolicy), nigdy zero.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cellToLatLng, cellToParent } from 'h3-js'
import { do2180, punktWWielokacie, wielokatyZGeojson } from './lib/geo.mjs'
import { bezOgonkow } from './lib/nazwy.mjs'
import { CACHE, DANE, dzis, wczytajAdresy } from './lib/wspolne.mjs'

export const ROZDZIELCZOSC_NAZW = 8
const KAT = join(CACHE, 'okolice')
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse'
const UA = 'adresscore-etl/1.0 (HackYeah 2026; https://github.com/Mati46p/adresscore)'

export const slug = (s) =>
  bezOgonkow(String(s))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Dzielnica „VIII Dębniki” → „Dębniki” (numer rzymski to część nazwy urzędowej, nie potocznej). */
export const bezNumeru = (dzielnica) => dzielnica.replace(/^[IVXL]+\s+/, '')

/** Potoczna nazwa z adresu Nominatim: najpierw quarter, potem neighbourhood, potem osiedle. */
export function nazwaPotoczna(adres) {
  if (!adres) return null
  const kandydat = adres.quarter ?? adres.neighbourhood ?? adres.residential ?? null
  if (!kandydat) return null
  return kandydat.replace(/^Osiedle\s+/i, 'os. ').trim() || null
}

/** Jednostki SIM z GeoJSON → [{ id, nazwa, wielokaty }]. */
export function jednostkiSim(geojson) {
  const wynik = []
  for (const f of geojson.features ?? []) {
    const p = f.properties ?? {}
    const id = p.id ?? p.ID ?? p.numer ?? p.NUMER ?? p.OBJECTID
    const nazwa = p.nazwa ?? p.NAZWA ?? p.name ?? null
    if (id === undefined || id === null || !f.geometry) continue
    wynik.push({ id: `sim-${id}`, nazwa, wielokaty: wielokatyZGeojson(f.geometry) })
  }
  return wynik
}

/** Jednostka SIM zawierająca punkt albo null. */
export function znajdzJednostke(jednostki, lon, lat) {
  const [x, y] = do2180(lon, lat)
  for (const j of jednostki)
    for (const w of j.wielokaty) {
      const [x0, y0, x1, y1] = w.bbox
      if (x < x0 || x > x1 || y < y0 || y > y1) continue
      if (punktWWielokacie(x, y, w)) return j
    }
  return null
}

/**
 * Okolica adresu w podziale zastępczym. `potoczne` – Map(h3 r8 → nazwa potoczna | null).
 * Zwraca { id, nazwa, nazwaUrzedowa, dzielnica, gmina, rodzaj } albo null.
 */
export function okolicaZastepcza(a, potoczne) {
  if (a.gmina === 'Kraków' && a.dzielnica) {
    const dz = bezNumeru(a.dzielnica)
    const pot = potoczne.get(cellToParent(a.h3, ROZDZIELCZOSC_NAZW)) ?? null
    if (pot)
      return {
        id: `krk-${slug(dz)}-${slug(pot)}`,
        nazwa: pot,
        nazwaUrzedowa: a.dzielnica,
        dzielnica: a.dzielnica,
        gmina: a.gmina,
        rodzaj: 'osiedle-osm',
      }
    return {
      id: `krk-${slug(dz)}`,
      nazwa: dz,
      nazwaUrzedowa: a.dzielnica,
      dzielnica: a.dzielnica,
      gmina: a.gmina,
      rodzaj: 'dzielnica',
    }
  }
  if (a.gmina && a.miejscowosc && a.gmina !== 'Kraków')
    return {
      id: `m-${a.teryt ?? slug(a.gmina)}-${slug(a.miejscowosc)}`,
      nazwa: a.miejscowosc,
      nazwaUrzedowa: `${a.miejscowosc} (gm. ${a.gmina})`,
      dzielnica: null,
      gmina: a.gmina,
      rodzaj: 'miejscowosc',
    }
  return null
}

/**
 * Składa wynik: kolumna id okolic, słownik i rozjazdy.
 * Rozjazdy: potoczna nazwa obecna w więcej niż jednej dzielnicy (osiedle przecięte granicą) oraz,
 * przy SIM, jednostka, w której potoczna nazwa różni się od urzędowej.
 */
export function zloz(adresy, przypisz) {
  const kolumna = []
  const slownik = {}
  for (const a of adresy) {
    const o = przypisz(a)
    if (!o) {
      kolumna.push(null)
      continue
    }
    kolumna.push(o.id)
    const wpis = slownik[o.id]
    if (wpis) wpis.liczbaAdresow++
    else {
      const { id, ...reszta } = o
      slownik[id] = { ...reszta, liczbaAdresow: 1 }
    }
  }
  const dzielniceNazwy = new Map()
  for (const o of Object.values(slownik)) {
    if (o.rodzaj !== 'osiedle-osm') continue
    const lista = dzielniceNazwy.get(o.nazwa) ?? []
    lista.push(o.dzielnica)
    dzielniceNazwy.set(o.nazwa, lista)
  }
  const rozjazdy = []
  for (const [nazwa, dz] of dzielniceNazwy)
    if (dz.length > 1)
      rozjazdy.push({
        nazwa,
        rodzaj: 'osiedle-w-kilku-dzielnicach',
        opis: `Potoczna nazwa „${nazwa}” występuje w dzielnicach: ${dz.sort().join(', ')} – okolica jest podzielona granicą dzielnicy, każda część ma osobne id.`,
      })
  for (const [id, o] of Object.entries(slownik))
    if (o.rodzaj === 'sim' && o.nazwaPotoczna && o.nazwaPotoczna !== o.nazwaUrzedowa)
      rozjazdy.push({
        id,
        rodzaj: 'nazwa-potoczna-inna-niz-urzedowa',
        opis: `Jednostka SIM „${o.nazwaUrzedowa}” jest potocznie nazywana „${o.nazwaPotoczna}”.`,
      })
  return { kolumna, slownik, rozjazdy }
}

const czekaj = (ms) => new Promise((r) => setTimeout(r, ms))

/** Odwrotne geokodowanie środka heksu (cache na dysku, 1 zapytanie/s). */
async function adresNominatim(h3) {
  const cel = join(KAT, 'nominatim', `${h3}.json`)
  if (existsSync(cel)) return JSON.parse(readFileSync(cel, 'utf8'))
  const [lat, lon] = cellToLatLng(h3)
  await czekaj(1100)
  const r = await fetch(
    `${NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1&accept-language=pl`,
    { headers: { 'User-Agent': UA } },
  )
  if (!r.ok) throw new Error(`Nominatim ${h3} → ${r.status}`)
  const dane = await r.json()
  mkdirSync(join(KAT, 'nominatim'), { recursive: true })
  writeFileSync(cel, JSON.stringify(dane))
  return dane
}

async function main() {
  const { wersja, adresy } = wczytajAdresy()
  const heksy = [
    ...new Set(
      adresy.filter((a) => a.gmina === 'Kraków').map((a) => cellToParent(a.h3, ROZDZIELCZOSC_NAZW)),
    ),
  ].sort()
  const potoczne = new Map()
  let bledy = 0
  for (const [n, h] of heksy.entries()) {
    try {
      const d = await adresNominatim(h)
      potoczne.set(h, d.address?.city === 'Kraków' ? nazwaPotoczna(d.address) : null)
    } catch (e) {
      bledy++
      potoczne.set(h, null)
      console.warn(String(e))
    }
    if (n % 50 === 0) console.log(`Nominatim ${n}/${heksy.length}`)
  }

  const plikSim = join(KAT, 'sim.geojson')
  const sim = existsSync(plikSim) ? jednostkiSim(JSON.parse(readFileSync(plikSim, 'utf8'))) : null
  const przypisz = sim
    ? (a) => {
        const j = a.gmina === 'Kraków' ? znajdzJednostke(sim, a.lon, a.lat) : null
        if (!j) return okolicaZastepcza(a, new Map())
        const pot = potoczne.get(cellToParent(a.h3, ROZDZIELCZOSC_NAZW)) ?? null
        return {
          id: j.id,
          nazwa: pot ?? j.nazwa,
          nazwaUrzedowa: j.nazwa,
          nazwaPotoczna: pot,
          dzielnica: a.dzielnica,
          gmina: a.gmina,
          rodzaj: 'sim',
        }
      }
    : (a) => okolicaZastepcza(a, potoczne)

  const { kolumna, slownik, rozjazdy } = zloz(adresy, przypisz)
  const dzien = dzis()
  const numer = new Map(Object.keys(slownik).map((id, n) => [id, n]))
  const plik = {
    wersjaAdresow: wersja,
    metoda: sim ? 'sim-msip' : 'zastepcza',
    opis: sim
      ? 'Okolica = jednostka SIM z MSIP Kraków (adres → jednostka przez punkt w wielokącie); nazwa potoczna z OSM. Poza Krakowem – miejscowość w gminie.'
      : 'Granice jednostek SIM z MSIP były nieosiągalne – zastępczo: w Krakowie dzielnica × potoczna nazwa osiedla z OSM (heks H3 r8), poza Krakowem miejscowość w gminie. Po dostarczeniu etl/.cache/okolice/sim.geojson bieg skryptu przełącza się na SIM.',
    rozdzielczosc: sim ? 'adres' : 'heks',
    zrodla: [
      {
        nazwa: 'Punkty adresowe (adresy.json): dzielnica MSIP, miejscowość i gmina PRG / EMUiA',
        url: 'https://msip.krakow.pl/dataset/1492',
        licencja: 'Regulamin MSIP: https://msip.krakow.pl/getHtml?dok_id=228972',
        dataDanych: dzien,
        pobrano: dzien,
      },
      {
        nazwa: 'OpenStreetMap przez Nominatim – potoczne nazwy osiedli (quarter / neighbourhood)',
        url: NOMINATIM,
        licencja: 'ODbL 1.0, © współtwórcy OpenStreetMap',
        dataDanych: dzien,
        pobrano: dzien,
      },
      ...(sim
        ? [
            {
              nazwa: 'MSIP Kraków – jednostki SIM',
              url: 'https://msip.krakow.pl',
              licencja: 'Regulamin MSIP: https://msip.krakow.pl/getHtml?dok_id=228972',
              dataDanych: dzien,
              pobrano: dzien,
            },
          ]
        : []),
    ],
    okolice: slownik,
    rozjazdy,
    // Kolumna jako numery w `idOkolic` (null = brak danych) – plik kilka razy mniejszy niż z napisami.
    idOkolic: Object.keys(slownik),
    kolumny: { okolica: kolumna.map((k) => (k === null ? null : numer.get(k))) },
  }
  writeFileSync(join(DANE, 'okolice.json'), JSON.stringify(plik))
  const bez = kolumna.filter((k) => k === null).length
  console.log(
    `okolice: ${Object.keys(slownik).length} okolic, ${bez} adresów bez okolicy, ${rozjazdy.length} rozjazdów, błędy Nominatim: ${bledy}`,
  )
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main()
