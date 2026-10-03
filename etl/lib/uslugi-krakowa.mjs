// Czyste funkcje warstw „usługi Krakowa" (#120): odległość od adresu do najbliższego obiektu,
// odczyt warstw ArcGIS REST MSIP i geokodowanie Centrów Aktywności Seniora po punktach
// adresowych projektu (adresy.json), bez zewnętrznego geokodera.
// Używa ich etl/uslugi-krakowa.mjs; test: etl/uslugi-krakowa.test.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import { dirname, join } from 'node:path'
import proj4 from 'proj4'
import { CACHE } from './wspolne.mjs'

const RAD = Math.PI / 180
const PROMIEN_ZIEMI_M = 6_371_000
export const TERYT_KRAKOWA = '1261011'
// Ramka z zapasem wokół Krakowa: współrzędne spoza niej to błąd rejestru, nie obiekt miasta.
const RAMKA = { lon: [19.7, 20.3], lat: [49.9, 50.2] }
const UA = 'adresscore-etl/1.0 (HackYeah 2026; https://github.com/Mati46p/adresscore)'

// PL-2000 strefa 7 (EPSG:2178): układ źródeł MSIP. W Krakowie (ok. 1° od południka osiowego)
// skala różni się od jedności o mniej niż 0,003%, więc odległość euklidesowa w metrach tego układu
// jest praktycznie odległością w linii prostej po elipsoidzie. Sfera (haversine) myliłaby się
// do 0,3% w kierunku wschód-zachód, a przy kilku kandydatach w remisie mogłaby wskazać nie ten obiekt.
proj4.defs(
  'EPSG:2178',
  '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs',
)

/** WGS84 (lon, lat) → metry PL-2000 [x, y]. */
export const rzutPL2000 = (lon, lat) => proj4('EPSG:4326', 'EPSG:2178', [lon, lat])

/** Odległość w linii prostej na sferze (haversine) w metrach – do prostych porównań, nie do wskaźników. */
export function odlegloscMetry(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * RAD
  const dLon = (bLon - aLon) * RAD
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * PROMIEN_ZIEMI_M * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Najbliższy punkt { x, y, ... } (metry PL-2000) od miejsca (x, y). Zbiory mają kilkaset obiektów,
 * więc pełny przegląd jest prostszy w utrzymaniu niż indeks. Pusta lista daje null.
 */
export function najblizszy(x, y, punkty) {
  let trafienie = null
  let minimum = Number.POSITIVE_INFINITY
  for (const p of punkty) {
    const d2 = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d2 < minimum) {
      minimum = d2
      trafienie = p
    }
  }
  return trafienie ? { punkt: trafienie, metry: Math.sqrt(minimum) } : null
}

const MALE_SLOWA = new Set([
  'w',
  'we',
  'z',
  'ze',
  'i',
  'im.',
  'od',
  'na',
  'do',
  'przy',
  'nr',
  'dla',
  'oraz',
  'ul.',
  'al.',
  'pl.',
  'os.',
])

/**
 * Rejestry podają część nazw WIELKIMI LITERAMI („PARK JORDANA"). Zamieniamy je na zwykłą pisownię,
 * nazwy w normalnej pisowni zostają bez zmian. Spacje twarde i podwójne znikają, rejestr ZIS gubi
 * myślnik („Zakrzówek ? akwen"), więc samotny znak zapytania między spacjami wraca jako półpauza.
 * Długie nazwy skracamy do `max` znaków, najchętniej na granicy słowa.
 */
export function czytelnaNazwa(nazwa, max = 60) {
  let n = String(nazwa ?? '')
    .replace(/\s+/g, ' ')
    .replace(/ \? /g, ' – ')
    .trim()
  if (n && n === n.toLocaleUpperCase('pl') && /\p{L}/u.test(n)) {
    n = n
      .toLocaleLowerCase('pl')
      .split(' ')
      .map((s, i) => {
        if (/^[ivxlc]+$/.test(s)) return s.toLocaleUpperCase('pl')
        if (i > 0 && MALE_SLOWA.has(s)) return s
        return s.charAt(0).toLocaleUpperCase('pl') + s.slice(1)
      })
      .join(' ')
  }
  if (n.length <= max) return n
  const ciete = n.slice(0, max - 1)
  const spacja = ciete.lastIndexOf(' ')
  const koniec = spacja > max * 0.6 ? ciete.slice(0, spacja) : ciete
  return `${koniec.replace(/[\s,;:–-]+$/, '')}…`
}

/**
 * Punkty (WGS84) z odpowiedzi ArcGIS REST `f=json&outSR=4326`: punkt albo wielopunkt. Obiekty bez
 * geometrii lub poza ramką Krakowa pomija i liczy. Ucięta odpowiedź (limit rekordów) to błąd –
 * lepiej zatrzymać ETL niż policzyć odległość do niepełnego zbioru.
 */
export function odczytajPunkty(odpowiedz) {
  if (odpowiedz?.error) throw new Error(`ArcGIS: ${JSON.stringify(odpowiedz.error)}`)
  if (!Array.isArray(odpowiedz?.features)) throw new Error('ArcGIS: brak listy obiektów')
  if (odpowiedz.exceededTransferLimit)
    throw new Error('ArcGIS: odpowiedź ucięta limitem rekordów (potrzebna paginacja)')
  const punkty = []
  let pominiete = 0
  for (const f of odpowiedz.features) {
    const g = f.geometry
    const pary = g?.points ?? (g && 'x' in g ? [[g.x, g.y]] : [])
    let dodano = 0
    for (const [lon, lat] of pary) {
      if (
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        lon < RAMKA.lon[0] ||
        lon > RAMKA.lon[1] ||
        lat < RAMKA.lat[0] ||
        lat > RAMKA.lat[1]
      )
        continue
      punkty.push({ lon, lat, atr: f.attributes ?? {} })
      dodano++
    }
    if (!dodano) pominiete++
  }
  return { punkty, pominiete }
}

/** Najpóźniejsza data (ms od epoki) z pola rekordów jako YYYY-MM-DD albo null. */
export function najnowszaData(rekordy, pole) {
  let max = Number.NEGATIVE_INFINITY
  for (const r of rekordy) {
    const v = r[pole]
    if (Number.isFinite(v) && v > max) max = v
  }
  return Number.isFinite(max) ? new Date(max).toISOString().slice(0, 10) : null
}

// --- Pobieranie z cache ------------------------------------------------------------------

const HOSTY_MIEJSKIE = new Set(['msip.um.krakow.pl', 'api.um.krakow.pl'])
const BLEDY_CERTYFIKATU = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
])

/** Pobranie bez weryfikacji certyfikatu, wyłącznie z hostów miejskich (MSIP, API otwartych danych). */
export function pobierzHttps(url) {
  const { hostname } = new URL(url)
  if (!HOSTY_MIEJSKIE.has(hostname))
    throw new Error(`Poluzowany certyfikat tylko dla hostów miejskich: ${hostname}`)
  const agent = new https.Agent({ rejectUnauthorized: false })
  return new Promise((ok, blad) => {
    https
      .get(url, { agent, headers: { 'User-Agent': UA } }, (res) => {
        const kawalki = []
        res.on('data', (k) => kawalki.push(k))
        res.on('end', () => {
          if (res.statusCode !== 200) blad(new Error(`${url} → ${res.statusCode}`))
          else ok(Buffer.concat(kawalki).toString('utf8'))
        })
      })
      .on('error', blad)
  })
}

/**
 * Tekst spod adresu. W Node certyfikat serwerów miejskich bywa odrzucany (brak certyfikatu
 * pośredniego w łańcuchu) – wtedy, i tylko dla hostów MSIP i API miasta, ponawiamy bez weryfikacji.
 */
export async function pobierzTekst(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(60_000),
    })
    if (!r.ok) throw new Error(`${url} → ${r.status}`)
    return await r.text()
  } catch (e) {
    if (!BLEDY_CERTYFIKATU.has(e?.cause?.code)) throw e
    console.warn(
      `Certyfikat ${new URL(url).hostname} odrzucony (${e.cause.code}), ponawiam bez weryfikacji`,
    )
    return pobierzHttps(url)
  }
}

const zapiszWCache = (cel, tekst) => {
  mkdirSync(dirname(cel), { recursive: true })
  writeFileSync(cel, tekst)
}

/** JSON spod adresu, zapisany raz w etl/.cache/uslugi-krakowa/<plik>; drugi bieg nie pyta serwera. */
export async function pobierzJson(url, plik) {
  const cel = join(CACHE, 'uslugi-krakowa', plik)
  if (existsSync(cel)) return JSON.parse(readFileSync(cel, 'utf8'))
  const tekst = await pobierzTekst(url)
  const dane = JSON.parse(tekst)
  // ArcGIS odpowiada błędem w treści z kodem 200 – taki plik nie może trafić do cache.
  if (dane?.error) throw new Error(`${url}: ${JSON.stringify(dane.error)}`)
  zapiszWCache(cel, tekst)
  return dane
}

/** Jak pobierzJson, ale dla tekstu (karta zbioru HTML). */
export async function pobierzTekstZCache(url, plik) {
  const cel = join(CACHE, 'uslugi-krakowa', plik)
  if (existsSync(cel)) return readFileSync(cel, 'utf8')
  const tekst = await pobierzTekst(url)
  zapiszWCache(cel, tekst)
  return tekst
}

// --- Geokodowanie CAS po punktach adresowych projektu -----------------------------------

/** Małe litery bez ogonków: „Łódź" → „lodz". Porównujemy tak nazwy ulic z dwóch rejestrów. */
export function bezOgonkow(s) {
  return String(s ?? '')
    .toLocaleLowerCase('pl')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

/**
 * Klucz ulicy: bez „ul.", z rozwiniętymi skrótami, sklejone „OsiedleTysiąclecia" rozdzielone,
 * myślnik bez spacji („Karaszewicza- Tokarzewskiego" → „karaszewicza-tokarzewskiego").
 */
export function kluczUlicy(ulica) {
  const u = String(ulica ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^ul\.?\s+/i, '')
    .replace(/^al\.\s*/i, 'Aleja ')
    .replace(/^os\.\s*/i, 'Osiedle ')
    .replace(/^pl\.\s*/i, 'Plac ')
    .replace(/^(Osiedle|Aleja|Plac)(?=\p{Lu})/u, '$1 ')
    .replace(/\s*-\s*/g, '-')
  return bezOgonkow(u)
}

/** Klucz numeru budynku: „9a" i „9A" to to samo, spacje nie mają znaczenia. */
export const kluczNumeru = (nr) =>
  String(nr ?? '')
    .replace(/\s+/g, '')
    .toUpperCase()

/**
 * Numer budynku wiersza CAS: pole „Numer budynku", a gdy puste – końcówka pola „Adres"
 * („Rzeźnicza 2a" → 2a, „Kasprowicza 9a/1" → 9a, „28 lipca 1943 17a" → 17a). Bez numeru null.
 */
export function numerBudynku(wiersz) {
  const osobno = String(wiersz['Numer budynku'] ?? '').trim()
  if (osobno) return osobno
  const adres = String(wiersz.Adres ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  const m = /(\d+[A-Za-z]?)(?:[/-]\S*)?$/.exec(adres)
  return m ? (m[1] ?? null) : null
}

/**
 * Klucze numerów do sprawdzenia, od najdokładniejszego: numer budynku („144A"), numer złożony
 * z pola „Adres" w zapisie punktów adresowych („9-15" → „9/15"), numer bez litery („144").
 */
export function numeryDoSprawdzenia(wiersz) {
  const budynek = numerBudynku(wiersz)
  if (!budynek) return []
  const glowny = kluczNumeru(budynek)
  const lista = [glowny]
  const zlozony = /(\d+[A-Za-z]?)\s*[/-]\s*(\d+[A-Za-z]?)\s*$/.exec(
    String(wiersz.Adres ?? '').trim(),
  )
  if (zlozony) lista.push(`${zlozony[1]}/${zlozony[2]}`.toUpperCase())
  const bezLitery = glowny.replace(/[A-Z]+$/, '')
  if (bezLitery) lista.push(bezLitery)
  return [...new Set(lista)]
}

/** Indeks punktów adresowych: klucz ulicy → klucz numeru → punkty { lon, lat, kod, dzielnica }. */
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
    const lista = numery.get(n)
    const punkt = { lon: a.lon, lat: a.lat, kod: a.kod, dzielnica: a.dzielnica }
    if (lista) lista.push(punkt)
    else numery.set(n, [punkt])
  }
  return ulice
}

const slowaUlicy = (klucz) => klucz.split(/[\s.]+/).filter(Boolean)

/** Czy każde słowo zapytania jest początkiem innego słowa nazwy z rejestru („gen" → „generala"). */
function slowaPasuja(zapytanie, nazwa) {
  const wolne = [...nazwa]
  return zapytanie.every((s) => {
    const i = wolne.findIndex((w) => w === s || w.startsWith(s))
    if (i < 0) return false
    wolne.splice(i, 1)
    return true
  })
}

/** Środek kilku punktów tego samego adresu, jeśli leżą blisko siebie; inaczej null (niejednoznaczne). */
function srodekGrupy(punkty) {
  const lon = punkty.reduce((s, p) => s + p.lon, 0) / punkty.length
  const lat = punkty.reduce((s, p) => s + p.lat, 0) / punkty.length
  const rozrzut = Math.max(...punkty.map((p) => odlegloscMetry(lat, lon, p.lat, p.lon)))
  return rozrzut <= 120 ? { lon, lat } : null
}

/** Pierwszy z numerów, który ma punkty na danej ulicy: [numer, punkty] albo null. */
function pierwszyNumer(numeryUlicy, numery) {
  for (const n of numery) {
    const punkty = numeryUlicy?.get(n)
    if (punkty?.length) return [n, punkty]
  }
  return null
}

/**
 * Geokoduje wiersz CAS po ulicy i numerze budynku w indeksie adresów. Najpierw dokładna nazwa
 * ulicy; gdy jej nie ma („Aleja Daszyńskiego" zamiast „Aleja Ignacego Daszyńskiego"), ulica,
 * której nazwa zawiera wszystkie słowa zapytania i ma któryś z numerów – o ile jest dokładnie
 * jedna. Numer: budynek, potem zapis złożony, na końcu bez litery („144A" → „144").
 * Kilka punktów pod jednym numerem rozstrzyga kod pocztowy, potem bliskość.
 * Zwraca { lon, lat, metoda, dzielnica } albo { powod }.
 */
export function geokodujWiersz(wiersz, indeks) {
  const ulica = kluczUlicy(wiersz.Ulica)
  const numery = numeryDoSprawdzenia(wiersz)
  if (!ulica) return { powod: 'brak ulicy' }
  if (!numery.length) return { powod: 'brak numeru budynku' }
  let trafienie = pierwszyNumer(indeks.get(ulica), numery)
  let metoda = 'dokladna ulica'
  if (!trafienie) {
    const slowa = slowaUlicy(ulica)
    const kandydaci = []
    for (const [nazwa, numeryUlicy] of indeks) {
      const t = pierwszyNumer(numeryUlicy, numery)
      if (t && slowaPasuja(slowa, slowaUlicy(nazwa))) kandydaci.push([nazwa, t])
    }
    if (kandydaci.length === 0)
      return { powod: `brak adresu ${String(wiersz.Ulica).trim()} ${numery[0]}` }
    if (kandydaci.length > 1) return { powod: `niejednoznaczna ulica (${kandydaci.length})` }
    trafienie = kandydaci[0]?.[1] ?? null
    metoda = `skrocona nazwa ulicy (${kandydaci[0]?.[0]})`
  }
  if (!trafienie) return { powod: 'brak punktów' }
  const [numer, punkty] = trafienie
  if (numer !== numery[0]) metoda += `, numer ${numer} zamiast ${numery[0]}`
  const kod = String(wiersz['Kod pocztowy'] ?? '').trim()
  const zgodne = kod ? punkty.filter((p) => p.kod === kod) : []
  const wybrane = zgodne.length ? zgodne : punkty
  const srodek = wybrane.length === 1 ? wybrane[0] : srodekGrupy(wybrane)
  if (!srodek) return { powod: 'adres w kilku odległych punktach' }
  return { lon: srodek.lon, lat: srodek.lat, metoda, dzielnica: wybrane[0]?.dzielnica ?? null }
}

/**
 * Punkty CAS z wierszy rejestru. Powtórzone wiersze tego samego miejsca (CAS opisany w dwóch
 * dzielnicach) łączy w jeden punkt. Zwraca { punkty, odrzucone: [{ nazwa, powod }] }.
 */
export function punktyCAS(wiersze, adresy) {
  const indeks = indeksAdresow(adresy)
  const punkty = []
  const odrzucone = []
  const widziane = new Set()
  for (const w of wiersze) {
    const nazwa = czytelnaNazwa(w.Nazwa, 70)
    const g = geokodujWiersz(w, indeks)
    if (g.powod) {
      odrzucone.push({ nazwa, powod: g.powod })
      continue
    }
    const klucz = `${g.lon.toFixed(6)}|${g.lat.toFixed(6)}|${nazwa}`
    if (widziane.has(klucz)) continue
    widziane.add(klucz)
    punkty.push({
      lon: g.lon,
      lat: g.lat,
      etykieta: nazwa,
      atr: {
        dzielnicaRejestru: w.Dzielnica ?? null,
        dzielnicaAdresu: g.dzielnica,
        metoda: g.metoda,
      },
    })
  }
  return { punkty, odrzucone }
}
