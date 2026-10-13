// Otwarte boiska szkolne Warszawy (#234): odległość od adresu do najbliższego obiektu z API
// dane.um.warszawa.pl (action get_be_otwarte_boiska, JSON, 1227 rekordów = ok. 300 adresów szkół;
// jedna szkoła ma kilka rekordów, po jednym na rodzaj urządzenia sportowego).
// Rekordy mają tylko adres tekstowy ("ul. Elbląska 51"), bez współrzędnych. Geokodujemy je po
// dopasowaniu do punktów adresowych Warszawy z adresy.json (bez zewnętrznego geokodera):
// normalizacja nazwy ulicy (przedrostki ul./al./pl./aleja/plac, wielkość liter, polskie znaki,
// myślniki, inicjały imion), numer budynku (12/14, 12A, "lok."), potem fallbacki opisane przy
// geokoduj(). PUNKT DECYZYJNY (plan zadania #234): jeśli dopasowanych adresów jest mniej niż
// 90%, warstwa NIE jest zapisywana – skrypt wypisuje odsetek i niedopasowane adresy.
// Uruchom: ADRESCORE_MIASTO=warszawa node etl/warszawa-boiska.mjs
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { odlegloscMetry } from './lib/codziennosc-geo.mjs'
import { pobierzAction, wymagajWarszawy } from './lib/warszawa-api.mjs'
import { zapiszOdleglosc } from './lib/warszawa-wskaznik.mjs'
import { MIASTO, wczytajAdresy } from './lib/wspolne.mjs'

export const ACTION = 'get_be_otwarte_boiska'
export const PROG_DOPASOWANIA = 0.9
const PRZEDROSTKI = new Set(['ul', 'ulica', 'al', 'aleja', 'aleje', 'pl', 'plac', 'os', 'osiedle'])

/** Małe litery bez znaków diakrytycznych (ł osobno, bo NFD jej nie rozkłada). */
export const bezOgonkow = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')

/** Słowa nazwy ulicy bez przedrostka (ul./al./pl./aleja/plac/os.), bez kropek i myślnikowych spacji. */
export function slowaUlicy(ulica) {
  const slowa = bezOgonkow(ulica)
    .replace(/\s*-\s*/g, '-')
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  while (slowa.length > 1 && PRZEDROSTKI.has(slowa[0])) slowa.shift()
  return slowa
}

export const kluczUlicy = (ulica) => slowaUlicy(ulica).join(' ')

/** Klucz numeru: wielkie litery, bez spacji ("12 a" → "12A"). */
export const kluczNumeru = (nr) =>
  String(nr ?? '')
    .replace(/\s+/g, '')
    .toUpperCase()

/**
 * "ul. Chłodna 36/46" → { ulica: "ul. Chłodna", numer: "36/46", kod: null }.
 * Odcina: kod i miasto po przecinku ("…, 02-943 Warszawa"), dopiski w nawiasach ("(Wesoła)"),
 * "lok./m./lokal …", opis po myślniku ze spacjami (" - filia szkoły"). Numerem jest ostatnia
 * grupa cyfr, więc nazwy typu "Aleja 3 Maja" zostają w całości w ulicy. Bez numeru numer = null.
 */
export function rozbijAdres(adres) {
  let t = String(adres ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const kod = /\b(\d{2}-\d{3})\b/.exec(t)?.[1] ?? null
  t = t
    .replace(/,.*$/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/["„”«»]/g, '')
    .replace(/\s+[-–]\s+.*$/, '')
    .replace(/\s+(lok|lokal|m)\.?\s*\d.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const m = /^(.*?)\s+(\d+\s?[A-Za-z]?(?:\s?\/\s?\d+\s?[A-Za-z]?)?)$/u.exec(t)
  if (!m) return { ulica: t, numer: null, kod }
  return { ulica: m[1].trim(), numer: kluczNumeru(m[2]), kod }
}

/** Numery do sprawdzenia po kolei: pełny ("36/46"), pierwszy człon, drugi człon, bez litery. */
export function numeryDoSprawdzenia(numer) {
  if (!numer) return []
  const lista = [numer]
  for (const czlon of numer.split('/')) {
    lista.push(czlon)
    lista.push(czlon.replace(/[A-Z]+$/, ''))
  }
  return [...new Set(lista.filter(Boolean))]
}

/** Indeks adresów: klucz ulicy → klucz numeru → punkty { lon, lat, kod }. */
export function indeksAdresow(adresy) {
  const ulice = new Map()
  for (const a of adresy) {
    if (!a.ulica) continue
    const u = kluczUlicy(a.ulica)
    const n = kluczNumeru(a.nr)
    let numery = ulice.get(u)
    if (!numery) {
      numery = new Map()
      ulice.set(u, numery)
    }
    const punkt = { lon: a.lon, lat: a.lat, kod: a.kod }
    const lista = numery.get(n)
    if (lista) lista.push(punkt)
    else numery.set(n, [punkt])
  }
  return ulice
}

/** Czy każde słowo zapytania jest słowem albo początkiem (inicjałem) innego słowa nazwy. */
export function slowaPasuja(zapytanie, nazwa) {
  const wolne = [...nazwa]
  return zapytanie.every((s) => {
    const i = wolne.findIndex((w) => w === s || w.startsWith(s))
    if (i < 0) return false
    wolne.splice(i, 1)
    return true
  })
}

function pierwszyNumer(numeryUlicy, numery) {
  for (const n of numery) {
    const punkty = numeryUlicy?.get(n)
    if (punkty?.length) return [n, punkty]
  }
  return null
}

/** Środek kilku punktów jednego adresu, jeśli leżą w promieniu 120 m od niego; inaczej null. */
function srodekGrupy(punkty) {
  const lon = punkty.reduce((s, p) => s + p.lon, 0) / punkty.length
  const lat = punkty.reduce((s, p) => s + p.lat, 0) / punkty.length
  const rozrzut = Math.max(...punkty.map((p) => odlegloscMetry(lat, lon, p.lat, p.lon)))
  return rozrzut <= 120 ? { lon, lat } : null
}

/** Skupiska punktów w promieniu 120 m (ta sama ulica i numer w różnych częściach miasta). */
export function skupiska(punkty) {
  const grupy = []
  for (const p of punkty) {
    const g = grupy.find((x) => odlegloscMetry(x.lat, x.lon, p.lat, p.lon) <= 120)
    if (g) g.punkty.push(p)
    else grupy.push({ lon: p.lon, lat: p.lat, punkty: [p] })
  }
  return grupy.map((g) => srodekGrupy(g.punkty) ?? { lon: g.lon, lat: g.lat })
}

/**
 * Geokoduje adres tekstowy w indeksie punktów adresowych. Kolejność:
 *  1. dokładna nazwa ulicy (po normalizacji) + numer (pełny, człony, bez litery),
 *  2. ulica, której nazwa zawiera wszystkie słowa zapytania (inicjały, pominięte imię: "B. Limanowskiego",
 *     "Aleja Reymonta") i ma ten numer – tylko gdy jest dokładnie jedna taka ulica.
 * Wiele punktów pod jednym numerem: najpierw kod pocztowy z adresu, potem środek grupy do 120 m;
 * punkty dalsze to niejednoznaczność (ta sama ulica w dwóch miejscach) i adres odpada.
 * Zwraca { lon, lat, metoda } albo { powod }.
 */
export function geokoduj(adres, indeks) {
  const { ulica, numer, kod } = rozbijAdres(adres)
  const klucz = kluczUlicy(ulica)
  const numery = numeryDoSprawdzenia(numer)
  if (!klucz) return { powod: 'brak ulicy' }
  if (!numery.length) return { powod: 'brak numeru budynku' }
  let trafienie = pierwszyNumer(indeks.get(klucz), numery)
  let metoda = 'dokladna ulica'
  if (!trafienie) {
    const slowa = slowaUlicy(ulica)
    const kandydaci = []
    for (const [nazwa, numeryUlicy] of indeks) {
      const t = pierwszyNumer(numeryUlicy, numery)
      if (t && slowaPasuja(slowa, nazwa.split(' '))) kandydaci.push([nazwa, t])
    }
    if (kandydaci.length === 0) return { powod: `brak adresu ${klucz} ${numery[0]}` }
    if (kandydaci.length > 1) return { powod: `niejednoznaczna ulica (${kandydaci.length})` }
    trafienie = kandydaci[0][1]
    metoda = `skrocona nazwa ulicy (${kandydaci[0][0]})`
  }
  const [dopasowany, punkty] = trafienie
  if (dopasowany !== numery[0]) metoda += `, numer ${dopasowany} zamiast ${numery[0]}`
  const zgodne = kod ? punkty.filter((p) => p.kod === kod) : []
  const wybrane = zgodne.length ? zgodne : punkty
  const srodek = wybrane.length === 1 ? wybrane[0] : srodekGrupy(wybrane)
  if (!srodek) return { powod: 'adres w kilku odległych punktach', kandydaci: skupiska(wybrane) }
  return { lon: srodek.lon, lat: srodek.lat, metoda }
}

const medianaLiczb = (v) => {
  const t = [...v].sort((x, y) => x - y)
  const m = t.length >> 1
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2
}

/** Mediana współrzędnych punktów w każdej dzielnicy: Map(dzielnica → { lon, lat }). */
export function srodkiPoDzielnicach(punkty) {
  const grupy = new Map()
  for (const p of punkty) {
    if (!p.dzielnica) continue
    const g = grupy.get(p.dzielnica) ?? { lon: [], lat: [] }
    g.lon.push(p.lon)
    g.lat.push(p.lat)
    grupy.set(p.dzielnica, g)
  }
  return new Map(
    [...grupy].map(([d, g]) => [d, { lon: medianaLiczb(g.lon), lat: medianaLiczb(g.lat) }]),
  )
}

/**
 * Rekordy API → unikalne obiekty (jeden na adres) z geokodowaniem.
 * Zwraca { punkty, adresy: {unikalne, dopasowane}, rekordy: {wszystkie, dopasowane}, niedopasowane }.
 */
export function geokodujBoiska(rekordy, adresyMiasta) {
  const indeks = indeksAdresow(adresyMiasta)
  const poAdresie = new Map()
  for (const r of rekordy) {
    const adres = String(r['Adres obiektu'] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    const wpis = poAdresie.get(adres) ?? {
      adres,
      rekordy: 0,
      typy: new Set(),
      dzielnica: r.Dzielnica,
    }
    wpis.rekordy++
    wpis.typy.add(r['Typ obiektu'])
    poAdresie.set(adres, wpis)
  }
  const punkty = []
  const niedopasowane = []
  const metody = {}
  let rekordyDopasowane = 0
  const przyjmij = (w, g, metoda) => {
    rekordyDopasowane += w.rekordy
    const rodzaj = metoda.split(',')[0]
    metody[rodzaj] = (metody[rodzaj] ?? 0) + 1
    punkty.push({
      lon: g.lon,
      lat: g.lat,
      dzielnica: w.dzielnica,
      atr: { adres: w.adres, typy: [...w.typy] },
    })
  }
  const niejednoznaczne = []
  for (const w of poAdresie.values()) {
    const g = geokoduj(w.adres, indeks)
    if (g.kandydaci) niejednoznaczne.push({ w, g })
    else if (g.powod)
      niedopasowane.push({
        adres: w.adres,
        dzielnica: w.dzielnica,
        rekordy: w.rekordy,
        powod: g.powod,
      })
    else przyjmij(w, g, g.metoda)
  }
  // Ta sama ulica i numer w kilku częściach miasta: rozstrzyga dzielnica z rekordu. Środek dzielnicy
  // to mediana jednoznacznie dopasowanych adresów tej dzielnicy; kandydat musi leżeć wyraźnie
  // (dwa razy) bliżej niż drugi, inaczej adres zostaje niedopasowany.
  const srodkiDzielnic = srodkiPoDzielnicach(punkty)
  for (const { w, g } of niejednoznaczne) {
    const c = srodkiDzielnic.get(w.dzielnica)
    const posortowani = c
      ? g.kandydaci
          .map((k) => ({ k, m: odlegloscMetry(c.lat, c.lon, k.lat, k.lon) }))
          .sort((x, y) => x.m - y.m)
      : []
    if (posortowani.length >= 2 && posortowani[0].m * 2 <= posortowani[1].m)
      przyjmij(w, posortowani[0].k, 'rozstrzygnieta dzielnica')
    else
      niedopasowane.push({
        adres: w.adres,
        dzielnica: w.dzielnica,
        rekordy: w.rekordy,
        powod: g.powod,
      })
  }
  return {
    punkty,
    adresy: { unikalne: poAdresie.size, dopasowane: punkty.length },
    rekordy: { wszystkie: rekordy.length, dopasowane: rekordyDopasowane },
    niedopasowane,
    metody,
  }
}

/** Najpóźniejsza data aktualizacji rekordów (ISO) albo null. */
export function dataAktualizacji(rekordy) {
  const daty = rekordy
    .map((r) => String(r['Data aktualizacji'] ?? ''))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
  return daty.at(-1) ?? null
}

async function main() {
  wymagajWarszawy(MIASTO)
  const { result, pobrano } = await pobierzAction(ACTION)
  const { adresy } = wczytajAdresy()
  const g = geokodujBoiska(result, adresy)
  const odsAdresy = g.adresy.dopasowane / g.adresy.unikalne
  const odsRekordy = g.rekordy.dopasowane / g.rekordy.wszystkie
  console.log(
    `Boiska: ${g.rekordy.wszystkie} rekordów, ${g.adresy.unikalne} unikalnych adresów\n` +
      `Dopasowane adresy: ${g.adresy.dopasowane}/${g.adresy.unikalne} (${(odsAdresy * 100).toFixed(1)}%), ` +
      `rekordy: ${g.rekordy.dopasowane}/${g.rekordy.wszystkie} (${(odsRekordy * 100).toFixed(1)}%); metody: ${JSON.stringify(g.metody)}`,
  )
  if (g.niedopasowane.length) {
    console.log(`Niedopasowane (${g.niedopasowane.length}):`)
    for (const n of g.niedopasowane) console.log(`  ${n.adres} [${n.dzielnica}] – ${n.powod}`)
  }
  if (Math.min(odsAdresy, odsRekordy) < PROG_DOPASOWANIA) {
    console.log(
      `PUNKT DECYZYJNY: dopasowanie poniżej ${PROG_DOPASOWANIA * 100}%, warstwa boisk NIE została zapisana.`,
    )
    process.exitCode = 2
    return
  }
  zapiszOdleglosc({
    id: 'boisko_otwarte_odleglosc',
    kategoria: 'codziennosc',
    nazwa: 'Najbliższe otwarte boisko',
    opis: `Odległość do najbliższego boiska szkolnego otwartego dla mieszkańców, z rejestru m.st. Warszawy (${g.adresy.dopasowane} adresów szkół z ${g.adresy.unikalne}; ${(odsAdresy * 100).toFixed(0)}% adresów dało się przypisać do punktu adresowego, resztę pominięto). Rejestr podaje tylko adres, bez współrzędnych, więc położenie to punkt adresowy budynku szkoły, nie samo boisko. Godziny dostępności różnią się między obiektami (np. popołudnia i weekendy).`,
    zakres: [0, 1500],
    zadanie: 234,
    zrodlo: {
      nazwa: 'm.st. Warszawa – otwarte boiska (Biuro Edukacji)',
      action: ACTION,
      dataDanych: dataAktualizacji(result) ?? pobrano,
      pobrano,
    },
    punkty: g.punkty,
  })
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
}
