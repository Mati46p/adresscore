// Popyt trybu „Biznes” (E10, #105): adresy z public/dane/adresy.json zebrane w heksy H3 r10.
// Uruchom: node etl/biznes-popyt.mjs (ok. 5 s, bez sieci). Opis, liczby i granice pokrycia:
// etl/biznes-popyt.md.
//
// Obszar to WSZYSTKIE adresy z pliku adresów, czyli Kraków (MSIP) i 13 gmin obwarzanka (PRG).
// Ludność z NSP 2021 (wskaźnik ludnosc_1km: liczba osób w oczku siatki 1 km, taka sama dla każdego
// adresu w oczku) dzielimy równo między adresy tego oczka, więc oczko liczy się raz, a nie tyle
// razy, ile ma adresów. Stąd bilans: suma ludności w heksach równa się sumie ludności oczek, w
// których leży choć jeden adres (z dokładnością do zaokrąglenia 0,01 osoby na heks).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cellToLatLng } from 'h3-js'
import proj4 from 'proj4'
import { DANE, dzis } from './lib/wspolne.mjs'

// Układ siatki spisowej (ETRS89-LAEA). Ta sama definicja co w etl/gus.mjs, który przypisuje oczka
// adresom: rozjazd definicji wyszedłby w `zbudujPopyt` jako różne wartości ludności w jednym oczku.
proj4.defs(
  'EPSG:3035',
  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +datum=WGS84 +units=m +no_defs',
)

/** Dopuszczalna różnica sumy ludności heksów i oczek przed zaokrągleniem (osoby): tylko błąd float. */
const TOLERANCJA_BILANSU = 1e-3
const PAUZA = String.fromCodePoint(0x2014)
const POLPAUZA = String.fromCodePoint(0x2013)

/** Klucz oczka siatki 1 km (EPSG:3035) dla punktu WGS84; ten sam dla każdego adresu w oczku. */
export function oczkoSiatki(lon, lat) {
  const [x, y] = proj4('WGS84', 'EPSG:3035', [lon, lat])
  return Math.floor(x / 1000) + ':' + Math.floor(y / 1000)
}

/** Polskie opisy bez pauzy: półpauza ze spacjami (reguła typografii projektu). Źródła kopiują ją z wejść. */
export function bezPauzy(wartosc) {
  return JSON.parse(JSON.stringify(wartosc).replaceAll(PAUZA, POLPAUZA))
}

const zaokragl = (liczba, miejsca) => {
  const m = 10 ** miejsca
  return Math.round(liczba * m) / m
}

/**
 * Heksy popytu z adresów. `adresy`, `ludnosc` i `kursy` to sparsowane pliki wejściowe. Zwraca
 * komórki w kolejności pierwszego adresu w heksie, przeliczenie na gminy i bilans ludności.
 * Rzuca błąd, gdy wejścia nie pasują do siebie albo gdy ludność w jednym oczku jest różna.
 */
export function zbudujPopyt({ adresy, ludnosc, kursy }) {
  if (ludnosc.wersjaAdresow !== adresy.wersja || kursy.wersjaAdresow !== adresy.wersja)
    throw new Error('Niezgodna wersja adresów')
  const k = adresy.kolumny
  const n = k.id.length
  if (ludnosc.wartosci.length !== n || kursy.wartosci.length !== n)
    throw new Error('Wskaźnik ma inną długość niż lista adresów')

  const oczka = k.lon.map((lon, i) => oczkoSiatki(lon, k.lat[i]))
  const liczbaAdresow = new Map()
  for (const id of oczka) liczbaAdresow.set(id, (liczbaAdresow.get(id) ?? 0) + 1)

  // Ludność oczka: wartość z jego adresów, która MUSI być ta sama w każdym z nich (to liczba osób
  // w oczku, nie przy adresie). Inaczej oczko policzono różnie w gus.mjs i tutaj albo wskaźnik jest
  // z innej wersji adresów, a suma po heksach przestałaby oznaczać cokolwiek.
  const ludnoscOczka = new Map()
  const oczkaBezWartosci = new Set()
  for (let i = 0; i < n; i++) {
    const pop = ludnosc.wartosci[i]
    if (!Number.isFinite(pop)) {
      oczkaBezWartosci.add(oczka[i])
      continue
    }
    const znana = ludnoscOczka.get(oczka[i])
    if (znana === undefined) ludnoscOczka.set(oczka[i], pop)
    else if (znana !== pop)
      throw new Error(`Niespójna ludność w oczku ${oczka[i]}: ${znana} i ${pop}`)
  }
  for (const id of oczkaBezWartosci)
    if (ludnoscOczka.has(id)) throw new Error(`Oczko ${id}: ludność jest tylko przy części adresów`)

  const heksy = new Map()
  const gminy = new Map()
  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (let i = 0; i < n; i++) {
    const h3 = k.h3[i]
    let cell = heksy.get(h3)
    if (!cell) {
      const [lat, lon] = cellToLatLng(h3)
      cell = { h3, lon, lat, adresy: 0, ludnosc: 0, kursy: 0, liczbaKursow: 0 }
      heksy.set(h3, cell)
    }
    cell.adresy++
    const pop = ludnosc.wartosci[i]
    const udzial = Number.isFinite(pop) ? pop / liczbaAdresow.get(oczka[i]) : 0
    cell.ludnosc += udzial
    const kurs = kursy.wartosci[i]
    if (Number.isFinite(kurs)) {
      cell.kursy += kurs
      cell.liczbaKursow++
    }

    let gmina = gminy.get(k.teryt[i])
    if (!gmina) {
      gmina = { nazwa: k.gmina[i], teryt: k.teryt[i], adresy: 0, h3: new Set(), ludnosc: 0 }
      gminy.set(k.teryt[i], gmina)
    }
    gmina.adresy++
    gmina.h3.add(h3)
    gmina.ludnosc += udzial
    if (k.lon[i] < minLon) minLon = k.lon[i]
    if (k.lon[i] > maxLon) maxLon = k.lon[i]
    if (k.lat[i] < minLat) minLat = k.lat[i]
    if (k.lat[i] > maxLat) maxLat = k.lat[i]
  }

  let ludnoscOczek = 0
  for (const pop of ludnoscOczka.values()) ludnoscOczek += pop
  let ludnoscHeksow = 0
  for (const c of heksy.values()) ludnoscHeksow += c.ludnosc
  if (Math.abs(ludnoscHeksow - ludnoscOczek) > TOLERANCJA_BILANSU)
    throw new Error(`Bilans ludności: heksy ${ludnoscHeksow}, oczka ${ludnoscOczek}`)

  // [h3, lon, lat, adresy, przypisana_ludnosc_NSP, srednie_kursy_w_szczycie]
  const komorki = [...heksy.values()].map((c) => [
    c.h3,
    zaokragl(c.lon, 6),
    zaokragl(c.lat, 6),
    c.adresy,
    zaokragl(c.ludnosc, 2),
    c.liczbaKursow ? zaokragl(c.kursy / c.liczbaKursow, 2) : 0,
  ])
  let ludnoscZapisana = 0
  for (const c of komorki) ludnoscZapisana += c[4]

  return {
    komorki,
    // `ludnoscPrzypisana` to ludność oczek 1 km rozdzielona na adresy gminy, a NIE ludność gminy:
    // oczko przy granicy ma też mieszkańców sąsiada, a każdy jego adres dostaje swój udział.
    gminy: [...gminy.values()]
      .sort((a, b) => b.adresy - a.adresy || a.teryt.localeCompare(b.teryt))
      .map((g) => ({
        nazwa: g.nazwa,
        teryt: g.teryt,
        adresy: g.adresy,
        heksy: g.h3.size,
        ludnoscPrzypisana: Math.round(g.ludnosc),
      })),
    bbox: {
      minLat: zaokragl(minLat, 5),
      maxLat: zaokragl(maxLat, 5),
      minLon: zaokragl(minLon, 5),
      maxLon: zaokragl(maxLon, 5),
    },
    bilans: {
      adresy: n,
      heksy: komorki.length,
      oczka: liczbaAdresow.size,
      ludnoscOczek,
      ludnoscHeksow: zaokragl(ludnoscZapisana, 2),
    },
  }
}

/**
 * Cały plik `popyt.json`. Kontrakt czytany przez `src/wynik/biznes.ts` i worker to `komorki`
 * (krotki jak wyżej) i `zrodla`; `wersjaAdresow` i `meta` są dodatkowe i czytnik ich nie potrzebuje.
 */
export function zbudujPlikPopytu(wejscie, wygenerowano = dzis()) {
  const { adresy, ludnosc, kursy } = wejscie
  const { komorki, gminy, bbox, bilans } = zbudujPopyt(wejscie)
  return {
    wersjaAdresow: adresy.wersja,
    zrodla: bezPauzy([...adresy.zrodla, ...ludnosc.meta.zrodla, ...kursy.meta.zrodla]),
    meta: {
      wygenerowano,
      obszar: {
        opis:
          'Wszystkie adresy z adresy.json: Kraków (MSIP) i gminy obwarzanka (PRG). Heks popytu ' +
          'istnieje tylko tam, gdzie leży co najmniej jeden adres, więc punkty usług z marginesu ' +
          'katalogu i z sąsiednich gmin nie mają popytu w zasięgu.',
        bbox,
        gminy,
      },
      metoda:
        'Ludność rezydująca z NSP 2021 (siatka 1 km, EPSG:3035) dzielona równo między adresy z ' +
        'tego samego oczka i sumowana w heksach H3 r10 (kolumna ludnosc, zaokrąglona do 0,01 ' +
        'osoby). Kursy to średnia z adresów heksu z wartością (kolumna kursy, kursy/h w porannym ' +
        'szczycie).',
      kolumny: ['h3', 'lon', 'lat', 'adresy', 'ludnosc', 'kursy'],
      bilans,
    },
    komorki,
  }
}

const wczytaj = (sciezka) => JSON.parse(readFileSync(join(DANE, sciezka), 'utf8'))

/** Pliki wejściowe tak, jak leżą w public/dane. */
export function wczytajWejscie() {
  return {
    adresy: wczytaj('adresy.json'),
    ludnosc: wczytaj('wskazniki/ludnosc_1km.json'),
    kursy: wczytaj('wskazniki/kursy_szczyt_h.json'),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plik = zbudujPlikPopytu(wczytajWejscie())
  const folder = join(DANE, 'biznes')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'popyt.json'), JSON.stringify(plik))
  const { bilans, obszar } = plik.meta
  console.log(
    `Popyt: ${bilans.heksy} heksów, ${bilans.adresy} adresów, ${obszar.gminy.length} gmin; ` +
      `ludność ${bilans.ludnoscHeksow} w heksach i ${bilans.ludnoscOczek} w ${bilans.oczka} oczkach`,
  )
}
