// Nocne światło z satelity VIIRS dla KAŻDEGO adresu (#137): wskaźnik swiatlo_nocne_viirs.
// Źródło: roczna średnia jasność nocna VIIRS DNB, produkt EOG „VNL v2.2, annual average masked”
// za 2023 r., w kopii WorldPop (zbiór „Nighttime Lights 2015–2023”, Polska, wariant nvf = bez filtra
// pochodni gazowych i wulkanów). Oryginały (NASA Black Marble VNP46A4 w LAADS i EOG w Mines) są
// za logowaniem (Earthdata Login, konto EOG); kopia WorldPop jest otwarta, licencja CC BY 4.0.
// Jednostka: nW/cm²/sr, czyli światło wysyłane w górę z powierzchni. To pośrednik zanieczyszczenia
// światłem w skali okolicy, nie jasność nieba widziana z balkonu ani oświetlenie ulicy.
// Metoda: wartość piksela, w którym leży adres. Natywne oczko VNL to 15″ (ok. 460 m × 300 m
// na 50°N); WorldPop wygładził je do 3″ (w oknie adresów 0 z 367 595 par sąsiednich pikseli
// o wartości dodatniej ma równe wartości), więc to interpolacja między oczkami, a uczciwa
// rozdzielczość to wciąż 15″.
// Zero w źródle to „brak światła powyżej progu czułości” (EOG zeruje tło), czyli pomiar. Brak
// pomiaru to nodata (−999999), który zamieniamy na null; w obszarze adresów nie występuje.
// Odczyt własny, bez GDAL: BigTIFF z kompresją LZW (etl/lib/tiff.mjs), tylko kafle pod adresami.
// Uruchom: node etl/swiatlo-viirs.mjs [--szybko]. Pobranie (145 MB, raz) trafia do etl/.cache/viirs/;
// --szybko pomija kontrolę dekodera na całym rastrze (ok. 5 s).
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  czytajNaglowekTiff,
  oknoDlaPunktow,
  statystykiGdal,
  statystykiRastra,
  wartoscPiksela,
  zrodloPliku,
} from './lib/tiff.mjs'
import { CACHE, DANE, dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const ROK = 2023
export const PLIK_RASTRA = `pol_viirs_nvf_${ROK}_100m_v1.tif`
export const URL_RASTRA = `https://data.worldpop.org/GIS/Covariates/Global_2015_2030/POL/VIIRS/v1/nvf/${PLIK_RASTRA}`
export const URL_STRONY_ZBIORU = 'https://hub.worldpop.org/geodata/summary?id=62680'
/** Co dokładnie wolno nam czytać: inny rozmiar lub suma oznaczają inną wersję pliku u źródła. */
export const OCZEKIWANY_PLIK = {
  rozmiar: 144_825_645,
  sha256: '6c7ae8f3f6a8c027aef40642cf737a6b73827f7be14a7fb6e643c4da8d74c045',
  szer: 12_027,
  wys: 7_001,
  nodata: -999_999,
}
/**
 * Zakres skali dla silnika (silnik skaluje liniowo): poświata nad miastem jest w przybliżeniu sumą
 * wkładów źródeł światła, więc skala liniowa nie przekłamuje. 60 nW/cm²/sr to 97. percentyl
 * adresów Krakowa (p97 = 59 dla rocznika 2023, patrz etl/swiatlo-viirs.md); wyżej jest już samo
 * śródmieście, które i tak dostaje najniższą ocenę.
 */
export const ZAKRES = [0, 60]
/** Zapas okna w pikselach: pokrywa przesunięcia testu georeferencji (do 10 px) z zapasem. */
export const ZAPAS_OKNA = 12
export const PRZESUNIECIA = [-10, -5, 0, 5, 10]

const LICENCJA_WORLDPOP =
  'CC BY 4.0 – https://creativecommons.org/licenses/by/4.0/ – © WorldPop, University of Southampton (2024), DOI 10.5258/SOTON/WP00772; dane wejściowe: EOG VNL v2.2; przekształcenie: wartość piksela rastra w punkcie adresu'
const LICENCJA_EOG =
  'CC BY 4.0 – https://creativecommons.org/licenses/by/4.0/ – © Earth Observation Group, Payne Institute for Public Policy, Colorado School of Mines; cytowanie: Elvidge C.D., Zhizhin M., Ghosh T., Hsu F.-C., Taneja J. (2021), Remote Sensing 13(5):922, https://doi.org/10.3390/rs13050922'

// ── Statystyka ────────────────────────────────────────────────────────────────────────────────

/** Percentyl z interpolacją liniową; `posortowane` rosnąco, p w procentach. */
export function percentyl(posortowane, p) {
  if (posortowane.length === 0) return null
  const poz = (p / 100) * (posortowane.length - 1)
  const d = Math.floor(poz)
  const g = Math.ceil(poz)
  return posortowane[d] + (posortowane[g] - posortowane[d]) * (poz - d)
}

/** Podsumowanie rozkładu; null pomijamy, zera liczymy osobno (zero to pomiar, nie brak). */
export function podsumuj(wartosci) {
  const liczby = wartosci.filter((v) => v !== null).sort((a, b) => a - b)
  return {
    n: liczby.length,
    nulli: wartosci.length - liczby.length,
    zer: liczby.filter((v) => v === 0).length,
    min: liczby[0] ?? null,
    p5: percentyl(liczby, 5),
    p25: percentyl(liczby, 25),
    mediana: percentyl(liczby, 50),
    p75: percentyl(liczby, 75),
    p95: percentyl(liczby, 95),
    p97: percentyl(liczby, 97),
    p99: percentyl(liczby, 99),
    max: liczby.at(-1) ?? null,
    srednia: liczby.length ? liczby.reduce((a, b) => a + b, 0) / liczby.length : null,
  }
}

/** Rangi liczone od 0 (0 = najmniejsza wartość); remisy dostają średnią rangę. */
export function rangi(wartosci) {
  const kolejnosc = wartosci.map((v, i) => i).sort((a, b) => wartosci[a] - wartosci[b])
  const wynik = new Float64Array(wartosci.length)
  for (let i = 0; i < kolejnosc.length; ) {
    let j = i
    while (j + 1 < kolejnosc.length && wartosci[kolejnosc[j + 1]] === wartosci[kolejnosc[i]]) j++
    const ranga = (i + j) / 2
    for (let k = i; k <= j; k++) wynik[kolejnosc[k]] = ranga
    i = j + 1
  }
  return wynik
}

function pearson(x, y) {
  const n = x.length
  let sx = 0
  let sy = 0
  for (let i = 0; i < n; i++) {
    sx += x[i]
    sy += y[i]
  }
  const mx = sx / n
  const my = sy / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx
    const b = y[i] - my
    sxx += a * a
    syy += b * b
    sxy += a * b
  }
  return sxx <= 0 || syy <= 0 ? null : sxy / Math.sqrt(sxx * syy)
}

/**
 * Korelacja rangowa Spearmana na parach, w których obie wartości są liczbami (null pomijamy).
 * Rangowa, bo jasność nocna ma rozkład z długim ogonem: kilka bardzo jasnych oczek zdominowałoby
 * zwykłą korelację Pearsona. `r` = null, gdy par jest mniej niż 3 albo jedna strona jest stała.
 */
export function korelacjaRangowa(x, y) {
  const a = []
  const b = []
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      a.push(x[i])
      b.push(y[i])
    }
  }
  if (a.length < 3) return { n: a.length, r: null }
  return { n: a.length, r: pearson(rangi(a), rangi(b)) }
}

// ── Kontrole ──────────────────────────────────────────────────────────────────────────────────

/**
 * Znane miejsca z oczekiwanym przedziałem jasności (kontrola sensu, nie dane wejściowe). Granice
 * są szerokie: łapią błąd rzędu wielkości (zła oś, zły róg, zła jednostka), nie wahania roczne.
 * `klucz` to nazwa liczby w opisie wskaźnika (opisWskaznika), więc kolejność wpisów jest dowolna.
 */
export const KONTROLE = [
  {
    klucz: 'rynek',
    nazwa: 'Rynek Główny w Krakowie (śródmieście)',
    lon: 19.9372,
    lat: 50.0617,
    min: 50,
  },
  {
    klucz: 'galeria',
    nazwa: 'Galeria Krakowska i Dworzec Główny',
    lon: 19.9448,
    lat: 50.0647,
    min: 50,
  },
  { klucz: 'lasWolski', nazwa: 'Las Wolski (las)', lon: 19.833, lat: 50.0525, max: 15 },
  { klucz: 'puszcza', nazwa: 'Puszcza Niepołomicka (las)', lon: 20.3, lat: 50.08, max: 5 },
]

/** Wartości w miejscach znanych i lista naruszeń (pusta = wszystkie kontrole przeszły). */
export function sprawdzMiejsca(okno, miejsca = KONTROLE) {
  const wyniki = miejsca.map((m) => ({ ...m, wartosc: wartoscPiksela(okno, m.lon, m.lat) }))
  const bledy = wyniki
    .filter(
      (m) =>
        m.wartosc === null ||
        (m.min !== undefined && m.wartosc < m.min) ||
        (m.max !== undefined && m.wartosc > m.max),
    )
    .map(
      (m) =>
        `${m.nazwa}: ${m.wartosc === null ? 'brak danych' : m.wartosc.toFixed(1)}` +
        ` (oczekiwano ${m.min !== undefined ? `≥ ${m.min}` : ''}${m.max !== undefined ? `≤ ${m.max}` : ''})`,
    )
  return { wyniki, bledy }
}

/**
 * Kontrola georeferencji: korelacja rangowa jasności z wartością referencyjną (np. ludnością
 * w oczku 1 km) przy przesunięciu okna o (dc, dr) pikseli. Gdy raster leży dobrze, maksimum
 * wypada blisko zera; błąd rzędu setek metrów (zła oś, zły róg) przesuwa je albo rozmywa.
 * `maska[i]` = false wyklucza adres (np. poza Krakowem).
 */
export function przesunieciaKorelacji(okno, adresy, referencja, maska, kroki = PRZESUNIECIA) {
  const wynik = []
  for (const dr of kroki) {
    for (const dc of kroki) {
      const x = adresy.map((a, i) =>
        maska[i] ? wartoscPiksela(okno, a.lon + dc * okno.dLon, a.lat - dr * okno.dLat) : null,
      )
      wynik.push({ dc, dr, r: korelacjaRangowa(x, referencja).r })
    }
  }
  return wynik
}

/** Najlepsze przesunięcie i werdykt: maksimum w odległości najwyżej `dopuszczalne` pikseli. */
export function ocenPrzesuniecia(wyniki, dopuszczalne = 5) {
  const najlepsze = wyniki.reduce((a, b) => (b.r > a.r ? b : a))
  const zero = wyniki.find((w) => w.dc === 0 && w.dr === 0)
  return {
    najlepsze,
    zero,
    ok: Math.abs(najlepsze.dc) <= dopuszczalne && Math.abs(najlepsze.dr) <= dopuszczalne,
  }
}

/** Porównuje statystyki własnego dekodera z zapisanymi przez GDAL; zwraca listę rozbieżności. */
export function porownajZGdal(wlasne, gdal, tolerancja = 1e-6) {
  const bledy = []
  for (const klucz of ['mean', 'maximum', 'minimum', 'stddev', 'valid_percent']) {
    if (gdal[klucz] === undefined) continue
    // valid_percent GDAL zaokrągla do 2 miejsc po przecinku.
    const tol = klucz === 'valid_percent' ? 0.01 : tolerancja * Math.max(1, Math.abs(gdal[klucz]))
    if (Math.abs(wlasne[klucz] - gdal[klucz]) > tol)
      bledy.push(`${klucz}: własne ${wlasne[klucz]}, GDAL ${gdal[klucz]}`)
  }
  return bledy
}

// ── Opis wskaźnika ────────────────────────────────────────────────────────────────────────────

const liczbaPL = (v) =>
  new Intl.NumberFormat('pl-PL', { maximumFractionDigits: v >= 10 ? 0 : 1 }).format(v)

/** Opis z liczbami wziętymi z danych, więc nie rozjedzie się z nimi przy nowym roczniku. */
export function opisWskaznika(kotwice) {
  return (
    `Jak jasno jest nocą wokół adresu, widziane z satelity VIIRS: średnia roczna za ${ROK} r. (produkt EOG VNL 2.2), w nW/cm²/sr. Im więcej, tym więcej sztucznego światła widać z kosmosu. ` +
    'Mierzy światło wysyłane w górę z oczka 15″ (ok. 460 m × 300 m), więc opisuje zanieczyszczenie światłem w skali okolicy – nie jasność nieba widzianą z balkonu, oświetlenie ulicy ani wnętrz. ' +
    'Wartość jest wygładzona między sąsiednimi oczkami, dlatego nie ma ostrych granic. ' +
    `Dla porównania: Rynek Główny w Krakowie ${liczbaPL(kotwice.rynek)}, mediana adresów Krakowa ${liczbaPL(kotwice.medianaKrakowa)}, Las Wolski ${liczbaPL(kotwice.lasWolski)}, Puszcza Niepołomicka ${liczbaPL(kotwice.puszcza)}. ` +
    'Zero oznacza światło poniżej progu czułości satelity, nie brak pomiaru.'
  )
}

export function metaWskaznika(kotwice, pobrano = dzis()) {
  return {
    id: 'swiatlo_nocne_viirs',
    kategoria: 'spokoj',
    nazwa: 'Nocne światło z satelity (VIIRS)',
    opis: opisWskaznika(kotwice),
    jednostka: 'nW/cm²/sr',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'siatka',
    rozmiar: 'ok. 460 m × 300 m (oczko 15″, wygładzone do 3″)',
    zakres: ZAKRES,
    zadanie: 137,
    zrodla: [
      {
        nazwa: `WorldPop – Nighttime Lights 2015–2023, Polska, wariant bez filtra rozbłysków (${PLIK_RASTRA}); roczna średnia VNL przepróbkowana do 3″`,
        url: URL_STRONY_ZBIORU,
        licencja: LICENCJA_WORLDPOP,
        dataDanych: String(ROK),
        pobrano,
      },
      {
        nazwa: `Earth Observation Group, Payne Institute, Colorado School of Mines – VIIRS Nighttime Lights (VNL) v2.2, roczna średnia maskowana ${ROK} (źródło pierwotne, dane pobrane przez kopię WorldPop)`,
        url: 'https://eogdata.mines.edu/products/vnl/',
        licencja: LICENCJA_EOG,
        dataDanych: String(ROK),
        pobrano,
      },
    ],
  }
}

// ── Przebieg ──────────────────────────────────────────────────────────────────────────────────

async function sha256Pliku(sciezka) {
  const hash = createHash('sha256')
  for await (const kawalek of createReadStream(sciezka)) hash.update(kawalek)
  return hash.digest('hex')
}

const zaokr = (v, n = 1) => (v === null ? 'brak' : v.toFixed(n))
const sekundy = (od) => ((performance.now() - od) / 1000).toFixed(1)

function wypiszRozklad(nazwa, s) {
  console.log(
    `  ${nazwa.padEnd(14)} n=${s.n}, zer ${s.zer}, min ${zaokr(s.min)}, p5 ${zaokr(s.p5)}, p25 ${zaokr(s.p25)}, mediana ${zaokr(s.mediana)}, p75 ${zaokr(s.p75)}, p95 ${zaokr(s.p95)}, p97 ${zaokr(s.p97)}, p99 ${zaokr(s.p99)}, max ${zaokr(s.max)}, średnia ${zaokr(s.srednia)}`,
  )
}

/** Wartości innej warstwy dla tej samej wersji adresów albo { wartosci: null, powod } do dziennika. */
function wczytajWarstwe(id, wersja) {
  const sciezka = join(DANE, 'wskazniki', `${id}.json`)
  if (!existsSync(sciezka)) return { wartosci: null, powod: `brak pliku ${id}.json` }
  const plik = JSON.parse(readFileSync(sciezka, 'utf8'))
  if (plik.wersjaAdresow !== wersja)
    return { wartosci: null, powod: `${id} liczone dla innej wersji adresów` }
  return { wartosci: plik.wartosci, powod: null }
}

async function main() {
  const start = performance.now()
  const szybko = process.argv.includes('--szybko')
  const { wersja, adresy } = wczytajAdresy()

  const sciezka = join(CACHE, 'viirs', PLIK_RASTRA)
  mkdirSync(join(CACHE, 'viirs'), { recursive: true })
  if (!existsSync(sciezka))
    console.log(
      `Pobieram ${PLIK_RASTRA} (145 MB, jednorazowo; serwer WorldPop oddaje ok. 270 kB/s, więc ok. 9 minut)…`,
    )
  await pobierzDoCache(URL_RASTRA, join('viirs', PLIK_RASTRA))
  const rozmiar = statSync(sciezka).size
  if (rozmiar !== OCZEKIWANY_PLIK.rozmiar)
    throw new Error(
      `${sciezka}: ${rozmiar} B zamiast ${OCZEKIWANY_PLIK.rozmiar} B – pobranie ucięte albo źródło zmieniło plik. Usuń plik i uruchom ponownie.`,
    )
  const suma = await sha256Pliku(sciezka)
  if (suma !== OCZEKIWANY_PLIK.sha256)
    throw new Error(
      `${sciezka}: SHA-256 ${suma} zamiast ${OCZEKIWANY_PLIK.sha256}. Usuń plik i pobierz ponownie; jeśli suma się powtarza, WorldPop zmienił dane – sprawdź licencję i opis wersji, potem zaktualizuj OCZEKIWANY_PLIK.`,
    )

  const zrodlo = await zrodloPliku(sciezka)
  try {
    const n = await czytajNaglowekTiff(zrodlo)
    console.log(
      `Raster: ${n.szer} × ${n.wys} px (${n.duzy ? 'BigTIFF' : 'TIFF'}, kafle ${n.kafelSzer} px, kompresja ${n.kompresja}, ${n.Typ.name}), piksel ${n.dLon}°, lewy górny róg ${n.lon0.toFixed(4)}°E ${n.lat0.toFixed(4)}°N, nodata ${n.nodata}. Opis pliku: „${n.opis}”.`,
    )
    const oczekiwany = [
      [n.szer === OCZEKIWANY_PLIK.szer && n.wys === OCZEKIWANY_PLIK.wys, 'wymiary rastra'],
      [n.nodata === OCZEKIWANY_PLIK.nodata, 'wartość nodata'],
      [Math.abs(n.dLon - 1 / 1200) < 1e-9 && Math.abs(n.dLat - 1 / 1200) < 1e-9, 'piksel 3″'],
    ]
    for (const [ok, co] of oczekiwany)
      if (!ok) throw new Error(`Nagłówek rastra niezgodny z oczekiwaniami: ${co}`)

    // Dowód, że dekoder LZW i odczyt float działają: statystyki całego rastra muszą zgadzać się
    // ze statystykami, które GDAL zapisał w metadanych pliku.
    const gdal = statystykiGdal(n.metadaneGdal)
    if (szybko) console.log('Kontrola dekodera na całym rastrze pominięta (--szybko).')
    else if (Object.keys(gdal).length === 0)
      console.log('Plik nie ma statystyk GDAL w metadanych – kontrola dekodera pominięta.')
    else {
      const t = performance.now()
      const wlasne = await statystykiRastra(zrodlo, n)
      const bledy = porownajZGdal(wlasne, gdal)
      if (bledy.length)
        throw new Error(`Dekoder rozjechał się ze statystykami GDAL: ${bledy.join('; ')}`)
      console.log(
        `Kontrola dekodera (${wlasne.wszystkich.toLocaleString('pl-PL')} px, ${sekundy(t)} s): średnia ${wlasne.mean.toFixed(4)}, max ${wlasne.maximum.toFixed(2)}, ważnych ${wlasne.valid_percent.toFixed(2)}% – zgodne z metadanymi GDAL.`,
      )
    }

    const okno = await oknoDlaPunktow(zrodlo, n, adresy, ZAPAS_OKNA)
    console.log(
      `Okno: ${okno.szer} × ${okno.wys} px (${okno.kafli} kafli z ${Math.ceil(n.szer / n.kafelSzer) * Math.ceil(n.wys / n.kafelWys)}).`,
    )

    // Miejsca znane: kontrola sensu fizycznego i georeferencji.
    const miejsca = sprawdzMiejsca(okno)
    for (const m of miejsca.wyniki) console.log(`  ${m.nazwa}: ${zaokr(m.wartosc)}`)
    if (miejsca.bledy.length)
      throw new Error(`Kontrola miejsc znanych nie przeszła: ${miejsca.bledy.join('; ')}`)

    const wartosci = adresy.map((a) => wartoscPiksela(okno, a.lon, a.lat))
    const wKrakowie = adresy.map((a) => a.gmina === 'Kraków')
    const krakow = podsumuj(wartosci.filter((_, i) => wKrakowie[i]))
    const poza = podsumuj(wartosci.filter((_, i) => !wKrakowie[i]))
    console.log('Rozkład wartości (nW/cm²/sr):')
    wypiszRozklad('Kraków', krakow)
    wypiszRozklad('poza Krakowem', poza)
    const razem = podsumuj(wartosci)
    console.log(
      `Adresów z wartością: ${razem.n}/${wartosci.length} (null: ${razem.nulli}, zero źródła: ${razem.zer}). Skala [${ZAKRES}]: ${((100 * wartosci.filter((v) => v !== null && v > ZAKRES[1]).length) / razem.n).toFixed(1)}% adresów powyżej górnej granicy.`,
    )
    const najjasniejsze = adresy
      .map((a, i) => ({ a, v: wartosci[i] }))
      .filter((x) => x.v !== null)
      .sort((x, y) => y.v - x.v)
      .slice(0, 3)
    console.log(
      `Najjaśniejsze adresy: ${najjasniejsze.map(({ a, v }) => `${a.miejscowosc} ${a.ulica ?? ''} ${a.nr} (${a.gmina}) ${v.toFixed(1)}`).join('; ')}`,
    )

    // Zgodność z innymi warstwami: jasność nocna rośnie z zaludnieniem i maleje z zielenią.
    const ludnosc = wczytajWarstwe('ludnosc_1km', wersja)
    const zielen = wczytajWarstwe('zielen_worldcover_100m', wersja)
    const kontrolaKrzyzowa = []
    for (const [warstwa, id, znak, prog] of [
      [ludnosc, 'ludnosc_1km', 1, 0.5],
      [zielen, 'zielen_worldcover_100m', -1, 0.4],
    ]) {
      if (!warstwa.wartosci) {
        console.log(`Korelacja z ${id} pominięta: ${warstwa.powod}.`)
        continue
      }
      const kr = korelacjaRangowa(
        wartosci.map((v, i) => (wKrakowie[i] ? v : null)),
        warstwa.wartosci,
      )
      const opisR = kr.r === null ? 'brak' : kr.r.toFixed(3)
      console.log(`Kraków, jasność vs ${id}: Spearman ${opisR} (n = ${kr.n}).`)
      if (kr.r === null || znak * kr.r < prog)
        kontrolaKrzyzowa.push(`${id}: ${opisR}, oczekiwano ${znak > 0 ? '≥' : '≤ −'}${prog}`)
    }
    if (kontrolaKrzyzowa.length)
      throw new Error(
        `Korelacja z innymi warstwami poza oczekiwaniami: ${kontrolaKrzyzowa.join('; ')}`,
      )

    if (ludnosc.wartosci) {
      const wyniki = przesunieciaKorelacji(okno, adresy, ludnosc.wartosci, wKrakowie)
      const ocena = ocenPrzesuniecia(wyniki)
      console.log(
        `Georeferencja: maksimum korelacji z ludnością ${ocena.najlepsze.r.toFixed(3)} przy przesunięciu (${ocena.najlepsze.dc}, ${ocena.najlepsze.dr}) px, bez przesunięcia ${ocena.zero.r.toFixed(3)}.`,
      )
      if (!ocena.ok)
        throw new Error('Raster jest przesunięty względem adresów o więcej niż 5 pikseli (3″)')
    } else console.log('Test przesunięcia pominięty: brak ludnosc_1km dla tej wersji adresów.')

    const kotwice = {
      medianaKrakowa: krakow.mediana,
      ...Object.fromEntries(miejsca.wyniki.map((m) => [m.klucz, m.wartosc])),
    }
    zapiszWskaznik(metaWskaznika(kotwice), wartosci)
  } finally {
    await zrodlo.zamknij()
  }
  console.log(`Czas: ${sekundy(start)} s`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
