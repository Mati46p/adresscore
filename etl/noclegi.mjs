// Presja turystyczna: miejsca noclegowe w promieniu 300 m od adresu → wskaźnik `noclegi_lozka_300m`.
//
// Źródła (rejestry urzędowe; surowe pobrania w etl/.cache/noclegi/, drugi bieg ich używa):
//   KON – MSIP Kraków, „Krakowskie Obiekty Noclegowe": ewidencja obiektów świadczących usługi
//     hotelarskie, ale niebędących obiektami hotelarskimi (apartamenty, pokoje gościnne, hostele,
//     aparthotele, domy studenckie). Usługa ArcGIS REST (EPSG:2178, pobieramy outSR=4326),
//     liczba miejsc w polu total_beds. Dane żywe: pole `aktualnosc` to data importu do MSIP.
//   KOH – MSIP Kraków, „Krakowskie Obiekty Hotelarskie": wyciąg z CWOH dla Krakowa (hotele,
//     pensjonaty, kempingi, schroniska – obiekty skategoryzowane), import 2023-06-30 (pole
//     IMPORT_D). Dokładamy go do Krakowa, bo KON nie zawiera hoteli: bez KOH wskaźnik gubiłby
//     około jednej trzeciej miejsc, a dla gmin obwarzanka (CWOH) liczą się właśnie hotele.
//   CWOH – Centralny Wykaz Obiektów Hotelarskich, dane.gov.pl zbiór 1083, CSV ze stanem na
//     2021-09-02 (cp1250, separator „;"), licencja CC0. Bierzemy wiersze 13 gmin obwarzanka;
//     Kraków pochodzi z nowszego KOH (CWOH-2021 dla Krakowa to ten sam wykaz sprzed dwóch lat).
// Licencja MSIP zabrania ciągłego pośredniczenia w usługach miasta, dlatego liczymy statyczny
// plik skryptem, a nie odpytujemy MSIP z aplikacji.
//
// Co liczy: dla każdego adresu z adresy.json suma miejsc noclegowych wszystkich obiektów
// (KON + KOH + CWOH) leżących do 300 m (EPSG:2178, odległość płaska, błąd skali poniżej 0,1%).
// Liczymy po wspólnym zbiorze punktów, więc adres przy granicy Krakowa widzi też obiekty po
// drugiej stronie granicy.
//
// Zasady jakości:
//   - Ten sam lokal (ulica, numer, jeden numer lokalu) wpisany do KON kilka razy to jedno miejsce
//     świadczenia usług (zmiana operatora bez wykreślenia starego wpisu): liczymy go raz, wpis
//     z najnowszą aktualizacją. Wpisy bez numeru lokalu albo z zakresem/listą lokali zostają –
//     to mogą być różne obiekty w jednym budynku.
//   - Wpis bez współrzędnych albo bez liczby miejsc nie wchodzi do sumy (zliczamy je w kontroli).
//   - KON i KOH są rozłączne z definicji (obiekty niehotelarskie i skategoryzowane hotelarskie),
//     więc ich nie scalamy. Kilka obiektów mogło przejść z KOH do KON i występuje w obu
//     rejestrach; skala tego zjawiska jest mierzona i wypisywana przy każdym biegu.
//   - CWOH geokodujemy po adresy.json: gmina + (miejscowość, ulica, numer). Ulice w CWOH bywają
//     skrócone („Kościuszki" zamiast „Tadeusza Kościuszki", „G. Narutowicza"), dlatego zgodność
//     ulicy liczymy od końca nazwy, z dopuszczeniem inicjałów. Gdy takich adresów jest kilka,
//     wygrywa najbliższy współrzędnym z pliku CWOH. Brak adresu albo rozbieżność powyżej 1 km
//     od współrzędnych z pliku to powrót do współrzędnych z pliku (CWOH podaje je dla każdego
//     obiektu). Rozbieżności wypisujemy.
//   - Wiersze CWOH bierzemy tylko wtedy, gdy nazwa gminy i 6 pierwszych cyfr TERYT z identyfikatora
//     zgadzają się z adresami (homonimy: Michałowice i Zielonki pod Warszawą).
//   - 0 oznacza brak obiektu z rejestrów w 300 m, nie brak danych: rejestry obejmują cały
//     obszar. W gminach CWOH nie zawiera obiektów nieskategoryzowanych (pokoje, agroturystyka),
//     o czym mówi opis wskaźnika.
//
// Uruchom: node etl/noclegi.mjs

import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import KDBush from 'kdbush'
import proj4 from 'proj4'
import { CACHE, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const PROMIEN = 300 // m
export const TERYT_KRAKOW = '1261011'
const MAKS_ROZBIEZNOSC_M = 1000 // adres z adresy.json dalej niż to od współrzędnych CWOH odrzucamy
const MSIP = 'https://msip.um.krakow.pl/arcgis/rest/services/Obserwatorium'
const URL_KON = `${MSIP}/WT_OBIEKTY_NOCLEGOWE_KON/MapServer/0`
const URL_KOH = `${MSIP}/WT_OBIEKTY_HOTELOWE_KOH/MapServer/0`
const URL_KOH_ZBIOR = 'https://msip.krakow.pl/dataset/1309'
const URL_CWOH_ZBIOR = 'https://dane.gov.pl/pl/dataset/1083,centralny-wykaz-obiektow-hotelarskich'
const URL_CWOH =
  'https://api.dane.gov.pl/media/resources/20210902/Centralny_Wykaz_Obiektow_Hotelarskich_stan_na_02.09.2021.csv'
const DATA_CWOH = '2021-09-02'
const REGULAMIN_MSIP = 'https://msip.krakow.pl/getHtml?dok_id=228972'
const STRONA = 1000 // najmniejszy maxRecordCount z usług (KOH)

const EPSG2178 =
  '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs'
const Z_WGS = proj4('EPSG:4326', EPSG2178)

// ---------- tekst: normalizacja nazw, ulic i numerów ----------

/** Małe litery, bez ogonków, jedna spacja zamiast interpunkcji. */
export function norm(tekst) {
  return String(tekst ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** „15 H" i „15h" to ten sam numer. */
export const nrNorm = (nr) =>
  String(nr ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')

const SKROTY = { al: 'aleja', pl: 'plac', os: 'osiedle' }

/** Człony nazwy ulicy bez „ul."; skróty typu „pl." rozwijamy, żeby nie myliły się z nazwiskiem. */
export function czlonyUlicy(ulica) {
  const czlony = norm(ulica).split(' ').filter(Boolean)
  while (czlony[0] === 'ul' || czlony[0] === 'ulica') czlony.shift()
  return czlony.map((c) => SKROTY[c] ?? c)
}

/**
 * Czy nazwa ulicy z CWOH może oznaczać ulicę z adresy.json. Porównujemy od końca nazwy, bo CWOH
 * często pomija imię („Kościuszki" = „Tadeusza Kościuszki") albo skraca je do inicjału
 * („G. Narutowicza"). Zgodność jest warunkiem koniecznym, nie wystarczającym: numer i miejscowość
 * muszą się zgadzać, a przy kilku kandydatach decyduje odległość.
 */
export function ulicaZgodna(a, b) {
  const n = Math.min(a.length, b.length)
  if (n === 0) return false
  for (let i = 1; i <= n; i++) {
    const x = a[a.length - i]
    const y = b[b.length - i]
    const zgodne =
      x === y || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y))
    if (!zgodne) return false
  }
  return true
}

// ---------- geometria ----------

const RAD = Math.PI / 180
const GRS80_A = 6_378_137
const GRS80_E2 = 0.0066943800229

/**
 * Odległość w metrach na elipsoidzie GRS80 (lokalnie, z promieniami krzywizny na średniej
 * szerokości). Nie używa proj4 ani indeksu, więc nadaje się do niezależnej kontroli sum;
 * dla odległości do kilku kilometrów błąd jest poniżej 0,01%. Kula (haversine) myliłaby się
 * o 0,3% w kierunku wschód–zachód, czyli o metr przy promieniu 300 m.
 */
export function metry(lat1, lon1, lat2, lon2) {
  const fi = ((lat1 + lat2) / 2) * RAD
  const w = Math.sqrt(1 - GRS80_E2 * Math.sin(fi) ** 2)
  const dN = (lat2 - lat1) * RAD * ((GRS80_A * (1 - GRS80_E2)) / w ** 3)
  const dE = (lon2 - lon1) * RAD * ((GRS80_A / w) * Math.cos(fi))
  return Math.hypot(dN, dE)
}

/**
 * Suma miejsc obiektów do `promien` m od każdego adresu. Płaska odległość w EPSG:2178, tak jak
 * w pozostałych warstwach promieniowych. Zero to zmierzone zero (brak obiektu w zasięgu).
 */
export function sumaMiejsc(adresy, obiekty, promien = PROMIEN) {
  if (!obiekty.length) return adresy.map(() => 0)
  const indeks = new KDBush(obiekty.length)
  for (const o of obiekty) indeks.add(...Z_WGS.forward([o.lon, o.lat]))
  indeks.finish()
  return adresy.map((a) => {
    const [x, y] = Z_WGS.forward([a.lon, a.lat])
    let suma = 0
    for (const i of indeks.within(x, y, promien)) suma += obiekty[i].miejsca
    return suma
  })
}

/**
 * Niezależne przeliczenie sum dla `liczba` adresów (ciąg pseudolosowy o stałym ziarnie): pełny
 * przegląd wszystkich obiektów zamiast indeksu, odległość z elipsoidy zamiast z odwzorowania.
 * Rozjazd jest dopuszczony tylko, gdy jakiś obiekt leży w granicy 10 cm od promienia.
 */
export function kontrolaNiezalezna(adresy, obiekty, wartosci, liczba = 600, promien = PROMIEN) {
  let ziarno = 12345
  const los = () => {
    ziarno = (ziarno * 1103515245 + 12345) % 2147483648
    return ziarno / 2147483648
  }
  let niezgodne = 0
  for (let n = 0; n < liczba; n++) {
    const i = Math.floor(los() * adresy.length)
    let suma = 0
    let naGranicy = false
    for (const o of obiekty) {
      const d = metry(adresy[i].lat, adresy[i].lon, o.lat, o.lon)
      if (d <= promien) suma += o.miejsca
      if (Math.abs(d - promien) < 0.1) naGranicy = true
    }
    if (suma !== wartosci[i] && !naGranicy) niezgodne++
  }
  return { sprawdzone: liczba, niezgodne }
}

// ---------- KON i KOH (MSIP) ----------

const dataIso = (ms) => new Date(ms).toISOString().slice(0, 10)

/** Wpisy KON jako płaskie obiekty; odrzuca wpisy bez geometrii albo bez liczby miejsc. */
export function obiektyKon(features) {
  const bilans = { wpisow: features.length, bezGeometrii: 0, bezMiejsc: 0 }
  const obiekty = []
  for (const f of features) {
    const p = f.properties ?? {}
    const [lon, lat] = f.geometry?.coordinates ?? []
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      bilans.bezGeometrii++
      continue
    }
    const miejsca = Number(p.total_beds)
    if (!Number.isInteger(miejsca) || miejsca < 1) {
      bilans.bezMiejsc++
      continue
    }
    obiekty.push({
      zrodlo: 'KON',
      lon,
      lat,
      miejsca,
      rodzaj: p.kind ?? null,
      nazwa: p.name ?? '',
      ulica: p.street ?? '',
      nr: p.building ?? '',
      lokal: p.apartment ?? '',
      aktualizacja: Number(p.gpt_date) || 0,
      fid: Number(p.objectid) || 0,
    })
  }
  return { obiekty, bilans }
}

/**
 * Ten sam lokal (jeden numer lokalu w tym samym budynku) zgłoszony wielokrotnie liczymy raz:
 * zostaje wpis z najnowszą aktualizacją, bo starszy to zwykle poprzedni operator albo import
 * z 2022-04-29. Zakresy i listy lokali („9-13", „1, 2, 3") opisują grupę, nie jeden lokal –
 * pięć różnych apartamentów w jednym budynku może mieć ten sam zakres – więc ich nie ruszamy,
 * tak samo jak wpisów bez numeru lokalu (to mogą być różne obiekty w jednym budynku).
 */
export function bezPowtorzonychLokali(obiekty) {
  const nowszy = (a, b) =>
    a.aktualizacja > b.aktualizacja || (a.aktualizacja === b.aktualizacja && a.fid > b.fid)
  const bezLokalu = []
  const lokale = new Map()
  for (const o of obiekty) {
    const lokal = norm(o.lokal)
    if (!/^[a-z0-9]+$/.test(lokal)) {
      bezLokalu.push(o)
      continue
    }
    const klucz = `${norm(o.ulica)}|${nrNorm(o.nr)}|${lokal}`
    const dotychczasowy = lokale.get(klucz)
    if (!dotychczasowy || nowszy(o, dotychczasowy)) lokale.set(klucz, o)
  }
  const wynik = [...bezLokalu, ...lokale.values()].sort((a, b) => a.fid - b.fid)
  const miejsca = (lista) => lista.reduce((s, o) => s + o.miejsca, 0)
  return {
    obiekty: wynik,
    usunieto: obiekty.length - wynik.length,
    usunietoMiejsc: miejsca(obiekty) - miejsca(wynik),
  }
}

/** Wpisy KOH (wyciąg z CWOH dla Krakowa) jako płaskie obiekty. */
export function obiektyKoh(features) {
  const bilans = { wpisow: features.length, bezGeometrii: 0, bezMiejsc: 0 }
  const obiekty = []
  for (const f of features) {
    const p = f.properties ?? {}
    const [lon, lat] = f.geometry?.coordinates ?? []
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      bilans.bezGeometrii++
      continue
    }
    const miejsca = Number(p.MN_LICZBA)
    if (!Number.isInteger(miejsca) || miejsca < 1) {
      bilans.bezMiejsc++
      continue
    }
    obiekty.push({
      zrodlo: 'KOH',
      lon,
      lat,
      miejsca,
      rodzaj: p.OB_RODZAJ ?? null,
      nazwa: p.OB_NAZWA ?? '',
      ulica: p.ULICA ?? '',
      nr: p.NR_AD_XY ?? '',
      lokal: '',
      fid: Number(p.FID) || 0,
    })
  }
  return { obiekty, bilans }
}

/** Obiekty KOH, które stoją pod tym samym adresem (ulica + numer) co jakiś wpis KON. */
export function wspolneAdresyKonKoh(kon, koh) {
  const adresy = new Set(kon.map((o) => `${norm(o.ulica)}|${nrNorm(o.nr)}`))
  return koh.filter((o) => adresy.has(`${norm(o.ulica)}|${nrNorm(o.nr)}`))
}

// ---------- CWOH (dane.gov.pl) ----------

export const dekodujCp1250 = (bufor) => new TextDecoder('windows-1250').decode(bufor)

/** CSV z separatorem „;", cudzysłowami (także zdwojonymi), CRLF i BOM-em. Zwraca obiekty po nagłówku. */
export function csvSredniki(tekst) {
  const wiersze = []
  let wiersz = []
  let pole = ''
  let cytat = false
  for (let i = 0; i < tekst.length; i++) {
    const znak = tekst[i]
    if (cytat) {
      if (znak === '"' && tekst[i + 1] === '"') {
        pole += '"'
        i++
      } else if (znak === '"') cytat = false
      else pole += znak
    } else if (znak === '"') cytat = true
    else if (znak === ';') {
      wiersz.push(pole)
      pole = ''
    } else if (znak === '\n') {
      wiersz.push(pole.replace(/\r$/, ''))
      if (wiersz.some(Boolean)) wiersze.push(wiersz)
      wiersz = []
      pole = ''
    } else pole += znak
  }
  if (cytat) throw new Error('CWOH: niedomknięty cudzysłów w CSV')
  if (pole || wiersz.length) wiersze.push([...wiersz, pole])
  const [naglowek, ...dane] = wiersze
  if (!naglowek) throw new Error('CWOH: pusty CSV')
  if (naglowek[0].charCodeAt(0) === 0xfeff) naglowek[0] = naglowek[0].slice(1) // BOM
  if (dane.some((w) => w.length !== naglowek.length))
    throw new Error('CWOH: niespójna liczba kolumn w CSV (ucięty plik?)')
  return dane.map((w) => Object.fromEntries(naglowek.map((n, i) => [n, w[i]])))
}

const KOLUMNY_CWOH = [
  'ID',
  'Nazwa',
  'Rodzaj',
  'Województwo',
  'Powiat',
  'Gmina',
  'Miasto',
  'Ulica',
  'Numer',
  'Lokalizacja na mapie',
  'Liczba miejsc noclegowych',
]

/** Współrzędne CWOH w formacie „szerokość, długość"; poza Polską traktujemy jak brak. */
export function wspolrzedneCwoh(tekst) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(tekst ?? ''))
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  return lat > 48.5 && lat < 55.5 && lon > 13.5 && lon < 24.5 ? { lat, lon } : null
}

/** Wiersze CWOH jako płaskie obiekty z TERYT (6 cyfr) wyjętym z identyfikatora. */
export function wierszeCwoh(tekst) {
  const surowe = csvSredniki(tekst)
  if (!surowe.length || KOLUMNY_CWOH.some((k) => !(k in surowe[0])))
    throw new Error('CWOH: nieoczekiwany schemat CSV')
  return surowe.map((w) => {
    const miejsca = Number.parseInt(w['Liczba miejsc noclegowych'], 10)
    return {
      zrodlo: 'CWOH',
      id: w.ID.trim(),
      teryt6: /^CWOH\/(\d{6})\d?\//.exec(w.ID.trim())?.[1] ?? null,
      nazwa: w.Nazwa.trim(),
      rodzaj: w.Rodzaj.trim(),
      wojewodztwo: w['Województwo'].trim(),
      gmina: w.Gmina.trim(),
      miasto: w.Miasto.trim(),
      ulica: w.Ulica.trim(),
      numer: w.Numer.trim(),
      xy: wspolrzedneCwoh(w['Lokalizacja na mapie']),
      miejsca: Number.isInteger(miejsca) && miejsca > 0 ? miejsca : null,
    }
  })
}

/** Adresy podzielone na gminy obwarzanka (bez Krakowa) i indeks numer → adresy. */
export function indeksAdresow(adresy) {
  const gminy = new Map() // znormalizowana nazwa → teryt
  const poNumerze = new Map()
  for (const a of adresy) {
    if (a.teryt === TERYT_KRAKOW) continue
    gminy.set(norm(a.gmina), a.teryt)
    const klucz = `${a.teryt}|${nrNorm(a.nr)}`
    if (!poNumerze.has(klucz)) poNumerze.set(klucz, [])
    poNumerze.get(klucz).push(a)
  }
  return { gminy, poNumerze }
}

/**
 * Wiersze CWOH z gmin obwarzanka. Nazwa gminy musi się zgadzać z adresami, a 6 pierwszych cyfr
 * TERYT z identyfikatora z kodem gminy – inaczej to homonim z innego województwa.
 */
export function wierszeGmin(wiersze, indeks) {
  const wybrane = []
  const bilans = { poza: 0, homonim: 0 }
  for (const w of wiersze) {
    const teryt = indeks.gminy.get(norm(w.gmina))
    if (!teryt) {
      bilans.poza++
      continue
    }
    if (w.teryt6 !== teryt.slice(0, 6)) {
      bilans.homonim++
      continue
    }
    wybrane.push({ ...w, teryt })
  }
  return { wiersze: wybrane, bilans }
}

/**
 * Lokalizacja obiektu CWOH. Najpierw punkt adresowy z adresy.json (gmina + numer + ulica
 * w miejscowości; wsie bez ulic: nazwa wsi w polu ulicy), z rozstrzyganiem kilku kandydatów
 * najbliższym współrzędnym z pliku. Gdy adresu nie ma albo leży dalej niż MAKS_ROZBIEZNOSC_M od
 * współrzędnych z pliku – współrzędne z pliku. Bez współrzędnych i bez jednoznacznego adresu: null.
 */
export function geokoduj(w, indeks) {
  const kandydaci = indeks.poNumerze.get(`${w.teryt}|${nrNorm(w.numer)}`) ?? []
  const czlony = czlonyUlicy(w.ulica)
  const miasto = norm(w.miasto)
  // Wieś bez ulic: CWOH wpisuje jej nazwę w pole ulicy (albo zostawia je puste i podaje w „Miasto").
  const wies = czlonyUlicy(w.ulica).join(' ') || miasto
  const zUlica = (a) => a.ulica && ulicaZgodna(czlony, czlonyUlicy(a.ulica))
  const zWsia = (a) => !a.ulica && norm(a.miejscowosc) === wies
  let pasujace = kandydaci.filter((a) => zWsia(a) || (zUlica(a) && norm(a.miejscowosc) === miasto))
  const odPliku = (a) => (w.xy ? metry(a.lat, a.lon, w.xy.lat, w.xy.lon) : null)
  // Gdy nazwa miejscowości w CWOH jest inna niż w adresach: ulica i numer wystarczą,
  // ale tylko dla adresu tuż przy współrzędnych z pliku.
  if (!pasujace.length && w.xy)
    pasujace = kandydaci.filter((a) => zUlica(a) && odPliku(a) <= PROMIEN)

  let adres = null
  if (pasujace.length && w.xy) {
    adres = pasujace.reduce((najlepszy, a) => (odPliku(a) < odPliku(najlepszy) ? a : najlepszy))
    if (odPliku(adres) > MAKS_ROZBIEZNOSC_M) adres = null
  } else if (pasujace.length) {
    const [pierwszy] = pasujace
    const jednoznaczne = pasujace.every(
      (a) => metry(a.lat, a.lon, pierwszy.lat, pierwszy.lon) <= 30,
    )
    if (jednoznaczne) adres = pierwszy
  }
  if (adres)
    return {
      lon: adres.lon,
      lat: adres.lat,
      metoda: 'adres',
      kandydatow: pasujace.length,
      odPlikuM: odPliku(adres),
    }
  if (w.xy)
    return {
      lon: w.xy.lon,
      lat: w.xy.lat,
      metoda: 'plik',
      kandydatow: pasujace.length,
      odPlikuM: null,
    }
  return null
}

// ---------- pobieranie ----------

const dataPliku = (sciezka) => statSync(sciezka).mtime.toISOString().slice(0, 10)

async function pobierzJson(url, plik) {
  const sciezka = await pobierzDoCache(url, join('noclegi', plik))
  const dane = JSON.parse(readFileSync(sciezka, 'utf8'))
  if (dane.error) throw new Error(`${url}: ${JSON.stringify(dane.error)} (usuń ${sciezka})`)
  return { dane, sciezka }
}

/**
 * Cała warstwa ArcGIS REST jako GeoJSON w WGS84, z kontrolą liczby obiektów. KON stronicujemy
 * (resultOffset); KOH to starsza usługa bez stronicowania, ale jej 204 obiekty mieszczą się
 * w jednej odpowiedzi (limit STRONA), co sprawdzamy.
 */
async function pobierzWarstwe(url, polePorzadku, prefiks, stronicowanie = true) {
  const licznik = await pobierzJson(
    `${url}/query?where=1%3D1&returnCountOnly=true&f=json`,
    `${prefiks}_liczba.json`,
  )
  const liczba = licznik.dane.count
  if (!Number.isInteger(liczba) || liczba < 1) throw new Error(`${prefiks}: pusta warstwa`)
  if (!stronicowanie && liczba > STRONA)
    throw new Error(`${prefiks}: ${liczba} obiektów nie mieści się w jednej odpowiedzi (${STRONA})`)
  const features = []
  for (let od = 0; od < liczba; od += STRONA) {
    const strona = stronicowanie ? `&resultOffset=${od}&resultRecordCount=${STRONA}` : ''
    const adres = `${url}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&orderByFields=${polePorzadku}${strona}&f=geojson`
    const { dane } = await pobierzJson(adres, `${prefiks}_${od}.geojson`)
    if (dane.type !== 'FeatureCollection' || !Array.isArray(dane.features))
      throw new Error(`${prefiks}: strona ${od} nie jest GeoJSON-em`)
    features.push(...dane.features)
  }
  if (features.length !== liczba)
    throw new Error(`${prefiks}: ${features.length} obiektów, usługa zgłasza ${liczba}`)
  if (new Set(features.map((f) => f.id)).size !== liczba)
    throw new Error(`${prefiks}: powtórzone obiekty między stronami`)
  return { features, pobrano: dataPliku(licznik.sciezka) }
}

// ---------- uruchomienie ----------

const znajdz = (adresy, miejscowosc, ulica, nr) =>
  adresy.find((a) => a.miejscowosc === miejscowosc && a.ulica === ulica && a.nr === nr)

async function main() {
  const start = performance.now()
  mkdirSync(join(CACHE, 'noclegi'), { recursive: true })
  const { adresy } = wczytajAdresy()
  const indeks = indeksAdresow(adresy)

  const [kon, koh] = await Promise.all([
    pobierzWarstwe(URL_KON, 'objectid', 'kon'),
    pobierzWarstwe(URL_KOH, 'FID', 'koh', false),
  ])
  const sciezkaCwoh = await pobierzDoCache(URL_CWOH, join('noclegi', 'cwoh-2021-09-02.csv'))
  const pobranoCwoh = dataPliku(sciezkaCwoh)

  // --- KON ---
  const konSurowe = obiektyKon(kon.features)
  const konBezPowtorzen = bezPowtorzonychLokali(konSurowe.obiekty)
  const dataKon = dataIso(
    Math.max(...kon.features.map((f) => Number(f.properties?.aktualnosc) || 0)),
  )
  // --- KOH ---
  const kohObiekty = obiektyKoh(koh.features)
  const dataKoh = dataIso(Math.max(...koh.features.map((f) => Number(f.properties?.IMPORT_D) || 0)))
  const wspolne = wspolneAdresyKonKoh(konBezPowtorzen.obiekty, kohObiekty.obiekty)
  // --- CWOH ---
  const cwohWiersze = wierszeCwoh(dekodujCp1250(readFileSync(sciezkaCwoh)))
  if (cwohWiersze.length < 3000)
    throw new Error(
      `CWOH: tylko ${cwohWiersze.length} wierszy – plik ucięty? (usuń ${sciezkaCwoh})`,
    )
  const gminy = wierszeGmin(cwohWiersze, indeks)
  const cwohObiekty = []
  const cwohBilans = { adres: 0, plik: 0, bezLokalizacji: 0, bezMiejsc: 0, rozbiezne: [] }
  for (const w of gminy.wiersze) {
    if (!w.miejsca) {
      cwohBilans.bezMiejsc++
      continue
    }
    const g = geokoduj(w, indeks)
    if (!g) {
      cwohBilans.bezLokalizacji++
      continue
    }
    cwohBilans[g.metoda]++
    if (g.metoda === 'adres' && g.odPlikuM !== null && g.odPlikuM > PROMIEN)
      cwohBilans.rozbiezne.push(`${w.nazwa} (${Math.round(g.odPlikuM)} m)`)
    cwohObiekty.push({ ...w, lon: g.lon, lat: g.lat, metoda: g.metoda })
  }

  console.log(
    `KON: ${konSurowe.bilans.wpisow} wpisów, bez geometrii ${konSurowe.bilans.bezGeometrii}, bez liczby miejsc ${konSurowe.bilans.bezMiejsc}; powtórzone lokale: -${konBezPowtorzen.usunieto} wpisów (-${konBezPowtorzen.usunietoMiejsc} miejsc); do sumy ${konBezPowtorzen.obiekty.length} obiektów, ${konBezPowtorzen.obiekty.reduce((s, o) => s + o.miejsca, 0)} miejsc, stan ${dataKon}`,
  )
  console.log(
    `KOH: ${kohObiekty.bilans.wpisow} wpisów, do sumy ${kohObiekty.obiekty.length} obiektów, ${kohObiekty.obiekty.reduce((s, o) => s + o.miejsca, 0)} miejsc, stan ${dataKoh}; adres wspólny z wpisem KON: ${wspolne.length} obiektów KOH (${wspolne.reduce((s, o) => s + o.miejsca, 0)} miejsc), nie scalamy`,
  )
  console.log(
    `CWOH: ${cwohWiersze.length} wierszy w kraju, w gminach obwarzanka ${gminy.wiersze.length} (w innych gminach, także w Krakowie: ${gminy.bilans.poza}, homonimy z innych województw ${gminy.bilans.homonim}); lokalizacja z adresy.json ${cwohBilans.adres}, ze współrzędnych pliku ${cwohBilans.plik}, bez lokalizacji ${cwohBilans.bezLokalizacji}, bez liczby miejsc ${cwohBilans.bezMiejsc}; do sumy ${cwohObiekty.length} obiektów, ${cwohObiekty.reduce((s, o) => s + o.miejsca, 0)} miejsc`,
  )
  if (cwohBilans.rozbiezne.length)
    console.log(
      `CWOH: adres dalej niż ${PROMIEN} m od współrzędnych pliku: ${cwohBilans.rozbiezne.join('; ')}`,
    )

  const obiekty = [...konBezPowtorzen.obiekty, ...kohObiekty.obiekty, ...cwohObiekty]
  const wartosci = sumaMiejsc(adresy, obiekty)

  // --- kontrola: zasięg, rozkład, niezależne przeliczenie na próbie, znane miejsca ---
  const strefa = (czyKrakow) => {
    const w = adresy.flatMap((a, i) =>
      (a.teryt === TERYT_KRAKOW) === czyKrakow ? [wartosci[i]] : [],
    )
    const z = w.filter((v) => v > 0)
    return `${w.length} adresów, z obiektem w ${PROMIEN} m: ${z.length} (${((100 * z.length) / w.length).toFixed(1)}%), mediana wśród niezerowych ${z.sort((a, b) => a - b)[Math.floor(z.length / 2)] ?? 0}, maks. ${z.at(-1) ?? 0}`
  }
  console.log(`Kraków – ${strefa(true)}`)
  console.log(`Obwarzanek – ${strefa(false)}`)
  const posortowane = wartosci.filter((v) => v > 0).sort((a, b) => a - b)
  const percentyl = (p) =>
    posortowane[Math.min(posortowane.length - 1, Math.floor(p * posortowane.length))]
  console.log(
    `Rozkład niezerowych: p50 ${percentyl(0.5)}, p90 ${percentyl(0.9)}, p99 ${percentyl(0.99)}, maks. ${posortowane.at(-1)}`,
  )

  const kontrola = kontrolaNiezalezna(adresy, obiekty, wartosci)
  console.log(
    `Kontrola niezależna (${kontrola.sprawdzone} adresów, pełny przegląd, odległość z elipsoidy): niezgodnych ${kontrola.niezgodne}`,
  )
  if (kontrola.niezgodne)
    throw new Error(`Suma w promieniu niezgodna z przeliczeniem kontrolnym: ${kontrola.niezgodne}`)

  const znane = [
    ['Kraków', 'Rynek Główny', '1'],
    ['Kraków', 'Józefa', '30'],
    ['Kraków', 'Bosacka', '7'],
    ['Wieliczka', 'Park Kingi', '7'],
    ['Niepołomice', 'Zamkowa', '2'],
    ['Balice', 'kpt. Mieczysława Medweckiego', '3'],
  ]
  for (const [m, u, nr] of znane) {
    const a = znajdz(adresy, m, u, nr)
    if (!a) {
      console.log(`  ${m}, ${u} ${nr}: brak w adresy.json`)
      continue
    }
    const bliskie = obiekty
      .map((o) => ({ o, d: metry(a.lat, a.lon, o.lat, o.lon) }))
      .filter((x) => x.d <= PROMIEN)
    const wgZrodla = Object.groupBy(bliskie, (x) => x.o.zrodlo)
    const opis = Object.entries(wgZrodla)
      .map(([z, l]) => `${z} ${l.length} obiektów/${l.reduce((s, x) => s + x.o.miejsca, 0)} miejsc`)
      .join(', ')
    console.log(`  ${m}, ${u} ${nr}: ${wartosci[a.i]} miejsc (${opis || 'brak obiektów'})`)
  }

  // --- zapis ---
  const zakresGorny = Math.ceil(percentyl(0.99) / 100) * 100
  const licencjaMsip = `Regulamin MSIP: ${REGULAMIN_MSIP}; atrybucja: Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl), data pozyskania ${kon.pobrano}`
  zapiszWskaznik(
    {
      id: 'noclegi_lozka_300m',
      kategoria: 'spokoj',
      nazwa: 'Miejsca noclegowe w 300 m',
      opis: `Suma miejsc noclegowych w obiektach z rejestrów publicznych do 300 m od adresu, w linii prostej. Kraków: ewidencja KON (apartamenty, pokoje gościnne, hostele, aparthotele; stan ${dataKon}) i hotele skategoryzowane KOH (stan ${dataKoh}). Gminy obwarzanka: wyłącznie obiekty skategoryzowane z CWOH według stanu na ${DATA_CWOH}, więc wartość jest tam niepełna i nieporównywalna z krakowską. Zero oznacza brak obiektu z tych rejestrów w promieniu 300 m. Nie obejmuje najmu krótkoterminowego niezgłoszonego do ewidencji. Dużo miejsc to ruch turystyczny: dla jednych usługi i życie ulicy, dla innych hałas, więc kierunku nie oceniamy.`,
      jednostka: 'miejsc',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      rozmiar: 'promień 300 m',
      zakres: [0, zakresGorny],
      zadanie: 121,
      zrodla: [
        {
          nazwa:
            'MSIP Kraków – Krakowskie Obiekty Noclegowe (KON), obiekty niebędące obiektami hotelarskimi',
          url: URL_KON,
          licencja: licencjaMsip,
          dataDanych: dataKon,
          pobrano: kon.pobrano,
        },
        {
          nazwa: 'MSIP Kraków – Krakowskie Obiekty Hotelarskie (KOH), wyciąg z CWOH dla Krakowa',
          url: URL_KOH_ZBIOR,
          licencja: `Regulamin MSIP: ${REGULAMIN_MSIP}; atrybucja: Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl), data pozyskania ${koh.pobrano}`,
          dataDanych: dataKoh,
          pobrano: koh.pobrano,
        },
        {
          nazwa:
            'Ministerstwo Sportu i Turystyki – Centralny Wykaz Obiektów Hotelarskich (dane.gov.pl, zbiór 1083)',
          url: URL_CWOH_ZBIOR,
          licencja: 'CC0 1.0 – https://creativecommons.org/publicdomain/zero/1.0/',
          dataDanych: DATA_CWOH,
          pobrano: pobranoCwoh,
        },
      ],
    },
    wartosci,
  )
  console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
