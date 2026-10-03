// Koleje Małopolskie (GTFS): stacje kolejowe SKA i przystanki busów MLD → odległość w linii prostej
// do najbliższego czynnego punktu oraz kursy w porannym szczycie. Cztery wskaźniki: kolej_odleglosc,
// kolej_kursy_szczyt_h, bus_mld_odleglosc, bus_mld_kursy_szczyt_h (zadanie #111).
// Uruchom: node etl/kolej-km.mjs [YYYY-MM-DD] [--odswiez]. Bez daty liczy dla najbliższej środy
// (dziś, gdy jest środa). Surowe ZIP-y trafiają jednorazowo do etl/.cache/kolej-km/; --odswiez
// pobiera je ponownie. Opis metody, licencja i ograniczenia: etl/kolej-km.md.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { csv, indeksPrzystankow, odlegloscMetry } from './gtfs-przystanki.mjs'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const KATALOG = join(CACHE, 'kolej-km')
const INDEKS_URL = 'https://gtfs.kolejemalopolskie.com.pl/'
const LICENCJA =
  'Zasady ponownego wykorzystywania danych GTFS Kolei Małopolskich (ustawa z 11.08.2021 o otwartych danych): bezpłatnie, z podaniem spółki jako źródła, daty pozyskania danych i informacją o przetworzeniu; bez sugerowania, że spółka zatwierdza wynik. https://bip.malopolska.pl/malopolskiekoleje,a,2934167,zasady-udostepniania-i-ponownego-wykorzystywania-danych-gtfs.html'
// Zasady KM wymagają informacji o przetworzeniu, więc zdanie trafia do opisu każdej warstwy.
const PRZETWORZENIE =
  ' Wartość obliczona przez adresscore z rozkładu GTFS Kolei Małopolskich (dane przetworzone, nie są danymi źródłowymi spółki).'
const DNI = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const RAD = Math.PI / 180
const SZCZYT_OD = 7 * 3600
const SZCZYT_DO = 9 * 3600
const GODZIN_SZCZYTU = (SZCZYT_DO - SZCZYT_OD) / 3600
const MAX_PROMIEN = 60_000
const TERYT_KRAKOW = '1261011'

/**
 * Dwa feedy z gtfs.kolejemalopolskie.com.pl. Busy MLD biorą świeży GTFS.zip z sekcji „MLD”
 * (R&G PLUS, zgodny z GTFS-RT), a nie ald-gtfs.zip: ten ma stan z 2026-08-31 i nie zna linii
 * A73 (Skawina), A67 (Kocmyrzów-Luborzyca) ani A74, uruchomionych po tej dacie (etl/kolej-km.md).
 */
export const FEEDY = [
  {
    klucz: 'kolej',
    plik: 'kml-ska-gtfs.zip',
    url: 'https://kolejemalopolskie.com.pl/rozklady_jazdy/kml-ska-gtfs.zip',
    indeksParam: 'L2hvbWUvYnByb2cvcm96a2xhZHlfamF6ZHkva21sLXNrYS1ndGZzLnppcA%3D%3D',
    opis: 'rozkład kolejowy SKA',
  },
  {
    klucz: 'mld',
    plik: 'mld-gtfs-rg.zip',
    url: `${INDEKS_URL}?download=L2hvbWUvcmdfdXNlci9yZ191c2VyL0dURlMtU1QvR1RGUy56aXA%3D`,
    indeksParam: 'L2hvbWUvcmdfdXNlci9yZ191c2VyL0dURlMtU1QvR1RGUy56aXA%3D',
    opis: 'rozkład autobusowy MLD',
  },
]

const PLIKI_GTFS = new Set([
  'stops.txt',
  'trips.txt',
  'stop_times.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'feed_info.txt',
])

const sha256 = (bufor) => createHash('sha256').update(bufor).digest('hex')

/** Data kalendarzowa w Europe/Warsaw jako YYYY-MM-DD. */
export function dataLokalna(data = new Date()) {
  const czesci = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(data)
  const pole = (nazwa) => czesci.find((czesc) => czesc.type === nazwa).value
  return `${pole('year')}-${pole('month')}-${pole('day')}`
}

/** Najbliższa środa od podanego dnia włącznie: dzień pomiaru szczytu (jak w warstwach ZTP). */
export function najblizszaSroda(data) {
  const dzien = new Date(`${data}T12:00:00Z`)
  if (Number.isNaN(dzien.getTime())) throw new Error(`Niepoprawna data: ${data}`)
  dzien.setUTCDate(dzien.getUTCDate() + ((3 - dzien.getUTCDay() + 7) % 7))
  return dzien.toISOString().slice(0, 10)
}

/** „HH:MM:SS” z godziną > 24 dla kursów po północy → sekundy od północy albo null. */
export function sekundyDnia(czas) {
  const m = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec((czas ?? '').trim())
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

/**
 * Usługi aktywne danego dnia. Feed SKA nie ma calendar.txt (same daty w calendar_dates.txt,
 * exception_type=1), więc oba pliki są opcjonalne, ale co najmniej jeden musi istnieć.
 */
export function uslugiDnia(pliki, data, etykieta = 'GTFS') {
  const dzienTygodnia = DNI[new Date(`${data}T12:00:00Z`).getUTCDay()]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !dzienTygodnia)
    throw new Error(`${etykieta}: niepoprawna data ${data}`)
  if (!pliki['calendar.txt'] && !pliki['calendar_dates.txt'])
    throw new Error(`${etykieta}: brak calendar.txt i calendar_dates.txt`)
  const dzien = data.replaceAll('-', '')
  const uslugi = new Set()
  if (pliki['calendar.txt'])
    for (const w of csv(strFromU8(pliki['calendar.txt'])))
      if (w.start_date <= dzien && w.end_date >= dzien && w[dzienTygodnia] === '1')
        uslugi.add(w.service_id)
  if (pliki['calendar_dates.txt'])
    for (const w of csv(strFromU8(pliki['calendar_dates.txt']))) {
      if (w.date !== dzien) continue
      if (w.exception_type === '1') uslugi.add(w.service_id)
      if (w.exception_type === '2') uslugi.delete(w.service_id)
    }
  if (!uslugi.size) throw new Error(`${etykieta}: brak aktywnych usług na ${data}`)
  return uslugi
}

/**
 * Odjazdy, z których można wsiąść: ostatni przystanek kursu to tylko przyjazd, pickup_type=1
 * wyklucza wsiadanie. pickup_type=3 (na żądanie, tak oznacza R&G przystanki MLD) wsiadanie
 * dopuszcza. Szczyt to 07:00–09:00 (od włącznie, do wyłącznie) według czasu odjazdu.
 * Zwraca Map(stop_id → { dzien, szczyt }) i liczbę odrzuconych wierszy z błędnym czasem.
 */
export function odjazdyPrzystankow(wiersze, kursy) {
  const poKursie = new Map()
  for (const w of wiersze) {
    if (!kursy.has(w.trip_id)) continue
    let lista = poKursie.get(w.trip_id)
    if (!lista) poKursie.set(w.trip_id, (lista = []))
    lista.push(w)
  }
  const odjazdy = new Map()
  let odrzucone = 0
  for (const lista of poKursie.values()) {
    lista.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence))
    lista.pop()
    for (const w of lista) {
      if (w.pickup_type === '1') continue
      const sekundy = sekundyDnia(w.departure_time || w.arrival_time)
      if (sekundy === null) {
        odrzucone++
        continue
      }
      const licznik = odjazdy.get(w.stop_id) ?? { dzien: 0, szczyt: 0 }
      licznik.dzien++
      if (sekundy >= SZCZYT_OD && sekundy < SZCZYT_DO) licznik.szczyt++
      odjazdy.set(w.stop_id, licznik)
    }
  }
  return { odjazdy, odrzucone }
}

/**
 * Czynne punkty wsiadania danego dnia. `grupa` to stacja nadrzędna (parent_station) albo sam
 * punkt: kursy w szczycie liczymy dla całego zespołu przystankowego, w obie strony.
 */
export function odczytajFeed(bufor, data, etykieta = 'GTFS') {
  let pliki
  try {
    pliki = unzipSync(bufor, { filter: ({ name }) => PLIKI_GTFS.has(name) })
  } catch (blad) {
    throw new Error(`${etykieta}: niekompletny lub uszkodzony ZIP: ${blad.message}`)
  }
  for (const nazwa of ['stops.txt', 'trips.txt', 'stop_times.txt'])
    if (!pliki[nazwa]) throw new Error(`${etykieta}: brak ${nazwa}`)
  const informacje = pliki['feed_info.txt'] ? (csv(strFromU8(pliki['feed_info.txt']))[0] ?? {}) : {}
  const uslugi = uslugiDnia(pliki, data, etykieta)
  const kursy = new Set(
    csv(strFromU8(pliki['trips.txt']))
      .filter((w) => uslugi.has(w.service_id))
      .map((w) => w.trip_id),
  )
  if (!kursy.size) throw new Error(`${etykieta}: brak kursów na ${data}`)
  const { odjazdy, odrzucone } = odjazdyPrzystankow(csv(strFromU8(pliki['stop_times.txt'])), kursy)

  const punkty = []
  const grupy = new Map()
  let wszystkich = 0
  for (const p of csv(strFromU8(pliki['stops.txt']))) {
    // Stacje (1), wejścia (2), węzły (3) i strefy (4) nie są miejscem wsiadania.
    if (p.location_type && p.location_type !== '0') continue
    wszystkich++
    const lat = Number(p.stop_lat)
    const lon = Number(p.stop_lon)
    const licznik = odjazdy.get(p.stop_id)
    if (
      !licznik ||
      !p.stop_lat ||
      !p.stop_lon ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180 ||
      (lat === 0 && lon === 0)
    )
      continue
    const grupa = p.parent_station || p.stop_id
    punkty.push({
      id: p.stop_id,
      grupa,
      nazwa: p.stop_name,
      lat,
      lon,
      odjazdyDnia: licznik.dzien,
      odjazdySzczyt: licznik.szczyt,
    })
    const suma = grupy.get(grupa) ?? { odjazdyDnia: 0, odjazdySzczyt: 0 }
    suma.odjazdyDnia += licznik.dzien
    suma.odjazdySzczyt += licznik.szczyt
    grupy.set(grupa, suma)
  }
  if (!punkty.length) throw new Error(`${etykieta}: brak czynnych punktów wsiadania na ${data}`)
  return {
    informacje,
    punkty,
    grupy,
    statystyki: { kursy: kursy.size, punktowWFeedzie: wszystkich, odrzuconeCzasy: odrzucone },
  }
}

/** Najbliższy punkt w linii prostej; szuka adaptacyjnie i kończy, gdy trafienie leży w kole. */
export function najblizszyPunkt(adres, punkty, indeks, maxPromien = MAX_PROMIEN) {
  if (!Number.isFinite(adres.lat) || !Number.isFinite(adres.lon) || !punkty.length) return null
  for (let promien = 500; ; promien *= 2) {
    const r = Math.min(promien, maxPromien)
    const deltaLat = r / 110_500
    const cos = Math.cos((Math.abs(adres.lat) + deltaLat) * RAD)
    const deltaLon = r / (110_500 * Math.max(cos, 0.01))
    let trafienie = null
    let minimum = Number.POSITIVE_INFINITY
    for (const i of indeks.range(
      adres.lon - deltaLon,
      adres.lat - deltaLat,
      adres.lon + deltaLon,
      adres.lat + deltaLat,
    )) {
      const metry = odlegloscMetry(adres.lat, adres.lon, punkty[i].lat, punkty[i].lon)
      if (metry < minimum) {
        minimum = metry
        trafienie = punkty[i]
      }
    }
    if (minimum <= r) return { punkt: trafienie, metry: minimum }
    if (r >= maxPromien) return null
  }
}

/** Dla każdego adresu: odległość (m) do najbliższego czynnego punktu i kursy/h jego zespołu. */
export function liczWarstwe(adresy, feed) {
  const indeks = indeksPrzystankow(feed.punkty)
  const odleglosc = []
  const kursy = []
  const trafienia = []
  for (const adres of adresy) {
    const w = najblizszyPunkt(adres, feed.punkty, indeks)
    trafienia.push(w)
    odleglosc.push(w ? Math.round(w.metry) : null)
    kursy.push(w ? (feed.grupy.get(w.punkt.grupa)?.odjazdySzczyt ?? 0) / GODZIN_SZCZYTU : null)
  }
  return { odleglosc, kursy, trafienia }
}

/** Data „aktualizacja:” z listy plików na stronie gtfs.kolejemalopolskie.com.pl dla danego linku. */
export function dataAktualizacjiZIndeksu(html, param) {
  const poz = html.indexOf(`?download=${param}`)
  if (poz < 0) return null
  const przed = html.slice(Math.max(0, poz - 800), poz)
  return [...przed.matchAll(/aktualizacja:\s*(\d{4}-\d{2}-\d{2})/g)].at(-1)?.[1] ?? null
}

/** Data GTFS (YYYYMMDD) → YYYY-MM-DD albo null. */
export function dataIso(data) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(data ?? '')
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** Stan danych: Last-Modified, a gdy go brak, data z indeksu, a na końcu początek ważności feedu. */
export function wybierzDateDanych({ lastModified, dataIndeksu, poczatekWaznosci }) {
  const modyfikacja = lastModified ? new Date(lastModified) : null
  if (modyfikacja && !Number.isNaN(modyfikacja.getTime())) return dataLokalna(modyfikacja)
  const data = dataIndeksu || dataIso(poczatekWaznosci)
  if (!data) throw new Error('Brak daty stanu GTFS (Last-Modified, indeks, feed_start_date)')
  return data
}

async function pobierzIndeks() {
  try {
    const odpowiedz = await fetch(INDEKS_URL, { signal: AbortSignal.timeout(30_000) })
    return odpowiedz.ok ? await odpowiedz.text() : ''
  } catch {
    return ''
  }
}

/** Pobiera ZIP raz do etl/.cache/kolej-km/ z sumą SHA-256 i datą pobrania obok (plik.json). */
async function pobierzFeed(feed, odswiez) {
  mkdirSync(KATALOG, { recursive: true })
  const cel = join(KATALOG, feed.plik)
  const metaplik = `${cel}.json`
  if (!odswiez && existsSync(cel) && existsSync(metaplik)) {
    try {
      const bufor = readFileSync(cel)
      const meta = JSON.parse(readFileSync(metaplik, 'utf8'))
      if (bufor.length === meta.bajty && sha256(bufor) === meta.sha256) return { bufor, ...meta }
    } catch {
      /* uszkodzony cache trzeba pobrać ponownie */
    }
  }
  let ostatniBlad
  for (let proba = 1; proba <= 3; proba++) {
    try {
      const odpowiedz = await fetch(feed.url, { signal: AbortSignal.timeout(120_000) })
      if (!odpowiedz.ok) throw new Error(`HTTP ${odpowiedz.status}`)
      const bufor = Buffer.from(await odpowiedz.arrayBuffer())
      const oczekiwane = Number(odpowiedz.headers.get('content-length'))
      if (oczekiwane && bufor.length !== oczekiwane)
        throw new Error(`ucięte pobranie: ${bufor.length}/${oczekiwane} B`)
      unzipSync(bufor, { filter: ({ name }) => name === 'feed_info.txt' }) // sprawdza katalog ZIP
      const indeks = await pobierzIndeks()
      const meta = {
        bajty: bufor.length,
        sha256: sha256(bufor),
        lastModified: odpowiedz.headers.get('last-modified'),
        dataIndeksu: dataAktualizacjiZIndeksu(indeks, feed.indeksParam),
        pobrano: dzis(),
      }
      writeFileSync(`${cel}.tmp`, bufor)
      renameSync(`${cel}.tmp`, cel)
      writeFileSync(metaplik, JSON.stringify(meta))
      return { bufor, ...meta }
    } catch (blad) {
      rmSync(`${cel}.tmp`, { force: true })
      ostatniBlad = blad
      console.warn(`GTFS KM ${feed.plik}, próba ${proba}/3: ${blad.message}`)
      if (proba < 3) await new Promise((resolve) => setTimeout(resolve, proba * 1000))
    }
  }
  throw new Error(
    `GTFS KM ${feed.plik}: nie udało się pobrać poprawnego archiwum: ${ostatniBlad.message}`,
  )
}

function zrodloMeta(feed, pobrane, dane) {
  const i = dane.informacje
  const poczatek = dataIso(i.feed_start_date)
  const koniec = dataIso(i.feed_end_date)
  const waznosc = poczatek && koniec ? `; ważny ${poczatek} – ${koniec}` : ''
  return {
    nazwa: `Koleje Małopolskie sp. z o.o. – ${feed.opis} GTFS (${feed.plik}; wydawca w feed_info: ${i.feed_publisher_name || 'nie podano'}; wersja ${i.feed_version || 'bez numeru'}${waznosc}; SHA-256 ${pobrane.sha256.slice(0, 12)})`,
    url: feed.url,
    licencja: LICENCJA,
    dataDanych: wybierzDateDanych({
      lastModified: pobrane.lastModified,
      dataIndeksu: pobrane.dataIndeksu,
      poczatekWaznosci: i.feed_start_date,
    }),
    // Cache żyje między dniami, więc liczy się dzień faktycznego pobrania ZIP-a, nie dzień ETL.
    pobrano: pobrane.pobrano,
  }
}

/** Mediana i 95. percentyl z niepustych wartości. */
function rozklad(wartosci) {
  const z = wartosci.filter((v) => v !== null).sort((a, b) => a - b)
  if (!z.length) return null
  const q = (p) => z[Math.min(z.length - 1, Math.floor(p * (z.length - 1) + 0.5))]
  return { n: z.length, mediana: q(0.5), p95: q(0.95), max: z.at(-1) }
}

function podsumuj(nazwa, wartosci, adresy) {
  const krakow = wartosci.filter((_, i) => adresy[i].teryt === TERYT_KRAKOW)
  const obwarzanek = wartosci.filter((_, i) => adresy[i].teryt !== TERYT_KRAKOW)
  const opis = (r, n) =>
    r
      ? `${r.n}/${n} z wartością, mediana ${r.mediana}, p95 ${r.p95}, max ${r.max}`
      : `0/${n} z wartością`
  console.log(`${nazwa} | Kraków: ${opis(rozklad(krakow), krakow.length)}`)
  console.log(`${nazwa} | obwarzanek: ${opis(rozklad(obwarzanek), obwarzanek.length)}`)
}

/** Znane miejsca do ręcznej kontroli wyników (miejscowość, ulica, numer w adresy.json). */
const KONTROLA = [
  { miejscowosc: 'Kraków', ulica: 'Rynek Główny', nr: '10' },
  { miejscowosc: 'Kraków', ulica: 'Pawia', nr: '5' },
  { miejscowosc: 'Kraków', ulica: 'Wielicka', nr: '256' },
  { miejscowosc: 'Wieliczka', ulica: 'Rynek Górny', nr: '7' },
  { miejscowosc: 'Skawina', ulica: 'Rynek', nr: '2' },
  { miejscowosc: 'Niepołomice', ulica: 'Rynek', nr: '19' },
  { miejscowosc: 'Zabierzów', ulica: 'Krakowska', nr: '22' },
  { miejscowosc: 'Kocmyrzów', ulica: 'Na Błonie', nr: '6' },
  { miejscowosc: 'Mogilany', ulica: 'Zakopiańska', nr: '66' },
]

function kontrola(adresy, wyniki) {
  console.log('Kontrola na znanych miejscach:')
  for (const k of KONTROLA) {
    const i = adresy.findIndex(
      (a) =>
        a.miejscowosc === k.miejscowosc &&
        (k.ulica === null ? !a.ulica : a.ulica === k.ulica) &&
        a.nr === k.nr,
    )
    if (i < 0) {
      console.log(`  ${k.miejscowosc} ${k.ulica ?? ''} ${k.nr}: brak w adresach`)
      continue
    }
    const opisz = (w, kursy) =>
      w ? `${w.punkt.nazwa} ${Math.round(w.metry)} m, ${kursy} kursów/h` : 'brak'
    const { kolej, mld } = wyniki
    console.log(
      `  ${k.miejscowosc} ${k.ulica ?? ''} ${k.nr}: kolej ${opisz(kolej.trafienia[i], kolej.kursy[i])}; MLD ${opisz(mld.trafienia[i], mld.kursy[i])}`,
    )
  }
}

export async function generuj({ data = najblizszaSroda(dataLokalna()), odswiez = false } = {}) {
  const { adresy } = wczytajAdresy()
  const dane = {}
  const zrodla = {}
  const wyniki = {}
  for (const feed of FEEDY) {
    const pobrane = await pobierzFeed(feed, odswiez)
    const wczytane = odczytajFeed(pobrane.bufor, data, feed.plik)
    dane[feed.klucz] = wczytane
    zrodla[feed.klucz] = zrodloMeta(feed, pobrane, wczytane)
    wyniki[feed.klucz] = liczWarstwe(adresy, wczytane)
    console.log(
      `GTFS ${feed.klucz}: ${wczytane.punkty.length} czynnych punktów z ${wczytane.statystyki.punktowWFeedzie} w feedzie, ${wczytane.statystyki.kursy} kursów w dniu ${data}, ${wczytane.statystyki.odrzuconeCzasy} odrzuconych czasów, SHA-256 ${pobrane.sha256}`,
    )
  }

  const wspolne = { kategoria: 'transport', rozdzielczosc: 'adres', zadanie: 111 }
  const kolej = wyniki.kolej
  const mld = wyniki.mld
  zapiszWskaznik(
    {
      ...wspolne,
      id: 'kolej_odleglosc',
      nazwa: 'Najbliższa stacja kolejowa',
      opis: `Odległość geodezyjna w linii prostej do najbliższej stacji lub przystanku kolejowego, z którego odjeżdża pociąg Kolei Małopolskich (SKA i połączenia regionalne) w środę ${data} (rozkład GTFS). Liczone są punkty z możliwością wsiadania; ostatni przystanek kursu nie jest odjazdem. To nie jest długość dojścia ani czas dojazdu. Brak pociągów innych przewoźników (PKP Intercity, Polregio). Odległość powyżej 5 km (górna granica zakresu warstwy, dalej wszystkie adresy są oceniane tak samo) oznacza brak stacji w zasięgu pieszym lub rowerowym, a nie brak danych.${PRZETWORZENIE}`,
      jednostka: 'm',
      kierunek: 'mniej-lepiej',
      zakres: [0, 5000],
      zrodla: [zrodla.kolej],
    },
    kolej.odleglosc,
  )
  zapiszWskaznik(
    {
      ...wspolne,
      id: 'kolej_kursy_szczyt_h',
      nazwa: 'Pociągi w porannym szczycie',
      opis: `Średnia liczba planowych odjazdów pociągów Kolei Małopolskich na godzinę z najbliższej stacji (tej samej co dla odległości) między 07:00 a 09:00 w środę ${data}, w obie strony łącznie. To częstotliwość jednej stacji, nie gwarancja faktycznego kursu; stacja może leżeć daleko od adresu, więc ocenia się ją razem z odległością. 0 oznacza stację bez odjazdów w tym oknie.${PRZETWORZENIE}`,
      jednostka: 'kursy/h',
      kierunek: 'wiecej-lepiej',
      zakres: [0, 8],
      zrodla: [zrodla.kolej],
    },
    kolej.kursy,
  )
  zapiszWskaznik(
    {
      ...wspolne,
      id: 'bus_mld_odleglosc',
      nazwa: 'Najbliższy przystanek busów MLD',
      opis: `Odległość geodezyjna w linii prostej do najbliższego przystanku Małopolskich Linii Dowozowych (autobusy Kolei Małopolskich), z którego odjeżdża kurs w środę ${data} (rozkład GTFS). Przystanki na żądanie liczą się jako możliwość wsiadania. To nie jest długość dojścia. Linie MLD dowożą pasażerów do Krakowa i kolei, więc w mieście o dostępie do komunikacji decyduje głównie ZTP (warstwa przystanek_odleglosc). Odległość powyżej 1,5 km (górna granica zakresu warstwy, dalej wszystkie adresy są oceniane tak samo) oznacza brak przystanku MLD w zasięgu pieszym, a nie brak danych.${PRZETWORZENIE}`,
      jednostka: 'm',
      kierunek: 'mniej-lepiej',
      zakres: [0, 1500],
      zrodla: [zrodla.mld],
    },
    mld.odleglosc,
  )
  zapiszWskaznik(
    {
      ...wspolne,
      id: 'bus_mld_kursy_szczyt_h',
      nazwa: 'Busy MLD w porannym szczycie',
      opis: `Średnia liczba planowych odjazdów busów MLD na godzinę z zespołu przystankowego najbliższego przystanku (tego samego co dla odległości) między 07:00 a 09:00 w środę ${data}, w obie strony i wszystkich linii łącznie. Przystanki na żądanie liczą się jako odjazdy. To częstotliwość jednego zespołu przystankowego, nie gwarancja faktycznego kursu; przystanek może leżeć daleko od adresu, więc ocenia się go razem z odległością. 0 oznacza zespół bez odjazdów w tym oknie.${PRZETWORZENIE}`,
      jednostka: 'kursy/h',
      kierunek: 'wiecej-lepiej',
      zakres: [0, 8],
      zrodla: [zrodla.mld],
    },
    mld.kursy,
  )

  podsumuj('kolej_odleglosc [m]', kolej.odleglosc, adresy)
  podsumuj('kolej_kursy_szczyt_h', kolej.kursy, adresy)
  podsumuj('bus_mld_odleglosc [m]', mld.odleglosc, adresy)
  podsumuj('bus_mld_kursy_szczyt_h', mld.kursy, adresy)
  kontrola(adresy, wyniki)
  return { data, dane, wyniki }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argumenty = process.argv.slice(2)
  const data = argumenty.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a))
  await generuj({ data, odswiez: argumenty.includes('--odswiez') })
}
