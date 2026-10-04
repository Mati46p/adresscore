// Wspólne narzędzia skryptów ETL. Każda warstwa: etl/<nazwa>.mjs → public/dane/wskazniki/<id>.json.
// Kontrakt (typy): src/kontrakty/index.ts, opis: docs/etapy/kontrakt-danych.md.
// Surowe pobrania trzymaj w etl/.cache/ (poza gitem) – drugi bieg nie ściąga ich ponownie.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const KORZEN = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// ADRESCORE_MIASTO=<slug> przełącza cały ETL na public/dane/miasta/<slug> (adresy.json tego miasta).
export const MIASTO = process.env.ADRESCORE_MIASTO || null
export const DANE = join(KORZEN, 'public', 'dane', ...(MIASTO ? ['miasta', MIASTO] : []))
export const CACHE = join(KORZEN, 'etl', '.cache')
const KATEGORIE = [
  'codziennosc',
  'transport',
  'spokoj',
  'spolecznosc',
  'przyszlosc',
  'bezpieczenstwo',
  'kontekst',
]
const ROZDZIELCZOSCI = ['adres', 'budynek', 'heks', 'siatka', 'rejon', 'gmina', 'powiat']
const KIERUNKI = ['mniej-lepiej', 'wiecej-lepiej', 'neutralny']

export const dzis = () => new Date().toISOString().slice(0, 10)

/** Pobiera URL do etl/.cache/<plik> (raz). Zwraca ścieżkę lokalną. */
export async function pobierzDoCache(url, plik, opcje = {}) {
  mkdirSync(CACHE, { recursive: true })
  const cel = join(CACHE, plik)
  if (existsSync(cel)) return cel
  const r = await fetch(url, opcje)
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  writeFileSync(cel, Buffer.from(await r.arrayBuffer()))
  return cel
}

/** Adresy jako tablica obiektów { i, id, ..., lon, lat, h3 } – ta sama kolejność co w pliku. */
export function wczytajAdresy() {
  const p = JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8'))
  const k = p.kolumny
  const adresy = k.id.map((id, i) => ({
    i,
    id,
    miejscowosc: k.miejscowosc[i],
    ulica: k.ulica[i],
    nr: k.nr[i],
    kod: k.kod[i],
    dzielnica: k.dzielnica[i],
    gmina: k.gmina[i],
    teryt: k.teryt[i],
    lon: k.lon[i],
    lat: k.lat[i],
    h3: k.h3[i],
  }))
  return { wersja: p.wersja, atrapa: Boolean(p.atrapa), adresy }
}

/** Wersja = skrót z id i współrzędnych, więc zmienia się tylko, gdy zmienia się zbiór adresów. */
export function wersjaAdresow(kolumny) {
  const h = createHash('sha256')
  for (let i = 0; i < kolumny.id.length; i++)
    h.update(`${kolumny.id[i]}|${kolumny.lon[i]}|${kolumny.lat[i]}\n`)
  return h.digest('hex').slice(0, 12)
}

/**
 * Zapisuje wskaźnik po walidacji kontraktu. wartosci[i] dotyczy adresy[i]; null = brak danych.
 * Rzuca błąd przy złej długości, NaN, nieznanej kategorii – lepiej teraz niż na karcie.
 */
export function zapiszWskaznik(meta, wartosci, etykiety, slownikEtykiet) {
  const { wersja, adresy } = wczytajAdresy()
  const bledy = []
  if (!/^[a-z0-9_]+$/.test(meta.id ?? '')) bledy.push('id: snake_case')
  if (!KATEGORIE.includes(meta.kategoria)) bledy.push(`kategoria: jedna z ${KATEGORIE}`)
  if (!ROZDZIELCZOSCI.includes(meta.rozdzielczosc)) bledy.push(`rozdzielczosc: ${ROZDZIELCZOSCI}`)
  if (!KIERUNKI.includes(meta.kierunek)) bledy.push(`kierunek: ${KIERUNKI}`)
  for (const k of ['nazwa', 'opis', 'jednostka']) if (!meta[k]) bledy.push(`${k}: wymagane`)
  if (!Number.isInteger(meta.zadanie)) bledy.push('zadanie: numer issue')
  if (!meta.zrodla?.length) bledy.push('zrodla: co najmniej jedno')
  for (const z of meta.zrodla ?? [])
    for (const k of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano'])
      if (!z[k]) bledy.push(`zrodla[].${k}: wymagane`)
  if (wartosci.length !== adresy.length)
    bledy.push(`wartosci: ${wartosci.length}, adresów ${adresy.length}`)
  if (wartosci.some((v) => v !== null && !Number.isFinite(v)))
    bledy.push('wartosci: tylko liczby albo null')
  if (etykiety && etykiety.length !== adresy.length) bledy.push('etykiety: długość jak adresy')
  if (slownikEtykiet && etykiety?.some((e) => e !== null && !slownikEtykiet[e]))
    bledy.push('etykiety: brak wpisu w słowniku')
  if (bledy.length) throw new Error(`Wskaźnik ${meta.id}: ${bledy.join('; ')}`)

  const zaokr = (v) => (v === null ? null : Math.round(v * 100) / 100)
  const plik = { meta, wersjaAdresow: wersja, wartosci: wartosci.map(zaokr) }
  if (etykiety) plik.etykiety = etykiety
  if (slownikEtykiet) plik.slownikEtykiet = slownikEtykiet
  const cel = join(DANE, 'wskazniki', `${meta.id}.json`)
  mkdirSync(dirname(cel), { recursive: true })
  writeFileSync(cel, JSON.stringify(plik))

  const z = wartosci.filter((v) => v !== null)
  const pokrycie = ((100 * z.length) / adresy.length).toFixed(1)
  const min = z.reduce((a, b) => Math.min(a, b), Infinity)
  const max = z.reduce((a, b) => Math.max(a, b), -Infinity)
  console.log(
    `${meta.id}: pokrycie ${pokrycie}% (${z.length}/${adresy.length}), min ${min}, max ${max}`,
  )
}
