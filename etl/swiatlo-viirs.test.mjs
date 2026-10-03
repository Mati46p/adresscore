import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { czytajNaglowekTiff, oknoDlaPunktow, wartoscPiksela, zrodloPliku } from './lib/tiff.mjs'
import { CACHE, DANE, wczytajAdresy } from './lib/wspolne.mjs'
import {
  KONTROLE,
  korelacjaRangowa,
  metaWskaznika,
  OCZEKIWANY_PLIK,
  ocenPrzesuniecia,
  opisWskaznika,
  PLIK_RASTRA,
  percentyl,
  podsumuj,
  porownajZGdal,
  przesunieciaKorelacji,
  rangi,
  sprawdzMiejsca,
  ZAKRES,
} from './swiatlo-viirs.mjs'

// Pauza (U+2014) jest zakazana w polskich tekstach projektu; zapis przez kod znaku, żeby sam
// plik testu jej nie zawierał.
const PAUZA = String.fromCharCode(0x2014)

/** Okno rastra z funkcji (x, y) → wartość; georeferencja jak w WorldPop, ale mały piksel. */
function oknoZ(szer, wys, f, { lon0 = 19.8, lat0 = 50.1, krok = 0.0005, nodata = -999999 } = {}) {
  const piksele = new Float32Array(szer * wys)
  for (let y = 0; y < wys; y++) for (let x = 0; x < szer; x++) piksele[y * szer + x] = f(x, y)
  return { szer, wys, piksele, lon0, lat0, dLon: krok, dLat: krok, nodata }
}

// ── Statystyka ─────────────────────────────────────────────────────────────────────────────────

test('percentyl: interpolacja liniowa, brzegi i pusta lista', () => {
  const t = [1, 2, 3, 4, 5]
  assert.equal(percentyl(t, 0), 1)
  assert.equal(percentyl(t, 100), 5)
  assert.equal(percentyl(t, 50), 3)
  assert.equal(percentyl(t, 25), 2)
  assert.equal(percentyl(t, 10), 1.4)
  assert.equal(percentyl([], 50), null)
  assert.equal(percentyl([7], 99), 7)
})

test('podsumuj: null to brak danych, a zero źródła to pomiar liczony osobno', () => {
  const s = podsumuj([null, 0, 0, 2, 4, null, 10])
  assert.equal(s.n, 5)
  assert.equal(s.nulli, 2)
  assert.equal(s.zer, 2)
  assert.equal(s.min, 0)
  assert.equal(s.max, 10)
  assert.equal(s.mediana, 2)
  assert.equal(s.srednia, 16 / 5)
  const pusty = podsumuj([null, null])
  assert.equal(pusty.n, 0)
  assert.equal(pusty.mediana, null)
  assert.equal(pusty.srednia, null)
})

test('rangi: uśredniają remisy i nie zależą od kolejności wejścia', () => {
  assert.deepEqual([...rangi([10, 20, 20, 30])], [0, 1.5, 1.5, 3])
  assert.deepEqual([...rangi([30, 20, 10, 20])], [3, 1.5, 0, 1.5])
  assert.deepEqual([...rangi([5, 5, 5])], [1, 1, 1])
})

test('korelacja rangowa: zgodna ze wzorem, odporna na ogon i na null', () => {
  assert.equal(korelacjaRangowa([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]).r, 1)
  assert.equal(korelacjaRangowa([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]).r, -1)
  // zależność monotoniczna, ale nieliniowa z ogromnym wyrzutem: Spearman = 1, Pearson by spadł
  const x = [1, 2, 3, 4, 5, 6]
  const y = [1, 2, 3, 4, 5, 1_000_000]
  assert.equal(korelacjaRangowa(x, y).r, 1)
  // remisy: ręcznie policzone r = 4,5 / sqrt(4,5 · 5)
  const z = korelacjaRangowa([1, 1, 2, 3], [1, 2, 3, 4])
  assert.ok(Math.abs(z.r - 4.5 / Math.sqrt(4.5 * 5)) < 1e-12)
  // pary z null i NaN odpadają
  const k = korelacjaRangowa([1, null, 3, 4, Number.NaN, 6], [2, 5, 6, 8, 7, 12])
  assert.equal(k.n, 4)
  assert.equal(k.r, 1)
  // za mało par albo stała po jednej stronie: brak wyniku, nie 0 i nie NaN
  assert.deepEqual(korelacjaRangowa([1, 2], [3, 4]), { n: 2, r: null })
  assert.equal(korelacjaRangowa([1, 2, 3], [5, 5, 5]).r, null)
})

// ── Kontrole ───────────────────────────────────────────────────────────────────────────────────

test('miejsca znane: granice rozdzielają śródmieście od lasu, a każde ma współrzędne w okolicy Krakowa', () => {
  assert.ok(KONTROLE.length >= 4)
  assert.equal(new Set(KONTROLE.map((k) => k.nazwa)).size, KONTROLE.length)
  // klucze zasilają liczby w opisie wskaźnika: muszą być unikalne i obejmować to, co opis cytuje
  const klucze = KONTROLE.map((k) => k.klucz)
  assert.equal(new Set(klucze).size, klucze.length)
  for (const wymagany of ['rynek', 'lasWolski', 'puszcza'])
    assert.ok(klucze.includes(wymagany), `brak miejsca „${wymagany}” w KONTROLE`)
  for (const k of KONTROLE) {
    assert.ok(k.lon > 19.6 && k.lon < 20.4 && k.lat > 49.9 && k.lat < 50.25, k.nazwa)
    assert.ok(k.min !== undefined || k.max !== undefined, k.nazwa)
  }
  const dolnaMiasta = Math.min(...KONTROLE.filter((k) => k.min !== undefined).map((k) => k.min))
  const gornaLasu = Math.max(...KONTROLE.filter((k) => k.max !== undefined).map((k) => k.max))
  assert.ok(dolnaMiasta > 3 * gornaLasu, 'kontrole muszą odróżniać miasto od lasu z zapasem')
})

/** Okno obejmujące miejsca znane, z wartością przypisaną wokół każdego z nich. */
function oknoMiejsc(wartosci, tlo = 20) {
  const krok = 0.0005
  const lon0 = 19.8
  const lat0 = 50.1
  return oknoZ(
    Math.ceil((20.35 - lon0) / krok),
    Math.ceil((lat0 - 50.04) / krok),
    (x, y) => {
      const lon = lon0 + (x + 0.5) * krok
      const lat = lat0 - (y + 0.5) * krok
      for (const m of KONTROLE)
        if (Math.abs(lon - m.lon) < 0.001 && Math.abs(lat - m.lat) < 0.001) return wartosci[m.nazwa]
      return tlo
    },
    { lon0, lat0, krok },
  )
}

test('sprawdzMiejsca: dobre wartości przechodzą, a zła georeferencja jest wskazana z nazwy', () => {
  const dobre = Object.fromEntries(
    KONTROLE.map((k) => [k.nazwa, k.min !== undefined ? k.min + 40 : (k.max ?? 1) / 2]),
  )
  const ok = sprawdzMiejsca(oknoMiejsc(dobre))
  assert.deepEqual(ok.bledy, [])
  assert.equal(ok.wyniki.length, KONTROLE.length)
  assert.equal(ok.wyniki[0].wartosc, dobre[KONTROLE[0].nazwa])

  // odwrócona jasność (np. zła oś): śródmieście ciemne, las jasny
  const zle = Object.fromEntries(KONTROLE.map((k) => [k.nazwa, k.min !== undefined ? 1 : 80]))
  const wynik = sprawdzMiejsca(oknoMiejsc(zle))
  assert.equal(wynik.bledy.length, KONTROLE.length)
  assert.match(wynik.bledy[0], /Rynek Główny/)

  // piksel bez danych w miejscu znanym to też naruszenie, nie „przeszło”
  const brak = { ...dobre, [KONTROLE[0].nazwa]: -999999 }
  const bezDanych = sprawdzMiejsca(oknoMiejsc(brak))
  assert.equal(bezDanych.bledy.length, 1)
  assert.match(bezDanych.bledy[0], /brak danych/)
})

/** Złożona, niemonotoniczna funkcja: przesunięcie o kilka pikseli wyraźnie zmienia jej rangi. */
const poleJasnosci = (x, y) => ((x * 37 + y * 11) % 97) + Math.sin(x / 9) * Math.cos(y / 7) * 20

/** Adresy rozrzucone w środku okna 200 × 200 (zapas na przesunięcia do 10 px). */
function adresyPrzesuniec(okno, ile = 400) {
  let a = 12345
  const los = () => {
    a = (Math.imul(a, 1103515245) + 12345) & 0x7fffffff
    return a / 0x7fffffff
  }
  return Array.from({ length: ile }, () => {
    const x = 40 + Math.floor(los() * 120)
    const y = 40 + Math.floor(los() * 120)
    return {
      x,
      y,
      lon: okno.lon0 + (x + 0.5) * okno.dLon,
      lat: okno.lat0 - (y + 0.5) * okno.dLat,
    }
  })
}

test('test przesunięcia: raster położony poprawnie ma maksimum korelacji w zerze', () => {
  const okno = oknoZ(200, 200, poleJasnosci)
  const adresy = adresyPrzesuniec(okno)
  const referencja = adresy.map((a) => Math.fround(poleJasnosci(a.x, a.y)))
  const maska = adresy.map(() => true)
  const wyniki = przesunieciaKorelacji(okno, adresy, referencja, maska)
  assert.equal(wyniki.length, 25)
  const ocena = ocenPrzesuniecia(wyniki)
  assert.deepEqual([ocena.najlepsze.dc, ocena.najlepsze.dr], [0, 0])
  assert.ok(Math.abs(ocena.zero.r - 1) < 1e-12)
  assert.equal(ocena.ok, true)
  for (const w of wyniki) if (w.dc !== 0 || w.dr !== 0) assert.ok(w.r < 0.9, `(${w.dc}, ${w.dr})`)
})

test('test przesunięcia: raster przesunięty o 10 pikseli jest wykryty, a maska wyklucza adresy', () => {
  const okno = oknoZ(200, 200, poleJasnosci)
  const adresy = adresyPrzesuniec(okno)
  // referencja zgodna z rastrem przesuniętym o (+10, -10) pikseli względem adresów
  const referencja = adresy.map((a) => Math.fround(poleJasnosci(a.x + 10, a.y - 10)))
  const wyniki = przesunieciaKorelacji(
    okno,
    adresy,
    referencja,
    adresy.map(() => true),
  )
  const ocena = ocenPrzesuniecia(wyniki)
  assert.deepEqual([ocena.najlepsze.dc, ocena.najlepsze.dr], [10, -10])
  assert.equal(ocena.ok, false)

  // maska false: adres nie bierze udziału (null po stronie jasności), więc par jest mniej
  const polowa = przesunieciaKorelacji(
    okno,
    adresy,
    referencja,
    adresy.map((_, i) => i % 2 === 0),
    [0],
  )
  assert.equal(polowa.length, 1)
  assert.ok(Number.isFinite(polowa[0].r))
})

test('ocenPrzesuniecia: maksimum w odległości do 5 pikseli jest dopuszczalne, dalej nie', () => {
  const wyniki = (dc, dr) => [
    { dc: 0, dr: 0, r: 0.7 },
    { dc, dr, r: 0.8 },
  ]
  assert.equal(ocenPrzesuniecia(wyniki(5, -5)).ok, true)
  assert.equal(ocenPrzesuniecia(wyniki(10, 0)).ok, false)
  assert.equal(ocenPrzesuniecia(wyniki(0, -10)).ok, false)
})

test('porównanie ze statystykami GDAL: zgodne przechodzi, rozjazd wskazuje pole', () => {
  const gdal = { mean: 1.2149, maximum: 815.94, minimum: 0, stddev: 4.4635, valid_percent: 70.03 }
  const wlasne = {
    mean: 1.2149000001,
    maximum: 815.94,
    minimum: 0,
    stddev: 4.4635,
    valid_percent: 70.0301,
  }
  assert.deepEqual(porownajZGdal(wlasne, gdal), [])
  const zle = porownajZGdal({ ...wlasne, mean: 1.3 }, gdal)
  assert.equal(zle.length, 1)
  assert.match(zle[0], /^mean:/)
  // pola, których GDAL nie zapisał, nie są porównywane
  assert.deepEqual(porownajZGdal(wlasne, { mean: 1.2149 }), [])
  assert.equal(porownajZGdal({ ...wlasne, valid_percent: 71 }, gdal).length, 1)
})

// ── Opis i meta ────────────────────────────────────────────────────────────────────────────────

const KOTWICE = { rynek: 91.3, medianaKrakowa: 21.9, lasWolski: 4.83, puszcza: 1.39 }

test('opis: liczby z danych z polskim przecinkiem, bez pauzy, bez nadużyć w sformułowaniach', () => {
  const opis = opisWskaznika(KOTWICE)
  assert.match(opis, /Rynek Główny w Krakowie 91,/)
  assert.match(opis, /mediana adresów Krakowa 22,/)
  assert.match(opis, /Las Wolski 4,8,/)
  assert.match(opis, /Puszcza Niepołomicka 1,4\./)
  assert.match(opis, /nW\/cm²\/sr/)
  assert.match(opis, /nie jasność nieba/)
  assert.match(opis, /Zero oznacza światło poniżej progu czułości/)
  assert.ok(!opis.includes(PAUZA), 'w polskim tekście półpauza, nie pauza')
  assert.ok(!/\d\.\d/.test(opis.replace(/EOG VNL 2\.2/, '')), 'przecinek dziesiętny, nie kropka')
})

test('meta: kontrakt wskaźnika, dwa źródła z licencją i datami, uczciwa rozdzielczość', () => {
  const meta = metaWskaznika(KOTWICE, '2026-10-03')
  assert.equal(meta.id, 'swiatlo_nocne_viirs')
  assert.match(meta.id, /^[a-z0-9_]+$/)
  assert.equal(meta.kategoria, 'spokoj')
  assert.equal(meta.kierunek, 'mniej-lepiej')
  assert.equal(meta.rozdzielczosc, 'siatka')
  assert.match(meta.rozmiar, /15″/)
  assert.equal(meta.jednostka, 'nW/cm²/sr')
  assert.equal(meta.zadanie, 137)
  assert.deepEqual(meta.zakres, ZAKRES)
  assert.equal(meta.atrapa, undefined)
  assert.equal(meta.norma, undefined, 'nie ma normy prawnej dla jasności nocnej z satelity')
  assert.equal(meta.zrodla.length, 2)
  for (const z of meta.zrodla) {
    for (const k of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano']) assert.ok(z[k], k)
    assert.match(z.licencja, /CC BY 4\.0/)
    assert.equal(z.dataDanych, '2023')
    assert.equal(z.pobrano, '2026-10-03')
  }
  assert.match(meta.zrodla[0].licencja, /WorldPop/)
  assert.match(meta.zrodla[0].nazwa, new RegExp(PLIK_RASTRA.replace(/\./g, '\\.')))
  assert.match(meta.zrodla[1].licencja, /Elvidge/)
  assert.match(meta.zrodla[1].url, /eogdata\.mines\.edu/)
  assert.ok(!JSON.stringify(meta).includes(PAUZA), 'w polskim tekście półpauza, nie pauza')
})

test('oczekiwany plik źródłowy: rozmiar, suma SHA-256 i wymiary są opisane', () => {
  assert.equal(OCZEKIWANY_PLIK.rozmiar, 144_825_645)
  assert.match(OCZEKIWANY_PLIK.sha256, /^[0-9a-f]{64}$/)
  assert.equal(OCZEKIWANY_PLIK.nodata, -999_999)
  assert.ok(OCZEKIWANY_PLIK.szer > 0 && OCZEKIWANY_PLIK.wys > 0)
})

// ── Opublikowany wskaźnik ──────────────────────────────────────────────────────────────────────

const sciezkaWskaznika = join(DANE, 'wskazniki', 'swiatlo_nocne_viirs.json')
const plikWskaznika = JSON.parse(readFileSync(sciezkaWskaznika, 'utf8'))

test('opublikowany wskaźnik: kontrakt, wersja adresów, pokrycie i rozmiar pliku', () => {
  const { wersja, adresy } = wczytajAdresy()
  const { meta, wartosci } = plikWskaznika
  assert.equal(plikWskaznika.wersjaAdresow, wersja)
  assert.equal(wartosci.length, adresy.length)
  assert.deepEqual(Object.keys(plikWskaznika).sort(), ['meta', 'wartosci', 'wersjaAdresow'])
  assert.equal(meta.id, 'swiatlo_nocne_viirs')
  assert.equal(meta.kategoria, 'spokoj')
  assert.equal(meta.kierunek, 'mniej-lepiej')
  assert.equal(meta.rozdzielczosc, 'siatka')
  assert.equal(meta.zadanie, 137)
  assert.deepEqual(meta.zakres, ZAKRES)
  assert.deepEqual(
    { ...meta, opis: null, zrodla: null },
    { ...metaWskaznika(KOTWICE), opis: null, zrodla: null },
    'meta opublikowanego pliku zgadza się z kodem skryptu (poza opisem i źródłami z datą)',
  )
  assert.ok(!JSON.stringify(meta).includes(PAUZA), 'w polskim tekście półpauza, nie pauza')
  for (const z of meta.zrodla) assert.match(z.pobrano, /^\d{4}-\d{2}-\d{2}$/)

  let policzone = 0
  for (const v of wartosci) {
    if (v === null) continue
    policzone++
    assert.ok(Number.isFinite(v) && v >= 0, `wartość ${v}`)
    assert.equal(v, Math.round(v * 100) / 100, 'wartości zaokrąglone do 0,01')
  }
  assert.ok(policzone >= 0.99 * wartosci.length, `pokrycie ${policzone}/${wartosci.length}`)
  assert.ok(statSync(sciezkaWskaznika).size < 2 * 1024 * 1024, 'plik wskaźnika < 2 MB')
})

test('opublikowany wskaźnik: opis ma medianę Krakowa z danych, a miasto jest jaśniejsze niż wieś', () => {
  const { adresy } = wczytajAdresy()
  const { wartosci, meta } = plikWskaznika
  const krakow = podsumuj(wartosci.filter((_, i) => adresy[i].gmina === 'Kraków'))
  const poza = podsumuj(wartosci.filter((_, i) => adresy[i].gmina !== 'Kraków'))
  const liczba = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
  assert.ok(
    meta.opis.includes(`mediana adresów Krakowa ${liczba.format(krakow.mediana)},`),
    `opis nie zgadza się z medianą ${krakow.mediana}`,
  )
  assert.ok(krakow.mediana > 2 * poza.mediana, 'Kraków jaśniejszy niż gminy wokół niego')
  assert.ok(krakow.p5 > poza.p5)
  // zero źródła zostaje zerem: istnieją adresy bez wykrytego światła, nie są null
  assert.ok(poza.zer > 0)
  assert.equal(krakow.zer, 0)
  assert.equal(krakow.nulli + poza.nulli, 0)

  // adres w sercu miasta i adres na wsi: wartości zgodne z kierunkiem rozkładu
  const wartoscAdresu = (ulica, nr, gmina) => {
    const i = adresy.findIndex((a) => a.ulica === ulica && a.nr === nr && a.gmina === gmina)
    assert.notEqual(i, -1, `${ulica} ${nr} (${gmina})`)
    return wartosci[i]
  }
  assert.ok(wartoscAdresu('Rynek Główny', '10', 'Kraków') > 50)
  const wies = adresy.findIndex((a) => a.gmina === 'Koniusza')
  assert.ok(wartosci[wies] < 5)
})

const sciezkaRastra = join(CACHE, 'viirs', PLIK_RASTRA)

test('opublikowany wskaźnik: wartości zgadzają się z odczytem rastra w cache (próbka adresów)', {
  skip: existsSync(sciezkaRastra) ? false : `brak ${sciezkaRastra} (node etl/swiatlo-viirs.mjs)`,
}, async () => {
  const { adresy } = wczytajAdresy()
  const probka = adresy.map((a, i) => ({ ...a, i })).filter((a) => a.i % 400 === 0)
  assert.ok(probka.length > 400)
  const zrodlo = await zrodloPliku(sciezkaRastra)
  try {
    const naglowek = await czytajNaglowekTiff(zrodlo)
    assert.equal(naglowek.szer, OCZEKIWANY_PLIK.szer)
    assert.equal(naglowek.wys, OCZEKIWANY_PLIK.wys)
    const okno = await oknoDlaPunktow(zrodlo, naglowek, probka, 3)
    for (const a of probka) {
      const v = wartoscPiksela(okno, a.lon, a.lat)
      const opublikowana = plikWskaznika.wartosci[a.i]
      assert.ok(
        v !== null && Math.abs(v - opublikowana) <= 0.005 + 1e-9,
        `adres ${a.i}: raster ${v}, plik ${opublikowana}`,
      )
    }
  } finally {
    await zrodlo.zamknij()
  }
})
