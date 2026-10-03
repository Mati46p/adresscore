// Okolice (#75): okolica adresu = jednostka SIM (System Informacji Miejskiej) Krakowa z MSIP,
// poza Krakowem miejscowość w gminie. Dla ekranów Okolica i Porównanie oraz rankingu okolic.
//
// Wyniki (public/dane/):
//  - okolice.json            id okolicy każdego adresu (ta sama kolejność co adresy.json), słownik okolic,
//                            słownik potocznych nazw osiedli z OSM i jawna lista rozjazdów
//                            „jednostka SIM ↔ nazwa potoczna”,
//  - okolice-granice.geojson granice 123 jednostek SIM (WGS84) dla mapy i rankingu.
// Migawka OSM, z której liczymy słownik: etl/okolice-osm.json. Metoda, kontrola jakości i format
// pliku: etl/okolice.md.
//
// Decyzje (dlaczego):
//  - Okolica to jednostka SIM, a nie dzielnica (18, za grube) ani osiedle z OSM (nie pokrywa miasta).
//    Jednostki SIM (123) to podstawowy podział Krakowa przygotowany przez ZTP: sumuje się do granic
//    dzielnic, a nazwy wybrano m.in. na podstawie badania mieszkańców. Podział nie ma dziur ani
//    nakładek – sprawdzamy to na wszystkich adresach Krakowa (każdy w dokładnie jednej jednostce).
//  - Granice pobieramy z MSIP JEDNORAZOWO (warstwa Obserwatorium/ZTP_SIM, kontrolnie kopia
//    ZSOZ/Rc_Sim) i zapisujemy jako plik statyczny w repo. Regulamin MSIP zabrania ciągłego
//    pośredniczenia w usługach miasta, a plik w repo pozwala przeliczyć okolice offline, gdy zmieni
//    się lista adresów (`wersjaAdresow` musi równać się `wersja` z adresy.json).
//  - Nazwy potoczne trzymamy jako słownik na poziomie jednostki, NIE jako nazwę przypisaną adresowi.
//    OSM ma obrysy tylko ok. 30 osiedli (1,7% adresów Krakowa), a reszta to punkty „w środku
//    osiedla”: mediana odległości adresu do najbliższego takiego punktu w tej samej jednostce to
//    ponad 400 m. Nazwa osiedla wybrana „po najbliższym punkcie” byłaby zgadywaniem, którego karta
//    nie umiałaby uzasadnić. Adres dostaje więc okolicę z SIM, a słownik mówi, jakie nazwy potoczne
//    leżą w tej okolicy i gdzie obie warstwy się rozjeżdżają.
//  - Brak danych = null: adres bez jednostki (poza Krakowem) i bez miejscowości nie dostaje okolicy.
//    Poza Krakowem nie ma jednostek SIM; okolicą jest miejscowość w gminie (inny rząd wielkości niż
//    jednostka SIM – opisane jako rozjazd).
//
// Uruchom:
//  node etl/okolice.mjs            – przelicza okolice.json z plików w repo (bez sieci),
//  node etl/okolice.mjs --pobierz  – najpierw jednorazowo pobiera granice SIM z MSIP i miejsca z OSM
//                                    (Overpass); surowe odpowiedzi trafiają do etl/.cache/okolice/,
//                                    więc drugi bieg ich nie pobiera (usuń katalog, by odświeżyć).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import proj4 from 'proj4'
import {
  do2180,
  odlegloscDoWielokata,
  pierscien,
  punktWPierscieniu,
  punktWWielokacie,
  wielokat,
  wielokatyZGeojson,
} from './lib/geo.mjs'
import { LICENCJA_MSIP, pobierzWarstwe } from './lib/msip.mjs'
import { bezOgonkow } from './lib/nazwy.mjs'
import { dataPobrania } from './lib/pobieranie.mjs'
import { CACHE, DANE, KORZEN, wczytajAdresy } from './lib/wspolne.mjs'

export const WARSTWA_SIM = 'Obserwatorium/ZTP_SIM/MapServer/0'
export const WARSTWA_KONTROLNA = 'ZSOZ/Rc_Sim/MapServer/0'
/** Liczba jednostek SIM w podziale z lipca 2026; inna liczba to zmiana podziału, nie błąd skryptu. */
export const LICZBA_JEDNOSTEK = 123
export const PLIK_GRANIC = join(DANE, 'okolice-granice.geojson')
export const PLIK_OSM = join(KORZEN, 'etl', 'okolice-osm.json')
export const PLIK_WYNIKU = join(DANE, 'okolice.json')

const KATALOG_SIM =
  'https://otwartedane.um.krakow.pl/zbiory-danych/system-informacji-miejskiej-w-krakowie-sim'
const WARUNKI_ZTP =
  'Ponowne wykorzystanie informacji sektora publicznego (źródło: Gmina Miejska Kraków, otwartedane.um.krakow.pl): https://otwartedane.um.krakow.pl/warunki-wykorzystania-danych-udostepnianych-w-portalu; granice pobrane z MSIP jednorazowo, bez ciągłego pośredniczenia (regulamin MSIP: https://msip.krakow.pl/getHtml?dok_id=228972)'
const LICENCJA_OSM = 'ODbL 1.0, © współtwórcy OpenStreetMap'
const UA = 'adresscore-etl/1.0 (HackYeah 2026; https://github.com/Mati46p/adresscore)'
/** Prostokąt wokół Krakowa (S, W, N, E) – z zapasem; jednostki SIM odsiewają to, co leży poza miastem. */
const BBOX_OSM = '49.95,19.78,50.14,20.23'
const MIEJSCA_OSM = new Set(['neighbourhood', 'quarter'])
export const ZAPYTANIE_OSM = `[out:json][timeout:120];
(
  node["place"~"^(neighbourhood|quarter)$"]["name"](${BBOX_OSM});
  way["place"~"^(neighbourhood|quarter)$"]["name"](${BBOX_OSM});
  relation["place"~"^(neighbourhood|quarter)$"]["name"](${BBOX_OSM});
);
out geom;`
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
/** Obrys OSM liczy się jako „rozcięty”, gdy drugą jednostkę zajmuje co najmniej tyle jego powierzchni. */
const PROG_UDZIALU_OBRYSU = 0.1
/** Adres do 30 m od granicy jednostki (błąd położenia punktu adresowego) dostaje najbliższą, nie null. */
const MAKS_ODLEGLOSC_DO_JEDNOSTKI_M = 30

// Układ EPSG:2178 rejestruje lib/msip.mjs przy imporcie.
const NA_WGS84 = proj4('EPSG:2178', 'EPSG:4326')

// ── Teksty ──────────────────────────────────────────────────────────────────────────────────

/** Białe znaki sklejone do jednej spacji, bez brzegów (MSIP zwraca np. „XVII.6\n” w numerze). */
export const czyscTekst = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()

export const slug = (s) =>
  bezOgonkow(czyscTekst(s))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Dzielnica „VIII Dębniki” → „Dębniki” (numer rzymski to część nazwy urzędowej, nie potocznej). */
export const bezNumeru = (dzielnica) => dzielnica.replace(/^[IVXL]+\s+/, '')

/** Słowa nazwy bez ogonków i znaków specjalnych: „Osiedle „Kurdwanów Nowy”” → [osiedle, kurdwanow, nowy]. */
export const slowa = (s) =>
  bezOgonkow(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** Czy `fraza` (lista słów) występuje w `tekst` (lista słów) jako ciągły fragment. */
export function zawieraFraze(tekst, fraza) {
  if (!fraza.length) return false
  for (let i = 0; i + fraza.length <= tekst.length; i++)
    if (fraza.every((s, k) => tekst[i + k] === s)) return true
  return false
}

const RZYMSKIE = { I: 1, V: 5, X: 10, L: 50 }
export function liczbaRzymska(tekst) {
  let suma = 0
  for (let i = 0; i < tekst.length; i++) {
    const a = RZYMSKIE[tekst[i]]
    if (!a) throw new Error(`Liczba rzymska „${tekst}”`)
    const b = RZYMSKIE[tekst[i + 1]]
    suma += b && a < b ? -a : a
  }
  return suma
}

/** Numer jednostki „VIII.3” → 803 (numer dzielnicy × 100 + numer w dzielnicy; tak samo jest w `id_sim`). */
export function idSimZNumeru(numer) {
  const m = /^([IVXL]+)\.(\d{1,2})$/.exec(numer)
  if (!m) throw new Error(`Numer jednostki SIM „${numer}” nie ma postaci „VIII.3”`)
  return liczbaRzymska(m[1]) * 100 + Number(m[2])
}
export const idOkolicySim = (numer) => `sim-${idSimZNumeru(numer)}`
const numerZId = (id) => Number(id.slice(4))
const porownajId = (a, b) => numerZId(a) - numerZId(b)
const sortujPl = (lista) => [...lista].sort((a, b) => a.localeCompare(b, 'pl'))

// ── Granice jednostek SIM: MSIP (esri, EPSG:2178) → GeoJSON (WGS84) ─────────────────────────

/** Pole pierścienia ze znakiem (wzór Gaussa, od pierwszego wierzchołka): dodatnie = przeciwnie do ruchu wskazówek zegara. */
function poleZeZnakiem(p) {
  const [x0, y0] = p[0]
  let s = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    s += (p[j][0] - x0) * (p[i][1] - y0) - (p[i][0] - x0) * (p[j][1] - y0)
  return s / 2
}

const plaski = (p) => Float64Array.from(p.flat())

function pierscienWgs84(p) {
  const wynik = []
  for (const [x, y] of p) {
    const [lon, lat] = NA_WGS84.forward([x, y]).map((v) => Math.round(v * 1e6) / 1e6)
    const ostatni = wynik.at(-1)
    if (!ostatni || ostatni[0] !== lon || ostatni[1] !== lat) wynik.push([lon, lat])
  }
  const pierwszy = wynik[0]
  const ostatni = wynik.at(-1)
  if (pierwszy && (pierwszy[0] !== ostatni[0] || pierwszy[1] !== ostatni[1])) wynik.push(pierwszy)
  if (wynik.length < 4) throw new Error(`Pierścień po przeliczeniu ma ${wynik.length} punktów`)
  return wynik
}

/**
 * Pierścienie esri (EPSG:2178; zewnętrzne zgodnie z ruchem wskazówek zegara, otwory przeciwnie) →
 * geometria GeoJSON w WGS84 (6 miejsc, ok. 0,1 m): zewnętrzne przeciwnie do ruchu wskazówek zegara,
 * otwory zgodnie (RFC 7946). Kilka pierścieni zewnętrznych daje MultiPolygon.
 */
export function geometriaGeojson(pierscienie) {
  const zewnetrzne = []
  const otwory = []
  for (const r of pierscienie) {
    const pole = poleZeZnakiem(r)
    if (pole < 0) zewnetrzne.push(r)
    else if (pole > 0) otwory.push(r)
  }
  if (!zewnetrzne.length) throw new Error('Geometria bez pierścienia zewnętrznego')
  const wielokaty = zewnetrzne.map((z) => ({ zewnetrzny: z, otwory: [] }))
  for (const o of otwory) {
    const [x, y] = o[0]
    const wlasciciel = wielokaty.find((w) => punktWPierscieniu(x, y, plaski(w.zewnetrzny)))
    if (!wlasciciel) throw new Error('Otwór poza każdym pierścieniem zewnętrznym')
    wlasciciel.otwory.push(o)
  }
  const wspolrzedne = wielokaty.map((w) => [
    pierscienWgs84([...w.zewnetrzny].reverse()),
    ...w.otwory.map((o) => pierscienWgs84([...o].reverse())),
  ])
  return wspolrzedne.length === 1
    ? { type: 'Polygon', coordinates: wspolrzedne[0] }
    : { type: 'MultiPolygon', coordinates: wspolrzedne }
}

const dataImportu = (tekst) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(tekst)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/**
 * Składa granice jednostek SIM z warstwy ZTP (numery, nazwy, dzielnice, geometria) i kontrolnej
 * kopii z ZSOZ (`id_sim`). Zatrzymuje się, gdy dwie kopie się rozjeżdżają, gdy numery się powtarzają albo gdy
 * liczba jednostek nie jest oczekiwana – lepiej teraz niż po cichu w danych.
 *
 * @param {object[]} ztp obiekty esri warstwy Obserwatorium/ZTP_SIM/0
 * @param {object[]} kontrolna obiekty esri warstwy ZSOZ/Rc_Sim/0
 */
export function zlozGranice(ztp, kontrolna, oczekiwana = LICZBA_JEDNOSTEK) {
  const bledy = []
  const kontrolnePoNumerze = new Map()
  for (const o of kontrolna) {
    const numer = czyscTekst(o.attributes.nr_jed_sim)
    if (kontrolnePoNumerze.has(numer)) bledy.push(`kontrolna: numer ${numer} występuje dwa razy`)
    kontrolnePoNumerze.set(numer, o)
  }
  const widziane = new Set()
  const features = []
  let maxRoznicaPolaProc = 0
  let sumaKm2 = 0
  const daty = new Set()
  for (const o of ztp) {
    const a = o.attributes
    const numer = czyscTekst(a.nr_jed_sim)
    const nazwa = czyscTekst(a.nazwa_sim)
    const dzielnica = czyscTekst(a.dziel).replace(/^Dzielnica\s+/i, '')
    if (widziane.has(numer)) bledy.push(`numer ${numer} występuje dwa razy`)
    widziane.add(numer)
    let id
    try {
      id = idOkolicySim(numer)
    } catch (e) {
      bledy.push(e.message)
      continue
    }
    const k = kontrolnePoNumerze.get(numer)
    if (!k) bledy.push(`${numer} ${nazwa}: brak w warstwie kontrolnej`)
    else {
      const ka = k.attributes
      if (czyscTekst(ka.nazwa_sim) !== nazwa)
        bledy.push(`${numer}: nazwa „${nazwa}” ≠ kontrolna „${czyscTekst(ka.nazwa_sim)}”`)
      if (`sim-${ka.id_sim}` !== id) bledy.push(`${numer}: id_sim ${ka.id_sim} ≠ ${id}`)
      if (czyscTekst(ka.nazwa_dziel).replace(/^Dzielnica\s+/i, '') !== dzielnica)
        bledy.push(`${numer}: dzielnica „${dzielnica}” ≠ kontrolna „${ka.nazwa_dziel}”`)
      const polaKontrolne = ka['st_area(shape)']
      const polaGeometrii = Math.abs(o.geometry.rings.reduce((s, r) => s + poleZeZnakiem(r), 0))
      const roznica = (100 * Math.abs(polaGeometrii - polaKontrolne)) / polaKontrolne
      maxRoznicaPolaProc = Math.max(maxRoznicaPolaProc, roznica)
      if (roznica > 0.5)
        bledy.push(`${numer}: pole geometrii różni się od kontrolnego o ${roznica.toFixed(2)}%`)
    }
    const poleKm2 = Math.abs(o.geometry.rings.reduce((s, r) => s + poleZeZnakiem(r), 0)) / 1e6
    if (Math.abs(poleKm2 - a.pow) > 0.01 * a.pow + 0.002)
      bledy.push(`${numer}: pole z geometrii ${poleKm2.toFixed(3)} km² ≠ pow ${a.pow}`)
    sumaKm2 += a.pow
    const dzien = dataImportu(czyscTekst(a.data_importu))
    if (dzien) daty.add(dzien)
    features.push({
      type: 'Feature',
      properties: { id, numer, nazwa, dzielnica, powierzchniaKm2: a.pow },
      geometry: geometriaGeojson(o.geometry.rings),
    })
  }
  for (const numer of kontrolnePoNumerze.keys())
    if (!widziane.has(numer)) bledy.push(`${numer}: jest w kontrolnej, brak w warstwie ZTP`)
  if (ztp.length !== oczekiwana)
    bledy.push(`jednostek ${ztp.length}, oczekiwano ${oczekiwana} – czy zmienił się podział SIM?`)
  const nazwy = new Map()
  for (const f of features) {
    const kl = slowa(f.properties.nazwa).join(' ')
    if (nazwy.has(kl)) bledy.push(`nazwa „${f.properties.nazwa}” powtarza się: ${nazwy.get(kl)}`)
    nazwy.set(kl, f.properties.numer)
  }
  if (bledy.length) throw new Error(`Granice SIM: ${bledy.slice(0, 12).join('; ')}`)
  features.sort((a, b) => porownajId(a.properties.id, b.properties.id))
  return {
    features,
    kontrola: {
      jednostek: features.length,
      sumaPowierzchniKm2: Math.round(sumaKm2 * 1000) / 1000,
      dataImportuWarstwy: [...daty].sort().at(-1) ?? null,
      zgodnoscZKopiaKontrolna: {
        warstwa: WARSTWA_KONTROLNA,
        zgodnychJednostek: features.length,
        najwiekszaRoznicaPolaProc: Math.round(maxRoznicaPolaProc * 1000) / 1000,
      },
    },
  }
}

/** Jednostki SIM z GeoJSON granic → [{ id, numer, nazwa, dzielnica, powierzchniaKm2, wielokaty }]. */
export function jednostkiSim(geojson) {
  return (geojson.features ?? []).map((f) => {
    const p = f.properties ?? {}
    for (const k of ['id', 'numer', 'nazwa', 'dzielnica'])
      if (!p[k]) throw new Error(`Jednostka SIM bez pola „${k}”: ${JSON.stringify(p)}`)
    return {
      id: p.id,
      numer: p.numer,
      nazwa: p.nazwa,
      dzielnica: p.dzielnica,
      powierzchniaKm2: p.powierzchniaKm2 ?? null,
      wielokaty: wielokatyZGeojson(f.geometry),
    }
  })
}

/** Wszystkie jednostki zawierające punkt (x, y w EPSG:2180). Podział poprawny daje 0 albo 1. */
export function jednostkiPunktu(jednostki, x, y) {
  const wynik = []
  for (const j of jednostki)
    for (const w of j.wielokaty)
      if (punktWWielokacie(x, y, w)) {
        wynik.push(j)
        break
      }
  return wynik
}

/** Jednostka SIM zawierająca punkt albo null. */
export function znajdzJednostke(jednostki, lon, lat) {
  const [x, y] = do2180(lon, lat)
  return jednostkiPunktu(jednostki, x, y)[0] ?? null
}

/** Najbliższa jednostka w promieniu `maksM` od punktu (x, y w EPSG:2180) albo null. */
export function najblizszaJednostka(jednostki, x, y, maksM = MAKS_ODLEGLOSC_DO_JEDNOSTKI_M) {
  let najlepsza = null
  let metry = maksM
  for (const j of jednostki)
    for (const w of j.wielokaty) {
      const d = odlegloscDoWielokata(x, y, w)
      if (d <= metry) {
        metry = d
        najlepsza = j
      }
    }
  return najlepsza ? { jednostka: najlepsza, metry } : null
}

// ── Miejsca z OSM: Overpass → migawka ───────────────────────────────────────────────────────

const zaokr6 = (v) => Math.round(v * 1e6) / 1e6
const zamkniety = (p) => p.length >= 4 && p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1]
const punkty = (geometria) => geometria.map((g) => [g.lon, g.lat])

/** Obrys jako tekst „lon lat,lon lat,…” – w migawce JSON bez tablic liczb, żeby Biome go nie przepisywał. */
export const obrysDoTekstu = (p) => p.map(([lon, lat]) => `${zaokr6(lon)} ${zaokr6(lat)}`).join(',')
export const obrysZTekstu = (tekst) =>
  tekst.split(',').map((punkt) => {
    const [lon, lat] = punkt.split(' ').map(Number)
    if (!Number.isFinite(lon) || !Number.isFinite(lat))
      throw new Error(`Obrys: zły punkt „${punkt}”`)
    return [lon, lat]
  })

/** Środek ciężkości pierścienia [lon, lat] (wzór na centroid; przy zerowym polu średnia wierzchołków). */
export function srodekPierscienia(p) {
  // Współrzędne przesunięte do pierwszego wierzchołka: iloczyny rzędu 20 × 50 zjadałyby dokładność.
  const [x0, y0] = p[0]
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xj, yj] = [p[j][0] - x0, p[j][1] - y0]
    const [xi, yi] = [p[i][0] - x0, p[i][1] - y0]
    const k = xj * yi - xi * yj
    a += k
    cx += (xj + xi) * k
    cy += (yj + yi) * k
  }
  if (Math.abs(a) < 1e-14) {
    const n = p.length
    return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n]
  }
  return [x0 + cx / (3 * a), y0 + cy / (3 * a)]
}

/** Zamknięty obrys elementu Overpass (way albo relacja z jednym obrysem zewnętrznym) albo null. */
function obrysOsm(el) {
  if (el.type === 'way') {
    const p = punkty(el.geometry ?? [])
    return zamkniety(p) ? p : null
  }
  if (el.type === 'relation') {
    const zewnetrzne = (el.members ?? []).filter(
      (m) => m.type === 'way' && m.role === 'outer' && m.geometry,
    )
    if (zewnetrzne.length !== 1) return null
    const p = punkty(zewnetrzne[0].geometry)
    return zamkniety(p) ? p : null
  }
  return null
}

/** Wszystkie punkty elementu (do środka, gdy nie ma prostego obrysu). */
function punktyElementu(el) {
  if (el.type === 'way') return punkty(el.geometry ?? [])
  return (el.members ?? []).flatMap((m) => (m.geometry ? punkty(m.geometry) : []))
}

const kolejnoscTypu = { node: 0, way: 1, relation: 2 }
const porownajOsm = (a, b) => {
  const [ta, ia] = a.osm.split('/')
  const [tb, ib] = b.osm.split('/')
  return kolejnoscTypu[ta] - kolejnoscTypu[tb] || Number(ia) - Number(ib)
}

/**
 * Odpowiedź Overpass (`out geom`) → miejsca [{ osm, nazwa, place, lon, lat, obrys? }]. Bierzemy tylko
 * place=neighbourhood i place=quarter z nazwą: suburb to dzielnice (znamy je z adresów), a locality
 * to nazwy terenowe, nie osiedla.
 */
export function miejscaZOverpass(odpowiedz) {
  const wynik = []
  for (const e of odpowiedz.elements ?? []) {
    const t = e.tags ?? {}
    const nazwa = czyscTekst(t.name)
    if (!nazwa || !MIEJSCA_OSM.has(t.place)) continue
    let lon = e.lon
    let lat = e.lat
    let obrys = null
    if (e.type !== 'node') {
      obrys = obrysOsm(e)
      const p = obrys ?? punktyElementu(e)
      if (!p.length) continue
      const srodek = obrys
        ? srodekPierscienia(obrys)
        : [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]
      lon = srodek[0]
      lat = srodek[1]
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    wynik.push({
      osm: `${e.type}/${e.id}`,
      nazwa,
      place: t.place,
      lon: zaokr6(lon),
      lat: zaokr6(lat),
      ...(obrys ? { obrys: obrysDoTekstu(obrys) } : {}),
    })
  }
  return wynik.sort(porownajOsm)
}

// ── Słownik potocznych nazw i rozjazdy ──────────────────────────────────────────────────────

const procent = (u) => Math.round(u * 100)
const nazwaJednostki = (j) => `„${j.nazwa}” (${j.numer})`
const liczba = new Intl.NumberFormat('pl-PL')

/** Forma rzeczownika po liczbie: 1 jednostkę, 2–4 jednostki (ale nie 12–14), reszta jednostek. */
export function mnoga(n, jedna, kilka, wiele) {
  if (n === 1) return jedna
  const jednosci = n % 10
  const reszta = n % 100
  return jednosci >= 2 && jednosci <= 4 && !(reszta >= 12 && reszta <= 14) ? kilka : wiele
}

/**
 * Udziały powierzchni obrysu w jednostkach SIM: siatka punktów co `krok` m (EPSG:2180) w obrysie,
 * każdy punkt do jednostki, która go zawiera. Klucz null = poza jednostkami (poza Krakowem).
 * Zwraca Map(id | null → udział 0–1). Obrys mniejszy niż oczko siatki liczy się punktem `srodek`.
 */
export function udzialyObrysuWJednostkach(jednostki, obrys, srodek, krok = 10) {
  const [xmin, ymin, xmax, ymax] = obrys.bbox
  const liczniki = new Map()
  let razem = 0
  const dolicz = (x, y) => {
    razem++
    const id = jednostkiPunktu(jednostki, x, y)[0]?.id ?? null
    liczniki.set(id, (liczniki.get(id) ?? 0) + 1)
  }
  for (let x = xmin + krok / 2; x < xmax; x += krok)
    for (let y = ymin + krok / 2; y < ymax; y += krok)
      if (punktWWielokacie(x, y, obrys)) dolicz(x, y)
  if (!razem) dolicz(srodek[0], srodek[1])
  return new Map([...liczniki].map(([id, n]) => [id, n / razem]))
}

/**
 * Słownik potocznych nazw osiedli i części miasta (OSM) względem jednostek SIM.
 *
 * Zwraca:
 *  - `slownik` – wpisy { nazwa, place, jednostki, osm }; `jednostki[0]` to jednostka, w której leży
 *    punkt (albo większość obrysu) OSM, kolejne to jednostki, których nazwa zawiera tę nazwę
 *    (np. „Bronowice” → Bronowice Małe, Stare Bronowice Małe, Bronowice Wielkie) i jednostki
 *    zajmowane przez obrys; wpis, który tylko powtarza nazwę jednostki, pomijamy,
 *  - `potocznePoJednostce` – Map(id → nazwy OSM leżące w jednostce, bez nazwy samej jednostki),
 *  - `rozjazdy` – jawna lista miejsc, w których jednostka SIM i nazwa potoczna się rozjeżdżają,
 *  - `kontrola` – liczby do raportu jakości.
 *
 * @param {object[]} jednostki wynik `jednostkiSim`
 * @param {object[]} miejsca wynik `miejscaZOverpass` (migawka)
 * @param {{ x: number, y: number, id: string }[]} adresyKrakowa adresy z id jednostki (EPSG:2180)
 */
export function zbudujSlownik(jednostki, miejsca, adresyKrakowa) {
  const poId = new Map(jednostki.map((j) => [j.id, j]))
  const slowaJ = new Map(jednostki.map((j) => [j.id, slowa(j.nazwa)]))
  const kluczJ = new Map(jednostki.map((j) => [j.id, slowa(j.nazwa).join(' ')]))

  // 1. Gdzie leży każde miejsce OSM: punkt → jednostka, obrys → jednostka z największym udziałem.
  const polozone = []
  let pozaKrakowem = 0
  for (const m of miejsca) {
    const [x, y] = do2180(m.lon, m.lat)
    let dom = null
    let udzialy = null
    let adresyWObrysie = null
    if (m.obrys) {
      const obrys = wielokat([
        pierscien(obrysZTekstu(m.obrys).map(([lon, lat]) => do2180(lon, lat))),
      ])
      udzialy = udzialyObrysuWJednostkach(jednostki, obrys, [x, y])
      const wKrakowie = [...udzialy].filter(([id]) => id !== null)
      if (wKrakowie.length) dom = wKrakowie.sort((a, b) => b[1] - a[1])[0][0]
      adresyWObrysie = new Map()
      for (const a of adresyKrakowa)
        if (punktWWielokacie(a.x, a.y, obrys))
          adresyWObrysie.set(a.id, (adresyWObrysie.get(a.id) ?? 0) + 1)
    } else dom = jednostkiPunktu(jednostki, x, y)[0]?.id ?? null
    if (!dom) {
      pozaKrakowem++
      continue
    }
    polozone.push({ ...m, dom, udzialy, adresyWObrysie })
  }

  // 2. Wpisy: ta sama nazwa (po normalizacji) w tej samej jednostce to jeden wpis.
  const wpisy = new Map()
  for (const m of polozone) {
    const kl = `${slowa(m.nazwa).join(' ')}|${m.dom}`
    const w = wpisy.get(kl)
    if (!w) wpisy.set(kl, { ...m, osm: [m.osm], place: m.place })
    else {
      w.osm.push(m.osm)
      if (m.place === 'quarter') w.place = 'quarter'
      w.udzialy ??= m.udzialy
      w.adresyWObrysie ??= m.adresyWObrysie
    }
  }

  // 3. Jednostki, które pasują do każdego wpisu.
  const wszystkie = []
  for (const w of wpisy.values()) {
    const fraza = slowa(w.nazwa)
    const zNazwy = jednostki
      .filter((j) => zawieraFraze(slowaJ.get(j.id), fraza))
      .map((j) => j.id)
      .sort(porownajId)
    const zObrysu = w.udzialy
      ? [...w.udzialy]
          .filter(([id, u]) => id !== null && u >= PROG_UDZIALU_OBRYSU)
          .map(([id]) => id)
          .sort(porownajId)
      : []
    const ids = [...new Set([w.dom, ...zNazwy, ...zObrysu])]
    wszystkie.push({ ...w, fraza, zNazwy, jednostki: ids })
  }

  // 4. Słownik (bez wpisów, które tylko powtarzają nazwę jednostki) i nazwy w jednostkach.
  const slownik = []
  const potocznePoJednostce = new Map(jednostki.map((j) => [j.id, []]))
  for (const w of wszystkie) {
    const powtarzaNazwe = w.jednostki.length === 1 && slowa(w.nazwa).join(' ') === kluczJ.get(w.dom)
    if (slowa(w.nazwa).join(' ') !== kluczJ.get(w.dom)) potocznePoJednostce.get(w.dom).push(w.nazwa)
    if (!powtarzaNazwe)
      slownik.push({ nazwa: w.nazwa, place: w.place, jednostki: w.jednostki, osm: w.osm })
  }
  for (const [id, lista] of potocznePoJednostce)
    potocznePoJednostce.set(id, sortujPl(new Set(lista)))
  slownik.sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl') || a.osm[0].localeCompare(b.osm[0]))

  // 5. Rozjazdy.
  const rozjazdy = []
  const lista = (ids) => ids.map((id) => nazwaJednostki(poId.get(id))).join(', ')

  // 5a. Osiedle z obrysem OSM rozcięte granicą jednostek SIM.
  for (const w of wszystkie.filter((x) => x.udzialy)) {
    const wiele = [...w.udzialy]
      .filter(([id, u]) => id !== null && u >= PROG_UDZIALU_OBRYSU)
      .sort((a, b) => b[1] - a[1])
    if (wiele.length < 2) continue
    const adresy = Object.fromEntries(
      wiele.map(([id]) => [id, w.adresyWObrysie?.get(id) ?? 0]).filter(([, n]) => n > 0),
    )
    const czesci = wiele
      .map(([id, u]) => `${nazwaJednostki(poId.get(id))} – ${procent(u)}% powierzchni`)
      .join(', ')
    rozjazdy.push({
      rodzaj: 'osiedle-w-kilku-jednostkach',
      nazwa: w.nazwa,
      jednostki: wiele.map(([id]) => id),
      udzialyProc: Object.fromEntries(wiele.map(([id, u]) => [id, procent(u)])),
      adresy,
      opis: `Obrys OSM „${w.nazwa}” leży w ${wiele.length} jednostkach SIM: ${czesci}. Adres ma okolicę z jednostki, w której leży, więc osiedle jest rozcięte granicą jednostek.`,
    })
  }

  // 5b. Ta sama nazwa potoczna w kilku jednostkach.
  const poNazwie = new Map()
  for (const w of wszystkie) {
    const kl = w.fraza.join(' ')
    const l = poNazwie.get(kl) ?? []
    l.push(w)
    poNazwie.set(kl, l)
  }
  for (const l of [...poNazwie.values()].sort((a, b) =>
    a[0].nazwa.localeCompare(b[0].nazwa, 'pl'),
  )) {
    const domy = [...new Set(l.map((w) => w.dom))].sort(porownajId)
    if (domy.length < 2) continue
    rozjazdy.push({
      rodzaj: 'nazwa-w-kilku-jednostkach',
      nazwa: l[0].nazwa,
      jednostki: domy,
      opis: `Nazwa „${l[0].nazwa}” występuje w OSM w ${domy.length} jednostkach SIM: ${lista(domy)} – wyszukiwanie po tej nazwie jest niejednoznaczne.`,
    })
  }

  // 5c. Nazwa potoczna a nazwy jednostek: punkt OSM leży poza jednostką o tej samej nazwie albo nazwa
  //     jest częścią nazw kilku jednostek (jedno miejsce w OSM, kilka okolic w podziale SIM).
  for (const w of [...wszystkie].sort((a, b) => a.nazwa.localeCompare(b.nazwa, 'pl'))) {
    const kl = w.fraza.join(' ')
    const dokladne = w.zNazwy.filter((id) => kluczJ.get(id) === kl)
    const dom = nazwaJednostki(poId.get(w.dom))
    if (dokladne.length && !dokladne.includes(w.dom))
      rozjazdy.push({
        rodzaj: 'nazwa-poza-jednostka-o-tej-nazwie',
        nazwa: w.nazwa,
        jednostki: [w.dom, ...dokladne],
        opis: `Punkt OSM „${w.nazwa}” leży w jednostce ${dom}, a jednostka SIM o tej nazwie to ${lista(dokladne)}.`,
      })
    else if (w.zNazwy.length >= 2 || (w.zNazwy.length === 1 && !w.zNazwy.includes(w.dom)))
      rozjazdy.push({
        rodzaj: 'nazwa-szersza-niz-jednostka',
        nazwa: w.nazwa,
        jednostki: [...new Set([w.dom, ...w.zNazwy])],
        opis: `Nazwa „${w.nazwa}” z OSM jest częścią nazw jednostek SIM: ${lista(w.zNazwy)}. Punkt OSM leży w jednostce ${dom} – wyszukiwanie po nazwie „${w.nazwa}” prowadzi do kilku okolic.`,
      })
  }

  // 5d. Jednostki bez żadnego miejsca OSM w środku.
  const zMiejscem = new Set(polozone.map((m) => m.dom))
  const bezMiejsc = jednostki
    .filter((j) => !zMiejscem.has(j.id))
    .sort((a, b) => porownajId(a.id, b.id))
  for (const j of bezMiejsc)
    rozjazdy.push({
      rodzaj: 'jednostka-bez-miejsc-osm',
      jednostki: [j.id],
      opis: `W jednostce SIM ${nazwaJednostki(j)} OSM nie ma żadnego osiedla ani części miasta (place=neighbourhood, place=quarter) – okolica ma tylko nazwę SIM.`,
    })

  // 5e. Nazwa jednostki zgodna z nazwą dzielnicy, a zakres inny.
  const dzielnice = new Map()
  for (const j of jednostki) {
    const d = dzielnice.get(j.dzielnica) ?? { powierzchnia: 0, jednostki: [] }
    d.powierzchnia += j.powierzchniaKm2 ?? 0
    d.jednostki.push(j)
    dzielnice.set(j.dzielnica, d)
  }
  const zakresy = [...dzielnice.keys()].map((nazwa) => ({ nazwa, fraza: slowa(bezNumeru(nazwa)) }))
  for (const j of [...jednostki].sort((a, b) => porownajId(a.id, b.id))) {
    const tokeny = slowaJ.get(j.id)
    for (const z of zakresy) {
      if (!zawieraFraze(tokeny, z.fraza)) continue
      const d = dzielnice.get(z.nazwa)
      if (z.nazwa === j.dzielnica) {
        const udzial =
          j.powierzchniaKm2 && d.powierzchnia ? j.powierzchniaKm2 / d.powierzchnia : null
        rozjazdy.push({
          rodzaj: 'nazwa-jednostki-jak-dzielnica',
          jednostki: [j.id],
          dzielnica: z.nazwa,
          ...(udzial === null ? {} : { udzialPowierzchniDzielnicyProc: procent(udzial) }),
          opis: `Nazwa jednostki SIM ${nazwaJednostki(j)} zawiera nazwę dzielnicy ${z.nazwa}, ale jednostka to ${udzial === null ? 'część' : `${procent(udzial)}%`} jej powierzchni; dzielnica ma ${d.jednostki.length} ${mnoga(d.jednostki.length, 'jednostkę', 'jednostki', 'jednostek')} SIM z różnymi nazwami.`,
        })
      } else
        rozjazdy.push({
          rodzaj: 'nazwa-jednostki-z-innej-dzielnicy',
          jednostki: [j.id],
          dzielnica: z.nazwa,
          opis: `Jednostka SIM ${nazwaJednostki(j)} leży w dzielnicy ${j.dzielnica}, choć jej nazwa zawiera nazwę dzielnicy ${z.nazwa}.`,
        })
    }
  }

  const nazwyOsm = new Set(polozone.map((m) => slowa(m.nazwa).join(' ')))
  return {
    slownik,
    potocznePoJednostce,
    rozjazdy,
    kontrola: {
      miejscOsm: miejsca.length,
      miejscWKrakowie: polozone.length,
      miejscPozaKrakowem: pozaKrakowem,
      miejscZObrysem: polozone.filter((m) => m.udzialy).length,
      obrysowRozcietychGranicaJednostek: rozjazdy.filter(
        (r) => r.rodzaj === 'osiedle-w-kilku-jednostkach',
      ).length,
      jednostekZMiejscemOsm: zMiejscem.size,
      jednostekBezMiejscaOsm: bezMiejsc.map((j) => j.id),
      nazwJednostekWOsm: jednostki.filter((j) => nazwyOsm.has(kluczJ.get(j.id))).length,
    },
  }
}

// ── Okolice adresów ─────────────────────────────────────────────────────────────────────────

/** Okolica adresu poza Krakowem: miejscowość w gminie (id po TERYT gminy i nazwie miejscowości) albo null. */
export function okolicaMiejscowosc(a) {
  if (!a.gmina || !a.miejscowosc || a.gmina === 'Kraków') return null
  return {
    id: `m-${a.teryt ?? slug(a.gmina)}-${slug(a.miejscowosc)}`,
    nazwa: a.miejscowosc,
    rodzaj: 'miejscowosc',
    dzielnica: null,
    gmina: a.gmina,
  }
}

/**
 * Składa plik okolice.json. Adres w Krakowie → jednostka SIM (punkt w wielokącie; do 30 m od granicy
 * najbliższa), adres poza Krakowem → miejscowość w gminie, reszta null.
 */
export function zlozOkolice({ adresy, wersja, granice, osm, zrodlaAdresow }) {
  const jednostki = jednostkiSim(granice)
  const kolumna = new Array(adresy.length).fill(null)
  const liczniki = new Map(jednostki.map((j) => [j.id, 0]))
  const miejscowosci = new Map()
  const punktyKrakowa = []
  const kontrola = {
    adresyKrakow: 0,
    adresyWJednostce: 0,
    adresyPrzypisaneDoNajblizszej: 0,
    adresyBezJednostki: 0,
    adresyWKilkuJednostkach: 0,
    adresyZDzielnicaInnaNizJednostka: 0,
    adresyPozaKrakowem: 0,
    adresyPozaKrakowemBezMiejscowosci: 0,
  }
  const przykladyNiezgodnych = new Map()
  adresy.forEach((a, i) => {
    if (a.gmina === 'Kraków') {
      kontrola.adresyKrakow++
      const [x, y] = do2180(a.lon, a.lat)
      const trafione = jednostkiPunktu(jednostki, x, y)
      let j = trafione[0] ?? null
      if (trafione.length > 1) kontrola.adresyWKilkuJednostkach++
      else if (j) kontrola.adresyWJednostce++
      else {
        const n = najblizszaJednostka(jednostki, x, y)
        if (n) {
          j = n.jednostka
          kontrola.adresyPrzypisaneDoNajblizszej++
        } else kontrola.adresyBezJednostki++
      }
      if (!j) return
      kolumna[i] = j.id
      liczniki.set(j.id, liczniki.get(j.id) + 1)
      punktyKrakowa.push({ x, y, id: j.id })
      if (a.dzielnica && a.dzielnica !== j.dzielnica) {
        kontrola.adresyZDzielnicaInnaNizJednostka++
        const para = `${a.dzielnica} ≠ ${j.dzielnica}`
        przykladyNiezgodnych.set(para, (przykladyNiezgodnych.get(para) ?? 0) + 1)
      }
      return
    }
    kontrola.adresyPozaKrakowem++
    const o = okolicaMiejscowosc(a)
    if (!o) {
      kontrola.adresyPozaKrakowemBezMiejscowosci++
      return
    }
    kolumna[i] = o.id
    const wpis = miejscowosci.get(o.id)
    if (wpis) wpis.liczbaAdresow++
    else {
      const { id, ...reszta } = o
      miejscowosci.set(id, { ...reszta, liczbaAdresow: 1 })
    }
  })

  const slownikOsm = zbudujSlownik(jednostki, osm.miejsca, punktyKrakowa)
  const okolice = {}
  for (const j of [...jednostki].sort((a, b) => porownajId(a.id, b.id)))
    okolice[j.id] = {
      nazwa: j.nazwa,
      numer: j.numer,
      rodzaj: 'sim',
      dzielnica: j.dzielnica,
      gmina: 'Kraków',
      powierzchniaKm2: j.powierzchniaKm2,
      liczbaAdresow: liczniki.get(j.id),
      potoczne: slownikOsm.potocznePoJednostce.get(j.id),
    }
  for (const id of [...miejscowosci.keys()].sort()) okolice[id] = miejscowosci.get(id)
  const idOkolic = Object.keys(okolice)
  const numer = new Map(idOkolic.map((id, n) => [id, n]))

  const rozjazdy = [
    ...slownikOsm.rozjazdy,
    {
      rodzaj: 'okolica-poza-krakowem',
      opis: `Poza Krakowem nie ma jednostek SIM: okolicą adresu jest miejscowość w gminie (${liczba.format(miejscowosci.size)} miejscowości, ${liczba.format(kontrola.adresyPozaKrakowem - kontrola.adresyPozaKrakowemBezMiejscowosci)} adresów). To inny rząd wielkości niż jednostka SIM, więc ranking okolic nie powinien mieszać obu rodzajów bez podpisu.`,
    },
  ]
  const liczbyAdresow = jednostki.map((j) => liczniki.get(j.id)).sort((a, b) => a - b)
  return {
    wersjaAdresow: wersja,
    metoda: 'sim-msip',
    opis: 'Okolica adresu w Krakowie = jednostka SIM (System Informacji Miejskiej, 123 jednostki z MSIP): adres → jednostka przez punkt w wielokącie. Poza Krakowem – miejscowość w gminie. Potoczne nazwy osiedli z OSM są słownikiem na poziomie jednostki; rozjazdy między nimi a podziałem SIM opisuje pole `rozjazdy`. Brak danych = null.',
    rozdzielczosc: 'adres',
    zrodla: [
      {
        nazwa: `Jednostki SIM Krakowa – granice (MSIP, warstwa ${WARSTWA_SIM}; wydawca: Zarząd Transportu Publicznego w Krakowie)`,
        url: granice.metadane.katalog,
        licencja: granice.metadane.licencja,
        dataDanych: granice.metadane.dataDanych,
        pobrano: granice.metadane.pobrano,
      },
      {
        nazwa: 'Punkty adresowe projektu (adresy.json): współrzędne, gmina, miejscowość, dzielnica',
        url: zrodlaAdresow[0].url,
        licencja: zrodlaAdresow[0].licencja,
        dataDanych: zrodlaAdresow[0].dataDanych,
        pobrano: zrodlaAdresow[0].pobrano,
      },
      {
        nazwa:
          'OpenStreetMap przez Overpass API – potoczne nazwy osiedli i części miasta (place=neighbourhood, place=quarter)',
        url: osm.url,
        licencja: osm.licencja,
        dataDanych: osm.znacznik.slice(0, 10),
        pobrano: osm.pobrano,
      },
    ],
    kontrola: {
      ...kontrola,
      jednostekSim: jednostki.length,
      okolicPozaKrakowem: miejscowosci.size,
      najmniejszaJednostkaAdresow: liczbyAdresow[0],
      medianaAdresowWJednostce: liczbyAdresow[Math.floor(liczbyAdresow.length / 2)],
      najwiekszaJednostkaAdresow: liczbyAdresow.at(-1),
      jednostekBezAdresow: liczbyAdresow.filter((n) => n === 0).length,
      dzielnicaAdresuInnaNizJednostki: Object.fromEntries(przykladyNiezgodnych),
      osm: slownikOsm.kontrola,
      granice: granice.metadane.kontrola,
    },
    okolice,
    idOkolic,
    slownikNazw: slownikOsm.slownik,
    rozjazdy,
    // Kolumna jako numery w `idOkolic` (null = brak danych) – plik kilka razy mniejszy niż z napisami.
    kolumny: { okolica: kolumna.map((id) => (id === null ? null : numer.get(id))) },
  }
}

// ── Pobieranie (tylko z --pobierz) ──────────────────────────────────────────────────────────

async function zapytajOverpass(zapytanie) {
  let blad = new Error('brak instancji Overpass')
  for (const adres of OVERPASS)
    for (let proba = 1; proba <= 3; proba++) {
      try {
        const odp = await fetch(adres, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(zapytanie)}`,
          signal: AbortSignal.timeout(180_000),
        })
        const tekst = await odp.text()
        if (!odp.ok) throw new Error(`${adres} → ${odp.status}`)
        const j = JSON.parse(tekst) // przeciążony serwer odpowiada XML-em z kodem 200
        if (!Array.isArray(j.elements)) throw new Error(`${adres}: brak pola elements`)
        return tekst
      } catch (e) {
        blad = e
        console.warn(`  Overpass, próba ${proba}/3 nieudana: ${e.message}`)
        await new Promise((r) => setTimeout(r, 4000 * proba))
      }
    }
  throw blad
}

async function pobierzOsm() {
  const cel = join(CACHE, 'okolice', 'osm-miejsca.json')
  if (!existsSync(cel)) {
    mkdirSync(dirname(cel), { recursive: true })
    writeFileSync(cel, await zapytajOverpass(ZAPYTANIE_OSM))
  }
  const odpowiedz = JSON.parse(readFileSync(cel, 'utf8'))
  const migawka = {
    opis: 'Migawka miejsc OSM (place=neighbourhood, place=quarter z nazwą) wokół Krakowa, z której etl/okolice.mjs liczy słownik potocznych nazw. Generuje ją `node etl/okolice.mjs --pobierz`, nie edytuj ręcznie.',
    zrodlo: 'OpenStreetMap przez Overpass API',
    url: OVERPASS[0],
    licencja: LICENCJA_OSM,
    znacznik: odpowiedz.osm3s?.timestamp_osm_base,
    pobrano: dataPobrania(cel),
    zapytanie: ZAPYTANIE_OSM,
    miejsca: miejscaZOverpass(odpowiedz),
  }
  if (!migawka.znacznik || !migawka.miejsca.length)
    throw new Error('Odpowiedź Overpass bez znacznika czasu albo bez miejsc')
  writeFileSync(PLIK_OSM, `${JSON.stringify(migawka, null, 2)}\n`)
  console.log(`OSM: ${migawka.miejsca.length} miejsc, stan bazy ${migawka.znacznik}`)
}

async function pobierzGranice() {
  const ztp = await pobierzWarstwe(WARSTWA_SIM, { katalog: 'okolice/sim-jednostki' })
  const kontrolna = await pobierzWarstwe(WARSTWA_KONTROLNA, { katalog: 'okolice/sim-kontrolna' })
  const { features, kontrola } = zlozGranice(ztp.obiekty, kontrolna.obiekty)
  const geojson = {
    type: 'FeatureCollection',
    metadane: {
      nazwa: 'Jednostki SIM Krakowa – granice',
      znaczenie:
        'Jednostki SIM (System Informacji Miejskiej): podstawowy podział Krakowa na 123 jednostki, które sumują się do granic dzielnic. Nazwy dobrano m.in. na podstawie badania mieszkańców; to nie są osiedla w rozumieniu potocznym.',
      zrodlo: `https://msip.um.krakow.pl/arcgis/rest/services/${WARSTWA_SIM}`,
      katalog: KATALOG_SIM,
      wydawca: 'Zarząd Transportu Publicznego w Krakowie (Gmina Miejska Kraków)',
      licencja: WARUNKI_ZTP,
      licencjaMsip: LICENCJA_MSIP,
      dataDanych: kontrola.dataImportuWarstwy,
      znaczenieDatyDanych:
        'Data importu warstwy do MSIP (pole data_importu), nie data zmiany granic podziału.',
      pobrano: dataPobrania(join(CACHE, 'okolice/sim-jednostki/info.json')),
      przetworzono:
        'Pierścienie przeliczone z EPSG:2178 do WGS84 (6 miejsc po przecinku), zewnętrzne przeciwnie do ruchu wskazówek zegara; teksty oczyszczone z białych znaków; id = sim-<id_sim> (numer dzielnicy × 100 + numer jednostki), zgodny z id_sim w warstwie kontrolnej ZSOZ/Rc_Sim. Pominięto opisy słowne jednostek i opisy przebiegu granic.',
      kontrola,
    },
    features,
  }
  writeFileSync(PLIK_GRANIC, JSON.stringify(geojson))
  console.log(
    `granice: ${features.length} jednostek SIM, stan warstwy ${kontrola.dataImportuWarstwy}`,
  )
}

async function main() {
  if (process.argv.includes('--pobierz')) {
    await pobierzGranice()
    await pobierzOsm()
  }
  for (const plik of [PLIK_GRANIC, PLIK_OSM])
    if (!existsSync(plik))
      throw new Error(`Brak pliku ${plik} – uruchom: node etl/okolice.mjs --pobierz`)
  const granice = JSON.parse(readFileSync(PLIK_GRANIC, 'utf8'))
  const osm = JSON.parse(readFileSync(PLIK_OSM, 'utf8'))
  const { wersja, adresy } = wczytajAdresy()
  const { zrodla: zrodlaAdresow } = JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8'))
  const plik = zlozOkolice({ adresy, wersja, granice, osm, zrodlaAdresow })
  writeFileSync(PLIK_WYNIKU, JSON.stringify(plik))
  const k = plik.kontrola
  const bez = plik.kolumny.okolica.filter((x) => x === null).length
  console.log(
    `okolice: ${Object.keys(plik.okolice).length} okolic (${k.jednostekSim} SIM + ${k.okolicPozaKrakowem} miejscowości), ${bez} adresów bez okolicy, ${plik.slownikNazw.length} nazw w słowniku, ${plik.rozjazdy.length} rozjazdów`,
  )
  console.log(
    `Kraków: ${k.adresyWJednostce}/${k.adresyKrakow} w jednostce, ${k.adresyPrzypisaneDoNajblizszej} do najbliższej, ${k.adresyBezJednostki} bez, ${k.adresyWKilkuJednostkach} w kilku; dzielnica adresu ≠ jednostki: ${k.adresyZDzielnicaInnaNizJednostka}`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
