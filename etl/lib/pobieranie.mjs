// Pobieranie źródeł do etl/.cache/ryzyka/ (poza gitem): OGC API Features ze stronicowaniem i WFS.
// Dwa biegi z rzędu nie pytają serwera drugi raz – data pobrania pochodzi z pliku w cache.
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE, pobierzDoCache } from './wspolne.mjs'

export const PODKATALOG = 'ryzyka'

/** Plik w etl/.cache/ryzyka/ (katalog zakładany przy pierwszym użyciu). */
export function plikCache(nazwa) {
  mkdirSync(join(CACHE, PODKATALOG), { recursive: true })
  return join(PODKATALOG, nazwa)
}

/** Data (YYYY-MM-DD) pobrania pliku z cache – ostatnia modyfikacja pliku. */
export function dataPobrania(sciezka) {
  return statSync(sciezka).mtime.toISOString().slice(0, 10)
}

/**
 * Pobranie do cache z limitem czasu i kilkoma próbami. Serwery IIP (GIOŚ, GDOŚ) potrafią
 * zawiesić pojedyncze żądanie i zerwać połączenie (ECONNRESET), a kolejna próba przechodzi.
 */
export async function pobierzTrwale(url, plik, { proby = 4, limitMs = 120_000 } = {}) {
  let blad
  for (let i = 1; i <= proby; i++) {
    try {
      return await pobierzDoCache(url, plik, { signal: AbortSignal.timeout(limitMs) })
    } catch (e) {
      blad = e
      console.warn(
        `  próba ${i}/${proby} nieudana (${e.cause?.code ?? e.message}): ${url.slice(0, 110)}`,
      )
    }
  }
  throw blad
}

/**
 * Kolekcja OGC API Features (GeoJSON): idzie za linkiem rel=next aż do końca i sprawdza,
 * że liczba obiektów zgadza się z `numberMatched`. Zwraca obiekty, datę stanu usługi
 * (`timeStamp` z odpowiedzi) i datę pobrania.
 */
export async function pobierzKolekcje(urlPierwszejStrony, prefiks, { maxStron = 50 } = {}) {
  const features = []
  let url = urlPierwszejStrony
  let timeStamp = null
  let zadeklarowane = null
  let pobrano = null
  for (let n = 0; url && n < maxStron; n++) {
    const sciezka = await pobierzTrwale(url, plikCache(`${prefiks}_${n}.geojson`))
    const strona = JSON.parse(readFileSync(sciezka, 'utf8'))
    if (strona.type !== 'FeatureCollection' || !Array.isArray(strona.features))
      throw new Error(`${url}: to nie jest FeatureCollection (usuń ${sciezka})`)
    features.push(...strona.features)
    timeStamp ??= strona.timeStamp ?? null
    zadeklarowane ??= strona.numberMatched ?? null
    pobrano ??= dataPobrania(sciezka)
    url = strona.links?.find((l) => l.rel === 'next')?.href ?? null
  }
  if (url) throw new Error(`${urlPierwszejStrony}: więcej niż ${maxStron} stron`)
  if (zadeklarowane !== null && features.length !== zadeklarowane)
    throw new Error(`Pobrano ${features.length} obiektów, usługa zgłasza ${zadeklarowane}`)
  return {
    features,
    dataDanych: timeStamp ? timeStamp.slice(0, 10) : pobrano,
    pobrano,
    zgloszone: zadeklarowane,
  }
}
