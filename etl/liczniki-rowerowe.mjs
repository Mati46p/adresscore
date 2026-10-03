// Liczniki rowerowe Krakowa (#136): jedna liczba dla każdego adresu z adresy.json.
//   rower_ruch_dobowy – średnia dobowa liczba rowerów z 365 dni pracy najbliższego automatycznego
//                       licznika ZTP, jeśli licznik stoi nie dalej niż 1 km w linii prostej od adresu.
//
// Źródła (oba otwarte, bez klucza, konta i logowania):
//   * Liczby: tabela „Dane tabelaryczne” na stronie ZTP Kraków (STRONA_ZTP). Strona ładuje ją z pliku
//     CSV, który ZTP publikuje w Arkuszach Google („publikuj w sieci”): dane dobowe z 19 liczników od
//     2016-11-18, odświeżane z opóźnieniem. Portal otwartedane.um.krakow.pl tych liczb nie zawiera
//     (zbiór „Mobilność Aktywna (Rowery)” podaje tylko lokalizacje), a api.um.krakow.pl wymaga
//     klucza, więc go nie używamy.
//   * Położenie: MSIP Kraków, usługa Obserwatorium/ZTP_Komunikacja_Miejska_i_Rowerowa, warstwa 3
//     „Infrastruktura rowerowa ZTP”, typ = „licznik rowerowy” (17 punktów, EPSG:2178). Nazwy
//     punktów są takie same jak nagłówki kolumn tabeli, więc łączymy je po nazwie.
//
// Dlaczego „365 dni pracy licznika”, a nie jedno okno kalendarzowe: ruch rowerowy zmienia się z
// porą roku czterokrotnie (lato kontra zima), więc średnia z niepełnego roku byłaby zafałszowana
// sezonem, a nie miejscem. Licznik wchodzi tylko z kompletnym rokiem (≥ 90% dni z odczytem).
// Dla 15 z 17 liczników rok kończy się na końcu tabeli; Bora-Komorowskiego i Smoleńsk mają w tabeli
// odczyty tylko do wcześniejszej daty (styczeń i lipiec 2026), więc ich rok kończy się na ostatnim
// odczycie (opis w meta.opis).
//
// Czego tu nie ma: liczników Brożka i Nawojki (uruchomione jesienią 2025, brak pełnego roku, brak
// położenia w MSIP) oraz rozbicia na kierunki jazdy (tabela ZTP go nie podaje).
//
// Uruchom: node etl/liczniki-rowerowe.mjs
// Surowe pobrania: etl/.cache/liczniki-rowerowe (jeden raz; aby odświeżyć, usuń katalog).
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import proj4 from 'proj4'
import {
  ATRYBUCJA_MSIP,
  LICENCJA_MSIP,
  MSIP,
  naMetry,
  pobierzJsonDoCache,
  pobierzWarstwe,
} from './lib/msip.mjs'
import { IndeksOdcinkow } from './lib/odcinki.mjs'
import { dataPobrania, pobierzTrwale } from './lib/pobieranie.mjs'
import { CACHE, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ZADANIE = 136
const ID = 'rower_ruch_dobowy'
const TERYT_KRAKOW = '1261011'
const PODKATALOG = 'liczniki-rowerowe'
const STRONA_ZTP = 'https://ztp.krakow.pl/rower/pomiary-ruchu-rowerowego/dane-tabelaryczne'
const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTWNYLoE3k3JegSt47hV66v5j7_Vh8jIdLRUhcMLrIAW4VcIZK-3W9rGoDSfnToUnCIb9DPngGAlgL6/pub?gid=0&single=true&output=csv'
const USLUGA_ZTP = 'Obserwatorium/ZTP_Komunikacja_Miejska_i_Rowerowa/MapServer'
const WARSTWA_LICZNIKOW = `${USLUGA_ZTP}/3`
const WARSTWA_CIAGOW = `${USLUGA_ZTP}/5`
const ZBIOR_ZTP =
  'https://otwartedane.um.krakow.pl/zbiory-danych/mobilnosc-aktywna-rowery-w-krakowie'
const WARUNKI_PORTALU =
  'https://otwartedane.um.krakow.pl/warunki-wykorzystania-danych-udostepnianych-w-portalu'

export const PROMIEN = 1000 // m, promień zasięgu licznika (ustalenie z issue #136)
export const OKNO_DNI = 365
export const MIN_POKRYCIE = 0.9 // udział dni z odczytem w oknie, poniżej którego licznik odpada
export const MAX_STAROSC_DNI = 366 // ostatni odczyt nie starszy niż rok od końca tabeli
// Ramka Krakowa w EPSG:2178 (jak w rowery.mjs i zielen.mjs): odsiewa rekordy z błędnymi współrzędnymi.
const RAMKA_KRAKOWA = { x: [7_400_000, 7_460_000], y: [5_520_000, 5_570_000] }
// Kolumny pogodowe tabeli mają jednostkę w nawiasie kwadratowym albo w nazwie temperaturę/opad.
const KOLUMNA_POGODOWA = /\[.*\]|temperatur|opad/i
const LATO = ['06', '07', '08']
const ZIMA = ['12', '01', '02']
// Znak kolejności bajtów, którym Excel zaczyna pliki CSV (zapis przez kod, bo jest niewidoczny).
const BOM = String.fromCharCode(0xfeff)

// ---------------------------------------------------------------------------------------------
// Tabela pomiarów (CSV)
// ---------------------------------------------------------------------------------------------

/** Parser CSV: pola w cudzysłowach z przecinkami i podwojonym „""”, końce wierszy LF i CRLF. */
export function parsujCsv(tekst) {
  const wiersze = []
  let wiersz = []
  let pole = ''
  let wCudzyslowie = false
  const koniecWiersza = () => {
    wiersz.push(pole)
    pole = ''
    if (wiersz.length > 1 || wiersz[0] !== '') wiersze.push(wiersz)
    wiersz = []
  }
  for (let i = 0; i < tekst.length; i++) {
    const znak = tekst[i]
    if (wCudzyslowie) {
      if (znak !== '"') pole += znak
      else if (tekst[i + 1] === '"') {
        pole += '"'
        i++
      } else wCudzyslowie = false
    } else if (znak === '"') wCudzyslowie = true
    else if (znak === ',') {
      wiersz.push(pole)
      pole = ''
    } else if (znak === '\n') koniecWiersza()
    else if (znak !== '\r') pole += znak
  }
  if (pole !== '' || wiersz.length) koniecWiersza()
  return wiersze
}

/** Komórka licznika: pusta (także ze spacją) albo niepoprawna to null, reszta liczba ≥ 0. */
function liczba(komorka) {
  const tekst = String(komorka ?? '')
    .trim()
    .replace(',', '.')
  if (tekst === '') return null
  const v = Number(tekst)
  return Number.isFinite(v) && v >= 0 ? v : null
}

/**
 * Tabela ZTP → { daty, liczniki: Map(nazwa → odczyty[]) }. Kolumny pogodowe (temperatura, opad)
 * odpadają. Rzuca błąd, gdy format wygląda inaczej niż znany (np. pobrano stronę błędu zamiast CSV):
 * lepiej zatrzymać bieg niż policzyć wskaźnik z przypadkowych kolumn.
 */
export function wczytajPomiary(tekst, { minLicznikow = 10, minDni = 365 } = {}) {
  const wiersze = parsujCsv(tekst.startsWith(BOM) ? tekst.slice(1) : tekst)
  const naglowek = (wiersze[0] ?? []).map((n) => n.trim())
  if (naglowek[0] !== 'Date')
    throw new Error(
      'Tabela ZTP: pierwsza kolumna powinna nazywać się „Date” (zmienił się format albo pobrano stronę błędu)',
    )
  const kolumny = []
  for (let i = 1; i < naglowek.length; i++)
    if (naglowek[i] && !KOLUMNA_POGODOWA.test(naglowek[i])) kolumny.push({ nazwa: naglowek[i], i })
  if (kolumny.length < minLicznikow)
    throw new Error(`Tabela ZTP: znaleziono ${kolumny.length} kolumn liczników, oczekiwano ok. 19`)
  if (new Set(kolumny.map((k) => kluczNazwy(k.nazwa))).size !== kolumny.length)
    throw new Error('Tabela ZTP: powtórzona nazwa licznika w nagłówku')
  const daty = []
  const liczniki = new Map(kolumny.map((k) => [k.nazwa, []]))
  for (const w of wiersze.slice(1)) {
    const data = (w[0] ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue
    if (daty.length && data <= daty.at(-1))
      throw new Error(`Tabela ZTP: daty nie rosną (${daty.at(-1)} → ${data})`)
    daty.push(data)
    for (const k of kolumny) liczniki.get(k.nazwa).push(liczba(w[k.i]))
  }
  if (daty.length < minDni) throw new Error(`Tabela ZTP: tylko ${daty.length} dni`)
  return { daty, liczniki, koniecTabeli: daty.at(-1) }
}

const numerDnia = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000
const naIso = (numer) => new Date(numer * 86_400_000).toISOString().slice(0, 10)

/**
 * Średnia dobowa z `oknoDni` dni kończących się na ostatnim odczycie licznika. Odczyt 0 to awaria
 * (licznik na ulicy ze średnią kilkuset rowerów nie notuje doby bez przejazdu), więc nie liczy się
 * ani do średniej, ani do pokrycia. Zwraca { srednia, dni, od, do, ... } albo { srednia: null, powod }.
 */
export function sredniaRoczna(
  daty,
  odczyty,
  {
    koniecTabeli = daty.at(-1),
    oknoDni = OKNO_DNI,
    minPokrycie = MIN_POKRYCIE,
    maxStarosc = MAX_STAROSC_DNI,
  } = {},
) {
  let ostatni = -1
  for (let i = daty.length - 1; i >= 0; i--)
    if (odczyty[i] > 0) {
      ostatni = i
      break
    }
  if (ostatni < 0) return { srednia: null, powod: 'brak odczytów' }
  const koniec = numerDnia(daty[ostatni])
  const starosc = numerDnia(koniecTabeli) - koniec
  if (starosc > maxStarosc)
    return {
      srednia: null,
      powod: `ostatni odczyt ${daty[ostatni]}, ${starosc} dni przed końcem tabeli`,
    }
  const poczatek = koniec - (oknoDni - 1)
  let suma = 0
  let dni = 0
  let lato = 0
  let dniLata = 0
  let zima = 0
  let dniZimy = 0
  for (let i = ostatni; i >= 0 && numerDnia(daty[i]) >= poczatek; i--) {
    const v = odczyty[i]
    if (!(v > 0)) continue
    suma += v
    dni++
    const miesiac = daty[i].slice(5, 7)
    if (LATO.includes(miesiac)) {
      lato += v
      dniLata++
    } else if (ZIMA.includes(miesiac)) {
      zima += v
      dniZimy++
    }
  }
  const wymagane = Math.ceil(minPokrycie * oknoDni)
  if (dni < wymagane)
    return {
      srednia: null,
      powod: `${dni} z ${oknoDni} dni z odczytem (wymagane ${wymagane})`,
      dni,
    }
  return {
    srednia: suma / dni,
    dni,
    od: naIso(poczatek),
    do: daty[ostatni],
    srednieLato: dniLata ? lato / dniLata : null,
    sredniaZima: dniZimy ? zima / dniZimy : null,
  }
}

/** Klucz do łączenia nazw: bez różnic wielkości liter, spacji i zapisu znaków diakrytycznych. */
export const kluczNazwy = (nazwa) =>
  String(nazwa ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

// ---------------------------------------------------------------------------------------------
// Położenie liczników (MSIP)
// ---------------------------------------------------------------------------------------------

const wRamceKrakowa = (x, y) =>
  x > RAMKA_KRAKOWA.x[0] &&
  x < RAMKA_KRAKOWA.x[1] &&
  y > RAMKA_KRAKOWA.y[0] &&
  y < RAMKA_KRAKOWA.y[1]

/** Punkty typu „licznik rowerowy” z warstwy 3 ZTP: { nazwa, klucz, x, y } w EPSG:2178. */
export function licznikiZMsip(obiekty) {
  const liczniki = []
  const pominiete = { inneTypy: 0, bezGeometrii: 0, poZasiegu: 0, powtorzone: 0 }
  const widziane = new Set()
  for (const o of obiekty) {
    const typ = String(o.attributes?.typ ?? '')
      .trim()
      .toLowerCase()
    if (typ !== 'licznik rowerowy') {
      pominiete.inneTypy++
      continue
    }
    const nazwa = String(o.attributes?.nazwa ?? '').trim()
    const g = o.geometry
    if (!nazwa || !g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) {
      pominiete.bezGeometrii++
      continue
    }
    if (!wRamceKrakowa(g.x, g.y)) {
      pominiete.poZasiegu++
      continue
    }
    const klucz = kluczNazwy(nazwa)
    if (widziane.has(klucz)) {
      pominiete.powtorzone++
      continue
    }
    widziane.add(klucz)
    liczniki.push({ nazwa, klucz, x: g.x, y: g.y })
  }
  return { liczniki, pominiete }
}

/** „26/09/2026” → „2026-09-26”; z wielu wartości bierze najpóźniejszą. */
export function dataImportuMsip(obiekty) {
  const daty = new Set()
  for (const o of obiekty) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(o.attributes?.data_importu ?? '').trim())
    if (m) daty.add(`${m[3]}-${m[2]}-${m[1]}`)
  }
  if (!daty.size) throw new Error('MSIP: brak poprawnej daty w polu data_importu')
  return [...daty].sort().at(-1)
}

/**
 * Łączy położenia z tabelą pomiarów po nazwie. Zwraca liczniki z kompletnym rokiem
 * ({ nazwa, x, y, srednia, dni, od, do, ... }) i listę odrzuconych z powodem – każdy z 19 liczników
 * z tabeli i każdy punkt z MSIP trafia do jednej z dwóch list.
 */
export function zlaczLiczniki(pozycje, pomiary, opcje = {}) {
  const uzyte = []
  const odrzucone = []
  const poKluczu = new Map(pozycje.map((p) => [p.klucz, p]))
  const wTabeli = new Set()
  for (const [nazwa, odczyty] of pomiary.liczniki) {
    const klucz = kluczNazwy(nazwa)
    wTabeli.add(klucz)
    const sr = sredniaRoczna(pomiary.daty, odczyty, {
      koniecTabeli: pomiary.koniecTabeli,
      ...opcje,
    })
    const pozycja = poKluczu.get(klucz)
    if (sr.srednia === null) odrzucone.push({ nazwa, powod: sr.powod })
    else if (!pozycja) odrzucone.push({ nazwa, powod: 'brak położenia w MSIP' })
    else uzyte.push({ ...pozycja, ...sr })
  }
  for (const p of pozycje)
    if (!wTabeli.has(p.klucz)) odrzucone.push({ nazwa: p.nazwa, powod: 'brak w tabeli pomiarów' })
  return { uzyte, odrzucone }
}

// ---------------------------------------------------------------------------------------------
// Wskaźnik
// ---------------------------------------------------------------------------------------------

/** Do 10: tabela podaje pełne rowery, ale to średnia z roku, więc dziesiątki są uczciwą precyzją. */
export const zaokraglij10 = (v) => Math.round(v / 10) * 10

/** „2026-08-31” → „31.08.2026” (zapis w tekstach dla czytelnika). */
export const dataPl = (iso) => iso.split('-').reverse().join('.')

export const etykietaLicznika = (nazwa, metry) => `licznik ${nazwa}, ${zaokraglij10(metry)} m`

/** Najbliższy licznik w promieniu (włącznie) albo null. Odległość euklidesowa w metrach EPSG:2178. */
export function najblizszyLicznik(liczniki, x, y, promien = PROMIEN) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  let najlepszy = null
  for (const l of liczniki) {
    const metry = Math.hypot(l.x - x, l.y - y)
    if (metry <= promien && (!najlepszy || metry < najlepszy.metry))
      najlepszy = { licznik: l, metry }
  }
  return najlepszy
}

/** Wartości i etykiety dla adresów danych jako [x, y] w EPSG:2178; poza promieniem null. */
export function policzWskaznik(xy, liczniki, promien = PROMIEN) {
  const wartosci = []
  const etykiety = []
  const trafienia = []
  for (const [x, y] of xy) {
    const t = najblizszyLicznik(liczniki, x, y, promien)
    wartosci.push(t ? zaokraglij10(t.licznik.srednia) : null)
    etykiety.push(t ? etykietaLicznika(t.licznik.nazwa, t.metry) : null)
    trafienia.push(t)
  }
  return { wartosci, etykiety, trafienia }
}

/**
 * Odległość w metrach po elipsoidzie GRS80 z długości i szerokości geograficznej (WGS84), liczona
 * w płaszczyźnie stycznej w środku odcinka: promienie krzywizny M (południk) i N (równoleżnik).
 * Niezależna od układu EPSG:2178, więc nadaje się do kontroli odległości z proj4; do kilku
 * kilometrów błąd to ułamki milimetra. Haversine na kuli myliłby się tu o 0,3% (ok. 3 m na 1 km).
 */
export function odlegloscElipsoidyM(lon1, lat1, lon2, lat2) {
  const rad = Math.PI / 180
  const a = 6_378_137
  const e2 = 0.0066943800229
  const fi = ((lat1 + lat2) / 2) * rad
  const w = Math.sqrt(1 - e2 * Math.sin(fi) ** 2)
  const dy = ((a * (1 - e2)) / w ** 3) * (lat2 - lat1) * rad
  const dx = (a / w) * Math.cos(fi) * (lon2 - lon1) * rad
  return Math.hypot(dx, dy)
}

// ---------------------------------------------------------------------------------------------
// Pobieranie
// ---------------------------------------------------------------------------------------------

async function pobierzPomiary() {
  mkdirSync(join(CACHE, PODKATALOG), { recursive: true })
  const plik = `${PODKATALOG}/pomiary-ztp.csv`
  const sciezka = join(CACHE, plik)
  if (!existsSync(sciezka)) await pobierzTrwale(CSV_URL, plik)
  try {
    return { ...wczytajPomiary(readFileSync(sciezka, 'utf8')), pobrano: dataPobrania(sciezka) }
  } catch (blad) {
    rmSync(sciezka, { force: true }) // zepsutego bufora nie zostawiamy na kolejny bieg
    throw blad
  }
}

// ---------------------------------------------------------------------------------------------
// Skrypt
// ---------------------------------------------------------------------------------------------

function percentyle(wartosci, ps = [5, 25, 50, 75, 95, 100]) {
  const s = wartosci.filter((v) => v !== null).sort((a, b) => a - b)
  if (!s.length) return 'brak danych'
  return ps
    .map((p) => `p${p}=${s[Math.min(s.length - 1, Math.ceil((s.length * p) / 100) - 1)]}`)
    .join(' ')
}

// Przybliżone współrzędne znanych miejsc [lon, lat]; kontrola pokazuje wartość dla najbliższego adresu.
const MIEJSCA_KONTROLNE = [
  ['Kraków, Rynek Główny', 19.93725, 50.06168],
  ['Kraków, Dworzec Główny', 19.9475, 50.0677],
  ['Kraków, Rondo Mogilskie', 19.9573, 50.0658],
  ['Kraków, Plac Nowy (Kazimierz)', 19.9419, 50.0513],
  ['Kraków, Rynek Podgórski', 19.9496, 50.0425],
  ['Kraków, Salwator', 19.8991, 50.0548],
  ['Kraków, Nowa Huta, Plac Centralny', 20.0373, 50.0724],
  ['Kraków, Wola Justowska', 19.87, 50.075],
  ['Kraków, Prokocim', 20.0, 50.0105],
  ['Wieliczka, Rynek', 20.0646, 49.9868],
  ['Skawina, Rynek', 19.8284, 49.9752],
  ['Niepołomice, Rynek', 20.2152, 50.0343],
]

async function main() {
  const start = performance.now()
  const { adresy } = wczytajAdresy()
  const xy = adresy.map((a) => naMetry(a.lon, a.lat))
  const wKrakowie = adresy.map((a) => a.teryt === TERYT_KRAKOW)
  const nKrakow = wKrakowie.filter(Boolean).length
  console.log(
    `Adresy: ${adresy.length}, w tym Kraków ${nKrakow}, obwarzanek ${adresy.length - nKrakow}`,
  )

  // 1. Tabela pomiarów ZTP
  const pomiary = await pobierzPomiary()
  console.log(
    `Tabela ZTP: ${pomiary.daty.length} dni (${pomiary.daty[0]} – ${pomiary.koniecTabeli}), ` +
      `${pomiary.liczniki.size} liczników: ${[...pomiary.liczniki.keys()].join(', ')}`,
  )

  // 2. Położenie liczników (MSIP, warstwa 3)
  const warstwa = await pobierzWarstwe(WARSTWA_LICZNIKOW, {
    katalog: `${PODKATALOG}/msip3`,
    where: "typ='licznik rowerowy'",
  })
  const { liczniki: pozycje, pominiete } = licznikiZMsip(warstwa.obiekty)
  const dataZtp = dataImportuMsip(warstwa.obiekty)
  const pobranoMsip = dataPobrania(join(CACHE, PODKATALOG, 'msip3', 'id.json'))
  console.log(
    `MSIP: ${warstwa.liczba} obiektów, liczników z położeniem ${pozycje.length} ` +
      `(pominięte: ${JSON.stringify(pominiete)}); data importu ZTP ${dataZtp}`,
  )

  // 3. Łączenie i średnie roczne
  const { uzyte, odrzucone } = zlaczLiczniki(pozycje, pomiary)
  if (uzyte.length < 10) throw new Error(`Tylko ${uzyte.length} liczników z kompletnym rokiem`)
  console.log(`Liczniki z kompletnym rokiem: ${uzyte.length}`)
  for (const l of uzyte.sort((a, b) => b.srednia - a.srednia))
    console.log(
      `  ${l.nazwa.padEnd(20)} ${l.srednia.toFixed(1).padStart(7)} rowerów/dobę, ${l.dni} dni ${l.od} – ${l.do}`,
    )
  console.log(`Odrzucone: ${odrzucone.map((o) => `${o.nazwa} (${o.powod})`).join('; ') || 'brak'}`)

  // 4. Kontrole układu: położenia z serwera w WGS84 kontra proj4, odległości kontra elipsoida
  const wgs = await pobierzJsonDoCache(
    `${MSIP}/${WARSTWA_LICZNIKOW}/query?${new URLSearchParams({
      where: "typ='licznik rowerowy'",
      outFields: 'nazwa',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
    })}`,
    `${PODKATALOG}/msip3_wgs84.json`,
  )
  const lonLat = new Map(wgs.features.map((f) => [kluczNazwy(f.attributes.nazwa), f.geometry]))
  let najwiekszyRozjazd = 0
  for (const l of uzyte) {
    const [lon, lat] = proj4('EPSG:2178', 'EPSG:4326', [l.x, l.y])
    const serwer = lonLat.get(l.klucz)
    if (!serwer) throw new Error(`Brak położenia WGS84 z serwera dla licznika ${l.nazwa}`)
    l.lon = serwer.x
    l.lat = serwer.y
    najwiekszyRozjazd = Math.max(
      najwiekszyRozjazd,
      odlegloscElipsoidyM(lon, lat, serwer.x, serwer.y),
    )
  }
  console.log(
    `Kontrola układu: proj4 (EPSG:2178 → WGS84) kontra WGS84 z serwera MSIP, największy rozjazd ` +
      `${najwiekszyRozjazd.toFixed(2)} m na ${uzyte.length} licznikach`,
  )
  if (najwiekszyRozjazd > 2)
    throw new Error(`Definicja EPSG:2178 rozjeżdża się z serwerem MSIP o ${najwiekszyRozjazd} m`)

  // 5. Wskaźnik
  const { wartosci, etykiety, trafienia } = policzWskaznik(xy, uzyte)

  let najwiekszaRoznicaOdleglosci = 0
  let sprawdzone = 0
  trafienia.forEach((t, i) => {
    if (!t) return
    const elipsoida = odlegloscElipsoidyM(
      adresy[i].lon,
      adresy[i].lat,
      t.licznik.lon,
      t.licznik.lat,
    )
    najwiekszaRoznicaOdleglosci = Math.max(
      najwiekszaRoznicaOdleglosci,
      Math.abs(elipsoida - t.metry),
    )
    sprawdzone++
  })
  console.log(
    `Kontrola odległości: ${sprawdzone} adresów w zasięgu, EPSG:2178 (proj4 + położenie MSIP) kontra elipsoida ` +
      `z WGS84, największa różnica ${najwiekszaRoznicaOdleglosci.toFixed(2)} m`,
  )
  if (najwiekszaRoznicaOdleglosci > 1)
    throw new Error('Odległości w EPSG:2178 rozjeżdżają się z elipsoidą o ponad 1 m')

  // Kontrola wyboru: drugi sposób, pełne sortowanie licznik po liczniku zamiast najbliższego z pętli.
  const krok = Math.max(1, Math.floor(adresy.length / 800))
  let zgodne = 0
  for (let i = 0; i < adresy.length; i += krok) {
    const posortowane = uzyte
      .map((l) => ({ l, m: Math.hypot(l.x - xy[i][0], l.y - xy[i][1]) }))
      .sort((a, b) => a.m - b.m)
    const oczekiwany = posortowane[0].m <= PROMIEN ? posortowane[0].l.nazwa : null
    const jest = trafienia[i]?.licznik.nazwa ?? null
    if (oczekiwany !== jest) throw new Error(`Adres ${i}: oczekiwano ${oczekiwany}, jest ${jest}`)
    zgodne++
  }
  console.log(
    `Kontrola wyboru licznika: ${zgodne} adresów zgodnych z pełnym sortowaniem odległości`,
  )

  // Kontrola położenia: liczniki powinny stać na infrastrukturze rowerowej (warstwa 5, #119).
  try {
    const ciagi = await pobierzWarstwe(WARSTWA_CIAGOW, { katalog: `${PODKATALOG}/msip5` })
    const indeks = new IndeksOdcinkow()
    for (const o of ciagi.obiekty)
      for (const sciezka of o.geometry?.paths ?? [])
        indeks.dodajLinie(
          sciezka.map(([x, y]) => [x, y]),
          o.attributes?.rodzaj ?? null,
        )
    const odl = uzyte
      .map((l) => ({
        nazwa: l.nazwa,
        ...(indeks.najblizszy(l.x, l.y, 5000) ?? { metry: Infinity }),
      }))
      .sort((a, b) => a.metry - b.metry)
    const wZasiegu = odl.filter((o) => o.metry <= 30).length
    console.log(
      `Kontrola położenia (#119, ciągi rowerowe ZTP, ${indeks.liczbaOdcinkow} odcinków): ` +
        `${wZasiegu} z ${odl.length} liczników w ≤ 30 m od linii; najdalej: ` +
        odl
          .slice(-3)
          .map((o) => `${o.nazwa} ${Math.round(o.metry)} m [${o.znacznik ?? 'brak'}]`)
          .join(', '),
    )
  } catch (blad) {
    console.warn(`KONTROLA POŁOŻENIA POMINIĘTA: ${blad.message}`)
  }

  // Statystyki
  const pokrycie = (maska) => {
    const n = wartosci.filter((v, i) => maska(i) && v !== null).length
    const z = adresy.filter((_, i) => maska(i)).length
    return `${n}/${z} (${((100 * n) / z).toFixed(1)}%)`
  }
  console.log(
    `Pokrycie: Kraków ${pokrycie((i) => wKrakowie[i])}, obwarzanek ${pokrycie((i) => !wKrakowie[i])}`,
  )
  console.log(`Wartości:  ${percentyle(wartosci)}`)
  console.log(
    `Odległość do licznika: ${percentyle(trafienia.map((t) => (t ? Math.round(t.metry) : null)))}`,
  )
  const poLicznikach = new Map()
  for (const t of trafienia)
    if (t) poLicznikach.set(t.licznik.nazwa, (poLicznikach.get(t.licznik.nazwa) ?? 0) + 1)
  console.log(
    `Adresów na licznik: ${[...poLicznikach]
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `${n} ${c}`)
      .join(', ')}`,
  )
  console.log('Miejsca kontrolne (najbliższy adres w bazie):')
  for (const [nazwa, lon, lat] of MIEJSCA_KONTROLNE) {
    const [px, py] = naMetry(lon, lat)
    let najlepszy = -1
    let odl = Infinity
    for (let i = 0; i < adresy.length; i++) {
      const d = Math.hypot(xy[i][0] - px, xy[i][1] - py)
      if (d < odl) {
        odl = d
        najlepszy = i
      }
    }
    const a = adresy[najlepszy]
    console.log(
      `  ${nazwa.padEnd(36)} → ${`${a.miejscowosc} ${a.ulica ?? ''} ${a.nr}`.trim().padEnd(34)} (${Math.round(odl)} m od punktu) ` +
        `${wartosci[najlepszy] === null ? 'brak licznika w 1 km' : `${wartosci[najlepszy]} rowerów/dobę [${etykiety[najlepszy]}]`}`,
    )
  }

  // 6. Zapis
  const roki = new Map()
  for (const l of uzyte) {
    const k = `${dataPl(l.od)} – ${dataPl(l.do)}`
    roki.set(k, [...(roki.get(k) ?? []), l.nazwa])
  }
  const [glowny, ...wyjatki] = [...roki].sort((a, b) => b[1].length - a[1].length)
  const opisOkna =
    `Rok pomiaru: ${glowny[0]} dla ${glowny[1].length} liczników` +
    (wyjatki.length
      ? `; dla pozostałych rok kończy się na ostatnim odczycie (${wyjatki.map(([k, n]) => `${n.join(', ')}: ${k}`).join('; ')})`
      : '')
  const lato = uzyte.map((l) => l.srednieLato / l.srednia)
  const zima = uzyte.map((l) => l.sredniaZima / l.srednia)
  const sezon = lato.reduce((s, v) => s + v, 0) / zima.reduce((s, v) => s + v, 0)
  console.log(`Sezonowość: latem średnio ${sezon.toFixed(1)} razy więcej niż zimą`)

  zapiszWskaznik(
    {
      id: ID,
      kategoria: 'transport',
      nazwa: 'Ruch rowerowy przy najbliższym liczniku',
      opis:
        `Średnia dobowa liczba rowerów zarejestrowana w ciągu 365 dni pracy przez najbliższy z ${uzyte.length} automatycznych liczników ZTP Kraków, o ile stoi nie dalej niż ${PROMIEN / 1000} km w linii prostej od adresu. ` +
        `${opisOkna}. Liczby pochodzą z tabeli ZTP (dane dobowe, bez rozbicia na kierunki); dni z odczytem zero uznajemy za awarię licznika. ` +
        `To ruch na jednej policzonej ulicy, nie pod adresem: pokazuje, jak intensywnie jeździ się rowerem w okolicy, a nie czy jest tam bezpiecznie lub wygodnie. ` +
        `Średnia roczna ukrywa porę roku: latem (czerwiec – sierpień) liczniki notują średnio ${Math.round(sezon)} razy więcej rowerów niż zimą (grudzień – luty). ` +
        `Liczniki stoją na głównych trasach Krakowa, więc brak wartości znaczy „żaden licznik w promieniu ${PROMIEN / 1000} km”, a nie „nikt tu nie jeździ”; poza Krakowem liczników nie ma. ` +
        `Nie wchodzą liczniki bez pełnego roku danych albo bez położenia w MSIP (${odrzucone.map((o) => o.nazwa).join(', ') || 'brak'}).`,
      jednostka: 'rowerów/dobę',
      kierunek: 'wiecej-lepiej',
      rozdzielczosc: 'rejon',
      rozmiar: `do ${PROMIEN / 1000} km od najbliższego licznika`,
      // Średnie liczników mieszczą się w 680–2 220; 2 000 to „bardzo ruchliwa trasa” (Mogilska, Dworzec).
      zakres: [0, 2000],
      zadanie: ZADANIE,
      zrodla: [
        {
          nazwa:
            'Zarząd Transportu Publicznego w Krakowie – wyniki automatycznych pomiarów ruchu rowerowego (dane tabelaryczne z liczników)',
          url: STRONA_ZTP,
          licencja: `Informacja sektora publicznego udostępniona na stronie ZTP bez rejestracji; strona nie podaje odrębnej licencji, więc stosujemy warunki portalu Otwarte Dane Krakowa (swobodne ponowne wykorzystanie, wymagane podanie źródła „Gmina Miejska Kraków” oraz czasu wytworzenia i pozyskania danych): ${WARUNKI_PORTALU}`,
          dataDanych: pomiary.koniecTabeli,
          pobrano: pomiary.pobrano,
        },
        {
          nazwa: `${ATRYBUCJA_MSIP} – ZTP Kraków: Infrastruktura rowerowa ZTP (położenie liczników rowerowych)`,
          url: `${MSIP}/${WARSTWA_LICZNIKOW}`,
          licencja: `${LICENCJA_MSIP}; dane ZTP: ${ZBIOR_ZTP}`,
          dataDanych: dataZtp,
          pobrano: pobranoMsip,
        },
      ],
    },
    wartosci,
    etykiety,
  )
  console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
}
