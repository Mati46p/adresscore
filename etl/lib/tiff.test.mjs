import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import {
  czytajNaglowekTiff,
  czytajTagi,
  dekodujKafel,
  lzwDekoduj,
  oknoDlaPunktow,
  statystykiGdal,
  statystykiRastra,
  wartoscPiksela,
  wczytajOkno,
  zrodloBufora,
  zrodloPliku,
} from './tiff.mjs'

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

// ── Koder LZW jak w libtiff (tylko do testów dekodera) ─────────────────────────────────────────

/** Pakuje pary [kod, szerokość] od najstarszego bitu. */
function spakuj(kody) {
  const bajty = []
  let zapas = 0
  let bity = 0
  for (const [kod, szer] of kody) {
    zapas = (zapas << szer) | kod
    bity += szer
    while (bity >= 8) {
      bajty.push((zapas >>> (bity - 8)) & 0xff)
      bity -= 8
    }
    zapas &= (1 << bity) - 1
  }
  if (bity > 0) bajty.push((zapas << (8 - bity)) & 0xff)
  return Buffer.from(bajty)
}

/** ClearCode na początku, wczesna zmiana szerokości, Clear przy zapełnieniu słownika (4094). */
function lzwKoduj(dane) {
  const kody = []
  let szer = 9
  let nastepny = 258
  let slownik = new Map()
  const emituj = (kod) => kody.push([kod, szer])
  emituj(256)
  let w = -1
  for (const c of dane) {
    if (w === -1) {
      w = c
      continue
    }
    const znaleziony = slownik.get(w * 256 + c)
    if (znaleziony !== undefined) {
      w = znaleziony
      continue
    }
    emituj(w)
    slownik.set(w * 256 + c, nastepny++)
    if (nastepny > (1 << szer) - 1 && szer < 12) szer++
    if (nastepny === 4094) {
      emituj(256)
      slownik = new Map()
      nastepny = 258
      szer = 9
    }
    w = c
  }
  if (w !== -1) emituj(w)
  emituj(257)
  return spakuj(kody)
}

// ── LZW ────────────────────────────────────────────────────────────────────────────────────────

test('LZW: przykład ze specyfikacji TIFF 6.0 (7 7 7 8 8 7 7 6 6)', () => {
  const kody = [256, 7, 258, 8, 8, 258, 6, 6, 257].map((k) => [k, 9])
  const wynik = lzwDekoduj(spakuj(kody), 9)
  assert.deepEqual([...wynik], [7, 7, 7, 8, 8, 7, 7, 6, 6])
})

test('LZW: kodowanie i dekodowanie wracają do danych (długie serie, losowe, wzorce, float)', () => {
  const los = losowy(7)
  const przypadki = {
    'zera (długa seria, szerokość kodu dochodzi do 12 bitów)': new Uint8Array(70_000),
    'losowe bajty (słownik zapełnia się i jest czyszczony)': Uint8Array.from(
      { length: 60_000 },
      () => Math.floor(los() * 256),
    ),
    'powtarzający się wzorzec': Uint8Array.from({ length: 30_000 }, (_, i) => (i * 31) % 17),
    'jeden bajt': Uint8Array.of(42),
    'gładkie floaty jak raster': new Uint8Array(
      Float32Array.from({ length: 5_000 }, (_, i) => Math.round(Math.sin(i / 50) * 400) / 10)
        .buffer,
    ),
  }
  for (const [nazwa, dane] of Object.entries(przypadki)) {
    const spakowane = lzwKoduj(dane)
    assert.deepEqual(lzwDekoduj(spakowane, dane.length), dane, nazwa)
  }
})

test('LZW: wejście uszkodzone albo o złym rozmiarze to błąd, nie śmieci', () => {
  const dane = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) % 13)
  const dobre = lzwKoduj(dane)
  assert.throws(() => lzwDekoduj(dobre, dane.length - 1), /więcej danych/)
  assert.throws(() => lzwDekoduj(dobre, dane.length + 1), /rozpakowano 1000 B, oczekiwano 1001 B/)
  assert.throws(() => lzwDekoduj(dobre.subarray(0, 100), dane.length), /bez kodu EndOfInformation/)
  // po ClearCode musi być literał, a kod spoza słownika to błąd
  assert.throws(
    () =>
      lzwDekoduj(
        spakuj([
          [256, 9],
          [300, 9],
          [257, 9],
        ]),
        1,
      ),
    /oczekiwano kodu < 256/,
  )
  assert.throws(
    () =>
      lzwDekoduj(
        spakuj([
          [256, 9],
          [5, 9],
          [400, 9],
          [257, 9],
        ]),
        4,
      ),
    /spoza słownika/,
  )
})

// ── Syntetyczny GeoTIFF: klasyczny i BigTIFF, kafle float32 ────────────────────────────────────

const ROZMIAR_TYPU = { 2: 1, 3: 2, 4: 4, 12: 8, 16: 8 }
const WYPEŁNIENIE_KRAWĘDZI = 12345 // dopełnienie kafli na krawędzi: nie może wyciec do okna

function zakoduj(typ, wartosci) {
  const bufor = Buffer.alloc(ROZMIAR_TYPU[typ] * wartosci.length)
  wartosci.forEach((w, i) => {
    const o = i * ROZMIAR_TYPU[typ]
    if (typ === 3) bufor.writeUInt16LE(w, o)
    else if (typ === 4) bufor.writeUInt32LE(w, o)
    else if (typ === 16) bufor.writeBigUInt64LE(BigInt(w), o)
    else bufor.writeDoubleLE(w, o)
  })
  return bufor
}

/** IFD (z polami spoza wpisu) dla klasycznego TIFF-a albo BigTIFF-a, ułożone od `pozycja`. */
function zbudujIfd(wpisy, duzy, pozycja) {
  const rozmWpisu = duzy ? 20 : 12
  const naglowek = duzy ? 8 : 2
  const rozmiar = naglowek + wpisy.length * rozmWpisu + (duzy ? 8 : 4)
  const ifd = Buffer.alloc(rozmiar)
  if (duzy) ifd.writeBigUInt64LE(BigInt(wpisy.length), 0)
  else ifd.writeUInt16LE(wpisy.length, 0)
  let zewnetrzna = pozycja + rozmiar
  const zewnetrzne = []
  const posortowane = [...wpisy].sort((a, b) => a[0] - b[0])
  posortowane.forEach(([tag, typ, wartosci], i) => {
    const o = naglowek + i * rozmWpisu
    ifd.writeUInt16LE(tag, o)
    ifd.writeUInt16LE(typ, o + 2)
    const dane = typ === 2 ? Buffer.from(`${wartosci}\0`, 'latin1') : zakoduj(typ, wartosci)
    const liczba = typ === 2 ? dane.length : wartosci.length
    if (duzy) ifd.writeBigUInt64LE(BigInt(liczba), o + 4)
    else ifd.writeUInt32LE(liczba, o + 4)
    const pole = o + (duzy ? 12 : 8)
    if (dane.length <= (duzy ? 8 : 4)) dane.copy(ifd, pole)
    else {
      if (duzy) ifd.writeBigUInt64LE(BigInt(zewnetrzna), pole)
      else ifd.writeUInt32LE(zewnetrzna, pole)
      zewnetrzne.push(dane)
      zewnetrzna += dane.length
    }
  })
  return Buffer.concat([ifd, ...zewnetrzne])
}

/**
 * Kafelkowany GeoTIFF little-endian z jedną próbką float32 (domyślnie), jak kopia WorldPop.
 * `piksel(x, y)` daje wartość; kafle na krawędzi dopełniamy WYPEŁNIENIEM_KRAWĘDZI.
 */
function zbudujTiff({
  duzy = false,
  szer,
  wys,
  kafel,
  piksel,
  kompresja = 1,
  predyktor,
  bity = 32,
  format = 3,
  probki = 1,
  paski = false,
  puste = [],
  nodata = -999999,
  lon0 = 19.5,
  lat0 = 50.5,
  krok = 0.001,
  pixelIsPoint = false,
  epsg = 4326,
  opis = 'Test VIIRS',
  metadaneGdal = null,
}) {
  const kafliX = Math.ceil(szer / kafel)
  const kafliY = Math.ceil(wys / kafel)
  const kafle = []
  for (let ty = 0; ty < kafliY; ty++) {
    for (let tx = 0; tx < kafliX; tx++) {
      const f = new Float32Array(kafel * kafel).fill(WYPEŁNIENIE_KRAWĘDZI)
      for (let y = 0; y < kafel; y++)
        for (let x = 0; x < kafel; x++) {
          const gx = tx * kafel + x
          const gy = ty * kafel + y
          if (gx < szer && gy < wys) f[y * kafel + x] = piksel(gx, gy)
        }
      const surowy = Buffer.from(f.buffer)
      const jestPusty = puste.includes(ty * kafliX + tx)
      kafle.push(
        jestPusty
          ? Buffer.alloc(0)
          : kompresja === 1
            ? surowy
            : kompresja === 5
              ? lzwKoduj(surowy)
              : deflateSync(surowy),
      )
    }
  }
  const poczatek = duzy ? 16 : 8
  let pozycja = poczatek
  const offsety = kafle.map((k) => {
    const o = pozycja
    pozycja += k.length
    return o
  })
  const polowa = pixelIsPoint ? krok / 2 : 0
  const wpisy = [
    [256, 4, [szer]],
    [257, 4, [wys]],
    [258, 3, [bity]],
    [259, 3, [kompresja]],
    [262, 3, [1]],
    [270, 2, opis],
    [277, 3, [probki]],
    [284, 3, [1]],
    ...(predyktor ? [[317, 3, [predyktor]]] : []),
    ...(paski
      ? [
          [273, 4, offsety],
          [278, 4, [kafel]],
          [279, 4, kafle.map((k) => k.length)],
        ]
      : [
          [322, 3, [kafel]],
          [323, 3, [kafel]],
          [324, duzy ? 16 : 4, offsety],
          [325, 4, kafle.map((k) => k.length)],
        ]),
    [339, 3, [format]],
    [33550, 12, [krok, krok, 0]],
    [33922, 12, [0, 0, 0, lon0 + polowa, lat0 - polowa, 0]],
    [34735, 3, [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, pixelIsPoint ? 2 : 1, 2048, 0, 1, epsg]],
    ...(metadaneGdal ? [[42112, 2, metadaneGdal]] : []),
    ...(nodata === null ? [] : [[42113, 2, String(nodata)]]),
  ]
  const ifdPozycja = pozycja
  const naglowek = Buffer.alloc(poczatek)
  naglowek.write('II', 0, 'latin1')
  if (duzy) {
    naglowek.writeUInt16LE(43, 2)
    naglowek.writeUInt16LE(8, 4)
    naglowek.writeUInt16LE(0, 6)
    naglowek.writeBigUInt64LE(BigInt(ifdPozycja), 8)
  } else {
    naglowek.writeUInt16LE(42, 2)
    naglowek.writeUInt32LE(ifdPozycja, 4)
  }
  return Buffer.concat([naglowek, ...kafle, zbudujIfd(wpisy, duzy, ifdPozycja)])
}

/** Wartość wzorcowa piksela (x, y): gładka, nieskończenie wiele różnych wartości, część nodata. */
const wzor = (x, y) => ((x * 7 + y * 13) % 251) + x / 16 + y / 1024
const wzorZNodata = (x, y) => ((x + y) % 11 === 0 ? -999999 : Math.fround(wzor(x, y)))

const WARIANTY = [
  { nazwa: 'BigTIFF, LZW', duzy: true, kompresja: 5 },
  { nazwa: 'klasyczny TIFF, LZW', duzy: false, kompresja: 5 },
  { nazwa: 'klasyczny TIFF, Deflate', duzy: false, kompresja: 8 },
  { nazwa: 'BigTIFF, bez kompresji', duzy: true, kompresja: 1 },
]

// ── Nagłówek ───────────────────────────────────────────────────────────────────────────────────

test('nagłówek: wymiary, kafle, georeferencja, nodata, opis i metadane GDAL (TIFF i BigTIFF)', async () => {
  for (const w of WARIANTY) {
    const xml = '<GDALMetadata><Item name="STATISTICS_MEAN" sample="0">1.5</Item></GDALMetadata>'
    const bufor = zbudujTiff({
      ...w,
      szer: 40,
      wys: 30,
      kafel: 16,
      piksel: wzor,
      metadaneGdal: xml,
    })
    const n = await czytajNaglowekTiff(zrodloBufora(bufor))
    assert.equal(n.duzy, w.duzy, w.nazwa)
    assert.equal(n.szer, 40)
    assert.equal(n.wys, 30)
    assert.equal(n.kafelSzer, 16)
    assert.equal(n.kafelWys, 16)
    assert.equal(n.kompresja, w.kompresja)
    assert.equal(n.Typ, Float32Array)
    assert.equal(n.offsety.length, 6)
    assert.equal(n.dlugosci.length, 6)
    assert.equal(n.dLon, 0.001)
    assert.equal(n.lon0, 19.5)
    assert.equal(n.lat0, 50.5)
    assert.equal(n.nodata, -999999)
    assert.equal(n.opis, 'Test VIIRS')
    assert.equal(n.metadaneGdal, xml)
  }
})

test('nagłówek: PixelIsPoint przesuwa punkt wiązania o pół piksela', async () => {
  const bufor = zbudujTiff({ szer: 8, wys: 8, kafel: 8, piksel: wzor, pixelIsPoint: true })
  const n = await czytajNaglowekTiff(zrodloBufora(bufor))
  assert.ok(Math.abs(n.lon0 - 19.5) < 1e-12)
  assert.ok(Math.abs(n.lat0 - 50.5) < 1e-12)
})

test('nagłówek: brak tagu nodata to null, a pola większe niż wpis czytamy spod offsetu', async () => {
  const bufor = zbudujTiff({ duzy: true, szer: 8, wys: 8, kafel: 8, piksel: wzor, nodata: null })
  const zrodlo = zrodloBufora(bufor)
  const n = await czytajNaglowekTiff(zrodlo)
  assert.equal(n.nodata, null)
  const { tagi, duzy } = await czytajTagi(zrodlo)
  assert.equal(duzy, true)
  assert.equal(tagi.get(33922).length, 6) // 48 B > 8 B miejsca w wpisie
  assert.equal(tagi.get(270), 'Test VIIRS')
})

test('nagłówek: odrzuca to, czego nie umie czytać, zamiast zwracać śmieci', async () => {
  const bazowe = { szer: 8, wys: 8, kafel: 8, piksel: wzor }
  const odrzuca = async (opcje, wzorzec, co) =>
    assert.rejects(
      czytajNaglowekTiff(zrodloBufora(zbudujTiff({ ...bazowe, ...opcje }))),
      wzorzec,
      co,
    )
  await odrzuca({ predyktor: 3 }, /predyktor/, 'predyktor')
  await odrzuca({ kompresja: 7 }, /kompresja 7/, 'JPEG')
  await odrzuca({ probki: 3 }, /jedna próbka/, 'RGB')
  await odrzuca({ bity: 12 }, /12 bitów/, 'zła liczba bitów')
  await odrzuca({ format: 4 }, /format próbki 4/, 'nieznany format próbki')
  await odrzuca({ paski: true }, /nie jest kafelkowany/, 'układ paskowy')
  await odrzuca({ epsg: 2180 }, /EPSG:4326/, 'inny układ współrzędnych')
  // porządek bajtów MM i plik, który nie jest TIFF-em
  const mm = Buffer.alloc(32)
  mm.write('MM', 0, 'latin1')
  mm.writeUInt16BE(42, 2)
  mm.writeUInt32BE(8, 4)
  await assert.rejects(czytajNaglowekTiff(zrodloBufora(mm)), /little-endian/)
  await assert.rejects(czytajNaglowekTiff(zrodloBufora(Buffer.alloc(32, 1))), /nie jest plik TIFF/)
  const zlyBig = zbudujTiff({ ...bazowe, duzy: true })
  zlyBig.writeUInt16LE(4, 4) // BigTIFF z 4-bajtowymi offsetami
  await assert.rejects(czytajNaglowekTiff(zrodloBufora(zlyBig)), /8-bajtowe/)
})

// ── Kafle i okna ───────────────────────────────────────────────────────────────────────────────

test('kafel: dekodowanie zgadza się ze wzorem w każdym wariancie, a krawędź ma dopełnienie', async () => {
  for (const w of WARIANTY) {
    const zrodlo = zrodloBufora(zbudujTiff({ ...w, szer: 40, wys: 30, kafel: 16, piksel: wzor }))
    const n = await czytajNaglowekTiff(zrodlo)
    const kafel = await dekodujKafel(zrodlo, n, 1) // kolumna 1, wiersz 0
    assert.equal(kafel.length, 256)
    assert.ok(kafel instanceof Float32Array)
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        assert.equal(kafel[y * 16 + x], Math.fround(wzor(16 + x, y)), `${w.nazwa} (${x}, ${y})`)
    const krawedz = await dekodujKafel(zrodlo, n, 5) // kolumna 2 (x 32–47 z 40), wiersz 1 (y 16–31 z 30)
    assert.equal(krawedz[0], Math.fround(wzor(32, 16)))
    assert.equal(krawedz[15], WYPEŁNIENIE_KRAWĘDZI) // x = 47 poza rastrem
  }
})

test('kafel: zerowa długość to brak kafla (nodata), a kafel poza plikiem to błąd', async () => {
  const bufor = zbudujTiff({ szer: 32, wys: 16, kafel: 16, piksel: wzor, kompresja: 5, puste: [1] })
  const zrodlo = zrodloBufora(bufor)
  const n = await czytajNaglowekTiff(zrodlo)
  const pusty = await dekodujKafel(zrodlo, n, 1)
  assert.ok(pusty.every((v) => v === -999999))
  await assert.rejects(
    dekodujKafel(zrodlo, { ...n, dlugosci: n.dlugosci.map(() => 1e9) }, 0),
    /poza plikiem/,
  )
  await assert.rejects(dekodujKafel(zrodlo, n, 99), /poza plikiem/)
  // kafel o innej długości po rozpakowaniu (Deflate) to błąd, nie cichy skrót
  const maly = zbudujTiff({ szer: 16, wys: 16, kafel: 8, piksel: wzor, kompresja: 8 })
  const zr = zrodloBufora(maly)
  const nm = await czytajNaglowekTiff(zr)
  await assert.rejects(
    dekodujKafel(zr, { ...nm, kafelSzer: 16, kafelWys: 16 }, 0),
    /po rozpakowaniu/,
  )
})

test('okno: piksele zgadzają się z wzorem, także na granicach kafli i na krawędzi rastra', async () => {
  const okna = [
    [0, 0, 40, 30], // cały raster
    [0, 0, 1, 1],
    [15, 15, 17, 17], // przecina róg czterech kafli
    [16, 0, 32, 16], // dokładnie jeden kafel
    [30, 20, 40, 30], // prawy dolny róg z dopełnieniem kafla
    [3, 5, 38, 29],
  ]
  for (const w of WARIANTY) {
    const zrodlo = zrodloBufora(
      zbudujTiff({ ...w, szer: 40, wys: 30, kafel: 16, piksel: wzorZNodata }),
    )
    const n = await czytajNaglowekTiff(zrodlo)
    for (const [c0, r0, c1, r1] of okna) {
      const okno = await wczytajOkno(zrodlo, n, c0, r0, c1, r1)
      assert.equal(okno.szer, c1 - c0)
      assert.equal(okno.wys, r1 - r0)
      for (let y = 0; y < okno.wys; y++)
        for (let x = 0; x < okno.szer; x++)
          assert.equal(
            okno.piksele[y * okno.szer + x],
            wzorZNodata(c0 + x, r0 + y),
            `${w.nazwa} okno ${[c0, r0, c1, r1]} (${x}, ${y})`,
          )
      assert.ok(Math.abs(okno.lon0 - (19.5 + c0 * 0.001)) < 1e-12)
      assert.ok(Math.abs(okno.lat0 - (50.5 - r0 * 0.001)) < 1e-12)
    }
  }
})

test('okno: wychodzące poza raster jest przycinane, a leżące całkiem poza rastrem to błąd', async () => {
  const zrodlo = zrodloBufora(
    zbudujTiff({ szer: 40, wys: 30, kafel: 16, piksel: wzor, kompresja: 5, duzy: true }),
  )
  const n = await czytajNaglowekTiff(zrodlo)
  const okno = await wczytajOkno(zrodlo, n, -5, -5, 3, 3)
  assert.equal(okno.szer, 3)
  assert.equal(okno.wys, 3)
  assert.ok(Math.abs(okno.lon0 - 19.5) < 1e-12) // lewy górny róg okna to róg rastra
  assert.equal(okno.piksele[0], Math.fround(wzor(0, 0)))
  const dolne = await wczytajOkno(zrodlo, n, 35, 25, 100, 100)
  assert.equal(dolne.szer, 5)
  assert.equal(dolne.wys, 5)
  assert.equal(dolne.piksele[4 * 5 + 4], Math.fround(wzor(39, 29)))
  await assert.rejects(wczytajOkno(zrodlo, n, 40, 0, 50, 10), /poza rastrem/)
  await assert.rejects(wczytajOkno(zrodlo, n, 0, 30, 10, 40), /poza rastrem/)
})

test('okno dla punktów: obejmuje wszystkie punkty z zapasem, wartości zgodne z wzorem', async () => {
  const zrodlo = zrodloBufora(
    zbudujTiff({ szer: 60, wys: 50, kafel: 16, piksel: wzor, kompresja: 5, duzy: true }),
  )
  const n = await czytajNaglowekTiff(zrodlo)
  // środki pikseli (x, y): lon = 19.5 + (x + 0.5)·0.001, lat = 50.5 − (y + 0.5)·0.001
  const punkt = (x, y) => ({ lon: 19.5 + (x + 0.5) * 0.001, lat: 50.5 - (y + 0.5) * 0.001, x, y })
  const punkty = [punkt(10, 12), punkt(33, 20), punkt(21, 41)]
  const okno = await oknoDlaPunktow(zrodlo, n, punkty, 3)
  for (const p of punkty)
    assert.equal(wartoscPiksela(okno, p.lon, p.lat), Math.fround(wzor(p.x, p.y)))
  // okno ma zapas 3 pikseli wokół zakresu punktów
  assert.equal(okno.szer, 33 - 10 + 1 + 2 * 3)
  assert.equal(okno.wys, 41 - 12 + 1 + 2 * 3)
  await assert.rejects(oknoDlaPunktow(zrodlo, n, []), /Brak punktów/)
})

test('wartoscPiksela: piksel z punktem, nodata i NaN to null, punkt poza oknem to błąd', async () => {
  const f = (x, y) => (x === 2 && y === 1 ? -999999 : x === 3 && y === 1 ? Number.NaN : x + 10 * y)
  const zrodlo = zrodloBufora(zbudujTiff({ szer: 8, wys: 8, kafel: 8, piksel: f }))
  const n = await czytajNaglowekTiff(zrodlo)
  const okno = await wczytajOkno(zrodlo, n, 0, 0, 8, 8)
  const srodek = (x, y) => [19.5 + (x + 0.5) * 0.001, 50.5 - (y + 0.5) * 0.001]
  assert.equal(wartoscPiksela(okno, ...srodek(4, 3)), 34)
  assert.equal(wartoscPiksela(okno, ...srodek(2, 1)), null)
  assert.equal(wartoscPiksela(okno, ...srodek(3, 1)), null)
  // lewy górny róg rastra należy do piksela (0, 0); pół piksela niżej jest już wiersz 1
  assert.equal(wartoscPiksela(okno, 19.5, 50.5), 0)
  assert.equal(wartoscPiksela(okno, 19.5002, 50.4985), 10)
  assert.throws(() => wartoscPiksela(okno, 19.4999, 50.4995), /poza oknem/)
  assert.throws(() => wartoscPiksela(okno, 19.5 + 8.5 * 0.001, 50.4995), /poza oknem/)
  assert.throws(() => wartoscPiksela(okno, 19.5, 50.5 + 0.0001), /poza oknem/)
  assert.throws(() => wartoscPiksela(okno, 19.5, 50.5 - 8.5 * 0.001), /poza oknem/)
})

// ── Statystyki ─────────────────────────────────────────────────────────────────────────────────

test('statystykiGdal: liczby z metadanych XML, brak pól i brak XML to pusty wynik', () => {
  const xml = `<GDALMetadata>
  <Item name="Description">tekst</Item>
  <Item name="STATISTICS_MAXIMUM" sample="0">815.94470214844</Item>
  <Item name="STATISTICS_MEAN" sample="0">1.2148999985956</Item>
  <Item name="STATISTICS_MINIMUM" sample="0">0</Item>
  <Item name="STATISTICS_STDDEV" sample="0">4.4635190607244</Item>
  <Item name="STATISTICS_VALID_PERCENT" sample="0">70.03</Item>
  <Item name="STATISTICS_X" sample="0">nie liczba</Item>
</GDALMetadata>`
  assert.deepEqual(statystykiGdal(xml), {
    maximum: 815.94470214844,
    mean: 1.2148999985956,
    minimum: 0,
    stddev: 4.4635190607244,
    valid_percent: 70.03,
  })
  assert.deepEqual(statystykiGdal(null), {})
  assert.deepEqual(statystykiGdal('<GDALMetadata></GDALMetadata>'), {})
})

test('statystykiRastra: całość rastra jak liczenie wprost, bez dopełnienia kafli i bez nodata', async () => {
  const szer = 37
  const wys = 21
  for (const w of WARIANTY) {
    const zrodlo = zrodloBufora(zbudujTiff({ ...w, szer, wys, kafel: 16, piksel: wzorZNodata }))
    const n = await czytajNaglowekTiff(zrodlo)
    const s = await statystykiRastra(zrodlo, n)
    let waznych = 0
    let suma = 0
    let suma2 = 0
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let y = 0; y < wys; y++)
      for (let x = 0; x < szer; x++) {
        const v = wzorZNodata(x, y)
        if (v === -999999) continue
        waznych++
        suma += v
        suma2 += v * v
        min = Math.min(min, v)
        max = Math.max(max, v)
      }
    assert.equal(s.wszystkich, szer * wys, w.nazwa)
    assert.equal(s.waznych, waznych)
    assert.equal(s.minimum, min)
    assert.equal(s.maximum, max)
    assert.ok(Math.abs(s.mean - suma / waznych) < 1e-9)
    assert.ok(Math.abs(s.stddev - Math.sqrt(suma2 / waznych - (suma / waznych) ** 2)) < 1e-6)
    assert.ok(Math.abs(s.valid_percent - (100 * waznych) / (szer * wys)) < 1e-9)
  }
})

// ── Źródła bajtów ──────────────────────────────────────────────────────────────────────────────

test('źródło z pliku: odczyt zakresów jak z bufora, odczyt poza plikiem to błąd', async () => {
  const katalog = mkdtempSync(join(tmpdir(), 'tiff-test-'))
  try {
    const bufor = zbudujTiff({
      duzy: true,
      szer: 40,
      wys: 30,
      kafel: 16,
      piksel: wzor,
      kompresja: 5,
    })
    const sciezka = join(katalog, 'raster.tif')
    writeFileSync(sciezka, bufor)
    const zrodlo = await zrodloPliku(sciezka)
    try {
      assert.equal(zrodlo.rozmiar, bufor.length)
      assert.deepEqual(await zrodlo.czytaj(10, 20), bufor.subarray(10, 30))
      await assert.rejects(zrodlo.czytaj(bufor.length - 5, 10), /poza plikiem/)
      await assert.rejects(zrodlo.czytaj(-1, 4), /poza plikiem/)
      const n = await czytajNaglowekTiff(zrodlo)
      const okno = await wczytajOkno(zrodlo, n, 0, 0, 40, 30)
      assert.equal(okno.piksele[29 * 40 + 39], Math.fround(wzor(39, 29)))
    } finally {
      await zrodlo.zamknij()
    }
  } finally {
    rmSync(katalog, { recursive: true, force: true })
  }
  const bufor = zrodloBufora(Buffer.alloc(10))
  await assert.rejects(bufor.czytaj(8, 4), /poza buforem/)
})
