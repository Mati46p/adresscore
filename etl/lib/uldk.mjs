// Usługa lokalizacji działek katastralnych (ULDK, GUGiK): geometria działki ewidencyjnej po identyfikatorze.
// Dokumentacja: https://uldk.gugik.gov.pl/opis.html (dane EGiB z baz powiatowych, bez opłat i bez limitu
// w opisie usługi; pobieramy uprzejmie – kilka zapytań naraz, wynik każdej działki zapisujemy w cache,
// więc drugi bieg nie dotyka usługi).
// Identyfikator działki: WWPPGG_R.OOOO.NR_DZ albo WWPPGG_R.OOOO.AR_n.NR_DZ (obręb z arkuszem mapy).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

const URL_ULDK = 'https://uldk.gugik.gov.pl/'

/**
 * Odpowiedź ULDK: pierwszy wiersz to status („0” = jest wynik, „-1 brak wyników” = nie ma takiej
 * działki), kolejne to `id|SRID=2180;WKT`. Zwraca { wkt } | { brak: true } | { blad: tekst }.
 */
export function parsujOdpowiedz(tekst) {
  const wiersze = tekst.split(/\r?\n/).filter((w) => w.trim() !== '')
  const status = (wiersze[0] ?? '').trim()
  if (status === '0') {
    const dane = wiersze[1]
    const wkt = dane?.slice(dane.indexOf('|') + 1).replace(/^SRID=\d+;/, '')
    if (!wkt || !/^(?:MULTI)?POLYGON/i.test(wkt)) return { blad: 'status 0 bez geometrii' }
    return { wkt }
  }
  if (/^-1\s+brak wynik/i.test(status)) {
    // „usługa nie zwróciła odpowiedzi <adres WMS powiatu>" to chwilowa awaria serwera powiatu, nie
    // brak działki: ten sam identyfikator chwilę później bywa rozpoznany albo naprawdę nieznany.
    if (/nie zwróciła odpowiedzi/i.test(tekst)) return { blad: 'serwer powiatu nie odpowiada' }
    return { brak: true }
  }
  // Niepusty komunikat, żeby `blad` zawsze był prawdziwy: pusta odpowiedź to błąd, nie wynik.
  return { blad: status.slice(0, 120) || 'pusta odpowiedź' }
}

/** WKT POLYGON / MULTIPOLYGON → lista wielokątów, każdy to lista pierścieni [[x, y], …] (pierwszy zewnętrzny). */
export function parsujWkt(wkt) {
  const m = /^\s*(MULTIPOLYGON|POLYGON)\s*(\(.*\))\s*$/is.exec(wkt)
  if (!m) throw new Error(`Nieobsługiwany WKT: ${wkt.slice(0, 40)}`)
  const rozdziel = (s) => {
    const wynik = []
    let glebokosc = 0
    let start = -1
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') {
        if (glebokosc === 0) start = i + 1
        glebokosc++
      } else if (s[i] === ')') {
        glebokosc--
        if (glebokosc === 0) wynik.push(s.slice(start, i))
      }
    }
    return wynik
  }
  const pierscien = (s) =>
    s.split(',').map((p) => {
      const [x, y] = p.trim().split(/\s+/).map(Number)
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Zła współrzędna w WKT: ${p}`)
      return [x, y]
    })
  const wnetrze = m[2].slice(1, -1)
  if (m[1].toUpperCase() === 'POLYGON') return [rozdziel(wnetrze).map(pierscien)]
  return rozdziel(wnetrze).map((poligon) => rozdziel(poligon).map(pierscien))
}

/** Pole (ze znakiem) i całka środka ciężkości pierścienia – wzór na pole wielokąta (shoelace). */
function pierscienMomenty(pierscien) {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pierscien.length - 1; i++) {
    const [x0, y0] = pierscien[i]
    const [x1, y1] = pierscien[i + 1]
    const w = x0 * y1 - x1 * y0
    a += w
    cx += (x0 + x1) * w
    cy += (y0 + y1) * w
  }
  return { pole: a / 2, sx: cx / 6, sy: cy / 6 }
}

/**
 * Środek ciężkości i pole sumy wielokątów (otwory odejmowane). null dla zerowego pola.
 * Współrzędne w metrach (EPSG:2178/2180), więc pole w m².
 */
export function srodekIPole(poligony) {
  let pole = 0
  let sx = 0
  let sy = 0
  for (const poligon of poligony) {
    poligon.forEach((pierscien, i) => {
      const mom = pierscienMomenty(pierscien)
      // Znak pola zależy od kierunku pierścienia – normalizujemy: zewnętrzny dodaje, otwór odejmuje.
      const znak = Math.sign(mom.pole) * (i === 0 ? 1 : -1)
      pole += znak * mom.pole
      sx += znak * mom.sx
      sy += znak * mom.sy
    })
  }
  if (!(pole > 0)) return null
  return { x: sx / pole, y: sy / pole, pole }
}

const pauza = (ms) => new Promise((r) => setTimeout(r, ms))

async function zapytaj(id, { probyMax = 4, limitCzasuMs = 30_000 } = {}) {
  const url = `${URL_ULDK}?request=GetParcelById&id=${encodeURIComponent(id)}&result=id,geom_wkt&srid=2180`
  let ostatni = 'brak odpowiedzi'
  for (let proba = 1; proba <= probyMax; proba++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(limitCzasuMs) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const wynik = parsujOdpowiedz(await r.text())
      if (!wynik.blad) return wynik
      ostatni = wynik.blad
    } catch (e) {
      ostatni = String(e.message ?? e)
    }
    if (proba < probyMax) await pauza(1000 * 3 ** (proba - 1))
  }
  return { blad: ostatni }
}

/**
 * Pobiera geometrie działek z ULDK i dopisuje wyniki do pliku JSONL (jeden wiersz = jedna działka).
 * Zapisujemy tylko rozstrzygnięcia: { id, wkt } albo { id, brak: 1 }; błąd przejściowy (limit czasu,
 * HTTP 5xx) nie trafia do cache, więc następny bieg spróbuje ponownie.
 * Zwraca { dzialki: Map(id → { wkt } | { brak: true }), bledy }: Map obejmuje całą zawartość cache
 * (także starsze wpisy), a `bledy` to liczba działek z `idy` bez rozstrzygnięcia w tym biegu.
 */
export async function pobierzDzialki(
  idy,
  { plikCache, wspolbieznosc = 6, log = console.log } = {},
) {
  mkdirSync(dirname(plikCache), { recursive: true })
  const znane = new Map()
  if (existsSync(plikCache)) {
    for (const linia of readFileSync(plikCache, 'utf8').split('\n')) {
      if (!linia) continue
      const r = JSON.parse(linia)
      znane.set(r.id, r.brak ? { brak: true } : { wkt: r.wkt })
    }
  }
  const doPobrania = [...new Set(idy)].filter((id) => !znane.has(id))
  log(
    `ULDK: ${idy.length} działek do rozpoznania, w cache ${idy.length - doPobrania.length}, do pobrania ${doPobrania.length}`,
  )
  let kolejny = 0
  let zrobione = 0
  let bledy = 0
  const start = Date.now()
  async function pracownik() {
    while (kolejny < doPobrania.length) {
      const id = doPobrania[kolejny++]
      const wynik = await zapytaj(id)
      if (wynik.blad) {
        bledy++
      } else {
        znane.set(id, wynik)
        appendFileSync(
          plikCache,
          `${JSON.stringify(wynik.brak ? { id, brak: 1 } : { id, wkt: wynik.wkt })}\n`,
        )
      }
      zrobione++
      if (zrobione % 500 === 0) {
        const sek = (Date.now() - start) / 1000
        log(
          `  ULDK ${zrobione}/${doPobrania.length} (${(zrobione / sek).toFixed(1)}/s, błędów ${bledy})`,
        )
      }
    }
  }
  await Promise.all(Array.from({ length: wspolbieznosc }, pracownik))
  if (doPobrania.length)
    log(
      `ULDK: zakończono w ${((Date.now() - start) / 1000).toFixed(0)} s, bez rozstrzygnięcia ${bledy}`,
    )
  return { dzialki: znane, bledy }
}
