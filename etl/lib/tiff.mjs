// Odczyt kafelkowanych GeoTIFF-ów (klasyczny TIFF i BigTIFF) bez GDAL. Nagłówek i tablice kafli
// czytamy z „źródła bajtów” (plik albo bufor), a dekodujemy tylko te kafle, które pokrywają
// potrzebne okno. Dlaczego tak: kopia nocnego światła VIIRS z WorldPop to 145 MB BigTIFF
// z kompresją LZW, a do adresów Krakowa wystarczy sześć kafli z 336 (ok. 1,5 MB po kompresji);
// reszty nie ma po co rozpakowywać ani trzymać w pamięci.
// Obsługujemy tylko to, co umiemy poprawnie odczytać (jedna próbka, układ kafelkowy, little-endian,
// bez predyktora, współrzędne geograficzne WGS 84). Wszystko inne kończy się błędem z nazwą
// problemu, a nie śmieciowymi pikselami – ta sama zasada co w etl/zielen-worldcover.mjs.
import { open } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

// ── Źródła bajtów ─────────────────────────────────────────────────────────────────────────────
// Źródło to obiekt { rozmiar, czytaj(od, dlugosc) → Promise<Buffer> }. Dzięki temu ten sam kod
// czyta plik z dysku i bufor z testu. HTTP Range celowo nie ma: serwer WorldPop deklaruje
// Accept-Ranges: bytes, ale na żądanie zakresu oddaje cały plik (HTTP 200), więc „zakresy”
// kosztowałyby 145 MB za każdym razem.

/** Źródło z bufora w pamięci (testy, małe pliki). */
export function zrodloBufora(bufor) {
  return {
    rozmiar: bufor.length,
    async czytaj(od, dlugosc) {
      if (od < 0 || od + dlugosc > bufor.length)
        throw new Error(`Odczyt ${od}+${dlugosc} poza buforem (${bufor.length} B)`)
      return bufor.subarray(od, od + dlugosc)
    },
  }
}

/** Źródło z pliku na dysku; po pracy wywołaj zamknij(). */
export async function zrodloPliku(sciezka) {
  const uchwyt = await open(sciezka, 'r')
  const { size } = await uchwyt.stat()
  return {
    rozmiar: size,
    async czytaj(od, dlugosc) {
      if (od < 0 || od + dlugosc > size)
        throw new Error(`Odczyt ${od}+${dlugosc} poza plikiem (${size} B) – plik ucięty?`)
      const bufor = Buffer.alloc(dlugosc)
      const { bytesRead } = await uchwyt.read(bufor, 0, dlugosc, od)
      if (bytesRead !== dlugosc) throw new Error(`Przeczytano ${bytesRead} z ${dlugosc} B`)
      return bufor
    },
    zamknij: () => uchwyt.close(),
  }
}

// ── LZW (kompresja TIFF 5) ────────────────────────────────────────────────────────────────────

/**
 * Dekoduje strumień LZW z TIFF-a: kody 9–12 bitów od najstarszego bitu, ClearCode 256,
 * EndOfInformation 257, pierwszy wolny kod 258. Wariant TIFF ma „wczesną zmianę”: szerokość kodu
 * rośnie, gdy następny wolny kod osiąga 2^n − 1 (w GIF-ie dopiero przy 2^n).
 * Zwraca dokładnie `rozmiarWyjscia` bajtów; krótszy albo dłuższy strumień to błąd.
 */
export function lzwDekoduj(wejscie, rozmiarWyjscia) {
  const wyjscie = new Uint8Array(rozmiarWyjscia)
  const prefiks = new Uint16Array(4096)
  const ostatni = new Uint8Array(4096)
  const pierwszy = new Uint8Array(4096)
  const dlugosc = new Uint16Array(4096)
  for (let i = 0; i < 256; i++) {
    ostatni[i] = i
    pierwszy[i] = i
    dlugosc[i] = 1
  }
  let szerokosc = 9
  let nastepny = 258
  let poprzedni = -1
  let zapas = 0
  let bity = 0
  let we = 0
  let wy = 0

  const wypisz = (kod) => {
    const d = dlugosc[kod]
    if (wy + d > rozmiarWyjscia) throw new Error('LZW: więcej danych, niż wynika z rozmiaru kafla')
    let k = kod
    for (let i = wy + d - 1; i >= wy; i--) {
      wyjscie[i] = ostatni[k]
      k = prefiks[k]
    }
    wy += d
  }

  for (;;) {
    while (bity < szerokosc) {
      if (we >= wejscie.length)
        throw new Error('LZW: strumień kończy się bez kodu EndOfInformation')
      zapas = (zapas << 8) | wejscie[we++]
      bity += 8
    }
    const kod = (zapas >>> (bity - szerokosc)) & ((1 << szerokosc) - 1)
    bity -= szerokosc
    zapas &= (1 << bity) - 1
    if (kod === 257) break
    if (kod === 256) {
      szerokosc = 9
      nastepny = 258
      poprzedni = -1
      continue
    }
    if (poprzedni === -1) {
      if (kod > 255) throw new Error(`LZW: po ClearCode oczekiwano kodu < 256, jest ${kod}`)
      wypisz(kod)
      poprzedni = kod
      continue
    }
    if (kod > nastepny)
      throw new Error(`LZW: kod ${kod} spoza słownika (następny wolny ${nastepny})`)
    // Kod == nastepny to ciąg „poprzedni + jego pierwszy znak”, którego jeszcze nie ma w słowniku.
    const znak = kod < nastepny ? pierwszy[kod] : pierwszy[poprzedni]
    if (nastepny < 4096) {
      prefiks[nastepny] = poprzedni
      ostatni[nastepny] = znak
      pierwszy[nastepny] = pierwszy[poprzedni]
      dlugosc[nastepny] = dlugosc[poprzedni] + 1
      nastepny++
      if (nastepny === (1 << szerokosc) - 1 && szerokosc < 12) szerokosc++
    }
    wypisz(kod)
    poprzedni = kod
  }
  if (wy !== rozmiarWyjscia)
    throw new Error(`LZW: rozpakowano ${wy} B, oczekiwano ${rozmiarWyjscia} B`)
  return wyjscie
}

// ── Nagłówek TIFF / BigTIFF ───────────────────────────────────────────────────────────────────

// Rozmiary typów pól TIFF: BYTE, ASCII, SHORT, LONG, RATIONAL, SBYTE, UNDEFINED, SSHORT, SLONG,
// SRATIONAL, FLOAT, DOUBLE, a w BigTIFF także LONG8, SLONG8, IFD8.
const ROZMIAR_TYPU = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  16: 8,
  17: 8,
  18: 8,
}

/**
 * Tagi pierwszej IFD: Map tag → tablica liczb (typy 1, 3, 4, 7, 12, 16) albo tekst (typ 2).
 * Pola większe niż miejsce w wpisie (4 B w TIFF, 8 B w BigTIFF) czytamy spod wskazanego offsetu.
 */
export async function czytajTagi(zrodlo) {
  const glowa = await zrodlo.czytaj(0, 16)
  const porzadek = glowa.toString('latin1', 0, 2)
  if (porzadek !== 'II' && porzadek !== 'MM') throw new Error('To nie jest plik TIFF')
  const le = porzadek === 'II'
  const u16 = (b, o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o))
  const u32 = (b, o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o))
  const f64 = (b, o) => (le ? b.readDoubleLE(o) : b.readDoubleBE(o))
  const u64 = (b, o) => {
    const v = le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o)
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Offset TIFF większy niż 2^53')
    return Number(v)
  }
  const magia = u16(glowa, 2)
  if (magia !== 42 && magia !== 43) throw new Error('To nie jest plik TIFF')
  const duzy = magia === 43
  if (duzy && (u16(glowa, 4) !== 8 || u16(glowa, 6) !== 0))
    throw new Error('BigTIFF z offsetami innymi niż 8-bajtowe nie jest obsługiwany')

  const ifd = duzy ? u64(glowa, 8) : u32(glowa, 4)
  const poczatek = await zrodlo.czytaj(ifd, duzy ? 8 : 2)
  const liczbaTagow = duzy ? u64(poczatek, 0) : u16(poczatek, 0)
  const rozmWpisu = duzy ? 20 : 12
  const miejsce = duzy ? 8 : 4
  const wpisy = await zrodlo.czytaj(ifd + (duzy ? 8 : 2), liczbaTagow * rozmWpisu)

  const tagi = new Map()
  for (let i = 0; i < liczbaTagow; i++) {
    const o = i * rozmWpisu
    const tag = u16(wpisy, o)
    const typ = u16(wpisy, o + 2)
    const liczba = duzy ? u64(wpisy, o + 4) : u32(wpisy, o + 4)
    const pole = o + (duzy ? 12 : 8)
    const rozmiar = ROZMIAR_TYPU[typ]
    if (!rozmiar) continue
    const bajty = rozmiar * liczba
    const dane =
      bajty <= miejsce
        ? wpisy.subarray(pole, pole + bajty)
        : await zrodlo.czytaj(duzy ? u64(wpisy, pole) : u32(wpisy, pole), bajty)
    if (typ === 2) {
      tagi.set(tag, dane.toString('latin1').replace(/\0+$/, ''))
      continue
    }
    const odczyt =
      typ === 1 || typ === 7
        ? (b, p) => b[p]
        : typ === 3
          ? u16
          : typ === 4
            ? u32
            : typ === 12
              ? f64
              : typ === 16
                ? u64
                : null
    if (!odczyt) continue // typy, których nie potrzebujemy (ułamki, ze znakiem)
    const wartosci = new Array(liczba)
    for (let k = 0; k < liczba; k++) wartosci[k] = odczyt(dane, k * rozmiar)
    tagi.set(tag, wartosci)
  }
  return { tagi, le, duzy }
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

// Klucz „format:bity” (SampleFormat 1 = uint, 2 = int, 3 = float) → typ tablicy.
const TYPY_PIKSELI = {
  '1:8': Uint8Array,
  '1:16': Uint16Array,
  '1:32': Uint32Array,
  '2:16': Int16Array,
  '2:32': Int32Array,
  '3:32': Float32Array,
  '3:64': Float64Array,
}

/**
 * Wymiary, kafle i georeferencja rastra. Odrzuca wszystko, czego nie umiemy poprawnie odczytać
 * (inna kompresja, predyktor, układ współrzędnych, kolejność bajtów), zamiast zwracać śmieci.
 */
export async function czytajNaglowekTiff(zrodlo) {
  const { tagi, le, duzy } = await czytajTagi(zrodlo)
  if (!le) throw new Error('Nieobsługiwany TIFF: tylko kolejność bajtów little-endian (II)')
  const wartosc = (tag, domyslna) => {
    const w = tagi.get(tag)
    if (w === undefined) {
      if (domyslna === undefined) throw new Error(`Brak wymaganego tagu TIFF ${tag}`)
      return domyslna
    }
    return Array.isArray(w) ? w[0] : w
  }
  const kompresja = wartosc(259)
  const bity = wartosc(258)
  const format = wartosc(339, 1)
  const Typ = TYPY_PIKSELI[`${format}:${bity}`]
  const wymagania = [
    [Boolean(Typ), `format próbki ${format}, ${bity} bitów nie jest obsługiwany`],
    [wartosc(277, 1) === 1, 'tylko jedna próbka na piksel'],
    [wartosc(284, 1) === 1, 'tylko PlanarConfiguration = 1'],
    [wartosc(317, 1) === 1, 'predyktor nie jest obsługiwany'],
    [[1, 5, 8, 32946].includes(kompresja), `kompresja ${kompresja} nie jest obsługiwana`],
    [tagi.has(322) && tagi.has(323), 'raster nie jest kafelkowany'],
  ]
  for (const [ok, powod] of wymagania) if (!ok) throw new Error(`Nieobsługiwany TIFF: ${powod}`)

  const szer = wartosc(256)
  const wys = wartosc(257)
  const kafelSzer = wartosc(322)
  const kafelWys = wartosc(323)
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
  const nodata = tagi.has(42113) ? Number(tagi.get(42113)) : null
  return {
    duzy,
    szer,
    wys,
    kafelSzer,
    kafelWys,
    kompresja,
    Typ,
    offsety,
    dlugosci,
    dLon,
    dLat,
    lon0: x - (i + poprawka) * dLon,
    lat0: y + (j + poprawka) * dLat,
    nodata: Number.isFinite(nodata) ? nodata : null,
    opis: tagi.get(270) ?? null,
    // XML z GDAL-a (tag 42112): m.in. STATISTICS_* policzone na całym rastrze przy zapisie pliku.
    metadaneGdal: tagi.get(42112) ?? null,
  }
}

/**
 * Statystyki zapisane przez GDAL w metadanych pliku (STATISTICS_MEAN, _MAXIMUM, _MINIMUM, _STDDEV,
 * _VALID_PERCENT) jako liczby; brakujące pola nie wchodzą do wyniku.
 */
export function statystykiGdal(xml) {
  const wynik = {}
  for (const [, nazwa, tekst] of (xml ?? '').matchAll(
    /<Item name="STATISTICS_(\w+)"[^>]*>([^<]*)<\/Item>/g,
  )) {
    const v = Number(tekst)
    if (Number.isFinite(v)) wynik[nazwa.toLowerCase()] = v
  }
  return wynik
}

/**
 * Statystyki całego rastra liczone własnym dekoderem (wszystkie kafle, bez dopełnienia na
 * krawędziach i bez wartości nodata), w tej samej konwencji co GDAL: do porównania z metadanymi
 * pliku. Rozbieżność oznacza błąd dekodera albo uszkodzony plik.
 */
export async function statystykiRastra(zrodlo, naglowek) {
  const { szer, wys, kafelSzer, kafelWys, nodata } = naglowek
  const kafliX = Math.ceil(szer / kafelSzer)
  const kafliY = Math.ceil(wys / kafelWys)
  let wszystkich = 0
  let waznych = 0
  let suma = 0
  let suma2 = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let ty = 0; ty < kafliY; ty++) {
    for (let tx = 0; tx < kafliX; tx++) {
      const kafel = await dekodujKafel(zrodlo, naglowek, ty * kafliX + tx)
      const wiersze = Math.min(kafelWys, wys - ty * kafelWys)
      const kolumny = Math.min(kafelSzer, szer - tx * kafelSzer)
      for (let y = 0; y < wiersze; y++) {
        for (let x = 0; x < kolumny; x++) {
          wszystkich++
          const v = kafel[y * kafelSzer + x]
          if (Number.isNaN(v) || v === nodata) continue
          waznych++
          suma += v
          suma2 += v * v
          if (v < min) min = v
          if (v > max) max = v
        }
      }
    }
  }
  const srednia = suma / waznych
  // Nazwy pól jak w statystykiGdal (STATISTICS_MEAN → mean itd.), żeby porównywać je pętlą.
  return {
    wszystkich,
    waznych,
    valid_percent: (100 * waznych) / wszystkich,
    minimum: min,
    maximum: max,
    mean: srednia,
    stddev: Math.sqrt(Math.max(0, suma2 / waznych - srednia * srednia)),
  }
}

// ── Kafle i okna ──────────────────────────────────────────────────────────────────────────────

/** Piksele kafla o danym indeksie (wierszami, kafelSzer × kafelWys) jako tablica typowana. */
export async function dekodujKafel(zrodlo, naglowek, indeks) {
  const od = naglowek.offsety[indeks]
  const dlugosc = naglowek.dlugosci[indeks]
  const { kafelSzer, kafelWys, Typ, kompresja } = naglowek
  const pikseli = kafelSzer * kafelWys
  const bajtow = pikseli * Typ.BYTES_PER_ELEMENT
  if (od === undefined || dlugosc === undefined || od + dlugosc > zrodlo.rozmiar)
    throw new Error(`Kafel ${indeks} poza plikiem (plik ucięty?)`)
  // Kafel o zerowej długości to w TIFF-ach rzadkich „brak kafla”: same wartości nodata.
  if (dlugosc === 0) return new Typ(pikseli).fill(naglowek.nodata ?? 0)
  const surowe = await zrodlo.czytaj(od, dlugosc)
  let dane
  if (kompresja === 1) {
    if (surowe.length !== bajtow)
      throw new Error(`Kafel ${indeks}: ${surowe.length} B, oczekiwano ${bajtow}`)
    dane = new Uint8Array(bajtow)
    dane.set(surowe)
  } else if (kompresja === 5) {
    dane = lzwDekoduj(surowe, bajtow)
  } else {
    const rozpakowane = inflateSync(surowe)
    if (rozpakowane.length !== bajtow)
      throw new Error(
        `Kafel ${indeks}: ${rozpakowane.length} B po rozpakowaniu, oczekiwano ${bajtow}`,
      )
    dane = new Uint8Array(rozpakowane)
  }
  return new Typ(dane.buffer, dane.byteOffset, pikseli)
}

/**
 * Okno rastra [kol0, kol1) × [wiersz0, wiersz1) w pikselach, przycięte do rastra. Zwraca piksele
 * oraz georeferencję okna (lon0/lat0 = lewy górny róg piksela (0, 0) okna), dekodując tylko kafle,
 * które okno dotyka.
 */
export async function wczytajOkno(zrodlo, naglowek, kol0, wiersz0, kol1, wiersz1) {
  const c0 = Math.max(0, kol0)
  const r0 = Math.max(0, wiersz0)
  const c1 = Math.min(naglowek.szer, kol1)
  const r1 = Math.min(naglowek.wys, wiersz1)
  if (c1 <= c0 || r1 <= r0) throw new Error('Okno leży poza rastrem')
  const szer = c1 - c0
  const wys = r1 - r0
  const { kafelSzer, kafelWys, Typ } = naglowek
  const piksele = new Typ(szer * wys)
  const kafliWPoziomie = Math.ceil(naglowek.szer / kafelSzer)
  let kafli = 0
  for (let ty = Math.floor(r0 / kafelWys); ty <= Math.floor((r1 - 1) / kafelWys); ty++) {
    for (let tx = Math.floor(c0 / kafelSzer); tx <= Math.floor((c1 - 1) / kafelSzer); tx++) {
      const kafel = await dekodujKafel(zrodlo, naglowek, ty * kafliWPoziomie + tx)
      kafli++
      const x0 = tx * kafelSzer
      const y0 = ty * kafelWys
      const od = Math.max(c0, x0)
      const doo = Math.min(c1, x0 + kafelSzer)
      for (let y = Math.max(r0, y0); y < Math.min(r1, y0 + kafelWys); y++) {
        const z = (y - y0) * kafelSzer + (od - x0)
        piksele.set(kafel.subarray(z, z + (doo - od)), (y - r0) * szer + (od - c0))
      }
    }
  }
  return {
    szer,
    wys,
    piksele,
    kafli,
    lon0: naglowek.lon0 + c0 * naglowek.dLon,
    lat0: naglowek.lat0 - r0 * naglowek.dLat,
    dLon: naglowek.dLon,
    dLat: naglowek.dLat,
    nodata: naglowek.nodata,
  }
}

/** Okno obejmujące wszystkie punkty { lon, lat } z zapasem `zapas` pikseli z każdej strony. */
export async function oknoDlaPunktow(zrodlo, naglowek, punkty, zapas = 2) {
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
  if (!Number.isFinite(minLon)) throw new Error('Brak punktów do pokrycia oknem')
  return wczytajOkno(
    zrodlo,
    naglowek,
    Math.floor((minLon - naglowek.lon0) / naglowek.dLon) - zapas,
    Math.floor((naglowek.lat0 - maxLat) / naglowek.dLat) - zapas,
    Math.floor((maxLon - naglowek.lon0) / naglowek.dLon) + 1 + zapas,
    Math.floor((naglowek.lat0 - minLat) / naglowek.dLat) + 1 + zapas,
  )
}

/**
 * Wartość piksela okna, w którym leży punkt. null = piksel bez danych (nodata albo NaN).
 * Punkt poza oknem to błąd wywołania, a nie „brak danych”: rzuca wyjątek.
 */
export function wartoscPiksela(okno, lon, lat) {
  const c = Math.floor((lon - okno.lon0) / okno.dLon)
  const r = Math.floor((okno.lat0 - lat) / okno.dLat)
  if (c < 0 || r < 0 || c >= okno.szer || r >= okno.wys)
    throw new Error(`Punkt (${lon}, ${lat}) leży poza oknem rastra`)
  const v = okno.piksele[r * okno.szer + c]
  return Number.isNaN(v) || v === okno.nodata ? null : v
}
