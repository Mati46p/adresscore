import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import {
  czytajNaglowekTiff,
  dekodujKafel,
  KLASY_LEGENDY,
  KONTROLE,
  korelacja,
  metryNaStopien,
  oknoDlaPunktow,
  opisWskaznika,
  PROMIEN,
  tabelaKlas,
  udzialZieleni,
  wczytajOkno,
  zgodnoscZPunktami,
} from './zielen-worldcover.mjs'

// Pauza (U+2014) jest zakazana w polskich tekstach projektu; zapis przez kod znaku, żeby sam
// plik testu jej nie zawierał.
const PAUZA = String.fromCharCode(0x2014)

// ── Pomocnicze: syntetyczny TIFF jak kafel WorldCover i brutalne liczenie wzorcowe ─────────────

const ROZMIAR_TYPU = { 3: 2, 4: 4, 12: 8 }

function zapisz(bufor, offset, typ, wartosc) {
  if (typ === 3) bufor.writeUInt16LE(wartosc, offset)
  else if (typ === 4) bufor.writeUInt32LE(wartosc, offset)
  else bufor.writeDoubleLE(wartosc, offset)
}

/** Klasyczny TIFF little-endian z kafelkami: 8 bitów, jedna próbka, EPSG:4326, krawędzie zerami. */
function zbudujTiff({
  szer,
  wys,
  kafel,
  piksel,
  kompresja = 8,
  predyktor,
  pixelIsPoint = false,
  lon0 = 18,
  lat0 = 51,
  krok = 1 / 12000,
}) {
  const kafle = []
  for (let ty = 0; ty < Math.ceil(wys / kafel); ty++) {
    for (let tx = 0; tx < Math.ceil(szer / kafel); tx++) {
      const surowy = Buffer.alloc(kafel * kafel)
      for (let y = 0; y < kafel; y++) {
        for (let x = 0; x < kafel; x++) {
          const gx = tx * kafel + x
          const gy = ty * kafel + y
          if (gx < szer && gy < wys) surowy[y * kafel + x] = piksel(gx, gy)
        }
      }
      kafle.push(kompresja === 1 ? surowy : deflateSync(surowy))
    }
  }
  let pozycja = 8
  const offsety = kafle.map((k) => {
    const o = pozycja
    pozycja += k.length
    return o
  })
  const polowa = pixelIsPoint ? krok / 2 : 0
  const wpisy = [
    [256, 4, [szer]],
    [257, 4, [wys]],
    [258, 3, [8]],
    [259, 3, [kompresja]],
    [262, 3, [1]],
    [277, 3, [1]],
    [284, 3, [1]],
    ...(predyktor ? [[317, 3, [predyktor]]] : []),
    [322, 3, [kafel]],
    [323, 3, [kafel]],
    [324, 4, offsety],
    [325, 4, kafle.map((k) => k.length)],
    [339, 3, [1]],
    [33550, 12, [krok, krok, 0]],
    [33922, 12, [0, 0, 0, lon0 + polowa, lat0 - polowa, 0]],
    [
      34735,
      3,
      [
        1,
        1,
        0,
        4,
        1024,
        0,
        1,
        2,
        1025,
        0,
        1,
        pixelIsPoint ? 2 : 1,
        2048,
        0,
        1,
        4326,
        2054,
        0,
        1,
        9102,
      ],
    ],
  ]
  const ifdPozycja = pozycja + (pozycja % 2)
  const ifd = Buffer.alloc(2 + wpisy.length * 12 + 4)
  ifd.writeUInt16LE(wpisy.length, 0)
  let zewnetrznaPozycja = ifdPozycja + ifd.length
  const zewnetrzne = []
  wpisy.forEach(([tag, typ, wartosci], i) => {
    const o = 2 + i * 12
    ifd.writeUInt16LE(tag, o)
    ifd.writeUInt16LE(typ, o + 2)
    ifd.writeUInt32LE(wartosci.length, o + 4)
    const bajty = ROZMIAR_TYPU[typ] * wartosci.length
    if (bajty <= 4) {
      wartosci.forEach((w, k) => zapisz(ifd, o + 8 + k * ROZMIAR_TYPU[typ], typ, w))
      return
    }
    const dane = Buffer.alloc(bajty + (bajty % 2))
    wartosci.forEach((w, k) => zapisz(dane, k * ROZMIAR_TYPU[typ], typ, w))
    ifd.writeUInt32LE(zewnetrznaPozycja, o + 8)
    zewnetrznaPozycja += dane.length
    zewnetrzne.push(dane)
  })
  const naglowek = Buffer.alloc(8)
  naglowek.write('II', 0, 'latin1')
  naglowek.writeUInt16LE(42, 2)
  naglowek.writeUInt32LE(ifdPozycja, 4)
  return Buffer.concat([naglowek, ...kafle, Buffer.alloc(ifdPozycja - pozycja), ifd, ...zewnetrzne])
}

/** Powtarzalne liczby pseudolosowe z przedziału [0, 1). */
function losowy(ziarno) {
  let a = ziarno
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function oknoZ(szer, wys, klasa, { lon0 = 19.9, lat0 = 50.1, krok = 1 / 12000 } = {}) {
  const piksele = new Uint8Array(szer * wys)
  for (let y = 0; y < wys; y++) for (let x = 0; x < szer; x++) piksele[y * szer + x] = klasa(x, y)
  return { szer, wys, piksele, lon0, lat0, dLon: krok, dLat: krok }
}

/** Środek środkowego piksela okna: leży w głębi piksela, więc zaokrąglenia nie zmieniają kolumny. */
const srodekOkna = (okno) => ({
  lon: okno.lon0 + (Math.floor(okno.szer / 2) + 0.5) * okno.dLon,
  lat: okno.lat0 - (Math.floor(okno.wys / 2) + 0.5) * okno.dLat,
})

/** Wzorzec: każdy piksel osobno, środek piksela w kole (te same wzory odległości, bez zakresów). */
function naiwnie(okno, lon, lat, promien = PROMIEN) {
  const { mLon, mLat } = metryNaStopien(lat)
  let wszystkich = 0
  let zDanymi = 0
  let zielonych = 0
  for (let y = 0; y < okno.wys; y++) {
    for (let x = 0; x < okno.szer; x++) {
      const dx = (okno.lon0 + (x + 0.5) * okno.dLon - lon) * mLon
      const dy = (okno.lat0 - (y + 0.5) * okno.dLat - lat) * mLat
      if (dx * dx + dy * dy > promien * promien) continue
      wszystkich++
      const kod = okno.piksele[y * okno.szer + x]
      if (kod === 0) continue
      zDanymi++
      if (kod === 10 || kod === 30) zielonych++
    }
  }
  return { wszystkich, zDanymi, zielonych }
}

// ── Metry na stopień ───────────────────────────────────────────────────────────────────────────

test('metry na stopień zgadzają się z elipsoidą WGS 84 na równiku i na 50°N', () => {
  const rownik = metryNaStopien(0)
  assert.ok(Math.abs(rownik.mLat - 110574.3) < 1)
  assert.ok(Math.abs(rownik.mLon - 111319.5) < 1)
  const krakow = metryNaStopien(50)
  assert.ok(Math.abs(krakow.mLat - 111229) < 2)
  assert.ok(Math.abs(krakow.mLon - 71697) < 2)
})

// ── TIFF ───────────────────────────────────────────────────────────────────────────────────────

const wzor = (x, y) => (x * 7 + y * 13) % 251

test('nagłówek TIFF: wymiary, kafle i georeferencja (PixelIsArea)', () => {
  const plik = zbudujTiff({
    szer: 40,
    wys: 35,
    kafel: 16,
    piksel: wzor,
    lon0: 18.5,
    lat0: 50.5,
    krok: 0.001,
  })
  const n = czytajNaglowekTiff(plik)
  assert.equal(n.szer, 40)
  assert.equal(n.wys, 35)
  assert.equal(n.kafelSzer, 16)
  assert.equal(n.offsety.length, 9)
  assert.equal(n.kompresja, 8)
  assert.equal(n.lon0, 18.5)
  assert.equal(n.lat0, 50.5)
  assert.equal(n.dLon, 0.001)
})

test('nagłówek TIFF: PixelIsPoint przesuwa róg o pół piksela', () => {
  const plik = zbudujTiff({
    szer: 20,
    wys: 20,
    kafel: 16,
    piksel: wzor,
    lon0: 18.5,
    lat0: 50.5,
    krok: 0.001,
    pixelIsPoint: true,
  })
  const n = czytajNaglowekTiff(plik)
  assert.ok(Math.abs(n.lon0 - 18.5) < 1e-12)
  assert.ok(Math.abs(n.lat0 - 50.5) < 1e-12)
})

test('okno rastra zwraca dokładnie te piksele, także na kaflach brzegowych i po przycięciu', () => {
  for (const kompresja of [8, 1]) {
    const plik = zbudujTiff({ szer: 40, wys: 35, kafel: 16, piksel: wzor, kompresja })
    const n = czytajNaglowekTiff(plik)
    const okno = wczytajOkno(plik, n, 5, 2, 33, 31)
    assert.equal(okno.szer, 28)
    assert.equal(okno.wys, 29)
    for (let y = 0; y < okno.wys; y++)
      for (let x = 0; x < okno.szer; x++)
        assert.equal(
          okno.piksele[y * okno.szer + x],
          wzor(x + 5, y + 2),
          `piksel (${x + 5}, ${y + 2})`,
        )
    assert.equal(okno.lon0, n.lon0 + 5 * n.dLon)
    assert.equal(okno.lat0, n.lat0 - 2 * n.dLat)

    const calosc = wczytajOkno(plik, n, -5, -3, 100, 100)
    assert.equal(calosc.szer, 40)
    assert.equal(calosc.wys, 35)
    assert.equal(calosc.piksele[34 * 40 + 39], wzor(39, 34))
    assert.throws(() => wczytajOkno(plik, n, 50, 0, 60, 10), /poza rastrem/)
  }
})

test('TIFF: odrzuca predyktor, BigTIFF i ucięty plik zamiast zwracać śmieci', () => {
  const zPredyktorem = zbudujTiff({ szer: 20, wys: 20, kafel: 16, piksel: wzor, predyktor: 2 })
  assert.throws(() => czytajNaglowekTiff(zPredyktorem), /predyktor/)

  const plik = zbudujTiff({ szer: 40, wys: 35, kafel: 16, piksel: wzor })
  const duzy = Buffer.from(plik)
  duzy.writeUInt16LE(43, 2)
  assert.throws(() => czytajNaglowekTiff(duzy), /BigTIFF/)
  assert.throws(() => czytajNaglowekTiff(Buffer.from('to nie jest tiff')), /nie jest plik TIFF/)
  assert.throws(() => czytajNaglowekTiff(plik.subarray(0, plik.length - 10)), /wykracza poza plik/)

  const n = czytajNaglowekTiff(plik)
  assert.throws(() => dekodujKafel(plik.subarray(0, 60), n, 8), /poza plikiem/)
})

// ── Udział zieleni w kole ──────────────────────────────────────────────────────────────────────

test('jednolity raster: klasy 10 i 30 to 100%, pozostałe klasy legendy to 0%', () => {
  const lon0 = 19.9
  const lat0 = 50.1
  for (const kod of KLASY_LEGENDY.filter((k) => k !== 0)) {
    const okno = oknoZ(90, 70, () => kod, { lon0, lat0 })
    const { lon, lat } = srodekOkna(okno)
    const u = udzialZieleni(okno, lon, lat)
    assert.equal(u.procent, kod === 10 || kod === 30 ? 100 : 0, `klasa ${kod}`)
    // Koło 100 m na 50°N to elipsa 16,8 × 10,8 piksela, czyli ok. 570 pikseli.
    assert.ok(u.wszystkich > 540 && u.wszystkich < 600, `pikseli: ${u.wszystkich}`)
  }
})

test('koło ma promień 100 m w metrach, nie w pikselach (piksel jest dłuższy w pionie niż w poziomie)', () => {
  // Cztery piksele zieleni: dwa w kole, dwa tuż za nim. Gdyby promień liczyć w pikselach (100 m /
  // 10 m = 10 px), wynik byłby inny: 12 px na wschód wypadłoby z koła, a 8 px na północ zostało.
  const okno = oknoZ(90, 70, () => 50)
  const { lon, lat } = srodekOkna(okno)
  const c = Math.floor(okno.szer / 2)
  const r = Math.floor(okno.wys / 2)
  okno.piksele[r * okno.szer + c + 12] = 10 // 12 px · 5,97 m ≈ 72 m na wschód: w kole
  okno.piksele[r * okno.szer + c + 17] = 10 // 17 px ≈ 101 m: poza kołem
  okno.piksele[(r - 8) * okno.szer + c] = 10 // 8 px · 9,27 m ≈ 74 m na północ: w kole
  okno.piksele[(r - 11) * okno.szer + c] = 10 // 11 px ≈ 102 m: poza kołem
  assert.equal(udzialZieleni(okno, lon, lat).zielonych, 2)
})

test('pół koła z trawą, pół z polami: ok. 50%', () => {
  const okno = oknoZ(90, 70, (x) => (x < 45 ? 30 : 40))
  const lon = okno.lon0 + 45 * okno.dLon // dokładnie na granicy kolumn
  const lat = okno.lat0 - 35 * okno.dLat
  assert.ok(Math.abs(udzialZieleni(okno, lon, lat).procent - 50) < 1)
})

test('wynik zgadza się z liczeniem piksel po pikselu na losowym rastrze', () => {
  const los = losowy(112)
  const klasy = [0, 10, 20, 30, 40, 50, 80]
  const okno = oknoZ(120, 80, () => klasy[Math.floor(los() * klasy.length)])
  for (let i = 0; i < 300; i++) {
    // Środek koła co najmniej 20 i 14 pikseli od krawędzi, żeby koło mieściło się w oknie.
    const lon = okno.lon0 + (20 + los() * 80) * okno.dLon
    const lat = okno.lat0 - (14 + los() * 52) * okno.dLat
    const wzorzec = naiwnie(okno, lon, lat)
    const u = udzialZieleni(okno, lon, lat)
    if (wzorzec.zDanymi * 2 < wzorzec.wszystkich) {
      assert.equal(u, null)
      continue
    }
    assert.equal(u.wszystkich, wzorzec.wszystkich, `punkt ${i}`)
    assert.equal(u.zDanymi, wzorzec.zDanymi, `punkt ${i}`)
    assert.equal(u.zielonych, wzorzec.zielonych, `punkt ${i}`)
    assert.equal(u.procent, (100 * wzorzec.zielonych) / wzorzec.zDanymi)
  }
})

test('piksele bez danych (kod 0) nie wchodzą do mianownika, a brak danych w połowie koła to null', () => {
  const lon0 = 19.9
  const lat0 = 50.1
  const szer = 90
  const polowaKola = (x, granica) => (x < granica ? 0 : 10)
  // Pierwsza trzecia okna bez danych, reszta zielona: wszystkie piksele z danymi są zielone.
  const oknoTrzecia = oknoZ(szer, 70, (x) => polowaKola(x, 40), { lon0, lat0 })
  const { lon, lat } = srodekOkna(oknoTrzecia)
  const u = udzialZieleni(oknoTrzecia, lon, lat)
  assert.equal(u.procent, 100)
  assert.ok(u.zDanymi < u.wszystkich)
  // Cała lewa połowa bez danych plus kawałek: ponad połowa koła bez danych.
  const oknoPonadPolowa = oknoZ(szer, 70, (x) => polowaKola(x, 50), { lon0, lat0 })
  assert.equal(udzialZieleni(oknoPonadPolowa, lon, lat), null)
  const oknoPusty = oknoZ(szer, 70, () => 0, { lon0, lat0 })
  assert.equal(udzialZieleni(oknoPusty, lon, lat), null)
})

test('koło poza oknem to błąd wywołania, nie „brak danych”', () => {
  const okno = oknoZ(90, 70, () => 10)
  const { lat } = srodekOkna(okno)
  assert.throws(() => udzialZieleni(okno, okno.lon0 + 3 * okno.dLon, lat), /poza okno/)
  assert.throws(
    () => udzialZieleni(okno, okno.lon0 + 45 * okno.dLon, okno.lat0 - 2 * okno.dLat),
    /poza okno/,
  )
})

test('tabela klas: tylko wskazane kody mają znacznik', () => {
  const t = tabelaKlas([10, 30])
  assert.equal(t.length, 256)
  assert.deepEqual(
    [...t.keys()].filter((k) => t[k] === 1),
    [10, 30],
  )
})

test('cała ścieżka: TIFF → okno dla punktów → udział zieleni równa się wzorcowi z wzoru na piksel', () => {
  // Szachownica 8 × 8 pikseli: zieleń na polach parzystych, zabudowa na nieparzystych; 400 × 300 px.
  const klasa = (x, y) => (((x >> 3) + (y >> 3)) % 2 === 0 ? 30 : 50)
  const plik = zbudujTiff({ szer: 400, wys: 300, kafel: 64, piksel: klasa })
  const n = czytajNaglowekTiff(plik)
  const punkty = [
    { lon: 18 + 120.3 / 12000, lat: 51 - 100.7 / 12000 },
    { lon: 18 + 200 / 12000, lat: 51 - 150 / 12000 },
    { lon: 18 + 310.9 / 12000, lat: 51 - 210.2 / 12000 },
    { lon: 18 + 60 / 12000, lat: 51 - 40 / 12000 },
  ]
  const okno = oknoDlaPunktow(plik, n, punkty)
  assert.ok(okno.szer < n.szer && okno.wys < n.wys, 'okno jest mniejsze niż raster')
  const pelne = wczytajOkno(plik, n, 0, 0, n.szer, n.wys)
  for (const p of punkty) {
    const u = udzialZieleni(okno, p.lon, p.lat)
    const wzorzec = naiwnie(pelne, p.lon, p.lat)
    assert.equal(u.zielonych, wzorzec.zielonych)
    assert.equal(u.wszystkich, wzorzec.wszystkich)
    assert.ok(u.procent > 20 && u.procent < 80, `szachownica ≈ 50%, jest ${u.procent}`)
  }
})

test('kontrola georeferencji wskazuje przesunięcie, o które raster minął punkty', () => {
  // Punkty leżą w pikselach (x, y); zabudowa stoi o jeden piksel na wschód od każdego z nich.
  const okno = oknoZ(60, 40, () => 10)
  const punkty = []
  for (const [x, y] of [
    [10, 8],
    [25, 20],
    [40, 30],
    [18, 33],
  ]) {
    okno.piksele[y * okno.szer + x + 1] = 50
    punkty.push({ lon: okno.lon0 + (x + 0.5) * okno.dLon, lat: okno.lat0 - (y + 0.5) * okno.dLat })
  }
  const wynik = zgodnoscZPunktami(okno, punkty, 50, 3)
  assert.equal(wynik.length, 49)
  const najlepsze = wynik.reduce((a, b) => (b.procent > a.procent ? b : a))
  assert.deepEqual([najlepsze.dc, najlepsze.dr, najlepsze.procent], [1, 0, 100])
  assert.equal(wynik.find((w) => w.dc === 0 && w.dr === 0).procent, 0)
})

// ── Statystyka i opis ──────────────────────────────────────────────────────────────────────────

test('korelacja: pełna dodatnia i ujemna, pomijanie null, brak zmienności', () => {
  assert.ok(Math.abs(korelacja([1, 2, 3, 4], [2, 4, 6, 8]).r - 1) < 1e-12)
  assert.ok(Math.abs(korelacja([1, 2, 3, 4], [8, 6, 4, 2]).r + 1) < 1e-12)
  const zBrakami = korelacja([1, null, 2, 3, 4], [10, 99, 20, 30, null])
  assert.equal(zBrakami.n, 3)
  assert.ok(Math.abs(zBrakami.r - 1) < 1e-12)
  assert.equal(zBrakami.sredniaX, 2)
  assert.equal(zBrakami.sredniaY, 20)
  assert.equal(korelacja([5, 5, 5], [1, 2, 3]).r, null)
  assert.equal(korelacja([1, 2], [1, 2]).r, null)
})

test('opis wskaźnika niesie policzoną korelację, liczności i średnie, bez pauzy', () => {
  const opis = opisWskaznika({ r: 0.8173, n: 70217, sredniaX: 49.6, sredniaY: 61.2 })
  assert.match(opis, /r = 0,82/)
  assert.match(opis, /n = 70\s217/)
  assert.match(opis, /średnio 50% wobec 61%/)
  assert.ok(!opis.includes(PAUZA), 'w polskim tekście półpauza, nie pauza')
})

// ── Opublikowany wskaźnik ──────────────────────────────────────────────────────────────────────

const plikWskaznika = JSON.parse(
  readFileSync(join(DANE, 'wskazniki', 'zielen_worldcover_100m.json'), 'utf8'),
)

test('opublikowany wskaźnik: kontrakt, wersja adresów, pokrycie Krakowa i obwarzanka', () => {
  const { wersja, adresy } = wczytajAdresy()
  const { meta, wartosci } = plikWskaznika
  assert.equal(plikWskaznika.wersjaAdresow, wersja)
  assert.equal(wartosci.length, adresy.length)
  assert.equal(meta.id, 'zielen_worldcover_100m')
  assert.equal(meta.kategoria, 'spokoj')
  assert.equal(meta.kierunek, 'wiecej-lepiej')
  assert.equal(meta.rozdzielczosc, 'adres')
  assert.equal(meta.jednostka, '%')
  assert.equal(meta.zadanie, 112)
  assert.deepEqual(meta.zakres, [0, 100])
  assert.match(meta.opis, /korelacja r = 0,\d\d/)
  assert.ok(!JSON.stringify(meta).includes(PAUZA), 'w polskim tekście półpauza, nie pauza')
  const [zrodlo] = meta.zrodla
  assert.equal(meta.zrodla.length, 1)
  assert.match(zrodlo.licencja, /CC BY 4\.0/)
  assert.match(zrodlo.licencja, /ESA WorldCover project 2021/)
  assert.match(zrodlo.url, /ESA_WorldCover_10m_2021_v200_N48E018_Map\.tif$/)
  assert.equal(zrodlo.dataDanych, '2021')

  for (const v of wartosci) assert.ok(v === null || (Number.isInteger(v) && v >= 0 && v <= 100))
  const pokrycie = (czyKrakow) => {
    const w = wartosci.filter((_, i) => (adresy[i].gmina === 'Kraków') === czyKrakow)
    return w.filter((v) => v !== null).length / w.length
  }
  assert.ok(pokrycie(true) > 0.999, 'Kraków')
  assert.ok(pokrycie(false) > 0.999, 'obwarzanek (zielen_udzial ma tu ok. 1%)')
})

test('opublikowany wskaźnik: znane miejsca mają sensowny udział zieleni', () => {
  const { adresy } = wczytajAdresy()
  const wartosc = (gmina, ulica, nr) => {
    const a = adresy.find((x) => x.gmina === gmina && x.ulica === ulica && x.nr === nr)
    assert.ok(a, `brak adresu ${gmina}, ${ulica} ${nr}`)
    return plikWskaznika.wartosci[a.i]
  }
  // Rynek Główny: bruk i kamienice.
  assert.ok(wartosc('Kraków', 'Rynek Główny', '3') <= 5)
  // Brzeg Lasu Wolskiego.
  assert.ok(wartosc('Kraków', 'Aleja Żubrowa', '15') >= 80)
  // Centrum Wieliczki: zabudowa z Plantami, ale nie las.
  const wieliczka = wartosc('Wieliczka', 'Marszałka Józefa Piłsudskiego', '59')
  assert.ok(wieliczka >= 10 && wieliczka <= 45, `Wieliczka: ${wieliczka}`)
  // Puszcza Niepołomicka: w gminie Niepołomice są setki adresów otoczonych lasem.
  const wLesie = adresy.filter(
    (a, i) => a.gmina === 'Niepołomice' && plikWskaznika.wartosci[i] >= 95,
  )
  assert.ok(wLesie.length > 300, `adresów w lesie: ${wLesie.length}`)
})

test('lista kontroli ETL ma przedział dla każdego znanego miejsca', () => {
  assert.ok(KONTROLE.length >= 5)
  for (const k of KONTROLE) assert.ok(k.min !== undefined || k.max !== undefined, k.nazwa)
})
