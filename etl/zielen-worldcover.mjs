// Zieleń z satelitarnej mapy pokrycia terenu ESA WorldCover 2021 (piksel 10 m), dla KAŻDEGO adresu.
// Po co obok zielen_udzial: siatka MSIP kończy się na granicy Krakowa (w obwarzanku 1 109 wartości
// na 106 467 adresów), a WorldCover pokrywa cały obszar tą samą metodą. Dlatego osobny wskaźnik,
// a nie łatanie braków w zielen_udzial: skale obu warstw nie są równoważne (patrz opis wskaźnika).
// Źródło: kafel N48E018 v200 (18–21°E, 48–51°N), GeoTIFF COG, CC BY 4.0, https://esa-worldcover.org.
// Metoda: udział pikseli klas 10 (drzewa) i 30 (trawa) wśród pikseli z danymi, których ŚRODEK leży
// w promieniu 100 m od adresu. Piksel to 1/12 000° (ok. 6 × 9 m na tej szerokości), więc odległość
// liczymy w metrach, nie w pikselach – inaczej koło byłoby elipsą.
// Odczyt własny, bez GDAL: nagłówek TIFF, potem tylko kafle (1024 px, Deflate) pokrywające adresy.
// Uruchom: node etl/zielen-worldcover.mjs. Pobranie (92 MB, raz) trafia do etl/.cache/worldcover/.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'
import {
  CACHE,
  DANE,
  dzis,
  MIASTO,
  pobierzDoCache,
  wczytajAdresy,
  zapiszWskaznik,
} from './lib/wspolne.mjs'

const NAZWA_KAFLA = 'ESA_WorldCover_10m_2021_v200_N48E018_Map.tif'
const URL_KAFLA = `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/${NAZWA_KAFLA}`
const LICENCJA =
  'CC BY 4.0 – https://creativecommons.org/licenses/by/4.0/ – © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium'

export const PROMIEN = 100 // m
/** Klasy WorldCover liczone jako zieleń: 10 – drzewa, 30 – trawa. */
export const KLASY_ZIELENI = [10, 30]
/** Kody legendy WorldCover; każdy inny kod w rastrze oznacza błąd odczytu. */
export const KLASY_LEGENDY = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]
const BRAK_DANYCH = 0

/** Tablica 256 znaczników: tabela[kod] === 1, gdy kod należy do klas. */
export function tabelaKlas(klasy) {
  const tabela = new Uint8Array(256)
  for (const k of klasy) tabela[k] = 1
  return tabela
}
const TABELA_ZIELENI = tabelaKlas(KLASY_ZIELENI)

/** Metry na stopień długości i szerokości na szerokości geograficznej (wzory WGS 84). */
export function metryNaStopien(latStopnie) {
  const f = (latStopnie * Math.PI) / 180
  return {
    mLat: 111132.92 - 559.82 * Math.cos(2 * f) + 1.175 * Math.cos(4 * f),
    mLon: 111412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f) + 0.118 * Math.cos(5 * f),
  }
}

// ── TIFF / GeoTIFF ────────────────────────────────────────────────────────────────────────────

const ROZMIAR_TYPU = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8 } // BYTE, ASCII, SHORT, LONG, DOUBLE

/** Tagi pierwszej (pełnej rozdzielczości) IFD klasycznego TIFF: Map tag → liczby albo tekst. */
export function czytajTagi(bufor) {
  const porzadek = bufor.toString('latin1', 0, 2)
  if (porzadek !== 'II' && porzadek !== 'MM') throw new Error('To nie jest plik TIFF')
  const le = porzadek === 'II'
  const u16 = (o) => (le ? bufor.readUInt16LE(o) : bufor.readUInt16BE(o))
  const u32 = (o) => (le ? bufor.readUInt32LE(o) : bufor.readUInt32BE(o))
  const f64 = (o) => (le ? bufor.readDoubleLE(o) : bufor.readDoubleBE(o))
  const magia = u16(2)
  if (magia === 43)
    throw new Error('BigTIFF nie jest obsługiwany (kafel WorldCover to klasyczny TIFF)')
  if (magia !== 42) throw new Error('To nie jest plik TIFF')

  const ifd = u32(4)
  const liczbaTagow = u16(ifd)
  const tagi = new Map()
  for (let i = 0; i < liczbaTagow; i++) {
    const wpis = ifd + 2 + i * 12
    const tag = u16(wpis)
    const typ = u16(wpis + 2)
    const liczba = u32(wpis + 4)
    const rozmiar = ROZMIAR_TYPU[typ]
    if (!rozmiar) continue // typ, którego nie potrzebujemy (np. RATIONAL)
    const bajty = rozmiar * liczba
    const start = bajty <= 4 ? wpis + 8 : u32(wpis + 8)
    if (start + bajty > bufor.length)
      throw new Error(`Tag ${tag} wykracza poza plik (plik ucięty?)`)
    if (typ === 2) {
      tagi.set(tag, bufor.toString('latin1', start, start + liczba).replace(/\0+$/, ''))
      continue
    }
    const wartosci = new Array(liczba)
    for (let k = 0; k < liczba; k++) {
      const o = start + k * rozmiar
      wartosci[k] = typ === 1 ? bufor[o] : typ === 3 ? u16(o) : typ === 4 ? u32(o) : f64(o)
    }
    tagi.set(tag, wartosci)
  }
  return tagi
}

/** Klucze GeoTIFF zapisane wprost w tagu (lokalizacja 0): Map id klucza → wartość. */
function kluczeGeo(katalog) {
  const klucze = new Map()
  for (let k = 0; k < (katalog[3] ?? 0); k++) {
    const [id, lokalizacja, , wartosc] = katalog.slice(4 + 4 * k, 8 + 4 * k)
    if (lokalizacja === 0) klucze.set(id, wartosc)
  }
  return klucze
}

/**
 * Wymiary, kafle i georeferencja rastra. Odrzuca wszystko, czego nie umiemy poprawnie odczytać
 * (inna kompresja, predyktor, inny układ współrzędnych), zamiast zwracać śmieci.
 */
export function czytajNaglowekTiff(bufor) {
  const tagi = czytajTagi(bufor)
  const liczba = (tag, domyslna) => {
    const w = tagi.get(tag)
    if (w === undefined) {
      if (domyslna === undefined) throw new Error(`Brak wymaganego tagu TIFF ${tag}`)
      return domyslna
    }
    return w[0]
  }
  const kompresja = liczba(259)
  const wymagania = [
    [liczba(258) === 8, 'tylko 8 bitów na piksel'],
    [liczba(277, 1) === 1, 'tylko jedna próbka na piksel'],
    [liczba(284, 1) === 1, 'tylko PlanarConfiguration = 1'],
    [liczba(339, 1) === 1, 'tylko liczby całkowite bez znaku'],
    [liczba(317, 1) === 1, 'predyktor różnicowy nie jest obsługiwany'],
    [[1, 8, 32946].includes(kompresja), `kompresja ${kompresja} nie jest obsługiwana`],
    [tagi.has(322) && tagi.has(323), 'raster nie jest kafelkowany'],
  ]
  for (const [ok, powod] of wymagania) if (!ok) throw new Error(`Nieobsługiwany TIFF: ${powod}`)

  const szer = liczba(256)
  const wys = liczba(257)
  const kafelSzer = liczba(322)
  const kafelWys = liczba(323)
  const offsety = tagi.get(324)
  const dlugosci = tagi.get(325)
  const kafli = Math.ceil(szer / kafelSzer) * Math.ceil(wys / kafelWys)
  if (offsety?.length !== kafli || dlugosci?.length !== kafli)
    throw new Error(`Tablice kafli (${offsety?.length}, ${dlugosci?.length}) ≠ ${kafli} kafli`)

  const skala = tagi.get(33550)
  const punkt = tagi.get(33922)
  if (!skala || !punkt) throw new Error('Brak georeferencji (ModelPixelScale, ModelTiepoint)')
  const klucze = kluczeGeo(tagi.get(34735) ?? [])
  if (klucze.get(1024) !== 2 || klucze.get(2048) !== 4326)
    throw new Error('Oczekiwano współrzędnych geograficznych WGS 84 (EPSG:4326)')
  const [i, j, , x, y] = punkt
  const [dLon, dLat] = skala
  // Domyślnie piksel to powierzchnia (PixelIsArea) i punkt wiązania to jego lewy górny róg;
  // przy PixelIsPoint (klucz 1025 = 2) punkt wiązania to środek piksela.
  const poprawka = klucze.get(1025) === 2 ? 0.5 : 0
  return {
    szer,
    wys,
    kafelSzer,
    kafelWys,
    kompresja,
    offsety,
    dlugosci,
    dLon,
    dLat,
    lon0: x - (i + poprawka) * dLon,
    lat0: y + (j + poprawka) * dLat,
  }
}

/** Rozpakowane piksele kafla o danym indeksie (wierszami, kafelSzer × kafelWys). */
export function dekodujKafel(bufor, naglowek, indeks) {
  const od = naglowek.offsety[indeks]
  const dlugosc = naglowek.dlugosci[indeks]
  if (od === undefined || dlugosc === undefined || od + dlugosc > bufor.length)
    throw new Error(`Kafel ${indeks} poza plikiem (plik ucięty? usuń go z etl/.cache/worldcover)`)
  const surowe = bufor.subarray(od, od + dlugosc)
  const kafel = naglowek.kompresja === 1 ? surowe : inflateSync(surowe)
  if (kafel.length !== naglowek.kafelSzer * naglowek.kafelWys)
    throw new Error(`Kafel ${indeks}: ${kafel.length} B po rozpakowaniu, oczekiwano pełnego kafla`)
  return kafel
}

/**
 * Okno rastra [kol0, kol1) × [wiersz0, wiersz1) w pikselach, przycięte do rastra. Zwraca piksele
 * oraz georeferencję okna (lon0/lat0 = lewy górny róg piksela (0, 0) okna), dekodując tylko kafle,
 * które okno dotyka.
 */
export function wczytajOkno(bufor, naglowek, kol0, wiersz0, kol1, wiersz1) {
  const c0 = Math.max(0, kol0)
  const r0 = Math.max(0, wiersz0)
  const c1 = Math.min(naglowek.szer, kol1)
  const r1 = Math.min(naglowek.wys, wiersz1)
  if (c1 <= c0 || r1 <= r0) throw new Error('Okno leży poza rastrem')
  const szer = c1 - c0
  const wys = r1 - r0
  const piksele = new Uint8Array(szer * wys)
  const { kafelSzer, kafelWys } = naglowek
  const kafliWPoziomie = Math.ceil(naglowek.szer / kafelSzer)
  for (let ty = Math.floor(r0 / kafelWys); ty <= Math.floor((r1 - 1) / kafelWys); ty++) {
    for (let tx = Math.floor(c0 / kafelSzer); tx <= Math.floor((c1 - 1) / kafelSzer); tx++) {
      const kafel = dekodujKafel(bufor, naglowek, ty * kafliWPoziomie + tx)
      const x0 = tx * kafelSzer
      const y0 = ty * kafelWys
      const od = Math.max(c0, x0)
      const doo = Math.min(c1, x0 + kafelSzer)
      for (let y = Math.max(r0, y0); y < Math.min(r1, y0 + kafelWys); y++) {
        const zrodlo = (y - y0) * kafelSzer + (od - x0)
        piksele.set(kafel.subarray(zrodlo, zrodlo + (doo - od)), (y - r0) * szer + (od - c0))
      }
    }
  }
  return {
    szer,
    wys,
    piksele,
    lon0: naglowek.lon0 + c0 * naglowek.dLon,
    lat0: naglowek.lat0 - r0 * naglowek.dLat,
    dLon: naglowek.dLon,
    dLat: naglowek.dLat,
  }
}

// ── Udział zieleni w kole ─────────────────────────────────────────────────────────────────────

/**
 * Udział pikseli „zielonych” w kole o promieniu `promien` m wokół punktu. Bierzemy piksele,
 * których środek leży w kole; piksele bez danych (kod 0) nie liczą się do mianownika. Gdy
 * połowa koła albo więcej nie ma danych, wynik jest niewiarygodny: null (nigdy 0).
 * Rzuca błąd, gdy koło wychodzi poza okno – to błąd wywołania, nie „brak danych”.
 */
export function udzialZieleni(okno, lon, lat, promien = PROMIEN, zielen = TABELA_ZIELENI) {
  const { mLon, mLat } = metryNaStopien(lat)
  const polowaLat = promien / mLat // stopnie
  // Środek wiersza r leży na lat0 − (r + ½)·dLat, więc |środek − lat| ≤ promień ⇒ zakres wierszy.
  const wiersz0 = Math.ceil((okno.lat0 - lat - polowaLat) / okno.dLat - 0.5)
  const wiersz1 = Math.floor((okno.lat0 - lat + polowaLat) / okno.dLat - 0.5)
  if (wiersz0 < 0 || wiersz1 >= okno.wys) throw new Error('Koło wykracza poza okno rastra')
  let wszystkich = 0
  let zDanymi = 0
  let zielonych = 0
  for (let r = wiersz0; r <= wiersz1; r++) {
    const dy = (okno.lat0 - (r + 0.5) * okno.dLat - lat) * mLat // m
    const polowaLon = Math.sqrt(Math.max(0, promien * promien - dy * dy)) / mLon // stopnie
    const kol0 = Math.ceil((lon - okno.lon0 - polowaLon) / okno.dLon - 0.5)
    const kol1 = Math.floor((lon - okno.lon0 + polowaLon) / okno.dLon - 0.5)
    if (kol0 < 0 || kol1 >= okno.szer) throw new Error('Koło wykracza poza okno rastra')
    const baza = r * okno.szer
    for (let c = kol0; c <= kol1; c++) {
      wszystkich++
      const kod = okno.piksele[baza + c]
      if (kod === BRAK_DANYCH) continue
      zDanymi++
      zielonych += zielen[kod]
    }
  }
  if (wszystkich === 0 || zDanymi * 2 < wszystkich) return null
  return { procent: (100 * zielonych) / zDanymi, zielonych, zDanymi, wszystkich }
}

/** Okno rastra obejmujące wszystkie punkty z zapasem na koło o promieniu `promien` m. */
export function oknoDlaPunktow(bufor, naglowek, punkty, promien = PROMIEN) {
  let minLon = Infinity
  let maxLon = -Infinity
  let minLat = Infinity
  let maxLat = -Infinity
  for (const { lon, lat } of punkty) {
    minLon = Math.min(minLon, lon)
    maxLon = Math.max(maxLon, lon)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  }
  // Zapas 2 pikseli ponad promień, liczony na szerokości, na której stopień długości jest najkrótszy.
  const { mLon } = metryNaStopien(Math.max(Math.abs(minLat), Math.abs(maxLat)))
  const { mLat } = metryNaStopien(minLat)
  const zapasLon = promien / mLon + 2 * naglowek.dLon
  const zapasLat = promien / mLat + 2 * naglowek.dLat
  return wczytajOkno(
    bufor,
    naglowek,
    Math.floor((minLon - zapasLon - naglowek.lon0) / naglowek.dLon),
    Math.floor((naglowek.lat0 - (maxLat + zapasLat)) / naglowek.dLat),
    Math.ceil((maxLon + zapasLon - naglowek.lon0) / naglowek.dLon),
    Math.ceil((naglowek.lat0 - (minLat - zapasLat)) / naglowek.dLat),
  )
}

// ── Kontrole ──────────────────────────────────────────────────────────────────────────────────

/**
 * Kontrola georeferencji: odsetek punktów (adresów), których własny piksel ma klasę `kod`, przy
 * przesunięciu okna o (dc, dr) pikseli. Gdy kafel jest dobrze położony, maksimum wypada przy
 * przesunięciu 0 ± 1 piksel; błąd rzędu dziesiątek pikseli (zła oś, zły róg) rozmywa je w płaską
 * równinę. Punkty muszą leżeć co najmniej `maks` pikseli od krawędzi okna.
 */
export function zgodnoscZPunktami(okno, punkty, kod, maks = 3) {
  const wynik = []
  for (let dr = -maks; dr <= maks; dr++) {
    for (let dc = -maks; dc <= maks; dc++) {
      let trafione = 0
      for (const { lon, lat } of punkty) {
        const c = Math.floor((lon - okno.lon0) / okno.dLon) + dc
        const r = Math.floor((okno.lat0 - lat) / okno.dLat) + dr
        if (okno.piksele[r * okno.szer + c] === kod) trafione++
      }
      wynik.push({ dc, dr, procent: (100 * trafione) / punkty.length })
    }
  }
  return wynik
}

/** Znane miejsca z oczekiwanym przedziałem udziału zieleni (kontrola sensu, nie dane wejściowe). */
export const KONTROLE = [
  { nazwa: 'Rynek Główny w Krakowie (bruk i zabudowa)', lon: 19.9372, lat: 50.0617, max: 5 },
  { nazwa: 'Rynek w Wieliczce (zabudowa centrum)', lon: 20.0647, lat: 49.9871, max: 40 },
  { nazwa: 'Błonia Krakowskie (łąka)', lon: 19.9143, lat: 50.06, min: 95 },
  { nazwa: 'Las Wolski (las)', lon: 19.833, lat: 50.0525, min: 95 },
  { nazwa: 'Puszcza Niepołomicka (las)', lon: 20.3, lat: 50.08, min: 95 },
]

// ── Statystyka ────────────────────────────────────────────────────────────────────────────────

/** Korelacja Pearsona i średnie na parach, w których obie wartości są liczbami (null pomijamy). */
export function korelacja(x, y) {
  let n = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < x.length; i++) {
    const a = x[i]
    const b = y[i]
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    n++
    sx += a
    sy += b
    sxx += a * a
    syy += b * b
    sxy += a * b
  }
  const wx = sxx - (sx * sx) / n
  const wy = syy - (sy * sy) / n
  const r = n < 3 || wx <= 0 || wy <= 0 ? null : (sxy - (sx * sy) / n) / Math.sqrt(wx * wy)
  return { n, r, sredniaX: n ? sx / n : null, sredniaY: n ? sy / n : null }
}

// ── Przebieg ──────────────────────────────────────────────────────────────────────────────────

const liczbaPL = new Intl.NumberFormat('pl-PL')

/** Opis wskaźnika z policzoną korelacją; liczby wchodzą do tekstu, więc nie rozjadą się z danymi. */
export function opisWskaznika(kor) {
  const r = kor.r.toFixed(2).replace('.', ',')
  return (
    'Odsetek powierzchni w promieniu 100 m od adresu zajęty przez drzewa i trawę według satelitarnej mapy pokrycia terenu ESA WorldCover z 2021 r. (piksel 10 m). ' +
    'Liczony tak samo w Krakowie i w gminach wokół niego, więc działa także tam, gdzie kończy się siatka MSIP („Udział zieleni”). ' +
    'To pokrycie terenu, nie temperatura ani dostęp do parku. Łąki i pastwiska liczą się jak trawa, krzewy i pola uprawne nie, więc na wsi wynik zależy od rozpoznania uprawy. ' +
    `W Krakowie zgadza się z „Udziałem zieleni” MSIP (korelacja r = ${r}, n = ${liczbaPL.format(kor.n)}), ale mierzy mniej: średnio ${kor.sredniaX.toFixed(0)}% wobec ${kor.sredniaY.toFixed(0)}% w MSIP. To osobne skale.`
  )
}

/** Nazwa kafla WorldCover 3° × 3° dla punktu (lewy dolny róg to wielokrotność 3°). */
export function nazwaKaflaDlaPunktu(lon, lat) {
  const la = Math.floor(lat / 3) * 3
  const lo = Math.floor(lon / 3) * 3
  const ns = la >= 0 ? 'N' : 'S'
  const ew = lo >= 0 ? 'E' : 'W'
  return `ESA_WorldCover_10m_2021_v200_${ns}${String(Math.abs(la)).padStart(2, '0')}${ew}${String(Math.abs(lo)).padStart(3, '0')}_Map.tif`
}

/**
 * Tryb miejski (ADRESCORE_MIASTO): kafel dobierany do każdego adresu (miasto może leżeć na styku
 * kafli, np. Warszawa na 21°E). Adres, którego koło 100 m wychodzi poza kafel, dostaje null.
 * Porównania z MSIP i kontrole krakowskie pomijamy; dekoder i georeferencję sprawdza bieg Krakowa.
 */
async function mainMiasto() {
  const start = performance.now()
  const { adresy } = wczytajAdresy()
  const wedlugKafla = new Map()
  adresy.forEach((a, i) => {
    const n = nazwaKaflaDlaPunktu(a.lon, a.lat)
    if (!wedlugKafla.has(n)) wedlugKafla.set(n, [])
    wedlugKafla.get(n).push(i)
  })
  const wartosci = new Array(adresy.length).fill(null)
  let brzeg = 0
  const kafle = []
  mkdirSync(join(CACHE, 'worldcover'), { recursive: true })
  for (const [nazwa, indeksy] of wedlugKafla) {
    const url = `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/${nazwa}`
    if (!existsSync(join(CACHE, 'worldcover', nazwa)))
      console.log(`Pobieram kafel ESA WorldCover ${nazwa} (jednorazowo)…`)
    const bufor = readFileSync(await pobierzDoCache(url, join('worldcover', nazwa)))
    const naglowek = czytajNaglowekTiff(bufor)
    const punkty = indeksy.map((i) => adresy[i])
    const okno = oknoDlaPunktow(bufor, naglowek, punkty)
    const licznik = new Float64Array(256)
    for (const kod of okno.piksele) licznik[kod]++
    for (let k = 0; k < licznik.length; k++)
      if (licznik[k] > 0 && !KLASY_LEGENDY.includes(k))
        throw new Error(`Kody spoza legendy WorldCover w ${nazwa}: ${k}`)
    let zabudowa = 0
    for (const i of indeksy) {
      const a = adresy[i]
      let w
      try {
        w = udzialZieleni(okno, a.lon, a.lat)
      } catch {
        brzeg++
        continue
      }
      wartosci[i] = w === null ? null : Math.round(w.procent)
      const c = Math.floor((a.lon - okno.lon0) / okno.dLon)
      const r = Math.floor((okno.lat0 - a.lat) / okno.dLat)
      if (okno.piksele[r * okno.szer + c] === 50) zabudowa++
    }
    console.log(
      `${nazwa}: ${indeksy.length} adresów, w pikselu zabudowy ${((100 * zabudowa) / indeksy.length).toFixed(1)}%`,
    )
    kafle.push({ nazwa, url })
  }
  console.log(`Adresy z kołem poza kafelkiem (null): ${brzeg}`)
  zapiszWskaznik(
    {
      id: 'zielen_worldcover_100m',
      kategoria: 'spokoj',
      nazwa: 'Zieleń w promieniu 100 m (ESA WorldCover)',
      opis:
        'Odsetek powierzchni w promieniu 100 m od adresu zajęty przez drzewa i trawę według satelitarnej mapy pokrycia terenu ESA WorldCover z 2021 r. (piksel 10 m). ' +
        'To pokrycie terenu, nie temperatura ani dostęp do parku. Łąki i pastwiska liczą się jak trawa, krzewy i pola uprawne nie.',
      jednostka: '%',
      kierunek: 'wiecej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 100],
      zadanie: 112,
      zrodla: kafle.map((k) => ({
        nazwa: `ESA WorldCover 10 m 2021 v200, kafel ${k.nazwa.split('_')[4]} (klasy 10 drzewa i 30 trawa)`,
        url: k.url,
        licencja: LICENCJA,
        dataDanych: '2021',
        pobrano: dzis(),
      })),
    },
    wartosci,
  )
  console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
}

async function main() {
  if (MIASTO) return mainMiasto()
  const start = performance.now()
  const { wersja, adresy } = wczytajAdresy()

  const plikKafla = join(CACHE, 'worldcover', NAZWA_KAFLA)
  if (!existsSync(plikKafla))
    console.log('Pobieram kafel ESA WorldCover N48E018 (92 MB, jednorazowo)…')
  mkdirSync(join(CACHE, 'worldcover'), { recursive: true })
  const bufor = readFileSync(await pobierzDoCache(URL_KAFLA, join('worldcover', NAZWA_KAFLA)))
  const naglowek = czytajNaglowekTiff(bufor)
  console.log(
    `Kafel: ${naglowek.szer} × ${naglowek.wys} px, kafle ${naglowek.kafelSzer} px, lewy górny róg ${naglowek.lon0}°E ${naglowek.lat0}°N, piksel ${naglowek.dLon}°.`,
  )
  const okno = oknoDlaPunktow(bufor, naglowek, adresy)
  const pikseliOkna = okno.szer * okno.wys
  console.log(`Okno: ${okno.szer} × ${okno.wys} px (${(pikseliOkna / 1e6).toFixed(1)} Mpx).`)

  // Dowód, że rozpakowanie dało legendę WorldCover, a nie śmieci.
  const licznik = new Float64Array(256)
  for (const kod of okno.piksele) licznik[kod]++
  const nieznane = []
  for (let k = 0; k < licznik.length; k++)
    if (licznik[k] > 0 && !KLASY_LEGENDY.includes(k)) nieznane.push(k)
  if (nieznane.length) throw new Error(`Kody spoza legendy WorldCover w rastrze: ${nieznane}`)
  console.log(
    `Klasy w oknie: ${KLASY_LEGENDY.filter((k) => licznik[k] > 0)
      .map((k) => `${k}: ${((100 * licznik[k]) / pikseliOkna).toFixed(1)}%`)
      .join(', ')}`,
  )

  // Georeferencja: adresy w Krakowie powinny najczęściej leżeć w pikselu zabudowy (klasa 50).
  const wKrakowie = adresy.map((a) => a.gmina === 'Kraków')
  const zgodnosc = zgodnoscZPunktami(
    okno,
    adresy.filter((_, i) => wKrakowie[i]),
    50,
  )
  const zero = zgodnosc.find((z) => z.dc === 0 && z.dr === 0)
  const najlepsze = zgodnosc.reduce((a, b) => (b.procent > a.procent ? b : a))
  const najgorsze = zgodnosc.reduce((a, b) => (b.procent < a.procent ? b : a))
  console.log(
    `Georeferencja: ${zero.procent.toFixed(1)}% adresów w Krakowie leży w pikselu zabudowy; maksimum ${najlepsze.procent.toFixed(1)}% przy przesunięciu (${najlepsze.dc}, ${najlepsze.dr}) px, minimum ${najgorsze.procent.toFixed(1)}% przy ±3 px.`,
  )
  if (
    Math.abs(najlepsze.dc) > 1 ||
    Math.abs(najlepsze.dr) > 1 ||
    zero.procent < najgorsze.procent + 10
  )
    throw new Error(
      'Kafel jest przesunięty względem adresów o więcej niż 1 piksel – sprawdź georeferencję',
    )

  // Znane miejsca.
  for (const k of KONTROLE) {
    const u = udzialZieleni(okno, k.lon, k.lat)
    console.log(`  ${k.nazwa}: ${u.procent.toFixed(1)}%`)
    if ((k.min !== undefined && u.procent < k.min) || (k.max !== undefined && u.procent > k.max))
      throw new Error(`Kontrola nie przeszła: ${k.nazwa} = ${u.procent.toFixed(1)}%`)
  }

  const wyniki = adresy.map((a) => udzialZieleni(okno, a.lon, a.lat))
  const wartosci = wyniki.map((w) => (w === null ? null : Math.round(w.procent)))
  const liczone = wyniki.filter((w) => w !== null)
  const pikseliWKole = liczone.map((w) => w.wszystkich)
  console.log(
    `Pikseli w kole ${PROMIEN} m: ${pikseliWKole.reduce((a, b) => Math.min(a, b))}–${pikseliWKole.reduce((a, b) => Math.max(a, b))}; bez danych (koło w połowie bez pikseli): ${wyniki.length - liczone.length}.`,
  )

  // Porównanie z siatką MSIP: tylko w Krakowie, bo poza nim MSIP ma pojedyncze oczka graniczne.
  const msip = JSON.parse(readFileSync(join(DANE, 'wskazniki', 'zielen_udzial.json'), 'utf8'))
  if (msip.wersjaAdresow !== wersja)
    throw new Error('zielen_udzial ma inną wersję adresów – przelicz node etl/zielen.mjs')
  const kor = korelacja(
    wartosci.map((v, i) => (wKrakowie[i] ? v : null)),
    msip.wartosci,
  )
  if (kor.r === null) throw new Error('Za mało wspólnych adresów, by policzyć korelację z MSIP')
  console.log(
    `Kraków, WorldCover vs zielen_udzial (MSIP): n = ${kor.n}, r = ${kor.r.toFixed(3)}, średnie ${kor.sredniaX.toFixed(1)}% vs ${kor.sredniaY.toFixed(1)}%.`,
  )
  const poza = korelacja(
    wartosci.map((v, i) => (wKrakowie[i] ? null : v)),
    msip.wartosci,
  )
  console.log(
    `Poza Krakowem MSIP ma ${poza.n} wartości (oczka przy granicy), średnio ${poza.sredniaY.toFixed(1)}% wobec ${poza.sredniaX.toFixed(1)}% z WorldCover.`,
  )

  zapiszWskaznik(
    {
      id: 'zielen_worldcover_100m',
      kategoria: 'spokoj',
      nazwa: 'Zieleń w promieniu 100 m (ESA WorldCover)',
      opis: opisWskaznika(kor),
      jednostka: '%',
      kierunek: 'wiecej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 100],
      zadanie: 112,
      zrodla: [
        {
          nazwa: 'ESA WorldCover 10 m 2021 v200, kafel N48E018 (klasy 10 drzewa i 30 trawa)',
          url: URL_KAFLA,
          licencja: LICENCJA,
          dataDanych: '2021',
          pobrano: dzis(),
        },
      ],
    },
    wartosci,
  )
  console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
