// Stacje bazowe telefonii komórkowej (#246): dwa wskaźniki z otwartych danych UKE.
//
//   stacje_bazowe_300m          – liczba lokalizacji stacji bazowych w promieniu 300 m od adresu
//                                 (ten sam wskaźnik co dla Krakowa, z MSIP – patrz srodowisko-msip.mjs)
//   stacje_bazowe_odleglosc     – odległość [m] w linii prostej do najbliższej lokalizacji stacji
//
// Źródło: UKE, „Wykazy pozwoleń radiowych dla stacji bazowych telefonii komórkowej (GSM, UMTS, LTE, 5G)
// oraz stacji wykorzystujących technologię CDMA”, dane.gov.pl, zbiór 1075 (co miesiąc nowy zasób ZIP,
// jeden plik XLSX na pasmo). Wiersz = pozwolenie radiowe dla jednej stacji w jednym paśmie; kolumny:
// operator, nr decyzji, data ważności, długość i szerokość geograficzna (DMS, np. 20E58'40"), miejscowość,
// lokalizacja, IdStacji, TERYT. Dane bez logowania i bez CAPTCHA.
//
// Decyzje (dlaczego):
//  - Ta sama stacja występuje w wielu plikach (pasma) i u wielu operatorów (współdzielone maszty), więc
//    zliczamy lokalizacje: punkty bliższe niż KLASTER_M łączymy w jeden (współrzędne w UKE mają dokładność
//    1 sekundy łuku, ok. 20–30 m, więc ten sam maszt bywa zapisany z rozrzutem). Kraków łączy anteny w 20 m.
//  - Pomijamy sieci specjalne, które nie są publiczną telefonią: GSM-R (kolej), LTE420 i LTE450
//    (sieci energetyczne i przemysłowe), CDMA420. Zostają GSM, UMTS, LTE (700–2600), 5G.
//  - Pozwolenia z datą ważności w przeszłości odrzucamy (stan bieżący, nie archiwum).
//  - Współrzędne to położenie stacji z pozwolenia, nie anten, a wykaz nie mówi o mocy ani kierunku,
//    więc liczba nie oznacza poziomu pola elektromagnetycznego. Wskaźnik „kontekst”, kierunek neutralny.
//  - Dane są ogólnopolskie, więc każdy adres ma wartość (0 w 300 m to prawdziwe zero). Margines wokół
//    obszaru adresów (MARGINES_M) wystarcza, by najbliższa stacja za granicą gminy liczyła się do odległości.
//
// Uruchom: ADRESCORE_MIASTO=redziny node etl/stacje-bazowe.mjs   (pierwszy bieg pobiera ok. 13 MB)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { odlegloscMetry } from './lib/codziennosc-geo.mjs'
import { dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ZASOB = '2718720'
const DATA_ZASOBU = '2026-09-25'
const URL_ZASOBU = `https://api.dane.gov.pl/resources/${ZASOB}/file`
const URL_ZBIORU = 'https://dane.gov.pl/pl/dataset/1075'
const PLIK_CACHE = `uke-stacje-bazowe-${DATA_ZASOBU}.zip`
const LICENCJA =
  'Otwarte dane UKE (dane.gov.pl, zbiór 1075): https://dane.gov.pl/pl/dataset/1075 – wykorzystanie zgodne z warunkami portalu dane.gov.pl'

export const PROMIEN_M = 300
export const KLASTER_M = 40
const MARGINES_M = 5000
const POMIJANE_PASMA = /^(GSM-R|LTE420|LTE450|CDMA420)\b/i
const STOPNIE_NA_M = 111_195

/** Współrzędna UKE w DMS (20E58'40" albo 52N13'47.5") → stopnie dziesiętne; zły zapis daje null. */
export function dmsNaStopnie(tekst) {
  const m = /^\s*(\d{1,3})\s*[EN]\s*(\d{1,2})\s*'\s*(\d{1,2}(?:[.,]\d+)?)\s*"?\s*$/i.exec(
    String(tekst ?? ''),
  )
  if (!m) return null
  const min = Number(m[2])
  const sek = Number(m[3].replace(',', '.'))
  if (min >= 60 || sek >= 60) return null
  return Number(m[1]) + min / 60 + sek / 3600
}

/** Serial daty Excela (dni od 1899-12-30) dla dnia RRRR-MM-DD. */
export function serialExcela(iso) {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000)
}

const xmlTekst = (s) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** Wiersze arkusza XLSX jako obiekty { A: ..., B: ... } (tylko kolumny z `kolumny`). */
export function wierszeArkusza(zip, kolumny) {
  const wspolne = zip['xl/sharedStrings.xml']
    ? [...strFromU8(zip['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(
        (m) => xmlTekst(m[1]),
      )
    : []
  const arkusz = strFromU8(zip['xl/worksheets/sheet1.xml'])
  const wiersze = []
  for (const w of arkusz.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const komorki = {}
    for (const c of w[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const kol = c[1].match(/\br="([A-Z]+)/)?.[1]
      if (!kol || !kolumny.includes(kol)) continue
      const surowa = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      if (surowa !== undefined)
        komorki[kol] = /\bt="s"/.test(c[1]) ? wspolne[Number(surowa)] : surowa
      else {
        const wl = c[2]?.match(/<is>([\s\S]*?)<\/is>/)?.[1]
        if (wl !== undefined) komorki[kol] = xmlTekst(wl)
      }
    }
    wiersze.push(komorki)
  }
  return wiersze
}

/**
 * Łączy punkty { lat, lon } bliższe niż `promien` m w jedną lokalizację (zachłannie, w kolejności
 * danych; środek to pierwszy punkt grupy). Zwraca listę lokalizacji { lat, lon, n }.
 */
export function klasterLokalizacji(punkty, promien = KLASTER_M) {
  const komorka = promien / STOPNIE_NA_M
  const siatka = new Map()
  const wyniki = []
  const klucz = (cx, cy) => `${cx}|${cy}`
  for (const p of punkty) {
    const cx = Math.floor(p.lon / komorka)
    const cy = Math.floor(p.lat / komorka)
    let znaleziona = null
    for (let dx = -2; dx <= 2 && !znaleziona; dx++)
      for (let dy = -2; dy <= 2 && !znaleziona; dy++)
        for (const l of siatka.get(klucz(cx + dx, cy + dy)) ?? [])
          if (odlegloscMetry(p.lat, p.lon, l.lat, l.lon) <= promien) {
            znaleziona = l
            break
          }
    if (znaleziona) znaleziona.n++
    else {
      const l = { lat: p.lat, lon: p.lon, n: 1 }
      wyniki.push(l)
      const k = klucz(cx, cy)
      if (!siatka.has(k)) siatka.set(k, [])
      siatka.get(k).push(l)
    }
  }
  return wyniki
}

/** Odległość do najbliższej lokalizacji i liczba lokalizacji w promieniu dla jednego punktu. */
export function ocenAdres(lat, lon, lokalizacje, promien = PROMIEN_M) {
  let najblizsza = Infinity
  let wPromieniu = 0
  for (const l of lokalizacje) {
    const d = odlegloscMetry(lat, lon, l.lat, l.lon)
    if (d < najblizsza) najblizsza = d
    if (d <= promien) wPromieniu++
  }
  return { odleglosc: najblizsza, wPromieniu }
}

/** Punkty { lat, lon } ważnych pozwoleń z ZIP-a UKE; `okno` = [lonMin, latMin, lonMax, latMax]. */
export function punktyZZip(zipUke, okno, dzisiejszySerial) {
  const punkty = []
  const stat = { plikow: 0, wierszy: 0, wazne: 0, wOknie: 0, pominiete: [] }
  for (const [nazwa, dane] of Object.entries(unzipSync(zipUke))) {
    if (!/\.xlsx$/i.test(nazwa)) continue
    const pasmo = nazwa
      .replace(/\.xlsx$/i, '')
      .split(' - ')[0]
      .trim()
    if (POMIJANE_PASMA.test(pasmo)) {
      stat.pominiete.push(pasmo)
      continue
    }
    stat.plikow++
    for (const w of wierszeArkusza(unzipSync(dane), ['D', 'E', 'F'])) {
      const waznosc = Number(w.D)
      if (!Number.isFinite(waznosc)) continue // nagłówek
      stat.wierszy++
      if (waznosc < dzisiejszySerial) continue
      stat.wazne++
      const lon = dmsNaStopnie(w.E)
      const lat = dmsNaStopnie(w.F)
      if (lon === null || lat === null) continue
      if (lon < okno[0] || lon > okno[2] || lat < okno[1] || lat > okno[3]) continue
      stat.wOknie++
      punkty.push({ lat, lon })
    }
  }
  return { punkty, stat }
}

async function main() {
  const { adresy } = wczytajAdresy()
  const lats = adresy.map((a) => a.lat)
  const lons = adresy.map((a) => a.lon)
  const lat0 = Math.min(...lats)
  const lat1 = Math.max(...lats)
  const lon0 = Math.min(...lons)
  const lon1 = Math.max(...lons)
  const dLat = MARGINES_M / STOPNIE_NA_M
  const dLon = dLat / Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180)
  const okno = [lon0 - dLon, lat0 - dLat, lon1 + dLon, lat1 + dLat]

  const plik = await pobierzDoCache(URL_ZASOBU, PLIK_CACHE)
  const { punkty, stat } = punktyZZip(readFileSync(plik), okno, serialExcela(dzis()))
  const lokalizacje = klasterLokalizacji(punkty)
  console.log(
    `UKE: ${stat.plikow} plików pasm (pominięto ${stat.pominiete.join(', ')}), ${stat.wierszy} pozwoleń, ` +
      `${stat.wazne} ważnych, ${stat.wOknie} w oknie → ${lokalizacje.length} lokalizacji`,
  )
  if (!lokalizacje.length) throw new Error('Brak stacji w oknie – sprawdź format danych UKE')

  const wyniki = adresy.map((a) => ocenAdres(a.lat, a.lon, lokalizacje))
  const meta = [
    {
      nazwa: `UKE – Wykazy pozwoleń radiowych dla stacji bazowych telefonii komórkowej (stan na ${DATA_ZASOBU})`,
      url: URL_ZBIORU,
      licencja: LICENCJA,
      dataDanych: DATA_ZASOBU,
      pobrano: dzis(),
    },
  ]
  const wspolne = `Źródło: wykazy pozwoleń radiowych UKE (GSM, UMTS, LTE, 5G; bez sieci kolejowej i specjalnych). Stacje o współrzędnych bliższych niż ${KLASTER_M} m liczymy jako jedną lokalizację (maszt z kilkoma operatorami i pasmami). To informacja o otoczeniu, nie ocena: wykaz nie podaje mocy, wysokości ani kierunku anten, więc liczba nie mówi o polu elektromagnetycznym w mieszkaniu. Współrzędne w wykazie mają dokładność ok. 30 m.`
  zapiszWskaznik(
    {
      id: 'stacje_bazowe_300m',
      kategoria: 'kontekst',
      nazwa: 'Stacje bazowe telefonii w 300 m',
      opis: `Liczba lokalizacji stacji bazowych telefonii komórkowej w promieniu ${PROMIEN_M} m od adresu; 0 = w tym promieniu nie ma żadnej stacji z wykazu. ${wspolne}`,
      jednostka: 'szt.',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      zakres: [0, 10],
      zadanie: 246,
      zrodla: meta,
    },
    wyniki.map((w) => w.wPromieniu),
  )
  zapiszWskaznik(
    {
      id: 'stacje_bazowe_odleglosc',
      kategoria: 'kontekst',
      nazwa: 'Odległość do stacji bazowej telefonii',
      opis: `Odległość w linii prostej od adresu do najbliższej lokalizacji stacji bazowej telefonii komórkowej. ${wspolne}`,
      jednostka: 'm',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      zakres: [0, 2000],
      zadanie: 246,
      zrodla: meta,
    },
    wyniki.map((w) => Math.round(w.odleglosc / 10) * 10),
  )
  const z = (f) => wyniki.filter(f).length
  console.log(
    `adresów ${adresy.length}: ≥1 stacja w 300 m: ${z((w) => w.wPromieniu >= 1)}, ≤500 m: ${z((w) => w.odleglosc <= 500)}, ≤1 km: ${z((w) => w.odleglosc <= 1000)}`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
