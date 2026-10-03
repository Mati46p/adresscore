// NFZ – Informator o Terminach Leczenia (API Terminy Leczenia) dla flagi `nfz` dentysty (#160).
// NFZ NIE jest tu źródłem punktów: z odpowiedzi API bierzemy wyłącznie położenie miejsc udzielania
// świadczeń stomatologicznych i sprawdzamy, który punkt dentysty z katalogu jest w jego pobliżu.
// Do plików w public/dane trafia sam bit flagi, bez nazw, adresów, współrzędnych i terminów z NFZ.
//
// Licencja i regulamin (sprawdzone 2026-10-03):
//  - metadane zbioru „API Terminy Leczenia" na dane.gov.pl (zbiór 1455): CC BY 4.0,
//  - regulamin API (https://api.nfz.gov.pl/app-itl-api/terms): wymaga wskazania źródła
//    https://api.nfz.gov.pl/, zakazuje modyfikowania danych i przeciążania API (10 zapytań na sekundę
//    z jednego IP). Ponownego udostępniania regulamin nie zakazuje.
// Mimo to publikujemy tylko flagę, a źródło wskazujemy w atrybucji pliku dentysty i w katalog.json.
// Cache w etl/.cache (poza gitem) trzyma wpisy zredukowane do położenia: bez nazw świadczeniodawców,
// NIP, REGON i telefonów.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { czytelnaNazwa, geokoduj, odlegloscMetry } from './codziennosc-geo.mjs'
import { CACHE, dzis } from './wspolne.mjs'

export const NFZ_API = 'https://api.nfz.gov.pl/app-itl-api/queues'
export const NFZ_ZRODLO_URL = 'https://api.nfz.gov.pl/'
/** Kod województwa w API NFZ: 06 to Małopolski Oddział Wojewódzki (oddziały NFZ numerowane są inaczej niż TERYT). */
export const NFZ_WOJEWODZTWO = '06'
/**
 * Fragmenty nazw świadczeń (parametr `benefit`), które tworzą flagę: poradnie stomatologiczne (także dla
 * dzieci, chirurgii i protetyki) oraz ortodontyczne. Kody VIII części tych wpisów (1800, 1801, 1830, 1840,
 * 1820) pokrywają się z kodami RPWDL dentysty w katalogu.
 */
export const NFZ_SWIADCZENIA = ['stomatolog', 'ortodon']
/** Maksymalny rozmiar strony API (większy daje błąd 400). */
export const NFZ_LIMIT_STRONY = 25
/** Pauza między zapytaniami: regulamin dopuszcza 10 na sekundę z jednego IP, my ok. 5. */
const PAUZA_MS = 200
/** Miejsce NFZ i punkt dentysty dalej niż tyle od siebie nie są tym samym miejscem. */
export const PROMIEN_NFZ_M = 50
const PLIK_CACHE = 'nfz-itl-stomatologia-06.json'
const UA = 'adresscore-etl/1.0 (HackYeah 2026; https://github.com/Mati46p/adresscore)'

const pauza = (ms) => new Promise((ok) => setTimeout(ok, ms))

const bezOgonkow = (s) =>
  String(s ?? '')
    .toLocaleLowerCase('pl')
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

// --- Redukcja wpisów ---------------------------------------------------------------------------

/**
 * Wpis kolejki z API → tylko to, co potrzebne do położenia miejsca: miejscowość, adres, TERYT miejsca,
 * kod VIII części, okres sprawozdawczy i współrzędne (null, gdy NFZ ich nie podaje albo wyglądają na
 * błędne). Nazwa świadczeniodawcy, NIP, REGON, telefon i numer księgi odpadają tu, zanim cokolwiek
 * trafi do cache.
 */
export function zredukujWpis(wpis) {
  const a = wpis?.attributes ?? {}
  const lat = a.latitude == null ? Number.NaN : Number(a.latitude)
  const lon = a.longitude == null ? Number.NaN : Number(a.longitude)
  // Polska mieści się w 48,9–55 N i 14,1–24,2 E; wartość spoza ramki to błąd w danych NFZ, nie miejsce.
  const wsp = lat > 48.9 && lat < 55 && lon > 14.1 && lon < 24.2
  return {
    miejscowosc: String(a.locality ?? '').trim(),
    adres: String(a.address ?? '').trim(),
    teryt: a['teryt-place'] ?? null,
    kod8: a['id-resort-part-VIII'] ?? null,
    okres: a.statistics?.['provider-data']?.update ?? null,
    lat: wsp ? lat : null,
    lon: wsp ? lon : null,
  }
}

/**
 * Wpisy kolejek → unikalne miejsca (miejscowość, adres, współrzędne): to samo miejsce ma osobny wpis
 * na każde świadczenie i przypadek. Wynik jest posortowany, więc nie zależy od kolejności wejścia.
 * `kody8` zbiera kody VIII części ze wszystkich wpisów miejsca.
 */
export function miejscaZWpisow(zredukowane) {
  const mapa = new Map()
  for (const w of zredukowane) {
    const klucz = `${w.miejscowosc}|${w.adres}|${w.lat ?? ''}|${w.lon ?? ''}`
    const m = mapa.get(klucz) ?? {
      miejscowosc: w.miejscowosc,
      adres: w.adres,
      teryt: w.teryt,
      lat: w.lat,
      lon: w.lon,
      kody8: new Set(),
      okres: null,
    }
    if (w.kod8) m.kody8.add(w.kod8)
    if (w.okres && (!m.okres || w.okres > m.okres)) m.okres = w.okres
    mapa.set(klucz, m)
  }
  return [...mapa.values()]
    .map((m) => ({ ...m, kody8: [...m.kody8].sort() }))
    .sort((a, b) =>
      `${a.miejscowosc}|${a.adres}|${a.lat}|${a.lon}`.localeCompare(
        `${b.miejscowosc}|${b.adres}|${b.lat}|${b.lon}`,
        'pl',
      ),
    )
}

// --- Pobranie ----------------------------------------------------------------------------------

async function pobierzStrone(url, proby = 4) {
  for (let i = 0; i < proby; i++) {
    try {
      const r = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': UA },
        signal: AbortSignal.timeout(60_000),
      })
      if (r.status === 429 || r.status >= 500) throw new Error(`NFZ API ${r.status}`)
      if (!r.ok) throw new Error(`NFZ API ${r.status}: ${(await r.text()).slice(0, 200)}`)
      return await r.json()
    } catch (e) {
      if (i === proby - 1) throw e
      await pauza(1000 * (i + 1))
    }
  }
  return null
}

/**
 * Wszystkie wpisy kolejek dla świadczenia (fragment nazwy) w województwie, przypadek stabilny. Przypadek
 * pilny (case=2) daje te same miejsca, więc go nie pytamy. Liczba pobranych wpisów musi zgadzać się z
 * `meta.count`, inaczej rzucamy błąd (uciętą listę lepiej zauważyć niż zapisać).
 */
export async function pobierzWpisySwiadczenia(swiadczenie, { pobierz = pobierzStrone } = {}) {
  const wpisy = []
  let meta = null
  for (let strona = 1; ; strona++) {
    const qs = new URLSearchParams({
      page: String(strona),
      limit: String(NFZ_LIMIT_STRONY),
      format: 'json',
      case: '1',
      province: NFZ_WOJEWODZTWO,
      benefit: swiadczenie,
      'api-version': '1.3',
    })
    const j = await pobierz(`${NFZ_API}?${qs}`)
    meta = j.meta
    wpisy.push(...(j.data ?? []))
    if (!j.links?.next || !(j.data ?? []).length) break
    await pauza(PAUZA_MS)
  }
  if (wpisy.length !== Number(meta?.count))
    throw new Error(
      `NFZ „${swiadczenie}": pobrano ${wpisy.length} wpisów, API podaje ${meta?.count} (lista ucięta?)`,
    )
  return { wpisy, dataModyfikacji: String(meta['date-modified'] ?? '').slice(0, 10) || null }
}

/**
 * Miejsca świadczeń stomatologicznych NFZ w województwie: { miejsca, meta }. Pierwsze wywołanie pyta API
 * (kilkadziesiąt zapytań), kolejne czytają etl/.cache/nfz-itl-stomatologia-06.json; odświeżenie = usunięcie pliku.
 */
export async function miejscaNfz({ cache = CACHE, pobierz } = {}) {
  const plik = join(cache, PLIK_CACHE)
  if (existsSync(plik)) return JSON.parse(readFileSync(plik, 'utf8'))
  const zredukowane = []
  let dataModyfikacji = null
  let zapytan = 0
  for (const swiadczenie of NFZ_SWIADCZENIA) {
    const r = await pobierzWpisySwiadczenia(swiadczenie, { pobierz })
    zredukowane.push(...r.wpisy.map(zredukujWpis))
    zapytan += Math.ceil(r.wpisy.length / NFZ_LIMIT_STRONY)
    if (r.dataModyfikacji && (!dataModyfikacji || r.dataModyfikacji > dataModyfikacji))
      dataModyfikacji = r.dataModyfikacji
  }
  const okresy = zredukowane.map((w) => w.okres).filter(Boolean)
  const wynik = {
    meta: {
      pobrano: dzis(),
      dataDanych: dataModyfikacji,
      okresOd: okresy.length ? okresy.reduce((a, b) => (a < b ? a : b)) : null,
      okresDo: okresy.length ? okresy.reduce((a, b) => (a > b ? a : b)) : null,
      swiadczenia: NFZ_SWIADCZENIA,
      wpisow: zredukowane.length,
      zapytan,
    },
    miejsca: miejscaZWpisow(zredukowane),
  }
  mkdirSync(cache, { recursive: true })
  const tmp = `${plik}.tmp`
  writeFileSync(tmp, JSON.stringify(wynik))
  renameSync(tmp, plik)
  return wynik
}

// --- Położenie miejsca -------------------------------------------------------------------------

/**
 * Numer domu na końcu adresu: ostatnia liczba z opcjonalną literą. Zakres („35-37"), lokal („38/219")
 * i druga litera („80 C-D") pomijamy, bo PRG zna pojedynczy numer. Początek jest zachłanny, żeby ulica
 * z liczbą w nazwie („1 Maja", „29 Listopada") nie zjadła numeru.
 */
const NUMER = /^(.*)[\s,]+(\d+)\s*([A-Za-z]{0,3})\b(?:\s*[-/]\s*[A-Za-z0-9]{1,4})?$/

/**
 * „UL. STEFANA ŻEROMSKIEGO 2" → { ulica: „Stefana Żeromskiego", nr: „2" }, wieś bez ulicy
 * („OTFINÓW 237", miejscowość OTFINÓW) → { ulica: „", nr: „237" }. Nazwy WIELKIMI LITERAMI
 * (tak pisze NFZ) zamieniamy na zwykłą pisownię, bo rejestry i PRG piszą ulice normalnie.
 */
export function rozbijAdres(adres, miejscowosc = '') {
  const tekst = String(adres ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s+BUD\.?\s.*$/i, '')
    .trim()
  const m = NUMER.exec(tekst)
  if (!m) return { ulica: '', nr: '' }
  // NFZ pisze „UL. UL. 1 - GO MAJA", a geokoder zna tylko jeden przedrostek (ul. zdejmujemy, al. i os. zostają).
  // „1 - GO MAJA" to ulica 1 Maja: przyrostek porządkowy po liczbie nie należy do nazwy w PRG.
  let ulica = m[1]
    .replace(/^(?:ul\.?\s+)+/i, '')
    .replace(/(\d)\s*-\s*go\b/gi, '$1')
    .trim()
  // Wieś numerowana: „adres" zaczyna się od nazwy miejscowości, a ulicy nie ma.
  if (!ulica || bezOgonkow(ulica) === bezOgonkow(miejscowosc)) ulica = ''
  return { ulica: czytelnaNazwa(ulica, 100), nr: `${m[2]}${m[3]}` }
}

/**
 * Położenie miejsc. Każde miejsce ma `pozycje`: własne współrzędne NFZ (jeśli je podaje) i adres
 * geokodowany usługą UUG jak rejestry w #8 (jeśli geokoder go zna). Obie, bo każda zawodzi gdzie
 * indziej: NFZ bywa w złym miejscu (do kilkuset kilometrów), a UUG nie zna części adresów. Adres
 * geokodowany tą samą usługą co adresy RPWDL daje to samo położenie dla tego samego adresu, więc ta
 * pozycja pełni rolę dopasowania „po adresie". Dla miejsc z obiema pozycjami `rozbieznoscM` to
 * odległość między nimi (kontrola jakości progu dopasowania).
 */
export async function ustalPolozenie(miejsca, { geokoduj: geo = geokoduj } = {}) {
  const adresy = miejsca.map((m) => {
    const { ulica, nr } = rozbijAdres(m.adres, m.miejscowosc)
    return { miejscowosc: czytelnaNazwa(m.miejscowosc, 100), ulica, nr, kod: null }
  })
  const wsp = await geo(adresy)
  return miejsca.map((m, i) => {
    const adres = wsp[i] ?? null
    const pozycje = []
    if (m.lat != null && m.lon != null) pozycje.push({ lat: m.lat, lon: m.lon, zrodlo: 'nfz' })
    if (adres) pozycje.push({ lat: adres.lat, lon: adres.lon, zrodlo: 'adres' })
    const rozbieznoscM =
      pozycje.length === 2
        ? Math.round(odlegloscMetry(pozycje[0].lat, pozycje[0].lon, pozycje[1].lat, pozycje[1].lon))
        : null
    return { ...m, pozycje, rozbieznoscM }
  })
}

/**
 * Kontrola jakości położenia: dla miejsc z obiema pozycjami (NFZ i adres) ile leży w `promienM` od siebie
 * i jaka jest mediana odległości. Wysoka zgodność znaczy, że próg dopasowania nie zależy od wyboru pozycji.
 */
export function kontrolaPolozenia(miejsca, { promienM = PROMIEN_NFZ_M } = {}) {
  const odleglosci = miejsca
    .map((m) => m.rozbieznoscM)
    .filter((x) => x != null)
    .sort((a, b) => a - b)
  return {
    zObiemaPozycjami: odleglosci.length,
    zgodnychWPromieniu: odleglosci.filter((x) => x <= promienM).length,
    medianaM: odleglosci.length ? odleglosci[Math.floor(odleglosci.length / 2)] : null,
  }
}

// --- Dopasowanie do punktów dentysty ------------------------------------------------------------

const M_NA_STOPIEN = (6_371_000 * Math.PI) / 180
const COS0 = Math.cos((50.06 * Math.PI) / 180)
const plaskiX = (lon) => (lon - 19.9) * COS0 * M_NA_STOPIEN
const plaskiY = (lat) => (lat - 50.06) * M_NA_STOPIEN
const KLUCZ = (cx, cy) => cx * 200_003 + cy

/**
 * Oznacza flagą `nfz` punkty dentysty, przy których leży miejsce z Informatora. Dla każdego miejsca
 * (z `pozycje`: własne współrzędne NFZ i/lub adres geokodowany) bierzemy punkty w promieniu `promienM`
 * od którejkolwiek pozycji i wybieramy JEDEN: najbliższy z rejestru
 * (świadczeniodawca z umową NFZ jest zawsze w RPWDL, więc punkt rejestru to ten właściwy), a gdy
 * rejestru w pobliżu nie ma – najbliższy w ogóle. Jeden punkt na miejsce, bo kilka gabinetów w jednym
 * budynku nie ma umowy tylko dlatego, że ma ją sąsiad. Flaga przechodzi na cały klaster po deduplikacji
 * (flagi punktów łączą się w sumę), więc dotyczy też punktów OSM i Overture tego samego gabinetu.
 *
 * `punkty`: { zrodlo, lat, lon, flagi[] }. Nie zmienia wejścia. Zwraca { punkty, statystyki, dopasowania },
 * gdzie `dopasowania` to pary indeksów { miejsce, punkt, metry } (do kontroli i testów).
 */
export function oznaczNfz(punkty, miejsca, { promienM = PROMIEN_NFZ_M, flaga = 'nfz' } = {}) {
  const wynik = punkty.map((p) => ({ ...p, flagi: [...(p.flagi ?? [])] }))
  const siatka = new Map()
  wynik.forEach((p, i) => {
    const klucz = KLUCZ(
      Math.floor(plaskiX(p.lon) / promienM),
      Math.floor(plaskiY(p.lat) / promienM),
    )
    if (siatka.has(klucz)) siatka.get(klucz).push(i)
    else siatka.set(klucz, [i])
  })
  const stat = {
    miejsc: miejsca.length,
    zPolozeniem: 0,
    dopasowanych: 0,
    wybranychZRejestru: 0,
    bezPunktuWPoblizu: 0,
  }
  const dopasowania = []
  for (const m of miejsca) {
    const pozycje = m.pozycje ?? []
    if (!pozycje.length) continue
    stat.zPolozeniem++
    let najlepszy = null
    for (const poz of pozycje) {
      const cx = Math.floor(plaskiX(poz.lon) / promienM)
      const cy = Math.floor(plaskiY(poz.lat) / promienM)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const i of siatka.get(KLUCZ(cx + dx, cy + dy)) ?? []) {
            const d = odlegloscMetry(poz.lat, poz.lon, wynik[i].lat, wynik[i].lon)
            if (d > promienM) continue
            const rejestr = wynik[i].zrodlo === 'rejestr'
            // Rejestr wygrywa z nierejestrem niezależnie od odległości (w granicach promienia), potem
            // najbliższy; remis rozstrzyga kolejność wejścia, więc wynik jest deterministyczny.
            if (
              !najlepszy ||
              (rejestr && !najlepszy.rejestr) ||
              (rejestr === najlepszy.rejestr && d < najlepszy.d)
            )
              najlepszy = { i, d, rejestr }
          }
    }
    if (!najlepszy) {
      stat.bezPunktuWPoblizu++
      continue
    }
    stat.dopasowanych++
    if (najlepszy.rejestr) stat.wybranychZRejestru++
    if (!wynik[najlepszy.i].flagi.includes(flaga)) wynik[najlepszy.i].flagi.push(flaga)
    dopasowania.push({
      miejsce: miejsca.indexOf(m),
      punkt: najlepszy.i,
      metry: Math.round(najlepszy.d),
    })
  }
  return { punkty: wynik, statystyki: stat, dopasowania }
}
